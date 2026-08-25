import base64
import json
import os

import frappe
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from frappe.rate_limiter import rate_limit

GRAPH_URL = "https://graph.microsoft.com/v1.0"

# The only domain this org-directory lookup is meant to serve — the case
# registration web form restricts requestor_email to this domain client-side,
# but that check is trivially bypassable by calling this whitelisted, guest
# endpoint directly, so it must also be enforced here.
ALLOWED_EMAIL_DOMAIN = "azimpremjifoundation.org"


_ACCESS_TOKEN_CACHE_KEY = "support_iid:microsoft_graph_access_token"


def _graph_get(url, headers, params=None):
	"""
	requests.get wrapper shared by the Company Directory endpoints —
	a bare connection reset/timeout talking to Graph (seen in practice:
	ConnectionResetError mid-response) previously propagated as an
	unhandled 500 all the way to the Desk page, since none of those
	endpoints caught requests.exceptions.RequestException the way
	get_access_token/_send_plain_email's callers already do elsewhere in
	this file. One retry, since a reset connection reliably succeeds on
	the very next attempt in practice; a second failure is logged and
	returned as None so the caller can degrade (partial results, empty
	list) instead of the whole request blowing up.
	"""
	for attempt in range(2):
		try:
			return requests.get(url, headers=headers, params=params, timeout=15)
		except requests.exceptions.RequestException as e:
			if attempt == 1:
				frappe.log_error(str(e), "Graph API request failed")
				return None


def get_access_token():
	"""
	Get a Microsoft Graph access token, cached in Redis for most of its
	real lifetime (Microsoft's client-credentials tokens are normally
	valid ~60-90 minutes). Every one of this endpoint's callers used to
	do a full OAuth handshake with login.microsoftonline.com on every
	single request — the slowest leg by far in the whole lookup, and
	entirely avoidable once a still-valid token is already on hand.
	"""
	cached = frappe.cache.get_value(_ACCESS_TOKEN_CACHE_KEY)
	if cached:
		return cached

	settings = frappe.get_single("Microsoft Graph Settings")

	tenant_id = settings.tenant_id
	client_id = settings.client_id
	client_secret = settings.get_password("client_secret")

	if not tenant_id:
		frappe.throw("Tenant ID is missing.")

	if not client_id:
		frappe.throw("Client ID is missing.")

	if not client_secret:
		frappe.throw("Client Secret is missing.")

	token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

	payload = {
		"grant_type": "client_credentials",
		"client_id": client_id,
		"client_secret": client_secret,
		"scope": "https://graph.microsoft.com/.default",
	}

	response = requests.post(token_url, data=payload)

	if response.status_code != 200:
		# response.text on failure is an OAuth error body (error code/
		# description), not a credential — safe to surface. On success it
		# contains the live access_token itself, so it must never be
		# logged/printed (a Graph API bearer token in server logs is
		# effectively as sensitive as the client secret).
		frappe.log_error(response.text, "Microsoft Graph token request failed")
		frappe.throw("Could not obtain a Microsoft Graph access token.")

	token_data = response.json()
	access_token = token_data["access_token"]

	# expires_in is in seconds (typically 3600) — cached for a bit less
	# than that so a request never gets handed a token that expires
	# mid-flight between the cache read and Graph actually receiving it.
	expires_in = int(token_data.get("expires_in") or 3600)
	cache_ttl = max(expires_in - 120, 60)
	frappe.cache.set_value(_ACCESS_TOKEN_CACHE_KEY, access_token, expires_in_sec=cache_ttl)

	return access_token


@frappe.whitelist()
def debug_graph(email):
	"""
	Returns the raw Microsoft Graph response.
	Useful for debugging permissions.
	"""

	token = get_access_token()

	headers = {"Authorization": f"Bearer {token}"}

	response = requests.get(f"{GRAPH_URL}/users/{email}", headers=headers)

	return {"status_code": response.status_code, "headers": dict(response.headers), "response": response.text}


# AES key — must match the key in the web form client script
AES_KEY = base64.b64decode("sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=")


# ------------------------------------------------------------------
# Encryption
# ------------------------------------------------------------------


def encrypt_payload(data: dict) -> dict:
	aesgcm = AESGCM(AES_KEY)
	nonce = os.urandom(12)
	ciphertext = aesgcm.encrypt(nonce, json.dumps(data).encode("utf-8"), None)
	return {
		"encrypted": True,
		"iv": base64.b64encode(nonce).decode("utf-8"),
		"data": base64.b64encode(ciphertext).decode("utf-8"),
	}


# ------------------------------------------------------------------
# Case Approval level settings lookup
#
# Filters by approval_limit_amount >= funds_requested.
#
# Returns the first matching row name (e.g. "L1") and all settings
# sorted ascending by approval_limit_amount.
# ------------------------------------------------------------------


def _get_level_settings(funds_requested: float):
	"""
	Returns (ceiling_level_name, ordered_settings_list) — the first
	settings row (ascending by approval_limit_amount) whose ceiling is
	>= funds_requested, or the highest level if funds_requested exceeds
	every ceiling.
	"""
	try:
		if not frappe.db.table_exists("Case Approval level settings"):
			return None, []

		# Fetch all settings sorted by amount asc
		settings = frappe.get_all(
			"Case Approval level settings",
			fields=["name", "approval_limit_amount"],
			order_by="approval_limit_amount asc",
			ignore_permissions=True,
		)

		if not settings:
			return None, []

		# Find first row whose ceiling >= funds_requested
		for row in settings:
			if float(row.get("approval_limit_amount") or 0) >= float(funds_requested or 0):
				return row.get("name"), settings

		# Amount exceeds all — use highest level
		return settings[-1].get("name"), settings

	except Exception:
		frappe.log_error(frappe.get_traceback(), "Case Approval level settings fetch failed")
		return None, []


def _allowed_level_names(ceiling_name: str, settings: list) -> set:
	allowed = set()
	for row in settings:
		name = row.get("name")
		allowed.add(name)
		if name == ceiling_name:
			break
	return allowed


# ------------------------------------------------------------------
# Robust Approval Hierarchy lookup
# ------------------------------------------------------------------


def _find_hierarchy_doc(email: str):
	"""
	Returns the Approval Hierarchy doc name if found, else None.
	Tries 3 strategies for robustness against migration/case issues.
	"""
	email_lower = (email or "").strip().lower()

	# Strategy 1: standard filter
	try:
		name = frappe.db.get_value(
			"Approval Hierarchy", {"requestor_email": email}, "name", ignore_permissions=True
		)
		if name:
			return name
	except Exception:
		pass

	# Strategy 2: case-insensitive SQL
	try:
		result = frappe.db.sql(
			"SELECT name FROM `tabApproval Hierarchy` WHERE LOWER(requestor_email) = %s LIMIT 1",
			(email_lower,),
			as_dict=True,
		)
		if result:
			return result[0].get("name")
	except Exception:
		pass

	# Strategy 3: scan all docs in Python
	try:
		all_docs = frappe.get_all(
			"Approval Hierarchy",
			fields=["name", "requestor_email"],
			ignore_permissions=True,
			limit_page_length=500,
		)
		for doc in all_docs:
			if (doc.get("requestor_email") or "").strip().lower() == email_lower:
				return doc["name"]
	except Exception:
		pass

	return None


# ------------------------------------------------------------------
# PATH A: Approval Hierarchy found
# ------------------------------------------------------------------


def _stages_from_hierarchy(parent_name: str, funds_requested: float) -> list:
	"""
	Loads Approval Hierarchy doc, reads approval_hierarchy_details
	child table (Case Approval Stage doctype).

	Filters child rows by allowed levels based on funds_requested
	(checked against Case Approval level settings).
	"""
	try:
		doc = frappe.get_doc("Approval Hierarchy", parent_name)
		child_rows = doc.get("approval_hierarchy_details") or []
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Approval Hierarchy get_doc failed")
		return []

	if not child_rows:
		return []

	# Get ceiling level based on amount
	ceiling_name, settings = _get_level_settings(funds_requested)

	if ceiling_name and settings:
		allowed = _allowed_level_names(ceiling_name, settings)

		# case_approval_level_decription is Link to Case Approval level settings
		# Its stored value = settings record name (e.g. "L1", "L2")
		filtered = [
			row for row in child_rows if (row.get("case_approval_level_decription") or "").strip() in allowed
		]

		# Fallback: slice by position if filter yields nothing
		if not filtered:
			ordered = [s.get("name") for s in settings]
			try:
				count = ordered.index(ceiling_name) + 1
			except ValueError:
				count = len(child_rows)
			filtered = list(child_rows)[:count]
	else:
		filtered = list(child_rows)

	stages = []
	for i, row in enumerate(filtered):
		level_id = row.get("case_approval_level_decription") or ("L" + str(i + 1))
		stages.append(
			{
				"case_approval_level": level_id,
				"case_approval_level_decription": level_id,
				"case_approval_status": "",
				"approver_name": row.get("approver_name") or "",
				"approver_email": row.get("approver_email") or "",
			}
		)

	return stages


# ------------------------------------------------------------------
# PATH B: No Approval Hierarchy — use Graph manager chain
# ------------------------------------------------------------------


def _stages_from_graph_chain(manager_chain: list, funds_requested: float) -> list:

	ceiling_name, settings = _get_level_settings(funds_requested)

	if ceiling_name and settings:
		ordered = [s.get("name") for s in settings]
		try:
			count = ordered.index(ceiling_name) + 1
		except ValueError:
			count = len(manager_chain)
		levels_needed = min(count, len(manager_chain))
		level_ids = [s.get("name") for s in settings]
	else:
		levels_needed = len(manager_chain)
		level_ids = []

	stages = []
	for i in range(levels_needed):
		m = manager_chain[i]
		level_id = level_ids[i] if i < len(level_ids) else "L" + str(i + 1)
		stages.append(
			{
				"case_approval_level": level_id,
				"case_approval_level_decription": level_id,
				"case_approval_status": "",
				"approver_name": m.get("name") or "",
				"approver_email": m.get("email") or "",
			}
		)

	return stages


# ------------------------------------------------------------------
# Current-reviewer lookup — used when a Sent-Back case is resubmitted,
# so the re-sent approval email goes to whoever is presently configured
# as that level's approver in Approval Hierarchy, not whoever it was
# when the case was first submitted (the org's reviewers can change).
# ------------------------------------------------------------------


def get_current_approver_for_level(requestor_email: str, level_name: str):
	"""
	Returns {"approver_name", "approver_email"} for the given level from
	the requestor's current Approval Hierarchy record, or None if no
	hierarchy doc or no matching level row exists (caller should keep
	the case's existing approver in that case).
	"""
	hierarchy_name = _find_hierarchy_doc(requestor_email)
	if not hierarchy_name:
		return None

	try:
		doc = frappe.get_doc("Approval Hierarchy", hierarchy_name)
	except Exception:
		return None

	for row in doc.get("approval_hierarchy_details") or []:
		if (row.get("case_approval_level_decription") or "").strip() == (level_name or "").strip():
			return {
				"approver_name": row.get("approver_name") or "",
				"approver_email": row.get("approver_email") or "",
			}
	return None


# ------------------------------------------------------------------
# Manager chain walker
# ------------------------------------------------------------------


def get_manager_chain(email: str, headers: dict, max_depth: int = 3) -> list:
	chain = []
	current = email
	seen = set()

	for _ in range(max_depth):
		resp = _graph_get(f"{GRAPH_URL}/users/{current}/manager", headers)
		if resp is None or resp.status_code != 200:
			break
		m = resp.json()
		m_email = m.get("mail") or m.get("userPrincipalName")
		if not m_email or m_email in seen:
			break
		seen.add(m_email)
		chain.append(
			{
				"name": m.get("displayName"),
				"email": m_email,
				"designation": m.get("jobTitle"),
				"department": m.get("department"),
			}
		)
		current = m_email

	return chain


# ------------------------------------------------------------------
# Combined endpoint — single API call from the web form
# ------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=60 * 60)
def get_employee_details(email, funds_requested=None):
	email = (email or "").strip()

	# This is always the requestor's own email (the web form only ever
	# calls this lookup for requestor_email, never approver_email) — gated
	# by Support IID Settings.enforce_email_domain_validation so the same
	# toggle that controls the web form's client-side domain check also
	# controls this server-side one. Defaults to enforced if the setting is
	# missing, matching the web form JS's own default.
	enforce_domain = frappe.db.get_single_value("Support IID Settings", "enforce_email_domain_validation")
	if enforce_domain is None or enforce_domain:
		domain = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
		if domain != ALLOWED_EMAIL_DOMAIN:
			frappe.throw("This lookup is only available for organization email addresses.")

	token = get_access_token()
	headers = {"Authorization": f"Bearer {token}"}

	fields = ",".join(
		[
			"id",
			"displayName",
			"givenName",
			"surname",
			"mail",
			"userPrincipalName",
			"jobTitle",
			"department",
			"companyName",
			"officeLocation",
			"mobilePhone",
			"businessPhones",
			"employeeId",
			"city",
			"state",
			"country",
		]
	)

	response = _graph_get(f"{GRAPH_URL}/users/{email}", headers, {"$select": fields})

	if response is None:
		# Both attempts in _graph_get failed (a connection reset/timeout
		# talking to Graph, already logged there) — distinct from a clean
		# 404/error response below, so the caller can tell "try again" apart
		# from "this email genuinely isn't in the directory."
		return encrypt_payload(
			{"exists": False, "transient_error": True, "message": "Could not reach the directory service. Please try again."}
		)

	if response.status_code == 404:
		return encrypt_payload({"exists": False, "message": "Email not found."})

	if response.status_code != 200:
		return encrypt_payload({"exists": False, "status_code": response.status_code, "error": response.text})

	user = response.json()

	# Manager chain — fetched only as internal input to the approval-stage
	# computation below (Path B fallback); not returned to the caller.
	manager_chain = get_manager_chain(email, headers, max_depth=3)

	# ------------------------------------------------------------------
	# Approval stages
	# ------------------------------------------------------------------
	approval_stages = []
	funds = float(funds_requested or 0)

	try:
		hierarchy_name = _find_hierarchy_doc(email)

		if hierarchy_name:
			# Path A: use Approval Hierarchy child table
			approval_stages = _stages_from_hierarchy(hierarchy_name, funds)
		else:
			# Path B: use Graph manager chain
			approval_stages = _stages_from_graph_chain(manager_chain, funds)

	except Exception:
		frappe.log_error(frappe.get_traceback(), "Approval stage build failed")
		try:
			approval_stages = _stages_from_graph_chain(manager_chain, funds)
		except Exception:
			approval_stages = []

	# Only the fields the web form actually consumes to prefill the case
	# registration form are returned — manager/manager_chain/direct_reports/
	# photo/employee_id/city/state/country are org-directory PII this
	# endpoint has no need to expose to the caller.
	result = {
		"exists": True,
		"employee": {
			"name": user.get("displayName"),
			"email": user.get("mail") or user.get("userPrincipalName"),
			"department": user.get("department"),
			"designation": user.get("jobTitle"),
			"mobile": user.get("mobilePhone"),
			"office_location": user.get("officeLocation"),
		},
		"approval_stages": approval_stages,
	}

	return encrypt_payload(result)


# ------------------------------------------------------------------
# Standalone skip-level lookup (backward compatibility)
# ------------------------------------------------------------------


# ------------------------------------------------------------------
# Company directory — System Manager only. Lists every user in a given
# company (companyName in Azure AD) with their email and direct-report
# count, for the internal "Company Directory" Desk page. Separate from
# get_employee_details above (allow_guest, single-user, case-form
# prefill) — this is an internal, admin-only, org-wide listing, so it's
# whitelisted without allow_guest and checked against System Manager
# explicitly rather than relying on the page's own role restriction
# alone (same defense-in-depth pattern as close_case/reviewer_final_approval
# checking their own permission rather than trusting the caller).
# ------------------------------------------------------------------


def _require_system_manager():
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles(frappe.session.user):
		frappe.throw("You don't have permission to view the company directory.", frappe.PermissionError)


@frappe.whitelist()
def get_directory_companies():
	"""
	Distinct companyName values across the tenant, for the Company
	Directory page's filter dropdown. Graph has no native DISTINCT — this
	pages through every user's companyName (id + companyName only, to
	keep each page small) and dedupes in Python.
	"""
	_require_system_manager()

	token = get_access_token()
	headers = {"Authorization": f"Bearer {token}"}

	companies = set()
	url = f"{GRAPH_URL}/users"
	params = {"$select": "companyName", "$top": 999}
	error = None

	# Graph pages via @odata.nextLink (a full URL with its own query
	# string) — once present, subsequent requests use that URL as-is and
	# drop params, matching Graph's own pagination contract.
	for _ in range(50):
		resp = _graph_get(url, headers, params)
		if resp is None:
			# Both attempts in _graph_get failed (already logged there) —
			# surface this distinctly from "the tenant just has no
			# companies", so the page can tell an admin the list may be
			# incomplete rather than silently showing an empty dropdown.
			error = "Could not reach the directory service. The list below may be incomplete."
			break
		if resp.status_code != 200:
			frappe.log_error(resp.text, "Graph directory companies fetch failed")
			error = "The directory service returned an error. The list below may be incomplete."
			break
		data = resp.json()
		for u in data.get("value") or []:
			name = (u.get("companyName") or "").strip()
			if name:
				companies.add(name)
		next_link = data.get("@odata.nextLink")
		if not next_link:
			break
		url, params = next_link, None

	return {"items": sorted(companies), "error": error}


def _fetch_directory_rows_for_company(company, headers):
	"""
	Shared by get_directory_users (Desk table — reportee_count/reportee_names
	both come along for free) and the Excel export endpoints below (which
	need reportee_names specifically) — one Graph call per user in the
	company either way (directReports), so there's no reason for the
	export path to re-fetch what this already gets.

	Returns (rows, error) — error is a user-facing message string, or None.
	"""
	company_escaped = company.replace("'", "''")

	fields = ",".join(["id", "displayName", "mail", "userPrincipalName", "jobTitle", "department", "companyName"])
	users = []
	url = f"{GRAPH_URL}/users"
	params = {
		"$select": fields,
		"$filter": f"companyName eq '{company_escaped}'",
		"$count": "true",
		"$top": 999,
	}
	error = None

	for _ in range(50):
		resp = _graph_get(url, headers, params)
		if resp is None:
			error = "Could not reach the directory service. This list may be incomplete."
			break
		if resp.status_code != 200:
			frappe.log_error(resp.text, "Graph directory users fetch failed")
			error = "The directory service returned an error. This list may be incomplete."
			break
		data = resp.json()
		users.extend(data.get("value") or [])
		next_link = data.get("@odata.nextLink")
		if not next_link:
			break
		url, params = next_link, None

	rows = []
	for u in users:
		# Every account Graph returns for the company is listed as-is,
		# shared mailboxes/meeting-room resources included — this tenant
		# has no field reliably distinguishing those from real employees
		# (userType/employeeId/jobTitle look identical for both), so
		# filtering any of them out risks silently hiding a real person.
		# Only a row with no email at all (neither mail nor
		# userPrincipalName) is skipped, since there'd be nothing to show
		# in the Email column anyway.
		email = u.get("mail") or u.get("userPrincipalName")
		if not email:
			continue

		user_id = u.get("id")
		reportee_names = []
		if user_id:
			reports_resp = _graph_get(
				f"{GRAPH_URL}/users/{user_id}/directReports",
				headers,
				{"$select": "displayName"},
			)
			if reports_resp is not None and reports_resp.status_code == 200:
				reportee_names = [
					r.get("displayName") for r in (reports_resp.json().get("value") or []) if r.get("displayName")
				]

		rows.append(
			{
				"id": user_id,
				"name": u.get("displayName"),
				"email": email,
				"designation": u.get("jobTitle"),
				"department": u.get("department"),
				"company": u.get("companyName"),
				"reportee_count": len(reportee_names),
				"reportee_names": reportee_names,
			}
		)

	return rows, error


@frappe.whitelist()
def get_directory_users(company=None):
	"""
	Users in `company` (companyName, exact match) with their email and
	direct-report count — the Company Directory page's main table.
	See _fetch_directory_rows_for_company for the per-user Graph call
	this needs (directReports, once per user in the company).
	"""
	_require_system_manager()

	if not (company or "").strip():
		return {"items": [], "error": None}

	token = get_access_token()
	# companyName filtering needs Graph's "advanced query" support — plain
	# $filter on this property 400s with Request_UnsupportedQuery without
	# both the ConsistencyLevel header and $count=true (confirmed against
	# this tenant; see get_directory_companies, which works unfiltered
	# without either).
	headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual"}

	rows, error = _fetch_directory_rows_for_company(company, headers)
	return {"items": rows, "error": error}


@frappe.whitelist()
def get_directory_reportees(user_id):
	"""
	Direct reports for one user (by Graph object id) — fetched on demand
	when a row in the Company Directory table is expanded, rather than
	upfront for every row in get_directory_users (which would multiply
	the already-one-call-per-user Graph load there by however many
	reports each person has).
	"""
	_require_system_manager()

	if not (user_id or "").strip():
		return {"items": [], "error": None}

	token = get_access_token()
	headers = {"Authorization": f"Bearer {token}"}

	fields = ",".join(["id", "displayName", "mail", "userPrincipalName", "jobTitle", "department"])
	resp = _graph_get(f"{GRAPH_URL}/users/{user_id}/directReports", headers, {"$select": fields})
	if resp is None:
		return {"items": [], "error": "Could not reach the directory service. Please try again."}
	if resp.status_code != 200:
		frappe.log_error(resp.text, "Graph directory reportees fetch failed")
		return {"items": [], "error": "The directory service returned an error. Please try again."}

	items = [
		{
			"id": r.get("id"),
			"name": r.get("displayName"),
			"email": r.get("mail") or r.get("userPrincipalName"),
			"designation": r.get("jobTitle"),
			"department": r.get("department"),
		}
		for r in resp.json().get("value") or []
	]
	return {"items": items, "error": None}


# ------------------------------------------------------------------
# Excel export — Company Directory page
#
# Two separate entry points, since they have very different cost:
#
# - export_directory_company (sync, whitelisted): the currently-selected
#   company only, reusing the exact same rows/Graph calls the Desk table
#   already made. Bounded by that one company's headcount — fast enough
#   to return directly as a file download in the same request.
#
# - export_directory_all_companies (enqueued, whitelisted only to kick
#   off the job): every company in the tenant. At 12k+ users tenant-wide
#   and one Graph call per person for reportee names, this is a genuinely
#   slow job (potentially thousands of calls) — run on the "long" queue,
#   reporting progress via frappe.publish_progress, and finishing with
#   both a realtime push (page still open) and a persistent Notification
#   Log entry (bell icon) carrying the download link, since a job this
#   long very plausibly outlives the user staying on the page.
# ------------------------------------------------------------------

_EXPORT_SHEET_HEADER = ["Company", "Employee Name", "Email", "Department", "Designation", "Reportee Names"]


def _rows_to_sheet_data(rows):
	data = [_EXPORT_SHEET_HEADER]
	for row in rows:
		data.append(
			[
				row.get("company") or "",
				row.get("name") or "",
				row.get("email") or "",
				row.get("department") or "",
				row.get("designation") or "",
				", ".join(row.get("reportee_names") or []),
			]
		)
	return data


@frappe.whitelist()
def export_directory_company(company=None):
	"""
	Synchronous export for the currently-selected company only — reuses
	_fetch_directory_rows_for_company (same call the Desk table itself
	just made), so this is bounded by that one company's headcount and
	fast enough to serve directly as a file download.
	"""
	_require_system_manager()

	from frappe.utils.xlsxutils import build_xlsx_response

	company = (company or "").strip()
	if not company:
		frappe.throw("Select a company first.")

	token = get_access_token()
	headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual"}
	rows, error = _fetch_directory_rows_for_company(company, headers)

	if error and not rows:
		frappe.throw(error)

	build_xlsx_response(_rows_to_sheet_data(rows), f"Company Directory - {company}")


@frappe.whitelist()
def export_directory_all_companies():
	"""
	Kicks off the full-tenant export as a background job (see
	_run_export_directory_all_companies) and returns immediately — the
	Desk page shows a "started" toast, then listens for the
	directory_export_all_done realtime event this job publishes on
	completion. Returns the RQ job id so the frontend could poll job
	status directly if it ever needs to (not currently used — realtime
	push is the primary notification path, per get_directory_reportees's
	sibling endpoints all following the same push-not-poll pattern used
	throughout Frappe core for long jobs).
	"""
	_require_system_manager()

	job = frappe.enqueue(
		"support_iid.api.microsoft_graph._run_export_directory_all_companies",
		queue="long",
		timeout=3600,
		user=frappe.session.user,
	)
	return {"job_id": job.id}


def _run_export_directory_all_companies(user):
	"""
	The actual background job body for export_directory_all_companies.
	Not whitelisted — only frappe.enqueue (from the whitelisted trigger
	above) is meant to call this, same as every other core "Prepared
	Report"-style background export.
	"""
	from frappe.utils.xlsxutils import build_xlsx_response, make_xlsx

	frappe.set_user(user)

	token = get_access_token()
	headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual"}

	companies_result = get_directory_companies()
	companies = companies_result["items"]
	total = len(companies) or 1

	all_rows = []
	for i, company in enumerate(companies):
		frappe.publish_progress(
			percent=(i / total) * 100,
			title="Exporting Company Directory",
			description=f"{company} ({i + 1}/{total})",
		)
		rows, _company_error = _fetch_directory_rows_for_company(company, headers)
		all_rows.extend(rows)

	frappe.publish_progress(percent=100, title="Exporting Company Directory", description="Saving file…")

	xlsx_data = make_xlsx(_rows_to_sheet_data(all_rows), "Company Directory - All Companies")

	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": "Company Directory - All Companies.xlsx",
			"is_private": 1,
			"content": xlsx_data.getvalue(),
		}
	)
	file_doc.save(ignore_permissions=True)

	frappe.publish_realtime(
		"directory_export_all_done",
		{"file_url": file_doc.file_url, "row_count": len(all_rows)},
		user=user,
	)

	frappe.get_doc(
		{
			"doctype": "Notification Log",
			"subject": f"Company Directory export ready — {len(all_rows)} people across {total} companies.",
			"email_content": f'<a href="{file_doc.file_url}" target="_blank">Download Company Directory.xlsx</a>',
			"for_user": user,
			"type": "Alert",
			"document_type": "File",
			"document_name": file_doc.name,
		}
	).insert(ignore_permissions=True)

	frappe.db.commit()


# ------------------------------------------------------------------
# Full-tenant directory load — Company Directory page's main table
#
# Same "loop every company, one Graph call per user for reportee names"
# cost as export_directory_all_companies above, so it shares the same
# background-job treatment: the page triggers this once on load, shows
# progress, and reads the cached result once done — rather than ever
# trying to serve ~12k users' worth of Graph calls inline within a
# single Desk request/response cycle.
# ------------------------------------------------------------------

_DIRECTORY_FULL_LOAD_CACHE_KEY_PREFIX = "support_iid:directory_full_load:"


@frappe.whitelist()
def start_directory_full_load():
	"""
	Kicks off the full-tenant directory fetch as a background job and
	returns immediately. The page listens for the directory_full_load_done
	realtime event, then calls get_directory_full_load_result to read the
	cached rows (kept out of the realtime payload itself, since a
	12k-row payload has no business riding a websocket message).
	"""
	_require_system_manager()

	job = frappe.enqueue(
		"support_iid.api.microsoft_graph._run_directory_full_load",
		queue="long",
		timeout=3600,
		user=frappe.session.user,
	)
	return {"job_id": job.id}


def _run_directory_full_load(user):
	"""
	Background job body for start_directory_full_load — not whitelisted,
	only frappe.enqueue is meant to call this (same pattern as
	_run_export_directory_all_companies).
	"""
	frappe.set_user(user)

	token = get_access_token()
	headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual"}

	companies_result = get_directory_companies()
	companies = companies_result["items"]
	total = len(companies) or 1

	all_rows = []
	any_error = None
	for i, company in enumerate(companies):
		frappe.publish_progress(
			percent=(i / total) * 100,
			title="Loading Company Directory",
			description=f"{company} ({i + 1}/{total})",
		)
		rows, company_error = _fetch_directory_rows_for_company(company, headers)
		all_rows.extend(rows)
		any_error = any_error or company_error

	frappe.publish_progress(percent=100, title="Loading Company Directory", description="Done")

	# Cached, not persisted — this is a point-in-time directory snapshot
	# for display, not a record anything else in the app reads; a 30
	# minute TTL is long enough to survive the user paging around the
	# Desk and coming back, without the cache silently going stale across
	# a full workday of Graph-side org changes.
	cache_key = _DIRECTORY_FULL_LOAD_CACHE_KEY_PREFIX + user
	frappe.cache.set_value(
		cache_key, {"items": all_rows, "error": any_error}, expires_in_sec=30 * 60
	)

	frappe.publish_realtime(
		"directory_full_load_done",
		{"row_count": len(all_rows), "error": any_error},
		user=user,
	)


@frappe.whitelist()
def get_directory_full_load_result():
	"""
	Reads back the cached result of the most recent start_directory_full_load
	run for the current user, if any (None if it's never been run, or the
	30-minute cache TTL has since expired — the page treats either the
	same as "not loaded yet", and re-triggers start_directory_full_load).
	"""
	_require_system_manager()

	cache_key = _DIRECTORY_FULL_LOAD_CACHE_KEY_PREFIX + frappe.session.user
	return frappe.cache.get_value(cache_key)


@frappe.whitelist(methods=["POST"])
def get_skip_level_manager(email):
	token = get_access_token()
	headers = {"Authorization": f"Bearer {token}"}

	mgr_resp = requests.get(f"{GRAPH_URL}/users/{email}/manager", headers=headers)
	if mgr_resp.status_code != 200:
		return encrypt_payload({"exists": False, "message": "No manager found."})

	manager = mgr_resp.json()
	manager_email = manager.get("mail") or manager.get("userPrincipalName")

	if not manager_email:
		return encrypt_payload({"exists": False, "message": "Manager has no email on record."})

	skip_resp = requests.get(f"{GRAPH_URL}/users/{manager_email}/manager", headers=headers)
	if skip_resp.status_code != 200:
		return encrypt_payload({"exists": False, "message": "No skip-level manager found."})

	skip = skip_resp.json()
	return encrypt_payload(
		{
			"exists": True,
			"immediate_manager": {
				"name": manager.get("displayName"),
				"email": manager_email,
				"designation": manager.get("jobTitle"),
			},
			"skip_level_manager": {
				"name": skip.get("displayName"),
				"email": skip.get("mail") or skip.get("userPrincipalName"),
				"designation": skip.get("jobTitle"),
			},
		}
	)

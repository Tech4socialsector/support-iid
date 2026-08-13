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
		resp = requests.get(f"{GRAPH_URL}/users/{current}/manager", headers=headers)
		if resp.status_code != 200:
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

	response = requests.get(f"{GRAPH_URL}/users/{email}", headers=headers, params={"$select": fields})

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

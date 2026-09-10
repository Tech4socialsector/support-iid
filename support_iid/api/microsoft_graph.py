import base64
import json
import os

import frappe
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from frappe.rate_limiter import rate_limit

GRAPH_URL = "https://graph.microsoft.com/v1.0"

ALLOWED_EMAIL_DOMAIN = "azimpremjifoundation.org"


_ACCESS_TOKEN_CACHE_KEY = "support_iid:microsoft_graph_access_token"


def _graph_get(url, headers, params=None):
	for attempt in range(2):
		try:
			return requests.get(url, headers=headers, params=params, timeout=15)
		except requests.exceptions.RequestException as e:
			if attempt == 1:
				frappe.log_error(str(e), "Graph API request failed")
				return None


def get_access_token():
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
		frappe.log_error(response.text, "Microsoft Graph token request failed")
		frappe.throw("Could not obtain a Microsoft Graph access token.")

	token_data = response.json()
	access_token = token_data["access_token"]

	expires_in = int(token_data.get("expires_in") or 3600)
	cache_ttl = max(expires_in - 120, 60)
	frappe.cache.set_value(_ACCESS_TOKEN_CACHE_KEY, access_token, expires_in_sec=cache_ttl)

	return access_token


@frappe.whitelist()
def debug_graph(email):

	token = get_access_token()

	headers = {"Authorization": f"Bearer {token}"}

	response = requests.get(f"{GRAPH_URL}/users/{email}", headers=headers)

	return {"status_code": response.status_code, "headers": dict(response.headers), "response": response.text}


def _response_aes_key():
	"""
	Same derivation as _response_aes_key() in case_register.py (kept as a
	small, dependency-free duplicate here rather than an import, to avoid
	a circular import — case_register.py already imports FROM this
	module) — must produce the identical key, since every web form's
	client-side JS uses one shared key to decrypt responses from both
	this module and case_register.py. See that function's own docstring
	for why this is derived from the site's own real secret
	(get_encryption_key()) instead of a fixed literal, and what that
	does and doesn't protect against.
	"""
	import hashlib

	from frappe.utils.password import get_encryption_key

	site_key = get_encryption_key().encode("utf-8")
	return hashlib.sha256(site_key + b"support_iid:response-encryption-v1").digest()


def encrypt_payload(data: dict) -> dict:
	aesgcm = AESGCM(_response_aes_key())
	nonce = os.urandom(12)
	ciphertext = aesgcm.encrypt(nonce, json.dumps(data).encode("utf-8"), None)
	return {
		"encrypted": True,
		"iv": base64.b64encode(nonce).decode("utf-8"),
		"data": base64.b64encode(ciphertext).decode("utf-8"),
	}


def _get_level_settings(funds_requested: float):
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


def _find_hierarchy_doc(email: str):
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


def _stages_from_hierarchy(parent_name: str, funds_requested: float) -> list:
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


def get_current_approver_for_level(requestor_email: str, level_name: str):
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


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=60 * 60)
def get_employee_details(email, funds_requested=None):
	email = (email or "").strip()

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
		return encrypt_payload(
			{"exists": False, "transient_error": True, "message": "Could not reach the directory service. Please try again."}
		)

	if response.status_code == 404:
		return encrypt_payload({"exists": False, "message": "Email not found."})

	if response.status_code != 200:
		return encrypt_payload({"exists": False, "status_code": response.status_code, "error": response.text})

	user = response.json()

	manager_chain = get_manager_chain(email, headers, max_depth=3)

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


def _require_system_manager():
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles(frappe.session.user):
		frappe.throw("You don't have permission to view the company directory.", frappe.PermissionError)


@frappe.whitelist()
def get_directory_companies():
	_require_system_manager()

	token = get_access_token()
	headers = {"Authorization": f"Bearer {token}"}

	companies = set()
	url = f"{GRAPH_URL}/users"
	params = {"$select": "companyName", "$top": 999}
	error = None

	for _ in range(50):
		resp = _graph_get(url, headers, params)
		if resp is None:
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
	_require_system_manager()

	if not (company or "").strip():
		return {"items": [], "error": None}

	token = get_access_token()
	headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual"}

	rows, error = _fetch_directory_rows_for_company(company, headers)
	return {"items": rows, "error": error}


@frappe.whitelist()
def get_directory_reportees(user_id):
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
	_require_system_manager()

	job = frappe.enqueue(
		"support_iid.api.microsoft_graph._run_export_directory_all_companies",
		queue="long",
		timeout=3600,
		user=frappe.session.user,
	)
	return {"job_id": job.id}


def _run_export_directory_all_companies(user):
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


_DIRECTORY_FULL_LOAD_CACHE_KEY_PREFIX = "support_iid:directory_full_load:"


@frappe.whitelist()
def start_directory_full_load():
	_require_system_manager()

	job = frappe.enqueue(
		"support_iid.api.microsoft_graph._run_directory_full_load",
		queue="long",
		timeout=3600,
		user=frappe.session.user,
	)
	return {"job_id": job.id}


def _run_directory_full_load(user):
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

import frappe
import requests
import base64
import os
import json
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

GRAPH_URL = "https://graph.microsoft.com/v1.0"


def get_access_token():
    """Get Microsoft Graph Access Token"""

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

    token_url = (
        f"https://login.microsoftonline.com/"
        f"{tenant_id}/oauth2/v2.0/token"
    )

    payload = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://graph.microsoft.com/.default"
    }

    response = requests.post(token_url, data=payload)

    print("=" * 80)
    print("TOKEN STATUS:", response.status_code)
    print(response.text)
    print("=" * 80)

    if response.status_code != 200:
        frappe.throw(response.text)

    return response.json()["access_token"]


@frappe.whitelist()
def test_token():
    token = get_access_token()

    return {
        "success": True,
        "token": token[:80] + "..."
    }


@frappe.whitelist()
def debug_graph(email):
    """
    Returns the raw Microsoft Graph response.
    Useful for debugging permissions.
    """

    token = get_access_token()

    headers = {
        "Authorization": f"Bearer {token}"
    }

    response = requests.get(
        f"{GRAPH_URL}/users/{email}",
        headers=headers
    )

    return {
        "status_code": response.status_code,
        "headers": dict(response.headers),
        "response": response.text
    }






# AES_KEY = base64.b64decode("sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=")
# import os
# import json
# import base64

# import frappe
# import requests
# from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# # Assumes GRAPH_URL and get_access_token() are already defined
# # in this file above this point.

# AES_KEY = base64.b64decode("sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=")


# def encrypt_payload(data: dict) -> dict:
#     aesgcm = AESGCM(AES_KEY)
#     nonce  = os.urandom(12)
#     ciphertext = aesgcm.encrypt(nonce, json.dumps(data).encode("utf-8"), None)
#     return {
#         "encrypted": True,
#         "iv":   base64.b64encode(nonce).decode("utf-8"),
#         "data": base64.b64encode(ciphertext).decode("utf-8")
#     }


# # ------------------------------------------------------------------
# # Approval stage builder
# # ------------------------------------------------------------------

# def _build_approval_stages(manager_chain: list, funds_requested: float) -> list:
#     """
#     Given the Graph manager chain (ordered low -> high in hierarchy)
#     and the funds requested, return a list of approval stage dicts
#     ready to be inserted into the Case Approval Stage child table.

#     The mapping is:
#       manager_chain[0]  L1  immediate manager
#       manager_chain[1]  L2  skip-level
#       manager_chain[2]  L3  two levels up

#     "Case Approval Level Settings" rows define which levels are required
#     for the given funds_requested amount. Each row has:
#       approval_limit_amount  the upper ceiling for that level
#       function               (currently unused placeholder — treated as the level number)

#     We pick the levels whose ceiling >= funds_requested, take the lowest
#     applicable ceiling, and return stages up to that many levels.
#     If no settings exist, we return all three levels from the chain.
#     """

#     # Fetch level settings sorted ascending by approval_limit_amount
#     settings = frappe.get_all(
#         "Case Approval level settings",
#         fields=["name", "approval_limit_amount", "function"],
#         order_by="approval_limit_amount asc",
#         ignore_permissions=True
#     )

#     # Determine how many levels are required for this amount
#     # The first row whose approval_limit_amount >= funds_requested
#     # tells us the minimum level needed.
#     levels_needed = len(manager_chain)  # default: all available levels

#     if settings:
#         for s in settings:
#             if float(s.get("approval_limit_amount") or 0) >= float(funds_requested or 0):
#                 # number of levels = position in sorted list + 1
#                 idx = settings.index(s)
#                 levels_needed = idx + 1
#                 break

#     # Cap at available managers in chain
#     levels_needed = min(levels_needed, len(manager_chain))

#     stages = []
#     level_labels = ["L1 - Reviewer", "L2 - Approver", "L3 - Senior Approver"]

#     for i in range(levels_needed):
#         m = manager_chain[i]
#         stages.append({
#             "case_approval_level":          "L" + str(i + 1),
#             "case_approval_level_decription": level_labels[i] if i < len(level_labels) else "L" + str(i + 1),
#             "case_approval_status":         "",
#             "approver_name":               m.get("name") or "",
#             "approver_email":              m.get("email") or ""
#         })

#     return stages


# # ------------------------------------------------------------------
# # Combined Graph + approval stage endpoint
# # ------------------------------------------------------------------

# @frappe.whitelist(allow_guest=True, methods=["POST"])
# def get_employee_details(email, funds_requested=None):

#     token   = get_access_token()
#     headers = {"Authorization": f"Bearer {token}"}

#     fields = ",".join([
#         "id", "displayName", "givenName", "surname",
#         "mail", "userPrincipalName", "jobTitle", "department",
#         "companyName", "officeLocation", "mobilePhone",
#         "businessPhones", "employeeId", "city", "state", "country"
#     ])

#     response = requests.get(
#         f"{GRAPH_URL}/users/{email}",
#         headers=headers,
#         params={"$select": fields}
#     )

#     if response.status_code == 404:
#         return encrypt_payload({"exists": False, "message": "Email not found."})

#     if response.status_code != 200:
#         return encrypt_payload({
#             "exists": False,
#             "status_code": response.status_code,
#             "error": response.text
#         })

#     user = response.json()

#     # ------------------------------------------------------------------
#     # Manager (immediate)
#     # ------------------------------------------------------------------
#     manager = {}
#     manager_response = requests.get(f"{GRAPH_URL}/users/{email}/manager", headers=headers)
#     if manager_response.status_code == 200:
#         m = manager_response.json()
#         manager = {
#             "name":        m.get("displayName"),
#             "email":       m.get("mail"),
#             "designation": m.get("jobTitle"),
#             "department":  m.get("department")
#         }

#     # ------------------------------------------------------------------
#     # Manager chain (up to 3 levels for approval stages)
#     # ------------------------------------------------------------------
#     manager_chain = get_manager_chain(email, headers, max_depth=3)

#     # ------------------------------------------------------------------
#     # Direct Reports
#     # ------------------------------------------------------------------
#     direct_reports = []
#     report_response = requests.get(f"{GRAPH_URL}/users/{email}/directReports", headers=headers)
#     if report_response.status_code == 200:
#         for emp in report_response.json().get("value", []):
#             direct_reports.append({
#                 "name":        emp.get("displayName"),
#                 "email":       emp.get("mail"),
#                 "designation": emp.get("jobTitle")
#             })

#     # ------------------------------------------------------------------
#     # Profile Photo
#     # ------------------------------------------------------------------
#     photo = None
#     photo_response = requests.get(f"{GRAPH_URL}/users/{email}/photo/$value", headers=headers)
#     if photo_response.status_code == 200:
#         photo = base64.b64encode(photo_response.content).decode()

#     # ------------------------------------------------------------------
#     # Approval stage — try Frappe Approval Hierarchy first,
#     # fall back to Graph manager chain if not found
#     # ------------------------------------------------------------------
#     approval_stages = []

#     try:
#         # Try Frappe-configured hierarchy first
#         hierarchy_name = frappe.db.get_value(
#             "Approval Hierarchy",
#             {"requestor_email": email},
#             "name"
#         )

#         if hierarchy_name:
#             hierarchy = frappe.get_doc("Approval Hierarchy", hierarchy_name)
#             for row in hierarchy.approval_hierarchy_details:
#                 approval_stages.append({
#                     "case_approval_level":            row.case_approval_level,
#                     "case_approval_level_decription": row.case_approval_level_decription,
#                     "case_approval_status":           "",
#                     "approver_name":                  row.approver_name,
#                     "approver_email":                 row.approver_email
#                 })
#         else:
#             # Fall back: build from Graph manager chain based on funds_requested
#             approval_stages = _build_approval_stages(
#                 manager_chain,
#                 float(funds_requested or 0)
#             )

#     except Exception as e:
#         frappe.log_error(frappe.get_traceback(), "Approval stage build failed")
#         # Still build from Graph as best effort
#         approval_stages = _build_approval_stages(
#             manager_chain,
#             float(funds_requested or 0)
#         )

#     # ------------------------------------------------------------------
#     # Return combined payload
#     # ------------------------------------------------------------------
#     result = {
#         "exists": True,
#         "employee": {
#             "id":              user.get("id"),
#             "name":            user.get("displayName"),
#             "email":           user.get("mail") or user.get("userPrincipalName"),
#             "department":      user.get("department"),
#             "designation":     user.get("jobTitle"),
#             "company":         user.get("companyName"),
#             "mobile":          user.get("mobilePhone"),
#             "work_phone":      user.get("businessPhones"),
#             "office_location": user.get("officeLocation"),
#             "employee_id":     user.get("employeeId"),
#             "city":            user.get("city"),
#             "state":           user.get("state"),
#             "country":         user.get("country"),
#             "manager":         manager,
#             "manager_chain":   manager_chain,
#             "direct_reports":  direct_reports,
#             "photo":           photo
#         },
#         "approval_stages": approval_stages
#     }

#     return encrypt_payload(result)


# def get_manager_chain(email, headers, max_depth=3):
#     """
#     Walk up the reporting line from email's manager.
#     Returns ordered list: [immediate manager, skip-level, two-up, ...]
#     max_depth=3 is enough for all our approval stage scenarios.
#     """
#     chain        = []
#     current      = email
#     seen         = set()

#     for _ in range(max_depth):
#         resp = requests.get(f"{GRAPH_URL}/users/{current}/manager", headers=headers)
#         if resp.status_code != 200:
#             break
#         m     = resp.json()
#         m_email = m.get("mail") or m.get("userPrincipalName")
#         if not m_email or m_email in seen:
#             break
#         seen.add(m_email)
#         chain.append({
#             "name":        m.get("displayName"),
#             "email":       m_email,
#             "designation": m.get("jobTitle"),
#             "department":  m.get("department")
#         })
#         current = m_email

#     return chain


# @frappe.whitelist(methods=["POST"])
# def get_skip_level_manager(email):
#     """Standalone skip-level lookup — kept for backward compatibility."""
#     token   = get_access_token()
#     headers = {"Authorization": f"Bearer {token}"}

#     manager_response = requests.get(f"{GRAPH_URL}/users/{email}/manager", headers=headers)
#     if manager_response.status_code != 200:
#         return encrypt_payload({"exists": False, "message": "No manager found."})

#     manager      = manager_response.json()
#     manager_email = manager.get("mail") or manager.get("userPrincipalName")

#     if not manager_email:
#         return encrypt_payload({"exists": False, "message": "Manager has no email on record."})

#     skip_response = requests.get(f"{GRAPH_URL}/users/{manager_email}/manager", headers=headers)
#     if skip_response.status_code != 200:
#         return encrypt_payload({"exists": False, "message": "No skip-level manager found."})

#     skip = skip_response.json()
#     return encrypt_payload({
#         "exists": True,
#         "immediate_manager": {
#             "name":        manager.get("displayName"),
#             "email":       manager_email,
#             "designation": manager.get("jobTitle")
#         },
#         "skip_level_manager": {
#             "name":        skip.get("displayName"),
#             "email":       skip.get("mail") or skip.get("userPrincipalName"),
#             "designation": skip.get("jobTitle")
#         }
#     })






import os
import json
import base64

import frappe
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# AES key — must match the key in the web form client script
AES_KEY = base64.b64decode("sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=")


# ------------------------------------------------------------------
# Encryption
# ------------------------------------------------------------------

def encrypt_payload(data: dict) -> dict:
    aesgcm     = AESGCM(AES_KEY)
    nonce      = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, json.dumps(data).encode("utf-8"), None)
    return {
        "encrypted": True,
        "iv":   base64.b64encode(nonce).decode("utf-8"),
        "data": base64.b64encode(ciphertext).decode("utf-8")
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
            ignore_permissions=True
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
            "Approval Hierarchy",
            {"requestor_email": email},
            "name",
            ignore_permissions=True
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
            as_dict=True
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
            limit_page_length=500
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
        doc        = frappe.get_doc("Approval Hierarchy", parent_name)
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
            row for row in child_rows
            if (row.get("case_approval_level_decription") or "").strip() in allowed
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
        stages.append({
            "case_approval_level":            level_id,
            "case_approval_level_decription": level_id,
            "case_approval_status":           "",
            "approver_name":                  row.get("approver_name") or "",
            "approver_email":                 row.get("approver_email") or ""
        })

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
        level_ids     = [s.get("name") for s in settings]
    else:
        levels_needed = len(manager_chain)
        level_ids     = []

    stages = []
    for i in range(levels_needed):
        m        = manager_chain[i]
        level_id = level_ids[i] if i < len(level_ids) else "L" + str(i + 1)
        stages.append({
            "case_approval_level":            level_id,
            "case_approval_level_decription": level_id,
            "case_approval_status":           "",
            "approver_name":                  m.get("name") or "",
            "approver_email":                 m.get("email") or ""
        })

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

    for row in (doc.get("approval_hierarchy_details") or []):
        if (row.get("case_approval_level_decription") or "").strip() == (level_name or "").strip():
            return {
                "approver_name":  row.get("approver_name") or "",
                "approver_email": row.get("approver_email") or "",
            }
    return None


# ------------------------------------------------------------------
# Manager chain walker
# ------------------------------------------------------------------

def get_manager_chain(email: str, headers: dict, max_depth: int = 3) -> list:
    chain   = []
    current = email
    seen    = set()

    for _ in range(max_depth):
        resp = requests.get(
            f"{GRAPH_URL}/users/{current}/manager",
            headers=headers
        )
        if resp.status_code != 200:
            break
        m       = resp.json()
        m_email = m.get("mail") or m.get("userPrincipalName")
        if not m_email or m_email in seen:
            break
        seen.add(m_email)
        chain.append({
            "name":        m.get("displayName"),
            "email":       m_email,
            "designation": m.get("jobTitle"),
            "department":  m.get("department")
        })
        current = m_email

    return chain


# ------------------------------------------------------------------
# Combined endpoint — single API call from the web form
# ------------------------------------------------------------------

@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_employee_details(email, funds_requested=None):

    token   = get_access_token()
    headers = {"Authorization": f"Bearer {token}"}

    fields = ",".join([
        "id", "displayName", "givenName", "surname",
        "mail", "userPrincipalName", "jobTitle", "department",
        "companyName", "officeLocation", "mobilePhone",
        "businessPhones", "employeeId", "city", "state", "country"
    ])

    response = requests.get(
        f"{GRAPH_URL}/users/{email}",
        headers=headers,
        params={"$select": fields}
    )

    if response.status_code == 404:
        return encrypt_payload({"exists": False, "message": "Email not found."})

    if response.status_code != 200:
        return encrypt_payload({
            "exists": False,
            "status_code": response.status_code,
            "error": response.text
        })

    user = response.json()

    # Immediate manager
    manager = {}
    mgr_resp = requests.get(f"{GRAPH_URL}/users/{email}/manager", headers=headers)
    if mgr_resp.status_code == 200:
        m = mgr_resp.json()
        manager = {
            "name":        m.get("displayName"),
            "email":       m.get("mail"),
            "designation": m.get("jobTitle"),
            "department":  m.get("department")
        }

    # Manager chain (always fetched for Path B fallback)
    manager_chain = get_manager_chain(email, headers, max_depth=3)

    # Direct reports
    direct_reports = []
    rpt_resp = requests.get(f"{GRAPH_URL}/users/{email}/directReports", headers=headers)
    if rpt_resp.status_code == 200:
        for emp in rpt_resp.json().get("value", []):
            direct_reports.append({
                "name":        emp.get("displayName"),
                "email":       emp.get("mail"),
                "designation": emp.get("jobTitle")
            })

    # Profile photo
    photo = None
    ph_resp = requests.get(f"{GRAPH_URL}/users/{email}/photo/$value", headers=headers)
    if ph_resp.status_code == 200:
        photo = base64.b64encode(ph_resp.content).decode()

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

    result = {
        "exists": True,
        "employee": {
            "id":              user.get("id"),
            "name":            user.get("displayName"),
            "email":           user.get("mail") or user.get("userPrincipalName"),
            "department":      user.get("department"),
            "designation":     user.get("jobTitle"),
            "company":         user.get("companyName"),
            "mobile":          user.get("mobilePhone"),
            "work_phone":      user.get("businessPhones"),
            "office_location": user.get("officeLocation"),
            "employee_id":     user.get("employeeId"),
            "city":            user.get("city"),
            "state":           user.get("state"),
            "country":         user.get("country"),
            "manager":         manager,
            "manager_chain":   manager_chain,
            "direct_reports":  direct_reports,
            "photo":           photo
        },
        "approval_stages": approval_stages
    }

    return encrypt_payload(result)


# ------------------------------------------------------------------
# Standalone skip-level lookup (backward compatibility)
# ------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def get_skip_level_manager(email):
    token   = get_access_token()
    headers = {"Authorization": f"Bearer {token}"}

    mgr_resp = requests.get(f"{GRAPH_URL}/users/{email}/manager", headers=headers)
    if mgr_resp.status_code != 200:
        return encrypt_payload({"exists": False, "message": "No manager found."})

    manager       = mgr_resp.json()
    manager_email = manager.get("mail") or manager.get("userPrincipalName")

    if not manager_email:
        return encrypt_payload({"exists": False, "message": "Manager has no email on record."})

    skip_resp = requests.get(f"{GRAPH_URL}/users/{manager_email}/manager", headers=headers)
    if skip_resp.status_code != 200:
        return encrypt_payload({"exists": False, "message": "No skip-level manager found."})

    skip = skip_resp.json()
    return encrypt_payload({
        "exists": True,
        "immediate_manager": {
            "name":        manager.get("displayName"),
            "email":       manager_email,
            "designation": manager.get("jobTitle")
        },
        "skip_level_manager": {
            "name":        skip.get("displayName"),
            "email":       skip.get("mail") or skip.get("userPrincipalName"),
            "designation": skip.get("jobTitle")
        }
    })




















# import os
# import json
# import base64

# import frappe
# import requests
# from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# # AES key — must match the key in the web form client script
# AES_KEY = base64.b64decode("sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=")


# # ------------------------------------------------------------------
# # Encryption
# # ------------------------------------------------------------------

# def encrypt_payload(data: dict) -> dict:
#     aesgcm     = AESGCM(AES_KEY)
#     nonce      = os.urandom(12)
#     ciphertext = aesgcm.encrypt(nonce, json.dumps(data).encode("utf-8"), None)
#     return {
#         "encrypted": True,
#         "iv":   base64.b64encode(nonce).decode("utf-8"),
#         "data": base64.b64encode(ciphertext).decode("utf-8")
#     }


# # ------------------------------------------------------------------
# # Case Approval level settings
# # ------------------------------------------------------------------

# def _get_level_settings(funds_requested: float):
#     """
#     Returns (ceiling_level_name, ordered_settings_list).
#     Sorted asc by approval_limit_amount.
#     First row whose ceiling >= funds_requested is the matched level.
#     """
#     try:
#         if not frappe.db.table_exists("Case Approval level settings"):
#             return None, []

#         settings = frappe.get_all(
#             "Case Approval level settings",
#             fields=["name", "approval_limit_amount", "function"],
#             order_by="approval_limit_amount asc",
#             ignore_permissions=True
#         )

#         if not settings:
#             return None, []

#         for row in settings:
#             if float(row.get("approval_limit_amount") or 0) >= float(funds_requested or 0):
#                 return row.get("name"), settings

#         return settings[-1].get("name"), settings

#     except Exception:
#         frappe.log_error(frappe.get_traceback(), "Case Approval level settings fetch failed")
#         return None, []


# def _allowed_level_names(ceiling_name: str, settings: list) -> set:
#     allowed = set()
#     for row in settings:
#         name = row.get("name")
#         allowed.add(name)
#         if name == ceiling_name:
#             break
#     return allowed


# # ------------------------------------------------------------------
# # Find Approval Hierarchy parent doc robustly
# # Tries multiple lookup strategies in case the field is not indexed
# # or the column name differs in DB
# # ------------------------------------------------------------------

# def _find_hierarchy_doc(email: str):
#     """
#     Returns the Approval Hierarchy doc name if found, else None.
#     Uses multiple strategies to be robust against migration issues.
#     """
#     email_lower = (email or "").strip().lower()

#     # Strategy 1: standard frappe.db.get_value with exact match
#     try:
#         name = frappe.db.get_value(
#             "Approval Hierarchy",
#             {"requestor_email": email},
#             "name",
#             ignore_permissions=True
#         )
#         if name:
#             frappe.logger().info(f"[ApprovalHierarchy] Found via exact match: {name}")
#             return name
#     except Exception as e:
#         frappe.logger().warning(f"[ApprovalHierarchy] Strategy 1 failed: {e}")

#     # Strategy 2: case-insensitive SQL query
#     try:
#         result = frappe.db.sql(
#             """SELECT name FROM `tabApproval Hierarchy`
#                WHERE LOWER(requestor_email) = %s
#                LIMIT 1""",
#             (email_lower,),
#             as_dict=True
#         )
#         if result:
#             name = result[0].get("name")
#             frappe.logger().info(f"[ApprovalHierarchy] Found via SQL: {name}")
#             return name
#     except Exception as e:
#         frappe.logger().warning(f"[ApprovalHierarchy] Strategy 2 failed: {e}")

#     # Strategy 3: get all and match in Python (handles edge cases)
#     try:
#         all_docs = frappe.get_all(
#             "Approval Hierarchy",
#             fields=["name", "requestor_email"],
#             ignore_permissions=True,
#             limit_page_length=500
#         )
#         for doc in all_docs:
#             if (doc.get("requestor_email") or "").strip().lower() == email_lower:
#                 frappe.logger().info(f"[ApprovalHierarchy] Found via scan: {doc['name']}")
#                 return doc["name"]
#     except Exception as e:
#         frappe.logger().warning(f"[ApprovalHierarchy] Strategy 3 failed: {e}")

#     frappe.logger().info(f"[ApprovalHierarchy] Not found for email: {email}")
#     return None


# # ------------------------------------------------------------------
# # PATH A: Approval Hierarchy found — use child table rows
# # ------------------------------------------------------------------

# def _stages_from_hierarchy(parent_name: str, funds_requested: float) -> list:
#     """
#     Loads the Approval Hierarchy doc and reads its
#     approval_hierarchy_details child table (doctype: Case Approval Stage).

#     Child row fields:
#       approver_name
#       approver_email
#       case_approval_level_decription  (Link -> Case Approval level settings name)
#     """
#     try:
#         doc        = frappe.get_doc("Approval Hierarchy", parent_name)
#         child_rows = doc.get("approval_hierarchy_details") or []
#     except Exception:
#         frappe.log_error(frappe.get_traceback(), "Approval Hierarchy get_doc failed")
#         return []

#     if not child_rows:
#         return []

#     ceiling_name, settings = _get_level_settings(funds_requested)

#     if ceiling_name and settings:
#         allowed = _allowed_level_names(ceiling_name, settings)

#         # case_approval_level_decription is a Link to Case Approval level settings
#         # Its stored value is the settings record name (e.g. "L1", "L2")
#         filtered = [
#             row for row in child_rows
#             if (row.get("case_approval_level_decription") or "").strip() in allowed
#         ]

#         # Fallback: slice by position if filter yields nothing
#         if not filtered:
#             ordered = [s.get("name") for s in settings]
#             try:
#                 count = ordered.index(ceiling_name) + 1
#             except ValueError:
#                 count = len(child_rows)
#             filtered = list(child_rows)[:count]
#     else:
#         filtered = list(child_rows)

#     stages = []
#     for i, row in enumerate(filtered):
#         level_id = row.get("case_approval_level_decription") or ("L" + str(i + 1))
#         stages.append({
#             "case_approval_level":            level_id,
#             "case_approval_level_decription": level_id,
#             "case_approval_status":           "",
#             "approver_name":                  row.get("approver_name") or "",
#             "approver_email":                 row.get("approver_email") or ""
#         })

#     return stages


# # ------------------------------------------------------------------
# # PATH B: No Approval Hierarchy — use Graph manager chain
# # ------------------------------------------------------------------

# def _stages_from_graph_chain(manager_chain: list, funds_requested: float) -> list:

#     ceiling_name, settings = _get_level_settings(funds_requested)

#     if ceiling_name and settings:
#         ordered = [s.get("name") for s in settings]
#         try:
#             count = ordered.index(ceiling_name) + 1
#         except ValueError:
#             count = len(manager_chain)
#         levels_needed = min(count, len(manager_chain))
#         level_ids     = [s.get("name") for s in settings]
#     else:
#         levels_needed = len(manager_chain)
#         level_ids     = []

#     stages = []
#     for i in range(levels_needed):
#         m        = manager_chain[i]
#         level_id = level_ids[i] if i < len(level_ids) else "L" + str(i + 1)
#         stages.append({
#             "case_approval_level":            level_id,
#             "case_approval_level_decription": level_id,
#             "case_approval_status":           "",
#             "approver_name":                  m.get("name") or "",
#             "approver_email":                 m.get("email") or ""
#         })

#     return stages


# # ------------------------------------------------------------------
# # Manager chain walker
# # ------------------------------------------------------------------

# def get_manager_chain(email: str, headers: dict, max_depth: int = 3) -> list:
#     chain   = []
#     current = email
#     seen    = set()

#     for _ in range(max_depth):
#         resp = requests.get(
#             f"{GRAPH_URL}/users/{current}/manager",
#             headers=headers
#         )
#         if resp.status_code != 200:
#             break
#         m       = resp.json()
#         m_email = m.get("mail") or m.get("userPrincipalName")
#         if not m_email or m_email in seen:
#             break
#         seen.add(m_email)
#         chain.append({
#             "name":        m.get("displayName"),
#             "email":       m_email,
#             "designation": m.get("jobTitle"),
#             "department":  m.get("department")
#         })
#         current = m_email

#     return chain


# # ------------------------------------------------------------------
# # Combined endpoint
# # ------------------------------------------------------------------

# @frappe.whitelist(allow_guest=True, methods=["POST"])
# def get_employee_details(email, funds_requested=None):

#     token   = get_access_token()
#     headers = {"Authorization": f"Bearer {token}"}

#     fields = ",".join([
#         "id", "displayName", "givenName", "surname",
#         "mail", "userPrincipalName", "jobTitle", "department",
#         "companyName", "officeLocation", "mobilePhone",
#         "businessPhones", "employeeId", "city", "state", "country"
#     ])

#     response = requests.get(
#         f"{GRAPH_URL}/users/{email}",
#         headers=headers,
#         params={"$select": fields}
#     )

#     if response.status_code == 404:
#         return encrypt_payload({"exists": False, "message": "Email not found."})

#     if response.status_code != 200:
#         return encrypt_payload({
#             "exists": False,
#             "status_code": response.status_code,
#             "error": response.text
#         })

#     user = response.json()

#     # Immediate manager
#     manager = {}
#     mgr_resp = requests.get(f"{GRAPH_URL}/users/{email}/manager", headers=headers)
#     if mgr_resp.status_code == 200:
#         m = mgr_resp.json()
#         manager = {
#             "name":        m.get("displayName"),
#             "email":       m.get("mail"),
#             "designation": m.get("jobTitle"),
#             "department":  m.get("department")
#         }

#     # Manager chain (always fetched — needed for Path B)
#     manager_chain = get_manager_chain(email, headers, max_depth=3)

#     # Direct reports
#     direct_reports = []
#     rpt_resp = requests.get(f"{GRAPH_URL}/users/{email}/directReports", headers=headers)
#     if rpt_resp.status_code == 200:
#         for emp in rpt_resp.json().get("value", []):
#             direct_reports.append({
#                 "name":        emp.get("displayName"),
#                 "email":       emp.get("mail"),
#                 "designation": emp.get("jobTitle")
#             })

#     # Profile photo
#     photo = None
#     ph_resp = requests.get(f"{GRAPH_URL}/users/{email}/photo/$value", headers=headers)
#     if ph_resp.status_code == 200:
#         photo = base64.b64encode(ph_resp.content).decode()

#     # ------------------------------------------------------------------
#     # Approval stages
#     # ------------------------------------------------------------------
#     approval_stages = []
#     funds = float(funds_requested or 0)

#     try:
#         # Robust lookup — tries 3 strategies
#         hierarchy_name = _find_hierarchy_doc(email)

#         if hierarchy_name:
#             # Path A: found in Approval Hierarchy — use child table
#             frappe.logger().info(f"[ApprovalStage] Using Path A (Hierarchy) for {email}")
#             approval_stages = _stages_from_hierarchy(hierarchy_name, funds)
#         else:
#             # Path B: not in Approval Hierarchy — use Graph chain
#             frappe.logger().info(f"[ApprovalStage] Using Path B (Graph chain) for {email}")
#             approval_stages = _stages_from_graph_chain(manager_chain, funds)

#     except Exception:
#         frappe.log_error(frappe.get_traceback(), "Approval stage build failed")
#         try:
#             approval_stages = _stages_from_graph_chain(manager_chain, funds)
#         except Exception:
#             approval_stages = []

#     result = {
#         "exists": True,
#         "employee": {
#             "id":              user.get("id"),
#             "name":            user.get("displayName"),
#             "email":           user.get("mail") or user.get("userPrincipalName"),
#             "department":      user.get("department"),
#             "designation":     user.get("jobTitle"),
#             "company":         user.get("companyName"),
#             "mobile":          user.get("mobilePhone"),
#             "work_phone":      user.get("businessPhones"),
#             "office_location": user.get("officeLocation"),
#             "employee_id":     user.get("employeeId"),
#             "city":            user.get("city"),
#             "state":           user.get("state"),
#             "country":         user.get("country"),
#             "manager":         manager,
#             "manager_chain":   manager_chain,
#             "direct_reports":  direct_reports,
#             "photo":           photo
#         },
#         "approval_stages":  approval_stages,
#         "hierarchy_source": "approval_hierarchy" if _find_hierarchy_doc(email) else "graph_chain"
#     }

#     return encrypt_payload(result)


# # ------------------------------------------------------------------
# # Standalone skip-level lookup (backward compatibility)
# # ------------------------------------------------------------------

# @frappe.whitelist(methods=["POST"])
# def get_skip_level_manager(email):
#     token   = get_access_token()
#     headers = {"Authorization": f"Bearer {token}"}

#     mgr_resp = requests.get(f"{GRAPH_URL}/users/{email}/manager", headers=headers)
#     if mgr_resp.status_code != 200:
#         return encrypt_payload({"exists": False, "message": "No manager found."})

#     manager       = mgr_resp.json()
#     manager_email = manager.get("mail") or manager.get("userPrincipalName")

#     if not manager_email:
#         return encrypt_payload({"exists": False, "message": "Manager has no email on record."})

#     skip_resp = requests.get(f"{GRAPH_URL}/users/{manager_email}/manager", headers=headers)
#     if skip_resp.status_code != 200:
#         return encrypt_payload({"exists": False, "message": "No skip-level manager found."})

#     skip = skip_resp.json()
#     return encrypt_payload({
#         "exists": True,
#         "immediate_manager": {
#             "name":        manager.get("displayName"),
#             "email":       manager_email,
#             "designation": manager.get("jobTitle")
#         },
#         "skip_level_manager": {
#             "name":        skip.get("displayName"),
#             "email":       skip.get("mail") or skip.get("userPrincipalName"),
#             "designation": skip.get("jobTitle")
#         }
#     })


# @frappe.whitelist(allow_guest=True)
# def get_employee_details_1(email):

    token = get_access_token()

    headers = {
        "Authorization": f"Bearer {token}"
    }

    # --------------------------------------------------
    # Employee Details
    # --------------------------------------------------

    fields = ",".join([
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
        "country"
    ])

    response = requests.get(
        f"{GRAPH_URL}/users/{email}",
        headers=headers,
        params={"$select": fields}
    )

    if response.status_code == 404:
        return {
            "exists": False,
            "message": "Email not found."
        }

    if response.status_code != 200:
        return {
            "exists": False,
            "status_code": response.status_code,
            "error": response.text
        }

    user = response.json()

    # --------------------------------------------------
    # Manager
    # --------------------------------------------------

    manager = {}

    manager_response = requests.get(
        f"{GRAPH_URL}/users/{email}/manager",
        headers=headers
    )

    if manager_response.status_code == 200:

        m = manager_response.json()

        manager = {
            "name": m.get("displayName"),
            "email": m.get("mail") or m.get("userPrincipalName"),
            "designation": m.get("jobTitle"),
            "department": m.get("department")
        }

    # --------------------------------------------------
    # Manager Chain
    # --------------------------------------------------

    manager_chain = []

    current_email = email
    seen = set()

    while True:

        r = requests.get(
            f"{GRAPH_URL}/users/{current_email}/manager",
            headers=headers
        )

        if r.status_code != 200:
            break

        m = r.json()

        manager_email = m.get("mail") or m.get("userPrincipalName")

        if not manager_email or manager_email in seen:
            break

        seen.add(manager_email)

        manager_chain.append({
            "name": m.get("displayName"),
            "email": manager_email,
            "designation": m.get("jobTitle"),
            "department": m.get("department")
        })

        current_email = manager_email

    # --------------------------------------------------
    # Direct Reports
    # --------------------------------------------------

    direct_reports = []

    reports_response = requests.get(
        f"{GRAPH_URL}/users/{email}/directReports",
        headers=headers
    )

    if reports_response.status_code == 200:

        for emp in reports_response.json().get("value", []):

            direct_reports.append({
                "name": emp.get("displayName"),
                "email": emp.get("mail") or emp.get("userPrincipalName"),
                "designation": emp.get("jobTitle")
            })

    # --------------------------------------------------
    # Profile Photo
    # --------------------------------------------------

    photo = None

    photo_response = requests.get(
        f"{GRAPH_URL}/users/{email}/photo/$value",
        headers=headers
    )

    if photo_response.status_code == 200:
        photo = base64.b64encode(photo_response.content).decode()

    # --------------------------------------------------
    # Response
    # --------------------------------------------------

    return {
        "exists": True,
        "employee": {
            "id": user.get("id"),
            "name": user.get("displayName"),
            "email": user.get("mail") or user.get("userPrincipalName"),
            "department": user.get("department"),
            "designation": user.get("jobTitle"),
            "company": user.get("companyName"),
            "mobile": user.get("mobilePhone"),
            "work_phone": user.get("businessPhones"),
            "office_location": user.get("officeLocation"),
            "employee_id": user.get("employeeId"),
            "city": user.get("city"),
            "state": user.get("state"),
            "country": user.get("country"),
            "manager": manager,
            "manager_chain": manager_chain,
            "direct_reports": direct_reports,
            "photo": photo
        }
    }
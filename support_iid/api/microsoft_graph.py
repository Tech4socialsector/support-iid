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






AES_KEY = base64.b64decode("sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=")
def encrypt_payload(data: dict) -> dict:
    aesgcm = AESGCM(AES_KEY)
    nonce = os.urandom(12)
    plaintext = json.dumps(data).encode("utf-8")
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)

    return {
        "encrypted": True,
        "iv": base64.b64encode(nonce).decode("utf-8"),
        "data": base64.b64encode(ciphertext).decode("utf-8")
    }


# --------------------------------------------------
# Main lookup
# --------------------------------------------------

@frappe.whitelist(methods=["POST"])
def get_employee_details(email):

    token = get_access_token()

    headers = {
        "Authorization": f"Bearer {token}"
    }

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

    print("=" * 80)
    print("USER API")
    print("Status :", response.status_code)
    print("URL :", response.url)
    print(response.text)
    print("=" * 80)

    if response.status_code == 404:
        return encrypt_payload({
            "exists": False,
            "message": "Email not found."
        })

    if response.status_code != 200:
        return encrypt_payload({
            "exists": False,
            "status_code": response.status_code,
            "error": response.text
        })

    user = response.json()

    # --------------------------------------------------
    # Manager (immediate)
    # --------------------------------------------------

    manager = {}

    manager_response = requests.get(
        f"{GRAPH_URL}/users/{email}/manager",
        headers=headers
    )

    print("=" * 80)
    print("MANAGER API")
    print(manager_response.status_code)
    print(manager_response.text)
    print("=" * 80)

    if manager_response.status_code == 200:

        m = manager_response.json()

        manager = {
            "name": m.get("displayName"),
            "email": m.get("mail"),
            "designation": m.get("jobTitle")
        }

    # --------------------------------------------------
    # Reporting manager chain (immediate -> top of org)
    # --------------------------------------------------

    manager_chain = get_manager_chain(email, headers)

    # --------------------------------------------------
    # Direct Reports
    # --------------------------------------------------

    direct_reports = []

    report_response = requests.get(
        f"{GRAPH_URL}/users/{email}/directReports",
        headers=headers
    )

    print("=" * 80)
    print("DIRECT REPORT API")
    print(report_response.status_code)
    print(report_response.text)
    print("=" * 80)

    if report_response.status_code == 200:

        for emp in report_response.json().get("value", []):

            direct_reports.append({
                "name": emp.get("displayName"),
                "email": emp.get("mail"),
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

    print("=" * 80)
    print("PHOTO API")
    print(photo_response.status_code)
    print("=" * 80)

    if photo_response.status_code == 200:
        photo = base64.b64encode(photo_response.content).decode()

    result = {

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

    return encrypt_payload(result)


def get_manager_chain(email, headers, max_depth=10):
    """
    Walks up the reporting line starting from `email`'s manager,
    returning an ordered list from immediate manager -> top of the org.

    manager_chain[0] = immediate manager
    manager_chain[1] = skip-level manager (manager's manager)
    manager_chain[2] = next level up, and so on.
    """

    chain = []
    current_email = email
    seen_emails = set()

    for _ in range(max_depth):

        manager_response = requests.get(
            f"{GRAPH_URL}/users/{current_email}/manager",
            headers=headers
        )

        print("=" * 80)
        print("MANAGER CHAIN API")
        print(current_email, "->", manager_response.status_code)
        print("=" * 80)

        if manager_response.status_code != 200:
            break

        m = manager_response.json()
        manager_email = m.get("mail") or m.get("userPrincipalName")

        if not manager_email or manager_email in seen_emails:
            # No email returned, or we've looped back on a cyclical
            # reporting structure — stop here to avoid an infinite loop
            break

        seen_emails.add(manager_email)

        chain.append({
            "name": m.get("displayName"),
            "email": manager_email,
            "designation": m.get("jobTitle"),
            "department": m.get("department")
        })

        current_email = manager_email

    return chain


@frappe.whitelist(methods=["POST"])
def get_skip_level_manager(email):
    """
    Standalone lookup for just the skip-level manager (your manager's
    manager), without fetching the full employee record or the whole chain.
    """

    token = get_access_token()
    headers = {"Authorization": f"Bearer {token}"}

    manager_response = requests.get(
        f"{GRAPH_URL}/users/{email}/manager",
        headers=headers
    )

    if manager_response.status_code != 200:
        return encrypt_payload({
            "exists": False,
            "message": "No manager found for this user."
        })

    manager = manager_response.json()
    manager_email = manager.get("mail") or manager.get("userPrincipalName")

    if not manager_email:
        return encrypt_payload({
            "exists": False,
            "message": "Manager has no email on record."
        })

    skip_level_response = requests.get(
        f"{GRAPH_URL}/users/{manager_email}/manager",
        headers=headers
    )

    if skip_level_response.status_code != 200:
        return encrypt_payload({
            "exists": False,
            "message": "This is the top of the reporting chain — no skip-level manager."
        })

    skip = skip_level_response.json()

    return encrypt_payload({
        "exists": True,
        "immediate_manager": {
            "name": manager.get("displayName"),
            "email": manager_email,
            "designation": manager.get("jobTitle")
        },
        "skip_level_manager": {
            "name": skip.get("displayName"),
            "email": skip.get("mail") or skip.get("userPrincipalName"),
            "designation": skip.get("jobTitle")
        }
    })


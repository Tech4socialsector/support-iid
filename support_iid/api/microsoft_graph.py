import frappe
import requests
import base64

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


@frappe.whitelist()
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

            "direct_reports": direct_reports,

            "photo": photo

        }

    }
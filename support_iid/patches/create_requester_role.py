import frappe


def execute():
	if not frappe.db.exists("Role", "Requester"):
		frappe.get_doc(
			{
				"doctype": "Role",
				"role_name": "Requester",
				"desk_access": 1,
			}
		).insert(ignore_permissions=True)

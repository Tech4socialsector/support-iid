import frappe


def execute():
	if not frappe.db.exists("Role", "Support IID Approver"):
		frappe.get_doc(
			{
				"doctype": "Role",
				"role_name": "Support IID Approver",
				"desk_access": 1,
			}
		).insert(ignore_permissions=True)

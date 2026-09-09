import frappe


def execute():
	if not frappe.db.exists("Case Status List", "Draft"):
		frappe.get_doc({"doctype": "Case Status List", "name": "Draft"}).insert(ignore_permissions=True)
		frappe.db.commit()

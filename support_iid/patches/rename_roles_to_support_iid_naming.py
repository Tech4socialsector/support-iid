import frappe


def execute():
	for old_name, new_name in (
		("Reviewer", "Support IID Reviewer"),
		("Requester", "Support IID Requester"),
	):
		if frappe.db.exists("Role", old_name) and not frappe.db.exists("Role", new_name):
			frappe.rename_doc("Role", old_name, new_name, ignore_permissions=True)

	frappe.db.commit()

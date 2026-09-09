import frappe


def execute():
	if frappe.db.exists("Workspace", "Case Management") and not frappe.db.exists("Workspace", "Support IID"):
		frappe.rename_doc("Workspace", "Case Management", "Support IID", ignore_permissions=True)
		frappe.db.set_value("Workspace", "Support IID", "label", "Support IID")
		frappe.db.set_value("Workspace", "Support IID", "title", "Support IID")

	if frappe.db.exists("Workspace Sidebar", "Case Management") and not frappe.db.exists(
		"Workspace Sidebar", "Support IID"
	):
		frappe.rename_doc("Workspace Sidebar", "Case Management", "Support IID", ignore_permissions=True)
		frappe.db.set_value("Workspace Sidebar", "Support IID", "title", "Support IID")

	frappe.db.commit()

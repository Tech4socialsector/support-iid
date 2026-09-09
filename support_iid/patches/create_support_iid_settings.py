import frappe


def execute():
	existing = frappe.db.get_singles_dict("Support IID Settings")
	if not existing:
		doc = frappe.new_doc("Support IID Settings")
		doc.send_requestor_notification_emails = 1
		doc.insert(ignore_permissions=True)

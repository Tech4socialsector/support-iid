import frappe


def execute():
	"""
	Seeds the Support IID Settings single record with notifications enabled
	by default, so the setting is visible/toggleable in the desk immediately
	rather than only appearing after someone opens and saves it once.
	"""
	existing = frappe.db.get_singles_dict("Support IID Settings")
	if not existing:
		doc = frappe.new_doc("Support IID Settings")
		doc.send_requestor_notification_emails = 1
		doc.insert(ignore_permissions=True)

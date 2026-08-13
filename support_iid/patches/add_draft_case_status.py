import frappe


def execute():
	"""
	Adds "Draft" to Case Status List — a case now starts in this status
	(default on the doctype's case_status field) when first created, and
	only moves to "Pending Approval" once explicitly submitted (see
	submit_case in case_register.py), instead of the approval workflow
	firing the instant a case row exists at all.
	"""
	if not frappe.db.exists("Case Status List", "Draft"):
		frappe.get_doc({"doctype": "Case Status List", "name": "Draft"}).insert(ignore_permissions=True)
		frappe.db.commit()

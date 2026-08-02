import frappe


def execute():
	"""Rename the 'Push Back' approval action to 'Send Back' in existing data."""
	for doctype, field in (
		("Case Approval Stage", "case_approval_status"),
		("Case Approval Log", "action"),
	):
		frappe.db.set_value(
			doctype,
			{field: "Push Back"},
			field,
			"Send Back",
			update_modified=False,
		)

	frappe.db.set_value(
		"Case Register",
		{"case_status": "Push Back"},
		"case_status",
		"Sent back",
		update_modified=False,
	)

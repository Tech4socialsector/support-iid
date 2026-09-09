import frappe


def execute():
	frappe.db.set_value(
		"Case Register",
		{"current_approval_level": "Reviewer"},
		"current_approval_level",
		"Final Verification",
		update_modified=False,
	)
	frappe.db.commit()

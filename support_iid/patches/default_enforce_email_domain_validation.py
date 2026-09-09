import frappe


def execute():
	if "enforce_email_domain_validation" not in frappe.db.get_singles_dict("Support IID Settings"):
		frappe.db.set_single_value("Support IID Settings", "enforce_email_domain_validation", 1)

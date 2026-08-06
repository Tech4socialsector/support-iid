import frappe


def execute():
	"""
	Backfills enforce_email_domain_validation = 1 on the existing Support
	IID Settings singleton — Frappe does not retroactively apply a new
	field's JSON default to a Single doctype's already-existing record, so
	without this the field stays unset (falsy) on any site that had this
	settings record created before the field was added, silently turning
	off domain validation that was always on before this toggle existed.
	"""
	if "enforce_email_domain_validation" not in frappe.db.get_singles_dict("Support IID Settings"):
		frappe.db.set_single_value("Support IID Settings", "enforce_email_domain_validation", 1)

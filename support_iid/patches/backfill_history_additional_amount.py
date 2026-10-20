import frappe


def execute():
	# History rows copied before "Additional Amount Required (Provisional
	# Approval time)" was recorded on them show 0. On the "First request" row
	# the total is exactly the first amount plus that additional amount, so the
	# difference can be restored.
	if not frappe.db.has_column("Additional Support Request", "additional_amount_required"):
		return

	rows = frappe.get_all(
		"Additional Support Request",
		filters={"purpose_of_additional_support": "First request"},
		fields=["name", "funds_requested", "total_funds_requested", "additional_amount_required"],
	)
	for row in rows:
		missing = float(row.total_funds_requested or 0) - float(row.funds_requested or 0)
		if not float(row.additional_amount_required or 0) and missing > 0:
			frappe.db.set_value(
				"Additional Support Request",
				row.name,
				"additional_amount_required",
				missing,
				update_modified=False,
			)

	frappe.db.commit()

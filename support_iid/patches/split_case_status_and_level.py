import re

import frappe

CASE_STATUS_VALUES = [
	"Pending Approval",
	"Approved",
	"Rejected",
	"Sent Back",
	"On Hold",
	"Closed",
]


def execute():
	"""
	Seeds the Case Status List master with the fixed set of case status
	values, then migrates existing Case Register rows off the old free-text
	case_status (which sometimes baked the approval level's name directly
	into the string, e.g. "Pending Approval - L1 Reviewer") onto the new
	Link field + a separate current_approval_level field.
	"""
	for status in CASE_STATUS_VALUES:
		if not frappe.db.exists("Case Status List", status):
			frappe.get_doc(
				{
					"doctype": "Case Status List",
					"name": status,
				}
			).insert(ignore_permissions=True)

	pending_re = re.compile(r"^Pending Approval\s*-\s*(.+)$")

	for row in frappe.db.get_all("Case Register", fields=["name", "case_status"]):
		old_status = (row.case_status or "").strip()
		if not old_status:
			continue

		match = pending_re.match(old_status)
		if match:
			new_status = "Pending Approval"
			level = match.group(1).strip()
		elif old_status.lower() == "sent back":
			new_status = "Sent Back"
			level = ""
		elif old_status in CASE_STATUS_VALUES:
			new_status = old_status
			level = ""
		else:
			# Unrecognized legacy value — leave as Pending Approval so it
			# still resolves to a valid Link rather than a dangling string.
			new_status = "Pending Approval"
			level = old_status

		frappe.db.set_value(
			"Case Register",
			row.name,
			{"case_status": new_status, "current_approval_level": level},
			update_modified=False,
		)

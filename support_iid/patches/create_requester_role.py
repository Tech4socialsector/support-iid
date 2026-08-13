import frappe


def execute():
	"""
	Creates the "Requester" role — Desk read access to Case Register,
	restricted to only the fields the guest web form itself shows (see the
	permlevel-1 fields on Case Register, which this role has no read
	permission for). System Manager and Reviewer continue to see every
	field, unrestricted, via their existing permlevel-0-and-1 access.
	"""
	if not frappe.db.exists("Role", "Requester"):
		frappe.get_doc(
			{
				"doctype": "Role",
				"role_name": "Requester",
				"desk_access": 1,
			}
		).insert(ignore_permissions=True)

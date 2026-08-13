import frappe


def execute():
	"""
	Creates the "Support IID Approver" role — read-only access to Case
	Register, distinct from System Manager, so the dashboard's per-user
	case scoping (get_dashboard_data) has a role to actually scope: assign
	this role to approvers instead of System Manager and they'll see only
	the cases where they appear as an approver.
	"""
	if not frappe.db.exists("Role", "Support IID Approver"):
		frappe.get_doc(
			{
				"doctype": "Role",
				"role_name": "Support IID Approver",
				"desk_access": 1,
			}
		).insert(ignore_permissions=True)

import frappe


def execute():
	"""
	Sets Support IID Approver and Reviewer roles' native Home Page field
	(Role.home_page) to the Support IID Dashboard page, same as Requester
	(see set_requester_home_page) — so all three case-facing roles land
	directly on the dashboard right after login instead of the Case
	Management workspace's shortcut screen.

	default_workspace on the User record always overrides Role.home_page
	if set, so it's cleared here for any existing user holding either
	role, same reasoning as set_requester_home_page.
	"""
	for role in ("Support IID Approver", "Reviewer"):
		if frappe.db.exists("Role", role):
			frappe.db.set_value("Role", role, "home_page", "support-iid-dashboard")

	affected_users = set(
		frappe.get_all(
			"Has Role",
			filters={"role": ["in", ["Support IID Approver", "Reviewer"]]},
			pluck="parent",
		)
	)
	for user in affected_users:
		frappe.db.set_value("User", user, "default_workspace", None, update_modified=False)

	frappe.db.commit()

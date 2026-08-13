import frappe


def execute():
	"""
	Sets "Case Management" as the default landing workspace for every real
	(non-Guest) user who doesn't already have one — so logging in lands
	directly on the case-facing workspace instead of Frappe's multi-app
	picker screen (shown because both frappe and support_iid are
	installed). Leaves any user's own already-chosen default_workspace
	untouched.

	Excludes Requester / Support IID Approver / Reviewer-role users:
	default_workspace unconditionally overrides Role.home_page (see
	set_requester_home_page / set_approver_reviewer_home_page), so setting
	it here would silently undo those roles' configured landing page
	(support-iid-dashboard) for anyone who holds one of them.
	"""
	if not frappe.db.exists("Workspace", "Case Management"):
		return

	excluded_role_users = set(
		frappe.get_all(
			"Has Role",
			filters={"role": ["in", ["Requester", "Support IID Approver", "Reviewer"]]},
			pluck="parent",
		)
	)

	users = frappe.get_all(
		"User",
		filters={"name": ["!=", "Guest"], "default_workspace": ["in", ["", None]]},
		pluck="name",
	)
	for user in users:
		if user in excluded_role_users:
			continue
		frappe.db.set_value("User", user, "default_workspace", "Case Management", update_modified=False)

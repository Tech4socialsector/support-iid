import frappe


def execute():
	"""
	Sets "Case Management" as the default landing workspace for every real
	(non-Guest) user who doesn't already have one — so logging in lands
	directly on the case-facing workspace instead of Frappe's multi-app
	picker screen (shown because both frappe and support_iid are
	installed). Leaves any user's own already-chosen default_workspace
	untouched.
	"""
	if not frappe.db.exists("Workspace", "Case Management"):
		return

	users = frappe.get_all(
		"User",
		filters={"name": ["!=", "Guest"], "default_workspace": ["in", ["", None]]},
		pluck="name",
	)
	for user in users:
		frappe.db.set_value("User", user, "default_workspace", "Case Management", update_modified=False)

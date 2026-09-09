import frappe


def execute():
	if not frappe.db.exists("Workspace", "Case Management"):
		return

	excluded_role_users = set(
		frappe.get_all(
			"Has Role",
			filters={
				"role": ["in", ["Requester", "Support IID Approver", "Reviewer"]],
				"parenttype": "User",
			},
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

import frappe


def execute():
	for role in ("Support IID Approver", "Reviewer"):
		if frappe.db.exists("Role", role):
			frappe.db.set_value("Role", role, "home_page", "support-iid-dashboard")

	affected_users = set(
		frappe.get_all(
			"Has Role",
			filters={"role": ["in", ["Support IID Approver", "Reviewer"]], "parenttype": "User"},
			pluck="parent",
		)
	)
	for user in affected_users:
		frappe.db.set_value("User", user, "default_workspace", None, update_modified=False)

	frappe.db.commit()

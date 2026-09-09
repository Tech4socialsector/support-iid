import frappe


def execute():
	if frappe.db.exists("Role", "Requester"):
		frappe.db.set_value("Role", "Requester", "home_page", "support-iid-dashboard")

	requester_users = frappe.get_all(
		"Has Role", filters={"role": "Requester", "parenttype": "User"}, pluck="parent"
	)
	for user in requester_users:
		frappe.db.set_value("User", user, "default_workspace", None, update_modified=False)

	frappe.db.commit()

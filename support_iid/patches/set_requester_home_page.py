import frappe


def execute():
	"""
	Sets Requester role's native Home Page field (Role.home_page — a
	built-in Frappe field, checked before any hook/default_workspace
	logic in frappe.website.utils.get_home_page) to the Support IID
	Dashboard page, so a Requester lands there directly right after login
	instead of the Case Management workspace's shortcut screen.

	default_workspace on the User record ALWAYS overrides Role.home_page
	if set (see get_home_page — it's checked last and unconditionally
	wins) — so every existing Requester-role user's default_workspace is
	cleared here too. ensure_requester_user (case_register.py) no longer
	sets default_workspace on newly-created Requester users for the same
	reason — see that function's own comment.
	"""
	if frappe.db.exists("Role", "Requester"):
		frappe.db.set_value("Role", "Requester", "home_page", "support-iid-dashboard")

	requester_users = frappe.get_all("Has Role", filters={"role": "Requester"}, pluck="parent")
	for user in requester_users:
		frappe.db.set_value("User", user, "default_workspace", None, update_modified=False)

	frappe.db.commit()

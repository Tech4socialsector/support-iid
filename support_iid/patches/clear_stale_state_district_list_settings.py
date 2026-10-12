import frappe


def execute():
	# State/District were reshaped (district_name / district / state_name
	# fields removed). Users who opened those lists before still have them
	# saved as the list sort, which fails with "You do not have permission to
	# access field District.district_name". Drop the saved list settings so the
	# lists fall back to the default sort.
	for doctype in ("State", "District"):
		users = frappe.db.sql(
			"select user from `__UserSettings` where doctype = %s", (doctype,), pluck=True
		)
		frappe.db.sql("delete from `__UserSettings` where doctype = %s", (doctype,))
		for user in users:
			frappe.cache.hdel("_user_settings", f"{doctype}::{user}")

	frappe.db.commit()

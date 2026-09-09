import frappe


def execute():
	for stale_role_name in ("Reviewer", "Requester"):
		stale_rows = frappe.get_all(
			"Has Role",
			filters={"role": stale_role_name, "parenttype": "User"},
			fields=["name", "parent"],
		)
		for row in stale_rows:
			frappe.delete_doc("Has Role", row.name, force=True, ignore_permissions=True)

	frappe.db.commit()

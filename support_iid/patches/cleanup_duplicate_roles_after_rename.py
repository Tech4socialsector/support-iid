import frappe


def execute():
	for old_name, new_name in (
		("Reviewer", "Support IID Reviewer"),
		("Requester", "Support IID Requester"),
	):
		if not frappe.db.exists("Role", old_name):
			continue

		stale_rows = frappe.get_all(
			"Has Role",
			filters={"role": old_name, "parenttype": "User"},
			fields=["name", "parent"],
		)
		affected_users = {row.parent for row in stale_rows}

		for row in stale_rows:
			frappe.delete_doc("Has Role", row.name, force=True, ignore_permissions=True)

		for user in affected_users:
			if not frappe.db.exists("User", user):
				continue
			user_doc = frappe.get_doc("User", user)
			existing_roles = [r.role for r in user_doc.get("roles") or []]
			if new_name not in existing_roles:
				user_doc.append("roles", {"role": new_name})
				user_doc.flags.ignore_permissions = True
				user_doc.save(ignore_permissions=True)

		frappe.delete_doc("Role", old_name, force=True, ignore_permissions=True, delete_permanently=True)

	frappe.db.commit()

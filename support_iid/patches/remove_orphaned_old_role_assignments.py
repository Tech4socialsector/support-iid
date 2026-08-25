import frappe


def execute():
	"""
	Follow-up to cleanup_duplicate_roles_after_rename: that patch deleted
	the stale duplicate "Reviewer"/"Requester" Role documents, but
	frappe.delete_doc on a Role does NOT cascade-clean the "Has Role"
	child rows on each User that still reference the now-deleted role by
	name (Has Role is a child table of User, not something Role itself
	owns/cleans up on delete) — so every affected user was left with an
	orphaned roles-table row pointing at a role that no longer exists.

	Removes exactly those two dangling "Has Role" rows per affected user
	— the real, still-valid "Support IID Reviewer"/"Support IID Requester"
	row cleanup_duplicate_roles_after_rename already added stays intact;
	this only strips the leftover reference to the deleted old name.
	"""
	for stale_role_name in ("Reviewer", "Requester"):
		stale_rows = frappe.get_all(
			"Has Role",
			filters={"role": stale_role_name, "parenttype": "User"},
			fields=["name", "parent"],
		)
		for row in stale_rows:
			frappe.delete_doc("Has Role", row.name, force=True, ignore_permissions=True)

	frappe.db.commit()

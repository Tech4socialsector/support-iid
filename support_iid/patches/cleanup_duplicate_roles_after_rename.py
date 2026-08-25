import frappe


def execute():
	"""
	Corrects a bug in rename_roles_to_support_iid_naming's very first run:
	that patch DID correctly rename Reviewer -> Support IID Reviewer and
	Requester -> Support IID Requester via frappe.rename_doc — but
	fixtures/role.json (this app's Role fixture) still listed the OLD
	names at that point, and fixtures sync runs AFTER patches during the
	same migrate, so it re-created fresh "Reviewer"/"Requester" Role
	records from the stale fixture right afterward. Net effect: two
	real Role docs per renamed role, and anyone who got assigned the
	role AFTER that migrate (via the Desk User form, which lists Roles
	alphabetically with no way to tell "the real one" apart at a
	glance) may have picked either the old, duplicate role or the new,
	correct one.

	Re-applies both role names to every user who holds the OLD role
	(Requester/Reviewer only ADDS the new role — never removes anything
	else the user has), then deletes the now-empty duplicate Role docs.
	fixtures/role.json itself was fixed in the same change that added
	this patch, so a fresh site never hits this in the first place.
	"""
	for old_name, new_name in (
		("Reviewer", "Support IID Reviewer"),
		("Requester", "Support IID Requester"),
	):
		if not frappe.db.exists("Role", old_name):
			continue

		affected_users = frappe.get_all("Has Role", filters={"role": old_name}, pluck="parent")
		for user in affected_users:
			user_doc = frappe.get_doc("User", user)
			existing_roles = [r.role for r in user_doc.get("roles") or []]
			if new_name not in existing_roles:
				user_doc.append("roles", {"role": new_name})
				user_doc.flags.ignore_permissions = True
				user_doc.save(ignore_permissions=True)

		# Now safe to remove the stale duplicate — every former holder
		# already has the real (new-named) role.
		frappe.delete_doc("Role", old_name, force=True, ignore_permissions=True, delete_permanently=True)

	frappe.db.commit()

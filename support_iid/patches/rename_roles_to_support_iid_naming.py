import frappe


def execute():
	"""
	Renames two of this app's roles to match the "Support IID <Role>"
	naming already used for the third ("Support IID Approver"):
	    Reviewer  -> Support IID Reviewer
	    Requester -> Support IID Requester

	frappe.rename_doc("Role", old, new) updates every Has Role / DocPerm
	row referencing the old name in the DATABASE automatically — no user
	loses their role, and every existing permission grant carries over
	under the new name. It does NOT touch other fields on the Role
	record itself (home_page, desk_access, etc. survive unchanged), and
	it does NOT touch the doctype/page JSON files on disk that define
	DocPerm rows — those were updated by hand in this same change (see
	case_register.json and the other master-doctype/page JSON files) so
	the next `bench migrate` doesn't re-create permission rows under the
	stale role names.

	Guarded per-role so a repeat migrate (or a site that installs this
	app fresh, where the roles are already created with the new names
	via create_requester_role/create_support_iid_approver_role — no,
	those still create the OLD names; this patch runs after them in
	patches.txt and is what actually renames the result) doesn't error
	on an already-renamed role.
	"""
	for old_name, new_name in (
		("Reviewer", "Support IID Reviewer"),
		("Requester", "Support IID Requester"),
	):
		if frappe.db.exists("Role", old_name) and not frappe.db.exists("Role", new_name):
			frappe.rename_doc("Role", old_name, new_name, ignore_permissions=True)

	frappe.db.commit()

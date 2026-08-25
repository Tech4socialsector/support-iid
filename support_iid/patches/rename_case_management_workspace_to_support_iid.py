import frappe


def execute():
	"""
	Renames the "Case Management" Workspace to "Support IID" —
	frappe.desk.desktop.get_workspaces always displays a Workspace's own
	`name` field in the top-left workspace switcher (page["label"] =
	_(page.get("name")), not the label/title fields), so this is the only
	way to make the switcher actually read "Support IID" for this app's
	entry there, rather than the un-renamed "Case Management".

	This is a Workspace document rename, NOT a rename of the "Case
	Management" MODULE — a large number of this app's own doctypes still
	legitimately belong to that module (module: "Case Management" in
	their own JSON) and are untouched by this patch. Only the Workspace
	record itself (and the handful of other records that reference it BY
	NAME — its own Workspace Sidebar record, in particular) move.

	frappe.rename_doc handles updating any Link field elsewhere in the
	database that points at this Workspace by name automatically; the
	Workspace Sidebar record ("Case Management", looked up by
	frappe.ui.Sidebar.setup(workspace_title) — see
	create_case_management_workspace_sidebar's own comment for why an
	exact-name match matters there) is renamed too so that lookup keeps
	resolving, since nothing renames it as a side effect of renaming the
	Workspace itself (they're two independent doctypes that happen to
	share a name by convention, not a Link relationship).
	"""
	if frappe.db.exists("Workspace", "Case Management") and not frappe.db.exists("Workspace", "Support IID"):
		frappe.rename_doc("Workspace", "Case Management", "Support IID", ignore_permissions=True)
		frappe.db.set_value("Workspace", "Support IID", "label", "Support IID")
		frappe.db.set_value("Workspace", "Support IID", "title", "Support IID")

	if frappe.db.exists("Workspace Sidebar", "Case Management") and not frappe.db.exists(
		"Workspace Sidebar", "Support IID"
	):
		frappe.rename_doc("Workspace Sidebar", "Case Management", "Support IID", ignore_permissions=True)
		frappe.db.set_value("Workspace Sidebar", "Support IID", "title", "Support IID")

	frappe.db.commit()

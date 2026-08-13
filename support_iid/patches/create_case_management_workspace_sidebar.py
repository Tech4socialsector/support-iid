import frappe


def execute():
	"""
	Creates an explicit "Case Management" Workspace Sidebar record.

	Why this is needed: frappe.ui.Sidebar.setup(title) (see
	views/workspace/workspace.js) looks up frappe.boot.workspace_sidebar_item
	by the WORKSPACE's own name, lowercased — not by its module. A sidebar
	only auto-exists for a given key when either (a) an explicit Workspace
	Sidebar record has that exact name, or (b) auto_generate_sidebar_from_module
	generates one keyed by MODULE name.

	When Case Register moved from the "Case Management" module to
	"Support IID", the Case Management workspace's own module field was
	updated to match — which is correct for workspace VISIBILITY (see
	resync_case_management_workspace_module) — but it also meant the
	auto-generated fallback sidebar is now keyed "support iid", not
	"case management". Opening the Case Management workspace calls
	sidebar.setup("Case Management"), finds no "case management" key,
	and — since that lookup is wrapped in a try/except that only
	console.logs (not console.error) on failure — silently ends up with
	an empty sidebar_items list. The user sees a Desk with no crash, no
	visible error, and literally no sidebar navigation at all.

	Creating an explicit record named exactly "Case Management" sidesteps
	the module-name mismatch entirely, the same way core Frappe ships an
	explicit "Build" Workspace Sidebar (module "Core") rather than relying
	on the auto-generated fallback.
	"""
	if frappe.db.exists("Workspace Sidebar", "Case Management"):
		return

	items = []
	if frappe.db.exists("Page", "support-iid-dashboard"):
		items.append(
			{
				"type": "Link",
				"label": "Support IID Dashboard",
				"link_type": "Page",
				"link_to": "support-iid-dashboard",
				"icon": "layout-dashboard",
			}
		)
	if frappe.db.exists("Page", "case-registry"):
		items.append(
			{
				"type": "Link",
				"label": "Case Registry",
				"link_type": "Page",
				"link_to": "case-registry",
				"icon": "table",
			}
		)
	if frappe.db.exists("DocType", "Case Register"):
		items.append(
			{
				"type": "Link",
				"label": "Case Register",
				"link_type": "DocType",
				"link_to": "Case Register",
				"icon": "file-text",
			}
		)

	if not items:
		return

	frappe.get_doc(
		{
			"doctype": "Workspace Sidebar",
			"title": "Case Management",
			"header_icon": "folder-normal",
			"module": "Support IID",
			"app": "support_iid",
			"standard": 1,
			"items": items,
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()

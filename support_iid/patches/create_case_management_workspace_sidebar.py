import frappe


def execute():
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

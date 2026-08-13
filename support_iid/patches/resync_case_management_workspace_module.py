import os

import frappe
from frappe.modules.import_file import import_file_by_path


def execute():
	"""
	Force-reimports the "Case Management" Workspace from its JSON file.

	Why this is needed: like Web Form (see
	resync_web_forms_and_remove_broken_links), a Workspace's fields are
	stored as actual DB rows, not derived live from its JSON file, and a
	plain `bench migrate` does not reliably overwrite an existing
	Workspace's module field when the JSON changes.

	This mattered concretely here: Case Register moved from the "Case
	Management" module to the "Support IID" module, but this workspace
	(which only links to Case Register-related pages/lists) kept its OLD
	module value ("Case Management") in the DB across every subsequent
	migrate. Frappe's own sidebar visibility (frappe.desk.desktop.
	Workspace.is_permitted -> allow_modules) hides an ENTIRE workspace from
	any user who has no permission on anything in that workspace's module
	— so a Requester (who only ever gets permission on Case Register,
	whose module is now "Support IID") saw a completely blank Desk with no
	sidebar at all, even though they had every permission they needed on
	the actual doctype.
	"""
	app_path = frappe.get_app_path("support_iid")
	json_path = os.path.join(
		app_path, "case_management", "workspace", "case_management", "case_management.json"
	)
	if os.path.exists(json_path):
		import_file_by_path(json_path, force=True)
		frappe.db.commit()

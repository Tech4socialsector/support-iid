import os

import frappe
from frappe.modules.import_file import import_file_by_path


def execute():
	"""
	Force-reimports every standard Web Form belonging to this app from its
	JSON file on disk, then strips any Link field still pointing at a
	DocType that no longer exists.

	Why this is needed: a Web Form's web_form_fields are stored as actual
	DB rows on the Web Form document, not derived live from its JSON file.
	A plain `bench migrate` does NOT reliably overwrite an existing Web
	Form record's field list when the JSON changes — it only inserts new
	standard records or updates a few top-level properties. So when a
	linked DocType (e.g. "Functions list") was removed from the app and
	from every current JSON file, sites that had already synced the OLD
	web form JSON (with that field still in it) kept the stale field in
	their DB forever, across every subsequent `bench migrate` — the
	field's Link options.py -> get_meta() lookup then throws
	DoesNotExistError the next time anyone loads that web form, which is
	exactly the "DocType Functions list not found" 404 seen on a site that
	was migrated before the field was removed but never had this patch
	run.

	Running this patch (once, automatically, via the patches list) forces
	every web form back in sync with its current JSON, and the fallback
	cleanup below removes any Link field pointing nowhere even if some
	future removal is made the same way and forgets to bump this patch.
	"""
	app_path = frappe.get_app_path("support_iid")

	for web_form_name in frappe.get_all(
		"Web Form", filters={"is_standard": 1, "module": ["in", ["Case Management", "Master"]]}, pluck="name"
	):
		module = frappe.db.get_value("Web Form", web_form_name, "module")
		if not module:
			continue
		module_folder = frappe.scrub(module)
		web_form_folder = frappe.scrub(web_form_name)
		json_path = os.path.join(app_path, module_folder, "web_form", web_form_folder, f"{web_form_folder}.json")
		if os.path.exists(json_path):
			import_file_by_path(json_path, force=True)

	# Safety net: strip any Link field on any Web Form in this app that
	# still points at a DocType which no longer exists, regardless of
	# whether the reimport above caught it.
	for web_form_name in frappe.get_all("Web Form", filters={"is_standard": 1}, pluck="name"):
		wf = frappe.get_doc("Web Form", web_form_name)
		changed = False
		for f in list(wf.web_form_fields):
			if f.fieldtype == "Link" and f.options and not frappe.db.exists("DocType", f.options):
				wf.web_form_fields.remove(f)
				changed = True
				frappe.log_error(
					f"Removed broken Web Form field '{f.fieldname}' -> missing DocType '{f.options}' "
					f"from '{web_form_name}' during migration cleanup.",
					"resync_web_forms_and_remove_broken_links",
				)
		if changed:
			wf.save(ignore_permissions=True)

	frappe.db.commit()

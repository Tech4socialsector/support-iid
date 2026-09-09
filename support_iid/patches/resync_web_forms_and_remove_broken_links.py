import os

import frappe
from frappe.modules.import_file import import_file_by_path


def execute():
	app_path = frappe.get_app_path("support_iid")

	for web_form_name in frappe.get_all(
		"Web Form", filters={"is_standard": 1, "module": ["in", ["Case Management", "Master"]]}, pluck="name"
	):
		module = frappe.db.get_value("Web Form", web_form_name, "module")
		if not module:
			continue
		module_folder = frappe.scrub(module)
		web_form_folder = frappe.scrub(web_form_name)
		json_path = os.path.join(
			app_path, module_folder, "web_form", web_form_folder, f"{web_form_folder}.json"
		)
		if os.path.exists(json_path):
			import_file_by_path(json_path, force=True)

	for web_form_name in frappe.get_all(
		"Web Form", filters={"is_standard": 1, "module": ["in", ["Case Management", "Master"]]}, pluck="name"
	):
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

import os

import frappe
from frappe.modules.import_file import import_file_by_path


def execute():
	app_path = frappe.get_app_path("support_iid")
	json_path = os.path.join(
		app_path, "case_management", "workspace", "case_management", "case_management.json"
	)
	if os.path.exists(json_path):
		import_file_by_path(json_path, force=True)
		frappe.db.commit()

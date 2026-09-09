import frappe


def execute():
	if not frappe.db.exists("Case Status List", "Final Verification"):
		frappe.get_doc({"doctype": "Case Status List", "name": "Final Verification"}).insert(
			ignore_permissions=True
		)

	frappe.db.sql(
		"""
		UPDATE `tabCase Register`
		SET case_status = 'Final Verification'
		WHERE case_status = 'Pending Approval'
		AND current_approval_level = 'Final Verification'
		"""
	)

	frappe.db.commit()

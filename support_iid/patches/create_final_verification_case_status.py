import frappe


def execute():
	"""
	Adds "Final Verification" to Case Status List, and migrates any
	already-in-flight case sitting at the old, indistinguishable
	representation of this same state (case_status="Pending Approval",
	current_approval_level="Final Verification") over to the new,
	dedicated case_status value.

	Before this patch, a case waiting on the Support IID Reviewer's own
	sign-off was invisible as such anywhere that only reads/filters/
	displays case_status directly (list views, reports, the Desk status
	badge, dashboard counts) — every one of those showed the exact same
	"Pending Approval" a case still working through an ordinary L1/L2/L3
	approval level would, with current_approval_level the only field
	that actually distinguished the two. That field carries no
	permission of its own guaranteed to reach every code path that reads
	the document the same reliable way case_status (the doctype's real
	status field) does, which is exactly the ambiguity a Support IID
	Reviewer hit trying to find their own Final Verification action
	button. See case_register.py's CASE_STATUS_FINAL_VERIFICATION for
	the ongoing app-side half of this fix.
	"""
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

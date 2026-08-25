import frappe


def execute():
	"""
	current_approval_level's "provisionally approved, awaiting the
	Support IID Reviewer's final verification" value was changed from the
	literal string "Reviewer" to "Final Verification" earlier this session
	(see CASE_APPROVAL_LEVEL_REVIEWER in case_register.py) — a pure
	rewording, away from a name that read like a per-case approval level
	rather than what it actually is (a role-based final-check gate).

	That rename touched the CODE's constant, but any Case Register that
	was ALREADY sitting at this stage before the change still has the old
	literal "Reviewer" stored in its current_approval_level DB column —
	frappe.rename_doc-style renames don't apply here since this was never
	a Link/Role rename, just a plain string literal baked into existing
	rows. Every place that gates on this value (most importantly
	apply_reviewer_final_approval_button in case_register.js, which is
	what actually shows the Reviewer their "Final Verification" action
	button) does an EXACT match against the new string — so any case
	stuck with the stale "Reviewer" value silently stopped showing that
	button the moment the code changed, with no error, no crash, just a
	case a Reviewer could no longer act on.

	Case Status stays "Pending Approval" through this whole stage, so
	filtering on current_approval_level alone (without needing to touch
	case_status at all) is enough to find every affected case.
	"""
	frappe.db.set_value(
		"Case Register",
		{"current_approval_level": "Reviewer"},
		"current_approval_level",
		"Final Verification",
		update_modified=False,
	)
	frappe.db.commit()

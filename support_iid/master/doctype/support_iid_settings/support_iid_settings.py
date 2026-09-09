import frappe
from frappe.custom.doctype.property_setter.property_setter import delete_property_setter
from frappe.model.document import Document

CASE_REGISTER_DOCTYPE = "Case Register"

# Every fieldname currently marked reqd:1 across Case Register itself AND
# its four child-table doctypes (Case Documents/Family Member/Case Approval
# Log/Case Approval Stage, each its own doctype with its own DocFields — a
# Property Setter is always applied against the doctype a field actually
# belongs to, never the parent it's used from) — kept as a static map here
# rather than read live off frappe.get_meta(), since once
# disable_case_register_mandatory_fields has run once, the live meta itself
# reflects the Property Setter override (reqd already forced to 0), so a
# later read would see nothing left to restore and silently forget which
# fields were ever mandatory in the first place. Update this map by hand if
# a field's reqd:1 is ever added/removed on any of these doctypes.
#
# Case Approval Log and Case Approval Stage have no reqd:1 fields of their
# own today, so they're left out entirely rather than listed with an empty
# array.
CASE_REGISTER_MANDATORY_FIELDS_BY_DOCTYPE = {
	CASE_REGISTER_DOCTYPE: [
		"type_of_request",
		"request_date",
		"beneficiary_name",
		"age",
		"mobile_number",
		"date_of_birth",
		"gender",
		"employment_status",
		"address_line_1",
		"district",
		"pincode",
		"state",
		"hospital_institution_name",
		"hospital_institution_location",
		"ailment__course_details",
		"funds_requested",
		"annual_family_income",
		"existing_debt",
		"residence_type",
		"residence_details",
		"physical_verification",
		"requestor_email",
		"marital_status",
		"note_about_the_individual",
		"requestor_name",
		"requestor_mobile_number",
	],
	# Supporting Documents grid
	"Case Documents": [
		"document_name",
	],
	# Family Members grid
	"Family Member": [
		"member_name",
		"monthly_income",
	],
}


class SupportIIDSettings(Document):
	def on_update(self):
		self._apply_case_register_mandatory_override()

	def _apply_case_register_mandatory_override(self):
		"""
		disable_case_register_mandatory_fields, checked -> every field in
		CASE_REGISTER_MANDATORY_FIELDS_BY_DOCTYPE (Case Register itself,
		plus its Case Documents/Family Member child-table rows) gets a
		Property Setter forcing reqd to 0 — genuinely optional everywhere
		(Desk form, guest web form, Data Import), not just bypassed on
		one save path. Unchecked -> those Property Setters are removed,
		restoring each field's real reqd:1 from its own doctype's JSON
		definition.

		Idempotent either way: make_property_setter's own validate()
		already deletes any existing Property Setter for the same
		(doctype, property, fieldname) before inserting the new one (see
		frappe/custom/doctype/property_setter/property_setter.py), and
		delete_property_setter on a field with no such row is a no-op —
		so saving Settings repeatedly with the checkbox unchanged doesn't
		create duplicates or error out.
		"""
		touched_doctypes = set()

		for doctype, fieldnames in CASE_REGISTER_MANDATORY_FIELDS_BY_DOCTYPE.items():
			touched_doctypes.add(doctype)
			for fieldname in fieldnames:
				if self.disable_case_register_mandatory_fields:
					frappe.make_property_setter(
						{
							"doctype": doctype,
							"fieldname": fieldname,
							"property": "reqd",
							"value": "0",
							"property_type": "Check",
						}
					)
				else:
					delete_property_setter(doctype, "reqd", fieldname)

		for doctype in touched_doctypes:
			frappe.clear_cache(doctype=doctype)

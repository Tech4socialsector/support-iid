import frappe

def get_context(context):
	# do your magic here
	pass




@frappe.whitelist(allow_guest=True)
def get_document_types(type_of_request):
    documents = []

    for name in frappe.get_all("Documents list", pluck="name"):
        doc = frappe.get_doc("Documents list", name)

        matching = [
            row.type_of_request
            for row in doc.type_of_request_list
            if row.type_of_request == type_of_request
        ]

        if matching:
            documents.append({
                "name": doc.name,
                "type_of_request_list": matching,
                "is_mandatory": doc.is_mandatory,
            })

    return documents





@frappe.whitelist(allow_guest=True)
def get_case_approval_hierarchy(email):
    hierarchy_name = frappe.db.get_value(
        "Approval Hierarchy",
        {
            "requestor_email": email
        },
        "name"
    )

    if not hierarchy_name:
        frappe.throw(
            f"No Approval Hierarchy found for {email}"
        )

    hierarchy = frappe.get_doc(
        "Approval Hierarchy",
        hierarchy_name
    )

    approval_stage = []

    for row in hierarchy.approval_hierarchy_details:

        approval_stage.append({

            "approver_name": row.approver_name,
            "approver_email": row.approver_email,
            "case_approval_level_decription": row.case_approval_level_decription,
            "case_approval_status": "",
            "case_approval_via": row.case_approval_via

        })

    return {

        "requestor_name": hierarchy.requestor_name,
        "approval_stage": approval_stage

    }
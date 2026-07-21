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
                "type_of_request_list": matching
            })

    return documents        
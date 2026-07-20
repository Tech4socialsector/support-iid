import frappe

def get_context(context):
	# do your magic here
	pass


@frappe.whitelist(allow_guest=True)
def get_document_types():
    return frappe.get_all(
        "Documents list",
        fields=["name"],
        order_by="idx asc",
        limit_page_length=6,
        ignore_permissions=True
    )
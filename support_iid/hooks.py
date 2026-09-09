app_name = "support_iid"
app_title = "Support IID"
app_publisher = "Tech For Social Sector"
app_description = "Support IID is a grant and support management application developed for the Azim Premji Foundation. It enables teams to track grant requests, beneficiary support, approvals, disbursements, case progress, and related documentation for education and healthcare initiatives. The application provides end-to-end visibility into support programs, helping ensure transparent, efficient, and accountable management of grants and assistance."
app_email = "tech4socialsector@azimpremjifoundation.org"
app_license = "mit"

app_logo_url = "/assets/support_iid/images/apf_logo.png"


# required_apps = []


app_include_js = "/assets/support_iid/js/pwa_register.js"


fixtures = [
	"Case Status List",
	"Type of Request List",
	"Source of Request List",
	"Documents list",
	"Qualification",
	"Family Member Relationship",
	{
		"dt": "Role",
		"filters": [["name", "in", ["Support IID Approver", "Support IID Reviewer", "Support IID Requester"]]],
	},
]


# after_build = "support_iid.build.after_build"


# notification_config = "support_iid.notifications.get_notification_config"


permission_query_conditions = {
	"Case Register": "support_iid.support_iid.doctype.case_register.case_register.get_permission_query_conditions",
}

has_permission = {
	"Case Register": "support_iid.support_iid.doctype.case_register.case_register.has_permission",
}


# before_tests = "support_iid.install.before_tests"


# ignore_links_on_delete = ["Communication", "ToDo"]



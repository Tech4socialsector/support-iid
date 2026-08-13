app_name = "support_iid"
app_title = "Support IID"
app_publisher = "Tech For Social Sector"
app_description = "Support IID is a grant and support management application developed for the Azim Premji Foundation. It enables teams to track grant requests, beneficiary support, approvals, disbursements, case progress, and related documentation for education and healthcare initiatives. The application provides end-to-end visibility into support programs, helping ensure transparent, efficient, and accountable management of grants and assistance."
app_email = "tech4socialsector@azimpremjifoundation.org"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "support_iid",
# 		"logo": "/assets/support_iid/logo.png",
# 		"title": "Support IID",
# 		"route": "/support_iid",
# 		"has_permission": "support_iid.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/support_iid/css/support_iid.css"
# app_include_js = "/assets/support_iid/js/support_iid.js"

# include js, css files in header of web template
# web_include_css = "/assets/support_iid/css/support_iid.css"
# web_include_js = "/assets/support_iid/js/support_iid.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "support_iid/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "support_iid/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "support_iid.utils.jinja_methods",
# 	"filters": "support_iid.utils.jinja_filters"
# }

# Fixtures
# ------------
# Master/config data exported so it installs automatically on any fresh
# site running this app, not just this dev site.

fixtures = [
	"Case Status List",
	"Type of Request List",
	"Source of Request List",
	"Documents list",
	"Qualification",
	"Family Member Relationship",
	{"dt": "Role", "filters": [["name", "in", ["Support IID Approver", "Reviewer", "Requester"]]]},
]

# Installation
# ------------

# before_install = "support_iid.install.before_install"
# after_install = "support_iid.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "support_iid.uninstall.before_uninstall"
# after_uninstall = "support_iid.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "support_iid.utils.before_app_install"
# after_app_install = "support_iid.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "support_iid.utils.before_app_uninstall"
# after_app_uninstall = "support_iid.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "support_iid.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "support_iid.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

permission_query_conditions = {
	"Case Register": "support_iid.support_iid.doctype.case_register.case_register.get_permission_query_conditions",
}

has_permission = {
	"Case Register": "support_iid.support_iid.doctype.case_register.case_register.has_permission",
}

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"support_iid.tasks.all"
# 	],
# 	"daily": [
# 		"support_iid.tasks.daily"
# 	],
# 	"hourly": [
# 		"support_iid.tasks.hourly"
# 	],
# 	"weekly": [
# 		"support_iid.tasks.weekly"
# 	],
# 	"monthly": [
# 		"support_iid.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "support_iid.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "support_iid.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "support_iid.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "support_iid.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["support_iid.utils.before_request"]
# after_request = ["support_iid.utils.after_request"]

# Job Events
# ----------
# before_job = ["support_iid.utils.before_job"]
# after_job = ["support_iid.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"support_iid.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

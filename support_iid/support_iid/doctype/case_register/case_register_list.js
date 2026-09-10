
const CASE_REGISTER_STATUS_COLOR = {
	Draft: "gray",
	"Pending Approval": "orange",
	"Final Verification": "orange",
	Approved: "green",
	Rejected: "red",
	"Sent Back": "yellow",
	"On Hold": "orange",
	Closed: "darkgrey",
	"Withdrawn by the Requester": "darkgrey",
};

// "Final Verification" is stored as-is (its own real Case Status List
// value — see CASE_STATUS_FINAL_VERIFICATION in case_register.py), but
// reads better to a user as "Pending with Reviewer" here, same relabeling
// case_register.py/case_register.js/the dashboard already apply for this
// exact status and for "Sent Back" -> "Pending with Requester".
const CASE_REGISTER_STATUS_DISPLAY_LABELS = {
	"Sent Back": "Pending with Requester",
	Rejected: "Declined",
	"Final Verification": "Pending with Reviewer",
};

frappe.listview_settings["Case Register"] = {
	get_indicator: function (doc) {
		var color = CASE_REGISTER_STATUS_COLOR[doc.case_status] || "gray";
		var label = CASE_REGISTER_STATUS_DISPLAY_LABELS[doc.case_status] || doc.case_status || "";
		return [__(label), color, "case_status,=," + doc.case_status];
	},

	// Case Status is read_only:1 on the doctype (only editable on the
	// form itself, and only for System Manager/Administrator via its own
	// read_only_depends_on — see case_register.json) specifically so it
	// can't be changed by an ordinary Requester/Approver/Reviewer. That
	// same read_only:1 is exactly why it can never appear as an option in
	// Frappe's own Bulk Edit tool either: Bulk Edit's field list only
	// offers fields whose base read_only is 0 (is_field_editable in
	// frappe/public/js/frappe/list/list_view.js) — it has no idea
	// read_only_depends_on exists, so it can't tell "read-only for most
	// people" apart from "read-only for everyone". This adds a separate,
	// purpose-built bulk action instead of trying to make Bulk Edit
	// itself offer the field — one that re-checks the same System
	// Manager/Administrator restriction server-side in
	// bulk_set_case_status, so it can't be reached by anyone Bulk Edit
	// itself was already right to hide this field from.
	onload: function (listview) {
		if (!frappe.user_roles.includes("System Manager") && frappe.session.user !== "Administrator") {
			return;
		}

		listview.page.add_action_item(__("Bulk Update Case Status"), function () {
			var names = listview.get_checked_items(true);
			if (!names.length) {
				frappe.show_alert({
					message: __("Select at least one case first."),
					indicator: "orange",
				});
				return;
			}

			frappe.db.get_list("Case Status List", { fields: ["name"], limit_page_length: 0 }).then(function (rows) {
				var options = (rows || []).filter((r) => r.name !== "Draft").map((r) => r.name);

				var dialog = new frappe.ui.Dialog({
					title: __("Bulk Update Case Status — {0} case(s)", [names.length]),
					fields: [
						{
							fieldname: "case_status",
							fieldtype: "Select",
							label: __("New Case Status"),
							options: options,
							reqd: 1,
						},
					],
					primary_action_label: __("Update"),
					primary_action: function (values) {
						frappe.call({
							method: "support_iid.support_iid.doctype.case_register.case_register.bulk_set_case_status",
							args: { names: names, case_status: values.case_status },
							freeze: true,
							freeze_message: __("Updating..."),
							callback: function (r) {
								dialog.hide();
								if (r.message) {
									frappe.show_alert({
										message: __("Updated {0} case(s).", [r.message.updated]),
										indicator: "green",
									});
									listview.refresh();
								}
							},
						});
					},
				});
				dialog.show();
			});
		});
	},
};

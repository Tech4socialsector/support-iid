// Copyright (c) 2026, Tech For Social Sector and contributors
// For license information, please see license.txt

// Colors the Case Status badge — both in the list view and the form's
// own title-area indicator (frappe.get_indicator calls this same hook
// for both). Mirrors the palette already used on the custom Case
// Registry page's STATUS_COLOR map, extended with the two statuses that
// page didn't have a case for (Pending Approval, Withdrawn).
const CASE_REGISTER_STATUS_COLOR = {
	Draft: "gray",
	"Pending Approval": "orange",
	Approved: "green",
	Rejected: "red",
	"Sent Back": "yellow",
	"On Hold": "orange",
	Closed: "darkgrey",
	"Withdrawn by the Requester": "darkgrey",
};

frappe.listview_settings["Case Register"] = {
	get_indicator: function (doc) {
		var color = CASE_REGISTER_STATUS_COLOR[doc.case_status] || "gray";
		return [__(doc.case_status || ""), color, "case_status,=," + doc.case_status];
	},
};

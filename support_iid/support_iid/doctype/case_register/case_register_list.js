
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

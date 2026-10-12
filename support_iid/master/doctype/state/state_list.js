// A list sort saved before this doctype's fields changed (e.g. the old
// district_name / district / state_name) makes every load fail with
// "You do not have permission to access field ...". Fall back to the default
// sort when the saved one is no longer a field — runs before the first fetch.
frappe.listview_settings["State"] = {
	onload(listview) {
		var standard = ["name", "creation", "modified", "owner", "modified_by", "idx"];
		var sort_by = (listview.sort_selector && listview.sort_selector.sort_by) || listview.sort_by;
		if (!sort_by || standard.includes(sort_by) || frappe.meta.has_field("State", sort_by)) return;

		listview.sort_by = "modified";
		listview.sort_order = "desc";
		if (listview.sort_selector) listview.sort_selector.set_value("modified", "desc");
	},
};

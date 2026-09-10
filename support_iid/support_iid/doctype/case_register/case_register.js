
if (!document.getElementById('siid-office-preview-script')) {
	var siid_preview_script = document.createElement('script');
	siid_preview_script.id = 'siid-office-preview-script';
	siid_preview_script.src = '/assets/support_iid/js/office_preview.js';
	document.head.appendChild(siid_preview_script);
}

$(
	"<style>" +
		".sd-mandatory-row { border-left:3px solid #c0392b; background:#fdf3f2; }" +
		".sd-mandatory-row .row-index { cursor:help; }" +
		"</style>"
).appendTo("head");

if (!document.getElementById("case-register-mobile-grid-style")) {
	var mobile_grid_style = document.createElement("style");
	mobile_grid_style.id = "case-register-mobile-grid-style";
	mobile_grid_style.textContent =
		"@media (max-width:640px) {" +
		"  .form-grid-container { margin-left:-15px; margin-right:-15px; }" +
		"  .form-grid-container .form-grid { overflow-x:auto; -webkit-overflow-scrolling:touch; }" +
		"  .form-grid-container .grid-heading-row, .form-grid-container .grid-row { min-width:max-content; }" +
		"  .form-grid-container .grid-static-col { min-width:110px; font-size:13px; padding-top:10px; padding-bottom:10px; }" +
		"  .form-grid-container .row-check, .form-grid-container .row-index { min-width:36px; }" +
		"  .form-grid-container .grid-row-check { width:18px; height:18px; }" +
		"  .form-grid-container .grid-footer-toolbar .btn { padding:8px 14px; font-size:13px; }" +
		"  .form-grid-container .grid-add-row { padding:10px 14px; font-size:13px; }" +
		"}";
	document.head.appendChild(mobile_grid_style);
}

if (!document.getElementById("case-register-loader-style")) {
	var loader_style = document.createElement("style");
	loader_style.id = "case-register-loader-style";
	loader_style.textContent =
		"@keyframes caseRegisterSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }";
	document.head.appendChild(loader_style);
}

function case_register_show_loader(message) {
	if (document.getElementById("case-register-loader")) return;
	var html =
		'<div id="case-register-loader" style="' +
		"position:fixed;top:0;left:0;width:100vw;height:100vh;" +
		"background:rgba(255,255,255,0.88);z-index:99999;" +
		"display:flex;flex-direction:column;align-items:center;" +
		'justify-content:center;gap:16px;">' +
		'<div style="position:relative;width:56px;height:56px;">' +
		'<img src="/assets/support_iid/images/apf_logo.png" style="width:56px;height:56px;' +
		'object-fit:contain;position:absolute;top:0;left:0;">' +
		'<div style="position:absolute;top:-6px;left:-6px;width:68px;height:68px;' +
		"border:3px solid #d7e6f7;border-top-color:#2490ef;border-radius:50%;" +
		'animation:caseRegisterSpin 0.8s linear infinite;"></div>' +
		"</div>" +
		'<span style="font-size:14px;font-weight:500;color:#36414c;">' +
		frappe.utils.escape_html(message || __("Loading...")) +
		"</span>" +
		"</div>";
	$(html).appendTo("body");
}

function case_register_hide_loader() {
	$("#case-register-loader").remove();
}

function case_register_call_with_loader(opts) {
	var message = opts.freeze_message;
	var original_always = opts.always;
	delete opts.freeze;
	delete opts.freeze_message;

	case_register_show_loader(message);
	opts.always = function () {
		case_register_hide_loader();
		if (original_always) original_always.apply(this, arguments);
	};
	frappe.call(opts);
}

if (!document.getElementById("case-register-modal-style")) {
	var modal_style = document.createElement("style");
	modal_style.id = "case-register-modal-style";
	modal_style.textContent =
		"@keyframes caseRegisterModalIn { from { opacity:0; transform:translateY(8px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }" +
		"@keyframes caseRegisterFadeIn { from { opacity:0; } to { opacity:1; } }" +
		".cr-modal-field:focus { outline:none; border-color:#2490ef !important; box-shadow:0 0 0 3px rgba(36,144,239,.15); }" +
		".cr-modal-btn-primary:hover { background:#1a7bd1 !important; }" +
		".cr-modal-btn-secondary:hover { background:#eef1f4 !important; }" +
		".cr-modal-close:hover { background:#eef1f4 !important; }";
	document.head.appendChild(modal_style);
}

function case_register_open_modal(opts) {
	var overlay = document.createElement("div");
	overlay.style.cssText =
		"position:fixed;inset:0;z-index:100000;background:rgba(20,26,32,.45);" +
		"backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;" +
		"padding:20px;animation:caseRegisterFadeIn .15s ease-out;";

	var field_html = (opts.fields || [])
		.map(function (f) {
			var label_html =
				'<label style="display:block;font-size:13.5px;font-weight:600;color:#4a5560;margin-bottom:7px;">' +
				frappe.utils.escape_html(f.label) +
				(f.reqd ? ' <span style="color:#e0524c;">*</span>' : "") +
				"</label>";
			var base_input_style =
				"width:100%;padding:10px 13px;font-size:14.5px;border:1.5px solid #dde3e8;" +
				"border-radius:9px;color:#1a2229;background:#fff;box-sizing:border-box;transition:border-color .12s;";

			if (f.type === "select") {
				var opts_html = (f.options || [])
					.map(function (o) {
						return (
							'<option value="' +
							frappe.utils.escape_html(o) +
							'"' +
							(o === f.default ? " selected" : "") +
							">" +
							frappe.utils.escape_html(o) +
							"</option>"
						);
					})
					.join("");
				return (
					'<div style="margin-bottom:14px;">' +
					label_html +
					'<select class="cr-modal-field" data-fieldname="' +
					f.fieldname +
					'" style="' +
					base_input_style +
					'appearance:auto;">' +
					opts_html +
					"</select></div>"
				);
			}
			if (f.type === "check") {
				return (
					'<label style="display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;cursor:pointer;font-size:14px;color:#4a5560;line-height:1.5;">' +
					'<input type="checkbox" class="cr-modal-field" data-fieldname="' +
					f.fieldname +
					'" style="margin-top:2px;width:17px;height:17px;accent-color:#2490ef;flex-shrink:0;cursor:pointer;">' +
					"<span>" +
					frappe.utils.escape_html(f.label) +
					"</span></label>"
				);
			}
			// text / textarea
			return (
				'<div style="margin-bottom:14px;">' +
				label_html +
				'<textarea class="cr-modal-field" data-fieldname="' +
				f.fieldname +
				'" rows="3" style="' +
				base_input_style +
				'resize:vertical;font-family:inherit;"></textarea></div>'
			);
		})
		.join("");

	overlay.innerHTML =
		'<div style="background:#fff;border-radius:16px;width:100%;max-width:520px;' +
		'box-shadow:0 16px 48px rgba(20,26,32,.24);animation:caseRegisterModalIn .18s cubic-bezier(.2,.8,.3,1);' +
		'overflow:hidden;">' +
		'<div style="padding:28px 30px 6px;display:flex;align-items:flex-start;gap:14px;">' +
		'<img src="/assets/support_iid/images/apf_logo.png" style="width:40px;height:40px;object-fit:contain;flex-shrink:0;margin-top:2px;">' +
		'<div style="flex:1;">' +
		(opts.title
			? '<div style="font-size:18.5px;font-weight:600;color:#1a2229;margin-bottom:5px;">' +
			  frappe.utils.escape_html(opts.title) +
			  "</div>"
			: "") +
		(opts.message
			? '<div style="font-size:14.5px;color:#5c6773;line-height:1.55;">' +
			  frappe.utils.escape_html(opts.message) +
			  "</div>"
			: "") +
		"</div>" +
		'<button class="cr-modal-close" style="background:none;border:none;font-size:19px;color:#9aa4ad;' +
		'cursor:pointer;line-height:1;padding:5px;border-radius:7px;flex-shrink:0;">✕</button>' +
		"</div>" +
		'<div style="padding:22px 30px 4px;">' +
		field_html +
		"</div>" +
		'<div style="padding:16px 30px 26px;display:flex;justify-content:flex-end;gap:12px;">' +
		'<button class="cr-modal-btn-secondary" style="padding:9px 18px;font-size:14px;font-weight:500;' +
		"border:1.5px solid #dde3e8;background:#fff;color:#4a5560;border-radius:9px;cursor:pointer;transition:background .12s;\">" +
		__("Cancel") +
		"</button>" +
		'<button class="cr-modal-btn-primary" style="padding:9px 20px;font-size:14px;font-weight:600;' +
		"border:none;background:#2490ef;color:#fff;border-radius:9px;cursor:pointer;transition:background .12s;\">" +
		frappe.utils.escape_html(opts.primary_label || __("Confirm")) +
		"</button>" +
		"</div>" +
		"</div>";

	document.body.appendChild(overlay);

	function close() {
		overlay.remove();
		document.removeEventListener("keydown", on_key);
	}
	function on_key(e) {
		if (e.key === "Escape") close();
	}
	document.addEventListener("keydown", on_key);
	overlay.addEventListener("mousedown", function (e) {
		if (e.target === overlay) close();
	});
	overlay.querySelector(".cr-modal-close").addEventListener("click", close);
	overlay.querySelector(".cr-modal-btn-secondary").addEventListener("click", close);
	overlay.querySelector(".cr-modal-btn-primary").addEventListener("click", function () {
		var values = {};
		overlay.querySelectorAll(".cr-modal-field").forEach(function (el) {
			values[el.dataset.fieldname] = el.type === "checkbox" ? el.checked : el.value;
		});
		for (var i = 0; i < (opts.fields || []).length; i++) {
			var f = opts.fields[i];
			if (f.reqd && !values[f.fieldname]) {
				frappe.show_alert({
					message: __("{0} is required.", [f.label]),
					indicator: "orange",
				});
				return;
			}
		}
		opts.on_submit(values, close);
	});

	var first_input = overlay.querySelector(".cr-modal-field");
	if (first_input) first_input.focus();
}

function case_register_branded_confirm(message, declaration_label, on_confirm) {
	case_register_open_modal({
		message: message,
		fields: [{ fieldname: "declaration", type: "check", label: declaration_label, reqd: 1 }],
		primary_label: __("Confirm"),
		on_submit: function (values, close) {
			close();
			on_confirm();
		},
	});
}

frappe.ui.form.on("Case Register", {
	onload(frm) {
		if (!frm.is_new()) return;

		if (frm.doc.requestor_email) {
			var already_has_autofill = frm.doc.requestor_name || frm.doc.department || frm.doc.work_location;
			if (!already_has_autofill) {
				fetch_requestor_details(frm, frm.doc.requestor_email);
			}
			return;
		}
		if (["Administrator", "Guest"].includes(frappe.session.user)) return;

		frm.set_value("requestor_email", frappe.session.user);
		fetch_requestor_details(frm, frappe.session.user);
	},

	requestor_email: frappe.utils.debounce(function (frm) {
		case_register_validate_email(frm, "requestor_email");
		var email = (frm.doc.requestor_email || "").trim();
		if (!email) return;
		fetch_requestor_details(frm, email);
	}, 800),

	type_of_request(frm) {
		apply_request_type_labels(frm, frm.doc.type_of_request);
		if (!frm.doc.type_of_request) return;
		load_documents_for(frm, frm.doc.type_of_request);
	},

	requestor_mobile_number(frm) {
		case_register_validate_mobile(frm, "requestor_mobile_number");
	},

	insurance_type(frm) {
		apply_insurance_visibility(frm, frm.doc.insurance_type);
	},

	physical_verification(frm) {
		apply_verification_visibility(frm, frm.doc.physical_verification);
	},

	pincode(frm) {
		var pin = String(frm.doc.pincode || "").trim();
		if (!pin) return;
		if (!case_register_validate_pincode(frm)) {
			frm.set_value("state", "");
			frm.set_value("district", "");
			return;
		}
		fetch("https://api.postalpincode.in/pincode/" + pin)
			.then(function (res) {
				return res.json();
			})
			.then(function (data) {
				if (data && data[0] && data[0].Status === "Success") {
					var po = data[0].PostOffice[0];
					frm.set_value("state", po.State);
					frm.set_value("district", po.District);
				} else {
					frm.set_value("state", "");
					frm.set_value("district", "");
					frappe.show_alert({
						message: __("Invalid pincode — no matching location found."),
						indicator: "orange",
					});
				}
			})
			.catch(function () {
				frappe.show_alert({
					message: __("Could not fetch location for this pincode. Please check your connection."),
					indicator: "red",
				});
			});
	},

	date_of_birth(frm) {
		if (!frm.doc.date_of_birth) return;
		if (!case_register_validate_dob(frm)) return;
		var dob = frappe.datetime.str_to_obj(frm.doc.date_of_birth);
		var today = new Date();
		var age = today.getFullYear() - dob.getFullYear();
		var m = today.getMonth() - dob.getMonth();
		if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
		frm.set_value("age", age);
	},

	email(frm) {
		case_register_validate_email(frm, "email");
	},

	beneficiary_name(frm) {
		case_register_validate_name(frm, "beneficiary_name");
	},

	requestor_name(frm) {
		case_register_validate_name(frm, "requestor_name");
	},

	primary_contact_person(frm) {
		case_register_validate_name(frm, "primary_contact_person");
	},

	mobile_number(frm) {
		case_register_validate_mobile(frm, "mobile_number");
	},

	primary_contact_mobile(frm) {
		case_register_validate_mobile(frm, "primary_contact_mobile");
	},

	funds_requested: frappe.utils.debounce(function (frm) {
		case_register_validate_currency(frm, "funds_requested");
		if (!frm.doc.requestor_email) return;
		fetch_requestor_details(frm, frm.doc.requestor_email);
	}, 800),

	amount_already_spent(frm) {
		case_register_validate_currency(frm, "amount_already_spent");
	},

	annual_family_income(frm) {
		case_register_validate_currency(frm, "annual_family_income");
	},

	refresh(frm) {
		if (frm.is_new()) {
			apply_save_as_draft_label(frm);
		}

		mark_mandatory_document_rows(frm);
		setup_supporting_document_preview(frm);
		force_private_attachments(frm);
		apply_request_type_labels(frm, frm.doc.type_of_request);
		apply_insurance_visibility(frm, frm.doc.insurance_type);
		apply_verification_visibility(frm, frm.doc.physical_verification);

		var current_roles = frappe.user_roles || [];
		var can_edit_approval_stage =
			current_roles.includes("Support IID Reviewer") || current_roles.includes("System Manager");
		frm.set_df_property("case_approval_stage", "read_only", can_edit_approval_stage ? 0 : 1);
		frm.refresh_field("case_approval_stage");

		apply_requester_post_submit_view(frm);
		apply_approver_read_only_view(frm);
		apply_approver_action_button(frm);
		apply_reviewer_final_approval_button(frm);
		apply_case_status_indicator(frm);
		case_register_resync_stale_roles(frm);

		if (frm.doc.case_status !== "Draft" || frm.is_new()) return;

		frm.disable_save();
		frm.page.set_primary_action(__("Submit"), () => submit_draft_case(frm));
		apply_draft_resave_toggle(frm);
	},

	validate(frm) {
		var all_valid = true;

		if (!case_register_validate_pincode(frm)) all_valid = false;
		if (!case_register_validate_dob(frm)) all_valid = false;
		if (!case_register_validate_email(frm, "email")) all_valid = false;
		if (!case_register_validate_email(frm, "requestor_email")) all_valid = false;
		if (!case_register_validate_mobile(frm, "mobile_number")) all_valid = false;
		if (!case_register_validate_mobile(frm, "requestor_mobile_number")) all_valid = false;
		if (!case_register_validate_mobile(frm, "primary_contact_mobile")) all_valid = false;
		if (!case_register_validate_currency(frm, "funds_requested")) all_valid = false;
		if (!case_register_validate_currency(frm, "amount_already_spent")) all_valid = false;
		if (!case_register_validate_currency(frm, "annual_family_income")) all_valid = false;
		_CASE_REGISTER_NAME_FIELDS.forEach(function (fieldname) {
			if (!case_register_validate_name(frm, fieldname)) all_valid = false;
		});

		var rows = frm.doc.supporting_documents || [];
		var missing = rows.filter(function (r) {
			return r.is_mandatory && !r.attachment;
		});
		if (!missing.length) {
			case_register_clear_field_error(frm, "supporting_documents");
		} else {
			case_register_field_error(
				frm,
				"supporting_documents",
				__("Please attach all mandatory documents: {0}", [missing.map((r) => r.document_name).join(", ")])
			);
			all_valid = false;
		}

		if (!all_valid) frappe.validated = false;
	},
});

function apply_save_as_draft_label(frm) {
	frm.page.set_primary_action(__("Save as Draft"), () => frm.save());
	if (frm.$wrapper.data("case-register-save-label-guard")) return;
	frm.$wrapper.data("case-register-save-label-guard", true);
	frm.$wrapper.on("dirty", function () {
		if (frm.is_new()) {
			frm.page.set_primary_action(__("Save as Draft"), () => frm.save());
		}
	});
}

function apply_draft_resave_toggle(frm) {
	if (frm.$wrapper.data("case-register-draft-resave-guard")) return;
	frm.$wrapper.data("case-register-draft-resave-guard", true);
	frm.$wrapper.on("dirty", function () {
		if (!frm.is_new() && frm.doc.case_status === "Draft") {
			frm.page.set_primary_action(__("Save"), () => frm.save());
			frm.page.set_indicator(__("Not Saved"), "orange");
		}
	});
}

// Mirrors applyInsuranceVisibility() in support_iid_case_registration.js.
function apply_insurance_visibility(frm, value) {
	var no_insurance = !value || value === "No Insurance";
	frm.set_df_property("insurance_coverage_details", "hidden", no_insurance ? 1 : 0);
	frm.set_df_property("insurance_coverage_details", "reqd", no_insurance ? 0 : 1);
	frm.refresh_field("insurance_coverage_details");
}

// Mirrors applyVerificationVisibility() in support_iid_case_registration.js.
function apply_verification_visibility(frm, value) {
	var show = value === "Yes";
	frm.set_df_property("physical_verification_notes", "hidden", show ? 0 : 1);
	if (!show && frm.doc.physical_verification_notes) {
		frm.set_value("physical_verification_notes", "");
	}
	frm.refresh_field("physical_verification_notes");
}

function apply_request_type_labels(frm, value) {
	if (value === "Medical") {
		frm.set_df_property("hospital_institution_name", "label", __("Hospital Name"));
		frm.set_df_property("hospital_institution_location", "label", __("Hospital Location"));
		frm.set_df_property("ailment__course_details", "label", __("Ailment Details"));
		frm.set_df_property("treatment", "hidden", 0);
		frm.set_df_property("treatment", "reqd", 1);
		frm.set_df_property("reviewer_case_diagnosis", "label", __("Reviewer Case Diagnosis"));
	} else if (value === "Education") {
		frm.set_df_property("hospital_institution_name", "label", __("Institution Name"));
		frm.set_df_property("hospital_institution_location", "label", __("Institution Location"));
		frm.set_df_property("ailment__course_details", "label", __("Course Details"));
		frm.set_df_property("treatment", "hidden", 1);
		frm.set_df_property("treatment", "reqd", 0);
		if (frm.doc.treatment) frm.set_value("treatment", "");
		frm.set_df_property("reviewer_case_diagnosis", "label", __("Reviewer Course Details"));
	} else {
		frm.set_df_property("hospital_institution_name", "label", __("Hospital / Institution Name"));
		frm.set_df_property("hospital_institution_location", "label", __("Hospital / Institution Location"));
		frm.set_df_property("ailment__course_details", "label", __("Ailment / Course Details"));
		frm.set_df_property("treatment", "hidden", 0);
		frm.set_df_property("treatment", "reqd", 0);
		frm.set_df_property("reviewer_case_diagnosis", "label", __("Reviewer Case Diagnosis / Course Details"));
	}
	[
		"hospital_institution_name",
		"hospital_institution_location",
		"ailment__course_details",
		"treatment",
		"reviewer_case_diagnosis",
	].forEach(function (fieldname) {
		frm.refresh_field(fieldname);
	});
}

function mark_mandatory_document_rows(frm) {
	var grid = frm.fields_dict.supporting_documents && frm.fields_dict.supporting_documents.grid;
	if (!grid || !grid.grid_rows) return;
	grid.grid_rows.forEach(function (grid_row) {
		var row = grid_row.doc;
		var $row_el = grid_row.row;
		if (!$row_el) return;
		$row_el.removeClass("sd-mandatory-row");
		$row_el.find(".row-index").removeAttr("title").css("font-weight", "");
		if (row && row.is_mandatory) {
			$row_el.addClass("sd-mandatory-row");
			$row_el.find(".row-index").attr("title", __("This document is required")).css("font-weight", "700");
		}
	});
}

function setup_supporting_document_preview(frm) {
	var grid = frm.fields_dict.supporting_documents && frm.fields_dict.supporting_documents.grid;
	if (!grid || !grid.wrapper || grid.wrapper.data("siid-preview-bound")) return;
	grid.wrapper.data("siid-preview-bound", true);

	function open_preview_for_row($el) {
		var url = $el.attr("href");
		if (!url) return;
		var $row_el = $el.closest(".grid-row");
		var row_name = $row_el.attr("data-name");
		var row = (frm.doc.supporting_documents || []).find(function (r) {
			return r.name === row_name;
		});
		case_register_open_document_preview(url, (row && row.document_name) || "Document");
	}

	grid.wrapper.on("click", ".attached-file-link", function (e) {
		e.preventDefault();
		open_preview_for_row($(this));
	});

	grid.wrapper.on("click", '.grid-static-col[data-fieldname="attachment"] .static-area a', function (e) {
		e.preventDefault();
		e.stopPropagation();
		open_preview_for_row($(this));
	});
}

function case_register_open_document_preview(url, name) {
	var ext = (url.split("?")[0].split(".").pop() || "").toLowerCase();
	var body;
	var needs_office_render = false;

	if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].indexOf(ext) > -1) {
		body =
			'<div style="text-align:center"><img src="' +
			url +
			'" style="max-width:100%;max-height:65vh;border-radius:8px;background:#fff"></div>';
	} else if (ext === "pdf") {
		body =
			'<iframe src="' +
			url +
			'" style="width:100%;height:65vh;border:none;border-radius:8px;background:#fff"></iframe>';
	} else if (["mp4", "webm", "ogg", "mov"].indexOf(ext) > -1) {
		body = '<video src="' + url + '" controls style="width:100%;max-height:65vh;border-radius:8px"></video>';
	} else if (["mp3", "wav"].indexOf(ext) > -1) {
		body = '<div style="padding:30px 10px"><audio src="' + url + '" controls style="width:100%"></audio></div>';
	} else if (["txt", "json", "log"].indexOf(ext) > -1) {
		body =
			'<iframe src="' +
			url +
			'" style="width:100%;height:65vh;border:none;border-radius:8px;background:#fff"></iframe>';
	} else if (window.SIIDOfficePreview && window.SIIDOfficePreview.isSupported(ext)) {
		needs_office_render = true;
		body =
			'<div class="text-center text-muted" style="padding:50px 20px" id="cr-doc-convert-status">' +
			'<div style="font-size:14px">' +
			__("Preparing preview…") +
			"</div></div>";
	} else if (window.SIIDOfficePreview && window.SIIDOfficePreview.isUnsupportedOffice(ext)) {
		body =
			'<div class="text-center text-muted" style="padding:50px 20px">' +
			'<div style="font-size:14px;margin-bottom:14px">' +
			__("In-browser preview isn't available for .{0} files. Please download to view.", [
				frappe.utils.escape_html(ext),
			]) +
			"</div>" +
			'<a href="' +
			url +
			'" target="_blank" class="cr-modal-btn-primary" style="display:inline-block;padding:8px 18px;' +
			'font-size:13px;font-weight:600;border:none;background:#2490ef;color:#fff;border-radius:8px;' +
			'text-decoration:none;">' +
			__("Open / Download") +
			"</a></div>";
	} else {
		body =
			'<div class="text-center text-muted" style="padding:50px 20px">' +
			'<div style="font-size:14px;margin-bottom:14px">' +
			__("Preview isn't available for this file type{0}.", [ext ? " (." + frappe.utils.escape_html(ext) + ")" : ""]) +
			"</div>" +
			'<a href="' +
			url +
			'" target="_blank" class="cr-modal-btn-primary" style="display:inline-block;padding:8px 18px;' +
			'font-size:13px;font-weight:600;border:none;background:#2490ef;color:#fff;border-radius:8px;' +
			'text-decoration:none;">' +
			__("Open / Download") +
			"</a></div>";
	}

	var overlay = document.createElement("div");
	overlay.style.cssText =
		"position:fixed;inset:0;z-index:100000;background:rgba(20,26,32,.45);" +
		"backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;" +
		"padding:20px;animation:caseRegisterFadeIn .15s ease-out;";
	overlay.innerHTML =
		'<div style="background:#fff;border-radius:16px;width:100%;max-width:920px;' +
		'max-height:90vh;display:flex;flex-direction:column;' +
		'box-shadow:0 16px 48px rgba(20,26,32,.24);animation:caseRegisterModalIn .18s cubic-bezier(.2,.8,.3,1);' +
		'overflow:hidden;">' +
		'<div style="padding:18px 22px;display:flex;align-items:center;justify-content:space-between;' +
		'border-bottom:1px solid #eceef0;flex-shrink:0;">' +
		'<div style="font-size:15px;font-weight:600;color:#1a2229;overflow:hidden;text-overflow:ellipsis;' +
		'white-space:nowrap;padding-right:12px;">' +
		frappe.utils.escape_html(name || __("Document")) +
		"</div>" +
		'<button class="cr-doc-preview-close" style="background:none;border:none;font-size:19px;color:#9aa4ad;' +
		'cursor:pointer;line-height:1;padding:5px;border-radius:7px;flex-shrink:0;">✕</button>' +
		"</div>" +
		'<div style="padding:20px 22px;overflow:auto;flex:1;">' +
		body +
		"</div>" +
		'<div style="padding:14px 22px;border-top:1px solid #eceef0;display:flex;justify-content:flex-end;' +
		'gap:10px;flex-shrink:0;">' +
		'<a href="' +
		url +
		'" target="_blank" style="padding:8px 16px;font-size:13px;font-weight:500;border:1.5px solid #dde3e8;' +
		'background:#fff;color:#4a5560;border-radius:8px;text-decoration:none;">' +
		__("Open in New Tab") +
		"</a>" +
		"</div>" +
		"</div>";

	document.body.appendChild(overlay);

	function close_preview() {
		overlay.remove();
		document.removeEventListener("keydown", on_preview_key);
	}
	function on_preview_key(e) {
		if (e.key === "Escape") close_preview();
	}
	document.addEventListener("keydown", on_preview_key);
	overlay.addEventListener("mousedown", function (e) {
		if (e.target === overlay) close_preview();
	});
	overlay.querySelector(".cr-doc-preview-close").addEventListener("click", close_preview);

	if (needs_office_render) {
		var $status = $(overlay).find("#cr-doc-convert-status");
		window.SIIDOfficePreview.render($status.parent(), url, ext).catch(function (err) {
			$status.html(
				'<div style="font-size:14px;margin-bottom:14px">' +
					frappe.utils.escape_html((err && err.message) || __("Could not render a preview for this file.")) +
					"</div>" +
					'<a href="' +
					url +
					'" target="_blank" style="display:inline-block;padding:8px 16px;font-size:13px;font-weight:500;' +
					'border:1.5px solid #dde3e8;background:#fff;color:#4a5560;border-radius:8px;text-decoration:none;">' +
					__("Open / Download") +
					"</a>"
			);
		});
	}
}

function _case_register_patch_attachment_df(df) {
	if (df) df.options = { make_attachments_public: 0, allow_toggle_private: false };
}

function force_private_attachments(frm) {
	var grid = frm.fields_dict.supporting_documents && frm.fields_dict.supporting_documents.grid;
	if (grid) {
		if (grid.docfields) {
			_case_register_patch_attachment_df(
				grid.docfields.find(function (df) {
					return df.fieldname === "attachment";
				})
			);
		}
		(grid.grid_rows || []).forEach(function (grid_row) {
			if (grid_row.docfields) {
				_case_register_patch_attachment_df(
					grid_row.docfields.find(function (df) {
						return df.fieldname === "attachment";
					})
				);
			}
			var field = grid_row.on_grid_fields_dict && grid_row.on_grid_fields_dict.attachment;
			if (field) _case_register_patch_attachment_df(field.df);
		});
	}

	var case_document_field = frm.get_field("case_document");
	if (case_document_field) _case_register_patch_attachment_df(case_document_field.df);
}

const _CASE_REGISTER_EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const _CASE_REGISTER_MOBILE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
const _CASE_REGISTER_CURRENCY_RE = /^\d*\.?\d*$/;
const _CASE_REGISTER_PINCODE_RE = /^\d{6}$/;
const _CASE_REGISTER_OFFICIAL_DOMAIN = "azimpremjifoundation.org";
const _CASE_REGISTER_NAME_RE = /^[A-Za-z .'-]+$/;
const _CASE_REGISTER_NAME_FIELDS = ["beneficiary_name", "requestor_name", "primary_contact_person"];

var _case_register_enforce_email_domain = true;
frappe.call({
	method:
		"support_iid.case_management.web_form.support_iid_case_registration.support_iid_case_registration.get_email_domain_validation_setting",
	callback: function (r) {
		if (r.message && typeof r.message.enforce === "boolean") {
			_case_register_enforce_email_domain = r.message.enforce;
		}
	},
});

function case_register_field_error(frm, fieldname, message) {
	var field = frm.get_field(fieldname);
	if (!field || !field.$wrapper) return;
	var wrapper = field.$wrapper;
	wrapper.find(".field-error-msg").remove();
	wrapper.find("input, select, textarea").css({ "border-color": "#e74c3c" });
	wrapper.append(
		$(
			'<div class="field-error-msg" style="' +
				"display:flex;align-items:center;gap:5px;" +
				'margin-top:4px;font-size:12px;color:#c0392b;">' +
				'<span style="width:6px;height:6px;border-radius:50%;' +
				'background:#e74c3c;flex-shrink:0;display:inline-block;"></span>' +
				"<span>" +
				frappe.utils.escape_html(message) +
				"</span>" +
				"</div>"
		)
	);
}

function case_register_clear_field_error(frm, fieldname) {
	var field = frm.get_field(fieldname);
	if (!field || !field.$wrapper) return;
	var wrapper = field.$wrapper;
	wrapper.find(".field-error-msg").remove();
	wrapper.find("input, select, textarea").css({ "border-color": "" });
}

function case_register_validate_email(frm, fieldname) {
	var value = (frm.doc[fieldname] || "").trim();
	if (!value) {
		case_register_clear_field_error(frm, fieldname);
		return true;
	}
	if (!_CASE_REGISTER_EMAIL_SHAPE_RE.test(value)) {
		case_register_field_error(frm, fieldname, __("Please enter a valid email address."));
		return false;
	}
	if (fieldname === "requestor_email" && _case_register_enforce_email_domain) {
		var domain = (value.split("@")[1] || "").toLowerCase();
		if (domain !== _CASE_REGISTER_OFFICIAL_DOMAIN) {
			case_register_field_error(
				frm,
				fieldname,
				__("This is not a member email. Please use your @azimpremjifoundation.org address.")
			);
			return false;
		}
	}
	case_register_clear_field_error(frm, fieldname);
	return true;
}

function case_register_validate_mobile(frm, fieldname) {
	var value = String(frm.doc[fieldname] || "").trim();
	if (!value || _CASE_REGISTER_MOBILE_RE.test(value)) {
		case_register_clear_field_error(frm, fieldname);
		return true;
	}
	case_register_field_error(frm, fieldname, __("Please enter a valid 10-digit mobile number."));
	return false;
}

function case_register_validate_currency(frm, fieldname) {
	var value = frm.doc[fieldname];
	if (value === null || value === undefined || value === "" || typeof value !== "string") {
		case_register_clear_field_error(frm, fieldname);
		return true;
	}
	if (_CASE_REGISTER_CURRENCY_RE.test(value.replace(/,/g, "").trim())) {
		case_register_clear_field_error(frm, fieldname);
		return true;
	}
	case_register_field_error(frm, fieldname, __("Please enter numbers only."));
	return false;
}

function case_register_validate_name(frm, fieldname) {
	var value = String(frm.doc[fieldname] || "").trim();
	if (!value || _CASE_REGISTER_NAME_RE.test(value)) {
		case_register_clear_field_error(frm, fieldname);
		return true;
	}
	case_register_field_error(
		frm,
		fieldname,
		__("Only letters and the usual name punctuation are allowed (no numbers).")
	);
	return false;
}

function case_register_validate_pincode(frm) {
	var pin = String(frm.doc.pincode || "").trim();
	if (!pin || _CASE_REGISTER_PINCODE_RE.test(pin)) {
		case_register_clear_field_error(frm, "pincode");
		return true;
	}
	case_register_field_error(frm, "pincode", __("Please enter a valid 6-digit pincode."));
	return false;
}

function case_register_validate_dob(frm) {
	if (!frm.doc.date_of_birth) {
		case_register_clear_field_error(frm, "date_of_birth");
		return true;
	}
	if (frappe.datetime.get_diff(frm.doc.date_of_birth, frappe.datetime.get_today()) > 0) {
		case_register_field_error(frm, "date_of_birth", __("Date of Birth cannot be in the future."));
		return false;
	}
	case_register_clear_field_error(frm, "date_of_birth");
	return true;
}

function apply_requester_post_submit_view(frm) {
	var roles = frappe.user_roles || [];
	var is_requester_only =
		roles.includes("Support IID Requester") &&
		!roles.includes("System Manager") &&
		!roles.includes("Support IID Reviewer") &&
		!roles.includes("Support IID Approver");

	if (!is_requester_only || frm.doc.case_status === "Draft" || frm.is_new()) return;

	if (frm.doc.case_status === "Sent Back") {
		frm.page.set_primary_action(__("Resubmit Case"), () => resubmit_case_dialog(frm));
		return;
	}

	frm.disable_save();
	frm.disable_form();

	if (frm.doc.case_status === "Pending Approval" || frm.doc.case_status === "Final Verification") {
		frm.page.set_primary_action(__("Withdraw Case"), () => withdraw_case_from_desk_dialog(frm));
	}
}

function resubmit_case_dialog(frm) {
	case_register_open_modal({
		title: __("Resubmit Case"),
		message: __("Resubmit this case to the approver? Save any edits first if you haven't already."),
		fields: [
			{
				fieldname: "comments",
				type: "text",
				label: __("What did you change? (sent to the approver)"),
				reqd: 1,
			},
			{
				fieldname: "declaration",
				type: "check",
				label: __("I confirm the details on this case are correct and ready to resubmit."),
				reqd: 1,
			},
		],
		primary_label: __("Resubmit"),
		on_submit: function (values, close) {
			var do_resubmit = function () {
				case_register_call_with_loader({
					method: "support_iid.support_iid.doctype.case_register.case_register.resubmit_case_from_desk",
					args: { case_name: frm.doc.name, comments: values.comments },
					freeze_message: __("Resubmitting..."),
					callback: function () {
						close();
						frm.reload_doc();
					},
				});
			};
			if (frm.is_dirty()) {
				frm.save().then(do_resubmit);
			} else {
				do_resubmit();
			}
		},
	});
}

function apply_approver_read_only_view(frm) {
	var roles = frappe.user_roles || [];
	var is_approver_only =
		roles.includes("Support IID Approver") &&
		!roles.includes("System Manager") &&
		!roles.includes("Support IID Reviewer") &&
		!roles.includes("Support IID Requester");

	if (!is_approver_only || frm.is_new()) return;

	frm.disable_form();
}

function withdraw_case_from_desk_dialog(frm) {
	case_register_open_modal({
		title: __("Withdraw Case"),
		message: __("This cannot be undone — you'll need to submit a new request if you change your mind."),
		fields: [
			{ fieldname: "reason", type: "text", label: __("Reason for withdrawing"), reqd: 1 },
			{ fieldname: "declaration", type: "check", label: __("I confirm I want to withdraw this case."), reqd: 1 },
		],
		primary_label: __("Withdraw"),
		on_submit: function (values, close) {
			case_register_call_with_loader({
				method: "support_iid.support_iid.doctype.case_register.case_register.withdraw_case_from_desk",
				args: { case_name: frm.doc.name, reason: values.reason },
				freeze_message: __("Withdrawing..."),
				callback: function () {
					close();
					frm.reload_doc();
				},
			});
		},
	});
}

function case_register_resync_if_session_stale(frm, then) {
	frappe.call({
		method: "frappe.auth.get_logged_user",
		callback: function (r) {
			var live_user = r.message;
			if (live_user && live_user !== frappe.session.user) {
				frappe.session.user = live_user;
				frappe.boot.user.name = live_user;
				frm.reload_doc();
				return;
			}
			then();
		},
	});
}

function case_register_resync_stale_roles(frm) {
	if (frm.is_new()) return;
	if (frappe.session.user === "Administrator") return;

	frappe.call({
		method: "support_iid.support_iid.doctype.case_register.case_register.get_current_user_roles",
		callback: function (r) {
			var live_roles = r.message;
			if (!Array.isArray(live_roles)) return;
			var cached_roles = frappe.user_roles || [];
			var changed =
				live_roles.length !== cached_roles.length ||
				live_roles.some(function (role) {
					return cached_roles.indexOf(role) === -1;
				});
			if (!changed) return;

			frappe.user_roles = live_roles;
			frappe.boot.user.roles = live_roles;
			if (frappe.perm && frappe.perm.doctype_perm) {
				delete frappe.perm.doctype_perm[frm.doctype];
			}
			frm.reload_doc();
		},
	});
}

function apply_approver_action_button(frm) {
	if (frm.is_new() || frm.doc.case_status !== "Pending Approval") return;

	var stages = frm.doc.case_approval_stage || [];
	var current_stage = null;
	for (var i = 0; i < stages.length; i++) {
		var status = (stages[i].case_approval_status || "").trim();
		if (status === "" || status === "Awaiting For Approval") {
			current_stage = stages[i];
			break;
		}
	}
	if (!current_stage) return;

	var roles = frappe.user_roles || [];
	var user = frappe.session.user;
	var approver_email = (current_stage.approver_email || "").trim().toLowerCase();
	var can_act =
		user === "Administrator" ||
		roles.includes("System Manager") ||
		(approver_email && user.toLowerCase() === approver_email);
	if (!can_act) return;

	frm.page.set_primary_action(__("Take Action"), () =>
		case_register_resync_if_session_stale(frm, () => take_action_dialog(frm, current_stage))
	);
}

function take_action_dialog(frm, current_stage) {
	var level_label = current_stage.case_approval_level_decription || __("this stage");
	var dialog = new frappe.ui.Dialog({
		title: __("Take Action — {0}", [level_label]),
		fields: [
			{
				fieldname: "action",
				fieldtype: "Select",
				label: __("Action"),
				options: ["Approve", "Send Back", "Decline"],
				default: "Approve",
				reqd: 1,
			},
			{ fieldname: "comments", fieldtype: "Small Text", label: __("Comments") },
		],
		primary_action_label: __("Submit"),
		primary_action: function (values) {
			case_register_call_with_loader({
				method: "support_iid.support_iid.doctype.case_register.case_register.process_case_approval",
				args: { case_name: frm.doc.name, action: values.action, comments: values.comments },
				freeze_message: __("Processing..."),
				callback: function () {
					dialog.hide();
					frm.reload_doc();
				},
			});
		},
	});
	dialog.show();
}

function apply_reviewer_final_approval_button(frm) {
	if (frm.is_new()) return;
	if (frm.doc.case_status !== "Final Verification") return;

	var roles = frappe.user_roles || [];
	var can_act =
		frappe.session.user === "Administrator" ||
		roles.includes("System Manager") ||
		roles.includes("Support IID Reviewer");
	if (!can_act) return;

	frm.page.set_primary_action(__("Final Verification"), () =>
		case_register_resync_if_session_stale(frm, () => reviewer_final_approval_dialog(frm))
	);
}

function apply_case_status_indicator(frm) {
	if (frm.is_new()) return;
	if (frm.doc.case_status === "Final Verification") {
		frm.page.set_indicator(__("Pending with Reviewer"), "orange");
	}
}

function reviewer_final_approval_dialog(frm) {
	var dialog = new frappe.ui.Dialog({
		title: __("Final Verification"),
		fields: [
			{
				fieldname: "action",
				fieldtype: "Select",
				label: __("Action"),
				options: ["Approve", "Send Back"],
				default: "Approve",
				reqd: 1,
			},
			{ fieldname: "comments", fieldtype: "Small Text", label: __("Comments") },
		],
		primary_action_label: __("Submit"),
		primary_action: function (values) {
			case_register_call_with_loader({
				method: "support_iid.support_iid.doctype.case_register.case_register.reviewer_final_approval",
				args: { case_name: frm.doc.name, action: values.action, comments: values.comments },
				freeze_message: __("Processing..."),
				callback: function () {
					dialog.hide();
					frm.reload_doc();
				},
			});
		},
	});
	dialog.show();
}

function submit_draft_case(frm) {
	case_register_branded_confirm(
		__("Submit this case? It will move to Pending Approval and the approver/requestor emails will be sent."),
		__("I confirm the information in this case is accurate to the best of my knowledge."),
		function () {
			var do_submit = function () {
				case_register_call_with_loader({
					method: "support_iid.support_iid.doctype.case_register.case_register.submit_case",
					args: { case_name: frm.doc.name },
					freeze_message: __("Submitting..."),
					callback: function () {
						var case_name = frm.doc.name;
						frm.reload_doc().then(function () {
							case_register_show_submission_success(case_name);
						});
					},
				});
			};
			if (frm.is_dirty()) {
				frm.save().then(do_submit);
			} else {
				do_submit();
			}
		}
	);
}

function case_register_show_submission_success(case_name) {
	var overlay = document.createElement("div");
	overlay.style.cssText =
		"position:fixed;inset:0;z-index:100000;background:rgba(20,26,32,.45);" +
		"backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;" +
		"padding:20px;animation:caseRegisterFadeIn .15s ease-out;";

	overlay.innerHTML =
		'<div style="background:#fff;border-radius:16px;width:100%;max-width:460px;text-align:center;' +
		'box-shadow:0 16px 48px rgba(20,26,32,.24);animation:caseRegisterModalIn .18s cubic-bezier(.2,.8,.3,1);' +
		'overflow:hidden;padding:36px 32px 30px;">' +
		'<div style="width:56px;height:56px;border-radius:50%;background:#e6f4ea;color:#1e8e3e;' +
		'display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:28px;">✓</div>' +
		'<div style="font-size:19px;font-weight:600;color:#1a2229;margin-bottom:8px;">' +
		__("Case submitted") +
		"</div>" +
		'<div style="font-size:14.5px;color:#5c6773;line-height:1.55;margin-bottom:4px;">' +
		__("Your request has been recorded as") +
		"</div>" +
		'<div style="font-size:16px;font-weight:600;color:#2490ef;margin-bottom:16px;">' +
		frappe.utils.escape_html(case_name) +
		"</div>" +
		'<div style="font-size:14px;color:#5c6773;line-height:1.55;margin-bottom:26px;">' +
		__(
			"It's now with the first-level approver. You'll get an email update as it moves through review — no need to submit this again."
		) +
		"</div>" +
		'<button class="cr-submit-success-done" style="width:100%;padding:11px 0;font-size:14.5px;font-weight:600;' +
		"border:none;background:#2490ef;color:#fff;border-radius:9px;cursor:pointer;\">" +
		__("Done") +
		"</button>" +
		"</div>";

	document.body.appendChild(overlay);

	function close() {
		overlay.remove();
		document.removeEventListener("keydown", on_key);
	}
	function on_key(e) {
		if (e.key === "Escape") close();
	}
	document.addEventListener("keydown", on_key);
	overlay.addEventListener("mousedown", function (e) {
		if (e.target === overlay) close();
	});
	overlay.querySelector(".cr-submit-success-done").addEventListener("click", close);
}

// The AES key itself is fetched from the server (get_response_encryption_key,
// derived there from this site's own real secret) instead of being a fixed
// literal baked into this file — see that function's docstring in
// case_register.py for why a literal here would be the exact same value
// shipped in every installation of this open app. Fetched once per page
// load and cached (case_register_crypto_key_promise).
var case_register_crypto_key_promise = null;

function case_register_base64_to_bytes(b64) {
	var binary = atob(b64);
	var bytes = new Uint8Array(binary.length);
	for (var i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function case_register_get_crypto_key() {
	if (!case_register_crypto_key_promise) {
		case_register_crypto_key_promise = new Promise(function (resolve, reject) {
			frappe.call({
				method: "support_iid.support_iid.doctype.case_register.case_register.get_response_encryption_key",
				callback: function (r) {
					if (!r.message) {
						reject(new Error("Could not fetch decryption key."));
						return;
					}
					crypto.subtle
						.importKey("raw", case_register_base64_to_bytes(r.message), { name: "AES-GCM" }, false, ["decrypt"])
						.then(resolve, reject);
				},
				error: function () {
					reject(new Error("Could not fetch decryption key."));
				},
			});
		});
	}
	return case_register_crypto_key_promise;
}

function case_register_decrypt_payload(payload) {
	if (!payload || !payload.encrypted) {
		return Promise.resolve(payload);
	}
	return case_register_get_crypto_key()
		.then(function (key) {
			return crypto.subtle.decrypt(
				{ name: "AES-GCM", iv: case_register_base64_to_bytes(payload.iv) },
				key,
				case_register_base64_to_bytes(payload.data)
			);
		})
		.then(function (decrypted) {
			return JSON.parse(new TextDecoder().decode(decrypted));
		});
}

function case_register_strip_country_code(mobile) {
	if (!mobile) return "";
	var cleaned = String(mobile).replace(/[\s\-()]/g, "");
	cleaned = cleaned.replace(/^(\+91|0091|91)/, "");
	return cleaned.slice(-10);
}

function fetch_requestor_details(frm, email) {
	var funds = frm.doc.funds_requested || 0;
	var call_key = email + "|" + funds;
	if (frm._last_graph_fetch_key === call_key) return;
	frm._last_graph_fetch_key = call_key;

	case_register_call_with_loader({
		method: "support_iid.api.microsoft_graph.get_employee_details",
		args: { email: email, funds_requested: funds },
		freeze_message: __("Fetching employee details..."),
		error: function (err) {
			console.error("Employee lookup failed:", err);
		},
		callback: function (r) {
			var payload = r.message;
			if (!payload || !payload.encrypted) return;
			case_register_decrypt_payload(payload)
				.then(function (data) {
					if (!data.exists) {
						if (data.transient_error) {
							frappe.show_alert(
								{
									message: __(
										"Could not fetch your details from the directory right now. Please fill the fields below manually, or retry by re-entering your email."
									),
									indicator: "orange",
								},
								7
							);
						}
						return;
					}
					var emp = data.employee;

					if (emp.name) frm.set_value("requestor_name", emp.name);
					if (emp.mobile) {
						frm.set_value("requestor_mobile_number", case_register_strip_country_code(emp.mobile));
					}
					if (emp.department) frm.set_value("department", emp.department);
					if (emp.office_location) frm.set_value("work_location", emp.office_location);

					fill_approval_stages(frm, data.approval_stages || []);
				})
				.catch(function (e) {
					console.error("Decryption failed:", e);
				});
		},
	});
}

function fill_approval_stages(frm, stages) {
	if (!stages || !stages.length) return;
	frm.clear_table("case_approval_stage");
	stages.forEach(function (s) {
		var row = frm.add_child("case_approval_stage");
		row.case_approval_level = s.case_approval_level || "";
		row.case_approval_level_decription = s.case_approval_level_decription || "";
		row.case_approval_status = s.case_approval_status || "";
		row.approver_name = s.approver_name || "";
		row.approver_email = s.approver_email || "";
	});
	frm.refresh_field("case_approval_stage");
	frm.dirty();
	if (!frm.is_new()) {
		frm.save();
	}
}

function load_documents_for(frm, request_type) {
	frappe.call({
		method:
			"support_iid.case_management.web_form.support_iid_case_registration.support_iid_case_registration.get_document_types",
		args: { type_of_request: request_type },
		callback: function (r) {
			if (!r.message) return;
			frm.clear_table("supporting_documents");
			r.message.forEach(function (doc) {
				var row = frm.add_child("supporting_documents");
				row.document_name = doc.name;
				row.is_mandatory = doc.is_mandatory ? 1 : 0;
			});
			frm.refresh_field("supporting_documents");
			mark_mandatory_document_rows(frm);
			force_private_attachments(frm);
		},
	});
}

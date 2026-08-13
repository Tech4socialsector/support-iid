// Copyright (c) 2026, Tech For Social Sector and contributors
// For license information, please see license.txt

// Same mandatory-document row styling support_iid_case_registration.js
// (the guest web form) injects — a subtle left border + background tint,
// not text in the Document Name cell (which wraps and breaks alignment).
$(
	"<style>" +
		".sd-mandatory-row { border-left:3px solid #c0392b; background:#fdf3f2; }" +
		".sd-mandatory-row .row-index { cursor:help; }" +
		"</style>"
).appendTo("head");

// ── Branded loader ────────────────────────────────────────────────────────
// Same look as the guest web form's own showLoader/hideLoader (a spinning
// ring around the APF logo) instead of Frappe's plain freeze overlay —
// used in place of every frappe.call({freeze: true, freeze_message}) on
// this form so Graph lookups/Submit/Take Action/Withdraw all show the
// same branded loading state a Requester/Approver already sees on the
// public web forms.
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

// Wraps a frappe.call config: replaces its freeze/freeze_message with the
// branded loader, shown before the call and hidden via `always` (which
// frappe.call fires exactly once regardless of success/error), so
// callers don't have to remember to hide it themselves.
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

// ── Branded confirmation dialog ──────────────────────────────────────────
// Used in place of frappe.confirm for the app's own significant, one-way
// actions (Submit, Resubmit) — carries the APF logo instead of Frappe's
// bare Yes/No prompt, and requires an explicit declaration checkbox
// (unticked by default) before the action can actually be confirmed,
// rather than a single click on "Yes" being enough on its own.
function case_register_branded_confirm(message, declaration_label, on_confirm) {
	var dialog = new frappe.ui.Dialog({
		title: "",
		centered: true,
		fields: [
			{
				fieldname: "case_register_confirm_message",
				fieldtype: "HTML",
				options:
					'<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">' +
					'<img src="/assets/support_iid/images/apf_logo.png" style="width:40px;height:40px;object-fit:contain;flex-shrink:0;">' +
					'<div style="font-size:14px;color:#36414c;line-height:1.5;">' +
					frappe.utils.escape_html(message) +
					"</div>" +
					"</div>",
			},
			{
				fieldname: "declaration",
				fieldtype: "Check",
				label: declaration_label,
				reqd: 1,
			},
		],
		primary_action_label: __("Confirm"),
		primary_action: function (values) {
			if (!values.declaration) {
				frappe.show_alert({ message: __("Please confirm the declaration to proceed."), indicator: "orange" });
				return;
			}
			dialog.hide();
			on_confirm();
		},
	});
	dialog.show();
}

frappe.ui.form.on("Case Register", {
	onload(frm) {
		// Auto-fill on a brand-new case only — an existing case already has
		// its own requestor_email (possibly different from whoever happens
		// to be viewing/reassigning it in the Desk), so this must never
		// overwrite real data on an already-submitted or already-saved doc.
		if (!frm.is_new()) return;
		if (frm.doc.requestor_email) return;
		// frappe.session.user is the literal string "Administrator" or
		// "Guest" for those accounts, not a real email — get_employee_details
		// would just throw trying to look either up as an org email.
		if (["Administrator", "Guest"].includes(frappe.session.user)) return;

		frm.set_value("requestor_email", frappe.session.user);
		fetch_requestor_details(frm, frappe.session.user);
	},

	// Covers the manual-entry case (e.g. an Administrator/System Manager
	// filing a case on a requester's behalf, or the onload auto-fill being
	// skipped for Administrator/Guest) — same lookup the onload auto-fill
	// triggers, just fired off whenever the field itself actually changes,
	// exactly like the guest web form's debouncedEmailHandler does for its
	// own requestor_email field.
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

	// Mirrors applyInsuranceVisibility() in support_iid_case_registration.js
	// — Insurance Coverage Details is only relevant (and only mandatory)
	// once an actual insurance type is picked; with "No Insurance" or
	// nothing selected yet, there's nothing to describe.
	insurance_type(frm) {
		apply_insurance_visibility(frm, frm.doc.insurance_type);
	},

	// Mirrors applyVerificationVisibility() in support_iid_case_registration.js
	// — the notes field only makes sense once a physical visit actually
	// happened; clearing it on "No" avoids leaving stale notes behind a
	// hidden field that no longer applies.
	physical_verification(frm) {
		apply_verification_visibility(frm, frm.doc.physical_verification);
	},

	// Mirrors the "PINCODE -> STATE & DISTRICT AUTO-FILL" block in
	// support_iid_case_registration.js (the guest web form) — same public
	// India Post lookup, same behavior on an invalid/no-match pincode
	// (state/district cleared, error shown). state/district are read_only
	// on the doctype itself (case_register.json) since they're only ever
	// meant to be set by this lookup, never typed in directly.
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

	// The following mirror case_register.py's server-side validate()
	// checks (pincode format handled above, DOB-not-future, email
	// shape/domain, mobile format, currency numeric-only) so a bad value
	// shows inline under its own field the moment it's entered, instead
	// of only surfacing as a popup dialog from the server on Save.
	// validate() itself is left in place as the authoritative check (a
	// direct API call still can't bypass it) — these are a client-side
	// convenience layer on top, exactly like the guest web form has.
	date_of_birth(frm) {
		if (!frm.doc.date_of_birth) return;
		if (!case_register_validate_dob(frm)) return;
		// Mirrors the "DATE OF BIRTH -> AGE AUTO-CALCULATE" block in
		// support_iid_case_registration.js. age itself stays a normal,
		// editable field (not read_only) — this only sets a starting
		// value so staff aren't forced to work it out by hand, matching
		// what the web form already does for the requestor.
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

	// Debounced (mirrors the guest web form's debouncedFundsHandler) —
	// a Currency field fires this on every keystroke, and each call
	// re-runs the Microsoft Graph lookup (get_employee_details) to
	// rescale approval_stages to the new amount. Calling that on every
	// keystroke was hitting Graph's own rate limit almost immediately;
	// this only actually fires once typing pauses.
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
		// A brand-new case's own primary action still says "Save as
		// Draft" instead of Frappe's default "Save" label — case_status
		// really does default to Draft (see case_register.json), so this
		// just names what actually happens instead of leaving it
		// implicit.
		if (frm.is_new()) {
			apply_save_as_draft_label(frm);
		}

		mark_mandatory_document_rows(frm);
		force_private_attachments(frm);
		apply_request_type_labels(frm, frm.doc.type_of_request);
		apply_insurance_visibility(frm, frm.doc.insurance_type);
		apply_verification_visibility(frm, frm.doc.physical_verification);

		// case_approval_stage is read_only:1 on the doctype itself (a UI
		// property only — not a real permission, so this can't be used to
		// actually block a write server-side) so it's read-only for
		// everyone by default: Requester, Support IID Approver, and
		// anyone else. Reviewer and System Manager are the two roles that
		// legitimately drive this table directly, so their forms
		// override it back to editable here. It's deliberately NOT set
		// via permlevel (Frappe silently resets ANY permlevel>0 field —
		// Table fields included — back to empty for a role without write
		// access at that level on every save, which was actually wiping
		// every approval-stage row a Requester saved, and is why the
		// approver was never getting notified).
		var current_roles = frappe.user_roles || [];
		var can_edit_approval_stage =
			current_roles.includes("Reviewer") || current_roles.includes("System Manager");
		frm.set_df_property("case_approval_stage", "read_only", can_edit_approval_stage ? 0 : 1);
		frm.refresh_field("case_approval_stage");

		// A freshly-saved case sits in "Draft" (the field's own default —
		// see case_register.json) until someone explicitly submits it. Once
		// it's been saved at least once, swap the default Save button for a
		// single "Submit" primary action instead — Save stays hidden the
		// whole time it's Draft, since there's nothing meaningful to "save"
		// beyond what Submit itself already re-validates and persists.
		// (A brand-new, not-yet-saved doc keeps the normal Save button so it
		// can be saved into Draft in the first place.)
		apply_requester_post_submit_view(frm);
		apply_approver_read_only_view(frm);
		apply_approver_action_button(frm);

		if (frm.doc.case_status !== "Draft" || frm.is_new()) return;

		frm.disable_save();
		frm.page.set_primary_action(__("Submit"), () => submit_draft_case(frm));
	},

	// Re-runs every inline check above right before save (not just
	// mandatory documents — mirrors validateMandatoryDocuments() in
	// support_iid_case_registration.js) so a bad value that never
	// triggered its own field's change event — pre-filled by the Graph
	// API auto-fill, or pasted then saved without blurring — still gets
	// caught here instead of only by case_register.py's validate(),
	// which would otherwise surface it as a popup dialog instead of the
	// same inline field message these checks already show.
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

// Frappe's own Toolbar binds a "dirty" listener (add_update_button_on_dirty,
// frappe/public/js/frappe/form/toolbar.js) that reasserts its own default
// "Save" primary action on EVERY field change, not just once at page
// load — so setting the label once in refresh() got silently reverted
// the moment the user touched any field. jQuery runs same-event
// handlers in bind order, and the toolbar's own listener is already
// bound (in its constructor, which runs before this form's own scripts
// ever see a "refresh" trigger) by the time this binds — so binding here
// runs SECOND on every "dirty" event and wins, keeping the custom label
// in place through every keystroke instead of only the very first
// render.
function apply_save_as_draft_label(frm) {
	frm.page.set_primary_action(__("Save as Draft"), () => frm.save());
	// frm.wrapper is NOT a jQuery object (it's the raw Page wrapper
	// element) — frm.$wrapper is the pre-wrapped jQuery version Frappe
	// itself keeps alongside it (frm.$wrapper = $(frm.wrapper), see
	// frappe/public/js/frappe/form/form.js) and the same element
	// dirty() itself dispatches "dirty" on, so binding here has to go
	// through $wrapper too — calling .data()/.on() straight on
	// frm.wrapper would throw (no such method on a plain object),
	// silently breaking everything below this line every single render.
	if (frm.$wrapper.data("case-register-save-label-guard")) return;
	frm.$wrapper.data("case-register-save-label-guard", true);
	frm.$wrapper.on("dirty", function () {
		if (frm.is_new()) {
			frm.page.set_primary_action(__("Save as Draft"), () => frm.save());
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

// Mirrors applyRequestTypeLabels() in support_iid_case_registration.js —
// Hospital/Institution/Ailment relabel to match whether this is a
// Medical or Education request, and Treatment (only meaningful for a
// Medical request) shows/hides + becomes mandatory/optional accordingly.
function apply_request_type_labels(frm, value) {
	if (value === "Medical") {
		frm.set_df_property("hospital_institution_name", "label", __("Hospital Name"));
		frm.set_df_property("hospital_institution_location", "label", __("Hospital Location"));
		frm.set_df_property("ailment__course_details", "label", __("Ailment Details"));
		frm.set_df_property("treatment", "hidden", 0);
		frm.set_df_property("treatment", "reqd", 1);
	} else if (value === "Education") {
		frm.set_df_property("hospital_institution_name", "label", __("Institution Name"));
		frm.set_df_property("hospital_institution_location", "label", __("Institution Location"));
		frm.set_df_property("ailment__course_details", "label", __("Course Details"));
		frm.set_df_property("treatment", "hidden", 1);
		frm.set_df_property("treatment", "reqd", 0);
		if (frm.doc.treatment) frm.set_value("treatment", "");
	} else {
		frm.set_df_property("hospital_institution_name", "label", __("Hospital / Institution Name"));
		frm.set_df_property("hospital_institution_location", "label", __("Hospital / Institution Location"));
		frm.set_df_property("ailment__course_details", "label", __("Ailment / Course Details"));
		frm.set_df_property("treatment", "hidden", 0);
		frm.set_df_property("treatment", "reqd", 0);
	}
	["hospital_institution_name", "hospital_institution_location", "ailment__course_details", "treatment"].forEach(
		function (fieldname) {
			frm.refresh_field(fieldname);
		}
	);
}

// Mirrors markMandatoryDocumentRows() in support_iid_case_registration.js —
// a subtle left border + background tint on a supporting_documents grid
// row whose document is mandatory, since the grid has no built-in
// per-row conditional-mandatory styling for a plain Link column.
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

// Uploaded supporting documents can carry sensitive personal/medical
// information — every one of them should always be private, with no
// "make public" affordance offered to whoever's attaching it. The
// Attach control's set_upload_options() (frappe/public/js/frappe/form/
// controls/attach.js) does `Object.assign(options, this.df.options)`
// when this.df.options is set — but a Table field's rows each build
// their OWN separate copy of the child doctype's fields (GridRow.
// set_docfields() -> frappe.meta.get_docfields(), cached per ROW NAME
// in frappe.meta.docfield_copy, not shared with grid.docfields at all)
// — so mutating grid.docfields itself never reaches any row's actual
// rendered Attach control. Has to walk each existing row's own control
// (grid_row.on_grid_fields_dict) directly, plus the grid-level
// docfields template (for rows added afterward, whose set_docfields()
// copies from it) to cover new rows without re-running this per row.
function force_private_attachments(frm) {
	var attach_options = { make_attachments_public: 0, allow_toggle_private: false };

	var grid = frm.fields_dict.supporting_documents && frm.fields_dict.supporting_documents.grid;
	if (grid) {
		if (grid.docfields) {
			var template_df = grid.docfields.find(function (df) {
				return df.fieldname === "attachment";
			});
			if (template_df) template_df.options = attach_options;
		}
		(grid.grid_rows || []).forEach(function (grid_row) {
			var field = grid_row.on_grid_fields_dict && grid_row.on_grid_fields_dict.attachment;
			if (field && field.df) field.df.options = attach_options;
		});
	}

	// case_document (the auto-generated case-summary PDF) is already
	// forced private server-side (_generate_and_save_pdf) and is
	// permlevel-2 (Reviewer/System Manager only) — hides the same
	// toggle here too in case either of them ever manually re-attaches it.
	var case_document_field = frm.get_field("case_document");
	if (case_document_field) {
		case_document_field.df.options = attach_options;
	}
}

// ── Inline field-error display ───────────────────────────────────────────
// Same DOM pattern as fieldError/clearFieldError in
// support_iid_case_registration.js (the guest web form) — a small message
// appended under the field's own wrapper plus a red input border, instead
// of Frappe's default popup dialog for a frappe.throw from the server.
const _CASE_REGISTER_EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const _CASE_REGISTER_MOBILE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
const _CASE_REGISTER_CURRENCY_RE = /^\d*\.?\d*$/;
const _CASE_REGISTER_OFFICIAL_DOMAIN = "azimpremjifoundation.org";
// Letters, spaces, and the usual name punctuation — no digits. Mirrors
// _NAME_RE in case_register.py.
const _CASE_REGISTER_NAME_RE = /^[A-Za-z .'-]+$/;
const _CASE_REGISTER_NAME_FIELDS = ["beneficiary_name", "requestor_name", "primary_contact_person"];

// Support IID Settings.enforce_email_domain_validation — fetched once and
// cached; defaults to true (current behavior) until the real value comes
// back, matching the guest web form's own fetch-once-and-cache pattern.
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

// Every case_register_validate_* helper below returns true/false (valid
// or not) as well as showing/clearing the inline field message, so
// validate(frm) can call them all again right before save and block a
// bad value from ever reaching the server — where the same check exists
// again in case_register.py's validate(), but only as a frappe.throw
// popup. Without this, a value nobody re-triggered the field's own
// change event for (e.g. pre-filled by the Graph API auto-fill, or
// pasted then saved without blurring) would sail past every per-field
// handler above and only get caught by that popup.
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
	// Domain restriction (requestor_email only — never applies to
	// approver_email in the Case Approval Stage table), same as the
	// guest web form's debouncedEmailHandler.
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
	if (!pin || (pin.length === 6 && !isNaN(pin))) {
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

// Once a Requester's own case has left Draft, the whole form becomes a
// read-only record for them — there's no "edit and re-save" path once
// it's out for approval; the only thing they can still do is Withdraw
// it (see withdraw_case_from_desk) or, once an approver Sends it Back,
// use the emailed edit-and-resubmit link (a separate, token-based flow
// that doesn't go through this Desk form at all). Reviewer, System
// Manager, and Support IID Approver all keep normal edit access — this
// only locks the form down for someone whose ONLY relevant role is
// Requester.
function apply_requester_post_submit_view(frm) {
	var roles = frappe.user_roles || [];
	var is_requester_only =
		roles.includes("Requester") &&
		!roles.includes("System Manager") &&
		!roles.includes("Reviewer") &&
		!roles.includes("Support IID Approver");

	if (!is_requester_only || frm.doc.case_status === "Draft" || frm.is_new()) return;

	// Sent Back is the one non-Draft status a Requester can still EDIT —
	// that's the whole point of being sent back: fix something and
	// resubmit, straight from this form (a Desk record link now, not a
	// separate token+OTP web form — see _send_requestor_notification_email).
	// Mirrors the Draft flow exactly: the normal Save button stays
	// available for saving edits-in-progress, and "Resubmit Case" is
	// the Submit-equivalent primary action. Withdraw is deliberately
	// NOT offered here — while actively revising, the only forward
	// action is to fix and resubmit; withdrawing becomes available
	// again once the case is back to Pending Approval, below.
	if (frm.doc.case_status === "Sent Back") {
		frm.page.set_primary_action(__("Resubmit Case"), () => resubmit_case_dialog(frm));
		return;
	}

	frm.disable_save();
	frm.disable_form();

	if (frm.doc.case_status === "Pending Approval") {
		frm.page.set_primary_action(__("Withdraw Case"), () => withdraw_case_from_desk_dialog(frm));
	}
}

function resubmit_case_dialog(frm) {
	case_register_branded_confirm(
		__("Resubmit this case to the approver? Save any edits first if you haven't already."),
		__("I confirm the details on this case are correct and ready to resubmit."),
		function () {
			var do_resubmit = function () {
				case_register_call_with_loader({
					method: "support_iid.support_iid.doctype.case_register.case_register.resubmit_case_from_desk",
					args: { case_name: frm.doc.name },
					freeze_message: __("Resubmitting..."),
					callback: function () {
						frm.reload_doc();
					},
				});
			};
			if (frm.is_dirty()) {
				frm.save().then(do_resubmit);
			} else {
				do_resubmit();
			}
		}
	);
}

// An Approver (Support IID Approver, and no broader role) never edits a
// case directly — they only ever act on it via the Take Action dialog
// (Approve/Send Back/Decline + comment), which calls process_case_approval
// straight away rather than going through a form save. So the whole form
// is locked read-only for them, on every case they can see (current
// stage or one they already acted on — see get_permission_query_conditions/
// has_permission), regardless of case_status. disable_form() only
// affects field editability + the Save button, not frappe.call, so Take
// Action itself keeps working normally on a fully read-only form.
function apply_approver_read_only_view(frm) {
	var roles = frappe.user_roles || [];
	var is_approver_only =
		roles.includes("Support IID Approver") &&
		!roles.includes("System Manager") &&
		!roles.includes("Reviewer") &&
		!roles.includes("Requester");

	if (!is_approver_only || frm.is_new()) return;

	frm.disable_form();
}

function withdraw_case_from_desk_dialog(frm) {
	var dialog = new frappe.ui.Dialog({
		title: "",
		centered: true,
		fields: [
			{
				fieldname: "case_register_withdraw_header",
				fieldtype: "HTML",
				options:
					'<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">' +
					'<img src="/assets/support_iid/images/apf_logo.png" style="width:40px;height:40px;object-fit:contain;flex-shrink:0;">' +
					'<div style="font-size:14px;color:#36414c;line-height:1.5;">' +
					__("Withdraw this case? This cannot be undone — you'll need to submit a new request if you change your mind.") +
					"</div>" +
					"</div>",
			},
			{
				fieldname: "reason",
				fieldtype: "Small Text",
				label: __("Reason for withdrawing"),
				reqd: 1,
			},
			{
				fieldname: "declaration",
				fieldtype: "Check",
				label: __("I confirm I want to withdraw this case."),
				reqd: 1,
			},
		],
		primary_action_label: __("Withdraw"),
		primary_action: function (values) {
			if (!values.declaration) {
				frappe.show_alert({ message: __("Please confirm the declaration to proceed."), indicator: "orange" });
				return;
			}
			case_register_call_with_loader({
				method: "support_iid.support_iid.doctype.case_register.case_register.withdraw_case_from_desk",
				args: { case_name: frm.doc.name, reason: values.reason },
				freeze_message: __("Withdrawing..."),
				callback: function () {
					dialog.hide();
					frm.reload_doc();
				},
			});
		},
	});
	dialog.show();
}

// Shows a "Take Action" primary button — Approve / Send Back / Decline,
// with an optional comment — for whoever's actually allowed to act on
// the case's CURRENT pending approval stage: the exact approver_email
// on that stage, or anyone with the Support IID Approver role, or
// System Manager/Administrator (mirrors the permission check
// process_case_approval itself already enforces server-side — this is
// only what decides whether to SHOW the button; the real gate is still
// that server-side check on every actual call).
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

	// Support IID Approver on its own is NOT enough to show this button —
	// that role is held by every approver across every level/case, so
	// checking only the role would show "Take Action" to level-2/3
	// approvers on a case that's still waiting on level 1. Only the
	// exact approver_email on the CURRENT stage (or System
	// Manager/Administrator, as an override) gets it — matches the same
	// current-stage-only visibility get_permission_query_conditions /
	// has_permission already enforce for whether the case is visible at
	// all (see case_register.py).
	var roles = frappe.user_roles || [];
	var user = frappe.session.user;
	var approver_email = (current_stage.approver_email || "").trim().toLowerCase();
	var can_act =
		user === "Administrator" ||
		roles.includes("System Manager") ||
		(approver_email && user.toLowerCase() === approver_email);
	if (!can_act) return;

	frm.page.set_primary_action(__("Take Action"), () => take_action_dialog(frm, current_stage));
}

function take_action_dialog(frm, current_stage) {
	var level_label = current_stage.case_approval_level_decription || __("this stage");
	var dialog = new frappe.ui.Dialog({
		title: __("Take Action — {0}", [level_label]),
		centered: true,
		fields: [
			{
				fieldname: "action",
				fieldtype: "Select",
				label: __("Action"),
				options: ["Approve", "Send Back", "Decline"],
				default: "Approve",
				reqd: 1,
			},
			{
				fieldname: "comments",
				fieldtype: "Small Text",
				label: __("Comments"),
			},
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

function submit_draft_case(frm) {
	case_register_branded_confirm(
		__("Submit this case? It will move to Pending Approval and the approver/requestor emails will be sent."),
		__("I confirm the information in this case is accurate to the best of my knowledge."),
		function () {
			// submit_case reads the case straight from the DB, not from
			// whatever's currently sitting unsaved in the browser — any
			// pending edit (e.g. a Graph re-fetch that filled the
			// approval stage table right before the user clicked Submit)
			// needs to actually land in the DB first, or it's silently
			// lost the moment the server loads its own copy of the doc.
			var do_submit = function () {
				case_register_call_with_loader({
					method: "support_iid.support_iid.doctype.case_register.case_register.submit_case",
					args: { case_name: frm.doc.name },
					freeze_message: __("Submitting..."),
					callback: function () {
						frm.reload_doc();
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

// Same AES-GCM key/scheme as the guest web form's decryptPayload (see
// support_iid_case_registration.js) — get_employee_details always
// encrypts its response regardless of caller, guest or logged-in Desk
// user, so this Desk script needs the same decrypt step to read it.
const CASE_REGISTER_AES_KEY_B64 = "sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=";

function case_register_base64_to_bytes(b64) {
	var binary = atob(b64);
	var bytes = new Uint8Array(binary.length);
	for (var i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function case_register_decrypt_payload(payload) {
	if (!payload || !payload.encrypted) {
		return Promise.resolve(payload);
	}
	return crypto.subtle
		.importKey("raw", case_register_base64_to_bytes(CASE_REGISTER_AES_KEY_B64), { name: "AES-GCM" }, false, ["decrypt"])
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

// Mirrors fetchRequestorDetails in support_iid_case_registration.js — same
// Microsoft Graph lookup (name/mobile/department/office_location) and the
// same server-computed approval_stages (Approval Hierarchy match, or a
// Graph manager-chain fallback, scaled to funds_requested), just written
// into a real frm (Desk form) instead of a web form's field.df.data.
function fetch_requestor_details(frm, email) {
	// onload sets requestor_email via frm.set_value AND calls this
	// directly — but set_value also fires the requestor_email field's own
	// (debounced) handler, which calls this again ~800ms later with the
	// exact same arguments. Same thing can happen from other paths that
	// both call this directly and also change a field this same function
	// is wired to. Guards against firing the identical (email, funds)
	// request twice in a row, which is what was tripping Microsoft
	// Graph's own rate limit on nothing more than opening a fresh form.
	var funds = frm.doc.funds_requested || 0;
	var call_key = email + "|" + funds;
	if (frm._last_graph_fetch_key === call_key) return;
	frm._last_graph_fetch_key = call_key;

	case_register_call_with_loader({
		method: "support_iid.api.microsoft_graph.get_employee_details",
		args: { email: email, funds_requested: funds },
		freeze_message: __("Fetching employee details..."),
		// Fails quietly (console only) rather than a blocking error dialog
		// — this auto-fill is a convenience on top of a form the user can
		// always fill in manually, same as the guest web form's own
		// graceful-degradation behavior for this same lookup.
		error: function (err) {
			console.error("Employee lookup failed:", err);
		},
		callback: function (r) {
			var payload = r.message;
			if (!payload || !payload.encrypted) return;
			case_register_decrypt_payload(payload)
				.then(function (data) {
					if (!data.exists) return;
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
	// add_child()/direct field assignment above bypasses set_value, so it
	// never fires the model-change event frm.dirty() normally listens
	// for — the grid visibly fills in, but the form doesn't know it has
	// unsaved changes, and submit_case (called straight from the Submit
	// button, which never itself calls frm.save()) would then read
	// straight from the DB and find no approval stage rows there at all.
	// Marked dirty explicitly, and — for a case that's already been
	// saved at least once (funds_requested changed after the first
	// save, re-triggering this same fetch) — saved right away so the
	// fetched rows are never left sitting unsaved.
	frm.dirty();
	if (!frm.is_new()) {
		frm.save();
	}
}

// Mirrors loadDocumentsFor in support_iid_case_registration.js — same
// Documents list lookup by Type of Request, matched against the child
// table rows that declare that type.
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

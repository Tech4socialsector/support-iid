frappe.ready(function () {

    /* =========================================================
       EDIT MODE — Send-Back "edit and resubmit" flow.
       If the URL carries ?token=..., this is a requestor editing an
       existing case (not a fresh submission): the token + a live OTP
       (sent to the requestor's own email) authorize applying the edits
       via submit_case_edit, bypassing the standard guest-blocked
       web_form.accept save path entirely.
    ========================================================= */

    // Declared up front (not inline with the Save-gating code further
    // below) since edit-mode setup runs immediately at the top of this
    // file and calls refreshSaveVisibility(), which reads this Set — if
    // it were declared later in source order, that first call would see
    // it as undefined and throw before ever reaching this line.
    var validationErrors = new Set();

    var editParams = new URLSearchParams(window.location.search);
    var editToken = editParams.get('token') || '';
    var editVerifyTicket = '';

    // While true, field-change handlers that have side effects meant only
    // for real user edits (Graph API lookup, resetting the supporting-
    // documents grid to blank rows) skip those side effects — the edit-mode
    // prefill (which only runs after OTP verification, see below) sets
    // every field from the existing case data, including fields like
    // requestor_email and type_of_request whose "on change" handlers would
    // otherwise wipe or re-fetch data that's already correct.
    var isPrefilling = false;

    // True for the entire lifetime of an edit-mode session (editToken
    // present) — permanently blocks the type_of_request change handler
    // from calling loadDocumentsFor() and wiping the Supporting Documents
    // grid back to blank template rows, since an edited case always has
    // real, already-uploaded documents to preserve rather than a fresh
    // checklist to populate.
    //
    // isPrefilling alone can't gate this safely: frappe.model.set_value's
    // internal field-changed event (what actually fires the
    // on('type_of_request', ...) handler below) is dispatched
    // asynchronously — sometime after set_value() returns, not
    // synchronously inside it — so by the time it lands, a same-tick
    // "isPrefilling = false" set at the end of the prefill call has
    // already run, making a would-be isPrefilling check see `false` and
    // let the wipe through regardless of the boolean's intent. Setting
    // this flag once, up front, for the whole edit session sidesteps
    // that timing race entirely instead of trying to win it.
    var caseDocumentsLoaded = !!editToken;

    if (editToken) {
        lockFormUntilVerified();
        addEditModeOtpControls();
    }

    // All real case fields stay hidden/locked until OTP verification
    // succeeds — resolve_case_for_edit (which returns the actual case
    // data) is only called at that point, so nothing case-specific is
    // fetched or shown before the requestor proves they hold the inbox
    // the edit link was sent to. Hiding .web-form-body (the wrapper around
    // every field/section) rather than toggling each field's own "hidden"
    // property individually — Section Break "hidden" doesn't reliably
    // collapse the fields nested under it, so per-field toggling left the
    // form fully visible with blank inputs instead of actually hidden.
    // The OTP entry itself is a small self-built panel (its own <input>,
    // not the real "otp" doctype field) so it renders independently of
    // .web-form-body and is completely unaffected by hiding it.
    function lockFormUntilVerified() {
        $('.web-form-body').hide();
        $('.web-form-footer').hide();
    }

    function unlockFormAfterVerified() {
        $('.web-form-body').show();
        $('.web-form-footer').show();
        $('#cr-edit-otp-panel').remove();
    }

    // Fills the Supporting Documents grid.
    //
    // Root cause of the Attach column showing blank: Grid.get_data() reads
    // `this.frm ? this.frm.doc[fieldname] : this.df.data`. Web form field
    // controls never get a `frm` (web forms use frappe.web_form, a
    // FieldGroup, not a real Form) — so for every Table field on a web
    // form, the grid actually renders from the FIELD's own `df.data`
    // array, not from frappe.web_form.doc[fieldname]. Writing only to
    // frappe.web_form.doc.supporting_documents (as fillApprovalStages()
    // does) left the grid still reading its old/empty df.data underneath,
    // which is why Document Name looked right (a stale value that
    // happened to already be correct) while Attachment stayed blank.
    // Fix: write the rows to df.data directly, same as Grid.add_row()
    // does internally on its own no-frm branch.
    function fillSupportingDocuments(rows) {
        var field = frappe.web_form.fields_dict["supporting_documents"];
        var grid = field && field.grid;
        if (!grid) return;

        var built = (rows || []).map(function (r, i) {
            return {
                doctype: "Case Documents",
                parentfield: "supporting_documents",
                parenttype: frappe.web_form.doc.doctype,
                parent: frappe.web_form.doc.name,
                idx: i + 1,
                document_name: r.document_name || '',
                attachment:    r.attachment || '',
                remarks:       r.remarks || '',
                __islocal: 1
            };
        });

        field.df.data = built;
        frappe.web_form.doc.supporting_documents = built;
        grid.refresh();
        caseDocumentsLoaded = true;
    }

    // Fills the Family Members grid — same df.data pattern as
    // fillSupportingDocuments/fillApprovalStages, since family_members is
    // also a Table field and the generic set_value loop below can't
    // populate it (web form grids render from field.df.data, not from
    // frappe.web_form.doc[fieldname]).
    function fillFamilyMembers(rows) {
        var field = frappe.web_form.fields_dict["family_members"];
        var grid = field && field.grid;
        if (!grid) return;

        var built = (rows || []).map(function (r, i) {
            return {
                doctype: "Family Member",
                parentfield: "family_members",
                parenttype: frappe.web_form.doc.doctype,
                parent: frappe.web_form.doc.name,
                idx: i + 1,
                member_name:    r.member_name || '',
                relationship:   r.relationship || '',
                age:            r.age || '',
                qualification:  r.qualification || '',
                monthly_income: r.monthly_income || 0,
                marital_status: r.marital_status || '',
                occupation:     r.occupation || '',
                __islocal: 1
            };
        });

        field.df.data = built;
        frappe.web_form.doc.family_members = built;
        grid.refresh();
    }

    function fetchCaseForEdit() {
        isPrefilling = true;
        frappe.call({
            method: 'support_iid.case_management.doctype.case_register.case_register.resolve_case_for_edit',
            args: { token: editToken },
            callback: function (r) {
                if (!r.message) return;
                decryptPayload(r.message).then(function (resolved) {
                    var data = resolved.data || {};
                    unlockFormAfterVerified();
                    // supporting_documents, case_approval_stage, and
                    // family_members are all Table fields — handled
                    // separately via fillSupportingDocuments/fillApprovalStages/
                    // fillFamilyMembers, which write to field.df.data (what the
                    // grid actually renders from in a web form) rather than just
                    // frappe.web_form.doc[fieldname], which the generic set_value
                    // path below uses and which the grid does NOT read from here.
                    // Going through the generic path for these left the grid
                    // showing stale/default rows instead of the case's real data.
                    Object.keys(data).forEach(function (fieldname) {
                        if (fieldname === 'supporting_documents' || fieldname === 'case_approval_stage' || fieldname === 'family_members') return;
                        if (data[fieldname] !== undefined && data[fieldname] !== null) {
                            frappe.web_form.set_value(fieldname, data[fieldname]);
                        }
                    });
                    fillSupportingDocuments(data.supporting_documents);
                    fillApprovalStages(data.case_approval_stage);
                    fillFamilyMembers(data.family_members);
                }).catch(function () {
                    frappe.msgprint('This edit link is invalid or has expired.');
                }).finally(function () {
                    isPrefilling = false;
                });
            },
            error: function () {
                frappe.msgprint('Could not load the case for editing. Please request a new link and try again.');
                isPrefilling = false;
            }
        });
    }

    // Replaces the whole page body with a clear, final confirmation once
    // the resubmit actually succeeds — no reload, no re-entering the OTP
    // flow on a now-stale edit token, no ambiguity about whether the
    // submit went through.
    function showResubmitSuccess(caseStatus) {
        $('.web-form-body').remove();
        $('.web-form-footer').remove();
        $('#cr-edit-otp-panel').remove();
        var $success = $(
            '<div style="text-align:center;padding:48px 20px">' +
            '<div style="font-size:40px;color:#2f9e5b;margin-bottom:12px">&#10003;</div>' +
            '<div style="font-size:18px;font-weight:600;color:#1a1a1a;margin-bottom:6px">Your case has been resubmitted for approval.</div>' +
            '<div style="font-size:13px;color:#8d99a6">Current status: ' + frappe.utils.escape_html(caseStatus) + '</div>' +
            '</div>'
        );
        $('.web-form').append($success);
    }

    function addEditModeOtpControls() {
        // Rendered as part of the form content itself (inserted right above
        // .web-form-body, which stays hidden until verified), not a
        // page-wide sticky overlay — so it reads as the first real step of
        // the page, not a banner floating on top of hidden content.
        var $panel = $(
            '<div id="cr-edit-otp-panel" style="background:#fff7ed;' +
            'border:1px solid #f0c37a;border-radius:8px;padding:14px 18px;margin-bottom:20px">' +
            '<div style="font-size:13px;color:#7c4a03;margin-bottom:10px">You are editing a returned case. ' +
            'Verify your email to load and edit the case details.</div>' +
            '<button type="button" class="btn btn-xs btn-default" id="cr-send-edit-otp">Send Verification Code</button>' +
            '<div style="font-size:12px;color:#8d99a6;margin-top:4px">' +
            'Click to receive a verification code by email, enter it below, then click Verify.</div>' +
            '<div style="margin-top:10px;display:none" id="cr-edit-otp-field-row">' +
            '<label style="font-size:13px;display:block;margin-bottom:4px">Verification Code</label>' +
            '<input type="text" id="cr-edit-otp-input" placeholder="Enter code" style="max-width:160px" class="form-control input-sm">' +
            '<div style="margin-top:8px">' +
            '<button type="button" class="btn btn-xs btn-primary" id="cr-verify-edit-otp">Verify</button>' +
            '<span id="cr-edit-otp-verified-note" style="margin-left:10px;color:#2f9e5b;font-weight:600;display:none">&#10003; Verified</span>' +
            '</div>' +
            '</div>' +
            '</div>'
        );

        var $webFormBody = $('.web-form-body');
        if ($webFormBody.length) {
            $webFormBody.before($panel);
        } else {
            $('.web-form').prepend($panel);
        }

        var $sendBtn = $panel.find('#cr-send-edit-otp');
        var $verifyBtn = $panel.find('#cr-verify-edit-otp');
        var $verifiedNote = $panel.find('#cr-edit-otp-verified-note');

        $sendBtn.on('click', function () {
            $sendBtn.prop('disabled', true).text('Sending...');
            frappe.call({
                method: 'support_iid.case_management.doctype.case_register.case_register.send_edit_otp',
                args: { token: editToken },
                callback: function (r) {
                    if (r.message && r.message.sent) {
                        $panel.find('#cr-edit-otp-field-row').show();
                        frappe.show_alert({ message: 'Verification code sent to your email.', indicator: 'green' }, 6);
                        $sendBtn.text('Resend Code');
                    }
                },
                error: function () {
                    frappe.msgprint('Could not send the verification code. Please try again.');
                    $sendBtn.text('Send Verification Code');
                },
                always: function () { $sendBtn.prop('disabled', false); }
            });
        });

        $verifyBtn.on('click', function () {
            var otp = ($panel.find('#cr-edit-otp-input').val() || '').trim();
            if (!otp) {
                frappe.msgprint('Please enter the verification code sent to your email.');
                return;
            }
            $verifyBtn.prop('disabled', true).text('Verifying...');
            frappe.call({
                method: 'support_iid.case_management.doctype.case_register.case_register.verify_edit_otp',
                args: { token: editToken, otp: otp },
                callback: function (r) {
                    if (r.message && r.message.verify_ticket) {
                        editVerifyTicket = r.message.verify_ticket;
                        $sendBtn.hide();
                        $panel.find('#cr-edit-otp-input').prop('disabled', true);
                        $verifyBtn.hide();
                        $verifiedNote.show();
                        frappe.show_alert({ message: 'Verified. Loading case details…', indicator: 'green' }, 5);
                        fetchCaseForEdit();
                        refreshSaveVisibility();
                    }
                },
                error: function () {
                    frappe.msgprint('Invalid or expired code. Please request a new one and try again.');
                    editVerifyTicket = '';
                },
                always: function () {
                    $verifyBtn.prop('disabled', false).text('Verify');
                }
            });
        });

        refreshSaveVisibility();
    }

    /* =========================================================
       UTILITIES
    ========================================================= */

    function debounce(fn, delay) {
        var timer;
        return function () {
            var args = arguments;
            var ctx = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(ctx, args); }, delay);
        };
    }

    /* =========================================================
       SAVE GATING — the Save button is hidden while any custom
       (non-Frappe-mandatory) validation is failing: invalid pincode,
       wrong email domain, bad mobile format, future date of birth.
       Frappe's own required-field checks still run at actual save
       time as normal; this only covers the checks this form adds.
    ========================================================= */

    function refreshSaveVisibility() {
        var $submitBtn = $('.web-form .submit-btn, .web-form-footer .submit-btn');
        var blockedByEdit = editToken && !editVerifyTicket;
        if (validationErrors.size > 0 || blockedByEdit) {
            $submitBtn.hide();
        } else {
            $submitBtn.show();
        }
    }

    function fieldError(fieldname, message) {
        var fd = frappe.web_form.fields_dict[fieldname];
        if (!fd || !fd.$wrapper) return;
        var wrapper = fd.$wrapper;
        wrapper.find('.field-error-msg').remove();
        wrapper.find('input, select, textarea').css({ 'border-color': '#e74c3c' });
        var msg = $('<div class="field-error-msg" style="'
            + 'display:flex;align-items:center;gap:5px;'
            + 'margin-top:4px;font-size:12px;color:#c0392b;">'
            + '<span style="width:6px;height:6px;border-radius:50%;'
            + 'background:#e74c3c;flex-shrink:0;display:inline-block;"></span>'
            + '<span>' + message + '</span>'
            + '</div>');
        wrapper.append(msg);

        validationErrors.add(fieldname);
        refreshSaveVisibility();

        // The message text fades after a while so it doesn't linger forever,
        // but the red border (and the Save-button gate) stays until the
        // field is actually re-validated as OK via clearFieldError — a
        // faded message must never look like "this got fixed on its own".
        var t = setTimeout(function () {
            msg.fadeOut(400, function () { msg.remove(); });
        }, 15000);
        msg.data('dt', t);
    }

    function clearFieldError(fieldname) {
        var fd = frappe.web_form.fields_dict[fieldname];
        if (!fd || !fd.$wrapper) return;
        var wrapper = fd.$wrapper;
        var msg = wrapper.find('.field-error-msg');
        clearTimeout(msg.data('dt'));
        msg.remove();
        wrapper.find('input, select, textarea').css({ 'border-color': '' });

        validationErrors.delete(fieldname);
        refreshSaveVisibility();
    }

    // Replaces Frappe's own mandatory-field check for the fresh-submission
    // path. This is a single-page web form (no Page Break fields), so the
    // actual gate that runs on Save is FieldGroup.get_values() (frappe/
    // public/js/frappe/ui/field_group.js), called via `super.get_values(...)`
    // inside WebForm.save() — which shows one popup dialog listing every
    // missing/invalid field by label ("Missing Values Required"). `super.`
    // calls always resolve against the prototype, so overriding
    // frappe.web_form.get_values on the instance would NOT intercept that
    // particular call and can't be used to fix this from here. Overriding
    // save() itself instead lets us run the same mandatory/invalid scan
    // ourselves first, show each problem inline under its own field (like
    // the email/mobile/pincode checks above) instead of one popup, and only
    // continue to the real save when everything passes.
    var original_save = frappe.web_form.save.bind(frappe.web_form);

    function validate_all_fields_inline() {
        var first_invalid_fieldname = null;

        frappe.web_form.fields.forEach(function (df) {
            var fieldname = df.fieldname;
            if (!fieldname) return;

            var field = frappe.web_form.fields_dict[fieldname];
            if (!field || !field.get_value || df.hidden) return;

            var value = field.get_value();
            var is_empty = is_null(typeof value === "string" ? strip_html(value) : value);
            var is_invalid = df.reqd && (
                is_empty ||
                (df.fieldtype === "Text Editor" && is_null(strip_html(cstr(value))))
            );

            if (is_invalid || df.invalid) {
                fieldError(fieldname, is_invalid
                    ? __("{0} is required.", [__(df.label)])
                    : __("{0} has an invalid value.", [__(df.label)]));
                if (!first_invalid_fieldname) first_invalid_fieldname = fieldname;
            }
        });

        if (first_invalid_fieldname) {
            var fd = frappe.web_form.fields_dict[first_invalid_fieldname];
            if (fd && fd.$wrapper && fd.$wrapper.length) {
                fd.$wrapper[0].scrollIntoView({ behavior: "smooth", block: "center" });
            }
            return false;
        }
        return true;
    }

    if (!editToken) {
        frappe.web_form.save = function () {
            if (!validate_all_fields_inline()) return false;
            return original_save();
        };
    }

    /* =========================================================
       AES-GCM DECRYPTION
    ========================================================= */

    var AES_KEY_B64 = "sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=";

    function base64ToBytes(b64) {
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function decryptPayload(payload) {
        if (!payload || !payload.encrypted) {
            return Promise.resolve(payload);
        }
        return crypto.subtle.importKey(
            "raw", base64ToBytes(AES_KEY_B64), { name: "AES-GCM" }, false, ["decrypt"]
        ).then(function (key) {
            return crypto.subtle.decrypt(
                { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
                key,
                base64ToBytes(payload.data)
            );
        }).then(function (decrypted) {
            return JSON.parse(new TextDecoder().decode(decrypted));
        });
    }

    /* =========================================================
       FULL-SCREEN LOADER
    ========================================================= */

    function showLoader() {
        if ($('#cr-loader').length) return;
        var styleEl = document.createElement('style');
        styleEl.id = 'cr-loader-style';
        styleEl.textContent = '@keyframes crSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
        document.head.appendChild(styleEl);
        var html = '<div id="cr-loader" style="'
            + 'position:fixed;top:0;left:0;width:100vw;height:100vh;'
            + 'background:rgba(255,255,255,0.88);z-index:99999;'
            + 'display:flex;flex-direction:column;align-items:center;'
            + 'justify-content:center;gap:16px;">'
            + '<div style="position:relative;width:56px;height:56px;">'
            + '<img src="/files/APF%20logo.png" style="width:56px;height:56px;'
            + 'object-fit:contain;position:absolute;top:0;left:0;">'
            + '<div style="position:absolute;top:-6px;left:-6px;width:68px;height:68px;'
            + 'border:3px solid #d7e6f7;border-top-color:#2490ef;border-radius:50%;'
            + 'animation:crSpin 0.8s linear infinite;"></div>'
            + '</div>'
            + '<span style="font-size:14px;font-weight:500;color:#36414c;">'
            + 'Fetching employee details...</span>'
            + '</div>';
        $(html).appendTo('body');
    }

    function hideLoader() {
        $('#cr-loader').remove();
        $('#cr-loader-style').remove();
    }

    /* =========================================================
       1. READ-ONLY FIELDS ON LOAD
    ========================================================= */

    frappe.web_form.set_df_property('state', 'read_only', 1);
    frappe.web_form.set_df_property('district', 'read_only', 1);

    if (!frappe.web_form.doc.request_date) {
        frappe.web_form.set_value('request_date', frappe.datetime.get_today());
    }
    frappe.web_form.set_df_property('request_date', 'read_only', 1);

    // 4. Hide Department field
    frappe.web_form.set_df_property('department', 'hidden', 1);

    /* =========================================================
       2. INSURANCE COVERAGE VISIBILITY + MANDATORY
    ========================================================= */

    function applyInsuranceVisibility(value) {
        var noInsurance = (!value || value === 'No Insurance');
        frappe.web_form.set_df_property('insurance_coverage_details', 'hidden', noInsurance ? 1 : 0);
        frappe.web_form.set_df_property('insurance_coverage_details', 'reqd', noInsurance ? 0 : 1);
    }

    frappe.web_form.on('insurance_type', function (field, value) {
        applyInsuranceVisibility(value);
    });
    applyInsuranceVisibility(frappe.web_form.doc.insurance_type);

    /* =========================================================
       3. PHYSICAL VERIFICATION NOTES VISIBILITY
    ========================================================= */

    function applyVerificationVisibility(value) {
        var show = (value === 'Yes');
        frappe.web_form.set_df_property('physical_verification_notes', 'hidden', show ? 0 : 1);
        if (!show) {
            frappe.web_form.set_value('physical_verification_notes', '');
        }
    }

    frappe.web_form.on('physical_verification', function (field, value) {
        applyVerificationVisibility(value);
    });
    applyVerificationVisibility(frappe.web_form.doc.physical_verification);

    /* =========================================================
       4. TYPE OF REQUEST -> LABELS + TREATMENT MANDATORY
    ========================================================= */

    function applyRequestTypeLabels(value) {
        if (value === 'Medical') {
            frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Hospital Name');
            frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Hospital Location');
            frappe.web_form.set_df_property('ailment__course_details', 'label', 'Ailment Details');
            frappe.web_form.set_df_property('treatment', 'hidden', 0);
            frappe.web_form.set_df_property('treatment', 'reqd', 1);
            frappe.web_form.set_df_property('milaap_campaign_link', 'hidden', 0);
            frappe.web_form.set_df_property('milaap_recommendation', 'hidden', 0);
        } else if (value === 'Education') {
            frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Institution Name');
            frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Institution Location');
            frappe.web_form.set_df_property('ailment__course_details', 'label', 'Course Details');
            frappe.web_form.set_df_property('treatment', 'hidden', 1);
            frappe.web_form.set_df_property('treatment', 'reqd', 0);
            frappe.web_form.set_value('treatment', '');
            frappe.web_form.set_df_property('milaap_campaign_link', 'hidden', 1);
            frappe.web_form.set_df_property('milaap_recommendation', 'hidden', 1);
            frappe.web_form.set_value('milaap_campaign_link', '');
            frappe.web_form.set_value('milaap_recommendation', '');
        } else {
            frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Hospital / Institution Name');
            frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Hospital / Institution Location');
            frappe.web_form.set_df_property('ailment__course_details', 'label', 'Ailment / Course Details');
            frappe.web_form.set_df_property('treatment', 'hidden', 0);
            frappe.web_form.set_df_property('treatment', 'reqd', 0);
            frappe.web_form.set_df_property('milaap_campaign_link', 'hidden', 0);
            frappe.web_form.set_df_property('milaap_recommendation', 'hidden', 0);
        }
    }

    frappe.web_form.on('type_of_request', function (field, value) {
        applyRequestTypeLabels(value);
        // supporting_documents is set directly from the case's existing
        // rows (with real attachment URLs) during edit-mode prefill —
        // loadDocumentsFor would reset it to blank, unattached rows.
        // caseDocumentsLoaded (not isPrefilling) is the reliable guard
        // here: this handler fires from frappe.model.set_value's
        // internal change event, which is dispatched asynchronously, so
        // isPrefilling may have already flipped back to false by the
        // time this runs even though the prefill triggered it.
        if (!caseDocumentsLoaded) {
            loadDocumentsFor(value);
        }
    });

    if (frappe.web_form.doc.type_of_request) {
        applyRequestTypeLabels(frappe.web_form.doc.type_of_request);
        if (!caseDocumentsLoaded && (frappe.web_form.doc.supporting_documents || []).length === 0) {
            loadDocumentsFor(frappe.web_form.doc.type_of_request);
        }
    }

    /* =========================================================
       5. PINCODE -> STATE & DISTRICT AUTO-FILL
    ========================================================= */

    frappe.web_form.on('pincode', function (field, value) {
        var pin = String(value || '').trim();
        if (!pin) return;
        if (pin.length !== 6 || isNaN(pin)) {
            fieldError('pincode', 'Please enter a valid 6-digit pincode.');
            frappe.web_form.set_value('state', '');
            frappe.web_form.set_value('district', '');
            return;
        }
        clearFieldError('pincode');
        fetch('https://api.postalpincode.in/pincode/' + pin)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data && data[0] && data[0].Status === 'Success') {
                    var po = data[0].PostOffice[0];
                    frappe.web_form.set_value('state', po.State);
                    frappe.web_form.set_value('district', po.District);
                } else {
                    frappe.web_form.set_value('state', '');
                    frappe.web_form.set_value('district', '');
                    fieldError('pincode', 'Invalid pincode — no matching location found.');
                }
            })
            .catch(function () {
                fieldError('pincode', 'Could not fetch location. Please check your connection.');
            });
    });

    /* =========================================================
       6. DATE OF BIRTH -> AGE AUTO-CALCULATE + FUTURE DATE BLOCK
    ========================================================= */

    frappe.web_form.on('date_of_birth', function (field, value) {
        if (!value) return;
        clearFieldError('date_of_birth');
        var dob = new Date(value);
        var today = new Date();
        if (dob > today) {
            fieldError('date_of_birth', 'Date of Birth cannot be in the future.');
            return;
        }
        var age = today.getFullYear() - dob.getFullYear();
        var m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) { age--; }
        frappe.web_form.set_value('age', age);
    });

    /* =========================================================
       7. EMAIL VALIDATION + MICROSOFT GRAPH LOOKUP
    ========================================================= */

    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var OFFICIAL_DOMAIN = 'azimpremjifoundation.org';

    function clearRequestorFields() {
        frappe.web_form.set_value('requestor_name', '');
        frappe.web_form.set_value('requestor_mobile_number', '');
        frappe.web_form.set_value('department', '');
        frappe.web_form.set_value('work_location', '');

        // Clear approval stage table too
        var grid = frappe.web_form.fields_dict["case_approval_stage"] &&
                   frappe.web_form.fields_dict["case_approval_stage"].grid;
        if (grid) {
            frappe.web_form.doc.case_approval_stage = [];
            grid.refresh();
        }
    }

    function stripCountryCode(mobile) {
        if (!mobile) return '';
        var cleaned = String(mobile).replace(/[\s\-()]/g, '');
        cleaned = cleaned.replace(/^(\+91|0091|91)/, '');
        return cleaned.slice(-10);
    }

    function fillApprovalStages(stages) {
        if (!stages || !stages.length) return;
        var field = frappe.web_form.fields_dict["case_approval_stage"];
        var grid = field && field.grid;
        if (!grid) return;
        // Written to field.df.data (not just frappe.web_form.doc) — see
        // fillSupportingDocuments() for why: web form grids render from
        // df.data, not from the parent doc.
        var built = stages.map(function (s, i) {
            return {
                doctype: "Case Approval Stage",
                parentfield: "case_approval_stage",
                parenttype: frappe.web_form.doc.doctype,
                parent: frappe.web_form.doc.name,
                idx: i + 1,
                case_approval_level:            s.case_approval_level || '',
                case_approval_level_decription: s.case_approval_level_decription || '',
                case_approval_status:           s.case_approval_status || '',
                approver_name:                  s.approver_name || '',
                approver_email:                 s.approver_email || '',
                __islocal: 1
            };
        });
        field.df.data = built;
        frappe.web_form.doc.case_approval_stage = built;
        grid.refresh();
    }

    function fetchRequestorDetails(email) {
        showLoader();
        // Pass funds_requested so the server can determine how many approval levels are needed
        var funds = frappe.web_form.get_value('funds_requested') || 0;
        frappe.call({
            method: 'support_iid.api.microsoft_graph.get_employee_details',
            args: { email: email, funds_requested: funds },
            callback: function (r) {
                var payload = r.message;
                if (!payload || !payload.encrypted) {
                    hideLoader();
                    fieldError('requestor_email', 'Unexpected response from server.');
                    return;
                }
                decryptPayload(payload).then(function (data) {
                    hideLoader();
                    if (!data.exists) {
                        fieldError('requestor_email', 'No employee record found for this email.');
                        return;
                    }
                    var emp = data.employee;

                    if (emp.name) {
                        frappe.web_form.set_value('requestor_name', emp.name);
                    }
                    if (emp.mobile) {
                        frappe.web_form.set_value('requestor_mobile_number', stripCountryCode(emp.mobile));
                    }
                    // department is hidden — still populate it silently
                    if (emp.department) {
                        frappe.web_form.set_value('department', emp.department);
                    }
                    if (emp.office_location) {
                        frappe.web_form.set_value('work_location', emp.office_location);
                    }

                    // Fill approval stage table from combined response
                    fillApprovalStages(data.approval_stages || []);

                }).catch(function (e) {
                    hideLoader();
                    console.error('Decryption failed:', e);
                    fieldError('requestor_email', 'Could not process employee details.');
                });
            },
            error: function (err) {
                hideLoader();
                console.error('Employee lookup failed:', err);
                fieldError('requestor_email', 'Could not fetch employee details. Please enter manually.');
            }
        });
    }

    // Re-trigger approval stages when funds_requested changes (email already entered)
    var debouncedFundsHandler = debounce(function (value) {
        var email = (frappe.web_form.get_value('requestor_email') || '').trim();
        if (!email || !emailRegex.test(email)) return;
        var funds = parseFloat(value) || 0;
        if (!funds) return;
        fetchRequestorDetails(email);
    }, 800);

    frappe.web_form.on('funds_requested', function (field, value) {
        debouncedFundsHandler(value);
    });

    var debouncedEmailHandler = debounce(function (fieldname, value) {
        var trimmed = (value || '').trim();

        // Empty — clear errors + wipe requestor fields
        if (!trimmed) {
            clearFieldError(fieldname);
            if (fieldname === 'requestor_email') {
                clearRequestorFields();
            }
            return;
        }

        // Invalid format
        if (!emailRegex.test(trimmed)) {
            fieldError(fieldname, 'Please enter a valid email address.');
            return;
        }

        // Wrong domain (requestor email only)
        if (fieldname === 'requestor_email') {
            var domain = trimmed.split('@')[1] || '';
            if (domain.toLowerCase() !== OFFICIAL_DOMAIN) {
                fieldError(fieldname, 'This is not a member email. Please use your @azimpremjifoundation.org address.');
                return;
            }
        }

        // Valid — clear error and fetch
        clearFieldError(fieldname);
        if (fieldname === 'requestor_email') {
            fetchRequestorDetails(trimmed);
        }
    }, 800);

    frappe.web_form.on('email', function (field, value) {
        debouncedEmailHandler('email', value);
    });
    frappe.web_form.on('requestor_email', function (field, value) {
        // Skip during edit-mode prefill: set_value('requestor_email', ...)
        // fires this handler with the case's own (unchanged) email, which
        // would otherwise trigger a redundant Graph API lookup on every
        // edit-form load. Checked here (not inside the debounced callback)
        // since isPrefilling has already reverted to false by the time the
        // 800ms debounce timer would run.
        if (isPrefilling) return;
        debouncedEmailHandler('requestor_email', value);
    });

    /* =========================================================
       8. MOBILE NUMBER VALIDATION
    ========================================================= */

    var mobileRegex = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

    var debouncedMobileHandler = debounce(function (fieldname, value) {
        if (!value || !String(value).trim()) {
            clearFieldError(fieldname);
            return;
        }
        if (!mobileRegex.test(String(value).trim())) {
            fieldError(fieldname, 'Please enter a valid 10-digit mobile number.');
        } else {
            clearFieldError(fieldname);
        }
    }, 800);

    frappe.web_form.on('mobile_number', function (field, value) {
        debouncedMobileHandler('mobile_number', value);
    });
    frappe.web_form.on('requestor_mobile_number', function (field, value) {
        debouncedMobileHandler('requestor_mobile_number', value);
    });
    frappe.web_form.on('primary_contact_mobile', function (field, value) {
        debouncedMobileHandler('primary_contact_mobile', value);
    });

    /* =========================================================
       9. TITLE + LOGO SWAP
    ========================================================= */

    var titleTries = 0;
    var titleTimer = setInterval(function () {
        var titleEl = document.querySelector('.title');
        titleTries++;
        if (titleEl) {
            clearInterval(titleTimer);
            titleEl.classList.remove('ellipsis');
            titleEl.style.whiteSpace = 'normal';
            titleEl.style.overflow = 'visible';
            titleEl.innerHTML = '<div style="display:flex;justify-content:space-between;'
                + 'align-items:flex-start;flex-wrap:wrap;gap:10px;width:100%;">'
                + '<h5 style="margin-top:24px">'
                + 'Support IID Case Registration - Azim Premji Foundation'
                + '</h5>'
                + '<img src="/files/APF%20logo.png" style="height:70px;flex-shrink:0">'
                + '</div>';
        } else if (titleTries > 20) {
            clearInterval(titleTimer);
        }
    }, 100);

    /* =========================================================
       10. SUPPORTING DOCUMENTS — LOAD BY TYPE OF REQUEST
    ========================================================= */

    function loadDocumentsFor(requestType) {
        var field = frappe.web_form.fields_dict["supporting_documents"];
        var grid = field && field.grid;
        if (!grid) {
            setTimeout(function () { loadDocumentsFor(requestType); }, 500);
            return;
        }
        frappe.call({
            method: 'support_iid.case_management.web_form.support_iid_case_registration.support_iid_case_registration.get_document_types',
            args: { type_of_request: requestType },
            callback: function (r) {
                if (!r.message) return;
                // Written to field.df.data (not just frappe.web_form.doc) —
                // see fillSupportingDocuments() above for why: web form
                // grids render from df.data, not from the parent doc,
                // since web form fields never get a real `frm`.
                var built = r.message.map(function (doc, i) {
                    return {
                        doctype: "Case Documents",
                        parentfield: "supporting_documents",
                        parenttype: frappe.web_form.doc.doctype,
                        parent: frappe.web_form.doc.name,
                        idx: i + 1,
                        document_name: doc.name,
                        __islocal: 1
                    };
                });
                field.df.data = built;
                frappe.web_form.doc.supporting_documents = built;
                grid.refresh();
            }
        });
    }

    /* =========================================================
       11. EDIT MODE — intercept save to call submit_case_edit
          instead of the standard (guest-blocked) web_form.accept path.
    ========================================================= */

    if (editToken) {
        // Edit mode overrides the ENTIRE save() (not just validate()) so we
        // fully control feedback to the user. Frappe's own save()
        // (frappe/public/js/frappe/web_form/web_form.js) does:
        //   let valid = this.validate && this.validate();
        //   if (!valid && valid !== undefined) { frappe.msgprint("Couldn't
        //   save, please check the data you have entered", ...); return; }
        //   ... otherwise falls through to the real (guest-blocked) accept
        //   save call ...
        // There's no way to make a validate() override both (a) block that
        // real accept call and (b) avoid the generic popup: returning
        // `false` blocks it but always pops the message; returning
        // `undefined` avoids the popup but lets the real accept call run
        // underneath us, which we don't want — this whole flow exists to
        // replace that call with submit_case_edit instead. Overriding
        // save() itself sidesteps the trade-off: our own frappe.call is the
        // only thing that runs, and it owns all success/error messaging.
        frappe.web_form.save = function () {
            if (!editVerifyTicket) {
                frappe.msgprint('Please verify your email with the code sent to you before saving.');
                return false;
            }

            var values = {};
            frappe.web_form.fields.forEach(function (df) {
                if (!df.fieldname) return;
                if (df.fieldtype === 'Table') {
                    // Table fields live directly on the doc, not via get_value.
                    values[df.fieldname] = frappe.web_form.doc[df.fieldname] || [];
                } else {
                    values[df.fieldname] = frappe.web_form.get_value(df.fieldname);
                }
            });

            frappe.call({
                method: 'support_iid.case_management.doctype.case_register.case_register.submit_case_edit',
                args: {
                    token: editToken,
                    verify_ticket: editVerifyTicket,
                    data: values
                },
                freeze: true,
                freeze_message: 'Resubmitting...',
                callback: function (r) {
                    if (!r.message) return;
                    decryptPayload(r.message).then(function (data) {
                        if (data && data.case_status) {
                            // Reloading the same URL after this point would
                            // re-run the whole edit-mode flow from scratch on
                            // a token that's no longer valid for editing —
                            // the case has already moved on, so re-verifying
                            // would just fail and leave the page showing the
                            // bare "verify your email" panel with no
                            // confirmation the resubmit actually worked.
                            // Replace the page content with a clear success
                            // state instead of reloading.
                            showResubmitSuccess(data.case_status);
                        }
                    });
                },
                error: function (err) {
                    console.error('submit_case_edit failed:', err);
                    frappe.msgprint('Could not resubmit the case. Please check your verification code and try again.');
                }
            });

            return false;
        };
    }

});





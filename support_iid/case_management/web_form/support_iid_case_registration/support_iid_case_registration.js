frappe.ready(function () {

    $('<style>.web-form-footer .discard-btn { display:none !important; }</style>').appendTo('head');

    $('<style>' +
        '.sd-mandatory-row { border-left:3px solid #c0392b; background:#fdf3f2; }' +
        '.sd-mandatory-row .row-index { cursor:help; }' +
        '</style>').appendTo('head');


    var validationErrors = new Set();

    var editParams = new URLSearchParams(window.location.search);
    var editToken = editParams.get('token') || '';
    var editVerifyTicket = '';

    var isPrefilling = false;

    var caseDocumentsLoaded = !!editToken;

    if (editToken) {
        lockFormUntilVerified();
        addEditModeOtpControls();
    }

    function lockFormUntilVerified() {
        $('.web-form-body').hide();
        $('.web-form-footer').hide();
    }

    function unlockFormAfterVerified() {
        $('.web-form-body').show();
        $('.web-form-footer').show();
        $('#cr-edit-otp-panel').remove();
    }

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
                is_mandatory:  r.is_mandatory ? 1 : 0,
                __islocal: 1
            };
        });

        field.df.data = built;
        frappe.web_form.doc.supporting_documents = built;
        grid.refresh();
        markMandatoryDocumentRows();
        caseDocumentsLoaded = true;
    }

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
            method: 'support_iid.support_iid.doctype.case_register.case_register.resolve_case_for_edit',
            args: { token: editToken },
            callback: function (r) {
                if (!r.message) return;
                decryptPayload(r.message).then(function (resolved) {
                    var data = resolved.data || {};
                    unlockFormAfterVerified();
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
                method: 'support_iid.support_iid.doctype.case_register.case_register.send_edit_otp',
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
                method: 'support_iid.support_iid.doctype.case_register.case_register.verify_edit_otp',
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


    function debounce(fn, delay) {
        var timer;
        return function () {
            var args = arguments;
            var ctx = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(ctx, args); }, delay);
        };
    }


    function refreshSaveVisibility() {
        var $submitBtn = $('.web-form .submit-btn, .web-form-footer .submit-btn');
        var blockedByEdit = editToken && !editVerifyTicket;
        if (blockedByEdit) {
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

        currencyFieldnames.forEach(function (fieldname) {
            if (!validateCurrencyField(fieldname) && !first_invalid_fieldname) {
                first_invalid_fieldname = fieldname;
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

    var alreadySubmitted = false;

    function lockFormAsSubmitted() {
        var $submitBtn = $('.web-form .submit-btn, .web-form-footer .submit-btn');
        $submitBtn.prop('disabled', true).css({ opacity: 0.6, cursor: 'not-allowed' });
    }

    window.addEventListener('pageshow', function (event) {
        if (event.persisted && alreadySubmitted) {
            lockFormAsSubmitted();
        }
    });

    if (!editToken) {
        frappe.web_form.save = function () {
            if (alreadySubmitted) return false;
            if (!validate_all_fields_inline()) return false;
            if (!validateMandatoryDocuments()) return false;

            var already_saving = window.saving;
            original_save();
            if (!already_saving && !window.saving) return false;

            alreadySubmitted = true;
            lockFormAsSubmitted();

            setTimeout(function () {
                if (!window.saving && $('.web-form-container').is(':visible')) {
                    alreadySubmitted = false;
                    $('.web-form .submit-btn, .web-form-footer .submit-btn')
                        .prop('disabled', false)
                        .css({ opacity: '', cursor: '' });
                }
            }, 4000);

            return false;
        };
    }


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


    frappe.web_form.set_df_property('state', 'read_only', 1);
    frappe.web_form.set_df_property('district', 'read_only', 1);

    if (!frappe.web_form.doc.request_date) {
        frappe.web_form.set_value('request_date', frappe.datetime.get_today());
    }
    frappe.web_form.set_df_property('request_date', 'read_only', 1);

    // 4. Hide Department field
    frappe.web_form.set_df_property('department', 'hidden', 1);


    function applyInsuranceVisibility(value) {
        var noInsurance = (!value || value === 'No Insurance');
        frappe.web_form.set_df_property('insurance_coverage_details', 'hidden', noInsurance ? 1 : 0);
        frappe.web_form.set_df_property('insurance_coverage_details', 'reqd', noInsurance ? 0 : 1);
    }

    frappe.web_form.on('insurance_type', function (field, value) {
        applyInsuranceVisibility(value);
    });
    applyInsuranceVisibility(frappe.web_form.doc.insurance_type);


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


    function applyRequestTypeLabels(value) {
        if (value === 'Medical') {
            frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Hospital Name');
            frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Hospital Location');
            frappe.web_form.set_df_property('ailment__course_details', 'label', 'Ailment Details');
            frappe.web_form.set_df_property('treatment', 'hidden', 0);
            frappe.web_form.set_df_property('treatment', 'reqd', 1);
        } else if (value === 'Education') {
            frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Institution Name');
            frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Institution Location');
            frappe.web_form.set_df_property('ailment__course_details', 'label', 'Course Details');
            frappe.web_form.set_df_property('treatment', 'hidden', 1);
            frappe.web_form.set_df_property('treatment', 'reqd', 0);
            frappe.web_form.set_value('treatment', '');
        } else {
            frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Hospital / Institution Name');
            frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Hospital / Institution Location');
            frappe.web_form.set_df_property('ailment__course_details', 'label', 'Ailment / Course Details');
            frappe.web_form.set_df_property('treatment', 'hidden', 0);
            frappe.web_form.set_df_property('treatment', 'reqd', 0);
        }
    }

    frappe.web_form.on('type_of_request', function (field, value) {
        applyRequestTypeLabels(value);
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


    frappe.web_form.on('pincode', function (field, value) {
        var pin = String(value || '').trim();
        if (!pin) return;
        if (!/^\d{6}$/.test(pin)) {
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


    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var OFFICIAL_DOMAIN = 'azimpremjifoundation.org';

    var enforceEmailDomain = true;
    frappe.call({
        method: 'support_iid.case_management.web_form.support_iid_case_registration.support_iid_case_registration.get_email_domain_validation_setting',
        callback: function (r) {
            if (r.message && typeof r.message.enforce === 'boolean') {
                enforceEmailDomain = r.message.enforce;
            }
        }
    });

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
                        fieldError(
                            'requestor_email',
                            data.transient_error
                                ? 'Could not fetch your details right now. Please try re-entering your email, or fill the fields below manually.'
                                : 'No employee record found for this email.'
                        );
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

        if (fieldname === 'requestor_email' && enforceEmailDomain) {
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
        if (isPrefilling) return;
        debouncedEmailHandler('requestor_email', value);
    });


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


    var currencyFieldnames = ['funds_requested', 'amount_already_spent', 'annual_family_income'];
    var currencyRegex = /^\d*\.?\d*$/;

    function validateCurrencyField(fieldname) {
        var fd = frappe.web_form.fields_dict[fieldname];
        if (!fd || !fd.$wrapper) return true;
        var $input = fd.$wrapper.find('input').first();
        var raw = ($input.val() || '').trim();

        if (!raw) {
            clearFieldError(fieldname);
            return true;
        }
        var withoutCommas = raw.replace(/,/g, '');
        if (!currencyRegex.test(withoutCommas)) {
            fieldError(fieldname, 'Please enter numbers only.');
            return false;
        }
        clearFieldError(fieldname);
        return true;
    }

    var debouncedCurrencyHandler = debounce(function (fieldname) {
        validateCurrencyField(fieldname);
    }, 500);

    currencyFieldnames.forEach(function (fieldname) {
        var fd = frappe.web_form.fields_dict[fieldname];
        if (!fd || !fd.$wrapper) return;
        fd.$wrapper.find('input').on('input', function () {
            debouncedCurrencyHandler(fieldname);
        });
    });


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
                var built = r.message.map(function (doc, i) {
                    return {
                        doctype: "Case Documents",
                        parentfield: "supporting_documents",
                        parenttype: frappe.web_form.doc.doctype,
                        parent: frappe.web_form.doc.name,
                        idx: i + 1,
                        document_name: doc.name,
                        is_mandatory: doc.is_mandatory ? 1 : 0,
                        __islocal: 1
                    };
                });
                field.df.data = built;
                frappe.web_form.doc.supporting_documents = built;
                grid.refresh();
                markMandatoryDocumentRows();
            }
        });
    }

    function markMandatoryDocumentRows() {
        var grid = frappe.web_form.fields_dict["supporting_documents"] &&
                   frappe.web_form.fields_dict["supporting_documents"].grid;
        if (!grid || !grid.grid_rows) return;
        grid.grid_rows.forEach(function (grid_row) {
            var row = grid_row.doc;
            var $row_el = grid_row.row;
            if (!$row_el) return;
            $row_el.removeClass('sd-mandatory-row');
            $row_el.find('.row-index').removeAttr('title').css('font-weight', '');
            if (row && row.is_mandatory) {
                $row_el.addClass('sd-mandatory-row');
                $row_el.find('.row-index').attr('title', 'This document is required').css('font-weight', '700');
            }
        });
    }

    function validateMandatoryDocuments() {
        var grid = frappe.web_form.fields_dict["supporting_documents"] &&
                   frappe.web_form.fields_dict["supporting_documents"].grid;
        var rows = (grid && grid.get_data()) || frappe.web_form.doc.supporting_documents || [];
        var missing = rows.filter(function (r) { return r.is_mandatory && !r.attachment; });
        if (missing.length) {
            fieldError('supporting_documents',
                'Please attach all mandatory documents: ' +
                missing.map(function (r) { return r.document_name; }).join(', '));
            return false;
        }
        clearFieldError('supporting_documents');
        return true;
    }


    if (editToken) {
        frappe.web_form.save = function () {
            if (!editVerifyTicket) {
                frappe.msgprint('Please verify your email with the code sent to you before saving.');
                return false;
            }
            if (!validateMandatoryDocuments()) return false;

            var values = {};
            frappe.web_form.fields.forEach(function (df) {
                if (!df.fieldname) return;
                if (df.fieldtype === 'Table') {
                    var field = frappe.web_form.fields_dict[df.fieldname];
                    var grid = field && field.grid;
                    values[df.fieldname] = (grid && grid.get_data()) || frappe.web_form.doc[df.fieldname] || [];
                } else {
                    values[df.fieldname] = frappe.web_form.get_value(df.fieldname);
                }
            });

            frappe.call({
                method: 'support_iid.support_iid.doctype.case_register.case_register.submit_case_edit',
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





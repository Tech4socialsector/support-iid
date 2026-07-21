// frappe.ready(function () {

//     /* =========================================================
//        UTILITIES
//     ========================================================= */

//     function debounce(fn, delay) {
//         var timer;
//         return function () {
//             var args = arguments;
//             var ctx = this;
//             clearTimeout(timer);
//             timer = setTimeout(function () { fn.apply(ctx, args); }, delay);
//         };
//     }

//     function fieldError(fieldname, message) {
//         var fd = frappe.web_form.fields_dict[fieldname];
//         if (!fd || !fd.$wrapper) return;
//         var wrapper = fd.$wrapper;
//         wrapper.find('.field-error-msg').remove();
//         wrapper.find('input, select, textarea').css({
//             'border-color': '#e74c3c',
//             'box-shadow': '0 0 0 3px rgba(231,76,60,0.12)'
//         });
//         var svgIcon = '<svg width="13" height="13" viewBox="0 0 20 20" fill="none"'
//             + ' xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">'
//             + '<circle cx="10" cy="10" r="9" stroke="#c0392b" stroke-width="2"/>'
//             + '<line x1="10" y1="5" x2="10" y2="11" stroke="#c0392b"'
//             + ' stroke-width="2" stroke-linecap="round"/>'
//             + '<circle cx="10" cy="14.5" r="1" fill="#c0392b"/>'
//             + '</svg>';
//         var pill = $('<div class="field-error-msg" style="'
//             + 'display:inline-flex;align-items:center;gap:6px;'
//             + 'margin-top:5px;padding:5px 10px;'
//             + 'background:#fff5f5;border:1px solid #fcc;border-radius:6px;'
//             + 'font-size:12px;color:#c0392b;line-height:1.4;">'
//             + svgIcon
//             + '<span>' + message + '</span>'
//             + '</div>');
//         wrapper.append(pill);
//         var t = setTimeout(function () {
//             pill.fadeOut(400, function () { pill.remove(); });
//             wrapper.find('input, select, textarea')
//                 .css({ 'border-color': '', 'box-shadow': '' });
//         }, 15000);
//         pill.data('dt', t);
//     }

//     function clearFieldError(fieldname) {
//         var fd = frappe.web_form.fields_dict[fieldname];
//         if (!fd || !fd.$wrapper) return;
//         var wrapper = fd.$wrapper;
//         var pill = wrapper.find('.field-error-msg');
//         clearTimeout(pill.data('dt'));
//         pill.remove();
//         wrapper.find('input, select, textarea')
//             .css({ 'border-color': '', 'box-shadow': '' });
//     }

//     /* =========================================================
//        AES-GCM DECRYPTION
//     ========================================================= */

//     var AES_KEY_B64 = "U8mjk4KicUak1r+9enaaVzIXlIqes=";

//     function base64ToBytes(b64) {
//         var binary = atob(b64);
//         var bytes = new Uint8Array(binary.length);
//         for (var i = 0; i < binary.length; i++) {
//             bytes[i] = binary.charCodeAt(i);
//         }
//         return bytes;
//     }

//     function decryptPayload(payload) {
//         return crypto.subtle.importKey(
//             "raw", base64ToBytes(AES_KEY_B64), { name: "AES-GCM" }, false, ["decrypt"]
//         ).then(function (key) {
//             return crypto.subtle.decrypt(
//                 { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
//                 key,
//                 base64ToBytes(payload.data)
//             );
//         }).then(function (decrypted) {
//             return JSON.parse(new TextDecoder().decode(decrypted));
//         });
//     }

//     /* =========================================================
//        FULL-SCREEN LOADER
//     ========================================================= */

//     function showLoader() {
//         if ($('#cr-loader').length) return;
//         var styleEl = document.createElement('style');
//         styleEl.id = 'cr-loader-style';
//         styleEl.textContent = '@keyframes crSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
//         document.head.appendChild(styleEl);
//         var html = '<div id="cr-loader" style="'
//             + 'position:fixed;top:0;left:0;width:100vw;height:100vh;'
//             + 'background:rgba(255,255,255,0.88);z-index:99999;'
//             + 'display:flex;flex-direction:column;align-items:center;'
//             + 'justify-content:center;gap:16px;">'
//             + '<div style="position:relative;width:56px;height:56px;">'
//             + '<img src="/files/APF%20logo.png" style="width:56px;height:56px;'
//             + 'object-fit:contain;position:absolute;top:0;left:0;">'
//             + '<div style="position:absolute;top:-6px;left:-6px;width:68px;height:68px;'
//             + 'border:3px solid #d7e6f7;border-top-color:#2490ef;border-radius:50%;'
//             + 'animation:crSpin 0.8s linear infinite;"></div>'
//             + '</div>'
//             + '<span style="font-size:14px;font-weight:500;color:#36414c;">'
//             + 'Fetching employee details...</span>'
//             + '</div>';
//         $(html).appendTo('body');
//     }

//     function hideLoader() {
//         $('#cr-loader').remove();
//         $('#cr-loader-style').remove();
//     }

//     /* =========================================================
//        1. READ-ONLY FIELDS ON LOAD
//     ========================================================= */

//     frappe.web_form.set_df_property('state', 'read_only', 1);
//     frappe.web_form.set_df_property('district', 'read_only', 1);

//     if (!frappe.web_form.doc.request_date) {
//         frappe.web_form.set_value('request_date', frappe.datetime.get_today());
//     }
//     frappe.web_form.set_df_property('request_date', 'read_only', 1);

//     /* =========================================================
//        2. INSURANCE COVERAGE VISIBILITY
//     ========================================================= */

//     function applyInsuranceVisibility(value) {
//         frappe.web_form.set_df_property(
//             'insurance_coverage_details', 'hidden',
//             (!value || value === 'No Insurance') ? 1 : 0
//         );
//     }

//     frappe.web_form.on('insurance_type', function (field, value) {
//         applyInsuranceVisibility(value);
//     });
//     applyInsuranceVisibility(frappe.web_form.doc.insurance_type);

//     /* =========================================================
//        3. PHYSICAL VERIFICATION NOTES VISIBILITY
//     ========================================================= */

//     function applyVerificationVisibility(value) {
//         var show = (value === 'Yes');
//         frappe.web_form.set_df_property('physical_verification_notes', 'hidden', show ? 0 : 1);
//         if (!show) {
//             frappe.web_form.set_value('physical_verification_notes', '');
//         }
//     }

//     frappe.web_form.on('physical_verification', function (field, value) {
//         applyVerificationVisibility(value);
//     });
//     applyVerificationVisibility(frappe.web_form.doc.physical_verification);

//     /* =========================================================
//        4. PINCODE -> STATE & DISTRICT AUTO-FILL
//     ========================================================= */

//     frappe.web_form.on('pincode', function (field, value) {
//         var pin = String(value || '').trim();
//         if (!pin) return;
//         if (pin.length !== 6 || isNaN(pin)) {
//             fieldError('pincode', 'Please enter a valid 6-digit pincode.');
//             frappe.web_form.set_value('state', '');
//             frappe.web_form.set_value('district', '');
//             return;
//         }
//         clearFieldError('pincode');
//         fetch('https://api.postalpincode.in/pincode/' + pin)
//             .then(function (res) { return res.json(); })
//             .then(function (data) {
//                 if (data && data[0] && data[0].Status === 'Success') {
//                     var po = data[0].PostOffice[0];
//                     frappe.web_form.set_value('state', po.State);
//                     frappe.web_form.set_value('district', po.District);
//                 } else {
//                     frappe.web_form.set_value('state', '');
//                     frappe.web_form.set_value('district', '');
//                     fieldError('pincode', 'Invalid pincode — no matching location found.');
//                 }
//             })
//             .catch(function () {
//                 fieldError('pincode', 'Could not fetch location. Please check your connection.');
//             });
//     });

//     /* =========================================================
//        5. DATE OF BIRTH -> AGE AUTO-CALCULATE + FUTURE DATE BLOCK
//     ========================================================= */

//     frappe.web_form.on('date_of_birth', function (field, value) {
//         if (!value) return;
//         clearFieldError('date_of_birth');
//         var dob = new Date(value);
//         var today = new Date();
//         if (dob > today) {
//             fieldError('date_of_birth', 'Date of Birth cannot be in the future.');
//             return;
//         }
//         var age = today.getFullYear() - dob.getFullYear();
//         var m = today.getMonth() - dob.getMonth();
//         if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) { age--; }
//         frappe.web_form.set_value('age', age);
//     });

//     /* =========================================================
//        6. EMAIL VALIDATION + MICROSOFT GRAPH LOOKUP
//     ========================================================= */

//     var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

//     function validateEmail(fieldname, value) {
//         if (!value) return false;
//         clearFieldError(fieldname);
//         if (!emailRegex.test(value)) {
//             fieldError(fieldname, 'Please enter a valid email address.');
//             return false;
//         }
//         return true;
//     }

//     function stripCountryCode(mobile) {
//         if (!mobile) return '';
//         var cleaned = String(mobile).replace(/[\s\-()]/g, '');
//         cleaned = cleaned.replace(/^(\+91|0091|91)/, '');
//         return cleaned.slice(-10);
//     }

//     function fetchRequestorDetails(email) {
//         showLoader();
//         frappe.call({
//             method: 'support_iid.api.microsoft_graph.get_employee_details',
//             args: { email: email },
//             callback: function (r) {
//                 var payload = r.message;
//                 if (!payload || !payload.encrypted) {
//                     hideLoader();
//                     fieldError('requestor_email', 'Unexpected response from server.');
//                     return;
//                 }
//                 decryptPayload(payload).then(function (data) {
//                     hideLoader();
//                     if (!data.exists) {
//                         fieldError('requestor_email', 'No employee record found for this email.');
//                         return;
//                     }
//                     var emp = data.employee;
//                     frappe.web_form.set_value('primary_spoc_name', emp.name || '');
//                     if (emp.mobile) {
//                         frappe.web_form.set_value(
//                             'primary_spoc_mobile_number', stripCountryCode(emp.mobile)
//                         );
//                     }
//                     if (emp.department) {
//                         frappe.web_form.set_value('department', emp.department);
//                     }
//                     if (emp.office_location) {
//                         frappe.web_form.set_value('work_location', emp.office_location);
//                     }
//                 }).catch(function (e) {
//                     hideLoader();
//                     console.error('Decryption failed:', e);
//                     fieldError('requestor_email', 'Could not process employee details.');
//                 });
//             },
//             error: function (err) {
//                 hideLoader();
//                 console.error('Employee lookup failed:', err);
//                 fieldError('requestor_email', 'Could not fetch employee details. Please enter manually.');
//             }
//         });
//     }

//     var debouncedEmailHandler = debounce(function (fieldname, value) {
//         var valid = validateEmail(fieldname, value);
//         if (fieldname === 'requestor_email' && valid) {
//             fetchRequestorDetails(value);
//         }
//     }, 800);

//     frappe.web_form.on('email', function (field, value) {
//         debouncedEmailHandler('email', value);
//     });
//     frappe.web_form.on('requestor_email', function (field, value) {
//         debouncedEmailHandler('requestor_email', value);
//     });

//     /* =========================================================
//        7. MOBILE NUMBER VALIDATION
//     ========================================================= */

//     var mobileRegex = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

//     var debouncedMobileHandler = debounce(function (fieldname, value) {
//         if (!value) return;
//         clearFieldError(fieldname);
//         if (!mobileRegex.test(String(value).trim())) {
//             fieldError(fieldname, 'Please enter a valid 10-digit mobile number.');
//         }
//     }, 800);

//     frappe.web_form.on('mobile_number', function (field, value) {
//         debouncedMobileHandler('mobile_number', value);
//     });
//     frappe.web_form.on('primary_contact_mobile', function (field, value) {
//         debouncedMobileHandler('primary_contact_mobile', value);
//     });

//     /* =========================================================
//        8. TYPE OF REQUEST -> DYNAMIC LABELS + SHOW/HIDE TREATMENT
//     ========================================================= */

//     function applyRequestTypeLabels(value) {
//         if (value === 'Medical') {
//             frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Hospital Name');
//             frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Hospital Location');
//             frappe.web_form.set_df_property('ailment__course_details', 'label', 'Ailment Details');
//             frappe.web_form.set_df_property('treatment', 'hidden', 0);
//         } else if (value === 'Education') {
//             frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Institution Name');
//             frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Institution Location');
//             frappe.web_form.set_df_property('ailment__course_details', 'label', 'Course Details');
//             frappe.web_form.set_df_property('treatment', 'hidden', 1);
//         } else {
//             frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Hospital / Institution Name');
//             frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Hospital / Institution Location');
//             frappe.web_form.set_df_property('ailment__course_details', 'label', 'Ailment / Course Details');
//             frappe.web_form.set_df_property('treatment', 'hidden', 0);
//         }
//     }

//     frappe.web_form.on('type_of_request', function (field, value) {
//         applyRequestTypeLabels(value);
//         loadDocumentsFor(value);
//     });

//     if (frappe.web_form.doc.type_of_request) {
//         applyRequestTypeLabels(frappe.web_form.doc.type_of_request);
//         if ((frappe.web_form.doc.supporting_documents || []).length === 0) {
//             loadDocumentsFor(frappe.web_form.doc.type_of_request);
//         }
//     }

//     /* =========================================================
//        9. TITLE + LOGO SWAP
//     ========================================================= */

//     var titleTries = 0;
//     var titleTimer = setInterval(function () {
//         var titleEl = document.querySelector('.title');
//         titleTries++;
//         if (titleEl) {
//             clearInterval(titleTimer);
//             titleEl.classList.remove('ellipsis');
//             titleEl.style.whiteSpace = 'normal';
//             titleEl.style.overflow = 'visible';
//             titleEl.innerHTML = '<div style="display:flex;justify-content:space-between;'
//                 + 'align-items:flex-start;width:100%;">'
//                 + '<h5 style="margin-top:24px">'
//                 + 'Support IID Case Registration - Azim Premji Foundation'
//                 + '</h5>'
//                 + '<img src="/files/APF%20logo.png" style="height:70px;flex-shrink:0">'
//                 + '</div>';
//         } else if (titleTries > 20) {
//             clearInterval(titleTimer);
//         }
//     }, 100);

//     /* =========================================================
//        10. SUPPORTING DOCUMENTS — LOAD BY TYPE OF REQUEST
//     ========================================================= */

//     function loadDocumentsFor(requestType) {
//         var grid = frappe.web_form.fields_dict["supporting_documents"] &&
//                    frappe.web_form.fields_dict["supporting_documents"].grid;
//         if (!grid) {
//             setTimeout(function () { loadDocumentsFor(requestType); }, 500);
//             return;
//         }
//         frappe.call({
//             method: 'support_iid.case_management.web_form.support_iid_case_registration.support_iid_case_registration.get_document_types',
//             args: { type_of_request: requestType },
//             callback: function (r) {
//                 if (!r.message) return;
//                 frappe.web_form.doc.supporting_documents = [];
//                 r.message.forEach(function (doc) {
//                     var row = {
//                         doctype: "Case Documents",
//                         parentfield: "supporting_documents",
//                         parenttype: frappe.web_form.doc.doctype,
//                         parent: frappe.web_form.doc.name,
//                         document_name: doc.name
//                     };
//                     row["__islocal"] = 1;
//                     frappe.web_form.doc.supporting_documents.push(row);
//                 });
//                 grid.refresh();
//             }
//         });
//     }

// });



frappe.ready(function () {

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

    // Simple dot + text error — no box, no background
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
        var t = setTimeout(function () {
            msg.fadeOut(400, function () { msg.remove(); });
            wrapper.find('input, select, textarea').css({ 'border-color': '' });
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

    /* =========================================================
       2. INSURANCE COVERAGE VISIBILITY
    ========================================================= */

    function applyInsuranceVisibility(value) {
        frappe.web_form.set_df_property(
            'insurance_coverage_details', 'hidden',
            (!value || value === 'No Insurance') ? 1 : 0
        );
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
       4. PINCODE -> STATE & DISTRICT AUTO-FILL
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
       5. DATE OF BIRTH -> AGE AUTO-CALCULATE + FUTURE DATE BLOCK
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
       6. EMAIL VALIDATION + MICROSOFT GRAPH LOOKUP
    ========================================================= */

    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function clearRequestorFields() {
        frappe.web_form.set_value('primary_spoc_name', '');
        frappe.web_form.set_value('primary_spoc_mobile_number', '');
        frappe.web_form.set_value('department', '');
        frappe.web_form.set_value('work_location', '');
    }

    function stripCountryCode(mobile) {
        if (!mobile) return '';
        var cleaned = String(mobile).replace(/[\s\-()]/g, '');
        cleaned = cleaned.replace(/^(\+91|0091|91)/, '');
        return cleaned.slice(-10);
    }

    function fetchRequestorDetails(email) {
        showLoader();
        frappe.call({
            method: 'support_iid.api.microsoft_graph.get_employee_details',
            args: { email: email },
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
                    frappe.web_form.set_value('primary_spoc_name', emp.name || '');
                    if (emp.mobile) {
                        frappe.web_form.set_value(
                            'primary_spoc_mobile_number', stripCountryCode(emp.mobile)
                        );
                    }
                    if (emp.department) {
                        frappe.web_form.set_value('department', emp.department);
                    }
                    if (emp.office_location) {
                        frappe.web_form.set_value('work_location', emp.office_location);
                    }
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

    // Three-state handler:
    //   empty  -> clear SPOC fields + remove error
    //   invalid -> show error, do not fetch
    //   valid  -> clear error, fetch from Graph
    var debouncedEmailHandler = debounce(function (fieldname, value) {
        var trimmed = (value || '').trim();

        // Empty — clear error and (for requestor email) wipe auto-filled fields
        if (!trimmed) {
            clearFieldError(fieldname);
            if (fieldname === 'requestor_email') {
                clearRequestorFields();
            }
            return;
        }

        // Invalid format — show error, stop here
        if (!emailRegex.test(trimmed)) {
            fieldError(fieldname, 'Please enter a valid email address.');
            return;
        }

        // Valid — clear any existing error and proceed
        clearFieldError(fieldname);
        if (fieldname === 'requestor_email') {
            fetchRequestorDetails(trimmed);
        }
    }, 800);

    frappe.web_form.on('email', function (field, value) {
        debouncedEmailHandler('email', value);
    });
    frappe.web_form.on('requestor_email', function (field, value) {
        debouncedEmailHandler('requestor_email', value);
    });

    /* =========================================================
       7. MOBILE NUMBER VALIDATION
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
    frappe.web_form.on('primary_contact_mobile', function (field, value) {
        debouncedMobileHandler('primary_contact_mobile', value);
    });

    /* =========================================================
       8. TYPE OF REQUEST -> DYNAMIC LABELS + SHOW/HIDE TREATMENT
    ========================================================= */

    function applyRequestTypeLabels(value) {
        if (value === 'Medical') {
            frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Hospital Name');
            frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Hospital Location');
            frappe.web_form.set_df_property('ailment__course_details', 'label', 'Ailment Details');
            frappe.web_form.set_df_property('treatment', 'hidden', 0);
        } else if (value === 'Education') {
            frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Institution Name');
            frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Institution Location');
            frappe.web_form.set_df_property('ailment__course_details', 'label', 'Course Details');
            frappe.web_form.set_df_property('treatment', 'hidden', 1);
        } else {
            frappe.web_form.set_df_property('hospital_institution_name', 'label', 'Hospital / Institution Name');
            frappe.web_form.set_df_property('hospital_institution_location', 'label', 'Hospital / Institution Location');
            frappe.web_form.set_df_property('ailment__course_details', 'label', 'Ailment / Course Details');
            frappe.web_form.set_df_property('treatment', 'hidden', 0);
        }
    }

    frappe.web_form.on('type_of_request', function (field, value) {
        applyRequestTypeLabels(value);
        loadDocumentsFor(value);
    });

    if (frappe.web_form.doc.type_of_request) {
        applyRequestTypeLabels(frappe.web_form.doc.type_of_request);
        if ((frappe.web_form.doc.supporting_documents || []).length === 0) {
            loadDocumentsFor(frappe.web_form.doc.type_of_request);
        }
    }

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
                + 'align-items:flex-start;width:100%;">'
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
        var grid = frappe.web_form.fields_dict["supporting_documents"] &&
                   frappe.web_form.fields_dict["supporting_documents"].grid;
        if (!grid) {
            setTimeout(function () { loadDocumentsFor(requestType); }, 500);
            return;
        }
        frappe.call({
            method: 'support_iid.case_management.web_form.support_iid_case_registration.support_iid_case_registration.get_document_types',
            args: { type_of_request: requestType },
            callback: function (r) {
                if (!r.message) return;
                frappe.web_form.doc.supporting_documents = [];
                r.message.forEach(function (doc) {
                    var row = {
                        doctype: "Case Documents",
                        parentfield: "supporting_documents",
                        parenttype: frappe.web_form.doc.doctype,
                        parent: frappe.web_form.doc.name,
                        document_name: doc.name
                    };
                    row["__islocal"] = 1;
                    frappe.web_form.doc.supporting_documents.push(row);
                });
                grid.refresh();
            }
        });
    }

});



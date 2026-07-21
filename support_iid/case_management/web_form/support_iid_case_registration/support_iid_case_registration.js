// frappe.ready(function() {

//     // 1. Make State and District read-only from the start
//     frappe.web_form.set_df_property('state', 'read_only', 1);
//     frappe.web_form.set_df_property('district', 'read_only', 1);

//     // 2. Pincode -> auto-fill State & District
//     frappe.web_form.on('pincode', (field, value) => {
//         const pin = String(value || '').trim();
//         if (pin.length !== 6 || isNaN(pin)) {
//             return;
//         }
//         fetch(`https://api.postalpincode.in/pincode/${pin}`)
//             .then(res => res.json())
//             .then(data => {
//                 if (data && data[0] && data[0].Status === 'Success') {
//                     const po = data[0].PostOffice[0];
//                     frappe.web_form.set_value('state', po.State);
//                     frappe.web_form.set_value('district', po.District);
//                 } else {
//                     frappe.web_form.set_value('state', '');
//                     frappe.web_form.set_value('district', '');
//                     frappe.msgprint('Pincode not found. Please enter State and District manually.');
//                 }
//             })
//             .catch((err) => {
//                 console.error('Pincode lookup failed:', err);
//                 frappe.msgprint('Could not fetch location for this pincode. Please check your connection.');
//             });
//     });

//     // 3. Date of Birth -> auto-calculate Age
//     frappe.web_form.on('date_of_birth', (field, value) => {
//         if (!value) return;

//         const dob = new Date(value);
//         const today = new Date();
//         let age = today.getFullYear() - dob.getFullYear();
//         const m = today.getMonth() - dob.getMonth();

//         if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
//             age--;
//         }

//         frappe.web_form.set_value('age', age);
//     });

//     // 4. Title + logo swap
//     let tries = 0;
//     const tryInject = setInterval(() => {
//         const titleEl = document.querySelector('.title');
//         tries++;
//         if (titleEl) {
//             clearInterval(tryInject);
//             titleEl.classList.remove('ellipsis');
//             titleEl.style.whiteSpace = 'normal';
//             titleEl.style.overflow = 'visible';
//             titleEl.innerHTML = `
//                 <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">
//                     <h5 style="margin-top:24px">Support IID Case Registration - Azim Premji Foundation</h5>
//                     <img src="/files/APF%20logo.png" style="height:70px;flex-shrink:0">
//                 </div>
//             `;
//         } else if (tries > 20) {
//             clearInterval(tryInject);
//         }
//     }, 100);

//     // 5. Pre-fill Supporting Documents rows from "Documents List"
//    function setDefaultDocuments() {
//         var grid = frappe.web_form.fields_dict["supporting_documents"] && frappe.web_form.fields_dict["supporting_documents"].grid;
//         if (!grid) {
//             setTimeout(setDefaultDocuments, 500);
//             return;
//         }
//         if ((frappe.web_form.doc.supporting_documents || []).length > 0) return;

//         frappe.call({
//             method: 'support_iid.case_management.web_form.support_iid_case_registration.support_iid_case_registration.get_document_types',
//             callback: function(r) {
//                 if (!r.message || !r.message.length) return;

//                 frappe.web_form.doc.supporting_documents = [];
//                 r.message.forEach(function(doc) {
//                     frappe.web_form.doc.supporting_documents.push({
//                         doctype: "Case Documents",
//                         __islocal: 1,
//                         parentfield: "supporting_documents",
//                         parenttype: frappe.web_form.doc.doctype,
//                         parent: frappe.web_form.doc.name,
//                         document_name: doc.name   // <-- changed from document_type
//                     });
//                 });
//                 grid.refresh();
//             }
//         });
//     }
//     setDefaultDocuments();

// });


frappe.ready(function() {

    // 1. Make State and District read-only from the start
    frappe.web_form.set_df_property('state', 'read_only', 1);
    frappe.web_form.set_df_property('district', 'read_only', 1);

    // 2. Auto-capture Request Date
    if (!frappe.web_form.doc.request_date) {
        frappe.web_form.set_value('request_date', frappe.datetime.get_today());
    }
    frappe.web_form.set_df_property('request_date', 'read_only', 1);

    // 3. Insurance Coverage Details — visible only if insurance_type is set and not "No Insurance"
    function applyInsuranceVisibility(value) {
        const hide = (!value || value === 'No Insurance');
        frappe.web_form.set_df_property('insurance_coverage_details', 'hidden', hide ? 1 : 0);
    }
    frappe.web_form.on('insurance_type', (field, value) => applyInsuranceVisibility(value));
    applyInsuranceVisibility(frappe.web_form.doc.insurance_type);

    // 4. Physical Verification Notes — visible only when Physical Verification = "Yes"
    function applyVerificationNotesVisibility(value) {
        const show = (value === 'Yes');
        frappe.web_form.set_df_property('physical_verification_notes', 'hidden', show ? 0 : 1);
        if (!show) {
            frappe.web_form.set_value('physical_verification_notes', '');
        }
    }
    frappe.web_form.on('physical_verification', (field, value) => applyVerificationNotesVisibility(value));
    applyVerificationNotesVisibility(frappe.web_form.doc.physical_verification);

    // 5. Pincode -> auto-fill State & District, with error on invalid pincode
    frappe.web_form.on('pincode', (field, value) => {
        const pin = String(value || '').trim();

        if (!pin) return;

        if (pin.length !== 6 || isNaN(pin)) {
            frappe.msgprint('Please enter a valid 6-digit pincode.');
            frappe.web_form.set_value('state', '');
            frappe.web_form.set_value('district', '');
            return;
        }

        fetch(`https://api.postalpincode.in/pincode/${pin}`)
            .then(res => res.json())
            .then(data => {
                if (data && data[0] && data[0].Status === 'Success') {
                    const po = data[0].PostOffice[0];
                    frappe.web_form.set_value('state', po.State);
                    frappe.web_form.set_value('district', po.District);
                } else {
                    frappe.web_form.set_value('state', '');
                    frappe.web_form.set_value('district', '');
                    frappe.msgprint('Invalid pincode. No matching location found — please check and re-enter.');
                }
            })
            .catch((err) => {
                console.error('Pincode lookup failed:', err);
                frappe.msgprint('Could not fetch location for this pincode. Please check your connection.');
            });
    });

    // 6. Date of Birth -> auto-calculate Age + block future dates
    frappe.web_form.on('date_of_birth', (field, value) => {
        if (!value) return;

        const dob = new Date(value);
        const today = new Date();

        if (dob > today) {
            frappe.msgprint('Date of Birth cannot be in the future.');
            frappe.web_form.set_value('date_of_birth', '');
            frappe.web_form.set_value('age', '');
            return;
        }

        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
            age--;
        }
        frappe.web_form.set_value('age', age);
    });

    // 7. Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function validateEmail(fieldname, value) {
        if (!value) return;
        if (!emailRegex.test(value)) {
            frappe.msgprint('Please enter a valid email address.');
            frappe.web_form.set_value(fieldname, '');
        }
    }
    frappe.web_form.on('email', (field, value) => validateEmail('email', value));
    frappe.web_form.on('requestor_email', (field, value) => validateEmail('requestor_email', value));

    // 8. Mobile number validation
    const mobileRegex = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
    function validateMobile(fieldname, value) {
        if (!value) return;
        const cleaned = String(value).trim();
        if (!mobileRegex.test(cleaned)) {
            frappe.msgprint('Please enter a valid 10-digit mobile number.');
            frappe.web_form.set_value(fieldname, '');
        }
    }
    frappe.web_form.on('mobile_number', (field, value) => validateMobile('mobile_number', value));
    frappe.web_form.on('primary_spoc_mobile_number', (field, value) => validateMobile('primary_spoc_mobile_number', value));
    frappe.web_form.on('primary_contact_mobile', (field, value) => validateMobile('primary_contact_mobile', value));

    // 9. Type of Request -> dynamic labels + show/hide Treatment
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

    // 10. Title + logo swap
    let tries = 0;
    const tryInject = setInterval(() => {
        const titleEl = document.querySelector('.title');
        tries++;
        if (titleEl) {
            clearInterval(tryInject);
            titleEl.classList.remove('ellipsis');
            titleEl.style.whiteSpace = 'normal';
            titleEl.style.overflow = 'visible';
            titleEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">
                    <h5 style="margin-top:24px">Support IID Case Registration - Azim Premji Foundation</h5>
                    <img src="/files/APF%20logo.png" style="height:70px;flex-shrink:0">
                </div>
            `;
        } else if (tries > 20) {
            clearInterval(tryInject);
        }
    }, 100);

    // 11. Supporting Documents — fetched based on selected Type of Request
    function loadDocumentsFor(requestType) {
        var grid = frappe.web_form.fields_dict["supporting_documents"] && frappe.web_form.fields_dict["supporting_documents"].grid;
        if (!grid) {
            setTimeout(() => loadDocumentsFor(requestType), 500);
            return;
        }

        frappe.call({
            method: 'support_iid.case_management.web_form.support_iid_case_registration.support_iid_case_registration.get_document_types',
            args: { type_of_request: requestType },
            callback: function(r) {
                if (!r.message) return;

                frappe.web_form.doc.supporting_documents = [];
                r.message.forEach(function(doc) {
                    frappe.web_form.doc.supporting_documents.push({
                        doctype: "Case Documents",
                        __islocal: 1,
                        parentfield: "supporting_documents",
                        parenttype: frappe.web_form.doc.doctype,
                        parent: frappe.web_form.doc.name,
                        document_name: doc.name
                    });
                });
                grid.refresh();
            }
        });
    }

    frappe.web_form.on('type_of_request', (field, value) => {
        applyRequestTypeLabels(value);
        loadDocumentsFor(value);
    });

    // On initial load: apply labels + load documents if a type is already set, or if not, load the default set once
    if (frappe.web_form.doc.type_of_request) {
        applyRequestTypeLabels(frappe.web_form.doc.type_of_request);
        if ((frappe.web_form.doc.supporting_documents || []).length === 0) {
            loadDocumentsFor(frappe.web_form.doc.type_of_request);
        }
    }

});
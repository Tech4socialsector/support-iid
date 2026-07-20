// frappe.ready(function() {

//     // Make State and District read-only from the start
//     frappe.web_form.set_df_property('state', 'read_only', 1);
//     frappe.web_form.set_df_property('district', 'read_only', 1);

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

// });


frappe.ready(function() {

    // 1. Make State and District read-only from the start
    frappe.web_form.set_df_property('state', 'read_only', 1);
    frappe.web_form.set_df_property('district', 'read_only', 1);

    // 2. Pincode -> auto-fill State & District
    frappe.web_form.on('pincode', (field, value) => {
        const pin = String(value || '').trim();
        if (pin.length !== 6 || isNaN(pin)) {
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
                    frappe.msgprint('Pincode not found. Please enter State and District manually.');
                }
            })
            .catch((err) => {
                console.error('Pincode lookup failed:', err);
                frappe.msgprint('Could not fetch location for this pincode. Please check your connection.');
            });
    });

    // 3. Date of Birth -> auto-calculate Age
    frappe.web_form.on('date_of_birth', (field, value) => {
        if (!value) return;

        const dob = new Date(value);
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();

        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
            age--;
        }

        frappe.web_form.set_value('age', age);
    });

    // 4. Title + logo swap
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

    // 5. Pre-fill Supporting Documents rows from "Documents List"
   function setDefaultDocuments() {
        var grid = frappe.web_form.fields_dict["supporting_documents"] && frappe.web_form.fields_dict["supporting_documents"].grid;
        if (!grid) {
            setTimeout(setDefaultDocuments, 500);
            return;
        }
        if ((frappe.web_form.doc.supporting_documents || []).length > 0) return;

        frappe.call({
            method: 'support_iid.case_management.web_form.support_iid_case_registration.support_iid_case_registration.get_document_types',
            callback: function(r) {
                if (!r.message || !r.message.length) return;

                frappe.web_form.doc.supporting_documents = [];
                r.message.forEach(function(doc) {
                    frappe.web_form.doc.supporting_documents.push({
                        doctype: "Case Documents",
                        __islocal: 1,
                        parentfield: "supporting_documents",
                        parenttype: frappe.web_form.doc.doctype,
                        parent: frappe.web_form.doc.name,
                        document_name: doc.name   // <-- changed from document_type
                    });
                });
                grid.refresh();
            }
        });
    }
    setDefaultDocuments();

});
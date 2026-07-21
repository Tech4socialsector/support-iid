// frappe.pages['case-registry'].on_page_load = function(wrapper) {
// 	var page = frappe.ui.make_app_page({
// 		parent: wrapper,
// 		title: 'Case Registry',
// 		single_column: true
// 	});
// }


frappe.pages['case-registry'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Case Registry',
        single_column: true
    });

    new CaseRegistry(page);
};

class CaseRegistry {
    constructor(page) {
        this.page = page;
        this.wrapper = $(page.body);
        this.current_case = null;

        // ---- Dummy data (swap for frappe.call to "Case Register" later) ----
        this.dummy_cases = [
            {
                name: 'SIID-0000212',
                beneficiary_name: 'Lakshmi Narayanan',
                type_of_request: 'Medical',
                case_status: 'Pending approval',
                status_color: 'warning',
                district: 'Villupuram',
                state: 'Tamil Nadu',
                funds_requested: 180000,
                assigned_to: 'Karthik',
                request_date: '2026-07-18',
                age: 34,
                gender: 'Female',
                mobile_number: '9876543210',
                employment_status: 'Unemployed',
                hospital_institution_name: 'Apollo Hospitals',
                ailment__course_details: 'Cardiac surgery',
                amount_already_spent: 25000,
                documents: [
                    { document_name: 'Aadhar card', attachment: '#' },
                    { document_name: 'Estimation letter', attachment: null }
                ],
                comments: [
                    { author: 'Reviewer - Priya', when: '2 days ago', text: 'Estimate looks reasonable, forwarding for approval.' },
                    { author: 'Approver - Karthik', when: '1 day ago', text: 'Provisionally approved pending physical verification.' }
                ]
            },
            {
                name: 'SIID-0000211',
                beneficiary_name: 'Arun Kumar',
                type_of_request: 'Education',
                case_status: 'Approved',
                status_color: 'success',
                district: 'Chennai',
                state: 'Tamil Nadu',
                funds_requested: 45000,
                assigned_to: 'Priya',
                request_date: '2026-07-15',
                age: 19,
                gender: 'Male',
                mobile_number: '9876500011',
                employment_status: 'Unemployed',
                hospital_institution_name: 'Government Polytechnic College',
                ailment__course_details: 'Diploma in Mechanical Engineering',
                amount_already_spent: 5000,
                documents: [
                    { document_name: 'Aadhar card', attachment: '#' },
                    { document_name: 'Fee structure letter', attachment: '#' }
                ],
                comments: [
                    { author: 'Approver - Karthik', when: '4 days ago', text: 'Approved. Funds released to institution directly.' }
                ]
            },
            {
                name: 'SIID-0000210',
                beneficiary_name: 'Fathima Begum',
                type_of_request: 'Medical',
                case_status: 'Sent back',
                status_color: 'danger',
                district: 'Salem',
                state: 'Tamil Nadu',
                funds_requested: 92500,
                assigned_to: 'Priya',
                request_date: '2026-07-12',
                age: 52,
                gender: 'Female',
                mobile_number: '9876511122',
                employment_status: 'Retired',
                hospital_institution_name: 'Government General Hospital',
                ailment__course_details: 'Knee replacement',
                amount_already_spent: 10000,
                documents: [
                    { document_name: 'Aadhar card', attachment: '#' },
                    { document_name: 'Medical reports', attachment: null }
                ],
                comments: [
                    { author: 'Reviewer - Priya', when: '5 days ago', text: 'Missing medical report. Sent back for correction.' }
                ]
            },
            {
                name: 'SIID-0000209',
                beneficiary_name: 'Ravi Shankar',
                type_of_request: 'Medical',
                case_status: 'Submitted',
                status_color: 'accent',
                district: 'Coimbatore',
                state: 'Tamil Nadu',
                funds_requested: 110000,
                assigned_to: 'Karthik',
                request_date: '2026-07-10',
                age: 41,
                gender: 'Male',
                mobile_number: '9876522233',
                employment_status: 'Employed',
                hospital_institution_name: 'KMCH',
                ailment__course_details: 'Dialysis support',
                amount_already_spent: 0,
                documents: [
                    { document_name: 'Aadhar card', attachment: '#' },
                    { document_name: 'Bank statement', attachment: '#' }
                ],
                comments: []
            },
            {
                name: 'SIID-0000208',
                beneficiary_name: 'Meena Kumari',
                type_of_request: 'Education',
                case_status: 'On hold',
                status_color: 'warning',
                district: 'Madurai',
                state: 'Tamil Nadu',
                funds_requested: 30000,
                assigned_to: 'Priya',
                request_date: '2026-07-08',
                age: 17,
                gender: 'Female',
                mobile_number: '9876533344',
                employment_status: 'Unemployed',
                hospital_institution_name: 'St. Mary\'s Higher Secondary School',
                ailment__course_details: '12th grade support',
                amount_already_spent: 0,
                documents: [
                    { document_name: 'Aadhar card', attachment: '#' }
                ],
                comments: [
                    { author: 'Approver - Karthik', when: '6 days ago', text: 'On hold pending confirmation of scholarship overlap.' }
                ]
            }
        ];

        this.dot_color = {
            warning: '#ffa00a',
            success: '#28a745',
            danger: '#ff5858',
            accent: '#2490ef'
        };

        this.inject_styles();
        this.render_layout();
        this.bind_events();
        this.render_list();
    }

    inject_styles() {
        if ($('#cr-styles').length) return;
        $(`<style id="cr-styles">
            .cr-wrap { padding: 4px 2px 24px; }
            .cr-toolbar { display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; align-items:center; }
            .cr-toolbar input, .cr-toolbar select {
                font-size:13px; padding:6px 10px; border:1px solid #d1d8dd; border-radius:6px;
                background:#fff; color:#36414c; height:32px;
            }
            .cr-toolbar-btn {
                font-size:12.5px; padding:6px 14px; border:1px solid #d1d8dd; border-radius:6px;
                background:#fff; color:#36414c; cursor:pointer;
            }
            .cr-toolbar-btn:hover { background:#f4f5f6; }
            .cr-table-container { border:1px solid #d1d8dd; border-radius:10px; overflow-x:auto; background:#fff; }
            table.cr-table { width:100%; border-collapse:collapse; font-size:13px; }
            table.cr-table th {
                text-align:left; font-weight:600; color:#8d99a6; font-size:12px;
                padding:10px 14px; border-bottom:1px solid #eaebec; white-space:nowrap; background:#fafbfc;
            }
            table.cr-table td { padding:11px 14px; border-bottom:1px solid #eaebec; color:#36414c; white-space:nowrap; }
            tr.cr-row { cursor:pointer; }
            tr.cr-row:hover td { background:#f8f9fa; }
            tr.cr-row:last-child td { border-bottom:none; }
            .cr-dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:7px; }
            .cr-pagination { display:flex; justify-content:flex-end; align-items:center; gap:14px; margin-top:12px; }
            .cr-empty { text-align:center; padding:60px 20px; color:#8d99a6; }

            .cr-detail { display:none; }
            .cr-back-btn {
                display:inline-flex; align-items:center; gap:6px; background:none; border:none;
                color:#2490ef; font-size:13px; font-weight:500; cursor:pointer; margin-bottom:14px; padding:0;
            }
            .cr-detail-header {
                display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;
                border-bottom:1px solid #eaebec; padding-bottom:16px; margin-bottom:16px;
            }
            .cr-detail-title { font-size:20px; font-weight:600; color:#1a1a1a; }
            .cr-detail-sub { font-size:13px; color:#8d99a6; margin-top:4px; }

            .cr-tabs { display:flex; gap:4px; border-bottom:1px solid #eaebec; margin-bottom:20px; }
            .cr-tab {
                padding:9px 18px; font-size:13px; font-weight:500; cursor:pointer;
                color:#8d99a6; border-bottom:2px solid transparent;
            }
            .cr-tab.active { color:#2490ef; border-bottom-color:#2490ef; }
            .cr-tabpanel { display:none; }
            .cr-tabpanel.active { display:block; }

            .cr-section { margin-bottom:24px; }
            .cr-section-title {
                font-size:12.5px; font-weight:600; text-transform:uppercase; letter-spacing:.4px;
                color:#8d99a6; margin-bottom:12px;
            }
            .cr-field-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); gap:16px 24px; }
            .cr-field-label { font-size:11.5px; color:#8d99a6; margin-bottom:2px; }
            .cr-field-value { font-size:13.5px; color:#1a1a1a; }

            .cr-doc-row {
                display:flex; align-items:center; justify-content:space-between; border:1px solid #eaebec;
                border-radius:8px; padding:10px 14px; margin-bottom:8px; background:#fafbfc;
            }
            .cr-doc-link { font-size:12.5px; color:#2490ef; font-weight:500; text-decoration:none; }
            .cr-doc-missing { font-size:12px; color:#b0b8bf; }

            .cr-comment { display:flex; gap:10px; margin-bottom:14px; }
            .cr-avatar {
                width:32px; height:32px; border-radius:50%; background:#e3f1ff; color:#2490ef;
                display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600; flex-shrink:0;
            }
            .cr-comment-body { background:#f4f5f6; border-radius:10px; padding:10px 14px; flex:1; }
            .cr-comment-meta { font-size:11.5px; color:#8d99a6; margin-bottom:4px; }
            .cr-comment-author { font-weight:600; color:#1a1a1a; }
            .cr-comment-text { font-size:13.5px; color:#2a2a2a; }
            .cr-comment-box { display:flex; gap:10px; align-items:flex-start; margin-top:6px; }
            .cr-comment-input {
                flex:1; min-height:44px; border:1px solid #d1d8dd; border-radius:6px;
                padding:10px 12px; font-size:13px; resize:vertical;
            }
            .cr-send-btn {
                background:#2490ef; color:#fff; border:none; border-radius:6px;
                padding:10px 18px; font-size:13px; font-weight:500; cursor:pointer;
            }
            .cr-send-btn:hover { background:#1a7bd1; }

            @media (max-width: 600px) {
                .cr-field-grid { grid-template-columns: 1fr; }
                .cr-detail-header { flex-direction:column; }
            }
        </style>`).appendTo('head');
    }

    render_layout() {
        this.wrapper.html(`
            <div class="cr-wrap">
                <div id="cr-list">
                    <div class="cr-toolbar">
                        <input type="text" id="cr-search" placeholder="Search by case ID or beneficiary" style="width:220px">
                        <select id="cr-status-filter"><option value="">All statuses</option></select>
                        <select id="cr-type-filter"><option value="">All types</option></select>
                        <div style="flex:1"></div>
                        <button class="cr-toolbar-btn"><i class="ti ti-filter" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"></i>Filter</button>
                        <button class="cr-toolbar-btn"><i class="ti ti-arrows-sort" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"></i>Sort</button>
                        <button class="cr-toolbar-btn"><i class="ti ti-columns" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"></i>Columns</button>
                    </div>
                    <div class="cr-table-container">
                        <table class="cr-table">
                            <thead><tr>
                                <th style="width:24px"><input type="checkbox"></th>
                                <th>Case ID</th><th>Beneficiary</th><th>Status</th><th>Type</th>
                                <th>District</th><th>Funds requested</th><th>Assigned to</th><th>Request date</th>
                            </tr></thead>
                            <tbody id="cr-tbody"></tbody>
                        </table>
                    </div>
                    <div class="cr-pagination">
                        <span style="font-size:12.5px;color:var(--text-muted)" id="cr-count"></span>
                        <button class="cr-toolbar-btn" id="cr-load-more">Load more</button>
                    </div>
                </div>

                <div class="cr-detail" id="cr-detail">
                    <button class="cr-back-btn" id="cr-back-btn"><i class="ti ti-arrow-left" aria-hidden="true"></i> Back to all cases</button>
                    <div class="cr-detail-header" id="cr-detail-header"></div>
                    <div class="cr-tabs">
                        <div class="cr-tab active" data-tab="details">Case details</div>
                        <div class="cr-tab" data-tab="conversation">Conversation</div>
                    </div>
                    <div class="cr-tabpanel active" id="cr-tab-details"></div>
                    <div class="cr-tabpanel" id="cr-tab-conversation"></div>
                </div>
            </div>
        `);

        this.populate_filters();
    }

    populate_filters() {
        const statuses = [...new Set(this.dummy_cases.map(c => c.case_status))];
        const types = [...new Set(this.dummy_cases.map(c => c.type_of_request))];
        const status_select = this.wrapper.find('#cr-status-filter');
        const type_select = this.wrapper.find('#cr-type-filter');
        statuses.forEach(s => status_select.append(`<option value="${s}">${s}</option>`));
        types.forEach(t => type_select.append(`<option value="${t}">${t}</option>`));
    }

    bind_events() {
        this.wrapper.on('input', '#cr-search', frappe.utils.debounce(() => this.render_list(), 250));
        this.wrapper.on('change', '#cr-status-filter, #cr-type-filter', () => this.render_list());
        this.wrapper.on('click', '#cr-back-btn', () => this.show_list());
        this.wrapper.on('click', '.cr-tab', (e) => this.switch_tab($(e.currentTarget).data('tab')));
        this.wrapper.on('click', '#cr-send-comment', () => this.send_comment());
        this.wrapper.on('click', '#cr-load-more', () => frappe.show_alert({ message: 'No more cases to load (dummy data)', indicator: 'blue' }));
    }

    switch_tab(tab) {
        this.wrapper.find('.cr-tab').removeClass('active');
        this.wrapper.find(`.cr-tab[data-tab="${tab}"]`).addClass('active');
        this.wrapper.find('.cr-tabpanel').removeClass('active');
        this.wrapper.find(`#cr-tab-${tab}`).addClass('active');
    }

    show_list() {
        this.wrapper.find('#cr-list').show();
        this.wrapper.find('#cr-detail').hide();
    }

    show_detail() {
        this.wrapper.find('#cr-list').hide();
        this.wrapper.find('#cr-detail').show();
    }

    get_filtered_cases() {
        const search = (this.wrapper.find('#cr-search').val() || '').toLowerCase();
        const status = this.wrapper.find('#cr-status-filter').val() || '';
        const type = this.wrapper.find('#cr-type-filter').val() || '';

        return this.dummy_cases.filter(c => {
            if (status && c.case_status !== status) return false;
            if (type && c.type_of_request !== type) return false;
            if (search && !(
                c.name.toLowerCase().includes(search) ||
                c.beneficiary_name.toLowerCase().includes(search)
            )) return false;
            return true;
        });
    }

    render_list() {
        const rows = this.get_filtered_cases();
        const tbody = this.wrapper.find('#cr-tbody');

        if (!rows.length) {
            tbody.html(`<tr><td colspan="9" class="cr-empty">No cases found.</td></tr>`);
            this.wrapper.find('#cr-count').text('0 of 0');
            return;
        }

        tbody.html(rows.map(c => `
            <tr class="cr-row" data-name="${c.name}">
                <td onclick="event.stopPropagation()"><input type="checkbox"></td>
                <td style="font-weight:500;color:var(--text-secondary)">${c.name}</td>
                <td style="font-weight:500">${frappe.utils.escape_html(c.beneficiary_name)}</td>
                <td><span class="cr-dot" style="background:${this.dot_color[c.status_color]}"></span>${c.case_status}</td>
                <td>${c.type_of_request}</td>
                <td>${c.district}</td>
                <td style="font-weight:500">${format_currency(c.funds_requested)}</td>
                <td>${c.assigned_to}</td>
                <td style="color:var(--text-secondary)">${frappe.datetime.str_to_user(c.request_date)}</td>
            </tr>
        `).join(''));

        this.wrapper.find('#cr-count').text(`${rows.length} of ${this.dummy_cases.length}`);

        tbody.find('.cr-row').on('click', (e) => {
            this.open_case_detail($(e.currentTarget).data('name'));
        });
    }

    field_block(label, value, opts = {}) {
        const empty = (value === undefined || value === null || value === '');
        let display = empty ? 'Not provided' : value;
        if (opts.currency && !empty) display = format_currency(value);
        return `
            <div>
                <div class="cr-field-label">${label}</div>
                <div class="cr-field-value ${empty ? 'empty' : ''}">${frappe.utils.escape_html(String(display))}</div>
            </div>
        `;
    }

    open_case_detail(name) {
        const doc = this.dummy_cases.find(c => c.name === name);
        if (!doc) return;
        this.current_case = doc;
        this.render_detail(doc);
        this.render_conversation(doc);
        this.show_detail();
        this.switch_tab('details');
    }

    render_detail(doc) {
        this.wrapper.find('#cr-detail-header').html(`
            <div>
                <div class="cr-detail-title">${frappe.utils.escape_html(doc.beneficiary_name)}</div>
                <div class="cr-detail-sub">${doc.name} &middot; ${doc.type_of_request}</div>
            </div>
            <span style="font-size:13px;color:#36414c;font-weight:500"><span class="cr-dot" style="background:${this.dot_color[doc.status_color]}"></span>${doc.case_status}</span>
        `);

        const isMedical = doc.type_of_request === 'Medical';

        const html = `
            <div class="cr-section">
                <div class="cr-section-title">Beneficiary information</div>
                <div class="cr-field-grid">
                    ${this.field_block('Age', doc.age)}
                    ${this.field_block('Gender', doc.gender)}
                    ${this.field_block('District', doc.district)}
                    ${this.field_block('State', doc.state)}
                    ${this.field_block('Mobile number', doc.mobile_number)}
                    ${this.field_block('Employment status', doc.employment_status)}
                </div>
            </div>

            <div class="cr-section">
                <div class="cr-section-title">Request details</div>
                <div class="cr-field-grid">
                    ${this.field_block(isMedical ? 'Hospital name' : 'Institution name', doc.hospital_institution_name)}
                    ${this.field_block(isMedical ? 'Ailment details' : 'Course details', doc.ailment__course_details)}
                    ${this.field_block('Funds requested', doc.funds_requested, { currency: true })}
                    ${this.field_block('Amount already spent', doc.amount_already_spent, { currency: true })}
                </div>
            </div>

            <div class="cr-section">
                <div class="cr-section-title">Supporting documents</div>
                ${doc.documents.map(d => `
                    <div class="cr-doc-row">
                        <span style="font-size:13px"><i class="ti ti-file" aria-hidden="true" style="margin-right:8px;vertical-align:-3px"></i>${frappe.utils.escape_html(d.document_name)}</span>
                        ${d.attachment
                ? `<a class="cr-doc-link" href="${d.attachment}" target="_blank">View</a>`
                : `<span class="cr-doc-missing">Not uploaded</span>`}
                    </div>
                `).join('')}
            </div>
        `;

        this.wrapper.find('#cr-tab-details').html(html);
    }

    render_conversation(doc) {
        const thread = doc.comments.length
            ? doc.comments.map(c => `
                <div class="cr-comment">
                    <div class="cr-avatar">${c.author.charAt(0).toUpperCase()}</div>
                    <div class="cr-comment-body">
                        <div class="cr-comment-meta"><span class="cr-comment-author">${frappe.utils.escape_html(c.author)}</span> &middot; ${c.when}</div>
                        <div class="cr-comment-text">${frappe.utils.escape_html(c.text)}</div>
                    </div>
                </div>
            `).join('')
            : `<div class="cr-empty">No comments yet — start the conversation below.</div>`;

        this.wrapper.find('#cr-tab-conversation').html(`
            <div id="cr-thread">${thread}</div>
            <div class="cr-comment-box">
                <textarea class="cr-comment-input" id="cr-comment-input" placeholder="Add a comment..."></textarea>
                <button class="cr-send-btn" id="cr-send-comment">Send</button>
            </div>
        `);
    }

    send_comment() {
        const input = this.wrapper.find('#cr-comment-input');
        const text = (input.val() || '').trim();
        if (!text || !this.current_case) return;

        this.current_case.comments.push({
            author: frappe.session.user_fullname || 'You',
            when: 'just now',
            text: text
        });
        input.val('');
        this.render_conversation(this.current_case);
    }
}
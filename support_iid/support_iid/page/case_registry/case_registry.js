frappe.pages['case-registry'].on_page_load = function (wrapper) {
	if (!document.getElementById('siid-office-preview-script')) {
		var s = document.createElement('script');
		s.id = 'siid-office-preview-script';
		s.src = '/assets/support_iid/js/office_preview.js';
		document.head.appendChild(s);
	}

	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Case Register',
		single_column: true
	});

	page.set_secondary_action('New Case', function () {
		frappe.new_doc('Case Register');
	}, 'add');

	new CaseListView(page);
};

// Fields fetched for the list rows only. Full detail is fetched on demand.
const CASE_LIST_FIELDS = [
	'name', 'beneficiary_name', 'requestor_name', 'type_of_request',
	'case_status', 'current_approval_level', 'funds_requested', 'district', 'state', 'request_date'
];

const STATUS_COLOR = {
	'Draft': 'gray', 'Submitted': 'blue', 'Rejected': 'red',
	'Sent Back': 'yellow', 'On Hold': 'orange', 'Closed': 'gray',
	'Approved': 'green', 'Withdrawn by the Requester': 'gray'
};

// The stored case_status value stays "Sent Back" (Link value, used in
// filters/data/comparisons everywhere) — this is the one place that
// value should actually show something friendlier to a user: "Pending
// with Requester" instead of the more passive "Sent Back".
//
// "Rejected" is flagged as a restricted/spam-trigger word by some
// outgoing-mail providers — shown as "Declined" everywhere instead
// (matching the wording already used for the Decline action). The
// stored case_status value stays "Rejected" for data/filter
// consistency.
const STATUS_DISPLAY_LABELS = { 'Sent Back': 'Pending with Requester', 'Rejected': 'Declined' };
function status_display_label(status) {
	return STATUS_DISPLAY_LABELS[status] || status;
}

// Case Status is now a fixed Link value ("Pending Approval") with the
// current approval level tracked separately — this composes the two back
// into one display string, e.g. "Pending Approval (L1 Reviewer)".
function display_status(c) {
	var label = status_display_label(c.case_status);
	if ((c.case_status === 'Pending Approval' || c.case_status === 'Sent Back') && c.current_approval_level) {
		return `${label} (${c.current_approval_level})`;
	}
	return label || '';
}

function status_color(status) {
	if (STATUS_COLOR[status]) return STATUS_COLOR[status];
	if (!status) return 'gray';
	if (status.indexOf('Pending Approval') === 0) return 'orange';
	return 'blue';
}

const ACTION_LABEL = { 'Approve': 'Approve', 'Decline': 'Decline', 'Send Back': 'Send Back' };
const ACTION_PAST = { 'Approve': 'approved', 'Decline': 'declined', 'Send Back': 'sent back' };

// Same public dataset used on the Support IID Dashboard's State/District
// filters, so both pages offer the same real dropdown options instead of
// free text.
const INDIA_LOCATION_URL = 'https://raw.githubusercontent.com/sab99r/Indian-States-And-Districts/master/states-and-districts.json';

const STATUS_HEX = {
	gray: '#9aa1a8', blue: '#2490ef', orange: '#e29a3d',
	green: '#2f9e5b', red: '#e0524c', purple: '#8a63d2', yellow: '#d4b106'
};

function relative_date(date_str) {
	if (!date_str) return '';
	try {
		return frappe.datetime.comment_when(date_str, true);
	} catch (e) {
		return frappe.datetime.str_to_user(date_str);
	}
}

// ---------------------------------------------------------------
// SAMPLE DATA — for testing the UI without real database records.
// Toggle "Test Mode" in the toolbar to browse/act on these instead
// of calling the server. Nothing here is saved to the database.
// ---------------------------------------------------------------
const SAMPLE_CASES = [
	{
		name: 'SIID-TEST-001', beneficiary_name: 'Lakshmi Narayanan',
		type_of_request: 'Medical', case_status: 'Pending Approval', current_approval_level: 'L1 Reviewer',
		request_date: '2026-07-18', funds_requested: 180000, amount_already_spent: 25000,
		annual_family_income: 120000, district: 'Villupuram', state: 'Tamil Nadu', pincode: 605602,
		address_line_1: '12, Gandhi Nagar, Villupuram', age: 34, gender: 'Female',
		mobile_number: '9876543210', email: '', qualification: 'Graduation',
		employment_status: 'Unemployed', marital_status: 'Married',
		requestor_email: 'priya.s@azimpremjifoundation.org', requestor_name: 'Priya Selvam',
		department: 'Health Operations', work_location: 'Chennai', source_of_request: 'Health operations',
		hospital_institution_name: 'Apollo Hospitals, Chennai', hospital_institution_location: 'Chennai',
		ailment__course_details: 'Cardiac valve replacement surgery', treatment: 'Open heart surgery',
		insurance_type: 'PMJAY', insurance_coverage_details: 'PMJAY covers up to Rs 5 lakhs. Surgery costs Rs 8 lakhs. Gap of Rs 1.8 lakhs needs support.',
		residence_type: 'Rent', residence_details: '1BHK, Rs 4000/month rent',
		existing_debt: 'Rs 2000/month EMI for personal loan',
		physical_verification: 'Yes',
		physical_verification_notes: 'Visited 10 July. Family of 4 in 1BHK rental. No four-wheeler. Husband is daily wage labourer.',
		genuineness_assessment: 'Bills verified. Hospital estimate letter confirmed. Case is genuine.',
		vulnerability_assessment: 'Low income household. Non-earning patient with two school-age children.',
		milaap_campaign_link: 'https://milaap.org/fundraisers/lakshmi-heart',
		milaap_recommendation: 'Recommended for Milaap campaign.',
		note_about_the_individual: 'Lakshmi is a 34-year-old homemaker with two children aged 8 and 11. Her husband works as a daily wage labourer.',
		family_members: [
			{ member_name: 'Rajan K', relationship: 'Husband', age: '38', occupation: 'Daily wage labourer', monthly_income: 9000, marital_status: 'Married', qualification: 'Class 10' },
			{ member_name: 'Kavya', relationship: 'Daughter', age: '11', occupation: 'Student', monthly_income: 0, marital_status: 'Unmarried', qualification: 'Class 5' }
		],
		supporting_documents: [
			{ document_name: 'Aadhar card', attachment: '#', remarks: 'Verified' },
			{ document_name: 'Bank statement', attachment: '#', remarks: '' },
			{ document_name: 'Hospital estimate letter', attachment: null, remarks: 'Pending upload' }
		],
		case_approval_stage: [
			{ name: 'CA-T001', case_approval_level_decription: 'L1 Reviewer', case_approval_status: 'Awaiting For Approval', approver_name: 'Karthik Rajan', approver_email: 'karthik.r@azimpremjifoundation.org' },
			{ name: 'CA-T002', case_approval_level_decription: 'L2 Approver', case_approval_status: '', approver_name: 'Deepa Murali', approver_email: 'deepa.m@azimpremjifoundation.org' }
		],
		case_approval_log: []
	},
	{
		name: 'SIID-TEST-002', beneficiary_name: 'Arun Kumar',
		type_of_request: 'Education', case_status: 'Approved',
		request_date: '2026-07-15', funds_requested: 45000, amount_already_spent: 5000,
		annual_family_income: 85000, district: 'Chennai', state: 'Tamil Nadu', pincode: 600001,
		address_line_1: '45, Anna Salai, Chennai', age: 19, gender: 'Male',
		mobile_number: '9876500011', email: 'arun.k@gmail.com', qualification: '12th',
		employment_status: 'Unemployed', marital_status: 'Unmarried',
		requestor_email: 'arun.k@azimpremjifoundation.org', requestor_name: 'Arun Krishnan',
		department: 'Philanthropy', work_location: 'Chennai', source_of_request: 'Philanthropy member',
		hospital_institution_name: 'Government Polytechnic College, Chennai', hospital_institution_location: 'Chennai',
		ailment__course_details: 'Diploma in Mechanical Engineering — 3 year course', treatment: '',
		insurance_type: 'No Insurance', insurance_coverage_details: '',
		residence_type: 'Own', residence_details: '2BHK owned house', existing_debt: '',
		physical_verification: 'Yes', physical_verification_notes: 'Modest but stable household.',
		genuineness_assessment: 'Admission letter and fee receipt verified.',
		vulnerability_assessment: 'First-generation college student. Father on Rs 7000/month pension.',
		milaap_campaign_link: '', milaap_recommendation: 'Not recommended.',
		note_about_the_individual: 'Arun secured admission to Government Polytechnic on merit. Family cannot afford first-year fees of Rs 45,000.',
		family_members: [
			{ member_name: 'Rajan Kumar', relationship: 'Father', age: '58', occupation: 'Retired', monthly_income: 7000, marital_status: 'Married', qualification: 'Graduation' },
			{ member_name: 'Meena Kumar', relationship: 'Mother', age: '52', occupation: 'Homemaker', monthly_income: 0, marital_status: 'Married', qualification: '12th' }
		],
		supporting_documents: [
			{ document_name: 'Aadhar card', attachment: '#', remarks: '' },
			{ document_name: 'Fee structure letter', attachment: '#', remarks: '' },
			{ document_name: 'Admission letter', attachment: '#', remarks: '' }
		],
		case_approval_stage: [
			{ name: 'CA-T003', case_approval_level_decription: 'L1 Reviewer', case_approval_status: 'Approve', approver_name: 'Arun Krishnan', approver_email: 'arun.k@azimpremjifoundation.org' },
			{ name: 'CA-T004', case_approval_level_decription: 'L2 Approver', case_approval_status: 'Approve', approver_name: 'Karthik Rajan', approver_email: 'karthik.r@azimpremjifoundation.org' }
		],
		case_approval_log: [
			{ date: '2026-07-16', level: 'L1 Reviewer', approver_name: 'Arun Krishnan', action: 'Approve', comments: 'Documents verified. Genuine case.' },
			{ date: '2026-07-17', level: 'L2 Approver', approver_name: 'Karthik Rajan', action: 'Approve', comments: 'Approved for Rs 45,000.' }
		]
	},
	{
		name: 'SIID-TEST-003', beneficiary_name: 'Fathima Begum',
		type_of_request: 'Medical', case_status: 'Sent Back',
		request_date: '2026-07-12', funds_requested: 92500, amount_already_spent: 10000,
		annual_family_income: 96000, district: 'Salem', state: 'Tamil Nadu', pincode: 636001,
		address_line_1: '8, Mosque Street, Salem', age: 52, gender: 'Female',
		mobile_number: '9876511122', email: '', qualification: '10th',
		employment_status: 'Retired', marital_status: 'Married',
		requestor_email: 'mohan.v@azimpremjifoundation.org', requestor_name: 'Mohan Velu',
		department: 'Field State', work_location: 'Salem', source_of_request: 'Field State',
		hospital_institution_name: 'Government General Hospital, Salem', hospital_institution_location: 'Salem',
		ailment__course_details: 'Total knee replacement — bilateral', treatment: 'Bilateral TKR surgery',
		insurance_type: 'State Insurance', insurance_coverage_details: 'State insurance covers Rs 40,000. Remaining Rs 52,500 is out of pocket.',
		residence_type: 'Own', residence_details: '2BHK owned house', existing_debt: '',
		physical_verification: 'No', physical_verification_notes: '', genuineness_assessment: '', vulnerability_assessment: '',
		milaap_campaign_link: '', milaap_recommendation: '',
		note_about_the_individual: 'Retired school teacher. Husband also retired. Both have limited pension income.',
		family_members: [
			{ member_name: 'Abdul Kader', relationship: 'Husband', age: '56', occupation: 'Retired', monthly_income: 6000, marital_status: 'Married', qualification: 'Graduation' }
		],
		supporting_documents: [
			{ document_name: 'Aadhar card', attachment: '#', remarks: '' },
			{ document_name: 'Medical reports', attachment: null, remarks: 'Missing' }
		],
		case_approval_stage: [
			{ name: 'CA-T005', case_approval_level_decription: 'L1 Reviewer', case_approval_status: 'Send Back', approver_name: 'Mohan Velu', approver_email: 'mohan.v@azimpremjifoundation.org' }
		],
		case_approval_log: [
			{ date: '2026-07-13', level: 'L1 Reviewer', approver_name: 'Mohan Velu', action: 'Send Back', comments: 'Medical reports and estimate letter missing. Please upload and resubmit.' }
		]
	}
];

class CaseListView {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.page_length = 20;
		this.page_num = 0;
		this.sort_field = 'request_date';
		this.sort_order = 'desc';
		this.all_rows = [];

		this.inject_styles();
		this.render_layout();
		this.bind_events();
		this.setup_routing();
		this.load_data();
	}

	// Keeps the browser's Back/Forward buttons in sync with list <-> detail
	// navigation by pushing a hash whenever a case is opened, and reacting
	// to hashchange (fired on both our own navigation and browser back/forward).
	setup_routing() {
		var self = this;
		this._hash_handler = function () {
			var match = window.location.hash.match(/^#case-list\/(.+)$/);
			if (match) {
				var name = decodeURIComponent(match[1]);
				if (!self.current || self.current.name !== name) {
					self.open_detail(name, true);
				}
			} else {
				self.show_list_view(true);
			}
		};
		window.addEventListener('hashchange', this._hash_handler);

		// Support opening a case directly via a deep link on first load
		var initial = window.location.hash.match(/^#case-list\/(.+)$/);
		if (initial) {
			this.open_detail(decodeURIComponent(initial[1]), true);
		}
	}

	show_list_view(skip_hash) {
		this.current = null;
		this.wrapper.find('#cl-detail-view').hide();
		this.wrapper.find('#cl-list-view').show();
		this.load_data();
		if (!skip_hash && !/^#case-list\/?$/.test(window.location.hash)) {
			window.location.hash = 'case-list';
		}
	}

	inject_styles() {
		if ($('#cl-style').length) return;
		$(`<style id="cl-style">
			.cl-page { padding:20px 28px 40px; }

			/* Hero card — the one place we keep a "card" look. Soft elevation
			   (shadow + thin border) instead of a flat outline, so it reads as
			   "raised" rather than a bare bordered box — the app-shell look. */
			.cl-card { background:var(--card-bg,#fff); border:1px solid var(--border-color,#d1d8dd); border-radius:12px; padding:20px 22px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04); }
			.cl-hero { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; }
			.cl-hero-name { font-size:23px; font-weight:700; margin-bottom:14px; letter-spacing:-.01em; }
			.cl-hero-stats { display:flex; flex-wrap:wrap; gap:0; }
			.cl-hero-stat { padding:0 22px; border-right:1px solid var(--border-color,#e3e8ec); }
			.cl-hero-stat:first-child { padding-left:0; }
			.cl-hero-stat:last-child { border-right:none; }
			.cl-hero-stat-label { font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted,#8d99a6); margin-bottom:5px; }
			.cl-hero-stat-value { font-size:14px; font-weight:600; color:var(--text-color,#1a1a1a); }
			.cl-hero-amount { font-size:25px; font-weight:700; }
			.cl-hero-amount-label { font-size:11px; color:var(--text-muted,#8d99a6); text-transform:uppercase; letter-spacing:.04em; }

			.cl-tabs { display:flex; gap:4px; border-bottom:1px solid var(--border-color,#d1d8dd); margin-bottom:20px; overflow-x:auto; }
			.cl-tab { padding:9px 16px; cursor:pointer; font-size:13px; font-weight:500; color:var(--text-muted,#8d99a6); border-bottom:2px solid transparent; white-space:nowrap; }
			.cl-tab.on { color:var(--text-color,#1a1a1a); border-bottom-color:var(--primary,#2490ef); }
			.cl-panel { display:none; }
			.cl-panel.on { display:block; }

			/* Overview / Family — Frappe-form style: label above value, in a field grid */
			.cl-section { padding:0 24px 20px 0; }
			.cl-section-title { font-size:13px; font-weight:700; color:var(--text-color,#1a1a1a); margin-bottom:16px; padding-bottom:10px; border-bottom:2px solid var(--border-color,#d1d8dd); }
			.cl-field-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:16px 20px; }
			.cl-field-grid.cl-field-grid-wide { grid-template-columns:1fr; }
			.cl-field { min-width:0; }
			.cl-field-label { font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted,#8d99a6); margin-bottom:5px; }
			.cl-field-value { font-size:13.5px; font-weight:500; color:var(--text-color,#1a1a1a); word-break:break-word; line-height:1.45; }
			.cl-field-value.cl-empty { color:var(--text-muted,#b8bfc6); font-weight:400; font-style:italic; }

			/* responsive column grid — 1 col narrow, 2 cols wider. The last section
			   in each panel spans the full row (see 'cl-span-full') so odd counts
			   never leave a lonely half-empty column. */
			.cl-grid { display:grid; grid-template-columns:1fr; column-gap:32px; }
			@media (min-width: 900px) { .cl-grid { grid-template-columns: repeat(2, 1fr); } }
			.cl-grid .cl-section:nth-child(odd) { border-right:1px solid var(--border-color,#eceef0); }
			.cl-grid .cl-section:last-child { border-right:none; }
			.cl-span-full { grid-column:1/-1; }

			/* document cards */
			.cl-doc-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px; }
			.cl-doc-card { border:1px solid var(--border-color,#e3e8ec); border-radius:10px; padding:16px 14px; cursor:pointer; transition:box-shadow .12s, transform .12s; background:var(--card-bg,#fff); box-shadow:0 1px 2px rgba(0,0,0,.04); }
			.cl-doc-card:hover { box-shadow:0 4px 14px rgba(0,0,0,.08); transform:translateY(-1px); }
			.cl-doc-card.cl-doc-missing-card { cursor:default; opacity:.6; }
			.cl-doc-card-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; }
			.cl-doc-icon { width:36px; height:36px; border-radius:8px; background:var(--primary,#2490ef); color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; text-transform:uppercase; flex-shrink:0; }
			.cl-doc-card-actions { display:flex; align-items:center; gap:4px; }
			.cl-doc-download-btn {
				width:28px; height:28px; border-radius:8px; background:var(--control-bg,#f4f5f7); color:#6b7280;
				display:inline-flex; align-items:center; justify-content:center;
				text-decoration:none; border:none; cursor:pointer; transition:background .12s,color .12s;
			}
			.cl-doc-download-btn:hover { background:#e0e7ff; color:#6366f1; }
			.cl-doc-download-disabled { opacity:.35; cursor:not-allowed; }
			.cl-doc-name { font-weight:600; font-size:13.5px; margin-bottom:2px; }
			.cl-doc-remarks { color:var(--text-muted,#8d99a6); font-size:12px; }
			.cl-doc-missing { color:var(--text-muted,#8d99a6); font-style:italic; font-size:12.5px; }

			.cl-family-table { border-collapse:collapse; width:100%; }
			.cl-family-table th { border:none; border-bottom:1px solid var(--border-color,#d1d8dd); background:transparent; font-weight:600; font-size:11.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted,#8d99a6); text-align:left; padding:10px 14px; }
			.cl-family-table td { border:none; border-bottom:1px solid var(--border-color,#f0f2f5); padding:10px 14px; font-size:13px; }
			.cl-family-table tr:last-child td { border-bottom:none; }

			.cl-stage-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border-color,#f0f2f5); font-size:13px; }
			.cl-stage-row:last-child { border-bottom:none; }
			.cl-log-item { padding:10px 0; border-bottom:1px solid var(--border-color,#f0f2f5); font-size:13px; }
			.cl-log-item:last-child { border-bottom:none; }
			.cl-log-meta { color:var(--text-muted,#8d99a6); font-size:11.5px; margin-bottom:2px; }

			/* List table — normal spreadsheet-style grid, black/white only. Status is the one place color is used. */
			#cl-table { border-collapse:separate; border-spacing:0; width:100%; }
			#cl-table th, #cl-table td { border-bottom:1px solid #e4e6e9; border-right:1px solid #e4e6e9; padding:11px 16px; font-size:13px; vertical-align:middle; }
			#cl-table th:last-child, #cl-table td:last-child { border-right:none; }
			#cl-table thead th {
				background:#f2f3f5; font-weight:700; font-size:11.5px; text-transform:uppercase; letter-spacing:.04em;
				color:#1a1a1a; text-align:left; white-space:nowrap; user-select:none; border-top:none;
				position:sticky; top:0; z-index:1;
			}
			#cl-table thead th.cl-sortable { cursor:pointer; }
			#cl-table thead th .cl-sort-arrow { color:#9aa1a8; margin-left:5px; font-size:11px; }
			#cl-table thead th.cl-sort-active .cl-sort-arrow { color:#1a1a1a; }
			#cl-table tbody tr:nth-child(even) td { background:#fafafa; }
			#cl-table tbody tr:hover td { background:#f0f4f9; }
			#cl-table tbody tr:last-child td { border-bottom:none; }
			#cl-table .cl-row-num { color:#9aa1a8; font-size:12.5px; width:36px; text-align:center; }
			#cl-table .cl-case-id { font-weight:600; color:#1a1a1a; font-size:12.5px; }
			#cl-table .cl-beneficiary { font-weight:600; color:#1a1a1a; }
			#cl-table .cl-amount { font-weight:600; text-align:right; font-variant-numeric:tabular-nums; }
			#cl-table .cl-muted-cell { color:#6b7076; }
			#cl-table .cl-type-chip { display:inline-block; padding:2px 10px; border:1px solid #d0d3d8; border-radius:20px; font-size:11.5px; font-weight:600; color:#3a3f45; }

			/* Frappe's own .indicator-pill has a fixed 20px height, which
			   breaks for longer combined text like "Pending with Requester
			   (L2)" — the text wraps to a second line but the pill box
			   doesn't grow, so the wrapped line overlaps/clips instead of
			   just being a taller pill. Overridden here (not in frappe's
			   own scss) to size to its content on one line instead. */
			#cl-table .indicator-pill, .cl-modal .indicator-pill {
				height:auto; min-height:20px; white-space:nowrap; max-width:none;
			}

			/* subtle colored accent tying each row to its status, inset so it doesn't disturb the grid borders */
			#cl-table tbody tr td:first-child { box-shadow:inset 3px 0 0 0 var(--cl-row-accent, transparent); }

			/* toolbar — per-column filter inputs (native Frappe control look) + icon buttons.
			   Sticky so it stays visible while scrolling a long list, with a
			   subtle backdrop so table rows don't show through underneath it. */
			.cl-toolbar-row {
				display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:14px;
				position:sticky; top:0; z-index:2; background:var(--card-bg,#fff);
				padding:10px 0; margin-left:-2px; margin-right:-2px;
			}
			.cl-toolbar-row .form-control { border-radius:8px; }
			.cl-icon-btn {
				width:32px; height:32px; border:1px solid var(--border-color,#d1d8dd); border-radius:8px;
				background:var(--card-bg,#fff); display:inline-flex; align-items:center; justify-content:center;
				cursor:pointer; color:var(--text-muted,#8d99a6); font-size:14px; flex-shrink:0;
				transition:background .12s, color .12s, box-shadow .12s;
			}
			.cl-icon-btn:hover { background:var(--control-bg,#f4f5f7); color:var(--text-color,#1a1a1a); box-shadow:0 1px 2px rgba(0,0,0,.05); }

			.cl-list-footer { display:flex; justify-content:space-between; align-items:center; margin-top:12px; flex-wrap:wrap; gap:8px; }
			.cl-list-footer-right { display:flex; align-items:center; gap:12px; }

			/* Numbered pagination — same look as the dashboard's drill-down grid */
			.cl-pagination-controls { display:flex; align-items:center; gap:5px; }
			.cl-pagination-controls button {
				border:1px solid var(--border-color,#d1d8dd); background:var(--card-bg,#fff); min-width:28px; height:28px; padding:0 8px;
				font-size:12px; border-radius:7px; cursor:pointer; color:var(--text-color,#1a1a1a); display:inline-flex; align-items:center; justify-content:center;
				transition:background .12s, box-shadow .12s;
			}
			.cl-pagination-controls button:hover:not(:disabled) { background:var(--control-bg,#f4f5f7); }
			.cl-pagination-controls button:disabled { opacity:.35; cursor:default; }
			.cl-pagination-controls button.cl-page-num.on { background:var(--primary,#2490ef); color:#fff; border-color:var(--primary,#2490ef); font-weight:600; }

			/* dropdown action button */
			.cl-action-dropdown { position:relative; display:inline-block; }
			.cl-action-dropdown .dropdown-menu { min-width:170px; }
			.cl-action-dropdown .dropdown-menu .dropdown-item[data-action="Decline"] { color:#c0392b; }
			.cl-action-dropdown .dropdown-menu .dropdown-item[data-action="Send Back"] { color:#b9770e; }

			/* modal / lightbox — shared by document preview + action confirmation */
			.cl-modal-backdrop { position:fixed; inset:0; background:rgba(15,18,22,.55); z-index:1200; display:flex; align-items:center; justify-content:center; padding:14px; }
			.cl-modal { background:var(--card-bg,#fff); border-radius:14px; max-width:900px; width:100%; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.3), 0 2px 6px rgba(0,0,0,.08); }
			.cl-modal.cl-modal-lg { max-width:720px; }
			.cl-modal-header { display:flex; align-items:center; justify-content:space-between; padding:18px 26px; border-bottom:1px solid var(--border-color,#e3e8ec); flex-wrap:wrap; gap:10px; }
			.cl-modal-title { font-weight:700; font-size:16px; }
			.cl-modal-close { cursor:pointer; font-size:22px; line-height:1; color:var(--text-muted,#8d99a6); background:none; border:none; border-radius:6px; transition:background .12s, color .12s; }
			.cl-modal-close:hover { color:var(--text-color,#1a1a1a); background:var(--control-bg,#f4f5f7); }
			.cl-modal-body { padding:26px; overflow:auto; flex:1; background:var(--subtle-fg,#f7f8fa); }
			.cl-modal-body.cl-modal-body-plain { background:var(--card-bg,#fff); }
			.cl-modal-footer { padding:16px 26px; border-top:1px solid var(--border-color,#e3e8ec); display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap; }

			/* Buttons & inputs — clearer tactile hover/focus states, accent-blue focus ring */
			.cl-page .btn { border-radius:8px; transition:box-shadow .12s, filter .12s, background .12s; }
			.cl-page .btn-primary, .cl-page button#cl-action-submit { box-shadow:0 1px 2px rgba(0,0,0,.08); }
			.cl-page .btn-primary:hover, .cl-page button#cl-action-submit:hover { filter:brightness(0.93); }
			.cl-page .form-control, .cl-modal .form-control {
				border-radius:8px; border:1px solid var(--border-color,#d1d8dd); background:var(--control-bg,var(--card-bg,#fff));
				transition:border-color .12s, box-shadow .12s;
			}
			.cl-page .form-control:focus, .cl-modal .form-control:focus {
				border-color:var(--primary,#2490ef); box-shadow:0 0 0 2px rgba(36,144,239,.18); outline:none;
			}

			/* Mobile — collapse doc/field grids to a single column, keep tables scrollable */
			@media (max-width: 640px) {
				.cl-page { padding:14px 14px 32px; }
				.cl-hero-stat { padding:0 14px; }
				.cl-doc-grid, .cl-field-grid { grid-template-columns:1fr; }
				.cl-grid .cl-section { border-right:none !important; }
				.cl-toolbar-row { position:static; }
			}
		</style>`).appendTo('head');
	}

	render_layout() {
		this.wrapper.html(`
			<div class="cl-page">
			<div id="cl-list-view">
				<div class="cl-toolbar-row">
					<input type="text" id="cl-f-id" class="form-control" placeholder="Case ID" style="max-width:120px;flex:1 1 100px">
					<input type="text" id="cl-f-beneficiary" class="form-control" placeholder="Beneficiary" style="max-width:150px;flex:1 1 120px">
					<input type="text" id="cl-f-requestor" class="form-control" placeholder="Requestor" style="max-width:150px;flex:1 1 120px">
					<select id="cl-f-state" class="form-control" style="max-width:140px;flex:1 1 120px">
						<option value="">All states</option>
					</select>
					<select id="cl-f-district" class="form-control" style="max-width:140px;flex:1 1 120px">
						<option value="">All districts</option>
					</select>
					<select id="cl-status" class="form-control" style="max-width:190px;flex:1 1 150px">
						<option value="">All statuses</option>
						<option>Pending Approval</option>
						<option>Approved</option>
						<option value="Rejected">Declined</option>
						<option value="Sent Back">Pending with Requester</option>
						<option>On Hold</option>
						<option>Closed</option>
					</select>
					<select id="cl-type" class="form-control" style="max-width:140px;flex:1 1 120px">
						<option value="">All types</option>
					</select>
					<div style="flex:1"></div>
					<button class="cl-icon-btn" id="cl-refresh" title="Refresh">&#8635;</button>
					<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin-bottom:0;color:var(--text-muted,#8d99a6)">
						<input type="checkbox" id="cl-test-mode"> Test Mode
					</label>
				</div>
				<div class="cl-card" style="padding:0;overflow:hidden;border-radius:8px;box-shadow:0 1px 4px rgba(15,18,22,.06)">
					<div class="case-list-table-wrap" style="overflow-x:auto">
						<table class="table" id="cl-table" style="margin-bottom:0">
							<thead>
								<tr>
									<th style="width:40px">#</th>
									<th class="cl-sortable" data-field="name">Case ID<span class="cl-sort-arrow">&#8645;</span></th>
									<th class="cl-sortable" data-field="beneficiary_name">Beneficiary<span class="cl-sort-arrow">&#8645;</span></th>
									<th class="cl-sortable" data-field="requestor_name">Requestor<span class="cl-sort-arrow">&#8645;</span></th>
									<th class="cl-sortable" data-field="type_of_request">Type<span class="cl-sort-arrow">&#8645;</span></th>
									<th class="cl-sortable" data-field="case_status">Status<span class="cl-sort-arrow">&#8645;</span></th>
									<th class="cl-sortable" data-field="funds_requested">Funds Requested<span class="cl-sort-arrow">&#8645;</span></th>
									<th class="cl-sortable" data-field="district">District<span class="cl-sort-arrow">&#8645;</span></th>
									<th class="cl-sortable cl-sort-active" data-field="request_date">Request Date<span class="cl-sort-arrow">&#8645;</span></th>
								</tr>
							</thead>
							<tbody id="cl-tbody">
								<tr><td colspan="9" class="text-muted text-center">Loading...</td></tr>
							</tbody>
						</table>
					</div>
				</div>
				<div class="cl-list-footer">
					<span class="text-muted small" id="cl-count"></span>
					<div class="cl-list-footer-right">
						<span class="text-muted small" id="cl-page-info"></span>
						<div class="cl-pagination-controls" id="cl-pagination-controls"></div>
					</div>
				</div>
			</div>

			<div id="cl-detail-view" style="display:none">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
					<button class="btn btn-default btn-sm" id="cl-back">&larr; Back to list</button>
					<div id="cl-detail-action"></div>
				</div>
				<div id="cl-detail-body"></div>
			</div>
			</div>
		`);

		frappe.db.get_list('Type of Request List', { fields: ['name'], limit_page_length: 0 })
			.then((rows) => {
				var sel = this.wrapper.find('#cl-type');
				(rows || []).forEach((r) => {
					sel.append(`<option value="${frappe.utils.escape_html(r.name)}">${frappe.utils.escape_html(r.name)}</option>`);
				});
			});

		this.load_location_data();
	}

	load_location_data() {
		var self = this;
		fetch(INDIA_LOCATION_URL)
			.then((r) => r.json())
			.then((data) => {
				var states = (data && data.states) || [];
				if (!states.length) return;

				var stateSel = self.wrapper.find('#cl-f-state');
				states.slice().sort((a, b) => (a.state || '').localeCompare(b.state || '')).forEach((s) => {
					stateSel.append(`<option value="${frappe.utils.escape_html(s.state)}">${frappe.utils.escape_html(s.state)}</option>`);
				});

				var allDistricts = [];
				states.forEach((s) => { allDistricts = allDistricts.concat(s.districts || []); });
				allDistricts = Array.from(new Set(allDistricts)).sort();
				var districtSel = self.wrapper.find('#cl-f-district');
				allDistricts.forEach((d) => {
					districtSel.append(`<option value="${frappe.utils.escape_html(d)}">${frappe.utils.escape_html(d)}</option>`);
				});
			})
			.catch(() => { /* offline/blocked — filters remain functional via "All" only */ });
	}

	bind_events() {
		var self = this;
		this.wrapper.on('input', '#cl-f-id, #cl-f-beneficiary, #cl-f-requestor', frappe.utils.debounce(function () {
			self.page_num = 0; self.refresh_table();
		}, 300));
		this.wrapper.on('change', '#cl-status, #cl-type, #cl-f-state, #cl-f-district', function () {
			self.page_num = 0; self.refresh_table();
		});
		this.wrapper.on('change', '#cl-test-mode', function () {
			self.test_mode = $(this).is(':checked');
			self.page_num = 0;
			self.load_data();
		});
		this.wrapper.on('click', '#cl-refresh', function () {
			self.page_num = 0; self.load_data();
		});
		this.wrapper.on('click', '#cl-table thead th.cl-sortable', function () {
			var field = $(this).data('field');
			if (self.sort_field === field) {
				self.sort_order = self.sort_order === 'desc' ? 'asc' : 'desc';
			} else {
				self.sort_field = field;
				self.sort_order = 'asc';
			}
			self.wrapper.find('#cl-table thead th').removeClass('cl-sort-active');
			$(this).addClass('cl-sort-active');
			self.page_num = 0; self.refresh_table();
		});
		this.wrapper.on('click', '.cl-row', function () {
			self.open_detail($(this).data('name'));
		});
		this.wrapper.on('click', '.cl-pagination-controls .cl-page-nav, .cl-pagination-controls .cl-page-num', function () {
			var p = parseInt($(this).data('page'), 10);
			if (isNaN(p)) return;
			self.page_num = p;
			self.render_table();
		});
		this.wrapper.on('click', '#cl-back', function () {
			if (/^#case-list\/.+/.test(window.location.hash)) {
				window.history.back();
			} else {
				self.show_list_view();
			}
		});
		this.wrapper.on('click', '.cl-tab', function () {
			var t = $(this).data('tab');
			self.wrapper.find('.cl-tab').removeClass('on');
			$(this).addClass('on');
			self.wrapper.find('.cl-panel').removeClass('on');
			self.wrapper.find('#cl-panel-' + t).addClass('on');
		});
		this.wrapper.on('click', '.cl-action-open', function (e) {
			e.preventDefault();
			self.open_action_modal($(this).data('action'));
		});
		this.wrapper.on('click', '.cl-close-case-open', function (e) {
			e.preventDefault();
			self.open_close_case_modal(self.current);
		});
		this.wrapper.on('click', '.cl-doc-card[data-doc-url]', function () {
			self.open_document_modal($(this).data('doc-url'), $(this).data('doc-name'));
		});
	}

	// Client-side filters applied to the already-loaded row set — matches
	// the dashboard drill-down grid's search-box-over-loaded-rows approach,
	// but keeps per-column inputs since that's finer-grained than one box.
	get_filtered_rows() {
		var status = this.wrapper.find('#cl-status').val();
		var type = this.wrapper.find('#cl-type').val();
		var id = (this.wrapper.find('#cl-f-id').val() || '').trim().toLowerCase();
		var beneficiary = (this.wrapper.find('#cl-f-beneficiary').val() || '').trim().toLowerCase();
		var requestor = (this.wrapper.find('#cl-f-requestor').val() || '').trim().toLowerCase();
		var state = this.wrapper.find('#cl-f-state').val();
		var district = this.wrapper.find('#cl-f-district').val();

		var rows = this.all_rows.filter(function (c) {
			if (status && c.case_status !== status) return false;
			if (type && c.type_of_request !== type) return false;
			if (id && (c.name || '').toLowerCase().indexOf(id) === -1) return false;
			if (beneficiary && (c.beneficiary_name || '').toLowerCase().indexOf(beneficiary) === -1) return false;
			if (requestor && (c.requestor_name || '').toLowerCase().indexOf(requestor) === -1) return false;
			if (state && c.state !== state) return false;
			if (district && c.district !== district) return false;
			return true;
		});

		var field = this.sort_field || 'request_date';
		var order = this.sort_order;
		rows.sort(function (a, b) {
			var av = a[field], bv = b[field];
			if (field === 'funds_requested') { av = av || 0; bv = bv || 0; }
			else { av = av || ''; bv = bv || ''; }
			var cmp = av < bv ? -1 : av > bv ? 1 : 0;
			return order === 'desc' ? -cmp : cmp;
		});

		return rows;
	}

	// Fetches the full working set of cases (like the dashboard's drill-down
	// grid does) so search/sort/pagination can all run instantly, client-side,
	// against already-loaded rows instead of round-tripping per interaction.
	load_data() {
		var self = this;

		if (this.test_mode) {
			this.all_rows = SAMPLE_CASES.slice();
			this.refresh_table();
			return;
		}

		this.wrapper.find('#cl-tbody').html('<tr><td colspan="9" class="text-muted text-center">Loading...</td></tr>');

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Case Register', fields: CASE_LIST_FIELDS, filters: {},
				order_by: 'request_date desc', limit_page_length: 0
			},
			callback: function (r) {
				self.all_rows = (r && r.message) || [];
				self.refresh_table();
			},
			error: function () {
				self.wrapper.find('#cl-tbody').html('<tr><td colspan="9" class="text-center text-danger">Could not load cases.</td></tr>');
			}
		});
	}

	// Re-applies filter/sort/pagination to the already-loaded rows — call
	// this (not load_data) whenever a filter, sort, or page changes.
	refresh_table() {
		this.render_table();
	}

	render_table() {
		var self = this;
		var tbody = this.wrapper.find('#cl-tbody');
		var visible = this.get_filtered_rows();

		if (!visible.length) {
			tbody.html('<tr><td colspan="9" class="text-muted text-center">No cases found.</td></tr>');
			this.wrapper.find('#cl-count').text('0 cases');
			this.wrapper.find('#cl-page-info').text('');
			this.wrapper.find('#cl-pagination-controls').empty();
			return;
		}

		var total_pages = Math.max(1, Math.ceil(visible.length / this.page_length));
		if (this.page_num >= total_pages) this.page_num = total_pages - 1;
		if (this.page_num < 0) this.page_num = 0;

		var page_rows = visible.slice(this.page_num * this.page_length, this.page_num * this.page_length + this.page_length);

		var html = page_rows.map((c, i) => {
			var accent = STATUS_HEX[status_color(c.case_status)] || STATUS_HEX.gray;
			return `
			<tr class="cl-row" data-name="${frappe.utils.escape_html(c.name)}" style="cursor:pointer;--cl-row-accent:${accent}">
				<td class="cl-row-num">${self.page_num * self.page_length + i + 1}</td>
				<td><span class="cl-case-id">${frappe.utils.escape_html(c.name)}</span></td>
				<td><span class="cl-beneficiary">${frappe.utils.escape_html(c.beneficiary_name || '')}</span></td>
				<td>${frappe.utils.escape_html(c.requestor_name || '')}</td>
				<td><span class="cl-type-chip">${frappe.utils.escape_html(c.type_of_request || '')}</span></td>
				<td><span class="indicator-pill ${status_color(c.case_status)}">${frappe.utils.escape_html(display_status(c))}</span></td>
				<td class="cl-amount">${format_currency(c.funds_requested || 0)}</td>
				<td class="cl-muted-cell">${frappe.utils.escape_html(c.district || '')}</td>
				<td class="cl-muted-cell">${relative_date(c.request_date)}</td>
			</tr>
		`;
		}).join('');

		tbody.html(html);
		this.wrapper.find('#cl-count').text(visible.length + ' of ' + this.all_rows.length + ' case(s)');
		this.wrapper.find('#cl-page-info').text('Page ' + (this.page_num + 1) + ' of ' + total_pages);
		this.render_pagination_controls(total_pages);
	}

	render_pagination_controls(total_pages) {
		var cur = this.page_num;
		var start = Math.max(0, cur - 3);
		var end = Math.min(total_pages - 1, cur + 3);
		var html = '';
		html += `<button class="cl-page-nav" data-page="0" ${cur === 0 ? 'disabled' : ''} title="First">&laquo;</button>`;
		html += `<button class="cl-page-nav" data-page="${cur - 1}" ${cur === 0 ? 'disabled' : ''} title="Previous">&lsaquo;</button>`;
		for (var p = start; p <= end; p++) {
			html += `<button class="cl-page-num ${p === cur ? 'on' : ''}" data-page="${p}">${p + 1}</button>`;
		}
		html += `<button class="cl-page-nav" data-page="${cur + 1}" ${cur >= total_pages - 1 ? 'disabled' : ''} title="Next">&rsaquo;</button>`;
		html += `<button class="cl-page-nav" data-page="${total_pages - 1}" ${cur >= total_pages - 1 ? 'disabled' : ''} title="Last">&raquo;</button>`;
		this.wrapper.find('#cl-pagination-controls').html(html);
	}

	/* ================= DETAIL VIEW ================= */

	open_detail(name, skip_hash) {
		var self = this;

		if (!skip_hash) {
			window.location.hash = 'case-list/' + encodeURIComponent(name);
		}

		if (this.test_mode) {
			var doc = SAMPLE_CASES.find(function (c) { return c.name === name; });
			if (!doc) return;
			self.current = doc;
			self.wrapper.find('#cl-list-view').hide();
			self.wrapper.find('#cl-detail-view').show();
			self.render_detail(self.current);
			return;
		}

		frappe.call({
			method: 'frappe.client.get',
			args: { doctype: 'Case Register', name: name },
			callback: function (r) {
				if (!r || !r.message) return;
				self.current = r.message;
				self.wrapper.find('#cl-list-view').hide();
				self.wrapper.find('#cl-detail-view').show();
				self.render_detail(self.current);
			}
		});
	}

	get_current_stage(doc) {
		// Only "Pending Approval" cases have a stage genuinely awaiting
		// action. Any other case_status (Sent Back, Rejected, Approved,
		// On Hold, Closed) means no approver should see a Take Action
		// button — even though a LATER stage's own row may still carry a
		// blank status simply because it was never reached yet (e.g.
		// stage 3 when the case was sent back at stage 1). Without this
		// check, scanning stage rows alone would incorrectly treat that
		// untouched later stage as "current" and show Take Action on a
		// case that isn't actually awaiting any approver right now.
		if (doc.case_status !== 'Pending Approval') return null;

		var stages = doc.case_approval_stage || [];
		for (var i = 0; i < stages.length; i++) {
			var s = (stages[i].case_approval_status || '').trim();
			if (s === '' || s === 'Awaiting For Approval') return { stage: stages[i], idx: i };
		}
		return null;
	}

	render_detail(doc) {
		var self = this;
		var body = this.wrapper.find('#cl-detail-body');
		var isMedical = (doc.type_of_request || '').toLowerCase() === 'medical';
		var current = this.get_current_stage(doc);
		var user = frappe.session.user;
		var is_admin = this.test_mode ||
			user === 'Administrator' ||
			(frappe.user_roles || []).indexOf('System Manager') > -1;
		var can_act = current && (
			is_admin ||
			(frappe.user_roles || []).indexOf('Support IID Approver') > -1 ||
			(current.stage.approver_email || '').toLowerCase() === user.toLowerCase()
		);
		var can_close = is_admin || (frappe.user_roles || []).indexOf('Support IID Reviewer') > -1;

		function row(label, value, wide) {
			var has = value !== null && value !== undefined && value !== '';
			return `<div class="cl-field"${wide ? ' style="grid-column:1/-1"' : ''}>
				<div class="cl-field-label">${label}</div>
				<div class="cl-field-value${has ? '' : ' cl-empty'}">${has ? frappe.utils.escape_html(String(value)) : 'Not provided'}</div>
			</div>`;
		}

		var action_html = '';
		if (doc.case_status === 'Approved') {
			if (can_close) {
				action_html = `<button type="button" class="btn btn-primary btn-sm cl-close-case-open">Close Case</button>`;
			}
		} else if (current) {
			if (can_act) {
				action_html = `
					<div class="btn-group cl-action-dropdown">
						<button type="button" class="btn btn-primary btn-sm dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
							Take Action
						</button>
						<div class="dropdown-menu dropdown-menu-right">
							<a class="dropdown-item cl-action-open" data-action="Approve" href="#">Approve</a>
							<a class="dropdown-item cl-action-open" data-action="Send Back" href="#">Send Back</a>
							<a class="dropdown-item cl-action-open" data-action="Decline" href="#">Decline</a>
						</div>
					</div>`;
			} else {
				action_html = `<span class="indicator-pill orange" style="white-space:nowrap">
					Awaiting: ${frappe.utils.escape_html(current.stage.approver_name || current.stage.approver_email || 'approver')}
				</span>`;
			}
		}
		this.wrapper.find('#cl-detail-action').html(action_html);

		function file_ext(url) {
			if (!url || url === '#') return '';
			return (url.split('?')[0].split('.').pop() || '').toLowerCase();
		}
		function ext_label(ext) {
			return ext ? ext.slice(0, 4) : 'FILE';
		}

		var docs = doc.supporting_documents || [];
		var docs_html = '<div class="cl-doc-grid">' + (docs.length ? docs.map(function (d, i) {
			var attachment = d.attachment;
			if (!attachment) {
				return `<div class="cl-doc-card cl-doc-missing-card">
					<div class="cl-doc-card-top">
						<div class="cl-doc-icon" style="background:#c3c9d1">—</div>
						<div class="cl-doc-card-actions">
							<span class="cl-doc-download-btn cl-doc-download-disabled" title="No file uploaded">
								<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
							</span>
						</div>
					</div>
					<div class="cl-doc-name">${frappe.utils.escape_html(d.document_name || 'Document')}</div>
					<div class="cl-doc-missing">Not uploaded</div>
				</div>`;
			}
			var ext = file_ext(attachment);
			return `<div class="cl-doc-card" data-doc-url="${frappe.utils.escape_html(attachment)}" data-doc-name="${frappe.utils.escape_html(d.document_name || 'Document')}">
				<div class="cl-doc-card-top">
					<div class="cl-doc-icon">${ext_label(ext)}</div>
					<div class="cl-doc-card-actions">
						<a href="${frappe.utils.escape_html(attachment)}" target="_blank" download
						   class="cl-doc-download-btn" title="Download ${frappe.utils.escape_html(d.document_name || 'Document')}"
						   onclick="event.stopPropagation()">
							<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
						</a>
					</div>
				</div>
				<div class="cl-doc-name">${frappe.utils.escape_html(d.document_name || 'Document')}</div>
				${d.remarks ? '<div class="cl-doc-remarks">' + frappe.utils.escape_html(d.remarks) + '</div>' : '<div class="cl-doc-remarks">Click to preview</div>'}
			</div>`;
		}).join('') : '<div class="cl-doc-missing">No documents uploaded.</div>') + '</div>';

		var fam = doc.family_members || [];
		var fam_html = fam.length ? `
			<div style="overflow-x:auto">
			<table class="table cl-family-table">
				<thead><tr><th>Name</th><th>Relationship</th><th>Age</th><th>Occupation</th><th>Monthly Income</th><th>Qualification</th></tr></thead>
				<tbody>${fam.map(function (m) {
					return '<tr><td>' + frappe.utils.escape_html(m.member_name || '') + '</td><td>' + frappe.utils.escape_html(m.relationship || '') + '</td><td>' + frappe.utils.escape_html(m.age || '') + '</td><td>' + frappe.utils.escape_html(m.occupation || '') + '</td><td>' + format_currency(m.monthly_income || 0) + '</td><td>' + frappe.utils.escape_html(m.qualification || '') + '</td></tr>';
				}).join('')}</tbody>
			</table>
			</div>` : '<div class="text-muted">No family members added.</div>';

		var stages = doc.case_approval_stage || [];
		var stages_html = stages.length ? stages.map(function (s) {
			var st = s.case_approval_status || 'Pending';
			var color = st === 'Approve' ? 'green' : st === 'Decline' ? 'red' : st === 'Send Back' ? 'orange' : 'gray';
			return `<div class="cl-stage-row">
				<span class="indicator-pill ${color}">${frappe.utils.escape_html(ACTION_LABEL[st] || st)}</span>
				<span><strong>${frappe.utils.escape_html(s.case_approval_level_decription || '')}</strong> — ${frappe.utils.escape_html(s.approver_name || s.approver_email || '')}</span>
			</div>`;
		}).join('') : '<div class="text-muted">No approval stages configured.</div>';

		var log = doc.case_approval_log || [];
		var log_html = log.length ? log.slice().reverse().map(function (l) {
			return `<div class="cl-log-item">
				<div class="cl-log-meta">${l.date ? frappe.datetime.str_to_user(l.date) : ''} &middot; ${frappe.utils.escape_html(l.level || '')} &middot; ${frappe.utils.escape_html(l.approver_name || '')}</div>
				<div><strong>${frappe.utils.escape_html(ACTION_LABEL[l.action] || l.action || '')}</strong>${l.comments ? ' — ' + frappe.utils.escape_html(l.comments) : ''}</div>
			</div>`;
		}).join('') : '<div class="text-muted">No activity logged yet.</div>';

		body.html(`
			<div class="cl-card cl-hero">
				<div>
					<div class="cl-hero-name">${frappe.utils.escape_html(doc.beneficiary_name || '')}</div>
					<div class="cl-hero-stats">
						<div class="cl-hero-stat">
							<div class="cl-hero-stat-label">Case ID</div>
							<div class="cl-hero-stat-value">${frappe.utils.escape_html(doc.name)}</div>
						</div>
						<div class="cl-hero-stat">
							<div class="cl-hero-stat-label">Case Type</div>
							<div class="cl-hero-stat-value">${frappe.utils.escape_html(doc.type_of_request || '—')}</div>
						</div>
						<div class="cl-hero-stat">
							<div class="cl-hero-stat-label">Location</div>
							<div class="cl-hero-stat-value">${frappe.utils.escape_html(doc.district || '')}${doc.state ? ', ' + frappe.utils.escape_html(doc.state) : ''}</div>
						</div>
						<div class="cl-hero-stat">
							<div class="cl-hero-stat-label">Filed</div>
							<div class="cl-hero-stat-value">${doc.request_date ? frappe.datetime.str_to_user(doc.request_date) : '—'}</div>
						</div>
					</div>
				</div>
				<div style="text-align:right">
					<span class="indicator-pill ${status_color(doc.case_status)}" style="margin-bottom:8px;display:inline-block">${frappe.utils.escape_html(display_status(doc))}</span>
					<div class="cl-hero-amount">${format_currency(doc.funds_requested || 0)}</div>
					<div class="cl-hero-amount-label">requested</div>
				</div>
			</div>

			<div class="cl-tabs">
				<div class="cl-tab on" data-tab="overview">Overview</div>
				<div class="cl-tab" data-tab="family">Family</div>
				<div class="cl-tab" data-tab="documents">Documents</div>
				<div class="cl-tab" data-tab="activity">Approval &amp; Activity</div>
			</div>

			<div class="cl-panel on" id="cl-panel-overview">
				<div class="cl-grid">
				<div class="cl-section">
					<div class="cl-section-title">Requestor</div>
					<div class="cl-field-grid">
						${row('Requestor Email', doc.requestor_email)}
						${row('Requestor Name', doc.requestor_name)}
						${row('Department', doc.department)}
						${row('Work Location', doc.work_location)}
						${row('Source of Request', doc.source_of_request)}
					</div>
				</div>
				<div class="cl-section">
					<div class="cl-section-title">Beneficiary</div>
					<div class="cl-field-grid">
						${row('Age', doc.age)}
						${row('Gender', doc.gender)}
						${row('Mobile Number', doc.mobile_number)}
						${row('Email', doc.email)}
						${row('Qualification', doc.qualification)}
						${row('Employment Status', doc.employment_status)}
						${row('Marital Status', doc.marital_status)}
						${row('District / State', (doc.district || '') + (doc.state ? ', ' + doc.state : ''))}
						${row('Pincode', doc.pincode)}
						${row('Address', doc.address_line_1, true)}
						${row('Note about individual', doc.note_about_the_individual, true)}
					</div>
				</div>
				<div class="cl-section">
					<div class="cl-section-title">Request Details</div>
					<div class="cl-field-grid">
						${row(isMedical ? 'Hospital Name' : 'Institution Name', doc.hospital_institution_name)}
						${row('Location', doc.hospital_institution_location)}
						${row('Funds Requested', format_currency(doc.funds_requested || 0))}
						${row('Amount Already Spent', format_currency(doc.amount_already_spent || 0))}
						${isMedical ? row('Treatment', doc.treatment) : ''}
						${row(isMedical ? 'Ailment Details' : 'Course Details', doc.ailment__course_details, true)}
					</div>
				</div>
				<div class="cl-section">
					<div class="cl-section-title">Financial &amp; Insurance</div>
					<div class="cl-field-grid">
						${row('Annual Family Income', format_currency(doc.annual_family_income || 0))}
						${row('Residence Type', doc.residence_type)}
						${row('Insurance Type', doc.insurance_type)}
						${row('Existing Debt', doc.existing_debt, true)}
						${row('Residence Details', doc.residence_details, true)}
						${row('Insurance Details', doc.insurance_coverage_details, true)}
					</div>
				</div>
				<div class="cl-section cl-span-full">
					<div class="cl-section-title">Verification &amp; Assessment</div>
					<div class="cl-field-grid">
						${row('Physical Verification', doc.physical_verification)}
						${row('Milaap Campaign Link', doc.milaap_campaign_link)}
						${row('Verification Notes', doc.physical_verification_notes, true)}
						${row('Genuineness Assessment', doc.genuineness_assessment, true)}
						${row('Vulnerability Assessment', doc.vulnerability_assessment, true)}
						${row('Milaap Recommendation', doc.milaap_recommendation, true)}
					</div>
				</div>
				<div class="cl-section cl-span-full">
					<div class="cl-section-title">Closure of Case</div>
					<div class="cl-field-grid">
						${row('Approved Amount', doc.approved_amount ? format_currency(doc.approved_amount) : '')}
						${row('Date of Transfer', doc.date_of_transfer ? frappe.datetime.str_to_user(doc.date_of_transfer) : '')}
						${row('UTR Details', doc.utr_details)}
						${row('Status of Milaap Transfer', doc.status_of_milaap_transfer)}
						${row('Refund Amount (if any)', doc.refund_amount_if_any ? format_currency(doc.refund_amount_if_any) : '')}
					</div>
				</div>
				</div>
			</div>

			<div class="cl-panel" id="cl-panel-family">
				<div class="cl-section" style="padding-right:0">${fam_html}</div>
			</div>

			<div class="cl-panel" id="cl-panel-documents">
				${docs_html}
			</div>

			<div class="cl-panel" id="cl-panel-activity">
				<div class="cl-grid">
				<div class="cl-section">
					<div class="cl-section-title">Approval Stages</div>
					${stages_html}
				</div>
				<div class="cl-section">
					<div class="cl-section-title">Activity Log</div>
					${log_html}
				</div>
				</div>
			</div>
		`);
	}

	submit_approval(action, comments) {
		var self = this;
		var doc = this.current;
		var past = ACTION_PAST[action] || (action.toLowerCase() + 'd');

		if (self.test_mode) {
			self.simulate_approval_locally(doc, action, comments);
			frappe.show_alert({ message: 'Case ' + past + ' (sample data — not saved).', indicator: 'green' });
			self.render_detail(doc);
			return;
		}

		frappe.call({
			method: 'support_iid.support_iid.doctype.case_register.case_register.process_case_approval',
			args: { case_name: doc.name, action: action, comments: comments },
			freeze: true,
			freeze_message: 'Processing...',
			callback: function (r) {
				if (r && r.message) {
					frappe.show_alert({ message: 'Case ' + past + '.', indicator: 'green' });
					self.open_detail(doc.name);
				}
			}
		});
	}

	// Reviewer / admin action on an Approved case — records fund-transfer
	// details and marks it Closed. Mirrors open_action_modal/submit_approval
	// above, but for this separate action + field set.
	open_close_case_modal(doc) {
		$('.cl-close-modal-backdrop').remove();
		var self = this;

		var modal = $(`
			<div class="cl-modal-backdrop cl-close-modal-backdrop">
				<div class="cl-modal cl-modal-lg">
					<div class="cl-modal-header">
						<div class="cl-modal-title">Close Case</div>
						<button class="cl-modal-close" aria-label="Close">&times;</button>
					</div>
					<div class="cl-modal-body cl-modal-body-plain">
						<div style="margin-bottom:16px">
							<label style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:6px">Date of Transfer</label>
							<div style="font-weight:600;font-size:15.5px">${frappe.datetime.str_to_user(frappe.datetime.get_today())}</div>
						</div>
						<div style="margin-bottom:16px">
							<label style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:6px">Approved Amount <span style="color:#c0392b">*</span></label>
							<input type="number" step="0.01" class="form-control" id="cl-close-approved-amount" value="${doc.approved_amount || ''}">
							<div id="cl-close-amount-error" style="display:none;color:#c0392b;font-size:12px;margin-top:4px"></div>
						</div>
						<div style="margin-bottom:16px">
							<label style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:6px">UTR Details</label>
							<input type="text" class="form-control" id="cl-close-utr" value="${frappe.utils.escape_html(doc.utr_details || '')}">
						</div>
						<div style="margin-bottom:16px">
							<label style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:6px">Status of Milaap Transfer</label>
							<select class="form-control" id="cl-close-milaap-status">
								<option value="" ${!doc.status_of_milaap_transfer ? 'selected' : ''}></option>
								<option value="Pending" ${doc.status_of_milaap_transfer === 'Pending' ? 'selected' : ''}>Pending</option>
								<option value="Partially Disbursed" ${doc.status_of_milaap_transfer === 'Partially Disbursed' ? 'selected' : ''}>Partially Disbursed</option>
								<option value="Fully Disbursed" ${doc.status_of_milaap_transfer === 'Fully Disbursed' ? 'selected' : ''}>Fully Disbursed</option>
							</select>
						</div>
						<div style="margin-bottom:16px">
							<label style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:6px">Refund Amount (if any)</label>
							<input type="number" step="0.01" class="form-control" id="cl-close-refund-amount" value="${doc.refund_amount_if_any || ''}">
						</div>
						<div style="margin-bottom:16px">
							<label style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:6px">Milaap Recommendation</label>
							<textarea class="form-control" id="cl-close-milaap-recommendation" rows="4">${frappe.utils.escape_html(doc.milaap_recommendation || '')}</textarea>
						</div>
						<div style="margin-bottom:0">
							<label style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:6px">Milaap Campaign Link</label>
							<input type="text" class="form-control" id="cl-close-milaap-link" value="${frappe.utils.escape_html(doc.milaap_campaign_link || '')}">
						</div>
					</div>
					<div class="cl-modal-footer">
						<button class="btn btn-default" id="cl-close-cancel">Cancel</button>
						<button class="btn btn-primary" id="cl-close-submit">Close Case</button>
					</div>
				</div>
			</div>
		`);

		modal.on('click', function (e) { if (e.target === this) modal.remove(); });
		modal.find('.cl-modal-close, #cl-close-cancel').on('click', function () { modal.remove(); });
		$('body').append(modal);

		modal.find('#cl-close-submit').on('click', function () {
			var amount = modal.find('#cl-close-approved-amount').val();
			if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
				modal.find('#cl-close-amount-error').text('Approved Amount is required.').show();
				return;
			}
			var payload = {
				approved_amount: amount,
				utr_details: modal.find('#cl-close-utr').val(),
				milaap_recommendation: modal.find('#cl-close-milaap-recommendation').val(),
				milaap_campaign_link: modal.find('#cl-close-milaap-link').val(),
				status_of_milaap_transfer: modal.find('#cl-close-milaap-status').val(),
				refund_amount_if_any: modal.find('#cl-close-refund-amount').val()
			};
			modal.remove();
			self.submit_close_case(doc, payload);
		});
	}

	submit_close_case(doc, payload) {
		var self = this;

		if (self.test_mode) {
			doc.case_status = 'Closed';
			doc.date_of_transfer = frappe.datetime.get_today();
			doc.approved_amount = payload.approved_amount ? parseFloat(payload.approved_amount) : doc.approved_amount;
			doc.utr_details = payload.utr_details;
			doc.milaap_recommendation = payload.milaap_recommendation;
			doc.milaap_campaign_link = payload.milaap_campaign_link;
			doc.status_of_milaap_transfer = payload.status_of_milaap_transfer;
			doc.refund_amount_if_any = payload.refund_amount_if_any ? parseFloat(payload.refund_amount_if_any) : doc.refund_amount_if_any;
			frappe.show_alert({ message: 'Case closed (sample data — not saved).', indicator: 'green' });
			self.render_detail(doc);
			return;
		}

		frappe.call({
			method: 'support_iid.support_iid.doctype.case_register.case_register.close_case',
			args: Object.assign({ case_name: doc.name }, payload),
			freeze: true,
			freeze_message: 'Closing case...',
			callback: function (r) {
				if (r && r.message) {
					frappe.show_alert({ message: 'Case closed.', indicator: 'green' });
					self.open_detail(doc.name);
				}
			}
		});
	}

	// Dropdown → popup with the approval level, a comment box, and a Submit
	// button. Nothing is sent to the server until the user confirms here.
	open_action_modal(action) {
		$('.cl-action-modal-backdrop').remove();

		var current = this.get_current_stage(this.current);
		var level_label = current ? (current.stage.case_approval_level_decription || current.stage.name) : '';
		var self = this;

		var accent = action === 'Decline' ? '#c0392b' : action === 'Send Back' ? '#b9770e' : '#2490ef';

		var modal = $(`
			<div class="cl-modal-backdrop cl-action-modal-backdrop">
				<div class="cl-modal cl-modal-lg">
					<div class="cl-modal-header">
						<div class="cl-modal-title">${frappe.utils.escape_html(ACTION_LABEL[action] || action)}</div>
						<button class="cl-modal-close" aria-label="Close">&times;</button>
					</div>
					<div class="cl-modal-body cl-modal-body-plain">
						<div style="margin-bottom:22px">
							<label style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:6px">Approval Level</label>
							<div style="font-weight:600;font-size:15.5px">${frappe.utils.escape_html(level_label || '—')}</div>
						</div>
						<label style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:8px">Comments</label>
						<textarea class="form-control" id="cl-action-comment" rows="7" style="font-size:14px" placeholder="Add a comment (optional)"></textarea>
					</div>
					<div class="cl-modal-footer">
						<button class="btn btn-default" id="cl-action-cancel">Cancel</button>
						<button class="btn" id="cl-action-submit" style="background:${accent};color:#fff">Submit</button>
					</div>
				</div>
			</div>
		`);

		modal.on('click', function (e) { if (e.target === this) modal.remove(); });
		modal.find('.cl-modal-close, #cl-action-cancel').on('click', function () { modal.remove(); });
		modal.find('#cl-action-submit').on('click', function () {
			var comments = modal.find('#cl-action-comment').val();
			modal.remove();
			self.submit_approval(action, comments);
		});
		$(document).on('keydown.cl-action-modal', function (e) {
			if (e.key === 'Escape') { modal.remove(); $(document).off('keydown.cl-action-modal'); }
		});

		$('body').append(modal);
	}

	// Mirrors the server-side process_case_approval logic, purely in-memory,
	// so Test Mode can be used to click through the full workflow.
	simulate_approval_locally(doc, action, comments) {
		var stages = doc.case_approval_stage || [];
		var current_idx = -1;
		for (var i = 0; i < stages.length; i++) {
			var s = (stages[i].case_approval_status || '').trim();
			if (s === '' || s === 'Awaiting For Approval') { current_idx = i; break; }
		}
		if (current_idx === -1) return;

		var current_stage = stages[current_idx];
		current_stage.case_approval_status = action;

		doc.case_approval_log = doc.case_approval_log || [];
		doc.case_approval_log.push({
			date: frappe.datetime.get_today(),
			level: current_stage.case_approval_level_decription || current_stage.name,
			approver_name: current_stage.approver_name || frappe.session.user,
			action: action,
			comments: comments || ''
		});

		if (action === 'Decline') {
			doc.case_status = 'Rejected';
			doc.current_approval_level = '';
		} else if (action === 'Send Back') {
			doc.case_status = 'Sent Back';
			doc.current_approval_level = '';
		} else {
			var remaining = stages.slice(current_idx + 1);
			if (remaining.length) {
				remaining[0].case_approval_status = 'Awaiting For Approval';
				doc.case_status = 'Pending Approval';
				doc.current_approval_level = remaining[0].case_approval_level_decription || 'next level';
			} else {
				doc.case_status = 'Approved';
				doc.current_approval_level = '';
			}
		}
	}

	// Opens any uploaded file (image, PDF, audio, video, or other) in an
	// inline preview popup instead of just linking out to it.
	open_document_modal(url, name) {
		$('.cl-modal-backdrop').remove();

		if (!url || url === '#') {
			frappe.show_alert({ message: 'This is sample data — no real file is attached.', indicator: 'orange' });
			return;
		}

		var ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
		var body;
		var needs_office_render = false;

		if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].indexOf(ext) > -1) {
			body = `<div style="text-align:center"><img src="${url}" style="max-width:100%;max-height:72vh;border-radius:6px;background:#fff"></div>`;
		} else if (ext === 'pdf') {
			body = `<iframe src="${url}" style="width:100%;height:72vh;border:none;border-radius:6px;background:#fff"></iframe>`;
		} else if (['mp4', 'webm', 'ogg', 'mov'].indexOf(ext) > -1) {
			body = `<video src="${url}" controls style="width:100%;max-height:72vh;border-radius:6px"></video>`;
		} else if (['mp3', 'wav', 'ogg'].indexOf(ext) > -1) {
			body = `<div style="padding:40px 10px"><audio src="${url}" controls style="width:100%"></audio></div>`;
		} else if (['txt', 'json', 'log'].indexOf(ext) > -1) {
			body = `<iframe src="${url}" style="width:100%;height:72vh;border:none;border-radius:6px;background:#fff"></iframe>`;
		} else if (window.SIIDOfficePreview && window.SIIDOfficePreview.isSupported(ext)) {
			needs_office_render = true;
			body = `<div class="text-center text-muted" style="padding:60px 20px" id="cl-doc-convert-status">
				<div style="font-size:15px">Preparing preview…</div>
			</div>`;
		} else if (window.SIIDOfficePreview && window.SIIDOfficePreview.isUnsupportedOffice(ext)) {
			body = `<div class="text-center text-muted" style="padding:60px 20px">
				<div style="font-size:15px;margin-bottom:14px">
					In-browser preview isn't available for .${frappe.utils.escape_html(ext)} files. Please download to view.
				</div>
				<a href="${url}" target="_blank" class="btn btn-primary btn-sm">Open / Download</a>
			</div>`;
		} else {
			body = `<div class="text-center text-muted" style="padding:60px 20px">
				<div style="font-size:15px;margin-bottom:14px">
					Preview isn't available for this file type${ext ? ' (.' + frappe.utils.escape_html(ext) + ')' : ''}.
				</div>
				<a href="${url}" target="_blank" class="btn btn-primary btn-sm">Open / Download</a>
			</div>`;
		}

		var modal = $(`
			<div class="cl-modal-backdrop">
				<div class="cl-modal">
					<div class="cl-modal-header">
						<div class="cl-modal-title">${frappe.utils.escape_html(name || 'Document')}</div>
						<button class="cl-modal-close" aria-label="Close">&times;</button>
					</div>
					<div class="cl-modal-body">${body}</div>
					<div class="cl-modal-footer">
						<a href="${url}" target="_blank" class="btn btn-default btn-sm">Open in new tab</a>
						<a href="${url}" download class="btn btn-default btn-sm">Download</a>
					</div>
				</div>
			</div>
		`);

		if (needs_office_render) {
			window.SIIDOfficePreview.render(modal.find('.cl-modal-body'), url, ext).catch(function (err) {
				modal.find('#cl-doc-convert-status').html(
					`<div style="font-size:15px;margin-bottom:14px">${frappe.utils.escape_html((err && err.message) || 'Could not render a preview for this file.')}</div>
					<a href="${url}" target="_blank" class="btn btn-primary btn-sm">Open / Download</a>`
				);
			});
		}

		modal.on('click', function (e) {
			if (e.target === this) modal.remove();
		});
		modal.find('.cl-modal-close').on('click', function () { modal.remove(); });
		$(document).on('keydown.cl-modal', function (e) {
			if (e.key === 'Escape') { modal.remove(); $(document).off('keydown.cl-modal'); }
		});

		$('body').append(modal);
	}
}
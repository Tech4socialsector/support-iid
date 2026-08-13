frappe.pages['support-iid-dashboard'].on_page_load = function (wrapper) {
	if (!document.getElementById('siid-office-preview-script')) {
		var s = document.createElement('script');
		s.id = 'siid-office-preview-script';
		s.src = '/assets/support_iid/js/office_preview.js';
		document.head.appendChild(s);
	}

	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Support IID Dashboard',
		single_column: true
	});
	new SupportIIDDashboard(page);
};

// ---------------------------------------------------------------
// Constants & small helpers
// ---------------------------------------------------------------

const TERMINAL_STATUSES = ['Approved', 'Rejected', 'Closed'];
function is_in_progress(status) {
	return TERMINAL_STATUSES.indexOf(status) === -1;
}
function case_amount(c) {
	return c.approved_amount || c.funds_requested || 0;
}

const STATUS_COLOR = {
	'Draft': 'gray', 'Submitted': 'blue', 'Rejected': 'red',
	'Sent Back': 'orange', 'On Hold': 'orange', 'Closed': 'gray',
	'Approved': 'green'
};
function status_color(status) {
	if (STATUS_COLOR[status]) return STATUS_COLOR[status];
	if (!status) return 'gray';
	if (status.indexOf('Pending Approval') === 0) return 'orange';
	return 'blue';
}
// The stored case_status value stays "Sent Back" (Link value, used in
// filters/data/comparisons everywhere) — this is the one place that
// value should actually show something friendlier to a user: "Pending
// with Requester" instead of the more passive "Sent Back".
const STATUS_DISPLAY_LABELS = {
	'Sent Back': 'Pending with Requester',
	// "Rejected" is flagged as a restricted/spam-trigger word by some
	// outgoing-mail providers — shown as "Declined" everywhere instead
	// (matching the wording already used for the Decline action). The
	// stored case_status value stays "Rejected" for data/filter
	// consistency.
	'Rejected': 'Declined'
};
function status_display_label(status) {
	return STATUS_DISPLAY_LABELS[status] || status;
}
// Case Status is a fixed Link value ("Pending Approval") with the current
// approval level tracked separately — this composes the two back into one
// display string, e.g. "Pending Approval (L1 Reviewer)".
function display_status(c) {
	var label = status_display_label(c.case_status);
	if ((c.case_status === 'Pending Approval' || c.case_status === 'Sent Back') && c.current_approval_level) {
		return `${label} (${c.current_approval_level})`;
	}
	return label || '';
}
const STATUS_HEX = {
	gray: '#9aa1a8', blue: '#2490ef', orange: '#e29a3d',
	green: '#2f9e5b', red: '#e0524c', purple: '#8a63d2'
};

const ACTION_LABEL = { 'Approve': 'Approve', 'Decline': 'Decline', 'Send Back': 'Send Back' };
const ACTION_PAST = { 'Approve': 'approved', 'Decline': 'declined', 'Send Back': 'sent back' };

// ---------------------------------------------------------------
// Small self-contained icon set (feather-style outline icons) so
// cards and buttons don't rely on any external icon font being loaded.
// ---------------------------------------------------------------
const ICON_PATHS = {
	refresh: '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
	clear: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>',
	download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
	chevronLeft: '<polyline points="15 18 9 12 15 6"></polyline>',
	chevronRight: '<polyline points="9 18 15 12 9 6"></polyline>',
	chevronsLeft: '<polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline>',
	chevronsRight: '<polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline>',
	copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
	checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
	pauseCircle: '<circle cx="12" cy="12" r="10"></circle><line x1="10" y1="15" x2="10" y2="9"></line><line x1="14" y1="15" x2="14" y2="9"></line>',
	clock: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
	cornerUpLeft: '<polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>',
	xCircle: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>',
	list: '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>',
	tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>',
	barChart: '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>',
	sliders: '<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line>'
};

function icon(name, size) {
	size = size || 15;
	var path = ICON_PATHS[name];
	if (!path) return '';
	return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex-shrink:0">${path}</svg>`;
}

function get_current_stage(doc) {
	// Only "Pending Approval" cases have a stage genuinely awaiting
	// action. Any other case_status (Sent Back, Rejected,
	// Approved, On Hold, Closed) means no approver should see a Take Action button —
	// even though a LATER stage's own row may still carry a blank status
	// simply because it was never reached yet (e.g. stage 3 when the
	// case was sent back at stage 1). Without this check, scanning stage
	// rows alone would incorrectly treat that untouched later stage as
	// "current" and show Take Action on a case that isn't actually
	// awaiting any approver right now.
	if (doc.case_status !== 'Pending Approval') return null;

	var stages = doc.case_approval_stage || [];
	for (var i = 0; i < stages.length; i++) {
		var s = (stages[i].case_approval_status || '').trim();
		if (s === '' || s === 'Awaiting For Approval') return { stage: stages[i], idx: i };
	}
	return null;
}

function month_key(date_str) {
	if (!date_str) return null;
	return date_str.slice(0, 7);
}
function quarter_key(date_str) {
	if (!date_str) return null;
	var y = date_str.slice(0, 4);
	var m = parseInt(date_str.slice(5, 7), 10);
	return y + '-Q' + Math.ceil(m / 3);
}
function year_key(date_str) {
	if (!date_str) return null;
	return date_str.slice(0, 4);
}
function period_key(date_str, granularity) {
	if (granularity === 'quarter') return quarter_key(date_str);
	if (granularity === 'year') return year_key(date_str);
	return month_key(date_str);
}
function period_label(key, granularity) {
	if (!key) return '—';
	if (granularity === 'month') {
		var parts = key.split('-');
		var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
		return d.toLocaleString('en-US', { month: 'short' }) + " '" + parts[0].slice(2);
	}
	if (granularity === 'quarter') return key.replace('-', ' ');
	return key;
}

// ---------------------------------------------------------------
// Free public dataset of Indian states & districts, used to populate
// the District/State filters as real dropdowns instead of free text.
// Loaded once and cached; falls back to plain text filtering if the
// fetch fails (network/CORS), so the filters still work either way.
// ---------------------------------------------------------------
const INDIA_LOCATION_URL = 'https://raw.githubusercontent.com/sab99r/Indian-States-And-Districts/master/states-and-districts.json';

// ---------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------
class SupportIIDDashboard {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.rows = [];
		this.trend_granularity = 'month';
		this.india_locations = null; // { states: [{state, districts}] } once loaded

		this.inject_styles();
		this.render_shell();
		this.bind_events();
		this.setup_date_controls();
		this.load_location_data();
		this.load_data();
	}

	inject_styles() {
		if ($('#siid-dash-style').length) return;
		$(`<style id="siid-dash-style">
			.sd-page { padding:22px 28px 48px; }
			.sd-toolbar { display:flex; align-items:center; gap:10px; margin-bottom:18px; flex-wrap:wrap; }
			.sd-toolbar .sd-spacer { flex:1; }

			.sd-section-heading { font-size:15px; font-weight:700; margin:0 0 14px; color:#1a1a1a; }

			.sd-filter-bar { margin-bottom:22px; padding-bottom:18px; border-bottom:1px solid var(--border-color,#e3e8ec); }
			.sd-filter-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px 18px; margin-bottom:16px; }
			.sd-filter-item label { display:block; font-size:12px; font-weight:600; color:var(--text-muted,#8d99a6); margin-bottom:6px; text-transform:uppercase; letter-spacing:.03em; }
			.sd-filter-item .form-control { width:100%; }
			.sd-filter-actions { display:flex; align-items:center; gap:8px; }

			/* smaller metric cards, with a small icon badge — every group
			   (Status, Financial, Insights) shares the same fixed card
			   width and height, so cards never look mismatched in size
			   across groups or within a group regardless of how many
			   cards a group has or how much sub-text a given card holds.
			   auto-fill (not auto-fit) with a fixed px width, not 1fr,
			   keeps cards from stretching to fill a group with fewer
			   cards than others. Height is tall enough for the worst case
			   (a 2-line label like "Sent Back for Revision" + a value +
			   a sub line) — content is never clipped, just given a
			   consistent floor so shorter cards don't look tiny next to it. */
			.sd-metrics-grid { display:grid; grid-template-columns:repeat(5, 1fr); gap:16px; align-items:stretch; }
			/* Plain neutral cards — no per-card accent colors, just a clean
			   white card with a subtle lift on hover. Wide and short,
			   matching a compact dashboard-summary-card look. */
			.sd-metric-card {
				background:#fff; border:1px solid var(--border-color,#d1d8dd); border-radius:10px;
				padding:12px 14px 10px; cursor:pointer; transition:box-shadow .16s, transform .16s;
				width:100%; min-height:76px; display:flex; flex-direction:column;
				box-shadow:0 1px 2px rgba(15,23,32,.04);
			}
			.sd-metric-card:hover { box-shadow:0 8px 20px rgba(15,23,32,.09); transform:translateY(-2px); }
			.sd-metric-card.sd-disabled { cursor:default; opacity:.65; }
			.sd-metric-card.sd-disabled:hover { box-shadow:none; transform:none; }


			/* Export dropdown — self-contained, no Bootstrap JS dependency */
			.sd-export-group { position:relative; display:inline-flex; }
			.sd-export-toggle {
				border:none; border-radius:6px; padding:6px 13px; font-size:12.5px; font-weight:600;
				cursor:pointer; display:inline-flex; align-items:center; gap:6px;
				background:#2490ef; color:#fff;
			}
			.sd-export-toggle:hover { background:#1a72c4; }
			.sd-export-toggle svg:last-child { transition:transform .18s; }
			.sd-export-group.open .sd-export-toggle svg:last-child { transform:rotate(90deg); }
			.sd-export-menu {
				display:none; position:absolute; top:calc(100% + 6px); right:0; z-index:9999;
				background:#fff; border:1px solid var(--border-color,#d1d8dd); border-radius:8px;
				box-shadow:0 8px 24px rgba(0,0,0,.14); padding:5px; min-width:180px;
			}
			.sd-export-group.open .sd-export-menu { display:block; }
			.sd-export-menu-item {
				display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:6px;
				cursor:pointer; font-size:13px; color:#1a1a1a;
			}
			.sd-export-menu-item:hover { background:#f4f5f7; }
			.sd-export-menu-icon {
				width:24px; height:24px; border-radius:5px; display:inline-flex; align-items:center;
				justify-content:center; color:#fff; flex-shrink:0;
			}

			/* Tooltip — attach data-tooltip="…" to any element */
			[data-tooltip] { position:relative; }
			[data-tooltip]::after {
				content:attr(data-tooltip); position:absolute; bottom:calc(100% + 7px); left:50%;
				transform:translateX(-50%); background:#1a1a1a; color:#fff; font-size:11.5px;
				padding:5px 10px; border-radius:6px; white-space:nowrap; pointer-events:none;
				opacity:0; transition:opacity .15s; z-index:99999;
			}
			[data-tooltip]::before {
				content:''; position:absolute; bottom:calc(100% + 1px); left:50%;
				transform:translateX(-50%); border:5px solid transparent; border-top-color:#1a1a1a;
				pointer-events:none; opacity:0; transition:opacity .15s; z-index:99999;
			}
			[data-tooltip]:hover::after, [data-tooltip]:hover::before { opacity:1; }

			/* indicator-pill override inside the case detail view —
			   matches the design specification in the request. height:auto
			   (not a fixed px height) so longer combined text like "Pending
			   with Requester (L2)" doesn't wrap and clip/overlap inside a
			   box too short for its own second line — same fix applied on
			   the Case Registry table's status pills. */
			#sd-detail-view .indicator-pill, #sd-detail-view .indicator-pill-right {
				font-size:12px; font-weight:400; letter-spacing:.02em;
				padding:2.5px 8px; border-radius:9999px; height:auto; min-height:22px;
				display:inline-flex; align-items:center; box-shadow:none !important;
				white-space:nowrap; max-width:none;
			}
			.sd-metric-icon {
				width:20px; height:20px; border-radius:5px; background:#f0f1f3; color:#5a6068;
				display:flex; align-items:center; justify-content:center; font-size:11px; margin-bottom:4px;
			}
			.sd-metric-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted,#8d99a6); margin-bottom:2px; }
			.sd-metric-value { font-size:20px; font-weight:700; color:#1a1a1a; line-height:1.2; }
			.sd-metric-sub { font-size:11.5px; color:var(--text-muted,#8d99a6); margin-top:2px; }

			.sd-chart-panel { background:#fff; border:1px solid var(--border-color,#d1d8dd); border-radius:10px; padding:20px 22px; }
			.sd-chart-title { font-size:13px; font-weight:700; margin-bottom:16px; color:#1a1a1a; }
			.sd-bar-row { margin-bottom:14px; cursor:pointer; }
			.sd-bar-row:last-child { margin-bottom:0; }
			.sd-bar-row-head { display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:5px; }
			.sd-bar-row-label { font-weight:600; color:#1a1a1a; }
			.sd-bar-row-value { color:var(--text-muted,#8d99a6); }
			.sd-bar-track { height:10px; background:#eef0f2; border-radius:6px; overflow:hidden; }
			.sd-bar-fill { height:100%; border-radius:6px; transition:width .2s; }

			.sd-trend-toggle { display:flex; gap:4px; }
			.sd-trend-toggle button {
				border:1px solid var(--border-color,#d1d8dd); background:#fff; padding:5px 12px; font-size:12px;
				cursor:pointer; color:var(--text-muted,#8d99a6); font-weight:600;
			}
			.sd-trend-toggle button:first-child { border-radius:6px 0 0 6px; }
			.sd-trend-toggle button:last-child { border-radius:0 6px 6px 0; }
			.sd-trend-toggle button.on { background:#1a1a1a; color:#fff; border-color:#1a1a1a; }
			.sd-trend-chart { display:flex; align-items:flex-end; gap:14px; height:180px; margin-top:16px; overflow-x:auto; padding-bottom:4px; }
			.sd-trend-col { display:flex; flex-direction:column; align-items:center; min-width:44px; flex-shrink:0; height:100%; justify-content:flex-end; cursor:pointer; }
			.sd-trend-bars { display:flex; align-items:flex-end; gap:3px; height:140px; }
			.sd-trend-bar { width:14px; border-radius:3px 3px 0 0; }
			.sd-trend-bar-count { background:#2490ef; }
			.sd-trend-bar-amount { background:#2f9e5b; }
			.sd-trend-col-label { font-size:10.5px; color:var(--text-muted,#8d99a6); margin-top:6px; white-space:nowrap; }
			.sd-trend-legend { display:flex; gap:16px; font-size:12px; color:var(--text-muted,#8d99a6); margin-top:14px; }
			.sd-trend-legend span { display:inline-flex; align-items:center; gap:6px; }
			.sd-trend-legend i { width:9px; height:9px; border-radius:2px; display:inline-block; }
			.sd-trend-grid { display:grid; grid-template-columns:1fr; gap:16px; }
			@media (min-width: 900px) { .sd-trend-grid { grid-template-columns:1fr 1fr; } }
			.sd-trend-section { margin-top:18px; }
			.sd-trend-section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }

			.sd-modal-backdrop { position:fixed; inset:0; background:rgba(15,18,22,.55); z-index:1200; display:flex; align-items:center; justify-content:center; padding:30px; }
			.sd-modal { background:#fff; border-radius:12px; max-width:1200px; width:96vw; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.3); transition:max-width .15s; }
			.sd-modal.sd-modal-narrow { max-width:1150px; }
			.sd-modal-header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 22px; border-bottom:1px solid var(--border-color,#e3e8ec); border-radius:12px 12px 0 0; flex-wrap:wrap; }
			.sd-modal-header-left { display:flex; align-items:center; gap:10px; min-width:0; }
			.sd-modal-header-right { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
			.sd-modal-title { font-weight:700; font-size:15px; }
			.sd-modal-count { font-weight:500; font-size:12.5px; color:var(--text-muted,#8d99a6); }
			.sd-modal-close { cursor:pointer; font-size:22px; line-height:1; color:var(--text-muted,#8d99a6); background:none; border:none; }
			.sd-modal-close:hover { color:#1a1a1a; }
			.sd-modal-body { overflow:auto; flex:1; border-radius:0 0 12px 12px; }
			.sd-modal-body.sd-modal-body-padded { padding:24px; }

			#sd-drilldown-table { border-collapse:collapse; width:100%; border:1px solid #d0d3d8; }
			#sd-drilldown-table th, #sd-drilldown-table td { border:1px solid #d0d3d8; padding:6px 14px; font-size:12.5px; text-align:left; white-space:nowrap; }
			.sd-table-scroll { overflow-x:auto; }
			.sd-pagination { display:flex; align-items:center; justify-content:space-between; padding:12px 4px 4px; font-size:12.5px; color:var(--text-muted,#8d99a6); flex-wrap:wrap; gap:8px; }
			.sd-pagination-controls { display:flex; align-items:center; gap:5px; }
			.sd-pagination-controls button {
				border:1px solid var(--border-color,#d1d8dd); background:#fff; min-width:28px; height:28px; padding:0 8px;
				font-size:12px; border-radius:5px; cursor:pointer; color:#1a1a1a; display:inline-flex; align-items:center; justify-content:center;
			}
			.sd-pagination-controls button:disabled { opacity:.35; cursor:default; }
			.sd-pagination-controls button.sd-page-num.on { background:#1a1a1a; color:#fff; border-color:#1a1a1a; font-weight:600; }
			#sd-drilldown-table th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted,#8d99a6); font-weight:700; position:sticky; top:0; background:#f4f5f7; cursor:pointer; user-select:none; }
			#sd-drilldown-table th.sd-no-sort { cursor:default; }
			#sd-drilldown-table th .sd-sort-arrow { color:#b8bfc6; margin-left:5px; font-size:11px; }
			#sd-drilldown-table th.sd-sort-active .sd-sort-arrow { color:#1a1a1a; }
			#sd-drilldown-table tbody tr { cursor:pointer; }
			#sd-drilldown-table tbody tr:nth-child(even) td { background:#fafafa; }
			#sd-drilldown-table tbody tr:hover td { background:#f0f4f9; }
			#sd-drilldown-table .sd-amount { text-align:right; font-weight:600; }
			#sd-drilldown-table .sd-row-num { color:#9aa1a8; width:36px; text-align:center; }
			.sd-empty-note { color:var(--text-muted,#8d99a6); font-size:13px; padding:30px 0; text-align:center; }

			.sd-detail-hero { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; padding:20px 24px; border-bottom:1px solid var(--border-color,#e3e8ec); }
			.sd-detail-name { font-size:20px; font-weight:700; margin-bottom:14px; letter-spacing:-.01em; }
			.sd-hero-stats { display:flex; flex-wrap:wrap; gap:0; }
			.sd-hero-stat { padding:0 20px; border-right:1px solid var(--border-color,#e3e8ec); }
			.sd-hero-stat:first-child { padding-left:0; }
			.sd-hero-stat:last-child { border-right:none; }
			.sd-hero-stat-label { font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted,#8d99a6); margin-bottom:5px; }
			.sd-hero-stat-value { font-size:13.5px; font-weight:600; color:#1a1a1a; }
			.sd-hero-amount { font-size:22px; font-weight:700; }
			.sd-hero-amount-label { font-size:11px; color:var(--text-muted,#8d99a6); text-transform:uppercase; letter-spacing:.04em; }
			.sd-detail-hero .indicator-pill { box-shadow:none !important; }
			.sd-hero-action { margin-top:10px; }

			.sd-detail-tabs { display:flex; gap:4px; border-bottom:1px solid var(--border-color,#d1d8dd); padding:0 24px; overflow-x:auto; }
			.sd-detail-tab { padding:11px 14px; cursor:pointer; font-size:13px; font-weight:500; color:var(--text-muted,#8d99a6); border-bottom:2px solid transparent; white-space:nowrap; }
			.sd-detail-tab.on { color:#1a1a1a; border-bottom-color:var(--primary,#2490ef); }
			.sd-detail-panel { display:none; padding:22px 24px; }
			.sd-detail-panel.on { display:block; }

			.sd-section { padding:0 20px 20px 0; }
			.sd-section-title { font-size:12.5px; font-weight:700; color:#1a1a1a; margin-bottom:14px; padding-bottom:9px; border-bottom:2px solid var(--border-color,#d1d8dd); }
			.sd-field-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:14px 18px; }
			.sd-field-label { font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted,#8d99a6); margin-bottom:5px; }
			.sd-field-value { font-size:13px; font-weight:500; color:#1a1a1a; word-break:break-word; line-height:1.4; }
			.sd-field-value.sd-empty { color:#b8bfc6; font-weight:400; font-style:italic; }

			.sd-detail-grid { display:grid; grid-template-columns:1fr; column-gap:28px; }
			@media (min-width: 820px) { .sd-detail-grid { grid-template-columns: repeat(2, 1fr); } }
			.sd-detail-grid .sd-section:nth-child(odd) { border-right:1px solid var(--border-color,#eceef0); }
			.sd-detail-grid .sd-section:last-child { border-right:none; }
			.sd-span-full { grid-column:1/-1; }

			.sd-family-table { border-collapse:collapse; width:100%; }
			.sd-family-table th { border:none; border-bottom:1px solid var(--border-color,#d1d8dd); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted,#8d99a6); text-align:left; padding:9px 12px; }
			.sd-family-table td { border:none; border-bottom:1px solid var(--border-color,#f0f2f5); padding:9px 12px; font-size:13px; }

			.sd-doc-accordion { border:1px solid var(--border-color,#e3e8ec); border-radius:8px; overflow:hidden; }
			.sd-doc-row { border-bottom:1px solid var(--border-color,#e3e8ec); }
			.sd-doc-row:last-child { border-bottom:none; }
			.sd-doc-row-head { display:flex; align-items:center; gap:12px; padding:13px 16px; cursor:pointer; }
			.sd-doc-row-head:hover { background:#f7f9fb; }
			.sd-doc-row.sd-doc-missing .sd-doc-row-head { cursor:default; opacity:.6; }
			.sd-doc-chevron { font-size:11px; color:var(--text-muted,#8d99a6); transition:transform .15s; flex-shrink:0; width:12px; }
			.sd-doc-row.sd-doc-open .sd-doc-chevron { transform:rotate(90deg); }
			.sd-doc-icon-sm { width:28px; height:28px; border-radius:6px; background:var(--primary,#2490ef); color:#fff; display:flex; align-items:center; justify-content:center; font-size:9.5px; font-weight:700; text-transform:uppercase; flex-shrink:0; }
			.sd-doc-title { font-weight:600; font-size:13px; flex-shrink:0; }
			.sd-doc-remarks { color:var(--text-muted,#8d99a6); font-size:12px; }
			.sd-doc-row-body { display:none; padding:0 16px 18px 40px; }
			.sd-doc-row.sd-doc-open .sd-doc-row-body { display:block; }

			.sd-copy-field { display:inline-flex; align-items:center; gap:7px; }
			.sd-copy-btn {
				border:none; background:#f0f1f3; color:var(--text-muted,#8d99a6); cursor:pointer;
				font-size:10.5px; padding:2px 7px; border-radius:4px; line-height:1.6;
			}
			.sd-copy-btn:hover { background:#e3e5e8; color:#1a1a1a; }

			.sd-stage-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border-color,#f0f2f5); font-size:13px; }
			.sd-log-item { padding:10px 0; border-bottom:1px solid var(--border-color,#f0f2f5); font-size:13px; }
			.sd-log-meta { color:var(--text-muted,#8d99a6); font-size:11.5px; margin-bottom:2px; }

			.sd-action-dropdown { position:relative; display:inline-block; }
			.sd-action-dropdown .dropdown-menu .dropdown-item[data-action="Decline"] { color:#c0392b; }
			.sd-action-dropdown .dropdown-menu .dropdown-item[data-action="Send Back"] { color:#b9770e; }

			/* Dropdowns are toggled with our own JS below (not relying on
			   Bootstrap's data-toggle behaviour, which isn't reliable across
			   Frappe/Bootstrap versions) — so the CSS here is fully self-contained. */
			.btn-group { position:relative; display:inline-block; }
			.dropdown-menu {
				display:none; position:absolute; top:100%; right:0; margin-top:6px; min-width:170px;
				background:#fff; border:1px solid var(--border-color,#d1d8dd); border-radius:8px;
				box-shadow:0 8px 24px rgba(0,0,0,.14); padding:5px 0; z-index:50;
			}
			.dropdown-menu.show { display:block; }
			.dropdown-item { display:block; padding:8px 16px; font-size:13px; color:#1a1a1a; text-decoration:none; cursor:pointer; }
			.dropdown-item:hover { background:#f4f5f7; }
			.sd-action-modal-body label { font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8d99a6);display:block;margin-bottom:6px; }
		</style>`).appendTo('head');
	}

	render_shell() {
		this.wrapper.html(`
			<div class="sd-page">
				<div class="sd-toolbar">
					<div class="sd-spacer"></div>
				</div>

				<div class="sd-filter-bar">
					<div class="sd-filter-grid">
						<div class="sd-filter-item">
							<label>Source of Request</label>
							<select id="sd-f-source" class="form-control">
								<option value="">All sources</option>
							</select>
						</div>
						<div class="sd-filter-item">
							<label>Type of Request</label>
							<select id="sd-f-type" class="form-control">
								<option value="">All types</option>
							</select>
						</div>
						<div class="sd-filter-item">
							<label>State</label>
							<select id="sd-f-state" class="form-control">
								<option value="">All states</option>
							</select>
						</div>
						<div class="sd-filter-item">
							<label>District</label>
							<select id="sd-f-district" class="form-control">
								<option value="">All districts</option>
							</select>
						</div>
						<div class="sd-filter-item">
							<label>Registered From</label>
							<div id="sd-f-from-field"></div>
						</div>
						<div class="sd-filter-item">
							<label>Registered Up To</label>
							<div id="sd-f-upto-field"></div>
						</div>
					</div>
					<div class="sd-filter-actions">
						<button class="btn btn-default btn-sm" id="sd-refresh" data-tooltip="Reload dashboard data">${icon('refresh', 13)} Reload</button>
						<button class="btn btn-default btn-sm" id="sd-f-clear" data-tooltip="Clear all active filters">${icon('clear', 13)} Clear filters</button>
					</div>
				</div>

				<div class="sd-section-heading">Case Overview</div>
				<div class="sd-metrics-grid" id="sd-metrics-status"></div>

				<div class="sd-section-heading" style="margin-top:22px">Financial Summary</div>
				<div class="sd-metrics-grid" id="sd-metrics-financial"></div>

				<div class="sd-trend-section">
					<div class="sd-trend-section-head">
						<span class="sd-section-heading" style="margin:0">Analysis</span>
						<div class="sd-trend-toggle" id="sd-trend-toggle">
							<button data-g="month" class="on" data-tooltip="Group by month">Monthly</button>
							<button data-g="quarter" data-tooltip="Group by quarter">Quarterly</button>
							<button data-g="year" data-tooltip="Group by year">Yearly</button>
						</div>
					</div>
					<div class="sd-trend-grid">
						<div class="sd-chart-panel">
							<div class="sd-chart-title">Case Numbers &amp; Approved Funds</div>
							<div id="sd-trend-chart" style="overflow:hidden"></div>
							<div class="sd-trend-legend">
								<span><i style="background:#2490ef"></i> Case count</span>
								<span><i style="background:#2f9e5b"></i> Approved funds</span>
							</div>
						</div>
						<div class="sd-chart-panel">
							<div class="sd-chart-title">Approved vs Declined Cases</div>
							<div class="sd-trend-chart" id="sd-trend-chart-2"></div>
							<div class="sd-trend-legend">
								<span><i style="background:#2f9e5b"></i> Approved</span>
								<span><i style="background:#e0524c"></i> Declined</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		`);

		frappe.db.get_list('Type of Request List', { fields: ['name'], limit_page_length: 0 })
			.then((rows) => {
				var sel = this.wrapper.find('#sd-f-type');
				(rows || []).forEach((r) => {
					sel.append(`<option value="${frappe.utils.escape_html(r.name)}">${frappe.utils.escape_html(r.name)}</option>`);
				});
				this.request_types = (rows || []).map((r) => r.name);
				this.render_metrics();
			});

		// No longer a filter dropdown — Status is shown as one Case
		// Overview card per status instead (see render_metrics), so this
		// only needs the plain list of status names for that. "Draft"
		// is excluded defensively even though nothing currently creates a
		// case in that status — a card for it would be meaningless (no
		// case is ever left sitting there for a user to act on).
		frappe.db.get_list('Case Status List', { fields: ['name'], limit_page_length: 0 })
			.then((rows) => {
				this.case_statuses = (rows || [])
					.map((r) => r.name)
					.filter((name) => name !== 'Draft');
				this.render_metrics();
			});

		frappe.db.get_list('Source of Request List', { fields: ['name'], order_by: 'sequence_id asc', limit_page_length: 0 })
			.then((rows) => {
				var sel = this.wrapper.find('#sd-f-source');
				(rows || []).forEach((r) => {
					sel.append(`<option value="${frappe.utils.escape_html(r.name)}">${frappe.utils.escape_html(r.name)}</option>`);
				});

				// Cached in case anything else needs the known-sources list —
				// built from whatever entries actually exist in this master
				// doctype, not a hardcoded list, so a new source added here
				// shows up automatically.
				this.request_sources = (rows || []).map((r) => r.name);
				this.render_metrics();
			});
	}

	// Frappe's own Date control — guarantees the site's configured date
	// format (dd-mm-yyyy for this deployment) instead of the browser's
	// native <input type="date"> locale formatting, which we can't control.
	setup_date_controls() {
		var self = this;
		this.from_control = frappe.ui.form.make_control({
			df: { fieldtype: 'Date', fieldname: 'sd_from_date', placeholder: 'DD-MM-YYYY' },
			parent: this.wrapper.find('#sd-f-from-field'),
			render_input: true
		});
		this.from_control.refresh();
		this.from_control.$input.on('change', () => self.apply_filters());

		this.upto_control = frappe.ui.form.make_control({
			df: { fieldtype: 'Date', fieldname: 'sd_upto_date', placeholder: 'DD-MM-YYYY' },
			parent: this.wrapper.find('#sd-f-upto-field'),
			render_input: true
		});
		this.upto_control.refresh();
		this.upto_control.$input.on('change', () => self.apply_filters());
	}

	// Loads a free public India states/districts dataset to turn the
	// State/District filters into real dropdowns. If the fetch fails
	// (offline, blocked, etc.) the dropdowns just stay at "All ..." —
	// filtering still works, it just won't offer suggestions.
	load_location_data() {
		var self = this;
		fetch(INDIA_LOCATION_URL)
			.then((r) => r.json())
			.then((data) => {
				var states = (data && data.states) || [];
				if (!states.length) return;
				self.india_locations = states;

				var stateSel = self.wrapper.find('#sd-f-state');
				states.slice().sort((a, b) => (a.state || '').localeCompare(b.state || '')).forEach((s) => {
					stateSel.append(`<option value="${frappe.utils.escape_html(s.state)}">${frappe.utils.escape_html(s.state)}</option>`);
				});

				var allDistricts = [];
				states.forEach((s) => { allDistricts = allDistricts.concat(s.districts || []); });
				allDistricts = Array.from(new Set(allDistricts)).sort();
				var districtSel = self.wrapper.find('#sd-f-district');
				allDistricts.forEach((d) => {
					districtSel.append(`<option value="${frappe.utils.escape_html(d)}">${frappe.utils.escape_html(d)}</option>`);
				});
			})
			.catch(() => { /* offline/blocked — filters remain functional via "All" only */ });
	}

	bind_events() {
		var self = this;
		this.wrapper.on('click', '#sd-refresh', function () { self.load_data(); });
		this.wrapper.on('change', '#sd-f-source, #sd-f-type, #sd-f-state, #sd-f-district', function () {
			self.apply_filters();
		});
		this.wrapper.on('click', '#sd-f-clear', function () {
			self.wrapper.find('#sd-f-source, #sd-f-type, #sd-f-state, #sd-f-district').val('');
			self.from_control.set_value('');
			self.upto_control.set_value('');
			self.apply_filters();
		});
		this.wrapper.on('click', '#sd-trend-toggle button', function () {
			self.wrapper.find('#sd-trend-toggle button').removeClass('on');
			$(this).addClass('on');
			self.trend_granularity = $(this).data('g');
			self.render_trend_chart();
			self.render_trend_chart_2();
		});
	}

	load_data() {
		var self = this;
		frappe.call({
			method: 'support_iid.api.dashboard.get_dashboard_data',
			freeze: true,
			freeze_message: 'Loading dashboard...',
			callback: function (r) {
				self.all_rows = (r && r.message) || [];
				self.apply_filters();
			}
		});
	}

	apply_filters() {
		var source = this.wrapper.find('#sd-f-source').val();
		var type = this.wrapper.find('#sd-f-type').val();
		var district = (this.wrapper.find('#sd-f-district').val() || '').trim().toLowerCase();
		var state = (this.wrapper.find('#sd-f-state').val() || '').trim().toLowerCase();
		var from_date = this.from_control ? this.from_control.get_value() : '';
		var upto = this.upto_control ? this.upto_control.get_value() : '';

		this.rows = (this.all_rows || []).filter((c) => {
			if (source && c.source_of_request !== source) return false;
			if (type && c.type_of_request !== type) return false;
			if (district && (c.district || '').toLowerCase().indexOf(district) === -1) return false;
			if (state && (c.state || '').toLowerCase().indexOf(state) === -1) return false;
			if (from_date && c.request_date && c.request_date < from_date) return false;
			if (upto && c.request_date && c.request_date > upto) return false;
			return true;
		});
		this.render_metrics();
		this.render_trend_chart();
		this.render_trend_chart_2();
	}

	// ---------------- Key Metrics ----------------

	render_metrics() {
		var rows = this.rows;
		var self = this;

		// Approved Amount totals every case that has actually cleared
		// approval — both cases still sitting at Approved (awaiting
		// disbursement/closure) and cases that have since been Closed —
		// not just the ones still in the Approved state.
		var approved_rows = rows.filter((c) => c.case_status === 'Approved' || c.case_status === 'Closed');
		var declined_rows = rows.filter((c) => c.case_status === 'Rejected');
		var pending_rows = rows.filter((c) => c.case_status === 'Pending Approval');
		var total_approved_value = approved_rows.reduce((s, c) => s + case_amount(c), 0);
		var total_requested_value = rows.reduce((s, c) => s + (c.funds_requested || 0), 0);
		var total_declined_value = declined_rows.reduce((s, c) => s + case_amount(c), 0);
		// Cases still awaiting a decision have no approved_amount yet —
		// this totals what's actually been requested, not case_amount()'s
		// approved-amount-first fallback (which would always be 0 here).
		var total_pending_value = pending_rows.reduce((s, c) => s + (c.funds_requested || 0), 0);
		var in_progress_rows = rows.filter((c) => is_in_progress(c.case_status));

		var financial_cards = [
			{
				icon: icon('barChart', 18), label: 'Total Requested Amount', value: format_currency(total_requested_value),
				sub: rows.length + ' total case(s)',
				click: () => self.open_drilldown('All cases', () => true)
			},
			{
				icon: icon('clock', 18), label: 'Pending for Approval Amount', value: format_currency(total_pending_value),
				sub: pending_rows.length + ' pending case(s)',
				click: () => self.open_drilldown('Pending approval cases', (c) => c.case_status === 'Pending Approval')
			},
			{
				icon: '₹', label: 'Total Approved Amount', value: format_currency(total_approved_value),
				sub: approved_rows.length + ' approved/closed case(s)',
				click: () => self.open_drilldown('Approved cases', (c) => c.case_status === 'Approved' || c.case_status === 'Closed')
			},
			{
				icon: icon('xCircle', 18), label: 'Total Declined Amount', value: format_currency(total_declined_value),
				sub: declined_rows.length + ' declined case(s)',
				click: () => self.open_drilldown('Declined cases', (c) => c.case_status === 'Rejected')
			}
		];

		// Source of Request and Type of Request are filter dropdowns above
		// instead of their own cards — this section leads with Total Cases /
		// Cases In Progress, then one card per status actually in Case
		// Status List, plus a catch-all "Others" for any case whose
		// case_status doesn't match a known status (blank, legacy, or a
		// stray value) — adding a new status there is enough to get a
		// matching card, no code change needed.
		var status_list = (this.case_statuses && this.case_statuses.length) ? this.case_statuses : [];
		var other_rows = rows.filter((c) => status_list.indexOf(c.case_status) === -1);

		var status_cards = [
			{
				icon: icon('list', 18), label: 'Total Cases', value: rows.length,
				sub: 'across all statuses',
				click: () => self.open_drilldown('All cases', () => true)
			},
			{
				icon: icon('clock', 18), label: 'Cases In Progress', value: in_progress_rows.length,
				sub: 'awaiting review, approval, or action',
				click: () => self.open_drilldown('Cases in progress', (c) => is_in_progress(c.case_status))
			}
		].concat(status_list.map((s) => {
			var status_rows = rows.filter((c) => c.case_status === s);
			return {
				icon: icon('tag', 18), label: status_display_label(s), value: status_rows.length,
				sub: status_rows.length + ' case(s)',
				click: () => self.open_drilldown(status_display_label(s) + ' cases', (c) => c.case_status === s)
			};
		})).concat(other_rows.length ? [{
			icon: icon('tag', 18), label: 'Others', value: other_rows.length,
			sub: other_rows.length + ' case(s)',
			click: () => self.open_drilldown('Other cases', (c) => status_list.indexOf(c.case_status) === -1)
		}] : []);

		this.render_metric_group('#sd-metrics-financial', financial_cards);
		this.render_metric_group('#sd-metrics-status', status_cards);
	}

	render_metric_group(selector, cards) {
		var html = cards.map((card, i) => `
			<div class="sd-metric-card ${card.disabled ? 'sd-disabled' : ''}" data-idx="${i}"${card.click && !card.disabled ? ' data-tooltip="Click to see matching cases"' : ''}>
				<div class="sd-metric-icon">${card.icon || ''}</div>
				<div class="sd-metric-label">${frappe.utils.escape_html(card.label)}</div>
				<div class="sd-metric-value">${typeof card.value === 'number' ? card.value : frappe.utils.escape_html(String(card.value))}</div>
				<div class="sd-metric-sub">${card.subHtml ? card.subHtml : frappe.utils.escape_html(card.sub || '')}</div>
			</div>
		`).join('');

		var container = this.wrapper.find(selector);
		container.html(html);
		container.find('.sd-metric-card').each(function (i) {
			var card = cards[i];
			if (card.click) $(this).on('click', card.click);
		});
	}

	// ---------------- Charts: Cases by Status + Financial Tracking ----------------

	// ---------------- Trend Analysis (Monthly / Quarterly / Yearly) ----------------

	render_trend_chart() {
		var self = this;
		var g = this.trend_granularity || 'month';
		var groups = {};

		this.rows.forEach((c) => {
			var key = period_key(c.request_date, g);
			if (!key) return;
			if (!groups[key]) groups[key] = { count: 0, amount: 0 };
			groups[key].count += 1;
			if (c.case_status === 'Approved') groups[key].amount += case_amount(c);
		});

		var keys = Object.keys(groups).sort();
		if (!keys.length) {
			this.wrapper.find('#sd-trend-chart').html('<div class="sd-empty-note">No case data yet.</div>');
			return;
		}

		var W = 560, H = 160, padL = 10, padR = 10, padT = 10, padB = 28;
		var cW = W - padL - padR, cH = H - padT - padB;
		var n = keys.length;
		var maxCount = Math.max.apply(null, keys.map((k) => groups[k].count).concat([1]));
		var maxAmount = Math.max.apply(null, keys.map((k) => groups[k].amount).concat([1]));

		function px(i) { return padL + (n < 2 ? cW / 2 : (i / (n - 1)) * cW); }
		function pyCount(v) { return padT + cH - (v / maxCount) * cH; }
		function pyAmount(v) { return padT + cH - (v / maxAmount) * cH; }

		var countPts = keys.map((k, i) => px(i) + ',' + pyCount(groups[k].count)).join(' ');
		var amountPts = keys.map((k, i) => px(i) + ',' + pyAmount(groups[k].amount)).join(' ');

		var gridLines = [0.25, 0.5, 0.75].map((f) => {
			var y = padT + cH * (1 - f);
			return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef0f2" stroke-width="1"/>`;
		}).join('');

		var countDots = keys.map((k, i) =>
			`<circle cx="${px(i)}" cy="${pyCount(groups[k].count)}" r="4" fill="#2490ef" style="cursor:pointer" data-period="${frappe.utils.escape_html(k)}">
				<title>${frappe.utils.escape_html(period_label(k, g))}: ${groups[k].count} case(s)</title>
			</circle>`).join('');
		var amountDots = keys.map((k, i) =>
			`<circle cx="${px(i)}" cy="${pyAmount(groups[k].amount)}" r="4" fill="#2f9e5b" style="cursor:pointer" data-period="${frappe.utils.escape_html(k)}">
				<title>${frappe.utils.escape_html(period_label(k, g))}: ${format_currency(groups[k].amount)} approved</title>
			</circle>`).join('');

		var step = n <= 12 ? 1 : Math.ceil(n / 8);
		var xLabels = keys.map((k, i) => {
			if (i % step !== 0 && i !== n - 1) return '';
			return `<text x="${px(i)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#8d99a6">${frappe.utils.escape_html(period_label(k, g))}</text>`;
		}).join('');

		var svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="160" style="display:block;overflow:visible">
			${gridLines}
			<polyline points="${amountPts}" fill="none" stroke="#2f9e5b" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
			<polyline points="${countPts}" fill="none" stroke="#2490ef" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
			${amountDots}${countDots}
			${xLabels}
		</svg>`;

		this.wrapper.find('#sd-trend-chart').html(svg);
		this.wrapper.find('#sd-trend-chart svg circle').on('click', function () {
			var period = $(this).data('period');
			if (period) self.open_drilldown('Period · ' + period_label(period, g), (c) => period_key(c.request_date, g) === period);
		});
	}

	render_trend_chart_2() {
		var self = this;
		var g = this.trend_granularity || 'month';
		var groups = {};

		this.rows.forEach((c) => {
			var key = period_key(c.request_date, g);
			if (!key) return;
			if (!groups[key]) groups[key] = { approved: 0, declined: 0 };
			if (c.case_status === 'Approved') groups[key].approved += 1;
			if (c.case_status === 'Rejected') groups[key].declined += 1;
		});

		var keys = Object.keys(groups).sort();
		if (!keys.length) {
			this.wrapper.find('#sd-trend-chart-2').html('<div class="sd-empty-note">No case data yet.</div>');
			return;
		}

		var max = Math.max.apply(null, keys.map((k) => Math.max(groups[k].approved, groups[k].declined)).concat([1]));

		var html = keys.map((k) => {
			var approvedPct = Math.max(4, Math.round((groups[k].approved / max) * 100));
			var declinedPct = Math.max(4, Math.round((groups[k].declined / max) * 100));
			return `
				<div class="sd-trend-col" data-period="${frappe.utils.escape_html(k)}"
					title="${frappe.utils.escape_html(period_label(k, g))}: ${groups[k].approved} approved, ${groups[k].declined} declined">
					<div class="sd-trend-bars">
						<div class="sd-trend-bar" style="height:${approvedPct}%;background:#2f9e5b"></div>
						<div class="sd-trend-bar" style="height:${declinedPct}%;background:#e0524c"></div>
					</div>
					<div class="sd-trend-col-label">${frappe.utils.escape_html(period_label(k, g))}</div>
				</div>
			`;
		}).join('');

		this.wrapper.find('#sd-trend-chart-2').html(html);
		this.wrapper.find('#sd-trend-chart-2 .sd-trend-col').on('click', function () {
			var period = $(this).data('period');
			self.open_drilldown('Period · ' + period_label(period, g), (c) =>
				period_key(c.request_date, g) === period && (c.case_status === 'Approved' || c.case_status === 'Rejected'));
		});
	}

	// ---------------- Drill-down popup (list <-> detail, in the SAME modal) ----------------

	open_drilldown(title, filterFn) {
		$('.sd-modal-backdrop').remove();

		var self = this;
		var matching = this.rows.filter(filterFn);
		var state = { search: '', sort_field: 'request_date', sort_order: 'desc', page: 0 };
		var PAGE_SIZE = 15;
		var current_detail_doc = null;

		function display_amount(c) {
			return c.approved_amount || (c.case_status === 'Approved' ? (c.funds_requested || 0) : 0);
		}
		function amount_text(c) {
			var a = display_amount(c);
			return a ? format_currency(a) : '—';
		}

		function get_visible_rows() {
			var term = state.search.trim().toLowerCase();
			var out = term
				? matching.filter((c) => (c.name || '').toLowerCase().indexOf(term) > -1 || (c.beneficiary_name || '').toLowerCase().indexOf(term) > -1)
				: matching.slice();

			out.sort((a, b) => {
				var f = state.sort_field, av, bv;
				if (f === 'approved_amount') { av = display_amount(a); bv = display_amount(b); }
				else { av = a[f] || ''; bv = b[f] || ''; }
				var cmp = av < bv ? -1 : av > bv ? 1 : 0;
				return state.sort_order === 'desc' ? -cmp : cmp;
			});
			return out;
		}

		function render_list_body() {
			var visible = get_visible_rows();
			var total_pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
			if (state.page >= total_pages) state.page = total_pages - 1;
			if (state.page < 0) state.page = 0;

			modal.find('#sd-modal-count').text(visible.length + ' of ' + matching.length);

			var page_rows = visible.slice(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE);
			var rows_html = page_rows.map((c, i) => `
				<tr data-name="${frappe.utils.escape_html(c.name)}">
					<td class="sd-row-num">${state.page * PAGE_SIZE + i + 1}</td>
					<td>${frappe.utils.escape_html(c.name)}</td>
					<td>${frappe.utils.escape_html(c.beneficiary_name || '')}</td>
					<td>${frappe.utils.escape_html(c.type_of_request || '')}</td>
					<td>${frappe.utils.escape_html(display_status(c))}</td>
					<td class="sd-amount">${format_currency(c.funds_requested || 0)}</td>
					<td class="sd-amount">${amount_text(c)}</td>
					<td>${frappe.utils.escape_html(c.approved_by || '—')}</td>
					<td>${c.request_date ? frappe.datetime.str_to_user(c.request_date) : ''}</td>
				</tr>
			`).join('');

			modal.find('#sd-drilldown-body').html(rows_html || '<tr><td colspan="9" class="sd-empty-note">No matching cases.</td></tr>');
			modal.find('#sd-drilldown-table thead th').removeClass('sd-sort-active');
			modal.find('#sd-drilldown-table thead th[data-field="' + state.sort_field + '"]').addClass('sd-sort-active');

			modal.find('#sd-page-info').text('Page ' + (state.page + 1) + ' of ' + total_pages);

			var cur = state.page;
			var start = Math.max(0, cur - 3);
			var end = Math.min(total_pages - 1, cur + 3);
			var page_html = '';
			page_html += `<button class="sd-page-nav" data-page="0" ${cur === 0 ? 'disabled' : ''} title="First">${icon('chevronsLeft', 12)}</button>`;
			page_html += `<button class="sd-page-nav" data-page="${cur - 1}" ${cur === 0 ? 'disabled' : ''} title="Previous">${icon('chevronLeft', 12)}</button>`;
			for (var p = start; p <= end; p++) {
				page_html += `<button class="sd-page-num ${p === cur ? 'on' : ''}" data-page="${p}">${p + 1}</button>`;
			}
			page_html += `<button class="sd-page-nav" data-page="${cur + 1}" ${cur >= total_pages - 1 ? 'disabled' : ''} title="Next">${icon('chevronRight', 12)}</button>`;
			page_html += `<button class="sd-page-nav" data-page="${total_pages - 1}" ${cur >= total_pages - 1 ? 'disabled' : ''} title="Last">${icon('chevronsRight', 12)}</button>`;
			modal.find('#sd-pagination-controls').html(page_html);
		}

		function show_list_mode() {
			current_detail_doc = null;
			modal.removeClass('sd-modal-narrow');
			modal.find('#sd-modal-back').hide();
			modal.find('.sd-modal-header-controls').css('display', 'flex');
			modal.find('#sd-modal-title-text').text(title);
			modal.find('#sd-modal-count').show();
			modal.find('#sd-list-view').show();
			modal.find('#sd-detail-view').hide().empty();
			modal.find('#sd-detail-action-slot').hide().empty();
		}

		function show_detail_mode(doc) {
			current_detail_doc = doc;
			modal.addClass('sd-modal-narrow');
			modal.find('.sd-modal-header-controls').hide();
			modal.find('#sd-modal-count').hide();
			modal.find('#sd-modal-back').show();
			modal.find('#sd-modal-title-text').text(doc.beneficiary_name || 'Case Detail');
			modal.find('#sd-list-view').hide();
			modal.find('#sd-detail-view').html(self.build_case_detail_html(doc)).show();
			modal.find('#sd-detail-action-slot').html(self.build_action_control_html(doc)).show();
		}

		function open_case(name) {
			frappe.call({
				method: 'frappe.client.get',
				args: { doctype: 'Case Register', name: name },
				freeze: true,
				freeze_message: 'Loading case...',
				callback: function (r) { if (r && r.message) show_detail_mode(r.message); }
			});
		}

		var modal = $(`
			<div class="sd-modal-backdrop">
				<div class="sd-modal">
					<div class="sd-modal-header">
						<div class="sd-modal-header-left">
							<button class="btn btn-default btn-sm" id="sd-modal-back" style="display:none" data-tooltip="Back to list">${icon('chevronLeft', 13)} Back to list</button>
							<div class="sd-modal-title" id="sd-modal-title-text"></div>
							<span id="sd-modal-count" class="sd-modal-count"></span>
						</div>
						<div class="sd-modal-header-right">
							<input type="text" id="sd-modal-search" class="form-control sd-modal-header-controls" placeholder="Search by Case ID or beneficiary name..." style="width:100%;max-width:240px;flex:1 1 160px">
							<div class="sd-export-group sd-modal-header-controls">
								<button class="sd-export-toggle" id="sd-export-toggle" data-tooltip="Export filtered cases">
									${icon('download', 13)} Export ${icon('chevronRight', 11)}
								</button>
								<div class="sd-export-menu" id="sd-export-menu">
									<div class="sd-export-menu-item" id="sd-export-excel">
										<span class="sd-export-menu-icon" style="background:#1d7a45">${icon('download', 12)}</span>
										<span>Export as Excel</span>
									</div>
									<div class="sd-export-menu-item" id="sd-export-pdf">
										<span class="sd-export-menu-icon" style="background:#c0392b">${icon('download', 12)}</span>
										<span>Export as PDF</span>
									</div>
								</div>
							</div>
							<div id="sd-detail-action-slot" style="display:none"></div>
							<button class="sd-modal-close" aria-label="Close" data-tooltip="Close">&times;</button>
						</div>
					</div>
					<div class="sd-modal-body">
						<div id="sd-list-view">
							${matching.length ? `
								<div class="sd-table-scroll">
									<table id="sd-drilldown-table">
										<thead>
											<tr>
												<th class="sd-no-sort">#</th>
												<th data-field="name">Case ID<span class="sd-sort-arrow">&#8645;</span></th>
												<th data-field="beneficiary_name">Beneficiary<span class="sd-sort-arrow">&#8645;</span></th>
												<th data-field="type_of_request">Type<span class="sd-sort-arrow">&#8645;</span></th>
												<th data-field="case_status">Status<span class="sd-sort-arrow">&#8645;</span></th>
												<th data-field="funds_requested" style="text-align:right">Requested Amount<span class="sd-sort-arrow">&#8645;</span></th>
												<th data-field="approved_amount" style="text-align:right">Approved Amount<span class="sd-sort-arrow">&#8645;</span></th>
												<th data-field="approved_by">Approved By<span class="sd-sort-arrow">&#8645;</span></th>
												<th data-field="request_date">Request Date<span class="sd-sort-arrow">&#8645;</span></th>
											</tr>
										</thead>
										<tbody id="sd-drilldown-body"></tbody>
									</table>
								</div>
								<div class="sd-pagination">
									<span id="sd-page-info"></span>
									<div class="sd-pagination-controls" id="sd-pagination-controls"></div>
								</div>
							` : '<div class="sd-empty-note">No matching cases.</div>'}
						</div>
						<div id="sd-detail-view" style="display:none"></div>
					<div style="display:flex;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--border-color,#e3e8ec)">
						<button class="btn btn-default btn-sm sd-modal-close-bottom">${icon('clear', 12)} Close</button>
					</div>
					</div>
				</div>
			</div>
		`);

		show_list_mode();
		if (matching.length) render_list_body();

		function trigger_export(file_format) {
			// Export uses ALL matching rows (all pages) — not just the current page.
			var all_names = get_visible_rows().map((c) => c.name);
			if (!all_names.length) { frappe.show_alert({ message: 'No cases to export.', indicator: 'orange' }); return; }
			var params = { file_format: file_format, names: JSON.stringify(all_names) };
			var url = frappe.urllib.get_full_url('/api/method/support_iid.api.dashboard.export_case_list?' + $.param(params));
			var win = window.open(url, '_blank');
			if (!win) {
				frappe.msgprint('Your browser blocked the export pop-up. Please allow pop-ups for this site, then try again.');
			}
			modal.find('#sd-export-group').removeClass('open');
		}
		modal.on('click', '#sd-export-toggle', function (e) {
			e.stopPropagation();
			modal.find('.sd-export-group').toggleClass('open');
		});
		modal.on('click', '#sd-export-excel', function () { trigger_export('excel'); });
		modal.on('click', '#sd-export-pdf', function () { trigger_export('pdf'); });
		$(document).on('click.sd-export-close', function () {
			modal.find('.sd-export-group').removeClass('open');
		});
		modal.on('click', '.dropdown-toggle', function (e) {
			e.stopPropagation();
			if ($(this).prop('disabled')) return;
			var menu = $(this).siblings('.dropdown-menu');
			var was_open = menu.hasClass('show');
			modal.find('.dropdown-menu').removeClass('show');
			if (!was_open) menu.addClass('show');
		});
		$(document).on('click.sd-dropdown-close', function () {
			modal.find('.dropdown-menu').removeClass('show');
		});
		modal.on('click', function (e) { if (e.target === this) modal.remove(); });
		modal.find('.sd-modal-close, .sd-modal-close-bottom').on('click', function () { modal.remove(); });
		modal.on('input', '#sd-modal-search', frappe.utils.debounce(function () {
			state.search = $(this).val() || '';
			state.page = 0;
			render_list_body();
		}, 250));
		modal.find('#sd-drilldown-table thead th[data-field]').on('click', function () {
			var field = $(this).data('field');
			if (state.sort_field === field) {
				state.sort_order = state.sort_order === 'desc' ? 'asc' : 'desc';
			} else {
				state.sort_field = field;
				state.sort_order = 'asc';
			}
			state.page = 0;
			render_list_body();
		});
		modal.on('click', '.sd-page-nav, .sd-page-num', function () {
			var p = parseInt($(this).data('page'), 10);
			if (isNaN(p)) return;
			state.page = p;
			render_list_body();
		});
		modal.on('click', '#sd-drilldown-table tbody tr', function () { open_case($(this).data('name')); });
		modal.on('click', '#sd-modal-back', function () { show_list_mode(); });
		modal.on('click', '.sd-detail-tab', function () {
			var t = $(this).data('tab');
			modal.find('.sd-detail-tab').removeClass('on');
			$(this).addClass('on');
			modal.find('.sd-detail-panel').removeClass('on');
			modal.find('.sd-detail-panel[data-panel="' + t + '"]').addClass('on');
		});
		modal.on('click', '.sd-doc-row-head', function () {
			var row = $(this).closest('.sd-doc-row');
			if (row.hasClass('sd-doc-missing')) return;
			var body = row.find('.sd-doc-row-body');
			if (row.hasClass('sd-doc-open')) { row.removeClass('sd-doc-open'); return; }
			row.siblings('.sd-doc-open').removeClass('sd-doc-open');
			if (!body.data('rendered')) {
				var preview_url = body.data('preview-url');
				body.html(self._preview_body_html(preview_url));
				body.data('rendered', true);

				if (self._preview_needs_conversion(preview_url)) {
					var ext = (preview_url.split('?')[0].split('.').pop() || '').toLowerCase();
					window.SIIDOfficePreview.render(body, preview_url, ext).catch(function (err) {
						body.find('.sd-doc-convert-status').html(
							`${frappe.utils.escape_html((err && err.message) || 'Could not render a preview for this file.')}
							<a href="${preview_url}" target="_blank" class="btn btn-default btn-sm" style="margin-left:8px">Open / Download</a>`
						);
					});
				}
			}
			row.addClass('sd-doc-open');
		});
		modal.on('click', '.sd-copy-btn', function (e) {
			e.stopPropagation();
			var value = $(this).data('copy');
			var btn = $(this);
			var done = function () {
				var original = btn.text();
				btn.text('Copied!');
				setTimeout(() => btn.text(original), 1200);
			};
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(value).then(done).catch(function () {
					frappe.show_alert({ message: 'Could not copy — please copy manually.', indicator: 'orange' });
				});
			} else {
				var tmp = document.createElement('textarea');
				tmp.value = value;
				document.body.appendChild(tmp);
				tmp.select();
				document.execCommand('copy');
				document.body.removeChild(tmp);
				done();
			}
		});
		modal.on('click', '.sd-action-open', function (e) {
			e.preventDefault();
			if (!current_detail_doc) return;
			self.open_action_modal($(this).data('action'), current_detail_doc, function (updated_doc) {
				show_detail_mode(updated_doc);
			});
		});
		modal.on('click', '.sd-close-case-open', function (e) {
			e.preventDefault();
			if (!current_detail_doc) return;
			self.open_close_case_modal(current_detail_doc, function (updated_doc) {
				show_detail_mode(updated_doc);
			});
		});
		$(document).on('keydown.sd-modal', function (e) {
			if (e.key === 'Escape') { modal.remove(); $(document).off('keydown.sd-modal'); }
		});
		modal.find('.sd-modal-close, .sd-modal-close-bottom').on('click', function () {
			$(document).off('click.sd-dropdown-close');
			$(document).off('click.sd-export-close');
		});

		$('body').append(modal);
	}

	// ---------------- Approval actions (Approve / Send Back / Decline) ----------------

	submit_case_approval(doc, action, comments, onDone) {
		var self = this;
		var past = ACTION_PAST[action] || (action.toLowerCase() + 'd');

		frappe.call({
			method: 'support_iid.support_iid.doctype.case_register.case_register.process_case_approval',
			args: { case_name: doc.name, action: action, comments: comments },
			freeze: true,
			freeze_message: 'Processing...',
			callback: function (r) {
				if (!r || !r.message) return;
				frappe.show_alert({ message: 'Case ' + past + '.', indicator: 'green' });
				frappe.call({
					method: 'frappe.client.get',
					args: { doctype: 'Case Register', name: doc.name },
					callback: function (r2) { if (r2 && r2.message) onDone(r2.message); }
				});
			}
		});
	}

	open_action_modal(action, doc, onDone) {
		$('.sd-action-modal-backdrop').remove();

		var current = get_current_stage(doc);
		var level_label = current ? (current.stage.case_approval_level_decription || '') : '';
		var self = this;
		var accent = action === 'Decline' ? '#c0392b' : action === 'Send Back' ? '#b9770e' : '#2490ef';

		var modal = $(`
			<div class="sd-modal-backdrop sd-action-modal-backdrop" style="z-index:1300">
				<div class="sd-modal" style="max-width:520px">
					<div class="sd-modal-header">
						<div class="sd-modal-header-left"><div class="sd-modal-title">${frappe.utils.escape_html(ACTION_LABEL[action] || action)}</div></div>
						<div class="sd-modal-header-right"><button class="sd-modal-close" aria-label="Close" data-tooltip="Close">&times;</button></div>
					</div>
					<div class="sd-modal-body sd-modal-body-padded sd-action-modal-body">
						<div style="margin-bottom:18px">
							<label>Approval Level</label>
							<div style="font-weight:600;font-size:14.5px">${frappe.utils.escape_html(level_label || '—')}</div>
						</div>
						<label>Comments</label>
						<textarea class="form-control" id="sd-action-comment" rows="5" placeholder="Add a comment (optional)"></textarea>
						<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
							<button class="btn btn-default btn-sm" id="sd-action-cancel">Cancel</button>
							<button class="btn btn-sm" id="sd-action-submit" style="background:${accent};color:#fff">Submit</button>
						</div>
					</div>
				</div>
			</div>
		`);

		modal.on('click', function (e) { if (e.target === this) modal.remove(); });
		modal.find('.sd-modal-close, #sd-action-cancel').on('click', function () { modal.remove(); });
		modal.find('#sd-action-submit').on('click', function () {
			var comments = modal.find('#sd-action-comment').val();
			modal.remove();
			self.submit_case_approval(doc, action, comments, onDone);
		});

		$('body').append(modal);
	}

	// ---------------- Close Case (Reviewer / admin, Approved cases only) ----------------

	open_close_case_modal(doc, onDone) {
		$('.sd-close-modal-backdrop').remove();
		var self = this;

		var modal = $(`
			<div class="sd-modal-backdrop sd-close-modal-backdrop" style="z-index:1300">
				<div class="sd-modal" style="max-width:520px">
					<div class="sd-modal-header">
						<div class="sd-modal-header-left"><div class="sd-modal-title">Close Case</div></div>
						<div class="sd-modal-header-right"><button class="sd-modal-close" aria-label="Close" data-tooltip="Close">&times;</button></div>
					</div>
					<div class="sd-modal-body sd-modal-body-padded sd-action-modal-body">
						<div style="margin-bottom:14px">
							<label>Date of Transfer</label>
							<div style="font-weight:600;font-size:14.5px">${frappe.datetime.str_to_user(frappe.datetime.get_today())}</div>
						</div>
						<div style="margin-bottom:14px">
							<label>Approved Amount <span style="color:#c0392b">*</span></label>
							<input type="number" step="0.01" class="form-control" id="sd-close-approved-amount" value="${doc.approved_amount || ''}">
							<div class="field-error-msg" id="sd-close-amount-error" style="display:none;color:#c0392b;font-size:12px;margin-top:4px"></div>
						</div>
						<div style="margin-bottom:14px">
							<label>UTR Details</label>
							<input type="text" class="form-control" id="sd-close-utr" value="${frappe.utils.escape_html(doc.utr_details || '')}">
						</div>
						<div style="margin-bottom:14px">
							<label>Milaap Recommendation</label>
							<textarea class="form-control" id="sd-close-milaap-recommendation" rows="3">${frappe.utils.escape_html(doc.milaap_recommendation || '')}</textarea>
						</div>
						<div style="margin-bottom:0">
							<label>Milaap Campaign Link</label>
							<input type="text" class="form-control" id="sd-close-milaap-link" value="${frappe.utils.escape_html(doc.milaap_campaign_link || '')}">
						</div>
						<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
							<button class="btn btn-default btn-sm" id="sd-close-cancel">Cancel</button>
							<button class="btn btn-sm btn-primary" id="sd-close-submit">Close Case</button>
						</div>
					</div>
				</div>
			</div>
		`);

		modal.on('click', function (e) { if (e.target === this) modal.remove(); });
		modal.find('.sd-modal-close, #sd-close-cancel').on('click', function () { modal.remove(); });

		$('body').append(modal);

		modal.find('#sd-close-submit').on('click', function () {
			var amount = modal.find('#sd-close-approved-amount').val();
			if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
				modal.find('#sd-close-amount-error').text('Approved Amount is required.').show();
				return;
			}
			var payload = {
				approved_amount: amount,
				utr_details: modal.find('#sd-close-utr').val(),
				milaap_recommendation: modal.find('#sd-close-milaap-recommendation').val(),
				milaap_campaign_link: modal.find('#sd-close-milaap-link').val()
			};
			modal.remove();
			self.submit_close_case(doc, payload, onDone);
		});
	}

	submit_close_case(doc, payload, onDone) {
		var self = this;

		frappe.call({
			method: 'support_iid.support_iid.doctype.case_register.case_register.close_case',
			args: Object.assign({ case_name: doc.name }, payload),
			freeze: true,
			freeze_message: 'Closing case...',
			callback: function (r) {
				if (!r || !r.message) return;
				frappe.show_alert({ message: 'Case closed.', indicator: 'green' });
				frappe.call({
					method: 'frappe.client.get',
					args: { doctype: 'Case Register', name: doc.name },
					callback: function (r2) { if (r2 && r2.message) onDone(r2.message); }
				});
			}
		});
	}

	// ---------------- Case detail markup (rendered inline into the drill-down modal) ----------------

	build_action_control_html(doc) {
		var user = frappe.session.user;
		var is_admin = user === 'Administrator' ||
			(frappe.user_roles || []).indexOf('System Manager') > -1;
		var can_close = is_admin || (frappe.user_roles || []).indexOf('Reviewer') > -1;

		if (doc.case_status === 'Approved') {
			if (!can_close) return '';
			return `
				<button type="button" class="btn btn-primary btn-sm sd-close-case-open" data-tooltip="Record transfer details and close this case">
					${icon('checkCircle', 13)} Close Case
				</button>`;
		}

		var current = get_current_stage(doc);
		if (!current) return '';

		var can_act = is_admin ||
			(frappe.user_roles || []).indexOf('Support IID Approver') > -1 ||
			(current.stage.approver_email || '').toLowerCase() === user.toLowerCase();

		if (!can_act) {
			return `<span class="indicator-pill orange" style="white-space:nowrap;box-shadow:none">Awaiting: ${frappe.utils.escape_html(current.stage.approver_name || current.stage.approver_email || 'approver')}</span>`;
		}

		return `
			<div class="btn-group sd-action-dropdown">
				<button type="button" class="btn btn-primary btn-sm dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
					${icon('sliders', 13)} Take Action
				</button>
				<div class="dropdown-menu dropdown-menu-right">
					<a class="dropdown-item sd-action-open" data-action="Approve" href="#">Approve</a>
					<a class="dropdown-item sd-action-open" data-action="Send Back" href="#">Send Back</a>
					<a class="dropdown-item sd-action-open" data-action="Decline" href="#">Decline</a>
				</div>
			</div>`;
	}

	build_case_detail_html(doc) {
		var isMedical = (doc.type_of_request || '').toLowerCase() === 'medical';

		function row(label, value, wide) {
			var has = value !== null && value !== undefined && value !== '';
			return `<div${wide ? ' style="grid-column:1/-1"' : ''}>
				<div class="sd-field-label">${label}</div>
				<div class="sd-field-value${has ? '' : ' sd-empty'}">${has ? frappe.utils.escape_html(String(value)) : 'Not provided'}</div>
			</div>`;
		}
		function row_copy(label, value) {
			var has = value !== null && value !== undefined && value !== '';
			var display = has
				? `<span class="sd-copy-field"><span>${frappe.utils.escape_html(String(value))}</span>
					<button type="button" class="sd-copy-btn" data-copy="${frappe.utils.escape_html(String(value))}" title="Copy">${icon('copy', 13)}</button></span>`
				: 'Not provided';
			return `<div><div class="sd-field-label">${label}</div><div class="sd-field-value${has ? '' : ' sd-empty'}">${display}</div></div>`;
		}
		function file_ext(url) {
			if (!url || url === '#') return '';
			return (url.split('?')[0].split('.').pop() || '').toLowerCase();
		}
		function preview_body_html(url) {
			if (!url || url === '#') {
				return '<div class="sd-empty-note" style="padding:14px 0;text-align:left">This is sample data — no real file is attached.</div>';
			}
			var ext = file_ext(url);
			if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].indexOf(ext) > -1) {
				return `<div style="text-align:center"><img src="${url}" style="max-width:100%;max-height:60vh;border-radius:6px"></div>`;
			}
			if (ext === 'pdf') {
				return `<iframe src="${url}" style="width:100%;height:60vh;border:none;border-radius:6px"></iframe>`;
			}
			if (['mp4', 'webm', 'ogg', 'mov'].indexOf(ext) > -1) {
				return `<video src="${url}" controls style="width:100%;max-height:60vh;border-radius:6px"></video>`;
			}
			if (['txt', 'json', 'log'].indexOf(ext) > -1) {
				return `<iframe src="${url}" style="width:100%;height:60vh;border:none;border-radius:6px"></iframe>`;
			}
			if (window.SIIDOfficePreview && window.SIIDOfficePreview.isSupported(ext)) {
				return `<div class="sd-empty-note sd-doc-convert-status" style="padding:20px 0;text-align:left">Preparing preview…</div>`;
			}
			if (window.SIIDOfficePreview && window.SIIDOfficePreview.isUnsupportedOffice(ext)) {
				return `<div class="sd-empty-note" style="padding:20px 0;text-align:left">
					In-browser preview isn't available for .${frappe.utils.escape_html(ext)} files. Please download to view.
					<a href="${url}" target="_blank" class="btn btn-default btn-sm" style="margin-left:8px">Open / Download</a>
				</div>`;
			}
			return `<div class="sd-empty-note" style="padding:20px 0;text-align:left">
				Preview isn't available for this file type${ext ? ' (.' + frappe.utils.escape_html(ext) + ')' : ''}.
				<a href="${url}" target="_blank" class="btn btn-default btn-sm" style="margin-left:8px">Open / Download</a>
			</div>`;
		}
		this._preview_body_html = preview_body_html;
		this._preview_needs_conversion = function (url) {
			return window.SIIDOfficePreview && window.SIIDOfficePreview.isSupported(file_ext(url));
		};

		var docs = doc.supporting_documents || [];
		var docs_html = '<div class="sd-doc-accordion">' + (docs.length ? docs.map((d) => {
			if (!d.attachment) {
				return `<div class="sd-doc-row sd-doc-missing">
					<div class="sd-doc-row-head">
						<span class="sd-doc-chevron">&#9656;</span>
						<div class="sd-doc-icon-sm" style="background:#c3c9d1">—</div>
						<div class="sd-doc-title">${frappe.utils.escape_html(d.document_name || 'Document')}</div>
						<div class="sd-doc-remarks">Not uploaded</div>
					</div>
				</div>`;
			}
			var ext = file_ext(d.attachment);
			return `<div class="sd-doc-row" data-doc-url="${frappe.utils.escape_html(d.attachment)}">
				<div class="sd-doc-row-head">
					<span class="sd-doc-chevron">&#9656;</span>
					<div class="sd-doc-icon-sm">${ext ? ext.slice(0, 4) : 'FILE'}</div>
					<div class="sd-doc-title">${frappe.utils.escape_html(d.document_name || 'Document')}</div>
					<div class="sd-doc-remarks">${d.remarks ? frappe.utils.escape_html(d.remarks) : ''}</div>
				</div>
				<div class="sd-doc-row-body" data-preview-url="${frappe.utils.escape_html(d.attachment)}"></div>
			</div>`;
		}).join('') : '<div class="sd-empty-note">No documents uploaded.</div>') + '</div>';

		var fam = doc.family_members || [];
		var fam_html = fam.length ? `
			<table class="sd-family-table">
				<thead><tr><th>Name</th><th>Relationship</th><th>Age</th><th>Occupation</th><th>Monthly Income</th><th>Qualification</th></tr></thead>
				<tbody>${fam.map((m) => `<tr>
					<td>${frappe.utils.escape_html(m.member_name || '')}</td>
					<td>${frappe.utils.escape_html(m.relationship || '')}</td>
					<td>${frappe.utils.escape_html(m.age || '')}</td>
					<td>${frappe.utils.escape_html(m.occupation || '')}</td>
					<td>${format_currency(m.monthly_income || 0)}</td>
					<td>${frappe.utils.escape_html(m.qualification || '')}</td>
				</tr>`).join('')}</tbody>
			</table>` : '<div class="sd-empty-note">No family members added.</div>';

		var stages = doc.case_approval_stage || [];
		var stages_html = stages.length ? stages.map((s) => {
			var st = s.case_approval_status || 'Pending';
			var color = st === 'Approve' ? 'green' : st === 'Decline' ? 'red' : st === 'Send Back' ? 'orange' : 'gray';
			return `<div class="sd-stage-row">
				<span class="indicator-pill ${color}">${frappe.utils.escape_html(ACTION_LABEL[st] || st)}</span>
				<span><strong>${frappe.utils.escape_html(s.case_approval_level_decription || '')}</strong> — ${frappe.utils.escape_html(s.approver_name || s.approver_email || '')}</span>
			</div>`;
		}).join('') : '<div class="sd-empty-note">No approval stages configured.</div>';

		var log = doc.case_approval_log || [];
		var log_html = log.length ? log.slice().reverse().map((l) => `
			<div class="sd-log-item">
				<div class="sd-log-meta">${l.date ? frappe.datetime.str_to_user(l.date) : ''} &middot; ${frappe.utils.escape_html(l.level || '')} &middot; ${frappe.utils.escape_html(l.approver_name || '')}</div>
				<div><strong>${frappe.utils.escape_html(ACTION_LABEL[l.action] || l.action || '')}</strong>${l.comments ? ' — ' + frappe.utils.escape_html(l.comments) : ''}</div>
			</div>
		`).join('') : '<div class="sd-empty-note">No activity logged yet.</div>';

		return `
			<div class="sd-detail-hero">
				<div>
					<div class="sd-detail-name">${frappe.utils.escape_html(doc.beneficiary_name || '')}</div>
					<div class="sd-hero-stats">
						<div class="sd-hero-stat"><div class="sd-hero-stat-label">Case ID</div><div class="sd-hero-stat-value">${frappe.utils.escape_html(doc.name)}</div></div>
						<div class="sd-hero-stat"><div class="sd-hero-stat-label">Case Type</div><div class="sd-hero-stat-value">${frappe.utils.escape_html(doc.type_of_request || '—')}</div></div>
						<div class="sd-hero-stat"><div class="sd-hero-stat-label">Location</div><div class="sd-hero-stat-value">${frappe.utils.escape_html(doc.district || '')}${doc.state ? ', ' + frappe.utils.escape_html(doc.state) : ''}</div></div>
						<div class="sd-hero-stat"><div class="sd-hero-stat-label">Filed</div><div class="sd-hero-stat-value">${doc.request_date ? frappe.datetime.str_to_user(doc.request_date) : '—'}</div></div>
					</div>
				</div>
				<div style="text-align:right">
					<span class="indicator-pill ${status_color(doc.case_status)}" style="margin-bottom:8px;display:inline-block;box-shadow:none;filter:none">${frappe.utils.escape_html(display_status(doc))}</span>
					<div class="sd-hero-amount">${format_currency(doc.funds_requested || 0)}</div>
					<div class="sd-hero-amount-label">requested</div>
				</div>
			</div>

			<div class="sd-detail-tabs">
				<div class="sd-detail-tab on" data-tab="overview">Overview</div>
				<div class="sd-detail-tab" data-tab="family">Family</div>
				<div class="sd-detail-tab" data-tab="documents">Documents</div>
				<div class="sd-detail-tab" data-tab="activity">Approval &amp; Activity</div>
			</div>

			<div class="sd-detail-panel on" data-panel="overview">
				<div class="sd-detail-grid">
					<div class="sd-section">
						<div class="sd-section-title">Requestor</div>
						<div class="sd-field-grid">
							${row_copy('Requestor Email', doc.requestor_email)}
							${row('Requestor Name', doc.requestor_name)}
							${row('Department', doc.department)}
							${row('Work Location', doc.work_location)}
							${row('Source of Request', doc.source_of_request)}
						</div>
					</div>
					<div class="sd-section">
						<div class="sd-section-title">Beneficiary</div>
						<div class="sd-field-grid">
							${row('Age', doc.age)}
							${row('Gender', doc.gender)}
							${row('Mobile Number', doc.mobile_number)}
							${row_copy('Email', doc.email)}
							${row('Qualification', doc.qualification)}
							${row('Employment Status', doc.employment_status)}
							${row('Marital Status', doc.marital_status)}
							${row('District / State', (doc.district || '') + (doc.state ? ', ' + doc.state : ''))}
							${row('Pincode', doc.pincode)}
							${row('Address', doc.address_line_1, true)}
							${row('Note about individual', doc.note_about_the_individual, true)}
						</div>
					</div>
					<div class="sd-section">
						<div class="sd-section-title">Request Details</div>
						<div class="sd-field-grid">
							${row(isMedical ? 'Hospital Name' : 'Institution Name', doc.hospital_institution_name)}
							${row('Location', doc.hospital_institution_location)}
							${row('Funds Requested', format_currency(doc.funds_requested || 0))}
							${row('Amount Already Spent', format_currency(doc.amount_already_spent || 0))}
							${isMedical ? row('Treatment', doc.treatment) : ''}
							${row(isMedical ? 'Ailment Details' : 'Course Details', doc.ailment__course_details, true)}
						</div>
					</div>
					<div class="sd-section">
						<div class="sd-section-title">Financial &amp; Insurance</div>
						<div class="sd-field-grid">
							${row('Annual Family Income', format_currency(doc.annual_family_income || 0))}
							${row('Residence Type', doc.residence_type)}
							${row('Insurance Type', doc.insurance_type)}
							${row('Existing Debt', doc.existing_debt, true)}
							${row('Residence Details', doc.residence_details, true)}
							${row('Insurance Details', doc.insurance_coverage_details, true)}
						</div>
					</div>
					<div class="sd-section sd-span-full">
						<div class="sd-section-title">Verification &amp; Assessment</div>
						<div class="sd-field-grid">
							${row('Physical Verification', doc.physical_verification)}
							${row('Milaap Campaign Link', doc.milaap_campaign_link)}
							${row('Verification Notes', doc.physical_verification_notes, true)}
							${row('Genuineness Assessment', doc.genuineness_assessment, true)}
							${row('Vulnerability Assessment', doc.vulnerability_assessment, true)}
							${row('Milaap Recommendation', doc.milaap_recommendation, true)}
						</div>
					</div>
				</div>
			</div>

			<div class="sd-detail-panel" data-panel="family">${fam_html}</div>
			<div class="sd-detail-panel" data-panel="documents">${docs_html}</div>
			<div class="sd-detail-panel" data-panel="activity">
				<div class="sd-detail-grid">
					<div class="sd-section">
						<div class="sd-section-title">Approval Stages</div>
						${stages_html}
					</div>
					<div class="sd-section">
						<div class="sd-section-title">Activity Log</div>
						${log_html}
					</div>
				</div>
			</div>
		`;
	}
}
frappe.pages['company-directory'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Company Directory',
		single_column: true
	});

	var directory = new CompanyDirectory(page);

	page.set_secondary_action('Export to Excel', function () {
		directory.export_current_company();
	}, 'download');

	page.add_menu_item('Export All Companies', function () {
		directory.export_all_companies();
	});

	frappe.realtime.on('directory_export_all_done', function (data) {
		frappe.show_alert({
			message: 'Company Directory export ready (' + data.row_count + ' people) — check the notification bell to download.',
			indicator: 'green'
		}, 8);
	});
};

class CompanyDirectory {
	constructor(page) {
		this.page = page;
		this.company = null;
		this.rows = [];
		this.expanded = {};
		this.reportee_cache = {};

		this.inject_styles();
		this.render_shell();
		this.load_companies();
	}

	inject_styles() {
		if (document.getElementById('cd-directory-style')) return;
		var style = document.createElement('style');
		style.id = 'cd-directory-style';
		style.textContent = `
			.cd-card { background:var(--card-bg,#fff); border:1px solid var(--border-color,#d1d8dd); border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04); }
			.cd-toolbar { display:flex; align-items:center; gap:12px; margin-bottom:18px; flex-wrap:wrap; padding:16px 20px; position:sticky; top:0; z-index:2; }
			.cd-toolbar label { font-size:11px; font-weight:700; color:var(--text-muted,#8d99a6); text-transform:uppercase; letter-spacing:.05em; }
			.cd-toolbar select { min-width:260px; padding:8px 12px; border:1.5px solid var(--border-color,#d1d8dd); border-radius:8px; font-size:13.5px; background:var(--card-bg,#fff); color:var(--text-color,#1a1a1a); transition:border-color .12s, box-shadow .12s; }
			.cd-toolbar select:focus { outline:none; border-color:var(--primary,#2490ef); box-shadow:0 0 0 2px rgba(36,144,239,.18); }
			.cd-count { font-size:12.5px; font-weight:500; color:var(--text-muted,#8d99a6); margin-left:auto; }
			.cd-table-wrap { overflow-x:auto; border-radius:12px; }
			.cd-table { width:100%; border-collapse:collapse; font-size:13.5px; min-width:760px; }
			.cd-table th { text-align:left; padding:12px 20px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted,#8d99a6); border-bottom:2px solid var(--border-color,#d1d8dd); white-space:nowrap; position:sticky; top:0; background:var(--card-bg,#fff); }
			.cd-table td { padding:12px 20px; border-bottom:1px solid var(--border-color,#eceef0); vertical-align:top; }
			.cd-table tbody tr:last-child td { border-bottom:none; }
			.cd-table tbody tr:hover { background:var(--row-hover,#f8f9fa); }
			.cd-name { font-weight:600; color:var(--text-color,#1a1a1a); }
			.cd-sub { font-size:12px; color:var(--text-muted,#8d99a6); margin-top:2px; }
			.cd-email { color:var(--primary,#2490ef); word-break:break-all; }
			.cd-reportee-toggle { display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-weight:600; color:var(--primary,#2490ef); user-select:none; }
			.cd-reportee-toggle .cd-caret { transition:transform .12s; font-size:10px; }
			.cd-reportee-toggle.open .cd-caret { transform:rotate(90deg); }
			.cd-reportee-panel td { padding:0 20px 16px 20px; background:var(--row-hover,#f8f9fa); }
			.cd-tree { margin-top:10px; }
			.cd-tree-node { margin-bottom:6px; }
			.cd-tree-row { display:flex; align-items:center; gap:10px; background:var(--card-bg,#fff); border:1px solid var(--border-color,#e3e8ec); border-radius:8px; padding:9px 11px; }
			.cd-tree-toggle { flex-shrink:0; width:20px; height:20px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--text-muted,#8d99a6); border-radius:5px; }
			.cd-tree-toggle:hover { background:var(--control-bg,#f0f2f5); }
			.cd-tree-toggle .cd-caret { transition:transform .12s; font-size:10px; }
			.cd-tree-toggle.open .cd-caret { transform:rotate(90deg); }
			.cd-tree-toggle.leaf { visibility:hidden; cursor:default; }
			.cd-tree-info { flex:1; min-width:0; }
			.cd-tree-info .cd-name { font-size:12.5px; }
			.cd-tree-info .cd-sub { font-size:11.5px; }
			.cd-tree-count { flex-shrink:0; font-size:11px; font-weight:600; color:var(--text-muted,#8d99a6); background:var(--control-bg,#f0f2f5); padding:2px 8px; border-radius:20px; }
			.cd-tree-children { margin-left:26px; margin-top:6px; padding-left:14px; border-left:2px solid var(--border-color,#e3e8ec); }
			.cd-tree-loading, .cd-tree-empty { font-size:12px; color:var(--text-muted,#8d99a6); padding:6px 2px; }
			.cd-empty-state { padding:56px 20px; text-align:center; color:var(--text-muted,#8d99a6); font-size:13.5px; }
			.cd-loading-row td { text-align:center; padding:36px; color:var(--text-muted,#8d99a6); }

			@media (max-width:640px) {
				.cd-toolbar { flex-direction:column; align-items:stretch; position:static; }
				.cd-toolbar select { min-width:0; width:100%; }
				.cd-count { margin-left:0; }
			}
		`;
		document.head.appendChild(style);
	}

	render_shell() {
		this.page.main.html(`
			<div class="cd-card cd-toolbar">
				<label>Company</label>
				<select class="cd-company-select">
					<option value="">Loading companies…</option>
				</select>
				<span class="cd-count"></span>
			</div>
			<div class="cd-card cd-table-wrap">
				<table class="cd-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Email</th>
							<th>Department</th>
							<th>Designation</th>
							<th>Reportees</th>
						</tr>
					</thead>
					<tbody class="cd-tbody"></tbody>
				</table>
			</div>
		`);

		this.select_el = this.page.main.find('.cd-company-select');
		this.tbody_el = this.page.main.find('.cd-tbody');
		this.count_el = this.page.main.find('.cd-count');

		var self = this;
		this.select_el.on('change', function () {
			self.company = $(this).val();
			self.load_users();
		});

		this.render_prompt('Choose a company to load its directory.');
	}

	render_prompt(message) {
		this.tbody_el.html(
			'<tr><td colspan="5" class="cd-empty-state">' + frappe.utils.escape_html(message) + '</td></tr>'
		);
		this.count_el.text('');
	}

	load_companies() {
		var self = this;
		frappe.call({
			method: 'support_iid.api.microsoft_graph.get_directory_companies',
			freeze: false,
			callback: function (r) {
				var result = (r && r.message) || {};
				var companies = result.items || [];

				if (result.error) {
					frappe.show_alert({ message: result.error, indicator: 'orange' });
				}

				if (!companies.length) {
					self.select_el.html('<option value="">No companies found</option>');
					self.render_prompt(
						result.error ? result.error : 'No companies were returned by the directory.'
					);
					return;
				}
				var options = '<option value="">Select a company…</option>' +
					companies.map(function (c) {
						return '<option value="' + frappe.utils.escape_html(c) + '">' + frappe.utils.escape_html(c) + '</option>';
					}).join('');
				self.select_el.html(options);
			},
			error: function () {
				self.select_el.html('<option value="">Failed to load companies</option>');
				self.render_prompt('Could not load the company list. Please try again.');
			}
		});
	}

	load_users() {
		var self = this;
		this.expanded = {};
		this.reportee_cache = {};

		if (!this.company) {
			this.render_prompt('Choose a company to load its directory.');
			return;
		}

		this.tbody_el.html('<tr class="cd-loading-row"><td colspan="5">Loading directory…</td></tr>');
		this.count_el.text('');

		frappe.call({
			method: 'support_iid.api.microsoft_graph.get_directory_users',
			args: { company: this.company },
			freeze: false,
			callback: function (r) {
				var result = (r && r.message) || {};
				self.rows = result.items || [];
				if (result.error) {
					frappe.show_alert({ message: result.error, indicator: 'orange' });
				}
				self.render_rows();
			},
			error: function () {
				self.render_prompt('Could not load the directory for this company. Please try again.');
			}
		});
	}

	render_rows() {
		if (!this.rows.length) {
			this.render_prompt('No employees found for this company.');
			return;
		}

		var self = this;
		this.count_el.text(this.rows.length + (this.rows.length === 1 ? ' person' : ' people'));

		var html = this.rows.map(function (row) {
			var is_open = !!self.expanded[row.id];
			var main_row = `
				<tr data-user-id="${frappe.utils.escape_html(row.id || '')}">
					<td>
						<div class="cd-name">${frappe.utils.escape_html(row.name || '-')}</div>
						<div class="cd-sub">${frappe.utils.escape_html(row.company || '')}</div>
					</td>
					<td class="cd-email">${frappe.utils.escape_html(row.email || '-')}</td>
					<td>${frappe.utils.escape_html(row.department || '-')}</td>
					<td>${frappe.utils.escape_html(row.designation || '-')}</td>
					<td>
						${row.reportee_count
							? `<span class="cd-reportee-toggle ${is_open ? 'open' : ''}" data-user-id="${frappe.utils.escape_html(row.id || '')}">
								<span class="cd-caret">&#9656;</span>${row.reportee_count} report${row.reportee_count === 1 ? '' : 's'}
							</span>`
							: '<span class="cd-sub">None</span>'}
					</td>
				</tr>
			`;
			var reportee_row = (row.reportee_count && is_open)
				? `<tr class="cd-reportee-panel"><td colspan="5">${self.render_tree_children(row.id)}</td></tr>`
				: '';
			return main_row + reportee_row;
		}).join('');

		this.tbody_el.html(html);
	}

	// Renders one level of the reportee tree under `user_id` — each child
	// gets its own toggle, so this is called recursively (once per
	// expanded node, at whatever depth) rather than being a fixed
	// one-level lookup. Every level reuses the same get_directory_reportees
	// call and the same expanded/reportee_cache maps keyed by user id —
	// depth doesn't need its own bookkeeping since a Graph user id is
	// already globally unique regardless of where it sits in the tree.
	render_tree_children(user_id) {
		var cached = this.reportee_cache[user_id];
		if (!cached) {
			return '<div class="cd-tree-loading">Loading reportees…</div>';
		}
		if (cached.error) {
			return '<div class="cd-tree-loading">' + frappe.utils.escape_html(cached.error) + '</div>';
		}
		if (!cached.items.length) {
			return '<div class="cd-tree-empty">No reportees found.</div>';
		}

		var self = this;
		return '<div class="cd-tree">' + cached.items.map(function (r) {
			return self.render_tree_node(r);
		}).join('') + '</div>';
	}

	render_tree_node(person) {
		var has_reports = person.reportee_count !== 0; // undefined (unknown yet) or >0 both show a toggle
		var is_open = !!this.expanded[person.id];
		var child_html = is_open ? this.render_tree_children(person.id) : '';

		return `
			<div class="cd-tree-node">
				<div class="cd-tree-row">
					<span class="cd-tree-toggle ${has_reports ? '' : 'leaf'} ${is_open ? 'open' : ''}" data-user-id="${frappe.utils.escape_html(person.id || '')}">
						<span class="cd-caret">&#9656;</span>
					</span>
					<div class="cd-tree-info">
						<div class="cd-name">${frappe.utils.escape_html(person.name || '-')}</div>
						<div class="cd-sub cd-email">${frappe.utils.escape_html(person.email || '-')}</div>
						${person.designation ? `<div class="cd-sub">${frappe.utils.escape_html(person.designation)}</div>` : ''}
					</div>
				</div>
				${is_open ? `<div class="cd-tree-children">${child_html}</div>` : ''}
			</div>
		`;
	}

	toggle_reportees(user_id) {
		var self = this;
		this.expanded[user_id] = !this.expanded[user_id];

		if (this.expanded[user_id] && !this.reportee_cache[user_id]) {
			this.render_rows();
			this.fetch_reportees(user_id);
			return;
		}

		this.render_rows();
	}

	fetch_reportees(user_id) {
		var self = this;
		frappe.call({
			method: 'support_iid.api.microsoft_graph.get_directory_reportees',
			args: { user_id: user_id },
			freeze: false,
			callback: function (r) {
				var result = (r && r.message) || {};
				self.reportee_cache[user_id] = { items: result.items || [], error: result.error || null };
				self.render_rows();
			},
			error: function () {
				self.reportee_cache[user_id] = {
					items: [],
					error: 'Could not load reportees. Please try again.',
				};
				self.render_rows();
			}
		});
	}

	export_current_company() {
		if (!this.company) {
			frappe.show_alert({ message: 'Select a company first.', indicator: 'orange' });
			return;
		}
		open_url_post(
			'/api/method/support_iid.api.microsoft_graph.export_directory_company',
			{ company: this.company }
		);
	}

	export_all_companies() {
		frappe.confirm(
			'This exports every company in the directory. With a large tenant this can take '
			+ 'several minutes to run in the background — you\'ll get a notification with a '
			+ 'download link when it\'s ready. Continue?',
			function () {
				frappe.call({
					method: 'support_iid.api.microsoft_graph.export_directory_all_companies',
					freeze: false,
					callback: function () {
						frappe.show_alert({
							message: 'Export started — you\'ll be notified when the file is ready.',
							indicator: 'blue'
						}, 6);
					}
				});
			}
		);
	}
}

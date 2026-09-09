frappe.pages['company-directory'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Company Directory',
		single_column: true
	});

	var directory = new CompanyDirectory(page);

	page.set_secondary_action('Refresh', function () {
		directory.start_load();
	}, 'refresh');

	page.add_menu_item('Export to Excel', function () {
		directory.export_all_companies();
	});

	frappe.realtime.on('directory_full_load_done', function (data) {
		directory.on_load_done(data);
	});

	frappe.realtime.on('directory_export_all_done', function (data) {
		frappe.show_alert({
			message: 'Company Directory export ready (' + data.row_count + ' people) — check the notification bell to download.',
			indicator: 'green'
		}, 8);
	});

	frappe.realtime.on('progress', function (data) {
		directory.on_progress(data);
	});
};

class CompanyDirectory {
	constructor(page) {
		this.page = page;
		this.rows = [];

		this.inject_styles();
		this.render_shell();
		this.check_existing_result();
	}

	inject_styles() {
		if (document.getElementById('cd-directory-style')) return;
		var style = document.createElement('style');
		style.id = 'cd-directory-style';
		style.textContent = `
			.cd-card { background:var(--card-bg,#fff); border:1px solid var(--border-color,#d1d8dd); border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04); }
			.cd-toolbar { display:flex; align-items:center; gap:12px; margin-bottom:18px; flex-wrap:wrap; padding:16px 20px; position:sticky; top:0; z-index:2; }
			.cd-count { font-size:12.5px; font-weight:500; color:var(--text-muted,#8d99a6); }
			.cd-progress-wrap { flex:1; min-width:200px; display:flex; align-items:center; gap:10px; }
			.cd-progress-bar-track { flex:1; height:6px; border-radius:4px; background:var(--control-bg,#f0f2f5); overflow:hidden; }
			.cd-progress-bar-fill { height:100%; background:var(--primary,#2490ef); border-radius:4px; transition:width .2s ease; }
			.cd-progress-label { font-size:12px; color:var(--text-muted,#8d99a6); white-space:nowrap; }
			.cd-table-wrap { overflow-x:auto; border-radius:12px; }
			.cd-table { width:100%; border-collapse:collapse; font-size:13.5px; min-width:900px; }
			.cd-table th { text-align:left; padding:12px 20px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted,#8d99a6); border-bottom:2px solid var(--border-color,#d1d8dd); white-space:nowrap; position:sticky; top:0; background:var(--card-bg,#fff); }
			.cd-table td { padding:12px 20px; border-bottom:1px solid var(--border-color,#eceef0); vertical-align:top; }
			.cd-table tbody tr:last-child td { border-bottom:none; }
			.cd-table tbody tr:hover { background:var(--row-hover,#f8f9fa); }
			.cd-name { font-weight:600; color:var(--text-color,#1a1a1a); }
			.cd-sub { font-size:12px; color:var(--text-muted,#8d99a6); margin-top:2px; }
			.cd-email { color:var(--primary,#2490ef); word-break:break-all; }
			.cd-reportees-cell { max-width:320px; white-space:normal; font-size:12.5px; color:var(--text-color,#1a1a1a); }
			.cd-empty-state { padding:56px 20px; text-align:center; color:var(--text-muted,#8d99a6); font-size:13.5px; }
			.cd-loading-row td { text-align:center; padding:36px; color:var(--text-muted,#8d99a6); }

			@media (max-width:640px) {
				.cd-toolbar { flex-direction:column; align-items:stretch; position:static; }
			}
		`;
		document.head.appendChild(style);
	}

	render_shell() {
		this.page.main.html(`
			<div class="cd-card cd-toolbar">
				<span class="cd-count"></span>
				<div class="cd-progress-wrap" style="display:none">
					<div class="cd-progress-bar-track"><div class="cd-progress-bar-fill" style="width:0%"></div></div>
					<span class="cd-progress-label"></span>
				</div>
			</div>
			<div class="cd-card cd-table-wrap">
				<table class="cd-table">
					<thead>
						<tr>
							<th>Company</th>
							<th>Name</th>
							<th>Email</th>
							<th>Department</th>
							<th>Designation</th>
							<th>Reportee Names</th>
						</tr>
					</thead>
					<tbody class="cd-tbody"></tbody>
				</table>
			</div>
		`);

		this.tbody_el = this.page.main.find('.cd-tbody');
		this.count_el = this.page.main.find('.cd-count');
		this.progress_wrap_el = this.page.main.find('.cd-progress-wrap');
		this.progress_fill_el = this.page.main.find('.cd-progress-bar-fill');
		this.progress_label_el = this.page.main.find('.cd-progress-label');
	}

	render_prompt(message) {
		this.tbody_el.html(
			'<tr><td colspan="6" class="cd-empty-state">' + frappe.utils.escape_html(message) + '</td></tr>'
		);
	}

	check_existing_result() {
		var self = this;
		this.render_prompt('Loading directory…');
		frappe.call({
			method: 'support_iid.api.microsoft_graph.get_directory_full_load_result',
			freeze: false,
			callback: function (r) {
				var cached = r && r.message;
				if (cached && cached.items) {
					self.rows = cached.items;
					if (cached.error) {
						frappe.show_alert({ message: cached.error, indicator: 'orange' });
					}
					self.render_rows();
				} else {
					self.start_load();
				}
			},
			error: function () {
				self.start_load();
			}
		});
	}

	start_load() {
		var self = this;
		this.render_prompt('Starting directory load…');
		this.progress_wrap_el.show();
		this.progress_fill_el.css('width', '0%');
		this.progress_label_el.text('Starting…');
		this.count_el.text('');

		frappe.call({
			method: 'support_iid.api.microsoft_graph.start_directory_full_load',
			freeze: false,
			callback: function () {
			},
			error: function () {
				self.progress_wrap_el.hide();
				self.render_prompt('Could not start the directory load. Please try again.');
			}
		});
	}

	on_progress(data) {
		if (!data || data.title !== 'Loading Company Directory') return;
		var percent = Math.max(0, Math.min(100, data.percent || 0));
		this.progress_fill_el.css('width', percent + '%');
		this.progress_label_el.text(data.description || (Math.round(percent) + '%'));
	}

	on_load_done(data) {
		this.progress_wrap_el.hide();
		if (data && data.error) {
			frappe.show_alert({ message: data.error, indicator: 'orange' });
		}
		var self = this;
		frappe.call({
			method: 'support_iid.api.microsoft_graph.get_directory_full_load_result',
			freeze: false,
			callback: function (r) {
				var cached = r && r.message;
				self.rows = (cached && cached.items) || [];
				self.render_rows();
			},
			error: function () {
				self.render_prompt('Directory load finished, but the result could not be read. Please refresh.');
			}
		});
	}

	render_rows() {
		if (!this.rows.length) {
			this.render_prompt('No employees found in the directory.');
			return;
		}

		this.count_el.text(this.rows.length + (this.rows.length === 1 ? ' person' : ' people') + ' across the tenant');

		var html = this.rows.map(function (row) {
			var reportee_names = (row.reportee_names || []).join(', ');
			return `
				<tr>
					<td>${frappe.utils.escape_html(row.company || '-')}</td>
					<td><div class="cd-name">${frappe.utils.escape_html(row.name || '-')}</div></td>
					<td class="cd-email">${frappe.utils.escape_html(row.email || '-')}</td>
					<td>${frappe.utils.escape_html(row.department || '-')}</td>
					<td>${frappe.utils.escape_html(row.designation || '-')}</td>
					<td class="cd-reportees-cell">${reportee_names ? frappe.utils.escape_html(reportee_names) : '<span class="cd-sub">None</span>'}</td>
				</tr>
			`;
		}).join('');

		this.tbody_el.html(html);
	}

	export_all_companies() {
		frappe.confirm(
			'This exports every company in the directory to an Excel file. With a large tenant '
			+ 'this can take several minutes to run in the background — you\'ll get a notification '
			+ 'with a download link when it\'s ready. Continue?',
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

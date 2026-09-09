(function (global) {
	var VENDOR_BASE = '/assets/support_iid/js/vendor/';
	var loaded = {};

	function loadScript(src) {
		if (loaded[src]) return loaded[src];
		loaded[src] = new Promise(function (resolve, reject) {
			var el = document.createElement('script');
			el.src = src;
			el.onload = function () { resolve(); };
			el.onerror = function () { reject(new Error('Failed to load ' + src)); };
			document.head.appendChild(el);
		});
		return loaded[src];
	}

	function ensureDocxPreview() {
		return loadScript(VENDOR_BASE + 'jszip.min.js').then(function () {
			return loadScript(VENDOR_BASE + 'docx-preview.js');
		});
	}

	function ensureXlsx() {
		return loadScript(VENDOR_BASE + 'xlsx.full.min.js');
	}

	var WORD_EXT = ['docx'];
	var EXCEL_EXT = ['xlsx', 'xls', 'csv'];
	var UNSUPPORTED_OFFICE_EXT = ['doc', 'ppt', 'pptx', 'odt', 'ods', 'odp'];

	function isSupported(ext) {
		return WORD_EXT.indexOf(ext) > -1 || EXCEL_EXT.indexOf(ext) > -1;
	}

	function isUnsupportedOffice(ext) {
		return UNSUPPORTED_OFFICE_EXT.indexOf(ext) > -1;
	}

	function renderWorkbookTable(sheet, XLSX) {
		var html = XLSX.utils.sheet_to_html(sheet, { editable: false });
		return html;
	}

	function renderOfficePreview(container, fileUrl, ext) {
		var el = container.jquery ? container.get(0) : container;

		if (WORD_EXT.indexOf(ext) > -1) {
			return ensureDocxPreview().then(function () {
				return fetch(fileUrl).then(function (resp) {
					if (!resp.ok) throw new Error('Could not download the file for preview.');
					return resp.blob();
				});
			}).then(function (blob) {
				el.innerHTML = '';
				var wrapper = document.createElement('div');
				wrapper.style.background = '#fff';
				wrapper.style.padding = '16px';
				wrapper.style.borderRadius = '6px';
				wrapper.style.maxHeight = '72vh';
				wrapper.style.overflow = 'auto';
				el.appendChild(wrapper);
				return global.docx.renderAsync(blob, wrapper);
			});
		}

		if (EXCEL_EXT.indexOf(ext) > -1) {
			return ensureXlsx().then(function () {
				return fetch(fileUrl).then(function (resp) {
					if (!resp.ok) throw new Error('Could not download the file for preview.');
					return resp.arrayBuffer();
				});
			}).then(function (buf) {
				var XLSX = global.XLSX;
				var workbook = XLSX.read(buf, { type: 'array' });
				var sheetNames = workbook.SheetNames || [];
				if (!sheetNames.length) throw new Error('This spreadsheet has no sheets to preview.');

				el.innerHTML = '';
				var wrapper = document.createElement('div');
				wrapper.style.background = '#fff';
				wrapper.style.padding = '10px';
				wrapper.style.borderRadius = '6px';
				wrapper.style.maxHeight = '72vh';
				wrapper.style.overflow = 'auto';

				if (sheetNames.length > 1) {
					var tabs = document.createElement('div');
					tabs.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px';
					wrapper.appendChild(tabs);
				}

				var tableHolder = document.createElement('div');
				wrapper.appendChild(tableHolder);
				el.appendChild(wrapper);

				function showSheet(name) {
					tableHolder.innerHTML = renderWorkbookTable(workbook.Sheets[name], XLSX);
					var table = tableHolder.querySelector('table');
					if (table) {
						table.style.borderCollapse = 'collapse';
						table.style.fontSize = '12.5px';
						table.querySelectorAll('td, th').forEach(function (cell) {
							cell.style.border = '1px solid #e3e8ec';
							cell.style.padding = '4px 8px';
						});
					}
				}

				if (sheetNames.length > 1) {
					var tabsEl = wrapper.querySelector('div');
					sheetNames.forEach(function (name, i) {
						var btn = document.createElement('button');
						btn.type = 'button';
						btn.textContent = name;
						btn.className = 'btn btn-default btn-xs' + (i === 0 ? ' active' : '');
						btn.style.cssText = i === 0 ? 'background:#1a1a1a;color:#fff' : '';
						btn.addEventListener('click', function () {
							tabsEl.querySelectorAll('button').forEach(function (b) {
								b.style.cssText = ''; b.classList.remove('active');
							});
							btn.style.cssText = 'background:#1a1a1a;color:#fff';
							btn.classList.add('active');
							showSheet(name);
						});
						tabsEl.appendChild(btn);
					});
				}

				showSheet(sheetNames[0]);
			});
		}

		return Promise.reject(new Error('Preview isn\'t available for this file type.'));
	}

	global.SIIDOfficePreview = {
		isSupported: isSupported,
		isUnsupportedOffice: isUnsupportedOffice,
		render: renderOfficePreview,
	};
})(window);

# Copyright (c) 2026, Tech For Social Sector and contributors
# For license information, please see license.txt

import frappe

DASHBOARD_FIELDS = [
    "name", "case_status", "current_approval_level", "type_of_request", "request_date",
    "funds_requested", "amount_already_spent", "approved_amount", "refund_amount_if_any",
    "status_of_milaap_transfer", "district", "state", "beneficiary_name", "source_of_request",
    "approved_date"
]


def _attach_approved_by(rows):
    """
    For each case row, adds 'approved_by' — the approver_name from the most
    recent Case Approval Stage marked "Approve" for that case (i.e. the last
    person who approved it, which may be an intermediate level if the case
    hasn't finished its full approval chain yet).
    """
    if not rows:
        return rows

    names = [r["name"] for r in rows]
    stage_rows = frappe.get_all(
        "Case Approval Stage",
        filters={"parent": ["in", names], "case_approval_status": "Approve"},
        fields=["parent", "approver_name", "idx"],
        order_by="parent asc, idx desc"
    )

    approved_by_map = {}
    for s in stage_rows:
        # order_by ensures the first row seen per parent is the highest idx (latest stage)
        if s.parent not in approved_by_map:
            approved_by_map[s.parent] = s.approver_name or ""

    for r in rows:
        r["approved_by"] = approved_by_map.get(r["name"], "")
    return rows


def _is_dashboard_admin():
    user = frappe.session.user
    return user == "Administrator" or "System Manager" in frappe.get_roles(user)


def _approver_case_names():
    """
    Case names where the current user appears as an approver at any stage
    — used to scope non-admin users to only the cases relevant to them.
    """
    stage_rows = frappe.get_all(
        "Case Approval Stage",
        filters={"approver_email": frappe.session.user},
        fields=["parent"],
        limit_page_length=0,
    )
    return list({s.parent for s in stage_rows})


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None):
    """
    Returns one lightweight row per Case Register — just the fields the
    Support IID Dashboard needs to compute its Key Metrics and filters,
    entirely on the client.

    Scoped to the logged-in user: Administrator / System Manager see every
    case; anyone else sees only cases where they appear as an approver at
    some stage (matched on approver_email == frappe.session.user, same
    check already used to decide who can act on a case).

    Args:
        from_date: optional — only include cases with request_date >= this
        to_date: optional — only include cases with request_date <= this

    Note: "Total Patients Supported under NWH" is computed from
    amount_already_spent (cases where the family had already spent
    something out of pocket) per the client's mapping — there's no
    dedicated "APF contribution" field on Case Register yet.
    """
    if not frappe.has_permission("Case Register", ptype="read"):
        frappe.throw("You don't have permission to view the Case Register dashboard.", frappe.PermissionError)

    filters = {}
    if from_date and to_date:
        filters["request_date"] = ["between", [from_date, to_date]]
    elif from_date:
        filters["request_date"] = [">=", from_date]
    elif to_date:
        filters["request_date"] = ["<=", to_date]

    if not _is_dashboard_admin():
        allowed_names = _approver_case_names()
        if not allowed_names:
            return []
        filters["name"] = ["in", allowed_names]

    rows = frappe.get_all(
        "Case Register",
        fields=DASHBOARD_FIELDS,
        filters=filters,
        limit_page_length=0
    )
    return _attach_approved_by(rows)


def _export_rows_for_display(rows):
    """Turns raw case rows into the display rows/columns used by both export formats."""
    headers = ["Case ID", "Beneficiary", "Type", "Status", "Requested Amount", "Approved Amount", "Approved By", "Request Date"]
    data = []
    for c in rows:
        amount = c.get("approved_amount") or (c.get("funds_requested") if c.get("case_status") == "Approved" else 0) or 0
        data.append([
            c.get("name") or "",
            c.get("beneficiary_name") or "",
            c.get("type_of_request") or "",
            c.get("case_status") or "",
            frappe.utils.fmt_money(c.get("funds_requested") or 0, currency="INR"),
            frappe.utils.fmt_money(amount, currency="INR") if amount else "—",
            c.get("approved_by") or "—",
            frappe.utils.format_date(c.get("request_date")) if c.get("request_date") else ""
        ])
    return headers, data


def _build_styled_xlsx(headers, data):
    """
    Builds an .xlsx with real formatting — bordered cells, a light-blue
    header row, and subtle zebra striping — instead of a bare data dump.
    """
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Border, Side, Alignment

    wb = Workbook()
    ws = wb.active
    ws.title = "Support IID Dashboard"

    header_fill = PatternFill(start_color="EAF2FB", end_color="EAF2FB", fill_type="solid")
    header_font = Font(bold=True, color="1A1A1A")
    header_border = Border(*[Side(style="thin", color="B7C6D9")] * 4)

    stripe_fill = PatternFill(start_color="F7F9FB", end_color="F7F9FB", fill_type="solid")
    data_border = Border(*[Side(style="thin", color="D9DEE3")] * 4)

    for col, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = header_border
        cell.alignment = Alignment(vertical="center")
        # Set initial width based on header length; will be widened by data if needed
        ws.column_dimensions[cell.column_letter].width = max(len(h) + 4, 16)

    amount_cols = [headers.index(h) + 1 for h in ("Requested Amount", "Approved Amount") if h in headers]

    col_widths = {i: len(h) + 4 for i, h in enumerate(headers, start=1)}

    for row_idx, row in enumerate(data, start=2):
        for col_idx, value in enumerate(row, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.border = data_border
            if row_idx % 2 == 0:
                cell.fill = stripe_fill
            if col_idx in amount_cols:
                cell.alignment = Alignment(horizontal="right")
            col_widths[col_idx] = max(col_widths.get(col_idx, 12), len(str(value)) + 4)

    for col_idx, width in col_widths.items():
        col_letter = ws.cell(row=1, column=col_idx).column_letter
        ws.column_dimensions[col_letter].width = min(width, 42)  # cap at 42 chars

    ws.freeze_panes = "A2"

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


@frappe.whitelist(methods=["GET", "POST"])
def export_case_list(names, file_format):
    """
    Exports exactly the set of cases currently shown in a Dashboard
    drill-down popup — as a real server-generated file (Excel or PDF),
    not built client-side. Triggered by opening this URL directly (a
    GET request), not via frappe.call, since it streams a binary file
    back instead of JSON.

    Args:
        names: JSON-encoded list of Case Register names to export
        file_format: 'excel' or 'pdf'
    """
    try:
        if not frappe.has_permission("Case Register", ptype="read"):
            frappe.throw("You don't have permission to export the Case Register dashboard.", frappe.PermissionError)

        if file_format not in ("excel", "pdf"):
            frappe.throw("file_format must be 'excel' or 'pdf'.")

        if isinstance(names, str):
            names = frappe.parse_json(names)
        if not names:
            frappe.throw("No cases to export.")

        if not _is_dashboard_admin():
            allowed_names = set(_approver_case_names())
            names = [n for n in names if n in allowed_names]
            if not names:
                frappe.throw("No cases to export.")

        rows = frappe.get_all(
            "Case Register",
            fields=["name", "beneficiary_name", "type_of_request", "case_status", "approved_amount", "funds_requested", "request_date"],
            filters={"name": ["in", names]},
            order_by="request_date desc",
            limit_page_length=0
        )
        rows = _attach_approved_by(rows)
        headers, data = _export_rows_for_display(rows)

        if file_format == "excel":
            frappe.response["filename"] = "support-iid-dashboard.xlsx"
            frappe.response["filecontent"] = _build_styled_xlsx(headers, data)
            frappe.response["type"] = "binary"
            return

        # PDF — import explicitly rather than relying on frappe.utils.pdf
        # already being loaded as an attribute elsewhere in the process.
        from frappe.utils.pdf import get_pdf

        amount_cols = {h for h in ("Requested Amount", "Approved Amount") if h in headers}

        def _cell(value, is_amount, is_stripe):
            align = "right" if is_amount else "left"
            bg = "#F7F9FB" if is_stripe else "#FFFFFF"
            return (
                f"<td style='padding:8px 12px;border:1px solid #D9DEE3;text-align:{align};"
                f"background:{bg};font-size:11px'>{frappe.utils.escape_html(str(value))}</td>"
            )

        table_rows = "".join(
            "<tr>" + "".join(
                _cell(cell, headers[col_idx] in amount_cols, row_idx % 2 == 1)
                for col_idx, cell in enumerate(row)
            ) + "</tr>"
            for row_idx, row in enumerate(data)
        )
        header_row = "".join(
            "<th style='padding:9px 12px;border:1px solid #B7C6D9;background:#EAF2FB;"
            "color:#1A1A1A;text-align:left;font-size:11px;font-weight:bold'>"
            f"{frappe.utils.escape_html(h)}</th>"
            for h in headers
        )
        html = f"""
            <h3 style="margin-bottom:2px">Support IID Dashboard — Case Export</h3>
            <p style="color:#666;font-size:11px;margin-top:0">
                Generated {frappe.utils.now_datetime().strftime('%d-%m-%Y %H:%M')} &middot; {len(data)} case(s)
            </p>
            <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif">
                <thead><tr>{header_row}</tr></thead>
                <tbody>{table_rows}</tbody>
            </table>
        """
        frappe.response["filename"] = "support-iid-dashboard.pdf"
        frappe.response["filecontent"] = get_pdf(html)
        frappe.response["type"] = "binary"

    except frappe.PermissionError:
        raise
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Support IID Dashboard export failed")
        frappe.throw(
            "Export failed. This is usually caused by a missing dependency on the server "
            "(openpyxl for Excel, wkhtmltopdf for PDF) — check the Error Log in Frappe for details."
        )

import base64
import hashlib
import io
import json
import os
import re
import secrets

import frappe
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from frappe.model.document import Document
from frappe.rate_limiter import rate_limit
from frappe.utils import fmt_money, format_date, get_url, getdate, today
from frappe.utils.password import decrypt as frappe_decrypt
from frappe.utils.password import encrypt as frappe_encrypt

ACTION_LABEL = {
	"Approve": "Approved",
	"Decline": "Declined",
	"Send Back": "Sent Back for Revision",
	"Reviewer Approve": "Verified",
	"Reviewer Send Back": "Sent Back for Revision (Final Verification)",
}

CASE_STATUS_DRAFT = "Draft"
CASE_STATUS_PENDING = "Pending Approval"
CASE_STATUS_APPROVED = "Approved"
CASE_STATUS_REJECTED = "Rejected"
CASE_STATUS_SENT_BACK = "Sent Back"
CASE_STATUS_CLOSED = "Closed"

CASE_APPROVAL_LEVEL_REVIEWER = "Final Verification"

CASE_STATUS_FINAL_VERIFICATION = "Final Verification"
CASE_STATUS_WITHDRAWN = "Withdrawn by the Requester"

CASE_STATUS_DISPLAY_LABELS = {
	CASE_STATUS_SENT_BACK: "Pending with Requester",
	CASE_STATUS_REJECTED: "Declined",
	CASE_STATUS_FINAL_VERIFICATION: "Pending with Reviewer",
}


def case_status_display_label(status):
	return CASE_STATUS_DISPLAY_LABELS.get(status, status)


_RESPONSE_AES_KEY = base64.b64decode("sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=")


def encrypt_response(data):
	aesgcm = AESGCM(_RESPONSE_AES_KEY)
	nonce = os.urandom(12)
	ciphertext = aesgcm.encrypt(nonce, json.dumps(data, default=str).encode("utf-8"), None)
	return {
		"encrypted": True,
		"iv": base64.b64encode(nonce).decode("utf-8"),
		"data": base64.b64encode(ciphertext).decode("utf-8"),
	}


def make_approval_token(case_name, level_idx, approver_email):
	payload = json.dumps(
		{
			"purpose": "approval",
			"case_name": case_name,
			"level_idx": level_idx,
			"approver_email": (approver_email or "").strip().lower(),
		}
	)
	encrypted = frappe_encrypt(payload)
	return base64.urlsafe_b64encode(encrypted.encode()).decode()


def make_edit_token(case_name, requestor_email, stage_idx):
	payload = json.dumps(
		{
			"purpose": "edit",
			"case_name": case_name,
			"requestor_email": (requestor_email or "").strip().lower(),
			"stage_idx": stage_idx,
		}
	)
	encrypted = frappe_encrypt(payload)
	return base64.urlsafe_b64encode(encrypted.encode()).decode()


def make_withdraw_token(case_name, requestor_email):
	payload = json.dumps(
		{
			"purpose": "withdraw",
			"case_name": case_name,
			"requestor_email": (requestor_email or "").strip().lower(),
		}
	)
	encrypted = frappe_encrypt(payload)
	return base64.urlsafe_b64encode(encrypted.encode()).decode()


def _read_token(token):
	"""Returns the decoded payload dict, or None if the token is missing/invalid."""
	if not token:
		return None
	try:
		encrypted = base64.urlsafe_b64decode(token.encode()).decode()
		payload = json.loads(frappe_decrypt(encrypted))
	except Exception:
		return None
	return payload


def read_approval_token(token):
	payload = _read_token(token)
	if not payload or payload.get("purpose") != "approval":
		return None
	return payload


def read_edit_token(token):
	payload = _read_token(token)
	if not payload or payload.get("purpose") != "edit":
		return None
	return payload


def read_withdraw_token(token):
	payload = _read_token(token)
	if not payload or payload.get("purpose") != "withdraw":
		return None
	return payload


def make_registry_link_token(case_name):
	payload = json.dumps({"purpose": "registry_link", "case_name": case_name})
	encrypted = frappe_encrypt(payload)
	return base64.urlsafe_b64encode(encrypted.encode()).decode()


def read_registry_link_token(token):
	payload = _read_token(token)
	if not payload or payload.get("purpose") != "registry_link":
		return None
	return payload


_OTP_TTL_SECONDS = 10 * 60


def _otp_cache_key(token):
	return "support_iid_approval_otp:" + hashlib.sha256(token.encode()).hexdigest()


@frappe.whitelist(allow_guest=True)
def send_approval_otp(token):
	payload = read_approval_token(token)
	if not payload:
		frappe.throw("This approval link is invalid or has expired.")

	approver_email = payload.get("approver_email")
	if not approver_email:
		frappe.throw("This approval link is invalid or has expired.")

	otp = f"{secrets.randbelow(1_000_000):06d}"
	frappe.cache().set_value(_otp_cache_key(token), otp, expires_in_sec=_OTP_TTL_SECONDS)

	stages = frappe.get_doc("Case Register", payload.get("case_name")).get("case_approval_stage") or []
	level_idx = payload.get("level_idx")
	approver_name = "Approver"
	if level_idx is not None and 0 <= level_idx < len(stages):
		approver_name = (stages[level_idx].get("approver_name") or "").strip() or "Approver"

	try:
		_send_plain_email(
			recipients=[approver_email],
			subject="Support IID Case Approval - Your Verification Code",
			lines=[
				f"Dear {approver_name},",
				"",
				"This is an official communication from the Support IID program "
				"at Azim Premji Foundation. Please use the One-Time Password "
				"(OTP) below to verify your identity and proceed with the case "
				"approval action.",
				"",
				f"{{{{code:{otp}}}}}",
				"",
				"This OTP is valid for 10 minutes and can be used only once. "
				"For your security, please do not share it with anyone, "
				"including anyone claiming to represent Azim Premji "
				"Foundation.",
				"",
				"If you did not request this code, no action is required — "
				"you may safely disregard this email.",
			],
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Approval OTP email failed")
		frappe.throw("Could not send the verification code. Please try again shortly.")

	return {"sent": True}


@frappe.whitelist(allow_guest=True)
def send_edit_otp(token):
	payload = read_edit_token(token)
	if not payload:
		frappe.throw("This edit link is invalid or has expired.")

	requestor_email = payload.get("requestor_email")
	if not requestor_email:
		frappe.throw("This edit link is invalid or has expired.")

	otp = f"{secrets.randbelow(1_000_000):06d}"
	frappe.cache().set_value(_otp_cache_key(token), otp, expires_in_sec=_OTP_TTL_SECONDS)

	requestor_name = (
		frappe.db.get_value("Case Register", payload.get("case_name"), "requestor_name") or "Team"
	)

	try:
		_send_plain_email(
			recipients=[requestor_email],
			subject="Support IID Case Edit - Your Verification Code",
			lines=[
				f"Dear {requestor_name},",
				"",
				"This is an official communication from the Support IID program "
				"at Azim Premji Foundation. Please use the One-Time Password "
				"(OTP) below to verify your identity and proceed with editing "
				"and resubmitting your case.",
				"",
				f"{{{{code:{otp}}}}}",
				"",
				"This OTP is valid for 10 minutes and can be used only once. "
				"For your security, please do not share it with anyone, "
				"including anyone claiming to represent Azim Premji "
				"Foundation.",
				"",
				"If you did not request this code, no action is required — "
				"you may safely disregard this email.",
			],
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Edit OTP email failed")
		frappe.throw("Could not send the verification code. Please try again shortly.")

	return {"sent": True}


@frappe.whitelist(allow_guest=True)
def send_withdraw_otp(token):
	payload = read_withdraw_token(token)
	if not payload:
		frappe.throw("This withdraw link is invalid or has expired.")

	requestor_email = payload.get("requestor_email")
	if not requestor_email:
		frappe.throw("This withdraw link is invalid or has expired.")

	otp = f"{secrets.randbelow(1_000_000):06d}"
	frappe.cache().set_value(_otp_cache_key(token), otp, expires_in_sec=_OTP_TTL_SECONDS)

	requestor_name = (
		frappe.db.get_value("Case Register", payload.get("case_name"), "requestor_name") or "Team"
	)

	try:
		_send_plain_email(
			recipients=[requestor_email],
			subject="Support IID Case Withdrawal - Your Verification Code",
			lines=[
				f"Dear {requestor_name},",
				"",
				"This is an official communication from the Support IID program "
				"at Azim Premji Foundation. Please use the One-Time Password "
				"(OTP) below to verify your identity and proceed with "
				"withdrawing your case.",
				"",
				f"{{{{code:{otp}}}}}",
				"",
				"This OTP is valid for 10 minutes and can be used only once. "
				"For your security, please do not share it with anyone, "
				"including anyone claiming to represent Azim Premji "
				"Foundation.",
				"",
				"If you did not request this code, no action is required — "
				"you may safely disregard this email.",
			],
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Withdraw OTP email failed")
		frappe.throw("Could not send the verification code. Please try again shortly.")

	return {"sent": True}


_OTP_MAX_ATTEMPTS = 5


def _otp_attempts_cache_key(token):
	return "support_iid_otp_attempts:" + hashlib.sha256(token.encode()).hexdigest()


def _verify_and_consume_otp(token, otp):
	if not token or not otp:
		return False

	attempts_key = _otp_attempts_cache_key(token)
	attempts = frappe.cache().get_value(attempts_key) or 0
	if attempts >= _OTP_MAX_ATTEMPTS:
		frappe.cache().delete_value(_otp_cache_key(token))
		return False

	key = _otp_cache_key(token)
	stored = frappe.cache().get_value(key)
	if stored and secrets.compare_digest(str(stored), str(otp).strip()):
		frappe.cache().delete_value(key)
		frappe.cache().delete_value(attempts_key)
		return True

	frappe.cache().set_value(attempts_key, attempts + 1, expires_in_sec=_OTP_TTL_SECONDS)
	return False


_VERIFY_TICKET_TTL_SECONDS = 60 * 60


def _verify_ticket_cache_key(ticket):
	return "support_iid_verify_ticket:" + hashlib.sha256(ticket.encode()).hexdigest()


def _issue_verify_ticket(token):
	ticket = secrets.token_urlsafe(24)
	frappe.cache().set_value(
		_verify_ticket_cache_key(ticket), token, expires_in_sec=_VERIFY_TICKET_TTL_SECONDS
	)
	return ticket


def _consume_verify_ticket(ticket, expected_token):
	"""Returns True and deletes the ticket if it matches the expected token; False otherwise."""
	if not ticket:
		return False
	key = _verify_ticket_cache_key(ticket)
	stored = frappe.cache().get_value(key)
	if stored and str(stored) == str(expected_token):
		frappe.cache().delete_value(key)
		return True
	return False


def _otp_or_ticket_verified(token, otp, verify_ticket):
	if verify_ticket:
		return _consume_verify_ticket(verify_ticket, token)
	return _verify_and_consume_otp(token, otp)


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=10 * 60)
def verify_approval_otp(token, otp):
	"""Explicit "Verify" step for the approval web form's OTP."""
	if not _verify_and_consume_otp(token, otp):
		frappe.throw("Invalid or expired verification code. Please request a new one and try again.")
	return {"verify_ticket": _issue_verify_ticket(token)}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=10 * 60)
def verify_edit_otp(token, otp):
	"""Explicit "Verify" step for the case-edit web form's OTP."""
	if not _verify_and_consume_otp(token, otp):
		frappe.throw("Invalid or expired verification code. Please request a new one and try again.")
	return {"verify_ticket": _issue_verify_ticket(token)}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=10 * 60)
def verify_withdraw_otp(token, otp):
	"""Explicit "Verify" step for the case-withdraw web form's OTP."""
	if not _verify_and_consume_otp(token, otp):
		frappe.throw("Invalid or expired verification code. Please request a new one and try again.")
	return {"verify_ticket": _issue_verify_ticket(token)}


def _safe_commit(context):
	try:
		frappe.db.commit()
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Post-save commit raised — {context}")


_APF_LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "apf_logo.jpg")
_APF_LOGO_FILENAME = "azim-premji-foundation-logo.jpg"


def _logo_inline_image():
	if not os.path.exists(_APF_LOGO_PATH):
		return None
	with open(_APF_LOGO_PATH, "rb") as f:
		return {"filename": _APF_LOGO_FILENAME, "filecontent": f.read()}


def _lines_to_html(lines):
	token_re = re.compile(
		r"\[\[([^\]]+)\]\]\((https?://[^\s)]+)\)"  # 1=button label, 2=url
		r"|\[([^\]]+)\]\((https?://[^\s)]+)\)"  # 3=label, 4=url
		r"|\*\*([^*]+)\*\*"  # 5=bold text
		r"|==([^=]+)=="  # 6=highlighted text
		r"|(https?://\S+)"  # 7=bare url
	)

	def render(text):
		out = []
		pos = 0
		for m in token_re.finditer(text):
			out.append(frappe.utils.escape_html(text[pos : m.start()]))
			if m.group(1) is not None:
				label = frappe.utils.escape_html(m.group(1))
				url = frappe.utils.escape_html(m.group(2))
				out.append(
					f'<a href="{url}" style="text-decoration:none;padding:4px 20px;font-size:13px;'
					"border:1px solid transparent;border-radius:6px;color:#ffffff;background-color:#171717;"
					f'display:inline-block;line-height:20px;">{label}</a>'
				)
			elif m.group(3) is not None:
				label = frappe.utils.escape_html(m.group(3))
				url = frappe.utils.escape_html(m.group(4))
				out.append(f'<a href="{url}"><b>{label}</b></a>')
			elif m.group(5) is not None:
				out.append(f"<b>{frappe.utils.escape_html(m.group(5))}</b>")
			elif m.group(6) is not None:
				out.append(
					'<span style="background:#fff3cd;color:#7a5b00;padding:1px 6px;'
					'border-radius:4px;font-weight:600;">'
					+ frappe.utils.escape_html(m.group(6))
					+ "</span>"
				)
			else:
				url = frappe.utils.escape_html(m.group(7))
				out.append(f'<a href="{url}">{url}</a>')
			pos = m.end()
		out.append(frappe.utils.escape_html(text[pos:]))
		return "".join(out)

	code_line_re = re.compile(r"^\{\{code:([^}]+)\}\}$")

	parts = []
	for line in lines:
		if line == "":
			parts.append('<div style="height:10px"></div>')
			continue
		code_match = code_line_re.match(line)
		if code_match:
			code = frappe.utils.escape_html(code_match.group(1))
			parts.append(
				'<div style="font-size:26px;font-weight:bold;letter-spacing:4px;'
				'color:#1a1a1a">' + code + "</div>"
			)
			continue
		parts.append(f"<div>{render(line)}</div>")
	return "".join(parts)


def _email_signature_html():
	return (
		'<div style="margin-top:8px;padding-top:12px;border-top:1px solid #d9dce0">'
		f'<img embed="{_APF_LOGO_FILENAME}" alt="Azim Premji Foundation" height="40"><br>'
		'<span style="font-weight:bold">Support IID Team</span><br>'
		"Azim Premji Foundation<br>"
		'<span style="color:#5a5a5a">'
		"134 Doddakannelli, Next to Wipro Corporate Office, Sarjapur Road, Bengaluru 560 035<br>"
		"Phone: 91 80 66144900/01/02 | www.azimpremjifoundation.org"
		"</span>"
		"</div>"
	)


def _build_email_html(lines):
	"""Combines body lines + signature into the final HTML message body."""
	return _lines_to_html(lines) + '<div style="height:16px"></div>' + _email_signature_html()


_EMAIL_SHAPE_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _looks_like_email(value):
	return bool(_EMAIL_SHAPE_RE.match((value or "").strip()))


def _filter_valid_recipients(recipients, subject):
	valid, dropped = [], []
	for r in recipients or []:
		(valid if _looks_like_email(r) else dropped).append(r)
	if dropped:
		frappe.log_error(
			f"Dropped recipient(s) that are not valid email addresses — sent to the "
			f"rest instead.\nSubject: {subject}\nDropped: {dropped}\nSent to: {valid}",
			"Support IID email — invalid recipient(s) skipped",
		)
	return valid


def _resolve_attachment_fids(attachments, subject):
	resolved = []
	for att in attachments or []:
		fid = att.get("fid")
		if not fid:
			continue
		try:
			frappe.get_doc("File", fid).get_content()
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Attachment file missing/unreadable (fid={fid}), skipped for this email "
				f"(Subject: {subject})",
			)
			continue
		resolved.append(att)
	return resolved


def _send_plain_email(recipients, subject, lines, attachments=None):
	recipients = _filter_valid_recipients(recipients, subject)
	if not recipients:
		frappe.log_error(
			f"No valid recipients remained after filtering — email not sent.\nSubject: {subject}",
			"Support IID email skipped — no valid recipients",
		)
		return

	logo = _logo_inline_image()
	frappe.sendmail(
		recipients=recipients,
		subject=subject,
		message=_build_email_html(lines),
		attachments=_resolve_attachment_fids(attachments, subject),
		inline_images=[logo] if logo else None,
		now=True,
	)


_FOOT1 = (
	"Azim Premji Foundation for Development, 134 Doddakannelli, "
	"Next to Wipro Corporate Office, Sarjapur Road, Bengaluru 560\u00a0035"
)
_FOOT2 = (
	"Phone: 91\u00a080\u00a066144900/01/02   "
	"Website: www.azimpremjifoundation.org   "
	"CIN \u2013 U93000KA2009NPL051792"
)

_BODY = "Times-Roman"
_BOLD = "Times-Bold"
_ITAL = "Times-Italic"
_BDIT = "Times-BoldItalic"


def _build_case_pdf_bytes(doc_data: dict) -> bytes:
	try:
		from reportlab.lib.colors import HexColor
		from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
		from reportlab.lib.pagesizes import A4
		from reportlab.lib.styles import ParagraphStyle
		from reportlab.lib.units import mm
		from reportlab.platypus import (
			HRFlowable,
			Paragraph,
			SimpleDocTemplate,
			Spacer,
			Table,
			TableStyle,
		)
	except ImportError:
		raise ImportError("reportlab is not installed. Run: bench pip install reportlab")

	# ── Colours ──────────────────────────────────────────────────────────────
	PAGE_W, _PAGE_H = A4
	ML = 20 * mm
	MR = 20 * mm
	MT = 22 * mm
	MB = 22 * mm
	CW = PAGE_W - ML - MR

	RED = HexColor("#C0392B")
	BLU = HexColor("#1A5276")
	DARK = HexColor("#1A1A1A")
	LGRAY = HexColor("#888888")
	TBDR = HexColor("#CCCCCC")
	THDR = HexColor("#F2F2F2")
	TSTRP = HexColor("#FAFAFA")

	# ── Logo ──────────────────────────────────────────────────────────────────
	_LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "apf_logo.jpg")
	_LOGO_W, _LOGO_H = 34 * mm, 34 * mm * (107 / 200)

	def draw_logo(cv, x, y):
		"""Real APF logo (extracted from the reference letterhead), top-right."""
		if os.path.exists(_LOGO_PATH):
			cv.drawImage(
				_LOGO_PATH,
				x,
				y - _LOGO_H,
				width=_LOGO_W,
				height=_LOGO_H,
				preserveAspectRatio=True,
				mask="auto",
			)
		else:
			cv.setFillColor(BLU)
			cv.setFont(_BOLD, 8.5)
			cv.drawString(x, y - 8, "Azim Premji")
			cv.setFont(_BODY, 8)
			cv.drawString(x, y - 18, "Foundation")

	def on_page(cv, doc):
		cv.saveState()
		pw, ph = A4
		draw_logo(cv, pw - MR - _LOGO_W, ph - MT + 12)
		fy = MB - 4 * mm
		cv.setStrokeColor(RED)
		cv.setLineWidth(0.8)
		cv.line(ML, fy + 10, pw - MR, fy + 10)
		cv.setFillColor(LGRAY)
		cv.setFont(_BODY, 7.5)
		cv.drawCentredString(pw / 2, fy + 3, _FOOT1)
		cv.drawCentredString(pw / 2, fy - 4, _FOOT2)
		cv.restoreState()

	# ── Paragraph styles ──────────────────────────────────────────────────────
	def ps(name, **kw):
		base = dict(fontName=_BODY, fontSize=10, leading=14, textColor=DARK, alignment=TA_LEFT)
		base.update(kw)
		return ParagraphStyle(name, **base)

	st = {
		"normal": ps("normal", alignment=TA_JUSTIFY),
		"sender": ps("sender", fontName=_BOLD),
		"sender_i": ps("si", fontName=_BDIT),
		"date": ps("date", fontName=_BOLD, spaceBefore=18, spaceAfter=10),
		"addr": ps("addr", fontName=_BOLD),
		"sal": ps("sal", fontName=_BOLD, spaceBefore=8, spaceAfter=4),
		"sec": ps("sec", fontName=_BOLD, fontSize=11, leading=15, spaceBefore=12, spaceAfter=0),
		"th": ps("th", fontName=_BOLD, fontSize=9.5, leading=12),
		"td": ps("td", fontSize=9.5, leading=12),
		"closing": ps("closing", fontName=_BOLD, spaceBefore=16),
		"cn": ps("cn", fontName=_BOLD, spaceBefore=38),
	}

	# ── Helpers ───────────────────────────────────────────────────────────────
	def sec(letter, title):
		return [
			Paragraph(f"{letter}.&nbsp;&nbsp;{title}", st["sec"]),
			HRFlowable(width="100%", thickness=0.7, color=RED, spaceAfter=6),
		]

	C1 = 68 * mm

	def dtable(rows):
		tbl = []
		for label, value in rows:
			tbl.append(
				[
					Paragraph(f"<b>{label}</b>", st["td"]),
					Paragraph(str(value) if value else "<i>Not provided</i>", st["td"]),
				]
			)
		style = TableStyle(
			[
				("FONTNAME", (0, 0), (-1, -1), _BODY),
				("FONTSIZE", (0, 0), (-1, -1), 9.5),
				("TEXTCOLOR", (0, 0), (-1, -1), DARK),
				("VALIGN", (0, 0), (-1, -1), "TOP"),
				("TOPPADDING", (0, 0), (-1, -1), 4),
				("BOTTOMPADDING", (0, 0), (-1, -1), 4),
				("LEFTPADDING", (0, 0), (-1, -1), 0),
				("RIGHTPADDING", (0, 0), (-1, -1), 6),
			]
		)
		return Table(tbl, colWidths=[C1, CW - C1], style=style, hAlign="LEFT")

	def ftable(members):
		if not members:
			return Paragraph("<i>No family members added.</i>", st["normal"])
		cws = [40 * mm, 32 * mm, 14 * mm, 38 * mm, 30 * mm, CW - 154 * mm]
		hdrs = ["Name", "Relationship", "Age", "Occupation", "Monthly Income", "Qualification"]
		tbl = [[Paragraph(h, st["th"]) for h in hdrs]]
		for m in members:
			inc = m.get("monthly_income") or 0
			tbl.append(
				[
					Paragraph(str(m.get("member_name") or ""), st["td"]),
					Paragraph(str(m.get("relationship") or ""), st["td"]),
					Paragraph(str(m.get("age") or ""), st["td"]),
					Paragraph(str(m.get("occupation") or ""), st["td"]),
					Paragraph(f"Rs {int(inc):,}" if inc else "\u2014", st["td"]),
					Paragraph(str(m.get("qualification") or ""), st["td"]),
				]
			)
		n = len(tbl)
		zebra = [("BACKGROUND", (0, i), (-1, i), TSTRP) for i in range(2, n, 2)]
		style = TableStyle(
			[
				("BACKGROUND", (0, 0), (-1, 0), THDR),
				("FONTNAME", (0, 0), (-1, 0), _BOLD),
				("FONTSIZE", (0, 0), (-1, -1), 9),
				("TEXTCOLOR", (0, 0), (-1, -1), DARK),
				("GRID", (0, 0), (-1, -1), 0.5, TBDR),
				("VALIGN", (0, 0), (-1, -1), "TOP"),
				("TOPPADDING", (0, 0), (-1, -1), 4),
				("BOTTOMPADDING", (0, 0), (-1, -1), 4),
				("LEFTPADDING", (0, 0), (-1, -1), 5),
				("RIGHTPADDING", (0, 0), (-1, -1), 5),
				*zebra,
			]
		)
		return Table(tbl, colWidths=cws, style=style, repeatRows=1, hAlign="LEFT")

	def fmt_rs(val):
		try:
			return "INR {:,.0f}".format(float(val))
		except TypeError, ValueError:
			return "\u2014"

	def para_field(label, value):
		return [
			Paragraph(label, st["th"]),
			Spacer(1, 2),
			Paragraph(str(value) if value else "<i>Not provided</i>", st["normal"]),
			Spacer(1, 8),
		]

	# ── Build story ───────────────────────────────────────────────────────────
	buf = io.BytesIO()
	pdf = SimpleDocTemplate(
		buf,
		pagesize=A4,
		leftMargin=ML,
		rightMargin=MR,
		topMargin=MT + 20 * mm,
		bottomMargin=MB + 10 * mm,
		title=f"Case Summary \u2014 {doc_data.get('name', '')}",
		author="Support IID Team \u00b7 Azim Premji Foundation",
	)

	def fgt(f):
		return str(doc_data.get(f) or "") if doc_data.get(f) is not None else ""

	is_medical = "medical" in fgt("type_of_request").lower()

	story = []

	# Sender block (like "Prajna Prahlad / Chief People Officer" in the offer letter)
	story += [
		Paragraph("Support IID Team", st["sender"]),
		Paragraph("<i>Case Management System</i>", st["sender_i"]),
		Spacer(1, 2),
		Paragraph(fgt("request_date") or "\u2014", st["date"]),
	]

	# Addressee block
	for line in filter(
		None,
		[
			fgt("beneficiary_name"),
			fgt("address_line_1"),
			fgt("district"),
			fgt("state"),
			str(doc_data.get("pincode") or ""),
		],
	):
		story.append(Paragraph(line, st["addr"]))

	story += [
		Spacer(1, 6),
		Paragraph("Beneficiary Details", st["sal"]),
		Spacer(1, 4),
		Paragraph(
			"This document is the official case summary for the support request registered "
			f"on behalf of {fgt('beneficiary_name') or 'the beneficiary'} with the Support IID Case Management "
			"System, Azim Premji Foundation. All details below are submitted for review and provisional approval.",
			st["normal"],
		),
		Paragraph("The terms of the support request are as under:", st["normal"]),
		Spacer(1, 8),
	]

	# A — Case Information
	case_status_display = case_status_display_label(fgt("case_status"))
	if fgt("case_status") == CASE_STATUS_PENDING and fgt("current_approval_level"):
		case_status_display = f"{case_status_display} ({fgt('current_approval_level')})"

	story += sec("A", "CASE INFORMATION")
	story.append(
		dtable(
			[
				("Case ID", fgt("name")),
				("Case Status", case_status_display),
				("Type of Request", fgt("type_of_request")),
				("Request Date", fgt("request_date")),
				("Source of Request", fgt("source_of_request")),
				("Department", fgt("department")),
				("Work Location", fgt("work_location")),
			]
		)
	)
	story.append(Spacer(1, 10))

	# B — Requestor
	story += sec("B", "REQUESTOR INFORMATION")
	story.append(
		dtable(
			[
				("Requestor Name", fgt("requestor_name")),
				("Requestor Email", fgt("requestor_email")),
				("Requestor Mobile", fgt("requestor_mobile_number")),
				("Department", fgt("department")),
				("Work Location", fgt("work_location")),
			]
		)
	)
	story.append(Spacer(1, 10))

	# C — Beneficiary
	story += sec("C", "BENEFICIARY INFORMATION")
	story.append(
		dtable(
			[
				("Beneficiary Name", fgt("beneficiary_name")),
				("Date of Birth", fgt("date_of_birth")),
				("Age", str(doc_data.get("age") or "")),
				("Gender", fgt("gender")),
				("Mobile Number", fgt("mobile_number")),
				("Email", fgt("email")),
				("Qualification", fgt("qualification")),
				("Employment Status", fgt("employment_status")),
				("Marital Status", fgt("marital_status")),
				("Primary Contact Person", fgt("primary_contact_person")),
				("Primary Contact Mobile", fgt("primary_contact_mobile")),
				("Address", fgt("address_line_1")),
				("District", fgt("district")),
				("State", fgt("state")),
				("Pincode", str(doc_data.get("pincode") or "")),
			]
		)
	)
	story.append(Spacer(1, 8))
	story += para_field("Note about Individual", fgt("note_about_the_individual"))

	# D — Family Members
	story += sec("D", "FAMILY MEMBERS")
	story.append(ftable(doc_data.get("family_members") or []))
	story.append(Spacer(1, 10))

	# E — Request Details
	story += sec("E", "REQUEST DETAILS")
	req_rows = [
		("Hospital / Institution Name", fgt("hospital_institution_name")),
		("Hospital / Institution Location", fgt("hospital_institution_location")),
		("Funds Requested", fmt_rs(doc_data.get("funds_requested"))),
		("Amount Already Spent", fmt_rs(doc_data.get("amount_already_spent"))),
	]
	if is_medical:
		req_rows.insert(2, ("Treatment", fgt("treatment")))
	story.append(dtable(req_rows))
	story.append(Spacer(1, 8))
	story += para_field("Ailment / Course Details", fgt("ailment__course_details"))

	# F — Financial & Insurance
	story += sec("F", "FINANCIAL INFORMATION & INSURANCE")
	story.append(
		dtable(
			[
				("Annual Family Income", fmt_rs(doc_data.get("annual_family_income"))),
				("Residence Type", fgt("residence_type")),
				("Residence Details", fgt("residence_details")),
				("Existing Debt", fgt("existing_debt")),
				("Insurance Type", fgt("insurance_type")),
				("Insurance Coverage", fgt("insurance_coverage_details")),
			]
		)
	)
	story.append(Spacer(1, 10))

	# G — Verification & Assessment
	story += sec("G", "VERIFICATION & ASSESSMENT")
	story.append(
		dtable(
			[
				("Physical Verification", fgt("physical_verification")),
				("Milaap Campaign Link", fgt("milaap_campaign_link")),
				("Milaap Recommendation", fgt("milaap_recommendation")),
			]
		)
	)
	story.append(Spacer(1, 8))
	story += para_field("Verification Notes", fgt("physical_verification_notes"))
	story += para_field("Genuineness Assessment", fgt("genuineness_assessment"))
	story += para_field("Vulnerability Assessment", fgt("vulnerability_assessment"))
	story.append(Spacer(1, 12))

	# Closing
	story += [
		Paragraph("Yours sincerely,", st["closing"]),
		Spacer(1, 36),
		Paragraph("Support IID Team", st["cn"]),
		Paragraph("Azim Premji Foundation", st["normal"]),
	]

	pdf.build(story, onFirstPage=on_page, onLaterPages=on_page)
	return buf.getvalue()


def ensure_requester_user(email, full_name=None):
	email = (email or "").strip().lower()
	if not email or not _EMAIL_SHAPE_RE.match(email):
		return

	if not frappe.db.exists("User", email):
		try:
			name_parts = (full_name or email.split("@")[0]).strip().split(None, 1)
			first_name = name_parts[0] if name_parts else email
			last_name = name_parts[1] if len(name_parts) > 1 else ""
			frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": first_name,
					"last_name": last_name,
					"send_welcome_email": 0,
					"user_type": "Website User",
				}
			).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Could not create Requester User for {email}")
			return

	try:
		user = frappe.get_doc("User", email)
		if "Support IID Requester" not in [r.role for r in user.get("roles") or []]:
			user.append("roles", {"role": "Support IID Requester"})
			user.flags.ignore_permissions = True
			user.save(ignore_permissions=True)
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Could not assign Requester role to {email}")


def _requester_only_scope_email(user=None):
	user = user or frappe.session.user
	if user in ("Administrator", "Guest"):
		return None

	roles = set(frappe.get_roles(user))
	broad_access_roles = {"System Manager", "Support IID Reviewer", "Support IID Approver"}
	if roles & broad_access_roles:
		return None
	if "Support IID Requester" not in roles:
		return None

	return user


def _approver_only_scope_email(user=None):
	user = user or frappe.session.user
	if user in ("Administrator", "Guest"):
		return None

	roles = set(frappe.get_roles(user))
	if "System Manager" in roles or "Support IID Reviewer" in roles:
		return None
	if "Support IID Approver" not in roles:
		return None

	return user


_APPROVER_VISIBLE_CASE_CONDITION = """
exists (
	select 1 from `tabCase Approval Stage` cas_mine
	where cas_mine.parent = `tabCase Register`.name
	and cas_mine.approver_email = {approver_email}
	and (
		cas_mine.case_approval_status is not null
		and cas_mine.case_approval_status not in ('', 'Awaiting For Approval')
	)
)
or exists (
	select 1 from `tabCase Approval Stage` cas_mine
	where cas_mine.parent = `tabCase Register`.name
	and cas_mine.approver_email = {approver_email}
	and (cas_mine.case_approval_status is null or cas_mine.case_approval_status in ('', 'Awaiting For Approval'))
	and not exists (
		select 1 from `tabCase Approval Stage` cas_earlier
		where cas_earlier.parent = cas_mine.parent
		and cas_earlier.idx < cas_mine.idx
		and (
			cas_earlier.case_approval_status is null
			or cas_earlier.case_approval_status in ('', 'Awaiting For Approval')
		)
	)
)
"""

_CASE_HAS_CONFIGURED_APPROVER_CONDITION = """
exists (
	select 1 from `tabCase Approval Stage` cas_any
	where cas_any.parent = `tabCase Register`.name
	and cas_any.approver_email is not null
	and cas_any.approver_email != ''
)
"""


def _case_has_no_configured_approver(doc):
	stages = doc.get("case_approval_stage") or []
	return not any((stage.get("approver_email") or "").strip() for stage in stages)


def _hide_unconfigured_cases_from(user):
	user = user or frappe.session.user
	if user in ("Administrator", "Guest"):
		return False
	roles = set(frappe.get_roles(user))
	if "System Manager" in roles:
		return False
	return bool(roles & {"Support IID Reviewer", "Support IID Approver"})


def get_permission_query_conditions(user=None, doctype=None):
	requester_scope_email = _requester_only_scope_email(user)
	if requester_scope_email:
		return "`tabCase Register`.`requestor_email` = {0}".format(frappe.db.escape(requester_scope_email))

	approver_scope_email = _approver_only_scope_email(user)
	if approver_scope_email:
		return _APPROVER_VISIBLE_CASE_CONDITION.format(approver_email=frappe.db.escape(approver_scope_email))

	if _hide_unconfigured_cases_from(user):
		return _CASE_HAS_CONFIGURED_APPROVER_CONDITION

	return None


def has_permission(doc, ptype=None, user=None, debug=False):
	requester_scope_email = _requester_only_scope_email(user)
	if requester_scope_email:
		if doc.is_new():
			return True
		return (doc.get("requestor_email") or "").strip().lower() == requester_scope_email.strip().lower()

	approver_scope_email = _approver_only_scope_email(user)
	if approver_scope_email:
		stages = doc.get("case_approval_stage") or []
		email = approver_scope_email.strip().lower()

		def is_pending(stage):
			return (stage.get("case_approval_status") or "").strip() in ("", "Awaiting For Approval")

		current_idx = next((i for i, s in enumerate(stages) if is_pending(s)), None)

		for idx, stage in enumerate(stages):
			stage_email = (stage.get("approver_email") or "").strip().lower()
			if stage_email != email:
				continue
			if not is_pending(stage):
				return True  # already acted on this stage
			if idx == current_idx:
				return True  # this is their current turn
		return False

	if _hide_unconfigured_cases_from(user) and not doc.is_new() and _case_has_no_configured_approver(doc):
		return False

	return True


_MOBILE_RE = re.compile(r"^(\+91[\-\s]?)?[6-9]\d{9}$")
_CURRENCY_RE = re.compile(r"^\d*\.?\d*$")
_CURRENCY_FIELDS = ("funds_requested", "amount_already_spent", "annual_family_income")
_MOBILE_FIELDS = ("mobile_number", "requestor_mobile_number", "primary_contact_mobile")
_NAME_RE = re.compile(r"^[A-Za-z .'\-]+$")
_NAME_FIELDS = ("beneficiary_name", "requestor_name", "primary_contact_person")


class CaseRegister(Document):
	# ── Lifecycle ──────────────────────────────────────────────────────────────

	def validate(self):
		# Support IID Settings.disable_case_register_mandatory_fields is
		# the single switch for this — checked, every mandatory check
		# below (both Frappe's own reqd:1 fields and this doctype's own
		# mandatory-document check) is skipped for every save, Data
		# Import included, since an import goes through this exact same
		# validate() per row; unchecked, a Data Import gets no special
		# treatment and is validated exactly like any other save. No
		# separate automatic relaxation for "a Data Import happens to be
		# running" — that used to bypass mandatory checks unconditionally
		# during any import regardless of this checkbox, which meant an
		# import could silently skip validation the checkbox said should
		# still apply.
		if frappe.db.get_single_value("Support IID Settings", "disable_case_register_mandatory_fields"):
			self.flags.ignore_mandatory = True

		self._validate_pincode()
		self._validate_date_of_birth()
		self._validate_email_fields()
		self._validate_mobile_fields()
		self._validate_currency_fields()
		self._validate_name_fields()
		self._validate_mandatory_documents()

	def _validate_pincode(self):
		pincode = str(self.get("pincode") or "").strip()
		if pincode and (len(pincode) != 6 or not pincode.isdigit()):
			frappe.throw("Please enter a valid 6-digit pincode.", title="Invalid Pincode")

	def _validate_date_of_birth(self):
		dob = self.get("date_of_birth")
		if dob and getdate(dob) > getdate(today()):
			frappe.throw("Date of Birth cannot be in the future.", title="Invalid Date of Birth")

	def _validate_email_fields(self):
		for fieldname in ("email", "requestor_email"):
			value = (self.get(fieldname) or "").strip()
			if value and not _EMAIL_SHAPE_RE.match(value):
				frappe.throw(
					f"Please enter a valid email address for {frappe.bold(self.meta.get_label(fieldname))}.",
					title="Invalid Email",
				)

		for idx, stage in enumerate(self.get("case_approval_stage") or []):
			value = (stage.get("approver_email") or "").strip()
			if value and not _EMAIL_SHAPE_RE.match(value):
				frappe.throw(
					f"Row #{idx + 1}: Please enter a valid email address for Approver Email "
					f"(got {frappe.bold(value)}).",
					title="Invalid Approver Email",
				)

		requestor_email = (self.get("requestor_email") or "").strip()
		if not requestor_email:
			return
		enforce_domain = frappe.db.get_single_value(
			"Support IID Settings", "enforce_email_domain_validation"
		)
		if enforce_domain is None or enforce_domain:
			domain = requestor_email.rsplit("@", 1)[-1].lower() if "@" in requestor_email else ""
			if domain != "azimpremjifoundation.org":
				frappe.throw(
					"This is not a member email. Please use your @azimpremjifoundation.org address.",
					title="Invalid Requestor Email",
				)

	def _validate_mobile_fields(self):
		for fieldname in _MOBILE_FIELDS:
			value = str(self.get(fieldname) or "").strip()
			if value and not _MOBILE_RE.match(value):
				frappe.throw(
					f"Please enter a valid 10-digit mobile number for "
					f"{frappe.bold(self.meta.get_label(fieldname))}.",
					title="Invalid Mobile Number",
				)

	def _validate_currency_fields(self):
		for fieldname in _CURRENCY_FIELDS:
			value = self.get(fieldname)
			if value in (None, ""):
				continue
			if isinstance(value, str) and not _CURRENCY_RE.match(value.replace(",", "").strip()):
				frappe.throw(
					f"Please enter numbers only for {frappe.bold(self.meta.get_label(fieldname))}.",
					title="Invalid Amount",
				)

	def _validate_name_fields(self):
		for fieldname in _NAME_FIELDS:
			value = str(self.get(fieldname) or "").strip()
			if value and not _NAME_RE.match(value):
				frappe.throw(
					f"{frappe.bold(self.meta.get_label(fieldname))} can only contain letters and "
					f"the usual name punctuation (spaces, periods, hyphens, apostrophes) — no numbers.",
					title="Invalid Name",
				)

	def _validate_mandatory_documents(self):
		# Not one of the fields Frappe's own ignore_mandatory flag (set
		# in validate(), above, from the Support IID Settings checkbox)
		# covers on its own — that only suppresses the core reqd:1 field
		# check, not this doctype's own custom supporting-document check
		# — so it's checked again here explicitly.
		if self.flags.ignore_mandatory:
			return

		missing = [
			row.document_name
			for row in (self.get("supporting_documents") or [])
			if row.is_mandatory and not row.attachment
		]
		if missing:
			frappe.throw(
				"Please attach all mandatory documents: " + ", ".join(missing),
				title="Missing Mandatory Documents",
			)

	def after_insert(self):
		ensure_requester_user(self.requestor_email, self.requestor_name)

		if self.case_status == CASE_STATUS_DRAFT:
			return

		self._fire_submission_workflow()

	def on_update(self):
		if self.case_status == CASE_STATUS_DRAFT:
			self._rename_supporting_documents()

	def _fire_submission_workflow(self):
		stages = self.get("case_approval_stage") or []
		self.case_status = CASE_STATUS_PENDING
		self.current_approval_level = (
			stages[0].case_approval_level_decription if stages else None
		) or "Level 1"
		self.db_set("case_status", self.case_status, update_modified=False)
		self.db_set("current_approval_level", self.current_approval_level, update_modified=False)

		pdf_path = self._generate_and_save_pdf()
		self._rename_supporting_documents()
		self._send_approval_request_email(
			stage_idx=0,
			case_pdf_path=pdf_path,
			include_supporting_docs=True,
		)
		self._send_requestor_acknowledgement_email(case_pdf_path=pdf_path)

	# ── Supporting document renaming ────────────────────────────────────────────

	def _rename_supporting_documents(self):
		for row in self.get("supporting_documents") or []:
			file_url = row.get("attachment")
			description = (row.get("document_name") or "").strip()
			if not file_url or not description:
				continue

			file_name = frappe.db.get_value(
				"File", {"file_url": file_url, "attached_to_name": self.name}, "name"
			) or frappe.db.get_value(
				"File", {"file_url": file_url, "attached_to_name": ["is", "not set"]}, "name"
			)
			if not file_name:
				continue

			file_doc = frappe.get_doc("File", file_name)
			_, ext = os.path.splitext(file_doc.file_name or "")
			safe_description = "".join(c for c in description if c.isalnum() or c in (" ", "-", "_")).strip()
			new_file_name = f"{self.name} - {safe_description}{ext}"

			if file_doc.file_name == new_file_name:
				continue

			try:
				old_path = file_doc.get_full_path()
				safe_new_file_name = re.sub(r"[/\\%?#]", "_", new_file_name)
				new_url_dir = "/private/files/" if file_doc.is_private else "/files/"
				new_path = frappe.utils.get_files_path(safe_new_file_name, is_private=file_doc.is_private)

				if os.path.exists(old_path) and not os.path.exists(new_path):
					os.rename(old_path, new_path)
					new_url = new_url_dir + safe_new_file_name
					renamed_file_name = new_file_name
				else:
					new_url = file_doc.file_url
					renamed_file_name = file_doc.file_name

				frappe.db.set_value(
					"File",
					file_doc.name,
					{
						"file_name": renamed_file_name,
						"file_url": new_url,
						"attached_to_doctype": "Case Register",
						"attached_to_name": self.name,
						"attached_to_field": "attachment",
					},
					update_modified=False,
				)

				row.attachment = new_url
				frappe.db.set_value(
					"Case Documents",
					row.name,
					"attachment",
					new_url,
					update_modified=False,
				)
				frappe.db.commit()
			except Exception:
				frappe.log_error(
					frappe.get_traceback(),
					f"Supporting document rename failed — {self.name} / {description}",
				)

	# ── PDF generation ─────────────────────────────────────────────────────────

	def _generate_and_save_pdf(self, force=False):
		existing_name = frappe.db.get_value(
			"File",
			{
				"attached_to_doctype": "Case Register",
				"attached_to_name": self.name,
				"file_name": f"Case-{self.name}.pdf",
			},
			"name",
		)
		if existing_name and not force:
			existing_url = frappe.db.get_value("File", existing_name, "file_url")
			self.case_document = existing_url
			return existing_url
		if existing_name and force:
			frappe.delete_doc("File", existing_name, ignore_permissions=True, force=True)

		lock_key = f"support_iid_case_pdf_lock:{self.name}"
		if not frappe.cache().set(lock_key, "1", nx=True, ex=60):
			# Another in-flight request is already generating this case's PDF.
			return frappe.db.get_value(
				"File",
				{
					"attached_to_doctype": "Case Register",
					"attached_to_name": self.name,
					"file_name": f"Case-{self.name}.pdf",
				},
				"file_url",
			)

		file_url = None
		try:
			doc_dict = self.as_dict()
			doc_dict["family_members"] = [r.as_dict() for r in (self.get("family_members") or [])]
			doc_dict["supporting_documents"] = [r.as_dict() for r in (self.get("supporting_documents") or [])]

			pdf_bytes = _build_case_pdf_bytes(doc_dict)

			file_doc = frappe.get_doc(
				{
					"doctype": "File",
					"file_name": f"Case-{self.name}.pdf",
					"attached_to_doctype": "Case Register",
					"attached_to_name": self.name,
					"attached_to_field": "case_document",
					"content": pdf_bytes,
					"decode": False,
					"is_private": 1,
				}
			)
			file_doc.save(ignore_permissions=True)

			frappe.db.set_value(
				"Case Register",
				self.name,
				"case_document",
				file_doc.file_url,
				update_modified=False,
			)
			self.case_document = file_doc.file_url
			file_url = file_doc.file_url

		except ImportError as e:
			frappe.log_error(str(e), "reportlab not installed — PDF skipped")
			return None
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"PDF generation failed — {self.name}",
			)
			return None
		finally:
			frappe.cache().delete(lock_key)

		try:
			frappe.db.commit()
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Post-PDF commit raised (PDF itself saved OK) — {self.name}",
			)

		return file_url

	# ── File lookup helper ─────────────────────────────────────────────────────

	def _get_file_id_from_url(self, file_url, document_name=None):
		if not file_url:
			return None

		fid = frappe.db.get_value("File", {"file_url": file_url}, "name")
		if fid:
			return fid

		basename = file_url.rsplit("/", 1)[-1]
		fid = frappe.db.get_value(
			"File",
			{
				"attached_to_doctype": "Case Register",
				"attached_to_name": self.name,
				"file_url": ["like", f"%{basename}"],
			},
			"name",
		)
		if fid or not document_name:
			return fid

		safe_description = "".join(
			c for c in document_name.strip() if c.isalnum() or c in (" ", "-", "_")
		).strip()
		return frappe.db.get_value(
			"File",
			{
				"attached_to_doctype": "Case Register",
				"attached_to_name": self.name,
				"file_name": ["like", f"{self.name} - {safe_description}.%"],
			},
			"name",
		)

	# ── Approval-request email  (sent to approvers) ───────────────────────────

	def _send_approval_request_email(
		self,
		stage_idx,
		case_pdf_path=None,
		include_supporting_docs=False,
		previous_action=None,
		previous_comments=None,
		previous_approver_name=None,
	):
		stages = self.get("case_approval_stage") or []
		if stage_idx >= len(stages):
			return

		stage = stages[stage_idx]
		approver_email = (stage.get("approver_email") or "").strip()
		approver_name = (stage.get("approver_name") or "Approver").strip()
		level_label = (stage.get("case_approval_level_decription") or f"Level {stage_idx + 1}").strip()

		if not approver_email:
			frappe.logger().warning(f"[SupportIID] No email for approver at stage {stage_idx} — {self.name}")
			return


		req_name = (
			getattr(self, "requestor_name", None) or getattr(self, "requestor_email", None) or "requestor"
		)

		is_final_round = previous_action == "Reviewer Approve"
		approval_kind = "Final Approval" if is_final_round else "Provisional Approval"
		subject = f"Approval Required - [{self.name}] - {req_name} ({approval_kind} ({level_label}))"

		token = make_approval_token(self.name, stage_idx, approver_email)
		webform_url = f"{get_url()}/support-iid-case-approval/new?token={token}"

		registry_token = make_registry_link_token(self.name)
		registry_url = f"{get_url()}/api/method/support_iid.support_iid.doctype.case_register.case_register.resolve_registry_link?token={registry_token}"

		lines = self._build_approval_email_lines(
			approver_name=approver_name,
			level_label=level_label,
			webform_url=webform_url,
			registry_url=registry_url,
			previous_action=previous_action,
			previous_comments=previous_comments,
			previous_approver_name=previous_approver_name,
		)

		attachments = []
		if case_pdf_path:
			fid = self._get_file_id_from_url(case_pdf_path)
			if fid:
				attachments.append({"fid": fid})

		if include_supporting_docs:
			for row in self.get("supporting_documents") or []:
				url = row.get("attachment")
				if not url:
					continue
				fid = self._get_file_id_from_url(url, document_name=row.get("document_name"))
				if fid:
					attachments.append({"fid": fid})

		try:
			_send_plain_email(
				recipients=[approver_email],
				subject=subject,
				lines=lines,
				attachments=attachments,
			)
			frappe.logger().info(
				f"[SupportIID] Approval email → {approver_email} ({level_label}) for {self.name}"
			)
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Approval email failed — {self.name}",
			)

	# ── Requestor notification email  (sent after final decisions) ────────────

	def _send_requestor_notification_email(
		self,
		action,
		comments=None,
		approver_name=None,
		stage_idx=None,
		next_level_label=None,
		final_round=False,
	):
		setting = frappe.db.get_single_value("Support IID Settings", "send_requestor_notification_emails")
		if setting is not None and not setting:
			return

		requestor_email = getattr(self, "requestor_email", None) or ""
		if not requestor_email:
			return

		requestor_name = getattr(self, "requestor_name", None) or "Team"
		beneficiary = getattr(self, "beneficiary_name", None) or ""

		action_line = None

		if action == "Approve" and final_round:
			subject = f"Provisional Approval - [{self.name}] - {beneficiary}"
			heading = "**Your case has passed final verification.**"
			body_extra = (
				f"The support request for {beneficiary or 'the beneficiary'} "
				f"has completed final verification by **{approver_name or 'the review team'}** "
				f"and is now awaiting one last confirmation from the approving "
				f"team before it is marked Approved."
			)
		elif action == "Approve" and next_level_label:
			subject = f"Provisional Approval - [{self.name}] - {beneficiary}"
			heading = "**Your case has moved to the next approval level.**"
			pending_phrase = (
				f"pending **{next_level_label}**"
				if next_level_label == CASE_APPROVAL_LEVEL_REVIEWER
				else f"pending **{next_level_label}** approval"
			)
			body_extra = (
				f"The support request for {beneficiary or 'the beneficiary'} "
				f"has been approved by **{approver_name or 'the review team'}** "
				f"and is now {pending_phrase}. You will receive another update "
				f"as it continues through the review process."
			)
		elif action == "Approve":
			subject = f"Final Approval - [{self.name}] - {beneficiary}"
			heading = "**Your case has been approved.**"
			body_extra = (
				f"Congratulations! This is the final level of approval, and "
				f"the support request for {beneficiary or 'the beneficiary'} "
				f"has been approved by **{approver_name or 'the review team'}**. "
				f"Our team will be in touch shortly regarding disbursement "
				f"details."
			)
		elif action == "Decline":
			subject = f"Case Declined - [{self.name}] - {beneficiary}"
			heading = "**Your case has been declined.**"
			body_extra = (
				f"We regret to inform you that after careful review, the "
				f"support request for {beneficiary or 'the beneficiary'} "
				f"could not be approved at this time."
			)
		else:  # Send Back
			subject = f"Case Returned for Revision - [{self.name}] - {beneficiary}"
			heading = "**Your case has been returned for revision.**"
			body_extra = (
				"Additional information or changes are needed before this "
				"case can proceed. Please review the notes below, update "
				"the details, and resubmit at your earliest convenience."
			)
			if stage_idx is not None:
				edit_url = f"{get_url()}/desk/case-register/{self.name}"
				action_line = f"[[Edit and Resubmit]]({edit_url})"

		lines = [
			f"Dear {requestor_name},",
			"",
			heading,
			f"**Case ID:** {self.name}",
			"",
			body_extra,
		]
		if comments:
			lines += ["", "**Notes:**", comments]
		if action_line:
			lines += ["", action_line]
		lines += ["", "Regards,"]

		try:
			_send_plain_email(
				recipients=[requestor_email],
				subject=subject,
				lines=lines,
			)
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Requestor notification failed — {self.name}",
			)

	# ── Requestor acknowledgement email  (sent right after submission) ────────

	def _send_requestor_acknowledgement_email(self, case_pdf_path=None):
		requestor_email = getattr(self, "requestor_email", None) or ""
		if not requestor_email:
			return

		requestor_name = getattr(self, "requestor_name", None) or "Team"
		beneficiary = getattr(self, "beneficiary_name", None) or ""

		stages = self.get("case_approval_stage") or []
		first_stage = stages[0] if stages else None
		level_label = (first_stage.case_approval_level_decription if first_stage else None) or "Level 1"
		approver_name = (first_stage.approver_name if first_stage else None) or ""

		subject = f"Case Received - [{self.name}] - {beneficiary}"

		withdraw_token = make_withdraw_token(self.name, requestor_email)
		withdraw_url = f"{get_url()}/support-iid-case-withdraw/new?token={withdraw_token}"
		case_url = f"{get_url()}/desk/case-register/{self.name}"

		lines = [
			f"Dear {requestor_name},",
			"",
			f"Thank you for submitting your support request. This is to "
			f"confirm that your request for {beneficiary or 'the beneficiary'} "
			f"has been received.",
			f"**Case ID:** {self.name}",
			"",
			(
				f"Your request is now pending **{level_label}** approval, with "
				f"**{approver_name}**. You will receive an email update as it "
				f"moves through the review process."
				if approver_name
				else f"Your request is now pending **{level_label}** approval. You "
				f"will receive an email update as it moves through the review "
				f"process."
			),
			"",
			"A copy of the case summary is attached for your records.",
			"",
			f"[[View this case]]({case_url})",
			"",
			"If you no longer need this request, you may withdraw it at "
			"any time before a final decision is made:",
			f"[[Withdraw this case]]({withdraw_url})",
			"",
			"Regards,",
		]

		attachments = []
		if case_pdf_path:
			fid = self._get_file_id_from_url(case_pdf_path)
			if fid:
				attachments.append({"fid": fid})

		try:
			_send_plain_email(
				recipients=[requestor_email],
				subject=subject,
				lines=lines,
				attachments=attachments,
			)
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Requestor acknowledgement failed — {self.name}",
			)


	def _send_requestor_resubmit_acknowledgement_email(self, level_label=None, approver_name=None):
		requestor_email = getattr(self, "requestor_email", None) or ""
		if not requestor_email:
			return

		requestor_name = getattr(self, "requestor_name", None) or "Team"
		beneficiary = getattr(self, "beneficiary_name", None) or ""

		subject = f"Case Updates Submitted - [{self.name}] - {beneficiary}"

		withdraw_token = make_withdraw_token(self.name, requestor_email)
		withdraw_url = f"{get_url()}/support-iid-case-withdraw/new?token={withdraw_token}"

		lines = [
			f"Dear {requestor_name},",
			"",
			f"This is to confirm that your updates to case {self.name} have "
			f"been received and resubmitted successfully.",
			"",
			(
				f"The revised support request for {beneficiary or 'the beneficiary'} "
				f"is now pending **{level_label or 'approval'}**, with **{approver_name}**. "
				f"You will receive an email update as it moves through the review process."
				if approver_name
				else f"The revised support request for {beneficiary or 'the beneficiary'} "
				f"is now pending **{level_label or 'approval'}**. You will receive "
				f"an email update as it moves through the review process."
			),
			"",
			"If you no longer need this request, you may withdraw it at "
			"any time before a final decision is made:",
			f"[[Withdraw this case]]({withdraw_url})",
			"",
			"Regards,",
		]

		try:
			_send_plain_email(
				recipients=[requestor_email],
				subject=subject,
				lines=lines,
			)
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"Requestor resubmit acknowledgement failed — {self.name}",
			)

	# ── Email body builder ─────────────────────────────────────────────────────

	def _build_approval_email_lines(
		self,
		approver_name,
		level_label,
		webform_url,
		registry_url,
		previous_action=None,
		previous_comments=None,
		previous_approver_name=None,
	):

		def fget(f):
			return getattr(self, f, None) or ""

		is_medical = (fget("type_of_request") or "").lower() == "medical"
		ben_name = fget("beneficiary_name") or "the beneficiary"
		req_name = fget("requestor_name") or fget("requestor_email") or "the requestor"
		source = fget("source_of_request") or "the team"
		ailment = fget("ailment__course_details") or "the current condition"
		hospital = fget("hospital_institution_name") or "-"
		hosp_loc = fget("hospital_institution_location") or ""
		treatment = fget("treatment") or ""
		age = fget("age") or "-"
		address = (
			", ".join(
				filter(
					None,
					[
						fget("address_line_1"),
						fget("district"),
						fget("state"),
					],
				)
			)
			or "-"
		)
		residence = (
			", ".join(
				filter(
					None,
					[
						fget("residence_type"),
						fget("residence_details"),
					],
				)
			)
			or "-"
		)
		funds_req = self.funds_requested or 0
		ann_income = float(fget("annual_family_income") or 0)
		monthly_inc = int(ann_income / 12) if ann_income else 0
		condition = fget("physical_verification_notes") or fget("genuineness_assessment") or "-"

		fam_parts = []
		for fm in self.get("family_members") or []:
			nm = (fm.get("member_name") or "").strip()
			rel = (fm.get("relationship") or "").strip()
			if rel and nm:
				fam_parts.append(f"{rel} ({nm})")
			elif rel:
				fam_parts.append(rel)
			elif nm:
				fam_parts.append(nm)
		family_line = ", ".join(fam_parts) if fam_parts else "-"

		# Build occupation line from family members
		family_rows = self.get("family_members") or []
		occ_parts = []
		for fm in family_rows:
			nm = (fm.get("member_name") or "").strip()
			occ = (fm.get("occupation") or "").strip()
			if not occ:
				continue
			occ_parts.append(f"{nm}: {occ}" if (nm and len(family_rows) > 1) else occ)
		occupation_line = "; ".join(occ_parts) if occ_parts else (fget("employment_status") or "-")

		hospital_display = f"{hospital}, {hosp_loc}" if hosp_loc else hospital

		funds_formatted = (
			(
				f"INR {int(funds_req):,} for "
				f"{'surgery' if is_medical else 'the request'}, "
				f"in addition to the existing insurance cover"
			)
			if funds_req
			else "-"
		)

		intro_sentence = (
			f"This request was submitted by {req_name} ({source}) on behalf of "
			f"{ben_name}, who is currently undergoing {ailment}."
		)

		lines = [
			f"Dear {approver_name},",
			"",
			f"A support request requires your review as part of the Support IID {level_label} approval.",
			"",
			intro_sentence,
			"",
		]

		if previous_action:
			prev_stage_label = (
				"Final verification, completed"
				if previous_action == "Reviewer Approve"
				else ACTION_LABEL.get(previous_action, previous_action)
			)
			prev_line = f"Previous stage: {prev_stage_label}"
			if previous_approver_name and previous_action in ("Approve", "Reviewer Approve"):
				if previous_action == "Reviewer Approve":
					prev_line += (
						f" — {previous_approver_name} has approved the last level of approval "
						"(Final Verification)"
					)
				else:
					prev_line += f" — approved by {previous_approver_name}"
			lines.append(prev_line)
			if previous_comments:
				lines.append(f"**Comments:** {previous_comments}")
			lines.append("")

		lines.append("**Case Details:**")
		lines.append(f"**Beneficiary:** {ben_name}")
		lines.append(f"**Age:** {age} Yrs" if age and age != "-" else "**Age:** -")
		lines.append(f"**Address:** {address}")
		lines.append(f"**Family:** {family_line}")
		lines.append(f"**Occupation:** {occupation_line}")
		lines.append(f"**Monthly Family Income:** Rs {monthly_inc:,}" if monthly_inc else "**Monthly Family Income:** -")
		lines.append(f"**Residence:** {residence}")
		lines.append(f"**Ailment:** {ailment}" + (f", Treatment: {treatment}" if treatment else ""))
		lines.append(f"**Hospital / Institution:** {hospital_display}")
		lines.append(f"**Funds Requested:** {funds_formatted}")
		lines.append(f"**Verification Notes:** =={condition}==")
		lines.append("")
		lines.append(
			"The case summary and all supporting documents are attached for your reference."
		)
		lines.append("Please review the request and record your decision using the button below:")
		lines.append("")
		lines.append(f"[[For Your Action — Approve / Send Back / Decline]]({webform_url})")
		lines.append("")
		lines.append(f"[[View Case]]({registry_url})")
		lines.append("")
		lines.append("Regards,")

		return lines


@frappe.whitelist(allow_guest=True)
def process_case_approval(
	case_name=None, action=None, comments=None, token=None, otp=None, verify_ticket=None, payload=None
):
	if payload:
		try:
			decrypted = json.loads(frappe_decrypt(payload))
		except Exception:
			frappe.throw("Invalid or corrupted request payload.")
		case_name = decrypted.get("case_name") or case_name
		action = decrypted.get("action") or action
		comments = decrypted.get("comments") or comments
		token = decrypted.get("token") or token
		otp = decrypted.get("otp") or otp
		verify_ticket = decrypted.get("verify_ticket") or verify_ticket

	token_payload = read_approval_token(token) if token else None

	if not case_name and token_payload:
		case_name = token_payload.get("case_name")

	if not case_name or not action:
		frappe.throw("case_name and action are required.")

	if token_payload and frappe.session.user == "Guest":
		if not _otp_or_ticket_verified(token, otp, verify_ticket):
			frappe.throw("Invalid or expired verification code. Please request a new one and try again.")

	if action not in ("Approve", "Decline", "Send Back"):
		frappe.throw("Invalid action. Must be 'Approve', 'Decline', or 'Send Back'.")

	doc = frappe.get_doc("Case Register", case_name)
	stages = doc.get("case_approval_stage") or []

	if not stages:
		frappe.throw("This case has no approval stages configured.")

	# Find the first stage still pending
	current_stage = current_idx = None
	for idx, stage in enumerate(stages):
		status = (stage.case_approval_status or "").strip()
		if status in ("", "Awaiting For Approval"):
			current_stage, current_idx = stage, idx
			break

	if not current_stage:
		frappe.throw("No pending approval stage found on this case.")

	approver_email = (current_stage.approver_email or "").strip().lower()

	user = frappe.session.user
	token_ok = bool(
		token_payload
		and token_payload.get("case_name") == case_name
		and token_payload.get("level_idx") == current_idx
		and token_payload.get("approver_email") == approver_email
	)

	if not token_ok:
		if user == "Administrator" or "System Manager" in frappe.get_roles(user):
			pass
		elif approver_email and user.lower() == approver_email:
			pass
		else:
			frappe.throw("You are not the designated approver for the current stage.")

	approver_name = current_stage.approver_name or (
		frappe.utils.get_fullname(user) if user != "Guest" else "Approver"
	)
	level_label = current_stage.case_approval_level_decription or f"Level {current_idx + 1}"
	log_user = approver_email or (user if user != "Guest" else "")

	# Record the action on the stage
	current_stage.case_approval_status = action

	# Append to audit log
	doc.append(
		"case_approval_log",
		{
			"date": today(),
			"level": level_label,
			"approver_name": approver_name,
			"approver_name_email": log_user,
			"action": action,
			"comments": comments or "",
		},
	)

	# ── Determine next state + trigger emails ──────────────────────────────────
	if action == "Decline":
		doc.case_status = CASE_STATUS_REJECTED
		doc.current_approval_level = ""
		doc.save(ignore_permissions=True)
		_safe_commit(case_name)
		doc._send_requestor_notification_email(
			action="Decline",
			comments=comments,
			approver_name=approver_name,
		)

	elif action == "Send Back":
		doc.case_status = CASE_STATUS_SENT_BACK
		doc.current_approval_level = level_label
		doc.save(ignore_permissions=True)
		_safe_commit(case_name)
		doc._send_requestor_notification_email(
			action="Send Back",
			comments=comments,
			approver_name=approver_name,
			stage_idx=current_idx,
		)

	else:  # Approve
		remaining = stages[current_idx + 1 :]
		if remaining:
			# Advance to the next stage
			next_stage = remaining[0]
			next_stage.case_approval_status = "Awaiting For Approval"
			next_level = next_stage.case_approval_level_decription or f"Level {current_idx + 2}"
			doc.case_status = CASE_STATUS_PENDING
			doc.current_approval_level = next_level
			doc.save(ignore_permissions=True)
			_safe_commit(case_name)

			# Email the next approver
			doc._send_approval_request_email(
				stage_idx=current_idx + 1,
				case_pdf_path=doc.case_document or None,
				include_supporting_docs=True,
				previous_action=action,
				previous_comments=comments,
				previous_approver_name=approver_name,
			)
			doc._send_requestor_notification_email(
				action="Approve",
				comments=comments,
				approver_name=approver_name,
				next_level_label=next_level,
			)

		else:
			already_verified_by_reviewer = any(
				(log.action or "") == "Reviewer Approve" for log in (doc.get("case_approval_log") or [])
			)

			if already_verified_by_reviewer:
				doc.case_status = CASE_STATUS_APPROVED
				doc.current_approval_level = ""
				if not doc.approved_date:
					doc.approved_date = today()
				doc.save(ignore_permissions=True)
				_safe_commit(case_name)
				doc._send_requestor_notification_email(
					action="Approve",
					comments=comments,
					approver_name=approver_name,
				)
			else:
				doc.case_status = CASE_STATUS_FINAL_VERIFICATION
				doc.current_approval_level = CASE_APPROVAL_LEVEL_REVIEWER
				doc.save(ignore_permissions=True)
				_safe_commit(case_name)
				doc._send_requestor_notification_email(
					action="Approve",
					comments=comments,
					approver_name=approver_name,
					next_level_label=CASE_APPROVAL_LEVEL_REVIEWER,
				)
				_notify_reviewers_of_provisional_approval(doc, approver_name, comments)

	result = {
		"case_status": doc.case_status,
		"current_approval_level": doc.current_approval_level,
		"case_approval_stage": [s.as_dict() for s in doc.case_approval_stage],
		"case_approval_log": [r.as_dict() for r in doc.case_approval_log],
	}

	return encrypt_response(result)


@frappe.whitelist(allow_guest=True)
def resolve_withdraw_token(token):
	payload = read_withdraw_token(token)
	if not payload:
		frappe.throw("This withdraw link is invalid or has expired.")

	case_name = payload.get("case_name")
	requestor_email = payload.get("requestor_email")

	doc = frappe.get_doc("Case Register", case_name)
	if (doc.requestor_email or "").strip().lower() != requestor_email:
		frappe.throw("This withdraw link is invalid or has expired.")

	return encrypt_response(
		{
			"case_name": case_name,
			"beneficiary_name": doc.beneficiary_name or "",
			"case_status": doc.case_status or "",
			"requestor_name": doc.requestor_name or "",
		}
	)


def _do_withdraw_case(doc, reason):
	if doc.case_status not in (CASE_STATUS_PENDING, CASE_STATUS_SENT_BACK, CASE_STATUS_FINAL_VERIFICATION):
		frappe.throw(
			"This case can no longer be withdrawn — its current status is "
			+ (doc.case_status or "unknown")
			+ "."
		)

	doc.case_status = CASE_STATUS_WITHDRAWN
	doc.current_approval_level = ""
	doc.withdrawal_reason = reason
	doc.append(
		"case_approval_log",
		{
			"date": today(),
			"level": "",
			"approver_name": doc.requestor_name or "",
			"action": "Withdrawn",
			"comments": reason,
		},
	)
	doc.save(ignore_permissions=True)
	_safe_commit(doc.name)

	try:
		_send_plain_email(
			recipients=[doc.requestor_email],
			subject=f"Case Withdrawn - [{doc.name}] - {doc.beneficiary_name or ''}",
			lines=[
				f"Dear {doc.requestor_name or 'Team'},",
				"",
				f"This is to confirm that case {doc.name} has been withdrawn at your request.",
				"",
				f"**Reason:** {reason}",
				"",
				"No further action will be taken on this case. If this was "
				"done in error, please feel free to submit a new request.",
			],
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Withdraw confirmation email failed — {doc.name}")

	_notify_reviewers_of_withdrawal(doc, reason)


@frappe.whitelist(allow_guest=True)
def withdraw_case(token, reason=None, otp=None, verify_ticket=None):
	payload = read_withdraw_token(token)
	if not payload:
		frappe.throw("This withdraw link is invalid or has expired.")

	if not _otp_or_ticket_verified(token, otp, verify_ticket):
		frappe.throw("Invalid or expired verification code. Please request a new one and try again.")

	reason = (reason or "").strip()
	if not reason:
		frappe.throw("Please provide a reason for withdrawing this case.")

	case_name = payload.get("case_name")
	requestor_email = payload.get("requestor_email")

	doc = frappe.get_doc("Case Register", case_name)
	if (doc.requestor_email or "").strip().lower() != requestor_email:
		frappe.throw("This withdraw link is invalid or has expired.")

	_do_withdraw_case(doc, reason)
	return encrypt_response({"case_status": doc.case_status})


@frappe.whitelist()
def withdraw_case_from_desk(case_name, reason=None):
	doc = frappe.get_doc("Case Register", case_name)

	user = frappe.session.user
	if not (
		user == "Administrator"
		or "System Manager" in frappe.get_roles(user)
		or (doc.requestor_email or "").strip().lower() == user.strip().lower()
	):
		frappe.throw("You don't have permission to withdraw this case.", frappe.PermissionError)

	reason = (reason or "").strip()
	if not reason:
		frappe.throw("Please provide a reason for withdrawing this case.")

	_do_withdraw_case(doc, reason)
	return {"case_status": doc.case_status}


def _notify_reviewers_of_withdrawal(doc, reason):
	reviewer_emails = frappe.get_all(
		"Has Role",
		filters={"role": "Support IID Reviewer", "parenttype": "User"},
		pluck="parent",
	)
	reviewer_emails = [e for e in reviewer_emails if e and e not in ("Administrator", "Guest")]
	if not reviewer_emails:
		return

	try:
		_send_plain_email(
			recipients=reviewer_emails,
			subject=f"Case Withdrawn - [{doc.name}] - {doc.beneficiary_name or ''}",
			lines=[
				"Dear Support IID Reviewer,",
				"",
				f"This is to inform you that case {doc.name} has been withdrawn by the requestor.",
				"",
				f"**Beneficiary:** {doc.beneficiary_name or '-'}",
				f"**Requestor:** {doc.requestor_name or '-'} ({doc.requestor_email or '-'})",
				f"**Reason given:** {reason}",
				"",
				"No further action is needed on this case.",
				"",
				"Regards,",
			],
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Reviewer withdrawal notification failed — {doc.name}")


def _notify_reviewers_of_provisional_approval(doc, approver_name, comments=None):
	reviewer_emails = frappe.get_all(
		"Has Role",
		filters={"role": "Support IID Reviewer", "parenttype": "User"},
		pluck="parent",
	)
	reviewer_emails = [e for e in reviewer_emails if e and e not in ("Administrator", "Guest")]
	if not reviewer_emails:
		return

	case_url = f"{get_url()}/desk/case-register/{doc.name}"
	lines = [
		"Dear Support IID Reviewer,",
		"",
		f"Case {doc.name} has now been approved at every approval level and "
		f"is ready for final verification before it can be marked Approved.",
		"",
		f"**Beneficiary:** {doc.beneficiary_name or '-'}",
		f"**Requestor:** {doc.requestor_name or '-'} ({doc.requestor_email or '-'})",
		f"**Last approved by:** {approver_name or '-'}",
	]
	if comments:
		lines += ["", "**Approver notes:**", comments]
	lines += [
		"",
		"The full case summary PDF and all supporting documents are attached for your reference.",
		"",
		f"[[For Your Action — Approve / Decline]]({case_url})",
		"",
		"Regards,",
	]

	attachments = []
	if doc.case_document:
		fid = doc._get_file_id_from_url(doc.case_document)
		if fid:
			attachments.append({"fid": fid})
	for row in doc.get("supporting_documents") or []:
		url = row.get("attachment")
		if not url:
			continue
		fid = doc._get_file_id_from_url(url, document_name=row.get("document_name"))
		if fid:
			attachments.append({"fid": fid})

	try:
		_send_plain_email(
			recipients=reviewer_emails,
			subject=f"Final Verification Needed - [{doc.name}] - {doc.beneficiary_name or ''}",
			lines=lines,
			attachments=attachments,
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Reviewer verification notification failed — {doc.name}")


@frappe.whitelist()
def reviewer_final_approval(case_name, action, comments=None):
	user = frappe.session.user
	if not (
		user == "Administrator"
		or "System Manager" in frappe.get_roles(user)
		or "Support IID Reviewer" in frappe.get_roles(user)
	):
		frappe.throw("You don't have permission to verify this case.", frappe.PermissionError)

	if action not in ("Approve", "Send Back"):
		frappe.throw("Invalid action. Must be 'Approve' or 'Send Back'.")

	doc = frappe.get_doc("Case Register", case_name)
	if doc.case_status != CASE_STATUS_FINAL_VERIFICATION or doc.current_approval_level != CASE_APPROVAL_LEVEL_REVIEWER:
		frappe.throw("This case is not awaiting final verification.")

	stages = doc.get("case_approval_stage") or []
	if not stages:
		frappe.throw("This case has no approval stages configured.")
	last_idx = len(stages) - 1
	last_stage = stages[last_idx]

	reviewer_name = frappe.utils.get_fullname(user) if user != "Guest" else "Support IID Reviewer"
	log_action = "Reviewer Approve" if action == "Approve" else "Reviewer Send Back"

	doc.append(
		"case_approval_log",
		{
			"date": today(),
			"level": CASE_APPROVAL_LEVEL_REVIEWER,
			"approver_name": reviewer_name,
			"approver_name_email": user if user != "Guest" else "",
			"action": log_action,
			"comments": comments or "",
		},
	)

	if action == "Approve":
		last_level_label = last_stage.case_approval_level_decription or f"Level {last_idx + 1}"
		last_stage.case_approval_status = "Awaiting For Approval"
		doc.case_status = CASE_STATUS_PENDING
		doc.current_approval_level = last_level_label
		doc.save(ignore_permissions=True)
		_safe_commit(case_name)

		# Back to the same last-level approver for the real, final round.
		doc._send_approval_request_email(
			stage_idx=last_idx,
			case_pdf_path=doc.case_document or None,
			include_supporting_docs=True,
			previous_action="Reviewer Approve",
			previous_comments=comments,
			previous_approver_name=reviewer_name,
		)
		doc._send_requestor_notification_email(
			action="Approve",
			comments=comments,
			approver_name=reviewer_name,
			final_round=True,
		)
	else:  # Send Back
		last_level_label = last_stage.case_approval_level_decription or f"Level {last_idx + 1}"
		doc.case_status = CASE_STATUS_SENT_BACK
		last_stage.case_approval_status = "Send Back"
		doc.current_approval_level = last_level_label
		doc.save(ignore_permissions=True)
		_safe_commit(case_name)
		doc._send_requestor_notification_email(
			action="Send Back",
			comments=comments,
			approver_name=reviewer_name,
			stage_idx=last_idx,
		)

	return {"case_status": doc.case_status, "current_approval_level": doc.current_approval_level}


@frappe.whitelist()
def submit_case(case_name):
	doc = frappe.get_doc("Case Register", case_name)
	if doc.case_status != CASE_STATUS_DRAFT:
		frappe.throw("Only a Draft case can be submitted.")

	doc.save()
	doc._fire_submission_workflow()
	frappe.db.commit()
	return {"case_status": doc.case_status, "current_approval_level": doc.current_approval_level}


@frappe.whitelist()
def close_case(
	case_name,
	approved_amount=None,
	utr_details=None,
	milaap_recommendation=None,
	milaap_campaign_link=None,
	status_of_milaap_transfer=None,
	refund_amount_if_any=None,
):
	user = frappe.session.user
	if not (
		user == "Administrator"
		or "System Manager" in frappe.get_roles(user)
		or "Support IID Reviewer" in frappe.get_roles(user)
	):
		frappe.throw("You don't have permission to close cases.", frappe.PermissionError)

	doc = frappe.get_doc("Case Register", case_name)
	if doc.case_status != CASE_STATUS_APPROVED:
		frappe.throw("Only an Approved case can be closed.")

	if approved_amount is None or approved_amount == "":
		frappe.throw("Approved Amount is required to close a case.")

	doc.date_of_transfer = today()
	doc.approved_amount = approved_amount
	if utr_details:
		doc.utr_details = utr_details
	if milaap_recommendation:
		doc.milaap_recommendation = milaap_recommendation
	if milaap_campaign_link:
		doc.milaap_campaign_link = milaap_campaign_link
	if status_of_milaap_transfer:
		doc.status_of_milaap_transfer = status_of_milaap_transfer
	if refund_amount_if_any not in (None, ""):
		doc.refund_amount_if_any = refund_amount_if_any

	doc.case_status = CASE_STATUS_CLOSED
	doc.save(ignore_permissions=True)
	_safe_commit(case_name)

	return encrypt_response(
		{
			"case_status": doc.case_status,
			"date_of_transfer": str(doc.date_of_transfer or ""),
			"approved_amount": doc.approved_amount,
			"utr_details": doc.utr_details,
			"milaap_recommendation": doc.milaap_recommendation,
			"milaap_campaign_link": doc.milaap_campaign_link,
			"status_of_milaap_transfer": doc.status_of_milaap_transfer,
			"refund_amount_if_any": doc.refund_amount_if_any,
		}
	)


@frappe.whitelist()
def get_approval_stages_for_case(case_name):
	doc = frappe.get_doc("Case Register", case_name)
	return encrypt_response(
		{
			"case_status": doc.case_status,
			"current_approval_level": doc.current_approval_level,
			"stages": [
				{
					"idx": s.idx,
					"level": s.case_approval_level_decription or "",
					"approver_name": s.approver_name or "",
					"approver_email": s.approver_email or "",
					"status": s.case_approval_status or "Awaiting For Approval",
				}
				for s in (doc.get("case_approval_stage") or [])
			],
			"logs": [
				{
					"date": r.date,
					"level": r.level,
					"approver_name": r.approver_name,
					"action": r.action,
					"comments": r.comments,
				}
				for r in (doc.get("case_approval_log") or [])
			],
		}
	)


@frappe.whitelist(allow_guest=True)
def resolve_approval_token(token):
	payload = read_approval_token(token)
	if not payload:
		frappe.throw("This approval link is invalid or has expired.")

	case_name = payload.get("case_name")
	level_idx = payload.get("level_idx")
	approver_email = payload.get("approver_email")

	doc = frappe.get_doc("Case Register", case_name)
	stages = doc.get("case_approval_stage") or []
	if level_idx is None or level_idx >= len(stages):
		frappe.throw("This approval link is invalid or has expired.")

	stage = stages[level_idx]
	if (stage.approver_email or "").strip().lower() != approver_email:
		frappe.throw("This approval link is invalid or has expired.")

	return encrypt_response(
		{
			"case_name": case_name,
			"level": stage.case_approval_level_decription or f"Level {level_idx + 1}",
			"approver_name": stage.approver_name or "",
			"approver_email": stage.approver_email or "",
			"status": stage.case_approval_status or "Awaiting For Approval",
			"beneficiary_name": doc.beneficiary_name or "",
		}
	)


@frappe.whitelist(allow_guest=True)
def resolve_case_for_edit(token):
	payload = read_edit_token(token)
	if not payload:
		frappe.throw("This edit link is invalid or has expired.")

	case_name = payload.get("case_name")
	requestor_email = payload.get("requestor_email")

	doc = frappe.get_doc("Case Register", case_name)
	if (doc.requestor_email or "").strip().lower() != requestor_email:
		frappe.throw("This edit link is invalid or has expired.")

	web_form = frappe.get_doc("Web Form", "support-iid-case-registration")
	editable_fieldnames = [
		f.fieldname
		for f in web_form.web_form_fields
		if f.fieldname not in ("case_approval_stage", "case_approval_log")
	]

	data = {}
	for fieldname in editable_fieldnames:
		value = doc.get(fieldname)
		if isinstance(value, list):
			data[fieldname] = [row.as_dict() for row in value]
		else:
			data[fieldname] = value

	return encrypt_response({"case_name": case_name, "data": data})


def _find_send_back_stage(doc):
	stages = doc.get("case_approval_stage") or []
	for idx, stage in enumerate(stages):
		if (stage.case_approval_status or "").strip() == "Send Back":
			return stage, idx
	return None, None


def _resubmit_after_send_back(doc, stage_idx, previous_action, previous_comments=None):
	stages = doc.get("case_approval_stage") or []
	stage = stages[stage_idx]

	logs = doc.get("case_approval_log") or []
	sent_back_by_reviewer = bool(logs) and (logs[-1].action or "").strip() == "Reviewer Send Back"

	if sent_back_by_reviewer:
		stage.case_approval_status = "Approve"
		doc.case_status = CASE_STATUS_FINAL_VERIFICATION
		doc.current_approval_level = CASE_APPROVAL_LEVEL_REVIEWER
		doc.save(ignore_permissions=True)
		_safe_commit(doc.name)

		doc._rename_supporting_documents()
		doc._generate_and_save_pdf(force=True)

		_notify_reviewers_of_provisional_approval(doc, stage.approver_name or "", previous_comments)
		doc._send_requestor_resubmit_acknowledgement_email(
			level_label=doc.current_approval_level,
			approver_name="",
		)
		return

	try:
		from support_iid.api.microsoft_graph import get_current_approver_for_level

		level_name = stage.case_approval_level_decription
		current_approver = get_current_approver_for_level(doc.requestor_email, level_name)
		if current_approver and current_approver.get("approver_email"):
			stage.approver_name = current_approver["approver_name"]
			stage.approver_email = current_approver["approver_email"]
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Reviewer refresh failed on resubmit — {doc.name}")

	stage.case_approval_status = "Awaiting For Approval"
	doc.case_status = CASE_STATUS_PENDING
	doc.current_approval_level = stage.case_approval_level_decription or f"Level {stage_idx + 1}"
	doc.save(ignore_permissions=True)
	_safe_commit(doc.name)

	doc._rename_supporting_documents()

	pdf_path = doc._generate_and_save_pdf(force=True)

	doc._send_approval_request_email(
		stage_idx=stage_idx,
		case_pdf_path=pdf_path,
		include_supporting_docs=True,
		previous_action=previous_action,
		previous_comments=previous_comments,
	)
	doc._send_requestor_resubmit_acknowledgement_email(
		level_label=doc.current_approval_level,
		approver_name=stage.approver_name or "",
	)


@frappe.whitelist(allow_guest=True)
def submit_case_edit(token, data, otp=None, verify_ticket=None):
	payload = read_edit_token(token)
	if not payload:
		frappe.throw("This edit link is invalid or has expired.")

	if not _otp_or_ticket_verified(token, otp, verify_ticket):
		frappe.throw("Invalid or expired verification code. Please request a new one and try again.")

	case_name = payload.get("case_name")
	requestor_email = payload.get("requestor_email")
	stage_idx = payload.get("stage_idx")

	doc = frappe.get_doc("Case Register", case_name)
	if (doc.requestor_email or "").strip().lower() != requestor_email:
		frappe.throw("This edit link is invalid or has expired.")

	stages = doc.get("case_approval_stage") or []
	if stage_idx is None or stage_idx >= len(stages):
		frappe.throw("This edit link is invalid or has expired.")
	if (stages[stage_idx].case_approval_status or "").strip() != "Send Back":
		frappe.throw("This case is no longer awaiting revision.")

	if isinstance(data, str):
		data = json.loads(data)

	web_form = frappe.get_doc("Web Form", "support-iid-case-registration")
	editable_fieldnames = {
		f.fieldname
		for f in web_form.web_form_fields
		if f.fieldname not in ("case_approval_stage", "case_approval_log")
	}

	for fieldname, value in (data or {}).items():
		if fieldname in editable_fieldnames:
			doc.set(fieldname, value)

	_resubmit_after_send_back(doc, stage_idx, previous_action="Send Back (revised & resubmitted)")

	return encrypt_response(
		{
			"case_status": doc.case_status,
			"current_approval_level": doc.current_approval_level,
		}
	)


@frappe.whitelist()
def resubmit_case_from_desk(case_name, comments=None):
	doc = frappe.get_doc("Case Register", case_name)

	user = frappe.session.user
	if not (
		user == "Administrator"
		or "System Manager" in frappe.get_roles(user)
		or (doc.requestor_email or "").strip().lower() == user.strip().lower()
	):
		frappe.throw("You don't have permission to resubmit this case.", frappe.PermissionError)

	if doc.case_status != CASE_STATUS_SENT_BACK:
		frappe.throw("Only a Sent Back case can be resubmitted.")

	_, stage_idx = _find_send_back_stage(doc)
	if stage_idx is None:
		frappe.throw("This case has no stage awaiting revision.")

	_resubmit_after_send_back(
		doc,
		stage_idx,
		previous_action="Send Back (revised & resubmitted)",
		previous_comments=comments,
	)

	return {"case_status": doc.case_status, "current_approval_level": doc.current_approval_level}


@frappe.whitelist()
def resolve_registry_link(token):
	payload = read_registry_link_token(token)
	if not payload:
		frappe.throw("This link is invalid or has expired.")

	case_name = payload.get("case_name")
	if not frappe.db.exists("Case Register", case_name):
		frappe.throw("This case no longer exists.")

	doc = frappe.get_doc("Case Register", case_name)
	if not doc.has_permission("read"):
		frappe.throw("You don't have permission to view this case.", frappe.PermissionError)

	frappe.local.response["type"] = "redirect"
	frappe.local.response["location"] = f"/desk/case-register/{case_name}"


@frappe.whitelist()
def get_current_user_roles():
	frappe.cache.hdel("roles", frappe.session.user)
	return frappe.get_roles(frappe.session.user)

# Copyright (c) 2026, Tech For Social Sector and contributors
# For license information, please see license.txt
#
# case_register.py — single self-contained file for the Case Register doctype.
#
# INSTALL reportlab into your bench before using PDF generation:
#   bench pip install reportlab
#
# Contains:
#   1. CaseRegister Document class (after_insert lifecycle)
#   2. PDF generation via ReportLab — all imports are LAZY (inside the
#      function that uses them) so the module loads fine even when reportlab
#      is not yet installed, and Frappe's web form / list views still work.
#   3. process_case_approval()  — @frappe.whitelist, shared by:
#        • web form  (support_iid_case_approval)
#        • UI page   (case_list / case-registry)
#        • dashboard popup
#   4. get_approval_stages_for_case() — @frappe.whitelist
#
# Email behaviour per approval level:
#   on_insert               → email to L1 approver (PDF + all supporting docs)
#   Approve + more stages   → email to next-level approver (PDF + docs)
#   Approve + last stage    → notification email to requestor (approved)
#   Decline                 → notification email to requestor (declined)
#   Send Back               → notification email to requestor (revision needed)

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

# ─────────────────────────────────────────────────────────────────────────────
# Shared maps used by both Python and JS (via the whitelisted functions)
# ─────────────────────────────────────────────────────────────────────────────
ACTION_LABEL = {
	"Approve": "Approved",
	"Decline": "Declined",
	"Send Back": "Sent Back for Revision",
}

# ─────────────────────────────────────────────────────────────────────────────
# Case Status — fixed set of values, each a record in the "Case Status List"
# master doctype (Link options), so case_status no longer bakes the current
# approval level's name into the stored string (that varies per case and
# can't be represented by a fixed Link master). The level, when status is
# "Pending Approval", is tracked separately in current_approval_level.
# ─────────────────────────────────────────────────────────────────────────────
CASE_STATUS_DRAFT = "Draft"
CASE_STATUS_PENDING = "Pending Approval"
CASE_STATUS_APPROVED = "Approved"
CASE_STATUS_REJECTED = "Rejected"
CASE_STATUS_SENT_BACK = "Sent Back"
CASE_STATUS_CLOSED = "Closed"
CASE_STATUS_WITHDRAWN = "Withdrawn by the Requester"

# Display-only relabeling — the stored case_status value (Link to Case
# Status List, used in filters/reports/data everywhere) stays "Sent Back"
# for data consistency, but anywhere it's actually shown to a user it
# should read "Pending with Requester" instead — clearer about whose turn
# it is to act than the more passive "Sent Back".
CASE_STATUS_DISPLAY_LABELS = {
	CASE_STATUS_SENT_BACK: "Pending with Requester",
	# "Rejected" is flagged as a restricted/spam-trigger word by some
	# outgoing-mail providers, causing emails using it in the subject or
	# body to be filtered or blocked. Displayed as "Declined" everywhere
	# instead, matching the wording already used for the Decline ACTION
	# (ACTION_LABEL["Decline"] = "Declined") — the stored case_status
	# value stays "Rejected" for data/filter consistency.
	CASE_STATUS_REJECTED: "Declined",
}


def case_status_display_label(status):
	return CASE_STATUS_DISPLAY_LABELS.get(status, status)


# ─────────────────────────────────────────────────────────────────────────────
# Response encryption — every endpoint that returns real case data (name,
# beneficiary, financials, medical details, approver contacts, ...) returns
# it wrapped in this AES-GCM envelope instead of plain JSON, so the payload
# isn't sitting in cleartext in the browser's Network tab. Same key and
# {"encrypted", "iv", "data"} shape already used by support_iid.api.
# microsoft_graph.encrypt_payload — must match the key in each web form's
# client-side decryptPayload().
# ─────────────────────────────────────────────────────────────────────────────
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


# ─────────────────────────────────────────────────────────────────────────────
# Approval token — encrypts (case_name, level, approver_email) into an
# opaque, URL-safe token so email links don't expose these as plain query
# params. Anyone holding a valid token is treated as the intended approver
# for that stage, which is what lets the (unauthenticated) web form verify
# identity without a Frappe login.
# ─────────────────────────────────────────────────────────────────────────────


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
	"""
	Token for the Send-Back "edit and resubmit" link — proves the holder
	is the requestor for this exact case, and remembers which approval
	stage sent it back so resubmission re-notifies the same approver.
	"""
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
	"""
	Token for the "withdraw this case" link sent with the requestor
	acknowledgement email — proves the holder is the requestor for this
	exact case, same as make_edit_token but with no approval stage tied
	to it (withdrawal isn't specific to any one stage).
	"""
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
	"""
	Token for the "View in Case Registry" link sent to approvers — the
	case name never appears in the email itself; resolve_registry_link
	decrypts it server-side and redirects, same opaque-link treatment
	the guest-facing approval/edit/withdraw links already get, even
	though this one's for a logged-in Desk user rather than a guest.
	"""
	payload = json.dumps({"purpose": "registry_link", "case_name": case_name})
	encrypted = frappe_encrypt(payload)
	return base64.urlsafe_b64encode(encrypted.encode()).decode()


def read_registry_link_token(token):
	payload = _read_token(token)
	if not payload or payload.get("purpose") != "registry_link":
		return None
	return payload


# ─────────────────────────────────────────────────────────────────────────────
# OTP — a second factor on top of the token. The token proves the caller
# received the emailed link; the OTP (sent to the same bound approver_email,
# entered live on the web form) proves they can access that inbox right now.
# Stored in Redis, keyed by a hash of the token, so it can't be guessed from
# the token itself and auto-expires without any extra doctype/table.
# ─────────────────────────────────────────────────────────────────────────────

_OTP_TTL_SECONDS = 10 * 60


def _otp_cache_key(token):
	return "support_iid_approval_otp:" + hashlib.sha256(token.encode()).hexdigest()


@frappe.whitelist(allow_guest=True)
def send_approval_otp(token):
	"""
	Generates a 6-digit OTP for the approver bound to this token and emails
	it to that (token-bound, not user-supplied) address. Called when the
	approver clicks "Send OTP" on the web form, before they can submit.
	"""
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
	"""
	Same as send_approval_otp, but for the Send-Back "edit and resubmit"
	flow — sends the OTP to the token-bound requestor_email.
	"""
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
	"""
	Same as send_edit_otp, but for the "withdraw this case" flow — sends
	the OTP to the token-bound requestor_email.
	"""
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
	"""Returns True and deletes the OTP if it matches; False otherwise (does not raise).

	A 6-digit OTP is only as strong as the guesswork it takes to brute-force
	it — with no attempt cap, a leaked token (e.g. a forwarded email, browser
	history, a Referer leak) could be brute-forced by simply calling this
	within the 10-minute TTL. Once _OTP_MAX_ATTEMPTS wrong guesses have been
	made for a given token, the OTP is invalidated outright (the caller must
	request a fresh one), the same as if it had expired.
	"""
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


# ─────────────────────────────────────────────────────────────────────────────
# Verify-ticket — lets the UI have an explicit "Verify" step that checks the
# OTP immediately (rather than deferring the check to final Save/Submit).
# Verifying consumes the OTP and issues a short-lived ticket; the final
# submit call sends the ticket instead of the raw code, so the code is
# never checked/exposed a second time.
# ─────────────────────────────────────────────────────────────────────────────

# Long enough to cover realistic time spent filling in the rest of a long
# form (family members, documents, etc.) after verifying — a short window
# here caused "Invalid or expired verification code" on Save even though
# the OTP itself had just been correctly verified moments before.
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
	"""
	True if either a valid verify_ticket (from an earlier explicit Verify
	step) or a raw otp (checked and consumed now) proves the caller.
	"""
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
	"""
	frappe.db.commit() can raise from unrelated deferred work (e.g. a stale
	queued email referencing an old file) that has nothing to do with the
	save that just happened. Swallow-and-log so callers can safely proceed
	to their own follow-up steps (like sending a notification) regardless.
	"""
	try:
		frappe.db.commit()
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Post-save commit raised — {context}")


# ─────────────────────────────────────────────────────────────────────────────
# Email helpers — plain content, rendered as minimal HTML so it actually
# displays with real line breaks (frappe.sendmail() always renders `message`
# through an HTML template — raw "\n" characters have no effect in HTML, so
# a naive plain-text string collapses into one run-on paragraph in Gmail/
# Outlook). No colors, boxes, or styled buttons — just <p>/<br> structure.
# The APF logo is embedded inline in the signature (not a file attachment).
# ─────────────────────────────────────────────────────────────────────────────
_APF_LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "apf_logo.jpg")
_APF_LOGO_FILENAME = "azim-premji-foundation-logo.jpg"


def _logo_inline_image():
	"""Returns the {"filename", "filecontent"} entry for frappe.sendmail's
	inline_images param, or None if the asset is missing."""
	if not os.path.exists(_APF_LOGO_PATH):
		return None
	with open(_APF_LOGO_PATH, "rb") as f:
		return {"filename": _APF_LOGO_FILENAME, "filecontent": f.read()}


def _lines_to_html(lines):
	"""Joins plain text lines into an HTML body: each line becomes its own
	paragraph-like block, blank lines add spacing. Two lightweight markup
	forms are supported so call sites can build user-friendly emails
	without writing raw HTML:
	  **bold text**        -> <b>bold text</b>
	  [Link label](url)    -> <a href="url">Link label</a>  (short,
	                           readable link text instead of a raw URL)
	Any bare https:// URL not already wrapped in [label](...) still
	becomes a plain clickable link, same as before.
	"""
	# Single tokenizing pass over the RAW (unescaped) text — matches
	# markdown-style link, bold, or a bare URL, in that priority order.
	# Everything between matches is plain text. Each piece is escaped
	# individually and only then wrapped in its HTML tag, so the tags
	# this function adds are never themselves escaped or re-matched.
	token_re = re.compile(
		r"\[([^\]]+)\]\((https?://[^\s)]+)\)"  # 1=label, 2=url
		r"|\*\*([^*]+)\*\*"  # 3=bold text
		r"|(https?://\S+)"  # 4=bare url
	)

	def render(text):
		out = []
		pos = 0
		for m in token_re.finditer(text):
			out.append(frappe.utils.escape_html(text[pos : m.start()]))
			if m.group(1) is not None:
				label = frappe.utils.escape_html(m.group(1))
				url = frappe.utils.escape_html(m.group(2))
				out.append(f'<a href="{url}"><b>{label}</b></a>')
			elif m.group(3) is not None:
				out.append(f"<b>{frappe.utils.escape_html(m.group(3))}</b>")
			else:
				url = frappe.utils.escape_html(m.group(4))
				out.append(f'<a href="{url}">{url}</a>')
			pos = m.end()
		out.append(frappe.utils.escape_html(text[pos:]))
		return "".join(out)

	# A line of the form "{{code:482913}}" renders as a standalone bold
	# code line instead of an inline sentence — deliberately plain (no
	# card/background/icon) so it drops cleanly into any email client
	# without looking like a styling experiment.
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
	"""Simple, unstyled signature block with the APF logo embedded inline
	(via frappe.sendmail's inline_images — see _logo_inline_image) — not
	sent as a file attachment.

	Uses <img embed="..."> (frappe's own inline-image convention — see
	replace_filename_with_cid in frappe/email/email_body.py), not
	<img src="cid:...">: frappe.sendmail() only wires up an inline image
	when it finds an embed="filename" attribute matching an entry in
	inline_images, and rewrites it to src="cid:<random-id>" itself. A raw
	src="cid:..." (this app's own convention from the old hand-rolled MIME
	builder) is never touched by that mechanism, so the logo would silently
	not render if this weren't updated when the send path switched to
	frappe.sendmail().
	"""
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
	"""Drops any recipient that isn't shaped like an email address, logging
	each one — frappe.sendmail() validates every recipient itself and
	THROWS on the first invalid one (aborting the whole send, including any
	valid recipients on the same call), so a value like "L1 Moses" (a name
	typed into the approver_email field by mistake — a real, repeated
	occurrence in this app's data) must be caught here first rather than
	handed to frappe.sendmail() and left to fail loudly."""
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
	"""Drops any {"fid": ...} attachment whose File record's bytes aren't
	actually readable on disk, logging each one.

	frappe.sendmail(delayed=False/now=True) still resolves fid attachments
	asynchronously (see EmailQueue.include_attachments in
	frappe/email/doctype/email_queue/email_queue.py), which calls
	File.get_content() with no try/except of its own — a File record whose
	file_url doesn't correspond to an actual file on disk (seen repeatedly
	in this app's data, e.g. after a botched rename) would raise there
	INSIDE frappe's own send-after-commit handling, well outside this
	module's ability to catch it. Checking eagerly here, before handing off
	to frappe.sendmail(), keeps that failure a same-request, loggable,
	skip-this-one-attachment event instead of a delayed one Frappe itself
	has to surface.
	"""
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
	"""
	Shared sender for all Support IID notification/approval emails: builds
	minimal structured HTML from `lines`, embeds the APF logo inline in the
	signature, and attaches any extra files (e.g. the case summary PDF or
	supporting documents) passed in `attachments`.

	Sends via frappe.sendmail(now=True) — queued through Frappe's own Email
	Queue, sent right after the current transaction commits (not the
	scheduler's delayed queue, and not a hand-rolled raw SMTP session).
	Recipients that don't look like real email addresses and attachments
	whose file content isn't actually readable are filtered out first (see
	_filter_valid_recipients / _resolve_attachment_fids) — approver/
	requestor addresses on this app are typed freehand with no format
	enforcement at entry time, so a malformed one reaching frappe.sendmail()
	directly would raise and abort the whole send instead of just being
	skipped.
	"""
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


# ─────────────────────────────────────────────────────────────────────────────
# PDF constants (plain values — no reportlab at module level)
# ─────────────────────────────────────────────────────────────────────────────
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


# ═══════════════════════════════════════════════════════════════════════════════
#  PDF GENERATION  (all reportlab imports are inside this function — lazy)
# ═══════════════════════════════════════════════════════════════════════════════


def _build_case_pdf_bytes(doc_data: dict) -> bytes:
	"""
	Generate the APF offer-letter-style case summary PDF.
	All reportlab imports are local so the module can be loaded by Frappe
	even when reportlab is not installed (PDF just won't be generated).

	Returns raw PDF bytes.
	Raises ImportError with a clear message if reportlab is missing.
	"""
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
		"""
		Renders a section's fields as a plain label/value layout — no
		"Field | Details" header row and no table borders/zebra striping,
		just the label in bold beside its value, like a proper document
		rather than a spreadsheet dump.
		"""
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
		"""Renders a long free-text field as its own labelled paragraph
		rather than a table row \u2014 narrative content (verification notes,
		assessments, etc.) reads as prose, not squeezed table cells."""
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

	# Intro — this document is a case summary FOR REVIEW (addressed to the
	# approver/reviewer reading it), describing a request submitted on
	# behalf of the beneficiary named below. It is not a letter to the
	# beneficiary, so it's written in third person rather than "Dear
	# <beneficiary>, ...your request".
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


# ═══════════════════════════════════════════════════════════════════════════════
#  Requester role — auto-provisioned User + case-visibility scoping
#
#  Guests never log in to submit a case, so no User account exists for
#  requestor_email at all today. ensure_requester_user() creates one
#  (silently — no welcome email) on every case submission, tagged with the
#  Requester role, so that IF that person ever logs in, they see only their
#  own cases everywhere Case Register is queried — Desk list view, reports,
#  the dashboard, and the case registry page — via the permission query
#  condition below (frappe.get_all/get_list respect it automatically) and
#  has_permission (direct frappe.get_doc access, e.g. following a link).
#  Uses the module-level _EMAIL_SHAPE_RE defined above (near _looks_like_email).
# ═══════════════════════════════════════════════════════════════════════════════

def ensure_requester_user(email, full_name=None):
	"""
	Creates a User for `email` if one doesn't exist yet, and makes sure it
	has the Requester role either way (a pre-existing User — e.g. an
	internal staff member acting as a requestor on someone else's behalf —
	should not lose whatever roles they already have, so this only ADDS
	Requester, never removes anything).
	"""
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
					# Deliberately NOT setting default_workspace here.
					# frappe.website.utils.get_home_page() checks the
					# User's own default_workspace LAST and unconditionally
					# overrides everything else (Role.home_page, hooks,
					# Website Settings) if it's set at all — so leaving it
					# empty is what lets Requester role's native Home Page
					# field (set to "support-iid-dashboard" — see the
					# set_requester_home_page patch) actually take effect
					# for a freshly created Requester user.
				}
			).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Could not create Requester User for {email}")
			return

	try:
		user = frappe.get_doc("User", email)
		if "Requester" not in [r.role for r in user.get("roles") or []]:
			user.append("roles", {"role": "Requester"})
			user.flags.ignore_permissions = True
			user.save(ignore_permissions=True)
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Could not assign Requester role to {email}")


def _requester_only_scope_email(user=None):
	"""
	Returns the email to scope Case Register visibility to, if `user` should
	be restricted to only their own cases (has the Requester role and none
	of the broader-access roles) — None if no restriction should apply.
	"""
	user = user or frappe.session.user
	if user in ("Administrator", "Guest"):
		return None

	roles = set(frappe.get_roles(user))
	broad_access_roles = {"System Manager", "Reviewer", "Support IID Approver"}
	if roles & broad_access_roles:
		return None
	if "Requester" not in roles:
		return None

	return user


def _approver_only_scope_email(user=None):
	"""
	Returns the email to scope Case Register visibility to, if `user`
	should only see cases relevant to their own place in the approval
	chain — has the Support IID Approver role and none of the roles
	with broader, stage-independent access. None if no restriction
	should apply (System Manager, Reviewer, Administrator/Guest, or a
	user without the Approver role at all — Requester scoping is
	handled separately by _requester_only_scope_email).
	"""
	user = user or frappe.session.user
	if user in ("Administrator", "Guest"):
		return None

	roles = set(frappe.get_roles(user))
	if "System Manager" in roles or "Reviewer" in roles:
		return None
	if "Support IID Approver" not in roles:
		return None

	return user


# A Support IID Approver may only be assigned to ONE stage per case (the
# Approval Hierarchy / Graph manager-chain builder never repeats the same
# approver across levels of a single case), so "this case has a stage row
# for me" and "is that row either my current turn or already decided by
# me" together are enough to answer "am I relevant to this case at all" —
# there's no second row of mine elsewhere in the same case to also check.
#
# A stage is the approver's CURRENT turn only if every stage before it has
# already been decided (Approve) — i.e. it's the first stage in idx order
# that has no decision recorded yet. A blank/"Awaiting For Approval" row
# further down the chain hasn't been reached and must stay invisible to
# whoever's assigned there — that's the actual "not next-level approvers"
# requirement, since every level's row exists from the moment the case is
# submitted, blank rows included.
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


def get_permission_query_conditions(user=None, doctype=None):
	"""
	Restricts every list/report/dashboard query against Case Register:
	  - Requester-only users: rows where requestor_email matches them.
	  - Support IID Approver-only users: rows where they're the approver
	    for the current pending stage, or a stage they already acted on
	    (Approve/Decline/Send Back) — never a stage further down the
	    chain that hasn't been reached yet.
	Returns None (no extra condition) for System Manager, Reviewer, or
	Administrator/Guest, who all keep their existing (broader)
	visibility unchanged.

	Called by frappe.model.db_query as
	frappe.call(method, self.user, doctype=self.doctype) — user is
	positional, doctype is an accepted (here, unused) keyword.
	"""
	requester_scope_email = _requester_only_scope_email(user)
	if requester_scope_email:
		return "`tabCase Register`.`requestor_email` = {0}".format(frappe.db.escape(requester_scope_email))

	approver_scope_email = _approver_only_scope_email(user)
	if approver_scope_email:
		return _APPROVER_VISIBLE_CASE_CONDITION.format(approver_email=frappe.db.escape(approver_scope_email))

	return None


def has_permission(doc, ptype=None, user=None, debug=False):
	"""
	Blocks a Requester-only user from opening a specific Case Register they
	don't own directly, and blocks a Support IID Approver-only user from
	opening a case whose stage assigned to them hasn't been reached yet
	(e.g. by guessing/typing a URL) — the permission query condition
	above only filters LIST-style queries, not a direct
	frappe.get_doc/single-record fetch, so this closes that gap.

	Called by frappe.permissions.has_controller_permissions as
	frappe.call(method, doc=doc, ptype=ptype, user=user, debug=debug) — a
	controller has_permission hook can only DENY, never grant, so returning
	True here for every other role just means "no extra restriction from
	this hook", not "this role definitely has access" (the doctype's own
	role-based permissions still apply as normal).
	"""
	requester_scope_email = _requester_only_scope_email(user)
	if requester_scope_email:
		# A brand-new, not-yet-inserted doc (frappe.new_doc(), or the
		# permission probe Frappe's own upload_file/check_write_permission
		# runs to decide whether an attachment upload against a still-
		# unsaved form is allowed at all — see relink_mismatched_files)
		# has no requestor_email yet to match against, since it hasn't
		# been filled in. Denying here would block a Requester from ever
		# creating a case, or attaching a document before their first
		# save — the actual ownership check only makes sense once the
		# doc is real and its requestor_email is known.
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

	return True


# ═══════════════════════════════════════════════════════════════════════════════
#  CaseRegister Document class
# ═══════════════════════════════════════════════════════════════════════════════


_MOBILE_RE = re.compile(r"^(\+91[\-\s]?)?[6-9]\d{9}$")
_CURRENCY_RE = re.compile(r"^\d*\.?\d*$")
_CURRENCY_FIELDS = ("funds_requested", "amount_already_spent", "annual_family_income")
_MOBILE_FIELDS = ("mobile_number", "requestor_mobile_number", "primary_contact_mobile")
# Letters, spaces, and the punctuation an actual person's/place's name can
# contain (periods for initials, apostrophes, hyphens) — no digits, since
# a real name never contains one and a stray number here is almost always
# a data-entry mistake (a phone number pasted into the wrong field, etc).
_NAME_RE = re.compile(r"^[A-Za-z .'\-]+$")
_NAME_FIELDS = ("beneficiary_name", "requestor_name", "primary_contact_person")


class CaseRegister(Document):
	# ── Lifecycle ──────────────────────────────────────────────────────────────

	def validate(self):
		"""
		Mirrors the same checks support_iid_case_registration.js already
		enforces client-side (pincode format, DOB not in the future, email
		shape/domain, mobile number format, currency fields numeric-only,
		mandatory documents attached) — so a request can't bypass them by
		calling the API directly instead of using the web form. Only ever
		rejects a value that's actually PRESENT and malformed, exactly like
		the JS: none of these fields are made newly mandatory here (several
		are optional at the field level and used by other save paths —
		process_case_approval/close_case/submit_case_edit — that shouldn't
		start failing over data that predates this validation).
		"""
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
			# Currency fields land here already parsed to a number by
			# Frappe's own Currency fieldtype on any normal save path — this
			# guards a value that arrived as a raw string instead (e.g. a
			# direct API call bypassing the field's own coercion), the same
			# class of input the web form's JS checks against the DOM input
			# before Frappe's control reformats/rejects it.
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
		"""
		Called once when a Case Register is saved for the first time.

		Ensures a Requester-role User exists for requestor_email, so the
		requester CAN log in later and see only their own cases (see
		ensure_requester_user / get_permission_query_conditions below) —
		they never had to log in to submit the case in the first place. This
		happens regardless of case_status: the User account should exist as
		soon as the requestor's email is known, not only once they submit.

		A case now starts life with case_status "Draft" (the field's default —
		see case_register.json). Draft rows are just a saved-but-not-yet-sent
		record: the PDF/email/approver-notification workflow below is NOT
		fired here anymore. It only fires once the case is explicitly
		submitted via the submit_case whitelisted function (called from the
		Desk "Submit" button shown once a Draft case has been saved, or
		immediately for guest/web-form submissions, which insert a case that's
		never Draft in the first place).
		"""
		ensure_requester_user(self.requestor_email, self.requestor_name)

		if self.case_status == CASE_STATUS_DRAFT:
			return

		self._fire_submission_workflow()

	def on_update(self):
		"""
		Called on every save after the first (after_insert only fires
		once). A Draft case can be saved several times before it's ever
		submitted — e.g. the requestor attaches supporting documents after
		the initial Save — and each of those attachments is uploaded
		against the still-unsaved child row's own placeholder name, not
		Case Register's real name, so the File record has no
		attached_to_doctype/attached_to_name link yet (see
		_rename_supporting_documents). Re-run on every update (not just at
		submission) so a Draft case's attachments show up in the File
		list / "Linked With" against this case right away, instead of
		only once the case is actually submitted.
		"""
		if self.case_status == CASE_STATUS_DRAFT:
			self._rename_supporting_documents()

	def _fire_submission_workflow(self):
		"""
		Generates the case-summary PDF, renames supporting documents, and
		sends the first-approver + requestor-acknowledgement emails — the
		same side effects after_insert used to fire unconditionally for
		every new case, now shared between after_insert (non-Draft/web-form
		submissions) and submit_case (explicit Submit of a Draft case).
		"""
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
		"""
		Renames each uploaded supporting document — on disk and in the File
		doctype record — to "<Case ID> - <short description>.<ext>" (e.g.
		"SIID-0000001 - Bank statement.pdf"), so files are identifiable once
		downloaded outside the app instead of keeping their original upload
		filename.

		Renames the physical file directly (rather than re-saving the
		content through a new File doc) so Frappe's content-hash dedup in
		File.save_file() can't silently keep the old filename/URL when the
		bytes are unchanged.
		"""
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
					# The physical rename didn't happen (source missing —
					# e.g. remote/S3-backed storage where get_full_path()
					# doesn't correspond to a real local disk path, or a
					# destination collision) — keep file_name/file_url as
					# they are RATHER than writing the new display name
					# against the old (unmoved) file. Writing file_name
					# here while file_url still points at the original
					# physical file left DB and disk internally consistent
					# with each other but silently untouched by this rename
					# attempt — previously this branch still wrote the new
					# file_name, which is misleading (the File record then
					# claims a name that was never actually applied) even
					# though it wasn't itself the direct cause of a missing
					# file, since file_url — the field that actually
					# determines what gets read from disk — was correctly
					# left alone.
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
		"""
		Build the case-summary PDF, save it as a private Frappe File,
		and store the URL in case_document.
		Returns the file_url string, or None on failure.

		Idempotent: if a case-summary PDF is already attached to this case
		(e.g. after_insert ran twice from a duplicate request), reuse it
		instead of generating a second one. A short Redis lock closes the
		race window between two near-simultaneous calls.

		Pass force=True to regenerate even if a PDF already exists (e.g.
		after the requestor edits and resubmits a Sent-Back case).
		"""
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

		# Commit separately: the File/case_document writes above are already
		# done by this point, so an unrelated exception surfacing here (e.g.
		# a stale queued email referencing an old file) must not be reported
		# as a PDF-generation failure — it isn't one.
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
		"""
		Return the Frappe File docname for a given file_url, or None.

		Tries an exact file_url match first (the common case). If that
		finds nothing — e.g. _rename_supporting_documents() changed the
		File record's actual file_url/file_name (renaming to "<Case ID> -
		<document description>") but the child row's own "attachment"
		string wasn't updated to match, because the rename's filesystem
		step (os.rename on a local path) raised partway through on a
		storage backend where files don't live on local disk (e.g. S3 on
		some cloud hosts) — falls back to the exact filename
		_rename_supporting_documents() would have produced, scoped to
		files attached to this case. Without this, a stale/mismatched
		exact URL silently drops the attachment from outgoing emails with
		no error anywhere, since the caller just treats "file not found"
		as "no attachment for this row".
		"""
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
	):
		"""
		Email the approver at ``stage_idx`` a simple plain-text request:
		subject, "Dear <approver>," intro, a "Details:" list, and a link to
		review/approve/decline/send back.

		Attachments: the case-summary PDF, each supporting document as its
		own individual file, and the APF logo.
		"""
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

		# No format/domain check on approver_email — it's sent exactly as
		# typed, by design (see _send_plain_email's docstring). If SMTP
		# itself rejects it, that's caught below (around the actual send)
		# and logged rather than raised, so a bad address here can't crash
		# the whole request.

		req_name = (
			getattr(self, "requestor_name", None) or getattr(self, "requestor_email", None) or "requestor"
		)

		subject = f"Request Submitted - [{self.name}] - {req_name} - For {level_label} Approval"

		# Per-level web-form URL — carries an encrypted token (case + level +
		# approver) instead of plain query params, so the link itself proves
		# the holder is the intended approver for this stage.
		token = make_approval_token(self.name, stage_idx, approver_email)
		webform_url = f"{get_url()}/support-iid-case-approval/new?token={token}"

		# Same opaque-token treatment for the internal Desk link — the case
		# name never appears in the email; resolve_registry_link decrypts
		# it and redirects once the clicking user is confirmed to still
		# have permission to see that case. (Previously this pointed at
		# #<name> directly, which wasn't even the URL format the Case
		# Registry page's own hash router understands — #case-list/<name>
		# — so the link never actually opened the right case either.)
		registry_token = make_registry_link_token(self.name)
		registry_url = f"{get_url()}/api/method/support_iid.support_iid.doctype.case_register.case_register.resolve_registry_link?token={registry_token}"

		lines = self._build_approval_email_lines(
			approver_name=approver_name,
			level_label=level_label,
			webform_url=webform_url,
			registry_url=registry_url,
			previous_action=previous_action,
			previous_comments=previous_comments,
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

	def _send_requestor_notification_email(self, action, comments=None, approver_name=None, stage_idx=None):
		"""
		Plain-text notification to the requestor after Approve / Decline /
		Send Back. On Send Back, includes an edit-and-resubmit link (token +
		OTP protected) so the requestor can correct and resend the case to
		the same approval level that returned it.

		stage_idx must be the exact stage that just performed this action —
		passed in by the caller (which already knows it), rather than
		re-derived here by scanning for "the first stage with status Send
		Back": if an earlier stage also happened to carry that status from
		some prior action, that scan would silently grab the wrong stage
		and route the edit-and-resubmit link to the wrong approver.

		Gated by Support IID Settings.send_requestor_notification_emails
		(defaults to enabled) — a System Manager can turn these off app-wide.
		"""
		setting = frappe.db.get_single_value("Support IID Settings", "send_requestor_notification_emails")
		if setting is not None and not setting:
			return

		requestor_email = getattr(self, "requestor_email", None) or ""
		if not requestor_email:
			return

		requestor_name = getattr(self, "requestor_name", None) or "Team"
		beneficiary = getattr(self, "beneficiary_name", None) or ""

		action_line = None

		if action == "Approve":
			subject = f"Case Approved - [{self.name}] - {beneficiary}"
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
				"The reviewer has requested additional information or "
				"changes before this case can proceed. Please review the "
				"notes below, update the details, and resubmit at your "
				"earliest convenience."
			)
			if stage_idx is not None:
				# The requestor now has real Desk access (a User account
				# with the Requester role, created by ensure_requester_user
				# on every case regardless of Draft/submitted state) — so
				# this links straight to the actual Case Register record,
				# editable there directly (case_status Sent Back keeps the
				# form open for edits — see case_register.js), instead of
				# the guest web form's separate token + OTP edit flow.
				edit_url = f"{get_url()}/desk/case-register/{self.name}"
				action_line = f"[Edit and Resubmit]({edit_url})"

		lines = [
			f"Dear {requestor_name},",
			"",
			heading,
			f"**Case ID:** {self.name}",
			"",
			body_extra,
		]
		if comments:
			lines += ["", "**Reviewer notes:**", comments]
		if action_line:
			lines += ["", action_line]

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
		"""
		Plain-text acknowledgement to the requestor immediately after they
		submit a new case — confirms it was received and is pending L1
		approval, with the case summary PDF attached for their records.
		"""
		requestor_email = getattr(self, "requestor_email", None) or ""
		if not requestor_email:
			return

		requestor_name = getattr(self, "requestor_name", None) or "Team"
		beneficiary = getattr(self, "beneficiary_name", None) or ""

		stages = self.get("case_approval_stage") or []
		level_label = (stages[0].case_approval_level_decription if stages else None) or "Level 1"

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
			f"Your request is now pending **{level_label}** approval. You "
			f"will receive an email update as it moves through the review "
			f"process.",
			"",
			"A copy of the case summary is attached for your records.",
			"",
			f"[View this case]({case_url})",
			"",
			"If you no longer need this request, you may withdraw it at "
			"any time before a final decision is made:",
			f"[Withdraw this case]({withdraw_url})",
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

	# ── Requestor resubmit acknowledgement email  (sent after an edit-and-
	#    resubmit following Send Back) ──────────────────────────────────────

	def _send_requestor_resubmit_acknowledgement_email(self, level_label=None):
		"""
		Plain-text acknowledgement to the requestor confirming their edits
		were received and the case has been resubmitted for approval —
		every action on a case should have a matching confirmation back to
		the requestor, and until now a resubmit after Send Back only
		notified the approver, leaving the requestor with no confirmation
		their update actually went through.
		"""
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
			f"The revised support request for {beneficiary or 'the beneficiary'} "
			f"is now pending **{level_label or 'approval'}**. You will receive "
			f"an email update as it moves through the review process.",
			"",
			"If you no longer need this request, you may withdraw it at "
			"any time before a final decision is made:",
			f"[Withdraw this case]({withdraw_url})",
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
	):
		"""
		Builds the approval-request email body as a list of plain text
		lines (rendered as minimal structured HTML by _send_plain_email):

		    Dear <approver_name>,

		    This request is from <requestor> who is our point of contact from
		    <source> for Support IID requests whose <beneficiary> is undergoing
		    <ailment>...

		    Details:
		    Patient: …
		    Age: … Yrs
		    Address: …
		    Family: …
		    Occupation: …
		    Income: Rs … per month
		    House: …
		    Ailment: …
		    Hospital: …
		    Fund required as per hospital letter: INR …
		    Patient's condition - …
		    Folder - <url>
		"""

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

		# Build family summary line, e.g.
		# "Father (Patient), Mother, Son (Janardhan) and Daughter(Married)"
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
			# Only disambiguate with the name when there's more than one
			# family member — otherwise it just repeats the "Family:" line.
			occ_parts.append(f"{nm}: {occ}" if (nm and len(family_rows) > 1) else occ)
		occupation_line = "; ".join(occ_parts) if occ_parts else (fget("employment_status") or "-")

		hospital_display = f"{hospital}, {hosp_loc}" if hosp_loc else hospital

		funds_formatted = (
			(
				f"INR {int(funds_req):,} funds for "
				f"{'surgery' if is_medical else 'the request'} "
				f"(additional to existing insurance cover)"
			)
			if funds_req
			else "-"
		)

		intro_sentence = (
			f"This request is from {req_name} who is our point of contact "
			f"from {source} for Support IID requests whose {ben_name} is "
			f"undergoing {ailment}."
		)

		lines = [
			f"Dear {approver_name},",
			"",
			"A support request is awaiting your review as part of the Support IID approval process.",
			"",
			intro_sentence,
			"",
		]

		if previous_action:
			prev_line = f"Previous stage: {ACTION_LABEL.get(previous_action, previous_action)}"
			if previous_comments:
				prev_line += f" - {previous_comments}"
			lines += [prev_line, ""]

		lines.append("**Details:**")
		lines.append(f"**Patient:** {ben_name}")
		lines.append(f"**Age:** {age} Yrs" if age and age != "-" else "**Age:** -")
		lines.append(f"**Address:** {address}")
		lines.append(f"**Family:** {family_line}")
		lines.append(f"**Occupation:** {occupation_line}")
		lines.append(f"**Income:** Rs {monthly_inc:,} per month" if monthly_inc else "**Income:** -")
		lines.append(f"**House:** {residence}")
		lines.append(f"**Ailment:** {ailment}" + (f", Treatment: {treatment}" if treatment else ""))
		lines.append(f"**Hospital:** {hospital_display}")
		lines.append(f"**Fund required as per hospital letter:** {funds_formatted}")
		lines.append(f"**Patient's condition:** {condition}")
		lines.append("")
		lines.append(
			"The full case summary PDF and all supporting documents are attached for your reference."
		)
		lines.append("Please review the request and record your decision using the link below:")
		lines.append("")
		lines.append(f"[Review & Approve / Decline / Send Back]({webform_url})")
		lines.append(f"[View in Case Registry]({registry_url})")

		return lines


# ═══════════════════════════════════════════════════════════════════════════════
#  WHITELISTED API — shared by web form, case-registry UI, dashboard popup
# ═══════════════════════════════════════════════════════════════════════════════


@frappe.whitelist(allow_guest=True)
def process_case_approval(
	case_name=None, action=None, comments=None, token=None, otp=None, verify_ticket=None, payload=None
):
	"""
	Process one approval action on the currently-pending stage.
	Shared by the web form (guest, token + OTP authenticated), the
	case-registry desk page, and the dashboard popup (both session-authenticated).

	Args:
	    case_name (str): Case Register name, e.g. "SIID-0000001"
	    action    (str): "Approve" | "Decline" | "Send Back"
	    comments  (str): Optional reviewer notes
	    token     (str): Encrypted approval token (from the emailed link) —
	                      required for guest/unauthenticated callers, proves
	                      the caller is the intended approver for the stage.
	    otp       (str): 6-digit one-time code sent via send_approval_otp to
	                      the token-bound approver_email — required alongside
	                      the token for guest callers, unless verify_ticket
	                      is supplied instead (see below).
	    verify_ticket (str): Ticket returned by verify_approval_otp after an
	                      earlier explicit "Verify" step already checked the
	                      OTP — an alternative to passing otp here directly.
	    payload   (str): Optional encrypted JSON blob containing
	                      case_name/action/comments/token/otp — when supplied,
	                      it is decrypted first and its fields fill in any
	                      of the plain args above that were left empty.

	Returns:
	    dict (encrypted if the request itself was encrypted):
	        case_status         — updated status string
	        case_approval_stage — list of stage dicts
	        case_approval_log   — list of log dicts

	Side-effects (emails triggered automatically):
	    Approve + more stages remain  → approval-request email to next approver
	    Approve + last stage          → notification email to requestor (approved)
	    Decline                       → notification email to requestor (declined)
	    Send Back                     → notification email to requestor (revision)
	"""
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

	# Guests must additionally prove they hold the OTP just sent to the
	# token-bound approver_email — the token alone only proves they once
	# received the emailed link. A verify_ticket from an earlier explicit
	# Verify step satisfies this in place of the raw otp.
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

	# Permission check — either a valid token for this exact case/stage/approver
	# (guest, emailed-link flow) or a logged-in session matching the approver
	# (or an admin/System Manager, e.g. from the desk UI).
	#
	# Holding the Support IID Approver role on its own is NOT enough —
	# that role is shared by every approver across every level and case,
	# so it can't be used to tell whether THIS user is the one actually
	# assigned to THIS case's current stage. Only an exact match on
	# approver_email (or Administrator/System Manager, as a genuine
	# override) is accepted.
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
		# Unlike Approve/Decline, the level matters here — it's the stage
		# that sent the case back, useful context when the requestor is
		# deciding what to fix before resubmitting.
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
			)

		else:
			# All stages approved — final approval
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

	result = {
		"case_status": doc.case_status,
		"current_approval_level": doc.current_approval_level,
		"case_approval_stage": [s.as_dict() for s in doc.case_approval_stage],
		"case_approval_log": [r.as_dict() for r in doc.case_approval_log],
	}

	return encrypt_response(result)


@frappe.whitelist(allow_guest=True)
def resolve_withdraw_token(token):
	"""
	Guest-safe lookup used by the (unauthenticated) withdraw web form:
	decrypts the emailed token and returns just enough display info to
	pre-fill the form — without exposing any other case data or
	requiring a Frappe login.
	"""
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
	"""
	Shared by withdraw_case (guest, token + OTP authenticated) and
	withdraw_case_from_desk (logged-in Requester, session authenticated)
	— actually applies the withdrawal once the caller has already
	established who's asking and that they're allowed to. Only callable
	while the case is still in progress (Pending Approval or Sent Back);
	a case that's already Approved, Rejected, Closed, or already
	Withdrawn can't be withdrawn a second time or reversed through
	either entry point.
	"""
	if doc.case_status not in (CASE_STATUS_PENDING, CASE_STATUS_SENT_BACK):
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
	"""
	Withdraws a case at the requestor's own request — guest, token + OTP
	authenticated exactly like submit_case_edit. See _do_withdraw_case
	for the shared status/logging/email logic.

	A reason is required — this is a definite, user-facing action with
	real consequences (approvers get notified the case is off the
	table), not something to allow silently.
	"""
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
	"""
	Withdraws a case from the Desk Case Register form for a Requester
	who's already logged in — no emailed OTP needed, since an active
	Desk session already proves who they are (unlike the guest
	withdraw_case flow above, which has no login to rely on and treats
	holding the emailed link as, at most, weak proof of identity).

	Only the case's own requestor (matched by session user's email) or
	an Administrator/System Manager may call this — mirrors the
	ownership check has_permission() already applies to viewing the
	case at all, so nobody else's Desk session can withdraw a case that
	isn't theirs.
	"""
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
	"""
	Emails every user holding the Reviewer role — the people who handle
	documentation/disbursement on approved cases — that this case has
	been withdrawn and is off the table. Not tied to any specific
	approval stage's approver_email, since Reviewer is a separate,
	app-wide role (potentially several people, assigned via Desk > User
	> Roles) rather than a per-case assignment.
	"""
	reviewer_emails = frappe.get_all(
		"Has Role",
		filters={"role": "Reviewer", "parenttype": "User"},
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
				"Dear Reviewer,",
				"",
				f"This is to inform you that case {doc.name} has been withdrawn by the requestor.",
				"",
				f"**Beneficiary:** {doc.beneficiary_name or '-'}",
				f"**Requestor:** {doc.requestor_name or '-'} ({doc.requestor_email or '-'})",
				f"**Reason given:** {reason}",
				"",
				"No further action is needed on this case.",
			],
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Reviewer withdrawal notification failed — {doc.name}")


@frappe.whitelist()
def submit_case(case_name):
	"""
	Moves a Draft Case Register out of Draft: runs the doctype's own
	validation (via doc.save(), same checks as a normal Desk save), sets
	case_status to "Pending Approval", and fires the same PDF/approver-email/
	requestor-acknowledgement workflow after_insert used to fire immediately
	on creation. Called from the Desk "Submit" button shown once a Draft
	case has been saved (see case_register.js) — this is a lightweight,
	status-only transition, NOT Frappe's docstatus Submit; docstatus stays 0.

	Only callable on a case whose current status is actually Draft — this
	is a one-way transition out of Draft, not something that can be re-run
	against an already-submitted case.
	"""
	doc = frappe.get_doc("Case Register", case_name)
	if doc.case_status != CASE_STATUS_DRAFT:
		frappe.throw("Only a Draft case can be submitted.")

	doc.save()
	doc._fire_submission_workflow()
	frappe.db.commit()
	return {"case_status": doc.case_status, "current_approval_level": doc.current_approval_level}


@frappe.whitelist()
def close_case(
	case_name, approved_amount=None, utr_details=None, milaap_recommendation=None, milaap_campaign_link=None
):
	"""
	Marks an Approved case as Closed, recording the fund-transfer details
	a Reviewer confirms at closure time. Only callable on a case whose
	current status is Approved — closing is the final step after the
	money has actually gone out, not a status any case can jump to.

	date_of_transfer is not an input — it's always set to today, the date
	the case is actually closed, not something the Reviewer types in.
	approved_amount is required; the other fields are optional.

	Permission: Administrator, System Manager, or a user with the
	Reviewer role. (Same pattern as the Approver-role check in
	process_case_approval — checked here rather than left to the
	doctype's own permission model, since this endpoint's whole point is
	to let Reviewer act without needing direct write access.)
	"""
	user = frappe.session.user
	if not (
		user == "Administrator"
		or "System Manager" in frappe.get_roles(user)
		or "Reviewer" in frappe.get_roles(user)
	):
		frappe.throw("You don't have permission to close cases.", frappe.PermissionError)

	doc = frappe.get_doc("Case Register", case_name)
	if doc.case_status != CASE_STATUS_APPROVED:
		frappe.throw("Only an Approved case can be closed.")

	if approved_amount is None or approved_amount == "":
		frappe.throw("Approved Amount is required to close a case.")

	# Date of Transfer is the date the case was actually closed, not a
	# value the Reviewer types in — always today, regardless of what (if
	# anything) was passed in.
	doc.date_of_transfer = today()
	doc.approved_amount = approved_amount
	if utr_details:
		doc.utr_details = utr_details
	if milaap_recommendation:
		doc.milaap_recommendation = milaap_recommendation
	if milaap_campaign_link:
		doc.milaap_campaign_link = milaap_campaign_link

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
		}
	)


@frappe.whitelist()
def get_approval_stages_for_case(case_name):
	"""
	Returns the current approval stages + log for a case.
	Called by: web form, case-registry UI page, dashboard popup.

	Returns:
	    dict:
	        case_status (str)
	        stages (list of dicts): idx, level, approver_name,
	                                approver_email, status
	        logs   (list of dicts): date, level, approver_name,
	                                action, comments
	"""
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
	"""
	Guest-safe lookup used by the (unauthenticated) approval web form:
	decrypts the emailed token and returns just enough display info
	(case name, level, approver name/email) to pre-fill the form —
	without exposing any other case data or requiring a Frappe login.
	"""
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


# ─────────────────────────────────────────────────────────────────────────────
# Send-Back "edit and resubmit" flow — guest, token + OTP authenticated
# (same pattern as the approval flow). The requestor edits the same
# registration web form, prefilled with their existing case data, and on
# resubmit the SAME approval level that sent it back is re-notified.
# ─────────────────────────────────────────────────────────────────────────────


@frappe.whitelist(allow_guest=True)
def resolve_case_for_edit(token):
	"""
	Guest-safe lookup for the Send-Back edit link: decrypts the token and
	returns the case's current field values so the registration web form
	can pre-fill itself for editing.
	"""
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
	"""
	Returns (stage, stage_idx) for the Case Approval Stage row currently
	sitting in "Send Back" status, or (None, None) if there isn't one —
	shared by submit_case_edit and resubmit_case_from_desk, both of
	which only make sense to run against that exact stage.
	"""
	stages = doc.get("case_approval_stage") or []
	for idx, stage in enumerate(stages):
		if (stage.case_approval_status or "").strip() == "Send Back":
			return stage, idx
	return None, None


def _resubmit_after_send_back(doc, stage_idx, previous_action):
	"""
	Shared by submit_case_edit (guest, token + OTP authenticated) and
	resubmit_case_from_desk (logged-in Requester, session authenticated)
	— resets the stage that sent the case back to "Awaiting For
	Approval" and re-sends the approval-request email to that same
	(or, if the org's Approval Hierarchy has since changed, newly
	current) approver. Assumes the caller already applied whatever
	field edits it wanted and has NOT yet saved — this does the save.
	"""
	stages = doc.get("case_approval_stage") or []

	# Re-fetch the current reviewer for this level from Approval Hierarchy —
	# the org's approvers can change after a case was first submitted, and a
	# resubmit after Send Back should go to whoever is presently configured
	# for that level, not whoever it was when the case was originally filed.
	# Falls back to the case's existing approver if no hierarchy match is found.
	try:
		from support_iid.api.microsoft_graph import get_current_approver_for_level

		level_name = stages[stage_idx].case_approval_level_decription
		current_approver = get_current_approver_for_level(doc.requestor_email, level_name)
		if current_approver and current_approver.get("approver_email"):
			stages[stage_idx].approver_name = current_approver["approver_name"]
			stages[stage_idx].approver_email = current_approver["approver_email"]
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Reviewer refresh failed on resubmit — {doc.name}")

	stages[stage_idx].case_approval_status = "Awaiting For Approval"
	doc.case_status = CASE_STATUS_PENDING
	doc.current_approval_level = stages[stage_idx].case_approval_level_decription or f"Level {stage_idx + 1}"
	doc.save(ignore_permissions=True)
	_safe_commit(doc.name)

	# Any documents re-uploaded/replaced as part of this edit still have
	# their original upload filenames at this point — rename them the same
	# way after_insert does for the initial submission.
	doc._rename_supporting_documents()

	pdf_path = doc._generate_and_save_pdf(force=True)

	doc._send_approval_request_email(
		stage_idx=stage_idx,
		case_pdf_path=pdf_path,
		include_supporting_docs=True,
		previous_action=previous_action,
	)
	doc._send_requestor_resubmit_acknowledgement_email(level_label=doc.current_approval_level)


@frappe.whitelist(allow_guest=True)
def submit_case_edit(token, data, otp=None, verify_ticket=None):
	"""
	Applies the requestor's edits to the case (token + OTP verified,
	either directly via otp or via a verify_ticket from an earlier
	explicit Verify step). See _resubmit_after_send_back for the shared
	stage-reset/PDF/email logic.
	"""
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
def resubmit_case_from_desk(case_name):
	"""
	Resubmits a Sent-Back case straight from the Desk Case Register
	form — the requestor edits fields directly on the (already
	editable-while-Sent-Back) form, saves normally, then clicks
	Resubmit. No token/OTP: an active Desk session already proves who
	they are, unlike the guest submit_case_edit flow above, which has
	no login to rely on.

	Only the case's own requestor (matched by session user's email) or
	an Administrator/System Manager may call this.
	"""
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

	_resubmit_after_send_back(doc, stage_idx, previous_action="Send Back (revised & resubmitted)")

	return {"case_status": doc.case_status, "current_approval_level": doc.current_approval_level}


@frappe.whitelist()
def resolve_registry_link(token):
	"""
	Landing point for the "View in Case Registry" link sent to approvers
	— the case name never appears in the email itself (make_registry_link_token
	encrypts it into an opaque token instead), and this decrypts it,
	confirms the CLICKING user (their real Desk session — this isn't a
	guest/token-only flow like the approval/edit/withdraw links) still has
	permission to see that case, then redirects into the Case Registry at
	the right one. GET-navigable (a plain email link), not a JSON API call.
	"""
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
	frappe.local.response["location"] = f"/desk/case-registry#case-list/{case_name}"

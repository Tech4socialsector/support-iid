frappe.ready(function () {

    /* =========================================================
       AES-GCM DECRYPTION — every server response carrying real case
       data (name, beneficiary, approver contacts, ...) comes back as
       {encrypted, iv, data} instead of plain JSON, so it isn't sitting
       in cleartext in the browser's Network tab. Same key/shape as
       support_iid_case_registration.js's decryptPayload — must match
       encrypt_response() in case_register.py.
    ========================================================= */

    var AES_KEY_B64 = "sY/J1pzdls6Bh5U8mjk4KicUak1r+9enaaVzIXlIqes=";

    function base64ToBytes(b64) {
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function decryptResponse(payload) {
        if (!payload || !payload.encrypted) {
            return Promise.resolve(payload);
        }
        return crypto.subtle.importKey(
            "raw", base64ToBytes(AES_KEY_B64), { name: "AES-GCM" }, false, ["decrypt"]
        ).then(function (key) {
            return crypto.subtle.decrypt(
                { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
                key,
                base64ToBytes(payload.data)
            );
        }).then(function (decrypted) {
            return JSON.parse(new TextDecoder().decode(decrypted));
        });
    }

    /* =========================================================
       1. Read the encrypted approval token from the URL and
          resolve it (guest-safe) to pre-fill case/approver info.
          The token — not case_id/approver_email in plain query
          params — is what proves the caller received the emailed
          link; the OTP step below proves they can access that
          inbox right now.
    ========================================================= */

    var params = new URLSearchParams(window.location.search);
    var token = params.get('token') || '';
    var verify_ticket = '';
    var stageAlreadyDecided = false;

    if (token) {
        frappe.web_form.set_value('case_id', '');
        frappe.web_form.set_df_property('case_id', 'read_only', 1);
        resolveToken(token);
        lockUntilVerified();
        addOtpControls();
    }

    /* =========================================================
       2. Comments — hidden unless Decline or Send Back
    ========================================================= */

    frappe.web_form.set_df_property('comments', 'hidden', 1);
    frappe.web_form.set_df_property('comments', 'reqd', 0);

    frappe.web_form.on('action', function (field, value) {
        var needsComment = (value === 'Decline' || value === 'Send Back');
        frappe.web_form.set_df_property('comments', 'hidden', needsComment ? 0 : 1);
        frappe.web_form.set_df_property('comments', 'reqd',   needsComment ? 1 : 0);
    });

    /* =========================================================
       3. Resolve the token to display case/approver details
    ========================================================= */

    function resolveToken(tok) {
        frappe.call({
            method: 'support_iid.support_iid.doctype.case_register.case_register.resolve_approval_token',
            args: { token: tok },
            callback: function (r) {
                if (!r.message) return;
                decryptResponse(r.message).then(function (data) {
                    frappe.web_form.set_value('case_id', data.case_name || '');
                    frappe.web_form.set_value('approver_name', data.approver_name || '');
                    frappe.web_form.set_value('approver_name_email', data.approver_email || '');
                    frappe.web_form.set_df_property('approver_name', 'read_only', 1);
                    frappe.web_form.set_df_property('approver_name_email', 'read_only', 1);

                    // The stage may have already been decided (e.g. someone
                    // reopens an old email link after the case moved on) —
                    // in that case Approve/Decline/Send Back no longer make
                    // sense, so show the current status instead of ever
                    // revealing the action options, even after OTP verify.
                    var status = (data.status || '').trim();
                    if (status && status !== 'Awaiting For Approval') {
                        stageAlreadyDecided = true;
                        showAlreadyDecidedNotice(status);
                    }
                }).catch(function () {
                    frappe.msgprint('This approval link is invalid or has expired.');
                });
            },
            error: function () {
                frappe.msgprint('This approval link is invalid or has expired.');
            }
        });
    }

    function showAlreadyDecidedNotice(status) {
        var $actionWrapper = frappe.web_form.get_field
            ? frappe.web_form.get_field('action').$wrapper
            : $('[data-fieldname="action"]');
        var $notice = $(
            '<div id="siid-already-decided-notice" style="background:#eef6ff;' +
            'border:1px solid #b7d4f5;border-radius:8px;padding:12px 16px;margin-top:10px">' +
            '<b>This case has already been actioned.</b><br>' +
            '<span style="color:#4a5a68">Current status: ' + frappe.utils.escape_html(status) + '. ' +
            'No further action is needed on this link.</span>' +
            '</div>'
        );
        $actionWrapper.before($notice);
    }

    /* =========================================================
       4. OTP flow — Send Code, then an explicit Verify step.
          Progressive reveal: the Verification Code field is
          hidden until "Send Verification Code" is clicked; the
          Action field is hidden until the code is verified.
    ========================================================= */

    function refreshSaveVisibility() {
        var $submitBtn = $('.web-form .submit-btn, .web-form-footer .submit-btn');
        if (verify_ticket && !stageAlreadyDecided) {
            $submitBtn.show();
        } else {
            $submitBtn.hide();
        }
    }

    function lockUntilVerified() {
        frappe.web_form.set_df_property('otp', 'hidden', 1);
        frappe.web_form.set_df_property('otp', 'read_only', 1);
        frappe.web_form.set_df_property('action', 'hidden', 1);
        frappe.web_form.set_df_property('action', 'read_only', 1);
        refreshSaveVisibility();
    }

    function unlockAfterVerified() {
        if (stageAlreadyDecided) {
            // Verified successfully, but the stage was already actioned —
            // the action field stays hidden; showAlreadyDecidedNotice()
            // already told the user why, so there's nothing left to submit.
            refreshSaveVisibility();
            return;
        }
        frappe.web_form.set_df_property('action', 'hidden', 0);
        frappe.web_form.set_df_property('action', 'read_only', 0);
        refreshSaveVisibility();
    }

    function addOtpControls() {
        // The "Send Verification Code" button must stay visible even while
        // the otp field itself is hidden (it's what reveals the field in
        // the first place), so it lives in its own sibling row placed
        // BEFORE the field. The Verify button only matters once the field
        // is already visible, so it goes in a separate sibling row placed
        // AFTER the field — reading top to bottom as Send → field → Verify,
        // not stacked above the field it verifies.
        var $otpWrapper = frappe.web_form.get_field
            ? frappe.web_form.get_field('otp').$wrapper
            : $('[data-fieldname="otp"]');

        var $sendRow = $(
            '<div id="siid-otp-send-row" style="margin-top:6px">' +
            '<button type="button" class="btn btn-sm btn-default" id="siid-send-otp">' +
            'Send Verification Code</button>' +
            '<div style="font-size:12px;color:#8d99a6;margin-top:4px">' +
            'Click to receive a verification code by email, then enter it below and click Verify.' +
            '</div>' +
            '</div>'
        );
        var $verifyRow = $(
            '<div id="siid-otp-verify-row" style="margin-top:6px">' +
            '<button type="button" class="btn btn-sm btn-primary" id="siid-verify-otp" ' +
            'style="display:none">Verify</button>' +
            '<span id="siid-otp-verified-note" style="margin-left:10px;color:#2f9e5b;font-weight:600;display:none">' +
            '&#10003; Verified</span>' +
            '</div>'
        );

        var $sendBtn = $sendRow.find('#siid-send-otp');
        var $verifyBtn = $verifyRow.find('#siid-verify-otp');
        var $verifiedNote = $verifyRow.find('#siid-otp-verified-note');

        $otpWrapper.before($sendRow);
        $otpWrapper.after($verifyRow);

        $sendBtn.on('click', function () {
            $sendBtn.prop('disabled', true).text('Sending...');
            frappe.call({
                method: 'support_iid.support_iid.doctype.case_register.case_register.send_approval_otp',
                args: { token: token },
                callback: function (r) {
                    if (r.message && r.message.sent) {
                        frappe.web_form.set_df_property('otp', 'hidden', 0);
                        frappe.web_form.set_df_property('otp', 'read_only', 0);
                        $verifyBtn.show();
                        frappe.show_alert({
                            message: 'A verification code has been sent to the approver email on file.',
                            indicator: 'green'
                        }, 6);
                        $sendBtn.text('Resend Code');
                    }
                },
                error: function () {
                    frappe.msgprint('Could not send the verification code. Please try again.');
                    $sendBtn.text('Send Verification Code');
                },
                always: function () {
                    $sendBtn.prop('disabled', false);
                }
            });
        });

        $verifyBtn.on('click', function () {
            var otp = frappe.web_form.get_value('otp') || '';
            if (!otp) {
                frappe.msgprint('Please enter the verification code sent to your email.');
                return;
            }
            $verifyBtn.prop('disabled', true).text('Verifying...');
            frappe.call({
                method: 'support_iid.support_iid.doctype.case_register.case_register.verify_approval_otp',
                args: { token: token, otp: otp },
                callback: function (r) {
                    if (r.message && r.message.verify_ticket) {
                        verify_ticket = r.message.verify_ticket;
                        frappe.web_form.set_df_property('otp', 'hidden', 1);
                        frappe.web_form.set_df_property('otp', 'read_only', 1);
                        $sendBtn.hide();
                        $verifyBtn.hide();
                        $verifiedNote.show();
                        unlockAfterVerified();
                        frappe.show_alert({ message: 'Verified. You may now record your decision.', indicator: 'green' }, 5);
                    }
                },
                error: function () {
                    frappe.msgprint('Invalid or expired code. Please request a new one and try again.');
                    verify_ticket = '';
                },
                always: function () {
                    $verifyBtn.prop('disabled', false).text('Verify');
                }
            });
        });
    }

    /* =========================================================
       5. After form save — call the shared process_case_approval
          API (same one used by the case registry and dashboard)
          to update: approval stage status + log + case_status.
          The token + verify_ticket are passed through so the
          server can confirm identity without requiring a login
          or re-checking the OTP a second time.
    ========================================================= */

    /* =========================================================
       6. TITLE + LOGO SWAP — same treatment as the registration
          form, so approvers see one consistent branded design
          across every Support IID web form.
    ========================================================= */

    var titleTries = 0;
    var titleTimer = setInterval(function () {
        var titleEl = document.querySelector('.title');
        titleTries++;
        if (titleEl) {
            clearInterval(titleTimer);
            titleEl.classList.remove('ellipsis');
            titleEl.style.whiteSpace = 'normal';
            titleEl.style.overflow = 'visible';
            titleEl.innerHTML = '<div style="display:flex;justify-content:space-between;'
                + 'align-items:flex-start;flex-wrap:wrap;gap:10px;width:100%;">'
                + '<h5 style="margin-top:24px">'
                + 'Support IID Case Approval - Azim Premji Foundation'
                + '</h5>'
                + '<img src="/files/APF%20logo.png" style="height:70px;flex-shrink:0">'
                + '</div>';
        } else if (titleTries > 20) {
            clearInterval(titleTimer);
        }
    }, 100);

    frappe.web_form.after_save = function () {
        var action   = frappe.web_form.get_value('action') || '';
        var comments = frappe.web_form.get_value('comments') || '';

        if (!token || !action) return;

        if (!verify_ticket) {
            frappe.msgprint('Please verify your email with the code sent to you before submitting.');
            return;
        }

        frappe.call({
            method: 'support_iid.support_iid.doctype.case_register.case_register.process_case_approval',
            args: {
                token:         token,
                verify_ticket: verify_ticket,
                action:        action,
                comments:      comments
            },
            callback: function (r) {
                if (!r.message) return;
                decryptResponse(r.message).then(function (data) {
                    if (data && data.case_status) {
                        // The stored value stays "Sent Back" everywhere it's
                        // used as data (filters, comparisons) — only the
                        // text actually shown to a user gets the friendlier
                        // "Pending with Requester" wording.
                        var displayStatus = data.case_status === 'Sent Back' ? 'Pending with Requester' : data.case_status;
                        var statusText = data.case_status === 'Pending Approval' && data.current_approval_level
                            ? displayStatus + ' (' + data.current_approval_level + ')'
                            : displayStatus;
                        frappe.show_alert({
                            message: 'Case updated to: ' + statusText,
                            indicator: 'green'
                        }, 5);
                    }
                });
            },
            error: function (err) {
                console.error('process_case_approval failed:', err);
                frappe.show_alert({
                    message: 'Action saved but case status update failed. Please contact support.',
                    indicator: 'orange'
                }, 8);
            }
        });
    };

});

frappe.ready(function () {

    /* =========================================================
       AES-GCM DECRYPTION — same key/shape as the registration and
       approval web forms' decrypt helpers; must match encrypt_response()
       in case_register.py.
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
       1. Read the encrypted withdraw token from the URL and
          resolve it (guest-safe) to pre-fill case info. The token —
          not case_id in a plain query param — is what proves the
          caller received the emailed link; the OTP step below proves
          they can access that inbox right now.
    ========================================================= */

    var params = new URLSearchParams(window.location.search);
    var token = params.get('token') || '';
    var verify_ticket = '';
    var alreadyDecided = false;

    if (token) {
        lockUntilVerified();
        addOtpControls();
        resolveToken(token);
    } else {
        $('.web-form-body').hide();
        $('.web-form-footer').hide();
        $('<div style="padding:24px;text-align:center;color:#8d99a6">This withdraw link is invalid or has expired.</div>').insertBefore('.web-form-body');
    }

    function resolveToken(tok) {
        frappe.call({
            method: 'support_iid.support_iid.doctype.case_register.case_register.resolve_withdraw_token',
            args: { token: tok },
            callback: function (r) {
                if (!r.message) return;
                decryptResponse(r.message).then(function (data) {
                    frappe.web_form.set_value('case_id', data.case_name || '');
                    frappe.web_form.set_value('beneficiary_name', data.beneficiary_name || '');

                    var status = (data.case_status || '').trim();
                    if (status && status !== 'Pending Approval' && status !== 'Sent Back') {
                        alreadyDecided = true;
                        showAlreadyDecidedNotice(status === 'Sent Back' ? 'Pending with Requester' : status);
                        refreshSaveVisibility();
                    }
                }).catch(function () {
                    frappe.msgprint('This withdraw link is invalid or has expired.');
                });
            },
            error: function () {
                frappe.msgprint('This withdraw link is invalid or has expired.');
            }
        });
    }

    function showAlreadyDecidedNotice(status) {
        var $reasonWrapper = frappe.web_form.get_field
            ? frappe.web_form.get_field('reason').$wrapper
            : $('[data-fieldname="reason"]');
        var $notice = $(
            '<div id="siid-withdraw-decided-notice" style="background:#eef6ff;' +
            'border:1px solid #b7d4f5;border-radius:8px;padding:12px 16px;margin-bottom:14px">' +
            '<b>This case can no longer be withdrawn.</b><br>' +
            '<span style="color:#4a5a68">Current status: ' + frappe.utils.escape_html(status) + '.</span>' +
            '</div>'
        );
        $reasonWrapper.before($notice);
        frappe.web_form.set_df_property('reason', 'hidden', 1);
    }

    /* =========================================================
       2. OTP flow — Send Code, then an explicit Verify step.
          Progressive reveal: the Verification Code field is hidden
          until "Send Verification Code" is clicked; the Reason field
          + Withdraw button stay hidden until the code is verified.
    ========================================================= */

    function refreshSaveVisibility() {
        var $submitBtn = $('.web-form .submit-btn, .web-form-footer .submit-btn');
        if (verify_ticket && !alreadyDecided) {
            $submitBtn.show();
        } else {
            $submitBtn.hide();
        }
    }

    function lockUntilVerified() {
        frappe.web_form.set_df_property('otp', 'hidden', 1);
        frappe.web_form.set_df_property('otp', 'read_only', 1);
        frappe.web_form.set_df_property('reason', 'hidden', 1);
        refreshSaveVisibility();
    }

    function unlockAfterVerified() {
        if (alreadyDecided) {
            refreshSaveVisibility();
            return;
        }
        frappe.web_form.set_df_property('reason', 'hidden', 0);
        refreshSaveVisibility();
    }

    function addOtpControls() {
        var $otpWrapper = frappe.web_form.get_field
            ? frappe.web_form.get_field('otp').$wrapper
            : $('[data-fieldname="otp"]');

        var $sendRow = $(
            '<div id="siid-withdraw-otp-send-row" style="margin-top:6px">' +
            '<button type="button" class="btn btn-sm btn-default" id="siid-withdraw-send-otp">' +
            'Send Verification Code</button>' +
            '<div style="font-size:12px;color:#8d99a6;margin-top:4px">' +
            'Click to receive a verification code by email, then enter it below and click Verify.' +
            '</div>' +
            '</div>'
        );
        var $verifyRow = $(
            '<div id="siid-withdraw-otp-verify-row" style="margin-top:6px">' +
            '<button type="button" class="btn btn-sm btn-primary" id="siid-withdraw-verify-otp" ' +
            'style="display:none">Verify</button>' +
            '<span id="siid-withdraw-otp-verified-note" style="margin-left:10px;color:#2f9e5b;font-weight:600;display:none">' +
            '&#10003; Verified</span>' +
            '</div>'
        );

        var $sendBtn = $sendRow.find('#siid-withdraw-send-otp');
        var $verifyBtn = $verifyRow.find('#siid-withdraw-verify-otp');
        var $verifiedNote = $verifyRow.find('#siid-withdraw-otp-verified-note');

        $otpWrapper.before($sendRow);
        $otpWrapper.after($verifyRow);

        $sendBtn.on('click', function () {
            $sendBtn.prop('disabled', true).text('Sending...');
            frappe.call({
                method: 'support_iid.support_iid.doctype.case_register.case_register.send_withdraw_otp',
                args: { token: token },
                callback: function (r) {
                    if (r.message && r.message.sent) {
                        frappe.web_form.set_df_property('otp', 'hidden', 0);
                        frappe.web_form.set_df_property('otp', 'read_only', 0);
                        $verifyBtn.show();
                        frappe.show_alert({
                            message: 'A verification code has been sent to your email.',
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
                method: 'support_iid.support_iid.doctype.case_register.case_register.verify_withdraw_otp',
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
                        frappe.show_alert({ message: 'Verified. You may now submit your withdrawal.', indicator: 'green' }, 5);
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
       3. After form save — call withdraw_case with the reason,
          token, and verify_ticket. Replaces the page content with a
          plain success state instead of reloading (reloading the
          same URL after this point would re-run the whole flow on a
          token that's no longer valid for withdrawal — the case has
          already moved on).
    ========================================================= */

    function showWithdrawSuccess() {
        $('.web-form-body').remove();
        $('.web-form-footer').remove();
        $('#siid-withdraw-decided-notice').remove();
        var $success = $(
            '<div style="text-align:center;padding:48px 20px">' +
            '<div style="font-size:40px;color:#2f9e5b;margin-bottom:12px">&#10003;</div>' +
            '<div style="font-size:18px;font-weight:600;color:#1a1a1a;margin-bottom:6px">Your case has been withdrawn.</div>' +
            '<div style="font-size:13px;color:#8d99a6">No further action will be taken on this case.</div>' +
            '</div>'
        );
        $('.web-form').append($success);
    }

    frappe.web_form.after_save = function () {
        var reason = frappe.web_form.get_value('reason') || '';

        if (!token) return;
        if (!verify_ticket) {
            frappe.msgprint('Please verify your email with the code sent to you before submitting.');
            return;
        }
        if (!reason.trim()) {
            frappe.msgprint('Please provide a reason for withdrawing this case.');
            return;
        }

        frappe.call({
            method: 'support_iid.support_iid.doctype.case_register.case_register.withdraw_case',
            args: {
                token:         token,
                verify_ticket: verify_ticket,
                reason:        reason
            },
            callback: function (r) {
                if (!r.message) return;
                decryptResponse(r.message).then(function () {
                    showWithdrawSuccess();
                });
            },
            error: function (err) {
                console.error('withdraw_case failed:', err);
                frappe.show_alert({
                    message: 'Could not withdraw the case. Please try again or contact support.',
                    indicator: 'orange'
                }, 8);
            }
        });
    };

    /* =========================================================
       4. TITLE + LOGO SWAP — same treatment as the other Support IID
          web forms, for a consistent branded look.
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
                + 'Support IID Case Withdraw - Azim Premji Foundation'
                + '</h5>'
                + '<img src="/files/APF%20logo.png" style="height:70px;flex-shrink:0">'
                + '</div>';
        } else if (titleTries > 20) {
            clearInterval(titleTimer);
        }
    }, 100);

});

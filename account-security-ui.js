'use strict';
let securitySubmitting = false;
let securityMode = 'forgot';
let securityMailSent = false;

async function loadLoginPreferences() {
  const saved = await window.api.accountLoginPreferences().catch(() => ({}));
  document.getElementById('auth-email').value = saved.email || '';
  document.getElementById('auth-password').value = saved.password || '';
  document.getElementById('auth-remember').checked = !!saved.rememberPassword;
  document.getElementById('auth-keep-session').checked = saved.keepSignedIn !== false;
}
async function forgetSavedPassword(checked) {
  if (checked) return;
  await window.api.accountForgetPasswordOnDevice().catch(() => {});
}
function openAccountSecurity(mode) {
  if (securitySubmitting) return;
  securityMode = mode; securityMailSent = false;
  const form = document.getElementById('account-security-form'); form.reset();
  document.getElementById('security-email').readOnly = false;
  document.getElementById('security-email').value = document.getElementById('auth-email').value || currentAccount?.email || '';
  document.getElementById('security-heading').textContent = mode === 'change' ? 'Đổi mật khẩu' : 'Quên mật khẩu';
  document.getElementById('security-description').textContent = mode === 'change'
    ? 'Nhập mật khẩu hiện tại. Khóa hồ sơ được mã hóa lại bằng mật khẩu mới; quyền truy cập được giữ nguyên.'
    : 'Nhận mã xác nhận qua email rồi đặt mật khẩu mới tại đây. Nếu máy không còn khóa đã lưu, admin cần khôi phục quyền mở hồ sơ Cloud cũ.';
  document.getElementById('security-current-row').hidden = mode !== 'change';
  document.getElementById('security-email-row').hidden = mode === 'change';
  document.getElementById('security-code-row').hidden = true;
  document.getElementById('security-password-fields').hidden = mode !== 'change';
  document.getElementById('security-current').required = mode === 'change';
  document.getElementById('security-email').required = mode !== 'change';
  document.getElementById('security-code').required = false;
  for (const id of ['security-new', 'security-confirm']) document.getElementById(id).required = mode === 'change';
  document.getElementById('security-error').textContent = '';
  document.getElementById('security-submit').textContent = mode === 'change' ? 'Đổi mật khẩu' : 'Gửi mã xác nhận';
  document.getElementById('security-resend').hidden = true;
  document.getElementById('modal-account-security').style.display = 'flex';
  (mode === 'change' ? document.getElementById('security-current') : document.getElementById('security-email')).focus();
}
function closeAccountSecurity() {
  if (securitySubmitting) return;
  void window.api.accountCancelPasswordReset().catch(() => {});
  document.getElementById('modal-account-security').style.display = 'none';
  document.getElementById('account-security-form').reset();
}
async function submitAccountSecurity(event, resend = false) {
  event?.preventDefault();
  if (securitySubmitting) return;
  const error = document.getElementById('security-error');
  const button = document.getElementById('security-submit');
  const email = document.getElementById('security-email').value.trim();
  const newPassword = document.getElementById('security-new').value;
  const sending = securityMode === 'forgot' && (!securityMailSent || resend);
  error.textContent = '';
  if (!sending && newPassword !== document.getElementById('security-confirm').value) { error.textContent = 'Hai mật khẩu mới chưa trùng nhau.'; return; }
  securitySubmitting = true; button.disabled = true; button.textContent = sending ? 'Đang gửi mã…' : 'Đang cập nhật…';
  document.getElementById('security-resend').disabled = true;
  try {
    let result;
    if (sending) result = await window.api.accountRequestPasswordReset(email);
    else if (securityMode === 'change') result = await window.api.accountChangePassword({ currentPassword: document.getElementById('security-current').value, newPassword });
    else result = await window.api.accountResetPassword({ email, code: document.getElementById('security-code').value, newPassword,
      rememberPassword: document.getElementById('auth-remember').checked, keepSignedIn: document.getElementById('auth-keep-session').checked });
    if (!result?.success) throw new Error(result?.error || 'Chưa hoàn tất.');
    if (sending) {
      securityMailSent = true;
      document.getElementById('security-email').readOnly = true;
      document.getElementById('security-code-row').hidden = false;
      document.getElementById('security-password-fields').hidden = false;
      for (const id of ['security-code', 'security-new', 'security-confirm']) document.getElementById(id).required = true;
      document.getElementById('security-resend').hidden = false;
      error.textContent = 'Nếu email có tài khoản, mã xác nhận sẽ được gửi. Kiểm tra cả thư rác. Nhập mã trong email, không mở liên kết localhost.';
      document.getElementById('security-code').focus();
      return;
    }
    securitySubmitting = false; closeAccountSecurity();
    if (result.account) { showAccount(result.account); switchView('profiles'); }
    alert(result.message || (result.needsAdminRecovery
      ? 'Đã đặt lại mật khẩu. Liên hệ admin để khôi phục quyền mở các hồ sơ Cloud cũ. Các hồ sơ và quyền chia sẻ vẫn còn trên hệ thống.'
      : 'Đã đặt lại mật khẩu và giữ được khóa mở hồ sơ trên máy này.'));
    if (result.warning) alert(result.warning);
  } catch (failure) { error.textContent = readableAppError(failure); }
  finally {
    securitySubmitting = false; button.disabled = false;
    button.textContent = securityMode === 'change' ? 'Đổi mật khẩu' : securityMailSent ? 'Đặt mật khẩu mới' : 'Gửi mã xác nhận';
    document.getElementById('security-resend').disabled = false;
  }
}
async function recoverUserProfileKeys(userId, email, button) {
  if (!confirm(`Khôi phục quyền mở hồ sơ cho ${email}? Chỉ cấp lại khóa của các hồ sơ tài khoản này đang sở hữu hoặc được chia sẻ.`)) return;
  try {
    if (!await ensureCloudUnlocked()) return;
    button.disabled = true;
    const result = await window.api.adminRecoverUserProfiles(userId);
    if (!result?.success) throw new Error(result?.error || 'Không thể khôi phục.');
    alert(`Đã khôi phục ${result.updated} hồ sơ. Chưa khôi phục: ${result.failed.length}.` + (result.failed.length ? '\n' + result.failed.slice(0, 8).map(p => p.name + ': ' + p.error).join('\n') : '\nNgười dùng có thể mở hồ sơ bằng mật khẩu mới.'));
  } catch (error) { alert(readableAppError(error)); }
  finally { button.disabled = false; }
}

document.addEventListener('keydown', event => {
  const modal = document.getElementById('modal-account-security');
  if (modal?.style.display !== 'flex') return;
  if (event.key === 'Escape') closeAccountSecurity();
  if (event.key === 'Tab') {
    const elements = Array.from(modal.querySelectorAll('button,input')).filter(e => !e.disabled && e.getClientRects().length);
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

function setAuthFormBusy(busy) {
  for (const id of ['auth-submit-btn','auth-email','auth-password','auth-remember','auth-keep-session','auth-forgot','auth-toggle-btn']) {
    const element = document.getElementById(id); if (element) element.disabled = busy;
  }
}

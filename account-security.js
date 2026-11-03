'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createAccountKeyMetadata, encryptPrivateKey, decryptPrivateKey, wrapDataKey, unwrapDataKey } = require('./cloud-profiles');

function installAccountSecurity({ ipcMain, supabase, createRecoveryClient, safeStorage, userDataPath, loadAccount, getAccount, getPrivateKey, setPrivateKey, canChange, setBusy }) {
  const sessionFile = path.join(userDataPath, 'account-session.enc');
  const loginFile = path.join(userDataPath, 'account-login.enc');
  let preferences = { rememberPassword: false, keepSignedIn: true };
  let recovery = null;
  let recoveryEmail = '';
  let lastMail = 0;
  let verifiedRecovery = null;
  let busy = false;
  function read(file) {
    try { if (safeStorage.isEncryptionAvailable() && fs.existsSync(file)) return JSON.parse(safeStorage.decryptString(fs.readFileSync(file))); } catch {}
    return null;
  }
  function write(file, data) {
    if (!data) { fs.rmSync(file, { force: true }); return; }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows chưa cung cấp kho mã hóa. Không thể lưu thông tin đăng nhập trên máy này.');
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(data)), { flag: 'wx' }); fs.renameSync(tmp, file); }
    finally { fs.rmSync(tmp, { force: true }); }
  }
  function persistSession(session) {
    try {
      if (!session || !preferences.keepSignedIn) return write(sessionFile, null);
      const account = getAccount();
      const old = read(sessionFile);
      write(sessionFile, { access_token: session.access_token, refresh_token: session.refresh_token,
        userId: session.user?.id,
        privateKey: account?.id === session.user?.id ? getPrivateKey() : (old?.userId === session.user?.id ? old.privateKey : null),
        publicKey: account?.id === session.user?.id ? account.public_key : (old?.userId === session.user?.id ? old.publicKey : null) });
    } catch { try { write(sessionFile, null); } catch {} }
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (event !== 'INITIAL_SESSION') persistSession(event === 'SIGNED_OUT' ? null : session);
  });
  async function saveLogin({ email, password, rememberPassword = false, keepSignedIn = true }) {
    preferences = { email, rememberPassword: !!rememberPassword, keepSignedIn: !!keepSignedIn };
    let warning;
    try { write(loginFile, { ...preferences, password: rememberPassword ? password : undefined }); }
    catch (error) { warning = error.message; write(loginFile, null); }
    const { data } = await supabase.auth.getSession();
    persistSession(data?.session);
    return warning;
  }
  async function restore() {
    preferences = { ...preferences, ...read(loginFile) };
    if (!preferences.keepSignedIn) { write(sessionFile, null); return; }
    const tokens = read(sessionFile);
    if (!tokens?.access_token || !tokens?.refresh_token) return;
    try {
      const { error } = await supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
      if (error) throw error;
      const result = await loadAccount();
      if (result?.account.id === tokens.userId && result.account.public_key === tokens.publicKey && tokens.privateKey) {
        const publicKey = crypto.createPublicKey(tokens.privateKey).export({ type: 'spki', format: 'pem' });
        if (publicKey === result.account.public_key) setPrivateKey(tokens.privateKey);
      } else if (result && preferences.rememberPassword && preferences.email === result.account.email) {
        try { setPrivateKey(await decryptPrivateKey(result.keyRow, preferences.password)); } catch {}
      }
    } catch { persistSession(null); setPrivateKey(null); }
  }
  function loginPreferences() {
    const saved = read(loginFile) || preferences;
    return { email: saved.email || '', password: saved.rememberPassword ? saved.password || '' : '', rememberPassword: !!saved.rememberPassword, keepSignedIn: saved.keepSignedIn !== false };
  }
  async function guarded(action) {
    if (busy || !canChange()) return { success: false, error: 'Đóng các hồ sơ và đợi đồng bộ hoàn tất trước khi thay đổi tài khoản.' };
    busy = true; setBusy(true);
    try { return await action(); }
    catch (error) { return { success: false, error: error.message }; }
    finally { busy = false; setBusy(false); }
  }
  function passwordValid(password) { if (typeof password !== 'string' || password.length < 9 || password.length > 512) throw new Error('Mật khẩu cần từ 9 đến 512 ký tự.'); }
  async function checkMigration(client, rotating = false) {
    const { error } = await client.rpc('td_account_security_ready', { p_rotating: rotating });
    if (error) throw new Error(String(error.message).includes('td_account_security_ready')
      ? 'Cần chạy SUPABASE-UPDATE-1.2.3.sql trên Supabase trước khi đổi hoặc đặt lại mật khẩu.' : error.message);
  }
  async function updateCredentials(client, result, password, privateKey, currentPassword) {
    await checkMigration(client, !privateKey);
    const metadata = privateKey ? await encryptPrivateKey(privateKey, password) : await createAccountKeyMetadata(password);
    if (privateKey && metadata.td_public_key !== result.keyRow.public_key) throw new Error('Khóa trên máy không khớp tài khoản. Đăng nhập lại hoặc liên hệ admin.');
    const operation = crypto.randomUUID();
    const { error } = await client.auth.updateUser({ password, ...(currentPassword ? { current_password: currentPassword } : {}), data: { ...metadata,
      td_key_operation_id: operation, td_key_expected_public: result.keyRow.public_key,
      td_key_expected_ciphertext: result.keyRow.private_key_ciphertext } });
    if (error) throw new Error(error.code === 'same_password' ? 'Mật khẩu mới phải khác mật khẩu cũ.' : error.message);
    return metadata;
  }
  async function rememberUnlockedSession() {
    const { data } = await supabase.auth.getSession();
    persistSession(data?.session);
  }
  ipcMain.handle('account:login-preferences', () => loginPreferences());
  ipcMain.handle('account:cancel-password-reset', async () => {
    if (busy) return false;
    const client = recovery;
    recovery = null; recoveryEmail = ''; verifiedRecovery = null;
    if (client) { client.auth.stopAutoRefresh(); await client.auth.signOut({ scope: 'local' }).catch(() => {}); }
    return true;
  });
  ipcMain.handle('account:forget-password-on-device', () => {
    preferences = { ...preferences, rememberPassword: false };
    write(loginFile, { ...preferences, password: undefined });
    return true;
  });
  ipcMain.handle('account:change-password', (event, input) => guarded(async () => {
    passwordValid(input.newPassword);
    const result = await loadAccount();
    if (!result) throw new Error('Hãy đăng nhập trước.');
    if (input.currentPassword === input.newPassword) throw new Error('Mật khẩu mới cần khác mật khẩu hiện tại.');
    const privateKey = await decryptPrivateKey(result.keyRow, String(input.currentPassword || ''));
    const client = createRecoveryClient();
    try {
      const { error } = await client.auth.signInWithPassword({ email: result.account.email, password: input.currentPassword });
      if (error) throw new Error('Mật khẩu hiện tại không đúng hoặc cần xác thực bổ sung.');
      await checkMigration(client);
      await updateCredentials(client, result, input.newPassword, privateKey, input.currentPassword);
      setPrivateKey(privateKey);
      const saved = loginPreferences();
      const warning = await saveLogin({ ...saved, email: result.account.email, password: input.newPassword });
      const { data: sessionData } = await client.auth.getSession();
      const { error: sessionError } = await supabase.auth.setSession(sessionData.session);
      if (sessionError) throw new Error('Đã đổi mật khẩu và khóa thành công. Hãy đăng xuất rồi đăng nhập bằng mật khẩu mới.');
      persistSession(sessionData.session);
      return { success: true, warning, account: { ...result.account, cloudUnlocked: true }, message: 'Đã đổi mật khẩu và mã hóa lại khóa hồ sơ. Hồ sơ và quyền chia sẻ được giữ nguyên.' };
    } finally { client.auth.stopAutoRefresh(); }
  }));
  ipcMain.handle('account:request-password-reset', (event, email) => guarded(async () => {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Nhập email hợp lệ.');
    if (Date.now() - lastMail < 60000) throw new Error('Đợi 60 giây trước khi yêu cầu gửi lại mã.');
    recovery?.auth.stopAutoRefresh();
    recovery = createRecoveryClient(); recoveryEmail = email; verifiedRecovery = null;
    const { error } = await recovery.auth.resetPasswordForEmail(email);
    if (error) throw error;
    lastMail = Date.now();
    return { success: true, email };
  }));
  ipcMain.handle('account:reset-password', (event, input) => guarded(async () => {
    passwordValid(input.newPassword);
    const email = String(input.email || '').trim().toLowerCase();
    if (!recovery || recoveryEmail !== email) throw new Error('Hãy yêu cầu gửi mã xác nhận lại.');
    if (!/^\d{6,10}$/.test(String(input.code || '').trim())) throw new Error('Nhập mã xác nhận trong email.');
    if (!verifiedRecovery || Date.now() - verifiedRecovery.at > 600000) {
      const { data, error } = await recovery.auth.verifyOtp({ email, token: String(input.code).trim(), type: 'recovery' });
      if (error || !data.user) throw new Error('Mã không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới.');
      verifiedRecovery = { user: data.user, at: Date.now() };
    }
    const data = verifiedRecovery;
    await checkMigration(recovery);
    const rowResult = await recovery.from('app_users').select('*').eq('user_id', data.user.id).single();
    if (rowResult.error || rowResult.data.status !== 'active') throw new Error('Tài khoản bị khóa hoặc chưa khởi tạo. Hãy liên hệ admin.');
    const row = rowResult.data;
    let privateKey = null;
    const saved = read(loginFile);
    const session = read(sessionFile);
    if (getAccount()?.id === data.user.id && getAccount()?.public_key === row.public_key) privateKey = getPrivateKey();
    if (!privateKey && session?.userId === data.user.id && session.publicKey === row.public_key) privateKey = session.privateKey;
    if (!privateKey && saved?.rememberPassword && saved.email === email) {
      try { privateKey = await decryptPrivateKey(row, saved.password); } catch {}
    }
    if (privateKey) {
      try { if (crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !== row.public_key) privateKey = null; }
      catch { privateKey = null; }
    }
    await updateCredentials(recovery, { keyRow: row }, input.newPassword, privateKey);
    // Refresh the main session only after the verified update has succeeded.
    const { data: authData } = await recovery.auth.getSession();
    const { error: loginError } = await supabase.auth.setSession(authData.session);
    if (loginError) { recovery.auth.stopAutoRefresh(); recovery = null; throw new Error('Đã đặt mật khẩu mới. Hãy đóng hộp thoại và đăng nhập bằng mật khẩu mới.'); }
    const result = await loadAccount();
    setPrivateKey(await decryptPrivateKey(result.keyRow, input.newPassword));
    const warning = await saveLogin({ email, password: input.newPassword, rememberPassword: !!input.rememberPassword, keepSignedIn: !!input.keepSignedIn });
    persistSession(authData.session);
    recovery.auth.stopAutoRefresh(); recovery = null; recoveryEmail = ''; verifiedRecovery = null;
    return { success: true, account: { ...result.account, cloudUnlocked: true }, needsAdminRecovery: !privateKey, warning };
  }));
  ipcMain.handle('admin:recover-user-profiles', (event, userId) => guarded(async () => {
    const result = await loadAccount();
    if (result?.account.role !== 'admin' || !getPrivateKey()) throw new Error('Admin cần đăng nhập và mở khóa Cloud trước.');
    const { data: rows, error } = await supabase.rpc('td_admin_recovery_candidates', { p_user_id: userId });
    if (error) throw error;
    let updated = 0; const failed = [];
    for (const item of rows || []) {
      let key;
      try {
        if (!item.admin_envelope) throw new Error('Admin này chưa có khóa hồ sơ.');
        key = unwrapDataKey(getPrivateKey(), item.admin_envelope);
        const { error: saveError } = await supabase.rpc('td_admin_restore_profile_key', {
          p_user_id: userId, p_profile_id: item.profile_id, p_expected_public_key: item.public_key,
          p_encrypted_key: wrapDataKey(item.public_key, key), p_expected_admin_envelope: item.admin_envelope
        });
        if (saveError) throw saveError;
        updated++;
      } catch (error) { failed.push({ name: item.profile_name, error: error.message }); }
      finally { key?.fill(0); }
    }
    return { success: true, updated, failed };
  }));
  return { restore, saveLogin, persistSession, rememberUnlockedSession, loginPreferences, isBusy: () => busy };
}
module.exports = { installAccountSecurity };

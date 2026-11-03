'use strict';
let selectedAdminUser = null;
let adminEditToken = null;
let adminEditSaving = false;
let adminProfilesRequest = 0;

function openUserProfiles(userId, email) {
  selectedAdminUser = { id: userId, email };
  switchView('admin-profiles');
}
function openAllAdminProfiles() {
  selectedAdminUser = null;
  switchView('admin-profiles');
}
async function renderAdminProfiles() {
  if (document.getElementById('view-admin-users')?.classList.contains('active')) { await refreshExpandedUserProfiles(); return; }
  const request = ++adminProfilesRequest;
  const user = selectedAdminUser;
  const tbody = document.getElementById('table-admin-profiles');
  const title = document.querySelector('#view-admin-profiles .page-title');
  title.textContent = user ? `Hồ sơ của ${user.email}` : 'Quản lý hồ sơ người dùng';
  document.getElementById('admin-profile-filter-bar').hidden = !user;
  document.getElementById('admin-profile-filter-email').textContent = user?.email || '';
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;">Đang tải hồ sơ…</td></tr>';
  try {
    if (user) void refreshCatalogStatusCells();
    const profiles = user ? await window.api.adminUserProfiles(user.id) : await window.api.adminAllUserProfiles();
    if (request !== adminProfilesRequest) return;
    if (!profiles?.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:36px;">Chưa nhận danh sách hồ sơ từ thiết bị. Máy người dùng cần mở app bản mới, đăng nhập và kết nối mạng để cập nhật danh sách.</td></tr>';
      return;
    }
    tbody.innerHTML = renderAdminProfileRows(profiles, user);
  } catch (error) {
    if (request === adminProfilesRequest) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:32px;">${escapeHtml(readableAppError(error))}</td></tr>`;
  }
}
async function removeSharedUserProfile(profileId, userId) {
  if (!confirm('Gỡ quyền sử dụng hồ sơ của tài khoản này? Chủ sở hữu và các tài khoản khác vẫn giữ hồ sơ. Máy người nhận sẽ cập nhật danh sách khi mở app và kết nối mạng.')) return;
  try {
    await window.api.adminRevokeProfileShare({ profileId, userId });
    await renderAdminProfiles();
  } catch (error) {
    const message = readableAppError(error);
    alert(message.includes('td_admin_revoke_profile_share') ? 'Cần chạy file SQL 202610120002_admin_revoke_profile_share.sql trên Supabase để bật chức năng gỡ quyền.' : message);
  }
}
const adminEditableFields = [
  ['name', 'Tên hồ sơ', 'text'], ['note', 'Ghi chú', 'text'], ['ua', 'User-Agent', 'text'],
  ['proxyIp', 'Host proxy', 'text'], ['proxyPort', 'Cổng proxy', 'text'],
  ['proxyType', 'Giao thức (http / https / socks5)', 'text'], ['proxyTimezoneMode', 'Múi giờ (auto / manual)', 'text'], ['proxyUser', 'Tài khoản proxy', 'text'], ['proxyPass', 'Mật khẩu proxy', 'password'], ['proxyTimezone', 'Múi giờ proxy (ví dụ America/New_York)', 'text']
];
async function openAdminProfileEdit(profileId) {
  try {
    if (!await ensureCloudUnlocked()) return;
    const result = await window.api.adminPrepareProfileEdit(profileId);
    let overlay = document.getElementById('modal-admin-profile-edit');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modal-admin-profile-edit';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `<form class="modal-box" style="width:680px;" role="dialog" aria-modal="true" aria-labelledby="admin-edit-heading" onsubmit="saveAdminProfileEdit(event)"><div class="modal-head"><span id="admin-edit-heading">Sửa hồ sơ người dùng</span><button type="button" class="btn-del" aria-label="Đóng" onclick="closeAdminProfileEdit()">✕</button></div><div class="modal-body"><p style="color:var(--text-muted);margin-bottom:16px;">Các thay đổi được lưu lên Cloud. Máy người dùng nhận cấu hình mới khi mở lại hồ sơ và có kết nối mạng.</p><div class="admin-profile-edit-grid">${adminEditableFields.map(([key, label, type]) => `<div class="form-row"><label class="form-label" for="admin-edit-${key}">${label}</label><input id="admin-edit-${key}" class="input-box" type="${type}" autocomplete="off" maxlength="${key === 'name' ? 120 : 4096}" ${key === 'name' ? 'required' : ''}></div>`).join('')}</div></div><div class="modal-foot"><button type="button" class="btn-test" onclick="closeAdminProfileEdit()">Hủy</button><button id="admin-edit-save" type="submit" class="btn-blue">Lưu và đồng bộ</button></div></form>`;
      document.body.appendChild(overlay);
    }
    adminEditToken = result.token;
    for (const [key] of adminEditableFields) document.getElementById('admin-edit-' + key).value = result.profile[key] || (key==='proxyType'?'http':key==='proxyTimezoneMode'?'auto':'');
    overlay.style.display = 'flex';
    document.getElementById('admin-edit-name').focus();
  } catch (error) { alert(readableAppError(error)); }
}
function closeAdminProfileEdit() {
  if (adminEditSaving) return;
  adminEditToken = null;
  const overlay = document.getElementById('modal-admin-profile-edit');
  if (overlay) { overlay.style.display = 'none'; overlay.querySelector('form').reset(); }
}
async function saveAdminProfileEdit(event) {
  event.preventDefault();
  if (adminEditSaving || !adminEditToken) return;
  adminEditSaving = true;
  const button = document.getElementById('admin-edit-save');
  button.disabled = true; button.textContent = 'Đang lưu và đồng bộ…';
  try {
    const updates = Object.fromEntries(adminEditableFields.map(([key]) => [key, document.getElementById('admin-edit-' + key).value]));
    await window.api.adminSaveProfileEdit({ token: adminEditToken, updates });
    adminEditSaving = false;
    closeAdminProfileEdit();
    await renderAdminProfiles();
    alert('Đã lưu hồ sơ lên Cloud. Người dùng đóng rồi mở lại hồ sơ để nhận bản mới.');
  } catch (error) { alert(readableAppError(error)); }
  finally { adminEditSaving = false; button.disabled = false; button.textContent = 'Lưu và đồng bộ'; }
}
setInterval(() => {
  if (!currentAccount || adminEditSaving || document.querySelector('.modal-overlay[style*="display: flex"]')) return;
  if (document.getElementById('view-profiles')?.classList.contains('active')) void loadProfilesTable();
  else if (document.getElementById('view-admin-profiles')?.classList.contains('active')) void renderAdminProfiles();
}, 30000);

const adminProfileActionIcons = Object.freeze({
  download: '<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 15v5h14v-5"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m13 6 5 5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/>',
  delete: '<path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7"/>',
  revoke: '<path d="m8 16-1 1a4 4 0 0 1-6-6l3-3a4 4 0 0 1 5-1m6 10a4 4 0 0 0 5-1l3-3a4 4 0 0 0-6-6l-1 1M3 3l18 18"/>'
});
function adminProfileActionButton(icon, label, action, options = {}) {
  const tone = options.danger ? ' is-danger' : options.primary ? ' is-primary' : '';
  return `<button type="button" class="profile-action-button${tone}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" ${options.disabled ? 'disabled' : ''} onclick="${action}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${adminProfileActionIcons[icon]}</svg></button>`;
}
function renderAdminProfileRows(profiles, user) {
  return profiles.map(p => {
      const id = inlineArg(p.id), name = inlineArg(p.profile_name);
      if(p.inventory_only)return `<tr><td>${escapeHtml(p.owner_email||user?.email||'Người dùng')}<br><span class="badge badge-gray">Hồ sơ trên máy</span></td><td style="font-weight:600;">${escapeHtml(p.profile_name)}</td><td>${p.pending_delete?'Chờ xóa':p.running?'Đang mở':p.connected?'Đã đóng':'Ngoại tuyến'}</td><td title="${escapeHtml(p.device_id)}">${escapeHtml(String(p.device_id).slice(0,8))}</td><td>${escapeHtml(new Date(p.updated_at).toLocaleString('vi-VN'))}</td><td><div class="row-actions profile-icon-actions">${adminProfileActionButton('delete','Yêu cầu xóa hồ sơ trên máy người dùng',`deleteUserLocalProfile(${inlineArg(p.user_id)},${inlineArg(p.device_id)},${inlineArg(p.local_id)})`,{danger:true,disabled:p.pending_delete})}</div></td></tr>`;
      const shared=false;
      const ready = Number(p.revision) > 0;
      const removeAction=adminProfileActionButton('delete','Xóa Cloud và bản trên các máy',`deleteCloudProfile(${id})`,{danger:true});
      const actions = [
        adminProfileActionButton('download', ready ? 'Tải bản độc lập về máy' : 'Chưa có dữ liệu để tải / mở', `downloadCloudProfile(${id},${name})`, { primary: true, disabled: !ready }),
        adminProfileActionButton('edit', ready ? 'Sửa hồ sơ' : 'Đổi tên hồ sơ', ready ? `openAdminProfileEdit(${id})` : `renameCloudProfile(${id},${name})`),
        removeAction
      ].join('');
      return `<tr><td title="${escapeHtml(p.owner_email || '')}">${escapeHtml(p.owner_email || '-')}<br><span class="badge ${shared ? 'badge-blue' : 'badge-gray'}">${shared ? 'Được chia sẻ' : 'Chủ sở hữu'}</span></td><td style="font-weight:600;" title="${escapeHtml(p.profile_name)}">${escapeHtml(p.profile_name)}</td><td>${ready ? 'v' + escapeHtml(p.revision) : 'Chờ dữ liệu'}${user ? '<br><span class="catalog-version">' + (p.on_user_device ? (p.running ? 'Đang mở' : 'Có trên máy') : 'Chưa báo trên máy') + '</span>' : ''}</td><td>${p.cipher_size ? (Number(p.cipher_size) / 1024 / 1024).toFixed(1) + ' MB' : '-'}</td><td>${escapeHtml(p.updated_at ? new Date(p.updated_at).toLocaleString('vi-VN') : '-')}</td><td><div class="row-actions profile-icon-actions">${actions}</div></td></tr>`;
    }).join('');
}

async function deleteUserLocalProfile(userId,deviceId,localId){
  if(!confirm('Yêu cầu xóa hồ sơ này trên máy người dùng? Lệnh được áp dụng khi máy đó mở TD và kết nối mạng. Không thể khôi phục từ thùng rác.'))return;
  try{await window.api.adminRequestProfileDelete({userId,deviceId,localId});workspaceToast('Đã gửi lệnh xóa đến máy người dùng.');await renderAdminProfiles();}
  catch(error){alert(readableAppError(error));}
}
const expandedAdminUsers = new Map();
const inlineUserRequests = new Map();
async function toggleInlineUserProfiles(userId, email) {
  if (expandedAdminUsers.has(userId)) expandedAdminUsers.delete(userId);
  else expandedAdminUsers.set(userId, { id: userId, email });
  const open = expandedAdminUsers.has(userId);
  const row = document.getElementById('user-profiles-' + userId);
  const button = document.getElementById('expand-user-' + userId);
  if (!row || !button) return;
  row.hidden = !open; button.setAttribute('aria-expanded', String(open)); button.textContent = open ? '▾ Thu gọn' : '▸ Hồ sơ';
  if (open) await refreshInlineUserProfiles(userId);
}
async function refreshInlineUserProfiles(userId) {
  const tbody = document.getElementById('inline-user-profiles-' + userId);
  if (!tbody || !expandedAdminUsers.has(userId)) return;
  const generation = (inlineUserRequests.get(userId) || 0) + 1;
  inlineUserRequests.set(userId, generation);
  if (!tbody.children.length) tbody.innerHTML = '<tr><td colspan="6">Đang tải hồ sơ…</td></tr>';
  try {
    const rows = await window.api.adminUserProfiles(userId);
    if (generation !== inlineUserRequests.get(userId) || !tbody.isConnected || !expandedAdminUsers.has(userId)) return;
    tbody.innerHTML = rows?.length ? renderAdminProfileRows(rows, expandedAdminUsers.get(userId)) : '<tr><td colspan="6">Chưa có hồ sơ. Danh sách tự cập nhật khi máy người dùng có mạng.</td></tr>';
  } catch (error) { if (tbody.isConnected && generation === inlineUserRequests.get(userId)) tbody.innerHTML = '<tr><td colspan="6">' + escapeHtml(readableAppError(error)) + '</td></tr>'; }
}
async function restoreExpandedUserProfiles() {
  for (const [userId] of expandedAdminUsers) {
    const row = document.getElementById('user-profiles-' + userId), button = document.getElementById('expand-user-' + userId);
    if (!row || !button) { expandedAdminUsers.delete(userId); continue; }
    row.hidden = false; button.setAttribute('aria-expanded', 'true'); button.textContent = '▾ Thu gọn';
  }
  await refreshExpandedUserProfiles();
}
async function refreshExpandedUserProfiles() {
  await Promise.all(Array.from(expandedAdminUsers.keys()).map(refreshInlineUserProfiles));
}
setInterval(() => {
  if (currentAccount?.role === 'admin' && document.getElementById('view-admin-users')?.classList.contains('active') && !document.querySelector('.modal-overlay[style*="display: flex"]')) void refreshExpandedUserProfiles();
}, 30000);

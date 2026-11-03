'use strict';
let catalogUserStatus = new Map();
let catalogStatusBusy = false;
let catalogStatusError = '';

function formatCatalogStatus(userId) {
  const info = catalogUserStatus.get(userId);
  if (catalogStatusError) return { count: info ? String(info.profile_count ?? 0) : '—', detail: `<span class="badge badge-orange">${catalogStatusError.includes('td_admin_profile_catalog_status') ? 'Cần cấu hình SQL' : 'Chưa lấy được trạng thái'}</span>${info?.last_seen ? '<span class="catalog-last-seen">Bản gần nhất: ' + escapeHtml(new Date(info.last_seen).toLocaleString('vi-VN')) + '</span>' : ''}` };
  if (!info?.last_seen) return { count: '—', detail: '<span class="badge badge-gray">Chưa nhận danh sách</span>' };
  const connected = Number(info.online_devices) > 0;
  return {
    count: String(info.profile_count ?? 0),
    detail: `<span class="badge ${connected ? 'badge-green' : 'badge-gray'}">${connected ? 'Vừa kết nối' : 'Chưa phản hồi / đã đóng'}</span><span class="catalog-last-seen">${escapeHtml(new Date(info.last_seen).toLocaleString('vi-VN'))}</span><span class="catalog-version">v${escapeHtml(info.app_version || '?')} · ${escapeHtml(info.device_count || 0)} máy</span>`
  };
}
async function fetchCatalogStatus() {
  try {
    const rows = await window.api.adminCatalogStatus();
    catalogUserStatus = new Map((rows || []).map(row => [row.user_id, row]));
    catalogStatusError = '';
  } catch (error) {
    catalogStatusError = readableAppError(error);
  }
}
async function refreshCatalogStatusCells() {
  if (catalogStatusBusy || currentAccount?.role !== 'admin') return;
  catalogStatusBusy = true;
  try {
    await fetchCatalogStatus();
    document.querySelectorAll('[data-catalog-user]').forEach(cell => {
      const status = formatCatalogStatus(cell.dataset.catalogUser);
      cell.innerHTML = cell.dataset.catalogField === 'count' ? escapeHtml(status.count) : status.detail;
      cell.title = catalogStatusError || 'Mỗi máy gửi danh sách khoảng 30 giây/lần. Hơn 90 giây không có tín hiệu được đánh dấu chưa phản hồi.';
    });
    if (selectedAdminUser) {
      const info = catalogUserStatus.get(selectedAdminUser.id);
      const summary = document.getElementById('admin-catalog-freshness');
      if (summary) summary.textContent = info?.last_seen
        ? `Danh sách máy người dùng: ${info.profile_count} hồ sơ · nhận lúc ${new Date(info.last_seen).toLocaleString('vi-VN')} · ${Number(info.online_devices) ? 'vừa kết nối' : 'chưa nhận tín hiệu mới'}`
        : 'Chưa nhận danh sách từ máy người dùng. Cần mở app 1.3.7 và kết nối mạng.';
    }
  } finally { catalogStatusBusy = false; }
}
function requestCatalogRefresh() {
  if (window.api?.requestCatalogSync && currentAccount) void window.api.requestCatalogSync();
  if (currentAccount?.role === 'admin') void refreshCatalogStatusCells();
}
window.addEventListener('online', requestCatalogRefresh);
window.addEventListener('focus', requestCatalogRefresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestCatalogRefresh(); });
setInterval(() => {
  if (currentAccount?.role === 'admin' && (document.getElementById('view-admin-users')?.classList.contains('active') || document.getElementById('view-admin-profiles')?.classList.contains('active'))) void refreshCatalogStatusCells();
}, 15000);

function updateLocalCatalogStatus(data) {
  const element = document.getElementById('local-catalog-status');
  if (!element || !currentAccount) return;
  element.hidden = false;
  if (data.success) {
    element.textContent = `Danh sách ${data.profileCount} hồ sơ đã cập nhật lúc ${new Date(data.lastSyncedAt).toLocaleTimeString('vi-VN')}`;
    element.title = 'Tự động gửi danh sách khoảng 30 giây/lần khi app mở và có mạng.';
  } else {
    element.textContent = data.message?.includes('td_sync_device_profile_catalog') ? 'Danh sách quản lý: đang chờ cấu hình hệ thống' : 'Danh sách quản lý: đang chờ kết nối lại';
    element.title = data.message || '';
  }
}

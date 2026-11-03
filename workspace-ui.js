'use strict';

// UI preferences contain display settings only; account and proxy secrets stay out.
const workspaceViews = {
  profiles: ['Hồ sơ trình duyệt', 'Sắp xếp hồ sơ, quản lý kết nối và bắt đầu công việc.', 'Tên hồ sơ, nhóm, proxy hoặc ghi chú…', 'table-profiles'],
  proxies: ['Kho proxy', 'Lưu và quản lý các kết nối mạng của bạn.', 'Tìm tên proxy, địa chỉ hoặc tài khoản…', 'table-proxies'],
  groups: ['Nhóm hồ sơ', 'Tổ chức công việc theo nhóm và mở nhanh các hồ sơ.', 'Tìm tên nhóm hoặc ghi chú…', 'table-groups'],
  extensions: ['Tiện ích mở rộng', 'Quản lý các tiện ích dùng chung cho trình duyệt.', 'Tìm tiện ích theo tên hoặc đường dẫn…', 'extensions-grid'],
  cloud: ['Hồ sơ Cloud', 'Tải hồ sơ được Admin cấp và dùng bản độc lập trên máy.', 'Tìm hồ sơ hoặc email chủ sở hữu…', 'table-cloud-profiles'],
  'admin-users': ['Quản lý người dùng', 'Theo dõi tài khoản và mở danh sách hồ sơ ngay trong bảng.', 'Tìm người dùng theo email…', 'table-admin-users'],
  'admin-profiles': ['Hồ sơ người dùng', 'Xem, quản lý và xóa hồ sơ người dùng.', 'Tìm hồ sơ hoặc email chủ sở hữu…', 'table-admin-profiles'],
  trash: ['Thùng rác', 'Khôi phục dữ liệu đã xóa hoặc dọn dẹp khi cần.', 'Tìm dữ liệu đã xóa…', 'table-trash']
};
const workspaceStates = new Map();
const workspaceSelection = new Set();
const workspaceLaunches = new Set();
const workspaceRuntime=new Map();let workspaceRuntimeGeneration=0;
const workspacePhaseLabels={starting:'Đang mở…',closing:'Đang đóng…',syncing:'Đồng bộ…',archiving:'Đang nén…',encrypting:'Mã hóa…',uploading:'Tải Cloud…',downloading:'Tải dữ liệu…',publishing:'Đang lưu…',pruning:'Dọn Cloud…',releasing:'Hoàn tất…'};
function workspaceProfileBusy(id){const phase=workspaceRuntime.get(id);return !!phase&&!['running','stopped'].includes(phase);}
function applyWorkspaceRuntime(rows){
  for(const state of rows||[]){
    if(!state?.profileId)continue;
    workspaceRuntime.set(state.profileId,state.phase);
    if(state.phase==='running')runningProfiles.add(state.profileId);else runningProfiles.delete(state.profileId);
  }
  for(const button of document.querySelectorAll('[id^="btn-TD_"]')){
    const id=button.id.slice(4).replace(/-grp$/,''),phase=workspaceRuntime.get(id),running=runningProfiles.has(id),busy=workspaceProfileBusy(id)||workspaceLaunches.has(id);
    button.disabled=busy;button.textContent=workspacePhaseLabels[phase]||(busy?'Đợi…':running?'Đang chạy':'Mở');button.className=running?'btn-running':'btn-open';button.title=busy?'Đợi hồ sơ hoàn tất xử lý':running?'Đóng trình duyệt':'Mở trình duyệt';
  }
  updateWorkspaceStats();applyWorkspaceFilters('profiles');
}
async function refreshWorkspaceRuntime(){
  if(!workspaceAccountId||!window.api.getProfileRuntime)return;
  const account=workspaceAccountId,generation=workspaceRuntimeGeneration;
  try{const rows=await window.api.getProfileRuntime();if(account===workspaceAccountId&&generation===workspaceRuntimeGeneration)applyWorkspaceRuntime(rows);}catch{}
}
window.api.onProfileRuntime?.(state=>{if(state.accountId&&state.accountId!==workspaceAccountId)return;workspaceRuntimeGeneration++;applyWorkspaceRuntime([state]);});
setInterval(()=>{void refreshWorkspaceRuntime();},2500);

const workspaceAdminDrafts = new Map();
let workspaceProfileRequest = 0;
let workspaceBulkBusy = false;
let workspaceProxyCheck = 0;
let workspaceAccountId = null;
let workspaceProfileSignature = '';
let workspaceProfileDrag = null;
const searchIcon = '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
const workspaceRead = key => { try { return localStorage.getItem('td_ui_' + key); } catch { return null; } };
const workspaceWrite = (key, value) => { try { localStorage.setItem('td_ui_' + key, value); } catch {} };
const workspaceNormalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi').trim();
const workspaceMatches = (value, query) => query.split(/\s+/).filter(Boolean).every(word => workspaceNormalize(value).includes(word));
const workspaceState = view => workspaceStates.get(view);

function workspaceToast(message, error = false) {
  const stack = document.getElementById('workspace-toasts');
  if (!stack) return;
  if(Array.from(stack.children).some(item=>item.classList.contains('error')===!!error&&item.querySelector('span')?.textContent===String(message)))return;
  const toast = document.createElement('div');
  toast.className = 'workspace-toast' + (error ? ' error' : '');
  toast.setAttribute('role', error ? 'alert' : 'status');
  const text = document.createElement('span'); text.textContent = message;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '✕'; close.setAttribute('aria-label', 'Đóng thông báo'); close.onclick = () => toast.remove();
  toast.append(text, close); stack.append(toast);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  if (!error) setTimeout(() => toast.remove(), 6000);
}

function workspaceSelect(id, label, options) {
  return `<select id="${id}" class="toolbar-select" aria-label="${label}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>`;
}

function setupWorkspace() {
  const nav = document.querySelector('.nav-container');
  nav.setAttribute('aria-label', 'Điều hướng chính');
  const label = document.createElement('div'); label.className = 'nav-label'; label.textContent = 'Không gian làm việc'; nav.prepend(label);
  document.getElementById('admin-nav-separator').className = 'nav-label';
  document.getElementById('admin-nav-separator').textContent = 'Quản trị';
  document.getElementById('admin-nav-separator').style.border = '0';
  for (const button of nav.querySelectorAll('.nav-btn')) {
    button.tabIndex = 0; button.setAttribute('role', 'button');
    button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); button.click(); } });
  }
  const footer = document.querySelector('.sidebar > div:last-child'); footer.classList.add('sidebar-footer');
  const account = document.createElement('details'); account.id = 'workspace-account';
  const summary = document.createElement('summary'); summary.className = 'account-summary';
  summary.innerHTML = '<span id="workspace-avatar" class="account-avatar">TD</span><div class="account-summary-copy"></div><span aria-hidden="true">⌄</span>';
  const copy = summary.querySelector('.account-summary-copy');
  copy.append(document.getElementById('app-account-email'));
  const meta = document.createElement('div'); meta.className = 'account-summary-meta';
  meta.append(document.getElementById('app-account-role'), document.createTextNode('·'), document.getElementById('app-version-text')); copy.append(meta);
  const actions = document.createElement('div'); actions.className = 'account-actions';
  actions.append(document.getElementById('account-security-btn'), document.getElementById('account-signout-btn'));
  account.append(summary, actions);
  // Remove only the old label containers after their values have been moved.
  for (const child of Array.from(footer.children)) if (child.tagName === 'DIV' && !child.id && !child.className) child.remove();
  footer.insertBefore(account, document.getElementById('manual-update-btn'));
  document.getElementById('theme-btn-auto').textContent = '◐ Auto';
  const stack = document.createElement('div'); stack.id = 'workspace-toasts'; stack.className = 'toast-stack'; document.body.append(stack);
  document.body.dataset.density = workspaceRead('density') === 'compact' ? 'compact' : 'comfortable';

  for (const [view, [title, subtitle, placeholder, targetId]] of Object.entries(workspaceViews)) {
    workspaceStates.set(view, { query: '', filter: '', group: '', sort: 'original' });
    const panel = document.getElementById('view-' + view), content = panel.querySelector('.content');
    const heading = document.createElement('div'); heading.className = 'page-heading';
    const titleElement = panel.querySelector('.page-title'); titleElement.textContent = title;
    titleElement.replaceWith(heading); heading.append(titleElement);
    const sub = document.createElement('span'); sub.className = 'page-subtitle'; sub.textContent = subtitle; heading.append(sub);
    const toolbar = document.createElement('div'); toolbar.className = 'workspace-toolbar'; toolbar.setAttribute('aria-label', 'Tìm kiếm và lọc');
    toolbar.innerHTML = `<div class="workspace-search">${searchIcon}<input id="workspace-search-${view}" type="search" placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off"><button type="button" class="search-clear" aria-label="Xóa tìm kiếm" hidden>✕</button></div>`;
    if (view === 'profiles') {
      toolbar.innerHTML += workspaceSelect('workspace-group', 'Lọc nhóm hồ sơ', [['', 'Tất cả nhóm'], ['__ungrouped', 'Chưa chia nhóm']]);
      toolbar.innerHTML += workspaceSelect('workspace-filter-profiles', 'Lọc trạng thái hồ sơ', [['', 'Mọi trạng thái'], ['running', 'Đang chạy'], ['stopped', 'Chưa mở'], ['cloud', 'Đã liên kết Cloud'], ['snapshot', 'Bản tải độc lập'], ['proxy', 'Có proxy'], ['direct', 'Mạng cục bộ']]);
      toolbar.innerHTML += workspaceSelect('workspace-sort', 'Sắp xếp hồ sơ', [['original', 'Thứ tự tùy chỉnh'], ['created', 'Thứ tự tạo ban đầu'], ['name', 'Tên A → Z'], ['newest', 'Mới tạo trước']]);
    } else if (view === 'admin-users') {
      toolbar.innerHTML += workspaceSelect('workspace-filter-admin-users', 'Lọc tài khoản', [['', 'Mọi tài khoản'], ['admin', 'Admin'], ['user', 'Người dùng'], ['active', 'Hoạt động'], ['disabled', 'Đã khóa']]);
    } else if (view === 'trash') {
      toolbar.innerHTML += workspaceSelect('workspace-filter-trash', 'Lọc loại dữ liệu', [['', 'Mọi loại dữ liệu'], ['Hồ sơ', 'Hồ sơ'], ['Nhóm', 'Nhóm']]);
    } else if (view === 'extensions') {
      toolbar.innerHTML += workspaceSelect('workspace-filter-extensions', 'Lọc tiện ích', [['', 'Mọi tiện ích'], ['enabled', 'Đang bật'], ['disabled', 'Đang tắt']]);
    }
    const right = document.createElement('div'); right.className = 'toolbar-right';
    right.innerHTML = `<span id="workspace-count-${view}" class="toolbar-meta"></span><button type="button" class="btn-test workspace-density" title="Đổi mật độ hàng"></button>`;
    if (view === 'profiles') right.innerHTML += '<details class="column-menu"><summary class="btn-test">Cột hiển thị</summary><div class="column-options"><strong>Thông tin trong bảng</strong></div></details>';
    toolbar.append(right);
    content.prepend(toolbar);
    const tableFooter = document.createElement('div'); tableFooter.className = 'table-footer';
    tableFooter.innerHTML = `<span id="workspace-footer-${view}"></span><span>${view === 'profiles' ? 'Ctrl + F: tìm kiếm · Ctrl + N: tạo hồ sơ' : 'Ctrl + F để tìm trong danh sách'}</span>`;
    content.append(tableFooter);
    if (view === 'profiles') {
      const stats = document.createElement('div'); stats.id = 'workspace-stats'; stats.className = 'workspace-stats'; content.insertBefore(stats, toolbar);
      const selection = document.createElement('div'); selection.id = 'workspace-selection'; selection.className = 'selection-bar'; selection.hidden = true;
      selection.innerHTML = '<strong id="workspace-selection-count"></strong><button id="workspace-open-selected" type="button" class="btn-blue" onclick="openWorkspaceSelection()">Mở đã chọn</button><select id="workspace-move-group" class="toolbar-select" aria-label="Nhóm đích"></select><button id="workspace-move-selected" type="button" class="btn-test" onclick="moveWorkspaceSelection()">Chuyển nhóm</button><button type="button" class="btn-test" onclick="clearWorkspaceSelection()">Bỏ chọn</button>';
      content.insertBefore(selection, toolbar.nextSibling);
      tableFooter.firstElementChild.append(document.getElementById('local-catalog-status'));
      const table = document.querySelector('.profiles-table');
      for (const [column, title, defaultValue] of [['clock', 'Giờ theo múi giờ', true], ['quality', 'Chất lượng kết nối', false], ['os', 'Hệ điều hành', false], ['note', 'Ghi chú', true], ['created', 'Ngày tạo', false]]) {
        const saved = workspaceRead('column_' + column), checked = saved === null ? defaultValue : saved === 'true';
        const option = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = checked;
        table.classList.toggle('hide-' + column, !checked);
        checkbox.addEventListener('change', () => { table.classList.toggle('hide-' + column, !checkbox.checked); workspaceWrite('column_' + column, String(checkbox.checked)); });
        option.append(checkbox, document.createTextNode(title)); right.querySelector('.column-options').append(option);
      }
      const all = table.querySelector('thead input'); all.id = 'workspace-select-all'; all.setAttribute('aria-label', 'Chọn tất cả hồ sơ đang hiển thị'); all.addEventListener('change', () => { document.querySelectorAll('#table-profiles tr[data-profile-id]:not([hidden])').forEach(row => { if (all.checked) workspaceSelection.add(row.dataset.profileId); else workspaceSelection.delete(row.dataset.profileId); }); updateWorkspaceSelection(); });
    }
    const input = toolbar.querySelector('input[type="search"]'), clear = toolbar.querySelector('.search-clear');
    input.addEventListener('input', () => { workspaceState(view).query = workspaceNormalize(input.value); clear.hidden = !input.value; applyWorkspaceFilters(view); });
    clear.addEventListener('click', () => { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); });
    toolbar.querySelector('[id^="workspace-filter-"]')?.addEventListener('change', e => { workspaceState(view).filter = e.target.value; applyWorkspaceFilters(view); });
    if (view !== 'profiles') {
      const target = document.getElementById(targetId);
      new MutationObserver(() => { decorateWorkspaceRows(view); applyWorkspaceFilters(view); }).observe(target, { childList:true });
      target.addEventListener('change', () => applyWorkspaceFilters(view));
    }
  }
  setupWorkspaceProfileOrdering();
  document.getElementById('workspace-group').addEventListener('change', e => { workspaceState('profiles').group = e.target.value; applyWorkspaceFilters('profiles'); });
  document.getElementById('workspace-sort').addEventListener('change', e => { workspaceState('profiles').sort = e.target.value; renderWorkspaceProfiles(); });
  for (const button of document.querySelectorAll('.workspace-density')) button.addEventListener('click', () => { document.body.dataset.density = document.body.dataset.density === 'compact' ? 'comfortable' : 'compact'; workspaceWrite('density', document.body.dataset.density); updateWorkspaceDensity(); });
  updateWorkspaceDensity();
  setupWorkspacePasswords(document);
  setupWorkspaceProxyInput('px'); setupWorkspaceProxyInput('create');
  document.querySelector('#modal-proxy .modal-head > span').textContent = 'Cấu hình proxy';
  const hint = document.createElement('p'); hint.className = 'proxy-paste-hint'; hint.textContent = 'Dán host:port hoặc host:port:user:pass vào ô Host để tự điền các trường.'; document.querySelector('#modal-proxy .modal-body').prepend(hint);
  const createHint = document.createElement('p'); createHint.className = 'proxy-paste-hint'; createHint.textContent = 'Không dùng proxy? Để trống các ô bên dưới. Có thể dán cả chuỗi proxy vào ô IP.'; document.querySelector('.create-left h4').after(createHint);
  document.querySelector('#modal-create-profile [onclick="randomizeProfile()"]')?.replaceChildren(document.createTextNode('Tạo cấu hình mới'));
  document.querySelector('#modal-create-profile [onclick="saveNewProfile()"]')?.replaceChildren(document.createTextNode('Tạo hồ sơ'));
  document.querySelector('#modal-proxy [onclick="runCheckProxy()"]')?.replaceChildren(document.createTextNode('Kiểm tra proxy'));
  document.getElementById('auth-email').previousElementSibling.setAttribute('for', 'auth-email');
  document.getElementById('auth-password').closest('.password-wrap').previousElementSibling.setAttribute('for', 'auth-password');
  installWorkspaceDialogs();
  document.addEventListener('keydown', workspaceKeyboard);
  document.addEventListener('click', e => { for (const menu of document.querySelectorAll('.column-menu[open]')) if (!menu.contains(e.target)) menu.open = false; });
}

function updateWorkspaceDensity() {
  const compact = document.body.dataset.density === 'compact';
  document.querySelectorAll('.workspace-density').forEach(button => { button.textContent = compact ? 'Hàng gọn' : 'Hàng thoáng'; button.setAttribute('aria-pressed', String(compact)); });
}

function setWorkspaceCount(view, count, total) {
  const element = document.getElementById('workspace-count-' + view);
  if (element) element.textContent = count === total ? `${total} mục` : `${count} / ${total} mục`;
  const nav = document.getElementById('nav-' + view);
  if (nav) { let badge = nav.querySelector('.nav-count'); if (!badge) { badge = document.createElement('span'); badge.className = 'nav-count'; nav.append(badge); } badge.textContent = String(total); }
  const foot = document.getElementById('workspace-footer-' + view);
  if (foot && view !== 'profiles') foot.textContent = total ? `${count} mục đang hiển thị` : 'Danh sách chưa có dữ liệu';
}

function profileMatchesWorkspace(profile) {
  const state = workspaceState('profiles'); if (!state) return true;
  if (!workspaceMatches([profile.name, profile.group, profile.proxyIp, profile.proxyPort, profile.note].join(' '), state.query)) return false;
  if (state.group === '__ungrouped' ? !!profile.groupId : state.group && profile.groupId !== state.group) return false;
  if (state.filter === 'running') return runningProfiles.has(profile.id);
  if (state.filter === 'stopped') return !runningProfiles.has(profile.id);
  if (state.filter === 'cloud') return !!profile.cloudProfileId;
  if (state.filter === 'snapshot') return profile.cloudSyncMode==='snapshot';
  if (state.filter === 'proxy') return !!profile.proxyIp;
  if (state.filter === 'direct') return !profile.proxyIp;
  return true;
}

function workspaceRowText(row, view) {
  if (view === 'extensions') return row.querySelector('strong')?.textContent + ' ' + row.querySelector('p')?.textContent;
  if (view === 'admin-users') return row.cells[0]?.textContent || '';
  return Array.from(row.cells).slice(0,-1).map(cell => cell.textContent).join(' ');
}

function applyWorkspaceFilters(view) {
  const state = workspaceState(view); if (!state) return;
  const target = document.getElementById(workspaceViews[view][3]);
  if (view === 'profiles') {
    let count = 0; const indexed = new Map(profilesList.map(profile => [profile.id,profile]));
    for (const row of target.querySelectorAll('tr[data-profile-id]')) { const profile = indexed.get(row.dataset.profileId), hidden = !profile || !profileMatchesWorkspace(profile); if (row.hidden !== hidden) clearWorkspaceProfileDrag(); row.hidden = hidden; if (!row.hidden) count++; }
    const empty = target.querySelector('.workspace-no-results'); if (empty) empty.hidden = !profilesList.length || count > 0;
    setWorkspaceCount(view, count, profilesList.length); updateWorkspaceSelection(); return;
  }
  const rows = Array.from(target.children).filter(row => view === 'extensions' ? row.classList.contains('ext-card') : row.tagName === 'TR' && row.cells.length > 1 && !row.classList.contains('user-profiles-expansion') && !row.id.startsWith('row-group-'));
  let count = 0;
  for (const row of rows) {
    let matches = workspaceMatches(workspaceRowText(row, view), state.query);
    if (state.filter) {
      if (view === 'admin-users') matches &&= Array.from(row.querySelectorAll('select')).some(select => select.value === state.filter);
      if (view === 'extensions') matches &&= row.querySelector('input[type="checkbox"]')?.checked === (state.filter === 'enabled');
      if (view === 'trash') matches &&= row.cells[0].textContent.trim() === state.filter;
    }
    row.hidden = !matches;
    if (matches) count++;
    if (view === 'admin-users' && row.nextElementSibling?.classList.contains('user-profiles-expansion')) { const expansion = row.nextElementSibling; const id = expansion.id.slice('user-profiles-'.length); expansion.hidden = !matches || !expandedAdminUsers.has(id); }
    if (view === 'groups' && row.nextElementSibling?.id.startsWith('row-group-')) row.nextElementSibling.hidden = !matches;
  }
  let empty = target.querySelector(':scope > .workspace-no-results');
  if (!empty && rows.length) { empty = document.createElement(view === 'extensions' ? 'div' : 'tr'); empty.className = 'workspace-no-results workspace-empty'; empty.hidden = true; if (view === 'extensions') { empty.style.gridColumn = '1 / -1'; empty.textContent = 'Không tìm thấy tiện ích phù hợp.'; } else empty.innerHTML = `<td colspan="${rows[0].cells.length}"><strong>Không tìm thấy kết quả</strong>Thử tên khác hoặc bỏ bộ lọc đang chọn.</td>`; target.append(empty); }
  if (empty) empty.hidden = !rows.length || count > 0;
  setWorkspaceCount(view, count, rows.length);
}

function decorateWorkspaceRows(view) {
  if (view !== 'admin-users') return;
  for (const row of document.querySelectorAll('#table-admin-users > tr')) {
    const role = row.querySelector('[id^="admin-role-"]'), status = row.querySelector('[id^="admin-status-"]');
    if (!role || row.dataset.workspaceDecorated) continue;
    const id = role.id.slice('admin-role-'.length), save = row.querySelector('.btn-blue'), flow=row.querySelector('[id^="admin-flow-"]'); if(flow)flow.dataset.original=flow.dataset.grant;
    row.dataset.workspaceDecorated = 'true'; role.dataset.original = role.value; status.dataset.original = status.value;
    const draft = workspaceAdminDrafts.get(id); if (draft) { role.value = draft.role; status.value = draft.status; if(flow)flow.dataset.grant=String(draft.automationEnabled); }
    const update = () => { if(flow){flow.disabled=role.value==='admin'||flow.dataset.schemaReady==='false'||currentAccount?.automation_schema_ready===false;flow.checked=role.value==='admin'||flow.dataset.grant==='true';} const dirty = role.value !== role.dataset.original || status.value !== status.dataset.original || (flow && flow.dataset.grant!==flow.dataset.original); row.classList.toggle('is-dirty', dirty); save.disabled = !dirty; save.textContent = dirty ? 'Lưu đổi' : 'Đã lưu'; if (dirty) workspaceAdminDrafts.set(id, {role:role.value,status:status.value,automationEnabled:flow?.dataset.grant==='true'}); else workspaceAdminDrafts.delete(id); };
    role.setAttribute('aria-label', 'Vai trò của ' + row.cells[0].textContent); status.setAttribute('aria-label', 'Trạng thái của ' + row.cells[0].textContent);
    if(flow)flow.addEventListener('change',()=>{flow.dataset.grant=String(flow.checked);update();}); role.addEventListener('change', update); status.addEventListener('change', update); update();
  }
}

async function loadProfilesTable() {
  const request = ++workspaceProfileRequest, accountId = workspaceAccountId;
  try {
    const [groups, profiles] = await Promise.all([window.api.getGroups(), window.api.getProfiles()]);
    await refreshWorkspaceRuntime();
    if (request !== workspaceProfileRequest || accountId !== workspaceAccountId) return;
    globalGroups = groups || []; profilesList = profiles || [];
    const ids = new Set(profilesList.map(p => p.id)); for (const id of workspaceSelection) if (!ids.has(id)) workspaceSelection.delete(id);
    const tbody = document.getElementById('table-profiles');
    if (tbody.dataset.workspaceReady === 'true' && workspaceProfileSignature === JSON.stringify([globalGroups,profilesList])) {
      updateWorkspaceStats(); applyWorkspaceFilters('profiles'); void autoPingProfiles(profilesList); return;
    }
    renderWorkspaceProfiles();
  } catch (error) {
    if (request !== workspaceProfileRequest || accountId !== workspaceAccountId) return;
    const tbody = document.getElementById('table-profiles'); tbody.dataset.workspaceReady = 'false';
    tbody.innerHTML = `<tr class="workspace-empty"><td colspan="11"><strong>Chưa tải được danh sách</strong>${escapeHtml(readableAppError(error))}<br><button type="button" class="btn-test" onclick="loadProfilesTable()">Thử lại</button></td></tr>`;
    setWorkspaceCount('profiles', 0, 0);
  }
}

function renderWorkspaceProfiles() {
  clearWorkspaceProfileDrag();
  const tbody = document.getElementById('table-profiles');
  tbody.dataset.workspaceReady = 'true'; workspaceProfileSignature = JSON.stringify([globalGroups,profilesList]);
  let rows = profilesList.map((profile, index) => ({profile, index}));
  const sort = workspaceState('profiles')?.sort;
  if (sort === 'original') {
    const order = new Map(workspaceOrderedProfileIds().map((id, index) => [id, index]));
    rows.sort((a,b) => order.get(a.profile.id) - order.get(b.profile.id));
  }
  if (sort === 'name') rows.sort((a,b) => String(a.profile.name || '').localeCompare(String(b.profile.name || ''), 'vi', {numeric:true}));
  if (sort === 'newest') rows.reverse(); // Local records are appended on creation; dates may be locale-formatted.
  tbody.innerHTML = rows.map(({profile:p},index) => {
    const id = inlineArg(p.id), htmlId = escapeHtml(p.id), name = inlineArg(p.name), note = inlineArg(p.note || '');
    const running = runningProfiles.has(p.id), launching = workspaceLaunches.has(p.id)||workspaceProfileBusy(p.id);
    const tz = p.proxyIp ? p.proxyTimezone || '' : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const proxy = p.proxyIp ? `<span class="badge badge-blue proxy-badge" title="${escapeHtml(p.proxyIp)}:${escapeHtml(p.proxyPort)}">⇄ <span class="proxy-address">${escapeHtml(p.proxyIp)}:${escapeHtml(p.proxyPort)}</span></span>` : '<span class="badge badge-gray">Mạng cục bộ</span>';
    return `<tr data-profile-id="${htmlId}"><td><input type="checkbox" aria-label="Chọn ${escapeHtml(p.name)}" onchange="selectWorkspaceProfile(${id},this.checked)"></td><td><div class="profile-position"><button type="button" class="profile-drag-handle" draggable="${sort === 'original' && !!workspaceAccountId}" aria-label="Sắp xếp ${escapeHtml(p.name)}" aria-disabled="${sort !== 'original' || !workspaceAccountId}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="${sort === 'original' ? 'Kéo để đổi vị trí · Alt + ↑ / ↓' : 'Chọn Thứ tự tùy chỉnh để di chuyển hồ sơ'}"><svg viewBox="0 0 16 20" aria-hidden="true"><path d="M5 4h.01M11 4h.01M5 10h.01M11 10h.01M5 16h.01M11 16h.01"/></svg></button><span>${index + 1}</span></div></td><td><select class="inline-select" aria-label="Nhóm của ${escapeHtml(p.name)}" data-original="${escapeHtml(p.groupId || '')}" onchange="changeProfileGroup(${id},this)"><option value="">Chưa chia nhóm</option>${globalGroups.map(g => `<option value="${escapeHtml(g.id)}" ${g.id === p.groupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}<option value="NEW_GROUP">+ Tạo nhóm mới</option></select></td><td><div class="editable-cell left" role="button" tabindex="0" title="Đổi tên hồ sơ" onclick="quickEditName(${id},${name})" onkeydown="workspaceActivate(event)">${WIN_SVG}<strong title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</strong>${PENCIL_SVG}</div></td><td><div class="editable-cell center" role="button" tabindex="0" aria-label="Sửa proxy cho ${escapeHtml(p.name)}" onclick="openProxyEditModal(${id})" onkeydown="workspaceActivate(event)">${proxy}${PENCIL_SVG}</div></td><td class="tz-cell-${htmlId}">${tz ? `<span class="live-clock badge badge-gray" data-tz="${escapeHtml(tz)}">${CLOCK_SVG}--:--</span>` : '<span class="badge badge-gray">Chưa rõ</span>'}</td><td class="ping-cell-${htmlId}">${SPINNER_SVG}</td><td>Windows</td><td><div class="editable-cell left" role="button" tabindex="0" aria-label="Sửa ghi chú" onclick="quickEditNote(${id},${note})" onkeydown="workspaceActivate(event)"><span title="${escapeHtml(p.note || '')}">${escapeHtml(p.note && p.note !== '-' ? p.note : 'Thêm ghi chú')}</span>${PENCIL_SVG}</div></td><td>${escapeHtml(p.createdAt || '—')}</td><td><div class="row-actions"><button type="button" id="btn-${htmlId}" class="${running ? 'btn-running' : 'btn-open'}" ${launching ? 'disabled' : ''} title="${running ? 'Đóng trình duyệt' : 'Mở trình duyệt'}" onclick="toggleBrowser(${id})">${workspacePhaseLabels[workspaceRuntime.get(p.id)]||(launching ? 'Đợi…' : running ? 'Đang chạy' : 'Mở')}</button><button type="button" class="btn-del" title="Đưa vào thùng rác" aria-label="Xóa ${escapeHtml(p.name)}" onclick="deleteProfile(${id})"><svg class="icon-svg" viewBox="0 0 24 24"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/></svg></button></div></td></tr>`;
  }).join('');
  if (!rows.length) tbody.innerHTML = '<tr class="workspace-empty"><td colspan="11"><strong>Không gian làm việc của bạn đã sẵn sàng</strong>Tạo hồ sơ để bắt đầu. Dữ liệu trình duyệt được lưu trên máy này.<br><br><button type="button" class="btn-blue" onclick="openCreateProfileModal()">+ Tạo hồ sơ đầu tiên</button></td></tr>';
  else tbody.insertAdjacentHTML('beforeend', '<tr class="workspace-no-results workspace-empty" hidden><td colspan="11"><strong>Không tìm thấy hồ sơ phù hợp</strong>Thử tìm kiếm khác hoặc chọn lại nhóm và trạng thái.</td></tr>');
  updateWorkspaceGroupOptions(); updateWorkspaceStats(); applyWorkspaceFilters('profiles');
  // Reuse the existing cache; render does not generate extra requests while searching.
  void autoPingProfiles(profilesList); updateLiveClocks();
}


// Account-scoped display preferences; moving a row never edits a profile archive.
function workspaceOrderedProfileIds() {
  const ids = profilesList.map(profile => profile.id), available = new Set(ids);
  let saved = [];
  try {
    const value = workspaceAccountId ? JSON.parse(workspaceRead('profile_order_' + workspaceAccountId) || '[]') : [];
    if (Array.isArray(value)) saved = value.filter(id => typeof id === 'string' && available.has(id));
  } catch {}
  return Array.from(new Set([...saved, ...ids]));
}

function clearWorkspaceProfileDrag() {
  workspaceProfileDrag = null;
  document.querySelectorAll('#table-profiles .profile-dragging, #table-profiles .profile-drop-before, #table-profiles .profile-drop-after').forEach(row => row.classList.remove('profile-dragging', 'profile-drop-before', 'profile-drop-after'));
}

function moveWorkspaceProfile(sourceId, targetId, after) {
  if (!workspaceAccountId || workspaceState('profiles')?.sort !== 'original' || sourceId === targetId) return false;
  const visible = Array.from(document.querySelectorAll('#table-profiles tr[data-profile-id]:not([hidden])')).map(row => row.dataset.profileId);
  if (!visible.includes(sourceId) || !visible.includes(targetId)) return false;
  const reordered = visible.filter(id => id !== sourceId);
  reordered.splice(reordered.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);
  if (reordered.every((id,index) => id === visible[index])) return false;
  // Keep filtered-out profiles in their existing positions in the full list.
  const visibleIds = new Set(visible); let cursor = 0;
  const order = workspaceOrderedProfileIds().map(id => visibleIds.has(id) ? reordered[cursor++] : id);
  try { localStorage.setItem('td_ui_profile_order_' + workspaceAccountId, JSON.stringify(order)); }
  catch { workspaceToast('Không lưu được thứ tự hồ sơ. Hãy thử lại.', true); return false; }
  renderWorkspaceProfiles();
  const handle = Array.from(document.querySelectorAll('#table-profiles tr[data-profile-id]')).find(row => row.dataset.profileId === sourceId)?.querySelector('.profile-drag-handle');
  handle?.focus({preventScroll:true});
  workspaceToast('Đã lưu thứ tự hồ sơ trên máy này.');
  return true;
}

function setupWorkspaceProfileOrdering() {
  const body = document.getElementById('table-profiles');
  body.addEventListener('dragstart', event => {
    const handle = event.target.closest('.profile-drag-handle');
    if (!handle || handle.getAttribute('aria-disabled') === 'true' || !event.dataTransfer) { event.preventDefault(); return; }
    clearWorkspaceProfileDrag();
    const row = handle.closest('tr[data-profile-id]');
    workspaceProfileDrag = {id:row.dataset.profileId, accountId:workspaceAccountId};
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.profileId);
    event.dataTransfer.setDragImage(row, Math.min(60, row.offsetWidth / 2), row.offsetHeight / 2);
    row.classList.add('profile-dragging');
  });
  body.addEventListener('dragover', event => {
    const row = event.target.closest('tr[data-profile-id]');
    body.querySelectorAll('.profile-drop-before, .profile-drop-after').forEach(item => item.classList.remove('profile-drop-before', 'profile-drop-after'));
    if (!workspaceProfileDrag || workspaceProfileDrag.accountId !== workspaceAccountId || workspaceState('profiles')?.sort !== 'original' || !row || row.hidden) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (row.dataset.profileId === workspaceProfileDrag.id) return;
    const rect = row.getBoundingClientRect();
    row.classList.add(event.clientY >= rect.top + rect.height / 2 ? 'profile-drop-after' : 'profile-drop-before');
    const scroller = body.closest('.table-card');
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      if (event.clientY < bounds.top + 44) scroller.scrollTop -= 20;
      else if (event.clientY > bounds.bottom - 44) scroller.scrollTop += 20;
    }
  });
  body.addEventListener('drop', event => {
    const drag = workspaceProfileDrag, row = event.target.closest('tr[data-profile-id]');
    if (!drag) return;
    event.preventDefault();
    const after = row?.classList.contains('profile-drop-after');
    clearWorkspaceProfileDrag();
    if (drag.accountId === workspaceAccountId && row && !row.hidden) moveWorkspaceProfile(drag.id, row.dataset.profileId, after);
  });
  body.addEventListener('dragleave', event => {
    if (!body.contains(event.relatedTarget)) body.querySelectorAll('.profile-drop-before, .profile-drop-after').forEach(row => row.classList.remove('profile-drop-before', 'profile-drop-after'));
  });
  document.addEventListener('dragend', clearWorkspaceProfileDrag);
  document.addEventListener('drop', clearWorkspaceProfileDrag);
  body.addEventListener('click', event => {
    if (event.target.closest('.profile-drag-handle')?.getAttribute('aria-disabled') === 'true') workspaceToast('Chọn “Thứ tự tùy chỉnh” để di chuyển hồ sơ.');
  });
  body.addEventListener('keydown', event => {
    const handle = event.target.closest('.profile-drag-handle');
    if (!handle || !event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (handle.getAttribute('aria-disabled') === 'true') { workspaceToast('Chọn “Thứ tự tùy chỉnh” để di chuyển hồ sơ.'); return; }
    const visible = Array.from(body.querySelectorAll('tr[data-profile-id]:not([hidden])'));
    const row = handle.closest('tr[data-profile-id]'), index = visible.indexOf(row), down = event.key === 'ArrowDown';
    const target = visible[index + (down ? 1 : -1)];
    if (target) moveWorkspaceProfile(row.dataset.profileId, target.dataset.profileId, down);
  });
}

function updateWorkspaceGroupOptions() {
  const filter = document.getElementById('workspace-group'), move = document.getElementById('workspace-move-group'); if (!filter || !move) return;
  const current = workspaceState('profiles').group, destination = move.value;
  const options = globalGroups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
  filter.innerHTML = '<option value="">Tất cả nhóm</option><option value="__ungrouped">Chưa chia nhóm</option>' + options;
  filter.value = current;
  if (filter.selectedIndex < 0) { filter.value = ''; workspaceState('profiles').group = ''; }
  move.innerHTML = '<option value="">Bỏ khỏi nhóm</option>' + options; move.value = destination; if (move.selectedIndex < 0) move.value = '';
}
function updateWorkspaceStats() {
  const element = document.getElementById('workspace-stats'); if (!element) return;
  element.innerHTML = `<span class="stat-chip"><span class="stat-dot"></span><strong>${profilesList.length}</strong> Hồ sơ</span><span class="stat-chip running"><span class="stat-dot"></span><strong>${profilesList.filter(p => runningProfiles.has(p.id)).length}</strong> Đang chạy</span><span class="stat-chip"><strong>${globalGroups.length}</strong> Nhóm</span><span class="workspace-tip">Kéo ⋮⋮ cạnh số thứ tự để sắp xếp · Bấm tên hoặc proxy để sửa</span>`;
}
function workspaceActivate(event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } }
function selectWorkspaceProfile(id, checked) { if (checked) workspaceSelection.add(id); else workspaceSelection.delete(id); updateWorkspaceSelection(); }
function clearWorkspaceSelection() { workspaceSelection.clear(); updateWorkspaceSelection(); }
function updateWorkspaceSelection() {
  const visible = [];
  document.querySelectorAll('#table-profiles tr[data-profile-id]').forEach(row => { const checked = workspaceSelection.has(row.dataset.profileId); row.querySelector('input[type="checkbox"]').checked = checked; row.classList.toggle('is-selected', checked); if (!row.hidden) visible.push(row.dataset.profileId); });
  const selectedVisible = visible.filter(id => workspaceSelection.has(id)).length, all = document.getElementById('workspace-select-all');
  if (all) { all.checked = visible.length > 0 && selectedVisible === visible.length; all.indeterminate = selectedVisible > 0 && selectedVisible < visible.length; all.disabled = !visible.length || workspaceBulkBusy; }
  const bar = document.getElementById('workspace-selection'); if (!bar) return;
  bar.hidden = workspaceSelection.size === 0;
  document.getElementById('workspace-selection-count').textContent = `${workspaceSelection.size} hồ sơ đã chọn${workspaceSelection.size > selectedVisible ? ` · ${workspaceSelection.size - selectedVisible} ngoài bộ lọc` : ''}`;
  bar.querySelectorAll('button,select').forEach(button => button.disabled = workspaceBulkBusy);
}

async function openWorkspaceSelection() {
  if (workspaceBulkBusy) return;
  const targets = profilesList.filter(p => workspaceSelection.has(p.id) && !runningProfiles.has(p.id) && !workspaceProfileBusy(p.id));
  if (!targets.length) return workspaceToast('Các hồ sơ đã chọn đều đang chạy.');
  if (targets.length > 1 && !confirm(`Mở ${targets.length} hồ sơ đã chọn? Mỗi hồ sơ sẽ mở một cửa sổ trình duyệt.`)) return;
  workspaceBulkBusy = true; updateWorkspaceSelection(); let opened = 0; const errors = [];
  try {
    for (const profile of targets) { try { const result = await window.api.launchProfile(profile.id); if (!result?.success) throw new Error(result?.error || 'Không mở được'); runningProfiles.add(profile.id); opened++; } catch (error) { errors.push(profile.name + ': ' + readableAppError(error)); } }
    await loadProfilesTable();
    workspaceToast(`Đã mở ${opened}/${targets.length} hồ sơ.`);
    if (errors.length) workspaceToast(errors.join('\n'), true);
  } finally { workspaceBulkBusy = false; updateWorkspaceSelection(); }
}
async function moveWorkspaceSelection() {
  if (workspaceBulkBusy || !workspaceSelection.size) return;
  const select = document.getElementById('workspace-move-group'), groupId = select.value;
  const group = globalGroups.find(g => g.id === groupId)?.name || 'Chưa chia nhóm';
  const targets = profilesList.filter(p => workspaceSelection.has(p.id) && (p.groupId || '') !== groupId);
  if (!targets.length) return workspaceToast('Các hồ sơ đã ở trong nhóm này.');
  workspaceBulkBusy = true; updateWorkspaceSelection(); let updated = 0; const errors = [];
  try {
    for (const profile of targets) { try { if (!await window.api.updateProfile(profile.id, {groupId,group})) throw new Error('Không lưu được'); updated++; } catch (error) { errors.push(profile.name + ': ' + readableAppError(error)); } }
    await loadProfilesTable(); workspaceToast(`Đã chuyển ${updated}/${targets.length} hồ sơ: ${group}.`);
    if (errors.length) workspaceToast(errors.join('\n'), true);
  } finally { workspaceBulkBusy = false; updateWorkspaceSelection(); }
}

function setupWorkspacePasswords(root) {
  for (const input of root.querySelectorAll('input[type="password"],#px-pass,#create-pass')) {
    if (input.id === 'account-input-value' || input.closest('.password-wrap')) continue;
    input.type = 'password';
    const wrapper = document.createElement('span'); wrapper.className = 'password-wrap'; input.replaceWith(wrapper); wrapper.append(input);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'password-toggle'; button.textContent = 'Hiện'; button.setAttribute('aria-label', 'Hiện mật khẩu'); button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => { const reveal = input.type === 'password'; input.type = reveal ? 'text' : 'password'; button.textContent = reveal ? 'Ẩn' : 'Hiện'; button.setAttribute('aria-label', reveal ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'); button.setAttribute('aria-pressed', String(reveal)); }); wrapper.append(button);
  }
}
function resetWorkspacePasswords(root) { root.querySelectorAll('.password-wrap').forEach(wrapper => { const input = wrapper.querySelector('input'), button = wrapper.querySelector('button'); input.type = 'password'; button.textContent = 'Hiện'; button.setAttribute('aria-label','Hiện mật khẩu'); button.setAttribute('aria-pressed','false'); }); }

function parseWorkspaceProxy(text) {
  text = text.trim(); if (!text || /\s/.test(text)) return null;
  let host, port, user = '', pass = '';
  if (/^https?:\/\//i.test(text) || text.includes('@')) {
    try { const url = new URL(/^https?:\/\//i.test(text) ? text : 'http://' + text); if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) return null; host = url.hostname; port = url.port || (url.protocol === 'https:' ? '443' : '80'); user = decodeURIComponent(url.username); pass = decodeURIComponent(url.password); } catch { return null; }
  } else {
    const parts = text.split(':'); if (parts.length !== 2 && parts.length < 4) return null;
    [host, port] = parts; if (parts.length >= 4) { user = parts[2]; pass = parts.slice(3).join(':'); }
  }
  // Existing proxy transport accepts IPv4 addresses and hostnames.
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return null;
  return {host,port,user,pass};
}
function setupWorkspaceProxyInput(prefix) {
  const host = document.getElementById(prefix + '-ip');
  host.addEventListener('paste', event => {
    const proxy = parseWorkspaceProxy(event.clipboardData?.getData('text') || ''); if (!proxy) return;
    event.preventDefault(); for (const [field, value] of [['ip',proxy.host],['port',proxy.port],['user',proxy.user],['pass',proxy.pass]]) { const input = document.getElementById(prefix + '-' + field); input.value = value; input.dispatchEvent(new Event('input', {bubbles:true})); }
    workspaceToast('Đã tách thông tin proxy vào các ô.');
  });
  const port = document.getElementById(prefix + '-port'); port.inputMode = 'numeric'; port.maxLength = 5;
  if (prefix === 'px') for (const field of ['ip','port','user','pass']) document.getElementById(prefix + '-' + field).addEventListener('input', () => { workspaceProxyCheck++; delete document.getElementById('modal-proxy').dataset.country; document.getElementById('px-result').style.display = 'none'; });
}
function validateWorkspaceProxy(prefix, optional = true) {
  const host = document.getElementById(prefix + '-ip'), port = document.getElementById(prefix + '-port');
  if (!host.value.trim() && !port.value.trim() && optional) return true;
  if (!host.value.trim() || !/^\d+$/.test(port.value.trim()) || Number(port.value) < 1 || Number(port.value) > 65535) { workspaceToast('Nhập Host và cổng proxy hợp lệ từ 1 đến 65535.', true); (!host.value.trim() ? host : port).focus(); return false; }
  return true;
}

async function runCheckProxy() {
  if (!validateWorkspaceProxy('px', false)) return;
  const generation = ++workspaceProxyCheck, modal = document.getElementById('modal-proxy'), box = document.getElementById('px-result');
  const button = modal.querySelector('[onclick="runCheckProxy()"]'); button.disabled = true; button.textContent = 'Đang kiểm tra…';
  box.style.display = 'block'; box.textContent = 'Đang kiểm tra kết nối qua proxy…';
  const proxy = Object.fromEntries(['ip','port','user','pass'].map(field => [field,document.getElementById('px-' + field).value.trim()]));
  try {
    const result = await window.api.checkProxy(proxy);
    if (generation !== workspaceProxyCheck || modal.style.display === 'none') return;
    if (!result?.success) throw new Error(result?.error || 'Không kết nối được proxy.');
    box.innerHTML = `<strong style="color:var(--success)">Kết nối thành công</strong><br>IP ra mạng: ${escapeHtml(result.ip)}<br>Độ trễ: ${escapeHtml(result.ping)} ms${result.timezone ? '<br>Múi giờ: ' + escapeHtml(result.timezone) : ''}`;
    modal.dataset.country = result.country || '';
  } catch (error) { if (generation === workspaceProxyCheck) { box.textContent = readableAppError(error); box.style.display = 'block'; } }
  finally { button.disabled = false; button.textContent = 'Kiểm tra proxy'; }
}

function workspaceKeyboard(event) {
  const authOpen = document.getElementById('auth-overlay').style.display !== 'none';
  const modalOpen = Array.from(document.querySelectorAll('.modal-overlay')).some(el => getComputedStyle(el).display !== 'none');
  if (authOpen && !modalOpen && event.key === 'Tab') {
    const fields = Array.from(document.querySelectorAll('.auth-card button,.auth-card input')).filter(el => !el.disabled && el.getClientRects().length), first = fields[0], last = fields[fields.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (authOpen || modalOpen || !currentAccount) return;
  const panel = document.querySelector('.view-panel.active'), input = panel?.querySelector('.workspace-search input');
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f' && input) { event.preventDefault(); input.focus(); input.select(); }
  if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') { event.preventDefault(); void openCreateProfileModal(); }
  if (event.key === 'Escape') { document.querySelectorAll('.column-menu[open]').forEach(menu => menu.open = false); if (document.activeElement === input && input.value) { input.value = ''; input.dispatchEvent(new Event('input')); } }
}

function installWorkspaceDialogs() {
  const visible = new Map();
  const refresh = () => {
    for (const overlay of document.querySelectorAll('.modal-overlay')) {
      const shown = getComputedStyle(overlay).display !== 'none';
      if (shown && !visible.has(overlay)) {
        visible.set(overlay, document.activeElement);
        const box = overlay.querySelector('.modal-box'); box?.setAttribute('role','dialog'); box?.setAttribute('aria-modal','true');
        const title = overlay.querySelector('.modal-head > span,h3'); if (title) { title.id ||= overlay.id + '-heading'; box?.setAttribute('aria-labelledby',title.id); }
        setupWorkspacePasswords(overlay);
        for (const close of overlay.querySelectorAll('.close-btn:not(button)')) { close.tabIndex = 0; close.setAttribute('role','button'); close.setAttribute('aria-label','Đóng'); close.onkeydown = workspaceActivate; }
        // Account/security dialogs already manage their own focus.
        if (!['modal-account-input','modal-account-security'].includes(overlay.id)) requestAnimationFrame(() => { if (!overlay.contains(document.activeElement)) overlay.querySelector('input:not([type="hidden"]):not(:disabled),select,button')?.focus(); });
      } else if (!shown && visible.has(overlay)) {
        const previous = visible.get(overlay); visible.delete(overlay); resetWorkspacePasswords(overlay);
        if (previous?.isConnected && !Array.from(visible.keys()).some(item => !item.contains(previous))) requestAnimationFrame(() => previous.focus());
      }
    }
    const blocked = visible.size > 0 || getComputedStyle(document.getElementById('auth-overlay')).display !== 'none';
    document.getElementById('main-workspace').inert = blocked;
    document.querySelector('.sidebar').inert = blocked;
  };
  new MutationObserver(refresh).observe(document.body, {subtree:true,attributes:true,attributeFilter:['style'],childList:true});
  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const overlays = Array.from(visible.keys()).filter(el => !['modal-account-input','modal-account-security'].includes(el.id));
    if (!overlays.length || document.getElementById('modal-account-input').style.display === 'flex' || document.getElementById('modal-account-security').style.display === 'flex') return;
    const overlay = overlays[overlays.length - 1], focusable = Array.from(overlay.querySelectorAll('button,input,select,textarea,[tabindex="0"]')).filter(el => !el.disabled && el.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  refresh();
}

// Integrate small interaction improvements without changing authentication or Cloud APIs.
const workspaceOriginalShowAccount = showAccount;
showAccount = function(account) {
  if (workspaceAccountId !== account?.id) {
    clearWorkspaceProfileDrag(); workspaceProfileRequest++; workspaceProfileSignature = '';
    workspaceAccountId = account?.id; workspaceRuntime.clear();workspaceRuntimeGeneration++;runningProfiles.clear(); workspaceSelection.clear(); workspaceAdminDrafts.clear();
    expandedAdminUsers.clear(); selectedAdminUser = null;
    workspaceStates.forEach((state, view) => { Object.assign(state,{query:'',filter:'',group:'',sort:'original'}); const search = document.getElementById('workspace-search-' + view); if (search) { search.value = ''; search.dispatchEvent(new Event('input')); } const filter = document.getElementById('workspace-filter-' + view); if (filter) filter.selectedIndex = 0; });
    document.getElementById('workspace-group').selectedIndex = 0; document.getElementById('workspace-sort').selectedIndex = 0;
    document.getElementById('workspace-account').open = false;
  }
  workspaceOriginalShowAccount(account);
  document.getElementById('workspace-avatar').textContent = account?.email?.slice(0,2).toUpperCase() || 'TD';
  document.getElementById('app-account-email').title = account?.email || '';
  resetWorkspacePasswords(document.getElementById('auth-overlay'));
};

const workspaceOriginalSwitchView = switchView;
switchView = function(view) { workspaceOriginalSwitchView(view); document.querySelectorAll('.nav-btn').forEach(button => { if (button.classList.contains('active')) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); }); };

const workspaceOriginalChangeGroup = changeProfileGroup;
changeProfileGroup = async function(id, select) { const original = select.dataset.original; try { await workspaceOriginalChangeGroup(id,select); if (select.value !== original && select.value !== 'NEW_GROUP') { await loadProfilesTable(); workspaceToast('Đã cập nhật nhóm hồ sơ.'); } } catch (error) { select.value = original; workspaceToast(readableAppError(error),true); } };

toggleBrowser = async function(id) {
  if (workspaceLaunches.has(id) || workspaceBulkBusy || workspaceProfileBusy(id)) return;
  workspaceLaunches.add(id);
  const buttons = () => Array.from(document.querySelectorAll('[id^="btn-"]')).filter(button => button.id === 'btn-' + id || button.id === 'btn-' + id + '-grp');
  buttons().forEach(button => { button.disabled = true; button.textContent = 'Đợi…'; });
  try {
    if (runningProfiles.has(id)) { const result=await window.api.closeProfile(id);if(result?.success===false)throw Error(result.error||'Không đóng được hồ sơ.');applyWorkspaceRuntime([{profileId:id,phase:result?.status==='stopped'?'stopped':result?.status==='syncing'?'syncing':'closing'}]); }
    else { const result = await window.api.launchProfile(id); if (!result?.success) { throw new Error(result?.error || 'Không mở được hồ sơ.'); } runningProfiles.add(id); }
  } catch (error) { workspaceToast(readableAppError(error),true); }
  finally { workspaceLaunches.delete(id);await refreshWorkspaceRuntime();applyWorkspaceRuntime([]); }
};

// Serialise form submission, show busy state and keep data on errors.
async function makeWorkspaceLocalSnapshot(id,fromLock=false){
  const profile=profilesList.find(p=>p.id===id);if(!profile)return false;
  if(!confirm((fromLock?'Cloud còn khóa hồ sơ này. ':'')+'Chuyển “'+profile.name+'” thành bản độc lập bằng dữ liệu đang có trên máy?\n\nHồ sơ không tự cập nhật hoặc đồng bộ lên Cloud. Bản Cloud vẫn được giữ. Muốn lấy dữ liệu mới, xóa bản trên máy rồi tải lại.'))return false;
  try{const result=await window.api.makeLocalSnapshot(id);await loadProfilesTable();workspaceToast('Đã chuyển sang bản độc lập trên máy.');return !!result?.profile;}
  catch(error){workspaceToast(readableAppError(error),true);return false;}
}

function workspaceGuardAction(name, original, validate) {
  let busy = false;
  return async function(...args) {
    if (busy || validate && !validate()) return;
    busy = true; const overlay = document.getElementById(name), buttons = Array.from(overlay.querySelectorAll('.modal-foot button,.create-right > div:last-child button'));
    const states = buttons.map(button => ({button, disabled:button.disabled, text:button.textContent}));
    states.forEach(({button}) => button.disabled = true);
    const primary = buttons.find(button => button.classList.contains('btn-blue')); if (primary) primary.textContent = 'Đang lưu…';
    try { return await original(...args); } catch (error) { workspaceToast(readableAppError(error),true); }
    finally { busy = false; states.forEach(({button,disabled,text}) => { button.disabled = disabled; button.textContent = text; }); }
  };
}
saveNewProfile = workspaceGuardAction('modal-create-profile', saveNewProfile, () => validateWorkspaceProxy('create'));
saveProxyModal = workspaceGuardAction('modal-proxy', saveProxyModal, () => validateWorkspaceProxy('px'));
saveQuickEdit = workspaceGuardAction('modal-quick-edit', saveQuickEdit);
saveGroupModal = workspaceGuardAction('modal-group', saveGroupModal);
saveGroupProfiles = workspaceGuardAction('modal-group-add-profiles', saveGroupProfiles);

saveAdminUser = async function(userId) {
  const role = document.getElementById('admin-role-' + userId), status = document.getElementById('admin-status-' + userId), flow=document.getElementById('admin-flow-'+userId), row = role?.closest('tr'), button = row?.querySelector('.btn-blue');
  if (!role || button.disabled) return;
  button.disabled = true; role.disabled = true; status.disabled = true; button.textContent = 'Đang lưu…';
  try { await window.api.adminSetUser({userId,role:role.value,status:status.value,...(currentAccount?.automation_schema_ready===false||flow?.dataset.schemaReady==='false'?{}:{automationEnabled:flow?.dataset.grant==='true'})}); workspaceAdminDrafts.delete(userId); role.dataset.original = role.value; status.dataset.original = status.value; if(flow)flow.dataset.original=flow.dataset.grant; row.classList.remove('is-dirty'); button.textContent = 'Đã lưu'; workspaceToast('Đã cập nhật tài khoản.'); }
  catch (error) { button.disabled = false; button.textContent = 'Lưu đổi'; workspaceToast(readableAppError(error),true); }
  finally { role.disabled = false; status.disabled = false; }
};

const workspaceOriginalOpenProxy = openProxyEditModal;
openProxyEditModal = function(id) { workspaceProxyCheck++; delete document.getElementById('modal-proxy').dataset.country; workspaceOriginalOpenProxy(id); };

const workspaceOriginalDeleteProfile = deleteProfile;
deleteProfile = async function(id) {
  if (runningProfiles.has(id) || workspaceLaunches.has(id) || pendingCloudOperations.has(id) || workspaceBulkBusy) return workspaceToast('Đóng hồ sơ và đợi tác vụ hoàn tất trước khi đưa vào thùng rác.',true);
  try { await workspaceOriginalDeleteProfile(id); } catch (error) { workspaceToast(readableAppError(error),true); }
};

async function deleteWorkspaceProxy(id) { if (!confirm('Xóa proxy khỏi kho lưu?')) return; try { await window.api.deleteProxy(id); await loadProxiesTable(); workspaceToast('Đã xóa proxy khỏi kho.'); } catch (error) { workspaceToast(readableAppError(error),true); } }
async function deleteWorkspaceExtension(id) { if (!confirm('Xóa tiện ích này?')) return; try { await window.api.deleteExtension(id); await loadExtensionsGrid(); workspaceToast('Đã xóa tiện ích.'); } catch (error) { workspaceToast(readableAppError(error),true); } }
async function toggleWorkspaceExtension(id, input) { const checked = input.checked; input.disabled = true; try { const result = await window.api.updateExtension(id,{enabled:checked}); if (result === false || result?.success === false) throw new Error(result?.error || 'Không lưu được tiện ích.'); const card = input.closest('.ext-card'); card.querySelector('.badge').textContent = checked ? 'Áp dụng khi mở hồ sơ' : 'Đã tắt'; applyWorkspaceFilters('extensions'); } catch (error) { input.checked = !checked; workspaceToast(readableAppError(error),true); } finally { input.disabled = false; } }

saveExtensionModal = workspaceGuardAction('modal-extension', async function() {
  // The main process returns a result object on download failure; keep the form open.
  let name = document.getElementById('ext-name').value.trim();
  const path = (currentExtTab === 'file' ? document.getElementById('ext-path') : document.getElementById('ext-store-url')).value.trim();
  if (!path || currentExtTab === 'file' && !name) throw new Error('Điền tên và đường dẫn tiện ích trước khi lưu.');
  if (currentExtTab === 'store') { let url; try { url = new URL(path); } catch { throw new Error('Nhập đường dẫn Chrome Web Store hợp lệ.'); } if (url.protocol !== 'https:' || !['chromewebstore.google.com','chrome.google.com'].includes(url.hostname)) throw new Error('Sử dụng đường dẫn từ Chrome Web Store.'); const slug = url.pathname.match(/\/detail\/([^/]+)\//)?.[1]; name = slug ? decodeURIComponent(slug).replace(/-/g,' ') : 'Tiện ích Chrome'; }
  const result = await window.api.addExtension({name,path,enabled:true}); if (!result?.success) throw new Error(result?.error || 'Không thêm được tiện ích.');
  closeModals(); await loadExtensionsGrid(); workspaceToast('Đã thêm tiện ích. Áp dụng khi mở hồ sơ.');
});

window.api.onBrowserClosed?.(() => { updateWorkspaceStats(); applyWorkspaceFilters('profiles'); });

const workspaceOriginalSignOut = signOutAccount;
signOutAccount = async function() { await workspaceOriginalSignOut(); if (!currentAccount) { workspaceAccountId = null; workspaceSelection.clear(); workspaceAdminDrafts.clear(); expandedAdminUsers.clear(); selectedAdminUser = null; resetWorkspacePasswords(document.getElementById('auth-overlay')); document.getElementById('workspace-account').open = false; } };

// Bound background checks and distinguish proxy credentials on a shared gateway.
const workspaceProxyCache = new Map(), workspaceProxyPending = new Map(), workspaceProxyQueue = [];
let workspaceProxyActive = 0;
function workspaceProxyKey(proxy) { return JSON.stringify([proxy.ip || '',proxy.port || '',proxy.user || '',proxy.pass || '']); }
function drainWorkspaceProxyQueue() {
  while (workspaceProxyActive < 4 && workspaceProxyQueue.length) {
    const {proxy,key,resolve} = workspaceProxyQueue.shift(); workspaceProxyActive++;
    Promise.resolve().then(() => window.api.checkProxy(proxy)).catch(error => ({success:false,error:readableAppError(error)})).then(result => {
      workspaceProxyCache.set(key,{time:Date.now(),result}); if (workspaceProxyCache.size > 256) workspaceProxyCache.delete(workspaceProxyCache.keys().next().value);
      workspaceProxyPending.delete(key); resolve(result);
    }).finally(() => { workspaceProxyActive--; drainWorkspaceProxyQueue(); });
  }
}
safeCheckProxy = function(proxy) {
  const key = workspaceProxyKey(proxy), cached = workspaceProxyCache.get(key);
  if (cached && Date.now() - cached.time < 30000) return Promise.resolve(cached.result);
  if (workspaceProxyPending.has(key)) return workspaceProxyPending.get(key);
  const promise = new Promise(resolve => workspaceProxyQueue.push({proxy,key,resolve})); workspaceProxyPending.set(key,promise); drainWorkspaceProxyQueue(); return promise;
};
autoPingProfiles = async function(profiles) {
  const grouped = new Map();
  for (const profile of profiles) { const proxy = profile.proxyIp && profile.proxyPort ? {ip:profile.proxyIp,port:profile.proxyPort,user:profile.proxyUser,pass:profile.proxyPass} : {}; const key = workspaceProxyKey(proxy); if (!grouped.has(key)) grouped.set(key,{proxy,ids:[]}); grouped.get(key).ids.push(profile.id); }
  await Promise.all(Array.from(grouped,async ([key,{proxy,ids}]) => {
    const result = await safeCheckProxy(proxy);
    for (const id of ids) { const latest = profilesList.find(p => p.id === id); if (!latest) continue; const currentProxy = latest.proxyIp && latest.proxyPort ? {ip:latest.proxyIp,port:latest.proxyPort,user:latest.proxyUser,pass:latest.proxyPass} : {}; if (workspaceProxyKey(currentProxy) === key) updatePingCells(id,result); }
  }));
};

openGroupProfiles = async function(groupId) {
  if (workspaceBulkBusy) return;
  const profiles = profilesList.filter(p => p.groupId === groupId && !runningProfiles.has(p.id));
  if (!profiles.length) return workspaceToast('Nhóm trống hoặc tất cả hồ sơ đã mở.');
  if (!confirm(`Mở ${profiles.length} hồ sơ chưa chạy trong nhóm này?`)) return;
  workspaceBulkBusy = true; let count = 0; const errors = [];
  try { for (const profile of profiles) { try { const result = await window.api.launchProfile(profile.id); if (!result?.success) throw new Error(result?.error || 'Không mở được'); runningProfiles.add(profile.id); count++; } catch (error) { errors.push(profile.name + ': ' + readableAppError(error)); } } await loadGroupsTable(); updateWorkspaceStats(); workspaceToast(`Đã mở ${count}/${profiles.length} hồ sơ trong nhóm.`); if (errors.length) workspaceToast(errors.join('\n'),true); }
  finally { workspaceBulkBusy = false; updateWorkspaceSelection(); }
};

setupWorkspace();
document.getElementById('auth-overlay').setAttribute('role','dialog');
document.getElementById('auth-overlay').setAttribute('aria-modal','true');
document.getElementById('auth-overlay').setAttribute('aria-labelledby','auth-title');
void initAuth();
void loadAppVersion();
setTimeout(() => { if (window.api?.checkForUpdates) window.api.checkForUpdates(); }, 3000);

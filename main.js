const { app, BrowserWindow, ipcMain, shell, safeStorage, powerMonitor, clipboard, dialog } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const {createProxyNetwork,parseProxy,proxyKey,profileProxyFields,validTimezone,explainProxyError}=require('./proxy-network');
const proxyNetwork=createProxyNetwork();
const {createProxyLibrary,canAccessProxy,normalizeTags}=require('./proxy-library');
const axios = require('axios');
const WebSocket = require('ws');
const AdmZip = require('adm-zip');
const { createClient } = require('@supabase/supabase-js');
const lanUpdate = require('./lan-update');
const licensing = require('./licensing');
const { CloudProfiles, createAccountKeyMetadata, decryptPrivateKey } = require('./cloud-profiles');
const { installAccountProfileManagement } = require('./admin-management');
const { installProfileCatalogSync } = require('./profile-catalog-sync');
const { installAccountSecurity } = require('./account-security');
const { createAutomationService, validateFlow } = require('./automation-service');
const { createAutomationHttp } = require('./automation-http');
const {createYouTubeChannelCloud}=require('./youtube-channel-cloud');
const hasManagerLock = app.requestSingleInstanceLock();
if(!hasManagerLock)app.quit();
const {installManagerLifecycle}=require('./app-lifecycle');
const {isLocalSnapshot,localSnapshot,getLockClientToken}=require('./profile-local-snapshot');
const {createProfileAdminControl}=require('./profile-admin-control');
let profileAdminControl=null;
let managerLifecycle=null,restoreTask=null,pendingInstaller=null,pendingAutoInstall=false;

// ============================================================
// SUPABASE CONFIGURATION
// ============================================================
const SUPABASE_URL = 'https://uuwxxnrqjbbckfqefpfr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JGC32urdczMQWC0qN2eTyw_UIoqQInZ';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: fetchWithDeadline }
});

async function fetchWithDeadline(url, options = {}) {
  const timeout = String(url).includes('/storage/v1/') ? 300000 : 30000;
  const signals=[options.signal,AbortSignal.timeout(timeout)].filter(Boolean);
  const signal=AbortSignal.any(signals);
  return fetch(url, { ...options, signal });
}

// ============================================================
// DATABASE & PATHS
// ============================================================
const PROFILES_DB = path.join(app.getPath('userData'), 'profiles.json');
const PROXIES_DB = path.join(app.getPath('userData'), 'proxies.json');
const GROUPS_DB = path.join(app.getPath('userData'), 'groups.json');
const EXTENSIONS_DB = path.join(app.getPath('userData'), 'extensions.json');
const TRASH_DB = path.join(app.getPath('userData'), 'trash.json'); 
const CORE_DIR = app.isPackaged ? path.join(process.resourcesPath, 'core') : path.join(__dirname, 'core');
const activeBrowsers = new Map();
let latestDownloadedExePath = null; 
let currentAccount = null;
let profileCatalogSync = null;
let currentPrivateKey = null;
let accountSecurityBusy = false;
let accountAuthenticationBusy = false;
let automation = null;
let automationHttp = null;
const profileLaunchTasks = new Map();
const snapshotDownloads = new Map();
let automationAuthAt = 0;
let automationAuthOwner = null;
const accountSecurity = installAccountSecurity({
  ipcMain: { handle: (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    const localUI = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;
    if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split('#')[0] !== localUI) throw new Error('Nguồn yêu cầu không hợp lệ.');
    return handler(event, ...args);
  }) }, supabase, safeStorage, userDataPath: app.getPath('userData'),
  createRecoveryClient: () => createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchWithDeadline }
  }),
  loadAccount: loadCurrentAccount, getAccount: () => currentAccount, getPrivateKey: () => currentPrivateKey,
  setPrivateKey: value => { currentPrivateKey = value; },
  canChange: () => !accountAuthenticationBusy && !activeBrowsers.size && !profileLaunchTasks.size && !snapshotDownloads.size && !profileAdminControl?.isBusy() && !accountProfiles.isBusy() && !automation?.isBusy(),
  setBusy: value => { accountSecurityBusy = value; }
});

async function loadCurrentAccount() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) { currentAccount = null; currentPrivateKey = null; return null; }
  const { data, error } = await supabase.from('app_users')
    .select('user_id,email,role,status,public_key,private_key_ciphertext,private_key_salt,private_key_iv,private_key_tag')
    .eq('user_id', authData.user.id).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'active') {
    currentAccount = null;
    currentPrivateKey = null;
    await supabase.auth.signOut();
    throw new Error(data ? 'Tài khoản đã bị admin khóa.' : 'Tài khoản chưa được khởi tạo trong hệ thống. Hãy liên hệ admin.');
  }
  if (currentAccount && (currentAccount.id !== data.user_id || currentAccount.public_key !== data.public_key)) currentPrivateKey = null;
  let automationEnabled = false, automationSchemaReady = true;
  try { const permission = await supabase.rpc('td_can_use_automation'); if(permission.error){automationSchemaReady=false;}else{automationEnabled=permission.data===true;} } catch { automationSchemaReady=false; }
  currentAccount = { automation_enabled: automationEnabled, automation_schema_ready: automationSchemaReady, id: data.user_id, email: data.email || authData.user.email, role: data.role, status: data.status, public_key: data.public_key };
  return { account: currentAccount, keyRow: data };
}

const cloudProfiles = new CloudProfiles({
  supabase,
  userDataPath: app.getPath('userData'),
  lockClientToken: getLockClientToken(app.getPath('userData')),
  getCurrentUser: () => currentAccount,
  getPrivateKey: () => currentPrivateKey,
  getProfiles: () => getData(PROFILES_DB),
  saveProfiles: profiles => saveData(PROFILES_DB, profiles),
  profileDataPath: profileId => getProfileDataPath(profileId)
});

const accountProfiles = installAccountProfileManagement({
  ipcMain, cloud: cloudProfiles, getAccount: () => accountSecurityBusy ? null : currentAccount, getPrivateKey: () => currentPrivateKey,
  getProfiles: () => getData(PROFILES_DB), saveProfiles: p => saveData(PROFILES_DB, p),
  getTrash: () => getData(TRASH_DB), saveTrash: p => saveData(TRASH_DB, p), activeBrowsers,
  isProfileInUse:id=>profileLaunchTasks.has(id)||!!automation?.isProfileBusy(id),
  notify: () => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send('cloud-sync-event', { success: true, status: 'catalog-updated' }); }
});

profileCatalogSync = installProfileCatalogSync({
  ipcMain, cloud: cloudProfiles, manager: accountProfiles, userDataPath: app.getPath('userData'),
  getAccount: () => accountSecurityBusy ? null : currentAccount, getProfiles: () => getData(PROFILES_DB), activeBrowsers, appVersion: app.getVersion(), beforeSync:()=>profileAdminControl?.refresh({force:true}),
  notify: data => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send('cloud-sync-event', data); }
});

profileAdminControl=createProfileAdminControl({cloud:cloudProfiles,userDataPath:app.getPath('userData'),getAccount:()=>accountSecurityBusy?null:currentAccount,getDeviceId:()=>profileCatalogSync.getDeviceId(),getProfiles:()=>getData(PROFILES_DB),saveProfiles:p=>saveData(PROFILES_DB,p),getTrash:()=>getData(TRASH_DB),saveTrash:p=>saveData(TRASH_DB,p),activeBrowsers,stopProfile,cancelProfile:id=>automation?.cancelProfile(id),isProfileLaunching:id=>profileLaunchTasks.has(id),isProfileBusy:id=>profileLaunchTasks.has(id)||accountProfiles.isProfileBusy(id)||!!automation?.isProfileBusy(id),cleanupStorage:false,notify:data=>{for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('cloud-sync-event',data);}});
ipcMain.handle('admin:request-profile-delete',(event,input)=>{localLifecycleRequest(event);return profileAdminControl.requestDeletion(input);});
const googleChannelCloud=createYouTubeChannelCloud({getAccount:()=>accountSecurityBusy?null:currentAccount,getPrivateKey:()=>currentPrivateKey,rpc:async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.code==='PGRST202'?'Admin cần chạy SUPABASE-UPDATE-1.3.7.sql để đồng bộ liên kết kênh dùng chung.':String(error.message).includes('youtube_link_changed')?'Liên kết kênh vừa thay đổi. Làm mới để dùng liên kết mới.':String(error.message).includes('google_client_changed')?'Admin đã đổi cấu hình Google API. Làm mới cấu hình.':'Không đồng bộ được liên kết kênh. Kiểm tra mạng và quyền truy cập hồ sơ.');return data;}});
// All GUI/API/MCP entry points share these profile lifecycle functions.
automation = createAutomationService({
  userDataPath:app.getPath('userData'),safeStorage,getAccount:()=>accountSecurityBusy?null:currentAccount,
  authorizeAccount:async()=>{
    if(accountAuthenticationBusy||accountSecurity.isBusy())throw new Error('Đang xử lý tài khoản.');
    if(!currentAccount||automationAuthOwner!==currentAccount.id||Date.now()-automationAuthAt>5000){await loadCurrentAccount();if(!currentAccount)throw new Error('Vui lòng đăng nhập lại.');automationAuthOwner=currentAccount.id;automationAuthAt=Date.now();}
  },
  openExternal:url=>shell.openExternal(url),googleChannelCloud,
  ensureGoogleCloudProfile:async profile=>{await cloudProfiles.registerLocalProfile(profile.id);return getData(PROFILES_DB).find(p=>p.id===profile.id);},
  getGoogleClient:async()=>{const {data,error}=await supabase.rpc('td_google_desktop_client');if(error)throw new Error(error.code==='PGRST202'?'Admin cần chạy SUPABASE-UPDATE-1.3.7.sql để thiết lập Google API dùng chung.':'Không lấy được cấu hình Google API từ máy chủ. Kiểm tra kết nối và quyền Flow.');return data;},
  saveGoogleClient:async client=>{const {error}=await supabase.rpc('td_admin_set_google_desktop_client',{p_client:client});if(error)throw new Error(error.code==='PGRST202'?'Admin cần chạy SUPABASE-UPDATE-1.3.7.sql trước khi cấu hình Google API.':String(error.message).includes('admin_required')?'Chỉ Admin được cấu hình Google API.':'Không lưu được cấu hình Google API lên máy chủ.');},
  openApiNetwork:async profile=>{const bridge=await proxyNetwork.open(profile),agent=bridge?new(require('https-proxy-agent').HttpsProxyAgent)(bridge.url,{keepAlive:true,maxSockets:15,maxFreeSockets:2}):undefined;return {agent,close:async()=>{agent?.destroy();await bridge?.close();}};},
  listProfiles:()=>accountProfiles.reconcile(),startProfile:launchProfile,stopProfile,
  getSession:id=>activeBrowsers.get(id),isProfileLaunching:id=>profileLaunchTasks.has(id),
  notify:data=>{for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('automation:event',data);}
});
automationHttp = createAutomationHttp({service:automation,safeStorage,userDataPath:app.getPath('userData'),getAccount:()=>currentAccount,
  createProfile:addProfile,updateProfile,deleteProfile,getSession:id=>activeBrowsers.get(id),checkProxy:(profile,settings)=>proxyNetwork.check(profile,settings),version:app.getVersion(),
  notify:data=>{for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('automation:event',{status:'api',...data});}
});
function automationIpc(channel,handler){ipcMain.handle(channel,async(event,...args)=>{
  const localUI=require('url').pathToFileURL(path.join(__dirname,'index.html')).href;
  if(event.senderFrame!==event.sender.mainFrame||event.senderFrame.url.split('#')[0]!==localUI)throw new Error('Nguồn yêu cầu không hợp lệ.');
  try{await automation.authorize();}catch(error){
    if(error.code==='FLOW_PERMISSION_DENIED' && ['automation:state','automation:live'].includes(channel))return {allowed:false,account:currentAccount,flows:[],runs:[],schedules:[],secrets:[],profiles:[],api:{},youtube:{channels:{},preferences:{}}};
    throw error;
  }return handler(...args);
});}
automationIpc('automation:state',async()=>{const profiles=await automation.visibleProfiles();await automation.refreshGoogleBindings(profiles);return {allowed:true,account:currentAccount,youtube:automation.youtubeSettings(),flows:automation.listFlows(),runs:automation.listJobs(),schedules:automation.listSchedules(),secrets:automation.listSecrets(),api:automationHttp.status(),profiles:profiles.map(automationHttp.cleanProfile),groups:getData(GROUPS_DB).filter(g=>profiles.some(p=>p.groupId===g.id))};});
automationIpc('automation:live',async runId=>{let run=null;if(runId)try{run=automation.getJob(runId);}catch{}await automation.refreshGoogleBindings();return {allowed:true,account:currentAccount,youtube:automation.youtubeSettings(),runs:automation.listJobs(),schedules:automation.listSchedules(),api:automationHttp.status(),run};});
automationIpc('automation:youtube-folder',async()=>{const owner=automation.current().id;const choice=await dialog.showOpenDialog({title:'Chọn thư mục video',properties:['openDirectory']});if(choice.canceled)return null;await automation.authorize(owner);return automation.grantYouTubeFolder(choice.filePaths[0],owner);});
automationIpc('automation:youtube-scan',input=>automation.scanYouTube(input));
automationIpc('automation:youtube-link',profileId=>automation.linkYouTube(profileId));
automationIpc('automation:youtube-google-import',async()=>{const account=automation.current();if(account.role!=='admin')throw new Error('Chỉ Admin được cấu hình Google API.');const owner=account.id;const choice=await dialog.showOpenDialog({title:'Admin: Cấu hình Google API dùng chung',properties:['openFile'],filters:[{name:'Google OAuth Desktop JSON',extensions:['json']}]});if(choice.canceled)return null;const fresh=await automation.authorize(owner);if(fresh.role!=='admin')throw new Error('Chỉ Admin được cấu hình Google API.');const file=choice.filePaths[0];if(fs.statSync(file).size>65536)throw Error('Tệp OAuth quá lớn.');return automation.importGoogleClient(fs.readFileSync(file,'utf8'));});
automationIpc('automation:youtube-google-link',pid=>automation.linkGoogle(pid));
automationIpc('automation:youtube-open-profile',(pid,mode)=>automation.openYouTubeProfile(pid,mode));
automationIpc('automation:youtube-google-cancel',pid=>automation.cancelGoogleLink(pid));
automationIpc('automation:youtube-google-disconnect',pid=>automation.disconnectGoogle(pid));
automationIpc('automation:youtube-settings' ,input=>automation.saveYouTubeSettings(input));
automationIpc('automation:validate-flow' ,input=>validateFlow(input));
automationIpc('automation:save-flow',input=>automation.saveFlow(input));
automationIpc('automation:delete-flow',flowId=>automation.deleteFlow(flowId));
automationIpc('automation:run',input=>automation.startBatch(input));
automationIpc('automation:cancel',runId=>automation.cancel(runId));
automationIpc('automation:save-schedule',input=>automation.saveSchedule(input));
automationIpc('automation:delete-schedule',scheduleId=>automation.deleteSchedule(scheduleId));
automationIpc('automation:save-secret',({name,value})=>automation.saveSecret(name,value));
automationIpc('automation:delete-secret',name=>automation.deleteSecret(name));
automationIpc('automation:configure-api',input=>automationHttp.configure(input));
automationIpc('automation:copy-token',async()=>{clipboard.writeText(await automationHttp.revealToken());return true;});
automationIpc('automation:connection',({profileId})=>automation.start(profileId));
automationIpc('automation:copy-text',value=>{if(typeof value!=='string'||value.length>200000)throw Error('Nội dung quá lớn.');clipboard.writeText(value);return true;});
automationIpc('automation:open-artifact',({runId,file})=>shell.showItemInFolder(automation.artifactPath(runId,file)));
automationIpc('automation:export-flow',async flowId=>{
  const flow=automation.listFlows().find(f=>f.id===flowId);if(!flow)throw Error('Không tìm thấy flow.');
  const result=await dialog.showSaveDialog({title:'Xuất flow TD Browser',defaultPath:'TD-Flow.json',filters:[{name:'TD Browser Flow',extensions:['json']}]});
  if(result.canceled)return false;
  fs.writeFileSync(result.filePath,JSON.stringify({format:'td-browser-flow',version:1,flow},null,2),'utf8');return true;
});

app.whenReady().then(() => powerMonitor.on('resume', () => { profileCatalogSync.schedule(0); void accountProfiles.background(); }));

function getData(file) {
  try {
    if (!fs.existsSync(file)) { fs.writeFileSync(file, '[]', 'utf8'); return []; }
    const content = fs.readFileSync(file, 'utf8');
    if (!content.trim()) return [];
    return JSON.parse(content);
  } catch (error) { return []; }
}

function saveData(file, data) {
  const tempFile = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempFile, file);
    if (file === PROFILES_DB) profileCatalogSync?.schedule();
    return true;
  } catch (error) {
    try { fs.rmSync(tempFile, { force: true }); } catch {}
    return false;
  }
}

function getProfileDataPath(profileId) {
  if (typeof profileId !== 'string' || !/^TD_[A-Za-z0-9_-]+$/.test(profileId)) return null;
  const root = path.resolve(app.getPath('userData'), 'BrowserData');
  const profilePath = path.resolve(root, profileId);
  return path.dirname(profilePath) === root ? profilePath : null;
}

function getBrowserExecutable() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const possiblePaths = [
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(CORE_DIR, 'chrome-win', 'chrome.exe'),
    path.join(CORE_DIR, 'chrome.exe')
  ];
  for (const browserPath of possiblePaths) {
    if (fs.existsSync(browserPath)) return browserPath;
  }
  return null;
}

function isValidTimezone(timezone) {
  if (!timezone || typeof timezone !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); return true; } catch { return false; }
}

function syncAndGetProxies() {
  const proxies=getData(PROXIES_DB);let changed=false;
  const known=new Set(proxies.flatMap(p=>{try{return [proxyKey(p)];}catch{return [];}}));
  for(const profile of getData(PROFILES_DB)){
    let parsed,key;try{parsed=parseProxy(profile);if(!parsed)continue;key=proxyKey(profile);}catch{continue;}
    const accountId=profile.localAccountId||currentAccount?.id;
    if(proxies.some(p=>{try{return proxyKey(p)===key&&(!p.localAccountId||p.localAccountId===accountId);}catch{return false;}}))continue;known.add(key);changed=true;
    proxies.push({localAccountId:accountId,id:'PRX_'+crypto.randomUUID(),title:'Proxy ('+parsed.host+')',ip:parsed.host,port:parsed.port,user:parsed.user,pass:parsed.pass,protocol:parsed.protocol,country:profile.proxyCountry||'',timezone:profile.proxyTimezone||'',createdAt:profile.createdAt||new Date().toISOString().split('T')[0]});
  }
  if(changed&&!saveData(PROXIES_DB,proxies))throw Error('Không lưu được danh sách proxy.');return proxies;
}

async function findFreePort() {
  const net = require('net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForChromeCDP(port, timeout = 45000, isAlive = () => true) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if(!isAlive())throw Object.assign(Error('Chrome đã đóng trước khi kết nối sẵn sàng.'),{code:'CHROME_EXITED'});
    try {
      const response = await axios.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1000, proxy: false });
      if (response.data && response.data.webSocketDebuggerUrl) return response.data.webSocketDebuggerUrl;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Object.assign(new Error('Chrome CDP timeout.'),{code:'CDP_READY_TIMEOUT'});
}

async function connectCDP(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const pending = new Map();
    const eventHandlers = new Map();
    let counter = 0;
    const connectionTimer = setTimeout(() => {
      reject(new Error('Chrome CDP connection timeout.'));
      ws.terminate();
    }, 12000);
    const rejectPending = error => {
      clearTimeout(connectionTimer);
      for (const command of pending.values()) {
        clearTimeout(command.timer);
        command.reject(error);
      }
      pending.clear();
    };
    ws.on('open', () => {
      clearTimeout(connectionTimer);
      ws._tdSend = function(method, params = {}, sessionId = null) {
        return new Promise((resolveCmd, rejectCmd) => {
          if (ws.readyState !== WebSocket.OPEN) return rejectCmd(new Error('Chrome CDP disconnected.'));
          const id = ++counter;
          const timer = setTimeout(() => {
            pending.delete(id);
            rejectCmd(new Error(`Chrome CDP command timeout: ${method}`));
          }, 12000);
          pending.set(id, { resolve: resolveCmd, reject: rejectCmd, timer });
          const payload = { id, method, params };
          if (sessionId) payload.sessionId = sessionId;
          const fail = error => {
            if (!error || !pending.has(id)) return;
            clearTimeout(timer);
            pending.delete(id);
            rejectCmd(error);
          };
          try { ws.send(JSON.stringify(payload), fail); } catch (error) { fail(error); }
        });
      };
      ws._tdOn = function(eventName, handler) { eventHandlers.set(eventName, handler); };
      resolve(ws);
    });
    ws.on('message', data => {
      try {
        const message = JSON.parse(data.toString());
        if (message.id && pending.has(message.id)) {
          const command = pending.get(message.id);
          pending.delete(message.id);
          clearTimeout(command.timer);
          if (message.error) command.reject(new Error(message.error.message));
          else command.resolve(message.result);
        } else if (message.method && eventHandlers.has(message.method)) {
          Promise.resolve(eventHandlers.get(message.method)(message.params, message.sessionId)).catch(() => {});
        }
      } catch (e) {}
    });
    ws.on('error', error => { rejectPending(error); reject(error); });
    ws.on('close', () => {
      const error = new Error('Chrome CDP disconnected.');
      rejectPending(error);
      eventHandlers.clear();
      reject(error);
    });
  });
}

// ============================================================
// CƠ CHẾ BẢO VỆ MÚI GIỜ VĨNH VIỄN
// ============================================================
async function applyTimezoneGlobal(browserWsUrl, timezone, targetUrl) {
  let cdp;
  try {
    cdp = await connectCDP(browserWsUrl);
    const pages = new Map(), failures = new Map();
    const regular = info => info && ['page','iframe'].includes(info.type) && !/^(?:chrome|chrome-extension|devtools|edge):/i.test(info.url||'');
    const transient = error => /timeout|execution context.*(?:destroyed|not found)|cannot find context|session.*closed|target.*closed|no target with given id/i.test(error.message||'');
    const canonical = value => new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;
    // Loading an external site is separate from verifying browser readiness.
    // Proxy/site latency must never turn a healthy Chrome session into a failed launch.
    const navigateStartup=(url,sessionId)=>{
      cdp._tdStartupNavigation=cdp._tdSend('Page.navigate',{url},sessionId).then(result=>{
        if(result?.errorText)throw Error('Navigation did not complete');
      }).catch(()=>{cdp._tdNavigationFailed=true;cdp.emit?.('td-navigation-warning');});
    };

    // Discovery + explicit attachment does not suspend popup creation. In
    // particular, window.open() must be free to assign its destination URL.
    cdp._tdOn('Target.attachedToTarget', (params) => {
      if (!params.sessionId) return;
      return cdp._tdSend('Runtime.runIfWaitingForDebugger', {}, params.sessionId).catch(() => {});
    });
    const attachPage = info => {
      if (!regular(info)) return Promise.resolve(null);
      if (pages.has(info.targetId)) return pages.get(info.targetId).ready;
      const entry = { sessionId: null, ready: null };
      pages.set(info.targetId, entry);
      entry.ready = (async () => {
        const attached = await cdp._tdSend('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        entry.sessionId = attached.sessionId;
        if (pages.get(info.targetId) !== entry) {
          await cdp._tdSend('Target.detachFromTarget', { sessionId: entry.sessionId }).catch(() => {});
          return null;
        }
        try {
          if (isValidTimezone(timezone)) {
            for(let attempt=0;attempt<3;attempt++){
              try{
                try{await cdp._tdSend('Emulation.setTimezoneOverride',{timezoneId:timezone},entry.sessionId);}
                catch(error){if(!/timezone override is already in effect/i.test(error.message||''))throw error;}
                // Chromium can share a timezone controller between targets. Accept
                // an existing override only after measuring the requested zone.
                const measured=await cdp._tdSend('Runtime.evaluate',{expression:'Intl.DateTimeFormat().resolvedOptions().timeZone',returnByValue:true},entry.sessionId);
                if(measured.exceptionDetails||typeof measured.result?.value!=='string')throw Error('Execution context not found while checking timezone.');
                if(canonical(measured.result.value)!==canonical(timezone))throw Object.assign(Error('Múi giờ JavaScript không khớp thiết lập.'),{code:'TIMEZONE_MISMATCH'});
                failures.delete(info.targetId);break;
              }catch(error){if(attempt===2||!transient(error))throw error;await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));}
            }
          }
        } finally {
          // Always release startup waiting, including when an override fails.
          await cdp._tdSend('Runtime.runIfWaitingForDebugger', {}, entry.sessionId).catch(() => {});
        }
        return entry.sessionId;
      })().catch(async error => {
        failures.set(info.targetId,error);
        if (entry.sessionId) await cdp._tdSend('Target.detachFromTarget', { sessionId: entry.sessionId }).catch(() => {});
        if (pages.get(info.targetId) === entry) pages.delete(info.targetId);
        return null;
      });
      return entry.ready;
    };
    cdp._tdOn('Target.targetCreated', params => attachPage(params.targetInfo));
    cdp._tdOn('Target.targetInfoChanged', params => attachPage(params.targetInfo));
    cdp._tdOn('Target.targetDestroyed', params => { pages.delete(params.targetId); });
    cdp._tdOn('Target.detachedFromTarget', params => {
      for (const [targetId, entry] of pages) if (entry.sessionId === params.sessionId) pages.delete(targetId);
    });
    cdp.once('close', () => pages.clear());

    await cdp._tdSend('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
    const initial = await cdp._tdSend('Target.getTargets');
    const startupPage = initial.targetInfos.find(info => regular(info) && info.type === 'page' && info.url === 'about:blank' && !info.openerId);
    await cdp._tdSend('Target.setDiscoverTargets', { discover: true });
    const attachedSessions=await Promise.all(initial.targetInfos.map(attachPage));
    const unresolved=initial.targetInfos.filter((info,index)=>regular(info)&&info.type==='page'&&!attachedSessions[index]);
    if(unresolved.length){
      const refreshed=await cdp._tdSend('Target.getTargets'),alive=new Set(refreshed.targetInfos.map(info=>info.targetId));
      const failed=unresolved.find(info=>alive.has(info.targetId));
      if(failed)throw failures.get(failed.targetId)||Error('Không áp dụng được múi giờ cho trang Chrome.');
    }
    const openStartup=async()=>{const created=await cdp._tdSend('Target.createTarget',{url:'about:blank'}),info=await cdp._tdSend('Target.getTargetInfo',{targetId:created.targetId}),sid=await attachPage(info.targetInfo);if(!sid)throw failures.get(created.targetId)||Error('Không áp dụng được múi giờ cho trang Chrome.');navigateStartup(targetUrl,sid);};
    if (startupPage) {
      const sessionId = await attachPage(startupPage);
      const current = await cdp._tdSend('Target.getTargetInfo', { targetId: startupPage.targetId }).catch(() => null);
      if (sessionId && current?.targetInfo.url === 'about:blank' && !current.targetInfo.openerId) {
        navigateStartup(targetUrl,sessionId);
      } else if(!current&&targetUrl){await openStartup();}
    } else if (targetUrl) {
      const created=await cdp._tdSend('Target.createTarget', { url: 'about:blank' });
      const info=await cdp._tdSend('Target.getTargetInfo', { targetId:created.targetId });
      const sessionId=await attachPage(info.targetInfo);
      if(!sessionId)throw Error('Không áp dụng được múi giờ cho trang Chrome.');
      navigateStartup(targetUrl,sessionId);
    }
    return cdp;
  } catch (error) {
    if (cdp) { try { cdp.close(); } catch {} }
    throw Object.assign(Error('Không kết nối hoặc áp dụng được múi giờ Chrome. Đóng hồ sơ và thử lại.',{cause:error}),{code:error.code||'CHROME_TIMEZONE_SETUP'});
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 850, title: 'TD Browser',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.on('will-navigate', (event, url) => {
    const localUI = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;
    if (url.split('#')[0] !== localUI) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.setMenuBarVisibility(false);
  managerLifecycle?.attach(win);
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

app.whenReady().then(async () => {
  if(!hasManagerLock)return;
  if(!await licensing.ensureActivated()){app.exit(0);return;}
  restoreTask=accountSecurity.restore().catch(()=>{});
  createWindow();
  await restoreTask;
  if(!waitingForProfileSyncBeforeQuit)syncAndGetProxies();
});

// ============================================================
// HỆ THỐNG AUTO-UPDATE
// ============================================================
// Cập nhật qua thư mục mạng LAN (version.json + file cài đặt, kiểm tra SHA-256). Chỉ bản đã kích hoạt mới chạy được.
function sendUpdateStatus(data) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-event', data);
}

let lanUpdateInfo = null, lanFolderAsked = false;
ipcMain.handle('check-for-updates', async () => {
  try {
    sendUpdateStatus({ status: 'checking' });
    let folder = lanUpdate.getFolder(app);
    if (!folder) {
      if (lanFolderAsked) { sendUpdateStatus({ status: 'not-available' }); return; }
      lanFolderAsked = true;
      const pick = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], { title: 'Chọn thư mục cập nhật (trên mạng LAN)', properties: ['openDirectory'] });
      if (pick.canceled || !pick.filePaths[0]) { sendUpdateStatus({ status: 'not-available' }); return; }
      folder = pick.filePaths[0];
      lanUpdate.setFolder(app, folder);
    }
    lanUpdateInfo = await lanUpdate.checkLatest(folder, app.getVersion());
    if (!lanUpdateInfo) { sendUpdateStatus({ status: 'not-available' }); return; }
    sendUpdateStatus({ status: 'available', notes: lanUpdateInfo.notes || ('Có phiên bản mới ' + lanUpdateInfo.version) });
  } catch (err) { sendUpdateStatus({ status: 'error', message: err.message }); }
});

ipcMain.handle('start-download-update', async () => {
  try {
    if (!lanUpdateInfo) throw new Error('Chưa kiểm tra cập nhật. Hãy bấm kiểm tra lại.');
    sendUpdateStatus({ status: 'downloading', percent: 2 });
    latestDownloadedExePath = await lanUpdate.copyVerified(app, lanUpdateInfo, percent => sendUpdateStatus({ status: 'downloading', percent }));
    sendUpdateStatus({ status: 'ready' });
  } catch (err) { sendUpdateStatus({ status: 'error', message: err.message }); }
});

ipcMain.handle('install-update', async event => {
  try {
    localLifecycleRequest(event);
    if(!latestDownloadedExePath||!fs.existsSync(latestDownloadedExePath))throw Error('Không tìm thấy bộ cài đã tải. Hãy tải lại bản cập nhật.');
    if(!managerLifecycle||managerLifecycle.isClosing())throw Error('Ứng dụng đang đóng. Đợi tác vụ hoàn tất.');
    await scheduleInstallerAfterExit(latestDownloadedExePath);
    pendingInstaller=latestDownloadedExePath;
    managerLifecycle.request();
    return {success:true};
  } catch(error) {
    sendUpdateStatus({status:'install-error',message:error.message});
    return {success:false,error:error.message};
  }
});

ipcMain.handle('get-version', () => app.getVersion());
// ============================================================
// ACCOUNT AUTHENTICATION & CLOUD PROFILE MANAGEMENT
// ============================================================
ipcMain.handle('account:get', async () => {
  try {
    if(restoreTask)await restoreTask;
    await loadCurrentAccount();
    return currentAccount ? { ...currentAccount, cloudUnlocked: !!currentPrivateKey } : null;
  } catch { return null; }
});

ipcMain.handle('account:sign-up', async (event, { email, password }) => {
  if (accountSecurity.isBusy() || accountAuthenticationBusy || automation?.isBusy() || profileLaunchTasks.size || snapshotDownloads.size || profileAdminControl?.isBusy() || activeBrowsers.size) return { success: false, error: 'Đóng hồ sơ và dừng tác vụ trước khi đổi tài khoản.' };
  accountAuthenticationBusy = true;
  try {
    email = String(email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new Error('Nhập email hợp lệ.');
    if (typeof password !== 'string' || password.length < 9) throw new Error('Mật khẩu cần có ít nhất 9 ký tự để bảo vệ khóa hồ sơ.');
    const keyMetadata = await createAccountKeyMetadata(password);
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: keyMetadata }
    });
    if (error) throw error;
    if (!data.session) return { success: true, needsEmailConfirmation: true };
    const result = await loadCurrentAccount();
    currentPrivateKey = await decryptPrivateKey(result.keyRow, password);
    return { success: true, account: { ...result.account, cloudUnlocked: true }, needsEmailConfirmation: false };
  } catch (error) { return { success: false, error: error.message }; }
  finally { accountAuthenticationBusy = false; }
});

ipcMain.handle('account:sign-in', async (event, { email, password, rememberPassword = false, keepSignedIn = true }) => {
  if (accountSecurity.isBusy() || accountAuthenticationBusy || automation?.isBusy() || profileLaunchTasks.size || snapshotDownloads.size || profileAdminControl?.isBusy() || activeBrowsers.size) return { success: false, error: 'Đóng hồ sơ và dừng tác vụ trước khi đổi tài khoản.' };
  accountAuthenticationBusy = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
    if (error) throw error;
    const result = await loadCurrentAccount();
    try {
      currentPrivateKey = await decryptPrivateKey(result.keyRow, String(password || ''));
      const warning = await accountSecurity.saveLogin({ email: result.account.email, password, rememberPassword, keepSignedIn });
      return { success: true, warning, account: { ...result.account, cloudUnlocked: true } };
    } catch (keyError) {
      currentPrivateKey = null;
      const warning = await accountSecurity.saveLogin({ email: result.account.email, password, rememberPassword, keepSignedIn });
      return { success: true, warning, account: { ...result.account, cloudUnlocked: false }, keyError: keyError.message };
    }
  } catch (error) {
    currentAccount = null;
    currentPrivateKey = null;
    return { success: false, error: error.message };
  } finally { accountAuthenticationBusy = false; }
});

ipcMain.handle('account:unlock', async (event, password) => {
  try {
    const result = await loadCurrentAccount();
    if (!result) throw new Error('Hãy đăng nhập tài khoản trước.');
    currentPrivateKey = await decryptPrivateKey(result.keyRow, String(password || ''));
    await accountSecurity.rememberUnlockedSession();
    return { success: true };
  } catch (error) { currentPrivateKey = null; return { success: false, error: error.message }; }
});

ipcMain.handle('account:sign-out', async () => {
  if (accountSecurity.isBusy() || accountAuthenticationBusy) return { success: false, error: 'Đang xử lý tài khoản.' };
  if (profileLaunchTasks.size) return { success: false, error: 'Đợi hồ sơ mở xong rồi đóng trước khi đăng xuất.' };
  if (snapshotDownloads.size || profileAdminControl?.isBusy() || accountProfiles.isBusy()) return { success: false, error: 'Đang tải hoặc đồng bộ hồ sơ. Đợi hoàn tất trước khi đăng xuất.' };
  if (automation?.isBusy()) return { success: false, error: 'Dừng các tác vụ tự động hóa trước khi đăng xuất.' };
  if (activeBrowsers.size) return { success: false, error: 'Đóng các trình duyệt đang chạy trước khi đăng xuất.' };
  await Promise.race([profileCatalogSync.depart(), new Promise(resolve => setTimeout(resolve, 2000))]);
  currentAccount = null;
  currentPrivateKey = null;
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  accountSecurity.persistSession(null);
  return { success: true };
});

ipcMain.handle('admin:list-users', async () => cloudProfiles.listUsers());
ipcMain.handle('admin:set-user', async (event, data) => cloudProfiles.setUser(data.userId, data.role, data.status, data.automationEnabled));
ipcMain.handle('admin:get-sharing', async () => cloudProfiles.getAdminSettings());
ipcMain.handle('admin:set-sharing', async () => {throw Error('Chức năng chia sẻ hồ sơ đã được bỏ.');});
ipcMain.handle('admin:grant-new-admin-access',()=>{throw Error('Hồ sơ lưu trên máy; không cần cấp khóa dữ liệu Cloud.');});
// Browser files are local only. Keep old IPC names blocked for older UI/API callers.
function browserCloudDisabled(){throw Object.assign(Error('Hồ sơ được lưu trên máy. Chức năng lưu/tải/chia sẻ dữ liệu hồ sơ Cloud đã tắt.'),{code:'PROFILE_CLOUD_DISABLED'});}
for(const channel of ['cloud:list-profiles','cloud:sync-profile','cloud:share-profile','cloud:share-recipients','cloud:download-profile','cloud:transfer-profile','cloud:rename-profile','cloud:delete-profile','profile:make-local-snapshot','admin:create-profile-for-user'])ipcMain.handle(channel,browserCloudDisabled);
ipcMain.handle('account:sync-profile-catalog',()=>{profileCatalogSync.schedule(0);return true;});

// ============================================================
// CRUD IPC HANDLERS
// ============================================================
ipcMain.handle('get-profiles', async () => {
  void profileAdminControl?.refresh().catch(()=>{});
  try { return (await accountProfiles.reconcile()).filter(p=>!profileAdminControl?.isDeleted(p)); }
  catch { return getData(PROFILES_DB).filter(p => (!p.localAccountId || p.localAccountId === currentAccount?.id)&&!profileAdminControl?.isDeleted(p)); }
});
async function addProfile(data) {
  Object.assign(data,profileProxyFields(data));
  data.proxyTimezoneMode=data.proxyTimezoneMode==='manual'?'manual':'auto';
  if(data.proxyTimezoneMode==='manual'&&!validTimezone(data.proxyTimezone))throw Error('Nhập múi giờ hợp lệ.');
  const profiles = getData(PROFILES_DB);
  data.id = `TD_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  data.localAccountId = currentAccount?.id;
  data.localStorageMode='local';
  data.createdAt = new Date().toISOString().split('T')[0];
  data.group = data.group || 'Chưa chia nhóm';
  data.note = data.note || '-';
  profiles.push(data);
  if (!saveData(PROFILES_DB, profiles)) throw new Error('Không lưu được hồ sơ.');
  syncAndGetProxies();
  return { success:true,id:data.id,localOnly:true };
}
ipcMain.handle('add-profile', (event,data) => addProfile(data));

async function updateProfile(id,updates) {
  if(automation?.isProfileBusy(id)||profileLaunchTasks.has(id)||accountProfiles.isProfileBusy(id)) throw new Error('Đợi hồ sơ mở xong và dừng tự động hóa/đồng bộ trước khi sửa.');
  const profiles = getData(PROFILES_DB);
  const index = profiles.findIndex(p => p.id === id);
  if (index === -1) return false;
  const oldProfile = profiles[index];
  profileAdminControl?.assertUsable(oldProfile);
  const networkChange=Object.keys(updates||{}).some(key=>['proxyIp','proxyPort','proxyUser','proxyPass','proxyType','proxyTimezone','proxyTimezoneMode'].includes(key));
  if(networkChange&&activeBrowsers.has(id))throw Error('Đóng hồ sơ trước khi đổi proxy hoặc múi giờ.');
  if(networkChange){
    const merged={...oldProfile,...updates};
    updates={...updates,...profileProxyFields(merged)};
    if(merged.proxyTimezoneMode==='manual'&&!validTimezone(merged.proxyTimezone))throw Error('Nhập múi giờ hợp lệ.');
    let previousProxyKey;try{previousProxyKey=proxyKey(oldProfile);}catch{previousProxyKey=null;}
    if(previousProxyKey!==proxyKey(merged)){
      updates.proxyLastCheck=null;updates.proxyCountry='';
      if(merged.proxyTimezoneMode!=='manual')updates.proxyTimezone='';
    }
  }
  profiles[index] = { ...oldProfile, ...updates };
  if (!saveData(PROFILES_DB, profiles)) return false;
  syncAndGetProxies();
  return true;
}
ipcMain.handle('update-profile', (event,{id,updates}) => updateProfile(id,updates));

function deleteProfile(id) {
  if (activeBrowsers.has(id) || profileLaunchTasks.has(id) || automation?.isProfileBusy(id) || accountProfiles.isProfileBusy(id)) throw new Error('Đóng hồ sơ và đợi tác vụ/đồng bộ hoàn tất trước khi xóa.');
 const profiles = getData(PROFILES_DB); const profileToTrash = profiles.find(p => p.id === id); if (profileToTrash) { const trash = getData(TRASH_DB); trash.push({ ...profileToTrash, deletedAt: new Date().toLocaleString('vi-VN'), type: 'profile' }); saveData(TRASH_DB, trash); } saveData(PROFILES_DB, profiles.filter(p => p.id !== id)); return true; }
ipcMain.handle('delete-profile', (event,id) => deleteProfile(id));

const proxyLibrary=createProxyLibrary({read:()=>getData(PROXIES_DB),write:rows=>saveData(PROXIES_DB,rows),getAccount:()=>currentAccount,network:proxyNetwork,notify:data=>{for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('proxy:check-progress',data);}});
ipcMain.handle('proxy:preview-import',(event,input)=>{const result=proxyLibrary.preview(input);return{count:result.rows.length,duplicates:result.duplicates,errors:result.errors,rows:result.rows.map(p=>({ip:p.ip,port:p.port,protocol:p.protocol,tags:p.tags}))};});
ipcMain.handle('proxy:import',(event,input)=>proxyLibrary.importMany(input));
ipcMain.handle('proxy:set-tags',(event,input)=>proxyLibrary.setTags(input));
ipcMain.handle('proxy:check-many',(event,input)=>proxyLibrary.checkMany(input));
ipcMain.handle('proxy:cancel-check',(event,id)=>proxyLibrary.cancel(id));
ipcMain.handle('get-proxies', () => getData(PROXIES_DB).filter(p=>canAccessProxy(p,currentAccount)));
ipcMain.handle('save-proxy',(event,input)=>{
  if(!currentAccount?.id)throw Error('Đăng nhập để lưu proxy.');
  const parsed=parseProxy(input);if(!parsed)throw Error('Nhập proxy trước khi lưu.');
  const proxies=getData(PROXIES_DB),profiles=getData(PROFILES_DB),key=proxyKey(input);
  const index=input.id?proxies.findIndex(p=>p.id===input.id):proxies.findIndex(p=>{try{return canAccessProxy(p,currentAccount)&&proxyKey(p)===key;}catch{return false;}});
  const existing=index>=0?proxies[index]:null;if(input.id&&(!existing||!canAccessProxy(existing,currentAccount)))throw Error('Không có quyền sửa proxy.');
  let oldKey=null;if(existing)try{oldKey=proxyKey(existing);}catch{}
  const matches=oldKey?profiles.filter(p=>{try{return (!p.localAccountId||p.localAccountId===currentAccount.id||currentAccount.role==='admin')&&proxyKey(p)===oldKey;}catch{return false;}}):[];
  if(existing&&key!==oldKey&&matches.some(p=>activeBrowsers.has(p.id)||profileLaunchTasks.has(p.id)||automation?.isProfileBusy(p.id)))throw Error('Đóng các hồ sơ đang dùng proxy này trước khi thay đổi.');
  const proxy={...existing,title:String(input.title||existing?.title||'Proxy ('+parsed.host+')').slice(0,120),localAccountId:existing?.localAccountId||currentAccount.id,tags:normalizeTags(input.tags??existing?.tags??[]),lastCheck:key===oldKey?existing?.lastCheck:null,ip:parsed.host,port:parsed.port,user:parsed.user,pass:parsed.pass,protocol:parsed.protocol,id:existing?.id||'PRX_'+crypto.randomUUID(),country:input.country||'',timezone:validTimezone(input.timezone)?input.timezone:'',createdAt:existing?.createdAt||new Date().toISOString().split('T')[0]};
  if(index>=0)proxies[index]=proxy;else proxies.push(proxy);
  if(!saveData(PROXIES_DB,proxies))throw Error('Không lưu được proxy.');
  if(existing&&key!==oldKey){for(const profile of matches){Object.assign(profile,profileProxyFields(proxy));profile.proxyCountry='';profile.proxyLastCheck=null;if(profile.proxyTimezoneMode!=='manual')profile.proxyTimezone='';}if(!saveData(PROFILES_DB,profiles))throw Error('Proxy đã lưu nhưng chưa cập nhật được hồ sơ.');}
  return true;
});
ipcMain.handle('delete-proxy',(event,id)=>{const rows=getData(PROXIES_DB),row=rows.find(p=>p.id===id);if(!row||!canAccessProxy(row,currentAccount))throw Error('Không có quyền xóa proxy.');return saveData(PROXIES_DB,rows.filter(p=>p.id!==id));});
ipcMain.handle('check-proxy',(event,proxy,settings)=>proxyNetwork.check(proxy,settings));

ipcMain.handle('get-groups', () => getData(GROUPS_DB));
ipcMain.handle('add-group', (event, data) => { const groups = getData(GROUPS_DB); data.id = `GRP_${Date.now()}`; data.createdAt = new Date().toISOString().split('T')[0]; groups.push(data); saveData(GROUPS_DB, groups); return true; });
ipcMain.handle('update-group', (event, { id, updates }) => { const groups = getData(GROUPS_DB); const index = groups.findIndex(g => g.id === id); if (index === -1) return false; const oldName = groups[index].name; const newName = updates.name; groups[index] = { ...groups[index], ...updates }; saveData(GROUPS_DB, groups); if (oldName !== newName) { const profiles = getData(PROFILES_DB); let changed = false; profiles.forEach(p => { if (p.groupId === id || p.group === oldName) { p.group = newName; p.groupId = id; changed = true; } }); if (changed) saveData(PROFILES_DB, profiles); } return true; });
ipcMain.handle('delete-group', (event, id) => { const groups = getData(GROUPS_DB); const groupToDelete = groups.find(g => g.id === id); if (groupToDelete) { const trash = getData(TRASH_DB); trash.push({ ...groupToDelete, deletedAt: new Date().toLocaleString('vi-VN'), type: 'group' }); saveData(TRASH_DB, trash); const profiles = getData(PROFILES_DB); let changed = false; profiles.forEach(p => { if (p.groupId === id || p.group === groupToDelete.name) { p.groupId = ''; p.group = 'Chưa chia nhóm'; changed = true; } }); if (changed) saveData(PROFILES_DB, profiles); } saveData(GROUPS_DB, groups.filter(g => g.id !== id)); return true; });

ipcMain.handle('get-trash', () => getData(TRASH_DB));
ipcMain.handle('restore-trash', async (event, itemRef) => {
  try{await profileAdminControl?.refresh();}catch{}
  const itemId = typeof itemRef === 'string' ? itemRef : itemRef && itemRef.id;
  if (typeof itemId !== 'string') return false;
  const trash = getData(TRASH_DB);
  const itemIndex = trash.findIndex(entry => entry.id === itemId);
  if (itemIndex === -1) return false;
  const item = trash[itemIndex];
  if(item.type==='profile')profileAdminControl?.assertUsable(item);
  if (item.type === 'profile') {
    const profiles = getData(PROFILES_DB);
    if (profiles.some(profile => profile.id === item.id)) return false;
    const restored = { ...item };
    delete restored.type;
    delete restored.deletedAt;
    profiles.push(restored);
    if (!saveData(PROFILES_DB, profiles)) return false;
  } else if (item.type === 'group') {
    const groups = getData(GROUPS_DB);
    if (groups.some(group => group.id === item.id)) return false;
    const restored = { ...item };
    delete restored.type;
    delete restored.deletedAt;
    groups.push(restored);
    if (!saveData(GROUPS_DB, groups)) return false;
  } else {
    return false;
  }
  trash.splice(itemIndex, 1);
  return saveData(TRASH_DB, trash);
});
ipcMain.handle('delete-trash-permanent', (event, itemRef) => {
  const itemId = typeof itemRef === 'string' ? itemRef : itemRef && itemRef.id;
  if (typeof itemId !== 'string') return false;
  const trash = getData(TRASH_DB);
  const item = trash.find(entry => entry.id === itemId);
  if (!item) return false;
  if (item.type === 'profile') {
    const profileDir = getProfileDataPath(item.id);
    if (!profileDir) return false;
    if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
  } else if (item.type !== 'group') {
    return false;
  }
  return saveData(TRASH_DB, trash.filter(entry => entry.id !== item.id));
});
ipcMain.handle('empty-trash', () => {
  const trash = getData(TRASH_DB);
  for (const item of trash) {
    if (item.type !== 'profile') continue;
    const profileDir = getProfileDataPath(item.id);
    if (profileDir && fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
  }
  return saveData(TRASH_DB, []);
});

ipcMain.handle('get-extensions', () => getData(EXTENSIONS_DB));
ipcMain.handle('add-extension', async (event, extData) => { const extensions = getData(EXTENSIONS_DB); let finalPath = extData.path; let finalName = extData.name; if (finalPath.startsWith('http://') || finalPath.startsWith('https://')) { try { const match = finalPath.match(/\/detail\/([^\/]+)\/([a-z32]{32})/i) || finalPath.match(/\/([a-z32]{32})(?:\/|$)/i); let extId = ''; if (match) { extId = match[2] || match[1]; } else { const possibleId = finalPath.split('/').filter(seg => seg.length === 32)[0]; if (possibleId) extId = possibleId; } if (!extId) throw new Error("Không thể trích xuất ID của extension từ URL này!"); const downloadUrl = `https://clients2.google.com/service/update2/crx?response=redirect&os=win&arch=x64&os_arch=x64&nacl_arch=x86-64&prod=chromeselfupdate&prodversion=110.0.0.0&acceptformat=crx2,crx3&x=id%3D${extId}%26installsource%3Dondemand%26uc`; const extDir = path.join(app.getPath('userData'), 'ExtCache', extId); if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true }); const crxFilePath = path.join(extDir, `${extId}.crx`); const response = await axios({ method: 'GET', url: downloadUrl, responseType: 'arraybuffer', timeout: 15000 }); fs.writeFileSync(crxFilePath, Buffer.from(response.data)); try { const zip = new AdmZip(crxFilePath); zip.extractAllTo(extDir, true); } catch (e) { const buffer = fs.readFileSync(crxFilePath); const zipStart = buffer.indexOf('504b0304', 0, 'hex'); if (zipStart !== -1) { const cleanZipBuffer = buffer.slice(zipStart); fs.writeFileSync(path.join(extDir, 'temp.zip'), cleanZipBuffer); const zip2 = new AdmZip(path.join(extDir, 'temp.zip')); zip2.extractAllTo(extDir, true); } else { throw new Error("Không thể giải nén định dạng tiện ích này."); } } finalPath = extDir; } catch (error) { return { success: false, error: `Không thể tải tiện ích từ Store: ${error.message}` }; } } extData.id = `EXT_${Date.now()}`; extData.path = finalPath; extData.name = finalName; extData.enabled = extData.enabled !== undefined ? extData.enabled : true; extData.createdAt = new Date().toISOString().split('T')[0]; extensions.push(extData); saveData(EXTENSIONS_DB, extensions); return { success: true }; });
ipcMain.handle('update-extension', (event, { id, updates }) => { const extensions = getData(EXTENSIONS_DB); const index = extensions.findIndex(e => e.id === id); if (index === -1) return false; extensions[index] = { ...extensions[index], ...updates }; saveData(EXTENSIONS_DB, extensions); return true; });
ipcMain.handle('delete-extension', (event, id) => { const extensions = getData(EXTENSIONS_DB); saveData(EXTENSIONS_DB, extensions.filter(e => e.id !== id)); return true; });

// ============================================================
// LAUNCH PROFILE (Cập nhật để chạy Extension sạch sẽ)
// ============================================================
function profileRuntimeState(profileId) {
  const session=activeBrowsers.get(profileId);
  return {profileId,phase:session?.phase||(session?(session.finishing?'syncing':session.starting?'starting':'running'):profileLaunchTasks.has(profileId)?'starting':accountProfiles.isProfileBusy(profileId)?'syncing':'stopped')};
}
function notifyProfileRuntime(profileId,phase,detail={}) {
  for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('profile-runtime-event',{profileId,phase,accountId:currentAccount?.id,...detail});
}
function profileDiagnostic(profileId,phase,error) {
  try{const folder=path.join(app.getPath('userData'),'diagnostics');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'profile-lifecycle.json'),JSON.stringify({at:new Date().toISOString(),profileId,phase,code:error.code||'PROFILE_SYNC_FAILED'},null,2));}catch{}
}
ipcMain.handle('profiles:runtime-state',()=>getData(PROFILES_DB).filter(p=>(!p.localAccountId||p.localAccountId===currentAccount?.id)&&!profileAdminControl?.isDeleted(p)).map(p=>profileRuntimeState(p.id)));
async function launchProfileInternal(profileId,options = {}) {
  let localProxy = null;
  try {
    let profile = getData(PROFILES_DB).find(item => item.id === profileId);
    if (!profile) return { success: false, error: 'Không tìm thấy hồ sơ!' };
    // Poll Admin commands in the background; opening local files never waits on storage or network.
    void profileAdminControl?.refresh().catch(()=>{});
    profile=getData(PROFILES_DB).find(p=>p.id===profileId);
    if(!profile)return {success:false,error:'Admin đã xóa hồ sơ này.',code:'PROFILE_ADMIN_DELETED'};
    profileAdminControl?.assertUsable(profile);
    if (profile.localAccountId && profile.localAccountId !== currentAccount?.id && currentAccount?.role !== 'admin') throw new Error('Hồ sơ thuộc tài khoản khác.');
    if (activeBrowsers.get(profileId)?.finishing||activeBrowsers.get(profileId)?.phase==='closing') throw Object.assign(Error('Hồ sơ đang đóng. Đợi hoàn tất trước khi mở lại.'),{code:'PROFILE_CLOSING'});
    if (activeBrowsers.has(profileId)) return { success: true };
    if (accountProfiles.isProfileBusy(profileId)) throw Object.assign(Error('Hồ sơ đang được đồng bộ hoặc lưu cấu hình. Vui lòng đợi hoàn tất.'),{code:'PROFILE_CLOSING'});
    if (isLocalSnapshot(profile) && !fs.existsSync(getProfileDataPath(profileId))) throw Error('Không tìm thấy dữ liệu hồ sơ trên máy. Khôi phục từ bản sao lưu cục bộ.');

    if(profile.cloudProfileId&&!profile.localStorageMode&&!fs.existsSync(getProfileDataPath(profileId)))throw Object.assign(Error('Hồ sơ này chưa có dữ liệu trên máy. Khôi phục từ bản sao lưu cục bộ trước khi mở.'),{code:'PROFILE_LOCAL_DATA_MISSING'});

    if(waitingForProfileSyncBeforeQuit)throw new Error('Ứng dụng đang đóng.');
    const execPath = getBrowserExecutable();
    if (!execPath) throw new Error('Không tìm thấy Google Chrome!');

    const parsedProxy=parseProxy(profile),hasProxy=!!parsedProxy;
    let targetTimezone=Intl.DateTimeFormat().resolvedOptions().timeZone,networkResult=null;
    if(profile.proxyTimezoneMode==='manual'){
      if(!validTimezone(profile.proxyTimezone))throw Error('Múi giờ thủ công không hợp lệ.');targetTimezone=profile.proxyTimezone;
    }
    if(hasProxy){
      localProxy=await proxyNetwork.open(profile);
      try{networkResult=await proxyNetwork.observe(localProxy);}catch(error){throw Error(explainProxyError(error).error);}
      if(profile.proxyTimezoneMode==='manual'){
        if(!validTimezone(profile.proxyTimezone))throw Error('Múi giờ thủ công không hợp lệ.');targetTimezone=profile.proxyTimezone;
      }else{
        if(!networkResult.timezone)throw Error('Đã kết nối proxy nhưng chưa lấy được múi giờ IP thoát. Thử lại hoặc chọn múi giờ thủ công trong cấu hình proxy.');
        targetTimezone=networkResult.timezone;
      }
      const rows=getData(PROFILES_DB),saved=rows.find(p=>p.id===profileId);
      if(saved&&proxyKey(saved)===proxyKey(profile)){
        Object.assign(saved,{proxyTimezone:targetTimezone,proxyCountry:networkResult.country,proxyLastCheck:networkResult});
        if(!saveData(PROFILES_DB,rows))throw Error('Không lưu được kết quả kiểm tra proxy.');profile=saved;
      }
    }

    const profileDir = getProfileDataPath(profile.id);
    if (!profileDir) throw new Error('Đường dẫn hồ sơ không hợp lệ.');
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

    const defaultDir = path.join(profileDir, 'Default');
    if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
    
    const prefPath = path.join(defaultDir, 'Preferences');
    let prefs = {};
    if (fs.existsSync(prefPath)) { try { prefs = JSON.parse(fs.readFileSync(prefPath)); } catch {} }
    
    if (hasProxy) {
      prefs.webrtc = { ip_handling_policy: 'disable_non_proxied_udp', multiple_routes_enabled: false, non_proxied_udp_enabled: false };
    } else {
      prefs.webrtc = { ip_handling_policy: 'default', multiple_routes_enabled: true, non_proxied_udp_enabled: true };
    }

    if (!prefs.profile) prefs.profile = {};
    // Nhiều nút liên kết do người dùng bấm mở trang đích bằng window.open().
    // Cho phép popup trong hồ sơ để các luồng này mở được tab/trang mới.
    if (!prefs.profile.default_content_setting_values || typeof prefs.profile.default_content_setting_values !== 'object') {
      prefs.profile.default_content_setting_values = {};
    }
    prefs.profile.default_content_setting_values.popups = 1;
    prefs.profile.exit_type = "Normal";
    prefs.profile.exited_cleanly = true;
    fs.writeFileSync(prefPath, JSON.stringify(prefs, null, 2));

    const debugPort = await findFreePort();

    const extensionsList = getData(EXTENSIONS_DB);
    const extPaths = extensionsList.filter(e => e.enabled !== false).map(e => e.path).filter(p => fs.existsSync(p));

    const args = [
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized',
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${debugPort}`,
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-features=InfiniteSessionRestore',
      'about:blank'
    ];

    if (hasProxy) {
      args.push(`--proxy-server=${localProxy.url}`);
      args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-quic','--proxy-bypass-list=<-loopback>');
    } else {
      args.push('--force-webrtc-ip-handling-policy=default');
    }
    
    if (extPaths.length > 0) {
      const joinedPaths = extPaths.join(',');
      args.push(`--disable-extensions-except=${joinedPaths}`);
      args.push(`--load-extension=${joinedPaths}`);
    }

    const envVars = { ...process.env };
    if (targetTimezone) { envVars['TZ'] = targetTimezone; }

    if(waitingForProfileSyncBeforeQuit)throw new Error('Ứng dụng đang đóng.');
    const child = spawn(execPath, args, { cwd: path.dirname(execPath), detached: false, windowsHide: false, env: envVars, stdio: 'ignore' });
    const session = { process: child, proxy: localProxy, debugPort, timezone: targetTimezone, cdpClient: null, browserWsUrl: null, cloudProfileId:null,cloudLockHeld:false, starting: true, finishing: false, phase:'starting' };
    let resolveClosed;
    session.closedPromise = new Promise(resolve => { resolveClosed = resolve; });
    // Browser data remains on this device.
    session.network=networkResult;
    activeBrowsers.set(profileId, session);
    notifyProfileRuntime(profileId,'starting');

    const notify = (channel, data) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, data);
    };
    const finishSession = async launchError => {
      if (session.finishing) return session.closedPromise;
      launchError=launchError||session.launchError||(session.starting?Object.assign(Error('Chrome đã đóng khi đang khởi động hồ sơ.'),{code:'CHROME_EXITED'}):null);
      session.finishing=true;session.phase='closing';notifyProfileRuntime(profileId,'closing');
      try {
        if(session.cdpClient){try{session.cdpClient.close();}catch{}}
        if(localProxy)await localProxy.close().catch(()=>{});

      } catch(error) {
        session.closeError=error.message;profileDiagnostic(profileId,session.phase,error);
        notify('cloud-sync-event',{profileId,success:false,status:'profile-close-failed',message:error.message});
      } finally {
        // No archive upload or remote lock release is required for local profiles.
        if(activeBrowsers.get(profileId)===session)activeBrowsers.delete(profileId);
        resolveClosed();notify('browser-closed',profileId);notifyProfileRuntime(profileId,'stopped');
      }
    };
    if(networkResult)notify('proxy-network-event',{profileId,result:networkResult,timezone:targetTimezone});
    child.once('error', error => { void finishSession(error); });
    child.once('close', () => { void finishSession(); });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });

    try {
      let lastError;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const browserWsUrl=await waitForChromeCDP(debugPort,45000,()=>!session.finishing&&child.exitCode==null);
          if(session.finishing)throw Object.assign(Error('Chrome đã đóng khi đang mở hồ sơ.'),{code:'CHROME_EXITED'});
          session.browserWsUrl=browserWsUrl;
          const client=await applyTimezoneGlobal(browserWsUrl,targetTimezone,options.startUrl||'about:blank');
          if(session.finishing){try{client.close();}catch{}throw Object.assign(Error('Chrome đã đóng khi đang mở hồ sơ.'),{code:'CHROME_EXITED'});}
          session.cdpClient=client;
          const navigationWarning=()=>{if(session.navigationWarningSent||session.finishing)return;session.navigationWarningSent=true;notify('cloud-sync-event',{profileId,success:false,status:'profile-navigation-warning',message:'Hồ sơ đã mở. Trang ban đầu chưa tải được; bạn có thể tải lại trong Chrome.'});};
          client.on?.('td-navigation-warning',navigationWarning);if(client._tdNavigationFailed)navigationWarning();
          lastError=null;break;
        }catch(error){lastError=error;if(session.finishing||error.code==='TIMEZONE_MISMATCH'||error.code==='CHROME_EXITED'||attempt===1)throw error;await new Promise(resolve=>setTimeout(resolve,400));}
      }
      if(lastError)throw lastError;
      session.starting=false;session.phase='running';notifyProfileRuntime(profileId,'running');
    } catch (error) {
      const detail=error.code==='TIMEZONE_MISMATCH'?'Múi giờ Chrome không khớp cấu hình.':error.code==='CHROME_EXITED'?'Chrome đã đóng trước khi hoàn tất khởi động.':'Chrome chưa sẵn sàng hoặc chưa áp dụng được múi giờ sau khi thử lại.';
      session.launchError=Object.assign(Error(detail+' Hồ sơ chưa được mở; thử lại và kiểm tra chẩn đoán nếu lỗi lặp lại.'),{code:error.code||'CHROME_TIMEZONE_SETUP'});
      try{if(typeof app!=='undefined'){const folder=path.join(app.getPath('userData'),'diagnostics');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'chrome-startup.json'),JSON.stringify({at:new Date().toISOString(),profileId,phase:'cdp-timezone',code:session.launchError.code,timezone:targetTimezone,browser:path.basename(execPath),debugPort},null,2));}}catch{}
      try{session.process?.kill();}catch{}
      throw session.launchError;
    }
    return { success: true };
  } catch (error) {
    if (localProxy) await localProxy.close().catch(() => {});
    return { success: false, error: error.message, code:error.code || null };
  }
}
ipcMain.handle('launch-profile', (event,profileId) => launchProfile(profileId));


function launchProfile(profileId,options = {}) {
  if(profileLaunchTasks.has(profileId)) return profileLaunchTasks.get(profileId);
  // Reserve synchronously before the first async check or background callback.
  const task=Promise.resolve().then(()=>launchProfileInternal(profileId,options));profileLaunchTasks.set(profileId,task);
  notifyProfileRuntime(profileId,'starting');
  task.finally(()=>{if(profileLaunchTasks.get(profileId)===task)profileLaunchTasks.delete(profileId);notifyProfileRuntime(profileId,profileRuntimeState(profileId).phase);}).catch(()=>{});
  return task;
}
async function stopProfile(profileId,options = {}) {
  const launching=profileLaunchTasks.get(profileId);if(launching&&options.skipLaunching)return {success:true,status:'starting'};if(launching)await launching;
  const session=activeBrowsers.get(profileId);if(!session)return {success:true,status:'stopped'};
  if(!session.finishing){
    session.phase='closing';notifyProfileRuntime(profileId,'closing');
    let closeTimer;
    try{if(session.cdpClient?._tdSend)await Promise.race([session.cdpClient._tdSend('Browser.close'),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('Chrome chưa phản hồi lệnh đóng.')),5000);})]);else session.process?.kill();}
    catch{if(!session.finishing)try{session.process?.kill();}catch{}}
    finally{clearTimeout(closeTimer);}
  }
  if(options.waitForSync&&session.closedPromise){
    let timer;
    try{await Promise.race([session.closedPromise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Hồ sơ vẫn đang đóng. Hãy kiểm tra trạng thái trong app.')),310000);})]);if(session.closeError)throw new Error(session.closeError);}
    finally{clearTimeout(timer);}
  }
  return {success:true,status:activeBrowsers.has(profileId)?'closing':'stopped'};
}
ipcMain.handle('close-profile', (event,profileId) => stopProfile(profileId));


let waitingForProfileSyncBeforeQuit = false;
async function scheduleInstallerAfterExit(exe){
  if(!fs.statSync(exe).isFile()||fs.statSync(exe).size<1024)throw Error('Bộ cài không hợp lệ. Tải lại bản cập nhật.');
  const folder=path.join(app.getPath('userData'),'diagnostics');fs.mkdirSync(folder,{recursive:true});
  const marker=path.join(folder,'installer-ready-'+crypto.randomUUID()+'.txt'),log=path.join(folder,'installer-launch.log');
  const quote=value=>"'"+value.replace(/'/g,"''")+"'";
  const script="$ErrorActionPreference='Stop'; try { $tdParent=Get-Process -Id "+process.pid+" -ErrorAction SilentlyContinue; [IO.File]::WriteAllText("+quote(marker)+",'ready'); if($tdParent){$tdParent.WaitForExit()}; Start-Process -FilePath "+quote(exe)+" -ErrorAction Stop } catch { [IO.File]::WriteAllText("+quote(log)+",$_.Exception.Message); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Không mở được bộ cài TD Browser. Hãy mở trực tiếp file: '+"+quote(exe)+") | Out-Null; exit 1 }";
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const child=spawn(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{detached:true,windowsHide:true,stdio:'ignore'});
  let failure=null;child.on('error',error=>{failure=error;});
  try{
    const until=Date.now()+15000;
    while(!fs.existsSync(marker)){
      if(failure||child.exitCode!=null)throw Error('Không khởi chạy được trình hỗ trợ cài đặt. Hãy mở bộ cài trực tiếp.');
      if(Date.now()>until){try{child.kill();}catch{}throw Error('Trình hỗ trợ cài đặt chưa sẵn sàng. Hãy thử lại.');}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    child.unref();
  }finally{try{fs.unlinkSync(marker);}catch{}}
}

if(hasManagerLock){
  managerLifecycle=installManagerLifecycle({app,getWindow:()=>BrowserWindow.getAllWindows().find(win=>!win.isDestroyed()),createWindow,
    stopWork:async()=>{
      waitingForProfileSyncBeforeQuit=true;profileAdminControl?.shutdown();accountProfiles.shutdown();profileCatalogSync?.shutdown();proxyLibrary.shutdown();
      await Promise.allSettled([automationHttp?.shutdown(),automation?.shutdown()]);
      await Promise.allSettled(Array.from(profileLaunchTasks.values()));
      await Promise.all(Array.from(activeBrowsers.keys(),id=>stopProfile(id,{waitForSync:false})));
    },
    isBusy:()=>activeBrowsers.size>0||profileLaunchTasks.size>0||snapshotDownloads.size>0||!!profileAdminControl?.isBusy()||!!automation?.isBusy()||accountProfiles.isBusy(),
    describe:()=>({profiles:activeBrowsers.size,launching:profileLaunchTasks.size,automationBusy:!!automation?.isBusy(),cloudBusy:snapshotDownloads.size>0||!!profileAdminControl?.isBusy()||accountProfiles.isBusy()}),
    finishWork:async()=>{await proxyNetwork.shutdown();supabase.auth.stopAutoRefresh();},
    forceStop:()=>{for(const session of activeBrowsers.values()){try{session.process?.kill();}catch{}}},
    complete:force=>{if(force)app.exit(0);else app.quit();}
  });
}
function localLifecycleRequest(event){const uri=require('url').pathToFileURL(path.join(__dirname,'index.html')).href;if(event.senderFrame!==event.sender.mainFrame||event.senderFrame.url.split('#')[0]!==uri)throw Error('Nguồn yêu cầu không hợp lệ.');}
ipcMain.handle('app:shutdown-state',event=>{localLifecycleRequest(event);return managerLifecycle?.status()||{phase:'idle'};});
ipcMain.handle('app:retry-quit',event=>{localLifecycleRequest(event);managerLifecycle?.request();return true;});
ipcMain.handle('app:force-quit',async event=>{localLifecycleRequest(event);if(!managerLifecycle?.isClosing())return false;const choice=await dialog.showMessageBox(BrowserWindow.getAllWindows()[0],{type:'warning',title:'Thoát ngay TD Browser?',message:'Tác vụ đang chạy hoặc tải video sẽ bị gián đoạn.',detail:'Dữ liệu cục bộ và nhật ký tải được giữ. Thay đổi chưa kịp lưu trong Chrome có thể mất. Bạn cần kiểm tra và tiếp tục các video chưa xong sau khi mở lại.',buttons:['Tiếp tục chờ','Thoát ngay'],defaultId:0,cancelId:0});if(choice.response===1)return managerLifecycle.force();return false;});

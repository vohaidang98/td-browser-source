'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function installProfileCatalogSync({ ipcMain, cloud, manager, userDataPath, getAccount, getProfiles, activeBrowsers, appVersion, notify, beforeSync=async()=>{} }) {
  const deviceFile = path.join(userDataPath, 'profile-catalog-device-id.json');
  let deviceId;
  try { deviceId = JSON.parse(fs.readFileSync(deviceFile, 'utf8')).id; } catch {}
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId || '')) {
    deviceId = crypto.randomUUID();
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(deviceFile, JSON.stringify({ id: deviceId }));
  }
  let busy = false, rerun = false, debounceTimer = null, departed = false, closing = false;
  let lastError = null;
  function snapshot(accountId) {
    return getProfiles().filter(p => !p.localAccountId || p.localAccountId === accountId).map(p => ({
      local_id: String(p.id), cloud_id:null, name: String(p.name || 'Hồ sơ mới').slice(0, 120),
      running: !!activeBrowsers.get(p.id)&&!activeBrowsers.get(p.id).finishing, revision:0, admin_deleted:!!p.adminDeleted
    }));
  }
  async function tick() {
    if (closing || !getAccount()) return;
    if (busy) { rerun = true; return; }
    busy = true; departed = false;
    const accountId = getAccount().id;
    try {
      try{await beforeSync();}catch(error){console.warn('Admin deletion polling:',error.message);}
      if (getAccount()?.id !== accountId || departed) return;
      try { await manager.reconcile(); } catch (error) { console.warn('Catalog reconciliation:', error.message); }
      if (getAccount()?.id !== accountId || departed) return;
      const profiles = snapshot(accountId);
      // Only profile names, local IDs and running state are sent. No browser files or credentials.
      const response = await cloud.rpc('td_sync_device_profile_catalog', {
        p_device_id: deviceId, p_app_version: appVersion, p_profiles: profiles
      });
      if (getAccount()?.id !== accountId || departed) return;
      lastError = null;
      notify({ success: true, status: 'catalog-heartbeat', lastSyncedAt: response, profileCount: profiles.length });
    } catch (error) {
      const message = error.message || String(error);
      if (message !== lastError) console.warn('Catalog heartbeat:', message);
      lastError = message;
      notify({ success: false, status: 'catalog-heartbeat', message });
    } finally {
      busy = false;
      if (departed && getAccount()?.id === accountId) await cloud.rpc('td_disconnect_device_profile_catalog', { p_device_id: deviceId }).catch(() => {});
      if (rerun) { rerun = false; schedule(1000); }
    }
  }
  function schedule(delay = 1500) {
    if(closing)return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; void tick(); }, delay);
    debounceTimer.unref();
  }
  async function depart() {
    departed = true;
    rerun = false;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    // Let an in-flight heartbeat finish before marking the device disconnected.
    if (busy) return;
    await cloud.rpc('td_disconnect_device_profile_catalog', { p_device_id: deviceId }).catch(() => {});
  }
  ipcMain.handle('catalog:request-sync', async () => { schedule(0); void manager.background(); return true; });
  ipcMain.handle('admin:catalog-status', async () => cloud.rpc('td_admin_profile_catalog_status'));
  const timer = setInterval(() => { void tick(); }, 30000);
  timer.unref();
  return { shutdown:()=>{closing=true;departed=true;rerun=false;clearInterval(timer);clearTimeout(debounceTimer);}, schedule, depart, tick, getDeviceId: () => deviceId };
}
module.exports = { installProfileCatalogSync };

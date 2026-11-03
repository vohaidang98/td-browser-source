'use strict';
// Kích hoạt bằng một mã duy nhất. Chỉ lưu mã băm (PBKDF2), không có mã gốc trong app.
// Tạo mã băm mới: node tools/make-hash.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const SALT = Buffer.from('TD-Browser|activation|v1');
const ROUNDS = 200000;
const CODE_HASH = '2e4b3d8f1c8faac55c3f0fee86cab0cac42a98f092f0e01f5463f8d4f4c58665';

function hashCode(code) {
  return crypto.pbkdf2Sync(String(code).trim(), SALT, ROUNDS, 32, 'sha256').toString('hex');
}
function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const storeFile = () => path.join(app.getPath('userData'), 'license.json');

function isActivated() {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return same(data.hash || '', CODE_HASH);
  } catch { return false; }
}
function activate(code) {
  if (!same(hashCode(code), CODE_HASH)) return false;
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify({ hash: CODE_HASH }), 'utf8');
  return true;
}

const PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kích hoạt TD Browser</title>
<style>body{font:14px Segoe UI,sans-serif;margin:0;padding:26px;background:#f3f6fa;color:#1d2733}
input{width:100%;box-sizing:border-box;padding:9px;margin:14px 0 6px;font-size:15px}
button{padding:8px 18px;font-size:14px;margin-left:8px}#m{color:#c0392b;min-height:20px}.r{text-align:right;margin-top:12px}</style>
<body><div>Nhập mã kích hoạt để sử dụng TD Browser.</div>
<input id="c" type="password" autofocus autocomplete="off"><div id="m"></div>
<div class="r"><button id="x">Thoát</button><button id="o">Kích hoạt</button></div>
<script>
const c=document.getElementById('c'),m=document.getElementById('m');
async function go(){const r=await window.licenseApi.submit(c.value);if(!r){c.value='';m.textContent='Mã không đúng. Hãy thử lại.';}}
document.getElementById('o').onclick=go;document.getElementById('x').onclick=()=>window.licenseApi.cancel();
c.addEventListener('keydown',e=>{if(e.key==='Enter')go();});
</script></body></html>`;

let handlersReady = false;
// Trả về true nếu đã kích hoạt (hoặc nhập đúng mã), false nếu người dùng thoát.
function ensureActivated() {
  if (isActivated()) return Promise.resolve(true);
  return new Promise(resolve => {
    let done = false;
    const win = new BrowserWindow({
      width: 420, height: 230, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
      title: 'Kích hoạt TD Browser',
      webPreferences: { preload: path.join(__dirname, 'license-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
    });
    const finish = ok => { if (done) return; done = true; if (!win.isDestroyed()) win.destroy(); resolve(ok); };
    if (!handlersReady) {
      handlersReady = true;
      ipcMain.handle('license:submit', (e, code) => { const ok = activate(code); if (ok) setImmediate(() => app.emit('td-license-ok')); return ok; });
      ipcMain.handle('license:cancel', () => { app.emit('td-license-cancel'); });
    }
    const onOk = () => finish(true), onCancel = () => finish(false);
    app.once('td-license-ok', onOk);
    app.once('td-license-cancel', onCancel);
    win.on('closed', () => { app.removeListener('td-license-ok', onOk); app.removeListener('td-license-cancel', onCancel); finish(false); });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
  });
}

module.exports = { isActivated, activate, ensureActivated, hashCode };

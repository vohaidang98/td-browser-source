'use strict';
// Cập nhật từ thư mục mạng LAN: version.json + file cài đặt (kiểm tra SHA-256).
// Tạo thư mục phát hành: node tools/make-release.js <file cài đặt> <phiên bản> <thư mục đích> [ghi chú]
// Chỉ cho tài khoản quản trị quyền GHI vào thư mục chia sẻ (ai ghi được là đẩy được chương trình tới mọi máy).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const settingsFile = app => path.join(app.getPath('userData'), 'update.json');

function getFolder(app) {
  try { return String(JSON.parse(fs.readFileSync(settingsFile(app), 'utf8')).folder || '').trim(); } catch { return ''; }
}
function setFolder(app, folder) {
  fs.mkdirSync(path.dirname(settingsFile(app)), { recursive: true });
  fs.writeFileSync(settingsFile(app), JSON.stringify({ folder }), 'utf8');
}

function parseVersion(text) {
  const m = String(text).match(/(\d+(?:\.\d+){0,3})/);
  return m ? m[1].split('.').map(Number) : [];
}
function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a.length) return false;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function checkLatest(folder, currentVersion) {
  const manifestPath = path.join(folder, 'version.json');
  let raw;
  try { raw = await fsp.readFile(manifestPath, 'utf8'); } catch { throw Error('Không tìm thấy version.json trong thư mục cập nhật:\n' + folder); }
  const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const version = String(data.version || '');
  if (!isNewer(version, currentVersion)) return null;
  const name = String(data.file || ''), sha = String(data.sha256 || '').toLowerCase();
  if (!/^[\w.\-]+\.exe$/.test(name)) throw Error('Tên file cập nhật không hợp lệ.');
  if (!/^[0-9a-f]{64}$/.test(sha)) throw Error('version.json thiếu mã SHA-256 hợp lệ.');
  const file = path.join(folder, name);
  try { await fsp.access(file); } catch { throw Error('Chưa thấy file ' + name + ' trong thư mục cập nhật.'); }
  return { version: version.replace(/^[vV]/, ''), name, file, sha256: sha, notes: String(data.notes || '') };
}

async function copyVerified(app, info, onPercent) {
  const dest = path.join(app.getPath('temp'), 'tdbrowser-update-' + crypto.randomUUID());
  await fsp.mkdir(dest, { recursive: true });
  const out = path.join(dest, info.name);
  const total = (await fsp.stat(info.file)).size;
  const hash = crypto.createHash('sha256');
  let done = 0, last = -1;
  await new Promise((resolve, reject) => {
    const src = fs.createReadStream(info.file, { highWaterMark: 1 << 20 }), dst = fs.createWriteStream(out);
    src.on('data', chunk => {
      hash.update(chunk); done += chunk.length;
      const pct = total ? Math.floor(done * 100 / total) : 0;
      if (onPercent && pct !== last) { last = pct; onPercent(pct); }
    });
    src.on('error', reject); dst.on('error', reject); dst.on('finish', resolve);
    src.pipe(dst);
  });
  if (hash.digest('hex') !== info.sha256) {
    await fsp.rm(dest, { recursive: true, force: true });
    throw Error('File cập nhật bị lỗi (sai mã SHA-256), đã huỷ cập nhật.');
  }
  return out;
}

module.exports = { getFolder, setFolder, isNewer, checkLatest, copyVerified };

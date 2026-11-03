'use strict';
// Tạo thư mục phát hành để đặt lên thư mục chia sẻ LAN.
// Chạy: node tools/make-release.js <file cài đặt .exe> <phiên bản> <thư mục đích> [ghi chú]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [installer, version, dest, notes = ''] = process.argv.slice(2);
if (!installer || !version || !dest) { console.error('Dùng: node tools/make-release.js <file cài đặt> <phiên bản> <thư mục đích> [ghi chú]'); process.exit(1); }
if (!fs.existsSync(installer)) { console.error('Không thấy file: ' + installer); process.exit(1); }
fs.mkdirSync(dest, { recursive: true });
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
const target = path.join(dest, path.basename(installer));
if (path.resolve(installer) !== path.resolve(target)) fs.copyFileSync(installer, target);
fs.writeFileSync(path.join(dest, 'version.json'), JSON.stringify({ version, file: path.basename(installer), sha256, notes }, null, 2), 'utf8');
console.log('Da tao:', path.join(dest, 'version.json'));

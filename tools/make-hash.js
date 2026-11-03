'use strict';
// Tạo mã băm từ mã kích hoạt để dán vào licensing.js (CODE_HASH). Mã nhập vào hiện dấu * và không được lưu.
// Chạy: node tools/make-hash.js
const crypto = require('crypto');
const readline = require('readline');

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { rl.output.write(s.startsWith(question) ? s : '*'.repeat(s.replace(/[\r\n]/g, '').length) + (/[\r\n]/.test(s) ? '\n' : '')); };
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}
(async () => {
  const a = await ask('Nhập mã kích hoạt: '), b = await ask('Nhập lại để xác nhận: ');
  if (!a.trim() || a !== b) { console.error('Hai lần nhập không khớp hoặc để trống.'); process.exit(1); }
  console.log('CODE_HASH =', crypto.pbkdf2Sync(a.trim(), Buffer.from('TD-Browser|activation|v1'), 200000, 32, 'sha256').toString('hex'));
})();

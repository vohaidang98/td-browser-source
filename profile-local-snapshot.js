'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const isLocalSnapshot = profile => profile?.cloudSyncMode === 'snapshot';

function localSnapshot(profile, {accountId, sourceId, revision, downloadedAt} = {}) {
  if (!accountId || !sourceId) throw Error('Thiếu thông tin bản tải hồ sơ.');
  const result = {...profile};
  // Cloud metadata is provenance only. It must never make this a sync target.
  for (const key of Object.keys(result)) if (key.startsWith('cloud')) delete result[key];
  Object.assign(result, {
    localAccountId: accountId, cloudSyncMode: 'snapshot',
    sourceCloudProfileId: sourceId, sourceCloudRevision: Number(revision) || 0,
    sourceCloudDownloadedAt: downloadedAt || new Date().toISOString()
  });
  return result;
}

function getLockClientToken(userDataPath) {
  const file = path.join(userDataPath, 'profile-lock-client.json');
  fs.mkdirSync(userDataPath, {recursive:true});
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.token || '')) return value.token;
    throw Error('Mã khóa thiết bị không hợp lệ.');
  } catch (error) {
    // Never silently replace a damaged identity: that would strand its leases.
    if (error.code !== 'ENOENT') throw Error('Không đọc được mã khóa thiết bị. Giữ lại profile-lock-client.json và liên hệ hỗ trợ.');
  }
  const token = crypto.randomUUID();
  try { fs.writeFileSync(file, JSON.stringify({token}), {flag:'wx', mode:0o600}); }
  catch (error) {
    if (error.code === 'EEXIST') return getLockClientToken(userDataPath);
    throw Error('Không lưu được mã khóa thiết bị. Kiểm tra quyền ghi thư mục dữ liệu TD Browser.');
  }
  return token;
}

module.exports = {isLocalSnapshot, localSnapshot, getLockClientToken};

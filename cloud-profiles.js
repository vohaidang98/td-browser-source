'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const {isLocalSnapshot,localSnapshot}=require('./profile-local-snapshot');

const BUCKET = 'td-browser-profile-data';
const CHUNK_BYTES = 12 * 1024 * 1024;
const MAX_CIPHER_BYTES = 20 * 1024 * 1024 * 1024;

function rpcError(error) {
  if (!error) return null;
  const text = String(error.message || error.details || error.code || 'Lỗi Supabase');
  if(['PGRST202','42883'].includes(error.code)&&/td_(?:admin_(?:request_profile_delete|pending_profile_storage_cleanup|ack_profile_storage_cleanup)|my_profile_delete_requests|ack_profile_delete)/.test(text))return Error('Admin cần chạy SUPABASE-ADMIN-DELETE-1.3.7.sql trên Supabase để bật xóa hồ sơ trên máy người dùng.');
  if (text.includes('user_sharing_disabled')) return new Error('Admin chưa bật quyền chia sẻ hồ sơ giữa người dùng.');
  if (text.includes('recipient_not_found')) return new Error('Không tìm thấy tài khoản nhận hoặc tài khoản chưa đăng ký.');
  if (text.includes('profile_locked')) return Object.assign(new Error('Cloud đang giữ khóa của một phiên trước hoặc thiết bị khác. Đóng phiên kia hoặc dùng bản độc lập trên máy.'),{code:'PROFILE_LOCKED'});
  if (text.includes('profile_access_denied')) return new Error('Tài khoản hiện tại không có quyền truy cập hồ sơ này.');
  if (text.includes('owner_or_admin_required')) return new Error('Chỉ chủ hồ sơ hoặc admin mới được cập nhật hồ sơ này.');
  if (text.includes('active_user_required')) return new Error('Tài khoản đang bị khóa hoặc chưa được cấp quyền.');
  return new Error(text);
}

function scryptKey(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key)));
}

async function createAccountKeyMetadata(password) {
  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return encryptPrivateKey(pair.privateKey, password);
}

async function encryptPrivateKey(privateKey, password) {
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await scryptKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  key.fill(0);
  key.fill(0);
  return {
    td_public_key: publicKey,
    td_private_key_ciphertext: ciphertext.toString('base64'),
    td_private_key_salt: salt.toString('base64'),
    td_private_key_iv: iv.toString('base64'),
    td_private_key_tag: cipher.getAuthTag().toString('base64')
  };
}

async function decryptPrivateKey(userRow, password) {
  if (!userRow || !userRow.public_key || !userRow.private_key_ciphertext) throw new Error('Tài khoản chưa có khóa mã hóa hồ sơ. Hãy liên hệ admin để khởi tạo lại tài khoản.');
  const key = await scryptKey(password, Buffer.from(userRow.private_key_salt, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(userRow.private_key_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(userRow.private_key_tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(userRow.private_key_ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Không giải mã được khóa hồ sơ. Kiểm tra lại mật khẩu tài khoản.');
  } finally { key.fill(0); }
}

function wrapDataKey(publicKey, dataKey) {
  return crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, dataKey).toString('base64');
}

function unwrapDataKey(privateKey, envelope) {
  try {
    return crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope, 'base64'));
  } catch { throw new Error('Không thể mở khóa dữ liệu hồ sơ bằng tài khoản hiện tại.'); }
}

function runTar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', part => stdout.push(part));
    child.stderr.on('data', part => stderr.push(part));
    child.on('error', error => reject(new Error(`Không chạy được tiện ích nén của Windows (tar.exe): ${error.message}`)));
    child.on('close', code => code === 0 ? resolve(Buffer.concat(stdout).toString('utf8')) : reject(new Error(`Không thể nén/giải nén hồ sơ: ${Buffer.concat(stderr).toString('utf8').trim() || `tar.exe trả mã ${code}`}`)));
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function profileIdValid(id) { return typeof id === 'string' && /^TD_[A-Za-z0-9_-]{1,100}$/.test(id); }

class CloudProfiles {
  constructor({ supabase, userDataPath, lockClientToken, getCurrentUser, getPrivateKey, getProfiles, saveProfiles, profileDataPath }) {
    this.supabase = supabase;
    this.userDataPath = userDataPath;
    this.lockClientToken = lockClientToken;
    this.getCurrentUser = getCurrentUser;
    this.getPrivateKey = getPrivateKey;
    this.getProfiles = getProfiles;
    this.saveProfiles = saveProfiles;
    this.profileDataPath = profileDataPath;
    this.lockTimers = new Map();
  }

  async rpc(name, args) {
    const { data, error } = await this.supabase.rpc(name, args);
    if (error) throw rpcError(error);
    return data;
  }

  async currentUser() {
    const user = this.getCurrentUser();
    if (!user?.id) throw new Error('Vui lòng đăng nhập lại.');
    return user;
  }

  async listProfiles() { return this.rpc('td_list_cloud_profiles'); }
  async listShareRecipients({profileId,search='',offset=0}={}){
    const user=await this.currentUser();
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(profileId||'')||typeof search!=='string'||search.length>254||!Number.isInteger(offset)||offset<0||offset>1000000)throw Error('Thông tin tìm người nhận không hợp lệ.');
    const response=await this.supabase.rpc('td_list_share_recipients',{p_profile_id:profileId,p_search:search.trim(),p_offset:offset,p_limit:51});
    if(this.getCurrentUser()?.id!==user.id)throw Error('Tài khoản đã thay đổi.');
    let rows=response.data;
    if(response.error){
      if(!['PGRST202','42883'].includes(response.error.code))throw rpcError(response.error);
      if(user.role!=='admin')throw Error('Admin cần chạy SQL 202610140003_share_recipient_picker.sql để bật danh sách người nhận.');
      // Existing Admin RPC/RLS supports the picker before the optional migration.
      const [users,profiles,shares]=await Promise.all([this.listUsers(),this.listProfiles(),this.supabase.from('profile_shares').select('recipient_id').eq('profile_id',profileId)]);
      if(this.getCurrentUser()?.id!==user.id)throw Error('Tài khoản đã thay đổi.');
      if(shares.error)throw rpcError(shares.error);
      const profile=profiles.find(p=>p.id===profileId&&p.status==='active');if(!profile)throw Error('Không có quyền chia sẻ hồ sơ này.');
      const shared=new Set((shares.data||[]).map(s=>s.recipient_id)),query=search.trim().toLowerCase();
      rows=(users||[]).filter(u=>u.status==='active'&&u.user_id!==user.id&&u.user_id!==profile.owner_id&&typeof u.email==='string'&&u.email.toLowerCase().includes(query)).map(u=>({user_id:u.user_id,email:u.email,already_shared:shared.has(u.user_id),can_receive:!!u.has_recovery_key})).sort((a,b)=>Number(a.already_shared)-Number(b.already_shared)||a.email.localeCompare(b.email,'en')).slice(offset,offset+51);
    }
    if(!Array.isArray(rows))throw Error('Không tải được danh sách người nhận.');
    return {users:rows.slice(0,50).map(u=>({userId:u.user_id,email:String(u.email),alreadyShared:!!u.already_shared,canReceive:!!u.can_receive})),hasMore:rows.length>50};
  }
  async listUsers() {
    const response=await this.supabase.rpc('td_admin_list_users_v2');
    if(!response.error)return response.data;
    if(['PGRST202','42883'].includes(response.error.code))return (await this.rpc('td_admin_list_users')).map(u=>({...u,automation_schema_ready:false,automation_enabled:false}));
    throw rpcError(response.error);
  }
  async getAdminSettings() { return this.rpc('td_admin_get_settings'); }
  async setUserSharing(enabled) { return this.rpc('td_admin_set_user_sharing', { p_enabled: !!enabled }); }
  async setUser(userId, role, status, automationEnabled) { if(typeof automationEnabled==='boolean')return this.rpc('td_admin_set_user_v2',{p_user_id:userId,p_role:role,p_status:status,p_automation_enabled:automationEnabled});return this.rpc('td_admin_set_user',{p_user_id:userId,p_role:role,p_status:status}); }
  async renameProfile(profileId, name) {
    const finalName = String(name || '').trim();
    await this.rpc('td_rename_cloud_profile', { p_profile_id: profileId, p_profile_name: finalName });
    const profiles = this.getProfiles();
    const updated = profiles.map(profile => profile.cloudProfileId === profileId ? { ...profile, name: finalName } : profile);
    this.saveProfiles(updated);
  }

  async adminPublicKeys() {
    const result = await this.rpc('td_admin_public_keys');
    if (!result || !result.length) throw new Error('Chưa có khóa admin để bảo vệ hồ sơ trên cloud. Đăng nhập lại bằng tài khoản admin hoặc liên hệ người quản trị.');
    return result;
  }

  async recipient(email) {
    const rows = await this.rpc('td_lookup_profile_recipient', { p_email: String(email || '').trim() });
    if (!rows || !rows.length) throw new Error('Không tìm thấy người dùng đang hoạt động có email này.');
    return rows[0];
  }

  async makeEnvelopes(dataKey, owner) {
    const adminKeys = await this.adminPublicKeys();
    const byId = new Map([[owner.user_id, owner]]);
    for (const admin of adminKeys) byId.set(admin.user_id, admin);
    return Array.from(byId.values()).filter(person => person.public_key).map(person => ({
      user_id: person.user_id, public_key: person.public_key,
      encrypted_key: wrapDataKey(person.public_key, dataKey)
    }));
  }

  async makeArchive(profileId, profile) {
    if (!profileIdValid(profileId)) throw new Error('Mã hồ sơ không hợp lệ.');
    const browserRoot = path.join(this.userDataPath, 'BrowserData');
    fs.mkdirSync(browserRoot, { recursive: true });
    const profileDir = this.profileDataPath(profileId);
    if (!profileDir || !fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-profile-'));
    const archive = path.join(temp, 'profile.zip');
    const configFile = path.join(temp, 'profile.json');
    fs.writeFileSync(configFile, JSON.stringify(profile), { encoding: 'utf8', mode: 0o600 });
    try {
      await runTar(['-a', '-c', '-f', archive,
        '--exclude=SingletonLock', '--exclude=SingletonCookie', '--exclude=SingletonSocket', '--exclude=DevToolsActivePort',
        '-C', browserRoot, profileId, '-C', temp, 'profile.json']);
      return { temp, archive };
    } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
  }

  async encryptArchive(archivePath, dataKey) {
    const archiveSize = fs.statSync(archivePath).size;
    if (archiveSize < 1 || archiveSize > MAX_CIPHER_BYTES) throw new Error('Kích thước hồ sơ cloud vượt giới hạn 20 GB.');
    const encryptedPath = `${archivePath}.enc`;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
    await pipeline(fs.createReadStream(archivePath), cipher, fs.createWriteStream(encryptedPath, { flags: 'wx' }));
    const stat = fs.statSync(encryptedPath);
    if (stat.size < 1 || stat.size > MAX_CIPHER_BYTES) throw new Error('Kích thước hồ sơ cloud vượt giới hạn 20 GB.');
    return { encryptedPath, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), size: stat.size, sha256: await sha256File(encryptedPath) };
  }

  async uploadChunks(profileId, revision, encryptedPath, count) {
    const fd = fs.openSync(encryptedPath, 'r');
    const uploaded = [];
    try {
      for (let index = 0; index < count; index++) {
        const start = index * CHUNK_BYTES;
        const length = Math.min(CHUNK_BYTES, fs.statSync(encryptedPath).size - start);
        const bytes = Buffer.allocUnsafe(length);
        const read = fs.readSync(fd, bytes, 0, length, start);
        if (read !== length) throw new Error('Tệp mã hóa bị thiếu dữ liệu khi tải lên.');
        const key = `${profileId}/${revision}/${String(index).padStart(6, '0')}.bin`;
        const { error } = await this.supabase.storage.from(BUCKET).upload(key, bytes, { contentType: 'application/octet-stream', upsert: true, cacheControl: '0' });
        if (error) throw rpcError(error);
        uploaded.push(key);
      }
      return uploaded;
    } catch (error) {
      if (uploaded.length) await this.supabase.storage.from(BUCKET).remove(uploaded).catch(() => {});
      throw error;
    } finally { fs.closeSync(fd); }
  }

  async createCloudArchive(profile, owner) {
    const user = await this.currentUser();
    const privateKey = this.getPrivateKey();
    if (!privateKey) throw new Error('Mật khẩu chưa được nhập lại nên chưa thể mã hóa hồ sơ. Đăng xuất rồi đăng nhập lại.');
    const dataKey = crypto.randomBytes(32);
    const archiveFiles = await this.makeArchive(profile.id, profile);
    let encrypted;
    let cloudId;
    try {
      encrypted = await this.encryptArchive(archiveFiles.archive, dataKey);
      const envelopes = await this.makeEnvelopes(dataKey, owner);
      const ownerEnvelope = envelopes.find(item => item.user_id === owner.user_id);
      if (!ownerEnvelope) throw new Error('Không tạo được khóa giải mã cho chủ hồ sơ.');
      cloudId = await this.rpc('td_create_cloud_profile', {
        p_owner_id: owner.user_id,
        p_profile_name: profile.name || 'Hồ sơ mới',
        p_cipher_iv: encrypted.iv,
        p_cipher_tag: encrypted.tag,
        p_envelopes: envelopes
      });
      const count = Math.ceil(encrypted.size / CHUNK_BYTES);
      await this.uploadChunks(cloudId, 1, encrypted.encryptedPath, count);
      await this.rpc('td_publish_cloud_profile', {
        p_profile_id: cloudId, p_revision: 1, p_chunk_count: count,
        p_sha256: encrypted.sha256, p_cipher_size: encrypted.size,
        p_cipher_iv: encrypted.iv, p_cipher_tag: encrypted.tag,
        p_admin_envelopes: envelopes.filter(item => item.user_id !== owner.user_id)
      });
      profile.cloudProfileId = cloudId;
      profile.cloudRevision = 1;
      profile.cloudOwnerId = owner.user_id;
      profile.cloudOwnerEmail = owner.email || user.email;
      const profiles = this.getProfiles();
      const index = profiles.findIndex(item => item.id === profile.id);
      if (index >= 0) { profiles[index] = { ...profiles[index], ...profile }; this.saveProfiles(profiles); }
      return { id: cloudId, revision: 1 };
    } catch (error) {
      if (cloudId) {
        await this.deleteObjectTree(cloudId).catch(() => {});
        await this.rpc('td_delete_cloud_profile', { p_profile_id: cloudId, p_client_token: this.lockClientToken }).catch(() => {});
      }
      throw error;
    } finally {
      dataKey.fill(0);
      fs.rmSync(archiveFiles.temp, { recursive: true, force: true });
    }
  }

  async createProfileForUser(profileId, email) {
    const user = await this.currentUser();
    if (user.role !== 'admin') throw new Error('Chỉ admin mới có thể tạo hồ sơ cho người dùng.');
    const owner = await this.recipient(email);
    const profile = this.getProfiles().find(item => item.id === profileId);
    if (!profile) throw new Error('Không tìm thấy hồ sơ cục bộ vừa tạo.');
    return this.createCloudArchive(profile, owner);
  }

  async registerLocalProfile(profileId) {
    this.registrations ||= new Map();
    if (this.registrations.has(profileId)) return this.registrations.get(profileId);
    const task = (async () => {
      const profile = this.getProfiles().find(p => p.id === profileId);
      if (!profile) throw new Error('Không tìm thấy hồ sơ cục bộ.');
      if(profile.adminDeleted)throw Error('Admin đã yêu cầu xóa hồ sơ này.');
      if(isLocalSnapshot(profile))throw Error('Bản tải độc lập không được tự đăng ký Cloud.');
      if (profile.cloudProfileId) return profile.cloudProfileId;
      const user = await this.currentUser();

      if (profile.localAccountId && profile.localAccountId !== user.id) throw new Error('Hồ sơ thuộc tài khoản khác trên máy.');
      const key = crypto.randomBytes(32);
      try {
        const envelopes = await this.makeEnvelopes(key, { user_id: user.id, email: user.email, public_key: user.public_key });
        const id = await this.rpc('td_create_cloud_profile', {
          p_owner_id: user.id, p_profile_name: profile.name || 'Hồ sơ mới',
          p_cipher_iv: null, p_cipher_tag: null, p_envelopes: envelopes
        });
        this.saveProfiles(this.getProfiles().map(p => p.id === profileId ? { ...p, cloudProfileId: id, cloudRevision: 0, cloudOwnerId: user.id, cloudOwnerEmail: user.email, localAccountId: user.id } : p));
        return id;
      } finally { key.fill(0); }
    })();
    this.registrations.set(profileId, task);
    try { return await task; } finally { this.registrations.delete(profileId); }
  }

  async syncProfile(profileId) {
    const profiles = this.getProfiles();
    const profile = profiles.find(item => item.id === profileId);
    if (!profile) throw new Error('Không tìm thấy hồ sơ.');
    if(isLocalSnapshot(profile))throw Error('Bản tải độc lập không đồng bộ lên Cloud.');
    if (profile.cloudProfileId) {
      const cloudRows = await this.listProfiles();
      if (cloudRows.some(item => item.id === profile.cloudProfileId)) return this.publishExisting(profile);
      throw new Error('Hồ sơ đã bị xóa hoặc tài khoản không còn được cấp quyền. Hãy làm mới danh sách.');
    }
    const user = await this.currentUser();
    const owner = { user_id: user.id, email: user.email, public_key: user.public_key };
    if (!owner.public_key) {
      const { data, error } = await this.supabase.from('app_users').select('public_key').eq('user_id', user.id).single();
      if (error) throw rpcError(error);
      owner.public_key = data.public_key;
    }
    return this.createCloudArchive(profile, owner);
  }

  async publishExisting(profile) {
    const user = await this.currentUser();
    const privateKey = this.getPrivateKey();
    if (!privateKey) throw new Error('Đăng xuất rồi đăng nhập lại để mở khóa đồng bộ.');
    const lock = await this.rpc('td_claim_profile_lock', { p_profile_id: profile.cloudProfileId, p_client_token: this.lockClientToken });
    try { return await this.publishWithLock(profile, privateKey, lock); }
    finally { await this.rpc('td_release_profile_lock', { p_profile_id: profile.cloudProfileId, p_client_token: this.lockClientToken }).catch(() => {}); }
  }

  async publishWithLock(profile, privateKey = this.getPrivateKey()) {
    if(profile.adminDeleted)throw Error('Admin đã yêu cầu xóa hồ sơ này.');
    if(isLocalSnapshot(profile))throw Error('Bản tải độc lập không đồng bộ lên Cloud.');
    if (!privateKey) throw new Error('Đăng xuất rồi đăng nhập lại để mở khóa đồng bộ.');
    const cloudRows = await this.listProfiles();
    const cloud = cloudRows.find(item => item.id === profile.cloudProfileId);
    if (!cloud) throw new Error('Không tìm thấy hồ sơ cloud hoặc bạn không có quyền truy cập.');
    const envelope = await this.rpc('td_my_key_envelope', { p_profile_id: cloud.id });
    if (!envelope) throw new Error('Tài khoản không có khóa giải mã hồ sơ cloud.');
    const dataKey = unwrapDataKey(privateKey, envelope);
    const files = await this.makeArchive(profile.id, profile);
    try {
      const encrypted = await this.encryptArchive(files.archive, dataKey);
      const revision = Number(cloud.revision || 0) + 1;
      const count = Math.ceil(encrypted.size / CHUNK_BYTES);
      await this.uploadChunks(cloud.id, revision, encrypted.encryptedPath, count);
      const adminKeys = await this.adminPublicKeys();
      const adminEnvelopes = adminKeys.map(admin => ({ user_id: admin.user_id, public_key: admin.public_key, encrypted_key: wrapDataKey(admin.public_key, dataKey) }));
      await this.rpc('td_publish_cloud_profile', {
        p_profile_id: cloud.id, p_revision: revision, p_chunk_count: count,
        p_sha256: encrypted.sha256, p_cipher_size: encrypted.size,
        p_cipher_iv: encrypted.iv, p_cipher_tag: encrypted.tag,
        p_admin_envelopes: adminEnvelopes
      });
      profile.cloudRevision = revision;
      const profiles = this.getProfiles();
      const index = profiles.findIndex(item => item.id === profile.id);
      if (index >= 0) { profiles[index] = { ...profiles[index], cloudRevision: revision }; this.saveProfiles(profiles); }
      await this.pruneRevision(cloud.id, revision - 2).catch(() => {});
      return { id: cloud.id, revision };
    } finally { dataKey.fill(0); fs.rmSync(files.temp, { recursive: true, force: true }); }
  }

  async shareProfile(cloudProfileId, email) {
    const user = await this.currentUser();
    const privateKey = this.getPrivateKey();
    if (!privateKey) throw new Error('Đăng xuất rồi đăng nhập lại để mở khóa hồ sơ.');
    const recipient = await this.recipient(email);
    const envelope = await this.rpc('td_my_key_envelope', { p_profile_id: cloudProfileId });
    if (!envelope) throw new Error('Không tìm thấy khóa hồ sơ của tài khoản hiện tại.');
    const dataKey = unwrapDataKey(privateKey, envelope);
    try {
      await this.rpc('td_share_cloud_profile_v2', {
        p_profile_id: cloudProfileId, p_recipient_email: recipient.email,
        p_encrypted_key: wrapDataKey(recipient.public_key, dataKey), p_expected_public_key: recipient.public_key, p_expected_public_key: recipient.public_key
      });
    } finally { dataKey.fill(0); }
    return true;
  }

  async transferProfile(cloudProfileId, email) {
    const user = await this.currentUser();
    if (user.role !== 'admin') throw new Error('Chỉ admin mới có thể chuyển chủ hồ sơ.');
    const privateKey = this.getPrivateKey();
    const recipient = await this.recipient(email);
    const envelope = await this.rpc('td_profile_key_for_user', { p_profile_id: cloudProfileId, p_user_id: user.id });
    if (!envelope || !privateKey) throw new Error('Admin không có khóa giải mã hồ sơ.');
    const dataKey = unwrapDataKey(privateKey, envelope);
    try {
      await this.rpc('td_admin_transfer_profile_v2', {
        p_profile_id: cloudProfileId, p_owner_id: recipient.user_id,
        p_owner_envelope: wrapDataKey(recipient.public_key, dataKey), p_expected_public_key: recipient.public_key, p_expected_public_key: recipient.public_key
      });
    } finally { dataKey.fill(0); }
  }

  async grantNewAdminsAccess() {
    const user = await this.currentUser();
    if (user.role !== 'admin') throw new Error('Chỉ admin mới có thể cấp khóa hồ sơ cho admin khác.');
    const privateKey = this.getPrivateKey();
    if (!privateKey) throw new Error('Đăng xuất rồi đăng nhập lại để mở khóa hồ sơ.');
    const admins = await this.adminPublicKeys();
    const profiles = await this.listProfiles();
    let updated = 0; let skipped = 0;
    for (const profile of profiles) {
      const envelope = await this.rpc('td_profile_key_for_user', { p_profile_id: profile.id, p_user_id: user.id }).catch(() => null);
      if (!envelope) { skipped++; continue; }
      let dataKey;
      try { dataKey = unwrapDataKey(privateKey, envelope); }
      catch { skipped++; continue; }
      try {
        const envelopes = admins.map(admin => ({ user_id: admin.user_id, public_key: admin.public_key, encrypted_key: wrapDataKey(admin.public_key, dataKey) }));
        await this.rpc('td_update_admin_key_envelopes', { p_profile_id: profile.id, p_envelopes: envelopes });
        updated++;
      } catch { skipped++; }
      finally { dataKey.fill(0); }
    }
    return { updated, skipped };
  }

  async claimLock(cloudProfileId) {
    const lease = await this.rpc('td_claim_profile_lock', { p_profile_id: cloudProfileId, p_client_token: this.lockClientToken });
    const oldTimer = this.lockTimers.get(cloudProfileId);
    if (oldTimer) clearInterval(oldTimer);
    const timer = setInterval(() => this.rpc('td_renew_profile_lock', { p_profile_id: cloudProfileId, p_client_token: this.lockClientToken }).catch(() => {}), 30 * 60 * 1000);
    this.lockTimers.set(cloudProfileId, timer);
    return lease;
  }

  async releaseLock(cloudProfileId) {
    const timer = this.lockTimers.get(cloudProfileId);
    if (timer) clearInterval(timer);
    this.lockTimers.delete(cloudProfileId);
    await this.rpc('td_release_profile_lock', { p_profile_id: cloudProfileId, p_client_token: this.lockClientToken });
  }

  async downloadToLocal(cloudProfileId, options = {}) {
    const account=await this.currentUser();
    const assertAccount=()=>{if(this.getCurrentUser()?.id!==account.id)throw Error('Tài khoản đã thay đổi trong khi tải hồ sơ.');};
    const privateKey = this.getPrivateKey();
    if (!privateKey) throw new Error('Đăng xuất rồi đăng nhập lại để mở khóa hồ sơ.');
    const rows = await this.listProfiles();
    const cloud = rows.find(item => item.id === cloudProfileId);
    if (!cloud || !cloud.chunk_count || !cloud.revision) throw new Error('Hồ sơ cloud chưa có bản dữ liệu hoàn chỉnh.');
    if (cloud.cipher_size > MAX_CIPHER_BYTES || cloud.chunk_count > 2000) throw new Error('Kích thước hồ sơ vượt giới hạn an toàn của ứng dụng.');
    const envelope = await this.rpc('td_my_key_envelope', { p_profile_id: cloudProfileId });
    if (!envelope) throw new Error('Tài khoản hiện tại không có khóa để mở hồ sơ.');
    const dataKey = unwrapDataKey(privateKey, envelope);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-cloud-download-'));
    const encryptedPath = path.join(temp, 'profile.enc');
    const archivePath = path.join(temp, 'profile.zip');
    const extractDir = path.join(temp, 'extract');
    fs.mkdirSync(extractDir);
    const fd = fs.openSync(encryptedPath, 'wx');
    let total = 0;
    try {
      for (let index = 0; index < Number(cloud.chunk_count); index++) {
        const objectKey = `${cloud.id}/${cloud.revision}/${String(index).padStart(6, '0')}.bin`;
        const { data, error } = await this.supabase.storage.from(BUCKET).download(objectKey);
        if (error) throw rpcError(error);
        const bytes = Buffer.from(await data.arrayBuffer());
        total += bytes.length;
        if (total > MAX_CIPHER_BYTES) throw new Error('Tệp hồ sơ vượt giới hạn 20 GB.');
        fs.writeSync(fd, bytes);
      }
      fs.closeSync(fd);
      if (total !== Number(cloud.cipher_size) || await sha256File(encryptedPath) !== cloud.cipher_sha256) throw new Error('Tệp hồ sơ bị thiếu hoặc checksum không khớp; bản cloud chưa được thay vào máy.');
      const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(cloud.cipher_iv, 'base64'));
      decipher.setAuthTag(Buffer.from(cloud.cipher_tag, 'base64'));
      await pipeline(fs.createReadStream(encryptedPath), decipher, fs.createWriteStream(archivePath, { flags: 'wx' }));
      const verbose = (await runTar(['-tvf', archivePath])).split(/\r?\n/).filter(Boolean);
      if (verbose.some(line => /^[lh]/.test(line.trim()))) throw new Error('Gói hồ sơ có liên kết tệp không an toàn.');
      const names = (await runTar(['-tf', archivePath])).split(/\r?\n/).filter(Boolean);
      const safeTop = new Set();
      for (const name of names) {
        const normalized = name.replace(/\\/g, '/');
        if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes(':') || normalized.split('/').includes('..')) throw new Error('Tệp hồ sơ chứa đường dẫn không an toàn.');
        safeTop.add(normalized.split('/')[0]);
      }
      const profileRoots = Array.from(safeTop).filter(name => profileIdValid(name));
      if (profileRoots.length !== 1 || !safeTop.has('profile.json')) throw new Error('Định dạng gói hồ sơ không hợp lệ.');
      await runTar(['-xf', archivePath, '-C', extractDir]);
      const importedId = profileRoots[0];
      const configPath = path.join(extractDir, 'profile.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const importedDir = path.join(extractDir, importedId);
      if (!fs.existsSync(importedDir) || path.dirname(path.resolve(importedDir)) !== path.resolve(extractDir)) throw new Error('Không tìm thấy dữ liệu trình duyệt trong gói hồ sơ.');
      assertAccount();
      const localProfiles = this.getProfiles();
      let local = options.snapshot ? null : localProfiles.find(item => !isLocalSnapshot(item) && item.cloudProfileId === cloudProfileId);
      let localId = options.snapshot ? null : options.localProfileId || local?.id;
      if (!localId) localId = `TD_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      if (!profileIdValid(localId)) throw new Error('Mã hồ sơ cục bộ không hợp lệ.');
      const destination = this.profileDataPath(localId);
      if (!destination) throw new Error('Đường dẫn hồ sơ cục bộ không hợp lệ.');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const backupDir = fs.existsSync(destination) ? `${destination}.before-cloud-${Date.now()}` : null;
      if (backupDir) fs.renameSync(destination, backupDir);
      try { fs.renameSync(importedDir, destination); }
      catch (error) {
        if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(destination)) fs.renameSync(backupDir, destination);
        throw error;
      }
      local = {
        ...config, id: localId, name: options.name || cloud.profile_name || config.name || 'Hồ sơ Cloud',
        localAccountId: this.getCurrentUser()?.id, cloudProfileId, cloudRevision: Number(cloud.revision), cloudOwnerId: cloud.owner_id,
        cloudOwnerEmail: cloud.owner_email, createdAt: config.createdAt || new Date().toISOString().slice(0, 10)
      };
      if(options.snapshot){
        local=localSnapshot(local,{accountId:account.id,sourceId:cloudProfileId,revision:cloud.revision});
        local.groupId='';local.group='Chưa chia nhóm';
      }
      assertAccount();
      const latestProfiles=this.getProfiles(),index=latestProfiles.findIndex(item=>item.id===localId);
      if(index>=0)latestProfiles[index]=local;else latestProfiles.push(local);
      if(this.saveProfiles(latestProfiles)===false){
        // Restore the previous browser directory if the metadata commit failed.
        fs.renameSync(destination,importedDir);
        if(backupDir)fs.renameSync(backupDir,destination);
        throw Error('Không lưu được danh sách hồ sơ sau khi tải.');
      }
      return { profile: local, backupDir };
    } finally {
      try { fs.closeSync(fd); } catch {}
      dataKey.fill(0);
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }

  async deleteObjectTree(profileId) {
    const storage = this.supabase.storage.from(BUCKET);
    const rootEntries = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.list(profileId, { limit: 1000, offset });
      if (error) throw rpcError(error);
      rootEntries.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const keys = [];
    for (const item of rootEntries) {
      if (item.id) keys.push(`${profileId}/${item.name}`);
      else {
        for (let offset = 0; ; offset += 1000) {
          const sub = await storage.list(`${profileId}/${item.name}`, { limit: 1000, offset });
          if (sub.error) throw rpcError(sub.error);
          for (const file of sub.data || []) if (file.id) keys.push(`${profileId}/${item.name}/${file.name}`);
          if (!sub.data || sub.data.length < 1000) break;
        }
      }
    }
    for (let offset = 0; offset < keys.length; offset += 100) {
      const { error: removeError } = await storage.remove(keys.slice(offset, offset + 100));
      if (removeError) throw rpcError(removeError);
    }
  }

  async pruneRevision(profileId, revision) {
    if (revision < 1) return;
    const storage = this.supabase.storage.from(BUCKET);
    const keys = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.list(`${profileId}/${revision}`, { limit: 1000, offset });
      if (error) return;
      keys.push(...(data || []).filter(item => item.id).map(item => `${profileId}/${revision}/${item.name}`));
      if (!data || data.length < 1000) break;
    }
    if (keys.length) await storage.remove(keys);
  }

  async deleteCloudProfile(profileId) {
    await this.claimLock(profileId);
    try {
      await this.deleteObjectTree(profileId);
      await this.rpc('td_delete_cloud_profile', { p_profile_id: profileId, p_client_token: this.lockClientToken });
      const profiles = this.getProfiles();
      const updated = profiles.map(profile => profile.cloudProfileId === profileId ? { ...profile, cloudRemoved: true } : profile);
      this.saveProfiles(updated);
    } finally { await this.releaseLock(profileId).catch(() => {}); }
  }
}

module.exports = { CloudProfiles, createAccountKeyMetadata, encryptPrivateKey, decryptPrivateKey, wrapDataKey, unwrapDataKey };

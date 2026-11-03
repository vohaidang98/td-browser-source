'use strict';
// Local browser files; server inventory and Admin commands contain metadata only.
function installAccountProfileManagement({ipcMain,cloud,getAccount,getProfiles}){
 const requireAdmin=()=>{const account=getAccount();if(account?.role!=='admin'||account.status!=='active')throw Error('Chỉ Admin được quản lý hồ sơ người dùng.');return account;};
 const disabled=()=>{throw Object.assign(Error('Hồ sơ lưu trên máy; đồng bộ/chia sẻ dữ liệu hồ sơ Cloud đã tắt.'),{code:'PROFILE_CLOUD_DISABLED'});};
 async function reconcile(){const account=getAccount();if(!account)return [];return getProfiles().filter(p=>!p.adminDeleted&&(!p.localAccountId||p.localAccountId===account.id));}
 async function userProfiles(userId,email=''){
  const account=requireAdmin();
  if(typeof userId!=='string'||!/^[a-f0-9-]{36}$/i.test(userId))throw Error('Tài khoản không hợp lệ.');
  const devices=await cloud.rpc('td_admin_user_profile_catalog',{p_user_id:userId});
  if(getAccount()?.id!==account.id)throw Error('Tài khoản đã thay đổi.');
  const rows=[];
  for(const device of devices||[]){
   const connected=!!device.connected&&Date.parse(device.server_time)-Date.parse(device.last_seen)<90000;
   for(const item of device.profiles||[])rows.push({id:'local:'+device.device_id+':'+item.local_id,profile_name:String(item.name||'Hồ sơ'),inventory_only:true,device_id:device.device_id,local_id:item.local_id,user_id:userId,owner_email:email,pending_delete:!!item.admin_deleted,updated_at:device.last_seen,connected,running:connected&&!!item.running});
  }
  return rows;
 }
 ipcMain.handle('admin:user-profiles',(_event,userId)=>userProfiles(userId));
 ipcMain.handle('admin:all-user-profiles',async()=>{
  const account=requireAdmin(),users=await cloud.listUsers();if(getAccount()?.id!==account.id)throw Error('Tài khoản đã thay đổi.');
  const results=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,users.length)},async()=>{while(cursor<users.length){const user=users[cursor++];results.push(...await userProfiles(user.user_id,user.email));}}));
  if(getAccount()?.id!==account.id)throw Error('Tài khoản đã thay đổi.');return results;
 });
 for(const name of ['admin:revoke-profile-share','admin:prepare-profile-edit','admin:save-profile-edit'])ipcMain.handle(name,disabled);
 return {shutdown(){},sync:disabled,syncAndShare:disabled,reconcile,background:async()=>{},isBusy:()=>false,isProfileBusy:()=>false};
}
module.exports={installAccountProfileManagement};

'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,LOCAL=/^TD_[A-Za-z0-9_-]+$/;

function createProfileAdminControl({cloud,userDataPath,getAccount,getDeviceId,getProfiles,saveProfiles,getTrash,saveTrash,activeBrowsers,stopProfile,cancelProfile=async()=>{},isProfileBusy=()=>false,isProfileLaunching=()=>false,notify=()=>{},cleanupStorage=true}){
 const file=path.join(userDataPath,'profile-admin-deletions.json');let cache=null,pending=null,cleanupTask=null,closing=false,lastFetched=0,lastOwner=null;
 function state(){if(cache)return cache;try{cache=JSON.parse(fs.readFileSync(file,'utf8'));if(cache?.version!==1||!cache.accounts||typeof cache.accounts!=='object'||Array.isArray(cache.accounts))throw Error('invalid');}catch(error){if(error.code!=='ENOENT')throw Error('Không đọc được trạng thái xóa của Admin. Liên hệ Admin trước khi mở hồ sơ.');cache={version:1,accounts:{}};}return cache;}
 function persist(){fs.mkdirSync(userDataPath,{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(cache),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
 function requests(owner){return Object.values(state().accounts[owner]||{});}
 function owns(profile,owner){return !profile.localAccountId||profile.localAccountId===owner;}
 function matches(profile,request){return request.cloud_profile_id ? [profile.cloudProfileId,profile.sourceCloudProfileId].some(id=>String(id||'').toLowerCase()===request.cloud_profile_id.toLowerCase()) : profile.id===request.local_profile_id;}
 function isDeleted(profile,owner=getAccount()?.id){return !!(profile?.adminDeleted||(owner&&owns(profile,owner)&&requests(owner).some(r=>matches(profile,r))));}
 function assertUsable(profile){if(isDeleted(profile))throw Object.assign(Error('Admin đã yêu cầu xóa hồ sơ này. Hồ sơ không còn được phép mở hoặc khôi phục.'),{code:'PROFILE_ADMIN_DELETED'});}
 function safeRemove(profileId){
  if(!LOCAL.test(profileId||''))throw Error('Mã hồ sơ cần xóa không hợp lệ.');
  const root=path.resolve(userDataPath,'BrowserData');if(!fs.existsSync(root))return;
  if(fs.lstatSync(root).isSymbolicLink())throw Error('Không xóa qua liên kết thư mục BrowserData.');
  const realRoot=fs.realpathSync(root),expected=path.join(fs.realpathSync(userDataPath),'BrowserData');
  if(realRoot.toLowerCase()!==expected.toLowerCase())throw Error('Thư mục dữ liệu nằm ngoài phạm vi được quản lý.');
  const names=fs.readdirSync(root).filter(name=>name===profileId||(name.startsWith(profileId+'.before-cloud-')&&/^\d+$/.test(name.slice((profileId+'.before-cloud-').length))));
  for(const name of names){const target=path.resolve(root,name);if(path.dirname(target)!==root)throw Error('Đường dẫn xóa vượt thư mục hồ sơ.');const stat=fs.lstatSync(target);if(stat.isSymbolicLink())throw Error('Không xóa hồ sơ qua liên kết thư mục.');if(fs.realpathSync(target).toLowerCase()!==path.join(realRoot,name).toLowerCase())throw Error('Đường dẫn hồ sơ đã đổi.');fs.rmSync(target,{recursive:true,force:true});}
 }
 async function apply(owner){
  const active=()=>getAccount()?.id===owner;
  for(const request of requests(owner)){
   if(request.applied&&!request.cloud_profile_id)continue;
   if(!active()||closing)return;
   const candidates=[...getProfiles(),...getTrash().filter(p=>p.type==='profile')].filter(p=>owns(p,owner)&&matches(p,request));
   const ids=[...new Set(candidates.map(p=>p.id))];let completed=true;
   if(ids.length){
    if(saveProfiles(getProfiles().map(p=>ids.includes(p.id)&&owns(p,owner)?{...p,adminDeleted:true}:p))===false)throw Error('Không ghi được trạng thái xóa hồ sơ.');
    for(const id of ids){
     if(!active()||closing)return;
     const session=activeBrowsers.get(id);if(session)session.adminDeleted=true;
     try{
      if(isProfileLaunching(id)){completed=false;continue;}
      // Never wait on a launch which may itself be waiting for this refresh.
      void Promise.resolve().then(()=>cancelProfile(id)).catch(()=>{});
      if(isProfileLaunching(id)){completed=false;continue;}
      await stopProfile(id,{waitForSync:false,skipLaunching:true});if(!active())return;
      if(activeBrowsers.has(id)||isProfileBusy(id)){completed=false;continue;}
      safeRemove(id);
      if(saveTrash(getTrash().filter(p=>!(p.type==='profile'&&p.id===id&&owns(p,owner))))===false)throw Error('Không cập nhật được thùng rác.');
      if(saveProfiles(getProfiles().filter(p=>!(p.id===id&&owns(p,owner))))===false)throw Error('Không cập nhật được danh sách hồ sơ.');
      notify({success:true,status:'admin-profile-deleted',profileId:id,message:'Admin đã xóa hồ sơ này.'});
     }catch(error){completed=false;notify({success:false,status:'admin-profile-delete-pending',profileId:id,message:'Admin đã khóa hồ sơ để xóa; đang chờ đóng tác vụ hoặc quyền xóa tệp.'});}
    }
   }
   if(completed&&!request.cloud_profile_id&&active()){await cloud.rpc('td_ack_profile_delete',{p_request_id:request.id,p_device_id:getDeviceId()});if(active()){request.applied=true;persist();}}
  }
 }
 async function refresh({force=false}={}){
  if(closing||!getAccount())return;if(pending)return pending;
  const owner=getAccount().id;
  const work=(async()=>{
   if(force||lastOwner!==owner||Date.now()-lastFetched>5000){
    const sources=[...new Set([...getProfiles(),...getTrash()].filter(p=>owns(p,owner)).flatMap(p=>[p.cloudProfileId,p.sourceCloudProfileId]).filter(id=>UUID.test(id||'')).map(id=>id.toLowerCase()))];
    const rows=await cloud.rpc('td_my_profile_delete_requests',{p_device_id:getDeviceId(),p_source_ids:sources});
    if(getAccount()?.id!==owner)return;
    if(!Array.isArray(rows)||rows.some(r=>!UUID.test(r.id||'')||!(UUID.test(r.cloud_profile_id||'')||(!r.cloud_profile_id&&LOCAL.test(r.local_profile_id||'')))))throw Error('Lệnh xóa hồ sơ không hợp lệ.');
    const accountRequests=state().accounts[owner]||{};
    for(const row of rows)accountRequests[row.id]={applied:!!accountRequests[row.id]?.applied,id:row.id,cloud_profile_id:row.cloud_profile_id||null,local_profile_id:row.cloud_profile_id?null:row.local_profile_id};
    cache.accounts[owner]=accountRequests;persist();lastFetched=Date.now();lastOwner=owner;
   }
   await apply(owner);
   if(getAccount()?.id===owner&&cleanupStorage&&getAccount()?.role==='admin'&&!cleanupTask&&!closing){
    const cleanup=(async()=>{const rows=await cloud.rpc('td_admin_pending_profile_storage_cleanup');
     for(const row of (rows||[]).slice(0,3)){if(closing||getAccount()?.id!==owner)return;if(!UUID.test(row.id||'')||!UUID.test(row.cloud_profile_id||''))throw Error('Yêu cầu dọn Cloud không hợp lệ.');await cloud.deleteObjectTree(row.cloud_profile_id);if(getAccount()?.id!==owner)return;await cloud.rpc('td_admin_ack_profile_storage_cleanup',{p_request_id:row.id});}
    })();cleanupTask=cleanup;cleanup.catch(()=>{}).finally(()=>{if(cleanupTask===cleanup)cleanupTask=null;});
   }
  })();pending=work;try{await work;}finally{if(pending===work)pending=null;}
 }
 async function requestDeletion(input){
  const account=getAccount();if(account?.role!=='admin'||account.status!=='active')throw Error('Chỉ Admin được xóa hồ sơ người dùng.');
  const source=input?.profileId,user=input?.userId,device=input?.deviceId,local=input?.localId;
  if(source?!UUID.test(source):!(UUID.test(user||'')&&UUID.test(device||'')&&LOCAL.test(local||'')))throw Error('Thông tin hồ sơ cần xóa không hợp lệ.');
  const requestId=await cloud.rpc('td_admin_request_profile_delete',{p_cloud_profile_id:source||null,p_user_id:user||null,p_device_id:device||null,p_local_profile_id:local||null});
  if(getAccount()?.id!==account.id)throw Error('Tài khoản đã thay đổi.');
  void refresh({force:true}).catch(()=>{});
  return {requestId,queued:true,appliesWhenOnline:true};
 }
 return {refresh,requestDeletion,isDeleted,assertUsable,isBusy:()=>!!pending||!!cleanupTask,shutdown:()=>{closing=true;}};
}
module.exports={createProfileAdminControl};

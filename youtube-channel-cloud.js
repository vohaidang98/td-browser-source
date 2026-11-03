'use strict';
const crypto=require('crypto');
const {unwrapDataKey}=require('./cloud-profiles');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function createYouTubeChannelCloud({rpc,getAccount,getPrivateKey}){
  const cache=new Map(),pending=new Map();
  function owner(){const account=getAccount();if(!account||account.status!=='active')throw Error('Đăng nhập để đồng bộ liên kết kênh.');return account.id;}
  function check(id){if(owner()!==id)throw Error('Tài khoản đã thay đổi.');}
  async function key(profileId,id){const privateKey=getPrivateKey();if(!privateKey)throw Error('Đăng xuất rồi đăng nhập bằng mật khẩu để mở khóa liên kết kênh dùng chung.');const envelope=await rpc('td_my_key_envelope',{p_profile_id:profileId});check(id);if(!envelope)throw Error('Tài khoản chưa có khóa giải mã hồ sơ dùng chung.');const bytes=unwrapDataKey(privateKey,envelope);try{if(bytes.length!==32)throw Error('Khóa hồ sơ không hợp lệ.');return Buffer.from(crypto.hkdfSync('sha256',bytes,Buffer.from(profileId.toLowerCase()),Buffer.from('TD Browser YouTube OAuth v1'),32));}finally{bytes.fill(0);}}
  function aad(pid,client,channel){return Buffer.from('TD-YOUTUBE-1\0'+pid+'\0'+client+'\0'+channel);}
  async function decode(row,id){
    const dataKey=await key(row.profile_id,id);
    try{const p=row.encrypted_payload;if(!p||typeof p.ciphertext!=='string'||p.ciphertext.length>100000)throw Error('invalid');const decipher=crypto.createDecipheriv('aes-256-gcm',dataKey,Buffer.from(p.iv,'base64'));decipher.setAAD(aad(row.profile_id,row.client_id,row.channel_id));decipher.setAuthTag(Buffer.from(p.tag,'base64'));const record=JSON.parse(Buffer.concat([decipher.update(Buffer.from(p.ciphertext,'base64')),decipher.final()]).toString());if(record.channelId!==row.channel_id)throw Error('invalid');return {...record,sharedProfileId:row.profile_id,sharedRevision:Number(row.revision)};}
    catch{throw Error('Không giải mã được liên kết kênh của hồ sơ. Liên hệ Admin để kiểm tra quyền mở hồ sơ.');}
    finally{dataKey.fill(0);}
  }
  async function save(profile,clientId,record,expectedRevision=0){
    const id=owner(),pid=profile.cloudProfileId;if(!UUID.test(pid||''))throw Error('Hồ sơ cần liên kết Cloud trước khi đồng bộ kênh.');
    const dataKey=await key(pid,id);let payload;
    try{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',dataKey,iv);cipher.setAAD(aad(pid,clientId,record.channelId));const {sharedRevision,sharedProfileId,...content}=record;const ciphertext=Buffer.concat([cipher.update(JSON.stringify(content)),cipher.final()]);payload={iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};}finally{dataKey.fill(0);}
    const revision=Number(await rpc('td_put_profile_youtube_link',{p_profile_id:pid,p_client_id:clientId,p_channel_id:record.channelId,p_payload:payload,p_expected_revision:expectedRevision}));check(id);
    if(!Number.isSafeInteger(revision)||revision<1)throw Error('Không xác nhận được đồng bộ liên kết kênh.');cache.delete(id);return {...record,sharedProfileId:pid,sharedRevision:revision};
  }
  async function synchronize(profiles,clientId,api,{force=false,required=false}={}){
    const id=owner(),rows=profiles.filter(p=>UUID.test(p.cloudProfileId||'')),ids=[...new Set(rows.map(p=>p.cloudProfileId))];
    if(!ids.length)return;const signature=clientId+'|'+rows.map(p=>p.id+':'+p.cloudProfileId).sort().join(',');
    if(!force&&cache.get(id)?.signature===signature&&Date.now()-cache.get(id).at<15000)return;
    if(pending.has(id)){await pending.get(id);check(id);return synchronize(profiles,clientId,api,{force,required});}
    const work=(async()=>{
      const response=[];for(let index=0;index<ids.length;index+=200){const batch=await rpc('td_list_profile_youtube_links',{p_profile_ids:ids.slice(index,index+200)});check(id);if(!Array.isArray(batch))throw Error('Danh sách liên kết kênh không hợp lệ.');response.push(...batch);}const remote=new Map(response.map(r=>[r.profile_id,r])),errors=[];
      for(const profile of rows){
        try{
          check(id);const row=remote.get(profile.cloudProfileId),local=api.readConnection(profile.id,id);
          if(row?.revoked){if(local)api.forgetConnection(profile.id,id);continue;}
          if(row&&row.client_id!==clientId){if(local)api.forgetConnection(profile.id,id);continue;}
          if(row){if(local?.sharedRevision===Number(row.revision)&&local.sharedProfileId===row.profile_id)continue;api.installConnection(profile.id,await decode(row,id),id);}
          else if(local?.sharedRevision){api.forgetConnection(profile.id,id);}
          else if(local?.refreshToken&&!local.needsReauth){api.installConnection(profile.id,await save(profile,clientId,local,0),id);}
        }catch(error){errors.push(error);}
      }
      if(errors.length){if(required)throw errors[0];throw Error(errors[0].message);}cache.set(id,{signature,at:Date.now()});
    })();pending.set(id,work);try{await work;}finally{if(pending.get(id)===work)pending.delete(id);}
  }
  async function publish(profile,clientId,record){
    const id=owner(),rows=await rpc('td_list_profile_youtube_links',{p_profile_ids:[profile.cloudProfileId]});check(id);const row=rows?.find(r=>r.profile_id===profile.cloudProfileId);return save(profile,clientId,record,Number(row?.revision)||0);
  }
  async function revoke(profile){
    const id=owner();if(getAccount().role!=='admin')throw Error('Chỉ Admin được ngắt liên kết kênh dùng chung.');const rows=await rpc('td_list_profile_youtube_links',{p_profile_ids:[profile.cloudProfileId]});check(id);const row=rows?.find(r=>r.profile_id===profile.cloudProfileId);if(row&&!row.revoked){await rpc('td_admin_revoke_profile_youtube_link',{p_profile_id:profile.cloudProfileId,p_expected_revision:Number(row.revision)});check(id);}cache.delete(id);
  }
  return {synchronize,publish,revoke,persistState:(profile,clientId,record)=>save(profile,clientId,record,Number(record.sharedRevision)||0)};
}
module.exports={createYouTubeChannelCloud};

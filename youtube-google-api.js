'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),https=require('https'),http=require('http');
const ROOT='https://www.googleapis.com/youtube/v3/';
const SCOPES=['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly'];
function parseDesktopClient(input){
  if(typeof input!=='string'||input.length>65536)throw Error('Tệp OAuth JSON không hợp lệ.');let parsed;try{parsed=JSON.parse(input);}catch{throw Error('Không đọc được tệp OAuth JSON.');}
  const c=parsed.installed;
  if(!c||!/^[-\w.]{10,250}\.apps\.googleusercontent\.com$/.test(c.client_id||'')||typeof c.client_secret!=='string'||!c.client_secret||c.client_secret.length>500||typeof c.project_id!=='string'||c.project_id.length>150)throw Error('Chọn OAuth Client JSON loại Desktop app (installed), không dùng client Web.');
  return {clientId:c.client_id,clientSecret:c.client_secret,projectId:c.project_id};
}
function allowedUrl(value,session=false){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.googleapis.com','youtube.googleapis.com','oauth2.googleapis.com'].includes(u.hostname))throw Error('Địa chỉ Google API không hợp lệ.');
  if(session&&(!['www.googleapis.com','youtube.googleapis.com'].includes(u.hostname)||u.pathname!=='/upload/youtube/v3/videos'))throw Error('Phiên tải Google không hợp lệ.');
  return u.href;
}
function requestGoogle(url,{method='GET',headers={},body=null,agent,signal,timeout=120000}={}){
  allowedUrl(url);
  return new Promise((resolve,reject)=>{
    const req=https.request(url,{method,headers,agent,signal},res=>{const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>1024*1024){res.destroy();req.destroy(Error('Phản hồi Google quá lớn.'));}else chunks.push(b);});res.on('error',reject);res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let data=null;try{data=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,data});});});
    req.setTimeout(timeout,()=>req.destroy(Error('Google API phản hồi quá chậm.')));req.on('error',reject);req.end(body);
  });
}
function apiError(response){
  const reason=response.data?.error?.errors?.[0]?.reason||response.data?.error?.status||response.data?.error;
  const code=typeof reason==='string'&&/^[a-zA-Z_]{1,80}$/.test(reason)?reason:'HTTP '+response.status;
  const messages={quotaExceeded:'Dự án Google đã hết hạn mức. Kiểm tra quota trong Google Cloud.',dailyLimitExceeded:'Google đã giới hạn lượt tải hôm nay.',uploadLimitExceeded:'Kênh đã đạt giới hạn tải video.',accessNotConfigured:'Bật YouTube Data API v3 trong dự án Google Cloud.',invalid_grant:'Quyền Google đã hết hiệu lực. Liên kết kênh lại.',insufficientPermissions:'Chưa được cấp đủ quyền Google. Liên kết lại và chấp nhận các quyền yêu cầu.'};
  return Error(messages[code]||'Google API: '+code);
}
function offsetFrom(response,total){
  const range=response.headers?.range;if(!range)return 0;
  const match=/^bytes=0-(\d+)$/.exec(range);const offset=match?Number(match[1])+1:NaN;
  if(!Number.isSafeInteger(offset)||offset<0||offset>total)throw Error('Google trả vị trí tải không hợp lệ.');return offset;
}
function createYouTubeGoogleApi({directory,current,authorize,safeStorage,openNetwork=async()=>({}),request=requestGoogle}){
  const cache=new Map(),pending=new Set(),refreshing=new Map();
  const key=(pid,channel,file)=>crypto.createHash('sha256').update(pid+'\0'+channel+'\0'+file).digest('hex');
  function data(owner=current().id){
    if(cache.has(owner))return cache.get(owner);let value={client:null,channels:{},sessions:{}};const file=path.join(directory(owner),'youtube-google.enc');
    if(fs.existsSync(file)){if(!safeStorage.isEncryptionAvailable())throw Error('Windows chưa sẵn sàng mở cấu hình Google.');try{value=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));}catch{throw Error('Không mở được cấu hình Google trên máy này.');}}
    cache.set(owner,value);return value;
  }
  function save(owner){
    if(!safeStorage.isEncryptionAvailable())throw Error('Windows chưa sẵn sàng mã hóa quyền Google.');
    const dir=directory(owner);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'youtube-google.enc'),temp=file+'.'+crypto.randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,safeStorage.encryptString(JSON.stringify(data(owner))),{flag:'wx'});fs.renameSync(temp,file);}catch(error){try{fs.unlinkSync(temp);}catch{}throw Error('Không lưu được cấu hình Google.');}
  }
  function status(){const d=data(),channels={};for(const [id,c]of Object.entries(d.channels))channels[id]={profileId:id,channelId:c.channelId,name:c.name,checkedAt:c.checkedAt,method:'api',needsReauth:!!c.needsReauth||!c.refreshToken,shared:!!c.sharedRevision};return {configured:!!d.client,projectId:d.client?.projectId||'',channels};}
  function setManagedClient(c){
    const owner=current().id,d=data(owner),previous=structuredClone(d),changed=d.client?.clientId!==c.clientId;
    if(JSON.stringify(d.client)===JSON.stringify(c))return status();
    if(changed){d.channels={};d.sessions={};}
    d.client={clientId:c.clientId,clientSecret:c.clientSecret,projectId:c.projectId};try{save(owner);}catch(error){cache.set(owner,previous);throw error;}return status();
  }
  function importClient(input){
    if(current().role!=='admin')throw Error('Chỉ Admin được cấu hình Google API.');return setManagedClient(parseDesktopClient(input));
  }
  function reauthError(){return Object.assign(Error('Quyền Google không còn dùng được. Bấm Liên kết Google để xác nhận lại.'),{code:'GOOGLE_REAUTH_REQUIRED'});}
  function connection(pid,owner=current().id){const d=data(owner),c=d.channels[pid];if(!d.client)throw Error('Admin chưa cấu hình Google API.');if(!c?.refreshToken||c.needsReauth)throw reauthError();return c;}
  function markReauth(pid,owner){const c=data(owner).channels[pid];if(c){c.needsReauth=true;save(owner);}return reauthError();}
  async function checked(owner){await authorize(owner);if(current().id!==owner)throw Error('Tài khoản TD đã thay đổi.');}
  async function token(pid,owner,network,signal){
    await checked(owner);const c=connection(pid,owner);if(c.accessToken&&c.expiresAt>Date.now()+60000)return c.accessToken;
    const lock=owner+'\0'+pid;if(refreshing.has(lock))return refreshing.get(lock);
    const work=(async()=>{const client=data(owner).client,body=new URLSearchParams({client_id:client.clientId,client_secret:client.clientSecret,refresh_token:c.refreshToken,grant_type:'refresh_token'}).toString();
      const response=await request('https://oauth2.googleapis.com/token',{method:'POST',agent:network.agent,signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body});await checked(owner);
      if(response.data?.error==='invalid_grant')throw markReauth(pid,owner);
      if(response.status!==200||!response.data?.access_token)throw apiError(response);c.accessToken=response.data.access_token;c.expiresAt=Date.now()+(Number(response.data.expires_in)||3600)*1000;if(response.data.refresh_token)c.refreshToken=response.data.refresh_token;save(owner);return c.accessToken;})();
    refreshing.set(lock,work);try{return await work;}finally{if(refreshing.get(lock)===work)refreshing.delete(lock);}
  }
  async function channels(accessToken,network,signal,pid,owner){const response=await request(ROOT+'channels?part=id,snippet&mine=true',{agent:network.agent,signal,headers:{Authorization:'Bearer '+accessToken}});if(response.status!==200){if(pid&&(response.status===401||response.data?.error?.errors?.some(e=>e.reason==='insufficientPermissions')))throw markReauth(pid,owner);throw apiError(response);}const items=response.data?.items;if(!Array.isArray(items)||items.length!==1||!/^UC[A-Za-z0-9_-]{22}$/.test(items[0].id))throw Error('Chọn rõ một kênh YouTube khi cấp quyền Google.');return items[0];}
  function readConnection(pid,owner=current().id){if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');const c=data(owner).channels[pid];return c?structuredClone(c):null;}
  function installConnection(pid,value,owner=current().id){
    if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');
    if(!value||!/^UC[A-Za-z0-9_-]{22}$/.test(value.channelId||'')||typeof value.refreshToken!=='string'||!value.refreshToken||value.refreshToken.length>20000||typeof value.accessToken!=='string'||value.accessToken.length>20000||!Number.isFinite(value.expiresAt))throw Error('Liên kết kênh dùng chung không hợp lệ.');
    const previous=data(owner).channels[pid];data(owner).channels[pid]={...value,name:String(value.name||value.channelId).slice(0,160)};try{save(owner);}catch(error){if(previous)data(owner).channels[pid]=previous;else delete data(owner).channels[pid];throw error;}return status().channels[pid];
  }
  function forgetConnection(pid,owner=current().id){if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');const previous=data(owner).channels[pid];delete data(owner).channels[pid];try{save(owner);}catch(error){if(previous)data(owner).channels[pid]=previous;throw error;}}
  async function connect({profile,openUrl,expectedChannelId}){
    const owner=current().id;await checked(owner);const client=data(owner).client;if(!client)throw Error('Nhập tệp OAuth Desktop trước.');
    const controller=new AbortController();controller.tdProfileId=profile.id;pending.add(controller);let network,server,timer,poll;
    try{
      network=await openNetwork(profile);const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url'),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
      let complete,rejectCallback,used=false,boundPort;const callback=new Promise((resolve,reject)=>{complete=resolve;rejectCallback=reject;});callback.catch(()=>{});
      const callbackResponse=(status,body)=>({status,body,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'",'Referrer-Policy':'no-referrer'}});
      const receiveCallback=(value,method='GET')=>{
        let url;try{url=new URL(value);}catch{return callbackResponse(400,'Yêu cầu không hợp lệ.');}
        if(controller.signal.aborted||method!=='GET'||url.origin!=='http://127.0.0.1:'+boundPort||url.pathname!=='/oauth2/callback'||url.searchParams.get('state')!==state||used)return callbackResponse(400,'Phiên xác nhận không hợp lệ.');
        used=true;const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code||code.length>4096){rejectCallback(Error('Chưa được cấp quyền Google.'));return callbackResponse(400,'Bạn chưa cấp quyền. Quay lại TD Browser để thử lại.');}
        complete(code);return callbackResponse(200,'Đã nhận xác nhận Google. Bạn có thể quay lại TD Browser.');
      };
      server=http.createServer((req,res)=>{const value=receiveCallback('http://'+req.headers.host+req.url,req.method);res.writeHead(value.status,value.headers);res.end(value.body);});
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      boundPort=server.address().port;const redirect='http://127.0.0.1:'+boundPort+'/oauth2/callback';
      controller.signal.addEventListener('abort',()=>rejectCallback(Error('Đã dừng kết nối Google.')),{once:true});
      timer=setTimeout(()=>controller.abort(),300000);poll=setInterval(()=>{void checked(owner).catch(()=>controller.abort());},2000);
      const url='https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:client.clientId,redirect_uri:redirect,response_type:'code',scope:SCOPES.join(' '),access_type:'offline',prompt:'consent select_account',code_challenge:challenge,code_challenge_method:'S256',state});
      await openUrl(url,{callbackUrl:redirect,receiveCallback});const code=await callback;await checked(owner);
      const body=new URLSearchParams({client_id:client.clientId,client_secret:client.clientSecret,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'}).toString();
      const response=await request('https://oauth2.googleapis.com/token',{method:'POST',agent:network.agent,signal:controller.signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
      if(response.status!==200||!response.data?.access_token||!response.data.refresh_token)throw apiError(response);
      const channel=await channels(response.data.access_token,network,controller.signal);await checked(owner);
      if(expectedChannelId&&channel.id!==expectedChannelId)throw Error('Kênh Google vừa chọn khác kênh đã liên kết của hồ sơ. Chọn đúng tài khoản/kênh rồi thử lại.');
      const previous=data(owner).channels[profile.id];
      data(owner).channels[profile.id]={channelId:channel.id,name:String(channel.snippet?.title||channel.id).slice(0,160),accessToken:response.data.access_token,refreshToken:response.data.refresh_token,expiresAt:Date.now()+(Number(response.data.expires_in)||3600)*1000,checkedAt:new Date().toISOString()};try{save(owner);}catch(error){if(previous)data(owner).channels[profile.id]=previous;else delete data(owner).channels[profile.id];throw error;}return status().channels[profile.id];
    }finally{clearTimeout(timer);clearInterval(poll);controller.abort();pending.delete(controller);if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}await network?.close?.();}
  }
  function disconnect(pid){const owner=current().id,previous=data(owner).channels[pid];delete data(owner).channels[pid];try{save(owner);}catch(error){data(owner).channels[pid]=previous;throw error;}return true;}
  async function upload({profile,owner,prepared,journal,signal,checkpoint,delay,progress,result,log}){
    const {files,settings}=prepared;if(!['PRIVATE','UNLISTED','PUBLIC'].includes(settings.visibility))throw Error('Google API hỗ trợ Riêng tư, Không công khai và Công khai. Không hỗ trợ tải bản nháp.');
    if(!Array.isArray(files)||!files.length||files.length>1000||new Set(files.map(f=>f.id)).size!==files.length)throw Error('Chọn 1–1.000 video khác nhau; tối đa 15 video đang tải.');
    const sequential=(settings.uploadOrder||'SEQUENTIAL')==='SEQUENTIAL';if(!['SEQUENTIAL','PARALLEL'].includes(settings.uploadOrder||'SEQUENTIAL'))throw Error('Thứ tự tải không hợp lệ.');
    connection(profile.id,owner);let network;const items=files.map(f=>({id:f.id,name:f.name,phase:'queued',percent:0,bytesConfirmed:0,bytesTotal:f.bytes}));let completed=0;const errors=[],totalBytes=files.reduce((n,f)=>n+f.bytes,0),activeIds=new Set();let nextIndex=0,stopRefill=false;
    function publish(file,phase){const item=items.find(r=>r.id===file?.id),received=items.reduce((n,r)=>n+r.bytesConfirmed,0),activeItems=items.filter(r=>activeIds.has(r.id)&&!['completed','paused','failed','review'].includes(r.phase));progress({method:'Google API',queueMode:sequential?'sequential':'rolling',concurrent:sequential?1:15,activeCount:activeItems.length,startedCount:nextIndex,queuedCount:files.length-nextIndex,uploadOrder:sequential?'SEQUENTIAL':'PARALLEL',file:file?.name||'',fileId:file?.id||'',index:file?files.indexOf(file)+1:0,total:files.length,completed,failed:errors.length,phase,percent:item?.percent||0,bytesConfirmed:item?.bytesConfirmed||0,bytesTotal:file?.bytes||0,overallBytesConfirmed:received,overallBytesTotal:totalBytes,overallPercent:Math.floor(received/totalBytes*100),visibility:settings.visibility,items:structuredClone(items),displayItems:structuredClone(activeItems.slice(0,15)),refillStopped:stopRefill});}
    try{
      network=await openNetwork(profile);
      await checkpoint();if(signal?.aborted)throw Error('Đã dừng tác vụ.');
      const access=await token(profile.id,owner,network,signal),channel=await channels(access,network,signal,profile.id,owner);
      if(channel.id!==settings.channelId)throw markReauth(profile.id,owner);
      async function uploadFile(file){
        const deadline=Date.now()+settings.timeoutMinutes*60000;let sent=0,phase='preparing';const item=items.find(r=>r.id===file.id);
        const report=()=>{item.phase=phase;item.percent=Math.floor(sent/file.bytes*100);item.bytesConfirmed=sent;publish(file,phase);};
        const check=async()=>{await checkpoint();if(signal?.aborted)throw Error('Đã dừng tác vụ.');if(Date.now()>deadline)throw Error('Hết thời gian tải video. Phiên tải được giữ để tiếp tục.');};
        try{
        await check();report();
        const stat=fs.lstatSync(file.file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file.file)!==path.resolve(file.file)||stat.size!==file.bytes||stat.mtimeMs!==file.mtimeMs)throw Error('Video đã thay đổi. Quét lại thư mục.');
        if(settings.reupload&&journal.getRecord(profile.id,settings.channelId,file.id,owner)?.status==='uploaded')journal.beginRepeat(profile.id,settings.channelId,file.id,owner);
        const attempt=journal.uploadKey?.(profile.id,settings.channelId,file.id,owner)||file.id;
        const k=key(profile.id,settings.channelId,attempt),d=data(owner);let session=d.sessions[k],final=null;
        if(session&&session.visibility!==settings.visibility)throw Error('Video có phiên tải '+session.visibility+'. Chọn lại đúng chế độ để tiếp tục.');
        if(!session&&journal.getRecord(profile.id,settings.channelId,file.id,owner))throw Error('Lần tải trước cần kiểm tra trong Studio; không tạo một phiên tải trùng.');
        const send=async(url,options)=>{
          const used=await token(profile.id,owner,network,signal);let response=await request(url,{...options,agent:network.agent,signal,headers:{...options.headers,Authorization:'Bearer '+used}});
          if(response.status===401){const c=connection(profile.id,owner);if(c.accessToken===used)c.expiresAt=0;response=await request(url,{...options,agent:network.agent,signal,headers:{...options.headers,Authorization:'Bearer '+await token(profile.id,owner,network,signal)}});}if(response.status===401||response.data?.error?.errors?.some(e=>e.reason==='insufficientPermissions'))throw markReauth(profile.id,owner);return response;
        };
        if(!session){
          await check();journal.setRecord(profile.id,settings.channelId,file.id,{status:'needs-review',method:'api',name:file.name,requestedVisibility:settings.visibility,at:new Date().toISOString()},owner);
          const metadata=JSON.stringify({snippet:{title:file.title,description:'',categoryId:'22'},status:{privacyStatus:settings.visibility.toLowerCase(),selfDeclaredMadeForKids:false}});
          const response=await send('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8','X-Upload-Content-Length':String(file.bytes),'X-Upload-Content-Type':'application/octet-stream'},body:metadata});
          if(response.status!==200||!response.headers?.location)throw apiError(response);
          session={url:allowedUrl(response.headers.location,true),visibility:settings.visibility,bytes:file.bytes,createdAt:new Date().toISOString()};d.sessions[k]=session;save(owner);
          journal.setRecord(profile.id,settings.channelId,file.id,{status:'api-paused',method:'api',name:file.name,requestedVisibility:settings.visibility,at:new Date().toISOString()},owner);
        }
        allowedUrl(session.url,true);if(session.bytes!==file.bytes)throw Error('Kích thước phiên tải đã thay đổi.');
        let retry=0,query=true;const handle=await fs.promises.open(file.file,'r');
        try{
          while(!final){
            await check();phase=query?'resuming':'transmitting';report();
            let response,buffer;
            if(!query){
              const freshStat=await handle.stat();if(freshStat.size!==file.bytes||freshStat.mtimeMs!==file.mtimeMs)throw Error('Video đã thay đổi trong khi tải.');
              const length=Math.min(1024*1024,file.bytes-sent);if(length<=0){query=true;continue;}
              buffer=Buffer.alloc(length);const read=await handle.read(buffer,0,length,sent);if(read.bytesRead!==length)throw Error('Không đọc đủ dữ liệu video.');
            }
            try{
              if(query){response=await send(session.url,{method:'PUT',headers:{'Content-Length':'0','Content-Range':'bytes */'+file.bytes}});}
              else{
                const length=buffer.length;
                response=await send(session.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(length),'Content-Range':`bytes ${sent}-${sent+length-1}/${file.bytes}`},body:buffer});
              }
            }catch(error){if(signal?.aborted||error.code==='GOOGLE_REAUTH_REQUIRED')throw error;if(++retry>5)throw Error('Kết nối Google gián đoạn. Có thể chọn video và tiếp tục lại.');await delay(Math.min(30000,1000*2**retry));query=true;continue;}
            await check();
            if(response.status===200||response.status===201){final=response.data;break;}
            if(response.status===308){const accepted=offsetFrom(response,file.bytes);if(accepted===file.bytes){if(++retry>5)throw Error('Google đã nhận tệp nhưng chưa xác nhận video. Dừng để kiểm tra/tiếp tục sau.');sent=accepted;query=true;report();await delay(1000*retry);continue;}if(!query&&accepted<=sent){if(++retry>5)throw Error('Google chưa nhận thêm dữ liệu. Dừng để tiếp tục sau.');await delay(1000*retry);}else retry=0;sent=accepted;query=false;report();continue;}
            if(response.status===429||response.status>=500){if(++retry>5)throw apiError(response);await delay(Math.min(30000,1000*2**retry));query=true;continue;}
            if(response.status===404||response.status===410){journal.setRecord(profile.id,settings.channelId,file.id,{status:'needs-review',method:'api',name:file.name,at:new Date().toISOString()},owner);throw Error('Phiên tải Google đã hết hạn. Kiểm tra kênh trước khi tải lại.');}
            throw apiError(response);
          }
        }finally{await handle.close();}
        if(!final||!/^[A-Za-z0-9_-]{11}$/.test(final.id)||final.snippet?.channelId!==settings.channelId||final.status?.privacyStatus!==settings.visibility.toLowerCase()){
          journal.setRecord(profile.id,settings.channelId,file.id,{status:'needs-review',method:'api',name:file.name,at:new Date().toISOString()},owner);throw Error('Google chưa xác nhận đúng kênh/chế độ hiển thị. Kiểm tra Studio trước khi tải tiếp.');
        }
        const row={file:file.name,title:file.title,url:'https://youtu.be/'+final.id,visibility:final.status.privacyStatus,method:'api'};
        journal.setRecord(profile.id,settings.channelId,file.id,{...row,status:'uploaded',name:file.name,at:new Date().toISOString()},owner);delete d.sessions[k];save(owner);sent=file.bytes;completed++;phase='completed';report();result(row);log('Google API đã xác nhận '+completed+'/'+files.length+': '+file.name);
        }catch(error){const record=journal.getRecord(profile.id,settings.channelId,file.id,owner);phase=record?.status==='api-paused'?'paused':record?.status==='needs-review'?'review':'failed';item.error=String(error.message||'Không tải được video.').split('\n')[0].slice(0,400);errors.push({file:file.name,error:item.error});stopRefill=true;report();throw error;}
      }
      if(sequential){for(const file of files){nextIndex++;activeIds.add(file.id);try{await uploadFile(file);}catch{break;}finally{activeIds.delete(file.id);}}}
      else{
        const worker=async()=>{while(nextIndex<files.length&&!stopRefill&&!signal?.aborted){const file=files[nextIndex++];activeIds.add(file.id);try{await uploadFile(file);}catch{stopRefill=true;}finally{activeIds.delete(file.id);publish(file,items.find(i=>i.id===file.id).phase);}}};
        const outcomes=await Promise.allSettled(Array.from({length:Math.min(15,files.length)},worker));const unexpected=outcomes.find(r=>r.status==='rejected');if(unexpected)throw unexpected.reason;
      }
      publish(null,signal?.aborted?'paused':errors.length?'failed':'completed');
      if(signal?.aborted)throw Error('Đã dừng tác vụ. Các phiên tải chưa xong được giữ để tiếp tục.');
      if(errors.length)throw Error('Đã lưu '+completed+'/'+files.length+' video; '+(files.length-completed)+' video chưa hoàn tất. '+errors[0].file+': '+errors[0].error);
      return {completed,total:files.length};
    }finally{await network?.close?.();}
  }
  return {status,importClient,setManagedClient,readConnection,installConnection,forgetConnection,clientIdentity:()=>data().client?.clientId||'',connection,connect,disconnect,upload,abortPending(pid){for(const controller of pending)if(!pid||controller.tdProfileId===pid)controller.abort();}};
}
module.exports={createYouTubeGoogleApi,parseDesktopClient,allowedUrl,offsetFrom,requestGoogle,SCOPES};

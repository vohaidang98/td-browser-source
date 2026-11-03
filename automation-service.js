'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');
const { createYouTubeUploader, channelId, visibility, title, uploadOrder } = require('./youtube-upload');
const {createYouTubeGoogleApi,parseDesktopClient}=require('./youtube-google-api');

const TYPES = ['goto','click','fill','press','wait','select','check','scroll','extract','screenshot','newTab','switchTab','closeTab','if','repeat','setVariable','youtubeUpload'];
const RESERVED = new Set(['__proto__','prototype','constructor']);
const id = prefix => prefix + '_' + crypto.randomUUID();
const text = (v, max = 4096) => String(v ?? '').slice(0, max);
function variableName(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value || '') || RESERVED.has(value)) throw Error('Tên biến chỉ gồm chữ, số và dấu gạch dưới, bắt đầu bằng chữ.');
  return value;
}
function variables(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100) throw Error('Biến đầu vào phải là đối tượng, tối đa 100 biến.');
  const result = Object.create(null);
  for (const [key, val] of Object.entries(value)) {
    variableName(key);
    if (!['string','number','boolean'].includes(typeof val) || String(val).length > (key==='YOUTUBE_ITEMS'?500000:20000)) throw Error('Giá trị biến không hợp lệ.');
    result[key] = val;
  }
  return result;
}
function validateFlow(input) {
  if (!input || typeof input !== 'object' || typeof input.name !== 'string' || !input.name.trim()) throw Error('Nhập tên flow.');
  if(JSON.stringify(input).length>1024*1024)throw Error('Flow tối đa 1 MB.');
  let total = 0;
  function steps(list, depth = 0) {
    if (!Array.isArray(list) || depth > 5) throw Error('Flow không hợp lệ hoặc lồng quá 5 cấp.');
    return list.map(s => {
      if (!s || !TYPES.includes(s.type) || ++total > 300) throw Error('Loại bước không hợp lệ hoặc flow vượt 300 bước.');
      const node = { id: id('step'), type: s.type, name: text(s.name, 120), selector: text(s.selector, 2000), value: text(s.value, 20000), variable: text(s.variable, 64),
        timeout: Math.min(60000, Math.max(1000, Number(s.timeout) || 15000)), retries: Math.min(2,Math.max(0,Math.floor(Number(s.retries)||0))),
        onError: s.onError === 'continue' ? 'continue' : 'stop', count: Math.min(100,Math.max(1,Math.floor(Number(s.count)||1))), checked: s.checked !== false,
        condition: ['visible','hidden','textContains','variableEquals'].includes(s.condition) ? s.condition : 'visible', waitForPopup: s.waitForPopup === true,
        pageIndex: Math.min(100,Math.max(0,Math.floor(Number(s.pageIndex)||0))) };
      if (['click','fill','select','check','extract'].includes(node.type) && !node.selector.trim()) throw Error('Bước '+node.type+' cần phần tử đích.');
      if (['goto','newTab','press'].includes(node.type) && !node.value.trim()) throw Error('Bước '+node.type+' cần giá trị.');
      if (['extract','setVariable'].includes(node.type)) variableName(node.variable);
      if (node.type === 'if' && node.condition !== 'variableEquals' && !node.selector.trim()) throw Error('Điều kiện cần phần tử đích.');
      if (node.type === 'if' && node.condition === 'variableEquals') variableName(node.variable);
      if (['if','repeat'].includes(node.type)) node.steps = steps(s.steps || [],depth+1);
      if (node.type === 'if') node.otherwise = steps(s.otherwise || [],depth+1);
      if (node.type === 'youtubeUpload') {if(depth)throw Error('Tải YouTube phải là bước gốc, không đặt trong vòng lặp hoặc điều kiện.');node.retries=0;node.onError='stop';}
      return node;
    });
  }
  const flow = { id: typeof input.id === 'string' && /^flow_[a-f0-9-]{36}$/.test(input.id) ? input.id : id('flow'), name: text(input.name.trim(),120), description: text(input.description,500), variables: variables(input.variables), steps: steps(input.steps), updatedAt: new Date().toISOString() };
  if (!total) throw Error('Thêm ít nhất một bước vào flow.');
  if (flow.steps.some(s=>s.type==='youtubeUpload') && (flow.steps.length!==1 || flow.steps[0].type!=='youtubeUpload')) throw Error('Flow YouTube chỉ gồm một khối tải để tránh gửi video nhiều lần.');
  return flow;
}
function safeUrl(value) {
  if (value === 'about:blank') return value;
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error('Chỉ mở URL http/https hoặc about:blank, không kèm mật khẩu.');
  return url.href;
}
function nextSchedule(s, now = Date.now()) {
  if (s.mode === 'interval') return new Date(now + s.minutes * 60000).toISOString();
  const date = new Date(now), [h,m] = s.time.split(':').map(Number);
  date.setHours(h,m,0,0); if (date.getTime() <= now) date.setDate(date.getDate()+1);
  return date.toISOString();
}
function createAutomationService(options) {
  const { userDataPath, safeStorage, getAccount, authorizeAccount, listProfiles, startProfile, stopProfile, getSession, isProfileLaunching = () => false, notify = () => {}, openExternal = async()=>{throw Error('Không mở được trình duyệt xác nhận Google.');}, openApiNetwork } = options;
  const root = path.join(userDataPath,'Automation');
  const jobs = new Map(), queue = [], heldProfiles = new Map(), connections = new Set(), stores = new Map();
  let closing = false, pumping = false, schedulerBusy = false;
  const maximumConcurrent = 2;
  function current() {
    const account = getAccount();
    if (!account || account.status !== 'active') throw Error('Đăng nhập tài khoản đang hoạt động để sử dụng tự động hóa.');
    if(account.role!=='admin' && account.automation_enabled!==true)throw Object.assign(Error('Admin chưa cấp quyền sử dụng Flow cho tài khoản này.'),{code:'FLOW_PERMISSION_DENIED',statusCode:403});
    if (closing) throw Error('Ứng dụng đang đóng.');
    return account;
  }
  async function authorize(expected) {
    const account = getAccount();
    if(!account || account.status!=='active')throw Error('Vui lòng đăng nhập lại.');
    if (expected && account.id !== expected) throw Error('Tài khoản đã thay đổi.');
    await authorizeAccount();
    if (current().id !== account.id) throw Error('Tài khoản đã thay đổi.');
    return current();
  }
  function directory(owner) { return path.join(root,crypto.createHash('sha256').update(owner).digest('hex').slice(0,32)); }
  const youtube = createYouTubeUploader({directory,current});
  const googleApi=createYouTubeGoogleApi({directory,current,authorize,safeStorage,openNetwork:openApiNetwork});
  const managedGoogle=new Map();
  async function refreshGoogleConfig(expected,{required=false,force=false}={}){
    const owner=(await authorize(expected)).id;let previous=managedGoogle.get(owner);
    if(options.localOnly){const available=googleApi.status().configured;if(required&&!available)throw Error('Nhập tệp OAuth Desktop bằng nút Cấu hình Google API trước.');return {available,checkedAt:Date.now()};}
    if(!force&&previous&&Date.now()-previous.checkedAt<10000){if(required&&!previous.available)throw Error(previous.error);return previous;}
    try{
      if(!options.getGoogleClient)throw Error('Chưa có kết nối cấu hình Google API của Admin.');
      const raw=await options.getGoogleClient();if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');
      if(!raw)throw Error('Admin chưa cấu hình Google API. Liên hệ Admin để thiết lập.');
      const c=parseDesktopClient(JSON.stringify({installed:raw})),oldId=googleApi.clientIdentity();
      if(oldId&&oldId!==c.clientId&&heldProfiles.size)throw Error('Admin đã đổi cấu hình Google API. Dừng tác vụ và liên kết kênh lại.');
      googleApi.setManagedClient(c);previous={available:true,error:'',checkedAt:Date.now(),clientId:c.clientId};
    }catch(error){previous={available:false,error:typeof error.message==='string'?error.message:'Không lấy được cấu hình Google API của Admin.',checkedAt:Date.now()};}
    if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');managedGoogle.set(owner,previous);if(required&&!previous.available)throw Error(previous.error);return previous;
  }
  const sharedGoogleState=new Map();
  async function ensureGoogleProfile(p,owner){
    if(options.localOnly)return p;
    if(p?.cloudSyncMode==='snapshot'&&p.sourceCloudProfileId)return {...p,cloudProfileId:p.sourceCloudProfileId};
    if(!p.cloudProfileId){if(!options.ensureGoogleCloudProfile)throw Error('Hồ sơ cần được đăng ký Cloud để dùng chung liên kết kênh.');p=await options.ensureGoogleCloudProfile(p);await authorize(owner);}
    if(!p?.cloudProfileId)throw Error('Chưa đăng ký được hồ sơ Cloud.');return p;
  }
  async function refreshGoogleBindings(profiles,{expected,required=false,force=false}={}){
    const account=await authorize(expected),cfg=await refreshGoogleConfig(account.id,{required,force});if(!cfg.available||options.localOnly)return;
    const cached=sharedGoogleState.get(account.id);if(!profiles&&!force&&cached&&Date.now()-cached.at<15000){if(required&&cached.error)throw Error(cached.error);return;}
    try{
      if(!options.googleChannelCloud)throw Error('Chưa có kết nối đồng bộ liên kết kênh.');
      const targets=[];for(let p of profiles||await listProfiles()){if((p.cloudSyncMode==='snapshot'&&p.sourceCloudProfileId)||(!p.cloudProfileId&&googleApi.readConnection(p.id,account.id)))p=await ensureGoogleProfile(p,account.id);targets.push(p);}
      await authorize(account.id);await options.googleChannelCloud.synchronize(targets,googleApi.clientIdentity(),googleApi,{force,required});await authorize(account.id);sharedGoogleState.set(account.id,{at:Date.now(),error:''});
    }catch(error){if(current().id!==account.id)throw Error('Tài khoản đã thay đổi.');sharedGoogleState.set(account.id,{at:Date.now(),error:String(error.message).split('\n')[0]});if(required)throw error;}
  }
  function write(owner, store) {
    const dir = directory(owner); fs.mkdirSync(dir,{recursive:true});
    const file = path.join(dir,'automation.json'), tmp = file+'.'+crypto.randomUUID()+'.tmp';
    try { fs.writeFileSync(tmp,JSON.stringify(store,null,2),{encoding:'utf8',flag:'wx'}); fs.renameSync(tmp,file); }
    catch (error) { try { fs.unlinkSync(tmp); } catch {} throw Error('Không lưu được dữ liệu tự động hóa: '+error.code); }
  }
  function store(owner = current().id) {
    if (stores.has(owner)) return stores.get(owner);
    const file = path.join(directory(owner),'automation.json');
    let value = { flows:[], schedules:[], runs:[], secrets:{} };
    if (fs.existsSync(file)) {
      try { value = JSON.parse(fs.readFileSync(file,'utf8')); }
      catch { throw Error('Dữ liệu tự động hóa bị lỗi. Hãy giữ tệp để khôi phục trước khi tiếp tục.'); }
    }
    if (!Array.isArray(value.flows) || !Array.isArray(value.runs) || !Array.isArray(value.schedules)) throw Error('Định dạng dữ liệu tự động hóa không hợp lệ.');
    value.secrets ||= {};
    for (const run of value.runs) if (['queued','starting','running','stopping','syncing'].includes(run.status) && !jobs.has(run.id)) { run.status='interrupted'; run.error='Ứng dụng đã đóng trước khi tác vụ hoàn tất.'; }
    stores.set(owner,value); return value;
  }
  function emit(job) { try{notify({jobId:job?.id,status:job?.status});}catch{} }
  function secrets(owner) {
    const values = Object.create(null);
    for (const [key,cipher] of Object.entries(store(owner).secrets)) {
      if (!safeStorage.isEncryptionAvailable()) throw Error('Windows chưa sẵn sàng mở khóa biến bảo mật.');
      try { values[key]=safeStorage.decryptString(Buffer.from(cipher,'base64')); } catch { throw Error('Không mở được biến bảo mật '+key+' trên máy này.'); }
    }
    return values;
  }
  function redact(job,value) {
    let result=String(value??'');
    for (const secret of job?.redactions || []) if(secret.length>=3) result=result.split(secret).join('***');
    return result.replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi,'$1?[ẩn tham số]').slice(0,2000);
  }
  function publicJob(job) {
    return {id:job.id,flowId:job.flowId,flowName:job.flowName,profileId:job.profileId,profileName:job.profileName,status:job.status,
      createdAt:job.createdAt,startedAt:job.startedAt,finishedAt:job.finishedAt,step:job.step,error:job.error,logs:job.logs,
      outputs:job.outputs,artifacts:job.artifacts,source:job.source,youtubeEngine:job.youtubeEngine,youtubeProgress:job.youtubeProgress?structuredClone(job.youtubeProgress):null};
  }
  function persistJob(job) {
    const data=store(job.owner); const row=publicJob(job), at=data.runs.findIndex(r=>r.id===job.id);
    if(at<0)data.runs.unshift(row);else data.runs[at]=row;
    data.runs=data.runs.slice(0,200);write(job.owner,data);
  }
  function log(job,status,message) {
    job.logs.push({at:new Date().toISOString(),status,message:redact(job,message)});
    if(job.logs.length>1000)job.logs.shift();emit(job);
  }
  async function visibleProfiles() { const account=await authorize();const rows=await listProfiles();if(current().id!==account.id)throw Error('Tài khoản đã thay đổi.');return rows; }
  async function profile(idValue,owner=current().id) {
    await authorize(owner);
    const rows=await listProfiles(), found=rows.find(p=>p.id===idValue);
    if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');
    if(!found)throw Error('Hồ sơ không tồn tại trong danh sách hoặc tài khoản không có quyền sử dụng.');
    return found;
  }
  async function start(idValue,url,jobId=null) {
    await profile(idValue);
    if(heldProfiles.has(idValue)&&heldProfiles.get(idValue)!==jobId)throw Error('Hồ sơ đang được tự động hóa điều khiển.');
    const startedNow=!getSession(idValue)&&!isProfileLaunching(idValue);
    const result=await startProfile(idValue,{startUrl:url?safeUrl(url):'about:blank'});
    if(!result?.success)throw Error(result?.error||'Không mở được hồ sơ.');
    const session=getSession(idValue);
    if(!session?.browserWsUrl||session.finishing){const error=Error('Chrome chưa sẵn sàng cho kết nối tự động hóa.');if(startedNow)error.tdStartedProfile=idValue;throw error;}
    return {profileId:idValue,startedNow,cdpUrl:`http://127.0.0.1:${session.debugPort}`,wsEndpoint:session.browserWsUrl};
  }
  async function connect(idValue,owner) {
    await profile(idValue,owner);
    const session=getSession(idValue);
    if(!session?.browserWsUrl||session.finishing)throw Error('Mở hồ sơ trước khi điều khiển trình duyệt.');
    const browser=await chromium.connectOverCDP(session.browserWsUrl,{timeout:15000,noDefaults:true});
    try{
      if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');
      const context=browser.contexts()[0];
      if(!context)throw Error('Không tìm thấy môi trường của hồ sơ.');
      connections.add(browser);browser.once('disconnected',()=>connections.delete(browser));
      return {browser,context};
    }catch(error){await browser.close().catch(()=>{});throw error;}
  }
  function interpolate(value,vars) {
    return String(value??'').replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,(_,key)=>{
      variableName(key);if(!Object.hasOwn(vars,key))throw Error('Thiếu biến '+key);return String(vars[key]);
    });
  }
  function checkCancelled(job) { if(job.cancelled||closing)throw Error('Đã dừng tác vụ.'); }
  async function delay(ms,job) {
    const end=Date.now()+Math.min(300000,Math.max(0,ms));
    while(Date.now()<end){checkCancelled(job);await new Promise(resolve=>setTimeout(resolve,Math.min(200,end-Date.now())));}
  }
  async function executeNode(step,state,job) {
    const {context,vars}=state;let page=state.page;
    if(!page||page.isClosed())throw Error('Tab đã đóng. Hãy chọn tab khác hoặc mở tab mới.');
    const value=interpolate(step.value,vars), selector=interpolate(step.selector,vars), locator=selector?page.locator(selector).first():null;
    const timeout=step.timeout;
    switch(step.type){
      case 'youtubeUpload': throw Error('Tải YouTube chỉ dùng Google API trong flow tải đã chuẩn bị.');
      case 'goto': await page.goto(safeUrl(value),{timeout,waitUntil:'domcontentloaded'});break;
      case 'click': {
        if(step.waitForPopup){
          const popup=page.waitForEvent('popup',{timeout:timeout*2}).then(value=>({value}),error=>({error}));
          await locator.click({timeout});const result=await popup;if(result.error)throw result.error;state.page=result.value;
        }else{
          await locator.click({timeout});
        }
        break;
      }
      case 'fill': await locator.fill(value,{timeout});break;
      case 'press': if(locator)await locator.press(value,{timeout});else await page.keyboard.press(value);break;
      case 'wait': if(locator)await locator.waitFor({state:'visible',timeout});else await delay(Number(value)||1000,job);break;
      case 'select': await locator.selectOption(value,{timeout});break;
      case 'check': await locator.setChecked(step.checked,{timeout});break;
      case 'scroll': await page.mouse.wheel(0,Math.min(10000,Math.max(-10000,Number(value)||600)));break;
      case 'extract': {
        const extracted=(await locator.innerText({timeout})).slice(0,20000);
        vars[step.variable]=extracted;job.outputs[step.variable]=redact(job,extracted);break;
      }
      case 'setVariable': vars[step.variable]=value;break;
      case 'screenshot': {
        if(job.artifacts.length>=20)throw Error('Mỗi tác vụ tối đa 20 ảnh chụp.');
        const bytes=await page.screenshot({type:'jpeg',quality:80,scale:'css',timeout});
        if(bytes.length>12*1024*1024)throw Error('Ảnh chụp quá lớn.');
        const file=id('image')+'.jpg', dir=path.join(directory(job.owner),'artifacts',job.id);
        fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,file),bytes);
        job.artifacts.push({file,label:text(value||'Ảnh bước '+job.step,120),mimeType:'image/jpeg',size:bytes.length});break;
      }
      case 'newTab': state.page=await context.newPage();await state.page.goto(safeUrl(value),{timeout,waitUntil:'domcontentloaded'});break;
      case 'switchTab': { const pages=context.pages();if(!pages[step.pageIndex])throw Error('Không có tab số '+(step.pageIndex+1));state.page=pages[step.pageIndex];await state.page.bringToFront();break; }
      case 'closeTab': await page.close();state.page=context.pages()[0]||await context.newPage();break;
      case 'if': {
        let matched;
        if(step.condition==='variableEquals')matched=String(vars[step.variable]??'')===value;
        else if(step.condition==='textContains')matched=(await locator.innerText({timeout})).includes(value);
        else {matched=await locator.isVisible();if(step.condition==='hidden')matched=!matched;}
        await executeSteps(matched?step.steps:step.otherwise,state,job);break;
      }
      case 'repeat': {const previous=vars.LOOP_INDEX;try{for(let i=0;i<step.count;i++){vars.LOOP_INDEX=i+1;await executeSteps(step.steps,state,job);}}finally{if(previous===undefined)delete vars.LOOP_INDEX;else vars.LOOP_INDEX=previous;}break;}
      default: throw Error('Loại bước không được hỗ trợ.');
    }
  }
  async function executeSteps(steps,state,job) {
    for(const step of steps){
      checkCancelled(job);if(++job.step>5000)throw Error('Tác vụ vượt giới hạn 5.000 bước thực thi.');
      if(Date.now()-job.lastAuth>5000){await profile(job.profileId,job.owner);job.lastAuth=Date.now();}
      const label=step.name||step.type;log(job,'running','Bước '+job.step+': '+label);
      let completed=false;
      for(let attempt=0;attempt<=step.retries;attempt++){
        checkCancelled(job);
        try{await executeNode(step,state,job);completed=true;break;}
        catch(error){checkCancelled(job);if(attempt<step.retries){log(job,'retry','Thử lại: '+label);await delay(500,job);}else if(step.onError==='continue')log(job,'warning','Bỏ qua bước lỗi: '+label+' — '+error.message.split('\n')[0]);else throw error;}
      }
      if(completed)log(job,'success','Hoàn tất: '+label);
    }
  }
  async function runYouTubeQueue(job){
    const prepared=job.youtubePlan,files=prepared.files,batches=Math.ceil(files.length/15),items=files.map(f=>({id:f.id,name:f.name,phase:'queued',percent:0,bytesConfirmed:0,bytesTotal:f.bytes})),byId=new Map(items.map(i=>[i.id,i]));
    const totalBytes=files.reduce((n,f)=>n+f.bytes,0);let completed=0,confirmedBytes=0,lastProgressAt=0;
    job.outputs.YOUTUBE_VIDEOS=[];
    const checkpoint=async()=>{checkCancelled(job);if(Date.now()-job.lastAuth>5000){if(!job.authCheck)job.authCheck=(async()=>{const p=await profile(job.profileId,job.owner);await refreshGoogleBindings([p],{expected:job.owner,required:true});const c=googleApi.connection(job.profileId,job.owner);if(c.channelId!==prepared.settings.channelId)throw Error('Liên kết kênh đã thay đổi. Dừng tác vụ và làm mới danh sách.');job.lastAuth=Date.now();})().finally(()=>{job.authCheck=null;});await job.authCheck;}checkCancelled(job);};
    if(prepared.settings.uploadOrder==='PARALLEL'){
      await checkpoint();
      const publish=value=>{if(Date.now()-lastProgressAt<250&&!['completed','paused','failed','review'].includes(value.phase)&&value.startedCount===job.youtubeProgress?.startedCount)return;lastProgressAt=Date.now();job.youtubeProgress={...value,method:'Google API',queueMode:'rolling',total:files.length,displayItems:structuredClone((value.displayItems||[]).slice(0,15))};emit(job);};
      log(job,'running','Hàng đợi cuốn chiếu: tối đa 15 video đang tải; hoàn tất một video sẽ lấy video tiếp theo.');
      await googleApi.upload({profile:await profile(job.profileId,job.owner),owner:job.owner,prepared,journal:youtube,signal:job.abortController.signal,checkpoint,delay:ms=>delay(ms,job),progress:publish,log:message=>log(job,'running',message),result:row=>{job.outputs.YOUTUBE_VIDEOS.push(row);persistJob(job);emit(job);}});
      return;
    }
    for(let offset=0;offset<files.length;offset+=15){
      await checkpoint();const batch=files.slice(offset,offset+15),batchIndex=Math.floor(offset/15)+1;let latest={completed:0,failed:0,overallBytesConfirmed:0,items:[]};
      const publish=(value,force=false)=>{
        latest=value;for(const item of value.items||[])Object.assign(byId.get(item.id),item);
        if(!force&&Date.now()-lastProgressAt<250&&!['completed','paused','failed','review'].includes(value.phase))return;
        lastProgressAt=Date.now();const received=confirmedBytes+(value.overallBytesConfirmed||0);
        job.youtubeProgress={...value,method:'Google API',batchIndex,totalBatches:batches,batchSize:batch.length,concurrent:prepared.settings.uploadOrder==='PARALLEL'?batch.length:1,uploadOrder:prepared.settings.uploadOrder,queuedCount:files.length-offset-batch.length,total:files.length,completed:completed+(value.completed||0),overallBytesConfirmed:received,overallBytesTotal:totalBytes,overallPercent:Math.floor(received/totalBytes*100),items:structuredClone(items),displayItems:structuredClone(batch.map(f=>byId.get(f.id)))};emit(job);
      };
      publish(latest,true);log(job,'running','Lượt '+batchIndex+'/'+batches+': '+batch.length+' video; '+(prepared.settings.uploadOrder==='PARALLEL'?'tải đồng thời.':'tải lần lượt theo danh sách.'));
      try{
        await googleApi.upload({profile:await profile(job.profileId,job.owner),owner:job.owner,prepared:{settings:prepared.settings,files:batch},journal:youtube,signal:job.abortController.signal,checkpoint,
          delay:ms=>delay(ms,job),progress:value=>publish(value),log:message=>log(job,'running',message),result:row=>{job.outputs.YOUTUBE_VIDEOS.push(row);persistJob(job);emit(job);}});
        publish(latest,true);completed+=latest.completed||0;confirmedBytes+=latest.overallBytesConfirmed||0;
      }catch(error){publish(latest,true);if(job.cancelled||job.abortController.signal.aborted)throw error;throw Error('Dừng tại lượt '+batchIndex+'/'+batches+'. '+error.message+' Các lượt sau chưa bắt đầu.');}
    }
  }
  async function run(job) {
    let browser,opened=false;job.abortController=new AbortController();
    const maximumMinutes=job.youtubePlan?Math.max(360,Math.ceil(job.youtubePlan.files.length/(job.youtubePlan.settings.uploadOrder==='PARALLEL'?15:1))*job.youtubePlan.settings.timeoutMinutes+30):30;
    const expiresAt=Date.now()+maximumMinutes*60000;let deadline;
    const watchDeadline=()=>{const remaining=expiresAt-Date.now();if(remaining>0){deadline=setTimeout(watchDeadline,Math.min(remaining,2147483647));return;}job.cancelled=true;job.timeout=true;job.abortController?.abort();void job.browser?.close().catch(()=>{});};watchDeadline();
    try{
      await profile(job.profileId,job.owner);checkCancelled(job);
      job.status='running';job.startedAt=new Date().toISOString();emit(job);
      const vars=Object.assign(Object.create(null),job.flow.variables,secrets(job.owner),job.variables,{PROFILE_ID:job.profileId,PROFILE_NAME:job.profileName});
      job.redactions=Object.values(vars).map(String).filter(v=>v.length>=3).sort((a,b)=>b.length-a.length);
      log(job,'running','Bắt đầu flow trên hồ sơ '+job.profileName);
      if(job.youtubePlan&&job.youtubeEngine==='api'){
        await runYouTubeQueue(job);
      }else{
        const connection=await start(job.profileId,undefined,job.id);opened=connection.startedNow;checkCancelled(job);
        const connected=await connect(job.profileId,job.owner);browser=connected.browser;job.browser=browser;checkCancelled(job);
        const page=connected.context.pages()[0]||await connected.context.newPage();
        await executeSteps(job.flow.steps,{...connected,page,vars},job);
      }checkCancelled(job);
      job.status='success';
    }catch(error){if(error.tdStartedProfile===job.profileId)opened=true;job.status=job.cancelled?'cancelled':'failed';job.error=job.timeout?'Tác vụ vượt thời hạn '+maximumMinutes+' phút.':redact(job,error.message.split('\n')[0]);log(job,job.status,job.error);}
    finally{
      clearTimeout(deadline);
      if(browser)await browser.close().catch(()=>{}); // CDP disconnect; do not close the persistent context.
      if(opened&&job.closeAfter){const outcome=job.status;job.status='syncing';emit(job);try{await stopProfile(job.profileId,{waitForSync:true});job.status=outcome;}catch(error){job.status='failed';job.error='Không hoàn tất đóng hồ sơ: '+redact(job,error.message);}}
      job.finishedAt=new Date().toISOString();
      try{persistJob(job);}catch(error){job.status='failed';job.error=error.message;}
      if(job.youtubeEngine==='api'&&options.googleChannelCloud){try{const record=googleApi.readConnection(job.profileId,job.owner);if(record?.needsReauth&&record.sharedRevision){const p=await ensureGoogleProfile(await profile(job.profileId,job.owner),job.owner);googleApi.installConnection(job.profileId,await options.googleChannelCloud.persistState(p,googleApi.clientIdentity(),record),job.owner);}}catch{}}
      heldProfiles.delete(job.profileId);job.browser=null;job.abortController=null;job.variables=null;job.redactions=[];job.flow=null;job.youtubePlan=null;
      const completed=Array.from(jobs.values()).filter(j=>j.finishedAt);
      for(const old of completed.slice(0,Math.max(0,completed.length-200)))jobs.delete(old.id);
      emit(job);void pump();
    }
  }
  async function pump() {
    if(pumping||closing)return;pumping=true;
    try{
      while(heldProfiles.size<maximumConcurrent){
        const index=queue.findIndex(j=>!heldProfiles.has(j.profileId));if(index<0)break;
        const [job]=queue.splice(index,1);if(job.cancelled)continue;
        heldProfiles.set(job.profileId,job.id);job.status='starting';void run(job);
      }
    }finally{pumping=false;}
  }
  async function startBatch(input,source='manual') {
    const account=await authorize();const data=store(account.id),flow=data.flows.find(f=>f.id===input.flowId);
    if(!flow)throw Error('Không tìm thấy flow.');
    const ids=[...new Set(input.profileIds||[])];
    const isYouTube=flow.steps.some(s=>s.type==='youtubeUpload');
    if(isYouTube && ids.some(pid=>heldProfiles.has(pid)||queue.some(j=>j.profileId===pid)))throw Error('Hồ sơ đang có tác vụ. Đợi hoàn tất trước khi tải video.');
    if(isYouTube && (ids.length!==1 || source==='schedule'))throw Error('Flow YouTube chạy thủ công trên đúng một hồ sơ mỗi lượt.');
    if(!ids.length||ids.length>100)throw Error('Chọn từ 1 đến 100 hồ sơ.');
    if(queue.length+ids.length>200)throw Error('Hàng đợi đã đầy, tối đa 200 tác vụ.');
    const profiles=await listProfiles();if(ids.some(pid=>!profiles.some(p=>p.id===pid)))throw Error('Có hồ sơ không thuộc danh sách được cấp quyền.');
    if(current().id!==account.id)throw Error('Tài khoản đã thay đổi.');
    if(queue.length+ids.length>200)throw Error('Hàng đợi đã đầy, tối đa 200 tác vụ.');
    const vars=variables({...flow.variables,...variables(input.variables)});
    const youtubeEngine=vars.YOUTUBE_ENGINE||'api';
    if(isYouTube && youtubeEngine!=='api')throw Error('Bản 1.3.7 chỉ tải bằng Google API. Chọn Riêng tư, Không công khai hoặc Công khai.');
    if(isYouTube){
      if(vars.YOUTUBE_VISIBILITY==='DRAFT')throw Error('Đã bỏ tải bản nháp. Chọn Riêng tư, Không công khai hoặc Công khai.');
      visibility(vars.YOUTUBE_VISIBILITY);await refreshGoogleBindings([profiles.find(p=>p.id===ids[0])],{expected:account.id,required:true,force:true});
      const binding=googleApi.status().channels[ids[0]];
      if(youtubeEngine==='api')googleApi.connection(ids[0],account.id);
      if(!binding)throw Error('Liên kết kênh YouTube trong hồ sơ trước khi chạy.');
      if(vars.YOUTUBE_CHANNEL && channelId(vars.YOUTUBE_CHANNEL)!==binding.channelId)throw Error('Kênh khác liên kết của hồ sơ.');
      vars.YOUTUBE_CHANNEL=binding.channelId;vars.YOUTUBE_AUDIENCE='no';vars.YOUTUBE_THUMBNAILS='';vars.YOUTUBE_DESCRIPTION='';
      let sourceFolders;try{sourceFolders=vars.YOUTUBE_FOLDERS===undefined?[vars.YOUTUBE_FOLDER]:JSON.parse(vars.YOUTUBE_FOLDERS);}catch{throw Error('Danh sách thư mục không hợp lệ.');}
      const rows=youtube.scan({folders:sourceFolders,profileId:ids[0],channel:binding.channelId},account.id);
      let selected;try{selected=JSON.parse(vars.YOUTUBE_ITEMS||'[]');}catch{throw Error('Danh sách video không hợp lệ.');}
      if(!Array.isArray(selected)||!selected.length||selected.length>1000)throw Error('Chọn từ 1 đến 1.000 video. App chia mỗi lượt tối đa 15 video.');
      vars.YOUTUBE_ITEMS=JSON.stringify(selected.map(item=>{const row=rows.find(r=>r.id===item.id);if(!row)throw Error('Video đã thay đổi. Quét lại thư mục.');return {id:row.id,title:title(Array.from(path.parse(row.name).name.trim()).slice(0,100).join('')),description:'',thumbnailName:''};}));
      visibility(vars.YOUTUBE_VISIBILITY);
    }
    const secretValues=Object.values(secrets(account.id)).map(String);
    if(isYouTube && (heldProfiles.has(ids[0])||queue.some(j=>j.profileId===ids[0])))throw Error('Hồ sơ đang có tác vụ.');
    const youtubePlan=isYouTube?youtube.plan({...flow.variables,...vars},ids[0],account.id,{allowApiResume:youtubeEngine==='api'}):null;
    if(isYouTube&&Array.from(jobs.values()).some(j=>!j.finishedAt&&j.youtubePlan?.settings.channelId===youtubePlan.settings.channelId))throw Error('Kênh này đang có hàng đợi tải trên app. Đợi hoàn tất hoặc dừng hàng đợi đó trước.');
    if(queue.length+ids.length>200)throw Error('Hàng đợi đã đầy, tối đa 200 tác vụ.');
    const pending=[];
    for(const pid of ids){
      const p=profiles.find(row=>row.id===pid);
      const job={id:id('run'),owner:account.id,flowId:flow.id,flowName:flow.name,profileId:pid,profileName:p.name,status:'queued',
        createdAt:new Date().toISOString(),logs:[],outputs:{},artifacts:[],step:0,source,lastAuth:0,cancelled:false,
        variables:vars,redactions:[...secretValues,...Object.values(vars).map(String)],flow:structuredClone(flow),youtubePlan,youtubeEngine,closeAfter:input.closeAfter!==false};
      pending.push(job);
    }
    const oldRuns=data.runs;
    data.runs=[...pending].reverse().map(publicJob).concat(oldRuns).slice(0,200);
    try{write(account.id,data);}catch(error){data.runs=oldRuns;throw error;}
    for(const job of pending){jobs.set(job.id,job);queue.push(job);}
    emit();void pump();return pending.map(publicJob);
  }
  function ownJob(runId) {
    const owner=current().id,job=jobs.get(runId);
    if(job&&job.owner===owner)return job;
    const row=store(owner).runs.find(r=>r.id===runId);if(!row)throw Error('Không tìm thấy tác vụ của tài khoản.');return row;
  }
  async function cancel(runId) {
    const job=ownJob(runId);if(!['queued','running','starting','stopping'].includes(job.status))return publicJob(job);
    job.cancelled=true;
    if(job.status==='queued'){
      job.status='cancelled';job.finishedAt=new Date().toISOString();const at=queue.indexOf(job);if(at>=0)queue.splice(at,1);persistJob(job);emit(job);
    }else{job.status='stopping';job.abortController?.abort();emit(job);if(job.browser)await job.browser.close().catch(()=>{});}
    return publicJob(job);
  }
  async function browserAction(input) {
    const account=await authorize();await profile(input.profileId,account.id);
    if(heldProfiles.has(input.profileId))throw Error('Hồ sơ đang chạy flow hoặc thao tác khác.');
    if(heldProfiles.size>=maximumConcurrent)throw Error('Đã có 2 tác vụ đang điều khiển trình duyệt. Vui lòng đợi.');
    heldProfiles.set(input.profileId,'action');let browser;
    const deadline=setTimeout(()=>{void browser?.close().catch(()=>{});},25000);
    try{
      const connected=await connect(input.profileId,account.id);browser=connected.browser;
      const pages=connected.context.pages(),page=pages[Number(input.pageIndex)||0];if(!page)throw Error('Tab không tồn tại.');
      const step=validateFlow({name:'Action',steps:[{...input.step,retries:0,onError:'stop',timeout:15000}]}).steps[0];
      if(['repeat','if'].includes(step.type))throw Error('Dùng flow cho điều kiện và vòng lặp.');
      const fake={id:id('action'),owner:account.id,artifacts:[],outputs:{},step:1,redactions:Object.values(secrets(account.id)).map(String)};
      const state={...connected,page,vars:secrets(account.id)};
      await executeNode(step,state,fake);
      if(step.type==='screenshot'){const artifact=fake.artifacts[0],dir=path.join(directory(account.id),'artifacts',fake.id),target=path.join(dir,artifact.file),data=fs.readFileSync(target).toString('base64');fs.unlinkSync(target);fs.rmdirSync(dir);return {mimeType:artifact.mimeType,data};}
      return {url:state.page.url(),title:await state.page.title(),outputs:fake.outputs};
    }finally{clearTimeout(deadline);if(browser)await browser.close().catch(()=>{});heldProfiles.delete(input.profileId);void pump();}
  }
  async function browserPages(profileId) {
    const owner=(await authorize()).id;const {browser,context}=await connect(profileId,owner);
    const deadline=setTimeout(()=>{void browser.close().catch(()=>{});},20000);
    try{return await Promise.all(context.pages().map(async(page,index)=>({index,title:await page.title(),url:page.url()})));}
    finally{clearTimeout(deadline);await browser.close().catch(()=>{});}
  }
  async function schedulerTick() {
    if(schedulerBusy||closing||!getAccount())return;schedulerBusy=true;
    try{
      const owner=current().id,data=store(owner);
      for(const schedule of data.schedules){
        if(!schedule.enabled||Date.parse(schedule.nextRunAt)>Date.now())continue;
        schedule.nextRunAt=nextSchedule(schedule);write(owner,data);
        try{await startBatch(schedule,'schedule');schedule.lastError=null;schedule.lastRunAt=new Date().toISOString();}
        catch(error){schedule.lastError=text(error.message,300);}
        write(owner,data);emit();
      }
    }catch{}finally{schedulerBusy=false;}
  }
  async function linkYouTube(profileId){
    const account=await authorize();await profile(profileId,account.id);
    if(heldProfiles.has(profileId)||heldProfiles.size>=maximumConcurrent)throw Error('Hồ sơ đang có tác vụ. Hãy đợi hoàn tất.');
    const token=id('inspect');heldProfiles.set(profileId,token);let browser;
    const deadline=setTimeout(()=>{void browser?.close().catch(()=>{});},65000);
    try{
      await start(profileId,'https://studio.youtube.com',token);
      const connected=await connect(profileId,account.id);browser=connected.browser;
      let page=connected.context.pages().find(p=>{try{return new URL(p.url()).hostname==='studio.youtube.com';}catch{return false;}});
      if(!page){page=await connected.context.newPage();await page.goto('https://studio.youtube.com',{waitUntil:'domcontentloaded',timeout:30000});}
      await page.bringToFront();const until=Date.now()+30000;let found;
      while(Date.now()<until){await authorize(account.id);try{found=channelId(page.url());break;}catch{}await new Promise(r=>setTimeout(r,500));}
      if(!found)throw Error('Đăng nhập YouTube Studio và chọn đúng kênh trong hồ sơ, rồi bấm Liên kết kênh lại.');
      let name='';try{name=(await page.locator('#channel-title').first().innerText({timeout:3000})).trim().slice(0,160);}catch{}
      await profile(profileId,account.id);const binding={profileId,channelId:found,name:name||found,checkedAt:new Date().toISOString()};
      const data=store(account.id);data.youtubeChannels||={};data.youtubeChannels[profileId]=binding;write(account.id,data);emit();return binding;
    }finally{clearTimeout(deadline);if(browser)await browser.close().catch(()=>{});heldProfiles.delete(profileId);void pump();}
  }
  async function openYouTubeProfile(profileId,mode='PRIVATE'){
    const account=await authorize();await profile(profileId,account.id);visibility(mode);
    if(heldProfiles.has(profileId)||heldProfiles.size>=maximumConcurrent)throw Error('Hồ sơ đang có tác vụ. Hãy đợi hoàn tất.');
    const token=id('youtube-open');heldProfiles.set(profileId,token);let browser;
    const deadline=setTimeout(()=>{void browser?.close().catch(()=>{});},65000);
    try{
      const data=store(account.id),binding=googleApi.status().channels[profileId]||data.youtubeChannels?.[profileId];
      const url=binding?.channelId?'https://studio.youtube.com/channel/'+channelId(binding.channelId)+'/videos':'https://studio.youtube.com';
      await start(profileId,url,token);const connected=await connect(profileId,account.id);browser=connected.browser;
      let page=connected.context.pages().find(p=>{try{return new URL(p.url()).hostname==='studio.youtube.com';}catch{return false;}});
      if(!page)page=await connected.context.newPage();
      await profile(profileId,account.id);await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await page.bringToFront();
      return {profileId,url};
    }finally{clearTimeout(deadline);if(browser)await browser.close().catch(()=>{});heldProfiles.delete(profileId);void pump();}
  }
  async function linkGoogle(profileId){
    const account=await authorize();let p=await profile(profileId,account.id);p=await ensureGoogleProfile(p,account.id);
    await refreshGoogleBindings([p],{expected:account.id,required:true,force:true});
    const existing=googleApi.status().channels[profileId];if(existing&&!existing.needsReauth)return existing;
    if(heldProfiles.has(profileId)||heldProfiles.size>=maximumConcurrent)throw Error('Hồ sơ đang có tác vụ.');
    if(!googleApi.status().configured)throw Error('Nhập tệp OAuth Desktop bằng nút Cấu hình Google API trước.');
    const token=id('google-oauth');heldProfiles.set(profileId,token);let browser,context,matcher,handler;
    try{
      await start(profileId,undefined,token);const connected=await connect(profileId,account.id);browser=connected.browser;context=connected.context;
      const page=await context.newPage();
      const linked=await googleApi.connect({profile:p,expectedChannelId:googleApi.readConnection(profileId,account.id)?.channelId||store(account.id).youtubeChannels?.[profileId]?.channelId,openUrl:async(url,{callbackUrl,receiveCallback})=>{
        const callback=new URL(callbackUrl);matcher=value=>value.origin===callback.origin&&value.pathname===callback.pathname;
        // Only this OAuth callback is fulfilled locally. General proxy routing stays unchanged.
        handler=async route=>{try{const req=route.request(),value=receiveCallback(req.url(),req.method());await route.fulfill({status:value.status,headers:value.headers,body:value.body});}catch{await route.abort().catch(()=>{});}};
        await context.route(matcher,handler);await profile(profileId,account.id);await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await page.bringToFront();
        let text='';try{text=(await page.locator('body').innerText({timeout:2000})).slice(0,6000);}catch{}
        if(/400\.\s*(?:That['’]s an error|Đó là lỗi)|request because it is malformed/i.test(text))throw Error('Google trả lỗi 400 ở bước cấp quyền. Đóng tab lỗi và bấm Liên kết Google để tạo phiên mới. Nếu vẫn lỗi, kiểm tra OAuth Desktop và cấu hình tài khoản/kênh trong Google Cloud.');
      }});
      await authorize(account.id);const record=googleApi.readConnection(profileId,account.id);if(!options.localOnly)googleApi.installConnection(profileId,await options.googleChannelCloud.publish(p,googleApi.clientIdentity(),record),account.id);sharedGoogleState.delete(account.id);return googleApi.status().channels[profileId];
    }finally{if(context&&matcher)await context.unroute(matcher,handler).catch(()=>{});if(browser)await browser.close().catch(()=>{});heldProfiles.delete(profileId);emit();void pump();}
  }
  let permissionChecking=false;
  const permissionTimer=setInterval(async()=>{if(permissionChecking||closing||(!heldProfiles.size&&!queue.length))return;permissionChecking=true;try{await authorize();}catch{for(const job of jobs.values())if(!job.finishedAt){job.cancelled=true;job.abortController?.abort();job.error='Quyền Flow hoặc tài khoản đã thay đổi.';if(job.status==='queued'){job.status='cancelled';job.finishedAt=new Date().toISOString();try{persistJob(job);}catch{}}}queue.length=0;googleApi.abortPending();await Promise.allSettled(Array.from(connections,b=>b.close()));emit();}finally{permissionChecking=false;}},5000);permissionTimer.unref();
  const scheduleTimer=setInterval(()=>{void schedulerTick();},15000);scheduleTimer.unref();
  return {
    authorize, current, start, linkYouTube, linkGoogle,openYouTubeProfile,refreshGoogleConfig,refreshGoogleBindings,
    async importGoogleClient(input){const account=await authorize();if(account.role!=='admin')throw Error('Chỉ Admin được cấu hình Google API.');if(heldProfiles.size||queue.length)throw Error('Dừng các tác vụ trước khi đổi cấu hình Google.');if(!safeStorage.isEncryptionAvailable())throw Error('Windows chưa sẵn sàng mã hóa cấu hình Google.');const c=parseDesktopClient(input);if(options.localOnly){googleApi.setManagedClient(c);emit();return googleApi.status();}if(!options.saveGoogleClient)throw Error('Chưa có kết nối cấu hình Google API của Admin.');await options.saveGoogleClient({client_id:c.clientId,client_secret:c.clientSecret,project_id:c.projectId});await authorize(account.id);managedGoogle.delete(account.id);await refreshGoogleConfig(account.id,{required:true,force:true});emit();return googleApi.status();},
    async cancelGoogleLink(pid){await authorize();googleApi.abortPending(pid);return true;},
    async disconnectGoogle(pid){const account=await authorize();if(account.role!=='admin')throw Error('Chỉ Admin được ngắt liên kết kênh dùng chung.');const p=await ensureGoogleProfile(await profile(pid,account.id),account.id);if(heldProfiles.has(pid))throw Error('Dừng tác vụ trước khi ngắt liên kết.');if(!options.localOnly&&p.cloudProfileId)await options.googleChannelCloud.revoke(p);await authorize(account.id);googleApi.forgetConnection(pid,account.id);sharedGoogleState.delete(account.id);return true;},
    youtubeSettings:()=>{const account=current(),managed=managedGoogle.get(account.id),saved=googleApi.status(),shared=sharedGoogleState.get(account.id);return structuredClone({channels:store().youtubeChannels||{},google:{...saved,configured:!!managed?.available,managed:true,canConfigure:account.role==='admin',canDisconnect:account.role==='admin',error:managed?.error||'',sharingError:shared?.error||''},preferences:store().youtubePreferences||{}});},
    async saveYouTubeSettings(input){const account=await authorize();await profile(input.profileId,account.id);const data=store(account.id),list=input.folders===undefined?(input.folder?[input.folder]:[]):input.folders;if(!Array.isArray(list)||list.length>100||list.some(f=>typeof f!=='string'))throw Error('Danh sách thư mục không hợp lệ.');if(list.length)youtube.scan({folders:list,profileId:input.profileId},account.id);data.youtubePreferences||={};const previous=data.youtubePreferences[input.profileId],excludedIds=input.excludedIds===undefined?(previous?.excludedIds||[]):input.excludedIds;if(!Array.isArray(excludedIds)||excludedIds.length>1000||excludedIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw Error('Danh sách video đã gỡ không hợp lệ.');data.youtubePreferences[input.profileId]={folders:[...list],folder:list[0]||'',excludedIds:[...new Set(excludedIds)],visibility:visibility(input.visibility),uploadOrder:uploadOrder(input.uploadOrder)};try{write(account.id,data);}catch(error){if(previous)data.youtubePreferences[input.profileId]=previous;else delete data.youtubePreferences[input.profileId];throw error;}return true;}, visibleProfiles, browserAction, browserPages, startBatch,
    grantYouTubeFolder:(value,owner)=>youtube.grantFolder(value,owner),
    async scanYouTube(input){const account=await authorize();if(input.profileId)await profile(input.profileId,account.id);return youtube.scan(input,account.id);},
    isBusy:()=>heldProfiles.size>0||queue.length>0||Array.from(jobs.values()).some(j=>['running','starting','stopping'].includes(j.status)),
    isProfileBusy:profileId=>heldProfiles.has(profileId),
    async stop(profileId){await profile(profileId);if(heldProfiles.has(profileId))throw Error('Dừng tác vụ của hồ sơ trước khi đóng.');return stopProfile(profileId,{waitForSync:false});},
    listFlows:()=>structuredClone(store().flows),
    saveFlow(input){const flow=validateFlow(input),owner=current().id,data=store(owner),at=data.flows.findIndex(f=>f.id===flow.id);if(at<0){if(data.flows.length>=300)throw Error('Tối đa 300 flow.');data.flows.push(flow);}else data.flows[at]=flow;write(owner,data);emit();return flow;},
    deleteFlow(flowId){const owner=current().id,data=store(owner);if(data.schedules.some(s=>s.flowId===flowId&&s.enabled))throw Error('Tắt lịch chạy của flow trước khi xóa.');data.flows=data.flows.filter(f=>f.id!==flowId);write(owner,data);emit();return true;},
    getJob:runId=>publicJob(ownJob(runId)),
    listJobs(){const owner=current().id,rows=new Map(store(owner).runs.map(r=>[r.id,r]));for(const j of jobs.values())if(j.owner===owner)rows.set(j.id,publicJob(j));return Array.from(rows.values()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200).map(row=>{const {logs,outputs,artifacts,...summary}=row;return summary;});},
    async cancelProfile(profileId){
      const closing=[];
      for(const job of jobs.values())if(job.profileId===profileId&&!job.finishedAt){job.cancelled=true;job.abortController?.abort();if(job.status==='queued'){const at=queue.indexOf(job);if(at>=0)queue.splice(at,1);job.status='cancelled';job.finishedAt=new Date().toISOString();persistJob(job);}else job.status='stopping';if(job.browser)closing.push(job.browser.close().catch(()=>{}));emit(job);}
      await Promise.allSettled(closing);
    },
    cancel,
    listSecrets:()=>Object.keys(store().secrets),
    saveSecret(name,value){variableName(name);if(typeof value!=='string'||value.length>20000)throw Error('Giá trị biến không hợp lệ.');if(!safeStorage.isEncryptionAvailable())throw Error('Windows chưa hỗ trợ mã hóa biến bảo mật.');const owner=current().id,data=store(owner);data.secrets[name]=safeStorage.encryptString(value).toString('base64');write(owner,data);return Object.keys(data.secrets);},
    deleteSecret(name){variableName(name);const owner=current().id,data=store(owner);delete data.secrets[name];write(owner,data);return true;},
    listSchedules:()=>structuredClone(store().schedules),
    async saveSchedule(input){const owner=(await authorize()).id,data=store(owner);if(!data.flows.some(f=>f.id===input.flowId))throw Error('Chọn flow hợp lệ.');
      if(data.flows.find(f=>f.id===input.flowId).steps.some(s=>s.type==='youtubeUpload'))throw Error('Flow YouTube cần xem trước và chạy thủ công.');
      const s={id:/^schedule_[a-f0-9-]{36}$/.test(input.id||'')?input.id:id('schedule'),flowId:input.flowId,profileIds:[...new Set(input.profileIds||[])],variables:variables(input.variables),enabled:input.enabled!==false,mode:input.mode==='daily'?'daily':'interval',minutes:Math.min(43200,Math.max(1,Math.floor(Number(input.minutes)||60))),time:/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time||'')?input.time:'09:00',closeAfter:input.closeAfter!==false};
      if(!s.profileIds.length||s.profileIds.length>100)throw Error('Chọn từ 1 đến 100 hồ sơ.');const profiles=await listProfiles();if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');if(s.profileIds.some(pid=>!profiles.some(p=>p.id===pid)))throw Error('Lịch có hồ sơ không được cấp quyền.');s.nextRunAt=nextSchedule(s);const at=data.schedules.findIndex(row=>row.id===s.id);if(at<0){if(data.schedules.length>=100)throw Error('Tối đa 100 lịch chạy.');data.schedules.push(s);}else{s.lastRunAt=data.schedules[at].lastRunAt;s.lastError=data.schedules[at].lastError;data.schedules[at]=s;}write(owner,data);emit();return s;},
    deleteSchedule(scheduleId){const owner=current().id,data=store(owner);data.schedules=data.schedules.filter(s=>s.id!==scheduleId);write(owner,data);emit();return true;},
    artifactPath(runId,file){const run=ownJob(runId);if(!run.artifacts?.some(a=>a.file===file)||!/^image_[a-f0-9-]{36}\.jpg$/.test(file))throw Error('Ảnh không thuộc tác vụ.');return path.join(directory(current().id),'artifacts',runId,file);},
    async shutdown(){closing=true;googleApi.abortPending();clearInterval(scheduleTimer);clearInterval(permissionTimer);for(const job of jobs.values())if(['queued','running','starting','stopping'].includes(job.status)){job.cancelled=true;job.abortController?.abort();if(job.status==='queued'){job.status='cancelled';job.finishedAt=new Date().toISOString();try{persistJob(job);}catch{}}}queue.length=0;await Promise.allSettled(Array.from(connections,b=>b.close()));},
  };
}
module.exports={createAutomationService,validateFlow,variables,TYPES};

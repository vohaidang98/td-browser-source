'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const VIDEO_EXTENSIONS = new Set(['.mp4','.mov','.m4v','.avi','.wmv','.mkv','.webm','.mpeg','.mpg','.3gp','.flv']);
const IMAGE_EXTENSIONS = ['.jpg','.jpeg','.png'];
const VISIBILITIES = {PRIVATE:'Riêng tư',UNLISTED:'Không công khai',PUBLIC:'Công khai'};
function visibility(value='PRIVATE') {
  const code=String(value).trim().toUpperCase();
  if(!Object.hasOwn(VISIBILITIES,code))throw Error('Chế độ hiển thị phải là PRIVATE (Riêng tư), UNLISTED (Không công khai) hoặc PUBLIC (Công khai).');
  return code;
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function channelId(value) {
  const text = String(value || '').trim();
  let result = text;
  if (text.startsWith('https://')) {
    const url = new URL(text);
    if (url.origin !== 'https://studio.youtube.com' || url.username || url.password) throw Error('Dán URL kênh từ YouTube Studio.');
    result = url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/)?.[1];
  }
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(result || '')) throw Error('Cần URL YouTube Studio có /channel/UC… hoặc mã kênh UC… (24 ký tự).');
  return result;
}
function title(value) {
  const result = String(value || '').trim();
  if (!result || Array.from(result).length > 100 || /[<>]/.test(result)) throw Error('Tiêu đề cần 1–100 ký tự, không chứa < hoặc >.');
  return result;
}
function uploadOrder(value='SEQUENTIAL'){const mode=String(value).trim().toUpperCase();if(!['SEQUENTIAL','PARALLEL'].includes(mode))throw Error('Thứ tự tải phải là SEQUENTIAL hoặc PARALLEL.');return mode;}
function config(vars) {
  if(vars.YOUTUBE_REUPLOAD!==undefined&&!['yes','no'].includes(vars.YOUTUBE_REUPLOAD))throw Error('Tùy chọn tải lại không hợp lệ.');
  const result = {folder:String(vars.YOUTUBE_FOLDER || ''), thumbnails:String(vars.YOUTUBE_THUMBNAILS || ''), channelId:channelId(vars.YOUTUBE_CHANNEL), audience:vars.YOUTUBE_AUDIENCE, visibility:visibility(vars.YOUTUBE_VISIBILITY), uploadOrder:uploadOrder(vars.YOUTUBE_UPLOAD_ORDER), reupload:vars.YOUTUBE_REUPLOAD==='yes', description:String(vars.YOUTUBE_DESCRIPTION || ''), timeoutMinutes:Number(vars.YOUTUBE_TIMEOUT_MINUTES || 60)};
  if(vars.YOUTUBE_FOLDERS!==undefined){
    try{result.folders=typeof vars.YOUTUBE_FOLDERS==='string'?JSON.parse(vars.YOUTUBE_FOLDERS):vars.YOUTUBE_FOLDERS;}catch{throw Error('Danh sách thư mục không hợp lệ.');}
    if(!Array.isArray(result.folders))throw Error('Danh sách thư mục không hợp lệ.');
  }else result.folders=result.folder?[result.folder]:[];
  if (!['yes','no'].includes(result.audience)) throw Error('Chọn rõ video có dành cho trẻ em hay không.');
  if (Array.from(result.description).length > 5000 || /[<>]/.test(result.description)) throw Error('Mô tả tối đa 5.000 ký tự, không chứa < hoặc >.');
  if (!Number.isInteger(result.timeoutMinutes) || result.timeoutMinutes < 5 || result.timeoutMinutes > 180) throw Error('Thời gian tối đa mỗi video từ 5 đến 180 phút.');
  if (vars.YOUTUBE_ITEMS) {
    try { result.items = JSON.parse(vars.YOUTUBE_ITEMS); } catch { throw Error('Danh sách video không hợp lệ.'); }
    if (!Array.isArray(result.items) || !result.items.length || result.items.length > 1000) throw Error('Chọn từ 1 đến 1.000 video vào hàng đợi; mỗi lượt tải tối đa 15 video.');
    const ids = new Set();
    result.items = result.items.map(item => {
      if (!item || !/^[a-f0-9]{64}$/.test(item.id || '') || ids.has(item.id)) throw Error('Video bị trùng hoặc không hợp lệ.');
      ids.add(item.id);
      const description = item.description===undefined?result.description:String(item.description);
      if(Array.from(description).length>5000||/[<>]/.test(description))throw Error('Mô tả video tối đa 5.000 ký tự, không chứa < >.');
      const row={id:item.id,title:title(item.title),description};
      if(item.thumbnailName!==undefined){
        const name=String(item.thumbnailName);
        if(name && (path.basename(name)!==name || /[\\/]/.test(name) || !IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase())))throw Error('Thumbnail phải là tên JPG/PNG trong thư mục ảnh, không kèm đường dẫn.');
        row.thumbnailName=name;
      }
      return row;
    });
  }
  return result;
}
function regularFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== path.resolve(file)) throw Error('Chỉ chọn tệp thường, không dùng liên kết: '+path.basename(file));
  return stat;
}
function scanFiles(folder, thumbnails = '') {
  const entries = fs.readdirSync(folder,{withFileTypes:true});
  const videos = entries.filter(e=>e.isFile() && VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'vi',{numeric:true,sensitivity:'base'}));
  if (videos.length > 1000) throw Error('Thư mục có hơn 1.000 video. Hãy chia thành các thư mục nhỏ hơn.');
  const pictures = new Map();
  if (thumbnails) for (const e of fs.readdirSync(thumbnails,{withFileTypes:true})) if (e.isFile() && IMAGE_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) {
    const stem = path.parse(e.name).name.toLowerCase();
    if (!pictures.has(stem)) pictures.set(stem, []); pictures.get(stem).push(e.name);
  }
  return videos.map(e=>{
    const file = path.join(folder,e.name), stat = regularFile(file);
    if (!stat.size) throw Error('Video rỗng: '+e.name);
    let thumbnail = '', warning = '';
    const candidates = pictures.get(path.parse(e.name).name.toLowerCase()) || [];
    if (candidates.length > 1) warning = 'Có nhiều ảnh cùng tên; chỉ giữ một JPG/PNG.';
    else if (candidates.length) {
      thumbnail = path.join(thumbnails,candidates[0]);
      if (regularFile(thumbnail).size >= 2*1024*1024) { thumbnail = ''; warning = 'Thumbnail cần nhỏ hơn 2 MB.'; }
    }
    const fingerprint = file+'\0'+stat.size+'\0'+stat.mtimeMs;
    const proposed = path.parse(e.name).name;
    return {id:hash(fingerprint), name:e.name, sourceFolder:folder, file, bytes:stat.size, mtimeMs:stat.mtimeMs, title:proposed, thumbnail, thumbnailName:thumbnail?path.basename(thumbnail):'', warning};
  });
}
function createYouTubeUploader({directory,current}) {
  const cache = new Map();
  function data(owner) {
    if (cache.has(owner)) return cache.get(owner);
    const file = path.join(directory(owner),'youtube-uploads.json');
    let value = {folders:[],uploads:{},attempts:{}};
    if (fs.existsSync(file)) {
      try { value = JSON.parse(fs.readFileSync(file,'utf8')); } catch { throw Error('Nhật ký tải YouTube bị lỗi. Giữ tệp youtube-uploads.json để khôi phục.'); }
      if (!Array.isArray(value.folders) || !value.uploads || typeof value.uploads !== 'object') throw Error('Nhật ký YouTube không hợp lệ.');
    }
    value.attempts||={};if(typeof value.attempts!=='object'||Array.isArray(value.attempts))throw Error('Nhật ký lượt tải không hợp lệ.');
    cache.set(owner,value);return value;
  }
  function write(owner) {
    const dir = directory(owner);fs.mkdirSync(dir,{recursive:true});
    const file = path.join(dir,'youtube-uploads.json'), temporary = file+'.'+crypto.randomUUID()+'.tmp';
    try {fs.writeFileSync(temporary,JSON.stringify(data(owner),null,2),{flag:'wx',encoding:'utf8'});fs.renameSync(temporary,file);}
    catch(error){try{fs.unlinkSync(temporary);}catch{}throw Error('Không lưu được nhật ký YouTube: '+error.code);}
  }
  function folder(value,owner) {
    if (!path.isAbsolute(value || '')) throw Error('Chọn thư mục bằng nút Chọn thư mục trong app.');
    const real = fs.realpathSync(value);
    if (!data(owner).folders.includes(real)) throw Error('Thư mục này chưa được chọn trên máy bằng nút Chọn thư mục.');
    if (!fs.statSync(real).isDirectory()) throw Error('Đường dẫn không phải thư mục.');
    return real;
  }
  function grantFolder(value,owner=current().id) {
    if (current().id!==owner) throw Error('Tài khoản đã thay đổi.');
    const real = fs.realpathSync(value);
    if (!fs.statSync(real).isDirectory()) throw Error('Chọn một thư mục.');
    const d=data(owner);
    if (!d.folders.includes(real)) {if(d.folders.length>=100)throw Error('Tối đa 100 thư mục được chọn mỗi tài khoản.');d.folders.push(real);write(owner);}
    return real;
  }
  const ledgerKey = (profileId,channel,videoId) => hash(profileId+'\0'+channel+'\0'+videoId);
  const uploadKey=(pid,channel,fileId,owner=current().id)=>data(owner).attempts[ledgerKey(pid,channel,fileId)]||fileId;
  const recordKey=(pid,channel,fileId,owner)=>ledgerKey(pid,channel,uploadKey(pid,channel,fileId,owner));
  function beginRepeat(pid,channel,fileId,owner=current().id){if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');const d=data(owner),base=ledgerKey(pid,channel,fileId),old=d.attempts[base];if(d.uploads[recordKey(pid,channel,fileId,owner)]?.status!=='uploaded')throw Error('Chỉ tải lại video đã hoàn tất; tiếp tục phiên đang dở trước.');const nonce=crypto.randomBytes(32).toString('hex');d.attempts[base]=nonce;try{write(owner);}catch(e){if(old)d.attempts[base]=old;else delete d.attempts[base];throw e;}return nonce;}
  function folders(values,owner){
    if(!Array.isArray(values)||!values.length||values.length>100||values.some(v=>typeof v!=='string'))throw Error('Chọn từ 1 đến 100 thư mục video.');
    const seen=new Set();return values.map(v=>folder(v,owner)).filter(v=>{const key=process.platform==='win32'?v.toLowerCase():v;if(seen.has(key))return false;seen.add(key);return true;});
  }
  function scanFolders(values,thumbnails=''){
    const rows=values.flatMap(value=>scanFiles(value,thumbnails));
    if(rows.length>1000)throw Error('Danh sách có hơn 1.000 video. Gỡ bớt thư mục rồi tải từng đợt.');
    return rows;
  }
  function scan(input,owner=current().id) {
    const list=folders(input.folders===undefined?[String(input.folder||'')]:input.folders,owner), thumbs=input.thumbnails?folder(String(input.thumbnails),owner):'';
    const channel=input.channel?channelId(input.channel):'', records=data(owner).uploads;
    return scanFolders(list,thumbs).map(row=>{
      const record=channel&&input.profileId?records[recordKey(input.profileId,channel,row.id,owner)]:null;
      const {file,thumbnail,mtimeMs,...publicRow}=row;
      return {...publicRow,status:record?.status||'ready',url:record?.url||'',uploadedAt:record?.at||'',requestedVisibility:record?.requestedVisibility||record?.visibility||''};
    });
  }
  function plan(vars,profileId,owner=current().id,{allowApiResume=false}={}) {
    const settings=config(vars);
    settings.folders=folders(settings.folders,owner);settings.folder=settings.folders[0];settings.thumbnails=settings.thumbnails?folder(settings.thumbnails,owner):'';
    const files=scanFolders(settings.folders,settings.thumbnails), records=data(owner).uploads;
    const available=files.filter(file=>{const record=records[recordKey(profileId,settings.channelId,file.id,owner)];return !record||(allowApiResume&&record.status==='api-paused')||(settings.reupload&&record.status==='uploaded');});
    const selected=settings.items?settings.items.map(item=>{
      const file=files.find(row=>row.id===item.id);
      if(!file)throw Error('Video đã thay đổi hoặc bị xóa. Quét lại thư mục trước khi chạy.');
      if(records[recordKey(profileId,settings.channelId,file.id,owner)] && !(allowApiResume&&records[recordKey(profileId,settings.channelId,file.id,owner)].status==='api-paused')&&!(settings.reupload&&records[recordKey(profileId,settings.channelId,file.id,owner)].status==='uploaded'))throw Error('Video đã được tải hoặc có lần tải cần kiểm tra: '+file.name);
      const chosen={...file,title:item.title,description:item.description};
      if(item.thumbnailName!==undefined){
        chosen.thumbnail='';chosen.thumbnailName='';chosen.warning='';
        if(item.thumbnailName){
          if(!settings.thumbnails)throw Error('Chọn thư mục ảnh khi bảng có tên thumbnail.');
          chosen.thumbnail=path.join(settings.thumbnails,item.thumbnailName);
          if(regularFile(chosen.thumbnail).size>=2*1024*1024)throw Error('Thumbnail cần nhỏ hơn 2 MB: '+item.thumbnailName);
          chosen.thumbnailName=item.thumbnailName;
        }
      }
      return chosen;
    }):available.map(file=>({...file,title:title(file.title)}));
    if(!selected.length)throw Error('Không còn video mới để tải. Kiểm tra nhật ký hoặc chọn thư mục khác.');
    for(const file of selected){title(file.title);if(file.warning)throw Error(file.name+': '+file.warning);}
    return {settings,files:selected};
  }
  async function upload(){throw Error('TD Browser 1.3.7 chỉ tải YouTube bằng Google API.');}
  return {grantFolder,scan,plan,upload,uploadKey,beginRepeat,
    getRecord:(pid,channel,fileId,owner=current().id)=>data(owner).uploads[recordKey(pid,channel,fileId,owner)]||null,
    setRecord(pid,channel,fileId,record,owner=current().id){if(current().id!==owner)throw Error('Tài khoản đã thay đổi.');data(owner).uploads[recordKey(pid,channel,fileId,owner)]=record;write(owner);}
  };
}
module.exports={createYouTubeUploader,scanFiles,config,channelId,title,visibility,uploadOrder,VISIBILITIES,VIDEO_EXTENSIONS};

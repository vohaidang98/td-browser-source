'use strict';
const crypto=require('crypto');
const {parseProxy,proxyKey}=require('./proxy-network');
function parseProxyLine(value,protocol='http'){
  const text=String(value||'').replace(/^\s+/,'');if(!text.trim())throw Error('Dòng proxy trống.');
  // URL credentials are percent encoded; the common provider form keeps password colons intact.
  let input;
  const match=text.match(/^(?:(http|https|socks5|socks5h):\/\/)?(\[[^\]]+\]|[^:\s/]+):(\d+)(?::([^:]*):(.*))?$/i);
  if(match)input={protocol:match[1]||protocol,ip:match[2],port:match[3],user:match[4]||'',pass:match[5]||''};
  else if(text.includes('@')||text.includes('://'))input={ip:text.includes('://')?text:protocol+'://'+text};
  else throw Error('Dùng host:port, host:port:user:pass hoặc URL proxy.');
  return parseProxy(input);
}
function normalizeTags(value){
  const tags=Array.isArray(value)?value:String(value||'').split(',');
  if(tags.length>10)throw Error('Tối đa 10 thẻ.');
  const result=[];for(const item of tags){const tag=String(item).trim();if(!tag)continue;if(tag.length>40||/[\r\n\0]/.test(tag))throw Error('Mỗi thẻ tối đa 40 ký tự.');if(!result.some(t=>t.toLocaleLowerCase()===tag.toLocaleLowerCase()))result.push(tag);}return result;
}
const canAccessProxy=(row,account)=>!!account?.id&&(!row.localAccountId||row.localAccountId===account.id||account.role==='admin');
function createProxyLibrary({read,write,getAccount,network,notify=()=>{}}){
  const batches=new Map();
  function owner(){const account=getAccount();if(!account?.id||account.status==='disabled')throw Error('Đăng nhập tài khoản để quản lý proxy.');return account.id;}
  function persist(rows){if(!write(rows))throw Error('Không lưu được kho proxy.');}
  function preview({text,protocol='http',tags=[]}={}){
    owner();if(typeof text!=='string'||text.length>1000000)throw Error('Danh sách proxy không hợp lệ hoặc vượt 1 MB.');
    const lines=text.split(/\r?\n/).map((text,i)=>({text,line:i+1})).filter(r=>r.text.trim());
    if(!lines.length||lines.length>200)throw Error('Nhập từ 1 đến 200 proxy mỗi lần.');
    const checkedTags=normalizeTags(tags),seen=new Set(),rows=[],errors=[];
    for(const row of lines)try{const p=parseProxyLine(row.text,protocol),key=proxyKey({ip:p.host,...p});if(seen.has(key))continue;seen.add(key);rows.push({ip:p.host,port:p.port,user:p.user,pass:p.pass,protocol:p.protocol,tags:checkedTags});}catch(error){errors.push({line:row.line,error:error.message});}
    return{rows,errors,duplicates:lines.length-rows.length-errors.length};
  }
  function importMany(input){
    const ownerId=owner(),parsed=preview(input);if(parsed.errors.length)throw Error('Còn '+parsed.errors.length+' dòng sai. Sửa danh sách trước khi nhập.');
    const rows=read(),keys=new Set();for(const row of rows.filter(p=>canAccessProxy(p,getAccount())))try{keys.add(proxyKey(row));}catch{}
    let added=0;for(const p of parsed.rows){const key=proxyKey(p);if(keys.has(key))continue;keys.add(key);rows.push({...p,id:'PRX_'+crypto.randomUUID(),title:'Proxy ('+p.ip+')',localAccountId:ownerId,country:'',timezone:'',createdAt:new Date().toISOString().split('T')[0]});added++;}
    if(added)persist(rows);return{added,duplicates:parsed.rows.length-added+parsed.duplicates};
  }
  function setTags({ids,tags}){owner();if(!Array.isArray(ids)||!ids.length||ids.length>200)throw Error('Chọn từ 1 đến 200 proxy.');const checked=normalizeTags(tags),rows=read();if(ids.some(id=>!rows.some(p=>p.id===id&&canAccessProxy(p,getAccount()))))throw Error('Không có quyền sửa proxy đã chọn.');let changed=0;for(const row of rows)if(ids.includes(row.id)){row.tags=checked;changed++;}persist(rows);return{changed};}
  async function checkMany({ids,batchId}={}){
    const ownerId=owner();if(!Array.isArray(ids)||!ids.length||ids.length>100||typeof batchId!=='string'||batchId.length>100)throw Error('Chọn từ 1 đến 100 proxy để kiểm tra.');
    if(batches.has(batchId)||Array.from(batches.values()).some(b=>b.ownerId===ownerId))throw Error('Đợi hoặc dừng lượt kiểm tra hiện tại.');
    const selected=[...new Set(ids)].map(id=>read().find(p=>p.id===id&&canAccessProxy(p,getAccount())));if(selected.some(p=>!p))throw Error('Không có quyền truy cập hoặc proxy không còn trong thư viện.');
    const batch={ownerId,cancelled:false};batches.set(batchId,batch);let cursor=0,completed=0;const results=[];
    const current=()=>getAccount()?.id===ownerId&&getAccount()?.status!=='disabled';
    const progress=()=>notify({batchId,completed,total:selected.length,cancelled:batch.cancelled});
    try{
      progress();const workers=await Promise.allSettled(Array.from({length:Math.min(4,selected.length)},async()=>{
        try{
        while(!batch.cancelled&&current()&&cursor<selected.length){
          const row=selected[cursor++];let key;try{key=proxyKey(row);}catch{}
          const result=await network.check(row,{force:true});if(!current()){batch.cancelled=true;break;}
          const rows=read(),target=rows.find(p=>p.id===row.id);let unchanged=false;try{unchanged=!!target&&key===proxyKey(target);}catch{}
          if(unchanged){target.lastCheck=result;if(result.success){target.country=result.country||'';target.timezone=result.timezone||'';}persist(rows);}
          results.push({id:row.id,result,applied:unchanged});completed++;progress();
        }
        }catch(error){batch.cancelled=true;throw error;}
      }));
      const failure=workers.find(result=>result.status==='rejected');if(failure)throw failure.reason;
      if(!current())throw Error('Tài khoản đã thay đổi.');return{batchId,completed,total:selected.length,cancelled:batch.cancelled,results};
    }finally{batches.delete(batchId);}
  }
  function cancel(batchId){const batch=batches.get(batchId);if(batch?.ownerId!==owner())return false;batch.cancelled=true;return true;}
  return{preview,importMany,setTags,checkMany,cancel,shutdown(){for(const b of batches.values())b.cancelled=true;}};
}
module.exports={parseProxyLine,normalizeTags,canAccessProxy,createProxyLibrary};

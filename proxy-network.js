'use strict';
const net=require('net'),crypto=require('crypto'),https=require('https');
const axios=require('axios');
const {HttpsProxyAgent}=require('https-proxy-agent');
const {Server}=require('proxy-chain');
const SUPPORTED=new Set(['http','https','socks5']);
const validTimezone=value=>{if(typeof value!=='string'||!value)return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}};
function parseProxy(input={}){
  if(!input||typeof input!=='object')throw Error('Cấu hình proxy không hợp lệ.');
  let host=String(input.ip??input.proxyIp??'').trim(),port=String(input.port??input.proxyPort??'').trim();
  let user=String(input.user??input.proxyUser??''),pass=String(input.pass??input.proxyPass??'');
  let protocol=String(input.protocol??input.proxyType??'http').toLowerCase().replace(/:$/,'');
  if(!host&&!port&&!user&&!pass)return null;
  if(!host)throw Error('Nhập địa chỉ máy chủ proxy.');
  if(host.includes('://')){
    let url;try{url=new URL(host);}catch{throw Error('URL proxy không hợp lệ.');}
    if(url.pathname!=='/'&&url.pathname!==''||url.search||url.hash)throw Error('URL proxy không được chứa đường dẫn hoặc tham số.');
    protocol=url.protocol.slice(0,-1).toLowerCase();
    const urlPort=url.port||(protocol==='https'?'443':protocol==='http'?'80':'1080');
    if(port&&port!==urlPort)throw Error('Cổng nhập riêng khác với cổng trong URL proxy.');
    port=port||urlPort;host=url.hostname;
    try{if(url.username)user=decodeURIComponent(url.username);if(url.password)pass=decodeURIComponent(url.password);}catch{throw Error('Tài khoản trong URL proxy không hợp lệ.');}
  }
  if(protocol==='socks'||protocol==='socks5h')protocol='socks5';
  if(!SUPPORTED.has(protocol))throw Error('Chọn HTTP, HTTPS hoặc SOCKS5.');
  host=host.replace(/^\[|\]$/g,'').toLowerCase();
  if(!net.isIP(host)&&(!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)||host.includes('..')))throw Error('Host proxy cần là IPv4, IPv6 hoặc tên miền hợp lệ.');
  if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('Cổng proxy phải từ 1 đến 65535.');
  if(user.length>2048||pass.length>2048||/[\r\n\0]/.test(user+pass))throw Error('Tài khoản proxy không hợp lệ.');
  if(pass&&!user)throw Error('Proxy có mật khẩu cần tên tài khoản.');
  return {host,port:String(Number(port)),user,pass,protocol};
}
function proxyKey(input={}){const p=parseProxy(input);return p?crypto.createHash('sha256').update(JSON.stringify([p.protocol,p.host,p.port,p.user,p.pass])).digest('hex'):'direct';}
function proxyUrl(input){const p=input?.host?input:parseProxy(input);if(!p)return null;const host=net.isIP(p.host)===6?'['+p.host+']':p.host;const credentials=p.user||p.pass?encodeURIComponent(p.user)+':'+encodeURIComponent(p.pass)+'@':'';return `${p.protocol}://${credentials}${host}:${p.port}`;}
function profileProxyFields(input){const p=parseProxy(input);return p?{proxyIp:p.host,proxyPort:p.port,proxyUser:p.user,proxyPass:p.pass,proxyType:p.protocol}:{proxyIp:'',proxyPort:'',proxyUser:'',proxyPass:'',proxyType:'http'};}
function explainProxyError(error){
  const status=Number(error.response?.status||error.statusCode),statusText=String(error.response?.statusText||'');
  const upstreamCode=/^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ERR_TLS_CERT_ALTNAME_INVALID|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(statusText)?statusText:null;
  const code=upstreamCode||String(error.code||'');
  // Raw URLs/provider errors can contain credentials; return only fixed diagnostic text.
  if([407,597].includes(status)||/UPSTREAM(401|403|407)/.test(statusText)||/authentication|credentials|socks.*auth|status code 407/i.test(error.message||''))return {code:'PROXY_AUTH',error:'Proxy từ chối tài khoản hoặc mật khẩu. Kiểm tra thông tin đăng nhập và IP được nhà cung cấp cho phép.'};
  if(status===593||code==='ENOTFOUND'||code==='EAI_AGAIN')return {code:'PROXY_DNS',error:'Không phân giải được máy chủ proxy. Kiểm tra Host và DNS mạng.'};
  if(status===504||['ECONNABORTED','ETIMEDOUT','ERR_CANCELED'].includes(code))return {code:'PROXY_TIMEOUT',error:'Proxy hoặc dịch vụ kiểm tra phản hồi quá chậm.'};
  if(['ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code))return {code:'PROXY_TLS',error:'Chứng chỉ TLS không hợp lệ. Kiểm tra proxy HTTPS và giờ hệ thống.'};
  if(status===429)return {code:'CHECK_RATE_LIMIT',error:'Dịch vụ kiểm tra IP đang giới hạn lượt gọi. Thử lại sau.'};
  if(status===594||code==='ECONNREFUSED')return {code:'PROXY_REFUSED',error:'Máy chủ từ chối kết nối. Kiểm tra Host, cổng hoặc proxy đã hết hạn.'};
  return {code:'PROXY_CONNECTION',error:'Không kết nối được qua proxy. Kiểm tra giao thức, tài khoản, cổng và trạng thái dịch vụ.'};
}
function createProxyNetwork(options={}){
  const geoUrl=options.geoUrl||'https://ipwho.is/',ipUrl=options.ipUrl||'https://api.ipify.org?format=json';
  const timeout=Math.max(300,Math.min(15000,options.timeout||7000));
  const queue=[],pending=new Map(),cache=new Map(),bridges=new Set();let active=0,closing=false;
  async function open(input){
    if(closing)throw Error('Ứng dụng đang đóng.');
    const p=parseProxy(input);if(!p)return null;
    // Always bridge every protocol on loopback. Chrome and the checker use this same route.
    const upstream=proxyUrl(p);
    // CONNECT's Host header names the destination, while TLS must authenticate the proxy gateway.
    const upstreamAgent=p.protocol==='https'?new https.Agent({servername:net.isIP(p.host)?'':p.host,keepAlive:false}):undefined;
    const server=new Server({host:'127.0.0.1',port:0,verbose:false,prepareRequestFunction:()=>({requestAuthentication:false,upstreamProxyUrl:upstream,httpsAgent:upstreamAgent})});
    server.on('requestFailed',()=>{});
    try{await server.listen();if(closing){await server.close(true);throw Error('Ứng dụng đang đóng.');}}catch(error){upstreamAgent?.destroy();throw error;}let closed=false;
    const bridge={url:'http://127.0.0.1:'+server.port,proxy:p,async close(){if(closed)return;closed=true;bridges.delete(bridge);upstreamAgent?.destroy();let timer;try{await Promise.race([server.close(true),new Promise((_,reject)=>{timer=setTimeout(()=>{server.closeConnections();server.server?.closeAllConnections?.();reject(Error('Đã dừng kết nối proxy quá hạn.'));},5000);})]);}finally{clearTimeout(timer);}}};
    bridges.add(bridge);return bridge;
  }
  async function observe(bridge){
    const begin=Date.now(),agent=bridge?new HttpsProxyAgent(bridge.url,{keepAlive:false}):null;
    const request=async url=>(await axios.get(url,{proxy:false,httpAgent:agent||undefined,httpsAgent:agent||undefined,timeout,maxRedirects:0,maxContentLength:65536,headers:{Accept:'application/json'},validateStatus:status=>status>=200&&status<300})).data;
    try{
      let data,firstError;
      try{data=await request(geoUrl);if(data?.success===false||!net.isIP(String(data?.ip||'')))throw Error('IP response invalid');}catch(error){firstError=error;}
      if(!data||data.success===false||!net.isIP(String(data.ip||''))){
        let ipData;try{ipData=await request(ipUrl);}catch(error){throw firstError||error;}
        const ip=String(ipData?.ip||'');if(!net.isIP(ip))throw Error('IP response invalid');
        data={ip}; // Connectivity is confirmed even if geolocation is unavailable.
      }
      return {success:true,ip:data.ip,country:/^[A-Z]{2}$/.test(data.country_code||'')?data.country_code:'',timezone:validTimezone(data.timezone?.id)?data.timezone.id:'',isp:typeof data.connection?.isp==='string'?data.connection.isp.slice(0,120):'',location:[data.country_code,data.region].filter(Boolean).join(' / '),ping:Date.now()-begin,checkedAt:new Date().toISOString(),gateway:bridge?bridge.proxy.host+':'+bridge.proxy.port:null,protocol:bridge?.proxy.protocol||'direct',warning:validTimezone(data.timezone?.id)?'':'Đã xác định IP thoát nhưng chưa lấy được vị trí/múi giờ.'};
    }finally{agent?.destroy();}
  }
  function drain(){while(active<4&&queue.length){const item=queue.shift();active++;Promise.resolve().then(item.work).then(item.resolve,item.reject).finally(()=>{active--;drain();});}}
  const enqueue=work=>new Promise((resolve,reject)=>{if(queue.length>=200)return reject(Error('Đang kiểm tra quá nhiều proxy. Đợi lượt trước hoàn tất.'));queue.push({work,resolve,reject});drain();});
  async function check(input={},settings={}){
    if(closing)return {success:false,code:'APP_CLOSING',error:'Ứng dụng đang đóng.'};
    let key;try{key=proxyKey(input);}catch(error){return {success:false,code:'PROXY_CONFIG',error:error.message};}
    const samples=settings.samples===2?2:1,workKey=key+':'+samples,cached=cache.get(key);
    if(!settings.force&&samples===1&&cached&&Date.now()-cached.time<120000)return {...cached.result,cached:true};
    if(pending.has(workKey))return pending.get(workKey);
    const job=enqueue(async()=>{
      let bridge;
      try{bridge=await open(input);const observed=[];for(let i=0;i<samples;i++)observed.push(await observe(bridge));const last=observed.at(-1),ips=observed.map(r=>r.ip);const result={...last,observedIps:ips,rotationDetected:new Set(ips).size>1,previousIp:cached?.result.ip||null,ipChanged:!!cached?.result.ip&&cached.result.ip!==last.ip};if(result.rotationDetected)result.warning='IP thay đổi giữa hai lần kiểm tra. Proxy có thể xoay theo kết nối; app không thể cố định IP nếu nhà cung cấp không hỗ trợ phiên sticky.';else if(result.ipChanged)result.warning='IP thoát đã thay đổi so với lần kiểm tra trước. Kiểm tra chế độ xoay/sticky của nhà cung cấp.';cache.set(key,{time:Date.now(),result});if(cache.size>256)cache.delete(cache.keys().next().value);return result;}
      catch(error){return {success:false,...explainProxyError(error),checkedAt:new Date().toISOString()};}
      finally{await bridge?.close().catch(()=>{});}
    }).finally(()=>pending.delete(workKey));pending.set(workKey,job);return job;
  }
  return {open,observe,check,async shutdown(){closing=true;for(const item of queue.splice(0))item.reject(Error('Ứng dụng đang đóng.'));await Promise.allSettled(Array.from(bridges,b=>b.close()));}};
}
module.exports={parseProxy,proxyKey,proxyUrl,profileProxyFields,validTimezone,explainProxyError,createProxyNetwork};

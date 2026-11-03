'use strict';
(() => {
  const esc=escapeHtml;let lastCheck=null;
  const modal=document.getElementById('modal-proxy');
  const protocolRow=prefix=>`<div class="form-row"><label class="form-label" for="${prefix}-protocol" style="width:90px">Giao thức</label><div class="form-input-wrap"><select id="${prefix}-protocol" class="input-box"><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></div></div>`;
  document.getElementById('px-ip').closest('.form-row').insertAdjacentHTML('beforebegin',protocolRow('px'));
  document.getElementById('create-ip').closest('.form-row').insertAdjacentHTML('beforebegin',protocolRow('create'));
  document.getElementById('px-pass').closest('.form-row').insertAdjacentHTML('afterend',`<div class="form-row"><label class="form-label" for="px-timezone-mode" style="width:90px">Múi giờ</label><div class="form-input-wrap" style="flex-wrap:wrap"><select id="px-timezone-mode" class="input-box"><option value="auto">Tự lấy theo IP thoát khi mở hồ sơ</option><option value="manual">Chọn thủ công</option></select><input id="px-timezone" class="input-box" placeholder="Ví dụ: Asia/Ho_Chi_Minh" aria-label="Múi giờ thủ công" hidden></div></div><p style="color:var(--text-muted);font-size:11px;line-height:1.7;margin:8px 0">Host/cổng là máy chủ kết nối. IP thoát là địa chỉ website nhìn thấy. Với proxy xoay, IP có thể thay đổi theo kết nối; muốn giữ IP cần phiên sticky từ nhà cung cấp.</p>`);
  const rotate=document.createElement('button');rotate.type='button';rotate.className='btn-test';rotate.id='px-check-rotation';rotate.textContent='Kiểm tra IP xoay';rotate.style.marginTop='10px';rotate.onclick=()=>runCheckProxy(2);document.getElementById('px-result').before(rotate);
  const direct=document.createElement('button');direct.type='button';direct.className='btn-test';direct.textContent='Dùng mạng trực tiếp';direct.style.margin='10px 0 0 8px';direct.onclick=()=>{for(const name of ['ip','port','user','pass']){const el=document.getElementById('px-'+name);el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));}document.getElementById('px-timezone-mode').value='auto';timezoneUI();lastCheck=null;workspaceToast('Đã bỏ cấu hình proxy. Bấm Lưu cấu hình để áp dụng.');};rotate.after(direct);
  function fields(prefix){return {ip:document.getElementById(prefix+'-ip').value.trim(),port:document.getElementById(prefix+'-port').value.trim(),user:document.getElementById(prefix+'-user').value,pass:document.getElementById(prefix+'-pass').value,protocol:document.getElementById(prefix+'-protocol').value};}
  function timezoneUI(){document.getElementById('px-timezone').hidden=document.getElementById('px-timezone-mode').value!=='manual';}
  document.getElementById('px-timezone-mode').onchange=timezoneUI;
  document.getElementById('px-protocol').onchange=()=>{workspaceProxyCheck++;lastCheck=null;delete modal.dataset.country;document.getElementById('px-result').style.display='none';};
  const previousOpen=openProxyEditModal;
  openProxyEditModal=function(id){delete modal.dataset.libraryId;previousOpen(id);lastCheck=null;const p=profilesList.find(p=>p.id===id);document.getElementById('px-protocol').value=p?.proxyType||'http';document.getElementById('px-timezone-mode').value=p?.proxyTimezoneMode==='manual'?'manual':'auto';document.getElementById('px-timezone').value=p?.proxyTimezone||'';timezoneUI();};
  const previousCreate=openCreateProfileModal;
  openCreateProfileModal=async function(){document.getElementById('create-protocol').value='http';return previousCreate();};
  // Reuse the existing paste interaction, with protocol and IPv6 support.
  parseWorkspaceProxy=function(value){
    const text=String(value||'').replace(/^\s+/,'');if(!text.trim())return null;
    const legacy=text.match(/^(?:(http|https|socks5|socks5h):\/\/)?(\[[^\]]+\]|[^:\s/]+):(\d+)(?::([^:]*):(.*))?$/i);
    if(legacy){const port=Number(legacy[3]);if(port<1||port>65535)return null;return{host:legacy[2].replace(/^\[|\]$/g,''),port:String(port),user:legacy[4]||'',pass:legacy[5]||'',protocol:(legacy[1]||'http').toLowerCase().replace('socks5h','socks5')};}
    let url;
    try{if(text.includes('://')||text.includes('@')||text.startsWith('['))url=new URL(text.includes('://')?text:'http://'+text);else{const parts=text.split(':');if(parts.length!==2&&parts.length<4)return null;const [host,port,user='',...password]=parts;url=new URL('http://'+(user?encodeURIComponent(user)+':'+encodeURIComponent(password.join(':'))+'@':'')+host+':'+port);}
      let protocol=url.protocol.slice(0,-1);if(protocol==='socks'||protocol==='socks5h')protocol='socks5';if(!['http','https','socks5'].includes(protocol)||url.pathname&&url.pathname!=='/'||url.search||url.hash)return null;
      const port=url.port||(protocol==='https'?'443':protocol==='http'?'80':'1080');if(Number(port)<1||Number(port)>65535)return null;
      return {host:url.hostname.replace(/^\[|\]$/g,''),port,user:decodeURIComponent(url.username),pass:decodeURIComponent(url.password),protocol};
    }catch{return null;}
  };
  for(const prefix of ['px','create'])document.getElementById(prefix+'-ip').addEventListener('paste',event=>{const parsed=parseWorkspaceProxy(event.clipboardData?.getData('text'));if(!parsed)return;event.preventDefault();event.stopImmediatePropagation();for(const [name,value]of Object.entries({ip:parsed.host,port:parsed.port,user:parsed.user,pass:parsed.pass,protocol:parsed.protocol})){const el=document.getElementById(prefix+'-'+name);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}workspaceToast('Đã tách giao thức, host và tài khoản proxy.');},true);
  workspaceProxyKey=proxy=>JSON.stringify([proxy.protocol||proxy.proxyType||'http',proxy.ip||'',String(proxy.port||''),proxy.user||'',proxy.pass||'']);
  runCheckProxy=async function(samples=1){
    if(!validateWorkspaceProxy('px',false))return;
    const generation=++workspaceProxyCheck,proxy=fields('px'),key=workspaceProxyKey(proxy),box=document.getElementById('px-result'),buttons=[modal.querySelector('[onclick="runCheckProxy()"]'),rotate];
    buttons.forEach(b=>b.disabled=true);box.style.display='block';box.textContent=samples===2?'Đang kiểm tra hai kết nối để nhận biết IP xoay…':'Đang kiểm tra IP thoát qua proxy…';lastCheck=null;
    try{const result=await window.api.checkProxy(proxy,{force:true,samples});if(generation!==workspaceProxyCheck||modal.style.display==='none')return;if(!result?.success)throw Error(result?.error||'Không kết nối được proxy.');lastCheck={key,result};modal.dataset.country=result.country||'';box.innerHTML=`<strong style="color:var(--success)">Đã kết nối qua proxy</strong><br>Máy chủ: ${esc(result.gateway||proxy.ip+':'+proxy.port)}<br>IP thoát: <strong>${esc(result.ip)}</strong><br>Độ trễ: ${esc(result.ping)} ms${result.timezone?'<br>Múi giờ IP thoát: '+esc(result.timezone):''}${result.isp?'<br>ISP: '+esc(result.isp):''}${result.observedIps?.length===2?'<br>Hai lần kiểm tra: '+result.observedIps.map(esc).join(' → '):''}${result.warning?'<p style="color:var(--warning);margin-top:8px">'+esc(result.warning)+'</p>':''}`;
    }catch(error){if(generation===workspaceProxyCheck){box.textContent=readableAppError(error);box.style.display='block';}}
    finally{buttons.forEach(b=>b.disabled=false);}
  };
  saveProxyModal=workspaceGuardAction('modal-proxy',async()=>{
    const p=fields('px'),profileId=document.getElementById('px-profile-id').value,mode=document.getElementById('px-timezone-mode').value,manual=document.getElementById('px-timezone').value.trim();
    if(mode==='manual'){try{new Intl.DateTimeFormat('en',{timeZone:manual});if(!manual)throw Error();}catch{throw Error('Nhập múi giờ hợp lệ, ví dụ Asia/Ho_Chi_Minh.');}}
    const result=lastCheck?.key===workspaceProxyKey(p)?lastCheck.result:null;
    const update={proxyIp:p.ip,proxyPort:p.port,proxyUser:p.user,proxyPass:p.pass,proxyType:p.protocol,proxyTimezoneMode:mode,proxyTimezone:mode==='manual'?manual:result?.timezone||'',proxyCountry:result?.country||'',proxyLastCheck:result||null};
    if(profileId&&!await window.api.updateProfile(profileId,update))throw Error('Không lưu được hồ sơ.');
    if(p.ip&&p.port&&!await window.api.saveProxy({...p,...(modal.dataset.libraryId?{id:modal.dataset.libraryId}:{}),title:'Proxy ('+p.ip+')',country:update.proxyCountry,timezone:update.proxyTimezone}))throw Error('Không lưu được proxy vào kho.');
    workspaceProxyCache.clear();closeModals();profilesList=await window.api.getProfiles()||[];await loadProfilesTable();await loadProxiesTable();workspaceToast('Đã lưu cấu hình proxy.');
  },()=>validateWorkspaceProxy('px'));
  autoPingProfiles=async function(profiles){
    const route=p=>({ip:p.proxyIp||'',port:p.proxyPort||'',user:p.proxyUser||'',pass:p.proxyPass||'',protocol:p.proxyType||'http'});
    const grouped=new Map();for(const p of profiles){const proxy=route(p),key=workspaceProxyKey(proxy);if(!grouped.has(key))grouped.set(key,{proxy,ids:[]});grouped.get(key).ids.push(p.id);}
    await Promise.all(Array.from(grouped,async([key,{proxy,ids}])=>{const result=await safeCheckProxy(proxy);for(const id of ids){const p=profilesList.find(p=>p.id===id);if(p&&workspaceProxyKey(route(p))===key)updatePingCells(id,result);}}));
  };
  window.api.onProxyNetworkEvent?.(({profileId,result,timezone})=>{const p=profilesList.find(p=>p.id===profileId);if(!p)return;p.proxyLastCheck=result;p.proxyTimezone=timezone;p.proxyCountry=result.country;const cell=document.querySelector('.tz-cell-'+profileId);if(cell){cell.innerHTML=`<span class="live-clock badge badge-gray" data-tz="${esc(timezone)}">${CLOCK_SVG}--:--</span>`;updateLiveClocks();}const row=Array.from(document.querySelectorAll('[data-profile-id]')).find(r=>r.dataset.profileId===profileId);if(row)row.title='IP thoát lúc mở: '+result.ip+' · '+timezone;});
  const previousPing=updatePingCells;
  updatePingCells=function(id,result){
    const p=profilesList.find(p=>p.id===id),copy={...result};
    if(p&&(runningProfiles.has(id)||p.proxyTimezoneMode==='manual'))copy.timezone=p.proxyTimezone||'';
    previousPing(id,copy);
    for(const cell of document.querySelectorAll('.ping-cell-'+id)){
      const badge=cell.querySelector('.badge');if(!badge||!result.success)continue;
      const latency=Number(result.ping)||0;badge.textContent=latency<=800?'Tốt':latency<=2000?'Khá':'Chậm';badge.className='badge '+(latency<=800?'badge-green':latency<=2000?'badge-orange':'badge-red');
      badge.title='Thời gian yêu cầu kiểm tra: '+latency+' ms\nIP kiểm tra: '+(result.ip||'Chưa rõ')+'\nMúi giờ IP kiểm tra: '+(result.timezone||'Chưa rõ')+(result.checkedAt?'\nKiểm tra lúc: '+new Date(result.checkedAt).toLocaleTimeString('vi-VN'):'')+(result.warning?'\n'+result.warning:'');
    }
  };
})();

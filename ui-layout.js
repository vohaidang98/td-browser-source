'use strict';

const pendingCloudOperations = new Set();
let accountDialogResolver = null;
let accountDialogPreviousFocus = null;
let shareRecipientDialog = null;

function requestShareRecipient(profileId,{onShare}={}) {
  if(shareRecipientDialog)shareRecipientDialog.finish(null);
  const accountId=currentAccount?.id,previousFocus=document.activeElement;
  if(!accountId)return Promise.resolve(null);
  const overlay=document.createElement('div');overlay.id='modal-share-recipient';overlay.className='modal-overlay';
  overlay.innerHTML=`<form class="modal-box share-recipient-dialog" role="dialog" aria-modal="true" aria-labelledby="share-recipient-title"><div class="modal-head"><span id="share-recipient-title">Chia sẻ hồ sơ</span><button type="button" class="btn-del" data-share-close aria-label="Đóng">✕</button></div><div class="modal-body"><p class="share-recipient-description">Chọn tài khoản nhận hồ sơ. Người nhận vào Hồ sơ Cloud để tải và sử dụng. Chủ sở hữu vẫn giữ nguyên; dữ liệu hồ sơ được đồng bộ chung.</p><label class="form-label" for="share-recipient-search">Tìm tài khoản trong TD Browser</label><input type="search" class="input-box" id="share-recipient-search" placeholder="Tìm theo email…" autocomplete="off" maxlength="254"><div id="share-recipient-status" class="share-recipient-status" role="status" aria-live="polite"></div><div id="share-recipient-list" class="share-recipient-list" role="radiogroup" aria-label="Tài khoản nhận hồ sơ"></div><div class="share-recipient-load"><button type="button" class="btn-test" id="share-recipient-more" hidden>Xem thêm tài khoản</button><button type="button" class="btn-test" id="share-recipient-retry" hidden>Thử lại</button></div><p id="share-recipient-error" class="share-recipient-error" role="alert"></p></div><div class="modal-foot"><span id="share-recipient-selected">Chưa chọn người nhận</span><button type="button" class="btn-test" data-share-close>Hủy</button><button type="submit" class="btn-blue" id="share-recipient-submit" disabled>Chia sẻ hồ sơ</button></div></form>`;
  document.body.appendChild(overlay);overlay.style.display='flex';
  return new Promise(resolve=>{
    let closed=false,request=0,timer,rows=[],hasMore=false,loading=false,sharing=false,chosen=null,query='';
    const search=overlay.querySelector('#share-recipient-search'),list=overlay.querySelector('#share-recipient-list'),status=overlay.querySelector('#share-recipient-status'),error=overlay.querySelector('#share-recipient-error'),submit=overlay.querySelector('#share-recipient-submit'),more=overlay.querySelector('#share-recipient-more'),retry=overlay.querySelector('#share-recipient-retry');
    const valid=()=>!closed&&currentAccount?.id===accountId&&currentAccount?.status==='active';
    const finish=value=>{if(closed)return;closed=true;request++;clearTimeout(timer);clearInterval(accountPoll);document.removeEventListener('keydown',keydown);overlay.remove();if(shareRecipientDialog?.finish===finish)shareRecipientDialog=null;if(previousFocus?.isConnected)previousFocus.focus();resolve(value);};
    const keydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!sharing)finish(null);}};
    const accountPoll=setInterval(()=>{if(!valid()||!overlay.isConnected||overlay.style.display==='none')finish(null);},1000);
    shareRecipientDialog={finish,get busy(){return sharing;}};document.addEventListener('keydown',keydown);
    function render(){
      list.innerHTML=rows.map(person=>{const unavailable=person.alreadyShared||!person.canReceive;return `<label class="share-recipient-row ${unavailable?'is-unavailable':''}"><input type="radio" name="share-recipient" value="${escapeHtml(person.userId)}" ${chosen?.userId===person.userId?'checked':''} ${unavailable||loading||sharing?'disabled':''}><span class="share-recipient-avatar" aria-hidden="true">${escapeHtml(person.email.slice(0,2).toUpperCase())}</span><span class="share-recipient-person"><strong title="${escapeHtml(person.email)}">${escapeHtml(person.email)}</strong><small>${person.alreadyShared?'Đã được chia sẻ hồ sơ này':!person.canReceive?'Chưa sẵn sàng nhận · cần xác nhận email và đăng nhập':'Có thể nhận hồ sơ'}</small></span>${person.alreadyShared?'<span class="badge badge-green">Đã chia sẻ</span>':''}</label>`;}).join('');
      submit.disabled=loading||sharing||!chosen;submit.textContent=sharing?'Đang đồng bộ và chia sẻ…':'Đồng bộ và chia sẻ';search.disabled=sharing;more.hidden=!hasMore;more.disabled=loading||sharing;retry.disabled=sharing;overlay.querySelectorAll('[data-share-close]').forEach(button=>button.disabled=sharing);overlay.querySelector('#share-recipient-selected').textContent=chosen?'Người nhận: '+chosen.email:'Chưa chọn người nhận';
    }
    async function load(append=false){
      if(!valid()){finish(null);return;}const token=++request,offset=append?rows.length:0,requestedQuery=query;loading=true;error.textContent='';retry.hidden=true;
      if(!append){rows=[];chosen=null;hasMore=false;}status.textContent='Đang tải tài khoản…';render();
      try{
        const result=await window.api.cloudShareRecipients({profileId,search:requestedQuery,offset});
        if(!valid()){finish(null);return;}if(token!==request||requestedQuery!==query)return;
        rows=append?[...rows,...result.users]:result.users;hasMore=!!result.hasMore;status.textContent=rows.length?`${rows.length} tài khoản${hasMore?' · còn thêm kết quả':''}`:'Không có tài khoản phù hợp. Tài khoản mới cần đăng ký trong TD Browser.';
      }catch(failure){if(valid()&&token===request){error.textContent=readableAppError(failure);status.textContent='Chưa tải được danh sách tài khoản.';retry.hidden=false;}}
      finally{if(valid()&&token===request){loading=false;render();}}
    }
    overlay.querySelector('form').onsubmit=async event=>{event.preventDefault();if(!valid()){finish(null);return;}if(loading||sharing||!chosen?.canReceive||chosen.alreadyShared)return;const email=chosen.email;if(!onShare){finish(email);return;}sharing=true;error.textContent='';status.textContent='Đang đồng bộ dữ liệu hồ sơ mới nhất lên Cloud, sau đó cấp quyền cho người nhận. Vui lòng chờ…';render();try{await onShare(email);sharing=false;finish(valid()?email:null);}catch(failure){if(valid()){sharing=false;error.textContent=readableAppError(failure);status.textContent='Chưa hoàn tất chia sẻ. Xử lý lỗi rồi thử lại.';render();}else{sharing=false;finish(null);}}};
    overlay.onclick=event=>{if(!sharing&&(event.target===overlay||event.target.closest('[data-share-close]')))finish(null);};
    list.onchange=event=>{if(loading||sharing||!valid())return;const person=rows.find(p=>p.userId===event.target.value);chosen=person?.canReceive&&!person.alreadyShared?person:null;render();list.querySelector('input:checked')?.focus();};
    search.oninput=()=>{clearTimeout(timer);query=search.value.trim();request++;chosen=null;rows=[];hasMore=false;loading=true;status.textContent='Đang tìm tài khoản…';error.textContent='';render();timer=setTimeout(()=>void load(),250);};
    more.onclick=()=>{if(!loading)void load(true);};retry.onclick=()=>void load();
    requestAnimationFrame(()=>search.focus());void load();
  });
}

function requestAccountInput({ title, label, value = '', type = 'text', optional = false, description = '', maxLength = 120 }) {
  if (accountDialogResolver) finishAccountInput(null);
  const overlay = document.getElementById('modal-account-input');
  document.getElementById('account-input-title').textContent = title;
  document.getElementById('account-input-label').textContent = label;
  const descriptionEl = document.getElementById('account-input-description');
  descriptionEl.textContent = description;
  descriptionEl.hidden = !description;
  const input = document.getElementById('account-input-value');
  input.type = type;
  input.value = value;
  input.required = !optional;
  input.autocomplete = type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'off';
  input.maxLength = type === 'text' ? maxLength : 512;
  accountDialogPreviousFocus = document.activeElement;
  overlay.style.display = 'flex';
  return new Promise(resolve => {
    accountDialogResolver = resolve;
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}

function finishAccountInput(value) {
  const resolve = accountDialogResolver;
  if (!resolve) return;
  accountDialogResolver = null;
  const input = document.getElementById('account-input-value');
  input.value = '';
  document.getElementById('modal-account-input').style.display = 'none';
  accountDialogPreviousFocus?.focus();
  resolve(value);
}

function submitAccountInput(event) {
  event.preventDefault();
  const input = document.getElementById('account-input-value');
  if (!input.reportValidity()) return;
  finishAccountInput(input.type === 'password' ? input.value : input.value.trim());
}

function setCloudOperationBusy(profileId, busy) {
  if (busy) pendingCloudOperations.add(profileId); else pendingCloudOperations.delete(profileId);
  document.querySelectorAll('[data-cloud-sync]').forEach(button => {
    if (button.dataset.cloudSync !== profileId) return;
    button.disabled = busy;
    button.textContent = busy ? '…' : '☁';
    button.setAttribute('aria-busy', String(busy));
  });
  document.getElementById('cloud-operation-status').hidden = pendingCloudOperations.size === 0;
}

document.addEventListener('keydown', event => {
  if (!accountDialogResolver) return;
  if (event.key === 'Escape') { event.preventDefault(); finishAccountInput(null); }
  if (event.key === 'Tab') {
    const elements = Array.from(document.querySelectorAll('#modal-account-input button, #modal-account-input input'));
    const first = elements[0]; const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

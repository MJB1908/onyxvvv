// ONYX — minimal popup: ERP status, ONYX status, Get Data, Open ONYX
const erpDot=document.getElementById('erpDot'),erpSub=document.getElementById('erpSub');
const onyxDot=document.getElementById('onyxDot'),onyxSub=document.getElementById('onyxSub');
const getBtn=document.getElementById('getDataBtn'),openBtn=document.getElementById('openBtn');
const progress=document.getElementById('progress');
let erpOk=false,onyxOk=false,onyxUrl='https://onyx-ew82.onrender.com',running=false,userEmail='';

function msg(type,payload={}){return new Promise(r=>{chrome.runtime.sendMessage({type,...payload},res=>{if(chrome.runtime.lastError)r({ok:false,error:chrome.runtime.lastError.message});else r(res);});});}

async function checkERP(){
  erpDot.className='dot checking';erpSub.textContent='Checking…';
  try{const r=await msg('CHECK_SESSION');
    if(r?.ok&&r.result?.healthy){erpOk=true;erpDot.className='dot green';
      userEmail=r.result.sessionInfo?.email||'';
      const m=r.result.sessionInfo?.minsLeft;
      erpSub.textContent=userEmail+(m>0?` · ${m}m left`:'');
    } else{erpOk=false;erpDot.className='dot red';erpSub.textContent=r?.result?.issues?.[0]?.msg||r?.error||'Not connected';}
  }catch(e){erpOk=false;erpDot.className='dot red';erpSub.textContent=e.message;}
  updateBtn();
}

async function checkONYX(){
  onyxDot.className='dot checking';onyxSub.textContent='Checking…';
  try{
    const r=await msg('GET_ONYX_URL');
    onyxUrl=r?.result?.url||r?.url||onyxUrl;
    const resp=await fetch(`${onyxUrl}/api/me`,{method:'GET',signal:AbortSignal.timeout(10000)});
    if(resp.ok){
      onyxOk=true; onyxDot.className='dot green';
      onyxSub.textContent=onyxUrl.replace(/^https?:\/\//,'');
    } else {
      onyxOk=false; onyxDot.className='dot red';
      onyxSub.textContent=`Server error ${resp.status}`;
    }
  }catch(e){
    onyxOk=false; onyxDot.className='dot red';
    onyxSub.textContent=e.message?.includes('timeout')?'Not responding':(e.message||'Unreachable');
  }
  updateBtn();
}

function updateBtn(){
  getBtn.disabled=!erpOk||!onyxOk||running;
  if(!erpOk) getBtn.textContent='ERP offline';
  else if(!onyxOk) getBtn.textContent='ONYX offline';
  else getBtn.textContent='Get Data';
}

getBtn.addEventListener('click',async()=>{
  if(running||!erpOk||!onyxOk)return;running=true;updateBtn();getBtn.textContent='Fetching…';
  progress.className='progress';progress.textContent='Scraping partner list…';
  try{const r=await msg('FETCH_PARTNER_LIST');
    if(r?.ok){const c=Array.isArray(r.result)?r.result.length:'?';progress.className='progress success';progress.textContent=`✓ ${c} partners pushed to ONYX`;}
    else throw new Error(r?.error||'Failed');
  }catch(e){progress.className='progress error';progress.textContent=e.message;}
  finally{running=false;updateBtn();}
});

// Open ONYX with user email for session isolation
openBtn.addEventListener('click',()=>{
  const url = userEmail
    ? `${onyxUrl}?onyxUser=${encodeURIComponent(userEmail)}#/dashboard`
    : `${onyxUrl}#/dashboard`;
  chrome.tabs.create({url});
});

chrome.runtime.onMessage.addListener(m=>{
  if((m.type==='partner360_status'||m.type==='refresh_progress')&&running){
    progress.className='progress';progress.textContent=m.payload||'';
  }
});

checkERP();
checkONYX();

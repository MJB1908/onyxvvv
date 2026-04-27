// content.js — Gmail content script
function extractEmail() {
  const subjectEl = document.querySelector('h2.hP') || document.querySelector('.nH .ha h2');
  const subject   = subjectEl?.innerText?.trim() ?? '';
  const bodyEl    = document.querySelector('.a3s.aiL') || document.querySelector('.a3s');
  let body = '';
  if (bodyEl) {
    const clone = bodyEl.cloneNode(true);
    clone.querySelectorAll('br').forEach(b=>b.replaceWith('\n'));
    clone.querySelectorAll('p,div,tr,li').forEach(el=>{ if(el.nextSibling) el.insertAdjacentText('afterend','\n'); });
    body = (clone.innerText??clone.textContent??'').replace(/\n{3,}/g,'\n\n').trim();
  }
  const senderEl = document.querySelector('.gD') || document.querySelector('[email]');
  const sender   = senderEl?.getAttribute('email') ?? '';
  const is3cx    = subject.toLowerCase().includes('voicemail')||subject.toLowerCase().includes('missed call')||
                   subject.toLowerCase().includes('transcript')||body.includes('3CX');
  return { subject, body, sender, is3cx };
}
chrome.runtime.onMessage.addListener((msg,_,sendResponse) => {
  if (msg.type==='EXTRACT_EMAIL') sendResponse(extractEmail());
});

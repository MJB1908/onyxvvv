// Detect context: extension vs web
const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
const isBrowser = !isExtension;

if (isExtension) {
  document.getElementById('body').classList.add('ext-mode');
  // Load extension popup script using chrome.runtime.getURL for correct path
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('popup.js');
  document.body.appendChild(script);
} else {
  document.getElementById('body').classList.add('web-mode');
  // Load web UI script
  const script = document.createElement('script');
  script.src = '/erp.js';
  document.body.appendChild(script);
}

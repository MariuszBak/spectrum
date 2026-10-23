const installSection = document.getElementById('installSection');
const installButton = document.getElementById('installPwa');
const installHint = document.getElementById('installHint');
const offlineStatus = document.getElementById('offlineStatus');
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt;
function updateInstallUI() {
  installSection.hidden = isStandalone();
  installHint.textContent = isIOS ? 'Safari → Udostępnij → Do ekranu początkowego → Dodaj.' : 'Zainstaluj aplikację z menu przeglądarki.';
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt; installPrompt = null; installButton.hidden = true;
  await prompt.prompt(); await prompt.userChoice;
});
window.addEventListener('appinstalled', () => { installSection.hidden = true; installPrompt = null; });
window.matchMedia('(display-mode: standalone)').addEventListener('change', updateInstallUI);
updateInstallUI();
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js?v=26.10.3', { scope: './', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      offlineStatus.textContent = 'Gotowa do pracy offline.';
      if (registration.waiting) offlineStatus.textContent = 'Aktualizacja gotowa. Zamknij i otwórz aplikację.';
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offlineStatus.textContent = 'Aktualizacja gotowa. Zamknij i otwórz aplikację.';
        });
      });
    } catch { offlineStatus.textContent = 'Tryb offline nie został przygotowany. Spróbuj ponownie przy dostępie do sieci.'; }
  });
} else {
  offlineStatus.textContent = 'Instalacja i mikrofon wymagają uruchomienia przez HTTPS.';
}

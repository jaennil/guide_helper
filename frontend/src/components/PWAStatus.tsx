import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLanguage } from '../context/LanguageContext';
import './PWAStatus.css';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandaloneMode(): boolean {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

export function PWAStatus() {
  const { t } = useLanguage();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isStandalone, setIsStandalone] = useState(() => isStandaloneMode());
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installPromptDismissed, setInstallPromptDismissed] = useState(false);
  const [offlineReadyVisible, setOfflineReadyVisible] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('[pwa] service worker registration failed:', error);
    },
  });

  useEffect(() => {
    const handleConnectionChange = () => setIsOnline(navigator.onLine);

    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);

    return () => {
      window.removeEventListener('online', handleConnectionChange);
      window.removeEventListener('offline', handleConnectionChange);
    };
  }, []);

  useEffect(() => {
    if (offlineReady) {
      setOfflineReadyVisible(true);
    }
  }, [offlineReady]);

  useEffect(() => {
    const updateStandaloneState = () => setIsStandalone(isStandaloneMode());
    const displayModeQuery = window.matchMedia('(display-mode: standalone)');
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
      setInstallPromptDismissed(false);
    };
    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
      setInstallPromptDismissed(true);
      updateStandaloneState();
    };

    updateStandaloneState();
    displayModeQuery.addEventListener('change', updateStandaloneState);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      displayModeQuery.removeEventListener('change', updateStandaloneState);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPromptEvent) {
      return;
    }

    setIsInstalling(true);

    try {
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPromptEvent(null);
      }
      setInstallPromptDismissed(true);
    } finally {
      setIsInstalling(false);
    }
  };

  const closeOfflineReady = () => {
    setOfflineReady(false);
    setOfflineReadyVisible(false);
  };

  if (needRefresh) {
    return (
      <div className="pwa-status-stack">
        <section className="pwa-status-card" aria-live="polite">
          <div className="pwa-status-label">{t('pwa.badge')}</div>
          <h3>{t('pwa.updateTitle')}</h3>
          <p>{t('pwa.updateDescription')}</p>
          <div className="pwa-status-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void updateServiceWorker(true)}>
              {t('pwa.updateAction')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setNeedRefresh(false)}>
              {t('pwa.dismiss')}
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="pwa-status-stack">
        <section className="pwa-status-card pwa-status-card-offline" aria-live="polite">
          <div className="pwa-status-label">{t('pwa.badge')}</div>
          <h3>{t('pwa.offlineTitle')}</h3>
          <p>{t('pwa.offlineDescription')}</p>
        </section>
      </div>
    );
  }

  if (offlineReadyVisible) {
    return (
      <div className="pwa-status-stack">
        <section className="pwa-status-card" aria-live="polite">
          <div className="pwa-status-label">{t('pwa.badge')}</div>
          <h3>{t('pwa.readyTitle')}</h3>
          <p>{t('pwa.readyDescription')}</p>
          <div className="pwa-status-actions">
            <button className="btn btn-secondary btn-sm" onClick={closeOfflineReady}>
              {t('pwa.dismiss')}
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!isStandalone && installPromptEvent && !installPromptDismissed) {
    return (
      <div className="pwa-status-stack">
        <section className="pwa-status-card" aria-live="polite">
          <div className="pwa-status-label">{t('pwa.badge')}</div>
          <h3>{t('pwa.installTitle')}</h3>
          <p>{t('pwa.installDescription')}</p>
          <div className="pwa-status-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void handleInstall()} disabled={isInstalling}>
              {isInstalling ? t('common.loading') : t('pwa.installAction')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setInstallPromptDismissed(true)}>
              {t('pwa.dismiss')}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return null;
}

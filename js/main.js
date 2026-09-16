import { StorageManager } from './modules/StorageManager.js';
import { UI } from './ui.js';
import { Events } from './event-bus.js';
import { Toast } from './components/toast.js';
import { Settings } from './components/settings.js';
import { Analytics } from './components/analytics.js';
import { InvoiceList } from './components/invoice-list.js';
import { InvoiceForm } from './components/invoice-form.js';
import { Home } from './components/home.js';
import { Utils } from './utils.js';

/**
 * Main Application Module
 */
const App = {
    els: {},

    async init() {
        // Zaznaj ali gre za reload po uvozu podatkov
        let isPostImport = false;
        try {
            isPostImport = sessionStorage.getItem('racunko_import_pending') === '1';
            if (isPostImport) sessionStorage.removeItem('racunko_import_pending');
        } catch (e) {}

        // Če je post-import, takoj prikaži loader (pred inicializacijo)
        if (isPostImport) {
            UI.showLoader('Nalaganje uvoženih podatkov...');
        }

        try {
            this.cacheElements();
            
            // 1. Initialize DB
            await StorageManager.init();

            // 2. Initialize UI (Navigation, Click Outside)
            await UI.init();

            // 3. Global UI Setup
            this.bindGlobalEvents();

            // 4. Initialize Components
            await Promise.all([
                Settings.init(),
                InvoiceForm.init()
            ]);
            
            InvoiceList.init();
            Analytics.init();
            Home.init();

            // 5. Handle PWA shortcut
            this.handleShortcut();

            // 6. Service Worker
            this.registerServiceWorker();

            // 7. Storage Estimate 
            if (navigator.storage && navigator.storage.estimate) {
                const { usage, quota } = await navigator.storage.estimate();
                const percent = Math.round((usage / quota) * 100);
                if (percent > 80) Toast.show('Prostor za shranjevanje je skoraj poln!', 'warning');
            }

            // 8. Po polni inicializaciji: prikaži uspeh, če gre za post-import
            if (isPostImport) {
                await UI.showSuccess('Uvoz podatkov uspešen!', 1800);
            }

        } catch (error) {
            if (isPostImport) UI.hideLoader();
            this.handleInitError(error);
        }
    },

    cacheElements() {
        this.els = {
            dialogs: document.querySelectorAll('dialog.modal-dialog'),
            infoModal: document.getElementById('modal-stat-info'),
            infoTitle: document.getElementById('stat-info-title-text'),
            infoDesc: document.getElementById('stat-info-desc')
        };
    },

    bindGlobalEvents() {
        document.querySelectorAll('dialog.modal-dialog').forEach(dlg => {
            dlg.querySelector('.close-modal')?.addEventListener('click', () => dlg.close());
            dlg.onclick = (e) => (e.target === dlg) && dlg.close();
        });

        // Global stat-info listener
        document.body.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-stat-info');
            if (btn && this.els.infoModal && this.els.infoTitle && this.els.infoDesc) {
                this.els.infoTitle.textContent = btn.dataset.title || 'Pojasnilo';
                this.els.infoDesc.textContent = btn.dataset.desc || '';
            }
        });
    },

    handleShortcut() {
        const params = new URLSearchParams(window.location.search);
        const action = params.get('action');

        if (action === 'new-invoice') {
            window.location.hash = 'invoices';
            Events.emit('new-invoice-requested');
            
            window.history.replaceState({}, '', window.location.pathname);
        }
    },

    handleInitError(error) {
        console.error('App initialization failed:', error);
        document.body.replaceChildren();
        
        const container = document.createElement('div');
        container.className = 'app-error-screen';
        
        const h1 = document.createElement('h1');
        h1.textContent = 'Napaka pri nalaganju aplikacije';
        
        const p = document.createElement('p');
        p.textContent = 'Prišlo je do kritične napake pri inicializaciji podatkovne baze ali uporabniškega vmesnika.';
        
        const code = document.createElement('code');
        code.textContent = error.message;
        
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = 'Poskusi znova';
        btn.onclick = () => window.location.reload();
        
        container.append(h1, p, code, btn);
        document.body.appendChild(container);
    },

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            let refreshing = false;
            
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) {
                    refreshing = true;
                    window.location.reload();
                }
            });

            const swUrl = Utils.policy ? Utils.policy.createScriptURL('./service-worker.js') : './service-worker.js';
            navigator.serviceWorker.register(swUrl)
                .then(registration => {
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                Toast.showUpdate('Nova verzija aplikacije je pripravljena!', () => {
                                    newWorker.postMessage({ action: 'skipWaiting' });
                                });
                            }
                        });
                    });
                })
                .catch(err => console.log('SW registration failed: ', err));
        }
    }
};

// Note: ES6 modules are deferred by default, meaning they load in parallel.
// DOM je pripravljen, ko se modul izvede. Neposreden klic za hitrejši TTI.
App.init();

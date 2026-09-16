import { StorageManager } from './modules/StorageManager.js';
import { Events } from './event-bus.js';
import { Utils } from './utils.js';

import { UX } from './modules/ux.js';

export const UI = {
    async init() {
        // Track current view – no view is active yet in HTML
        this.currentViewId = null;

        this.setupInteractiveElements();
        UX.setupValidation();

        // CRITICAL ORDER: initGreeting MUST run BEFORE setupNavigation.
        // initGreeting() checks if user has data and sets the correct hash
        // (#welcome for first-time users, unchanged for returning users).
        // setupNavigation() then reads the hash and shows the correct view.
        await UX.initGreeting();
        await UX.initTheme();

        // NOW setup navigation – it will read the (already correct) hash
        this.setupNavigation();

        this.setupKeyboardA11y();
        this.setupFocusManagement(); // Centralizirano upravljanje fokusa
        this.updateStorageStatus();
        this.updateOnlineStatus();

        Events.on('user-settings-changed', () => {
            this.applyGreeting();
            this.updateStorageStatus();
        });

        // Home events moved to home.js

        window.addEventListener('online', () => this.updateOnlineStatus());
        window.addEventListener('offline', () => this.updateOnlineStatus());
    },

    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        const btnProfile = document.getElementById('btn-goto-profile');

        const VIEW_MAP = {
            data: 'view-data',
            profile: 'view-profile',
            'invoice-form': 'view-invoice-form',
            'entity-form': 'view-entity-form',
            'service-form': 'view-service-form',
            welcome: 'welcome',
            instructions: 'instructions'
        };
        const handleNavigation = (targetId) => {
            this.switchView(VIEW_MAP[targetId] || targetId, targetId);
        };

        // Navigacija preko navadnih <a> značk, omogoča desni klik
        // Dogodek poslušamo preko hashchange dogodka spodaj.

        // Profile Trigger in Header
        if (btnProfile) {
            btnProfile.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.hash = 'profile';
            });
        }

        // "View all invoices" link on Home
        const linkViewAll = document.getElementById('link-view-all-invoices');
        if (linkViewAll) {
            linkViewAll.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.hash = 'invoices';
            });
        }

        // Modern Unsaved Changes Guard (Browser close / refresh)
        window.addEventListener('beforeunload', (e) => {
            const dirtyForms = document.querySelectorAll('form[data-dirty="true"]');
            if (dirtyForms.length > 0) {
                e.preventDefault();
                // Opozorilo za uporabnika (brskalnik prikaže svoj native dialog)
                e.returnValue = '';
            }
        });

        // Listen for URL hash changes
        window.addEventListener('hashchange', async (e) => {
            const hash = window.location.hash.replace('#', '') || 'home';
            const oldHash = e.oldURL.split('#')[1] || 'home';

            // List of "Form" views that are related to each other
            const FORM_VIEWS = ['invoice-form', 'entity-form', 'service-form'];
            const isTransitionBetweenForms = FORM_VIEWS.includes(hash) && FORM_VIEWS.includes(oldHash);

            // Unsaved changes guard 
            const dirtyForms = document.querySelectorAll('form[data-dirty="true"]');

            // If we are moving between forms, we DON'T prompt (sub-form opening/closing)
            if (dirtyForms.length > 0 && !isTransitionBetweenForms) {
                const confirmed = confirm('Imate neshranjene spremembe. Ali ste prepričani, da želite zapustiti trenutno okno in zavreči spremembe?');
                if (!confirmed) {
                    history.replaceState(null, '', `#${oldHash}`);
                    return;
                }

                // User confirmed: clear dirty flags
                dirtyForms.forEach(form => delete form.dataset.dirty);
            }

            document.body.classList.remove('sub-view-open');
            handleNavigation(hash);
        });

        // Global Dirty Tracking ()
        document.addEventListener('input', (e) => {
            if (e.target.closest('form')) {
                e.target.closest('form').dataset.dirty = 'true';
            }
        });
        document.addEventListener('change', (e) => {
            if (e.target.closest('form')) {
                e.target.closest('form').dataset.dirty = 'true';
            }
        });

        // Initialize view based on current URL hash
        const initialHash = window.location.hash.replace('#', '') || 'home';

        // Routing Guard (): Prevent landing on transient form views after cold boot/refresh.
        // These views are context-dependent and would appear empty or lose state on cold boot.
        const TRANSIENT_VIEWS = ['invoice-form', 'entity-form', 'service-form'];
        const safeHash = TRANSIENT_VIEWS.includes(initialHash) ? 'home' : initialHash;

        if (safeHash !== initialHash) {
            history.replaceState(null, '', '#home');
        }

        handleNavigation(safeHash);
    },

    switchView(targetId, navTargetId = null) {
        // Prevent redundant switches
        if (this.currentViewId === targetId) return;

        // 1. Full-screen override for specific views (e.g. Welcome)
        if (targetId === 'welcome') {
            document.body.classList.add('fullscreen-view-active');
        } else {
            document.body.classList.remove('fullscreen-view-active');
        }

        // 2. Content update – instant, zero animation
        const container = document.getElementById('view-container');
        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === targetId);
        });
        if (container) container.scrollTo({ top: 0, behavior: 'instant' });

        // 2. Navigation UI update
        const finalNavId = navTargetId || (targetId.startsWith('view-') ? targetId.replace('view-', '') : targetId);
        document.querySelectorAll('.nav-item').forEach(nav => {
            const isActive = nav.dataset.target === finalNavId;
            nav.classList.toggle('active', isActive);
            nav.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        const btnProfile = document.getElementById('btn-goto-profile');
        if (btnProfile) {
            btnProfile.classList.toggle('active', finalNavId === 'profile');
        }

        this.currentViewId = targetId;

        // 3. Accessibility: Move focus to the new view
        const activeView = document.getElementById(targetId);
        if (activeView) {
            // Find first focusable element or use the back button
            const firstFocus = activeView.querySelector('.btn-back, h2, h3');
            if (firstFocus) {
                if (!firstFocus.tabIndex) firstFocus.tabIndex = -1;
                firstFocus.focus({ preventScroll: true });
            }
        }
    },

    setupInteractiveElements() {
        // Global Action Dispatcher (CSP Compliance)
        document.body.addEventListener('click', (e) => {
            // Native Date Picker delegation
            if (e.target.matches('input[type="date"]')) {
                e.target.showPicker();
                return;
            }

            // Global "Go Back" action
            const backBtn = e.target.closest('[data-action="go-back"]');
            if (backBtn) {
                e.preventDefault();
                window.history.back();
            }
        });
    },

    async updateStorageStatus() {
        const el = document.getElementById('storage-usage');
        if (!el) return;

        if (navigator.storage && navigator.storage.estimate) {
            const { usage, quota } = await navigator.storage.estimate();
            const usageMB = (usage / (1024 * 1024)).toFixed(2);
            const quotaMB = (quota / (1024 * 1024)).toFixed(0);
            const percent = ((usage / quota) * 100).toFixed(1);

            el.textContent = `${usageMB} MB / ${quotaMB} MB (${percent}%)`;

            // Opozori uporabnika, če je poraba nad 80 %
            if (percent > 80) {
                el.classList.add('text-danger', 'font-bold');
                console.warn(`Storage pressure: ${percent}% used.`);
            } else {
                el.classList.remove('text-danger', 'font-bold');
            }
        } else {
            el.textContent = 'Neznano';
        }
    },

    updateOnlineStatus() {
        const el = document.getElementById('conn-status');
        if (!el) return;

        const isOnline = navigator.onLine;
        el.textContent = isOnline ? 'Povezano' : 'Brez povezave';
        el.className = `status-pill ${isOnline ? 'success' : 'danger'}`;
    },

    applyGreeting() {
        return UX.applyGreeting();
    },

    /**
     * Prikaže globalni nalagalni zaslon (overlay) z zameglitvijo in spinnerjem.
     * @param {string} [text='Obdelava podatkov...'] - Besedilo, prikazano ob spinnerju.
     */
    showLoader(text = 'Obdelava podatkov...') {
        const loader = document.getElementById('global-loader');
        if (!loader) return;

        // Ponastavi ikono nazaj na spinner (CSP-safe: DOM API namesto innerHTML)
        const iconContainer = loader.querySelector('.loader-icon-container');
        if (iconContainer) {
            const spinner = document.createElement('div');
            spinner.className = 'loader-spinner';
            iconContainer.replaceChildren(spinner);
        }

        const textEl = loader.querySelector('.loader-text');
        if (textEl) textEl.textContent = text;
        loader.classList.remove('hidden', 'hiding');
    },

    /**
     * Prikaže uspeh na globalnem zaslonu in ga nato skrije.
     * @param {string} text - Besedilo za uspeh.
     * @param {number} [duration=1200] - Čas prikaza v ms.
     * @returns {Promise<void>}
     */
    async showSuccess(text = 'Uspešno dokončano!', duration = 1200) {
        const loader = document.getElementById('global-loader');
        if (!loader) return;

        // Če loader še ni prikazan, ga prikažemo
        loader.classList.remove('hidden', 'hiding');

        // Prikaži zelen kljukec z animacijo (CSP-safe: DOM API namesto innerHTML)
        const iconContainer = loader.querySelector('.loader-icon-container');
        if (iconContainer) {
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-circle-check loader-success-icon';
            icon.setAttribute('aria-hidden', 'true');
            iconContainer.replaceChildren(icon);
        }

        const textEl = loader.querySelector('.loader-text');
        if (textEl) textEl.textContent = text;

        return new Promise((resolve) => {
            setTimeout(() => {
                this.hideLoader();
                // Počakamo, da se fade-out animacija izvede (450ms) pred razrešitvijo
                setTimeout(resolve, 450);
            }, duration);
        });
    },

    /**
     * Skrije globalni nalagalni zaslon z gladkim prehodom (fade-out).
     */
    hideLoader() {
        const loader = document.getElementById('global-loader');
        if (!loader) return;
        loader.classList.add('hiding');
        // Po koncu CSS tranzicije (400ms) dodamo hidden, da element ne blokira klikov
        setTimeout(() => {
            loader.classList.add('hidden');
            loader.classList.remove('hiding');
        }, 450);
    },

    /**
     * Private: Generic modal opener. Reduces duplication between confirmWarnings and confirmAction.
     * @param {string} modalId - ID of the <dialog> element
     * @param {function} setup - Callback to populate modal content before showing
     * @returns {Promise<boolean>}
     */
    _openModal(modalId, setup) {
        return new Promise((resolve) => {
            const modal = document.getElementById(modalId);
            if (!modal) { resolve(true); return; }

            const btnCancel = modal.querySelector('[data-role="cancel"], #btn-warnings-cancel, #btn-confirm-cancel');
            const btnProceed = modal.querySelector('[data-role="proceed"], #btn-warnings-proceed, #btn-confirm-proceed');
            const closeBtn = modal.querySelector('.close-modal');
            const lastFocusedElement = document.activeElement;

            // Let caller populate modal content
            const shouldShow = setup(modal);
            if (shouldShow === false) { resolve(true); return; }

            const cleanup = () => {
                btnCancel?.removeEventListener('click', onCancel);
                closeBtn?.removeEventListener('click', onCancel);
                btnProceed?.removeEventListener('click', onProceed);
                modal.removeEventListener('close', onDialogClose);
                modal.close();
                if (lastFocusedElement) lastFocusedElement.focus();
            };

            const onCancel = (e) => { e?.preventDefault(); cleanup(); resolve(false); };
            const onProceed = (e) => { e?.preventDefault(); cleanup(); resolve(true); };
            const onDialogClose = () => { cleanup(); resolve(false); };

            btnCancel?.addEventListener('click', onCancel);
            closeBtn?.addEventListener('click', onCancel);
            btnProceed?.addEventListener('click', onProceed);
            modal.addEventListener('close', onDialogClose);

            modal.showModal();
        });
    },

    /**
     * Shows a warning dialog listing the provided warnings.
     * @param {string[]} warnings 
     * @returns {Promise<boolean>}
     */
    confirmWarnings(warnings) {
        return this._openModal('modal-warnings', (modal) => {
            const list = document.getElementById('modal-warnings-list');
            if (!list || warnings.length === 0) return false;

            list.replaceChildren();
            warnings.forEach(w => {
                const li = document.createElement('li');
                li.textContent = w;
                list.appendChild(li);
            });
        });
    },

    /**
     * Architecture Pattern: Generic Asynchronous Confirmation Dialog.
     * @param {string} title 
     * @param {string} message 
     * @param {string} confirmText 
     * @returns {Promise<boolean>}
     */
    confirmAction(title, message, confirmText = 'Potrdi') {
        return this._openModal('modal-confirm', (modal) => {
            const titleEl = document.getElementById('confirm-title');
            const messageEl = document.getElementById('confirm-message');
            const btnProceed = document.getElementById('btn-confirm-proceed');

            if (titleEl) titleEl.textContent = title;
            if (messageEl) messageEl.textContent = message;
            if (btnProceed) btnProceed.textContent = confirmText;
        });
    },

    /**
     * Architecture Pattern: Accessibility Layer.
     * Captures Enter and Space keys for all role="button" elements (e.g., dashboard cards).
     */
    setupKeyboardA11y() {
        document.addEventListener('keydown', (e) => {
            const target = e.target.closest('[role="button"]');
            if (!target) return;

            if (e.key === 'Enter' || e.key === ' ') {
                if (e.key === ' ') e.preventDefault();
                target.click();
            }
        });
    },

    /**
     * Architecture Pattern: Focus Management (Accessibility Pattern)
     * Upravlja s fokusom za <dialog> in [popover] elemente.
     */
    setupFocusManagement() {
        const lastFocusedElements = new Map(); // Shranjevanje elementov za povratek fokusa

        // 1. POPOVER LOGIKA (Toggle event)
        document.addEventListener('toggle', (e) => {
            const popover = e.target.closest('[popover]');
            if (!popover) return;

            if (e.newState === 'open') {
                // Zapomnimo si kateri gumb je odprl popover
                lastFocusedElements.set(popover.id, document.activeElement);

                // Prestavimo fokus na prvi interaktivni element v oknu
                this._focusFirstElement(popover);
            } else {
                // Ob zaprtju vrnemo fokus
                const lastEl = lastFocusedElements.get(popover.id);
                if (lastEl) {
                    lastEl.focus();
                    lastFocusedElements.delete(popover.id);
                }
            }
        }, true);

        // 2. DIALOG LOGIKA (Native close event)
        // Opomba: showModal() že delno trapa fokus, a za povratek na trigger potrebujemo tole
        document.addEventListener('close', (e) => {
            if (e.target.tagName === 'DIALOG') {
                const dlg = e.target;
                const lastEl = lastFocusedElements.get(dlg.id);
                if (lastEl) {
                    lastEl.focus();
                    lastFocusedElements.delete(dlg.id);
                }
            }
        }, true);

        // Ker se dialogi odpirajo programsko, moramo prestreči moment odpiranja
        // To rešimo z wrapanjem originalnih confirm metod ali poslušanjem modal-ov
        Events.on('modal-opened', (modalId) => {
            lastFocusedElements.set(modalId, document.activeElement);
        });

        // 3. GLOBALNI FOCUS TRAP (KeyDown interceptor)
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;

            // Najdemo trenutno aktivno okno (popover ali dialog)
            const activeModal = document.querySelector('[popover]:popover-open, dialog[open]');
            if (!activeModal) return;

            const focusables = this._getFocusableElements(activeModal);
            if (focusables.length === 0) return;

            const first = focusables[0];
            const last = focusables[focusables.length - 1];

            if (e.shiftKey) {
                // Backward Tab
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                // Forward Tab
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        });
    },

    _focusFirstElement(container) {
        const first = this._getFocusableElements(container)[0];
        if (first) {
            // Počakamo en frame da se animacija začne/konča
            requestAnimationFrame(() => first.focus());
        }
    },

    _getFocusableElements(container) {
        return Array.from(container.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    }

};

// Scope Isolation: Removed global Window injection in favor of strict ES6 module scoping.

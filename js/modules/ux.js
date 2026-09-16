import { StorageManager } from './StorageManager.js';
import { Toast } from '../components/toast.js';
import { Events } from '../event-bus.js';
import { Validators } from '../validators.js';

/**
 * UX Module - Consolidated UI logic for Theme, Greeting, and Validation.
 * Architecture Pattern.
 */
export const UX = {
    // --- Theme Management ---
    async initTheme() {
        const prefs = await StorageManager.getPrefs();
        const theme = prefs.theme || 'system';
        await this.setTheme(theme, false);
        
        if (prefs.primaryColor) this.applyPrimaryColor(prefs.primaryColor);
        
        const activeBtn = document.querySelector(`.theme-btn[data-theme="${theme}"]`);
        if (activeBtn) {
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            activeBtn.classList.add('active');
        }
        
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.onclick = async () => {
                await this.setTheme(btn.dataset.theme);
                document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b === btn));
            };
        });
    },

    async setTheme(theme, save = true) {
        if (save) {
            const prefs = await StorageManager.getPrefs();
            prefs.theme = theme;
            await StorageManager.savePrefs(prefs);
        }
        document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
        const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#0f1115' : '#3b82f6');
    },

    applyPrimaryColor(hexColor) {
        document.documentElement.style.setProperty('--c-primary', hexColor);
        document.documentElement.style.setProperty('--c-primary-hover', hexColor + 'E6');
    },

    // --- Greeting & Welcome Management ---
    async initGreeting() {
        const prefs = await StorageManager.getPrefs();

        const closeWelcome = async (name = null) => {
            if (name && name.trim()) prefs.userName = name;
            prefs.hasSeenWelcome = true;
            await StorageManager.savePrefs(prefs);
            
            try {
                localStorage.setItem('racunko_has_seen_welcome', 'true');
            } catch (e) {}
            document.documentElement.classList.remove('new-user');
            document.documentElement.classList.add('returning-user');

            this.applyGreeting();
            window.location.hash = 'home';
        };

        // Welcome Setup
        document.getElementById('btn-welcome-save')?.addEventListener('click', () => {
            closeWelcome(document.getElementById('welcome-name-input')?.value || '');
        });

        // CSP Compliance: Import trigger brez inline onclick
        document.getElementById('btn-trigger-welcome-import')?.addEventListener('click', () => {
            document.getElementById('welcome-file-import')?.click();
        });
        
        // Import JSON File Trigger Setup
        document.getElementById('welcome-file-import')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Prikaži nalagalni zaslon
            const { UI } = await import('../ui.js');
            UI.showLoader('Uvažanje podatkov...');

            try {
                const text = await file.text();
                await StorageManager.importAllData(text);
                
                // Mirror to localStorage
                try {
                    localStorage.setItem('racunko_has_seen_welcome', 'true');
                } catch (e) {}
                document.documentElement.classList.remove('new-user');
                document.documentElement.classList.add('returning-user');
                
                // Zastavica: main.js bo po polni inicializaciji prikazal uspeh
                try { sessionStorage.setItem('racunko_import_pending', '1'); } catch (e) {}
                window.location.reload();
            } catch (err) {
                console.error(err);
                const { UI: UIref } = await import('../ui.js');
                UIref.hideLoader();
                alert('Napaka pri uvozu podatkov: ' + (err.message || 'Preverite datoteko.'));
            }
            e.target.value = ''; // Reset input
        });

        if (!prefs.hasSeenWelcome) {
            window.location.hash = 'welcome';
        } else {
            try {
                localStorage.setItem('racunko_has_seen_welcome', 'true');
            } catch (e) {}
            document.documentElement.classList.remove('new-user');
            document.documentElement.classList.add('returning-user');
        }
        this.applyGreeting();

        // Settings sync & Auto-save logic
        const nameInput = document.getElementById('pref-user-name');
        const greetingCheck = document.getElementById('pref-show-greeting');
        const upnCheck = document.getElementById('pref-default-upn');
        const colorInput = document.getElementById('pref-primary-color');
        const btnSavePrefs = document.getElementById('btn-save-prefs');

        if (nameInput) nameInput.value = prefs.userName || '';
        if (greetingCheck) greetingCheck.checked = !!prefs.showGreeting;
        if (upnCheck) upnCheck.checked = !!prefs.defaultIncludeUpn;
        if (colorInput && prefs.primaryColor) colorInput.value = prefs.primaryColor;

        /**
         * Centralizirana funkcija za shranjevanje nastavitev (Auto-save)
         */
        const saveAllPrefs = async (showToast = false) => {
            const updated = await StorageManager.getPrefs();
            if (nameInput) updated.userName = nameInput.value;
            if (greetingCheck) updated.showGreeting = greetingCheck.checked;
            if (upnCheck) updated.defaultIncludeUpn = upnCheck.checked;
            if (colorInput) updated.primaryColor = colorInput.value;
            
            await StorageManager.savePrefs(updated);
            this.applyGreeting();
            if (updated.primaryColor) this.applyPrimaryColor(updated.primaryColor);
            if (showToast) Toast.show('Nastavitve shranjene!', 'success');
        };

        // Attach auto-save listeners
        [greetingCheck, upnCheck, colorInput].forEach(el => {
            el?.addEventListener('change', () => saveAllPrefs(false));
        });
        
        // Name saves on blur
        nameInput?.addEventListener('blur', () => saveAllPrefs(false));
        
        // Color input provides live feedback
        colorInput?.addEventListener('input', (e) => this.applyPrimaryColor(e.target.value));

        if (btnSavePrefs) {
            btnSavePrefs.onclick = () => saveAllPrefs(true);
        }

        // Color Reset
        document.getElementById('btn-reset-color')?.addEventListener('click', () => {
            if (colorInput) {
                colorInput.value = '#3b82f6';
                saveAllPrefs(false);
            }
        });
    },

    async applyGreeting() {
        const prefs = await StorageManager.getPrefs();
        const name = prefs.userName || '';
        const display = name || 'Uporabnik';
        const initial = display.charAt(0).toUpperCase();

        // Home greeting
        const greetingWrapper = document.getElementById('greeting-wrapper');
        const displayNameEl = document.getElementById('display-name');
        if (greetingWrapper) {
            greetingWrapper.style.display = prefs.showGreeting !== false ? '' : 'none';
        }
        if (displayNameEl) {
            displayNameEl.textContent = display;
        }

        // Profile info & Navigation
        const profileNameEl = document.getElementById('profile-display-name');
        const profileInitialEl = document.getElementById('profile-avatar-initials-large');
        const navInitialEl = document.getElementById('user-avatar-initials');

        if (profileNameEl) profileNameEl.textContent = display;
        if (profileInitialEl) profileInitialEl.textContent = initial;
        if (navInitialEl) navInitialEl.textContent = initial;
    },

    // --- Dynamic Validation Management ---
    setupValidation() {
        const rules = [
            { sel: 'input[name="taxNumber"], [id$="-tax"]', fn: Validators.isSlovenianTaxNumber.bind(Validators), msg: 'Davčna številka običajno vsebuje 8 števk.' },
            { sel: 'input[name="registrationNumber"], [id$="-reg"]', fn: Validators.isSlovenianRegistrationNumber.bind(Validators), msg: 'Matična številka običajno vsebuje 10 števk.' },
            { sel: 'input[name="email"], [id$="-email"]', fn: Validators.email.bind(Validators), msg: 'E-pošta ni v veljavnem formatu.' },
            { sel: 'input[name="postalCode"], [id$="-zip"]', fn: Validators.postalCode.bind(Validators), msg: 'Poštna št. običajno vsebuje 4 števke.' },
            { sel: 'input[name="iban"], [id$="-iban"]', fn: (v) => Validators.iban(v) && Validators.ibanMod97(v), msg: 'IBAN morda ni v pravilnem formatu (Mod97).' }
        ];

        const validate = (input) => {
            const rule = rules.find(r => input.matches(r.sel));
            if (!rule) return;
            
            const isValid = !input.value || rule.fn(input.value);
            let warn = input.parentNode.querySelector('.input-warning');
            
            if (isValid) {
                warn?.remove();
                input.classList.remove('input-warning-border');
            } else if (!warn) {
                warn = document.createElement('div');
                warn.className = 'input-warning helper-text text-warning';
                const icon = document.createElement('i');
                icon.className = 'fa-solid fa-triangle-exclamation';
                icon.setAttribute('aria-hidden', 'true');
                const span = document.createElement('span');
                span.textContent = rule.msg;
                warn.appendChild(icon);
                warn.appendChild(document.createTextNode(' '));
                warn.appendChild(span);
                input.parentNode.appendChild(warn);
                input.classList.add('input-warning-border');
            }
        };

        document.body.addEventListener('input', (e) => {
            if (e.target.tagName === 'INPUT') {
                if (e.target.matches('input[name="iban"], [id$="-iban"]')) {
                    const raw = e.target.value.replace(/\s/g, '').toUpperCase();
                    e.target.value = raw.match(/.{1,4}/g)?.join(' ') || '';
                }
                validate(e.target);
            }
        });
        document.body.addEventListener('focusout', (e) => e.target.tagName === 'INPUT' && validate(e.target));
    }
};

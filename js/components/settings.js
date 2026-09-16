import { UI } from '../ui.js';
import { Events } from '../event-bus.js';
import { Utils } from '../utils.js';
import { StorageManager } from '../modules/StorageManager.js';
import { Validators } from '../validators.js';
import { Toast } from './toast.js';
import { EntityModal } from './form/EntityModal.js';
import { Component } from '../modules/Component.js';

export const Settings = {
    async init() {
        Component.init(this, {
            btnDeleteAll: 'btn-delete-all-data',
            btnExport: 'btn-export-data',
            btnImport: 'btn-import-data',
            fileInput: 'import-file-input',
            serviceFormIn: 'settings-service-form',
            searchPartners: 'search-partners',
            searchServices: 'search-services',
            companiesList: 'companies-list',
            partnersList: 'partners-list',
            servicesList: 'services-list',
            modalService: 'view-service-form'
        });

        this.setupEventListeners();
        this.setupItemActionDelegation();

        const refresh = () => Promise.all([this.renderCompaniesList(), this.renderPartnersList(), this.renderServicesList()]);
        Events.on('company-saved', refresh);
        Events.on('partner-saved', refresh);
        Events.on('service-saved', refresh);
        Events.on('data-cleared', refresh);

        await refresh();
    },

    setupEventListeners() {
        const { btnDeleteAll, btnExport, btnImport, fileInput, serviceFormIn, searchPartners, searchServices, modalService } = this.els;

        if (btnDeleteAll) {
            btnDeleteAll.onclick = async () => {
                if (await UI.confirmAction('POZOR', 'Izbrišem VSE podatke?', 'Izbriši vse')) {
                    try {
                        UI.showLoader('Brisanje podatkov...');
                        await StorageManager.clearAllData();
                        try {
                            localStorage.removeItem('racunko_has_seen_welcome');
                        } catch (e) {}
                        await UI.showSuccess('Vsi podatki so bili izbrisani.', 1500);
                    } catch (err) {
                        console.error('Napaka pri brisanju:', err);
                    } finally {
                        window.location.reload();
                    }
                }
            };
        }

        if (btnExport) {
            btnExport.onclick = async () => {
                const data = await StorageManager.exportAllData();
                const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `racunkomat_izvoz_${Utils.getTodayDate()}.json`;
                a.click();
                URL.revokeObjectURL(url);
                Toast.show('Izvoženo.', 'success');
            };
        }

        if (btnImport && fileInput) {
            btnImport.onclick = () => fileInput.click();
            fileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                // Prikaži nalagalni zaslon
                UI.showLoader('Uvažanje podatkov...');

                const reader = new FileReader();
                reader.onload = async (re) => {
                    try {
                        await StorageManager.importAllData(re.target.result);
                        // Zastavica: main.js bo po polni inicializaciji prikazal uspeh
                        try { sessionStorage.setItem('racunko_import_pending', '1'); } catch (e) {}
                        window.location.reload();
                    } catch {
                        UI.hideLoader();
                        Toast.show('Napaka pri uvozu.', 'error');
                    }
                };
                reader.readAsText(file);
            };
        }

        if (serviceFormIn) {
            serviceFormIn.onsubmit = async (e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(serviceFormIn));
                data.price = parseFloat(data.price);
                const val = Validators.validateService(data);
                if (!val.isValid) return val.errors.forEach(err => Toast.show(err, 'error'));
                await StorageManager.saveService(data);
                Toast.show('Shranjeno.', 'success');
                delete serviceFormIn.dataset.dirty;
                serviceFormIn.reset();
                if (window.history.length > 2) { history.back(); } else { window.location.hash = 'data'; }
                Events.emit('service-saved');
            };
        }

        if (searchPartners) searchPartners.oninput = (e) => this.renderPartnersList(e.target.value);
        if (searchServices) searchServices.oninput = (e) => this.renderServicesList(e.target.value);

        document.querySelectorAll('.btn-add-company, #btn-add-company').forEach(b => b.onclick = () => EntityModal.openForCompany());
        document.querySelectorAll('.btn-add-partner, #btn-add-partner').forEach(b => b.onclick = () => EntityModal.openForPartner());
        document.querySelectorAll('.btn-add-service, #btn-add-service').forEach(b => b.onclick = () => {
            serviceFormIn?.reset();
            document.getElementById('modal-service-title').textContent = 'Storitve';
            window.location.hash = 'service-form';
            window.scrollTo({ top: 0, behavior: 'instant' });
        });

        const closeService = () => { if (window.history.length > 2) { history.back(); } else { window.location.hash = 'data'; } };
        document.getElementById('btn-close-service-modal')?.addEventListener('click', closeService);
        document.getElementById('btn-cancel-service-modal')?.addEventListener('click', closeService);
        
        EntityModal.init();
    },

    /**
     * Helper to create a detail span with icon 
     */
    _createInfoSpan(iconClass, text, className = '', label = '') {
        if (!text) return null;
        const span = document.createElement('span');
        if (className) span.className = className;
        
        if (iconClass) {
            const icon = document.createElement('i');
            icon.className = `fa-solid ${iconClass}`;
            icon.setAttribute('aria-hidden', 'true');
            span.appendChild(icon);
            span.appendChild(document.createTextNode(` ${text}`));
        } else if (label) {
            const strong = document.createElement('strong');
            strong.textContent = label + ': ';
            span.appendChild(strong);
            span.appendChild(document.createTextNode(text));
        }
        
        return span;
    },

    async renderCompaniesList() {
        const listContainer = document.getElementById('companies-list');
        if (!listContainer) return;

        let companies = await StorageManager.getCompanies();
        companies.sort((a, b) => Utils.compareStrings(a.companyName, b.companyName));

        if (!companies.length) {
            listContainer.replaceChildren(Utils.renderEmptyState(
                'Ni shranjenih podjetij',
                'Dodajte svoje podjetje, da boste lahko izdavali račune.',
                'fa-building'
            ));
            return;
        }

        const template = document.getElementById('template-settings-item-card');
        const fragment = document.createDocumentFragment();

        companies.forEach(c => {
            const clone = template.content.cloneNode(true);
            const nameEl = clone.querySelector('.settings-item-name');
            const detailsEl = clone.querySelector('.settings-item-details');
            const editBtn = clone.querySelector('.btn-edit');
            const delBtn = clone.querySelector('.btn-delete');

            nameEl.textContent = c.companyName;
            
            const badges = [];
            badges.push(this._createInfoSpan(null, c.taxNumber || '/', 'badge-tax', 'DŠ'));
            badges.push(this._createInfoSpan(null, c.registrationNumber, 'badge-reg', 'MŠ'));
            const addressStr = [(c.address || '').trim(), `${c.postalCode || ''} ${c.city || ''}`.trim()].filter(Boolean).join(', ');
            badges.push(this._createInfoSpan('fa-location-dot', addressStr));
            badges.push(this._createInfoSpan('fa-credit-card', c.iban, 'badge-iban'));
            badges.push(this._createInfoSpan('fa-building-columns', c.bic, 'badge-bic'));
            badges.push(this._createInfoSpan('fa-envelope', c.email, 'badge-email'));

            if (c.isVatPayer) {
                badges.push(this._createInfoSpan('fa-percent', 'Zavezanec za DDV', 'badge-vat-payer'));
            }

            detailsEl.replaceChildren(...badges.filter(b => b !== null));

            editBtn.dataset.action = 'edit-company';
            editBtn.dataset.id = c.id;
            editBtn.title = 'Uredi podjetje';

            delBtn.dataset.action = 'delete-company';
            delBtn.dataset.id = c.id;
            delBtn.title = 'Izbriši podjetje';

            fragment.appendChild(clone);
        });

        listContainer.replaceChildren(fragment);
    },

    async renderPartnersList(filter = '') {
        const listContainer = document.getElementById('partners-list');
        if (!listContainer) return;

        let partners = await StorageManager.getPartners();
        if (filter) {
            const lcFilter = filter.toLowerCase();
            partners = partners.filter(p => (p.name || '').toLowerCase().includes(lcFilter));
        }
        partners.sort((a, b) => Utils.compareStrings(a.name, b.name));

        if (!partners.length) {
            listContainer.replaceChildren(Utils.renderEmptyState(
                filter ? 'Ni najdenih partnerjev' : 'Ni shranjenih partnerjev',
                filter ? 'Poskusite z drugim iskalnim nizom.' : 'Dodajte prvega partnerja za hitrejše izdajanje računov.',
                'fa-address-book'
            ));
            return;
        }

        const template = document.getElementById('template-settings-item-card');
        const fragment = document.createDocumentFragment();

        partners.forEach(p => {
            const clone = template.content.cloneNode(true);
            const nameEl = clone.querySelector('.settings-item-name');
            const detailsEl = clone.querySelector('.settings-item-details');
            const editBtn = clone.querySelector('.btn-edit');
            const delBtn = clone.querySelector('.btn-delete');

            nameEl.textContent = p.name;
            
            const badges = [];
            badges.push(this._createInfoSpan(null, p.taxNumber || '/', 'badge-tax', 'DŠ'));
            badges.push(this._createInfoSpan(null, p.registrationNumber, 'badge-reg', 'MŠ'));
            const addressStr = [(p.address || '').trim(), `${p.postalCode || ''} ${p.city || ''}`.trim()].filter(Boolean).join(', ');
            badges.push(this._createInfoSpan('fa-location-dot', addressStr));
            badges.push(this._createInfoSpan('fa-envelope', p.email, 'badge-email'));

            detailsEl.replaceChildren(...badges.filter(b => b !== null));

            editBtn.dataset.action = 'edit-partner';
            editBtn.dataset.id = p.id;
            editBtn.title = 'Uredi partnerja';

            delBtn.dataset.action = 'delete-partner';
            delBtn.dataset.id = p.id;
            delBtn.title = 'Izbriši partnerja';

            fragment.appendChild(clone);
        });

        listContainer.replaceChildren(fragment);
    },

    async renderServicesList(filter = '') {
        const listContainer = document.getElementById('services-list');
        if (!listContainer) return;

        let services = await StorageManager.getServices();
        if (filter) {
            const lcFilter = filter.toLowerCase();
            services = services.filter(s => (s.name || '').toLowerCase().includes(lcFilter));
        }
        services.sort((a, b) => Utils.compareStrings(a.name, b.name));

        if (!services.length) {
            listContainer.replaceChildren(Utils.renderEmptyState(
                filter ? 'Ni najdenih storitev' : 'Ni shranjenih storitev',
                filter ? 'Poskusite z drugim iskalnim nizom.' : 'Dodajte prvo storitev za hitrejše izdajanje računov.',
                'fa-box-open'
            ));
            return;
        }

        const template = document.getElementById('template-settings-item-card');
        const fragment = document.createDocumentFragment();

        services.forEach(s => {
            const clone = template.content.cloneNode(true);
            const nameEl = clone.querySelector('.settings-item-name');
            const detailsEl = clone.querySelector('.settings-item-details');
            const editBtn = clone.querySelector('.btn-edit');
            const delBtn = clone.querySelector('.btn-delete');

            nameEl.textContent = s.name;
            
            const badges = [];
            badges.push(this._createInfoSpan('fa-tag', Utils.formatCurrency(s.price) + ` / ${s.unit || 'kos'}`, 'badge-price'));
            
            if (s.vatRate !== undefined) {
                badges.push(this._createInfoSpan('fa-percent', `${s.vatRate}% DDV`, 'badge-vat-rate'));
            }

            detailsEl.replaceChildren(...badges.filter(b => b !== null));

            editBtn.dataset.action = 'edit-service';
            editBtn.dataset.id = s.id;
            editBtn.title = 'Uredi storitev';

            delBtn.dataset.action = 'delete-service';
            delBtn.dataset.id = s.id;
            delBtn.title = 'Izbriši storitev';

            fragment.appendChild(clone);
        });

        listContainer.replaceChildren(fragment);
    },

    // --- Event Delegation for Item Actions ---
    setupItemActionDelegation() {
        const { partnersList, companiesList, servicesList } = this.els;

        const actions = {
            'edit-company': (id) => this.editCompany(id),
            'edit-partner': (id) => this.editPartner(id),
            'edit-service': (id) => this.editService(id),
            'delete-company': (id) => this._deleteItem('podjetje', id, StorageManager.deleteCompany.bind(StorageManager), 'company-saved'),
            'delete-partner': (id) => this._deleteItem('partnerja', id, StorageManager.deletePartner.bind(StorageManager), 'partner-saved'),
            'delete-service': (id) => this._deleteItem('storitev', id, StorageManager.deleteService.bind(StorageManager), 'service-saved')
        };

        Component.delegate(partnersList, actions);
        Component.delegate(companiesList, actions);
        Component.delegate(servicesList, actions);
    },

    async _deleteItem(label, id, deleteFn, eventName) {
        if (await UI.confirmAction('Brisanje', `Izbrišem ${label}?`)) {
            await deleteFn(id);
            Toast.show('Izbrisano.', 'info');
            Events.emit(eventName);
        }
    },

    async editCompany(id, triggerBtn) {
        const company = await StorageManager.getCompany(id);
        if (!company) return;
        EntityModal.openForCompany(company);
    },

    async editPartner(id, triggerBtn) {
        const partner = await StorageManager.getPartner(id);
        if (!partner) return;
        EntityModal.openForPartner(partner);
    },

    async editService(id, triggerBtn) {
        const services = await StorageManager.getServices();
        const service = services.find(s => s.id === id);
        if (!service) return;
        const form = document.getElementById('settings-service-form');
        if (!form) return;
        for (const [key, value] of Object.entries(service)) {
            if (form.elements[key]) form.elements[key].value = value;
        }
        document.getElementById('modal-service-title').textContent = 'Uredi storitev';
        window.location.hash = 'service-form';
        window.scrollTo({ top: 0, behavior: 'instant' });
    },



};


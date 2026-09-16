import { StorageManager } from '../../modules/StorageManager.js';
import { Utils } from '../../utils.js';
import { Events } from '../../event-bus.js';
import { Toast } from '../toast.js';
import { Store } from '../../store.js';
import { EntityModal } from './EntityModal.js';

/**
 * EntityFormHandler 
 * Abstract logic for handling entity CRUD (Issuers/Partners) to reduce code duplication (80%+ overlap).
 */
export class EntityFormHandler {
    constructor(config) {
        this.config = {
            type: '', // 'issuer' or 'partner'
            selectId: '',
            formId: '',
            displayId: '',
            templateId: '',
            idPrefix: '', // e.g., 'inline-comp-'
            entityStoreKey: '', // e.g., 'companyId' in Store.state.invoice
            getEntities: null, // async fn
            getEntity: null, // async fn
            saveEntity: null, // async fn
            validate: null, // fn
            onSaved: null, // fn callback
            onSelected: null, // fn callback
            ...config
        };
        this.els = {};
        this._currentImages = {}; // State for base64 images (logos/signatures)
    }

    async init() {
        this.cacheElements();
        this.setupFormToggle();
        await this.loadEntities();

        Store.subscribe((state) => {
            const select = this.els.select;
            const currentId = state.invoice[this.config.entityStoreKey];
            if (select && select.value !== currentId && currentId !== 'NEW') {
                select.value = currentId || '';
                this.updateDisplay(currentId);
            }
        });
    }

    cacheElements() {
        this.els = {
            select: document.getElementById(this.config.selectId),
            display: document.getElementById(this.config.displayId),
            template: document.getElementById(this.config.templateId),
            btnToggle: document.getElementById(`btn-toggle-${this.config.formId.replace('-form', '')}`)
        };
    }

    async loadEntities() {
        const { select } = this.els;
        if (!select) return;

        select.replaceChildren();
        
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = this.config.type === 'issuer' ? 'Izberi podjetje...' : 'Izberi stranko...';
        select.appendChild(defaultOpt);

        const newOpt = document.createElement('option');
        newOpt.value = 'NEW';
        newOpt.textContent = this.config.type === 'issuer' ? '+ Dodaj novo podjetje' : '+ Dodaj novo stranko';
        newOpt.className = 'select-opt-new';
        select.appendChild(newOpt);

        try {
            const entities = await this.config.getEntities();
            const prefs = await StorageManager.getPrefs();

            entities.forEach(entity => {
                const opt = document.createElement('option');
                opt.value = entity.id;
                opt.textContent = entity.companyName || entity.name || 'Neznano';
                select.appendChild(opt);
            });

            // Handle auto-selection logic
            const lastUsedId = this.config.type === 'issuer' ? prefs.lastUsedCompanyId : prefs.lastUsedPartnerId;
            if (entities.length === 1 && !select.value && this.config.type === 'issuer') {
                select.value = entities[0].id;
                Store.state.invoice[this.config.entityStoreKey] = entities[0].id;
                this.updateDisplay(entities[0].id);
            } else if (lastUsedId && entities.some(e => e.id === lastUsedId)) {
                select.value = lastUsedId;
                Store.state.invoice[this.config.entityStoreKey] = lastUsedId;
                this.updateDisplay(lastUsedId);
            } else if (select.value && select.value !== 'NEW') {
                Store.state.invoice[this.config.entityStoreKey] = select.value;
                this.updateDisplay(select.value);
            }
        } catch (err) {
            console.error(`Failed to load ${this.config.type}s`, err);
        }
    }

    setupFormToggle() {
        const { select, btnToggle } = this.els;

        if (btnToggle) {
            btnToggle.addEventListener('click', () => {
                this.openFormForNew();
            });
        }

        if (select) {
            select.addEventListener('change', () => {
                if (select.value === 'NEW') {
                    select.value = '';
                    this.openFormForNew();
                } else {
                    Store.state.invoice[this.config.entityStoreKey] = select.value;
                    this.updateDisplay(select.value);
                }
            });
        }

        // Faza 2: EntityModal emits events. We listen and update.
        Events.on(this.config.type === 'issuer' ? 'company-saved' : 'partner-saved', async (data) => {
            await this.loadEntities();
            if (this.els.select) this.els.select.value = data.id;
            Store.state.invoice[this.config.entityStoreKey] = data.id;
            await this.updateDisplay(data.id);
        });
    }

    openFormForNew() {
        if (this.config.type === 'issuer') {
            EntityModal.openForCompany();
        } else {
            EntityModal.openForPartner();
        }
    }

    async updateDisplay(entityId) {
        const { display, template } = this.els;
        if (!display) return;

        if (!entityId || entityId === 'NEW') {
            display.classList.add('hidden');
            display.replaceChildren();
            return;
        }

        const entity = await this.config.getEntity(entityId);
        if (entity) {
            if (!template) return;

            const clone = template.content.cloneNode(true);
            this.fillDisplayTemplate(clone, entity);

            // Bind Edit Action
            const editBtnSelector = this.config.type === 'issuer' ? '.btn-edit-issuer' : '.btn-edit-partner';
            const editBtn = clone.querySelector(editBtnSelector);
            if (editBtn) {
                editBtn.addEventListener('click', () => this.openFormForEdit(entity));
            }

            display.replaceChildren(clone);
            display.classList.remove('hidden');
            if (this.config.onSelected) this.config.onSelected(entity);
            return entity;
        } else {
            display.classList.add('hidden');
        }
    }

    fillDisplayTemplate(clone, entity) {
        // Base text fields
        const map = this.config.type === 'issuer' ? {
            name: '.comp-name',
            addressLine: '.comp-address',
            tax: '.comp-tax',
            reg: '.comp-reg',
            iban: '.comp-iban',
            contact: '.comp-contact',
            signatory: '.comp-signatory'
        } : {
            name: '.part-name',
            addressLine: '.part-address',
            tax: '.part-tax',
            reg: '.part-reg',
            contact: '.part-contact'
        };

        const addressStr = `${entity.address || ""}, ${entity.postalCode || ""} ${entity.city || ""}, ${entity.country || "SI"}`;
        
        this._setText(clone, map.name, entity.companyName || entity.name);
        this._setText(clone, map.addressLine, addressStr);
        
        this._setTextPrefixed(clone, map.tax, 'Davčna: ', entity.taxNumber);
        this._setTextPrefixed(clone, map.reg, 'Matična: ', entity.registrationNumber);
        
        if (map.iban) this._setTextPrefixed(clone, map.iban, 'IBAN: ', entity.iban || '/');
        
        const contactParts = [];
        if (entity.email) contactParts.push(`Email: ${entity.email}`);
        if (entity.phone) contactParts.push(`Tel: ${entity.phone}`);
        this._setText(clone, map.contact, contactParts.join(' | ') || null);

        if (map.signatory) this._setTextPrefixed(clone, map.signatory, 'Podpisnik: ', entity.signatory);

        // Media (Issuer only)
        if (this.config.type === 'issuer') {
            const logoBox = clone.querySelector('.issuer-logo-box');
            if (logoBox && entity.logo) {
                const img = logoBox.querySelector('img');
                if (img) img.src = entity.logo;
                logoBox.classList.remove('hidden');
            }
            
            const sigBox = clone.querySelector('.issuer-signature-box');
            if (sigBox && entity.signature) {
                const img = sigBox.querySelector('img');
                if (img) img.src = entity.signature;
                sigBox.classList.remove('hidden');
            }
        }
    }

    _setText(parent, selector, text) {
        const el = parent.querySelector(selector);
        if (!el) return;
        if (text) el.textContent = text;
        else el.remove();
    }

    _setTextPrefixed(parent, selector, prefix, text) {
        const el = parent.querySelector(selector);
        if (!el) return;
        if (text) el.textContent = `${prefix}${text}`;
        else el.remove();
    }

    openFormForEdit(entity) {
        if (this.config.type === 'issuer') {
            EntityModal.openForCompany(entity);
        } else {
            EntityModal.openForPartner(entity);
        }
    }
}

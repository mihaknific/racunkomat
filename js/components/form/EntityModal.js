import { Events } from '../../event-bus.js';
import { Toast } from '../toast.js';
import { StorageManager } from '../../modules/StorageManager.js';
import { Validators } from '../../validators.js';
import { UI } from '../../ui.js';
import { Component } from '../../modules/Component.js';
import { Utils } from '../../utils.js';

/**
 * EntityModal 
 * Enoten upravitelj za urejanje podjetij in partnerjev preko <dialog> elementa.
 */
export const EntityModal = {
    els: {},
    _tempImages: { logo: null, signature: null },

    init() {
        Component.init(this, {
            view: 'view-entity-form',
            body: 'modal-entity-body',
            closeBtn: 'btn-close-entity-modal',
            title: 'modal-entity-title'
        });

        const { view, closeBtn } = this.els;
        if (!view) return;

        closeBtn.onclick = () => this.hide();

        // Ensure we catch submit regardless of template
        view.addEventListener('submit', async (e) => {
            if (e.target.tagName === 'FORM') {
                e.preventDefault();
                await this.handleSave(e.target);
            }
        });
        
        view.addEventListener('click', (e) => {
            if (e.target.closest('.btn-cancel-accordion')) this.hide();
        });
    },

    _ensureForm() {
        if (!this.els.body.querySelector('form')) {
            const tpl = document.getElementById('template-entity-form');
            this.els.body.replaceChildren(tpl.content.cloneNode(true));
            this._setupImageUploads(this.els.body.querySelector('form'));
        }
        return this.els.body.querySelector('form');
    },
    
    _setupImageUploads(form) {
        ['logo', 'signature'].forEach(type => {
            const box = form.querySelector(`#${type}-upload-box`);
            const input = form.querySelector(`#${type}-input`);
            const btnRemove = form.querySelector(`.btn-remove-image[data-target="${type}"]`);
            if (!box || !input) return;

            // Click on the box opens file dialog
            box.addEventListener('click', (e) => {
                if (e.target.closest('.btn-remove-image')) return;
                input.click();
            });

            // Handle file selection and compression
            input.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                // Reset input value so same file can be selected again
                input.value = '';

                try {
                    // Compress image (from Utils.compressImage)
                    const base64Str = await Utils.compressImage(file, { maxWidthPx: 600, maxSizeKB: 150 });
                    this._tempImages[type] = base64Str;
                    this._updateImagePreview(form, type);
                } catch (err) {
                    Toast.show(err.message || 'Napaka pri nalaganju slike', 'error');
                }
            });

            // Remove image
            if (btnRemove) {
                btnRemove.addEventListener('click', (e) => {
                    e.stopPropagation(); // prevent opening file dialog
                    this._tempImages[type] = null;
                    this._updateImagePreview(form, type);
                });
            }
        });
    },

    _updateImagePreview(form, type) {
        const previewEl = form.querySelector(`#${type}-upload-box .upload-preview`);
        const imgEl = form.querySelector(`#${type}-preview-img`);
        const placeholderEl = form.querySelector(`#${type}-upload-box .upload-placeholder`);
        
        if (!previewEl || !imgEl || !placeholderEl) return;

        if (this._tempImages[type]) {
            imgEl.src = this._tempImages[type];
            previewEl.classList.remove('hidden');
            placeholderEl.classList.add('hidden');
        } else {
            imgEl.src = '';
            previewEl.classList.add('hidden');
            placeholderEl.classList.remove('hidden');
        }
    },

    // Opomba: Polja za logotip in podpis so načrtovana za prihodnjo verzijo.

    openForCompany(company = null) {
        this.currentType = 'company';
        const form = this._ensureForm();
        this.els.title.textContent = company ? 'Uredi podjetje' : 'Dodaj podjetje';
        
        form.reset();
        this._tempImages = { logo: null, signature: null };
        this._updateImagePreview(form, 'logo');
        this._updateImagePreview(form, 'signature');
        
        form.querySelector('.field-group-company').classList.remove('hidden');
        form.querySelector('.field-group-partner').classList.add('hidden');
        const btnText = form.querySelector('.btn-text');
        if (btnText) btnText.textContent = 'Shrani podjetje';

        if (company) {
            this._fillForm(form, company, 'company');
        }

        this._showView();
    },

    openForPartner(partner = null) {
        this.currentType = 'partner';
        const form = this._ensureForm();
        this.els.title.textContent = partner ? 'Uredi stranko' : 'Dodaj stranko';
        
        form.reset();
        form.querySelector('.field-group-company').classList.add('hidden');
        form.querySelector('.field-group-partner').classList.remove('hidden');
        const btnText = form.querySelector('.btn-text');
        if (btnText) btnText.textContent = 'Shrani stranko';

        if (partner) {
            this._fillForm(form, partner, 'partner');
        }

        this._showView();
    },

    _fillForm(form, data, type) {
        if (form.elements['id']) form.elements['id'].value = data.id || '';
        
        const nameField = form.elements['name'];
        if (nameField) {
            nameField.value = type === 'company' ? (data.companyName || data.name || '') : (data.name || '');
        }

        const fields = ['address', 'postalCode', 'city', 'taxNumber', 'registrationNumber', 'country'];
        if (type === 'company') {
            fields.push('iban', 'bic');
        } else {
            fields.push('email');
        }

        fields.forEach(f => {
            if (form.elements[f] && data[f] !== undefined) {
                form.elements[f].value = data[f];
            }
        });

        if (type === 'company') {
            if (form.elements['isVatPayer']) {
                form.elements['isVatPayer'].checked = !!data.isVatPayer;
            }
            
            this._tempImages.logo = data.logo || null;
            this._tempImages.signature = data.signature || null;
            this._updateImagePreview(form, 'logo');
            this._updateImagePreview(form, 'signature');
        }
    },

    async handleSave(form) {
        const formData = new FormData(form);
        const data = Object.fromEntries(
            Array.from(formData.entries()).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
        );

        if (this.currentType === 'company') {
            data.isVatPayer = formData.get('isVatPayer') === 'on';
            data.companyName = data.name;
            data.logo = this._tempImages.logo;
            data.signature = this._tempImages.signature;
            
            if (!data.id) data.id = StorageManager.generateId();

            const validation = Validators.validateCompany(data);
            if (!validation.isValid) {
                validation.errors.forEach(err => Toast.show(err, 'error'));
                return;
            }
            if (validation.warnings?.length) {
                if (!(await UI.confirmWarnings(validation.warnings))) return;
            }

            await StorageManager.saveCompany(data);
            Toast.show('Podjetje shranjeno.', 'success');
            Events.emit('company-saved', data);
        } else {
            if (!data.id) data.id = StorageManager.generateId();

            const validation = Validators.validatePartner(data);
            if (!validation.isValid) {
                validation.errors.forEach(err => Toast.show(err, 'error'));
                return;
            }
            if (validation.warnings?.length) {
                if (!(await UI.confirmWarnings(validation.warnings))) return;
            }

            await StorageManager.savePartner(data);
            Toast.show('Stranka shranjena.', 'success');
            Events.emit('partner-saved', data);
        }

        delete form.dataset.dirty;
        this.hide();
    },

    _showView() {
        this.returnHash = window.location.hash.replace('#', '') || 'home';
        window.location.hash = 'entity-form';
        window.scrollTo({ top: 0, behavior: 'instant' });
    },

    hide() {
        if (this.returnHash) {
            window.location.hash = this.returnHash;
        } else {
            history.back();
        }
        this.returnHash = null;
    }
};

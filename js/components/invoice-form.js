import { UI } from '../ui.js';
import { Events } from '../event-bus.js';
import { Utils } from '../utils.js';
import { StorageManager } from '../modules/StorageManager.js';
import { Store } from '../store.js';
import { Toast } from './toast.js';
import { Validators } from '../validators.js';
import { Component } from '../modules/Component.js';

import { IssuerSection } from './form/IssuerSection.js';
import { PartnerSection } from './form/PartnerSection.js';
import { InvoiceDetails } from './form/InvoiceDetails.js';
import { ItemsTable } from './form/ItemsTable.js';

export const InvoiceForm = {
    // DOM Cache
    els: {},
    isSaving: false,

    async init() {
        Component.init(this, {
            formContainer: 'view-invoice-form',
            form: 'new-invoice-form',
            formTitle: 'invoice-form-title',
            saveLabel: 'btn-save-label',
            btnNew: 'btn-new-invoice',
            btnCancel: 'btn-cancel-invoice',
            btnClose: 'btn-close-invoice',
            btnPreview: 'btn-preview-invoice',
            btnDownload: 'btn-download-invoice',
            btnHelpSklic: 'btn-help-sklic',
            customNumber: 'inv-custom-number',
            dateIssue: 'inv-date',
            itemsList: 'inv-items-list'
        });


        try {
            const company = await StorageManager.getCompany();
            const isVatPayer = company ? company.isVatPayer : true;

            await IssuerSection.init();
            await PartnerSection.init();
            InvoiceDetails.init();
            ItemsTable.init(isVatPayer);

            this.setupFormToggle();
            this.setupSave();

            Events.on('company-saved', async () => {
                const c = await StorageManager.getCompany();
                if (c) ItemsTable.updateVatRates(!!c.isVatPayer);
            });
            Events.on('company-selected', (c) => c && ItemsTable.updateVatRates(!!c.isVatPayer));
            Events.on('new-invoice-requested', () => this.openNew());
            Events.on('edit-invoice-requested', id => this.editInvoice(id));
            Events.on('duplicate-invoice-requested', id => this.duplicateInvoice(id));
        } catch (e) {
            Toast.show('Napaka pri inicializaciji.', 'error');
        }
    },

    setupFormToggle() {
        const { btnNew, btnCancel, btnClose } = this.els;

        if (btnNew) btnNew.onclick = () => this.openNew();

        const closeForm = () => {
            // Because router (ui.js) handles dirty state checking globally via window hashchange,
            // we don't need a custom confirm here. Just standard navigation back.
            // If there's no history, we fall back to #invoices directly.
            if (window.history.length > 2) {
                history.back();
            } else {
                window.location.hash = 'invoices';
            }
        };

        if (btnCancel) btnCancel.addEventListener('click', closeForm);
        if (btnClose) btnClose.addEventListener('click', closeForm);
    },

    async openNew() {
        const { form } = this.els;

        this._showOverlay();

        // Dinamičen kontekst: Nov račun
        this.setFormContext('Nov račun', 'Izdaj račun');

        try {
            if (form) {
                form.reset();
                delete form.dataset.invoiceId;
                delete form.dataset.invoiceNumber;
                delete form.dataset.dirty;

                // KLJUČNO: Popolnoma resetiramo globalni Store PRED nalaganjem entitet
                Store.resetInvoice();

                // Prekrijemo reset z uporabniško preferenco UPN stikala
                const prefs = await StorageManager.getPrefs();
                if (prefs.defaultIncludeUpn) {
                    Store.state.invoice.includeUpn = true;
                }
            }

            await Promise.all([
                IssuerSection.loadCompanies(),
                PartnerSection.loadPartners()
            ]);

            if (form) {
                this.updateSubmitButton('fa-check', 'Izdaj račun');
                this.setFormContext('Nov račun', 'Izdaj račun');
                ItemsTable.clear();
            }
            this.initEmptyForm();
        } catch (error) {
            console.error('Error opening new invoice form:', error);
            Toast.show('Napaka pri odpiranju obrazca.', 'error');
        }
    },

    hide() {
        const { form } = this.els;

        if (form) {
            form.reset();
            delete form.dataset.invoiceId;
            delete form.dataset.invoiceNumber;
            delete form.dataset.dirty;
            Store.resetInvoice();
            ItemsTable.clear();
        }
    },

    _showOverlay() {
        window.location.hash = 'invoice-form';
        window.scrollTo({ top: 0, behavior: 'instant' });
    },

    initEmptyForm() {
        InvoiceDetails.setSmartDates();
        if (this.els.itemsList && this.els.itemsList.children.length === 0) {
            ItemsTable.addRow();
        }
        this.prefillInvoiceNumber();
    },

    /**
     * Pametno predizpolni številko računa.
     * Poišče najvišjo zaporedno številko v formatu LLLL-MM-NNNNN ali LLLL-NNN
     * in predlaga naslednjo zaporedno.
     */
    async prefillInvoiceNumber() {
        try {
            // Memory optimization: using cursor-based pagination to fetch only latest document numbers without loading memory payload.
            // Limit 50 pokrije robni primer: januar novega leta, ko je zadnjih 50 iz prejšnjega leta
            const numbers = await StorageManager.getLastInvoiceNumbers(50);
            const dateVal = this.els.dateIssue?.value || Utils.getTodayDate();
            const parts = dateVal.split('-');
            const year = parseInt(parts[0], 10);
            const month = parts[1];
            let maxNum = 0;

            numbers.forEach(number => {
                if (!number) return;

                const patterns = [
                    new RegExp(`^${year}-\\d{2}-(\\d+)$`), // YYYY-MM-NNNNN
                    new RegExp(`^${year}-(\\d+)$`)          // YYYY-NNNNN
                ];

                for (const pattern of patterns) {
                    const match = number.match(pattern);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (!isNaN(num)) maxNum = Math.max(maxNum, num);
                        break;
                    }
                }
            });

            const nextNum = maxNum + 1;
            if (this.els.customNumber) {
                this.els.customNumber.value = `${year}-${month}-${String(nextNum).padStart(5, '0')}`;
            }
        } catch (error) {
            console.error('Error prefilling invoice number:', error);
        }
    },

    setupSave() {
        const { form, btnPreview, btnDownload } = this.els;

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleSave();
            });

            if (btnPreview) {
                btnPreview.addEventListener('click', async () => {
                    try {
                        const data = this.getFormData();
                        const validation = Validators.validateInvoice(data);
                        if (!validation.isValid) {
                            validation.errors.forEach(err => Toast.show(err, 'error'));
                            return;
                        }

                        data.number = this.els.customNumber?.value?.trim() || 'PREDOGLED';
                        data.totalAmount = data.grossTotal;
                        const { PdfGenerator } = await import('../pdf-generator.js');
                        PdfGenerator.preview(data);
                    } catch (err) {
                        Toast.show('Napaka pri generiranju predogleda.', 'error');
                    }
                });
            }

            if (btnDownload) {
                btnDownload.addEventListener('click', async () => {
                    try {
                        const data = this.getFormData();
                        const validation = Validators.validateInvoice(data);
                        if (!validation.isValid) {
                            validation.errors.forEach(err => Toast.show(err, 'error'));
                            return;
                        }

                        data.number = this.els.customNumber?.value?.trim() || 'OSNUTEK';
                        data.totalAmount = data.grossTotal;
                        const { PdfGenerator } = await import('../pdf-generator.js');
                        PdfGenerator.generate(data);
                    } catch (err) {
                        Toast.show('Napaka pri prenosu PDF-ja.', 'error');
                    }
                });
            }
        }
    },

    getFormData() {
        return JSON.parse(JSON.stringify(Store.state.invoice));
    },

    async handleSave() {
        const { form, customNumber: customNumberEl, datePaid: datePaidEl } = this.els;
        if (!form) return;

        if (this.isSaving) return;
        this.isSaving = true;

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const formData = this.getFormData();
            const datePaid = datePaidEl?.value || '';

            const validation = Validators.validateInvoice(formData);
            if (!validation.isValid) {
                validation.errors.forEach(err => Toast.show(err, 'error'));
                return;
            }

            const customNumber = customNumberEl ? customNumberEl.value.trim() : '';

            if (!customNumber) {
                Toast.show('Prosimo, vnesite številko računa.', 'error');
                return;
            }

            const editingId = form.dataset.invoiceId;
            const validFormat = /^\d{4}-\d{2}-\d{5}$/.test(customNumber);

            if (!validFormat && !editingId) {
                validation.warnings = validation.warnings || [];
                validation.warnings.push(
                    `Številka računa "${customNumber}" ne ustreza priporočenemu formatu 'Leto-Mesec-Zaporedje' (npr. 2026-03-00001). Prepričajte se, da je pravilna.`
                );
            }

            if (validation.warnings && validation.warnings.length > 0) {
                const proceed = await UI.confirmWarnings(validation.warnings);
                if (!proceed) return;
            }

            // Varnostni popravek: Preprečimo da bi 'id' iz Store-a preglasil ID novega računa
            const { id: _, ...cleanFormData } = formData;

            const invoiceData = {
                id: editingId || undefined, // Če ni editingId, bo StorageManager generiral novega
                ...cleanFormData,
                totalAmount: formData.grossTotal,
                status: datePaid ? 'paid' : 'issued',
                datePaid: datePaid,
                number: customNumber
            };

            // Auto-save new services logic
            await this.autoSaveServices(formData.items);

            await StorageManager.saveInvoice(invoiceData);
            Toast.show(editingId ? 'Račun posodobljen!' : 'Račun uspešno shranjen!', 'success');

            this.hide();
            window.location.hash = 'invoices'; // Preusmeritev na seznam računov po izdaji

            const prefs = await StorageManager.getPrefs();
            prefs.lastUsedCompanyId = formData.companyId;
            prefs.lastUsedPartnerId = formData.partnerId;
            await StorageManager.savePrefs(prefs);

            Events.emit('invoice-saved', invoiceData);
        } catch (error) {
            console.error('Error saving invoice:', error);
            Toast.show('Napaka pri shranjevanju računa.', 'error');
        } finally {
            this.isSaving = false;
            if (submitBtn) submitBtn.disabled = false;
        }
    },

    async autoSaveServices(items) {
        try {
            const existingServices = await StorageManager.getServices();
            let addedNew = false;

            for (const item of items) {
                if (!item.description || !item.description.trim()) continue;

                const exists = existingServices.some(s =>
                    s.name.toLowerCase() === item.description.trim().toLowerCase()
                );

                if (!exists) {
                    const newService = {
                        id: StorageManager.generateId(),
                        name: item.description.trim(),
                        unit: item.unit || 'ura',
                        price: item.price || 0,
                        vatRate: item.vatRate !== undefined ? item.vatRate : 22
                    };
                    await StorageManager.saveService(newService);
                    existingServices.push(newService);
                    addedNew = true;
                }
            }

            if (addedNew) {
                Events.emit('service-saved');
                Toast.show('Nove vpisane storitve so bile uspešno shranjene.', 'info');
            }
        } catch (e) {
            console.warn('Silent failure auto-saving services:', e);
        }
    },

    async editInvoice(id) {
        try {
            // UX: Takoj prikažemo overlay za vizualno povratno informacijo,
            // preden čakamo na IndexedDB odgovore
            this._showOverlay();
            this.setFormContext('Nalaganje...', 'Shrani spremembe');

            const invoice = await StorageManager.getInvoice(id);
            if (!invoice) {
                Toast.show('Račun ni bil najden.', 'error');
                if (window.history.length > 2) {
                    history.back();
                } else {
                    window.location.hash = 'invoices';
                }
                return;
            }

            // Varnostno čiščenje stanja pred nalaganjem podatkov
            Store.resetInvoice();

            await Promise.all([
                IssuerSection.loadCompanies(),
                PartnerSection.loadPartners()
            ]);

            const itemsBackup = invoice.items || [];
            const invoiceCopy = { ...invoice };
            delete invoiceCopy.items;

            Object.assign(Store.state.invoice, invoiceCopy);

            if (this.els.datePaid) this.els.datePaid.value = invoice.datePaid || '';

            ItemsTable.clear();
            itemsBackup.forEach(item => ItemsTable.addRow(item, true));

            const { form } = this.els;
            if (form) {
                form.dataset.invoiceId = invoice.id;
                form.dataset.invoiceNumber = invoice.number;
                delete form.dataset.dirty;

                this.updateSubmitButton('fa-save', 'Shrani spremembe');
            }

            if (this.els.customNumber) this.els.customNumber.value = invoice.number || '';

            // Dinamičen kontekst: Urejanje računa
            const displayNum = invoice.number || `#${id.slice(0, 8)}`;
            this.setFormContext(`Urejanje: ${displayNum}`, 'Shrani spremembe');
        } catch (error) {
            console.error('Error editing invoice:', error);
            Toast.show('Napaka pri nalaganju računa za urejanje.', 'error');
            if (window.history.length > 2) {
                history.back();
            } else {
                window.location.hash = 'invoices';
            }
        }
    },

    async duplicateInvoice(id) {
        try {
            // UX: Takoj prikažemo overlay za vizualno povratno informacijo,
            // preden čakamo na IndexedDB odgovore
            this._showOverlay();
            this.setFormContext('Nalaganje...', 'Izdaj račun');

            const invoice = await StorageManager.getInvoice(id);
            if (!invoice) {
                Toast.show('Račun za kopiranje ni bil najden.', 'error');
                if (window.history.length > 2) {
                    history.back();
                } else {
                    window.location.hash = 'invoices';
                }
                return;
            }

            await Promise.all([
                IssuerSection.loadCompanies(),
                PartnerSection.loadPartners()
            ]);

            const itemsBackup = invoice.items || [];
            const invoiceCopy = { ...invoice };

            // Remove tracking and identity data
            delete invoiceCopy.id;
            delete invoiceCopy.number;
            delete invoiceCopy.status;
            delete invoiceCopy.datePaid;
            delete invoiceCopy.createdAt;
            delete invoiceCopy.updatedAt;
            delete invoiceCopy.items;

            Store.resetInvoice();
            Object.assign(Store.state.invoice, invoiceCopy);

            if (this.els.datePaid) this.els.datePaid.value = '';

            ItemsTable.clear();
            itemsBackup.forEach(item => ItemsTable.addRow(item, true));

            const { form } = this.els;
            if (form) {
                delete form.dataset.invoiceId;
                delete form.dataset.invoiceNumber;
                form.dataset.dirty = 'true';

                this.updateSubmitButton('fa-check', 'Izdaj račun');
            }

            if (this.els.dateIssue) this.els.dateIssue.value = Utils.getTodayDate();
            InvoiceDetails.setSmartDates();
            await this.prefillInvoiceNumber();

            this.setFormContext('Nov račun (kopija)', 'Izdaj račun');
            Toast.show('Podatki so prekopirani. Preverite nov datum in številko.', 'info');
        } catch (error) {
            console.error('Error duplicating invoice:', error);
            Toast.show('Napaka pri podvojevanju računa.', 'error');
            if (window.history.length > 2) {
                history.back();
            } else {
                window.location.hash = 'invoices';
            }
        }
    },

    updateSubmitButton(iconClass, label) {
        const { form } = this.els;
        if (!form) return;
        const submitBtn = form.querySelector('button[type="submit"]');
        if (!submitBtn) return;

        const icon = submitBtn.querySelector('i');
        if (icon) icon.className = `fa-solid ${iconClass}`;

        const labelSpan = submitBtn.querySelector('#btn-save-label');
        if (labelSpan) {
            labelSpan.textContent = label;
        } else {
            // Fallback za stari HTML format
            submitBtn.replaceChildren();
            const newIcon = document.createElement('i');
            newIcon.className = `fa-solid ${iconClass}`;
            newIcon.setAttribute('aria-hidden', 'true');
            submitBtn.append(newIcon, document.createTextNode(` ${label}`));
        }
    },

    /**
     * Nastavi kontekst sub-view obrazca.
     * Posodobi naslov v headerju in tekst gumba za shranjevanje.
     */
    setFormContext(title, saveLabel) {
        if (this.els.formTitle) this.els.formTitle.textContent = title;
        if (this.els.saveLabel) this.els.saveLabel.textContent = saveLabel;
    }
};


import { Utils } from '../../utils.js';
import { Store, INVOICE_DEFAULTS } from '../../store.js';

export const InvoiceDetails = {
    _bindings: [
        { id: 'inv-date', key: 'dateIssued' },
        { id: 'inv-due-date', key: 'dateDue' },
        { id: 'inv-date-service-from', key: 'dateServiceFrom' },
        { id: 'inv-date-service-to', key: 'dateServiceTo' },
        { id: 'inv-ref-model', key: 'referenceModel' },
        { id: 'inv-ref-number', key: 'referenceNumber' },
        { id: 'inv-purpose-code', key: 'purposeCode' },
        { id: 'inv-upn-purpose-code', key: 'upnPurposeCode' },
        { id: 'inv-include-upn-slip', key: 'includeUpn', isCheckbox: true },
        { id: 'inv-notes', key: 'notes' }
    ],

    // DOM Optimization: Prevents repetitive frame-blocking layout thrashing by caching element references synchronously.
    _cachedEls: {},

    init() {
        const upnPanel = document.getElementById('upn-settings-panel');

        // Caching in Two-way binding
        this._bindings.forEach(binding => {
            const el = document.getElementById(binding.id);
            if (el) {
                this._cachedEls[binding.id] = el;
                // DOM to Store
                el.addEventListener('change', (e) => {
                    Store.state.invoice[binding.key] = binding.isCheckbox ? e.target.checked : e.target.value;
                });
                el.addEventListener('input', (e) => {
                    if (!binding.isCheckbox) {
                        Store.state.invoice[binding.key] = e.target.value;
                    }
                });
            }
        });

        // Store → DOM sinhronizacija (klicano na vsak tick, zato uporabimo predpomnilnik)
        Store.subscribe((state) => {
            this._bindings.forEach(binding => {
                const el = this._cachedEls[binding.id];
                if (el) {
                    if (binding.isCheckbox) {
                        if (el.checked !== !!state.invoice[binding.key]) {
                            el.checked = !!state.invoice[binding.key];
                        }
                    } else if (el.value !== state.invoice[binding.key]) {
                        el.value = state.invoice[binding.key] || '';
                    }
                }
            });

            // Toggle UPN panel visibility
            if (upnPanel) {
                if (state.invoice.includeUpn) {
                    upnPanel.classList.remove('hidden');
                } else {
                    upnPanel.classList.add('hidden');
                }
            }
        });
    },

    setSmartDates() {
        const smartDates = Utils.getSmartDates();

        // Update Store instead of DOM directly. 
        // The subscribe listener will auto-update the DOM.
        Store.state.invoice.dateIssued = smartDates.issueDate;
        Store.state.invoice.dateDue = smartDates.dueDate;
        Store.state.invoice.dateServiceFrom = smartDates.periodFrom;
        Store.state.invoice.dateServiceTo = smartDates.periodTo;
    },

    clear() {
        // Uporabi INVOICE_DEFAULTS za vse privzete vrednosti (DRY)
        this._bindings.forEach(binding => {
            if (binding.isCheckbox) {
                Store.state.invoice[binding.key] = !!INVOICE_DEFAULTS[binding.key];
            } else {
                Store.state.invoice[binding.key] = INVOICE_DEFAULTS[binding.key] ?? '';
            }
        });
    }
};

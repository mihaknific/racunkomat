import { StorageManager } from '../../modules/StorageManager.js';
import { Utils } from '../../utils.js';
import { Toast } from '../toast.js';
import { Events } from '../../event-bus.js';
import { Store } from '../../store.js';

export const ItemsTable = {
    isVatPayer: true,
    _controller: null,
    _els: {
        totalDisplay: null
    },

    _updateIndexes() {
        const rows = document.querySelectorAll('.item-row');
        rows.forEach((r, idx) => {
            const display = r.querySelector('.item-index-display');
            if (display) display.textContent = `#${idx + 1}`;
        });
    },

    init(isVatPayer = true) {
        this.isVatPayer = isVatPayer;
        this._els.totalDisplay = document.getElementById('inv-total-display');

        // Cleanly remove all previous listeners via AbortController
        if (this._controller) this._controller.abort();
        this._controller = new AbortController();
        const signal = this._controller.signal;

        const btnAdd = document.getElementById('btn-add-item');
        if (btnAdd) {
            btnAdd.addEventListener('click', () => this.addRow(), { signal });
        }

        const itemsContainer = document.getElementById('inv-items-list');
        if (itemsContainer) {
            itemsContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action="remove-item"]');
                if (!btn) return;
                
                const row = btn.closest('.item-row');
                const rowId = btn.dataset.id;
                if (!row || !rowId) return;

                const doRemove = () => {
                    row.remove();
                    Store.state.invoice.items = Store.state.invoice.items.filter(i => i.id !== rowId);
                    ItemsTable._updateIndexes();
                };
                doRemove();
            }, { signal });
        }
        
        this.loadServicesDatalist();

        // Listen to global changes to update datalist without reloading page
        Events.on('service-saved', () => this.loadServicesDatalist());

        // React to Store changes (calculate totals)
        Store.subscribe((state) => {
            this.recalculateTotalFromStore(state);
        });
    },

    async loadServicesDatalist() {
        const datalist = document.getElementById('datalist-services');
        if (!datalist) return;
        try {
            const services = await StorageManager.getServices();
            datalist.replaceChildren();
            services.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.name;
                datalist.appendChild(opt);
            });
        } catch (err) { console.error('Failed to load services datalist', err); }
    },

    updateVatRates(isVatPayer) {
        this.isVatPayer = isVatPayer;
        
        // Pure Reactivity: Update the Store only. The subscriber (recalculateTotalFromStore) 
        // and a subsequent UI refresh will handle the details, preventing manual DOM drift.
        Store.state.invoice.items.forEach(item => {
            item.vatRate = isVatPayer ? 22 : 0;
            // No manual DOM updates here. Let the reactive cycle handle it.
        });
        
        // Explicitly trigger a refresh of row displays to match new rates
        this.refreshRowDisplays();
    },

    refreshRowDisplays() {
        document.querySelectorAll('.item-row').forEach(row => {
            const rowId = row.dataset.id;
            const item = Store.state.invoice.items.find(i => i.id === rowId);
            if (!item) return;

            const vatSelect = row.querySelector('.item-vat');
            if (vatSelect) vatSelect.value = item.vatRate;

            const netoEl = row.querySelector('.item-neto');
            const vatAmtEl = row.querySelector('.item-vat-amount');
            const totalEl = row.querySelector('.item-total');

            const net = Utils.safeMul(item.quantity, item.price);
            if (netoEl) netoEl.value = Utils.formatCurrency(net).replace(/\s*€/g, '');
            if (vatAmtEl) vatAmtEl.value = Utils.formatCurrency(item.vatAmount).replace(/\s*€/g, '');
            if (totalEl) totalEl.value = Utils.formatCurrency(item.total).replace(/\s*€/g, '');
        });
    },

    addRow(itemData = null, preventTransition = false) {
        const container = document.getElementById('inv-items-list');
        const template = document.getElementById('template-invoice-item-row');
        if (!container || !template) return;

        const clone = template.content.cloneNode(true);
        const row = clone.querySelector('.item-row');
        
        // Unikatni ID za povezavo DOM-a s shrambo (DOM -> Store)
        const rowId = crypto.randomUUID();
        row.dataset.id = rowId;

        const descInput = row.querySelector('.item-desc');
        const qtyInput = row.querySelector('.item-qty');
        const unitInput = row.querySelector('.item-unit');
        const priceInput = row.querySelector('.item-price');
        const vatSelect = row.querySelector('.item-vat');
        const netoOutput = row.querySelector('.item-neto');
        const vatAmountOutput = row.querySelector('.item-vat-amount');
        const removeBtn = row.querySelector('.btn-remove-item');

        const defaultVat = this.isVatPayer ? 22 : 0;
        const initItem = {
            id: rowId,
            description: itemData ? (itemData.description || '') : '',
            quantity: itemData ? (itemData.quantity || 1) : 1,
            unit: itemData ? (itemData.unit || 'kos') : 'kos',
            price: itemData ? (itemData.price || 0) : 0,
            vatRate: itemData && itemData.vatRate !== undefined ? itemData.vatRate : defaultVat,
            vatAmount: 0,
            total: 0
        };

        descInput.value = initItem.description;
        qtyInput.value = initItem.quantity;
        if (unitInput) unitInput.value = initItem.unit;
        priceInput.value = initItem.price || '';
        vatSelect.value = initItem.vatRate;

        Store.state.invoice.items.push(initItem);

        const updateStoreFromRow = () => {
            const target = Store.state.invoice.items.find(i => i.id === rowId);
            if (!target) return;
            
            target.description = descInput.value;
            target.quantity = parseFloat(qtyInput.value) || 0;
            if (unitInput) target.unit = unitInput.value;
            target.price = parseFloat(priceInput.value) || 0;
            target.vatRate = parseFloat(vatSelect.value) || 0;
            
            const net = Utils.safeMul(target.quantity, target.price);
            target.vatAmount = Utils.fromCents(Math.round(Utils.toCents(net) * (target.vatRate / 100)));
            target.total = Utils.safeAdd(net, target.vatAmount);
            
            // Live DOM updates for read-only fields
            if (netoOutput) netoOutput.value = Utils.formatCurrency(net).replace(/\s*€/g, '');
            if (vatAmountOutput) vatAmountOutput.value = Utils.formatCurrency(target.vatAmount).replace(/\s*€/g, '');
            
            const totalInput = row.querySelector('.item-total');
            if (totalInput) totalInput.value = Utils.formatCurrency(target.total).replace(/\s*€/g, '');
            
            ItemsTable._updateIndexes();

            // Opomba: Ker updejtamo Store array item (in ker uporablja recursive Proxy),  
            // se bo sprožil klic Store.subscribe(), ki bo izračunal globalni Total.
        };

        // UI Architecture: Programmatic dropdown to bypass native <datalist> strict focus limitations and guarantee immediate dropdown visibility.
        // Nativni <datalist> ne podpira zanesljivega prikaza ob prvem kliku,
        // zato gradimo lasten dropdown, ki se prikaže takoj ob fokusu.
        const descWrapper = descInput.closest('.item-col-desc');
        if (descWrapper) descWrapper.style.position = 'relative';

        const dropdown = document.createElement('div');
        dropdown.className = 'service-autocomplete-dropdown';
        dropdown.style.display = 'none';
        if (descWrapper) descWrapper.appendChild(dropdown);

        let acHighlight = -1; // trenutno označena opcija v dropdownu

        const showDropdown = async () => {
            const services = await StorageManager.getServices();
            const query = descInput.value.toLowerCase().trim();
            const filtered = (query
                ? services.filter(s => s.name.toLowerCase().includes(query))
                : services
            ).sort((a, b) => a.name.localeCompare(b.name, 'sl'));

            if (filtered.length === 0) {
                dropdown.style.display = 'none';
                return;
            }

            acHighlight = -1;
            dropdown.replaceChildren();
            filtered.forEach((s, idx) => {
                const item = document.createElement('div');
                item.className = 'service-ac-item';
                item.dataset.index = idx;
                item.textContent = s.name;
                if (s.price) {
                    const price = document.createElement('span');
                    price.className = 'service-ac-price';
                    price.textContent = ` — ${Utils.formatCurrency(s.price)}`;
                    item.appendChild(price);
                }
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // prepreči blur pred izbiro
                    selectService(s);
                });
                dropdown.appendChild(item);
            });
            dropdown.style.display = '';
        };

        const hideDropdown = () => {
            dropdown.style.display = 'none';
            acHighlight = -1;
        };

        const selectService = (service) => {
            descInput.value = service.name;
            if (service.unit && unitInput) unitInput.value = service.unit;
            priceInput.value = service.price || '';
            if (service.vatRate !== undefined && vatSelect) {
                vatSelect.value = service.vatRate;
            }
            hideDropdown();
            updateStoreFromRow();
        };

        descInput.addEventListener('focus', () => showDropdown());
        descInput.addEventListener('click', () => showDropdown());
        descInput.addEventListener('blur', () => hideDropdown());

        descInput.addEventListener('input', () => {
            showDropdown();
            updateStoreFromRow();
        });

        // Tipkovnica: puščice gor/dol + enter za izbiro
        descInput.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.service-ac-item');
            if (!items.length || dropdown.style.display === 'none') return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                acHighlight = Math.min(acHighlight + 1, items.length - 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                acHighlight = Math.max(acHighlight - 1, 0);
            } else if (e.key === 'Enter' && acHighlight >= 0) {
                e.preventDefault();
                items[acHighlight]?.dispatchEvent(new Event('mousedown'));
                return;
            } else if (e.key === 'Escape') {
                hideDropdown();
                return;
            } else {
                return;
            }

            items.forEach((it, i) => {
                it.classList.toggle('highlighted', i === acHighlight);
                if (i === acHighlight) it.scrollIntoView({ block: 'nearest' });
            });
        });

        [qtyInput, priceInput, vatSelect, unitInput].forEach(input => {
            if (input) input.addEventListener('input', updateStoreFromRow);
        });

        if (removeBtn) {
            removeBtn.dataset.action = 'remove-item';
            removeBtn.dataset.id = rowId;
        }

        container.appendChild(row);
        updateStoreFromRow();
        ItemsTable._updateIndexes();
    },

    recalculateTotalFromStore(state) {
        // High-Precision Synchronization: Update row-level calculations in the Store 
        // to ensure individual object properties match the global totals.
        (state.invoice.items || []).forEach(item => {
            const net = Utils.safeMul(item.quantity || 0, item.price || 0);
            const rate = this.isVatPayer ? (parseFloat(item.vatRate) || 0) : 0;
            const vat = Utils.fromCents(Math.round(Utils.toCents(net) * (rate / 100)));
            const gross = Utils.safeAdd(net, vat);

            if (item.vatAmount !== vat) item.vatAmount = vat;
            if (item.total !== gross) item.total = gross;
        });

        // Accounting Architecture: Delegating complex VAT grouping and rounding logic back to Utils.
        // This guarantees that the UI totals and PDF totals are analytically identical.
        const totals = Utils.calculateTotals(state.invoice.items, this.isVatPayer);
        
        // Synchronization: Inject calculated values back into Store (triggers subscription updates if changed).
        if (state.invoice.netTotal !== totals.netTotal) state.invoice.netTotal = totals.netTotal;
        if (state.invoice.vatTotal !== totals.vatTotal) state.invoice.vatTotal = totals.vatTotal;
        if (state.invoice.grossTotal !== totals.grossTotal) state.invoice.grossTotal = totals.grossTotal;

        if (this._els.totalDisplay) {
            this._els.totalDisplay.textContent = Utils.formatCurrency(totals.grossTotal);
            // A11y: Ensure dynamic changes are announced to technology-assisted users.
            this._els.totalDisplay.setAttribute('aria-live', 'polite');
        }
    },

    // Reactive Engine: manual calculateTotal() invocation removed. Native Proxy handlers manage mutation triggers identically.
    // samodejno proži recalculateTotalFromStore() ob vsaki spremembi items[].

    clear() {
        const container = document.getElementById('inv-items-list');
        if (container) container.replaceChildren();
        Store.state.invoice.items = [];
    }
};

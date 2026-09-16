import { UI } from '../ui.js';
import { Events } from '../event-bus.js';
import { Utils } from '../utils.js';
import { StorageManager } from '../modules/StorageManager.js';
import { Toast } from './toast.js';
import { Component } from '../modules/Component.js';
import { PdfGenerator } from '../pdf-generator.js';

export const InvoiceList = {
    currentSort: { field: 'dateIssued', dir: 'desc' },
    currentPage: 1,
    itemsPerPage: 15,
    els: {},

    init() {
        Component.init(this, {
            tbody: 'invoices-table-body',
            tableContainer: '#invoices-list-container .table-container',
            filterTrigger: '.collapsible-trigger',
            filterContent: '.collapsible-content',
            resetBtn: 'resetFiltersBtn',
            template: 'template-invoice-table-row',
            partnerSelect: 'filterPartner',
            searchTerm: 'filterSearchTerm',
            status: 'filterStatus',
            dateFrom: 'filterDateFrom',
            dateTo: 'filterDateTo',
            amountFrom: 'filterAmountFrom',
            amountTo: 'filterAmountTo'
        });

        this.setupFilters();
        this.setupItemActionDelegation();
        
        Events.on('invoice-saved', () => { this.currentPage = 1; this.render(); });
        Events.on('invoice-deleted', () => this.render());
        Events.on('partner-saved', () => this.updateFilterDropdowns());
        Events.on('data-cleared', () => { this.currentPage = 1; this.render(); });

        this.render();
    },



    setupFilters() {
        const { filterTrigger, filterContent, resetBtn } = this.els;
        const filters = ['searchTerm', 'partnerSelect', 'status', 'dateFrom', 'dateTo', 'amountFrom', 'amountTo'];

        if (filterTrigger && filterContent) {
            filterTrigger.onclick = (e) => {
                e.stopPropagation();
                const expanded = filterTrigger.getAttribute('aria-expanded') === 'true';
                filterTrigger.setAttribute('aria-expanded', !expanded);
                filterContent.setAttribute('aria-hidden', expanded);
                filterContent.classList.toggle('is-expanded', !expanded);
            };
        }

        filters.forEach(key => {
            const el = this.els[key];
            if (el) {
                const update = () => { this.currentPage = 1; this.render(); };
                el.oninput = update;
                el.onchange = update;
            }
        });

        if (resetBtn) {
            resetBtn.onclick = () => {
                filters.forEach(key => { if (this.els[key]) this.els[key].value = ''; });
                this.currentPage = 1;
                this.render();
            };
        }

        document.querySelectorAll('.sortable-header').forEach(th => {
            th.onclick = () => this.setSort(th.dataset.sortKey);
        });
    },

    setSort(field) {
        if (this.currentSort.field === field) {
            this.currentSort.dir = this.currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSort.field = field;
            this.currentSort.dir = 'asc';
        }
        this.currentPage = 1;
        this.render();
    },

    async updateFilterDropdowns() {
        const { partnerSelect } = this.els;
        if (partnerSelect) {
            try {
                const partners = await StorageManager.getPartners();
                const currentVal = partnerSelect.value;
                
                partnerSelect.replaceChildren();
                const defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.textContent = 'Vsi plačniki';
                partnerSelect.appendChild(defaultOpt);

                partners
                    .sort((a, b) => Utils.compareStrings(a.name, b.name))
                    .forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.id;
                        opt.textContent = p.name || 'Neznan partner';
                        partnerSelect.appendChild(opt);
                    });

                partnerSelect.value = currentVal;
            } catch (err) {
                console.error('Error updating filter dropdowns:', err);
            }
        }
    },

    async render() {
        const { tbody, tableContainer, filters, template } = this.els;
        if (!tbody || !template) return;

        try {
            // Show skeletons if first load or empty
            if (this.currentPage === 1 && tbody.children.length === 0) {
                const skeletonTpl = document.getElementById('template-skeleton-row');
                if (skeletonTpl) {
                    const frag = document.createDocumentFragment();
                    for (let i = 0; i < 5; i++) {
                        frag.appendChild(skeletonTpl.content.cloneNode(true));
                    }
                    tbody.replaceChildren(frag);
                }
            }

            const partners = await StorageManager.getPartners();
            const partnerMap = {};
            partners.forEach(p => partnerMap[p.id] = p.name);

            // Data Fetching: Cursor iteration bypasses massive memory allocations associated with classic .getAll() + .filter() anti-patterns.
            const result = await StorageManager.searchFilteredInvoices({
                filters: {
                    searchTerm: this.els.searchTerm?.value,
                    partner: this.els.partnerSelect?.value,
                    status: this.els.status?.value,
                    dateFrom: this.els.dateFrom?.value,
                    dateTo: this.els.dateTo?.value,
                    amountFrom: this.els.amountFrom?.value,
                    amountTo: this.els.amountTo?.value
                },
                sortField: this.currentSort.field,
                sortDir: this.currentSort.dir,
                limit: this.currentPage * this.itemsPerPage,
                partnerMap: partnerMap
            });

            const invoices = result.invoices;
            const totalFiltered = result.totalComputed;

            // --- VISIBILITY ---
            if (tableContainer) tableContainer.classList.remove('hidden');

            // --- SORTING UI ---
            document.querySelectorAll('th.sortable-header').forEach(th => {
                th.removeAttribute('aria-sort');
                if (th.dataset.sortKey === this.currentSort.field) {
                    th.setAttribute('aria-sort', this.currentSort.dir === 'asc' ? 'ascending' : 'descending');
                }
            });

            // --- RENDERING ---
            if (invoices.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 8;
                td.className = 'u-p-0';
                td.appendChild(Utils.renderEmptyState(
                    'Ni najdenih računov', 
                    'Ustvarite svoj prvi račun s klikom na gumb Novo zgoraj.',
                    'fa-file-invoice'
                ));
                tr.appendChild(td);
                tbody.replaceChildren(tr);
                return;
            }

            const fragment = document.createDocumentFragment();
            invoices.forEach(inv => {
                const clone = template.content.cloneNode(true);
                const tr = clone.querySelector('tr');
                
                tr.querySelector('.inv-number').textContent = `#${inv.number}`;
                tr.querySelector('.inv-partner').textContent = partnerMap[inv.partnerId] || 'Neznan';
                tr.querySelector('.inv-date').textContent = Utils.formatDate(inv.dateIssued);
                
                const netAmount = inv.netTotal !== undefined ? inv.netTotal : (inv.totalAmount || 0);
                const grossAmount = inv.grossTotal !== undefined ? inv.grossTotal : (inv.totalAmount || 0);
                
                tr.querySelector('.inv-net-amount').textContent = Utils.formatCurrency(netAmount);
                tr.querySelector('.inv-gross-amount').textContent = Utils.formatCurrency(grossAmount);
                
                const statusBtn = tr.querySelector('.badge-status-btn');
                const statusIcon = statusBtn.querySelector('i');
                const statusLabel = statusBtn.querySelector('.status-text');
                
                const isPaid = inv.status === 'paid';
                statusBtn.classList.add(isPaid ? 'bg-success' : 'bg-warning');
                statusIcon.classList.add('fa-solid', isPaid ? 'fa-circle-check' : 'fa-circle');
                statusLabel.textContent = isPaid ? 'Plačano' : 'Odprto';
                statusBtn.title = isPaid ? 'Označi kot neplačano' : 'Označi kot plačano';
                
                // Add IDs for actions
                tr.querySelectorAll('[data-id]').forEach(el => el.dataset.id = inv.id);
                const deleteBtn = tr.querySelector('.btn-delete-invoice');
                if (deleteBtn) deleteBtn.dataset.number = inv.number;

                fragment.appendChild(tr);
            });

            tbody.replaceChildren(fragment);

            // Infinite Scroll / Load more sentinel
            if (totalFiltered > invoices.length) {
                const loadMoreRow = document.createElement('tr');
                const loadMoreTd = document.createElement('td');
                loadMoreTd.colSpan = 8;
                loadMoreTd.className = 'text-center-box text-muted u-p-lg';
                
                const spinner = document.createElement('i');
                spinner.className = 'fa-solid fa-circle-notch fa-spin u-me-2';
                spinner.setAttribute('aria-hidden', 'true');
                
                loadMoreTd.appendChild(spinner);
                loadMoreTd.appendChild(document.createTextNode(' Nalaganje...'));
                loadMoreRow.appendChild(loadMoreTd);
                tbody.appendChild(loadMoreRow);

                if (this.io) this.io.disconnect();
                this.io = new IntersectionObserver((entries) => {
                    if (entries[0].isIntersecting) {
                        this.io.disconnect();
                        this.currentPage++;
                        this.render();
                    }
                }, { rootMargin: '150px' });
                
                this.io.observe(loadMoreRow);
            }
        } catch (error) {
            console.error('Error rendering invoice list:', error);
            const errRow = document.createElement('tr');
            const errTd = document.createElement('td');
            errTd.colSpan = 8;
            errTd.className = 'text-center u-p-lg danger';
            errTd.textContent = 'Napaka pri nalaganju podatkov.';
            errRow.appendChild(errTd);
            tbody.replaceChildren(errRow);
        }
    },

    setupItemActionDelegation() {
        Component.delegate(this.els.tbody, {
            'toggle-status': (id) => this.toggleInvoiceStatus(id),
            'edit-invoice': (id) => Events.emit('edit-invoice-requested', id),
            'duplicate-invoice': (id) => Events.emit('duplicate-invoice-requested', id),
            'print-invoice': (id) => PdfGenerator.generate(id),
            'delete-invoice': async (id, btn) => {
                const number = btn.dataset.number || '';
                const confirmed = await UI.confirmAction('Brisanje računa', `Ali želite izbrisati račun #${number}?`, 'Izbriši');
                if (confirmed) {
                    await StorageManager.deleteInvoice(id);
                    Events.emit('invoice-deleted', { id });
                    Toast.show('Račun izbrisan.', 'success');
                }
            }
        });
    },

    async toggleInvoiceStatus(invoiceId) {
        const invoice = await StorageManager.getInvoice(invoiceId);
        if (!invoice) return;

        invoice.status = invoice.status === 'paid' ? 'unpaid' : 'paid';
        if (invoice.status === 'paid' && !invoice.datePaid) {
            invoice.datePaid = Utils.getTodayDate();
        } else if (invoice.status === 'unpaid') {
            invoice.datePaid = null;
        }

        await StorageManager.saveInvoice(invoice);
        Events.emit('invoice-saved', invoice);
        this.render();
        Toast.show(`Račun #${invoice.number} označen kot ${invoice.status === 'paid' ? 'plačan' : 'neplačan'}`, 'success');
    }
};

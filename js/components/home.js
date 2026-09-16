import { Utils } from '../utils.js';
import { Events } from '../event-bus.js';
import { StorageManager } from '../modules/StorageManager.js';
import { Component } from '../modules/Component.js';

export const Home = {
    init() {
        Component.init(this, {
            annualRevenue: 'home-annual-revenue',
            overdueAmount: 'home-overdue-amount',
            recentContainer: 'home-recent-invoices',
            actionGrid: 'home-action-grid'
        });

        this.initHomeActions();
        
        Events.on('invoice-saved', () => this.refresh());
        Events.on('invoice-deleted', () => this.refresh());
        Events.on('data-cleared', () => {
            this.updateStats();
            this.els.recentContainer?.replaceChildren();
        });
    },

    refresh() {
        this.updateStats();
        this.populateRecent();
    },

    async updateStats() {
        const stats = await StorageManager.getAggregatedStats();
        const { annualRevenue, overdueAmount } = this.els;

        if (annualRevenue) {
            annualRevenue.textContent = Utils.formatCurrency(stats.annualRevenue);
            annualRevenue.classList.remove('skeleton');
        }

        if (overdueAmount) {
            if (stats.overdueCount > 0) {
                const frag = document.createDocumentFragment();
                frag.appendChild(document.createTextNode(Utils.formatCurrency(stats.unpaidTotal) + ' '));
                const extra = document.createElement('span');
                extra.className = 'stat-extra';
                extra.textContent = `(Zapadlih računov: ${stats.overdueCount})`;
                frag.appendChild(extra);
                overdueAmount.replaceChildren(frag);
            } else {
                overdueAmount.textContent = Utils.formatCurrency(stats.unpaidTotal);
            }
            overdueAmount.classList.remove('skeleton');
        }
    },

    initHomeActions() {
        const { actionGrid, recentContainer } = this.els;

        if (actionGrid && !actionGrid.dataset.initialized) {
            Component.delegate(actionGrid, {
                'new-invoice': () => {
                    Events.emit('new-invoice-requested');
                },
                'view-analytics': () => {
                    window.location.hash = 'analytics';
                }
            });
            actionGrid.dataset.initialized = "true";
        }
        
        if (recentContainer && !recentContainer.dataset.initialized) {
            recentContainer.onclick = (e) => {
                const card = e.target.closest('.invoice-card');
                if (!card?.dataset.id) return;
                window.location.hash = 'invoices';
                Events.emit('edit-invoice-requested', card.dataset.id);
            };
            recentContainer.dataset.initialized = "true";
        }

        this.refresh();
    },

    async populateRecent() {
        const { recentContainer } = this.els;
        if (!recentContainer) return;

        try {
            const [recent, partners] = await Promise.all([
                StorageManager.getInvoices(5, 0),
                StorageManager.getPartners()
            ]);

            if (recent.length === 0) {
                recentContainer.replaceChildren(Utils.renderEmptyState('Ni računov', 'Novo zgoraj.', 'fa-file-invoice'));
                return;
            }

            const pMap = Object.fromEntries(partners.map(p => [p.id, p.name]));
            const template = document.getElementById('template-recent-invoice-card');
            if (!template) return;

            recentContainer.replaceChildren();
            recent.forEach(inv => {
                const clone = template.content.cloneNode(true);
                const card = clone.querySelector('.invoice-card');
                if (!card) return;

                card.dataset.id = inv.id;

                const numEl = card.querySelector('.inv-number');
                if (numEl) numEl.textContent = `#${inv.number}`;

                const partEl = card.querySelector('.inv-partner');
                if (partEl) partEl.textContent = pMap[inv.partnerId] || 'Neznan';

                const amountEl = card.querySelector('.inv-amount-val');
                if (amountEl) amountEl.textContent = Utils.formatCurrency(inv.totalAmount);

                const badge = card.querySelector('.inv-status-badge');
                if (badge) {
                    const isPaid = inv.status === 'paid';
                    badge.className = `inv-status-badge badge ${isPaid ? 'bg-success' : 'bg-warning'}`;
                    badge.textContent = isPaid ? 'Plačano' : 'Odprto';
                }
                recentContainer.appendChild(clone);
            });
        } catch (error) {
            console.error('Home: Napaka pri nalaganju nedavnih računov:', error);
            recentContainer.replaceChildren(
                Utils.renderEmptyState('Napaka pri nalaganju', 'Poskusite osvežiti stran.', 'fa-exclamation-triangle')
            );
        }
    }
};

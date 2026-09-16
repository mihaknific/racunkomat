import { Utils } from '../utils.js';
import { Events } from '../event-bus.js';
import { StorageManager } from '../modules/StorageManager.js';
import { Component } from '../modules/Component.js';
import { LazyLoader } from '../modules/LazyLoader.js';

export const Analytics = {
    charts: {
        revenueMonth: null,
        revenueStructure: null
    },
    selectedYear: new Date().getFullYear(),
    els: {},

    init() {
        Component.init(this, {
            yearSelect: 'analytics-year',
            dateTypeSelect: 'furs-date-type',
            fursContainer: 'furs-report-content',
            fursGrid: 'furs-report-grid',
            kpiTotal: 'stat-total-revenue',
            kpiPaid: 'stat-paid-revenue',
            kpiOpen: 'stat-open-revenue'
        });
        
        if (this.els.yearSelect) {
            this.els.yearSelect.onchange = (e) => {
                this.selectedYear = parseInt(e.target.value);
                this.updateDashboard();
            };
        }

        if (this.els.dateTypeSelect) {
            this.els.dateTypeSelect.onchange = () => this.updateDashboard();
        }

        Events.on('invoice-saved', () => this.updateDashboard());
        Events.on('invoice-deleted', () => this.updateDashboard());
        Events.on('data-cleared', () => this.updateDashboard());
        
        this.updateDashboard();
    },



    async updateDashboard() {
        try {
            this.showSkeletons();
            const year = this.selectedYear;

            // 1. Populate Year Dropdown — cursor, brez nalaganja vseh računov
            const years = await StorageManager.getDistinctYears();
            this.populateYearDropdown(years);

            // 2. Pridobi agregirane statistike za izbrano leto (cursor-based)
            const stats = await StorageManager.getAggregatedStats(year);

            // 3. Render Charts
            this.renderCharts(stats, year);

            // 4. Update Analytics-specific KPI cards
            this.updateAnalyticsKPIs(stats);

            // 5. FURS Report zahteva item-level DDV podatke
            // Performance: Uses native IDBKeyRange binary tree indexing for O(logN + M) search instead of O(N) full table scan.
            // Za dateService/datePaid moramo naložiti vse, ker teh datumov nimamo v indexu
            const dateType = this.els.dateTypeSelect?.value || 'dateIssued';
            const yearInvoices = dateType === 'dateIssued'
                ? await StorageManager.getInvoicesByYear(year)
                : await StorageManager.getInvoices();
            this.renderFursReport(yearInvoices, year);

        } catch (error) {
            console.error('Error updating dashboard:', error);
        }
    },

    showSkeletons() {
        const kpis = [this.els.kpiTotal, this.els.kpiPaid, this.els.kpiOpen];
        kpis.forEach(el => {
            if (el) {
                const span = document.createElement('span');
                span.className = 'skeleton skeleton-inline-lg';
                el.replaceChildren(span);
            }
        });

        if (this.els.fursGrid) {
            this.els.fursGrid.replaceChildren();
            for (let i = 0; i < 4; i++) {
                const skeleton = document.createElement('div');
                skeleton.className = 'skeleton skeleton-chart-box';
                this.els.fursGrid.appendChild(skeleton);
            }
        }
    },

    // Data flow optimization: Pass aggregated DTO instead of full entity lists to prevent duplicated iteration.
    updateAnalyticsKPIs(stats) {
        if (this.els.kpiTotal) this.els.kpiTotal.textContent = Utils.formatCurrency(stats.annualRevenue);
        if (this.els.kpiPaid) this.els.kpiPaid.textContent = Utils.formatCurrency(stats.paidTotal);
        if (this.els.kpiOpen) this.els.kpiOpen.textContent = Utils.formatCurrency(stats.openTotal);
    },

    // Payload minimization: Receiver expects an array of primitives instead of heavy entity models.
    populateYearDropdown(years) {
        const { yearSelect } = this.els;
        if (!yearSelect) return;

        yearSelect.replaceChildren();
        years.forEach(y => {
            const option = document.createElement('option');
            option.value = y;
            option.textContent = y;
            if (y === this.selectedYear) option.selected = true;
            yearSelect.appendChild(option);
        });
    },

    async renderCharts(stats, year) {
        try {
            await LazyLoader.loadChart();
            this.renderBarChart(stats.byMonth, year);
            this.renderPieChart(stats.paidTotal, stats.openTotal);
        } catch (err) {
            console.error('Chart rendering failed:', err);
        }
    },

    renderBarChart(data, year) {
        const id = 'chart-revenue-month';
        let canvas = document.getElementById(id);
        if (!canvas) return;

        if (canvas.tagName !== 'CANVAS') {
            const newCanvas = document.createElement('canvas');
            newCanvas.id = id;
            canvas.parentElement.replaceChild(newCanvas, canvas);
            canvas = newCanvas;
        }

        if (this.charts.revenueMonth) this.charts.revenueMonth.destroy();
        this.charts.revenueMonth = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'],
                datasets: [{
                    label: `Prihodki ${year} (€)`,
                    data: data,
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
    },

    renderPieChart(paid, open) {
        const id = 'chart-revenue-structure';
        let canvas = document.getElementById(id);
        if (!canvas) return;

        if (canvas.tagName !== 'CANVAS') {
            const newCanvas = document.createElement('canvas');
            newCanvas.id = id;
            canvas.parentElement.replaceChild(newCanvas, canvas);
            canvas = newCanvas;
        }

        const isEmpty = (paid === 0 && open === 0);

        if (this.charts.revenueStructure) this.charts.revenueStructure.destroy();
        this.charts.revenueStructure = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: isEmpty ? ['Plačano (ni prometa)', 'Odprto (ni prometa)'] : ['Plačano', 'Odprto'],
                datasets: [{
                    data: isEmpty ? [50, 50] : [paid, open],
                    backgroundColor: isEmpty ? ['rgba(34, 197, 94, 0.15)', 'rgba(234, 179, 8, 0.15)'] : ['#22c55e', '#eab308'],
                    borderWidth: 0
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                cutout: '70%', 
                plugins: { 
                    legend: { position: 'bottom' },
                    tooltip: { enabled: !isEmpty } 
                } 
            }
        });
    },

    renderFursReport(invoices, year) {
        const { fursContainer, fursGrid, dateTypeSelect } = this.els;
        if (!fursContainer || !fursGrid) return;

        const dateType = dateTypeSelect?.value || 'dateIssued';

        const filtered = invoices.filter(inv => {
            const dateVal = dateType === 'dateService' ? inv.dateServiceTo : inv[dateType];
            if (!dateVal) return false;
            return new Date(dateVal).getFullYear() === year;
        });

        let totalGross = 0, totalNet = 0, totalVat = 0, paidCount = 0, openCount = 0;

        filtered.forEach(inv => {
            totalGross = Utils.safeAdd(totalGross, inv.totalAmount);
            if (inv.status === 'paid') paidCount++;
            else openCount++;
            
            (inv.items || []).forEach(item => {
                const itemNet = Utils.safeMul(item.quantity, item.price);
                totalNet = Utils.safeAdd(totalNet, itemNet);
                totalVat = Utils.safeAdd(totalVat, (item.vatAmount || 0));
            });
        });

        const dateLabel = {
            'dateIssued': 'datuma izdaje',
            'dateService': 'datuma opravljene storitve (do)',
            'datePaid': 'datuma plačila'
        }[dateType] || 'datuma izdaje';

        // Update Intro
        let introEl = fursContainer.querySelector('.furs-intro');
        if (!introEl) {
            introEl = document.createElement('p');
            introEl.className = 'text-muted furs-intro';
            fursContainer.prepend(introEl);
        }
        introEl.replaceChildren(
            document.createTextNode('Povzetek za leto '),
            (() => { const s = document.createElement('strong'); s.textContent = year; return s; })(),
            document.createTextNode(' glede na '),
            (() => { const s = document.createElement('strong'); s.textContent = dateLabel; return s; })(),
            document.createTextNode('.')
        );
        
        // Hide placeholder
        const placeholder = fursContainer.querySelector('.furs-intro-placeholder');
        if (placeholder) placeholder.classList.add('hidden');

        fursGrid.replaceChildren();

        const template = document.getElementById('template-stat-card');
        if (!template) return;

        const addStat = (title, value, colorClass, extra = '', tooltip = '', iconClass = '') => {
            const clone = template.content.cloneNode(true);
            const card = clone.querySelector('.stat-card');
            
            card.classList.add(colorClass || 'purple');
            card.querySelector('.stat-title').textContent = title;
            card.querySelector('.stat-value').textContent = value;
            card.querySelector('.stat-value').value = value;
            card.querySelector('.stat-card-footer').textContent = extra;
            
            const icon = card.querySelector('.fa-solid');
            if (iconClass) {
                icon.className = `fa-solid ${iconClass}`;
            } else {
                icon.remove();
            }

            if (tooltip) {
                const infoBtn = card.querySelector('.btn-stat-info');
                infoBtn.setAttribute('data-title', title);
                infoBtn.setAttribute('data-desc', tooltip);
            } else {
                card.querySelector('.btn-stat-info').remove();
            }

            fursGrid.appendChild(clone);
        };

        addStat('Skupaj bruto', Utils.formatCurrency(totalGross), 'blue', 'Celoten znesek v obdobju', 'Celoten bruto znesek izdanih računov v izbranem obdobju.', 'fa-euro-sign');
        addStat('Skupaj neto', Utils.formatCurrency(totalNet), 'green', 'Znesek brez DDV', 'Znesek brez vračunanega DDV-ja. Pomembno za normirance ob preverjanju limita.', 'fa-coins');
        addStat('DDV', Utils.formatCurrency(totalVat), 'orange', 'Obračunan davek', 'Obračunan davek na dodano vrednost na vseh postavkah.', 'fa-percent');
        addStat('Št. računov', filtered.length.toString(), 'purple', `${paidCount} plač. / ${openCount} odpr.`, 'Število vseh izdanih računov in vpogled v to, koliko jih je že poravnanih.', 'fa-file-invoice');

        // Normiranec Progress Bar & Tax Calculation
        const limit = 50000;
        
        let wrapperEl = fursContainer.querySelector('.normiranec-wrapper');
        if (!wrapperEl) {
            wrapperEl = document.createElement('div');
            wrapperEl.className = 'normiranec-wrapper stats-grid';
            fursContainer.appendChild(wrapperEl);
        }
        
        wrapperEl.replaceChildren();

        // 1. Ocenjena dohodnina (Popoldanski s.p. pravila)
        let estimatedTax = 0;
        if (totalNet <= 12500) {
            estimatedTax = totalNet * 0.04;
        } else {
            estimatedTax = (12500 * 0.04) + ((totalNet - 12500) * 0.12);
        }

        // ============================================
        // KARTICA 1: Limit 50.000 € (Uporablja stat-card strukturo)
        // ============================================
        const limitEl = document.createElement('article');
        limitEl.className = 'card card--surface stat-card';

        // Header
        const limitHeader = document.createElement('div');
        limitHeader.className = 'stat-card-header';
        
        const limitInfoDiv = document.createElement('div');
        limitInfoDiv.className = 'stat-card-info';
        const limitTitle = document.createElement('h3');
        limitTitle.className = 'stat-title text-main';
        limitTitle.textContent = 'Limit (Popoldanski s.p.)';
        limitInfoDiv.appendChild(limitTitle);
        
        const limitIconDiv = document.createElement('div');
        limitIconDiv.className = 'stat-card-icon';
        const limitIcon = document.createElement('i');
        limitIcon.className = 'fa-solid fa-chart-line text-primary';
        limitIcon.setAttribute('aria-hidden', 'true');
        limitIconDiv.appendChild(limitIcon);
        
        limitHeader.appendChild(limitInfoDiv);
        limitHeader.appendChild(limitIconDiv);
        limitEl.appendChild(limitHeader);

        // Value area
        const limitValueWrapper = document.createElement('div');
        limitValueWrapper.className = 'normiranec-body';

        const limitValue = document.createElement('data');
        limitValue.className = totalNet >= limit ? 'stat-value text-danger' : 'stat-value text-main';
        limitValue.textContent = Utils.formatCurrency(totalNet);
        
        const limitMax = document.createElement('span');
        limitMax.className = 'text-muted text-sm';
        limitMax.textContent = '/ 50.000,00 €';
        
        limitValueWrapper.appendChild(limitValue);
        limitValueWrapper.appendChild(limitMax);
        limitEl.appendChild(limitValueWrapper);

        // Progress bar (Meter)
        const meterElement = document.createElement('meter');
        meterElement.className = 'normiranec-meter';
        meterElement.min = 0;
        meterElement.max = limit;
        meterElement.low = limit * 0.8;
        meterElement.high = limit;
        meterElement.optimum = limit * 0.5;
        meterElement.value = totalNet;
        meterElement.setAttribute('aria-label', 'Izkoriščenost letnega limita za normirance');
        limitEl.appendChild(meterElement);

        // Opozorila pod črto
        if (totalNet > (limit * 0.8) && totalNet < limit) {
            const warn = document.createElement('p');
            warn.className = 'helper-text text-warning normiranec-msg';
            const wIcon = document.createElement('i');
            wIcon.className = 'fa-solid fa-triangle-exclamation';
            wIcon.setAttribute('aria-hidden', 'true');
            warn.appendChild(wIcon);
            warn.appendChild(document.createTextNode(' Bližate se meji 50.000 €!'));
            limitEl.appendChild(warn);
        } else if (totalNet >= limit) {
            const danger = document.createElement('p');
            danger.className = 'helper-text text-danger normiranec-msg';
            const dIcon = document.createElement('i');
            dIcon.className = 'fa-solid fa-circle-exclamation';
            dIcon.setAttribute('aria-hidden', 'true');
            danger.appendChild(dIcon);
            danger.appendChild(document.createTextNode(' Presegli ste mejo 50.000 €!'));
            limitEl.appendChild(danger);
        }

        // Footer z info tipko
        const limitFooterContainer = document.createElement('div');
        limitFooterContainer.className = 'stat-card-footer-container';
        
        const limitFooterText = document.createElement('small');
        limitFooterText.className = 'stat-card-footer';
        limitFooterText.textContent = 'Izkoriščenost limita';
        
        const limitInfoBtn = document.createElement('button');
        limitInfoBtn.type = 'button';
        limitInfoBtn.className = 'btn-stat-info';
        limitInfoBtn.setAttribute('aria-label', 'Pojasnilo limita');
        limitInfoBtn.setAttribute('data-title', 'Limit 50.000 €');
        limitInfoBtn.setAttribute('data-desc', 'V znesek za preverjanje limita se seštevajo vsi izdani računi v koledarskem letu (tudi neplačani). Ob prekoračitvi limita je obvezen vstop v sistem DDV oz. izstop iz sistema normiranega s.p.');
        limitInfoBtn.setAttribute('popovertarget', 'modal-stat-info');
        
        const limitInfoBtnIcon = document.createElement('i');
        limitInfoBtnIcon.className = 'fa-solid fa-info';
        limitInfoBtnIcon.setAttribute('aria-hidden', 'true');
        limitInfoBtn.appendChild(limitInfoBtnIcon);
        
        limitFooterContainer.appendChild(limitFooterText);
        limitFooterContainer.appendChild(limitInfoBtn);
        limitEl.appendChild(limitFooterContainer);
        
        wrapperEl.appendChild(limitEl);

        // ============================================
        // KARTICA 2: Ocenjena Dohodnina (Uporablja stat-card strukturo)
        // ============================================
        const taxEl = document.createElement('article');
        taxEl.className = 'card card--surface stat-card';

        // Header
        const taxHeader = document.createElement('div');
        taxHeader.className = 'stat-card-header';
        
        const taxInfoDiv = document.createElement('div');
        taxInfoDiv.className = 'stat-card-info';
        const taxTitle = document.createElement('h3');
        taxTitle.className = 'stat-title text-main';
        taxTitle.textContent = 'Letna dohodnina';
        taxInfoDiv.appendChild(taxTitle);
        
        const taxIconDiv = document.createElement('div');
        taxIconDiv.className = 'stat-card-icon';
        const taxIcon = document.createElement('i');
        taxIcon.className = 'fa-solid fa-calculator text-primary';
        taxIcon.setAttribute('aria-hidden', 'true');
        taxIconDiv.appendChild(taxIcon);
        
        taxHeader.appendChild(taxInfoDiv);
        taxHeader.appendChild(taxIconDiv);
        taxEl.appendChild(taxHeader);

        // Value area
        const taxValue = document.createElement('data');
        taxValue.className = 'stat-value text-main';
        taxValue.textContent = Utils.formatCurrency(estimatedTax);
        taxEl.appendChild(taxValue);

        // Footer z info tipko
        const taxFooterContainer = document.createElement('div');
        taxFooterContainer.className = 'stat-card-footer-container';
        
        const taxFooterText = document.createElement('small');
        taxFooterText.className = 'stat-card-footer';
        taxFooterText.textContent = 'Ocenjena (popoldanski s.p.)';
        
        const taxInfoBtn = document.createElement('button');
        taxInfoBtn.type = 'button';
        taxInfoBtn.className = 'btn-stat-info';
        taxInfoBtn.setAttribute('aria-label', 'Pojasnilo izračuna');
        taxInfoBtn.setAttribute('data-title', 'Ocenjena letna dohodnina');
        taxInfoBtn.setAttribute('data-desc', 'Za popoldanski s.p.: Do 12.500 € letnih prihodkov se prizna 80% normiranih odhodkov (efektivni davek 4%). Nad 12.500 € do 50.000 € se prizna 40% normiranih odhodkov (efektivni davek 12%). Prikazan znesek je zgolj informativne narave.');
        taxInfoBtn.setAttribute('popovertarget', 'modal-stat-info');
        
        const taxInfoBtnIcon = document.createElement('i');
        taxInfoBtnIcon.className = 'fa-solid fa-info';
        taxInfoBtnIcon.setAttribute('aria-hidden', 'true');
        taxInfoBtn.appendChild(taxInfoBtnIcon);
        
        taxFooterContainer.appendChild(taxFooterText);
        taxFooterContainer.appendChild(taxInfoBtn);
        taxEl.appendChild(taxFooterContainer);
        
        wrapperEl.appendChild(taxEl);
    }
};

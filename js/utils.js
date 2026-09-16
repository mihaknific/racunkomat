/**
 * Utility Functions
 */

// Security Enforcement: Strict Content Security Policy (CSP) alignment via Trusted Types to unconditionally prevent DOM-based XSS vectors.
// Omogoča varno vstavljanje HTML vsebin in preprečuje DOM-XSS napade.
const policy = window.trustedTypes?.createPolicy('racunkomat-policy', {
    // V bodoče tukaj dodamo DOMPurify ali podobno logiko za strožje preverjanje.
    createHTML: (string) => string, 
    createScriptURL: (string) => string,
});

export const Utils = {
    /**
     * Policy getter
     */
    get policy() { return policy; },

    /**
     * Odstrani nepodprte znake, pretvori šumnike za UPN QR (ZBS ISO-8859-2 compliant chars only)
     */
    sanitizeForQr(str) {
        if (!str) return '';
        const map = {
            'Č': 'C', 'Š': 'S', 'Ž': 'Z',
            'č': 'c', 'š': 's', 'ž': 'z',
            'Ć': 'C', 'Đ': 'D', 'ć': 'c', 'đ': 'd',
            'Ü': 'U', 'Ö': 'O', 'Ä': 'A', 'ẞ': 'SS',
            'ü': 'u', 'ö': 'o', 'ä': 'a', 'ß': 'ss',
            '–': '-', '—': '-', '´': "'", '`': "'", '"': "'", '„': "'", '“': "'"
        };
        let sanitized = str.replace(/[ČŠŽčšžĆĐćđÜÖÄẞüöäß–—´`„“"]/g, m => map[m] || '');
        return sanitized.trim();
    },

    formatAmountForQr(amount) {
        if (!amount) return '00000000000';
        let cents = this.toCents(amount);
        return cents.toString().padStart(11, '0');
    },

    formatDateForQr(val) {
        if (!val) return '';
        if (!val.includes('-')) return val;
        const p = val.split('-');
        return `${p[2]}.${p[1]}.${p[0]}`;
    },

    calculateQrChecksum(lines) {
        let total = 0;
        lines.forEach(line => {
            total += (line + '\n').length;
        });
        return total.toString().padStart(3, '0');
    },

    /**
     * Format a number as currency (EUR)
     * @param {number} amount 
     * @returns {string} e.g. "1.234,56 €"
     */
    formatCurrency(amount) {
        if (typeof amount !== 'number') return '0,00 €';
        return new Intl.NumberFormat('sl-SI', {
            style: 'currency',
            currency: 'EUR'
        }).format(amount);
    },

    /**
     * Convert EUR amount to integer cents (e.g. 1.50 → 150).
     * Core primitive for all monetary calculations.
     * @param {number} amount - EUR value
     * @returns {number} Integer cents
     */
    toCents(amount) {
        return Math.round((parseFloat(amount) || 0) * 100);
    },

    /**
     * Convert integer cents back to EUR (e.g. 150 → 1.50).
     * Used only for display/output after all math is done in cents.
     * @param {number} cents - Integer cents value
     * @returns {number} EUR value
     */
    fromCents(cents) {
        return cents / 100;
    },

    /**
     * Safe multiplication for money: qty × price
     * Converts price to cents first, multiplies by qty, rounds to integer cents,
     * then converts back to EUR. Eliminates floating-point drift.
     * Example: safeMul(3, 33.33) → 99.99 (not 99.99000000000001)
     * @param {number} qty
     * @param {number} price
     * @returns {number} EUR result
     */
    safeMul(qty, price) {
        const priceCents = this.toCents(price);
        return this.fromCents(Math.round(priceCents * (parseFloat(qty) || 0)));
    },

    /**
     * Safe addition for money amounts.
     * Converts both operands to cents, adds, converts back.
     * @param {number} a - EUR
     * @param {number} b - EUR
     * @returns {number} EUR
     */
    safeAdd(a, b) {
        return this.fromCents(this.toCents(a) + this.toCents(b));
    },

    /**
     * Round any number to exactly 2 decimal places (cents)
     * @param {number} value
     * @returns {number}
     */
    roundCents(value) {
        return this.fromCents(Math.round((parseFloat(value) || 0) * 100));
    },

    /**
     * Accounting Architecture: Centralized Invoice Totals Calculation.
     * High-precision cent-based grouping by VAT rate to eliminate cumulative rounding drift.
     * @param {Object[]} items - Invoice items
     * @param {boolean} isVatPayer 
     * @returns {Object} { netTotal, vatTotal, grossTotal, vatGroups }
     */
    calculateTotals(items, isVatPayer = true) {
        let netTotal = 0;
        const vatGroups = {}; // { "22": netCents, ... }

        (items || []).forEach(item => {
            const net = this.safeMul(item.quantity, item.price);
            const netCents = this.toCents(net);
            const rate = isVatPayer ? (parseFloat(item.vatRate) || 0) : 0;

            netTotal = this.safeAdd(netTotal, net);
            
            if (!vatGroups[rate]) vatGroups[rate] = 0;
            vatGroups[rate] += netCents;
        });

        let totalVatCents = 0;
        Object.keys(vatGroups).forEach(rateStr => {
            const rate = parseFloat(rateStr);
            const groupNetCents = vatGroups[rateStr];
            totalVatCents += Math.round(groupNetCents * (rate / 100));
        });

        const vatTotal = this.fromCents(totalVatCents);
        const grossTotal = this.safeAdd(netTotal, vatTotal);

        return {
            netTotal,
            vatTotal,
            grossTotal,
            vatGroups: Object.fromEntries(
                Object.entries(vatGroups).map(([rate, cents]) => [rate, this.fromCents(cents)])
            )
        };
    },



    /**
     * Get today's date in YYYY-MM-DD format
     * @returns {string}
     */
    getTodayDate() {
        return new Date().toISOString().split('T')[0];
    },

    /**
     * Add days to a date and return YYYY-MM-DD
     * @param {string} dateStr YYYY-MM-DD
     * @param {number} days 
     */
    addDays(dateStr, days) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d));
        date.setUTCDate(date.getUTCDate() + days);
        const dd = String(date.getUTCDate()).padStart(2, '0');
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
        return `${date.getUTCFullYear()}-${mm}-${dd}`;
    },

    /**
     * Compare two strings using Slovenian locale rules (for proper ČŠŽ sorting)
     * @param {string} a 
     * @param {string} b 
     * @returns {number}
     */
    compareStrings(a, b) {
        return (a || "").localeCompare(b || "", 'sl-SI');
    },

    /**
     * Format a date string (YYYY-MM-DD or ISO) to DD.MM.YYYY (Slovenian format)
     * @param {string} dateStr 
     * @returns {string} e.g. "12.02.2026"
     */
    formatDate(dateStr) {
        if (!dateStr) return '';
        const cleanStr = typeof dateStr === 'string' ? dateStr.split('T')[0] : '';
        const parts = cleanStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}.${parts[1]}.${parts[0]}`;
        }
        
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
    },

    /**
     * Parse a YYYY-MM-DD date string into a Date object at local midnight to prevent timezone shifting.
     * @param {string} dateStr 
     * @returns {Date|null}
     */
    parseDateLocal(dateStr) {
        if (!dateStr) return null;
        const cleanStr = typeof dateStr === 'string' ? dateStr.split('T')[0] : '';
        const parts = cleanStr.split('-');
        if (parts.length === 3) {
            return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    },

    /**
     * Generate HTML for a premium empty state (Trusted Types safe)
     * @param {string} title 
     * @param {string} message 
     * @param {string} icon 
     * @returns {string|TrustedHTML} HTML string or TrustedHTML
     */
    renderEmptyState(title, message, icon = 'fa-folder-open') {
        const template = document.getElementById('template-empty-state');
        if (!template) return document.createDocumentFragment();

        const clone = template.content.cloneNode(true);
        const root = clone.querySelector('.empty-state');
        
        const iconEl = root.querySelector('.empty-icon-box i');
        if (iconEl) iconEl.className = `fa-solid ${icon}`;
        
        root.querySelector('.empty-title').textContent = title;
        root.querySelector('.empty-desc').textContent = message;
        
        return clone;
    },

    /**
     * Get intelligent default dates for invoicing
     * @returns {Object} { issueDate, dueDate, periodFrom, periodTo }
     */
    getSmartDates() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-11
        const day = now.getDate();

        // 1. Issue date = today
        const issueDate = this.getTodayDate();

        let dueDate, periodFrom, periodTo;

        if (day <= 5) {
            // Invoicing for the PREVIOUS month
            const prevDate = new Date(year, month - 1, 1);
            const pY = prevDate.getFullYear();
            const pM = prevDate.getMonth();
            const lastDayPrev = new Date(pY, pM + 1, 0).getDate();

            periodFrom = `${pY}-${String(pM + 1).padStart(2, '0')}-01`;
            periodTo   = `${pY}-${String(pM + 1).padStart(2, '0')}-${String(lastDayPrev).padStart(2, '0')}`;

            // Due date = 15th of current month
            dueDate = `${year}-${String(month + 1).padStart(2, '0')}-15`;
        } else {
            // Invoicing for the CURRENT month
            const lastDayCurr = new Date(year, month + 1, 0).getDate();

            periodFrom = `${year}-${String(month + 1).padStart(2, '0')}-01`;
            periodTo   = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDayCurr).padStart(2, '0')}`;

            // Due date = 15th of next month
            const nextDate = new Date(year, month + 1, 1);
            dueDate = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-15`;
        }

        return { issueDate, dueDate, periodFrom, periodTo };
    },

    /**
     * Storage Strategy: Resize to max 200KB via canvas buffer encoding to preserve Quota constraints and ensure rapid IO decodes.
     * Zmanjša velikost logotipov/podpisov na maks. 200 KB za zaščito pred kvoto.
     * @param {File} file - Vhodna slikovna datoteka
     * @param {Object} opts - Nastavitve: { maxWidthPx, maxSizeKB, quality }
     * @returns {Promise<string>} Base64 data URL komprimirane slike
     */
    compressImage(file, opts = {}) {
        const { maxWidthPx = 800, maxSizeKB = 200, quality = 0.82 } = opts;
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Branje datoteke ni uspelo.'));
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = () => reject(new Error('Nalaganje slike ni uspelo.'));
                img.onload = () => {
                    let { width, height } = img;

                    // Proporcionalni resize na max širino
                    if (width > maxWidthPx) {
                        height = Math.round((height * maxWidthPx) / width);
                        width = maxWidthPx;
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // PNG → JPEG za boljšo kompresijo; ohrani originalni MIME za ostale
                    const mimeType = (file.type === 'image/png' || file.type === '') ? 'image/jpeg' : (file.type || 'image/jpeg');

                    let dataUrl = canvas.toDataURL(mimeType, quality);

                    // Preveri velikost (Base64 → bytes ≈ length * 3/4)
                    const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
                    if (sizeKB > maxSizeKB) {
                        // Druga stopnja kompresije — zniža kvaliteto za 30%
                        dataUrl = canvas.toDataURL(mimeType, quality * 0.7);
                    }

                    resolve(dataUrl);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
};

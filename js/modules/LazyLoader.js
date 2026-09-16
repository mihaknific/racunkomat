/**
 * LazyLoader – Centralizirano nalaganje zunanjih knjižnic na zahtevo (on-demand).
 * Zero-cost initial bundle.
 * 
 * Knjižnice se naložijo šele ob prvi dejanski uporabi.
 * Vsaka knjižnica se naloži samo enkrat (singleton pattern s Promise caching).
 */

import { Utils } from '../utils.js';

const loaded = new Map();

/**
 * Naloži zunanjo skripto dinamično in jo vstavi v <head>.
 * Uporablja Trusted Types, če so na voljo (CSP compliance).
 * @param {string} src - Relativna pot do skripte
 * @returns {Promise<void>}
 */
function loadScript(src) {
    if (loaded.has(src)) return loaded.get(src);

    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        // CSP Trusted Types compliance
        script.src = Utils.policy ? Utils.policy.createScriptURL(src) : src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Napaka pri nalaganju knjižnice: ${src}`));
        document.head.appendChild(script);
    });

    loaded.set(src, promise);
    return promise;
}

export const LazyLoader = {
    /**
     * Naloži Chart.js (za Analytics).
     * Po nalaganju je globalno dostopen kot `window.Chart`.
     */
    async loadChart() {
        if (typeof Chart !== 'undefined') return;
        await loadScript('./js/vendor/chart.min.js');
    },

    /**
     * Naloži pdfmake + fonti (za PDF generiranje).
     * POMEMBNO: vfs_fonts.js MORA biti naložen PO pdfmake.min.js
     * (ker se registrira na globalni objekt pdfMake).
     */
    async loadPdfMake() {
        if (typeof pdfMake !== 'undefined') return;
        await loadScript('./js/vendor/pdfmake.min.js');
        await loadScript('./js/vendor/vfs_fonts.js');
    },

    /**
     * Naloži pdf-lib + fontkit (za UPN QR risanje na PDF).
     * Ti dve knjižnici sta med seboj neodvisni, nalagamo vzporedno.
     */
    async loadPdfLib() {
        if (typeof PDFLib !== 'undefined') return;
        await Promise.all([
            loadScript('./js/vendor/pdf-lib.min.js'),
            loadScript('./js/vendor/fontkit.umd.js')
        ]);
    },

    /**
     * Naloži kjua (za QR kodo generiranje).
     */
    async loadQR() {
        if (typeof kjua !== 'undefined') return;
        await loadScript('./js/vendor/kjua.min.js');
    },

    /**
     * Naloži vse PDF-relevantne knjižnice naenkrat.
     * Uporabno ko generiraš PDF z UPN/QR kodo.
     */
    async loadAllPdf() {
        await this.loadPdfMake();
        await Promise.all([
            this.loadPdfLib(),
            this.loadQR()
        ]);
    }
};

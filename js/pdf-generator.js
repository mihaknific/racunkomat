/**
 * PDF Generator Module
 * Handles generation of PDF invoices using pdfmake.
 */

import { StorageManager } from './modules/StorageManager.js';
import { Utils } from './utils.js';
import { Toast } from './components/toast.js';
import { UpnDrawer } from './modules/UpnDrawer.js';
import { LazyLoader } from './modules/LazyLoader.js';

// Architecture: Singleton background worker instance. Created once and reused to avoid cold-boot delays on multiple generations.
let _pdfWorker = null;
let _isBusy = false;

export const PdfGenerator = {

    /**
     * Zagotovi, da obstaja aktiven Worker. Ustvari novega le, če je mrtev ali ne obstaja.
     */
    _getWorker() {
        if (!_pdfWorker || _pdfWorker._dead) {
            const workerUrl = Utils.policy ? Utils.policy.createScriptURL('js/modules/PdfWorker.js') : 'js/modules/PdfWorker.js';
            _pdfWorker = new Worker(workerUrl);
            _pdfWorker._dead = false;
        }
        return _pdfWorker;
    },

    /**
     * Skupna gradnja docDefinition — odpravi podvajanje kode med generate() in preview().
     */
    _buildDocDefinition(invoice, partner, myCompany, qrCodeDataUrl) {
        return {
            content: [
                this.getHeader(myCompany, invoice),
                this.getPartnerInfo(partner),
                this.getItemsTable(invoice.items, myCompany.isVatPayer),
                this.getSummary(invoice.items, invoice.totalAmount, myCompany.isVatPayer),
                this.getFooter(myCompany, invoice, qrCodeDataUrl)
            ],
            styles: this.getStyles(),
            defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2 },
            _needsPageFooter: true
        };
    },

    /**
     * Skupna Worker dispatch logika — odpravlja podvajanje med generate() in preview().
     * @param {Object} docDefinition
     * @param {Function} onSuccess - callback(buffer: ArrayBuffer)
     */
    _dispatch(docDefinition, options, onSuccess) {
        return new Promise((resolve, reject) => {
            const worker = this._getWorker();
            worker.onmessage = async (e) => {
                if (e.data.type === 'success') {
                    try { 
                        let buffer = e.data.buffer;
                        
                        if (options && options.invoice && options.invoice.includeUpn) {
                            // Ensure PDFLib and Fontkit are loaded on main thread for drawing the slip
                            await LazyLoader.loadPdfLib();
                            buffer = await UpnDrawer.appendSlip(
                                buffer, 
                                options.invoice, 
                                options.partner, 
                                options.company, 
                                options.qrDataUrl
                            );
                        }

                        onSuccess(buffer); 
                        resolve(); 
                    } catch (err) { reject(err); }
                } else {
                    _pdfWorker._dead = true;
                    reject(new Error(e.data.message));
                }
            };
            worker.onerror = (err) => {
                _pdfWorker._dead = true;
                reject(err);
            };
            worker.postMessage({
                docDefinition,
                scripts: ['../vendor/pdfmake.min.js', '../vendor/vfs_fonts.js']
            });
        });
    },

    async generate(invoiceIdOrData) {
        if (_isBusy) { Toast.show('PDF se že pripravlja, počakajte …', 'warning'); return; }
        try {
            _isBusy = true;
            // Lazy load all required PDF generation libraries first
            await LazyLoader.loadAllPdf();

            let invoice;
            if (typeof invoiceIdOrData === 'string') {
                invoice = await StorageManager.getInvoice(invoiceIdOrData);
                if (!invoice) throw new Error('Račun ni najden');
            } else {
                invoice = invoiceIdOrData;
            }

            const [partner, myCompany] = await Promise.all([
                StorageManager.getPartner(invoice.partnerId),
                StorageManager.getCompany(invoice.companyId)
            ]);

            if (!myCompany) {
                Toast.show('Prosimo, najprej uredite podatke o svojem podjetju v nastavitvah.', 'info');
                return;
            }

            Toast.show('Pripravljam PDF …', 'info');
            const qrCodeDataUrl = await this.generateQrCode(invoice, partner, myCompany);
            const docDefinition = this._buildDocDefinition(invoice, partner, myCompany, qrCodeDataUrl);

            await this._dispatch(docDefinition, { invoice, partner, company: myCompany, qrDataUrl: qrCodeDataUrl }, (buffer) => {
                const blob = new Blob([buffer], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `racun-${invoice.number}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
                Toast.show('PDF uspešno prenesen!', 'success');
            });

        } catch (error) {
            console.error('PDF Generation Error:', error);
            Toast.show('Napaka pri generiranju PDF: ' + error.message, 'error');
        } finally {
            _isBusy = false;
        }
    },

    async preview(invoiceData) {
        if (_isBusy) { Toast.show('PDF se že pripravlja, počakajte …', 'warning'); return; }
        try {
            _isBusy = true;
            // Lazy load all required PDF generation libraries first
            await LazyLoader.loadAllPdf();

            const [partner, myCompany] = await Promise.all([
                StorageManager.getPartner(invoiceData.partnerId),
                StorageManager.getCompany(invoiceData.companyId)
            ]);

            if (!myCompany) {
                Toast.show('Za predogled manjka izdajatelj (podjetje).', 'info');
                return;
            }
            if (!partner) {
                Toast.show('Za predogled manjka stranka.', 'info');
                return;
            }

            Toast.show('Pripravljam predogled …', 'info');
            const qrCodeDataUrl = await this.generateQrCode(invoiceData, partner, myCompany);
            const docDefinition = this._buildDocDefinition(invoiceData, partner, myCompany, qrCodeDataUrl);

            await this._dispatch(docDefinition, { invoice: invoiceData, partner, company: myCompany, qrDataUrl: qrCodeDataUrl }, (buffer) => {
                const blob = new Blob([buffer], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const iframe = document.getElementById('pdf-preview-frame');
                const modal = document.getElementById('modal-pdf-preview');
                if (iframe && modal) {
                    iframe.src = url;
                    modal.showModal();
                } else {
                    window.open(url, '_blank'); // Fail-safe
                }
                // URL ne prekličemo takoj, da ima iframe čas za nalaganje
            });

        } catch (error) {
            console.error('PDF Preview Error:', error);
            Toast.show('Napaka pri predogledu: ' + error.message, 'error');
        } finally {
            _isBusy = false;
        }
    },


    getHeader(myCompany, invoice) {
        let signatureStack = [];
        if (myCompany.logo && myCompany.logo.startsWith('data:')) {
            signatureStack.push({ image: myCompany.logo, width: 60, margin: [0, 0, 0, 8] });
        }
        
        const dateStr = invoice.dateServiceFrom && invoice.dateServiceTo && invoice.dateServiceFrom !== invoice.dateServiceTo
            ? { text: `Obdobje storitve: ${Utils.formatDate(invoice.dateServiceFrom)} - ${Utils.formatDate(invoice.dateServiceTo)}`, alignment: 'right' }
            : (invoice.dateServiceFrom || invoice.dateServiceTo)
                ? { text: `Datum opr. storitve: ${Utils.formatDate(invoice.dateServiceFrom || invoice.dateServiceTo)}`, alignment: 'right' }
                : { text: '', alignment: 'right' };

        return {
            columns: [
                {
                    width: '*',
                    stack: [
                        ...signatureStack,
                        { text: 'Izvajalec storitev:', style: 'subheader'},
                        { text: myCompany.companyName || '', style: 'companyName'},
                        myCompany.address || '',
                        `${myCompany.postalCode || ''} ${myCompany.city || ''}`,
                        `Davčna št.: ${myCompany.taxNumber || ''}`,
                        `Matična št.: ${myCompany.registrationNumber || ''}`,
                        `TRR: ${myCompany.iban || ''}`,
                        myCompany.bic ? `BIC/SWIFT: ${myCompany.bic}` : '',
                    ],
                },
                {
                    width: 'auto',
                    stack: [
                        { text: 'RAČUN', style: 'invoiceTitle', alignment: 'right' },
                        { text: `Številka računa: ${invoice.number || 'N/A'}`, alignment: 'right' },
                        { text: `Datum izdaje: ${Utils.formatDate(invoice.dateIssued)}`, alignment: 'right' },
                        dateStr,
                        { text: `Datum zapadlosti: ${Utils.formatDate(invoice.dateDue)}`, alignment: 'right' },
                    ],
                }
            ],
            marginBottom: 20
        };
    },

    getPartnerInfo(partner) {
        if (!partner) return {};
        return {
            stack: [
                { text: 'Plačnik:', style: 'subheader' },
                partner.name || '',
                partner.address || '',
                `${partner.postalCode || ''} ${partner.city || ''}, ${partner.country || ''}`,
                partner.taxNumber ? `Davčna številka: ${partner.taxNumber}` : '',
                partner.registrationNumber ? `Matična št.: ${partner.registrationNumber}` : ''
            ],
            marginBottom: 10
        };
    },

    getItemsTable(items, isVatPayer) {
        const formatNum = (num) => {
            if (typeof num !== 'number' || isNaN(num)) return '0,00';
            return num.toFixed(2).replace('.', ',');
        };

        const headerRow = [
            { text: '#', style: 'tableHeader', alignment: 'center' },
            { text: 'Opis storitve/artikla', style: 'tableHeader' },
            { text: 'Kol.', style: 'tableHeader', alignment: 'center' },
            { text: 'Enota', style: 'tableHeader', alignment: 'center' },
            { text: 'Cena/en.(€)', style: 'tableHeader', alignment: 'right' },
            { text: 'DDV(%)', style: 'tableHeader', alignment: 'right' },
            { text: 'Neto(€)', style: 'tableHeader', alignment: 'right' },
            { text: 'DDV(€)', style: 'tableHeader', alignment: 'right' },
            { text: 'Bruto(€)', style: 'tableHeader', alignment: 'right' }
        ];

        // Centralized Accounting: Hand-off precision math to Utils to match UI exactly.
        const totals = Utils.calculateTotals(items, isVatPayer);
        
        const dataRows = (items || []).map((item, index) => {
            const net = Utils.safeMul(item.quantity || 0, item.price || 0);
            const rate = isVatPayer ? (parseFloat(item.vatRate) || 0) : 0;
            const vatAmt = Utils.fromCents(Math.round(Utils.toCents(net) * (rate / 100)));
            const gross = Utils.safeAdd(net, vatAmt);

            return [
                { text: index + 1, alignment: 'center' },
                item.description || '',
                { text: formatNum(item.quantity || 0), alignment: 'center' },
                { text: item.unit || 'kos', alignment: 'center' },
                { text: formatNum(item.price || 0), alignment: 'right' },
                { text: formatNum(rate), alignment: 'right' },
                { text: formatNum(net), alignment: 'right' },
                { text: formatNum(vatAmt), alignment: 'right' },
                { text: formatNum(gross), alignment: 'right' }
            ];
        });

        if (items && items.length > 0) {
            dataRows.push([
                { text: 'Skupaj:', colSpan: 6, alignment: 'right', bold: true }, {}, {}, {}, {}, {},
                { text: formatNum(totals.netTotal), alignment: 'right', bold: true },
                { text: formatNum(totals.vatTotal), alignment: 'right', bold: true },
                { text: formatNum(totals.grossTotal), alignment: 'right', bold: true }
            ]);
        }

        return {
            style: 'itemsTable',
            table: {
                headerRows: 1,
                widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
                body: [headerRow, ...dataRows]
            },
            layout: 'invoiceTableLayout'
        };
    },

    getSummary(items, totalAmount, isVatPayer) {
        if (!items || items.length === 0) return { text: '' };
        
        const formatNum = (num) => {
            if (typeof num !== 'number' || isNaN(num)) return '0,00';
            return num.toFixed(2).replace('.', ',');
        };

        const totals = Utils.calculateTotals(items, isVatPayer);

        const summaryTableBody = [
            [ 
                { text: 'Skupaj brez DDV:', style: 'summaryLabel', border: [false, false, false, false] }, 
                { text: `${formatNum(totals.netTotal)} EUR`, style: 'summaryValue', alignment: 'right', border: [false, false, false, false] } 
            ]
        ];

        // Dodajanje posameznih DDV stopenj
        Object.keys(totals.vatGroups).sort((a,b) => a - b).forEach(rateStr => {
            const rate = parseFloat(rateStr);
            const amt = totals.vatGroups[rateStr];
            
            if (rate > 0 || !isVatPayer) {
                summaryTableBody.push([ 
                    { text: `DDV (${formatNum(rate)}%):`, style: 'summaryLabel', border: [false, false, false, false] }, 
                    { text: `${formatNum(amt)} EUR`, style: 'summaryValue', alignment: 'right', border: [false, false, false, false] } 
                ]);
            }
        });

        summaryTableBody.push([ 
            { text: 'Skupaj za plačilo:', style: 'summaryLabelTotal', bold: true, border: [false, true, false, false], paddingTop: 5 }, 
            { text: `${formatNum(totals.grossTotal)} EUR`, style: 'summaryValueTotal', bold: true, alignment: 'right', border: [false, true, false, false], paddingTop: 5 } 
        ]);

        return {
            table: { body: summaryTableBody, widths: ['*', 'auto'] },
            margin: [0, 10, 0, 0]
        };
    },

    getFooter(myCompany, invoice, qrCodeDataUrl) {
        const refModel = invoice.referenceModel || 'SI99';
        const refNumber = invoice.referenceNumber || invoice.number.replace(/-/g, '');
        const fullRef = `${refModel} ${refNumber}`;

        let paymentLines = [];
        if (myCompany.isVatPayer === false) {
            paymentLines.push('DDV ni obračunan v skladu s 1. odstavkom 94. člena ZDDV-1 (nismo zavezanci za DDV).');
        }
        paymentLines.push(`Pri plačilu se sklicujte na številko: ${fullRef}`);
        paymentLines.push('Prosimo, da račun poravnate do roka plačila.');

        const qrStack = [];
        if (qrCodeDataUrl) {
            qrStack.push({ text: 'Plačilo s skeniranjem QR kode:', fontSize: 8, bold: true, color: '#555555', margin: [0, 0, 0, 5] });
            qrStack.push({ image: qrCodeDataUrl, width: 130, alignment: 'left', margin: [0, 0, 0, 0] });
        }

        const textStack = [];
        textStack.push({ text: paymentLines.join('\n'), margin: [0, 2, 0, 0] });

        // Show BOTH invoice notes AND company footer text if they exist
        if (invoice.notes) {
            textStack.push({ text: `Opomba: ${invoice.notes}`, style: 'customFooterText', marginTop: 15 });
        }
        if (myCompany.invoiceFooterText) {
            textStack.push({ text: myCompany.invoiceFooterText, style: 'customFooterText', marginTop: invoice.notes ? 5 : 15 });
        }

        // Signatory section (Name + Signature)
        if (myCompany.signatory || myCompany.signature) {
            const signatoryStack = [];

            if (myCompany.signature && myCompany.signature.startsWith('data:')) {
                signatoryStack.push({
                    image: myCompany.signature,
                    width: 100,
                    alignment: 'right',
                    margin: [0, 10, 0, 5]
                });
            }

            signatoryStack.push({
                text: 'Podpis izdajatelja',
                fontSize: 8,
                alignment: 'right',
                italics: true,
                margin: [0, 0, 0, 2]
            });

            if (myCompany.signatory) {
                signatoryStack.push({
                    text: myCompany.signatory,
                    fontSize: 10,
                    bold: true,
                    alignment: 'right'
                });
            }

            textStack.push({
                unbreakable: true,
                stack: signatoryStack,
                margin: [0, 20, 0, 0]
            });
        }

        return {
            unbreakable: true, // Garancija, da noga vedno ostane v celoti skupaj!
            columns: [
                { width: 'auto', stack: qrStack },
                { width: '*', stack: textStack }
            ],
            columnGap: 20,
            fontSize: 10,
            margin: [0, 25, 0, 0]
        };
    },


    getStyles() {
        return {
            companyName: { fontSize: 10, marginBottom: 0 },
            invoiceTitle: { fontSize: 20, bold: true, marginBottom: 5 },
            subheader: { fontSize: 10, bold: true, marginBottom: 2 },
            itemsTable: { margin: [0, 5, 0, 15], fontSize: 9 },
            tableHeader: { bold: true, fontSize: 10, fillColor: '#eeeeee' },
            summaryLabel: { fontSize: 10, margin: [0, 2, 0, 2] },
            summaryValue: { fontSize: 10, margin: [0, 2, 0, 2] },
            summaryLabelTotal: { fontSize: 11, bold: true, margin: [0, 5, 0, 2] },
            summaryValueTotal: { fontSize: 11, bold: true, margin: [0, 5, 0, 2] },
            customFooterText: { fontSize: 9, italics: true, alignment: 'left', color: '#555555' },
            footer: { fontSize: 8, italics: true },
            signatoryNameStyle: { fontSize: 10, alignment: 'center' }
        };
    },

    getPageFooter() {
        return function(currentPage, pageCount) {
            return { text: `Stran ${currentPage.toString()} od ${pageCount}`, alignment: 'center', fontSize: 8, margin: [0, 10, 0, 0] };
        };
    },

    async generateQrCode(invoice, partner, myCompany) {
        /**
         * UPNQR String Generator — Strict ZBS Standard (20 fields)
         * Following official Priloga 7.3 specifications from 2026-04-10 project.
         */
        try {
            const payerCity = `${partner?.postalCode || partner?.zip || ''} ${partner?.city || ''}`.trim();
            const recipientCity = `${myCompany.postalCode || ''} ${myCompany.city || ''}`.trim();

            const recipientIban = (myCompany.iban || '').replace(/\s/g, '').toUpperCase();
            const refModel = invoice.referenceModel || 'SI00';
            const refNumber = (invoice.referenceNumber || invoice.number?.replace(/-/g, '') || '').replace(/\s/g, '');
            const recipientRef = `${refModel}${refNumber}`;
            const purposeCode = (invoice.upnPurposeCode || invoice.purposeCode || 'GDSV').toUpperCase();
            const purpose = (invoice.notes ? invoice.notes.substring(0, 42) : `Plačilo računa ${invoice.number || ''}`).toUpperCase();

            // 1. Prepare first 19 fields
            const lines = [
                'UPNQR',                                                      // 1. Vodilni slog
                '',                                                           // 2. IBAN plačnika
                '',                                                           // 3. Polog
                '',                                                           // 4. Dvig
                '',                                                           // 5. Referenca plačnika
                Utils.sanitizeForQr(partner?.name || '').substring(0, 33),    // 6. Ime plačnika
                Utils.sanitizeForQr(partner?.address || '').substring(0, 33), // 7. Ulica plačnika
                Utils.sanitizeForQr(payerCity).substring(0, 33),              // 8. Kraj plačnika
                Utils.formatAmountForQr(invoice.totalAmount),                 // 9. Znesek (11 digits)
                '',                                                           // 10. Datum plačila
                '',                                                           // 11. Nujno
                purposeCode.substring(0, 4),                                  // 12. Koda namena
                Utils.sanitizeForQr(purpose).substring(0, 42),                // 13. Namen plačila
                Utils.formatDateForQr(invoice.dateDue),                       // 14. Rok plačila
                recipientIban,                                                // 15. IBAN prejemnika
                recipientRef.substring(0, 26),                                // 16. Referenca prejemnika
                Utils.sanitizeForQr(myCompany.companyName || '').substring(0, 33),    // 17. Ime prejemnika
                Utils.sanitizeForQr(myCompany.address || '').substring(0, 33),        // 18. Ulica prejemnika
                Utils.sanitizeForQr(recipientCity).substring(0, 33)                   // 19. Kraj prejemnika
            ];

            // 2. Calculate checksum (Field 20)
            const checksum = Utils.calculateQrChecksum(lines);
            lines.push(checksum);

            // 3. Join with LF (\n) and ensure final LF
            const upnString = lines.join('\n') + '\n';

            const el = kjua({
                text: upnString,
                render: 'canvas',
                size: 300,
                ecLevel: 'M',
                quiet: 1
            });
            return el.toDataURL('image/png');

        } catch (e) {
            console.warn('QR Gen Failed', e);
            return null;
        }
    }
};

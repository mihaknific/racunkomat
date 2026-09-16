/**
 * PDF Worker
 * Offloads PDF generation (pdfMake) to a background thread.
 * Layout functions cannot be cloned via postMessage, so they are injected here.
 */

/* eslint-disable no-undef */

self.onmessage = async (e) => {
    const { docDefinition, options, scripts } = e.data;

    try {
        if (typeof pdfMake === 'undefined') {
            importScripts(...scripts);
        }

        // --- INJECT FUNCTIONS THAT COULD NOT BE CLONED VIA POSTMESSAGE ---

        // Inject page footer (pagination and watermark)
        if (docDefinition._needsPageFooter) {
            docDefinition.footer = function (currentPage, pageCount) {
                return {
                    columns: [
                        {
                            text: [
                                'Izdelano z brezplačno, varno in anonimno aplikacijo ',
                                { text: 'Računkomat', link: 'https://github.com/mihaknific/racunkomat', color: '#0066cc', decoration: 'underline' }
                            ],
                            alignment: 'left',
                            fontSize: 8,
                            color: '#888888',
                            margin: [40, 10, 0, 0]
                        },
                        { text: 'Stran ' + currentPage.toString() + ' od ' + pageCount.toString(), alignment: 'right', fontSize: 8, color: '#888888', margin: [0, 10, 40, 0] }
                    ]
                };
            };
            delete docDefinition._needsPageFooter;
        }

        // Register the table layout globally in pdfMake
        // This handles thick borders above/below header and above/below the totals row
        const invoiceTableLayout = {
            hLineWidth: function (i, node) {
                const len = node.table.body.length;
                // Odebeljene črte (1.0): nad glavo (i=0), pod glavo (i=1) in na dnu (i=len)
                // Ostale črte (0.5)
                if (i === 0 || i === 1 || i === len) return 1.0;
                return 0.5;
            },
            vLineWidth: function () {
                return 0; // Brez vertikalnih črt
            },
            hLineColor: function (i, node) {
                const len = node.table.body.length;
                // Temnejša barva za odebeljene črte, svetlejša za ostale
                if (i === 0 || i === 1 || i === len) return '#1a1a1a';
                return '#d1d5db';
            },
            paddingLeft: function () { return 8; },
            paddingRight: function () { return 8; },
            paddingTop: function () { return 6; },
            paddingBottom: function () { return 6; }
        };

        pdfMake.tableLayouts = pdfMake.tableLayouts || {};
        pdfMake.tableLayouts['invoiceTableLayout'] = invoiceTableLayout;
        pdfMake.tableLayouts['customTableLayout'] = invoiceTableLayout;

        // Also scan content and replace string markers (belt-and-suspenders safety)
        if (docDefinition.content && Array.isArray(docDefinition.content)) {
            docDefinition.content.forEach(function (item) {
                if (item && (item.layout === 'legacyTableLayout' || item.layout === 'invoiceTableLayout')) {
                    item.layout = 'invoiceTableLayout';
                }
            });
        }

        const pdfDoc = pdfMake.createPdf(docDefinition);

        pdfDoc.getBuffer(function (buffer) {
            self.postMessage({
                type: 'success',
                buffer: buffer
            }, [buffer.buffer]);
        });

    } catch (error) {
        self.postMessage({
            type: 'error',
            message: error.message
        });
    }
};

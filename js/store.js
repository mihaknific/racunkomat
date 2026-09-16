/**
 * Privzete vrednosti za nov račun.
 * Enotna definicija (DRY) — uporabljena v _data, resetInvoice() in InvoiceDetails.clear().
 */
export const INVOICE_DEFAULTS = Object.freeze({
    companyId: '',
    partnerId: '',
    dateIssued: '',
    dateDue: '',
    dateServiceFrom: '',
    dateServiceTo: '',
    referenceModel: 'SI00',
    referenceNumber: '',
    purposeCode: 'GDSV',
    notes: 'Hvala za sodelovanje!',
    includeUpn: false,
    upnPurposeCode: 'GDSV',
    items: [],
    netTotal: 0,
    vatTotal: 0,
    grossTotal: 0
});

export const Store = {
    _listeners: new Set(),
    _notifyTimeout: null,
    _proxyCache: new WeakMap(), // Predpomnilnik za hitrejše izvajanje Proxyjev
    
    // Zaseben objekt s podatki, ki vsebuje točno strukturo računa
    _data: {
        invoice: { ...INVOICE_DEFAULTS, items: [] }
    },

    // Javni state, ki je ovit v Proxy za avtomatsko reagiranje
    state: null,

    init() {
        this.state = this.createProxy(this._data);
    },

    /**
     * Ustvari rekurzivni (deep) Proxy, ki ujame spremembe na katerikoli ravni objekta.
     * To omogoča, da Store.state.invoice.items.push() prav tako proži obvestila.
     */
    createProxy(obj) {
        if (this._proxyCache.has(obj)) {
            return this._proxyCache.get(obj);
        }
        const self = this;
        const proxy = new Proxy(obj, {
            get(target, prop) {
                const value = target[prop];
                if (value !== null && typeof value === 'object') {
                    return self.createProxy(value); // Lazy deep proxy s cache
                }
                return value;
            },
            set(target, prop, value) {
                if (target[prop] !== value) {
                    target[prop] = value;
                    self._notify();
                }
                return true;
            },
            deleteProperty(target, prop) {
                delete target[prop];
                self._notify();
                return true;
            }
        });
        this._proxyCache.set(obj, proxy);
        return proxy;
    },

    /**
     * Naročilo za posodobitve. Komponenta poda funkcijo, ki se izvede ob vsaki spremembi podatkov.
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    },

    /**
     * Obvesti vse naročnike. Uporablja requestAnimationFrame za grupiranje (debouncing)
     * več hitrih sprememb (npr. pri izračunih).
     */
    _notify() {
        if (this._notifyTimeout) cancelAnimationFrame(this._notifyTimeout);
        this._notifyTimeout = requestAnimationFrame(() => {
            this._listeners.forEach(listener => listener(this.state));
        });
    },

    /**
     * Popoln reset stanja za nov račun.
     * Pobriše vse podatke in identifikatorje prejšnjih sej.
     */
    resetInvoice() {
        // Ponastavimo celoten objekt, da odstranimo morebitne ostanke (npr. ID od urejanja)
        this.state.invoice = { ...INVOICE_DEFAULTS, items: [] };
    }
};

// Inicializiraj takoj
Store.init();

import { Events } from '../event-bus.js';
import { Utils } from '../utils.js';

/**
 * StorageManager - Central Data Management
 * Združuje funkcionalnost `db.js` in `store.js`.
 * Uporablja IndexedDB s polno podporo kursorjem (paginacija) za zaščito pred "Memory Leaks".
 */

const DB_NAME = 'RacunkoDB'; // Posodobljeno ime baze na Računkomat
const DB_VERSION = 3; // V3: Varna incremental nadgradnja indeksov za obstoječe V2 uporabnike
let dbInstance = null;
let initPromise = null;

// Elegant 2026 Error Boundary wrapper for DB ops
const withBoundary = async (operationName, fn, fallback) => {
    try {
        if (!dbInstance) await StorageManager.init();
        return await fn();
    } catch (error) {
        console.error(`StorageManager operation [${operationName}] failed:`, error);
        
        let errorMessage = 'Napaka baze podatkov.';
        if (error.name === 'QuotaExceededError') {
            errorMessage = 'Zmanjkalo je prostora za shranjevanje. Prosimo, izbrišite stare račune ali očistite predpomnilnik.';
        }

        Events.emit('show-toast', { 
            message: errorMessage, 
            type: 'error' 
        });
        
        return fallback;
    }
};

export const StorageManager = {
    /**
     * Inicializacija baze podatkov.
     */
    async init() {
        if (dbInstance) return dbInstance;
        if (initPromise) return initPromise;

        initPromise = new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    const transaction = event.target.transaction;

                    // --- Invoices ---
                    let invoiceStore;
                    if (!db.objectStoreNames.contains('invoices')) {
                        invoiceStore = db.createObjectStore('invoices', { keyPath: 'id' });
                    } else {
                        invoiceStore = transaction.objectStore('invoices');
                    }
                    if (!invoiceStore.indexNames.contains('dateIssued'))
                        invoiceStore.createIndex('dateIssued', 'dateIssued', { unique: false });
                    if (!invoiceStore.indexNames.contains('status'))
                        invoiceStore.createIndex('status', 'status', { unique: false });
                    if (!invoiceStore.indexNames.contains('partnerId'))
                        invoiceStore.createIndex('partnerId', 'partnerId', { unique: false });

                    // --- Partners ---
                    let partnerStore;
                    if (!db.objectStoreNames.contains('partners')) {
                        partnerStore = db.createObjectStore('partners', { keyPath: 'id' });
                    } else {
                        partnerStore = transaction.objectStore('partners');
                    }
                    if (!partnerStore.indexNames.contains('name'))
                        partnerStore.createIndex('name', 'name', { unique: false });

                    // --- Ostale shrambe (brez indeksov) ---
                    if (!db.objectStoreNames.contains('companies'))
                        db.createObjectStore('companies', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('services'))
                        db.createObjectStore('services', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('preferences'))
                        db.createObjectStore('preferences', { keyPath: 'id' });
                };

                request.onsuccess = (event) => {
                    dbInstance = event.target.result;
                    initPromise = null; // Clear promise once resolved
                    resolve(dbInstance);
                };

                request.onerror = (event) => {
                    initPromise = null;
                    console.error('IndexedDB init error:', event.target.error);
                    reject(event.target.error);
                };
            } catch (err) {
                initPromise = null;
                reject(err);
            }
        });

        return initPromise;
    },

    /**
     * Izvozi celotno bazo v JSON format (Varnostna kopija)
     */
    async exportDatabase() {
        return withBoundary('exportDatabase', async () => {
            const db = await this.init();
            const storeNames = ['invoices', 'partners', 'companies', 'services', 'preferences'];
            const exportData = {};

            for (const storeName of storeNames) {
                exportData[storeName] = await new Promise((resolve, reject) => {
                    const transaction = db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            }

            return JSON.stringify(exportData);
        }, null);
    },

    /**
     * Uvozi podatke iz JSON objekta v bazo (popolna povrnitev)
     */
    async importDatabase(jsonData) {
        return withBoundary('importDatabase', async () => {
            const db = await this.init();
            const storeNames = ['invoices', 'partners', 'companies', 'services', 'preferences'];

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeNames, 'readwrite');

                transaction.oncomplete = () => {
                    Events.emit('database-imported');
                    resolve(true);
                };
                
                transaction.onerror = (e) => reject(e.target.error);

                for (const storeName of storeNames) {
                    if (jsonData[storeName]) {
                        const store = transaction.objectStore(storeName);
                        store.clear(); // Pobrišemo obstoječe pred vstavljanjem
                        jsonData[storeName].forEach(item => {
                            store.put(item);
                        });
                    }
                }
            });
        }, false);
    },

    /**
     * Univerzalna metoda CRUD operacij znotraj Managerja
     */
    async _saveToStore(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = dbInstance.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            
            // Backend-grade Data Integrity: Clone source object to strictly prevent lateral state leakage between memory and storage layers.
            const entry = { ...data };
            const now = new Date().toISOString();
            if (!entry.createdAt) entry.createdAt = now;
            entry.updatedAt = now;

            const request = store.put(entry);
            request.onsuccess = () => resolve(entry.id);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async _getFromStore(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction([storeName], 'readonly');
            transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            transaction.onerror = () => reject(transaction.error || new Error('Transaction error'));
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
        });
    },

    async _deleteFromStore(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction([storeName], 'readwrite');
            transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            transaction.onerror = () => reject(transaction.error || new Error('Transaction error'));
            const store = transaction.objectStore(storeName);
            store.delete(id);
            transaction.oncomplete = () => resolve(true);
        });
    },

    /**
     * Hitri bulk insert elementov za uvoz podatkov
     */
    async _bulkSaveToStore(storeName, itemsArray) {
        return new Promise((resolve, reject) => {
            if (!itemsArray || itemsArray.length === 0) return resolve(true);
            const transaction = dbInstance.transaction([storeName], 'readwrite');
            transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            transaction.onerror = () => reject(transaction.error || new Error('Transaction error'));
            
            const store = transaction.objectStore(storeName);
            for (const item of itemsArray) {
                store.put(item);
            }
            transaction.oncomplete = () => resolve(true);
        });
    },

    /**
     * Vračanje elementov preko Kursorja namesto nalaganja cele baze
     * (Ključna 2026 optimizacija za hitrost računanja)
     */
    async _getAllPaginated(storeName, limit = null, offset = 0, indexName = null, sortDirection = 'prev') {
        return new Promise((resolve, reject) => {
            if (!dbInstance) {
                reject(new Error('Baza ni inicializirana.'));
                return;
            }

            try {
                const transaction = dbInstance.transaction([storeName], 'readonly');
                transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
                transaction.onerror = () => reject(transaction.error || new Error('Transaction error'));
                const store = transaction.objectStore(storeName);
                let source = store;
                
                if (indexName) {
                    source = store.index(indexName);
                }
                
                const request = source.openCursor(null, sortDirection); 
                const results = [];
                let cursorAdvanced = false;

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        if (offset > 0 && !cursorAdvanced) {
                            cursorAdvanced = true;
                            try {
                                cursor.advance(offset);
                            } catch (e) {
                                // Če preskok vrstic spodleti (npr. offset izven meja zbirke), enostavno končamo
                                resolve(results);
                            }
                            return;
                        }

                        results.push(cursor.value);
                        
                        if (limit !== null && results.length >= limit) {
                             resolve(results);
                             return;
                        }
                        
                        cursor.continue();
                    } else {
                        resolve(results);
                    }
                };

                request.onerror = (event) => reject(event.target.error);
            } catch (err) {
                reject(err);
            }
        });
    },

    /**
     * Proactive architecture: Evaluates available disk quota before intensive local operations.
     * @returns {Promise<{percent: number, usageMB: string, quotaMB: string}>}
     */
    async getStorageStatus() {
        if (navigator.storage && navigator.storage.estimate) {
            const { usage, quota } = await navigator.storage.estimate();
            return {
                percent: parseFloat(((usage / quota) * 100).toFixed(1)),
                usageMB: (usage / (1024 * 1024)).toFixed(2),
                quotaMB: (quota / (1024 * 1024)).toFixed(0)
            };
        }
        return null;
    },

    /**
     * Helper za UUID
     */
    generateId() {
        return crypto.randomUUID();
    },

    // ==========================================
    // --- JAVNE METODE (API) ZA KOMPONENTE ---
    // ==========================================

    // --- Računi (Invoices) ---
    /**
     * Pridobi račune s pomočjo paginacije iz baze in jih sortira po izdaji od newer.
     */
    /**
     * Pridobi račune s pomočjo paginacije iz baze in jih sortira po izdaji od newer.
     */
    async getInvoices(limit = null, offset = 0) {
        return await withBoundary('getInvoices', () => 
            this._getAllPaginated('invoices', limit, offset, 'dateIssued', 'prev')
        , []);
    },

    /**
     * Database Layer: Memory-safe live filtered pagination via IndexedDB Cursors.
     * Baza namesto odjema polnega seznama pametno preskakuje nerelevantne objekte.
     * @param {Object} options - { filters, sortField, sortDir, limit }
     * @returns {Promise<{invoices: Object[], totalComputed: number}>}
     */
    async searchFilteredInvoices(options) {
        return await withBoundary('searchFilteredInvoices', async () => {
            return new Promise(async (resolve, reject) => {
                const tx = dbInstance.transaction(['invoices'], 'readonly');
                tx.onerror = () => reject(tx.error);
                const store = tx.objectStore('invoices');
                
                // Pomožni slovar partnerjev pri iskanju poslan od zunaj, da ne prekinemo IDB transakcije
                const partnerMap = options.partnerMap || {};

                // Normalizacija filtrov
                const term = (options.filters?.searchTerm || '').toLowerCase();
                const fPartner = options.filters?.partner || '';
                const fStatus = options.filters?.status || '';
                const fDateFrom = options.filters?.dateFrom;
                const fDateTo = options.filters?.dateTo;
                const fAmountFrom = parseFloat(options.filters?.amountFrom);
                const fAmountTo = parseFloat(options.filters?.amountTo);
                const limit = options.limit || 15;

                let indexName = null;
                let direction = options.sortDir === 'asc' ? 'next' : 'prev';
                
                if (options.sortField === 'dateIssued') indexName = 'dateIssued';
                else if (options.sortField === 'status') indexName = 'status';

                const source = indexName ? store.index(indexName) : store;
                const request = source.openCursor(null, direction);
                
                const results = [];
                // Če indeks se ne ujema (npr. znesek), preberemo vse izbrane in sortiramo naknadno.
                // Sicer lahko uporabimo kursor limit takoj.
                const needsPostSort = !indexName && options.sortField;
                let totalComputed = 0;

                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor) {
                        if (needsPostSort) {
                            results.sort((a, b) => {
                                let valA = options.sortField === 'partnerId' ? (partnerMap[a.partnerId] || '') : (a[options.sortField] || 0);
                                let valB = options.sortField === 'partnerId' ? (partnerMap[b.partnerId] || '') : (b[options.sortField] || 0);
                                if (typeof valA === 'string') {
                                    valA = valA.toLowerCase(); valB = valB.toLowerCase();
                                }
                                if (valA < valB) return options.sortDir === 'asc' ? -1 : 1;
                                if (valA > valB) return options.sortDir === 'asc' ? 1 : -1;
                                return 0;
                            });
                            resolve({ invoices: results.slice(0, limit), totalComputed });
                        } else {
                            resolve({ invoices: results, totalComputed });
                        }
                        return;
                    }

                    const inv = cursor.value;
                    let matchesAmount = true;
                    if (!isNaN(fAmountFrom)) matchesAmount = matchesAmount && (inv.totalAmount || 0) >= fAmountFrom;
                    if (!isNaN(fAmountTo)) matchesAmount = matchesAmount && (inv.totalAmount || 0) <= fAmountTo;

                    let matchesDate = true;
                    // Timezone-safe: primerjamo YYYY-MM-DD nize leksikografsko (deluje pravilno za ISO datume)
                    const invDate = (inv.dateIssued || '').split('T')[0];
                    if (fDateFrom) matchesDate = matchesDate && invDate >= fDateFrom;
                    if (fDateTo) matchesDate = matchesDate && invDate <= fDateTo;

                    const matchesPartner = !fPartner || inv.partnerId === fPartner;
                    const matchesStatus = !fStatus || inv.status === fStatus;

                    const matchesItem = inv.items && inv.items.some(item => 
                        (item.description || '').toLowerCase().includes(term)
                    );
                    const matchesSearch = !term ||
                        (inv.number || '').toLowerCase().includes(term) ||
                        (partnerMap[inv.partnerId] || '').toLowerCase().includes(term) ||
                        matchesItem;

                    if (matchesSearch && matchesPartner && matchesStatus && matchesDate && matchesAmount) {
                        totalComputed++;
                        if (needsPostSort) {
                            results.push(inv);
                        } else if (results.length < limit) {
                            results.push(inv);
                        }
                    }

                    cursor.continue();
                };
            });
        }, { invoices: [], totalComputed: 0 });
    },

    /**
     * Performance Strategy: Cursor-based aggregation iterates natively in IDB without inflating RAM payload via full arrays.
     * NE napolni RAM-a — iterira direktno v IndexedDB transakciji.
     * @param {number} year - Leto za filtriranje (npr. 2026)
     * @returns {Promise<{annualRevenue, monthRevenue, unpaidTotal, overdueCount, byMonth, paidTotal, openTotal, totalCount}>}
     */
    async getAggregatedStats(year = new Date().getFullYear()) {
        return await withBoundary('getAggregatedStats', () => {
            return new Promise((resolve, reject) => {
                const tx = dbInstance.transaction(['invoices'], 'readonly');
                tx.onerror = () => reject(tx.error);
                const store = tx.objectStore('invoices');
                const request = store.index('dateIssued').openCursor();

                const now = new Date();
                now.setHours(0, 0, 0, 0); // Lokalna polnoč — račun, ki zapade danes, NI zapadel
                const currentMonth = now.getMonth();
                const result = {
                    annualRevenue: 0,
                    monthRevenue: 0,
                    unpaidTotal: 0,
                    overdueCount: 0,
                    byMonth: new Array(12).fill(0),
                    paidTotal: 0,
                    openTotal: 0,
                    totalCount: 0
                };

                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor) { resolve(result); return; }

                    const inv = cursor.value;
                    const d = inv.dateIssued ? Utils.parseDateLocal(inv.dateIssued) : null;
                    const amount = inv.totalAmount || 0;

                    if (d && d.getFullYear() === year) {
                        result.annualRevenue += amount;
                        result.byMonth[d.getMonth()] += amount;
                        result.totalCount++;
                        if (inv.status === 'paid') result.paidTotal += amount;
                        else result.openTotal += amount;

                        if (d.getMonth() === currentMonth && d.getFullYear() === now.getFullYear()) {
                            result.monthRevenue += amount;
                        }
                    }

                    if (inv.status !== 'paid') {
                        result.unpaidTotal += amount;
                        if (inv.dateDue && Utils.parseDateLocal(inv.dateDue) < now) {
                            result.overdueCount++;
                        }
                    }

                    cursor.continue();
                };
                request.onerror = (e) => reject(e.target.error);
            });
        }, { annualRevenue: 0, monthRevenue: 0, unpaidTotal: 0, overdueCount: 0, byMonth: new Array(12).fill(0), paidTotal: 0, openTotal: 0, totalCount: 0 });
    },

    /**
     * Optimization: Resolves distinct primitives directly through cursor jumps without triggering heavy IDB bulk unloads.
     * @returns {Promise<number[]>}
     */
    async getDistinctYears() {
        return await withBoundary('getDistinctYears', () => {
            return new Promise((resolve, reject) => {
                const tx = dbInstance.transaction(['invoices'], 'readonly');
                tx.onerror = () => reject(tx.error);
                const years = new Set();
                years.add(new Date().getFullYear()); // vedno vključi tekoče leto
                const request = tx.objectStore('invoices').index('dateIssued').openCursor();
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor) { resolve(Array.from(years).sort((a, b) => b - a)); return; }
                    if (cursor.value.dateIssued) {
                        const yPart = parseInt(cursor.value.dateIssued.split('-')[0], 10);
                        if (!isNaN(yPart)) years.add(yPart);
                    }
                    cursor.continue();
                };
                request.onerror = (e) => reject(e.target.error);
            });
        }, [new Date().getFullYear()]);
    },

    /**
     * Memory Mapping: Traverses the tail end of the index exclusively for sequential operations, avoiding unneeded deserialization overhead.
     * Namenjeno generiranju naslednje zaporedne številke brez nalaganja celotne baze.
     * @param {number} limit
     * @returns {Promise<string[]>}
     */
    async getLastInvoiceNumbers(limit = 10) {
        return await withBoundary('getLastInvoiceNumbers', () => {
            return new Promise((resolve, reject) => {
                const tx = dbInstance.transaction(['invoices'], 'readonly');
                tx.onerror = () => reject(tx.error);
                const request = tx.objectStore('invoices').index('dateIssued').openCursor(null, 'prev');
                const numbers = [];
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor || numbers.length >= limit) { resolve(numbers); return; }
                    if (cursor.value.number) numbers.push(cursor.value.number);
                    cursor.continue();
                };
                request.onerror = (e) => reject(e.target.error);
            });
        }, []);
    },


    /**
     * Binary Search Indexing: Employs IDBKeyRange boundaries to reduce database reads from O(N) to O(log N + M).
     * Eliminira zadnji getAll() klic v analytics — O(log N + M) namesto O(N).
     * @param {number} year - Leto (npr. 2026)
     * @returns {Promise<Object[]>} Polni računi za izbrano leto
     */
    async getInvoicesByYear(year) {
        return await withBoundary('getInvoicesByYear', () => {
            return new Promise((resolve, reject) => {
                const tx = dbInstance.transaction(['invoices'], 'readonly');
                tx.onerror = () => reject(tx.error);
                // IDBKeyRange na dateIssued index: beri samo račune tega leta
                const from = `${year}-01-01`;
                const to   = `${year}-12-31`;
                const range = IDBKeyRange.bound(from, to + '\uffff');
                const request = tx.objectStore('invoices').index('dateIssued').openCursor(range);
                const results = [];
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor) { resolve(results); return; }
                    results.push(cursor.value);
                    cursor.continue();
                };
                request.onerror = (e) => reject(e.target.error);
            });
        }, []);
    },

    async saveInvoice(invoice) { return this._save('invoices', invoice); },
    async deleteInvoice(id) { return this._delete('invoices', id); },
    
    // --- Generic CRUD helpers ---
    async _get(storeName, id) {
        return await withBoundary(`get${storeName}`, () => this._getFromStore(storeName, id), null);
    },
    async _save(storeName, entity) {
        if (!entity.id) entity.id = this.generateId();
        return await withBoundary(`save${storeName}`, () => this._saveToStore(storeName, entity), null);
    },
    async _delete(storeName, id) {
        return await withBoundary(`delete${storeName}`, () => this._deleteFromStore(storeName, id), false);
    },

    async getInvoice(id) { return this._get('invoices', id); },

    // --- Stranke (Partners) ---
    async getPartners(limit = null, offset = 0) {
        return await withBoundary('getPartners', () => 
            this._getAllPaginated('partners', limit, offset, 'name', 'next')
        , []);
    },
    async savePartner(partner) { return this._save('partners', partner); },
    async deletePartner(id) { return this._delete('partners', id); },
    async getPartner(id) { return this._get('partners', id); },

    // --- Storitve/Artikli (Services) ---
    async getServices() {
        return await withBoundary('getServices', () => this._getAllPaginated('services'), []);
    },
    async saveService(service) { return this._save('services', service); },
    async deleteService(id) { return this._delete('services', id); },

    // --- Moje podjetje (Companies) ---
    async getCompanies() {
         return await withBoundary('getCompanies', () => this._getAllPaginated('companies'), []);
    },
    async getCompany(id) { 
        if (id) return this._get('companies', id);
        const companies = await this.getCompanies();
        return companies[0] || null;
    },
    async saveCompany(company) { return this._save('companies', company); },
    async deleteCompany(id) { return this._delete('companies', id); },

    // --- Uporabniške nastavitve (Preferences) ---
    async getPrefs() {
        const defaults = { id: 'user_settings', userName: '', showGreeting: true, hasSeenWelcome: false };
        return await withBoundary('getPrefs', async () => {
            const saved = await this._getFromStore('preferences', 'user_settings');
            return saved ? { ...defaults, ...saved } : defaults;
        }, defaults);
    },

    async savePrefs(prefs) {
        prefs.id = 'user_settings'; // Konstanten ID za preferences
        return await withBoundary('savePrefs', async () => {
            const result = await this._saveToStore('preferences', prefs);
            Events.emit('user-settings-changed', prefs);
            return result;
        }, false);
    },

    // --- Import / Export podatkov (Data Management) ---
    // Tukaj je uporabljen klasičen `getAll()` v surovem zapisu preko transakcije,
    // namerno samo za namene Backupa, kjer rabiš prebrati celotno bazo v 1 šusu.
    async exportAllData() {
        return await withBoundary('exportAllData', async () => {
             return new Promise((resolve, reject) => {
                 const tx = dbInstance.transaction(['invoices', 'partners', 'companies', 'services', 'preferences'], 'readonly');
                 const result = {};
                 
                 const stores = ['invoices', 'partners', 'companies', 'services', 'preferences'];
                 let completed = 0;

                 stores.forEach(storeName => {
                     const req = tx.objectStore(storeName).getAll();
                     req.onsuccess = async () => {
                         result[storeName] = req.result;
                         completed++;
                         // Ko so vsi prebrani
                         if (completed === stores.length) {
                             // Shrani v staršem JSON format, dodan timestamp
                             resolve(JSON.stringify({
                                 invoices: result.invoices,
                                 partners: result.partners,
                                 companies: result.companies,
                                 services: result.services,
                                 // Izvozimo celotno tabelo z nastavitvami in osnutki
                                 preferences: result.preferences, 
                                 // Za nazaj združljivost obdržimo tudi 'prefs', pri čemer explicitno poiščemo 'user_settings'
                                 prefs: result.preferences.find(p => p.id === 'user_settings') || await this.getPrefs(), 
                                 exportedAt: new Date().toISOString()
                             }, null, 2));
                         }
                     }
                 });
             });
        }, "{}");
    },

    async importAllData(jsonString) {
        return await withBoundary('importAllData', async () => {
            // Rollback Safety: Snapshot current state before destructive clear to ensure restoration is possible on IO failure.
            const backup = await this.exportAllData();
            
            try {
                let data;
                try {
                    data = JSON.parse(jsonString); 
                } catch (e) {
                    throw new Error("Neveljaven format datoteke. Prosimo, izberite pravilno JSON datoteko.");
                }
                
                // --- JSON SCHEMA VALIDATOR ---
                if (!data || typeof data !== 'object') throw new Error("Neveljaven ali prazen JSON.");
                
                // Validator helper
                const checkArray = (arr, name, reqFields) => {
                    if (arr && !Array.isArray(arr)) throw new Error(`${name} mora biti prepoznan kot Array seznam.`);
                    if (arr) {
                        arr.forEach((item, index) => {
                            if (typeof item !== 'object') throw new Error(`Napaka v zapisu #${index} pri ${name}: Ni objekt.`);
                            reqFields.forEach(f => {
                                if (!(f in item)) throw new Error(`Napaka v zapisu #${index} pri ${name}: Manjka obvezno polje '${f}'. Uvoz zaustavljen.`);
                            });
                        });
                    }
                };
                
                checkArray(data.invoices, 'Računi', ['id', 'number', 'dateIssued', 'totalAmount']);
                checkArray(data.partners, 'Stranke', ['id', 'name']);
                checkArray(data.companies, 'Podjetja', ['id', 'companyName', 'taxNumber']);
                checkArray(data.services, 'Storitve', ['id', 'name', 'price']);
                
                if (data.preferences) checkArray(data.preferences, 'Nastavitve (novo)', ['id']);
                if (data.prefs && typeof data.prefs !== 'object') throw new Error("Nastavitve morajo biti v formatu objekta.");
                // --- END VALIDATION ---

                await this.clearAllData();
                
                // Naložimo elemente v bulk transakcijah za ekstremno hiter uvoz
                if (data.invoices) await this._bulkSaveToStore('invoices', data.invoices);
                if (data.partners) await this._bulkSaveToStore('partners', data.partners);
                if (data.companies) await this._bulkSaveToStore('companies', data.companies);
                if (data.services) await this._bulkSaveToStore('services', data.services);
                
                if (data.preferences) {
                    await this._bulkSaveToStore('preferences', data.preferences);
                } else if (data.prefs) {
                    await this.savePrefs(data.prefs);
                }
                
                return true;
            } catch (err) {
                console.error("Import failed, attempting rollback...", err);
                // Simple rollback via the backup we just took
                try {
                    const rollbackData = JSON.parse(backup);
                    await this.clearAllData();
                    if (rollbackData.invoices) await this._bulkSaveToStore('invoices', rollbackData.invoices);
                    if (rollbackData.partners) await this._bulkSaveToStore('partners', rollbackData.partners);
                    if (rollbackData.companies) await this._bulkSaveToStore('companies', rollbackData.companies);
                    if (rollbackData.services) await this._bulkSaveToStore('services', rollbackData.services);
                    if (rollbackData.preferences) await this._bulkSaveToStore('preferences', rollbackData.preferences);
                } catch (rollbackErr) {
                    console.error("Critical: Rollback also failed!", rollbackErr);
                }
                throw err; // Re-throw original error
            }
        }, false);
    },

    async clearAllData() {
        return await withBoundary('clearAllData', async () => {
            return new Promise((resolve, reject) => {
                 const stores = ['invoices', 'partners', 'companies', 'services', 'preferences'];
                 const tx = dbInstance.transaction(stores, 'readwrite');
                 
                 stores.forEach(storeName => {
                     tx.objectStore(storeName).clear(); // Native IndexedDB clear
                 });
                 
                 tx.oncomplete = () => resolve(true);
                 tx.onerror = () => reject(tx.error);
            });
        }, false);
    },

};

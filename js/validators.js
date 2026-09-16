/**
 * Validators Module — client-side validation for Računkomat forms
 * No external dependencies. All rules are pure functions.
 */

export const Validators = {

    // --- Individual Field Validators ---

    /**
     * Slovenian tax number check (helper for UI warnings)
     */
    isSlovenianTaxNumber(value) {
        if (!value) return false;
        return /^\d{8}$/.test(value.replace(/\s/g, ''));
    },

    /**
     * Slovenian registration number check (10 digits)
     */
    isSlovenianRegistrationNumber(value) {
        if (!value) return false;
        return /^\d{10}$/.test(value.replace(/\s/g, ''));
    },

    /**
     * Localization Matrix for International Tax/VAT ID Regex Validation.
     */
    isInternationalTaxID(value, countryCode = 'SI') {
        const cleaned = value.replace(/\s/g, '').toUpperCase();
        const patterns = {
            'SI': /^\d{8}$/,         // Slovenia (8 digits)
            'HR': /^\d{11}$/,        // Croatia (OIB - 11 digits)
            'AT': /^U\d{8}$/,        // Austria (U + 8 digits)
            'DE': /^\d{11}$/,        // Germany (11 digits)
            'IT': /^\d{11}$/,        // Italy (11 digits)
            'HU': /^\d{8}$/          // Hungary (8 digits)
        };
        
        const pattern = patterns[countryCode.toUpperCase()];
        if (pattern) return pattern.test(cleaned);
        
        // Fallback: Generic VAT/Tax ID (EU style: 2 letters + 5-12 chars)
        return /^[A-Z]{0,2}[A-Z0-9]{5,15}$/.test(cleaned);
    },

    /**
     * Generic tax number validator (just checks if present and reasonable length)
     */
    taxNumber(value) {
        if (!value || !value.trim()) return true; // Optional field
        return value.trim().length >= 5; // Minimal length check
    },

    /**
     * Generic IBAN validator (basic format check for any country)
     */
    iban(value) {
        if (!value || !value.trim()) return true; // Optional field
        const cleaned = value.replace(/\s/g, '');
        // Basic IBAN regex: 2 letters + 2 digits + up to 30 alphanum
        return /^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(cleaned);
    },

    /**
     * BIC/SWIFT code: 8 or 11 alphanumeric characters
     */
    bic(value) {
        if (!value || !value.trim()) return true;
        return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(value.trim());
    },

    /**
     * Email address (basic format check)
     */
    email(value) {
        if (!value || !value.trim()) return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
    },

    /**
     * Postal code validator with country awareness
     */
    postalCode(value, countryCode = 'SI') {
        if (!value || !value.trim()) return true;
        const val = value.trim();
        
        const patterns = {
            'SI': /^\d{4}$/,         // Slovenia
            'HR': /^\d{5}$/,         // Croatia
            'AT': /^\d{4}$/,         // Austria
            'DE': /^\d{5}$/,         // Germany
            'IT': /^\d{5}$/          // Italy
        };

        const pattern = patterns[countryCode.toUpperCase()];
        return pattern ? pattern.test(val) : /^[A-Z0-9\s-]{3,10}$/i.test(val);
    },

    /**
     * Phone number (basic loose check)
     */
    phone(value) {
        if (!value || !value.trim()) return true;
        // Allow digits, spaces, +, -, (, ), /
        return /^[\d\s+\-()\/]+$/.test(value.trim());
    },

    /**
     * Non-empty string
     */
    required(value) {
        return typeof value === 'string' && value.trim().length > 0;
    },

    /**
     * Positive number
     */
    positiveNumber(value) {
        const num = parseFloat(value);
        return !isNaN(num) && num > 0;
    },

    /**
     * Date is not empty
     */
    validDate(value) {
        return !!value && !isNaN(new Date(value).getTime());
    },

    /**
     * Due date is not before issue date
     */
    dueDateAfter(dateDue, dateIssued) {
        if (!dateDue || !dateIssued) return true;
        return new Date(dateDue) >= new Date(dateIssued);
    },

    // --- Generic Validation Engine ---

    _validate(data, schema) {
        const errors = [];
        const warnings = [];
        const country = data.country || 'SI';

        for (const [field, rules] of Object.entries(schema)) {
            const val = data[field];

            // 1. Critical Errors
            if (rules.required && !this.required(val)) {
                errors.push(rules.requiredMsg || `${field} je obvezno polje.`);
            }

            // 2. Formatting Warnings (Soft)
            if (val) {
                if (rules.taxID && !this.isInternationalTaxID(val, country)) {
                    warnings.push(rules.taxIDMsg || 'Davčna številka morda ni v pravilnem formatu.');
                }
                if (rules.regNum && country === 'SI' && !this.isSlovenianRegistrationNumber(val)) {
                    warnings.push('Matična številka običajno vsebuje točno 10 števk.');
                }
                if (rules.iban && !this.iban(val)) {
                    warnings.push('IBAN morda ni v pravilnem formatu.');
                } else if (rules.iban && !this.ibanMod97(val)) {
                    warnings.push('Kontrolna vsota IBAN morda ni pravilna (Mod97).');
                }
                if (rules.bic && !this.bic(val)) {
                    warnings.push('BIC/SWIFT koda morda ni pravilna.');
                }
                if (rules.email && !this.email(val)) {
                    warnings.push('E-poštni naslov ni v veljavnem formatu.');
                }
                if (rules.phone && !this.phone(val)) {
                    warnings.push('Telefonska številka morda vsebuje neveljavne znake.');
                }
                if (rules.postalCode && !this.postalCode(val, country)) {
                    warnings.push(`Poštna številka običajno vsebuje ${country === 'SI' ? '4 števke' : 'pravilen format'}.`);
                }
                if (rules.positive && !this.positiveNumber(val)) {
                    errors.push(rules.positiveMsg || 'Vrednost mora biti pozitivna.');
                }
            }
        }
        return { isValid: errors.length === 0, errors, warnings };
    },

    /**
     * Validate company form data
     */
    validateCompany(data) {
        return this._validate(data, {
            companyName: { required: true, requiredMsg: 'Naziv podjetja je obvezen.' },
            taxNumber: { taxID: true },
            registrationNumber: { regNum: true },
            iban: { iban: true },
            bic: { bic: true },
            postalCode: { postalCode: true }
        });
    },

    /**
     * Validate partner form data
     */
    validatePartner(data) {
        return this._validate(data, {
            name: { required: true, requiredMsg: 'Naziv partnerja je obvezen.' },
            taxNumber: { taxID: true },
            registrationNumber: { regNum: true },
            email: { email: true },
            phone: { phone: true },
            postalCode: { postalCode: true }
        });
    },

    /**
     * Validate service/article form data
     * Architecture Pattern: Uses unified _validate schema engine.
     */
    validateService(data) {
        const result = this._validate(data, {
            name: { required: true, requiredMsg: 'Naziv storitve je obvezen.' },
            price: { required: true, requiredMsg: 'Cena storitve je obvezna.', positive: true, positiveMsg: 'Cena mora biti pozitivna vrednost.' }
        });

        // Additional cross-field check: vatRate must be a valid number if provided
        if (data.vatRate !== undefined && data.vatRate !== '') {
            const rate = parseFloat(data.vatRate);
            if (isNaN(rate) || rate < 0 || rate > 100) {
                result.errors.push('Stopnja DDV mora biti med 0 in 100.');
                result.isValid = false;
            }
        }

        return result;
    },

    /**
     * Validate invoice data
     */
    validateInvoice(data) {
        // 1. Basic field validation via schema
        const result = this._validate(data, {
            companyId: { required: true, requiredMsg: 'Izdajatelj je obvezen.' },
            partnerId: { required: true, requiredMsg: 'Prejemnik je obvezen.' },
            dateIssued: { required: true, requiredMsg: 'Datum izdaje je obvezen.' },
            dateDue: { required: true, requiredMsg: 'Rok plačila je obvezen.' }
        });

        // 2. Logic-based rules (Cross-field)
        if (data.dateIssued && data.dateDue && !this.dueDateAfter(data.dateDue, data.dateIssued)) {
            result.errors.push('Rok plačila ne sme biti pred datumom izdaje.');
        }

        if (!data.items?.length) {
            result.errors.push('Dodajte vsaj eno postavko.');
        } else {
            data.items.forEach((item, i) => {
                if (!this.required(item.description)) result.errors.push(`Postavka ${i + 1}: opis manjka.`);
                if (!this.positiveNumber(item.quantity)) result.errors.push(`Postavka ${i + 1}: količina mora biti > 0.`);
                if (!this.positiveNumber(item.price)) result.errors.push(`Postavka ${i + 1}: cena mora biti > 0.`);
            });
        }

        // 3. Financial Standards (UPN/QR)
        if (data.referenceModel && data.referenceNumber) {
            const refCheck = this.validateReference(data.referenceModel, data.referenceNumber);
            if (!refCheck.valid) {
                if (data.includeUpn) result.errors.push(`UPN: ${refCheck.message}`);
                else result.warnings.push(refCheck.message);
            }
        }

        if (data.purposeCode && !this.purposeCode(data.purposeCode)) {
            result.warnings.push('Koda namena mora vsebovati 4 črke (npr. GDSV).');
        }

        result.isValid = result.errors.length === 0;
        return result;
    },

    // --- Advanced Validators (2026 — soft warnings only) ---

    /**
     * IBAN Mod97 checksum verification (ISO 13616)
     * Returns true if IBAN passes Mod97 check or is empty.
     */
    ibanMod97(value) {
        if (!value || !value.trim()) return true;
        const cleaned = value.replace(/\s/g, '').toUpperCase();
        if (cleaned.length < 5 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) return false;

        const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
        const numStr = this._stringToNumeric(rearranged);

        if (!numStr) return false;

        try {
            return BigInt(numStr) % 97n === 1n;
        } catch (e) {
            return false;
        }
    },

    /**
     * Validates Slovenian SI reference 
     * Handles specific ZBS models: 00, 01, 02, 05, 11, 12, 18, 99
     * @param {string} fullRef - Full reference string, e.g., "SI0519-1235-845037"
     * @returns {boolean}
     */
    validateSI(fullRef) {
        if (!fullRef || !fullRef.startsWith('SI')) return false;

        // Normalize dashes
        const normalized = fullRef.replace(/[\u2013\u2014]/g, '-').toUpperCase();
        const model = normalized.substring(2, 4);
        const data = normalized.substring(4); // Keep hyphens for part-based validation
        const numericOnly = data.replace(/[^0-9]/g, '');

        if (model === '99') return numericOnly.length === 0;
        if (model === '00') return /^[\d-]{1,22}$/.test(data) && numericOnly.length > 0;

        // Mathematical validation based on model
        switch (model) {
            case '12':
                // Strict rule: 13 digits total
                if (numericOnly.length !== 13) return false;
                return this._checkMod11(numericOnly);

            case '05':
                // Modulo 97-10 (ISO 7064)
                if (numericOnly.length < 3 || numericOnly.length > 20) return false;
                return this._checkMod97(numericOnly);

            case '11':
                // Multi-part Modulo 11: P1-P2-P3
                const p11 = data.split('-').filter(p => p.length > 0);
                if (p11.length < 2) return false; 
                if (!this._checkMod11(p11[0])) return false;
                if (!this._checkMod11(p11[1])) return false;
                return true;

            case '18':
                // Three-part Modulo 11
                const p18 = data.split('-').filter(p => p.length > 0);
                if (p18.length < 3) return false;
                if (!this._checkMod11(p18[0])) return false;
                if (!this._checkMod11(p18[1])) return false;
                if (!this._checkMod11(p18[2])) return false;
                return true;

            case '01':
            case '02':
                return this._checkMod11(numericOnly);

            default:
                if (numericOnly.length < 2) return false;
                return this._checkMod11(numericOnly);
        }
    },

    /**
     * Internal Modulo 11 check (ZBS Variant)
     */
    _checkMod11(s) {
        const clean = s.replace(/\D/g, '');
        if (clean.length < 2) return false;
        
        const data = clean.substring(0, clean.length - 1);
        const K = parseInt(clean.substring(clean.length - 1), 10);
        
        return K === this.calculateMod11(data);
    },

    /**
     * Calculates Modulo 11 Check Digit (ZBS Rule)
     */
    calculateMod11(data) {
        const s = data.toString().replace(/[^0-9]/g, '');
        let sum = 0;
        let weight = 2;

        for (let i = s.length - 1; i >= 0; i--) {
            sum += parseInt(s[i], 10) * weight;
            weight++;
            if (weight > 13) weight = 2;
        }

        const remainder = sum % 11;
        if (remainder === 0 || remainder === 1) return 0;
        return 11 - remainder;
    },

    /**
     * Internal Modulo 97-10 check (ISO 7064)
     */
    _checkMod97(s) {
        const clean = s.replace(/\D/g, '');
        if (clean.length < 3) return false;
        try {
            return BigInt(clean) % 97n === 1n;
        } catch (e) {
            return false;
        }
    },

    /**
     * Validates ISO 11649 RF reference (Modulo 97-10)
     */
    validateRF(fullRef) {
        if (!fullRef || !fullRef.startsWith('RF')) return false;
        
        const cleanRef = fullRef.replace(/[\s\u2013\u2014-]/g, '').toUpperCase();
        if (cleanRef.length < 5 || cleanRef.length > 25) return false;

        const shifted = cleanRef.substring(4) + cleanRef.substring(0, 4);
        const numericStr = this._stringToNumeric(shifted);
        if (!numericStr) return false;

        try {
            return BigInt(numericStr) % 97n === 1n;
        } catch (e) {
            return false;
        }
    },

    /**
     * Converts letters in string to numbers (A=10, ..., Z=35)
     */
    _stringToNumeric(s) {
        let res = '';
        for (let i = 0; i < s.length; i++) {
            const code = s.charCodeAt(i);
            if (code >= 65 && code <= 90) { // A-Z
                res += (code - 55).toString();
            } else if (code >= 48 && code <= 57) { // 0-9
                res += s[i];
            } else {
                return null;
            }
        }
        return res;
    },

    /**
     * Validate UPN purpose code (exactly 4 uppercase letters)
     */
    purposeCode(value) {
        if (!value || !value.trim()) return true;
        return /^[A-Z]{4}$/.test(value.trim().toUpperCase());
    },

    /**
     * Validate UPN reference based on selected model.
     * Returns { valid: boolean, message: string|null }
     */
    validateReference(model, number) {
        if (!model || !number) return { valid: true, message: null };

        const cleanModel = model.trim().toUpperCase();
        const cleanNumber = number.trim();
        const fullRef = `${cleanModel}${cleanNumber}`;

        if (cleanModel.startsWith('SI')) {
            if (!this.validateSI(fullRef)) {
                return { valid: false, message: `Kontrolna številka ${cleanModel} sklica morda ni pravilna.` };
            }
        } else if (cleanModel.startsWith('RF')) {
            if (!this.validateRF(fullRef)) {
                return { valid: false, message: 'RF sklic morda ni pravilno izračunan (Mod 97-10).' };
            }
        }

        return { valid: true, message: null };
    }
};


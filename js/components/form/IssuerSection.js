import { StorageManager } from '../../modules/StorageManager.js';
import { Validators } from '../../validators.js';
import { Events } from '../../event-bus.js';
import { EntityFormHandler } from './EntityFormHandler.js';

/**
 * IssuerSection 
 * Handles company/issuer entity management using EntityFormHandler.
 */
const handler = new EntityFormHandler({
    type: 'issuer',
    selectId: 'inv-company',
    formId: 'inline-company-form',
    displayId: 'issuer-info-display',
    templateId: 'template-issuer-display-card',
    idPrefix: 'inline-comp-',
    entityStoreKey: 'companyId',
    getEntities: () => StorageManager.getCompanies(),
    getEntity: (id) => StorageManager.getCompany(id),
    saveEntity: (data) => StorageManager.saveCompany(data),
    validate: (data) => Validators.validateCompany(data),
    onSaved: () => Events.emit('company-saved'),
    onSelected: (company) => Events.emit('company-selected', company)
});

export const IssuerSection = {
    async init() {
        return handler.init();
    },

    async loadCompanies() {
        return handler.loadEntities();
    },

    async updateDisplay(companyId) {
        return handler.updateDisplay(companyId);
    }
};

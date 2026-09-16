import { StorageManager } from '../../modules/StorageManager.js';
import { Validators } from '../../validators.js';
import { Events } from '../../event-bus.js';
import { EntityFormHandler } from './EntityFormHandler.js';

/**
 * PartnerSection 
 * Handles partner entity management using EntityFormHandler.
 */
const handler = new EntityFormHandler({
    type: 'partner',
    selectId: 'inv-partner',
    formId: 'inline-partner-form',
    displayId: 'partner-info-display',
    templateId: 'template-partner-display-card',
    idPrefix: 'new-partner-',
    entityStoreKey: 'partnerId',
    getEntities: () => StorageManager.getPartners(),
    getEntity: (id) => StorageManager.getPartner(id),
    saveEntity: (data) => StorageManager.savePartner(data),
    validate: (data) => Validators.validatePartner(data),
    onSaved: () => Events.emit('partner-saved'),
    onSelected: (partner) => Events.emit('partner-selected', partner)
});

export const PartnerSection = {
    async init() {
        return handler.init();
    },

    async loadPartners() {
        return handler.loadEntities();
    },

    async updateDisplay(partnerId) {
        return handler.updateDisplay(partnerId);
    }
};

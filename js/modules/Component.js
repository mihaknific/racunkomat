/**
 * Component Helper - Minimalist boilerplate reduction for UI components.
 * Architecture Pattern.
 */
export const Component = {
    /**
     * Mapira DOM elemente v component.els objekt.
     * @param {Object} component - Objekt komponente (npr. Home, Settings)
     * @param {Object} selectors - Ključi so imena v .els, vrednosti so ID-ji (brez #) ali CSS selektorji.
     */
    init(component, selectors = {}) {
        component.els = {};
        for (const [name, selector] of Object.entries(selectors)) {
            if (!selector.startsWith('.') && !selector.startsWith('[') && !selector.includes(' ')) {
                // Preprosti ID (npr. 'btn-save')
                component.els[name] = document.getElementById(selector);
            } else {
                // CSS Selektor (npr. '.item-row' ali '#my-id')
                component.els[name] = document.querySelector(selector);
            }
        }
    },

    /**
     * Helper za delegacijo dogodkov za data-action elemente.
     * Podpira klik in tipkovnico (Enter/Space).
     * @param {HTMLElement} parent - Starševski element za poslušanje
     * @param {Object} actions - Mapa funkcij (npr. { 'delete': (id, el) => ... })
     */
    delegate(parent, actions) {
        if (!parent) return;

        const handler = (e) => {
            if (e.type === 'keydown' && !['Enter', ' '].includes(e.key)) return;
            
            const el = e.target.closest('[data-action]');
            if (!el) return;
            
            const action = el.dataset.action;
            if (actions[action]) {
                e.preventDefault();
                e.stopPropagation();
                actions[action](el.dataset.id, el);
            }
        };

        parent.addEventListener('click', handler);
        parent.addEventListener('keydown', handler);
    }
};

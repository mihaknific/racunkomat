/**
 * Event Bus (Pub/Sub)
 * A lightweight publish-subscribe pattern implementation for decoupling components.
 */

class EventBus {
    constructor() {
        this.listeners = {};
    }

    /**
     * Subscribe to an event
     * @param {string} event - The event name
     * @param {function} callback - The function to call when the event occurs
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        // Zaščita pred dvojnim naročanjem istega poslušalca
        if (this.listeners[event].includes(callback)) return () => this.off(event, callback);
        this.listeners[event].push(callback);
        
        // Decoupling optimization: return unsubscribe function directly to avoid memory leaks.
        return () => this.off(event, callback);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - The event name
     * @param {function} callback - The function to remove
     */
    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    /**
     * Emit an event
     * @param {string} event - The event name
     * @param {*} data - Optional data to pass to listeners
     */
    emit(event, data = null) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => {
            try {
                const result = callback(data);
                // Catch Promise rejections for asynchronous handlers to prevent unhandled rejection crashes.
                if (result instanceof Promise) {
                    result.catch(error => {
                        console.error(`Async error in event listener for ${event}:`, error);
                    });
                }
            } catch (error) {
                console.error(`Sync error in event listener for ${event}:`, error);
            }
        });
    }
}

// Export a single, global instance
export const Events = new EventBus();

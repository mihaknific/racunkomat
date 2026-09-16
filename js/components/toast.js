export const Toast = {
    _createToast(message, typeClasses, iconClass, buttonConfig, timeout) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `card card--highlight toast ${typeClasses}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');

        if (iconClass) {
            const iconEl = document.createElement('i');
            iconEl.className = `fa-solid ${iconClass}`;
            iconEl.setAttribute('aria-hidden', 'true');
            toast.appendChild(iconEl);
        }

        const span = document.createElement('span');
        span.textContent = message;
        toast.appendChild(span);

        let timeoutId;
        const closeToast = () => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        };

        if (buttonConfig) {
            const btn = document.createElement('button');
            btn.className = `btn btn-sm btn-outline-white ${buttonConfig.className || ''}`;
            btn.setAttribute('aria-label', buttonConfig.ariaLabel || '');
            btn.textContent = buttonConfig.text;
            btn.addEventListener('click', () => buttonConfig.onClick(btn, closeToast, () => clearTimeout(timeoutId)));
            toast.appendChild(btn);
        }

        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);

        if (timeout) {
            timeoutId = setTimeout(closeToast, timeout);
        }
    },

    show(message, type = 'success') {
        const iconMap = {
            'error': 'fa-exclamation-circle',
            'warning': 'fa-exclamation-triangle',
            'info': 'fa-info-circle',
            'success': 'fa-check-circle'
        };
        this._createToast(message, type, iconMap[type] || iconMap.success, null, 4000);
    },

    showUndo(message, onUndo) {
        this._createToast(message, 'warning toast-undo', null, {
            text: 'Prekliči',
            className: 'btn-undo-action',
            ariaLabel: 'Prekliči in razveljavi brisanje',
            onClick: (btn, closeToast, clearTimer) => {
                clearTimer();
                onUndo();
                closeToast();
                this.show('Brisanje preklicano.', 'success');
            }
        }, 5000);
    },

    showUpdate(message, onUpdateClick) {
        this._createToast(message, 'info toast-undo', null, {
            text: 'Posodobi zdaj',
            className: 'toast-action-btn',
            ariaLabel: 'Posodobi aplikacijo',
            onClick: (btn) => {
                btn.disabled = true;
                btn.textContent = 'Posodabljam...';
                onUpdateClick();
            }
        }, 0); // No timeout
    }
};

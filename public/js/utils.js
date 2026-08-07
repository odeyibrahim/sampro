/**
 * Shared utilities for V. Gallery.
 * Loaded before app.js / admin-app.js on every page that needs it.
 */
(function (global) {
    'use strict';

    /**
     * Escape a string for safe insertion into innerHTML.
     * Use this around ANY value that originates outside your own source code:
     * URL params, API/network responses, localStorage/sessionStorage, user input.
     */
    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"']/g, function (ch) {
            switch (ch) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#39;';
                default: return ch;
            }
        });
    }

    /** Escape a value for safe use inside an HTML attribute. */
    function escapeAttr(value) {
        return escapeHtml(value);
    }

    /**
     * Trap Tab/Shift+Tab focus inside `container` while it is open.
     * Returns a release() function to call when the modal/panel closes.
     */
    function trapFocus(container) {
        if (!container) return function release() {};

        var FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
        var previouslyFocused = document.activeElement;

        function handleKeydown(e) {
            if (e.key !== 'Tab') return;
            var focusable = Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE))
                .filter(function (el) { return el.offsetParent !== null; });
            if (focusable.length === 0) return;

            var first = focusable[0];
            var last = focusable[focusable.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }

        container.addEventListener('keydown', handleKeydown);

        var firstFocusable = container.querySelector(FOCUSABLE);
        if (firstFocusable) firstFocusable.focus();

        return function release() {
            container.removeEventListener('keydown', handleKeydown);
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus();
            }
        };
    }

    /** Read a URL query parameter safely (always returns a string, never null/undefined). */
    function getQueryParam(name) {
        try {
            return new URLSearchParams(window.location.search).get(name) || '';
        } catch (e) {
            return '';
        }
    }

    global.Utils = {
        escapeHtml: escapeHtml,
        escapeAttr: escapeAttr,
        trapFocus: trapFocus,
        getQueryParam: getQueryParam
    };
})(window);

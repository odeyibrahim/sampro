(function () {
    'use strict';

    // Session storage, not localStorage: the token is cleared when the tab closes,
    // which shrinks the XSS/theft window versus a persistent localStorage token.
    // Real authorization for every admin action still happens server-side in the
    // Netlify function — this token is just a bearer credential, never trusted
    // on its own for anything client-side (e.g. we never hide/show admin UI based on it).
    if (sessionStorage.getItem('admin_token')) {
        window.location.href = '/admin/dashboard.html';
    }

    var form = document.getElementById('loginForm');
    var errorDiv = document.getElementById('error');
    var btn = document.getElementById('loginBtn');
    var passwordInput = document.getElementById('password');

    function showError(message) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    function clearError() {
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
    }

    async function login(e) {
        e.preventDefault();
        var password = passwordInput.value;

        if (!password) {
            showError('Please enter password');
            return;
        }

        clearError();
        btn.disabled = true;
        btn.textContent = 'Checking…';

        try {
            var response = await fetch('/.netlify/functions/admin-operations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operation: 'login', data: { password: password } })
            });

            var result = await response.json();

            if (result.success && result.token) {
                sessionStorage.setItem('admin_token', result.token);
                window.location.href = '/admin/dashboard.html';
            } else {
                showError(result.error || 'Login failed');
                passwordInput.value = '';
                passwordInput.focus();
            }
        } catch (err) {
            showError('Network error. Please try again.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Login';
        }
    }

    form.addEventListener('submit', login);
})();

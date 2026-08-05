(function () {
    'use strict';
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
/* LearniTY PWA: register the app-shell service worker.
 *
 * Registration is deliberately quiet. If it fails (file://, an old browser,
 * or a blocked service worker) the normal page keeps working. The worker only
 * serves the shell from cache when the network is unavailable.
 */
(function () {
    if (!('serviceWorker' in navigator)) return;

    const host = window.location.hostname;
    const secure = window.location.protocol === 'https:' ||
        host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (!secure) return;

    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function (err) {
            console.warn('LearniTY service worker registration failed:', err);
        });
    });
})();

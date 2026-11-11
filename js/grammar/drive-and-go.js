/* LearniTY Dictation — the Drive & Go! shell on the Tenses page.
   The Mario Kart-style game arrives in a later PR, so this is only the
   placeholder page. It reuses #grammar-detail-view like the other grammar pages. */

        function showDriveAndGo() {
            const content = document.getElementById('grammar-detail-content');
            document.getElementById('detail-back-btn').onclick = () => changeView('grammar-revision-view');
            content.innerHTML = `
                <div class="text-center mb-10"><div class="text-8xl mb-4">🏎️</div><h2 class="text-4xl font-bold text-green-600">Drive & Go!</h2></div>
                <div class="text-center bg-green-50 border-2 border-dashed border-green-200 rounded-2xl p-10"><p class="text-xl font-bold text-green-700">The game will be added soon.</p></div>
            `;
            changeView('grammar-detail-view');
            recordGuestUsage('Grammar Quest', 'Drive & Go!');
        }

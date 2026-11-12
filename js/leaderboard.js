/* LearniTY Dictation — Hub leaderboard (dictation / grammar / Word Jump).
   Moved verbatim out of index.html. */

        let lbModeFilter = 'all';
        let lbRows = null;
        let lbRowsError = null;

        function setLeaderboardBlurb() {
            const blurb = document.getElementById('leaderboard-blurb');
            if (!blurb) return;
            blurb.textContent = lbModeFilter === 'wordjump'
                ? 'Personal bests — top 10 by best score and words collected.'
                : lbModeFilter === 'wjchallenge'
                    ? 'All-time Challenge wins — match history lasts 7 days; wins stay.'
                    : (lbModeFilter === 'dgsolo' || lbModeFilter === 'dgmulti')
                        ? 'Personal bests by composite score — time, accuracy, questions and AV / PV / Mixed.'
                        : 'Cumulative scores — practice more to rank higher!';
        }

        async function loadLeaderboard(mode) {
            if (isGuestUser()) return;
            lbModeFilter = mode || 'all';
            paintChoiceButtons('.lb-mode-btn', lbModeFilter);
            setLeaderboardBlurb();
            const container = document.getElementById('leaderboard-container');
            if (!container) return;
            container.innerHTML = '<div class="flex flex-col items-center py-10"><div class="loader mb-4"></div><p class="text-orange-400 font-bold">Loading...</p></div>';
            if (lbModeFilter === 'wjchallenge') {
                const { data, error } = await WJC.fetchWins();
                if (lbModeFilter !== 'wjchallenge' || isGuestUser() || !currentUser) return;
                container.innerHTML = error ? WJC.reportError(error) : WJC.winsHtml(data);
                return;
            }
            if (isAdmin()) await ensureFormDirectory();
            if (lbModeFilter === 'wordjump') {
                const { data, error } = await sb.from('wj_leaderboard')
                    .select('user_id,nickname,email,score,height,words,plays,created_at')
                    .order('score', { ascending: false })
                    .order('words', { ascending: false })
                    .order('created_at', { ascending: true })
                    .limit(10);
                lbRows = data || [];
                lbRowsError = error || null;
                renderLeaderboard();
                return;
            }
            if (lbModeFilter === 'dgsolo' || lbModeFilter === 'dgmulti') {
                const view = lbModeFilter === 'dgsolo'
                    ? 'drive_and_go_solo_leaderboard'
                    : 'drive_and_go_multi_leaderboard';
                const { data, error } = await sb.from(view)
                    .select('user_id,nickname,email,bank_mode,question_count,scene,composite,race_score,time_bonus,correct,wrong,accuracy,elapsed_ms,plays,created_at')
                    .order('composite', { ascending: false })
                    .order('elapsed_ms', { ascending: true })
                    .order('accuracy', { ascending: false })
                    .order('created_at', { ascending: true })
                    .limit(10);
                lbRows = data || [];
                lbRowsError = error || null;
                renderLeaderboard();
                return;
            }
            let query = sb.from("dictation_results").select("email, nickname, score, total, topic, mode, created_at");
            if (lbModeFilter !== 'all') query = query.eq("mode", lbModeFilter);
            const { data, error } = await query.order("created_at", { ascending: false }).limit(1000);
            lbRows = data || [];
            lbRowsError = error || null;
            renderLeaderboard();
        }

        function renderWordJumpLeaderboard(container) {
            if (lbRowsError) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">Word Jump leaderboard not available. Run <code class="text-orange-600">supabase/wj_scores.sql</code> in the SQL editor.</p>';
                return;
            }
            if (!lbRows.length) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">No Word Jump games recorded yet.</p>';
                return;
            }
            const medals = ['🥇', '🥈', '🥉'];
            const rowHtml = (r, i) => `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 gap-3 ${i < 3 ? 'border-2 border-orange-200 bg-orange-50' : ''}">
                            <span class="text-2xl w-10 text-center">${medals[i] || (i + 1)}</span>
                            <span class="font-bold text-gray-700 flex-1 ml-3">${escapeHtml(displayName(r))}${isAdmin() ? classBadge(r.email, r.nickname) : ''}</span>
                            ${formAssignControl(r.email, r.nickname)}
                            <span class="text-gray-400 text-sm mx-2">${Number(r.words) || 0} words</span>
                            <span class="font-bold text-orange-600 text-lg">${Number(r.score) || 0} pts</span>
                        </div>`;
            if (!isAdmin()) {
                container.innerHTML = `<div class="space-y-3">${lbRows.map(rowHtml).join('')}</div>`;
                return;
            }
            container.innerHTML = renderFormSections(groupRowsByForm(lbRows), (rows) =>
                `<div class="space-y-3">${rows.map(rowHtml).join('')}</div>`
            , { emptyAll: '<p class="text-gray-400 text-center py-10">No Word Jump games recorded yet.</p>' });
        }

        function renderDriveAndGoLeaderboard(container) {
            const solo = lbModeFilter === 'dgsolo';
            if (lbRowsError) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">Drive &amp; Go! leaderboard not available. Run <code class="text-orange-600">supabase/drive_and_go_scenes_and_boards.sql</code> in the SQL editor.</p>';
                return;
            }
            if (!lbRows.length) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">No Drive &amp; Go! ' + (solo ? 'Solo' : 'Multiplayer') + ' runs recorded yet.</p>';
                return;
            }
            const medals = ['🥇', '🥈', '🥉'];
            const rowHtml = (r, i) => {
                const time = (typeof DG !== 'undefined' && DG.formatRaceTime)
                    ? DG.formatRaceTime((Number(r.elapsed_ms) || 0) / 1000)
                    : Math.round((Number(r.elapsed_ms) || 0) / 1000) + 's';
                const acc = (typeof DG !== 'undefined' && DG.formatAccuracy)
                    ? DG.formatAccuracy(r.accuracy)
                    : Math.round((Number(r.accuracy) || 0) * 100) + '%';
                const n = (typeof DG !== 'undefined' && DG.normalizeQuestionCount)
                    ? DG.normalizeQuestionCount(r.question_count)
                    : (Number(r.question_count) || 20);
                const bank = (typeof DG !== 'undefined' && DG.MODE_SHORT && DG.MODE_SHORT[r.bank_mode]) || 'AV';
                const scene = (typeof DG !== 'undefined' && DG.sceneLabel)
                    ? DG.sceneLabel(r.scene)
                    : String(r.scene || 'Desert Hills');
                const runs = Number(r.plays) > 1 ? ' · ' + Number(r.plays) + ' runs' : '';
                const meta = time + ' · ' + acc + ' · ' + n + ' Q · ' + bank + ' · ' + scene + runs;
                return `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 gap-3 ${i < 3 ? 'border-2 border-orange-200 bg-orange-50' : ''}">
                            <span class="text-2xl w-10 text-center">${medals[i] || (i + 1)}</span>
                            <div class="flex-1 ml-3 min-w-0">
                                <p class="font-bold text-gray-700 truncate">${escapeHtml(displayName(r))}${isAdmin() ? classBadge(r.email, r.nickname) : ''}</p>
                                <p class="text-xs text-gray-400 truncate">${escapeHtml(meta)}</p>
                            </div>
                            ${formAssignControl(r.email, r.nickname)}
                            <span class="font-bold text-orange-600 text-lg whitespace-nowrap">${Number(r.composite) || 0} pts</span>
                        </div>`;
            };
            if (!isAdmin()) {
                container.innerHTML = `<div class="space-y-3">${lbRows.map(rowHtml).join('')}</div>`;
                return;
            }
            const empty = '<p class="text-gray-400 text-center py-10">No Drive &amp; Go! ' + (solo ? 'Solo' : 'Multiplayer') + ' runs recorded yet.</p>';
            container.innerHTML = renderFormSections(groupRowsByForm(lbRows), (rows) =>
                `<div class="space-y-3">${rows.map(rowHtml).join('')}</div>`
            , { emptyAll: empty, emptyForm: '<p class="text-gray-400 text-center py-4">No runs from this form yet.</p>' });
        }

        function renderLeaderboard() {
            if (isGuestUser()) return;
            const container = document.getElementById('leaderboard-container');
            if (!container || !lbRows || lbModeFilter === 'wjchallenge') return;
            if (lbModeFilter === 'wordjump') {
                renderWordJumpLeaderboard(container);
                return;
            }
            if (lbModeFilter === 'dgsolo' || lbModeFilter === 'dgmulti') {
                renderDriveAndGoLeaderboard(container);
                return;
            }
            if (lbRowsError || !lbRows.length) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">No records yet.</p>';
                return;
            }
            const studentMap = {};
            lbRows.forEach(r => {
                const key = (r.email || '').toLowerCase();
                if (!studentMap[key]) studentMap[key] = { nickname: r.nickname, email: r.email, totalScore: 0, quizzes: 0 };
                studentMap[key].totalScore += r.score;
                studentMap[key].quizzes++;
                if (r.nickname) studentMap[key].nickname = r.nickname;
            });
            const medals = ['🥇', '🥈', '🥉'];
            const rowHtml = (r, i) => `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 gap-3 ${i < 3 ? 'border-2 border-orange-200 bg-orange-50' : ''}">
                            <span class="text-2xl w-10 text-center">${medals[i] || (i + 1)}</span>
                            <span class="font-bold text-gray-700 flex-1 ml-3">${escapeHtml(displayName(r))}${isAdmin() ? classBadge(r.email, r.nickname) : ''}</span>
                            ${formAssignControl(r.email, r.nickname)}
                            <span class="text-gray-400 text-sm mx-2">${r.quizzes} quizzes</span>
                            <span class="font-bold text-orange-600 text-lg">${r.totalScore} pts</span>
                        </div>`;
            if (!isAdmin()) {
                const ranked = Object.values(studentMap).sort((a, b) => b.totalScore - a.totalScore).slice(0, 20);
                container.innerHTML = `<div class="space-y-3">${ranked.map(rowHtml).join('')}</div>`;
                return;
            }
            const ranked = Object.values(studentMap).sort((a, b) => b.totalScore - a.totalScore);
            container.innerHTML = renderFormSections(groupRowsByForm(ranked), (rows) =>
                `<div class="space-y-3">${rows.map(rowHtml).join('')}</div>`
            , { emptyAll: '<p class="text-gray-400 text-center py-10">No records yet.</p>' });
        }

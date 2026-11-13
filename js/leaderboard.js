/* LearniTY Dictation — Hub leaderboard (dictation / grammar / Word Jump).
   Moved verbatim out of index.html. */

        let lbModeFilter = 'all';
        let lbRows = null;
        let lbRowsError = null;

        function setLeaderboardBlurb() {
            const blurb = document.getElementById('leaderboard-blurb');
            if (!blurb) return;
            blurb.textContent = lbModeFilter === 'streaks'
                ? 'Current daily streaks — top 10 by consecutive Hong Kong practice days.'
                : lbModeFilter === 'wordjump'
                    ? 'Personal bests — top 10 by best score and words collected.'
                    : lbModeFilter === 'wjchallenge'
                        ? 'All-time Challenge wins — match history lasts 7 days; wins stay.'
                        : (lbModeFilter === 'dgsolo' || lbModeFilter === 'dgmulti')
                            ? 'Personal bests by composite score — time, accuracy, questions and AV / PV / Mixed.'
                            : 'Cumulative scores — practice more to rank higher!';
        }

        function leaderboardNameHTML(row, suffix) {
            const name = escapeHtml(displayName(row));
            const uid = row && row.user_id ? String(row.user_id) : '';
            const tail = suffix || '';
            if (!uid || isGuestUser() || previewStudentForm()) return name + tail;
            const me = currentUser && currentUser.id === uid;
            const handler = me
                ? 'profileShowOwn()'
                : "openFriendProfile('" + escapeHtml(uid) + "')";
            return '<button type="button" class="lb-name" onclick="' + handler + '" title="' +
                (me ? 'Open my profile' : 'Open profile and follow') + '">' + name + '</button>' + tail;
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
            if (lbModeFilter === 'streaks') {
                const { data, error } = await sb.from('user_streaks')
                    .select('user_id,email,nickname,streak_count,streak_best,last_practice_date,repair_cards')
                    .limit(1000);
                lbRows = data || [];
                lbRowsError = error || null;
                renderLeaderboard();
                return;
            }
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
                const baseColumns = 'user_id,nickname,email,bank_mode,question_count,scene,composite,race_score,time_bonus,correct,wrong,accuracy,elapsed_ms,plays,created_at';
                const readBoard = async (cols) => sb.from(view)
                    .select(cols)
                    .order('composite', { ascending: false })
                    .order('elapsed_ms', { ascending: true })
                    .order('accuracy', { ascending: false })
                    .order('created_at', { ascending: true })
                    .limit(10);
                let { data, error } = await readBoard(baseColumns + ',topic');
                // Old views (before the Agreement SQL) have no topic column.
                if (error && /topic|column .* does not exist|42703|PGRST204/i.test(String(error.message || ''))) {
                    const fallback = await readBoard(baseColumns);
                    data = fallback.data ? fallback.data.map(r => Object.assign({}, r, { topic: 'tenses' })) : fallback.data;
                    error = fallback.error || null;
                }
                lbRows = data || [];
                lbRowsError = error || null;
                renderLeaderboard();
                return;
            }
            let query = sb.from("dictation_results").select("user_id, email, nickname, score, total, topic, mode, created_at");
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
                            <span class="font-bold text-gray-700 flex-1 ml-3">${leaderboardNameHTML(r, isAdmin() ? classBadge(r.email, r.nickname) : '')}</span>
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
                const bank = (typeof DG !== 'undefined' && DG.topicChallenge)
                    ? DG.topicChallenge(r.topic, r.bank_mode)
                    : ((typeof DG !== 'undefined' && DG.MODE_SHORT && DG.MODE_SHORT[r.bank_mode]) || 'Tenses · AV');
                const scene = (typeof DG !== 'undefined' && DG.sceneLabel)
                    ? DG.sceneLabel(r.scene)
                    : String(r.scene || 'Desert Hills');
                const runs = Number(r.plays) > 1 ? ' · ' + Number(r.plays) + ' runs' : '';
                const meta = time + ' · ' + acc + ' · ' + n + ' Q · ' + bank + ' · ' + scene + runs;
                return `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 gap-3 ${i < 3 ? 'border-2 border-orange-200 bg-orange-50' : ''}">
                            <span class="text-2xl w-10 text-center">${medals[i] || (i + 1)}</span>
                            <div class="flex-1 ml-3 min-w-0">
                                <p class="font-bold text-gray-700 truncate">${leaderboardNameHTML(r, isAdmin() ? classBadge(r.email, r.nickname) : '')}</p>
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

        function renderStreakLeaderboard(container) {
            if (lbRowsError) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">Streak leaderboard not available. Run <code class="text-orange-600">supabase/user_streaks.sql</code> in the SQL editor.</p>';
                return;
            }
            const all = (lbRows || [])
                .map(r => Object.assign({}, r, { current_streak: streakCurrentCount(r) }))
                .filter(r => r.current_streak > 0)
                .sort((a, b) => (b.current_streak - a.current_streak)
                    || ((Number(b.streak_best) || 0) - (Number(a.streak_best) || 0))
                    || String(a.nickname || a.email || '').localeCompare(String(b.nickname || b.email || '')));
            const rows = all.slice(0, 10);
            if (!rows.length) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">No active streaks yet. Finish any practice today to start one.</p>';
                return;
            }
            const me = currentUser ? currentUser.id : null;
            const myIndex = me ? all.findIndex(r => r.user_id === me) : -1;
            const myRow = myIndex >= 0 ? all[myIndex] : null;
            const medals = ['🥇', '🥈', '🥉'];
            const rowHtml = (r, i) => `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 gap-3 ${i < 3 ? 'border-2 border-orange-200 bg-orange-50' : ''} ${r.user_id === me ? 'ring-2 ring-orange-300' : ''}">
                            <span class="text-2xl w-10 text-center">${medals[i] || (i + 1)}</span>
                            <span class="font-bold text-gray-700 flex-1 ml-3">${leaderboardNameHTML(r, (r.user_id === me ? ' <span class="text-xs text-orange-500">(you)</span>' : '') + (isAdmin() ? classBadge(r.email, r.nickname) : ''))}</span>
                            ${formAssignControl(r.email, r.nickname)}
                            <span class="text-gray-400 text-xs whitespace-nowrap">best ${Number(r.streak_best) || 0}</span>
                            <span class="font-bold text-orange-600 text-lg whitespace-nowrap">🔥 ${r.current_streak} day${r.current_streak === 1 ? '' : 's'}</span>
                        </div>`;
            if (!isAdmin()) {
                let html = `<div class="space-y-3">${rows.map(rowHtml).join('')}</div>`;
                if (myRow && myIndex >= 10) {
                    html += `<div class="mt-4 bg-orange-50 border-2 border-orange-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                        <span class="font-bold text-orange-700 text-sm">Your rank: #${myIndex + 1}</span>
                        <span class="font-bold text-orange-600">🔥 ${myRow.current_streak} day${myRow.current_streak === 1 ? '' : 's'}</span>
                    </div>`;
                }
                container.innerHTML = html;
                return;
            }
            container.innerHTML = renderFormSections(groupRowsByForm(rows), (list) =>
                `<div class="space-y-3">${list.map(rowHtml).join('')}</div>`
            , { emptyAll: '<p class="text-gray-400 text-center py-10">No active streaks yet.</p>' });
        }

        function renderLeaderboard() {
            if (isGuestUser()) return;
            const container = document.getElementById('leaderboard-container');
            if (!container || !lbRows || lbModeFilter === 'wjchallenge') return;
            if (lbModeFilter === 'streaks') {
                renderStreakLeaderboard(container);
                return;
            }
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
                if (!studentMap[key]) studentMap[key] = { nickname: r.nickname, email: r.email, user_id: r.user_id || '', totalScore: 0, quizzes: 0 };
                if (!studentMap[key].user_id && r.user_id) studentMap[key].user_id = r.user_id;
                studentMap[key].totalScore += r.score;
                studentMap[key].quizzes++;
                if (r.nickname) studentMap[key].nickname = r.nickname;
            });
            const medals = ['🥇', '🥈', '🥉'];
            const rowHtml = (r, i) => `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 gap-3 ${i < 3 ? 'border-2 border-orange-200 bg-orange-50' : ''}">
                            <span class="text-2xl w-10 text-center">${medals[i] || (i + 1)}</span>
                            <span class="font-bold text-gray-700 flex-1 ml-3">${leaderboardNameHTML(r, isAdmin() ? classBadge(r.email, r.nickname) : '')}</span>
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

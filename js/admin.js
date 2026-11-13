/* LearniTY Dictation — teacher dashboard, student login activity and
   guest usage. Moved verbatim out of index.html. */

        let adminCache = {
            dictation: null,
            grammar: null,
            logins: null,
            loginsError: null,
            streaks: null,
            streaksError: null,
            battles: null,
            battlesError: null,
            wj: null,
            dg: null
        };

        async function loadAdminDashboard() {
            if (!isAdmin()) return;
            const { data, error } = await sb.from("dictation_results")
                .select("*")
                .order("created_at", { ascending: false });
            adminCache.dictation = error ? [] : (data || []);
            adminCache.dictationError = error || null;
            renderAdminDashboard();
        }

        function renderAdminDashboard() {
            const statsEl = document.getElementById('admin-stats');
            const listEl = document.getElementById('admin-activity-container');
            if (!statsEl || !listEl || !adminCache.dictation) return;
            const rows = adminCache.dictation;
            if (adminCache.dictationError || !rows.length) {
                statsEl.innerHTML = '';
                listEl.innerHTML = '<p class="text-gray-400 text-center py-10">No data.</p>';
                return;
            }
            const uniqueStudents = new Set(rows.map(r => (r.email || '').toLowerCase())).size;
            const totalQuizzes = rows.length;
            const avgScore = rows.length ? Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length) : 0;
            const topicsUsed = new Set(rows.map(r => r.topic)).size;
            statsEl.innerHTML = `
                <div class="bg-orange-50 rounded-2xl p-5 text-center border-2 border-orange-100">
                    <div class="text-3xl font-bold text-orange-600">${uniqueStudents}</div>
                    <div class="text-sm text-gray-500 font-bold">Students</div>
                </div>
                <div class="bg-blue-50 rounded-2xl p-5 text-center border-2 border-blue-100">
                    <div class="text-3xl font-bold text-blue-600">${totalQuizzes}</div>
                    <div class="text-sm text-gray-500 font-bold">Quizzes Done</div>
                </div>
                <div class="bg-green-50 rounded-2xl p-5 text-center border-2 border-green-100">
                    <div class="text-3xl font-bold text-green-600">${avgScore}</div>
                    <div class="text-sm text-gray-500 font-bold">Avg Score</div>
                </div>
                <div class="bg-purple-50 rounded-2xl p-5 text-center border-2 border-purple-100">
                    <div class="text-3xl font-bold text-purple-600">${topicsUsed}</div>
                    <div class="text-sm text-gray-500 font-bold">Topics Used</div>
                </div>
            `;
            const studentMap = {};
            rows.forEach(r => {
                const key = (r.email || '').toLowerCase();
                if (!studentMap[key]) studentMap[key] = { nickname: r.nickname, email: r.email, quizzes: 0, totalScore: 0, topics: new Set(), lastActive: r.created_at };
                studentMap[key].quizzes++;
                studentMap[key].totalScore += r.score;
                studentMap[key].topics.add(r.topic);
                if (r.nickname) studentMap[key].nickname = r.nickname;
                if (r.created_at > studentMap[key].lastActive) studentMap[key].lastActive = r.created_at;
            });
            const students = Object.values(studentMap).sort((a, b) => b.totalScore - a.totalScore);
            listEl.innerHTML = renderFormSections(groupRowsByForm(students), (list) => `
                <div class="space-y-3">
                    ${list.map((s, i) => `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 gap-3 flex-wrap">
                            <div class="flex items-center gap-3 flex-1 min-w-[220px]">
                                <span class="text-lg font-bold text-gray-400 w-8 text-center">${i + 1}</span>
                                <div>
                                    <span class="font-bold text-gray-700">${escapeHtml(displayName(s))}${classBadge(s.email, s.nickname)}</span>
                                    <span class="text-gray-400 text-xs ml-2">${escapeHtml(s.email || '')}</span>
                                </div>
                                ${formAssignControl(s.email, s.nickname)}
                            </div>
                            <div class="flex items-center gap-4 text-sm">
                                <span class="text-gray-500">${s.quizzes} quizzes</span>
                                <span class="text-gray-500">${s.topics.size} topics</span>
                                <span class="font-bold text-orange-600">${s.totalScore} pts</span>
                                <span class="text-gray-400 text-xs">${new Date(s.lastActive).toLocaleDateString()}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `, { collapsible: true, scope: 'admin-activity' });
        }

        // --- Admin: Drive & Go! records (inside the Grammar Quest card) ---
        // Two separate personal-best views already exist in the live project:
        // drive_and_go_solo_leaderboard / drive_and_go_multi_leaderboard.
        // No new schema is needed.

        function driveAndGoBoardSummary(rows) {
            const list = Array.isArray(rows) ? rows : [];
            let runs = 0;
            let best = 0;
            let bestName = '';
            list.forEach(r => {
                const plays = Number(r && r.plays);
                runs += isFinite(plays) && plays > 0 ? plays : 1;
                const composite = Number(r && r.composite) || 0;
                if (composite > best) {
                    best = composite;
                    bestName = displayName(r);
                }
            });
            return { players: list.length, runs, best, bestName };
        }

        function driveAndGoRowMeta(r) {
            const row = r || {};
            const elapsed = (Number(row.elapsed_ms) || 0) / 1000;
            const time = (typeof DG !== 'undefined' && DG.formatRaceTime)
                ? DG.formatRaceTime(elapsed)
                : Math.round(elapsed) + 's';
            const acc = (typeof DG !== 'undefined' && DG.formatAccuracy)
                ? DG.formatAccuracy(row.accuracy)
                : Math.round((Number(row.accuracy) || 0) * 100) + '%';
            const n = (typeof DG !== 'undefined' && DG.normalizeQuestionCount)
                ? DG.normalizeQuestionCount(row.question_count)
                : (Number(row.question_count) || 20);
            const bank = (typeof DG !== 'undefined' && DG.topicChallenge)
                ? DG.topicChallenge(row.topic, row.bank_mode)
                : ((typeof DG !== 'undefined' && DG.MODE_SHORT && DG.MODE_SHORT[row.bank_mode]) || 'Tenses · AV');
            const scene = (typeof DG !== 'undefined' && DG.sceneLabel)
                ? DG.sceneLabel(row.scene)
                : String(row.scene || 'Desert Hills');
            const plays = Number(row.plays);
            const runs = plays > 1 ? ' · ' + plays + ' runs' : '';
            return time + ' · ' + acc + ' · ' + n + ' Q · ' + bank + ' · ' + scene + runs;
        }

        async function loadDriveAndGoAdmin(forceForms) {
            if (!isAdmin()) return;
            const statsEl = document.getElementById('dg-admin-stats');
            const soloEl = document.getElementById('dg-admin-solo-container');
            const multiEl = document.getElementById('dg-admin-multi-container');
            if (!statsEl || !soloEl || !multiEl) return;
            if (forceForms) await ensureFormDirectory(true);
            statsEl.innerHTML = '';

            const baseColumns = 'user_id,nickname,email,bank_mode,question_count,scene,composite,race_score,time_bonus,correct,wrong,accuracy,elapsed_ms,plays,created_at';
            const columns = baseColumns + ',topic';
            // Before supabase/drive_and_go_agreement_topic.sql is pasted the
            // views have no topic column. Fall back to the old column list and
            // treat every existing row as Tenses, so the Tenses dashboard never
            // breaks.
            const readBoard = async (view) => {
                let res = await sb.from(view)
                    .select(columns)
                    .order('composite', { ascending: false })
                    .order('elapsed_ms', { ascending: true })
                    .order('accuracy', { ascending: false })
                    .order('created_at', { ascending: true })
                    .limit(1000);
                if (res.error) {
                    const msg = String(res.error.message || '');
                    if (/topic|column .* does not exist|42703|PGRST204/i.test(msg)) {
                        res = await sb.from(view)
                            .select(baseColumns)
                            .order('composite', { ascending: false })
                            .order('elapsed_ms', { ascending: true })
                            .order('accuracy', { ascending: false })
                            .order('created_at', { ascending: true })
                            .limit(1000);
                        if (res.data) {
                            res.data = res.data.map(r => Object.assign({}, r, { topic: 'tenses' }));
                        }
                    }
                }
                return res;
            };
            const [soloRes, multiRes] = await Promise.all([
                readBoard('drive_and_go_solo_leaderboard'),
                readBoard('drive_and_go_multi_leaderboard')
            ]);
            adminCache.dg = {
                solo: soloRes.data || [],
                soloError: soloRes.error || null,
                multi: multiRes.data || [],
                multiError: multiRes.error || null
            };
            renderDriveAndGoAdmin();
        }

        function renderDriveAndGoAdminBoard(container, rows, solo, error) {
            if (!container) return;
            if (error) {
                const missing = isMissingSchema(error.message);
                container.innerHTML = missing
                    ? '<p class="text-gray-400 text-center py-8 text-sm">Drive &amp; Go! ' + (solo ? 'Solo' : 'Multiplayer') + ' board is not set up yet.<br>Run <code>supabase/drive_and_go_scenes_and_boards.sql</code> in the SQL editor.</p>'
                    : '<p class="text-red-400 text-center py-8 text-sm">Cannot load Drive &amp; Go! records: ' + escapeHtml(error.message) + '</p>';
                return;
            }
            if (!rows.length) {
                container.innerHTML = '<p class="text-gray-400 text-center py-8 text-sm">No Drive &amp; Go! ' + (solo ? 'Solo' : 'Multiplayer') + ' runs recorded yet.</p>';
                return;
            }
            container.innerHTML = renderFormSections(groupRowsByForm(rows), (list) =>
                '<div class="space-y-2">' + list.map((r, i) => {
                    const medal = ['🥇', '🥈', '🥉'][i] || `<span class="text-gray-400">${i + 1}.</span>`;
                    return `<div class="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                        <span class="w-7 text-center text-sm font-bold">${medal}</span>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 min-w-0 flex-wrap">
                                <p class="text-sm font-bold text-gray-700 truncate">${escapeHtml(displayName(r))}</p>
                                ${classBadge(r.email, r.nickname)}
                                ${formAssignControl(r.email, r.nickname)}
                            </div>
                            <p class="text-xs text-gray-400 truncate">${escapeHtml(driveAndGoRowMeta(r))}</p>
                        </div>
                        <span class="font-bold text-green-600 text-sm whitespace-nowrap">${Number(r.composite) || 0} pts</span>
                    </div>`;
                }).join('') + '</div>',
            { emptyAll: '<p class="text-gray-400 text-center py-8 text-sm">No Drive &amp; Go! ' + (solo ? 'Solo' : 'Multiplayer') + ' runs recorded yet.</p>' });
        }

        function renderDriveAndGoAdmin() {
            const statsEl = document.getElementById('dg-admin-stats');
            const soloEl = document.getElementById('dg-admin-solo-container');
            const multiEl = document.getElementById('dg-admin-multi-container');
            if (!statsEl || !soloEl || !multiEl || !adminCache.dg) return;
            const pack = adminCache.dg;
            const solo = driveAndGoBoardSummary(pack.solo);
            const multi = driveAndGoBoardSummary(pack.multi);
            statsEl.innerHTML = `
                <div class="bg-green-50 rounded-2xl p-4 text-center border-2 border-green-100">
                    <p class="text-2xl font-bold text-green-600">${solo.players}</p>
                    <p class="text-xs text-gray-400 font-bold uppercase tracking-wider">Solo students</p>
                </div>
                <div class="bg-blue-50 rounded-2xl p-4 text-center border-2 border-blue-100">
                    <p class="text-2xl font-bold text-blue-600">${solo.runs}</p>
                    <p class="text-xs text-gray-400 font-bold uppercase tracking-wider">Solo runs</p>
                </div>
                <div class="bg-green-50 rounded-2xl p-4 text-center border-2 border-green-100">
                    <p class="text-2xl font-bold text-green-600">${multi.players}</p>
                    <p class="text-xs text-gray-400 font-bold uppercase tracking-wider">Multi students</p>
                </div>
                <div class="bg-blue-50 rounded-2xl p-4 text-center border-2 border-blue-100">
                    <p class="text-2xl font-bold text-blue-600">${multi.runs}</p>
                    <p class="text-xs text-gray-400 font-bold uppercase tracking-wider">Multi runs</p>
                </div>`;
            renderDriveAndGoAdminBoard(soloEl, pack.solo, true, pack.soloError);
            renderDriveAndGoAdminBoard(multiEl, pack.multi, false, pack.multiError);
        }

        // --- Admin: student login activity ---

        const LOGIN_SORT_KEY = 'learniTY_login_sort';
        let loginAdminSort = (() => {
            try { return localStorage.getItem(LOGIN_SORT_KEY) === 'streak' ? 'streak' : 'login'; } catch (e) { return 'login'; }
        })();

        function paintLoginSortButtons() {
            paintChoiceButtons('.login-sort-btn', loginAdminSort);
            document.querySelectorAll('.login-sort-btn').forEach(btn => {
                const match = (btn.getAttribute('onclick') || '').match(/'([^']+)'/);
                btn.setAttribute('aria-pressed', String(!!match && match[1] === loginAdminSort));
            });
        }

        function setLoginAdminSort(mode) {
            loginAdminSort = mode === 'streak' ? 'streak' : 'login';
            try { localStorage.setItem(LOGIN_SORT_KEY, loginAdminSort); } catch (e) {}
            renderLoginAdmin();
        }

        async function loadLoginAdmin(forceForms) {
            if (!isAdmin()) return;
            if (forceForms) await ensureFormDirectory(true);
            const statsEl = document.getElementById('login-admin-stats');
            const listEl = document.getElementById('login-admin-container');
            if (!statsEl || !listEl) return;

            const logsRes = await sb.from('student_logins')
                .select('user_id, email, nickname, first_login_at, last_login_at, login_count, user_agent')
                .order('last_login_at', { ascending: false });
            const streakRes = await sb.from('user_streaks')
                .select('user_id, streak_count, streak_best, last_practice_date, repair_cards')
                .limit(1000);

            adminCache.logins = logsRes.data || [];
            adminCache.loginsError = logsRes.error || null;
            adminCache.streaks = streakRes.data || [];
            adminCache.streaksError = streakRes.error || null;
            renderLoginAdmin();
        }

        function renderLoginAdmin() {
            const statsEl = document.getElementById('login-admin-stats');
            const listEl = document.getElementById('login-admin-container');
            if (!statsEl || !listEl || !adminCache.logins) return;
            paintLoginSortButtons();
            if (adminCache.loginsError) {
                statsEl.innerHTML = '';
                const missing = isMissingSchema(adminCache.loginsError.message);
                listEl.innerHTML = missing
                    ? '<p class="text-amber-500 text-center py-10 font-bold">Login tracking is not set up yet.<br><span class="text-sm font-normal">Run <code>supabase/login_tracking.sql</code> in the Supabase SQL Editor.</span></p>'
                    : '<p class="text-red-400 text-center py-10">Cannot load login records: ' + escapeHtml(adminCache.loginsError.message) + '</p>';
                return;
            }
            const logs = adminCache.logins;
            const streakByUser = {};
            (adminCache.streaks || []).forEach(s => { streakByUser[s.user_id] = s; });
            // Count from the streak table itself, so the tile is still correct
            // if the login list happens to be unavailable.
            const activeStreaks = (adminCache.streaks || []).filter(s => streakCurrentCount(s) > 0).length;
            const streakStat = adminCache.streaksError ? '—' : activeStreaks;
            const displayLogs = logs.slice();
            if (loginAdminSort === 'streak') {
                displayLogs.sort((a, b) => {
                    const sa = streakCurrentCount(streakByUser[a.user_id]);
                    const sb = streakCurrentCount(streakByUser[b.user_id]);
                    if (sb !== sa) return sb - sa;
                    const ba = streakByUser[a.user_id] ? (Number(streakByUser[a.user_id].streak_best) || 0) : 0;
                    const bb = streakByUser[b.user_id] ? (Number(streakByUser[b.user_id].streak_best) || 0) : 0;
                    if (bb !== ba) return bb - ba;
                    return String(a.nickname || a.email || '').localeCompare(String(b.nickname || b.email || ''));
                });
            } else {
                displayLogs.sort((a, b) => new Date(b.last_login_at || 0).getTime() - new Date(a.last_login_at || 0).getTime());
            }
            const todayKey = hkDayKey(new Date().toISOString());
            const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
            const loggedToday = logs.filter(l => l.last_login_at && hkDayKey(l.last_login_at) === todayKey).length;
            const loggedThisWeek = logs.filter(l => l.last_login_at && new Date(l.last_login_at).getTime() >= sevenDaysAgo).length;
            if (!logs.length) {
                statsEl.innerHTML = `
                    <div class="bg-blue-50 rounded-2xl p-5 text-center border-2 border-blue-100">
                        <div class="text-3xl font-bold text-blue-600">0</div>
                        <div class="text-sm text-gray-500 font-bold">Students Tracked</div>
                    </div>
                    <div class="bg-green-50 rounded-2xl p-5 text-center border-2 border-green-100">
                        <div class="text-3xl font-bold text-green-600">0</div>
                        <div class="text-sm text-gray-500 font-bold">Logged in Today</div>
                    </div>
                    <div class="bg-purple-50 rounded-2xl p-5 text-center border-2 border-purple-100">
                        <div class="text-3xl font-bold text-purple-600">0</div>
                        <div class="text-sm text-gray-500 font-bold">Last 7 Days</div>
                    </div>
                    <div class="bg-orange-50 rounded-2xl p-5 text-center border-2 border-orange-100">
                        <div class="text-3xl font-bold text-orange-600">${streakStat}</div>
                        <div class="text-sm text-gray-500 font-bold">Active Streaks</div>
                    </div>
                `;
                listEl.innerHTML = '<p class="text-gray-400 text-center py-10">No login records yet.</p>';
                return;
            }
            statsEl.innerHTML = `
                <div class="bg-blue-50 rounded-2xl p-5 text-center border-2 border-blue-100">
                    <div class="text-3xl font-bold text-blue-600">${logs.length}</div>
                    <div class="text-sm text-gray-500 font-bold">Students Tracked</div>
                </div>
                <div class="bg-green-50 rounded-2xl p-5 text-center border-2 border-green-100">
                    <div class="text-3xl font-bold text-green-600">${loggedToday}</div>
                    <div class="text-sm text-gray-500 font-bold">Logged in Today</div>
                </div>
                <div class="bg-purple-50 rounded-2xl p-5 text-center border-2 border-purple-100">
                    <div class="text-3xl font-bold text-purple-600">${loggedThisWeek}</div>
                    <div class="text-sm text-gray-500 font-bold">Last 7 Days</div>
                </div>
                <div class="bg-orange-50 rounded-2xl p-5 text-center border-2 border-orange-100">
                    <div class="text-3xl font-bold text-orange-600">${streakStat}</div>
                    <div class="text-sm text-gray-500 font-bold">Active Streaks</div>
                </div>
            `;
            listEl.innerHTML = renderFormSections(groupRowsByForm(displayLogs), (list) => `
                <div class="space-y-3">
                    ${list.map(l => `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 flex-wrap gap-3">
                            <div class="flex items-center gap-3 flex-1 min-w-[220px]">
                                <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 font-bold flex items-center justify-center">
                                    ${escapeHtml((l.nickname || l.email || '?').charAt(0).toUpperCase())}
                                </div>
                                <div>
                                    <span class="font-bold text-gray-700">${escapeHtml(l.nickname || (l.email || '').split('@')[0])}${classBadge(l.email, l.nickname)}</span>
                                    <span class="text-gray-400 text-xs ml-2">${escapeHtml(l.email)}</span>
                                </div>
                                ${formAssignControl(l.email, l.nickname)}
                            </div>
                            <div class="flex items-center gap-4 text-sm flex-wrap">
                                <span class="text-gray-500">${l.login_count} login${l.login_count === 1 ? '' : 's'}</span>
                                ${(() => {
                                    if (adminCache.streaksError) {
                                        return '<span class="text-gray-400 text-xs" title="Run supabase/user_streaks.sql in the SQL editor">🔥 —</span>';
                                    }
                                    const s = streakByUser[l.user_id];
                                    const n = streakCurrentCount(s);
                                    const best = s ? (Number(s.streak_best) || 0) : 0;
                                    const last = s && s.last_practice_date ? escapeHtml(String(s.last_practice_date)) : '—';
                                    const lastLabel = s && s.last_practice_date ? hkRelativeDay(s.last_practice_date) : '—';
                                    return `<span class="font-bold text-xs ${n > 0 ? 'text-orange-600' : 'text-gray-400'}" title="Best ${best} day${best === 1 ? '' : 's'} · last ${last}">🔥 ${n} day${n === 1 ? '' : 's'}</span>
                                <span class="text-gray-400 text-xs whitespace-nowrap">best ${best} · last ${escapeHtml(lastLabel)}</span>`;
                                })()}
                                <span class="text-gray-400 text-xs">${escapeHtml(deviceLabel(l.user_agent))}</span>
                                <span class="text-gray-400 text-xs">First: ${escapeHtml(hkDate(l.first_login_at))}</span>
                                <span class="font-bold text-blue-600 text-xs" title="${escapeHtml(hkDate(l.last_login_at))}">${escapeHtml(timeAgo(l.last_login_at))}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `, { collapsible: true, scope: 'login-admin' });
        }

        // --- Admin: guest (password 0203) logins + usage ---
        // Guests never appear in student_logins, scores or leaderboards; these
        // tables (supabase/guest_tracking.sql) are readable by the teacher only.
        //
        // Only a rolling last 24 hours is kept. The database side deletes older
        // rows (prune_guest_records), the selects below ask for the same window,
        // and renderGuestAdmin filters again before drawing anything.
        const GUEST_ADMIN_SCOPE = 'guest-admin';
        const GUEST_ADMIN_GROUP = 'all';

        // Reuse the teacher dashboard's existing + / - controls (the same
        // adminFormToggleButtons / adminFormOpen pair as the F3 / F4 / F6
        // groups). adminFormOpen starts empty, so the card is collapsed until
        // the teacher opens it, and survives a Refresh because the state lives
        // in memory rather than in the rendered HTML.
        function isGuestAdminOpen() {
            return isAdminFormOpen(GUEST_ADMIN_SCOPE, GUEST_ADMIN_GROUP);
        }

        function syncGuestAdminChrome() {
            const open = isGuestAdminOpen();
            const body = document.getElementById('guest-admin-body');
            if (body) body.classList.toggle('hidden', !open);
            const holder = document.getElementById('guest-admin-toggles');
            if (holder) {
                holder.innerHTML = adminFormToggleButtons(
                    GUEST_ADMIN_SCOPE, GUEST_ADMIN_GROUP, 'Guest logins', open
                );
            }
            return open;
        }

        // Pure rolling-24-hour window shared by the stats and the list.
        // Deliberately not a calendar day and no 7-day figure: rows older than
        // 24 hours are deleted in the database, so nothing may advertise them.
        function guestAdminWindow(logins, usage, now) {
            const base = (now == null) ? Date.now() : Number(now);
            const recentLogins = filterGuestRecords(logins, 'logged_in_at', base);
            const recentUsage = filterGuestRecords(usage, 'created_at', base);
            const todayKey = hkDayKey(new Date(base).toISOString());
            return {
                logins: recentLogins,
                usage: recentUsage,
                summary: {
                    logins: recentLogins.length,
                    todayHk: recentLogins.filter(l => l.logged_in_at && hkDayKey(l.logged_in_at) === todayKey).length,
                    usage: recentUsage.length
                }
            };
        }

        function guestAdminSummary(logins, usage, now) {
            return guestAdminWindow(logins, usage, now).summary;
        }

        // Called on entering the admin view and by the card's Refresh button
        // (which passes a `true` argument that this loader does not need: every
        // call prunes and re-reads the rolling 24-hour window).
        async function loadGuestAdmin() {
            if (!isAdmin()) return;
            const statsEl = document.getElementById('guest-admin-stats');
            const listEl = document.getElementById('guest-admin-container');
            if (!statsEl || !listEl) return;
            // Keep the heading's + / - controls in sync even before data lands.
            syncGuestAdminChrome();

            // Prune first so the selects cannot return rows that were just
            // deleted. Not fatal: an older install without the RPC still loads.
            try {
                const pruned = await sb.rpc('prune_guest_records');
                if (pruned && pruned.error) console.warn('Guest prune failed:', pruned.error.message);
            } catch (e) {
                console.warn('Guest prune failed:', (e && e.message) ? e.message : e);
            }

            const now = Date.now();
            const cutoff = guestCutoffIso(now);
            const [loginsRes, usageRes] = await Promise.all([
                sb.from('guest_logins')
                    .select('id, logged_in_at, user_agent, session_key', { count: 'exact' })
                    .gte('logged_in_at', cutoff)
                    .order('logged_in_at', { ascending: false })
                    .limit(500),
                sb.from('guest_usage')
                    .select('id, session_key, feature, detail, created_at')
                    .gte('created_at', cutoff)
                    .order('created_at', { ascending: false })
                    .limit(60)
            ]);
            adminCache.guest = {
                logins: loginsRes.data || [],
                loginsCount: loginsRes.count,
                loginsError: loginsRes.error || null,
                usage: usageRes.data || [],
                usageError: usageRes.error || null,
                cutoff: cutoff,
                loadedAt: now
            };
            renderGuestAdmin();
        }

        function renderGuestAdmin() {
            const statsEl = document.getElementById('guest-admin-stats');
            const listEl = document.getElementById('guest-admin-container');
            if (!statsEl || !listEl || !adminCache.guest) return;
            syncGuestAdminChrome();
            const pack = adminCache.guest;
            const firstError = pack.loginsError || pack.usageError;
            if (firstError) {
                statsEl.innerHTML = '';
                const missing = isMissingSchema(firstError.message);
                listEl.innerHTML = missing
                    ? '<p class="text-amber-500 text-center py-10 font-bold">Guest tracking is not set up yet.<br><span class="text-sm font-normal">Run <code>supabase/guest_tracking.sql</code> (and <code>supabase/guest_tracking_prune.sql</code> on an existing install) in the Supabase SQL Editor.</span></p>'
                    : '<p class="text-red-400 text-center py-10">Cannot load guest records: ' + escapeHtml(firstError.message) + '</p>';
                return;
            }
            const win = guestAdminWindow(pack.logins, pack.usage, pack.loadedAt || Date.now());
            const stats = win.summary;
            statsEl.innerHTML = `
                <div class="bg-cyan-50 rounded-2xl p-5 text-center border-2 border-cyan-100">
                    <div class="text-3xl font-bold text-cyan-600">${stats.logins}</div>
                    <div class="text-sm text-gray-500 font-bold">Guest Logins (24h)</div>
                </div>
                <div class="bg-green-50 rounded-2xl p-5 text-center border-2 border-green-100">
                    <div class="text-3xl font-bold text-green-600">${stats.todayHk}</div>
                    <div class="text-sm text-gray-500 font-bold">Today (HK)</div>
                </div>
                <div class="bg-purple-50 rounded-2xl p-5 text-center border-2 border-purple-100">
                    <div class="text-3xl font-bold text-purple-600">${stats.usage}</div>
                    <div class="text-sm text-gray-500 font-bold">Browsing Records (24h)</div>
                </div>
            `;
            const usage = win.usage;
            if (!usage.length) {
                listEl.innerHTML = '<p class="text-gray-400 text-center py-10">No guest usage in the last 24 hours.</p>';
                return;
            }
            listEl.innerHTML = `
                <div class="space-y-3">
                    ${usage.map(u => `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 flex-wrap gap-3">
                            <div class="flex items-center gap-3 flex-1 min-w-[200px]">
                                <span class="font-bold text-gray-700">${escapeHtml(u.feature || '')}</span>
                                ${u.detail ? '<span class="text-gray-400 text-sm">' + escapeHtml(u.detail) + '</span>' : ''}
                            </div>
                            <span class="font-bold text-cyan-600 text-xs" title="${escapeHtml(hkDate(u.created_at))}">${escapeHtml(timeAgo(u.created_at))}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

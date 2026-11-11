/* LearniTY Dictation — teacher dashboard, student login activity and
   guest usage. Moved verbatim out of index.html. */

        let adminCache = {
            dictation: null,
            grammar: null,
            logins: null,
            loginsError: null,
            battles: null,
            battlesError: null,
            wj: null
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

        // --- Admin: student login activity ---

        async function loadLoginAdmin(forceForms) {
            if (!isAdmin()) return;
            if (forceForms) await ensureFormDirectory(true);
            const statsEl = document.getElementById('login-admin-stats');
            const listEl = document.getElementById('login-admin-container');
            if (!statsEl || !listEl) return;

            const logsRes = await sb.from('student_logins')
                .select('email, nickname, first_login_at, last_login_at, login_count, user_agent')
                .order('last_login_at', { ascending: false });

            adminCache.logins = logsRes.data || [];
            adminCache.loginsError = logsRes.error || null;
            renderLoginAdmin();
        }

        function renderLoginAdmin() {
            const statsEl = document.getElementById('login-admin-stats');
            const listEl = document.getElementById('login-admin-container');
            if (!statsEl || !listEl || !adminCache.logins) return;
            if (adminCache.loginsError) {
                statsEl.innerHTML = '';
                const missing = isMissingSchema(adminCache.loginsError.message);
                listEl.innerHTML = missing
                    ? '<p class="text-amber-500 text-center py-10 font-bold">Login tracking is not set up yet.<br><span class="text-sm font-normal">Run <code>supabase/login_tracking.sql</code> in the Supabase SQL Editor.</span></p>'
                    : '<p class="text-red-400 text-center py-10">Cannot load login records: ' + escapeHtml(adminCache.loginsError.message) + '</p>';
                return;
            }
            const logs = adminCache.logins;
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
            `;
            listEl.innerHTML = renderFormSections(groupRowsByForm(logs), (list) => `
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
        async function loadGuestAdmin() {
            if (!isAdmin()) return;
            const statsEl = document.getElementById('guest-admin-stats');
            const listEl = document.getElementById('guest-admin-container');
            if (!statsEl || !listEl) return;

            const [loginsRes, usageRes] = await Promise.all([
                sb.from('guest_logins')
                    .select('id, logged_in_at, user_agent, session_key', { count: 'exact' })
                    .order('logged_in_at', { ascending: false })
                    .limit(500),
                sb.from('guest_usage')
                    .select('id, session_key, feature, detail, created_at')
                    .order('created_at', { ascending: false })
                    .limit(60)
            ]);
            adminCache.guest = {
                logins: loginsRes.data || [],
                loginsCount: loginsRes.count,
                loginsError: loginsRes.error || null,
                usage: usageRes.data || [],
                usageError: usageRes.error || null
            };
            renderGuestAdmin();
        }

        function renderGuestAdmin() {
            const statsEl = document.getElementById('guest-admin-stats');
            const listEl = document.getElementById('guest-admin-container');
            if (!statsEl || !listEl || !adminCache.guest) return;
            const pack = adminCache.guest;
            const firstError = pack.loginsError || pack.usageError;
            if (firstError) {
                statsEl.innerHTML = '';
                const missing = isMissingSchema(firstError.message);
                listEl.innerHTML = missing
                    ? '<p class="text-amber-500 text-center py-10 font-bold">Guest tracking is not set up yet.<br><span class="text-sm font-normal">Run <code>supabase/guest_tracking.sql</code> in the Supabase SQL Editor.</span></p>'
                    : '<p class="text-red-400 text-center py-10">Cannot load guest records: ' + escapeHtml(firstError.message) + '</p>';
                return;
            }
            const logs = pack.logins;
            const total = (pack.loginsCount != null) ? pack.loginsCount : logs.length;
            const todayKey = hkDayKey(new Date().toISOString());
            const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
            const loggedToday = logs.filter(l => l.logged_in_at && hkDayKey(l.logged_in_at) === todayKey).length;
            const loggedThisWeek = logs.filter(l => l.logged_in_at && new Date(l.logged_in_at).getTime() >= sevenDaysAgo).length;
            statsEl.innerHTML = `
                <div class="bg-cyan-50 rounded-2xl p-5 text-center border-2 border-cyan-100">
                    <div class="text-3xl font-bold text-cyan-600">${total}</div>
                    <div class="text-sm text-gray-500 font-bold">Guest Logins</div>
                </div>
                <div class="bg-green-50 rounded-2xl p-5 text-center border-2 border-green-100">
                    <div class="text-3xl font-bold text-green-600">${loggedToday}</div>
                    <div class="text-sm text-gray-500 font-bold">Today</div>
                </div>
                <div class="bg-purple-50 rounded-2xl p-5 text-center border-2 border-purple-100">
                    <div class="text-3xl font-bold text-purple-600">${loggedThisWeek}</div>
                    <div class="text-sm text-gray-500 font-bold">Last 7 Days</div>
                </div>
            `;
            const usage = pack.usage;
            if (!usage.length) {
                listEl.innerHTML = '<p class="text-gray-400 text-center py-10">No guest usage recorded yet.</p>';
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

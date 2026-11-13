/* LearniTY Dictation — shared app shell.
   Moved verbatim out of the old single inline <script> in index.html.
   Loaded first, so it owns the constants, Supabase client, auth/session,
   form helpers, small text helpers, changeView() and window.onload.
   Feature files below may be referenced from here; they only run later. */

        const SPREADSHEET_ID = '1HY-fkzE7K6cYY5ZHgFVIubhzhSyMWpofjKLnEvjllwU';
        const SHEET_NAMES = ["charity", "entertainment", "environmental issues", "family", "fashion", "festivals", "food and restaurants", "health", "housing", "law and order", "modern communication", "people", "animals and pets", "school", "Shopping", "social affairs", "MTR stations", "sports", "exam focus", "basics"];

        // Display-only label overrides (Sheet tab names stay untouched).
        const TOPIC_LABELS = { "basics": "Basics", "New Vocab": "New Vocab", "Error Book": "Error Book" };
        function topicLabel(name) { return TOPIC_LABELS[name] || name; }
        const NEW_VOCAB = 'New Vocab';
        const ERROR_BOOK = 'Error Book';
        const SCHOOL_DOMAIN = "@lstyoungkhl.edu.hk";
        const ADMIN_EMAIL = "tywong@lstyoungkhl.edu.hk";

        // Supabase init
        const sb = window.supabase.createClient(
            "https://mggnwzirjmibreimrwiq.supabase.co",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nZ253emlyam1pYnJlaW1yd2lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NTg5MDUsImV4cCI6MjEwNTAzNDkwNX0.sxCPETSvMivX0L5ILBlIH07kJ6Ebz0OloHTSgD9I8l4"
        );

        let currentUser = null;
        let currentSubCategory = '';
        const GUEST_PASSWORD = '0203';
        const GUEST_SESSION_KEY = 'learniTY_guest_session';
        const GUEST_BLOCKED_VIEWS = ['leaderboard-view', 'admin-view', 'my-records-view'];
        let guestSession = false;

        // --- Bottom tab bar -------------------------------------------------
        // Exactly five tabs. Each tab always returns to its section root.
        const NAV_TABS = ['hub-view', 'home-view', 'wordjump-view', 'battle-view', 'profile-view'];
        // Views that keep the screen immersive: the bar would cover controls or
        // compete with the game HUD, so it hides and the view keeps its own exit.
        const NAV_HIDDEN_VIEWS = ['quiz-view', 'wordjump-view', 'drive-and-go-view', 'admin-view'];
        let currentView = 'hub-view';

        function navTabForView(viewId) {
            if (viewId === 'home-view' || viewId === 'sub-category-view' || viewId === 'word-list-view' || viewId === 'quiz-view' || viewId === 'error-book-view') return 'home-view';
            if (viewId === 'wordjump-view') return 'wordjump-view';
            if (viewId === 'battle-view') return 'battle-view';
            if (viewId === 'profile-view') return 'profile-view';
            return 'hub-view'; // hub, grammar tree, records, leaderboard
        }

        function navShouldShow(viewId) {
            if (NAV_HIDDEN_VIEWS.indexOf(viewId) !== -1) return false;
            if (viewId === 'battle-view') {
                // Lobby, result and the teacher's class live board can use the
                // bar; the student waiting / playing panels cannot.
                const panel = window.navBattlePanel || 'lobby';
                return panel === 'lobby' || panel === 'result' || panel === 'class';
            }
            return true;
        }

        function updateBottomNav() {
            const nav = document.getElementById('bottom-nav');
            if (!nav) return;
            const app = document.getElementById('app');
            const appOpen = !!(app && app.classList.contains('logged-in'));
            const show = appOpen && navShouldShow(currentView);
            document.body.classList.toggle('has-bottom-nav', show);
            const active = navTabForView(currentView);
            nav.querySelectorAll('[data-nav-view]').forEach(btn => {
                const on = btn.getAttribute('data-nav-view') === active;
                btn.classList.toggle('active', on);
                if (on) btn.setAttribute('aria-current', 'page');
                else btn.removeAttribute('aria-current');
            });
        }

        // --- Daily practice streak -----------------------------------------
        // One flame per consecutive Asia/Hong_Kong calendar day with practice.
        // Signed-in students sync through user_streaks (Supabase), so the flame
        // follows the Gmail account. Guests and teacher previews stay on the
        // browser (sessionStorage) and never share another person's streak.
        const STREAK_PREFIX = 'learniTY_streak:';
        const STREAK_DAY_MS = 24 * 60 * 60 * 1000;
        const STREAK_DEFAULT_CARDS = 3;
        const STREAK_CLOUD_TABLE = 'user_streaks';
        let streakCloudUser = '';
        let streakCloudLoaded = false;
        let streakCloudLoading = null;

        function streakOwner() {
            const form = previewStudentForm();
            if (form) return 'preview:' + form;
            if (isGuestUser()) return 'guest';
            if (currentUser && currentUser.id) return 'user:' + currentUser.id;
            return '';
        }

        function streakStore() {
            return (isGuestUser() || previewStudentForm()) ? sessionStorage : localStorage;
        }

        function normalizeStreakState(parsed) {
            const raw = (parsed && typeof parsed === 'object') ? parsed : {};
            let recent = Array.isArray(raw.recentDays)
                ? raw.recentDays.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-14)
                : [];
            const last = typeof raw.last === 'string' ? raw.last : '';
            if (/^\d{4}-\d{2}-\d{2}$/.test(last) && recent.indexOf(last) === -1) {
                recent = recent.concat(last).sort().slice(-14);
            }
            return {
                last: last,
                count: Math.max(0, Number(raw.count) || 0),
                best: Math.max(0, Number(raw.best) || 0),
                cards: raw.cards == null ? STREAK_DEFAULT_CARDS : Math.max(0, Number(raw.cards) || 0),
                firstSeen: typeof raw.firstSeen === 'string' ? raw.firstSeen : '',
                recentDays: recent
            };
        }

        function readStreakState() {
            const owner = streakOwner();
            if (!owner) return null;
            try {
                const parsed = JSON.parse(streakStore().getItem(STREAK_PREFIX + owner) || 'null');
                return normalizeStreakState(parsed);
            } catch (e) {
                return normalizeStreakState(null);
            }
        }

        function writeStreakState(state) {
            const owner = streakOwner();
            if (!owner) return;
            try { streakStore().setItem(STREAK_PREFIX + owner, JSON.stringify(state)); } catch (e) {}
        }

        function hkYesterdayKey() {
            return hkDayKey(new Date(Date.now() - STREAK_DAY_MS).toISOString());
        }

        function hkDayNumber(key) {
            if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
            const parts = key.split('-').map(Number);
            return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / STREAK_DAY_MS);
        }

        // Whole Hong Kong days from `fromKey` to `toKey` (1 = yesterday -> today).
        function streakGapDays(fromKey, toKey) {
            const a = hkDayNumber(fromKey);
            const b = hkDayNumber(toKey);
            if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
            return b - a;
        }

        function earliestIso(a, b) {
            if (!a) return b || '';
            if (!b) return a;
            const ta = new Date(a).getTime();
            const tb = new Date(b).getTime();
            if (!Number.isFinite(ta)) return b;
            if (!Number.isFinite(tb)) return a;
            return ta <= tb ? a : b;
        }

        // Effective current streak for a row from user_streaks. A lapsed run
        // can still be repaired with cards, so it stays visible until the gap
        // costs more cards than the student owns.
        function streakCurrentCount(row) {
            if (!row) return 0;
            const count = Number(row.streak_count) || 0;
            if (count <= 0) return 0;
            const last = row.last_practice_date ? String(row.last_practice_date).slice(0, 10) : '';
            if (!last) return 0;
            const gap = streakGapDays(last, hkDayKey(new Date().toISOString()));
            if (gap === 0 || gap === 1) return count;
            const cards = Number(row.repair_cards) || 0;
            return (gap > 1 && (gap - 1) <= cards) ? count : 0;
        }

        function streakSnapshot() {
            const state = readStreakState();
            if (!state) {
                return { count: 0, best: 0, cards: STREAK_DEFAULT_CARDS, firstSeen: '', recentDays: [], practicedToday: false, alive: false, pendingRepair: 0, last: '' };
            }
            const today = hkDayKey(new Date().toISOString());
            const practicedToday = state.last === today;
            const gap = state.last ? streakGapDays(state.last, today) : NaN;
            // A missed day can still be repaired with cards, so keep the flame
            // visible until the gap costs more cards than the student owns.
            const pendingRepair = (Number.isFinite(gap) && gap > 1) ? (gap - 1) : 0;
            const repairable = state.count > 0 && pendingRepair > 0 && pendingRepair <= state.cards;
            const alive = practicedToday || gap === 1 || repairable;
            return {
                count: alive ? state.count : 0,
                best: Math.max(state.best, state.count),
                cards: state.cards,
                firstSeen: state.firstSeen,
                recentDays: state.recentDays,
                practicedToday: practicedToday,
                alive: alive,
                pendingRepair: repairable ? pendingRepair : 0,
                last: state.last
            };
        }

        function updateStreakBadge() {
            const badge = document.getElementById('streak-badge');
            if (!badge) return;
            const snap = streakSnapshot();
            const label = document.getElementById('streak-count');
            if (label) label.innerText = String(snap.count);
            badge.classList.toggle('streak-zero', snap.count === 0);
            const dayWord = snap.count === 1 ? 'day' : 'days';
            badge.setAttribute('aria-label', snap.count
                ? 'Daily practice streak: ' + snap.count + ' ' + dayWord
                : 'Daily practice streak: not started');
            badge.title = snap.count
                ? (snap.practicedToday
                    ? '🔥 ' + snap.count + '-day streak — done for today! ' + snap.cards + ' repair card' + (snap.cards === 1 ? '' : 's') + ' left.'
                    : snap.pendingRepair
                        ? '🔥 ' + snap.count + '-day streak — finish a practice today to spend ' + snap.pendingRepair + ' repair card' + (snap.pendingRepair === 1 ? '' : 's') + '.'
                        : '🔥 ' + snap.count + '-day streak — practise today to keep it alive.')
                : '🔥 Finish any practice today to light your first flame.';
        }

        function showStreakInfo() {
            const snap = streakSnapshot();
            if (!snap.count) {
                updateMascot('🔥 Finish any practice today to light your first streak flame!');
                return;
            }
            if (snap.pendingRepair) {
                updateMascot('🔥 Your ' + snap.count + '-day streak is waiting. Finish a practice today to spend ' + snap.pendingRepair + ' repair card' + (snap.pendingRepair === 1 ? '' : 's') + ' and keep it.');
                return;
            }
            updateMascot(snap.practicedToday
                ? '🔥 ' + snap.count + '-day streak! You already practised today — come back tomorrow to grow it.'
                : '🔥 ' + snap.count + '-day streak. Finish a practice today to keep it alive!');
        }

        function cloudStreakToLocal(row) {
            return normalizeStreakState({
                last: row && row.last_practice_date ? String(row.last_practice_date).slice(0, 10) : '',
                count: row && row.streak_count,
                best: row && row.streak_best,
                cards: row && row.repair_cards,
                firstSeen: row && row.first_seen ? row.first_seen : '',
                recentDays: row && Array.isArray(row.recent_days) ? row.recent_days : []
            });
        }

        function mergeStreakStates(local, cloud) {
            const l = normalizeStreakState(local);
            const c = normalizeStreakState(cloud);
            const firstSeen = earliestIso(l.firstSeen, c.firstSeen);
            // Union the recent practice days from both devices, latest 14.
            const recentDays = Array.from(new Set(l.recentDays.concat(c.recentDays))).sort().slice(-14);
            if (!l.last && !c.last) {
                return { last: '', count: 0, best: Math.max(l.best, c.best), cards: Math.min(l.cards, c.cards), firstSeen: firstSeen, recentDays: recentDays };
            }
            if (!l.last) return { last: c.last, count: c.count, best: Math.max(c.best, l.best), cards: Math.min(c.cards, l.cards), firstSeen: firstSeen, recentDays: recentDays };
            if (!c.last) return { last: l.last, count: l.count, best: Math.max(l.best, c.best), cards: Math.min(l.cards, c.cards), firstSeen: firstSeen, recentDays: recentDays };
            if (l.last > c.last) return { last: l.last, count: l.count, best: Math.max(l.best, c.best, l.count), cards: Math.min(l.cards, c.cards), firstSeen: firstSeen, recentDays: recentDays };
            if (c.last > l.last) return { last: c.last, count: c.count, best: Math.max(c.best, l.best, c.count), cards: Math.min(c.cards, l.cards), firstSeen: firstSeen, recentDays: recentDays };
            return {
                last: l.last,
                count: Math.max(l.count, c.count),
                best: Math.max(l.best, c.best, l.count, c.count),
                cards: Math.min(l.cards, c.cards),
                firstSeen: firstSeen,
                recentDays: recentDays
            };
        }

        async function earliestActivityIso(uid) {
            const dates = [];
            try {
                const a = await sb.from('dictation_results')
                    .select('created_at').eq('user_id', uid)
                    .order('created_at', { ascending: true }).limit(1);
                if (!a.error && a.data && a.data[0] && a.data[0].created_at) dates.push(a.data[0].created_at);
            } catch (e) {}
            try {
                const b = await sb.from('wj_scores')
                    .select('created_at').eq('user_id', uid)
                    .order('created_at', { ascending: true }).limit(1);
                if (!b.error && b.data && b.data[0] && b.data[0].created_at) dates.push(b.data[0].created_at);
            } catch (e) {}
            return dates.reduce((best, d) => earliestIso(best, d), '');
        }

        // Reads this student's row once per sign-in and merges it with the local
        // mirror. Safe to call repeatedly; the in-flight promise is reused.
        async function loadCloudStreak(force) {
            if (!canUseCloud() || previewStudentForm()) return null;
            const uid = currentUser && currentUser.id;
            if (!uid) return null;
            if (!force && streakCloudUser === uid && streakCloudLoaded) return readStreakState();
            if (!force && streakCloudLoading && streakCloudUser === uid) return streakCloudLoading;
            streakCloudUser = uid;
            streakCloudLoaded = false;
            streakCloudLoading = (async () => {
                try {
                    let { data, error } = await sb.from(STREAK_CLOUD_TABLE)
                        .select('streak_count,streak_best,last_practice_date,repair_cards,first_seen,recent_days')
                        .eq('user_id', uid)
                        .maybeSingle();
                    // Older installs may not have recent_days yet; keep the
                    // rest of the streak working until the SQL is re-run.
                    if (error && /recent_days|column .* does not exist|42703|PGRST204/i.test(String(error.message || ''))) {
                        const fallback = await sb.from(STREAK_CLOUD_TABLE)
                            .select('streak_count,streak_best,last_practice_date,repair_cards,first_seen')
                            .eq('user_id', uid)
                            .maybeSingle();
                        data = fallback.data;
                        error = fallback.error;
                    }
                    if (error) throw error;
                    if (!currentUser || currentUser.id !== uid) return null;
                    let row = data;
                    if (!row) {
                        const firstSeen = await earliestActivityIso(uid);
                        row = {
                            user_id: uid,
                            email: currentUser.email,
                            nickname: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
                            streak_count: 0,
                            streak_best: 0,
                            last_practice_date: null,
                            repair_cards: STREAK_DEFAULT_CARDS,
                            first_seen: firstSeen || null,
                            recent_days: [],
                            updated_at: new Date().toISOString()
                        };
                        const inserted = await sb.from(STREAK_CLOUD_TABLE).upsert(row, { onConflict: 'user_id' });
                        if (inserted.error) {
                            if (/recent_days|column .* does not exist|42703|PGRST204/i.test(String(inserted.error.message || ''))) {
                                const legacy = Object.assign({}, row);
                                delete legacy.recent_days;
                                const retry = await sb.from(STREAK_CLOUD_TABLE).upsert(legacy, { onConflict: 'user_id' });
                                if (retry.error) throw retry.error;
                                row = legacy;
                            } else {
                                throw inserted.error;
                            }
                        }
                    }
                    if (!currentUser || currentUser.id !== uid) return null;
                    const merged = mergeStreakStates(readStreakState(), cloudStreakToLocal(row));
                    writeStreakState(merged);
                    streakCloudLoaded = true;
                    updateStreakBadge();
                    return merged;
                } catch (e) {
                    console.warn('Streak cloud unavailable:', e.message || e);
                    // The local mirror still works, so nothing on screen breaks.
                    streakCloudLoaded = true;
                    updateStreakBadge();
                    return readStreakState();
                } finally {
                    streakCloudLoading = null;
                }
            })();
            return streakCloudLoading;
        }

        function saveCloudStreak(state) {
            if (!canUseCloud() || previewStudentForm() || !currentUser) return;
            const row = {
                user_id: currentUser.id,
                email: currentUser.email,
                nickname: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
                streak_count: state.count,
                streak_best: state.best,
                last_practice_date: state.last || null,
                repair_cards: state.cards,
                first_seen: state.firstSeen || null,
                recent_days: state.recentDays || [],
                updated_at: new Date().toISOString()
            };
            sb.from(STREAK_CLOUD_TABLE).upsert(row, { onConflict: 'user_id' }).then(({ error }) => {
                if (error && /recent_days|column .* does not exist|42703|PGRST204/i.test(String(error.message || ''))) {
                    // Older table without recent_days: save the rest.
                    const legacy = Object.assign({}, row);
                    delete legacy.recent_days;
                    sb.from(STREAK_CLOUD_TABLE).upsert(legacy, { onConflict: 'user_id' }).then(({ error: retryError }) => {
                        if (retryError) console.warn('Streak cloud save failed:', retryError.message);
                    });
                    return;
                }
                if (error) console.warn('Streak cloud save failed:', error.message);
            });
        }

        // Called from every "finished a practice" hook. Only the first finished
        // practice of a Hong Kong calendar day extends the streak. If a day was
        // missed, repair cards bridge the gap while the student still has enough.
        function recordDailyPractice(source, options) {
            const owner = streakOwner();
            if (!owner) return { extended: false, count: 0 };
            // Wait for the cloud row once per sign-in, otherwise a fresh device
            // would look like a new student and reset the streak.
            if (canUseCloud() && !previewStudentForm() && !streakCloudLoaded) {
                loadCloudStreak().then(() => recordDailyPractice(source, options));
                return { extended: false, pending: true, count: 0 };
            }
            const state = readStreakState();
            const today = hkDayKey(new Date().toISOString());
            if (state.last === today) {
                return { extended: false, count: state.count, best: state.best, cards: state.cards, repaired: 0, today: today, recentDays: state.recentDays };
            }
            const gap = state.last ? streakGapDays(state.last, today) : NaN;
            let count = 1;
            let cards = state.cards;
            let repaired = 0;
            if (state.last && gap === 1) {
                count = Math.max(1, state.count + 1);
            } else if (state.count > 0 && Number.isFinite(gap) && gap > 1 && (gap - 1) <= cards) {
                // A repair card covers one missed day. Spend them only on a
                // live streak, when the whole gap can be bridged; otherwise
                // start a fresh streak without wasting cards.
                repaired = gap - 1;
                cards -= repaired;
                count = Math.max(1, state.count + 1);
            }
            const next = {
                last: today,
                count: count,
                best: Math.max(state.best, count),
                cards: cards,
                firstSeen: state.firstSeen || new Date().toISOString(),
                recentDays: state.recentDays.concat(today).filter((d, i, a) => a.indexOf(d) === i).sort().slice(-14)
            };
            writeStreakState(next);
            saveCloudStreak(next);
            updateStreakBadge();
            const delay = Math.max(0, Number(options && options.delayMs) || 0);
            const info = {
                count: count,
                best: next.best,
                cards: next.cards,
                repaired: repaired,
                fresh: count === 1 && !repaired,
                source: source || ''
            };
            if (delay > 0) setTimeout(() => showStreakPopup(info), delay);
            else showStreakPopup(info);
            return { extended: true, count: count, best: next.best, cards: next.cards, repaired: repaired, today: today, recentDays: next.recentDays };
        }

        function streakPopupKeydown(event) {
            if (event.key === 'Escape') closeStreakPopup();
        }

        function closeStreakPopup() {
            const popup = document.getElementById('streak-popup');
            if (!popup) return;
            popup.remove();
            document.removeEventListener('keydown', streakPopupKeydown);
        }

        function streakPopupHost() {
            // Native fullscreen renders only the fullscreen element's subtree,
            // so a race/Word Jump popup has to live inside it to be seen.
            const fs = document.fullscreenElement || document.webkitFullscreenElement;
            return (fs && fs.appendChild) ? fs : document.body;
        }

        function showStreakPopup(info) {
            const existing = document.getElementById('streak-popup');
            if (existing) existing.remove();
            const count = Math.max(1, Number(info && info.count) || 1);
            const source = (info && info.source) ? String(info.source) : '';
            const fresh = !!(info && info.fresh);
            const repaired = Math.max(0, Number(info && info.repaired) || 0);
            const cards = Math.max(0, Number(info && info.cards) || 0);
            const dayWord = count === 1 ? 'day' : 'days';
            const line = repaired
                ? 'Repair card used — your flame is still alive!'
                : fresh
                    ? 'Your first flame is lit. Finish a practice tomorrow to make it two.'
                    : count === 2
                        ? 'Two days in a row — the flame is growing!'
                        : count >= 7
                            ? count + ' days in a row. That is a proper bonfire!'
                            : count + ' days in a row — keep the fire alive!';
            const popup = document.createElement('div');
            popup.id = 'streak-popup';
            popup.className = 'streak-popup';
            popup.setAttribute('role', 'dialog');
            popup.setAttribute('aria-modal', 'true');
            popup.setAttribute('aria-labelledby', 'streak-popup-title');
            popup.innerHTML = `
                <div class="streak-popup-card">
                    <div class="streak-popup-flame" aria-hidden="true">🔥</div>
                    <h2 id="streak-popup-title" class="streak-popup-title">You made it!</h2>
                    <p class="streak-popup-count"><span aria-hidden="true">🔥</span> ${count} ${dayWord}</p>
                    <p class="streak-popup-line">${escapeHtml(line)}</p>
                    ${repaired ? `<p class="streak-popup-repair">🛟 ${repaired} repair card${repaired === 1 ? '' : 's'} used</p>` : ''}
                    <p class="streak-popup-cards">🛟 ${cards} repair card${cards === 1 ? '' : 's'} left</p>
                    ${source ? `<p class="streak-popup-source">${escapeHtml(source)} complete</p>` : ''}
                    <button type="button" class="streak-popup-btn" onclick="closeStreakPopup()">Keep going!</button>
                </div>`;
            popup.addEventListener('click', event => {
                if (event.target === popup) closeStreakPopup();
            });
            // The popup can sit inside #wj-stage during fullscreen; stop the
            // game's pointer handlers from treating a tap on it as steering.
            ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchmove', 'click'].forEach(type => {
                popup.addEventListener(type, event => event.stopPropagation());
            });
            streakPopupHost().appendChild(popup);
            document.addEventListener('keydown', streakPopupKeydown);
            const btn = popup.querySelector('.streak-popup-btn');
            if (btn && btn.focus) btn.focus({ preventScroll: true });
        }
        function isGuestUser() { return !!guestSession; }
        function isTeacherAccount() { return !isGuestUser() && currentUser && currentUser.email === ADMIN_EMAIL; }
        const PREVIEW_FORM_KEY = 'learniTY_preview_form';
        let previewStudentFormValue = '';
        function isAdmin() { return isTeacherAccount() && !previewStudentForm(); }
        function isSignedIn() { return isGuestUser() || !!currentUser; }
        function canUseCloud() { return !isGuestUser() && !!currentUser; }

        function hasGuestSessionFlag() {
            try { return sessionStorage.getItem(GUEST_SESSION_KEY) === '1'; } catch (e) { return false; }
        }
        function writeGuestSessionFlag() {
            try { sessionStorage.setItem(GUEST_SESSION_KEY, '1'); } catch (e) {}
        }
        function clearGuestSessionFlag() {
            try {
                sessionStorage.removeItem(GUEST_SESSION_KEY);
                // The usage session key belongs to the finished guest session;
                // a new password sign-in starts a fresh one anyway.
                sessionStorage.removeItem(GUEST_SESSION_KEY_ID);
            } catch (e) {}
        }

        // --- Guest tracking (teacher dashboard only) ---
        // Guests are never written to student_logins, scores or leaderboards.
        // A random session key (sessionStorage, one per guest tab) links the
        // login row and the usage rows for that tab together in guest_logins /
        // guest_usage, which only the teacher can read.
        const GUEST_SESSION_KEY_ID = 'learniTY_guest_session_key';

        function guestSessionKey(fresh) {
            try {
                let key = fresh ? null : sessionStorage.getItem(GUEST_SESSION_KEY_ID);
                if (!key) {
                    key = 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
                    sessionStorage.setItem(GUEST_SESSION_KEY_ID, key);
                }
                return key;
            } catch (e) {
                return 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
            }
        }

        // Rolling retention window for guest browsing records.
        // Deliberately a rolling last 24 hours (now - 24h), NOT an
        // Asia/Hong_Kong calendar day: the database deletes anything older
        // (prune_guest_records() in supabase/guest_tracking.sql and the
        // incremental supabase/guest_tracking_prune.sql), so the dashboard
        // window must use exactly the same cutoff.
        const GUEST_RETENTION_MS = 24 * 60 * 60 * 1000;

        function guestRetentionCutoffMs(now) {
            const base = (now == null) ? Date.now() : Number(now);
            return (Number.isFinite(base) ? base : Date.now()) - GUEST_RETENTION_MS;
        }

        function guestCutoffIso(now) {
            return new Date(guestRetentionCutoffMs(now)).toISOString();
        }

        function isWithinGuestLogWindow(value, now) {
            if (value == null || value === '') return false;
            const t = new Date(value).getTime();
            return Number.isFinite(t) && t >= guestRetentionCutoffMs(now);
        }

        // Keep only rows inside the rolling 24-hour window. Used by the
        // dashboard query (.gte) and again when rendering, so a stale row
        // that somehow comes back from the database is never displayed.
        function filterGuestRecords(rows, field, now) {
            return (rows || []).filter(r => r && isWithinGuestLogWindow(r[field], now));
        }

        // One row per successful password entry. Called only from
        // signInAsGuest — a refresh that restores the session from
        // sessionStorage goes through startGuestSession() without this.
        function recordGuestLogin() {
            try {
                sb.rpc('record_guest_login', {
                    p_session_key: guestSessionKey(true),
                    p_user_agent: navigator.userAgent
                }).then(({ error }) => {
                    if (error) console.warn('Guest login record failed:', error.message);
                });
            } catch (e) { /* tracking is optional — never block the game */ }
        }

        // Fire-and-forget usage row. Safe to call even if
        // supabase/guest_tracking.sql has not been run yet.
        function recordGuestUsage(feature, detail) {
            if (!guestSession) return;
            try {
                sb.rpc('record_guest_usage', {
                    p_session_key: guestSessionKey(false),
                    p_feature: feature || '',
                    p_detail: detail || null
                }).then(({ error }) => {
                    if (error) console.warn('Guest usage record failed:', error.message);
                });
            } catch (e) { /* tracking is optional — never block the game */ }
        }

        // Year groups. Add a form here (id must be F + the year, e.g. F5) and
        // every dropdown, display-name parser, grouping, and the old-browser
        // migration follow this list.
        const FORM_LEVELS = [
            { id: 'F3', label: 'F3' },
            { id: 'F4', label: 'F4' },
            { id: 'F6', label: 'F6' }
        ];
        const FORM_STORAGE_KEY = 'student_form_level';
        const FORM_CLAIMED_BY_KEY = 'student_form_claimed_by';

        function normalizeForm(raw) {
            const compact = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const hit = FORM_LEVELS.find(f => f.id.toUpperCase().replace(/[^A-Z0-9]/g, '') === compact);
            return hit ? hit.id : '';
        }

        function formLabel(id) {
            const hit = FORM_LEVELS.find(f => f.id === id);
            return hit ? hit.label : (id || 'Unassigned');
        }

        function previewStudentForm() {
            return normalizeForm(previewStudentFormValue);
        }
        function readPreviewForm() {
            try { return normalizeForm(sessionStorage.getItem(PREVIEW_FORM_KEY)); } catch (e) { return ''; }
        }
        function writePreviewForm(form) {
            try {
                if (form) sessionStorage.setItem(PREVIEW_FORM_KEY, form);
                else sessionStorage.removeItem(PREVIEW_FORM_KEY);
            } catch (e) {}
        }
        function paintPreviewBanner() {
            const banner = document.getElementById('preview-banner');
            const text = document.getElementById('preview-banner-text');
            const form = previewStudentForm();
            if (banner) banner.classList.toggle('hidden', !form);
            if (text && form) text.textContent = 'You are previewing the ' + form + ' student account.';
            const card = document.getElementById('hub-preview-entry');
            if (card) card.classList.toggle('hidden', !isTeacherAccount() || !!form);
        }
        function applyStudentPreview(form, goHub) {
            previewStudentFormValue = normalizeForm(form) || '';
            writePreviewForm(previewStudentFormValue);
            if (previewStudentFormValue) {
                myFormValue = previewStudentFormValue;
                myFormLoaded = true;
                ownFormPersisted = true;
            } else {
                myFormValue = '';
                myFormLoaded = false;
                ownFormPersisted = false;
            }
            if (typeof adoptErrorBookUser === 'function') adoptErrorBookUser();
            paintPreviewBanner();
            updateAuthUI();
            if (goHub) changeView('hub-view');
        }
        function enterStudentPreview(formId) {
            const form = normalizeForm(formId);
            if (!isTeacherAccount() || !form) return;
            applyStudentPreview(form, true);
            updateMascot('Previewing the ' + form + ' student account. Press Exit preview to return.');
        }
        function exitStudentPreview() {
            applyStudentPreview('', true);
            updateMascot('Back to the teacher account.');
        }
        function restoreStudentPreview() {
            if (!isTeacherAccount()) {
                previewStudentFormValue = '';
                paintPreviewBanner();
                return;
            }
            const saved = readPreviewForm();
            previewStudentFormValue = saved;
            if (saved) {
                myFormValue = saved;
                myFormLoaded = true;
                ownFormPersisted = true;
            }
            paintPreviewBanner();
        }

        // Derive form (and class 班別) only from the student's displayed
        // login name — Google full_name, stored as nickname on student_logins
        // and on teacher list rows. Never use the email local-part: school
        // logins look like s231014@…, whose first digit is an admission year,
        // not the form.
        //
        // Assign F3/F4/F6 only when the displayed name clearly provides a
        // class/form code at the start, e.g. "4C 16 Lai Ka Lok 黎嘉樂",
        // "3A 08 Chan Tai Man", "6D 21 Wong", or "Form 4C …". A name with
        // no class code, such as "Liu Chun Ming", stays Unassigned. A stray
        // 3, 4 or 6 later in a name, student number or year is ignored.
        function formFromClassCodeAtStart(text) {
            const empty = { form: '', classId: '' };
            const raw = String(text || '').trim();
            if (!raw) return empty;
            const m = /^(?:form\s*|f\.?\s*)?([346])([a-z])(?=$|[^a-z])/i.exec(raw);
            if (!m) return empty;
            const digit = m[1];
            const letter = m[2].toUpperCase();
            const form = normalizeForm('F' + digit);
            if (!form) return empty;
            return { form, classId: digit + letter };
        }

        // A real Google / on-screen name, not an email or email local-part
        // fallback such as s231014.
        function displayedLoginName(email, nickname) {
            const name = String(nickname || '').trim();
            if (!name) return '';
            const em = String(email || '').trim();
            const local = em.split('@')[0].trim();
            if (em && name.toLowerCase() === em.toLowerCase()) return '';
            if (local && name.toLowerCase() === local.toLowerCase()) return '';
            return name;
        }

        function parseDisplayNameFormClass(nickname) {
            return formFromClassCodeAtStart(nickname);
        }

        function nicknameOfEmail(email, nickname) {
            const fromRow = displayedLoginName(email, nickname);
            if (fromRow) return fromRow;
            const key = String(email || '').toLowerCase();
            return displayedLoginName(email, formDirectory.nicknames.get(key));
        }

        let formOverrides = new Map();
        let formDirRequest = 0;
        let formDirectory = { byEmail: new Map(), nicknames: new Map(), sources: new Map(), loaded: false, missing: false, error: '', pending: null };
        let formSaveSeq = 0;

        function isMissingSchema(message) {
            return /does not exist|Could not find|42703|42P01|PGRST204|PGRST202|PGRST20|schema cache/i.test(message || '');
        }

        function formOfEmail(email, nickname) {
            const key = String(email || '').toLowerCase();
            if (formOverrides.has(key)) return formOverrides.get(key) || '';
            const parsed = parseDisplayNameFormClass(nicknameOfEmail(email, nickname)).form || '';
            const stored = formDirectory.byEmail.get(key) || '';
            const source = formDirectory.sources.get(key) || '';
            // Teacher dropdown always wins. An automatic or unknown stored
            // form (for example Liu Chun Ming wrongly saved as F6) is ignored
            // unless the displayed name itself still has a class code.
            if (source === 'teacher') return stored || '';
            return parsed;
        }

        function classOfEmail(email, nickname) {
            const parsed = parseDisplayNameFormClass(nicknameOfEmail(email, nickname));
            if (!parsed.classId) return '';
            if (parsed.form && formOfEmail(email, nickname) !== parsed.form) return '';
            return parsed.classId;
        }

        function classBadge(email, nickname) {
            const klass = classOfEmail(email, nickname);
            if (!klass) return '';
            return `<span class="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">${escapeHtml(klass)}</span>`;
        }

        function formSections() {
            return FORM_LEVELS.map(f => ({ id: f.id, label: f.label })).concat([{ id: '', label: 'Unassigned' }]);
        }

        function groupRowsByForm(rows, emailOf) {
            const getEmail = emailOf || (r => r && r.email);
            const buckets = new Map(formSections().map(s => [s.id, []]));
            (rows || []).forEach(r => {
                const id = formOfEmail(getEmail(r), r && r.nickname) || '';
                if (!buckets.has(id)) buckets.set(id, []);
                buckets.get(id).push(r);
            });
            return formSections().map(s => ({ id: s.id, label: s.label, rows: buckets.get(s.id) || [] }));
        }

        const adminFormOpen = {};

        function adminFormKey(scope, formId) {
            return String(scope || '') + '::' + (formId || 'unassigned');
        }

        function isAdminFormOpen(scope, formId) {
            return !!adminFormOpen[adminFormKey(scope, formId)];
        }

        function setAdminFormOpen(scope, formId, open) {
            const id = formId || 'unassigned';
            adminFormOpen[adminFormKey(scope, id)] = !!open;
            const root = document.querySelector('[data-form-scope="' + scope + '"][data-form-group="' + id + '"]');
            if (!root) return;
            const body = root.querySelector('.admin-form-body');
            if (body) body.classList.toggle('hidden', !open);
            const plus = root.querySelector('.admin-form-expand');
            const minus = root.querySelector('.admin-form-collapse');
            if (plus) {
                plus.classList.toggle('bg-orange-500', !open);
                plus.classList.toggle('text-white', !open);
                plus.classList.toggle('bg-orange-100', !!open);
                plus.classList.toggle('text-orange-600', !!open);
                plus.setAttribute('aria-pressed', (!open).toString());
            }
            if (minus) {
                minus.classList.toggle('bg-orange-500', !!open);
                minus.classList.toggle('text-white', !!open);
                minus.classList.toggle('bg-orange-100', !open);
                minus.classList.toggle('text-orange-600', !open);
                minus.setAttribute('aria-pressed', (!!open).toString());
            }
        }

        function adminFormToggleButtons(scope, formId, label, open) {
            const id = formId || 'unassigned';
            const safeScope = escapeHtml(scope);
            const safeId = escapeHtml(id);
            const safeLabel = escapeHtml(label);
            const plusCls = !open ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600';
            const minusCls = open ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600';
            return `<span class="inline-flex items-center gap-1 ml-1">
                <button type="button" class="admin-form-expand w-7 h-7 rounded-full font-bold text-base leading-none ${plusCls} hover:bg-orange-500 hover:text-white transition-colors" aria-label="Expand ${safeLabel}" aria-pressed="${!open ? 'true' : 'false'}" onclick="event.stopPropagation(); setAdminFormOpen('${safeScope}','${safeId}',true)">+</button>
                <button type="button" class="admin-form-collapse w-7 h-7 rounded-full font-bold text-base leading-none ${minusCls} hover:bg-orange-500 hover:text-white transition-colors" aria-label="Collapse ${safeLabel}" aria-pressed="${open ? 'true' : 'false'}" onclick="event.stopPropagation(); setAdminFormOpen('${safeScope}','${safeId}',false)">-</button>
            </span>`;
        }

        function renderFormSections(groups, renderRows, options) {
            const opts = options || {};
            const hasAny = (groups || []).some(g => g.rows.length);
            if (!hasAny) return opts.emptyAll || '<p class="text-gray-400 text-center py-10">No records yet.</p>';
            return (groups || []).map(g => {
                if (!g.rows.length && !g.id) return '';
                const body = g.rows.length
                    ? renderRows(g.rows, g)
                    : `<p class="text-gray-400 text-center py-4">${opts.emptyForm || 'No students in this form yet.'}</p>`;
                const tone = g.id ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500';
                const groupId = g.id || 'unassigned';
                const collapsible = !!(opts.collapsible && opts.scope);
                const open = collapsible && isAdminFormOpen(opts.scope, groupId);
                const toggles = collapsible ? adminFormToggleButtons(opts.scope, groupId, g.label, open) : '';
                const wrapped = collapsible
                    ? `<div class="admin-form-body${open ? '' : ' hidden'}">${body}</div>`
                    : body;
                const scopeAttr = collapsible ? ` data-form-scope="${escapeHtml(opts.scope)}"` : '';
                return `<section class="mt-8 first:mt-0" data-form-group="${escapeHtml(groupId)}"${scopeAttr}>
                    <h4 class="text-lg font-bold text-gray-600 mb-3 flex items-center gap-2 flex-wrap">
                        <span class="px-3 py-1 rounded-full ${tone}">${escapeHtml(g.label)}</span>
                        <span class="text-sm font-bold text-gray-400">${g.rows.length}</span>
                        ${toggles}
                    </h4>
                    ${wrapped}
                </section>`;
            }).join('');
        }

        function answersForForm(rows, players, formId) {
            const list = rows || [];
            const ids = new Set();
            (players || []).forEach(p => {
                if (p.user_id && (formOfEmail(p.email, p.nickname) || '') === (formId || '')) ids.add(p.user_id);
            });
            return list.filter(r => ids.has(r.user_id));
        }

        function syncFormSetupNote() {
            const note = document.getElementById('form-setup-note');
            if (!note) return;
            if (!isAdmin() || !formDirectory.loaded || !formDirectory.missing) {
                note.classList.add('hidden');
                note.innerHTML = '';
                return;
            }
            note.classList.remove('hidden');
            note.innerHTML = 'Form assignments are not saved yet. Run <code>supabase/student_forms.sql</code> in the Supabase SQL editor, then refresh. Until then, students are still grouped from the class code in their displayed login name, but the form dropdown cannot be saved.';
        }

        function formAssignControl(email, nickname) {
            if (!isAdmin() || !email) return '';
            const current = formOfEmail(email, nickname);
            const opts = [`<option value="">—</option>`].concat(FORM_LEVELS.map(f =>
                `<option value="${f.id}"${current === f.id ? ' selected' : ''}>${escapeHtml(f.label)}</option>`
            )).join('');
            return `<select aria-label="Form for ${escapeHtml(email)}" title="Set form" onclick="event.stopPropagation()" class="text-xs font-bold rounded-full border-2 border-gray-200 px-2 py-1 bg-white text-gray-700" data-email="${encodeURIComponent(email)}" onchange="assignStudentForm(decodeURIComponent(this.getAttribute('data-email')), this.value)">${opts}</select>`;
        }

        function formBadge(email, nickname) {
            const id = formOfEmail(email, nickname);
            const klass = classOfEmail(email, nickname);
            const label = id ? (klass ? formLabel(id) + ' · ' + klass : formLabel(id)) : '—';
            const cls = id ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-400';
            return `<span class="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}">${escapeHtml(label)}</span>`;
        }

        function ensureFormDirectory(force) {
            if (formDirectory.loaded && !force) return Promise.resolve(formDirectory);
            if (formDirectory.pending && !force) return formDirectory.pending;
            const req = ++formDirRequest;
            formDirectory.loaded = false;
            formDirectory.pending = (async () => {
                try {
                    let res = await sb.from('student_logins').select('user_id, email, form, form_source, nickname');
                    let formColumnMissing = false;
                    let sourceColumnMissing = false;
                    if (res.error && isMissingSchema(res.error.message)) {
                        const retryForm = await sb.from('student_logins').select('user_id, email, form, nickname');
                        if (!retryForm.error) {
                            res = retryForm;
                            sourceColumnMissing = true;
                        } else if (isMissingSchema(retryForm.error.message)) {
                            const retry = await sb.from('student_logins').select('user_id, email, nickname');
                            if (!retry.error) {
                                res = retry;
                                formColumnMissing = true;
                                sourceColumnMissing = true;
                            }
                        }
                    }
                    if (req !== formDirRequest) return formDirectory;
                    if (res.error) {
                        formDirectory.missing = isMissingSchema(res.error.message);
                        formDirectory.error = res.error.message;
                        if (formDirectory.missing) {
                            formDirectory.byEmail = new Map();
                            formDirectory.nicknames = new Map();
                            formDirectory.sources = new Map();
                        }
                    } else {
                        const map = new Map();
                        const nicks = new Map();
                        const sources = new Map();
                        (res.data || []).forEach(row => {
                            const email = String(row.email || '').toLowerCase();
                            if (!email) return;
                            if (!formColumnMissing) map.set(email, normalizeForm(row.form));
                            if (!sourceColumnMissing) {
                                const src = String(row.form_source || '').trim().toLowerCase();
                                if (src) sources.set(email, src);
                            }
                            const nick = String(row.nickname || '').trim();
                            if (nick) nicks.set(email, nick);
                        });
                        formOverrides.forEach((value, email) => {
                            map.set(email, value);
                            sources.set(email, value ? 'teacher' : '');
                        });
                        formDirectory.byEmail = map;
                        formDirectory.nicknames = nicks;
                        formDirectory.sources = sources;
                        formDirectory.missing = formColumnMissing;
                        formDirectory.error = '';
                    }
                    formDirectory.loaded = true;
                    syncFormSetupNote();
                } catch (e) {
                    if (req === formDirRequest) {
                        formDirectory.error = e.message || String(e);
                        formDirectory.loaded = true;
                        syncFormSetupNote();
                    }
                } finally {
                    if (req === formDirRequest) formDirectory.pending = null;
                }
                return formDirectory;
            })();
            return formDirectory.pending;
        }

        function refreshTeacherSurfaces() {
            syncFormSetupNote();
            const admin = document.getElementById('admin-view');
            if (admin && !admin.classList.contains('hidden')) {
                renderAdminDashboard();
                renderGrammarAdmin();
                renderLoginAdmin();
                renderBattleAdmin();
                renderWordJumpAdmin();
            }
            const lb = document.getElementById('leaderboard-view');
            if (lb && !lb.classList.contains('hidden')) renderLeaderboard();
            const klass = document.getElementById('battle-class');
            if (klass && !klass.classList.contains('hidden') && battleRoom) {
                battleBreakdownLoadedFor = null;
                battleRenderClassHost();
            }
        }

        async function assignStudentForm(email, value) {
            if (!isAdmin()) return;
            const canonical = value ? normalizeForm(value) : '';
            if (value && !canonical) return;
            const key = String(email || '').toLowerCase();
            if (!key) return;
            const seq = ++formSaveSeq;
            const prev = formOverrides.has(key) ? formOverrides.get(key) : (formDirectory.byEmail.get(key) || '');
            const prevSource = formDirectory.sources.get(key) || '';
            formOverrides.set(key, canonical);
            formDirectory.byEmail.set(key, canonical);
            formDirectory.sources.set(key, canonical ? 'teacher' : '');
            refreshTeacherSurfaces();
            const { error } = await sb.rpc('set_student_form', { p_email: email, p_form: canonical });
            if (seq !== formSaveSeq) return;
            if (error) {
                console.warn('set_student_form failed:', error.message);
                formOverrides.set(key, prev);
                formDirectory.byEmail.set(key, prev);
                formDirectory.sources.set(key, prevSource);
                refreshTeacherSurfaces();
                updateMascot(isMissingSchema(error.message)
                    ? 'Form saving is not set up yet. Run supabase/student_forms.sql in the SQL editor.'
                    : 'Could not save that form. Please try again.');
            }
        }

        // Fill student_logins.form from a class code in the displayed login
        // name (Google full_name / name). Never guess from the email, and
        // never upload an old localStorage form. An empty p_form asks
        // claim_own_form to release a previous automatic claim only
        // (supabase/student_forms_source.sql); a teacher dropdown value is
        // left alone. Skip the teacher account.
        async function claimSavedForm(user) {
            if (!user || !user.email || user.email === ADMIN_EMAIL) return;
            const nick = user.user_metadata?.full_name || user.user_metadata?.name || '';
            const fromName = parseDisplayNameFormClass(displayedLoginName(user.email, nick)).form || '';
            const { error } = await sb.rpc('claim_own_form', { p_form: fromName });
            if (error) {
                console.warn('Form claim failed:', error.message);
            }
        }

        function signInWithGoogle() {
            sb.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: window.location.origin,
                    queryParams: { hd: "lstyoungkhl.edu.hk" }
                }
            });
        }

        function endGuestSession() {
            guestSession = false;
            clearGuestSessionFlag();
        }

        function startGuestSession(fresh) {
            guestSession = true;
            writeGuestSessionFlag();
            // Only a fresh password sign-in counts as a login; restoring the
            // session from sessionStorage (page refresh) does not.
            if (fresh) recordGuestLogin();
            loginRecorded = true;
            myFormValue = '';
            myFormLoaded = true;
            ownFormPersisted = false;
            updateAuthUI();
            adoptErrorBookUser();
            if (sheetCategoriesReady) renderCategories();
            else if (!sheetCategoriesLoading) loadAllCategoriesFromSheet();
            showApp();
            updateMascot("Guest mode: you can use all of Dictation Master and play Word Jump. Leaderboards stay off.");
        }

        function signInAsGuest(event) {
            if (event) event.preventDefault();
            const input = document.getElementById('guest-password');
            const err = document.getElementById('guest-login-error');
            const typed = String(input && input.value || '').trim();
            if (typed !== GUEST_PASSWORD) {
                if (err) {
                    err.classList.remove('hidden');
                    err.innerText = 'That guest password is not right.';
                }
                return;
            }
            if (input) input.value = '';
            if (err) { err.classList.add('hidden'); err.innerText = ''; }
            startGuestSession(true);
        }

        async function signOut() {
            endGuestSession();
            previewStudentFormValue = '';
            writePreviewForm('');
            if (currentUser) {
                currentUser = null;
                try { await sb.auth.signOut(); } catch (e) {}
            }
            loginRecorded = false;
            myFormValue = '';
            myFormLoaded = false;
            ownFormPersisted = false;
            streakCloudUser = '';
            streakCloudLoaded = false;
            streakCloudLoading = null;
            paintPreviewBanner();
            adoptErrorBookUser();
            updateAuthUI();
            showLogin();
        }

        function updateAuthUI() {
            const btn = document.getElementById('auth-btn');
            const nickname = document.getElementById('auth-nickname');
            const adminBtn = document.getElementById('admin-hub-entry');
            const previewCard = document.getElementById('hub-preview-entry');
            const lbCard = document.getElementById('hub-leaderboard-entry');
            const recCard = document.getElementById('hub-records-entry');
            if (isGuestUser()) {
                if (btn) { btn.innerText = 'Logout'; btn.onclick = signOut; }
                if (nickname) nickname.innerText = 'Guest';
                if (adminBtn) adminBtn.classList.add('hidden');
                if (previewCard) previewCard.classList.add('hidden');
                if (lbCard) lbCard.classList.add('hidden');
                if (recCard) recCard.classList.add('hidden');
                paintPreviewBanner();
                updateStreakBadge();
                return;
            }
            if (lbCard) lbCard.classList.remove('hidden');
            if (recCard) recCard.classList.remove('hidden');
            if (currentUser) {
                const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
                const form = previewStudentForm();
                if (btn) { btn.innerText = 'Logout'; btn.onclick = signOut; }
                if (nickname) nickname.innerText = form ? (form + ' preview') : name;
                if (adminBtn) adminBtn.classList.toggle('hidden', !isAdmin());
                if (previewCard) previewCard.classList.toggle('hidden', !isTeacherAccount() || !!form);
            } else {
                if (adminBtn) adminBtn.classList.add('hidden');
                if (previewCard) previewCard.classList.add('hidden');
                if (nickname) nickname.innerText = '';
            }
            paintPreviewBanner();
            updateStreakBadge();
        }

        function showApp() {
            const app = document.getElementById('app');
            const login = document.getElementById('login-view');
            const alreadyOpen = !!(app && app.classList.contains('logged-in') && login && login.style.display === 'none');
            if (login) login.style.display = 'none';
            if (app) app.classList.add('logged-in');
            // Token refresh / repeated SIGNED_IN events used to bounce the
            // current panel back to the Hub, so the teacher had to click in again
            // while adding New Vocab words (and students lost their place too).
            if (!alreadyOpen) changeView('hub-view');
            else updateBottomNav();
            updateStreakBadge();
            // Cross-device streak: fetch once per sign-in. The local mirror is
            // already showing, so a slow / missing table never blocks the app.
            if (canUseCloud() && !previewStudentForm()) loadCloudStreak();
        }

        function showLogin() {
            document.getElementById('app').classList.remove('logged-in');
            document.getElementById('login-view').style.display = '';
            updateBottomNav();
        }

        // --- Login tracking (admin dashboard) ---
        // Writes one row per student via the record_login() SQL function.
        // A new login only counts if the previous one was >12h ago, so page
        // refreshes / token refreshes do not inflate login_count.
        let loginRecorded = false;
        async function recordLogin(user) {
            if (!user || loginRecorded) return;
            loginRecorded = true;
            const nickname = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
            const { error } = await sb.rpc('record_login', {
                p_nickname: nickname,
                p_user_agent: navigator.userAgent
            });
            if (error) console.warn('Login record failed:', error.message);
            if (!previewStudentForm()) await claimSavedForm(user);
        }

        // Supabase can deliver its first auth event before the later feature
        // scripts have executed, so the listener is registered once the whole
        // document has parsed (all js/ files are loaded by then).
        function registerAuthListener() {
            sb.auth.onAuthStateChange(async (_event, session) => {
                const email = session?.user?.email ?? "";
                if (session && !email.endsWith(SCHOOL_DOMAIN)) {
                    await sb.auth.signOut();
                    document.getElementById('login-mascot-text').innerText = "Please use your school account to login (" + SCHOOL_DOMAIN + ")";
                    currentUser = null;
                    endGuestSession();
                    adoptErrorBookUser();
                    showLogin();
                } else if (session) {
                    endGuestSession();
                    currentUser = session.user;
                    restoreStudentPreview();
                    recordLogin(session.user);
                    updateAuthUI();
                    adoptErrorBookUser();
                    showApp();
                } else {
                    currentUser = null;
                    if (hasGuestSessionFlag()) {
                        startGuestSession();
                    } else {
                        guestSession = false;
                        adoptErrorBookUser();
                        showLogin();
                    }
                }
            });
        }

        window.addEventListener('DOMContentLoaded', registerAuthListener);

        function parseCSV(text) {
            const lines = text.split(/\r?\n/);
            const data = [];
            const seen = new Set();
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(p => p.replace(/^"|"$/g, '').trim());
                // Most tabs start with a title row like "Charity Level 1: ..."; the
                // "basics" tab does not, so only skip a first row that is not data.
                if (i === 0 && (parts.length < 3 || !parts[1] || !/^\d+$/.test(parts[0]))) continue;
                let row;
                if (parts.length >= 3) row = { cat: parts[0], en: parts[1], zh: parts[2] };
                else if (parts.length === 2) row = { cat: '', en: parts[0], zh: parts[1] };
                else continue;
                if (!row.en) continue;
                // the sheet sometimes repeats a row (e.g. "fifteen")
                const key = row.en.toLowerCase() + '|' + row.zh.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                data.push(row);
            }
            return data;
        }

        // One cell may hold several accepted answers, e.g. "plaza / square / mall".
        function answerVariants(en) {
            const out = String(en || '').split('/').map(s => s.trim()).filter(Boolean);
            return out.length ? out : [String(en || '').trim()];
        }

        function primaryAnswer(en) {
            return answerVariants(en)[0];
        }

        function quizNormalize(s) {
            return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
        }

        // `normalize` lets the battle mode reuse its punctuation-insensitive rules.
        function isAnswerCorrect(input, en, normalize) {
            const norm = normalize || quizNormalize;
            const typed = norm(input);
            if (!typed) return false;
            return answerVariants(en).some(v => norm(v) === typed);
        }


        function paintChoiceButtons(selector, activeValue) {
            document.querySelectorAll(selector).forEach(btn => {
                const match = (btn.getAttribute('onclick') || '').match(/'([^']+)'/);
                const on = !!(match && match[1] === activeValue);
                const green = btn.classList.contains('grammar-admin-btn');
                btn.classList.toggle(green ? 'bg-green-500' : 'bg-orange-500', on);
                btn.classList.toggle('text-white', on);
                btn.classList.toggle(green ? 'bg-green-100' : 'bg-orange-100', !on);
                btn.classList.toggle(green ? 'text-green-600' : 'text-orange-600', !on);
            });
        }

        function displayName(row) {
            return (row && (row.nickname || ((row.email || '').split('@')[0]))) || 'student';
        }

        function escapeHtml(s) {
            return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

        function timeAgo(iso) {
            if (!iso) return '—';
            const diff = Date.now() - new Date(iso).getTime();
            const m = Math.floor(diff / 60000);
            if (m < 1) return 'just now';
            if (m < 60) return m + ' min ago';
            const h = Math.floor(m / 60);
            if (h < 24) return h + ' hr ago';
            const d = Math.floor(h / 24);
            if (d < 30) return d + ' day' + (d === 1 ? '' : 's') + ' ago';
            return new Date(iso).toLocaleDateString();
        }

        function hkDate(iso) {
            if (!iso) return '—';
            return new Date(iso).toLocaleString('en-HK', {
                timeZone: 'Asia/Hong_Kong',
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }

        function hkDateOnly(iso) {
            if (!iso) return '—';
            const d = new Date(iso);
            if (!Number.isFinite(d.getTime())) return '—';
            return d.toLocaleDateString('en-HK', {
                timeZone: 'Asia/Hong_Kong',
                year: 'numeric', month: 'short', day: 'numeric'
            });
        }

        // Calendar-relative label in Hong Kong time: Today / Yesterday / N days ago.
        function hkRelativeDay(iso) {
            if (!iso) return '—';
            const text = String(iso).slice(0, 10);
            const key = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : hkDayKey(iso);
            const gap = streakGapDays(key, hkDayKey(new Date().toISOString()));
            if (!Number.isFinite(gap)) return '—';
            if (gap <= 0) return 'Today';
            if (gap === 1) return 'Yesterday';
            return gap + ' days ago';
        }

        function hkDayKey(iso) {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(new Date(iso));
        }

        function deviceLabel(ua) {
            if (!ua) return '—';
            const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
                : /Android/.test(ua) ? 'Android'
                : /Mac OS X/.test(ua) ? 'macOS'
                : /Windows/.test(ua) ? 'Windows'
                : /CrOS/.test(ua) ? 'ChromeOS' : 'Other';
            const br = /Edg\//.test(ua) ? 'Edge'
                : /OPR\//.test(ua) ? 'Opera'
                : /Chrome\//.test(ua) ? 'Chrome'
                : /Firefox\//.test(ua) ? 'Firefox'
                : /Safari\//.test(ua) ? 'Safari' : 'Browser';
            return os + ' · ' + br;
        }

        function updateMascot(text) {

            const el = document.getElementById('mascot-text');
            if(el) el.innerText = text; 
        }

        async function loadCloudRecords() {
            const container = document.getElementById('cloud-records-container');
            if (isGuestUser()) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10 text-lg">Guest visits are not saved to cloud records or leaderboards.</p>';
                return;
            }
            if (!currentUser) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10 text-lg">Please login to view cloud records.</p>';
                return;
            }
            const { data, error } = await sb.from("dictation_results")
                .select("*")
                .eq("user_id", currentUser.id)
                .order("created_at", { ascending: false })
                .limit(50);
            if (error || !data || data.length === 0) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10 text-lg">No records found.</p>';
                return;
            }
            container.innerHTML = `
                <div class="space-y-3">
                    ${data.map(r => `
                        <div class="flex justify-between items-center bg-gray-50 rounded-xl px-4 py-3">
                            <span class="font-bold text-gray-700">${r.topic}</span>
                            <span class="text-gray-400 capitalize">${r.mode}</span>
                            <span class="font-bold text-orange-600">${r.score} pts</span>
                            <span class="text-gray-400">${Math.round((r.score / (r.total * 10)) * 100)}%</span>
                            <span class="text-gray-400 text-sm">${new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        function changeView(viewId) {
            if (isGuestUser() && GUEST_BLOCKED_VIEWS.indexOf(viewId) !== -1) {
                updateMascot('Leaderboards and rankings are not available in guest mode.');
                viewId = 'hub-view';
            }
            if (previewStudentForm() && viewId === 'admin-view') {
                viewId = 'hub-view';
            }
            if (viewId !== 'battle-view') battleStopPolling();
            if (viewId !== 'wordjump-view' && typeof WJ !== 'undefined') WJ.stop();
            if (viewId !== 'wordjump-view' && typeof WJC !== 'undefined') WJC.onLeaveView();
            if (typeof DG !== 'undefined' && typeof DG.onLeaveView === 'function') DG.onLeaveView(viewId);
            const keepVocabPoll = (viewId === 'sub-category-view' || viewId === 'word-list-view') && currentTopic === NEW_VOCAB;
            if (!keepVocabPoll) nvStopPoll();
            if (window.lastFinalView) {
                window.lastFinalView.remove();
                window.lastFinalView = null;
            }
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            const target = document.getElementById(viewId);
            if(target) target.classList.remove('hidden');
            currentView = viewId;
            window.scrollTo(0,0);
            updateBottomNav();
            
            if (viewId === 'hub-view') {
                updateMascot("Awesome! What would you like to learn next?");
                battleRenderRejoin();
                if (typeof WJC !== 'undefined') WJC.renderRejoin();
            }
            if (viewId === 'home-view') {
                updateMascot("Choose a topic to begin your dictation journey.");
                if (sheetCategoriesReady) renderCategories();
                else if (!sheetCategoriesLoading) loadAllCategoriesFromSheet();
            }
            if (viewId === 'sub-category-view') {
                updateMascot(currentTopic === NEW_VOCAB ? "New Vocab keeps every word. Added today is just this lesson." : `Ready to practice ${currentTopic}? Pick an activity!`);
                if (currentTopic === NEW_VOCAB) nvEnter();
                else nvHide();
            }
            if (viewId === 'word-list-view') updateMascot("Here are the words for your revision.");
            if (viewId === 'grammar-tense-list-view') { updateMascot("Pick a tense to revise!"); renderTenseGrid(); }
            if (viewId === 'error-book-view') { updateMascot("These are the words to try again."); renderErrorBook(); }
            if (viewId === 'profile-view') { updateMascot("Your LearniTY profile — keep the flame alive!"); loadProfile(); }
            if (viewId === 'quiz-view') updateMascot(quizMode === 'listening' ? "Listen carefully! Type the word I say." : "Look at the Chinese meaning and recall the word.");
            if (viewId === 'my-records-view') { updateMascot("Here are your records from the cloud."); loadCloudRecords(); }
            if (viewId === 'leaderboard-view') { updateMascot("See who's on top!"); loadLeaderboard(lbModeFilter); }
            if (viewId === 'admin-view') {
                updateMascot("Admin dashboard — student usage overview.");
                ensureFormDirectory(true).then(() => {
                    const view = document.getElementById('admin-view');
                    if (!view || view.classList.contains('hidden')) return;
                    loadAdminDashboard();
                    loadGrammarAdmin('all');
                    loadDriveAndGoAdmin();
                    loadLoginAdmin();
                    loadGuestAdmin();
                    loadBattleAdmin();
                    loadWordJumpAdmin();
                });
            }
            if (viewId === 'battle-view') { updateMascot("Word Battle! Create a room or join with a code."); battleEnter(); }
            if (viewId === 'wordjump-view') {
                updateMascot("Jump, spell, climb — how high can you go?");
                const back = document.getElementById('wj-back-label');
                if (back) back.innerText = (typeof WJ !== 'undefined' && WJ.backView === 'battle-view') ? 'Back to Word Battle' : 'Back to Hub';
                if (sheetCategoriesReady) { /* topics already in memory */ }
                else if (!sheetCategoriesLoading) loadAllCategoriesFromSheet();
                requestAnimationFrame(() => WJ.mount());
            }
        }

        window.onload = () => {
            loadAllCategoriesFromSheet();
            loadIfClauseData();
            loadPCData();
        };

/* LearniTY — the "Me" profile page.
   Shows the daily streak, repair cards, dictation attempts / average accuracy,
   personal-best Word Jump run and the first day the student joined.
   Signed-in students read cloud records; guests and teacher previews read the
   current browser session only. Loaded after shared.js, before word-jump.js. */

function profileHistorySource() {
    if (isGuestUser()) {
        return { store: sessionStorage, key: 'dict_history_guest', note: 'Guest stats stay in this browser session and never enter a leaderboard.' };
    }
    const form = previewStudentForm();
    if (form) {
        return { store: sessionStorage, key: 'dict_history:preview:' + form, note: 'Preview only — these numbers are not written to the student account.' };
    }
    return null;
}

function profilePointsLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const rounded = Math.round(n * 10) / 10;
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + ' pts';
}

function profilePercentLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Math.round(n * 100) + '%';
}

function profileLocalDictStats() {
    const src = profileHistorySource();
    if (!src) return null;
    let rows = [];
    try { rows = JSON.parse(src.store.getItem(src.key) || '[]'); } catch (e) {}
    if (!Array.isArray(rows)) rows = [];
    const valid = rows.filter(r => r && Number.isFinite(Number(r.score)));
    const accRows = rows.filter(r => r && r.correct != null && r.correct !== '' && Number(r.total) > 0 && Number.isFinite(Number(r.correct)));
    const sumCorrect = accRows.reduce((a, r) => a + Number(r.correct), 0);
    const sumTotal = accRows.reduce((a, r) => a + Number(r.total), 0);
    return {
        attempts: valid.length,
        accuracy: sumTotal > 0 ? (sumCorrect / sumTotal) : null,
        accuracyCount: accRows.length,
        sampled: valid.length,
        total: valid.length,
        note: src.note
    };
}

async function profileCloudDictStats() {
    if (!currentUser) return null;
    const base = 'score,total,created_at';
    let res = await sb.from('dictation_results')
        .select('correct,' + base, { count: 'exact' })
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(1000);
    let accuracyUnavailable = false;
    if (res.error && /correct|column .* does not exist|42703|PGRST204/i.test(String(res.error.message || ''))) {
        accuracyUnavailable = true;
        res = await sb.from('dictation_results')
            .select(base, { count: 'exact' })
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(1000);
    }
    if (res.error) throw res.error;
    const rows = Array.isArray(res.data) ? res.data : [];
    const total = (typeof res.count === 'number') ? res.count : rows.length;
    const accRows = accuracyUnavailable ? [] : rows.filter(r => r && r.correct != null && r.correct !== '' && Number(r.total) > 0 && Number.isFinite(Number(r.correct)));
    const sumCorrect = accRows.reduce((a, r) => a + Number(r.correct), 0);
    const sumTotal = accRows.reduce((a, r) => a + Number(r.total), 0);
    return {
        attempts: total,
        accuracy: (!accuracyUnavailable && sumTotal > 0) ? (sumCorrect / sumTotal) : null,
        accuracyCount: accRows.length,
        accuracyUnavailable: accuracyUnavailable,
        sampled: rows.length,
        total: total
    };
}

function profileLocalWjBest() {
    const store = isGuestUser() ? sessionStorage : localStorage;
    const best = Number(store.getItem('wj_best') || 0);
    return best > 0 ? { score: best, words: 0 } : null;
}

async function profileCloudWjBest() {
    if (!currentUser) return null;
    try {
        const { data, error } = await sb.from('wj_leaderboard')
            .select('score,height,words')
            .eq('user_id', currentUser.id)
            .maybeSingle();
        if (!error && data) return data;
    } catch (e) {}
    try {
        const { data, error } = await sb.from('wj_scores')
            .select('score,height,words')
            .eq('user_id', currentUser.id)
            .order('score', { ascending: false })
            .limit(1);
        if (!error && data && data[0]) return data[0];
    } catch (e) {}
    return null;
}

function profileRenderDots(snap) {
    const box = document.getElementById('profile-dots');
    if (!box) return;
    const set = new Set(Array.isArray(snap.recentDays) ? snap.recentDays : []);
    const today = hkDayKey(new Date().toISOString());
    const days = [];
    for (let i = 6; i >= 0; i--) {
        days.push(hkDayKey(new Date(Date.now() - i * 86400000).toISOString()));
    }
    box.innerHTML = days.map(day => {
        const on = set.has(day);
        const label = new Date(day + 'T12:00:00+08:00')
            .toLocaleDateString('en-HK', { weekday: 'short', timeZone: 'Asia/Hong_Kong' })
            .slice(0, 1);
        return `<span class="profile-dot-cell" title="${day}${on ? ' — practised' : ' — no practice'}">
            <span class="profile-dot ${on ? 'on' : ''} ${day === today ? 'today' : ''}" aria-hidden="true"></span>
            <span class="profile-dot-label">${label}</span>
        </span>`;
    }).join('');
    const count = days.filter(day => set.has(day)).length;
    const summary = document.getElementById('profile-dots-summary');
    if (summary) summary.innerText = count + ' / 7 days';
    box.setAttribute('aria-label', count + ' of the last 7 days practised');
}

function profileRenderStreak() {
    const snap = streakSnapshot();
    const count = document.getElementById('profile-streak');
    const unit = document.getElementById('profile-streak-unit');
    const cards = document.getElementById('profile-cards');
    const best = document.getElementById('profile-best');
    const note = document.getElementById('profile-streak-note');
    const first = document.getElementById('profile-first');
    if (count) count.innerText = String(snap.count);
    if (unit) unit.innerText = 'day streak';
    if (cards) cards.innerText = String(snap.cards);
    if (best) best.innerText = String(Math.max(snap.best, snap.count));
    if (first) first.innerText = snap.firstSeen ? hkDateOnly(snap.firstSeen) : 'Not yet';
    profileRenderDots(snap);
    if (!note) return;
    if (!snap.count) {
        note.innerText = 'Finish any practice today to light your flame.';
    } else if (snap.pendingRepair) {
        note.innerText = 'Your flame is waiting — finish a practice today to spend ' +
            snap.pendingRepair + ' repair card' + (snap.pendingRepair === 1 ? '' : 's') + '.';
    } else if (snap.practicedToday) {
        note.innerText = 'Done for today — come back tomorrow to grow it.';
    } else {
        note.innerText = 'Finish a practice today to keep it alive.';
    }
}

function profileRenderIdentity() {
    const name = document.getElementById('profile-name');
    const sub = document.getElementById('profile-sub');
    const recordsBtn = document.getElementById('profile-records-btn');
    const lbBtn = document.getElementById('profile-lb-btn');
    if (isGuestUser()) {
        if (name) name.innerText = 'Guest';
        if (sub) sub.innerText = 'Guest session';
    } else if (previewStudentForm()) {
        if (name) name.innerText = 'Preview · ' + previewStudentForm();
        if (sub) sub.innerText = 'Student account preview';
    } else if (currentUser) {
        const full = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
        if (name) name.innerText = full;
        if (sub) sub.innerText = currentUser.email;
    } else {
        if (name) name.innerText = 'Your profile';
        if (sub) sub.innerText = '';
    }
    const hide = isGuestUser();
    if (recordsBtn) recordsBtn.classList.toggle('hidden', hide);
    if (lbBtn) lbBtn.classList.toggle('hidden', hide);
}

function profileRenderDict(stats, fallbackNote) {
    const countEl = document.getElementById('profile-dict-count');
    const avgEl = document.getElementById('profile-dict-avg');
    if (countEl) countEl.innerText = stats ? String(stats.attempts) : '—';
    if (avgEl) avgEl.innerText = stats && stats.accuracy != null ? profilePercentLabel(stats.accuracy) : '—';
    if (!stats) return fallbackNote || '';
    if (stats.accuracyUnavailable) {
        return 'Run supabase/dictation_accuracy.sql to enable average accuracy.';
    }
    if (stats.attempts > 0 && !stats.accuracyCount) {
        return 'Accuracy starts from new quizzes; older quizzes did not record correct answers.';
    }
    if (stats.accuracyCount > 0 && stats.accuracyCount < stats.attempts) {
        return 'Accuracy uses ' + stats.accuracyCount + ' of ' + stats.attempts + ' quizzes; older quizzes did not record correct answers.';
    }
    if (stats.sampled && stats.total && stats.sampled < stats.total) {
        return 'Accuracy is based on the latest ' + stats.sampled + ' quizzes.';
    }
    return fallbackNote || '';
}

function profileRenderWj(best) {
    const el = document.getElementById('profile-wj-best');
    if (!el) return;
    if (!best || !(Number(best.score) > 0)) {
        el.innerText = '—';
        el.removeAttribute('title');
        return;
    }
    el.innerText = profilePointsLabel(best.score);
    const bits = [];
    if (Number(best.words) > 0) bits.push(Number(best.words) + ' words');
    if (Number(best.height) > 0) bits.push('height ' + Math.round(Number(best.height)));
    el.title = bits.length ? bits.join(' · ') : '';
}

/* ---------------- friends / following / friend streaks ----------------
   Follows are directional; a mutual pair is a "friend". Friend streaks are
   written only by the security-definer bump_friend_streaks() RPC in
   supabase/friends.sql. Guests and teacher previews never see this card. */

let profileFriendId = '';
let profileFriendRow = null;
let profileFriendList = [];

function profileFriendsAvailable() {
    return canUseCloud() && !previewStudentForm() && !isGuestUser();
}

function profileFriendStreakText(row) {
    if (!row || !row.mutual) return '';
    const n = Number(row.friend_streak) || 0;
    return n > 0 ? ' · 💛🔥 ' + n : '';
}

function profileFriendRowHTML(row) {
    const form = row.form ? formLabel(normalizeForm(row.form)) : 'Unassigned';
    const practice = row.mutual && row.practiced_today != null
        ? (row.practiced_today ? ' · ✅ today' : ' · ⏳ not yet today')
        : '';
    return '<button type="button" class="friend-row" onclick="openFriendProfile(\'' + escapeHtml(row.user_id) + '\')">' +
        '<span class="friend-avatar" aria-hidden="true">🐱</span>' +
        '<span class="min-w-0 flex-1 text-left">' +
        '<span class="block font-bold text-gray-700 truncate">' + escapeHtml(row.nickname || 'Student') + '</span>' +
        '<span class="block text-xs text-gray-400 truncate">' + escapeHtml(form) + practice + profileFriendStreakText(row) + '</span>' +
        '</span>' +
        '<span class="text-xs font-bold text-orange-600">View →</span>' +
        '</button>';
}

function profileRenderFriendChrome(friend) {
    const card = document.getElementById('profile-friends-card');
    const own = document.getElementById('profile-own-actions');
    const back = document.getElementById('profile-friend-back');
    const follow = document.getElementById('profile-follow-btn');
    const banner = document.getElementById('profile-friend-banner');
    const cardsLabel = document.getElementById('profile-cards-label');
    // The Friends card and the personal action buttons are for your own
    // profile only; the back / follow / friend-streak controls only appear
    // while visiting someone else.
    if (card) card.classList.toggle('hidden', friend || !profileFriendsAvailable());
    if (own) own.classList.toggle('hidden', friend);
    if (back) back.classList.toggle('hidden', !friend);
    if (follow) follow.classList.toggle('hidden', !friend);
    if (banner) banner.classList.toggle('hidden', !friend);
    if (cardsLabel) cardsLabel.innerText = friend ? 'Friend streak' : 'Repair cards';
    // The achievement list belongs to the profile currently open. Hide the
    // old friend list while the own profile reloads it.
    const achCard = document.getElementById('profile-achievements-card');
    if (achCard && !friend) achCard.classList.add('hidden');
}

function profileShowOwn() {
    profileFriendId = '';
    profileFriendRow = null;
    if (currentView === 'profile-view') loadProfile();
    else changeView('profile-view');
}

function openFriendProfile(userId) {
    if (!userId || !profileFriendsAvailable()) return;
    profileFriendId = String(userId);
    profileFriendRow = null;
    changeView('profile-view');
}

function profileFriendInitial(name) {
    return String(name || 'S').trim().slice(0, 1).toUpperCase() || 'S';
}

function profileRenderFriendBanner(row) {
    const el = document.getElementById('profile-friend-banner');
    if (!el) return;
    if (!row) { el.innerText = ''; return; }
    if (!row.mutual) {
        el.innerText = 'Follow each other to become friends and start a friend streak.';
        return;
    }
    const n = Number(row.friend_streak) || 0;
    const best = Number(row.friend_best) || 0;
    el.innerText = n > 0
        ? '💛 ' + n + '-day friend streak with you' + (best > n ? ' · best ' + best : '')
        : '💛 You are friends — practise on the same day to light the friend flame.';
}

function profileRenderFollowButton(row) {
    const btn = document.getElementById('profile-follow-btn');
    if (!btn) return;
    if (!row) { btn.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
    btn.innerText = row.following ? '✅ Following' : '➕ Follow';
    btn.style.background = row.following ? '#059669' : '#f97316';
    btn.setAttribute('aria-pressed', row.following ? 'true' : 'false');
}

async function loadFriendProfile(userId) {
    profileRenderFriendChrome(true);
    profileRenderFollowButton(null);
    profileRenderFriendBanner(null);
    const nameEl = document.getElementById('profile-name');
    const subEl = document.getElementById('profile-sub');
    if (nameEl) nameEl.innerText = 'Friend';
    if (subEl) subEl.innerText = 'Loading profile…';
    const noteEl = document.getElementById('profile-note');
    if (!profileFriendsAvailable()) {
        if (noteEl) noteEl.innerText = 'Friends need a school Google account.';
        return;
    }
    let row = null;
    try {
        const { data, error } = await sb.rpc('friend_public_profile', { p_user_id: userId });
        if (error) throw error;
        row = Array.isArray(data) ? data[0] : data;
    } catch (e) {
        if (nameEl) nameEl.innerText = 'Friend profile';
        if (subEl) subEl.innerText = 'Unavailable';
        if (noteEl) noteEl.innerText = 'Run supabase/friends.sql in the Supabase SQL editor to enable friend profiles.';
        return;
    }
    if (!row) {
        if (nameEl) nameEl.innerText = 'Profile not found';
        if (subEl) subEl.innerText = '';
        if (noteEl) noteEl.innerText = 'That student profile is no longer available.';
        return;
    }
    row.mutual = !!(row.following && row.follows_me);
    profileFriendRow = row;
    if (nameEl) nameEl.innerText = row.nickname || 'Student';
    if (subEl) subEl.innerText = (row.form ? formLabel(normalizeForm(row.form)) : 'Unassigned') + ' · friend profile';
    const streakEl = document.getElementById('profile-streak');
    const unitEl = document.getElementById('profile-streak-unit');
    const streakNoteEl = document.getElementById('profile-streak-note');
    const bestEl = document.getElementById('profile-best');
    const cardsEl = document.getElementById('profile-cards');
    const dictEl = document.getElementById('profile-dict-count');
    const avgEl = document.getElementById('profile-dict-avg');
    const firstEl = document.getElementById('profile-first');
    if (streakEl) streakEl.innerText = String(Number(row.streak_count) || 0);
    if (unitEl) unitEl.innerText = 'day streak';
    if (streakNoteEl) streakNoteEl.innerText = 'Their current daily practice streak.';
    if (bestEl) bestEl.innerText = String(Number(row.streak_best) || 0);
    if (cardsEl) cardsEl.innerText = row.mutual ? String(Number(row.friend_streak) || 0) + ' days' : '—';
    if (dictEl) dictEl.innerText = row.dict_count == null ? '—' : String(Number(row.dict_count) || 0);
    if (avgEl) avgEl.innerText = row.dict_accuracy == null ? '—' : profilePercentLabel(Number(row.dict_accuracy));
    if (firstEl) firstEl.innerText = row.first_seen ? hkDateOnly(row.first_seen) : 'Not yet';
    profileRenderDots({ recentDays: Array.isArray(row.recent_days) ? row.recent_days : [] });
    profileRenderWj(row.wj_best ? { score: Number(row.wj_best) } : null);
    profileRenderFriendBanner(row);
    profileRenderFollowButton(row);
    loadAchievements(row.user_id, false);
    if (noteEl) {
        noteEl.innerText = 'You are viewing ' + (row.nickname || 'this student') +
            '\u2019s shared practice stats.' +
            (row.follows_me && !row.following ? ' They follow you — follow back to become friends.' : '') +
            (row.follows_me && row.following ? ' You are friends.' : '');
    }
}

async function profileLoadFriends() {
    const card = document.getElementById('profile-friends-card');
    if (!card) return;
    if (!profileFriendsAvailable()) {
        card.classList.add('hidden');
        return;
    }
    card.classList.remove('hidden');
    const listEl = document.getElementById('profile-friend-list');
    const countsEl = document.getElementById('profile-friend-counts');
    const noteEl = document.getElementById('profile-friend-note');
    if (listEl) listEl.innerHTML = '<p class="text-sm font-bold text-gray-400 py-2">Loading friends…</p>';
    // Best-effort: if both of you practised today, grow the shared flame.
    try { sb.rpc('bump_friend_streaks').then(() => {}, () => {}); } catch (e) {}
    let rows = [];
    try {
        const { data, error } = await sb.rpc('friend_overview');
        if (error) throw error;
        rows = Array.isArray(data) ? data : (data ? [data] : []);
    } catch (e) {
        profileFriendList = [];
        if (listEl) listEl.innerHTML = '';
        if (countsEl) countsEl.innerText = '';
        if (noteEl) noteEl.innerText = 'Run supabase/friends.sql in the Supabase SQL editor to enable friends.';
        return;
    }
    profileFriendList = rows;
    const friends = rows.filter(r => r.mutual);
    const following = rows.filter(r => r.following && !r.mutual);
    const followers = rows.filter(r => r.follows_me && !r.following);
    if (countsEl) {
        const waiting = friends.filter(r => r.practiced_today === false).length;
        countsEl.innerText = friends.length + ' friend' + (friends.length === 1 ? '' : 's') +
            ' · ' + following.length + ' following · ' + followers.length + ' follower' + (followers.length === 1 ? '' : 's') +
            (waiting ? ' · ⏳ ' + waiting + ' not practised today' : '');
    }
    const section = (title, list, empty) => {
        if (!list.length) return empty ? '<p class="text-xs font-bold text-gray-400 mt-2">' + empty + '</p>' : '';
        return '<p class="text-xs font-bold uppercase tracking-wide text-gray-400 mt-3 mb-1">' + title + '</p>' +
            list.map(profileFriendRowHTML).join('');
    };
    if (listEl) {
        listEl.innerHTML =
            section('Friends', friends.sort((a, b) => (Number(b.friend_streak) || 0) - (Number(a.friend_streak) || 0)), '') +
            section('You follow', following, '') +
            section('Follows you', followers, '') +
            (!rows.length ? '<p class="text-sm font-bold text-gray-400 py-3">No friends yet. Add a classmate by school email above.</p>' : '');
    }
    if (noteEl) noteEl.innerText = 'A friend streak grows when both of you finish a practice on the same Hong Kong day.';
}

async function profileAddFriend() {
    const input = document.getElementById('friend-email');
    const status = document.getElementById('friend-add-status');
    const email = String((input && input.value) || '').trim();
    const say = (text, bad) => {
        if (!status) return;
        status.innerText = text;
        status.classList.remove('hidden');
        status.classList.toggle('text-red-600', !!bad);
        status.classList.toggle('text-emerald-600', !bad);
    };
    if (!profileFriendsAvailable()) { say('Sign in with a school account first.', true); return; }
    if (!email) { say('Type the classmate\u2019s school email.', true); return; }
    if (currentUser && email.toLowerCase() === String(currentUser.email || '').toLowerCase()) {
        say('That is your own email.', true);
        return;
    }
    say('Looking up ' + email + '…', false);
    let found = null;
    try {
        const { data, error } = await sb.rpc('find_friend', { p_email: email });
        if (error) throw error;
        found = Array.isArray(data) ? data[0] : data;
    } catch (e) {
        say('Run supabase/friends.sql in the Supabase SQL editor to enable friends.', true);
        return;
    }
    if (!found) { say('No student with that school email.', true); return; }
    try {
        const { error } = await sb.rpc('follow_friend', { p_user_id: found.user_id });
        if (error) throw error;
    } catch (e) {
        say('Could not add that friend. Please try again.', true);
        return;
    }
    if (input) input.value = '';
    say('Now following ' + (found.nickname || 'that student') + '.', false);
    await profileLoadFriends();
}

async function profileToggleFollow() {
    if (!profileFriendRow || !profileFriendsAvailable()) return;
    const row = profileFriendRow;
    try {
        const { error } = row.following
            ? await sb.rpc('unfollow_friend', { p_user_id: row.user_id })
            : await sb.rpc('follow_friend', { p_user_id: row.user_id });
        if (error) throw error;
    } catch (e) {
        const note = document.getElementById('profile-note');
        if (note) note.innerText = 'Could not update that follow. Please try again.';
        return;
    }
    await loadFriendProfile(row.user_id);
}

/* ---------------- streak achievements + likes ---------------- */

let profileAchievementRows = [];
let profileAchievementOwner = '';
let profileAchievementOwn = true;

function profileAchievementLabel(row) {
    if (!row) return '';
    return row.kind === 'record'
        ? '🏆 Personal best · ' + (Number(row.value) || 0) + ' days'
        : '🏅 ' + (Number(row.value) || 0) + '-day streak';
}

function profileRenderAchievements() {
    const box = document.getElementById('profile-achievements');
    const card = document.getElementById('profile-achievements-card');
    if (!box || !card) return;
    if (!profileFriendsAvailable()) {
        card.classList.add('hidden');
        return;
    }
    card.classList.remove('hidden');
    if (!profileAchievementRows.length) {
        box.innerHTML = '<p class="text-sm font-bold text-gray-400 py-2">No achievements yet — reach a 7-day streak to start.</p>';
        return;
    }
    box.innerHTML = profileAchievementRows.map(row => {
        const own = profileAchievementOwn;
        const date = row.achieved_on ? hkDateOnly(row.achieved_on) : '';
        const like = own
            ? '<span class="ach-likes">❤️ ' + (Number(row.likes) || 0) + '</span>'
            : '<button type="button" class="ach-like' + (row.liked ? ' liked' : '') + '" onclick="toggleAchievementLike(\'' + escapeHtml(row.id) + '\')" aria-pressed="' + (row.liked ? 'true' : 'false') + '">' +
              (row.liked ? '❤️' : '🤍') + ' ' + (Number(row.likes) || 0) + '</button>';
        return '<div class="ach-row"><span class="ach-title">' + escapeHtml(profileAchievementLabel(row)) + '</span>' +
            (date ? '<span class="ach-date">' + escapeHtml(date) + '</span>' : '') + like + '</div>';
    }).join('');
}

async function loadAchievements(userId, own) {
    const card = document.getElementById('profile-achievements-card');
    if (!card) return;
    profileAchievementOwner = userId || '';
    profileAchievementOwn = !!own;
    if (!profileFriendsAvailable() || !userId) {
        card.classList.add('hidden');
        return;
    }
    card.classList.remove('hidden');
    const box = document.getElementById('profile-achievements');
    if (box) box.innerHTML = '<p class="text-sm font-bold text-gray-400 py-2">Loading achievements…</p>';
    try {
        const { data, error } = await sb.rpc('achievement_feed', { p_user_id: userId });
        if (error) throw error;
        profileAchievementRows = Array.isArray(data) ? data : (data ? [data] : []);
    } catch (e) {
        profileAchievementRows = [];
        if (box) box.innerHTML = '<p class="text-sm font-bold text-gray-400 py-2">Run supabase/friends.sql to enable streak achievements.</p>';
        return;
    }
    profileRenderAchievements();
}

async function toggleAchievementLike(id) {
    if (!id || profileAchievementOwn || !profileFriendsAvailable()) return;
    const row = profileAchievementRows.find(r => r.id === id);
    if (!row) return;
    try {
        const { data, error } = await sb.rpc('like_achievement', {
            p_achievement_id: id,
            p_like: !row.liked
        });
        if (error) throw error;
        row.liked = !row.liked;
        row.likes = Math.max(0, Number(data) || 0);
        profileRenderAchievements();
    } catch (e) {
        const box = document.getElementById('profile-achievements');
        if (box) box.innerHTML = '<p class="text-sm font-bold text-gray-400 py-2">Could not update that like. Please try again.</p>';
    }
}

async function loadProfile() {
    if (!document.getElementById('profile-name')) return;
    if (profileFriendId) {
        await loadFriendProfile(profileFriendId);
        return;
    }
    profileRenderFriendChrome(false);
    profileRenderIdentity();
    profileRenderStreak();

    const noteEl = document.getElementById('profile-note');
    let note = isGuestUser()
        ? 'Guest stats stay in this browser session and never enter a leaderboard.'
        : previewStudentForm()
            ? 'Preview only — nothing here is written to a real student account.'
            : 'Streak, quiz totals and Word Jump best follow your school Google account.';

    // Local / session data first, so the page is never blank while cloud loads.
    const localDict = profileLocalDictStats();
    if (localDict) {
        const extra = profileRenderDict(localDict);
        if (extra) note += ' ' + extra;
        profileRenderWj(profileLocalWjBest());
    }

    if (!canUseCloud() || previewStudentForm()) {
        if (noteEl) noteEl.innerText = note;
        return;
    }

    await loadCloudStreak();
    if (currentView !== 'profile-view') return;
    profileRenderStreak();

    const results = await Promise.allSettled([profileCloudDictStats(), profileCloudWjBest()]);
    if (currentView !== 'profile-view') return;
    const dict = results[0].status === 'fulfilled' ? results[0].value : null;
    const wj = results[1].status === 'fulfilled' ? results[1].value : null;

    const extra = profileRenderDict(dict, results[0].status === 'rejected' ? 'Cloud quiz records are unavailable right now.' : '');
    if (extra) note += ' ' + extra;
    profileRenderWj(wj);
    if (noteEl) noteEl.innerText = note;
    profileLoadFriends();
    if (currentUser) {
        recordStreakAchievements(streakSnapshot().best);
        loadAchievements(currentUser.id, true);
    }
}

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

async function loadProfile() {
    if (!document.getElementById('profile-name')) return;
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
}

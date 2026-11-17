/* LearniTY Dictation — Speak Flap (Fluency Master).

   45-second voice game. The student reads a phrase out loud; every word the
   browser's speech-to-text recognises lifts the winged cat. Gates need 75% of
   the phrase, a miss only stuns the cat (never instant game over), and the
   weekly board keeps one personal best per student.

   Everything lives inside this IIFE so it cannot clash with the other feature
   files, which share one global scope (classic scripts, no modules).
   Public surface: window.FLAP = { mount, stop, open, updateNav, state, ... }.
*/
(function () {
    'use strict';

    const el = (id) => document.getElementById('flap-' + id);
    const SCREENS = ['lobby', 'rules', 'mic', 'play', 'result', 'board', 'duel'];

    const W = 400;
    let H = 600;
    const GROUND = 64, BIRD_X = 96, BIRD_R = 13;
    const RUN_SECONDS = 120;
    const STEP = 1 / 120;
    const LIFT_SPEED = 300;
    const LIFT_PER_WORD = 0.75;
    const LIFT_DECAY = 0.3;
    const READ_MIN_RATIO = 0.75;
    /* Early levels forgive more missed words: the ladder is shallow → deep.
       L1 50%, L2 60%, L3 70%, L4 75%. */
    const PASS_RATIOS = [0.5, 0.6, 0.7, READ_MIN_RATIO];
    const PAWS_PER_PHRASE = 3;
    const PAWS_BOARD = 8;
    const PAWS_IMPROVED = 40;
    const WPM_MIN_ACC = 0.8;
    const GRACE_SECONDS = 6;
    const READY_SECONDS = 2.4;

    /* Levels rise with phrases read, not with time. The four phrase pools are
       the 150 Fluency Master sentences split into word-count quartiles, so a
       strong reader reaches the long opinion sentences faster. */
    const LEVELS = [
        { gates: 0, name: 'Level 1 · Warm-up', gap: 250, pts: 20, color: 0 },
        { gates: 3, name: 'Level 2 · Discussion', gap: 250, pts: 40, color: 1 },
        { gates: 6, name: 'Level 3 · Hot Topics', gap: 250, pts: 70, color: 2 },
        { gates: 9, name: 'Level 4 · Deep talk', gap: 250, pts: 100, color: 3 }
    ];

    /* 398px is how far a gate travels while it is the phrase being read.
       Early levels are deliberately slower so the student has time to read. */
    function gateSpeed(wordCount, level) {
        const secs = 1.7 + 0.38 * Math.max(1, wordCount);
        const base = Math.max(58, Math.min(190, 398 / secs));
        const factor = [0.72, 0.82, 0.92, 1][Math.max(0, Math.min(3, Number(level) || 0))];
        return Math.max(40, base * factor);
    }

    const SKY = [
        ['#dbeafe', '#fef9c3'],
        ['#fde68a', '#fdba74'],
        ['#fdba74', '#f472b6'],
        ['#6366f1', '#1e1b4b']
    ];
    const PIPE = [
        ['#4ade80', '#16a34a'],
        ['#34d399', '#059669'],
        ['#f472b6', '#be185d'],
        ['#a78bfa', '#6d28d9']
    ];

    let POOLS = null;

    function countWords(text) {
        return String(text || '').split(/\s+/).filter(Boolean).length;
    }

    /* L1 is a short warm-up bank so the first phrases are only a few words.
       L2 is Discussion Phrases (shortest half), L3 is Hot Topics (shortest
       half), and L4 is the longer half of both banks. */
    function buildPools() {
        if (POOLS) return POOLS;
        const phrases = [];
        const topics = [];
        const warm = [];
        const pull = (bank, target) => {
            try {
                const data = (typeof FLUENCY_DATA !== 'undefined') ? FLUENCY_DATA : null;
                const groups = (data && data[bank] && data[bank].groups) || [];
                groups.forEach((group) => {
                    (group.lines || []).forEach((line) => {
                        if (line && line.en) target.push(String(line.en).trim());
                    });
                });
            } catch (err) {
                console.warn('Speak Flap: FLUENCY_DATA unavailable', err);
            }
        };
        pull('phrases', phrases);
        pull('topics', topics);
        try {
            const data = (typeof FLUENCY_DATA !== 'undefined') ? FLUENCY_DATA : null;
            (data && data.warmup ? data.warmup : []).forEach((s) => {
                if (s) warm.push(String(s).trim());
            });
        } catch (err) { /* ignore */ }
        if (!phrases.length && !topics.length) {
            phrases.push('I agree with this point of view.');
            phrases.push('We should weigh the pros and cons before deciding.');
        }
        if (!phrases.length) phrases.push(...topics);
        if (!topics.length) topics.push(...phrases);

        const byLength = (a, b) => countWords(a) - countWords(b) || a.localeCompare(b);
        const p = phrases.slice().sort(byLength);
        const t = topics.slice().sort(byLength);
        if (warm.length < 4) warm.push(...p.slice(0, 8));
        const w = warm.sort(byLength);
        const pHalf = Math.ceil(p.length / 2);
        const tHalf = Math.ceil(t.length / 2);
        POOLS = [
            w,
            p.slice(0, pHalf),
            t.slice(0, tHalf),
            p.slice(pHalf).concat(t.slice(tHalf)).sort(byLength)
        ];
        const all = phrases.concat(topics).sort(byLength);
        POOLS.forEach((pool, i) => { if (!pool.length) POOLS[i] = all.slice(); });
        return POOLS;
    }

    /* ---------------- storage scope ---------------- */
    function scopeKey() {
        if (typeof isGuestUser === 'function' && isGuestUser()) return 'guest';
        if (typeof previewStudentForm === 'function' && previewStudentForm()) {
            return 'preview:' + previewStudentForm();
        }
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) {
            return 'user:' + currentUser.id;
        }
        return 'guest';
    }

    function store() {
        if (/^guest$/.test(scopeKey()) || /^preview:/.test(scopeKey())) {
            try { return sessionStorage; } catch (e) { return null; }
        }
        try { return localStorage; } catch (e) { return null; }
    }

    const BEST_PREFIX = 'learniTY_flap_best:';
    const RUNS_PREFIX = 'learniTY_flap_runs:';

    function readBest() {
        const s = store();
        if (!s) return 0;
        const n = parseInt(s.getItem(BEST_PREFIX + scopeKey()) || '0', 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function writeBest(score) {
        const s = store();
        if (!s) return false;
        const cur = readBest();
        if (score <= cur) return false;
        try { s.setItem(BEST_PREFIX + scopeKey(), String(score)); } catch (e) { return false; }
        return true;
    }

    function readRuns() {
        const s = store();
        if (!s) return [];
        try {
            const rows = JSON.parse(s.getItem(RUNS_PREFIX + scopeKey()) || '[]');
            return Array.isArray(rows) ? rows : [];
        } catch (e) { return []; }
    }

    function pushRun(score) {
        const s = store();
        if (!s) return;
        const day = (typeof hkDayKey === 'function') ? hkDayKey(new Date().toISOString()) : new Date().toISOString().slice(0, 10);
        const rows = readRuns();
        rows.push({ d: day, s: Math.max(0, Math.round(score)) });
        while (rows.length > 120) rows.shift();
        try { s.setItem(RUNS_PREFIX + scopeKey(), JSON.stringify(rows)); } catch (e) { /* ignore */ }
    }

    function shiftDay(dayKey, delta) {
        const parts = String(dayKey).split('-').map(Number);
        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        d.setUTCDate(d.getUTCDate() + delta);
        return d.toISOString().slice(0, 10);
    }

    function hkToday() {
        return (typeof hkDayKey === 'function') ? hkDayKey(new Date().toISOString()) : new Date().toISOString().slice(0, 10);
    }

    /* Monday 00:00 HKT is the weekly reset. */
    function weekStartKey() {
        const parts = hkToday().split('-').map(Number);
        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        const offset = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - offset);
        return d.toISOString().slice(0, 10);
    }

    function fmt(n) {
        return Number(n || 0).toLocaleString('en-US');
    }

    function clock(sec) {
        const s = Math.max(0, Math.ceil(Number(sec) || 0));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function canUseCloudBoard() {
        if (typeof canUseCloud === 'function' && !canUseCloud()) return false;
        if (typeof currentUser === 'undefined' || !currentUser || !currentUser.id) return false;
        if (typeof isGuestUser === 'function' && isGuestUser()) return false;
        if (typeof previewStudentForm === 'function' && previewStudentForm()) return false;
        return typeof sb !== 'undefined' && !!sb;
    }

    /* Guests must never see a leaderboard (app-wide rule), so the board is
       hidden for them even though the view itself is allowed. */
    function isGuestMode() {
        if (typeof isGuestUser === 'function' && isGuestUser()) return true;
        return typeof previewStudentForm === 'function' && !!previewStudentForm();
    }

    /* ---------------- state ---------------- */
    const FLAP = {
        tap: false,
        ranked: true,
        running: false,
        paused: false,
        started: false,
        mounted: false,
        micOn: false,
        stream: null,
        audioCtx: null,
        analyser: null,
        buf: null,
        micRaf: 0,
        micToken: 0,
        micMeterOn: false,
        asr: null,
        noiseFloor: -60,
        threshold: -45,
        levelIndex: 0,
        t: 0,
        hearts: 5,
        score: 0,
        gatesFlown: 0,
        gatesPassed: 0,
        gold: 0,
        elapsed: 0,
        voicedMs: 0,
        longest: 0,
        runSec: 0,
        pauses: 0,
        quietSec: 0,
        pauseCounted: false,
        inv: 0,
        lift: 0,
        stun: 0,
        hold: 0,
        bounce: 0,
        pull: 0,
        silentWarned: false,
        heard: [],
        readGate: null,
        wordsRead: 0,
        wordsShown: 0,
        accWords: 0,
        accHits: 0,
        wordMisses: {},
        streak: 0,
        bestStreak: 0,
        ghostPassed: false,
        fireworks: [],
        paws: 0,
        boardBonus: 0,
        improvedBonus: 0,
        mood: 'happy',
        autoRead: false,
        autoClock: 0,
        chipSig: '',
        bird: { y: H / 2, vy: 0, rot: 0 },
        gates: [],
        popups: [],
        lastGateX: W + 100,
        transcript: '',
        heardSig: '',
        asrOk: false,
        words: 0,
        fillers: 0,
        lastVoicedAt: -9,
        missed: [],
        raf: 0,
        last: 0,
        acc: 0,
        tapHeld: false,
        ready: READY_SECONDS,
        readyLabel: '',
        lastScore: 0,
        best: 0,
        bestStreakEver: 0,
        cloud: { status: 'unknown', rows: [], week: '', improved: [], error: '', submitted: false, rank: 0 },
        duel: {
            status: 'unknown',
            loading: false,
            list: [],
            created: null,
            active: null,
            playing: false,
            settling: false,
            result: null,
            error: ''
        },
        lastPhrases: 0,
        lastRankedScore: 0,
        lastRankedPhrases: 0,
        fsCss: false,
        fsPending: 0,
        resultCatRaf: 0,
        resultCatT: 0,
        toastTimer: 0,
        lastPhrase: ''
    };

    /* ---------------- screens ---------------- */
    let current = 'lobby';
    let bound = false;

    function show(name) {
        if (SCREENS.indexOf(name) === -1) name = 'lobby';
        if ((name === 'board' || name === 'duel') && isGuestMode()) {
            name = 'lobby';
            if (typeof updateMascot === 'function') updateMascot('Leaderboards and challenges are hidden in guest mode.');
        }
        current = name;
        SCREENS.forEach((n) => {
            const node = el('s-' + n);
            if (node) node.classList.toggle('on', n === name);
        });
        const content = document.getElementById('fluency-flap-content');
        if (content) content.classList.toggle('flap-live', name === 'play');
        FLAP.paused = false;
        const pause = el('pause');
        if (pause) pause.classList.remove('on');
        if (name !== 'play' && FLAP.running) stopRun();
        if (name === 'mic') openMic();
        if (name === 'lobby' || name === 'board') closeMic();
        if (name === 'board') {
            renderBoard();
            refreshCloud();
        }
        if (name === 'duel') {
            renderDuel();
            loadChallenges();
        }
        if (name === 'result') startResultCat(); else stopResultCat();
        if (name === 'lobby') renderLobby();
        if (name === 'mic') renderMicDuel();
        const view = document.getElementById('fluency-flap-view');
        if (view) view.classList.toggle('flap-playing', name === 'play');
        syncFsUi();
        if (name !== 'play') {
            /* Keep the controls above the fold without yanking the page while
               the student is reading a phrase. */
            try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
        }
    }

    function updateNav() {
        if (typeof updateBottomNav === 'function') updateBottomNav();
    }

    /* ---------------- full screen ---------------- */
    function fsTarget() {
        return document.getElementById('fluency-flap-content');
    }

    function nativeFsOn() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    function fsOn() {
        return nativeFsOn() || document.body.classList.contains('flap-fs');
    }

    function syncFsUi() {
        const on = fsOn();
        const play = el('fs-btn');
        if (play) {
            play.textContent = on ? '✕' : '⛶';
            play.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
        }
        const lobby = el('fs-lobby');
        if (lobby) lobby.textContent = on ? '✕ Exit full screen' : '⛶ Full screen';
        const result = el('r-fs');
        if (result) result.textContent = on ? '✕ Exit full screen' : '⛶ Full screen';
        window.navFlapPlaying = (current === 'play' && !FLAP.paused) || on;
        updateNav();
    }

    function enterCssFs() {
        FLAP.fsPending = (FLAP.fsPending || 0) + 1;
        document.body.classList.add('flap-fs');
        FLAP.fsCss = true;
        syncFsUi();
        fitWorld();
        if (current === 'play') draw();
    }

    function exitFs() {
        FLAP.fsPending = (FLAP.fsPending || 0) + 1;
        FLAP.fsCss = false;
        document.body.classList.remove('flap-fs');
        try {
            if (nativeFsOn()) {
                if (typeof document.exitFullscreen === 'function') {
                    const p = document.exitFullscreen();
                    if (p && p.catch) p.catch(() => {});
                } else if (typeof document.webkitExitFullscreen === 'function') {
                    document.webkitExitFullscreen();
                }
            }
        } catch (e) { /* ignore */ }
        syncFsUi();
        fitWorld();
        if (current === 'play') draw();
    }

    async function toggleFs() {
        if (fsOn()) {
            exitFs();
            return;
        }
        const target = fsTarget();
        if (!target) return;
        FLAP.fsPending = (FLAP.fsPending || 0) + 1;
        const token = FLAP.fsPending;
        /* Some browsers (notably iPhone Safari) either reject, hang or
           silently ignore requestFullscreen. Fall back to a CSS full screen
           if native full screen has not appeared in 600ms. */
        setTimeout(() => {
            if (token === FLAP.fsPending && !fsOn()) enterCssFs();
        }, 600);
        try {
            if (typeof target.requestFullscreen === 'function') {
                const p = target.requestFullscreen({ navigationUI: 'hide' });
                if (p && p.then) {
                    p.then(() => {
                        if (token === FLAP.fsPending && fsOn()) {
                            fitWorld();
                            syncFsUi();
                            if (current === 'play') draw();
                        }
                    }).catch(() => {});
                }
                return;
            }
            if (typeof target.webkitRequestFullscreen === 'function') {
                target.webkitRequestFullscreen();
                return;
            }
        } catch (e) { /* the timer will use the CSS fallback */ }
    }

    function onFsChange() {
        if (nativeFsOn()) document.body.classList.remove('flap-fs');
        fitWorld();
        syncFsUi();
        if (current === 'play') draw();
    }

    /* ---------------- mic ---------------- */
    async function openMic() {
        const fill = el('micfill');
        const state = el('micstate');
        const floor = el('micfloor');
        const samples = [];
        const token = (FLAP.micToken = (FLAP.micToken || 0) + 1);
        try {
            if (!FLAP.stream) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
                });
                if (token !== FLAP.micToken) {
                    try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
                    return false;
                }
                FLAP.stream = stream;
            }
            if (!FLAP.audioCtx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                FLAP.audioCtx = new AC();
            }
            if (token !== FLAP.micToken) return false;
            if (FLAP.audioCtx.state === 'suspended') await FLAP.audioCtx.resume();
            if (token !== FLAP.micToken) return false;
            const src = FLAP.audioCtx.createMediaStreamSource(FLAP.stream);
            FLAP.analyser = FLAP.audioCtx.createAnalyser();
            FLAP.analyser.fftSize = 1024;
            FLAP.analyser.smoothingTimeConstant = 0.4;
            src.connect(FLAP.analyser);
            FLAP.buf = new Uint8Array(FLAP.analyser.fftSize);
            if (state) {
                state.textContent = 'Listening — say “hello”.';
                state.className = 'flap-mic-state';
            }
            if (floor && !(window.SpeechRecognition || window.webkitSpeechRecognition)) {
                floor.textContent = 'This browser has no speech-to-text — Practice mode still works.';
            }

            const tick = () => {
                if (!FLAP.micMeterOn || token !== FLAP.micToken) return;
                const db = readDb();
                if (fill) fill.style.width = Math.max(0, Math.min(100, (db + 70) * 1.6)) + '%';
                if (samples.length < 90) {
                    if (db > -70) samples.push(db);
                    if (samples.length === 90) {
                        samples.sort((a, b) => a - b);
                        FLAP.noiseFloor = samples[Math.floor(samples.length * 0.5)];
                        FLAP.threshold = Math.max(FLAP.noiseFloor + 8, -45);
                        if (floor) {
                            floor.textContent = 'Noise floor: ' + FLAP.noiseFloor.toFixed(0)
                                + ' dB · trigger at ' + FLAP.threshold.toFixed(0) + ' dB';
                        }
                    }
                }
                if (db > FLAP.threshold && state) {
                    state.textContent = '✅ Good — your voice is coming through.';
                    state.className = 'flap-mic-state ok';
                }
                FLAP.micRaf = requestAnimationFrame(tick);
            };
            cancelAnimationFrame(FLAP.micRaf);
            FLAP.micMeterOn = true;
            tick();
            return true;
        } catch (err) {
            if (token === FLAP.micToken && state) {
                state.textContent = '🎤 No microphone — practice mode still works.';
                state.className = 'flap-mic-state bad';
            }
            if (token === FLAP.micToken && floor) floor.textContent = 'Permission denied or no device found.';
            return false;
        }
    }

    /* Release the actual microphone, not just the level meter. Leaving the run
       or the view must stop the tracks, or the browser keeps the mic open and
       the rest of the app feels laggy. */
    /* Stop only the level-meter loop: the microphone stream stays live during
       a ranked run so the game can measure voice time (and slow the sink). */
    function stopMicMeter() {
        FLAP.micMeterOn = false;
        cancelAnimationFrame(FLAP.micRaf);
        FLAP.micRaf = 0;
    }

    function closeMic() {
        stopMicMeter();
        FLAP.micToken = (FLAP.micToken || 0) + 1;
        FLAP.analyser = null;
        FLAP.buf = null;
        if (FLAP.stream) {
            try { FLAP.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
            FLAP.stream = null;
        }
        if (FLAP.audioCtx) {
            const ctx = FLAP.audioCtx;
            FLAP.audioCtx = null;
            try {
                if (ctx.state !== 'closed' && typeof ctx.close === 'function') {
                    const p = ctx.close();
                    if (p && p.catch) p.catch(() => {});
                }
            } catch (e) { /* ignore */ }
        }
    }

    function readDb() {
        if (!FLAP.analyser || !FLAP.buf) return -100;
        FLAP.analyser.getByteTimeDomainData(FLAP.buf);
        let sum = 0;
        for (let i = 0; i < FLAP.buf.length; i += 1) {
            const v = (FLAP.buf[i] - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / FLAP.buf.length);
        return rms > 0.00001 ? 20 * Math.log10(rms) : -100;
    }

    /* ---------------- speech-to-text ---------------- */
    function startAsr() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        try {
            const asr = new SR();
            FLAP.asr = asr;
            asr.continuous = true;
            asr.interimResults = true;
            try { asr.maxAlternatives = 3; } catch (e) { /* ignore */ }
            asr.lang = 'en-US';
            asr.onresult = (e) => {
                let s = '';
                for (let i = e.resultIndex; i < e.results.length; i += 1) {
                    const result = e.results[i];
                    const top = result[0] ? result[0].transcript : '';
                    s += top + ' ';
                    if (result.isFinal) {
                        FLAP.words += words(top).length;
                        /* Feed the other guesses too — Chrome often hears a
                           near-miss that the phrase matcher can still accept. */
                        for (let k = 1; k < result.length; k += 1) {
                            if (result[k] && result[k].transcript) heardWords(result[k].transcript);
                        }
                    }
                }
                FLAP.transcript = (FLAP.transcript + ' ' + s).slice(-480);
                FLAP.fillers = (FLAP.transcript.toLowerCase().match(/\b(um+|uh+|like|you know)\b/g) || []).length;
                heardWords(s);
            };
            asr.onerror = (e) => {
                FLAP.asrOk = false;
                const code = e && e.error;
                if (code === 'not-allowed' || code === 'service-not-allowed') {
                    FLAP.micOn = false;
                    toast('🎤 Microphone blocked — allow it in the browser, or use Practice mode.');
                } else if (code === 'network') {
                    FLAP.micOn = false;
                    toast('🎤 Speech-to-text is blocked/offline — use Practice mode.');
                }
            };
            asr.onend = () => {
                if (FLAP.running && FLAP.micOn && FLAP.asr === asr) {
                    try { asr.start(); } catch (e) { /* ignore */ }
                }
            };
            asr.start();
            FLAP.asrOk = true;
        } catch (e) {
            FLAP.asrOk = false;
        }
    }

    function stopAsr() {
        const asr = FLAP.asr;
        FLAP.asr = null;
        if (!asr) return;
        try {
            asr.onend = null;
            asr.onerror = null;
            if (typeof asr.abort === 'function') asr.abort();
            else asr.stop();
        } catch (e) { /* ignore */ }
        FLAP.asrOk = false;
    }

    function words(s) {
        return String(s || '').toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
    }

    function editDistance(a, b) {
        if (Math.abs(a.length - b.length) > 2) return 9;
        const m = a.length, n = b.length;
        let prev = new Array(n + 1);
        for (let j = 0; j <= n; j += 1) prev[j] = j;
        for (let i = 1; i <= m; i += 1) {
            const cur = [i];
            for (let j = 1; j <= n; j += 1) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                    prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            prev = cur;
        }
        return prev[n];
    }

    /* ---------------- read-to-fly engine ---------------- */
    function tokensOf(phrase) {
        return String(phrase || '').split(/\s+/).filter(Boolean).map((raw) => {
            const key = (words(raw)[0] || raw.toLowerCase().replace(/[^a-z]/g, ''));
            return { raw: raw.replace(/^[^A-Za-z']+|[^A-Za-z'!?.,]+$/g, ''), key };
        }).filter((t) => t.key);
    }

    function heardWords(text) {
        words(text).forEach((w) => {
            if (FLAP.heard[FLAP.heard.length - 1] !== w) FLAP.heard.push(w);
        });
        if (FLAP.heard.length > 40) FLAP.heard = FLAP.heard.slice(-40);
    }

    function wordMatches(want, said) {
        if (!want || !said) return false;
        if (want === said) return true;
        if (want.length >= 3 && said.length >= 3 && editDistance(want, said) <= 1) return true;
        if (want.length >= 8 && said.length >= 8 && editDistance(want, said) <= 2) return true;
        if (want.length >= 6 && said.length >= 5
            && (want.startsWith(said) || said.startsWith(want))) return true;
        return false;
    }

    function activeReadGate() {
        return FLAP.gates.find((g) => !g.passed && g.x + 58 > BIRD_X - 40) || null;
    }

    function pumpRead() {
        const g = activeReadGate();
        if (!g) return;
        if (FLAP.readGate !== g) {
            FLAP.readGate = g;
            FLAP.chipSig = '';
            FLAP.heard = [];
            FLAP.transcript = '';
            FLAP.heardSig = '';
        }
        while (g.readIdx < g.tokens.length) {
            const want = g.tokens[g.readIdx].key;
            const at = FLAP.heard.findIndex((w) => wordMatches(want, w));
            if (at >= 0) {
                g.tokens[g.readIdx].read = true;
                g.tokens[g.readIdx].wrong = false;
                g.tokens[g.readIdx].near = false;
                g.readIdx += 1;
                g.readCount += 1;
                FLAP.heard.splice(0, at + 1);
                FLAP.lift = Math.min(1.8, FLAP.lift + LIFT_PER_WORD);
                FLAP.wordsRead += 1;
                continue;
            }
            const nextTok = g.tokens[g.readIdx + 1];
            if (nextTok && FLAP.heard.some((w) => wordMatches(nextTok.key, w))) {
                g.tokens[g.readIdx].skipped = true;
                g.readIdx += 1;
                continue;
            }
            const afterNext = g.tokens[g.readIdx + 2];
            if (afterNext && FLAP.heard.some((w) => wordMatches(afterNext.key, w))) {
                g.tokens[g.readIdx].skipped = true;
                g.tokens[g.readIdx + 1].skipped = true;
                g.readIdx += 2;
                continue;
            }
            const third = g.tokens[g.readIdx + 3];
            if (third && FLAP.heard.some((w) => wordMatches(third.key, w))) {
                g.tokens[g.readIdx].skipped = true;
                g.tokens[g.readIdx + 1].skipped = true;
                g.tokens[g.readIdx + 2].skipped = true;
                g.readIdx += 3;
                continue;
            }
            /* Something was heard but it did not match this word: mark it
               orange (read but not accurate). Red is reserved for a wrong
               read after the gate fails. */
            if (FLAP.heard.length && g.tokens[g.readIdx]) g.tokens[g.readIdx].near = true;
            break;
        }
    }

    function renderChips() {
        const g = activeReadGate();
        const host = el('wchips');
        if (!g || !host) return;
        const sig = g.tokens.map((t) => (t.read ? '1' : t.wrong ? 'w' : (t.near || t.skipped) ? 'n' : '0')).join('') + g.readIdx;
        if (sig === FLAP.chipSig) return;
        FLAP.chipSig = sig;
        host.innerHTML = g.tokens.map((t, i) => {
            const cls = t.read ? 'flap-wchip done'
                : t.wrong ? 'flap-wchip miss'
                    : (t.near || t.skipped) ? 'flap-wchip near'
                        : (i === g.readIdx ? 'flap-wchip now' : 'flap-wchip');
            return '<span class="' + cls + '">' + t.raw.replace(/[<>&]/g, '') + '</span>';
        }).join('');
    }

    /* ---------------- run ---------------- */
    function startRun(tapMode) {
        if (FLAP.duel.playing && FLAP.duel.active && (tapMode === true || !FLAP.stream)) {
            if (typeof updateMascot === 'function') {
                updateMascot('A challenge run must be your voice — allow the mic and read out loud.');
            }
            return;
        }
        fitWorld();
        const useTap = tapMode === true || !FLAP.stream;
        show('play');
        if (useTap) closeMic(); else stopMicMeter();
        FLAP.duel.result = null;
        FLAP.tap = useTap;
        FLAP.ranked = !useTap;
        FLAP.started = true;
        FLAP.running = true;
        FLAP.paused = false;
        FLAP.micOn = !useTap;
        FLAP.elapsed = 0;
        FLAP.voicedMs = 0;
        FLAP.longest = 0;
        FLAP.runSec = 0;
        FLAP.pauses = 0;
        FLAP.quietSec = 0;
        FLAP.pauseCounted = false;
        FLAP.hearts = 5;
        FLAP.score = 0;
        FLAP.gatesFlown = 0;
        FLAP.gatesPassed = 0;
        FLAP.gold = 0;
        FLAP.inv = 0;
        FLAP.t = 0;
        FLAP.lift = 0;
        FLAP.pull = 0;
        FLAP.stun = 0;
        FLAP.hold = 0;
        FLAP.bounce = 0;
        FLAP.heard = [];
        FLAP.readGate = null;
        FLAP.wordsRead = 0;
        FLAP.wordsShown = 0;
        FLAP.accWords = 0;
        FLAP.accHits = 0;
        FLAP.wordMisses = {};
        FLAP.streak = 0;
        FLAP.bestStreak = 0;
        FLAP.ghostPassed = false;
        FLAP.fireworks = [];
        FLAP.paws = 0;
        FLAP.boardBonus = 0;
        FLAP.improvedBonus = 0;
        FLAP.mood = 'happy';
        FLAP.autoClock = 0;
        FLAP.chipSig = '';
        FLAP.bird = { y: H / 2, vy: 0, rot: 0 };
        FLAP.gates = [];
        FLAP.popups = [];
        FLAP.lastGateX = W + 80;
        FLAP.transcript = '';
        FLAP.heardSig = '';
        FLAP.silentWarned = false;
        if (el('heard')) el('heard').textContent = 'Listening…';
        FLAP.words = 0;
        FLAP.fillers = 0;
        FLAP.missed = [];
        FLAP.levelIndex = 0;
        FLAP.lastVoicedAt = -9;
        FLAP.last = 0;
        FLAP.acc = 0;
        FLAP.tapHeld = false;
        FLAP.ready = READY_SECONDS;
        FLAP.readyLabel = '';
        FLAP.lastPhrase = '';
        FLAP.best = readBest();
        FLAP.cloud.submitted = false;
        FLAP.cloud.rank = 0;

        const note = el('tapnote');
        if (note) note.style.display = useTap ? 'block' : 'none';
        const saylbl = el('saylbl');
        if (saylbl) {
            saylbl.textContent = useTap
                ? 'PRACTICE MODE · TAP TO FLY · NOT RANKED'
                : 'READ THIS · YOUR VOICE LIFTS YOU';
        }
        const saytext = el('saytext');
        if (saytext) saytext.textContent = 'Get ready…';
        if (el('wchips')) el('wchips').innerHTML = '';
        if (el('lvbadge')) el('lvbadge').textContent = LEVELS[0].name;
        if (el('hearts')) el('hearts').textContent = '❤️❤️❤️❤️❤️';
        if (el('phr')) el('phr').textContent = '0 ✅';
        if (el('timer')) el('timer').textContent = clock(RUN_SECONDS);
        if (el('meterfill')) el('meterfill').style.width = '0%';
        if (el('streakchip')) {
            el('streakchip').classList.remove('on');
            el('streakchip').textContent = '🔥 0';
        }
        updateGhostChip();

        if (useTap) {
            FLAP.asrOk = false;
            stopAsr();
        } else {
            startAsr();
        }

        cancelAnimationFrame(FLAP.raf);
        FLAP.raf = requestAnimationFrame(loop);
    }

    function stopRun() {
        FLAP.running = false;
        FLAP.paused = false;
        cancelAnimationFrame(FLAP.raf);
        FLAP.raf = 0;
        stopAsr();
        closeMic();
    }

    function pauseRun() {
        if (!FLAP.running || FLAP.paused) return;
        FLAP.paused = true;
        cancelAnimationFrame(FLAP.raf);
        FLAP.raf = 0;
        stopAsr();
        closeMic();
        const node = el('pause');
        if (node) node.classList.add('on');
        syncFsUi();
    }

    function resumeRun() {
        if (!FLAP.running || !FLAP.paused) return;
        FLAP.paused = false;
        FLAP.last = 0;
        const node = el('pause');
        if (node) node.classList.remove('on');
        if (!FLAP.tap) {
            openMic().then(() => {
                if (!FLAP.paused && FLAP.running) {
                    stopMicMeter();
                    if (!FLAP.asr) startAsr();
                }
            });
        }
        syncFsUi();
        FLAP.raf = requestAnimationFrame(loop);
    }

    function quitRun() {
        FLAP.duel.playing = false;
        stopRun();
        show('lobby');
    }

    function loop(ts) {
        if (!FLAP.running || FLAP.paused) return;
        if (!FLAP.last) FLAP.last = ts;
        let dt = (ts - FLAP.last) / 1000;
        FLAP.last = ts;
        if (dt > 0.25) dt = 0.25;
        FLAP.acc += dt;
        let steps = 0;
        while (FLAP.acc >= STEP && steps < 60 && FLAP.running) {
            update(STEP);
            FLAP.acc -= STEP;
            steps += 1;
        }
        draw();
        updateHud();
        if (FLAP.running) FLAP.raf = requestAnimationFrame(loop);
    }

    function levelFor(passed) {
        let idx = 0;
        LEVELS.forEach((l, i) => { if (passed >= l.gates) idx = i; });
        return idx;
    }

    function update(dt) {
        if (!FLAP.running) return;
        FLAP.t += dt;

        if (FLAP.ready > 0) {
            FLAP.ready -= dt;
            FLAP.bird.y = H / 2;
            FLAP.bird.vy = 0;
            const label = FLAP.ready > 0.3 ? (Math.ceil(FLAP.ready - 0.3) + '… speak to fly') : 'Go!';
            if (label !== FLAP.readyLabel) {
                FLAP.readyLabel = label;
                if (el('saytext')) el('saytext').textContent = label;
            }
            return;
        }

        FLAP.elapsed += dt;
        if (FLAP.ranked && !FLAP.tap && !FLAP.silentWarned && FLAP.elapsed > 6 && !FLAP.words && !FLAP.transcript) {
            FLAP.silentWarned = true;
            toast('🎤 No words heard yet — speak closer, or use Practice mode.');
        }
        const voiced = FLAP.micOn ? (readDb() > FLAP.threshold) : FLAP.tapHeld;

        if (voiced) {
            FLAP.voicedMs += dt * 1000;
            FLAP.runSec += dt;
            FLAP.longest = Math.max(FLAP.longest, FLAP.runSec);
            FLAP.quietSec = 0;
            FLAP.pauseCounted = false;
            FLAP.lastVoicedAt = FLAP.t;
        } else {
            FLAP.quietSec += dt;
            if (FLAP.quietSec > 0.6) FLAP.runSec = 0;
            if (FLAP.quietSec > 1 && !FLAP.pauseCounted) {
                FLAP.pauses += 1;
                FLAP.pauseCounted = true;
            }
        }

        /* Console-only helper for testing the pipeline without a microphone. */
        if (FLAP.autoRead) {
            FLAP.autoClock -= dt;
            if (FLAP.autoClock <= 0) {
                const ag = activeReadGate();
                const nextTok = ag && ag.tokens[ag.readIdx];
                if (nextTok) {
                    FLAP.heard.push(nextTok.key);
                    FLAP.autoClock = 0.12;
                } else {
                    FLAP.autoClock = 0.18;
                }
            }
        }

        if (FLAP.tap) {
            FLAP.pull = 0;
            if (FLAP.tapHeld) FLAP.lift = Math.min(1.2, FLAP.lift + dt * 3.2);
            FLAP.lift = Math.max(0, FLAP.lift - LIFT_DECAY * dt);
            if (FLAP.lift > 0.04) {
                const target = -LIFT_SPEED * Math.min(1.3, FLAP.lift);
                FLAP.bird.vy += (target - FLAP.bird.vy) * Math.min(1, dt * 9);
            } else {
                FLAP.bird.vy += 1050 * dt;
            }
        } else {
            /* Ranked: reading locks the cat onto the gate opening. The more of
               the phrase that is recognised, the stronger the pull; with
               nothing read the cat sinks. This makes a correct read feel like
               flying cleanly through the pillar instead of floating to the top. */
            pumpRead();
            FLAP.lift = Math.max(0, FLAP.lift - LIFT_DECAY * dt * (voiced ? 0.4 : 1));
            const g = activeReadGate();
            const ratio = g ? (g.readCount / Math.max(1, g.tokens.length)) : 0;
            const need = g ? passRatio(g.level) : 0.5;
            const pull = g ? Math.min(1, ratio / Math.max(0.01, need)) : 0;
            FLAP.pull = pull;
            if (g && pull > 0.05 && FLAP.stun <= 0.15) {
                FLAP.hold = 0;
                const dy = g.gapY - FLAP.bird.y;
                const desired = Math.max(-430, Math.min(430, dy * 8));
                const strength = (0.35 + 0.65 * pull) * (g.rushing ? 1.6 : 1);
                FLAP.bird.vy += (desired * strength - FLAP.bird.vy) * Math.min(1, dt * (g.rushing ? 18 : 12));
            } else if (FLAP.hold > 0) {
                /* Brief hover after a passed gate so the transition to the
                   next phrase cannot cost a life before the student reads. */
                FLAP.hold = Math.max(0, FLAP.hold - dt);
                FLAP.bird.vy += (0 - FLAP.bird.vy) * Math.min(1, dt * 12);
            } else {
                FLAP.bird.vy += 980 * dt * (voiced ? 0.6 : 1);
            }
        }
        FLAP.bird.vy = Math.max(-430, Math.min(560, FLAP.bird.vy));
        FLAP.bird.y += FLAP.bird.vy * dt;
        FLAP.bird.rot = Math.max(-0.5, Math.min(0.85, FLAP.bird.vy / 700));

        if (FLAP.bird.y - BIRD_R < 0) { FLAP.bird.y = BIRD_R; FLAP.bird.vy = 0; }
        if (FLAP.bird.y + BIRD_R > H - GROUND) {
            FLAP.bird.y = H - GROUND - BIRD_R;
            if (FLAP.inv <= 0) hit('ground');
        }

        FLAP.inv = Math.max(0, FLAP.inv - dt);
        FLAP.stun = Math.max(0, FLAP.stun - dt);
        FLAP.bounce = Math.max(0, FLAP.bounce - dt * 55);

        FLAP.gates.forEach((g) => {
            if (g.failFlash > 0) g.failFlash = Math.max(0, g.failFlash - dt);
            /* Finish the whole phrase before the gate arrives: rush it in so the
               next sentence appears immediately (the game is about reading many). */
            if (!g.passed && !g.rushing && g.tokens.length && g.readCount >= g.tokens.length) {
                g.rushing = true;
                g.speed = Math.max(g.speed, 620);
            }
            if (g.frozen > 0) { g.frozen -= dt; return; }
            g.x -= g.speed * dt;
            g.wobble += dt;
        });

        const last = FLAP.gates[FLAP.gates.length - 1];
        const canSpawn = !last
            || (last.passed && last.x < BIRD_X + 40)
            || last.x < -80;
        if (canSpawn && !FLAP.gates.some((g) => g.retrying)) spawnGate();

        for (let i = FLAP.gates.length - 1; i >= 0; i -= 1) {
            const g = FLAP.gates[i];
            if (!g.passed && g.x + 34 < BIRD_X) {
                if (!FLAP.ranked) {
                    g.passed = true;
                    FLAP.gatesFlown += 1;
                } else if (gateAccuracy(g) >= passRatio(g.level)) {
                    g.passed = true;
                    g.retrying = false;
                    FLAP.gatesFlown += 1;
                    scoreGate(g);
                } else if (!g.retrying) {
                    gateFail(g);
                    if (!FLAP.running) return;
                }
            }
            if (!g.hit && !g.passed && !g.retrying && collide(g)) {
                g.hit = true;
                hit('gate');
            }
            if (g.x < -120) FLAP.gates.splice(i, 1);
        }

        if (!FLAP.ghostPassed && FLAP.best > 0 && FLAP.score > FLAP.best) {
            FLAP.ghostPassed = true;
            ghostFireworks();
        }

        FLAP.popups.forEach((p) => { p.life -= dt; p.y -= 34 * dt; });
        FLAP.popups = FLAP.popups.filter((p) => p.life > 0);
        FLAP.fireworks.forEach((f) => {
            f.life -= dt;
            f.x += f.vx * dt;
            f.y += f.vy * dt;
            f.vy += 120 * dt;
        });
        FLAP.fireworks = FLAP.fireworks.filter((f) => f.life > 0);

        if (FLAP.elapsed >= RUN_SECONDS || FLAP.hearts <= 0) finishRun();
    }

    function pickPhrase(level) {
        const pool = (POOLS && POOLS[level]) || [];
        if (!pool.length) return 'I agree with this point of view.';
        let phrase = pool[Math.floor(Math.random() * pool.length)];
        if (pool.length > 1 && phrase === FLAP.lastPhrase) {
            phrase = pool[(pool.indexOf(phrase) + 1) % pool.length];
        }
        FLAP.lastPhrase = phrase;
        return phrase;
    }

    function spawnGate() {
        const L = LEVELS[FLAP.levelIndex];
        const phrase = pickPhrase(FLAP.levelIndex);
        const minY = 140 + L.gap / 2;
        const maxY = H - GROUND - 110 - L.gap / 2;
        const mid = H / 2;
        const half = Math.max(0, Math.min(90, (maxY - minY) / 2));
        const lo = Math.max(minY, mid - half);
        const hi = Math.min(maxY, mid + half);
        let gapY = lo + Math.random() * Math.max(0, hi - lo);
        const prev = FLAP.gates[FLAP.gates.length - 1];
        if (prev) gapY = Math.max(prev.gapY - 120, Math.min(prev.gapY + 120, gapY));
        const tokens = tokensOf(phrase);
        FLAP.wordsShown += tokens.length;
        FLAP.gates.push({
            x: W + 60,
            speed: gateSpeed(tokens.length, FLAP.levelIndex),
            gapY,
            gapH: L.gap,
            phrase,
            tokens,
            readIdx: 0,
            readCount: 0,
            level: FLAP.levelIndex,
            passed: false,
            hit: false,
            gold: false,
            retrying: false,
            rushing: false,
            retries: 0,
            failFlash: 0,
            frozen: 0,
            wobble: 0
        });
    }

    function collide(g) {
        if (FLAP.inv > 0) return false;
        const bx = BIRD_X, by = FLAP.bird.y, r = BIRD_R - 2;
        const inX = bx + r > g.x && bx - r < g.x + 58;
        if (!inX) return false;
        const topH = g.gapY - g.gapH / 2;
        const botY = g.gapY + g.gapH / 2;
        return by - r < topH || by + r > botY;
    }

    function hit(kind) {
        const ground = kind === 'ground';
        const grace = ground && FLAP.elapsed < GRACE_SECONDS;
        if (!grace) FLAP.hearts -= 1;
        FLAP.inv = ground ? 2.0 : 1.2;
        if (!grace) FLAP.score = Math.max(0, FLAP.score - 25);
        FLAP.streak = 0;
        FLAP.mood = 'puffed';
        FLAP.bounce = 18;
        FLAP.stun = 0.7;
        FLAP.hold = 0;
        updateStreakChip();
        toast(ground
            ? (grace ? '💦 Splash! Read the words to stay up.' : '💥 Water splash! −1 life')
            : '💥 Hit the gate! −1 life');
        if (ground) {
            FLAP.bird.y = H * 0.4;
            FLAP.bird.vy = -330;
            FLAP.lift = 0.9;
        }
        renderHearts();
        if (FLAP.hearts <= 0) finishRun();
    }

    function gateAccuracy(g) {
        return g.readCount / Math.max(1, g.tokens.length);
    }

    function passRatio(level) {
        const idx = (level == null) ? FLAP.levelIndex : level;
        return PASS_RATIOS[Math.min(idx, PASS_RATIOS.length - 1)];
    }

    /* Under the level's pass ratio the cat is only stunned: it bounces back,
       loses a life, and the gate is pushed ahead for an immediate retry with
       the unread words red. Early levels ask for 60%, L4 asks for 75%. */
    function gateFail(g) {
        g.retries += 1;
        g.retrying = true;
        g.failFlash = 1.5;
        g.frozen = 2.2;
        g.x = BIRD_X + 150;
        const firstMiss = g.tokens.findIndex((t) => !t.read);
        g.readIdx = firstMiss < 0 ? g.tokens.length : firstMiss;
        g.tokens.forEach((t) => {
            if (!t.read) { t.wrong = true; t.skipped = false; t.near = false; }
        });
        FLAP.chipSig = '';

        FLAP.hearts -= 1;
        FLAP.inv = Math.max(FLAP.inv, 1.0);
        FLAP.stun = 1.0;
        FLAP.hold = 0;
        FLAP.bounce = 30;
        FLAP.lift = 0;
        FLAP.bird.vy = Math.max(FLAP.bird.vy, 90);
        FLAP.streak = 0;
        FLAP.mood = 'puffed';
        updateStreakChip();

        FLAP.popups.push({ x: BIRD_X + 22, y: g.gapY, txt: 'stunned!', life: 1.2, color: '#b91c1c' });
        toast('😵 Read the red words — push through!');
        renderHearts();
        if (FLAP.hearts <= 0) finishRun();
    }

    function renderHearts() {
        const node = el('hearts');
        if (!node) return;
        const n = Math.max(0, FLAP.hearts);
        node.textContent = '❤️'.repeat(n) + '🖤'.repeat(Math.max(0, 5 - n));
    }

    function updateStreakChip() {
        const chip = el('streakchip');
        if (!chip) return;
        chip.textContent = '🔥 ' + FLAP.streak;
        chip.classList.toggle('on', FLAP.streak > 0);
    }

    function updateGhostChip() {
        const chip = el('ghostchip');
        if (!chip) return;
        if (FLAP.ghostPassed) {
            chip.textContent = '🎆 ghost ✓';
            chip.classList.add('done');
        } else {
            chip.textContent = '👻 ' + (FLAP.best > 0 ? fmt(FLAP.best) : '—');
            chip.classList.remove('done');
        }
    }

    function ghostFireworks() {
        toast('🎆 Ghost Cat passed — new best!');
        for (let i = 0; i < 54; i += 1) {
            const a = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 210;
            FLAP.fireworks.push({
                x: BIRD_X + 20 + Math.random() * 170,
                y: 110 + Math.random() * 170,
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed,
                life: 0.9 + Math.random() * 1.0,
                color: ['#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#f87171'][i % 5],
                r: 2 + Math.random() * 3
            });
        }
    }

    function scoreGate(g) {
        const L = LEVELS[g.level];
        const total = g.tokens.length || 1;
        const ratio = g.readCount / total;
        const full = ratio >= 0.999;

        FLAP.accWords += total;
        FLAP.accHits += g.readCount;
        g.tokens.forEach((t) => {
            if (!t.read) FLAP.wordMisses[t.key] = (FLAP.wordMisses[t.key] || 0) + 1;
        });

        g.gold = full;
        const pts = full ? L.pts * 2 : Math.round(L.pts * ratio);
        FLAP.score += pts;
        if (full) {
            FLAP.gold += 1;
            FLAP.streak += 1;
            FLAP.bestStreak = Math.max(FLAP.bestStreak, FLAP.streak);
        } else {
            FLAP.streak = 0;
            FLAP.missed.push(g.phrase);
        }
        FLAP.gatesPassed += 1;
        updateStreakChip();

        const nextLv = levelFor(FLAP.gatesPassed);
        if (nextLv !== FLAP.levelIndex) {
            FLAP.levelIndex = nextLv;
            toast('⬆ ' + LEVELS[nextLv].name);
        }
        FLAP.popups.push({
            x: BIRD_X + 30, y: g.gapY, txt: (full ? '⭐ +' : '+') + pts,
            life: 1.1, color: full ? '#b45309' : '#15803d'
        });
        /* Hover through the changeover to the next phrase, and keep the cat
           invincible for a moment so a transition fall cannot cost a life. */
        FLAP.hold = Math.max(FLAP.hold, 2.0);
        FLAP.inv = Math.max(FLAP.inv, 2.0);
        if (full) toast('⭐ Whole phrase! +' + pts + ' · streak ' + FLAP.streak);
    }

    function finishRun() {
        stopRun();
        FLAP.started = false;
        if (FLAP.ranked) {
            if (FLAP.gatesPassed === 0) FLAP.mood = 'flat';
            else if (FLAP.hearts <= 0) FLAP.mood = 'puffed';
            else FLAP.mood = 'happy';
            FLAP.paws = FLAP.gatesPassed * PAWS_PER_PHRASE;
        }
        FLAP.lastScore = FLAP.score;
        FLAP.lastPhrases = FLAP.gatesPassed;
        if (FLAP.ranked) {
            FLAP.lastRankedScore = FLAP.score;
            FLAP.lastRankedPhrases = FLAP.gatesPassed;
            const isBest = writeBest(FLAP.score);
            FLAP.best = Math.max(readBest(), FLAP.score);
            if (isBest) FLAP.newBest = true;
            pushRun(FLAP.score);
            submitRun();
            if (FLAP.duel.playing) settleChallenge();
        }
        renderResult();
        show('result');
    }

    /* ---------------- hud / draw ---------------- */
    function updateHud() {
        const left = Math.max(0, RUN_SECONDS - FLAP.elapsed);
        if (el('timer')) el('timer').textContent = clock(left);
        if (el('phr')) el('phr').textContent = FLAP.ranked ? (FLAP.gatesPassed + ' ✅') : (FLAP.gatesFlown + ' 🚪');
        if (el('lvbadge')) el('lvbadge').textContent = LEVELS[FLAP.levelIndex].name;
        updateGhostChip();

        const next = activeReadGate();
        if (next) {
            if (el('saytext')) el('saytext').textContent = next.phrase;
            if (el('saylbl')) {
                const need = Math.round(passRatio(next.level) * 100) + '% TO PASS';
                el('saylbl').textContent = next.retrying || next.failFlash > 0
                    ? 'SAY THE RED WORDS · ' + need
                    : 'READ THIS · ' + need;
            }
            renderChips();
            if (el('heard') && FLAP.heardSig !== FLAP.transcript) {
                FLAP.heardSig = FLAP.transcript;
                const tail = words(FLAP.transcript).slice(-6).join(' ');
                el('heard').textContent = tail ? 'Heard: ' + tail : 'Listening…';
            }
        }
        if (el('meterfill')) el('meterfill').style.width = Math.round(Math.min(100, FLAP.tap ? FLAP.lift * 70 : (FLAP.pull || 0) * 100)) + '%';
    }

    /* The world is 400 units wide. In normal mode it is 400x600 (2:3).
       In portrait full screen we extend H so the canvas fills the available
       height without stretching the cat; on wide/short screens it stays 600
       and is sized by height. */
    function fitWorld() {
        const cv = el('cv');
        if (!cv) return;
        const full = fsOn();
        let next = 600;
        if (full) {
            const availW = Math.max(200, window.innerWidth - 24);
            const availH = Math.max(300, window.innerHeight - 24);
            if (availH / availW > 1.5) {
                next = Math.max(600, Math.min(1100, Math.round(W * availH / availW)));
            }
        }
        const old = H;
        H = next;
        if (old !== H && FLAP.running) {
            const k = H / old;
            FLAP.bird.y = Math.max(BIRD_R, Math.min(H - GROUND - BIRD_R, FLAP.bird.y * k));
            FLAP.gates.forEach((g) => {
                const lo = 140 + g.gapH / 2;
                const hi = H - GROUND - 110 - g.gapH / 2;
                g.gapY = Math.max(lo, Math.min(hi, g.gapY * k));
            });
        }
        cv.dataset.w = String(W);
        cv.dataset.h = String(H);
        cv.style.aspectRatio = W + ' / ' + H;
        const wrap = cv.parentElement;
        if (wrap) {
            if (full) {
                wrap.style.width = (H > 600)
                    ? '100%'
                    : 'min(100%, calc((100dvh - 24px) * 2 / 3))';
            } else {
                wrap.style.width = '';
            }
        }
    }

    function canvasScale(canvas) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (!canvas) return 1;
        const w = Number(canvas.dataset.w || W);
        const h = Number(canvas.dataset.h || H);
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.aspectRatio = w + ' / ' + h;
        }
        return dpr;
    }

    function draw() {
        const cv = el('cv');
        if (!cv) return;
        const ctx = cv.getContext('2d');
        const dpr = canvasScale(cv);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const L = LEVELS[FLAP.levelIndex];
        const sky = SKY[L.color];
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, sky[0]);
        grad.addColorStop(1, sky[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let i = 0; i < 5; i += 1) {
            const cx = ((i * 137 - FLAP.elapsed * (14 + i * 4)) % (W + 160)) - 80;
            const cy = 70 + ((i * 97) % 260);
            const r = 26 + (i % 3) * 8;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.arc(cx + r * 0.8, cy + 6, r * 0.72, 0, Math.PI * 2);
            ctx.arc(cx - r * 0.8, cy + 8, r * 0.6, 0, Math.PI * 2);
            ctx.fill();
        }

        drawGhostLine(ctx);

        const pipe = PIPE[L.color];
        FLAP.gates.forEach((g) => {
            const topH = g.gapY - g.gapH / 2;
            const botY = g.gapY + g.gapH / 2;
            const col = g.failFlash > 0 && Math.floor(FLAP.t * 9) % 2
                ? ['#fca5a5', '#b91c1c'] : pipe;
            pipeRect(ctx, g.x, 0, 58, topH, col);
            pipeRect(ctx, g.x, botY, 58, H - GROUND - botY, col);
            ctx.save();
            ctx.translate(g.x + 29, g.gapY);
            ctx.rotate(g.wobble * 2);
            ctx.fillStyle = g.failFlash > 0 ? '#f87171' : '#f9a8d4';
            ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(0, 0, 7, 0.3, 2.4); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, 7, 3.6, 5.6); ctx.stroke();
            ctx.restore();
        });

        drawGround(ctx);
        drawFireworks(ctx);

        const b = FLAP.bird;
        drawCatSprite(ctx, BIRD_X - FLAP.bounce, b.y, b.rot * 0.55, FLAP.t, {
            stun: FLAP.stun > 0,
            lift: FLAP.lift,
            inv: FLAP.inv
        });

        FLAP.popups.forEach((p) => {
            ctx.globalAlpha = Math.min(1, p.life * 1.6);
            ctx.fillStyle = p.color;
            ctx.font = '700 16px Fredoka, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(p.txt, p.x, p.y);
            ctx.globalAlpha = 1;
        });
    }

    function ghostLineY() {
        if (FLAP.best <= 0) return 190;
        return 108 + Math.max(0.18, 1 - FLAP.best / 2600) * 180;
    }

    function drawGhostLine(ctx) {
        const y = ghostLineY();
        const passed = FLAP.ghostPassed;
        ctx.save();
        ctx.setLineDash([7, 7]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = passed ? 'rgba(251,191,36,0.95)' : 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.globalAlpha = passed ? 0.95 : 0.8;
        ctx.fillStyle = passed ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.ellipse(30, y - 12, 15, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(17, y - 19); ctx.lineTo(20, y - 32); ctx.lineTo(27, y - 23); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(35, y - 22); ctx.lineTo(42, y - 32); ctx.lineTo(44, y - 17); ctx.fill();
        ctx.fillStyle = '#1f2937';
        ctx.beginPath(); ctx.arc(25, y - 13, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(36, y - 13, 1.8, 0, Math.PI * 2); ctx.fill();

        ctx.globalAlpha = 1;
        ctx.fillStyle = passed ? '#b45309' : '#4b5563';
        ctx.font = '800 11px Fredoka, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(passed ? '🎆 GHOST PASSED'
            : (FLAP.best > 0 ? '👻 BEST ' + fmt(FLAP.best) : '👻 NO GHOST CAT YET'), 56, y + 4);
        ctx.restore();
    }

    function drawGround(ctx) {
        const gy = H - GROUND;
        const wg = ctx.createLinearGradient(0, gy, 0, H);
        wg.addColorStop(0, '#38bdf8');
        wg.addColorStop(1, '#075985');
        ctx.fillStyle = wg;
        ctx.fillRect(0, gy, W, GROUND);

        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        for (let row = 0; row < 3; row += 1) {
            ctx.beginPath();
            for (let x = 0; x <= W; x += 8) {
                const y = gy + 16 + row * 16 + Math.sin(x * 0.06 + FLAP.t * 2 + row) * 3;
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        for (let x = 10; x < W; x += 26) {
            ctx.fillStyle = '#cbd5e1';
            ctx.beginPath();
            ctx.moveTo(x - 8, gy);
            ctx.lineTo(x, gy - 17);
            ctx.lineTo(x + 8, gy);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#94a3b8';
            ctx.beginPath();
            ctx.moveTo(x, gy - 17);
            ctx.lineTo(x - 3, gy - 3);
            ctx.lineTo(x + 1, gy - 3);
            ctx.closePath();
            ctx.fill();
        }
    }

    function drawFireworks(ctx) {
        FLAP.fireworks.forEach((f) => {
            ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
            ctx.fillStyle = f.color;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
    }

    /* Winged cat mascot, drawn on the game canvas so it needs no store skins. */
    function drawCatSprite(ctx, x, y, rot, t, opts) {
        const o = opts || {};
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        if (o.inv > 0 && Math.floor(t * 12) % 2) ctx.globalAlpha = 0.72;

        const flap = Math.sin(t * 15) * 0.5;
        const wing = (mirror) => {
            ctx.save();
            if (mirror) ctx.scale(-1, 1);
            ctx.rotate(-0.15 + flap * 0.4);
            ctx.fillStyle = '#dbeafe';
            ctx.strokeStyle = '#93c5fd';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-6, -2);
            ctx.quadraticCurveTo(mirror ? -26 : -28, mirror ? -17 : -20, mirror ? -19 : -20, mirror ? 5 : 4);
            ctx.quadraticCurveTo(mirror ? -13 : -14, 10, -6, 8);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        };
        wing(false);
        wing(true);

        if ((o.lift || 0) > 0.35) {
            ctx.fillStyle = 'rgba(251,146,60,0.9)';
            ctx.beginPath();
            ctx.moveTo(-11, 6);
            ctx.lineTo(-16, 20 + Math.random() * 6);
            ctx.lineTo(-6, 9);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(254,240,138,0.95)';
            ctx.beginPath();
            ctx.moveTo(-10, 7);
            ctx.lineTo(-13, 15);
            ctx.lineTo(-8, 8);
            ctx.closePath();
            ctx.fill();
        }

        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-13, 3);
        ctx.quadraticCurveTo(-25, 2 + Math.sin(t * 12) * 4, -22, -9);
        ctx.stroke();

        const body = ctx.createRadialGradient(-3, -4, 2, 0, 0, 18);
        body.addColorStop(0, '#fde68a');
        body.addColorStop(1, '#f59e0b');
        ctx.fillStyle = body;
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(-13, -8); ctx.lineTo(-11, -21); ctx.lineTo(-3, -13); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(11, -9); ctx.lineTo(9, -22); ctx.lineTo(2, -13); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fda4af';
        ctx.beginPath();
        ctx.moveTo(-11, -10); ctx.lineTo(-10, -17); ctx.lineTo(-6, -12); ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(9, -11); ctx.lineTo(8, -18); ctx.lineTo(4, -13); ctx.closePath();
        ctx.fill();

        if (o.stun) {
            ctx.strokeStyle = '#7f1d1d';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(2, -6); ctx.lineTo(8, -1); ctx.moveTo(8, -6); ctx.lineTo(2, -1);
            ctx.moveTo(-9, -6); ctx.lineTo(-3, -1); ctx.moveTo(-3, -6); ctx.lineTo(-9, -1);
            ctx.stroke();
            ctx.fillStyle = '#7f1d1d';
            ctx.font = '700 9px Fredoka, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('@ @', 0, -25);
        } else {
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(-5, -5, 4.6, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(5, -5, 4.6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#1f2937';
            ctx.beginPath(); ctx.arc(-4, -5, 2.1, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(6, -5, 2.1, 0, Math.PI * 2); ctx.fill();
        }

        ctx.fillStyle = '#f472b6';
        ctx.beginPath();
        ctx.moveTo(-2, 3); ctx.lineTo(2, 3); ctx.lineTo(0, 6); ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#7c2d12';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(-2.5, 6, 2.5, 0, Math.PI);
        ctx.arc(2.5, 6, 2.5, 0, Math.PI);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(120,53,15,0.75)';
        ctx.lineWidth = 1.1;
        [-8, -3, 2].forEach((dy, i) => {
            ctx.beginPath();
            ctx.moveTo(-12, dy + 1);
            ctx.lineTo(-24, dy - 2 + i * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(12, dy + 1);
            ctx.lineTo(24, dy - 2 + i * 2);
            ctx.stroke();
        });

        ctx.restore();
    }

    function pipeRect(ctx, x, y, w, h, colors) {
        if (h <= 0) return;
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, colors[1]);
        g.addColorStop(0.35, colors[0]);
        g.addColorStop(1, colors[1]);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x + 8, y, 6, h);
        ctx.fillStyle = colors[1];
        if (y === 0) ctx.fillRect(x - 4, h - 22, w + 8, 22);
        else ctx.fillRect(x - 4, y, w + 8, 22);
    }

    function toast(text) {
        const node = el('toast');
        if (!node) return;
        node.textContent = text;
        node.classList.add('on');
        clearTimeout(FLAP.toastTimer);
        FLAP.toastTimer = setTimeout(() => node.classList.remove('on'), 1000);
    }

    /* ---------------- result helpers ---------------- */
    function stars() {
        let n = 0;
        const air = FLAP.voicedMs / Math.max(1, FLAP.elapsed * 1000);
        if (air >= 0.65) n += 1;
        if (FLAP.longest >= 8) n += 1;
        if (FLAP.pauses <= 3) n += 1;
        if (FLAP.gatesPassed >= 5) n += 1;
        return Math.max(1, Math.min(3, Math.round(n * 0.75)));
    }

    function readAccuracy() {
        return FLAP.accWords ? FLAP.accHits / FLAP.accWords : 0;
    }

    function weakestWord() {
        let word = '';
        let worst = 0;
        Object.keys(FLAP.wordMisses).forEach((k) => {
            if (FLAP.wordMisses[k] > worst) {
                worst = FLAP.wordMisses[k];
                word = k;
            }
        });
        return { word, count: worst };
    }

    function localImprove() {
        const today = hkToday();
        const runs = readRuns();
        const todays = runs.filter((r) => r.d === today).map((r) => Number(r.s) || 0);
        const from = shiftDay(today, -7);
        const past = runs.filter((r) => r.d < today && r.d >= from).map((r) => Number(r.s) || 0);
        if (!todays.length || !past.length) return null;
        const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        const t = avg(todays);
        const p = avg(past);
        if (!p) return null;
        return { today: Math.round(t), past: Math.round(p), pct: Math.round(((t - p) / p) * 100) };
    }

    function boardState() {
        const week = weekStartKey();
        const cloud = FLAP.cloud;
        const meId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? currentUser.id : '';
        if (cloud.status === 'ready' && cloud.week === week) {
            return { source: 'cloud', rows: cloud.rows.slice(), week, meId };
        }
        return {
            source: 'local',
            week,
            meId,
            rows: [{
                user_id: meId,
                nickname: (typeof displayName === 'function' && typeof currentUser !== 'undefined' && currentUser)
                    ? displayName() : 'You',
                score: Math.max(readBest(), FLAP.lastRankedScore || 0)
            }]
        };
    }

    function rankedRows(extraScore) {
        const st = boardState();
        const rows = st.rows.map((r) => ({
            user_id: r.user_id,
            name: r.nickname || 'Student',
            score: Number(r.score) || 0,
            phrases: Number(r.phrases) || 0,
            createdAt: r.created_at || ''
        }));
        const meId = st.meId;
        if (meId && extraScore != null && extraScore >= 0) {
            const existing = rows.find((r) => r.user_id === meId);
            if (existing) existing.score = Math.max(existing.score, extraScore);
            else rows.push({ user_id: meId, name: 'You', score: extraScore, phrases: FLAP.gatesPassed, createdAt: '' });
        }
        rows.sort((a, b) => b.score - a.score || b.phrases - a.phrases);
        return rows;
    }

    function myRank(extraScore) {
        const rows = rankedRows(extraScore);
        const meId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? currentUser.id : '';
        const idx = rows.findIndex((r) => (meId && r.user_id === meId) || r.name === 'You');
        return idx >= 0 ? idx + 1 : 0;
    }

    function boardTableHTML(rows, limit) {
        const meId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? currentUser.id : '';
        const top = rows.slice(0, limit);
        if (!top.length) {
            return '<div class="flap-empty-row">No scores on this board yet — be the first!</div>';
        }
        return '<table class="flap-table"><tbody>' + top.map((r, i) => {
            const me = meId && r.user_id === meId;
            return '<tr' + (me ? ' class="me"' : '') + '>'
                + '<td class="num">' + (i + 1) + '</td>'
                + '<td>' + (me ? 'You' : String(r.name).replace(/[<>&]/g, '')) + '</td>'
                + '<td class="pts">' + fmt(r.score) + '</td>'
                + '</tr>';
        }).join('') + '</tbody></table>';
    }

    function boardNote(rows, rank) {
        /* The local fallback only ever contains one row, so ranking text such
           as "You are #1" would be misleading. Say plainly that this is an
           on-device score instead. */
        const ready = FLAP.cloud.status === 'ready' && FLAP.cloud.week === weekStartKey();
        if (!ready) {
            if (FLAP.cloud.status === 'missing') {
                return 'Saved on this device only — the class board needs supabase/flap_runs.sql.';
            }
            return 'Saved on this device only — sign in to join the class board.';
        }
        if (!rows.length || !rank) return '';
        if (rank === 1) return 'You are #1 this week — 🥇';
        if (rank <= 7) {
            const gap = rows[rank - 2].score - rows[rank - 1].score;
            return '#' + rank + ' this week · ' + fmt(gap) + ' pts behind #' + (rank - 1) + '.';
        }
        const seventh = rows[6] ? rows[6].score : rows[rows.length - 1].score;
        return 'Your best ' + fmt(rows[rank - 1].score) + ' pts — '
            + fmt(Math.max(0, seventh - rows[rank - 1].score)) + ' pts behind #7 this week.';
    }

    /* ---------------- cloud ---------------- */
    async function refreshCloud() {
        if (!canUseCloudBoard()) {
            FLAP.cloud.status = 'signed-out';
            renderLobby();
            return;
        }
        if (FLAP.cloud.loading) return;
        FLAP.cloud.loading = true;
        const week = weekStartKey();
        try {
            const res = await sb.from('flap_weekly_board')
                .select('user_id,nickname,score,phrases,best_streak,created_at,week_start')
                .eq('week_start', week)
                .order('score', { ascending: false })
                .limit(200);
            if (res.error) throw res.error;
            FLAP.cloud.status = 'ready';
            FLAP.cloud.week = week;
            FLAP.cloud.rows = (res.data || []).map((r) => ({
                user_id: r.user_id,
                nickname: r.nickname,
                score: r.score,
                phrases: r.phrases,
                created_at: r.created_at
            }));
            FLAP.cloud.error = '';
        } catch (err) {
            FLAP.cloud.status = 'missing';
            FLAP.cloud.error = (err && err.message) ? err.message : String(err);
        }
        FLAP.cloud.loading = false;
        renderLobby();
        if (current === 'result') refreshResultBoard();
        loadImproved();
    }

    async function loadImproved() {
        if (!canUseCloudBoard()) {
            FLAP.cloud.improved = [];
            if (current === 'board' || current === 'result') renderBoard();
            return;
        }
        try {
            const res = await sb.from('flap_improved_today')
                .select('user_id,nickname,today_avg,past_avg,pct')
                .order('pct', { ascending: false })
                .limit(1);
            if (res.error) throw res.error;
            FLAP.cloud.improved = res.data || [];
        } catch (e) {
            FLAP.cloud.improved = [];
        }
        if (current === 'board' || current === 'result') renderBoard();
    }

    async function submitRun() {
        if (!canUseCloudBoard()) return;
        if (!FLAP.ranked) return;
        const payload = {
            p_score: Math.max(0, Math.round(FLAP.score)),
            p_phrases: Math.max(0, FLAP.gatesPassed),
            p_gold: Math.max(0, FLAP.gold),
            p_best_streak: Math.max(0, FLAP.bestStreak),
            p_acc_hits: Math.max(0, FLAP.accHits),
            p_acc_words: Math.max(0, FLAP.accWords),
            p_wpm: wpmEstimate()
        };
        try {
            const res = await sb.rpc('submit_flap_run', payload);
            if (res.error) throw res.error;
            const out = res.data || {};
            FLAP.cloud.submitted = true;
            FLAP.cloud.rank = Number(out.rank) || 0;
            FLAP.paws = Number(out.paws) || 0;
            FLAP.boardBonus = Number(out.board_bonus) || 0;
            FLAP.improvedBonus = Number(out.improved_bonus) || 0;
            if (out.best) {
                FLAP.best = Math.max(FLAP.best, Number(out.best) || 0);
            }
            if (current === 'result') renderResult();
            const board = await sb.from('flap_weekly_board')
                .select('user_id,nickname,score,phrases,created_at,week_start')
                .eq('week_start', weekStartKey())
                .order('score', { ascending: false })
                .limit(200);
            if (!board.error) {
                FLAP.cloud.status = 'ready';
                FLAP.cloud.week = weekStartKey();
                FLAP.cloud.rows = board.data || [];
                if (current === 'result') refreshResultBoard();
            }
            loadImproved();
        } catch (err) {
            FLAP.cloud.submitted = false;
            FLAP.cloud.error = (err && err.message) ? err.message : String(err);
        }
    }

    function wpmEstimate() {
        if (FLAP.voicedMs <= 3000) return 0;
        return Math.round(FLAP.words / (FLAP.voicedMs / 60000));
    }

    /* ---------------- result screen ---------------- */
    function renderResult() {
        const air = FLAP.voicedMs / Math.max(1, FLAP.elapsed * 1000);
        const pct = Math.round(air * 100);
        const acc = readAccuracy();
        const accPct = Math.round(acc * 100);
        const s = stars();

        if (el('r-stars')) el('r-stars').textContent = '⭐'.repeat(s) + '☆'.repeat(3 - s);
        if (el('r-score')) el('r-score').textContent = fmt(FLAP.score);
        if (el('r-air')) {
            el('r-air').textContent = Math.round(FLAP.voicedMs / 1000) + 's / '
                + Math.round(FLAP.elapsed) + 's · ' + pct + '%';
            el('r-air').className = 'v ' + (pct >= 65 ? 'ok' : 'warn');
        }
        if (el('r-long')) {
            el('r-long').textContent = FLAP.longest.toFixed(1) + 's';
            el('r-long').className = 'v ' + (FLAP.longest >= 8 ? 'ok' : 'warn');
        }
        if (el('r-pause')) {
            el('r-pause').textContent = String(FLAP.pauses);
            el('r-pause').className = 'v ' + (FLAP.pauses <= 3 ? 'ok' : 'warn');
        }
        if (el('r-level')) el('r-level').textContent = LEVELS[FLAP.levelIndex].name;
        if (el('r-flown')) el('r-flown').textContent = String(FLAP.gatesFlown);
        if (el('r-gold')) el('r-gold').textContent = FLAP.gold + ' / ' + Math.max(FLAP.gatesPassed, 1);
        if (el('r-gates')) el('r-gates').textContent = String(FLAP.gatesPassed);
        if (el('r-words')) el('r-words').textContent = FLAP.wordsRead + ' / ' + Math.max(FLAP.wordsShown, 1);
        if (el('r-acc')) {
            el('r-acc').textContent = accPct + '%';
            el('r-acc').className = 'v ' + (acc >= WPM_MIN_ACC ? 'ok' : 'warn');
        }
        if (el('r-streak')) {
            el('r-streak').textContent = String(FLAP.bestStreak);
            el('r-streak').className = 'v ' + (FLAP.bestStreak > 0 ? 'ok' : 'warn');
        }

        const miss = el('r-miss');
        if (miss) {
            miss.innerHTML = FLAP.missed.length
                ? FLAP.missed.slice(0, 3).map((p) =>
                    '<div class="flap-miss">❌ “' + p.replace(/[<>&]/g, '') + '”</div>').join('')
                : '<div class="flap-tiny" style="margin-top:6px">No missed phrases — nice.</div>';
        }

        const wpm = wpmEstimate();
        if (el('r-wpm')) {
            if (!(FLAP.asrOk || FLAP.words)) {
                el('r-wpm').textContent = 'n/a';
                if (el('r-fill')) el('r-fill').textContent = 'n/a';
                if (el('r-asrnote')) {
                    el('r-asrnote').textContent = 'Voice-to-text is not available on this device. Your score still counts.';
                }
            } else if (acc < WPM_MIN_ACC) {
                el('r-wpm').textContent = 'n/a — read 80%+';
                if (el('r-fill')) el('r-fill').textContent = FLAP.fillers + (FLAP.fillers <= 3 ? ' ✅' : ' ⚠️');
                if (el('r-asrnote')) {
                    el('r-asrnote').textContent = 'Pace only counts when read accuracy is at least 80%. '
                        + 'Not a pronunciation score — the browser only estimates what it hears.';
                }
            } else {
                el('r-wpm').textContent = wpm + ' wpm' + (wpm >= 110 && wpm <= 160 ? ' ✅' : ' ⚠️');
                if (el('r-fill')) el('r-fill').textContent = FLAP.fillers + (FLAP.fillers <= 3 ? ' ✅' : ' ⚠️');
                if (el('r-asrnote')) {
                    el('r-asrnote').textContent = 'Not a pronunciation score — the browser only estimates what it hears.';
                }
            }
        }

        const ranked = FLAP.ranked;
        const guest = isGuestMode();
        if (el('r-board-card')) el('r-board-card').style.display = guest ? 'none' : '';
        if (el('r-board')) el('r-board').style.display = guest ? 'none' : '';
        if (el('r-duel')) el('r-duel').style.display = guest ? 'none' : '';
        if (el('r-coach')) el('r-coach').style.display = ranked ? '' : 'none';

        if (!ranked) {
            if (el('r-gain')) el('r-gain').textContent = 'Practice run · no Paws';
            if (el('r-best')) el('r-best').style.display = 'none';
            if (el('r-rank')) el('r-rank').textContent = 'Practice run · not ranked';
            if (el('r-hint')) el('r-hint').style.display = 'none';
            if (el('r-catline')) el('r-catline').textContent = 'Practice flight — tap to climb, no reading needed.';
            if (el('r-improve')) el('r-improve').textContent = 'Practice run · not ranked, no Paws';
            FLAP.mood = 'happy';
            renderResultBoard();
        } else {
            if (el('r-catline')) {
                el('r-catline').textContent = FLAP.mood === 'flat'
                    ? 'Splat! Your cat never got off the water.'
                    : FLAP.mood === 'puffed'
                        ? 'Poof! Too many bumps — keep the wings moving.'
                        : (FLAP.best > 0 && FLAP.score > (FLAP.best - 1) && FLAP.score >= FLAP.best
                            ? '🎉 New best — the Ghost Cat is behind you!'
                            : 'Nice flying! Go beat your Ghost Cat.');
            }

            const weak = weakestWord();
            if (el('r-hint')) {
                if (weak.word) {
                    el('r-hint').style.display = '';
                    el('r-hint').textContent = '💡 Weakest word: “' + weak.word + '” ('
                        + weak.count + ' miss' + (weak.count > 1 ? 'es' : '')
                        + ') — say it 3× before your next run.';
                } else if (FLAP.gatesPassed > 0) {
                    el('r-hint').style.display = '';
                    el('r-hint').textContent = '💡 No weak words — try a longer phrase level next run.';
                } else {
                    el('r-hint').style.display = '';
                    el('r-hint').textContent = '💡 No whole phrase was read yet — read the green words out loud to climb.';
                }
            }

            renderResultBoard();

            if (el('r-best')) {
                el('r-best').style.display = (FLAP.score >= readBest() && FLAP.score > 0) ? 'block' : 'none';
                el('r-best').textContent = '🎉 New personal best';
            }

            const local = FLAP.gatesPassed * PAWS_PER_PHRASE;
            if (el('r-gain')) {
                if (FLAP.cloud.submitted) {
                    const total = FLAP.paws + FLAP.boardBonus + FLAP.improvedBonus;
                    const notes = [];
                    if (FLAP.boardBonus) notes.push('+' + PAWS_BOARD + ' board');
                    if (FLAP.improvedBonus) notes.push('+' + PAWS_IMPROVED + ' most improved');
                    el('r-gain').textContent = '+' + total + ' 🐾 earned'
                        + (notes.length ? ' (' + notes.join(' · ') + ')' : '');
                } else if (!canUseCloudBoard()) {
                    el('r-gain').textContent = '+' + local + ' 🐾 this run';
                    el('r-gain').title = 'Paws need the cloud board (supabase/flap_runs.sql).';
                } else {
                    el('r-gain').textContent = '+' + local + ' 🐾 this run';
                }
            }

            const imp = localImprove();
            if (el('r-improve')) {
                if (imp) {
                    el('r-improve').textContent = (imp.pct >= 0 ? '📈 +' : '📉 ') + imp.pct
                        + '% vs your 7-day average (' + fmt(imp.past) + ')';
                } else if (FLAP.cloud.improved && FLAP.cloud.improved.length) {
                    const best = FLAP.cloud.improved[0];
                    el('r-improve').textContent = '📈 Class most improved: '
                        + (best.nickname || 'a classmate') + ' +' + best.pct + '% today';
                } else {
                    el('r-improve').textContent = '📈 Keep playing to build a 7-day average';
                }
            }
            renderBoard();
        }
        renderResultDuel();
        startResultCat();
    }

    function refreshResultBoard() {
        if (current !== 'result') return;
        renderResultBoard();
        renderBoard();
    }

    function renderResultBoard() {
        const rows = rankedRows(FLAP.score);
        const rank = myRank(FLAP.score);
        if (el('r-top7')) el('r-top7').innerHTML = boardTableHTML(rows, 7);
        if (el('r-top7-note')) {
            el('r-top7-note').textContent = FLAP.ranked
                ? boardNote(rows, rank)
                : 'Practice runs do not change this week’s board.';
        }
        if (el('r-rank')) {
            el('r-rank').textContent = FLAP.ranked
                ? (rows.length > 1 || FLAP.cloud.status === 'ready'
                    ? '#' + (rank || 1) + ' this week'
                    : 'Personal best saved on this device')
                : 'Practice run · not ranked';
        }
    }

    /* ---------------- board screen ---------------- */
    function renderBoard() {
        if (!el('b-top7')) return;
        const rows = rankedRows(null);
        const rank = myRank(null);
        el('b-top7').innerHTML = boardTableHTML(rows, 7);
        if (el('b-top7-note')) el('b-top7-note').textContent = boardNote(rows, rank);

        const imp = localImprove();
        const cloudImp = (FLAP.cloud.improved && FLAP.cloud.improved[0]) || null;
        if (el('b-improve-pct')) {
            if (cloudImp) el('b-improve-pct').textContent = '+' + cloudImp.pct + '%';
            else if (imp) el('b-improve-pct').textContent = (imp.pct >= 0 ? '+' : '') + imp.pct + '%';
            else el('b-improve-pct').textContent = '—';
        }
        if (el('b-improve-who')) {
            if (cloudImp) {
                el('b-improve-who').textContent = (cloudImp.nickname || 'A classmate')
                    + ' · 7-day avg ' + fmt(cloudImp.past_avg) + ' → today ' + fmt(cloudImp.today_avg);
            } else if (imp) {
                el('b-improve-who').textContent = 'You · 7-day avg ' + fmt(imp.past)
                    + ' → today ' + fmt(imp.today);
            } else {
                el('b-improve-who').textContent = 'Play a few runs over a week to unlock Most improved.';
            }
        }
        if (el('b-improve-me')) {
            if (FLAP.cloud.status === 'signed-out') {
                el('b-improve-me').textContent = 'Sign in with a school account to join the class board.';
            } else if (FLAP.cloud.status === 'missing') {
                el('b-improve-me').textContent = 'Class board not set up yet — a teacher needs to run supabase/flap_runs.sql. Your personal best stays on this device.';
            } else {
                el('b-improve-me').textContent = 'One personal best per student each week · resets Monday 00:00 HKT.';
            }
        }
    }

    /* ---------------- 1v1 challenge ---------------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function duelError(err) {
        const m = (err && err.message) ? err.message : String(err);
        if (/TOO_MANY_CHALLENGES/.test(m)) return 'You already have 3 open challenges. Finish or cancel one first.';
        if (/CHALLENGE_NOT_FOUND/.test(m)) return 'No challenge with that code. Check the letters and try again.';
        if (/OWN_CHALLENGE/.test(m)) return 'That is your own code — send it to a classmate instead.';
        if (/CHALLENGE_TAKEN/.test(m)) return 'Someone already joined that challenge.';
        if (/CHALLENGE_EXPIRED/.test(m)) return 'That challenge has expired.';
        if (/CHALLENGE_CANCELLED/.test(m)) return 'That challenge was cancelled.';
        if (/NOT_AUTHENTICATED/.test(m)) return 'Sign in with a school account to use challenges.';
        return 'Challenge error: ' + m;
    }

    function challengeScore() {
        const best = Math.max(0, Number(readBest()) || 0);
        const last = Math.max(0, Number(FLAP.lastRankedScore) || 0);
        if (last > 0 && last >= best) {
            return { score: last, phrases: Math.max(0, Number(FLAP.lastRankedPhrases) || 0) };
        }
        return { score: best, phrases: 0 };
    }

    function duelRow(id) {
        return (FLAP.duel.list || []).find((r) => String(r.id) === String(id)) || null;
    }

    async function loadChallenges() {
        if (!canUseCloudBoard()) {
            FLAP.duel.status = 'signed-out';
            if (current === 'duel') renderDuel(); else renderLobby();
            return;
        }
        if (FLAP.duel.loading) return;
        FLAP.duel.loading = true;
        try {
            const res = await sb.rpc('flap_challenges_list');
            if (res.error) throw res.error;
            FLAP.duel.status = 'ready';
            FLAP.duel.list = res.data || [];
            FLAP.duel.error = '';
        } catch (err) {
            FLAP.duel.status = 'missing';
            FLAP.duel.list = [];
            FLAP.duel.error = (err && err.message) ? err.message : String(err);
        }
        FLAP.duel.loading = false;
        if (current === 'duel') renderDuel(); else renderLobby();
    }

    function renderDuel() {
        if (!el('d-list')) return;
        const guest = isGuestMode();
        const ready = canUseCloudBoard();
        const usable = ready && !guest && FLAP.duel.status === 'ready';

        const note = el('d-note');
        if (note) {
            let html = '';
            if (guest) {
                html = '🔒 Leaderboards and 1v1 challenges are hidden in guest mode. Sign in with a school account to play.';
            } else if (!ready) {
                html = '⚔️ Challenges need a school account. Teacher preview and guest mode cannot send or join one.';
            } else if (FLAP.duel.status === 'missing') {
                html = '⚔️ The challenge table is not set up yet — ask your teacher to run supabase/flap_challenges.sql.';
            } else if (FLAP.duel.status === 'unknown') {
                html = '⚔️ Loading your challenges…';
            }
            note.style.display = html ? '' : 'none';
            note.innerHTML = html;
        }

        if (el('d-create-card')) el('d-create-card').style.display = usable ? '' : 'none';
        if (el('d-accept-card')) el('d-accept-card').style.display = usable ? '' : 'none';

        const score = challengeScore();
        if (el('d-send-score')) {
            el('d-send-score').textContent = score.score > 0
                ? fmt(score.score) + ' pts'
                : 'No ranked score yet — play a voice run first';
        }
        if (el('d-create')) {
            const off = score.score <= 0;
            el('d-create').disabled = off;
            el('d-create').style.opacity = off ? '0.55' : '';
        }

        if (el('d-created')) {
            if (FLAP.duel.created) {
                el('d-created').style.display = '';
                if (el('d-created-code')) el('d-created-code').textContent = FLAP.duel.created.code;
            } else {
                el('d-created').style.display = 'none';
            }
        }

        const ch = FLAP.duel.active;
        if (el('d-active-card')) el('d-active-card').style.display = (usable && ch) ? '' : 'none';
        if (ch && el('d-active-body')) {
            el('d-active-body').innerHTML = '<div class="flap-drow">'
                + '<div class="ico">⚔️</div>'
                + '<div class="body"><div class="name">' + esc(ch.rival || 'Classmate') + '</div>'
                + '<div class="meta">Beat ' + fmt(ch.target_score) + ' pts · code ' + esc(ch.code) + '</div></div>'
                + '<span class="tag open">Your turn</span></div>';
        }

        if (el('d-accept-note')) {
            el('d-accept-note').textContent = FLAP.duel.error || '';
            el('d-accept-note').style.color = FLAP.duel.error ? '#b91c1c' : '';
        }

        renderDuelList(usable);
    }

    function renderDuelList(usable) {
        const host = el('d-list');
        if (!host) return;
        const rows = FLAP.duel.list || [];
        if (!usable) {
            host.innerHTML = '<div class="flap-empty-row">'
                + (isGuestMode() ? 'Challenges are hidden in guest mode.'
                    : FLAP.duel.status === 'missing' ? 'Setup needed before challenges can appear.'
                        : 'Loading your challenges…') + '</div>';
            return;
        }
        if (!rows.length) {
            host.innerHTML = '<div class="flap-empty-row">No challenges yet — create one and share the code.</div>';
            return;
        }
        const meId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? currentUser.id : '';
        host.innerHTML = rows.map((r) => {
            const mine = r.role === 'sent';
            const name = r.rival_name || (mine ? 'Waiting for a classmate' : 'A classmate');
            const tag = String(r.status || '');
            let icon = mine ? '📤' : '📥';
            let meta = '';
            let tagHtml = '';
            let action = '';

            if (tag === 'finished') {
                const win = r.winner && meId && r.winner === meId;
                const tie = !r.winner;
                icon = win ? '🏆' : tie ? '🤝' : '😼';
                meta = fmt(r.my_score) + ' – ' + fmt(r.their_score) + ' pts';
                tagHtml = '<span class="tag ' + (win ? 'win' : tie ? '' : 'lose') + '">'
                    + (win ? 'Won' : tie ? 'Tie' : 'Lost') + '</span>';
            } else if (tag === 'open') {
                meta = mine
                    ? 'Waiting · target ' + fmt(r.my_score) + ' pts · code ' + esc(r.code)
                    : 'Code ' + esc(r.code);
                tagHtml = '<span class="tag open">Open</span>';
                if (mine) {
                    action = '<button type="button" class="go ghost" data-duel-cancel="' + esc(r.id) + '">Cancel</button>';
                }
            } else if (tag === 'accepted') {
                if (!mine) {
                    meta = 'Beat ' + fmt(r.their_score) + ' pts';
                    tagHtml = '<span class="tag open">Your turn</span>';
                    action = '<button type="button" class="go" data-duel-play="' + esc(r.id) + '">Play</button>';
                } else {
                    meta = 'They joined — waiting for their run';
                    tagHtml = '<span class="tag open">Waiting</span>';
                }
            } else if (tag === 'expired') {
                icon = '💤';
                meta = 'Expired after 14 days';
                tagHtml = '<span class="tag">Expired</span>';
            } else {
                icon = '🚫';
                meta = 'Cancelled';
                tagHtml = '<span class="tag">Cancelled</span>';
            }

            return '<div class="flap-drow">'
                + '<div class="ico">' + icon + '</div>'
                + '<div class="body"><div class="name">' + esc(name) + '</div>'
                + '<div class="meta">' + meta + '</div></div>'
                + tagHtml + action + '</div>';
        }).join('');
    }

    function renderMicDuel() {
        const card = el('mic-duel');
        if (!card) return;
        const ch = FLAP.duel.active;
        if (FLAP.duel.playing && ch) {
            card.style.display = '';
            if (el('mic-duel-title')) {
                el('mic-duel-title').textContent = '⚔️ Challenge vs ' + (ch.rival || 'a classmate');
            }
            if (el('mic-duel-body')) {
                el('mic-duel-body').textContent = 'Beat ' + fmt(ch.target_score)
                    + ' pts. This ranked run also counts on the weekly board. Tap mode is disabled for challenges.';
            }
        } else {
            card.style.display = 'none';
        }
    }

    function renderResultDuel() {
        const card = el('r-duel-card');
        if (!card) return;
        const d = FLAP.duel.result;
        if (!d) {
            card.style.display = 'none';
            if (el('r-duel')) el('r-duel').style.display = isGuestMode() ? 'none' : '';
            return;
        }
        const win = d.result === 'win';
        const tie = d.result === 'tie';
        const head = win ? '🏆 You won the challenge!' : tie ? '🤝 Dead heat — a tie!' : '😼 You lost this one';
        card.style.display = '';
        if (el('r-duel')) el('r-duel').style.display = isGuestMode() ? 'none' : '';
        if (el('r-duel-body')) {
            el('r-duel-body').innerHTML = '<div style="font-weight:800;font-size:15px;margin-bottom:6px">' + head + '</div>'
                + '<div class="flap-statrow"><span class="k">You</span><span class="v">' + fmt(d.my_score) + ' pts</span></div>'
                + '<div class="flap-statrow"><span class="k">' + esc(d.their_name || 'Classmate') + '</span>'
                + '<span class="v">' + fmt(d.their_score) + ' pts</span></div>'
                + '<div class="flap-tiny" style="margin-top:6px">Code ' + esc(d.code || '') + ' · challenge runs pay only the normal phrase Paws.</div>';
        }
    }

    async function createChallenge() {
        if (!canUseCloudBoard()) return;
        const score = challengeScore();
        if (score.score <= 0) {
            FLAP.duel.error = 'Play a ranked voice run first so you have a score to challenge with.';
            renderDuel();
            return;
        }
        if (el('d-create')) el('d-create').disabled = true;
        try {
            const res = await sb.rpc('create_flap_challenge', {
                p_score: score.score,
                p_phrases: score.phrases
            });
            if (res.error) throw res.error;
            const out = res.data || {};
            FLAP.duel.created = {
                id: out.id,
                code: out.code,
                score: Number(out.score) || score.score
            };
            FLAP.duel.error = '';
            if (typeof updateMascot === 'function') {
                updateMascot('Challenge ready — share code ' + out.code + '.');
            }
            renderDuel();
            loadChallenges();
        } catch (err) {
            FLAP.duel.error = duelError(err);
            renderDuel();
        }
        if (el('d-create')) el('d-create').disabled = false;
    }

    async function copyCreatedCode() {
        const c = FLAP.duel.created;
        if (!c) return;
        let ok = false;
        try {
            await navigator.clipboard.writeText(c.code);
            ok = true;
        } catch (e) { ok = false; }
        if (ok) {
            FLAP.duel.error = '';
            if (typeof updateMascot === 'function') updateMascot('Code ' + c.code + ' copied.');
        } else {
            FLAP.duel.error = 'Copy failed — read the code out: ' + c.code;
        }
        renderDuel();
    }

    async function acceptChallenge() {
        if (!canUseCloudBoard()) return;
        const input = el('d-code-input');
        const code = String((input && input.value) || '').trim().toUpperCase();
        if (code.length !== 6) {
            FLAP.duel.error = 'Enter the 6-character code.';
            renderDuel();
            return;
        }
        if (el('d-accept')) el('d-accept').disabled = true;
        try {
            const res = await sb.rpc('accept_flap_challenge', { p_code: code });
            if (res.error) throw res.error;
            const out = res.data || {};
            if (out.status === 'finished') {
                FLAP.duel.error = 'That challenge is already finished — check My challenges for the result.';
                renderDuel();
                if (el('d-accept')) el('d-accept').disabled = false;
                return;
            }
            FLAP.duel.active = {
                id: out.id,
                code: out.code || code,
                rival: out.rival || 'Classmate',
                target_score: Number(out.target_score) || 0
            };
            FLAP.duel.playing = false;
            FLAP.duel.result = null;
            FLAP.duel.error = '';
            if (input) input.value = '';
            if (typeof updateMascot === 'function') {
                updateMascot('Challenge joined — beat ' + fmt(out.target_score) + ' pts.');
            }
            renderDuel();
            loadChallenges();
        } catch (err) {
            FLAP.duel.error = duelError(err);
            renderDuel();
        }
        if (el('d-accept')) el('d-accept').disabled = false;
    }

    function beginChallenge(row) {
        if (!row) return;
        FLAP.duel.active = {
            id: row.id,
            code: row.code,
            rival: row.rival_name || 'Classmate',
            target_score: Number(row.their_score) || 0
        };
        FLAP.duel.result = null;
        FLAP.duel.error = '';
        FLAP.duel.playing = true;
        renderDuel();
        show('mic');
    }

    function playActiveChallenge() {
        if (!FLAP.duel.active) return;
        FLAP.duel.playing = true;
        show('mic');
    }

    async function cancelChallenge(id) {
        if (!canUseCloudBoard() || !id) return;
        try {
            const res = await sb.rpc('cancel_flap_challenge', { p_id: Number(id) });
            if (res.error) throw res.error;
            if (FLAP.duel.active && String(FLAP.duel.active.id) === String(id)) FLAP.duel.active = null;
            if (FLAP.duel.created && String(FLAP.duel.created.id) === String(id)) FLAP.duel.created = null;
            FLAP.duel.error = '';
        } catch (err) {
            FLAP.duel.error = duelError(err);
        }
        renderDuel();
        loadChallenges();
    }

    async function settleChallenge() {
        const ch = FLAP.duel.active;
        if (!ch || !FLAP.duel.playing || FLAP.duel.settling) return;
        FLAP.duel.settling = true;
        try {
            const res = await sb.rpc('finish_flap_challenge', {
                p_id: Number(ch.id),
                p_score: Math.max(0, Math.round(FLAP.score)),
                p_phrases: Math.max(0, FLAP.gatesPassed)
            });
            if (res.error) throw res.error;
            const out = res.data || {};
            FLAP.duel.result = {
                result: out.result || 'tie',
                my_score: Number(out.my_score) || 0,
                their_score: Number(out.their_score) || 0,
                their_name: out.their_name || ch.rival || 'Classmate',
                code: ch.code
            };
            FLAP.duel.active = null;
            FLAP.duel.error = '';
            if (typeof updateMascot === 'function') {
                const r = FLAP.duel.result.result;
                updateMascot(r === 'win' ? 'You won the challenge! ⚔️'
                    : r === 'tie' ? 'Dead heat — it is a tie!'
                        : 'So close — challenge them again!');
            }
        } catch (err) {
            FLAP.duel.error = duelError(err);
        }
        FLAP.duel.settling = false;
        FLAP.duel.playing = false;
        if (current === 'result') renderResult();
        loadChallenges();
    }

    /* ---------------- result cat ---------------- */
    function startResultCat() {
        stopResultCat();
        FLAP.resultCatT = 0;
        const tick = () => {
            FLAP.resultCatT += 1 / 60;
            drawResultCat(FLAP.resultCatT);
            FLAP.resultCatRaf = requestAnimationFrame(tick);
        };
        FLAP.resultCatRaf = requestAnimationFrame(tick);
    }

    function stopResultCat() {
        if (FLAP.resultCatRaf) cancelAnimationFrame(FLAP.resultCatRaf);
        FLAP.resultCatRaf = 0;
    }

    function drawResultCat(t) {
        const cv = el('r-cat');
        if (!cv) return;
        cv.dataset.w = '380';
        cv.dataset.h = '244';
        const dpr = canvasScale(cv);
        const ctx = cv.getContext('2d');
        const w = 380, h = 244;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#dbeafe');
        sky.addColorStop(1, '#f8fafc');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = 'rgba(253,224,71,0.85)';
        ctx.beginPath();
        ctx.arc(w - 52, 42, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        [[70, 46, 20], [128, 70, 14], [300, 92, 16]].forEach(([cx, cy, r]) => {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.arc(cx + r * 0.8, cy + 4, r * 0.7, 0, Math.PI * 2);
            ctx.arc(cx - r * 0.8, cy + 6, r * 0.6, 0, Math.PI * 2);
            ctx.fill();
        });

        const water = ctx.createLinearGradient(0, h - 42, 0, h);
        water.addColorStop(0, '#7dd3fc');
        water.addColorStop(1, '#0369a1');
        ctx.fillStyle = water;
        ctx.fillRect(0, h - 42, w, 42);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        for (let row = 0; row < 2; row += 1) {
            ctx.beginPath();
            for (let x = 0; x <= w; x += 10) {
                const y = h - 28 + row * 16 + Math.sin(x * 0.05 + t * 2 + row) * 2.5;
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        const mood = FLAP.ranked ? FLAP.mood : 'happy';
        if (mood === 'puffed') drawPuffedCat(ctx, w / 2, 132, t);
        else if (mood === 'flat') drawFlatCat(ctx, w / 2, h - 44, t);
        else drawFlyingCat(ctx, w / 2, 128, t);
    }

    function drawFlyingCat(ctx, x, y, t) {
        const bob = Math.sin(t * 2.4) * 8;
        for (let i = 0; i < 8; i += 1) {
            const a = t * 1.4 + (i / 8) * Math.PI * 2;
            const r = 52 + Math.sin(t * 3 + i) * 6;
            ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 4 + i);
            ctx.fillStyle = ['#fbbf24', '#f472b6', '#a78bfa'][i % 3];
            ctx.beginPath();
            ctx.arc(x + Math.cos(a) * r, y + bob + Math.sin(a) * r * 0.7, 3.4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(x, y + bob);
        ctx.scale(3.3, 3.3);
        drawCatSprite(ctx, 0, 0, 0, t, { lift: 1 });
        ctx.restore();
    }

    function drawPuffedCat(ctx, x, y, t) {
        const pulse = 1 + Math.sin(t * 5) * 0.05;
        ctx.fillStyle = 'rgba(203,213,225,0.75)';
        for (let i = 0; i < 4; i += 1) {
            const rise = ((t * 40 + i * 34) % 120);
            const px = x - 40 + i * 26;
            ctx.beginPath();
            ctx.arc(px, y - 40 - rise * 0.5, 9 - i, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(3.1 * pulse, 3.1 * pulse);

        ctx.beginPath();
        const spikes = 20;
        for (let i = 0; i < spikes; i += 1) {
            const a = (i / spikes) * Math.PI * 2;
            const r = i % 2 ? 22 : 29;
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r * 0.94;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        const body = ctx.createRadialGradient(-4, -6, 3, 0, 0, 30);
        body.addColorStop(0, '#fde68a');
        body.addColorStop(1, '#f59e0b');
        ctx.fillStyle = body;
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1.8;
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.moveTo(-22, -18); ctx.lineTo(-24, -34); ctx.lineTo(-8, -24); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(22, -18); ctx.lineTo(24, -34); ctx.lineTo(8, -24); ctx.closePath(); ctx.fill(); ctx.stroke();

        ctx.strokeStyle = '#7f1d1d';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-12, -6); ctx.lineTo(-2, 1);
        ctx.moveTo(-2, -6); ctx.lineTo(-12, 1);
        ctx.moveTo(2, -6); ctx.lineTo(12, 1);
        ctx.moveTo(12, -6); ctx.lineTo(2, 1);
        ctx.stroke();

        ctx.fillStyle = 'rgba(251,113,133,0.55)';
        ctx.beginPath(); ctx.arc(-13, 8, 6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(13, 8, 6, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = '#7c2d12';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 10, 5, 0.2, Math.PI - 0.2); ctx.stroke();

        ctx.fillStyle = '#dbeafe';
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-24, 6); ctx.quadraticCurveTo(-38, 2, -30, 16); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(24, 6); ctx.quadraticCurveTo(38, 2, 30, 16); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
    }

    function drawFlatCat(ctx, x, y, t) {
        ctx.fillStyle = '#fbbf24';
        for (let i = 0; i < 3; i += 1) {
            const a = t * 2 + (i / 3) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(x + Math.cos(a) * 62, y - 26 + Math.sin(a) * 9, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(3.2, 3.2);

        const body = ctx.createRadialGradient(-6, -4, 3, 0, 0, 34);
        body.addColorStop(0, '#fde68a');
        body.addColorStop(1, '#f59e0b');
        ctx.fillStyle = body;
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(0, 0, 33, 10.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath(); ctx.moveTo(-26, -4); ctx.lineTo(-38, -10); ctx.lineTo(-24, 2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(26, -4); ctx.lineTo(38, -10); ctx.lineTo(24, 2); ctx.closePath(); ctx.fill(); ctx.stroke();

        ctx.strokeStyle = '#7f1d1d';
        ctx.lineWidth = 2;
        [[-9, -3], [9, -3]].forEach(([ex, ey]) => {
            ctx.beginPath();
            ctx.moveTo(ex - 3.4, ey - 2.6); ctx.lineTo(ex + 3.4, ey + 2.6);
            ctx.moveTo(ex + 3.4, ey - 2.6); ctx.lineTo(ex - 3.4, ey + 2.6);
            ctx.stroke();
        });

        ctx.fillStyle = '#fb7185';
        ctx.beginPath();
        ctx.ellipse(0, 5, 4.4, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(32, 2);
        ctx.quadraticCurveTo(46, 0, 44, -8);
        ctx.stroke();
        ctx.restore();
    }

    /* ---------------- lobby ---------------- */
    function renderLobby() {
        const best = readBest();
        FLAP.best = best;
        const guest = isGuestMode();
        if (el('l-best')) el('l-best').textContent = best > 0 ? fmt(best) : '0';
        if (el('l-best-note')) {
            el('l-best-note').textContent = best > 0
                ? '👻 Your Ghost Cat sits at ' + fmt(best) + '. Cross it for fireworks.'
                : '👻 No Ghost Cat yet — your first run sets the line.';
        }
        if (el('to-board')) el('to-board').style.display = guest ? 'none' : '';
        if (el('lobby-duel')) {
            el('lobby-duel').style.display = guest ? 'none' : '';
            const pending = (FLAP.duel.list || []).filter((r) => r.role === 'received' && r.status === 'accepted').length;
            el('lobby-duel').textContent = pending
                ? '⚔️ Challenge · ' + pending + ' to play'
                : '⚔️ Challenge a friend';
        }
        if (el('l-status')) {
            const st = FLAP.cloud.status;
            if (guest) {
                el('l-status').textContent = '🔒 Leaderboards are hidden in guest mode · your Ghost Cat still works';
            } else if (st === 'ready') {
                const rank = myRank(null);
                el('l-status').textContent = rank > 0
                    ? '🏆 You are #' + rank + ' this week · resets Monday 00:00 HKT'
                    : '🏆 Weekly board · one personal best per student';
            } else if (st === 'missing') {
                el('l-status').textContent = '💾 Personal best saved on this device · class board needs supabase/flap_runs.sql';
            } else if (st === 'signed-out') {
                el('l-status').textContent = '💾 Personal best saved on this device · sign in to join the class board';
            } else {
                el('l-status').textContent = '🏆 Loading this week’s board…';
            }
        }
        renderBoard();
    }

    /* ---------------- mount / stop / input ---------------- */
    function bindInput() {
        if (bound) return;
        bound = true;
        const cv = el('cv');
        if (cv) {
            cv.addEventListener('pointerdown', (e) => {
                if (!FLAP.running) return;
                e.preventDefault();
                FLAP.tapHeld = true;
            });
        }
        window.addEventListener('pointerup', () => { FLAP.tapHeld = false; });
        window.addEventListener('pointercancel', () => { FLAP.tapHeld = false; });
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.code === 'ArrowUp') {
                if (FLAP.running) {
                    e.preventDefault();
                    FLAP.tapHeld = true;
                } else if (current === 'play' && FLAP.paused) {
                    e.preventDefault();
                    resumeRun();
                }
            }
            if (e.key === 'Escape' && FLAP.running) quitRun();
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space' || e.code === 'ArrowUp') FLAP.tapHeld = false;
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && FLAP.running) pauseRun();
        });
        window.addEventListener('pagehide', () => {
            stopAsr();
            closeMic();
        });
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
        window.addEventListener('resize', () => {
            fitWorld();
            if (current === 'play') draw();
        });
    }

    function mount() {
        buildPools();
        FLAP.mounted = true;
        bindInput();
        fitWorld();
        FLAP.best = readBest();
        renderLobby();
        show('lobby');
        refreshCloud();
        loadChallenges();
        /* Lazy weekly settlement: safe to call every time, idempotent in SQL. */
        if (canUseCloudBoard()) {
            try { sb.rpc('settle_flap_week'); } catch (e) { /* ignore */ }
        }
    }

    function stop() {
        stopRun();
        stopResultCat();
        closeMic();
        FLAP.paused = false;
        FLAP.duel.playing = false;
        exitFs();
        window.navFlapPlaying = false;
        const content = document.getElementById('fluency-flap-content');
        if (content) content.classList.remove('flap-live');
        const view = document.getElementById('fluency-flap-view');
        if (view) view.classList.remove('flap-playing');
        updateNav();
    }

    function open() {
        if (typeof changeView === 'function') changeView('fluency-flap-view');
    }

    /* Bind the app's own buttons. Inline onclick is not used here so the game
       keeps working even if a Tailwind CDN request fails. */
    function wireButtons() {
        const on = (id, fn) => {
            const node = el(id);
            if (node) node.addEventListener('click', fn);
        };
        on('lobby-start', () => show('mic'));
        on('start-voice', () => show('mic'));
        on('start-practice', () => startRun(true));
        on('to-mic', () => show('mic'));
        on('to-board', () => show('board'));
        on('to-rules', () => show('rules'));
        on('mic-start', () => startRun(false));
        on('mic-practice', () => startRun(true));
        on('mic-back', () => show('lobby'));
        on('rules-play', () => show('mic'));
        on('rules-back', () => show('lobby'));
        on('board-back', () => show('lobby'));
        on('quit', quitRun);
        on('pause-btn', pauseRun);
        on('pause-quit', quitRun);
        on('resume', resumeRun);
        on('r-again', () => {
            if (FLAP.tap) startRun(true);
            else show('mic');
        });
        on('r-board', () => show('board'));
        on('r-duel', () => show('duel'));
        on('r-lobby', () => show('lobby'));
        on('lobby-duel', () => show('duel'));
        on('d-back', () => show('lobby'));
        on('d-create', createChallenge);
        on('d-accept', acceptChallenge);
        on('d-play', playActiveChallenge);
        on('d-drop', () => cancelChallenge(FLAP.duel.active && FLAP.duel.active.id));
        on('d-copy', copyCreatedCode);
        on('d-refresh', loadChallenges);
        on('fs-btn', toggleFs);
        on('fs-lobby', toggleFs);
        on('r-fs', toggleFs);

        const codeInput = el('d-code-input');
        if (codeInput) {
            codeInput.addEventListener('input', () => {
                codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
            });
            codeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    acceptChallenge();
                }
            });
        }

        const dlist = el('d-list');
        if (dlist) {
            dlist.addEventListener('click', (e) => {
                const t = e.target;
                const play = t.closest ? t.closest('[data-duel-play]') : null;
                if (play) { beginChallenge(duelRow(play.getAttribute('data-duel-play'))); return; }
                const cancel = t.closest ? t.closest('[data-duel-cancel]') : null;
                if (cancel) { cancelChallenge(cancel.getAttribute('data-duel-cancel')); return; }
            });
        }
    }

    /* The view markup exists before this script runs, so wiring can happen
       immediately; mount() is still called by changeView(). */
    wireButtons();

    window.FLAP = {
        mount,
        stop,
        open,
        updateNav,
        startRun,
        finishRun,
        show,
        renderResult,
        state: FLAP,
        buildPools,
        pools: () => (POOLS || buildPools()).map((p) => p.length),
        weekStartKey,
        canUseCloudBoard,
        duelState: () => FLAP.duel,
        loadChallenges
    };
})();

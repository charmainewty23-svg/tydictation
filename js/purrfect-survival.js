/* LearniTY — Purr-fect Survival main module.
 *
 * Homepage tile -> create / join lobby -> Round 1 (Red Light, Green Light)
 * -> Round 2 (Glass Stepping Stones) -> mid-victory / spectator screen.
 *
 * Rooms use short polling (no Realtime publication), exactly like Drive &
 * Go!. The host creates the room, picks 1-2 rounds with an independent
 * subject/topic per round (plus round-1 metres and round-2 glass steps) and
 * starts it. Students join with a 4-character code and follow the host's
 * settings.
 */
(function (root) {
    'use strict';

    const PS = {};

    /* ------------------------------------------------------------------ */
    /* Constants / state                                                  */
    /* ------------------------------------------------------------------ */

    const POLL_WAITING_MS = 1200;
    const POLL_ACTIVE_MS = 700;
    const RESUME_PREFIX = 'learniTY_ps_resume:';
    const INTRO_SEEN_PREFIX = 'learniTY_ps_intro:';
    const VIEW_ID = 'purrfect-survival-view';
    const PS_ROUND_MS = 180000;
    const PS_INTRO_HOLD_MS = 15000;
    const ROOM_COLUMNS = 'id,code,host_id,status,subject,source,topic,bank_mode,seed,max_players,finish_distance,current_round,round1_started_at,round1_ends_at,round2_started_at,round2_ends_at,phase_schedule,glass_steps,settings,created_at,started_at,finished_at,server_now';

    let room = null;
    let players = [];
    let me = null;
    let questions = [];
    let glassSteps = [];
    let pollTimer = 0;
    let pollBusy = false;
    let rafId = 0;
    let lastFrame = 0;
    let lastPhaseKey = '';
    let lastHeartbeat = 0;
    let lastBang = 0;
    let busy = false;
    let answerLockUntil = 0;
    let lastRedSent = -1;
    let overlayAction = null;
    let shownKeys = {};
    let questionsKey = '';
    let lastAlive = 0;
    let audioCtx = null;
    let soundOn = true;
    let liveOn = false;
    let clockOffset = 0;
    let lastTickAt = 0;
    let introStart = 0;
    let introPlaying = false;
    let introSeen = {};
    let cueTimer = 0;
    let rulesPainted = false;

    /* ---- public demo (no login, no Supabase) -------------------------- */
    const DEMO_ROUND_MS = 120000;
    const DEMO_ROUND2_MS = 600000;
    const DEMO_BOT_COUNT = 24;
    const DEMO_VISITOR_ID = 'demo-you';
    const DEMO_TEACHER_ID = 'demo-teacher';
    const DEMO_SEED = 20261125;
    let demoMode = false;
    let demoRole = 'student';
    let demoSubject = 'vocab';
    let demoRoundCount = 2;
    let demoFinishDistance = 100;
    let demoGlassStepCount = 9;
    let demoLoopTimer = 0;
    let demoClassmates = [];
    let demoGlassPairs = [];
    let demoShieldInstalled = false;
    let demoPrevShowApp = null;
    let demoPrevShowLogin = null;

    try {
        soundOn = localStorage.getItem('learniTY_ps_sound') !== '0';
    } catch (e) { soundOn = true; }

    /* ------------------------------------------------------------------ */
    /* Small helpers                                                      */
    /* ------------------------------------------------------------------ */

    function $(id) {
        return document.getElementById(id);
    }

    function setText(id, text) {
        const el = $(id);
        if (el) el.textContent = text == null ? '' : String(text);
    }

    function show(id, on) {
        const el = $(id);
        if (el) el.classList.toggle('hidden', !on);
    }

    function escapeText(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function signedInUser() {
        return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
    }

    function isGuest() {
        return (typeof isGuestUser === 'function' && isGuestUser()) || !signedInUser();
    }

    function isHost() {
        const user = signedInUser();
        return !!(room && user && room.host_id === user.id);
    }

    function isTeacherHost() {
        return isHost() && typeof isAdmin === 'function' && isAdmin();
    }

    function myLook() {
        const s = (typeof DG !== 'undefined' && DG && DG.readSettings) ? DG.readSettings() : {};
        return {
            cat: s.cat || 'Ginger',
            glasses: s.glasses || 'None',
            hat: s.hat || 'None',
            outfit: s.outfit || 'None'
        };
    }

    function myNickname() {
        const user = signedInUser();
        if (!user) return 'Guest';
        const fullName = (user.user_metadata || {}).full_name || '';
        if (typeof displayName === 'function') {
            return displayName({ email: user.email, nickname: fullName });
        }
        return fullName || (user.email || 'Player').split('@')[0];
    }

    function isPlayingPlayer(p) {
        return !!(p && p.is_playing !== false);
    }

    function alivePlayers() {
        return players.filter(p => isPlayingPlayer(p) && p.status !== 'eliminated' && p.status !== 'out' && p.status !== 'advanced' && p.ghost !== true);
    }

    function totalPlayers() {
        return players.filter(isPlayingPlayer).length;
    }

    function myPlayer() {
        const user = signedInUser();
        if (!user) return null;
        return players.find(p => String(p.user_id) === String(user.id)) || null;
    }

    function roomRound() {
        return room ? Number(room.current_round) || (room.status === 'round2' ? 2 : 1) : 0;
    }

    function resumeKey() {
        const user = signedInUser();
        return RESUME_PREFIX + (user ? user.id : 'guest');
    }

    function saveResume() {
        if (demoMode) return;
        if (!room) return;
        try {
            localStorage.setItem(resumeKey(), JSON.stringify({
                roomId: room.id,
                code: room.code,
                at: Date.now()
            }));
        } catch (e) { /* ignore */ }
    }

    function clearResume() {
        if (demoMode) return;
        try { localStorage.removeItem(resumeKey()); } catch (e) { /* ignore */ }
    }

    function readResume() {
        if (demoMode) return null;
        try {
            const raw = localStorage.getItem(resumeKey());
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.roomId) return null;
            if (parsed.at && Date.now() - parsed.at > 7 * 24 * 60 * 60 * 1000) {
                localStorage.removeItem(resumeKey());
                return null;
            }
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function resolveRoundMs() {
        const settings = (room && room.settings) || {};
        const cfg = (typeof PSEngine !== 'undefined' && PSEngine.roundConfig)
            ? PSEngine.roundConfig(settings, 1, room)
            : null;
        const value = Number(cfg && cfg.roundMs) || Number(settings.roundMs) || PS_ROUND_MS;
        return Math.max(30000, Math.min(600000, value));
    }

    function roomRoundCount() {
        if (!room) return PSEngine.HOST.MAX_IMPLEMENTED;
        return PSEngine.roomRoundCount(room.settings || {});
    }

    function roundConfig(n) {
        if (!room) return null;
        return PSEngine.roundConfig(room.settings || {}, n, room);
    }

    function finishDistance() {
        const cfg = roundConfig(1);
        return cfg ? cfg.finishDistance : PSEngine.ROUND1.FINISH_DISTANCE;
    }

    function roundConfigLabel(cfg) {
        if (!cfg) return '';
        if (cfg.subject === 'grammar') {
            const topic = String(cfg.topic || 'tenses').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
            return 'Grammar · ' + topic + (cfg.bankMode ? ' · ' + cfg.bankMode : '');
        }
        return 'Vocab · ' + (cfg.vocabSource || cfg.topic || 'Vocab') + (cfg.vocabForm ? ' · ' + cfg.vocabForm : '');
    }

    function asArray(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    function schedule() {
        if (!room) return [];
        return asArray(room.phase_schedule);
    }

    /* ------------------------------------------------------------------ */
    /* Cinematic entrance (front-end only, no extra SQL)                  */
    /*                                                                    */
    /* While the room is waiting everybody watches the hallway -> stair   */
    /* maze -> held landing sequence drawn by PSRender. The intro is      */
    /* purely cosmetic: it never gates the room code, the player list or  */
    /* the host's Start button, and it is skipped the moment the server   */
    /* moves the room into round 1 or round 2.                            */
    /* ------------------------------------------------------------------ */

    const INTRO_HALL_MS = 6000;
    const INTRO_STAIRS_DONE_MS = 14400;

    function introSeenKey(roomId) {
        return INTRO_SEEN_PREFIX + (roomId || 'room');
    }

    function introRoomSeen(roomId) {
        if (!roomId) return true;
        if (introSeen[roomId]) return true;
        try {
            return sessionStorage.getItem(introSeenKey(roomId)) === '1';
        } catch (e) {
            return false;
        }
    }

    function markIntroSeen(roomId) {
        const id = roomId || (room && room.id);
        introPlaying = false;
        if (!id) return;
        introSeen[id] = true;
        try {
            sessionStorage.setItem(introSeenKey(id), '1');
        } catch (e) { /* storage can be unavailable in private mode */ }
    }

    function introElapsedMs() {
        if (!introPlaying || !introStart) return PS_INTRO_HOLD_MS;
        return Math.max(0, Date.now() - introStart);
    }

    function ensureIntro() {
        if (!room || room.status !== 'waiting' || introPlaying) return;
        if (!PS.shouldPlayIntro({ status: room.status, seen: introRoomSeen(room.id) })) {
            introPlaying = false;
            return;
        }
        introPlaying = true;
        introStart = Date.now();
    }

    PS.skipIntro = function () {
        if (!room) return;
        const wasPlaying = introPlaying;
        markIntroSeen(room.id);
        updateIntroChrome();
        if (wasPlaying) renderWaiting();
        if (wasPlaying && typeof updateMascot === 'function') {
            updateMascot('Replay skipped — read the rules and start when everyone is in.');
        }
    };

    PS.introElapsedMs = introElapsedMs;

    /* Pure helper: which beat of the entrance is showing. */
    PS.introStage = function (elapsedMs) {
        const ms = Math.max(0, Number(elapsedMs) || 0);
        if (ms < INTRO_HALL_MS) return 'hall';
        if (ms < INTRO_STAIRS_DONE_MS) return 'stairs';
        return 'hold';
    };

    /* Pure helper: the entrance only plays in a waiting room it has not
       already played in for this session. */
    PS.shouldPlayIntro = function (opts) {
        const o = opts || {};
        return o.status === 'waiting' && !o.seen;
    };

    function serverNow() {
        return Date.now() - clockOffset;
    }

    function syncClock() {
        if (!room || !room.server_now) return;
        const parsed = Date.parse(room.server_now);
        if (!isFinite(parsed)) return;
        const next = Date.now() - parsed;
        // Smooth the estimate so jittery network latency does not make the
        // light timer jump between polls.
        clockOffset = clockOffset ? clockOffset * 0.7 + next * 0.3 : next;
    }

    function phaseInfo() {
        if (!room || room.status !== 'round1' || !room.round1_started_at) return null;
        const start = Date.parse(room.round1_started_at);
        if (!isFinite(start)) return null;
        return PSEngine.phaseAt(schedule(), Math.max(0, serverNow() - start));
    }

    function phaseNow() {
        const info = phaseInfo();
        return info && !info.done ? info.phase : 'done';
    }

    function sqlHint() {
        return 'Run supabase/purrfect_survival_host_settings.sql in the Supabase SQL editor first (project mggnwzirjmibreimrwiq). Clear the editor first and do not re-run older incrementals, then reload this page.';
    }

    function errorMessage(error) {
        const m = (error && error.message) || (typeof error === 'string' ? error : 'Something went wrong.');
        if (m.includes('GUEST_NOT_ALLOWED')) return 'Guests cannot play Purr-fect Survival. Sign in with your school Google account.';
        if (m.includes('NOT_AUTHENTICATED')) return 'Please sign in with your school account first.';
        if (m.includes('ROOM_NOT_FOUND')) return 'No room with that code (or it has expired).';
        if (m.includes('ROOM_FULL')) return 'That room is full (30 students).';
        if (m.includes('ROOM_FINISHED')) return 'That room has already finished.';
        if (m.includes('ROOM_ALREADY_STARTED')) return 'That room has already started. Ask your teacher to open a new room.';
        if (m.includes('NOT_A_MEMBER')) return 'You are not in that room any more.';
        if (m.includes('NOT_HOST')) return 'Only the room host can do that.';
        if (m.includes('CANNOT_START')) return 'Wait for at least two players before starting.';
        if (m.includes('NO_QUESTIONS') || m.includes('NO_SCHEDULE') || m.includes('NO_GLASS') || m.includes('INVALID_SCHEDULE') || m.includes('INVALID_GLASS')) return 'The question set could not be built. Reload and try again.';
        if (m.includes('ROUNDS_NOT_IMPLEMENTED')) return 'Rounds 3–5 are not available yet. Choose 1 or 2 rounds.';
        if (m.includes('INVALID_ROUND_COUNT')) return 'Choose 1 or 2 rounds for this class.';
        if (m.includes('INVALID_SUBJECT')) return 'Pick Vocab or Grammar for that round.';
        if (m.includes('ONE_SUBJECT_ONLY')) return 'One subject per round — do not mix Vocab and Grammar inside the same round.';
        if (m.includes('MISSING_VOCAB_SOURCE')) return 'Choose the word bank for that round.';
        if (m.includes('INVALID_TOPIC')) return 'Choose a grammar topic for that round.';
        if (typeof isMissingSchema === 'function' && isMissingSchema(m)) return sqlHint();
        if (/does not exist|Could not find|PGRST20|42P01|schema cache/i.test(m)) return sqlHint();
        return m;
    }

    function setError(message) {
        const el = $('ps-error');
        if (el) {
            el.textContent = message || '';
            el.classList.toggle('hidden', !message);
        }
        if (message) updateMascot(message);
    }

    function toast(message) {
        const el = $('ps-feedback');
        if (el) el.textContent = message || '';
    }

    /* ------------------------------------------------------------------ */
    /* Audio (tiny Web Audio oscillator effects, no binary assets)         */
    /* ------------------------------------------------------------------ */

    function audio() {
        if (!soundOn) return null;
        try {
            if (!audioCtx) {
                const Ctx = root.AudioContext || root.webkitAudioContext;
                if (!Ctx) return null;
                audioCtx = new Ctx();
            }
            if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
            return audioCtx;
        } catch (e) {
            return null;
        }
    }

    function tone(freq, duration, type, volume, delay) {
        const ctx = audio();
        if (!ctx) return;
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const t0 = ctx.currentTime + (delay || 0);
            const dur = duration || 0.12;
            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freq, t0);
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume || 0.08), t0 + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t0);
            osc.stop(t0 + dur + 0.03);
        } catch (e) { /* ignore autoplay / audio failures */ }
    }

    function sfxGreen() {
        tone(660, 0.10, 'sine', 0.07);
        tone(990, 0.12, 'sine', 0.05, 0.08);
    }

    function sfxYellow() {
        tone(420, 0.09, 'square', 0.05);
    }

    function sfxRed() {
        tone(140, 0.20, 'sawtooth', 0.10);
        tone(80, 0.28, 'square', 0.08, 0.05);
    }

    function sfxCorrect() {
        tone(740, 0.09, 'sine', 0.08);
        tone(1180, 0.12, 'sine', 0.05, 0.06);
    }

    function sfxWrong() {
        tone(180, 0.12, 'triangle', 0.07);
    }

    function sfxShatter() {
        tone(920, 0.08, 'square', 0.05);
        tone(240, 0.22, 'sawtooth', 0.07, 0.02);
    }

    function sfxWin() {
        [520, 660, 780, 1040].forEach((f, i) => tone(f, 0.16, 'sine', 0.07, i * 0.09));
    }

    PS.toggleSound = function () {
        soundOn = !soundOn;
        try { localStorage.setItem('learniTY_ps_sound', soundOn ? '1' : '0'); } catch (e) { /* ignore */ }
        const btn = $('ps-sound-btn');
        if (btn) {
            btn.textContent = soundOn ? '🔊' : '🔇';
            btn.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Turn sound on');
        }
        if (soundOn) tone(660, 0.1, 'sine', 0.06);
    };

    /* ------------------------------------------------------------------ */
    /* Lobby setup                                                        */
    /* ------------------------------------------------------------------ */

    function roundId(round, name) {
        return 'ps-r' + (Number(round) || 1) + '-' + name;
    }

    function roundField(round, name) {
        return $(roundId(round, name));
    }

    function populateVocabSources(round) {
        const r = Number(round) || 1;
        const sel = roundField(r, 'vocab-source') || (r === 1 ? $('ps-vocab-source') : null);
        if (!sel) return;
        const keep = sel.value;
        const names = (typeof SHEET_NAMES !== 'undefined' ? SHEET_NAMES : [])
            .filter(name => (typeof categories !== 'undefined' && categories) ? (categories[name] || []).length : true);
        const opts = ['<option value="New Vocab">🆕 New Vocab</option>'];
        names.forEach(name => {
            opts.push('<option value="' + escapeText(name) + '">' + escapeText(typeof topicLabel === 'function' ? topicLabel(name) : name) + '</option>');
        });
        if (names.length === 0 && typeof SHEET_NAMES !== 'undefined') {
            SHEET_NAMES.forEach(name => {
                opts.push('<option value="' + escapeText(name) + '">' + escapeText(typeof topicLabel === 'function' ? topicLabel(name) : name) + '</option>');
            });
        }
        sel.innerHTML = opts.join('');
        if (keep && Array.from(sel.options).some(o => o.value === keep)) sel.value = keep;
        syncVocabForm(r);
    }

    function syncVocabForm(round) {
        const r = Number(round) || 1;
        const sourceSel = roundField(r, 'vocab-source') || (r === 1 ? $('ps-vocab-source') : null);
        const source = sourceSel ? sourceSel.value : 'New Vocab';
        show(roundId(r, 'vocab-form-wrap'), source === 'New Vocab');
        const sel = roundField(r, 'vocab-form') || (r === 1 ? $('ps-vocab-form') : null);
        if (!sel) return;
        const admin = typeof isAdmin === 'function' && isAdmin();
        if (admin) {
            const keep = sel.value;
            sel.innerHTML = '<option value="ALL">All forms</option>' + (typeof FORM_LEVELS !== 'undefined' ? FORM_LEVELS : [])
                .map(f => '<option value="' + escapeText(f.id) + '">' + escapeText(f.label) + '</option>').join('');
            sel.disabled = false;
            if (keep && Array.from(sel.options).some(o => o.value === keep)) sel.value = keep;
        } else {
            const own = typeof myFormValue !== 'undefined' && myFormValue
                ? myFormValue
                : (typeof ownDisplayedForm === 'function' ? ownDisplayedForm() : '');
            sel.innerHTML = own
                ? '<option value="' + escapeText(own) + '">' + escapeText(own) + '</option>'
                : '<option value="ALL">All forms</option>';
            sel.value = own || 'ALL';
            sel.disabled = !!own;
        }
    }

    function parseLook(look) {
        const o = look || {};
        const cat = typeof DG !== 'undefined' && DG && DG.normalizeLook ? DG.normalizeLook(o).cat : (o.cat || 'Ginger');
        return {
            cat: cat,
            glasses: o.glasses || 'None',
            hat: o.hat || 'None',
            outfit: o.outfit || 'None'
        };
    }

    function syncGrammarModes(round) {
        const r = Number(round) || 1;
        const topicSel = roundField(r, 'grammar-topic') || (r === 1 ? $('ps-grammar-topic') : null);
        const topic = topicSel ? topicSel.value : 'tenses';
        const sel = roundField(r, 'grammar-mode') || (r === 1 ? $('ps-grammar-mode') : null);
        if (!sel) return;
        const modes = (PSEngine.GRAMMAR_MODES[topic] || ['mixed']).slice();
        const labels = {
            av: 'Active voice',
            pv: 'Passive voice',
            mixed: 'Mixed',
            gapfill: 'Gap-fill',
            choose: 'Choose'
        };
        sel.innerHTML = modes.map(m => '<option value="' + escapeText(m) + '">' + escapeText(labels[m] || m) + '</option>').join('');
    }

    function syncSubjectFields(round) {
        const r = Number(round) || 1;
        const subjectSel = roundField(r, 'subject') || (r === 1 ? $('ps-subject') : null);
        const subject = subjectSel ? subjectSel.value : 'vocab';
        show(roundId(r, 'vocab-wrap'), subject === 'vocab');
        show(roundId(r, 'grammar-wrap'), subject === 'grammar');
        if (subject === 'vocab') syncVocabForm(r);
        else syncGrammarModes(r);
        if (r === 1) syncTeacherPlays();
    }

    function syncRoundCount() {
        const sel = $('ps-round-count');
        let count = Number(sel && sel.value);
        if (!isFinite(count)) count = PSEngine.HOST.MAX_IMPLEMENTED;
        count = Math.max(1, Math.min(PSEngine.HOST.MAX_IMPLEMENTED, Math.floor(count)));
        if (sel && String(sel.value) !== String(count)) sel.value = String(count);
        show('ps-round2-card', count >= 2);
        return count;
    }

    function syncTeacherPlays() {
        const teacher = typeof isAdmin === 'function' && isAdmin();
        show('ps-teacher-row', teacher);
        const box = $('ps-teacher-plays');
        if (box && !teacher) box.checked = true;
    }

    function populateLobby() {
        for (let r = 1; r <= PSEngine.HOST.MAX_IMPLEMENTED; r++) {
            populateVocabSources(r);
            syncGrammarModes(r);
            syncSubjectFields(r);
        }
        syncRoundCount();
        const soundBtn = $('ps-sound-btn');
        if (soundBtn) {
            soundBtn.textContent = soundOn ? '🔊' : '🔇';
            soundBtn.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Turn sound on');
        }
        const guest = isGuest();
        show('ps-guest-notice', guest);
        show('ps-room-actions', !guest);
        show('ps-host-note', !guest);
        if (guest) {
            setError('');
            updateMascot('Purr-fect Survival is for signed-in students. Sign in with your school Google account to play.');
        }
        renderRejoin();
    }

    function renderRejoin() {
        const saved = readResume();
        const banner = $('ps-rejoin-banner');
        if (!banner) return;
        if (demoMode || isGuest()) {
            banner.classList.add('hidden');
            return;
        }
        if (saved && (!room || room.id !== saved.roomId)) {
            banner.classList.remove('hidden');
            setText('ps-rejoin-code', saved.code || '----');
        } else {
            banner.classList.add('hidden');
        }
    }

    /* ------------------------------------------------------------------ */
    /* Room creation / joining                                            */
    /* ------------------------------------------------------------------ */

    function assertCanPlay() {
        if (isGuest()) {
            setError('Guests cannot create or join Purr-fect Survival. Sign in with your school Google account.');
            return false;
        }
        return true;
    }

    function selectValue(id, fallback) {
        const el = $(id);
        return el && el.value ? el.value : (fallback || '');
    }

    function readRoundSetup(round) {
        const r = Number(round) || 1;
        const subject = selectValue(roundId(r, 'subject'), 'vocab');
        if (subject === 'grammar') {
            return {
                round: r,
                subject: 'grammar',
                topic: selectValue(roundId(r, 'grammar-topic'), 'tenses'),
                bankMode: selectValue(roundId(r, 'grammar-mode'), 'mixed')
            };
        }
        return {
            round: r,
            subject: 'vocab',
            vocabSource: selectValue(roundId(r, 'vocab-source'), 'New Vocab'),
            vocabForm: selectValue(roundId(r, 'vocab-form'), '')
        };
    }

    PS.createRoom = async function () {
        if (demoMode) { PS.demoJump('round1'); return; }
        if (busy || !assertCanPlay()) return;
        setError('');
        const roundCount = syncRoundCount();
        const rounds = [];
        for (let r = 1; r <= roundCount; r++) rounds.push(readRoundSetup(r));

        const validated = PSEngine.validateHostSettings({
            roundCount: roundCount,
            finishDistance: selectValue('ps-finish-distance', '100'),
            glassSteps: selectValue('ps-glass-steps', '9'),
            rounds: rounds
        });
        if (!validated.ok) return setError(errorMessage(validated.error));

        const r1 = validated.rounds[0];
        busy = true;
        const btn = $('ps-create-btn');
        if (btn) btn.disabled = true;
        try {
            const teacher = typeof isAdmin === 'function' && isAdmin();
            const teacherPlays = teacher ? !!(el => el && el.checked)($('ps-teacher-plays')) : true;
            const seed = Math.floor(Math.random() * 2000000000) + 1;
            const settings = Object.assign({}, validated.settings, {
                vocabForm: r1.vocabForm || '',
                vocabSource: r1.vocabSource || '',
                grammarTopic: r1.subject === 'grammar' ? r1.topic : '',
                bankMode: r1.bankMode || ''
            });
            const { data, error } = await sb.rpc('create_purrfect_survival', {
                p_subject: r1.subject,
                p_source: r1.subject === 'vocab' ? r1.vocabSource : '',
                p_topic: r1.subject === 'grammar' ? r1.topic : r1.vocabSource,
                p_bank_mode: r1.bankMode || '',
                p_seed: seed,
                p_settings: settings,
                p_teacher_plays: teacherPlays,
                p_nickname: myNickname(),
                p_look: myLook()
            });
            if (error) return setError(errorMessage(error));
            const created = Array.isArray(data) ? data[0] : data;
            if (!created || !created.id) return setError('Could not open that room.');
            adoptRoom(created);
        } finally {
            busy = false;
            if (btn) btn.disabled = false;
        }
    };

    PS.joinRoom = async function () {
        if (demoMode) { PS.demoJump('round1'); return; }
        if (busy || !assertCanPlay()) return;
        const input = $('ps-join-code');
        const code = (input && input.value ? input.value : '').trim().toUpperCase();
        if (code.length !== 4) return setError('Enter the 4-character room code.');
        setError('');
        busy = true;
        const btn = $('ps-join-btn');
        if (btn) btn.disabled = true;
        try {
            const { data, error } = await sb.rpc('join_purrfect_survival', {
                p_code: code,
                p_nickname: myNickname(),
                p_look: myLook()
            });
            if (error) return setError(errorMessage(error));
            const joined = Array.isArray(data) ? data[0] : data;
            if (!joined || !joined.id) return setError('Could not join that room.');
            if (input) input.value = '';
            adoptRoom(joined);
        } finally {
            busy = false;
            if (btn) btn.disabled = false;
        }
    };

    PS.rejoin = async function () {
        if (demoMode) { PS.demoJump('lobby'); return; }
        if (busy || !assertCanPlay()) return;
        const saved = readResume();
        if (!saved || !saved.roomId) return;
        setError('');
        busy = true;
        try {
            const { data, error } = await sb.rpc('rejoin_purrfect_survival', { p_room_id: saved.roomId });
            if (error) {
                clearResume();
                renderRejoin();
                return setError(errorMessage(error));
            }
            const joined = Array.isArray(data) ? data[0] : data;
            if (!joined || !joined.id) return setError('That room is no longer available.');
            adoptRoom(joined);
        } finally {
            busy = false;
        }
    };

    function adoptRoom(next) {
        room = next;
        questions = asArray(room.questions);
        glassSteps = asArray(room.glass_steps);
        lastRedSent = -1;
        lastPhaseKey = '';
        questionsKey = '';
        shownKeys = {};
        busy = false;
        introPlaying = false;
        // Late joiners / rejoiners drop straight into the live arena; only a
        // freshly waiting room plays the entrance.
        if (room.status !== 'waiting') markIntroSeen(room.id);
        PS.hideOverlay();
        saveResume();
        renderRejoin();
        startPolling();
        render();
        poll(true);
    }

    /* ------------------------------------------------------------------ */
    /* Polling                                                            */
    /* ------------------------------------------------------------------ */

    function pollDelay() {
        if (!room) return POLL_WAITING_MS;
        return (room.status === 'round1' || room.status === 'round2') ? POLL_ACTIVE_MS : POLL_WAITING_MS;
    }

    function startPolling() {
        stopPolling();
        if (demoMode) return;
        pollTimer = setInterval(poll, pollDelay());
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = 0;
        }
    }

    function retunePolling() {
        if (!pollTimer) return;
        const wanted = pollDelay();
        stopPolling();
        pollTimer = setInterval(poll, wanted);
    }

    async function poll(force) {
        if (demoMode) return;
        if (!room || pollBusy || isGuest()) return;
        if (typeof currentView !== 'undefined' && currentView !== VIEW_ID) return;
        pollBusy = true;
        try {
            if (room.status === 'round1' || room.status === 'round2') {
                // The host ticks every poll; students tick at most every
                // 1.5 s so 30 phones do not hammer the room row.
                if (isHost() || Date.now() - lastTickAt > 1500) {
                    lastTickAt = Date.now();
                    const tick = await sb.rpc('tick_purrfect_survival', { p_room_id: room.id });
                    if (tick && tick.error) {
                        const m = tick.error.message || '';
                        if (/does not exist|Could not find|PGRST20|42P01|schema cache/i.test(m)) {
                            setError(sqlHint());
                            stopPolling();
                            return;
                        }
                    } else if (tick && tick.data) {
                        room = Array.isArray(tick.data) ? tick.data[0] : tick.data;
                        syncClock();
                    }
                }
            }

            const columns = questions.length ? ROOM_COLUMNS : ROOM_COLUMNS + ',questions';
            const { data, error } = await sb.from('purrfect_survival_rooms')
                .select(columns)
                .eq('id', room.id)
                .maybeSingle();
            if (error || !data) {
                roomGone();
                return;
            }
            room = data;
            syncClock();
            const fetchedQuestions = asArray(room.questions);
            if (fetchedQuestions.length) questions = fetchedQuestions;
            glassSteps = asArray(room.glass_steps);

            const result = await sb.from('purrfect_survival_players')
                .select('*')
                .eq('room_id', room.id);
            if (!result.error) players = result.data || [];
            me = myPlayer();

            if (typeof currentView !== 'undefined' && currentView !== VIEW_ID) return;

            if (room.status === 'finished') {
                saveResume();
            } else {
                saveResume();
            }
            retunePolling();
            render();
        } catch (e) {
            console.warn('Purr-fect Survival poll failed:', e && e.message ? e.message : e);
        } finally {
            pollBusy = false;
        }
    }

    function roomGone() {
        room = null;
        players = [];
        me = null;
        questions = [];
        glassSteps = [];
        introPlaying = false;
        stopPolling();
        setLive(false);
        clearResume();
        setPanel('lobby');
        show('ps-code-chip', false);
        renderRejoin();
        setError('That room was closed.');
    }

    /* ------------------------------------------------------------------ */
    /* Panels / full-screen                                               */
    /* ------------------------------------------------------------------ */

    function setPanel(name) {
        show('ps-lobby', name === 'lobby');
        const liveStage = name === 'waiting' || name === 'game';
        show('ps-game', liveStage);
        show('ps-cine', name === 'waiting');
        const stage = $('ps-stage');
        if (stage) stage.classList.toggle('ps-stage-waiting', name === 'waiting');
        if (name === 'waiting') {
            show('ps-question', false);
            const overlay = $('ps-round-overlay');
            if (overlay) overlay.classList.add('hidden');
        }
    }

    function setLive(on) {
        liveOn = !!on;
        const view = $(VIEW_ID);
        if (view) view.classList.toggle('ps-live', liveOn);
        document.body.classList.toggle('ps-live-body', liveOn);
        root.navPurrfectLive = liveOn;
        if (typeof updateBottomNav === 'function') updateBottomNav();
        if (liveOn) requestAnimationFrame(() => { resizeCanvas(); startFrames(); });
        else stopFrames();
    }

    PS.backToHub = function () {
        if (demoMode) { PS.hideOverlay(); PS.demoJump('lobby'); return; }
        const keep = room;
        PS.stop();
        if (typeof changeView === 'function') changeView('hub-view');
        if (keep) renderRejoin();
    };

    /* ------------------------------------------------------------------ */
    /* Waiting room                                                       */
    /* ------------------------------------------------------------------ */

    function paintCineRules() {
        if (rulesPainted) return;
        const r1en = $('ps-cine-rule1-en');
        const r1zh = $('ps-cine-rule1-zh');
        const r2en = $('ps-cine-rule2-en');
        const r2zh = $('ps-cine-rule2-zh');
        if (!r1en || !r2en) return;
        const en = (typeof PSEngine !== 'undefined' && PSEngine.RULE_TEXT) ? PSEngine.RULE_TEXT : null;
        const zh = (typeof PSEngine !== 'undefined' && PSEngine.RULE_TEXT_ZH) ? PSEngine.RULE_TEXT_ZH : null;
        r1en.textContent = en ? en.round1 : '';
        r1zh.textContent = zh ? zh.round1 : '';
        r2en.textContent = en ? en.round2 : '';
        r2zh.textContent = zh ? zh.round2 : '';
        rulesPainted = true;
    }

    function updateIntroChrome() {
        if (!room || room.status !== 'waiting') return;
        const elapsed = introElapsedMs();
        const revealAll = !introPlaying;
        const r1 = $('ps-cine-rule1');
        const r2 = $('ps-cine-rule2');
        const playRound2 = roomRoundCount() > 1;
        if (r1) r1.classList.toggle('is-in', revealAll || elapsed >= 6800);
        if (r2) {
            r2.classList.toggle('hidden', !playRound2);
            r2.classList.toggle('is-in', playRound2 && (revealAll || elapsed >= 10800));
        }
        const skip = $('ps-intro-skip');
        if (skip) skip.classList.toggle('hidden', !introPlaying);
        const cine = $('ps-cine');
        if (cine) cine.classList.toggle('is-briefing', introPlaying && elapsed >= 5800);
        if (introPlaying && elapsed >= INTRO_STAIRS_DONE_MS) {
            markIntroSeen(room.id);
            updateIntroChrome();
        }
    }

    function renderWaiting() {
        setPanel('waiting');
        ensureIntro();
        setLive(true);
        paintCineRules();

        setText('ps-code', room.code || '----');
        const total = totalPlayers();
        setText('ps-player-count', total + ' player' + (total === 1 ? '' : 's') + ' joined');
        const count = roomRoundCount();
        const r1 = roundConfig(1);
        const r2 = roundConfig(2);
        const meta = count === 1
            ? '1 round · ' + roundConfigLabel(r1) + ' · ' + r1.finishDistance + ' m'
            : '2 rounds · R1 ' + roundConfigLabel(r1) + ' · ' + r1.finishDistance + ' m'
                + ' · R2 ' + roundConfigLabel(r2) + ' · ' + r2.glassSteps + ' steps';
        setText('ps-room-meta', meta);
        const list = $('ps-player-list');
        if (list) {
            list.innerHTML = players.filter(isPlayingPlayer).map((p) => {
                const name = escapeText(String(p.nickname || p.email || 'Player').split('@')[0]);
                const isHostPlayer = room && String(p.user_id) === String(room.host_id);
                const mine = signedInUser() && String(p.user_id) === String(signedInUser().id);
                return '<div class="ps-player-chip ps-cine-chip' + (mine ? ' ps-cine-chip-me' : '') + '">' +
                    '<span class="ps-player-cat">🐱</span><span>' + name + '</span>' +
                    (isHostPlayer ? '<span class="ps-host-tag">HOST</span>' : '') + '</div>';
            }).join('');
        }
        const host = isHost();
        const enough = totalPlayers() >= 2;
        const start = $('ps-start-btn');
        if (start) start.classList.toggle('hidden', !host);
        if (start) start.disabled = !enough || busy;
        const msg = $('ps-wait-msg');
        if (msg) {
            msg.textContent = host
                ? (enough ? 'Everyone in? Start Round 1 when ready — the cinematic will cut straight into the field.' : 'Waiting for at least one more player…')
                : 'Waiting for the host to start…';
        }
        const end = $('ps-host-end');
        if (end) end.classList.add('hidden');

        updateIntroChrome();
        requestAnimationFrame(() => { resizeCanvas(); startFrames(); });
    }

    /* ------------------------------------------------------------------ */
    /* Game rendering                                                     */
    /* ------------------------------------------------------------------ */

    function render() {
        if (!room) {
            setPanel('lobby');
            setLive(false);
            show('ps-code-chip', false);
            renderRejoin();
            return;
        }
        if (room.status === 'waiting') {
            renderWaiting();
            return;
        }
        if (introPlaying) markIntroSeen(room.id);
        setPanel('game');
        setLive(room.status === 'round1' || room.status === 'round2');
        const isR2 = roomRound() === 2;
        setText('ps-hud-round', isR2 ? 'ROUND 2 · GLASS BRIDGE' : 'ROUND 1 · 1-2-3 Meow!');
        setText('ps-hud-rule', isR2 ? PSEngine.RULE_TEXT.round2 : PSEngine.RULE_TEXT.round1);
        const alive = alivePlayers().length;
        const total = totalPlayers();
        setText('ps-hud-alive', 'Alive: ' + alive + ' / ' + total);
        lastAlive = alive;
        const codeChip = $('ps-code-chip');
        if (codeChip) {
            codeChip.classList.remove('hidden');
            codeChip.textContent = 'Room ' + (room.code || '----');
        }
        const host = isHost();
        show('ps-host-end', host && !isR2);
        if (me && isPlayingPlayer(me)) renderPlayerQuestion(isR2);
        else renderSpectator(isR2);
        checkMilestones();
        requestAnimationFrame(() => startFrames());
    }

    function renderSpectator(isR2) {
        if (!me || (demoMode && !isPlayingPlayer(me))) {
            // Teacher / host spectating with no player seat: keep the whole
            // track or bridge unobstructed.
            show('ps-question', false);
            return;
        }
        show('ps-question', true);
        setText('ps-prompt', isR2 ? 'Live class view' : 'Live class view');
        const opts = $('ps-options');
        if (opts) opts.innerHTML = '';
        toast(isR2
            ? 'Watching the glass bridge — ' + alivePlayers().length + ' still standing.'
            : 'Watching the race — ' + alivePlayers().length + ' still running.');
    }

    function renderPlayerQuestion(isR2) {
        const box = $('ps-question');
        if (!box) return;
        box.classList.remove('hidden');
        if (me.status === 'eliminated' || me.ghost) {
            setText('ps-prompt', '👻 You are out — but you can watch your classmates.');
            const opts = $('ps-options');
            if (opts) opts.innerHTML = '';
            toast('Eliminated. Stay and watch the rest of the class.');
            return;
        }
        if (isR2) renderGlassTurn();
        else renderRound1Question();
    }

    function renderRound1Question() {
        const qIndex = (Number(me.question_index) || 0) % Math.max(1, questions.length);
        const q = questions[qIndex];
        if (!q) {
            setText('ps-prompt', 'Loading the question set…');
            const opts = $('ps-options');
            if (opts) opts.innerHTML = '';
            return;
        }
        if (me.reached_finish) {
            setText('ps-prompt', '🏁 You reached ' + finishDistance() + ' m!'
                + (roomRoundCount() > 1 ? ' You are through to the glass bridge.' : ''));
            const opts = $('ps-options');
            if (opts) opts.innerHTML = '';
            toast(roomRoundCount() > 1
                ? 'Wait for the round to end — first 15 survivors cross.'
                : 'Wait for the round to end — every survivor wins this class.');
            return;
        }
        const key = 'r1:' + qIndex + ':' + (q.options || []).join('|');
        if (key !== questionsKey) {
            questionsKey = key;
            setText('ps-prompt', q.prompt || '');
            const opts = $('ps-options');
            if (opts) {
                opts.innerHTML = (q.options || []).map((label, i) =>
                    '<button type="button" class="ps-opt" data-choice="' + i + '" onclick="PS.answer(' + i + ')">' +
                    '<span class="ps-opt-key">' + (i + 1) + '</span>' +
                    '<span class="ps-opt-text">' + escapeText(label) + '</span>' +
                    '</button>'
                ).join('');
            }
        }
        const opts = $('ps-options');
        if (opts) opts.classList.remove('ps-options-glass');
    }

    function renderGlassTurn() {
        const steps = Math.max(1, Number(glassSteps.length) || PSEngine.ROUND2.STEP_COUNT);
        if (me.crossed_glass || me.status === 'advanced') {
            setText('ps-prompt', '🎉 You crossed the glass bridge. Round 3 is coming soon.');
            const opts = $('ps-options');
            if (opts) opts.innerHTML = '';
            toast('Survivor! Stay for the mid-victory screen.');
            return;
        }
        if (!me.glass_active) {
            const queue = PSEngine.glassQueueOrder(players.filter(p => isPlayingPlayer(p)));
            const pos = queue.findIndex(p => String(p.user_id) === String(me.user_id));
            setText('ps-prompt', pos >= 0
                ? 'You are #' + (pos + 1) + ' in the queue. Watch the panes the classmates ahead reveal.'
                : 'Watching the bridge.');
            const opts = $('ps-options');
            if (opts) opts.innerHTML = '';
            toast('Waiting for your turn at the glass bridge.');
            return;
        }
        const stepIndex = Math.max(0, Number(me.glass_step) || 0);
        const step = glassSteps[stepIndex];
        if (!step) {
            setText('ps-prompt', 'Waiting for the next pane…');
            const opts = $('ps-options');
            if (opts) opts.innerHTML = '';
            return;
        }
        const key = 'r2:' + stepIndex + ':' + step.left + '|' + step.right + ':' + (step.revealed ? step.revealed_side : '');
        if (key !== questionsKey) {
            questionsKey = key;
            setText('ps-prompt', (step.prompt ? step.prompt + '  ' : '') + 'Pick the tempered pane!');
            const opts = $('ps-options');
            if (opts) {
                opts.classList.add('ps-options-glass');
                const revealLeft = step.revealed_side === 'left';
                const revealRight = step.revealed_side === 'right';
                opts.innerHTML =
                    '<button type="button" class="ps-opt ps-glass-opt' + (revealLeft ? ' ps-glass-safe' : '') + '" data-choice="0" onclick="PS.jump(\'left\')">' +
                    '<span class="ps-opt-key">←</span><span class="ps-opt-text">' + escapeText(step.left) + '</span></button>' +
                    '<button type="button" class="ps-opt ps-glass-opt' + (revealRight ? ' ps-glass-safe' : '') + '" data-choice="1" onclick="PS.jump(\'right\')">' +
                    '<span class="ps-opt-key">1</span><span class="ps-opt-text">' + escapeText(step.right) + '</span></button>';
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* HUD / canvas frames                                                */
    /* ------------------------------------------------------------------ */

    function startFrames() {
        if (rafId) return;
        if (!room) return;
        if (room.status !== 'waiting' && room.status !== 'round1' && room.status !== 'round2') return;
        lastFrame = 0;
        rafId = requestAnimationFrame(frame);
    }

    function stopFrames() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
    }

    function resizeCanvas() {
        const canvas = $('ps-canvas');
        const stage = $('ps-stage');
        if (!canvas || !stage) return null;
        const w = Math.max(1, stage.clientWidth);
        const h = Math.max(1, stage.clientHeight);
        const dpr = Math.min(2, root.devicePixelRatio || 1);
        const pw = Math.round(w * dpr);
        const ph = Math.round(h * dpr);
        if (canvas.width !== pw || canvas.height !== ph) {
            canvas.width = pw;
            canvas.height = ph;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx: ctx, w: w, h: h, dpr: dpr };
    }

    function frame(ts) {
        rafId = 0;
        if (typeof currentView !== 'undefined' && currentView !== VIEW_ID) return;
        if (!room) return;
        const waiting = room.status === 'waiting';
        const playing = room.status === 'round1' || room.status === 'round2';
        if (!waiting && !playing) return;

        // Canvas art at ~30 fps keeps 30 cats smooth on phones; the DOM HUD
        // and phase sounds still update on every animation frame.
        if (!lastFrame || ts - lastFrame >= 30) {
            const surface = resizeCanvas();
            if (surface) {
                const isR2 = room.status === 'round2';
                const info = isR2 ? null : phaseInfo();
                const state = {
                    mode: waiting ? 'intro' : 'round',
                    round: waiting ? 0 : (isR2 ? 2 : 1),
                    introElapsed: waiting ? introElapsedMs() : 0,
                    role: (isHost() && (!me || !isPlayingPlayer(me))) ? 'host' : 'player',
                    w: surface.w,
                    h: surface.h,
                    dpr: surface.dpr,
                    players: players,
                    meId: me ? me.user_id : '',
                    finishDistance: room.finish_distance || finishDistance(),
                    phase: info && !info.done ? info.phase : (isR2 ? 'green' : 'done'),
                    phaseElapsed: info ? info.elapsed_ms : 0,
                    phaseDuration: info ? info.duration_ms : 2000,
                    elapsed: room.round1_started_at ? Math.max(0, serverNow() - Date.parse(room.round1_started_at)) : 0,
                    now: (root.performance && root.performance.now) ? root.performance.now() : Date.now(),
                    bang: Math.max(0, 1 - (Date.now() - lastBang) / 420),
                    glassSteps: glassSteps,
                    stepCount: glassSteps.length || PSEngine.ROUND2.STEP_COUNT
                };
                if (typeof PSRender !== 'undefined' && PSRender.drawScene) {
                    PSRender.drawScene(surface.ctx, state);
                }
            }
            lastFrame = ts;
        }

        if (waiting) {
            updateIntroChrome();
        } else {
            updateHud();
            handlePhaseSound();
        }
        rafId = requestAnimationFrame(frame);
    }

    function updateHud() {
        if (!room) return;
        const alive = alivePlayers().length;
        setText('ps-hud-alive', 'Alive: ' + alive + ' / ' + totalPlayers());

        if (room.status === 'round1') {
            const info = phaseInfo();
            const phase = info && !info.done ? info.phase : 'done';
            setText('ps-hud-you', me && isPlayingPlayer(me)
                ? (me.reached_finish ? '🏁 ' + finishDistance() + ' m' : 'You: ' + (Number(me.distance) || 0) + ' / ' + finishDistance() + ' m')
                : 'Spectating');
            const labels = {
                green: '🟢 GREEN — RUN!',
                yellow: '🟡 YELLOW — HEADS TURNING',
                red: '🔴 RED — FREEZE!',
                done: '⏹ ROUND OVER'
            };
            setText('ps-hud-phase', labels[phase] || labels.green);
            const hudPhase = $('ps-hud-phase');
            if (hudPhase) {
                hudPhase.className = 'ps-phase ps-phase-' + phase;
            }
            const ends = room.round1_ends_at ? Date.parse(room.round1_ends_at) : 0;
            setText('ps-hud-timer', ends ? PSEngine.formatClock(ends - serverNow()) : '—');
            const opts = $('ps-options');
            if (opts) opts.classList.toggle('ps-options-red', phase === 'red');
            const prompt = $('ps-prompt');
            if (prompt && me && isPlayingPlayer(me) && phase === 'red' && me.status !== 'eliminated' && !me.reached_finish) {
                prompt.dataset.red = '1';
            } else if (prompt) {
                delete prompt.dataset.red;
            }
        } else if (room.status === 'round2') {
            setText('ps-hud-phase', '🧊 GLASS BRIDGE');
            const hudPhase = $('ps-hud-phase');
            if (hudPhase) hudPhase.className = 'ps-phase ps-phase-glass';
            setText('ps-hud-you', me && isPlayingPlayer(me)
                ? (me.crossed_glass || me.status === 'advanced'
                    ? '🏁 Crossed'
                    : (me.glass_active ? 'Step ' + (Number(me.glass_step) || 0) + ' / ' + (glassSteps.length || 9) : 'Queued'))
                : 'Spectating');
            if (me && me.glass_active && me.glass_started_at) {
                const left = PSEngine.glassWindowRemaining(me.glass_started_at, serverNow());
                setText('ps-hud-timer', '⏱ ' + (left / 1000).toFixed(1) + 's');
            } else {
                const ends = room.round2_ends_at ? Date.parse(room.round2_ends_at) : 0;
                setText('ps-hud-timer', ends ? PSEngine.formatClock(ends - serverNow()) : '—');
            }
        }
    }

    function handlePhaseSound() {
        if (room.status !== 'round1') return;
        const info = phaseInfo();
        if (!info || info.done) return;
        const key = info.phase + ':' + info.index;
        if (key !== lastPhaseKey) {
            lastPhaseKey = key;
            if (info.phase === 'green') sfxGreen();
            else if (info.phase === 'yellow') sfxYellow();
            else if (info.phase === 'red') sfxRed();
        }
        if (info.phase === 'yellow') {
            const now = Date.now();
            if (!lastHeartbeat || now - lastHeartbeat > 520) {
                lastHeartbeat = now;
                tone(90, 0.09, 'sine', 0.06);
                tone(70, 0.10, 'sine', 0.04, 0.16);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Round 1 actions                                                    */
    /* ------------------------------------------------------------------ */

    function currentQuestionPhase() {
        const info = phaseInfo();
        return info && !info.done ? info : null;
    }

    async function redPress() {
        if (demoMode) { demoRedPress(); return; }
        if (busy || !room || room.status !== 'round1' || !me || me.status === 'eliminated' || me.ghost) return;
        const info = currentQuestionPhase();
        if (!info || info.phase !== 'red') {
            if (info && (info.phase === 'green' || info.phase === 'yellow')) toast('Go! Answer with 1–4.');
            return;
        }
        if (lastRedSent === info.index || Number(me.last_red_phase) === info.index) {
            toast('Wait for the green light — one hit per red phase.');
            return;
        }
        lastRedSent = info.index;
        busy = true;
        lastBang = Date.now();
        sfxRed();
        try {
            const { data, error } = await sb.rpc('submit_purrfect_survival_answer', {
                p_room_id: room.id,
                p_choice: -1
            });
            if (error) return setError(errorMessage(error));
            const res = Array.isArray(data) ? data[0] : data;
            if (res && res.player) {
                me = res.player;
                const idx = players.findIndex(p => String(p.user_id) === String(me.user_id));
                if (idx >= 0) players[idx] = me;
            }
            if (res && res.ignored) {
                toast('Hold still — wait for the green light.');
            } else if (res && res.eliminated) {
                toast('🔴 Laser hit — one more move and you are out!');
                renderPlayerQuestion(false);
                showEliminatedOverlay();
            } else if (res && res.penalty) {
                toast('🔴 Laser hit! ' + res.penalty + ' m. Get ready for the green light.');
            }
        } finally {
            busy = false;
        }
    }

    PS.answer = async function (choice) {
        if (demoMode) { demoAnswer(choice); return; }
        if (busy || !room || room.status !== 'round1' || !me || !isPlayingPlayer(me)) return;
        if (me.status === 'eliminated' || me.ghost || me.reached_finish) return;
        if (Date.now() < answerLockUntil) return;
        const info = currentQuestionPhase();
        if (!info) return;
        if (info.phase === 'red' || info.done) {
            return redPress();
        }
        if (!PSEngine.isAnswerPhase(info.phase)) return;

        busy = true;
        answerLockUntil = Date.now() + 260;
        const opts = $('ps-options');
        if (opts) opts.classList.add('ps-options-busy');
        try {
            const { data, error } = await sb.rpc('submit_purrfect_survival_answer', {
                p_room_id: room.id,
                p_choice: Number(choice) || 0
            });
            if (error) {
                setError(errorMessage(error));
                return;
            }
            const res = Array.isArray(data) ? data[0] : data;
            if (res && res.player) {
                me = res.player;
                const idx = players.findIndex(p => String(p.user_id) === String(me.user_id));
                if (idx >= 0) players[idx] = me;
            }
            if (res && res.correct) {
                sfxCorrect();
                toast('✅ +10 m! (' + (me ? me.distance : 0) + ' / ' + (room.finish_distance || finishDistance()) + ' m)');
                if (me && me.reached_finish) showFinishOverlay();
            } else if (res && res.ok === false) {
                toast('Too early — the round is not running.');
            } else {
                sfxWrong();
                const optsEl = $('ps-options');
                if (optsEl) {
                    optsEl.classList.add('ps-options-wrong');
                    setTimeout(() => optsEl.classList.remove('ps-options-wrong'), 340);
                }
                toast('❌ Not this one — next question.');
            }
            renderPlayerQuestion(false);
        } finally {
            busy = false;
            if (opts) opts.classList.remove('ps-options-busy');
        }
    };

    /* ------------------------------------------------------------------ */
    /* Round 2 actions                                                    */
    /* ------------------------------------------------------------------ */

    PS.jump = async function (side) {
        if (demoMode) { demoGlassJump(side); return; }
        if (busy || !room || room.status !== 'round2' || !me || !isPlayingPlayer(me)) return;
        if (!me.glass_active || me.status !== 'alive') return;
        if (side !== 'left' && side !== 'right') return;
        busy = true;
        try {
            const { data, error } = await sb.rpc('glass_jump_purrfect_survival', {
                p_room_id: room.id,
                p_side: side
            });
            if (error) return setError(errorMessage(error));
            const res = Array.isArray(data) ? data[0] : data;
            if (!res) return;
            if (res.ok === false) {
                if (res.error === 'NOT_YOUR_TURN') toast('Wait for your turn.');
                return;
            }
            if (res.player) {
                me = res.player;
                const idx = players.findIndex(p => String(p.user_id) === String(me.user_id));
                if (idx >= 0) players[idx] = me;
            }
            if (res.room) {
                room = res.room;
                glassSteps = asArray(room.glass_steps).length ? asArray(room.glass_steps) : glassSteps;
                questions = asArray(room.questions).length ? asArray(room.questions) : questions;
            }
            if (res.outcome === 'correct') {
                sfxCorrect();
                if (res.finished_bridge || (me && me.crossed_glass)) {
                    sfxWin();
                    showSurvivedOverlay();
                } else {
                    toast('✅ Tempered pane! Step ' + (Number(me.glass_step) || 0) + ' cleared.');
                }
            } else if (res.outcome === 'wrong') {
                sfxShatter();
                toast('💥 Normal glass! You fell — the correct pane is lit for the class.');
                showGlassOutOverlay('💥 You fell', 'The pane shattered. The correct side is now lit for the classmates behind you.');
            } else if (res.outcome === 'timeout') {
                sfxShatter();
                toast('⏱ Time up! No jump — you fell.');
                showGlassOutOverlay('⏱ No jump', 'The 5-second window closed and you fell. The correct pane was not revealed.');
            }
            questionsKey = '';
            renderPlayerQuestion(true);
        } finally {
            busy = false;
        }
    };

    function showGlassOutOverlay(title, body) {
        PS.showOverlay(title || 'You are out', body || 'You can stay and watch the rest of the class.', '👻', 'Watch the bridge');
    }

    /* ------------------------------------------------------------------ */
    /* Host controls                                                      */
    /* ------------------------------------------------------------------ */

    PS.startRound1 = async function () {
        if (demoMode) { PS.demoJump('round1'); return; }
        if (busy || !room || room.status !== 'waiting' || !isHost()) return;
        if (totalPlayers() < 2) return setError('Wait for at least two players before starting.');
        setError('');
        busy = true;
        const btn = $('ps-start-btn');
        if (btn) btn.disabled = true;
        try {
            const built = await buildQuestionSet();
            if (!built) return;
            const seed = Number(room.seed) || 1;
            const roundMs = resolveRoundMs();
            const glass = built.roundCount > 1
                ? PSEngine.buildGlassSteps({
                    pairs: built.glassPairs,
                    seed: seed + 17,
                    count: PSEngine.normalizeGlassSteps(built.round2.glassSteps)
                })
                : [];
            const phaseSchedule = PSEngine.buildPhaseSchedule(seed, { roundMs: roundMs });
            const { data, error } = await sb.rpc('start_purrfect_survival', {
                p_room_id: room.id,
                p_questions: built.questions,
                p_glass: glass,
                p_schedule: phaseSchedule,
                p_round_ms: roundMs
            });
            if (error) return setError(errorMessage(error));
            const started = Array.isArray(data) ? data[0] : data;
            if (started && started.id) room = started;
            syncClock();
            questions = asArray(room.questions);
            glassSteps = asArray(room.glass_steps);
            lastPhaseKey = '';
            lastRedSent = -1;
            overlayAction = null;
            hideOverlay();
            markIntroSeen(room.id);
            render();
            retunePolling();
            poll(true);
        } finally {
            busy = false;
            if (btn) btn.disabled = false;
        }
    };

    PS.endRound1Now = async function () {
        if (demoMode) { demoEndRound1(); render(); return; }
        if (busy || !room || !isHost() || room.status !== 'round1') return;
        const count = roomRoundCount();
        const message = count === 1
            ? 'End 1-2-3 Meow! now? The game will finish and every surviving student wins.'
            : 'End Round 1 now and move the first 15 survivors to the glass bridge?';
        if (typeof window.confirm === 'function' && !window.confirm(message)) return;
        busy = true;
        try {
            const { data, error } = await sb.rpc('end_purrfect_survival_round1', { p_room_id: room.id });
            if (error) return setError(errorMessage(error));
            const updated = Array.isArray(data) ? data[0] : data;
            if (updated && updated.id) room = updated;
            poll(true);
        } finally {
            busy = false;
        }
    };

    PS.startRound2Now = PS.endRound1Now;

    /* ------------------------------------------------------------------ */
    /* Bank loading / question building                                   */
    /* ------------------------------------------------------------------ */

    function waitForSheet(timeoutMs) {
        return new Promise(resolve => {
            const started = Date.now();
            const tick = () => {
                if (typeof sheetCategoriesLoading === 'undefined' || !sheetCategoriesLoading) return resolve();
                if (Date.now() - started > (timeoutMs || 15000)) return resolve();
                setTimeout(tick, 120);
            };
            tick();
        });
    }

    async function loadVocabWords(source, form) {
        const src = String(source || (room && (room.source || room.topic)) || '').trim();
        const looksNew = src === 'New Vocab' || src === 'new_vocab';
        if (!looksNew) {
            if (typeof categories === 'undefined' || !(categories[src] || []).length) {
                if (typeof loadAllCategoriesFromSheet === 'function') loadAllCategoriesFromSheet();
                await waitForSheet(15000);
            }
            const rows = (typeof categories !== 'undefined' && categories[src]) ? categories[src] : [];
            return rows.map(w => ({ en: String(w.en || '').trim(), zh: String(w.zh || '').trim() })).filter(w => w.en && w.zh);
        }

        let resolvedForm = String(form || '').trim().toUpperCase();
        if (resolvedForm === 'ALL') resolvedForm = '';
        if (!resolvedForm && typeof myFormValue !== 'undefined' && myFormValue) resolvedForm = myFormValue;
        if (!resolvedForm && typeof ownDisplayedForm === 'function') resolvedForm = ownDisplayedForm() || '';
        try {
            let query = sb.from('new_vocab_words').select('en,zh,form').order('id');
            if (resolvedForm && resolvedForm !== 'ALL') query = query.eq('form', resolvedForm);
            else if (typeof FORM_LEVELS !== 'undefined') query = query.in('form', FORM_LEVELS.map(f => f.id));
            const { data, error } = await query;
            if (error) {
                setError('Could not load New Vocab: ' + (error.message || 'unknown error'));
                return [];
            }
            return (data || []).map(w => ({ en: String(w.en || '').trim(), zh: String(w.zh || '').trim() })).filter(w => w.en && w.zh);
        } catch (e) {
            setError('Could not load New Vocab.');
            return [];
        }
    }

    /* Load the bank described by one round's config (vocab or grammar). */
    async function loadRoundBank(config) {
        if (!config) {
            setError('That round has no question bank.');
            return null;
        }
        if (config.subject === 'grammar') {
            if (typeof DG === 'undefined' || typeof DG.loadBank !== 'function') {
                setError('Grammar Quest could not load. Reload the page and try again.');
                return null;
            }
            let bank;
            try {
                bank = await DG.loadBank(config.topic, config.bankMode);
            } catch (e) {
                setError((e && e.message) || 'Could not load that grammar bank.');
                return null;
            }
            if (!Array.isArray(bank) || !bank.length) {
                setError('That grammar bank is empty.');
                return null;
            }
            return { subject: 'grammar', grammar: bank };
        }
        const words = await loadVocabWords(config.vocabSource || config.topic, config.vocabForm);
        if (!words.length) {
            setError('No usable words in that vocab bank. New Vocab cards need both English and Chinese.');
            return null;
        }
        return { subject: 'vocab', words: words };
    }

    function sameRoundBank(a, b) {
        if (!a || !b) return false;
        return a.subject === b.subject
            && String(a.topic || '') === String(b.topic || '')
            && String(a.vocabSource || '') === String(b.vocabSource || '')
            && String(a.vocabForm || '') === String(b.vocabForm || '')
            && String(a.bankMode || '') === String(b.bankMode || '');
    }

    async function buildQuestionSet() {
        const seed = Number(room.seed) || 1;
        const count = 160;
        const roundCount = roomRoundCount();
        const r1 = roundConfig(1);
        const r2 = roundConfig(2);

        const bank1 = await loadRoundBank(r1);
        if (!bank1) return null;
        const questions = bank1.subject === 'grammar'
            ? PSEngine.buildGrammarMC({ questions: bank1.grammar, seed: seed, count: count })
            : PSEngine.buildVocabMC({ words: bank1.words, seed: seed, count: count });

        let glassPairs = [];
        if (roundCount > 1) {
            const bank2 = sameRoundBank(r1, r2) ? bank1 : await loadRoundBank(r2);
            if (!bank2) return null;
            const steps = PSEngine.normalizeGlassSteps(r2.glassSteps);
            glassPairs = bank2.subject === 'grammar'
                ? PSEngine.buildGlassPairs({ questions: bank2.grammar, seed: seed + 3, count: steps })
                : PSEngine.buildGlassPairs({ words: bank2.words, seed: seed + 3, count: steps });
        }

        return {
            questions: questions,
            glassPairs: glassPairs,
            roundCount: roundCount,
            round1: r1,
            round2: r2
        };
    }

    /* ------------------------------------------------------------------ */
    /* Overlays / milestones                                              */
    /* ------------------------------------------------------------------ */

    PS.showOverlay = function (title, body, icon, buttonLabel, onContinue) {
        const overlay = $('ps-round-overlay');
        if (!overlay) return;
        setText('ps-overlay-title', title || '');
        setText('ps-overlay-body', body || '');
        setText('ps-overlay-icon', icon || '🐱');
        const btn = $('ps-overlay-btn');
        if (btn) btn.textContent = buttonLabel || 'Continue';
        overlayAction = typeof onContinue === 'function' ? onContinue : null;
        overlay.classList.remove('hidden');
    };

    PS.hideOverlay = function () {
        const overlay = $('ps-round-overlay');
        if (overlay) overlay.classList.add('hidden');
        overlayAction = null;
    };

    PS.overlayAction = function () {
        const action = overlayAction;
        PS.hideOverlay();
        if (action) action();
    };

    function hideOverlay() {
        PS.hideOverlay();
    }

    function once(key) {
        if (shownKeys[key]) return false;
        shownKeys[key] = true;
        return true;
    }

    /* Brief non-blocking round cue. The rules were already delivered in the
       entrance briefing, so nothing may cover the answer pad once the
       official clock is running. */
    function showRoundCue(roundNo) {
        const el = $('ps-round-cue');
        if (!el) return;
        const isR1 = Number(roundNo) !== 2;
        el.innerHTML = isR1
            ? '<b>🟢 ROUND 1 · 1-2-3 Meow!</b><span>Green = answer · Red = freeze</span>'
            : '<b>🧊 ROUND 2 · 玻璃橋</b><span>Pick the tempered pane before 5 s</span>';
        el.classList.remove('hidden');
        // restart the CSS animation
        el.classList.remove('ps-cue-on');
        void el.offsetWidth;
        el.classList.add('ps-cue-on');
        if (cueTimer) clearTimeout(cueTimer);
        cueTimer = setTimeout(() => {
            el.classList.add('hidden');
            el.classList.remove('ps-cue-on');
        }, 4200);
    }

    function showEliminatedOverlay() {
        if (!me || !once('out:' + room.id + ':' + me.user_id + ':' + room.status)) return;
        PS.showOverlay('👻 You are out', 'Your cat is now a ghost. You can still watch the rest of the class.', '👻', 'Watch');
    }

    function showFinishOverlay() {
        if (!once('finish:' + room.id + ':' + me.user_id)) return;
        const bridge = roomRoundCount() > 1;
        PS.showOverlay(
            '🏁 You reached ' + finishDistance() + ' m!',
            bridge
                ? 'You are one of the first 15 through. Wait for the round to end — the bridge is next.'
                : 'You finished 1-2-3 Meow! Wait for the round to end — every survivor wins this class.',
            '🏁',
            'Watch the class'
        );
    }

    function showSurvivedOverlay() {
        if (!once('survived:' + room.id + ':' + (me ? me.user_id : ''))) return;
        PS.showOverlay('🎉 You survived the glass bridge!', 'Mid-victory! Round 3 (and the Squid Circle finale) are coming soon. Stay to watch the rest of the class.', '🎉', 'Continue');
    }

    function checkMilestones() {
        if (!room || !me) return;
        if (room.status === 'round1' && once('cue1:' + room.id)) {
            showRoundCue(1);
        }
        if (room.status === 'round2' && once('cue2:' + room.id)) {
            showRoundCue(2);
        }
        if ((me.status === 'eliminated' || me.ghost) && (room.status === 'round1' || room.status === 'round2')) {
            showEliminatedOverlay();
        }
        if (room.status === 'finished') {
            const onlyRound1 = roomRoundCount() === 1;
            const survived = onlyRound1
                ? !!(me && me.status !== 'eliminated' && me.ghost !== true)
                : !!(me && (me.crossed_glass || me.status === 'advanced'));
            if (survived) {
                if (once('final-win:' + room.id)) {
                    if (onlyRound1) {
                        PS.showOverlay('🎉 Victory in 1-2-3 Meow!', 'You survived Red Light, Green Light. Round 2 was not selected for this class — every student still standing wins. You can go back to the Hub.', '🎉', 'Back to Hub', () => PS.backToHub());
                    } else {
                        PS.showOverlay('🎉 Mid-victory!', 'You survived the glass bridge. Round 3 and the Squid Circle finale are coming soon. You can go back to the Hub.', '🎉', 'Back to Hub', () => PS.backToHub());
                    }
                }
            } else if (once('final-out:' + room.id)) {
                if (onlyRound1) {
                    PS.showOverlay('1-2-3 Meow! is over', 'Your class finished Round 1. Later rounds are coming soon. You can go back to the Hub.', '🏁', 'Back to Hub', () => PS.backToHub());
                } else {
                    PS.showOverlay('The bridge is over', 'Your class finished Round 2. You can go back to the Hub — later rounds are coming soon.', '🧊', 'Back to Hub', () => PS.backToHub());
                }
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Realtime-ish keyboard / tap handling                                */
    /* ------------------------------------------------------------------ */

    function isTypingTarget(target) {
        if (!target) return false;
        const tag = String(target.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    function handleKey(event) {
        if (typeof currentView !== 'undefined' && currentView !== VIEW_ID) return;
        if (!room || (room.status !== 'round1' && room.status !== 'round2')) return;
        if (isTypingTarget(event.target)) return;
        const key = event.key;
        const overlayOpen = $('ps-round-overlay') && !$('ps-round-overlay').classList.contains('hidden');
        if (key === 'Escape' && overlayOpen) {
            event.preventDefault();
            PS.hideOverlay();
            return;
        }
        if (overlayOpen) return;

        if (room.status === 'round2') {
            if (key === '1' || key === 'ArrowLeft' || key.toLowerCase() === 'a') {
                event.preventDefault();
                PS.jump('left');
            } else if (key === '2' || key === 'ArrowRight' || key.toLowerCase() === 'd') {
                event.preventDefault();
                PS.jump('right');
            }
            return;
        }

        if (key >= '1' && key <= '4') {
            const choice = Number(key) - 1;
            event.preventDefault();
            if (phaseNow() === 'red') redPress();
            else PS.answer(choice);
        }
    }

    function handleTap(event) {
        if (typeof currentView !== 'undefined' && currentView !== VIEW_ID) return;
        if (!room || room.status !== 'round1') return;
        if (!me || me.status === 'eliminated' || me.ghost || me.reached_finish) return;
        const overlay = $('ps-round-overlay');
        if (overlay && !overlay.classList.contains('hidden')) return;
        const target = event.target;
        if (target && target.closest && target.closest('[data-ps-safe]')) return;
        if (phaseNow() !== 'red') return;
        redPress();
    }

    /* ------------------------------------------------------------------ */
    /* Public lifecycle                                                   */
    /* ------------------------------------------------------------------ */

    PS.enter = async function () {
        if (demoMode) {
            demoEnsureUser();
            demoPrepareChrome();
            demoApplyRoleClass();
            me = myPlayer();
            if (room) render();
            else setPanel('lobby');
            demoStartLoop();
            return;
        }
        if (!signedInUser() || isGuest()) {
            populateLobby();
            setPanel('lobby');
            setLive(false);
            setError('');
            show('ps-room-actions', false);
            show('ps-host-note', false);
            return;
        }
        if (!busy) setError('');
        try {
            if (typeof myFormValue !== 'undefined' && !myFormValue && typeof resolveOwnForm === 'function') {
                await resolveOwnForm(false);
            }
        } catch (e) { /* New Vocab may be unavailable before SQL */ }
        populateLobby();
        if (room) {
            setPanel(room.status === 'waiting' ? 'waiting' : 'game');
            if (room.status === 'waiting') {
                ensureIntro();
                setLive(true);
            }
            startPolling();
            poll(true);
        } else {
            setPanel('lobby');
            setLive(false);
        }
        updateMascot('Purr-fect Survival — survive the doll and the glass bridge!');
    };

    PS.stop = function () {
        stopPolling();
        stopFrames();
        setLive(false);
        if (cueTimer) {
            clearTimeout(cueTimer);
            cueTimer = 0;
        }
        if (overlayAction) overlayAction = null;
    };

    PS.copyCode = async function () {
        const code = (room && room.code) || '';
        if (!code) return;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(code);
            } else {
                const input = $('ps-code');
                if (input) {
                    const range = document.createRange();
                    range.selectNodeContents(input);
                    const sel = root.getSelection();
                    if (sel) {
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                    document.execCommand('copy');
                }
            }
            updateMascot('Room code ' + code + ' copied.');
        } catch (e) {
            updateMascot('Room code: ' + code);
        }
    };

    PS.leaveRoom = async function () {
        if (demoMode) { PS.hideOverlay(); PS.demoJump('lobby'); return; }
        if (!room) {
            PS.backToHub();
            return;
        }
        if (typeof window.confirm === 'function' &&
            !window.confirm(isHost() ? 'Close this room and remove everyone?' : 'Leave this room?')) return;
        const roomId = room.id;
        busy = true;
        try {
            await sb.rpc('leave_purrfect_survival', { p_room_id: roomId });
        } catch (e) { /* ignore */ }
        busy = false;
        room = null;
        players = [];
        me = null;
        questions = [];
        glassSteps = [];
        introPlaying = false;
        clearResume();
        stopPolling();
        setLive(false);
        setPanel('lobby');
        show('ps-code-chip', false);
        renderRejoin();
        setError('');
        updateMascot('You left the room.');
    };

    PS.render = render;
    PS.syncSubjectFields = syncSubjectFields;
    PS.syncVocabForm = syncVocabForm;
    PS.syncGrammarModes = syncGrammarModes;
    PS.syncRoundCount = syncRoundCount;
    PS.state = function () {
        return {
            room: room ? JSON.parse(JSON.stringify(room)) : null,
            players: players.map(p => Object.assign({}, p)),
            me: me ? Object.assign({}, me) : null
        };
    };

    /* ------------------------------------------------------------------ */
    /* Public demo mode (no login / no Supabase)                          */
    /* ------------------------------------------------------------------ */
    /*
     * The public demo reuses this exact module, the existing renderer and
     * the PSEngine rules. There is no second game loop and no second
     * canvas: a local setInterval updates the same `room` / `players`
     * objects the live polling would update, then calls the normal
     * render() and canvas frame loop.
     *
     * demoMode is only ever turned on by PS.startDemo() — which the demo
     * page calls, or which auto-boots when index.html?psdemo=1 is opened.
     * The normal homepage tile never sets it, so isGuest() /
     * assertCanPlay() / PS.enter() keep their real guest blocking.
     */

    function demoHash01(text) {
        return PSEngine.hashString(text) / 4294967296;
    }

    function demoIdentity() {
        if (demoRole === 'teacher') {
            return {
                id: DEMO_TEACHER_ID,
                email: 'teacher@lstyoungkhl.edu.hk',
                user_metadata: { full_name: '4C Teacher' }
            };
        }
        return {
            id: DEMO_VISITOR_ID,
            email: 'demo16@lstyoungkhl.edu.hk',
            user_metadata: { full_name: '4C 16 Demo' }
        };
    }

    function demoEnsureUser() {
        if (!demoMode) return;
        const user = demoIdentity();
        try {
            if (typeof currentUser !== 'undefined' && (!currentUser || currentUser.id !== user.id)) {
                currentUser = user;
            }
        } catch (e) { /* ignore */ }
        try {
            if (typeof guestSession !== 'undefined' && guestSession) guestSession = false;
        } catch (e) { /* ignore */ }
    }

    function demoPrepareChrome() {
        if (!demoMode) return;
        demoEnsureUser();
        document.body.classList.add('ps-demo-mode');
        const login = $('login-view');
        if (login) login.style.display = 'none';
        const app = $('app');
        if (app) app.classList.add('logged-in');
        ['bottom-nav', 'home-music-btn', 'me-store-music-btn'].forEach(function (id) {
            const el = $(id);
            if (el) el.style.display = 'none';
        });
        const header = document.querySelector('#app > .brand-header');
        if (header) header.style.display = 'none';
        const mascot = document.querySelector('#app > header');
        if (mascot) mascot.style.display = 'none';
    }

    /* Supabase auth can still emit a session event inside the demo
       iframe. Keep the demo in charge without touching the real path:
       showApp()/showLogin() fall back to the originals whenever demoMode
       is off. */
    function demoInstallShield() {
        if (demoShieldInstalled) return;
        demoShieldInstalled = true;
        try {
            demoPrevShowApp = root.showApp;
            demoPrevShowLogin = root.showLogin;
            root.showApp = function () {
                if (demoMode) {
                    demoPrepareChrome();
                    demoApplyRoleClass();
                    if (typeof currentView !== 'undefined' && currentView !== VIEW_ID && typeof changeView === 'function') {
                        changeView(VIEW_ID);
                    } else if (room) {
                        render();
                    }
                    return;
                }
                if (typeof demoPrevShowApp === 'function') return demoPrevShowApp.apply(this, arguments);
            };
            root.showLogin = function () {
                if (demoMode) {
                    demoPrepareChrome();
                    return;
                }
                if (typeof demoPrevShowLogin === 'function') return demoPrevShowLogin.apply(this, arguments);
            };
        } catch (e) { /* ignore */ }
    }

    function demoApplyRoleClass() {
        const view = $(VIEW_ID);
        if (view) {
            view.classList.add('ps-demo-mode');
            view.classList.toggle('ps-demo-projector', demoRole === 'teacher');
        }
        document.body.classList.toggle('ps-demo-projector', demoRole === 'teacher');
    }

    function demoOpenView() {
        demoPrepareChrome();
        demoApplyRoleClass();
        if (typeof changeView === 'function') {
            if (typeof currentView === 'undefined' || currentView !== VIEW_ID) changeView(VIEW_ID);
        } else {
            const view = $(VIEW_ID);
            if (view) view.classList.remove('hidden');
        }
    }

    function demoPlayerRow(bot) {
        return {
            user_id: bot.user_id,
            email: bot.email || '',
            nickname: bot.nickname || '',
            cat: bot.cat || 'Ginger',
            glasses: bot.glasses || 'None',
            hat: bot.hat || 'None',
            outfit: bot.outfit || 'None',
            is_playing: bot.is_playing !== false,
            status: 'alive',
            ghost: false,
            distance: 0,
            red_offences: 0,
            question_index: 0,
            reached_finish: false,
            finished_at: null,
            last_red_phase: -1,
            demo_attempts: 0,
            next_answer_at: 0,
            round1_advanced: false,
            round1_rank: null,
            glass_step: 0,
            glass_active: false,
            glass_released: false,
            glass_side: null,
            glass_started_at: null,
            glass_shattered: false,
            glass_finished_at: null,
            crossed_glass: false,
            survived_round2: false,
            advanced_round2: false
        };
    }

    function demoRoundMs() {
        return Math.max(PS.ROUND1.MIN_ROUND_MS, Math.round(DEMO_ROUND_MS * (demoFinishDistance / PS.ROUND1.FINISH_DISTANCE)));
    }

    function demoSettings() {
        const isGrammar = demoSubject === 'grammar';
        return {
            version: 1,
            roundCount: demoRoundCount,
            rounds: [
                {
                    round: 1,
                    kind: 'meow',
                    subject: demoSubject,
                    topic: isGrammar ? 'demo' : 'Demo Vocab',
                    vocabSource: isGrammar ? '' : 'Demo Vocab',
                    vocabForm: '',
                    bankMode: '',
                    finishDistance: demoFinishDistance,
                    roundMs: demoRoundMs()
                },
                {
                    round: 2,
                    kind: 'glass',
                    subject: demoSubject,
                    topic: isGrammar ? 'demo' : 'Demo Vocab',
                    vocabSource: isGrammar ? '' : 'Demo Vocab',
                    vocabForm: '',
                    bankMode: '',
                    glassSteps: demoGlassStepCount
                }
            ],
            roundMs: demoRoundMs(),
            finishDistance: demoFinishDistance,
            glassSteps: demoGlassStepCount
        };
    }

    function demoBuildGlassSteps() {
        return PSEngine.buildGlassSteps({
            pairs: demoGlassPairs,
            seed: PSEngine.coerceSeed(DEMO_SEED) + 17,
            count: demoGlassStepCount
        });
    }

    function demoInit() {
        const built = PSEngine.buildDemoQuestionSet({ subject: demoSubject, seed: DEMO_SEED });
        questions = built.questions.slice();
        demoGlassPairs = built.glassPairs.slice();
        glassSteps = demoBuildGlassSteps();
        demoClassmates = PSEngine.buildDemoClassmates({ count: DEMO_BOT_COUNT, seed: DEMO_SEED });
        players = demoClassmates.map(demoPlayerRow);
        players.push(demoPlayerRow({
            user_id: DEMO_VISITOR_ID,
            email: 'demo16@lstyoungkhl.edu.hk',
            nickname: '4C 16 Demo',
            cat: 'Ragdoll',
            glasses: 'Glasses',
            hat: 'None',
            outfit: 'None'
        }));
        const teacher = demoPlayerRow({
            user_id: DEMO_TEACHER_ID,
            email: 'teacher@lstyoungkhl.edu.hk',
            nickname: '4C Teacher',
            cat: 'Garfield',
            glasses: 'None',
            hat: 'None',
            outfit: 'None'
        });
        teacher.is_playing = false;
        players.push(teacher);
        room = {
            id: 'demo-purrfect-room',
            code: 'DEMO',
            host_id: DEMO_TEACHER_ID,
            status: 'waiting',
            subject: demoSubject,
            source: 'Demo Vocab',
            topic: 'Demo Vocab',
            bank_mode: '',
            seed: DEMO_SEED,
            max_players: 30,
            finish_distance: demoFinishDistance,
            current_round: 1,
            round1_started_at: null,
            round1_ends_at: null,
            round2_started_at: null,
            round2_ends_at: null,
            phase_schedule: [],
            glass_steps: glassSteps,
            questions: questions,
            settings: demoSettings(),
            server_now: new Date().toISOString(),
            created_at: new Date().toISOString(),
            started_at: null,
            finished_at: null
        };
        clockOffset = 0;
        shownKeys = {};
        questionsKey = '';
        lastPhaseKey = '';
        lastRedSent = -1;
        overlayAction = null;
        busy = false;
        me = myPlayer();
    }

    function demoResetPlayers() {
        players.forEach(function (p) {
            p.status = 'alive';
            p.ghost = false;
            p.distance = 0;
            p.red_offences = 0;
            p.question_index = 0;
            p.reached_finish = false;
            p.finished_at = null;
            p.last_red_phase = -1;
            p.demo_attempts = 0;
            p.next_answer_at = 0;
            p.round1_advanced = false;
            p.round1_rank = null;
            p.glass_step = 0;
            p.glass_active = false;
            p.glass_released = false;
            p.glass_side = null;
            p.glass_started_at = null;
            p.glass_shattered = false;
            p.glass_finished_at = null;
            p.crossed_glass = false;
            p.survived_round2 = false;
            p.advanced_round2 = false;
            p.eliminated_reason = null;
        });
        questionsKey = '';
        lastPhaseKey = '';
        lastRedSent = -1;
    }

    function demoIsVisitor(p) {
        return !!(demoMode && demoRole === 'student' && p && String(p.user_id) === DEMO_VISITOR_ID);
    }

    function demoBotSucceeds(p) {
        const skill = 0.80 + demoHash01(p.user_id + ':skill') * 0.15;
        return demoHash01(p.user_id + ':attempt:' + (Number(p.demo_attempts) || 0)) < skill;
    }

    function demoBotPace(p) {
        const base = 2600 + demoHash01(p.user_id + ':pace') * 1600;
        const jitter = (demoHash01(p.user_id + ':pj:' + (Number(p.demo_attempts) || 0)) - 0.5) * 700;
        return Math.max(1200, base + jitter);
    }

    function demoJumpLobby() {
        demoResetPlayers();
        room.status = 'waiting';
        room.current_round = 1;
        room.round1_started_at = null;
        room.round1_ends_at = null;
        room.round2_started_at = null;
        room.round2_ends_at = null;
        room.finished_at = null;
        room.phase_schedule = [];
        glassSteps = demoBuildGlassSteps();
        room.glass_steps = glassSteps;
        shownKeys = {};
        questionsKey = '';
        me = myPlayer();
        PS.hideOverlay();
    }

    function demoJumpRound1() {
        demoResetPlayers();
        if (!questions.length) {
            const built = PSEngine.buildDemoQuestionSet({ subject: demoSubject, seed: DEMO_SEED });
            questions = built.questions.slice();
            demoGlassPairs = built.glassPairs.slice();
        }
        const now = Date.now();
        const roundMs = demoRoundMs();
        room.status = 'round1';
        room.current_round = 1;
        room.finish_distance = demoFinishDistance;
        room.settings = demoSettings();
        room.round1_started_at = new Date(now).toISOString();
        room.round1_ends_at = new Date(now + roundMs).toISOString();
        room.round2_started_at = null;
        room.round2_ends_at = null;
        room.finished_at = null;
        room.phase_schedule = PSEngine.buildPhaseSchedule(DEMO_SEED, { roundMs: roundMs });
        glassSteps = demoBuildGlassSteps();
        room.glass_steps = glassSteps;
        room.questions = questions;
        shownKeys = {};
        questionsKey = '';
        lastPhaseKey = '';
        lastRedSent = -1;
        const playing = players.filter(isPlayingPlayer);
        playing.forEach(function (p, i) {
            p.next_answer_at = now + 300 + ((i * 127) % 1500) + demoHash01(p.user_id + ':stagger') * 600;
        });
        me = myPlayer();
        PS.hideOverlay();
    }

    function demoJumpRound2() {
        demoResetPlayers();
        if (!questions.length) {
            const built = PSEngine.buildDemoQuestionSet({ subject: demoSubject, seed: DEMO_SEED });
            questions = built.questions.slice();
            demoGlassPairs = built.glassPairs.slice();
        }
        const now = Date.now();
        const playing = players.filter(isPlayingPlayer);
        const visitor = playing.find(function (p) { return p.user_id === DEMO_VISITOR_ID; });
        const survivors = [];
        if (visitor && demoRole === 'student') survivors.push(visitor);
        const bots = playing.filter(function (p) { return p.user_id !== DEMO_VISITOR_ID; });
        bots.sort(function (a, b) {
            return demoHash01('survive:' + a.user_id) - demoHash01('survive:' + b.user_id);
        });
        while (survivors.length < PSEngine.ROUND1.ADVANCE_LIMIT && bots.length) survivors.push(bots.shift());
        const kept = {};
        survivors.forEach(function (p, i) {
            kept[p.user_id] = true;
            p.round1_advanced = true;
            p.round1_rank = i + 1;
            p.status = 'alive';
            p.ghost = false;
            p.distance = demoFinishDistance;
        });
        playing.forEach(function (p) {
            if (kept[p.user_id]) return;
            p.status = 'eliminated';
            p.ghost = true;
            p.eliminated_reason = 'round1_cut';
            p.round1_advanced = false;
            p.round1_rank = null;
        });
        room.status = 'round2';
        room.current_round = 2;
        room.round1_started_at = room.round1_started_at || new Date(now - 45000).toISOString();
        room.round1_ends_at = room.round1_ends_at || new Date(now).toISOString();
        room.round2_started_at = new Date(now).toISOString();
        room.round2_ends_at = new Date(now + DEMO_ROUND2_MS).toISOString();
        room.finished_at = null;
        glassSteps = demoBuildGlassSteps();
        room.glass_steps = glassSteps;
        room.questions = questions;
        shownKeys = {};
        shownKeys['intro2:' + room.id] = true;
        questionsKey = '';
        me = myPlayer();
        demoReleaseGlass(now);
        PS.hideOverlay();
    }

    function demoJumpVictory() {
        demoResetPlayers();
        const now = Date.now();
        const playing = players.filter(isPlayingPlayer);
        const visitor = playing.find(function (p) { return p.user_id === DEMO_VISITOR_ID; });
        const bots = playing.filter(function (p) { return p.user_id !== DEMO_VISITOR_ID; });
        bots.slice(0, 5).forEach(function (p, i) {
            p.status = 'advanced';
            p.crossed_glass = true;
            p.survived_round2 = true;
            p.advanced_round2 = true;
            p.glass_step = demoGlassStepCount;
            p.glass_active = false;
            p.round1_rank = i + 1;
        });
        if (visitor && demoRole === 'student') {
            visitor.status = 'advanced';
            visitor.crossed_glass = true;
            visitor.survived_round2 = true;
            visitor.advanced_round2 = true;
            visitor.glass_step = demoGlassStepCount;
            visitor.glass_active = false;
            visitor.round1_rank = 1;
        }
        playing.forEach(function (p) {
            if (p.status !== 'advanced') {
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = 'glass';
                p.glass_active = false;
            }
        });
        room.status = 'finished';
        room.current_round = 2;
        room.round2_started_at = room.round2_started_at || new Date(now - 40000).toISOString();
        room.round2_ends_at = new Date(now).toISOString();
        room.finished_at = new Date(now).toISOString();
        glassSteps = demoBuildGlassSteps();
        for (let i = 0; i < glassSteps.length; i++) PSEngine.revealGlassStep(glassSteps[i], 'correct');
        room.glass_steps = glassSteps;
        room.questions = questions;
        shownKeys = {};
        questionsKey = '';
        me = myPlayer();
        PS.hideOverlay();
    }

    function demoAdvanceToRound2() {
        if (!room || room.status !== 'round1') return;
        if (demoRoundCount <= 1) {
            demoFinishRound1Victory(Date.now());
            return;
        }
        const now = Date.now();
        const playing = players.filter(isPlayingPlayer);
        const picked = PSEngine.advanceRound1(playing, {
            limit: PSEngine.ROUND1.ADVANCE_LIMIT,
            finishDistance: room.finish_distance || PSEngine.ROUND1.FINISH_DISTANCE
        });
        const kept = {};
        picked.forEach(function (p) { kept[p.user_id] = true; });
        playing.forEach(function (p) {
            p.glass_step = 0;
            p.glass_active = false;
            p.glass_released = false;
            p.glass_side = null;
            p.glass_started_at = null;
            p.glass_shattered = false;
            p.glass_finished_at = null;
            p.crossed_glass = false;
            p.survived_round2 = false;
            p.advanced_round2 = false;
            if (kept[p.user_id]) {
                p.status = 'alive';
                p.ghost = false;
            } else {
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = p.eliminated_reason || 'round1_cut';
            }
        });
        glassSteps = demoBuildGlassSteps();
        room.glass_steps = glassSteps;
        room.status = 'round2';
        room.current_round = 2;
        room.round2_started_at = new Date(now).toISOString();
        room.round2_ends_at = new Date(now + DEMO_ROUND2_MS).toISOString();
        room.finished_at = null;
        shownKeys['intro2:' + room.id] = true;
        questionsKey = '';
        me = myPlayer();
        PS.hideOverlay();
        demoReleaseGlass(now);
    }

    function demoFinishRound1Victory(now) {
        if (!room || room.status !== 'round1') return;
        room.status = 'finished';
        room.current_round = 1;
        room.finished_at = new Date(now || Date.now()).toISOString();
        shownKeys = {};
        questionsKey = '';
        me = myPlayer();
    }

    function demoEndRound1() {
        if (!room || room.status !== 'round1') return;
        if (demoRoundCount <= 1) demoFinishRound1Victory(Date.now());
        else demoAdvanceToRound2();
    }

    function demoFinishRound2(now) {
        if (!room || room.status !== 'round2') return;
        room.status = 'finished';
        room.current_round = 2;
        room.finished_at = new Date(now || Date.now()).toISOString();
    }

    function demoReleaseGlass(now) {
        if (!room || room.status !== 'round2') return;
        const playing = players.filter(isPlayingPlayer);
        const queue = PSEngine.glassQueueIds(playing);
        PSEngine.releaseGlassQueue(playing, queue, { now: now || Date.now() });
    }

    function demoBotGlassJump(p, now) {
        const stepIndex = Math.max(0, Number(p.glass_step) || 0);
        const step = glassSteps[stepIndex];
        if (!step) { p.glass_active = false; return; }
        const stepCount = Math.max(1, glassSteps.length || PSEngine.ROUND2.STEP_COUNT);
        let side;
        if (step.revealed && step.revealed_side) {
            const wantCorrect = demoHash01(p.user_id + ':reveal:' + stepIndex) < 0.9;
            side = wantCorrect ? step.revealed_side : (step.revealed_side === 'left' ? 'right' : 'left');
        } else {
            const correctSide = step.correct_side === 'right' ? 'right' : 'left';
            const guessCorrect = demoHash01(p.user_id + ':guess:' + stepIndex + ':' + String(p.glass_started_at)) < 0.55;
            side = guessCorrect ? correctSide : (correctSide === 'left' ? 'right' : 'left');
        }
        const result = PSEngine.applyGlassJump(p, step, side, { stepCount: stepCount, at: now });
        if (result.outcome === 'correct' && !p.crossed_glass && p.status === 'alive') {
            // The live SQL keeps the same player on the bridge for the next
            // pane until they cross or fall; mirror that turn continuation.
            p.glass_active = true;
            p.glass_started_at = now;
        }
    }

    function demoGlassTimeout(p, now) {
        const stepIndex = Math.max(0, Number(p.glass_step) || 0);
        const step = glassSteps[stepIndex];
        if (!step) { p.glass_active = false; return; }
        const stepCount = Math.max(1, glassSteps.length || PSEngine.ROUND2.STEP_COUNT);
        PSEngine.applyGlassJump(p, step, '', { stepCount: stepCount, timedOut: true, at: now });
        if (demoIsVisitor(p)) {
            sfxShatter();
            toast('⏱ Time up! No jump — you fell.');
            showGlassOutOverlay('⏱ No jump', 'The 5-second window closed and you fell. The correct pane was not revealed.');
            questionsKey = '';
            renderPlayerQuestion(true);
        }
    }

    function demoTickRound1(now) {
        const info = phaseInfo();
        // A missing clock (just after jump, or a missing start stamp) is
        // not the same as the schedule being finished — wait, do not
        // skip the visitor straight to the glass bridge.
        if (!info) return;
        if (info.done) {
            demoEndRound1();
            return;
        }
        const phase = info;
        const playing = players.filter(isPlayingPlayer);

        if (phase.phase === 'green' || phase.phase === 'yellow') {
            playing.forEach(function (p) {
                if (demoIsVisitor(p)) return;
                if (!PSEngine.isAlive(p) || p.reached_finish) return;
                if (!p.next_answer_at) p.next_answer_at = now + 300 + demoHash01(p.user_id + ':start') * 900;
                if (now < p.next_answer_at) return;
                const correct = demoBotSucceeds(p);
                if (correct) {
                    PSEngine.applyGreenCorrect(p, PSEngine.ROUND1.SPRINT_METERS, {
                        at: now,
                        finishDistance: room.finish_distance || PSEngine.ROUND1.FINISH_DISTANCE
                    });
                } else {
                    PSEngine.applyGreenWrong(p);
                }
                p.question_index = (Number(p.question_index) || 0) + 1;
                p.demo_attempts = (Number(p.demo_attempts) || 0) + 1;
                p.next_answer_at = now + demoBotPace(p);
            });
        } else if (phase.phase === 'red') {
            playing.forEach(function (p) {
                if (demoIsVisitor(p)) return;
                if (!PSEngine.isAlive(p) || p.reached_finish) return;
                const wait = Math.max(0, Number(info.remaining_ms) || 0);
                if (!p.next_answer_at || p.next_answer_at < now + wait) {
                    p.next_answer_at = now + wait + 150 + demoHash01(p.user_id + ':postred') * 500;
                }
                if (p.last_red_phase === phase.index) return;
                if (demoHash01(p.user_id + ':red:' + room.round1_started_at + ':' + phase.index) < 0.055) {
                    p.last_red_phase = phase.index;
                    PSEngine.applyRedPenalty(p);
                }
            });
        }

        const finishers = playing.filter(function (p) {
            return PSEngine.isAlive(p) && PSEngine.isRound1Finished(p, room.finish_distance || PSEngine.ROUND1.FINISH_DISTANCE);
        });
        const ends = room.round1_ends_at ? Date.parse(room.round1_ends_at) : 0;
        if (demoRoundCount <= 1) {
            const living = playing.filter(PSEngine.isAlive);
            if ((ends && now >= ends) || finishers.length >= living.length) {
                demoFinishRound1Victory(now);
            }
        } else if (finishers.length >= PSEngine.ROUND1.ADVANCE_LIMIT || (ends && now >= ends)) {
            demoAdvanceToRound2();
        }
    }

    function demoTickRound2(now) {
        demoReleaseGlass(now);
        const playing = players.filter(isPlayingPlayer);
        playing.forEach(function (p) {
            if (!PSEngine.isAlive(p) || !p.glass_active) return;
            const stepIndex = Math.max(0, Number(p.glass_step) || 0);
            const step = glassSteps[stepIndex];
            if (!step) { p.glass_active = false; return; }
            if (PSEngine.glassWindowExpired(p.glass_started_at, now, PSEngine.ROUND2.WINDOW_MS)) {
                demoGlassTimeout(p, now);
                return;
            }
            const isVisitor = demoIsVisitor(p);
            if (isVisitor) return;
            const start = p.glass_started_at;
            const elapsed = now - (typeof start === 'number' ? start : (Date.parse(start) || now));
            const delay = 700 + demoHash01(p.user_id + ':glass:' + stepIndex + ':' + String(start)) * 3000;
            if (elapsed >= delay) demoBotGlassJump(p, now);
        });
        if (!playing.some(PSEngine.isAlive)) demoFinishRound2(now);
    }

    function demoTick() {
        if (!demoMode || !room) return;
        demoEnsureUser();
        demoPrepareChrome();
        demoApplyRoleClass();
        if (typeof currentView !== 'undefined' && currentView !== VIEW_ID && typeof changeView === 'function') {
            changeView(VIEW_ID);
        }
        room.server_now = new Date().toISOString();
        if (room.status === 'round1') demoTickRound1(Date.now());
        else if (room.status === 'round2') demoTickRound2(Date.now());
        render();
        if (room && (room.status === 'round1' || room.status === 'round2')) startFrames();
    }

    function demoStartLoop() {
        if (demoLoopTimer) return;
        demoLoopTimer = setInterval(demoTick, 150);
    }

    function demoRedPress() {
        if (!room || room.status !== 'round1' || !me || !isPlayingPlayer(me)) return;
        if (me.status === 'eliminated' || me.ghost) return;
        const info = currentQuestionPhase();
        if (!info || info.phase !== 'red') {
            if (info && (info.phase === 'green' || info.phase === 'yellow')) toast('Go! Answer with 1–4.');
            return;
        }
        if (lastRedSent === info.index || Number(me.last_red_phase) === info.index) {
            toast('Wait for the green light — one hit per red phase.');
            return;
        }
        lastRedSent = info.index;
        me.last_red_phase = info.index;
        lastBang = Date.now();
        const result = PSEngine.handleRound1Press(me, 'red');
        sfxRed();
        if (result.action === 'eliminated') {
            toast('🔴 Laser hit — you are out!');
            showEliminatedOverlay();
        } else if (result.penalty) {
            toast('🔴 Laser hit! ' + result.penalty + ' m. Get ready for the green light.');
        } else {
            toast('Hold still — wait for the green light.');
        }
        renderPlayerQuestion(false);
    }

    function demoAnswer(choice) {
        if (!room || room.status !== 'round1' || !me || !isPlayingPlayer(me)) return;
        if (me.status === 'eliminated' || me.ghost || me.reached_finish) return;
        if (Date.now() < answerLockUntil) return;
        const info = currentQuestionPhase();
        if (!info) return;
        if (info.phase === 'red' || info.done) { demoRedPress(); return; }
        if (!PSEngine.isAnswerPhase(info.phase)) return;
        const qIndex = (Number(me.question_index) || 0) % Math.max(1, questions.length);
        const q = questions[qIndex];
        if (!q) return;

        answerLockUntil = Date.now() + 260;
        const correct = Number(choice) === Number(q.answer);
        me.question_index = (Number(me.question_index) || 0) + 1;
        if (correct) {
            PSEngine.applyGreenCorrect(me, PSEngine.ROUND1.SPRINT_METERS, {
                at: Date.now(),
                finishDistance: room.finish_distance || PSEngine.ROUND1.FINISH_DISTANCE
            });
            sfxCorrect();
            toast('✅ +10 m! (' + (Number(me.distance) || 0) + ' / ' + (room.finish_distance || finishDistance()) + ' m)');
            if (me.reached_finish) showFinishOverlay();
        } else {
            PSEngine.applyGreenWrong(me);
            sfxWrong();
            const optsEl = $('ps-options');
            if (optsEl) {
                optsEl.classList.add('ps-options-wrong');
                setTimeout(function () { optsEl.classList.remove('ps-options-wrong'); }, 340);
            }
            toast('❌ Not this one — next question.');
        }
        questionsKey = '';
        renderPlayerQuestion(false);
    }

    function demoGlassJump(side) {
        if (!room || room.status !== 'round2' || !me || !isPlayingPlayer(me)) return;
        if (!me.glass_active || me.status !== 'alive') return;
        if (side !== 'left' && side !== 'right') return;
        const stepIndex = Math.max(0, Number(me.glass_step) || 0);
        const step = glassSteps[stepIndex];
        if (!step) return;
        const stepCount = Math.max(1, glassSteps.length || PSEngine.ROUND2.STEP_COUNT);
        const result = PSEngine.applyGlassJump(me, step, side, { stepCount: stepCount, at: Date.now() });
        if (result.outcome === 'correct') {
            sfxCorrect();
            if (me.crossed_glass) {
                sfxWin();
                showSurvivedOverlay();
            } else {
                me.glass_active = true;
                me.glass_started_at = Date.now();
                toast('✅ Tempered pane! Step ' + (Number(me.glass_step) || 0) + ' cleared.');
            }
        } else if (result.outcome === 'wrong') {
            sfxShatter();
            toast('💥 Normal glass! You fell — the correct pane is lit for the class.');
            showGlassOutOverlay('💥 You fell', 'The pane shattered. The correct side is now lit for the classmates behind you.');
        } else if (result.outcome === 'timeout') {
            sfxShatter();
            toast('⏱ Time up! No jump — you fell.');
            showGlassOutOverlay('⏱ No jump', 'The 5-second window closed and you fell. The correct pane was not revealed.');
        } else if (result.outcome !== 'ignored') {
            return;
        }
        questionsKey = '';
        renderPlayerQuestion(true);
        demoReleaseGlass(Date.now());
        if (!players.filter(isPlayingPlayer).some(PSEngine.isAlive)) demoFinishRound2(Date.now());
    }

    PS.isDemoMode = function () {
        return demoMode;
    };

    function demoApplyConfig(o) {
        const cfg = o || {};
        if (cfg.roundCount != null) {
            const n = Number(cfg.roundCount);
            if (isFinite(n)) demoRoundCount = Math.max(1, Math.min(PSEngine.HOST.MAX_IMPLEMENTED, Math.floor(n)));
        }
        if (cfg.finishDistance != null) demoFinishDistance = PSEngine.normalizeFinishDistance(cfg.finishDistance);
        if (cfg.glassSteps != null) demoGlassStepCount = PSEngine.normalizeGlassSteps(cfg.glassSteps);
        if (room) {
            room.finish_distance = demoFinishDistance;
            room.settings = demoSettings();
            glassSteps = demoBuildGlassSteps();
            room.glass_steps = glassSteps;
        }
    }

    PS.startDemo = function (opts) {
        const o = opts || {};
        demoMode = true;
        if (o.subject) demoSubject = PSEngine.normalizeSubject(o.subject) || 'vocab';
        if (o.role) demoRole = o.role === 'teacher' ? 'teacher' : 'student';
        demoApplyConfig(o);
        demoInstallShield();
        demoEnsureUser();
        if (!room) demoInit();
        demoApplyRoleClass();
        me = myPlayer();
        demoOpenView();
        demoStartLoop();
        if (o.scene) PS.demoJump(o.scene);
        else render();
        return true;
    };

    PS.setDemoSettings = function (opts) {
        if (!demoMode) return false;
        demoApplyConfig(opts || {});
        me = myPlayer();
        questionsKey = '';
        render();
        return true;
    };

    PS.setDemoRole = function (role) {
        if (!demoMode) return false;
        demoRole = role === 'teacher' ? 'teacher' : 'student';
        demoEnsureUser();
        demoApplyRoleClass();
        me = myPlayer();
        questionsKey = '';
        render();
        return true;
    };

    PS.setDemoSubject = function (subject) {
        if (!demoMode) return false;
        demoSubject = PSEngine.normalizeSubject(subject) || 'vocab';
        const built = PSEngine.buildDemoQuestionSet({ subject: demoSubject, seed: DEMO_SEED });
        questions = built.questions.slice();
        demoGlassPairs = built.glassPairs.slice();
        if (room) {
            room.finish_distance = demoFinishDistance;
            room.settings = demoSettings();
            glassSteps = demoBuildGlassSteps();
            room.glass_steps = glassSteps;
        }
        PS.demoJump('round1');
        return true;
    };

    PS.demoJump = function (scene) {
        if (!demoMode || !room) PS.startDemo({ role: demoRole, scene: 'lobby' });
        demoEnsureUser();
        demoApplyRoleClass();
        const target = String(scene || 'round1').toLowerCase();
        if (target === 'lobby' || target === 'waiting') demoJumpLobby();
        else if (target === 'round2' || target === 'glass') demoJumpRound2();
        else if (target === 'victory' || target === 'finished') demoJumpVictory();
        else demoJumpRound1();
        demoOpenView();
        demoStartLoop();
        render();
    };

    /* ------------------------------------------------------------------ */
    /* Wire listeners once                                                */
    /* ------------------------------------------------------------------ */

    document.addEventListener('keydown', handleKey);
    document.addEventListener('pointerdown', function (event) {
        if (typeof currentView === 'undefined' || currentView !== VIEW_ID) return;
        if (!room || (room.status !== 'round1' && room.status !== 'round2')) return;
        handleTap(event);
    }, { passive: true });

    root.addEventListener('resize', function () {
        if (typeof currentView !== 'undefined' && currentView === VIEW_ID) {
            resizeCanvas();
            if (rafId) startFrames();
        }
    });

    root.addEventListener('orientationchange', function () {
        setTimeout(() => {
            if (typeof currentView !== 'undefined' && currentView === VIEW_ID) {
                resizeCanvas();
                startFrames();
            }
        }, 180);
    });

    /* Direct public URL: index.html?psdemo=1 boots the same no-login demo
       without needing the wrapper page. The wrapper is still the public
       link; this keeps the flag usable on its own. */
    function demoAutoBoot() {
        try {
            const search = String((root.location && root.location.search) || '');
            if (!/[?&]psdemo=1(?:&|$)/.test(search)) return;
            if (demoMode) return;
            PS.startDemo({ role: 'student', scene: 'round1' });
        } catch (e) { /* ignore */ }
    }

    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { setTimeout(demoAutoBoot, 40); });
        } else {
            setTimeout(demoAutoBoot, 40);
        }
    } catch (e) { /* ignore */ }

    root.PS = PS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

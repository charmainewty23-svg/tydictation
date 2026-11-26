/* LearniTY — Purr-fect Survival main module.
 *
 * Homepage tile -> create / join lobby -> Round 1 (Red Light, Green Light)
 * -> Round 2 (Glass Stepping Stones) -> Round 3 (Tug of War)
 * -> Round 4 (Dalgona Candy Carving) -> Round 5 (Grammar Finals) -> victory.
 *
 * Rooms use short polling (no Realtime publication), exactly like Drive &
 * Go!. The host creates the room, picks 1-3 rounds with an independent
 * subject/topic per round (plus round-1 metres, round-2 glass steps and the
 * round-3 tug duration) and starts it. Students join with a 4-character
 * code and follow the host's settings.
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
    /* Qualifier beat between rounds: long enough to read ~15–30 names,
       auto-continues so a projector class is never stuck. */
    const QUALIFIER_MS = 7000;
    const ROOM_COLUMNS = 'id,code,host_id,status,subject,source,topic,bank_mode,seed,max_players,finish_distance,current_round,round1_started_at,round1_ends_at,round2_started_at,round2_ends_at,round3_started_at,round3_ends_at,round4_started_at,round4_ends_at,round5_started_at,round5_ends_at,finals_questions,phase_schedule,glass_steps,settings,tug_state,tug_questions,created_at,started_at,finished_at,server_now';
    const ROOM_COLUMNS_LIGHT = ROOM_COLUMNS.replace(',tug_questions', '');
    /* Every player column the HUD / board reads EXCEPT dalgona_item,
       dalgona_units and any finals answer payload: a phone must not receive
       the rest of a classmate's answers. The Round-4 poll fetches the
       current user's own candy in a separate one-row query, and the finals
       deck lives on the room (shared, never per-student). */
    const PLAYER_COLUMNS = 'room_id,user_id,email,nickname,cat,glasses,hat,outfit,distance,red_offences,status,ghost,eliminated_reason,question_index,last_red_phase,reached_finish,finished_at,round1_rank,glass_step,glass_side,glass_active,glass_started_at,glass_finished_at,crossed_glass,tug_team,answer_log,glass_order,is_playing,last_seen,dalgona_pattern,dalgona_progress,dalgona_cracks,dalgona_lick_used,dalgona_finished_at,advanced_round3,finals_progress,finals_combo,finals_ghost_correct,finals_question_index,ink_until,finals_eliminated_at';

    let room = null;
    let players = [];
    let me = null;
    let questions = [];
    let glassSteps = [];
    let tugQuestions = [];
    let myDalgonaItem = null;
    let dalgonaBanks = null;
    let finalsQuestions = [];
    let ghostQuestions = [];
    let finalsBanks = null;
    let lastInkUntil = '';
    let finalsPicks = [];
    let finalsShownKey = '';
    let finalsDeadline = 0;
    let finalsTimer = 0;
    let finalsTimerKey = '';
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
    let lickAnimStart = 0;
    let lickPending = false;
    let lastAlive = 0;
    let audioCtx = null;
    let soundOn = true;
    let musicTracks = { lobby: null, game: null, ceremony: null };
    let musicKind = '';
    let liveOn = false;
    let clockOffset = 0;
    let lastTickAt = 0;
    let introStart = 0;
    let introPlaying = false;
    let introSeen = {};
    let cueTimer = 0;
    let cineChipKey = '';
    let cineRuleKey = '';
    let lobbyRulesOpen = false;
    let lobbyRulesRoomKey = '';
    let ceremonyStart = 0;
    let ceremonyRoomId = '';
    let ceremonyCache = null;
    let ceremonyOfficial = null;
    let ceremonySaveState = '';
    let progressSig = '';
    let qualifierKeyRendered = '';
    let qualifierShownAt = {};
    let qualifierDismissed = {};

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
    let demoTugDuration = 60000;
    let demoDalgonaDuration = 180000;
    let demoFinalsDuration = 120000;
    let demoDalgonaAssignments = null;
    let demoFinalsSurvivorOverride = null;
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

    /* Same {cat, glasses, hat, outfit} shape the canvas renderer feeds to
       DG.drawCatAvatar, taken from whichever player is being drawn. */
    function playerLook(player) {
        const p = player || {};
        return {
            cat: p.cat || 'Ginger',
            glasses: p.glasses || 'None',
            hat: p.hat || 'None',
            outfit: p.outfit || 'None'
        };
    }

    /* Height the Round 4 question pad occupies under the stage. The renderer
       keeps the candy above it. 0 when the pad is hidden or not laid out
       (the renderer then uses its own conservative reserve). */
    function dalgonaPadBottom() {
        if (isHostView()) return 0;
        const box = $('ps-question');
        if (!box || !box.classList || box.classList.contains('hidden')) return 0;
        const h = Number(box.offsetHeight) || 0;
        return h > 0 ? Math.round(h) + 10 : 0;
    }

    /* Tight student Round 4 pad only; every other round and the teacher
       view keep the normal sizing. */
    function setRound4StudentClass(on) {
        const view = $('purrfect-survival-view');
        if (view && view.classList) view.classList.toggle('ps-r4-student', !!on);
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

    /* Teacher / projector: the same identity the canvas uses for the host
       camera. Demo teacher mode always counts as host. */
    function isHostView() {
        return (demoMode && demoRole === 'teacher') || (isHost() && (!me || !isPlayingPlayer(me)));
    }

    function roundIsPlayable() {
        return !!room && (room.status === 'round1' || room.status === 'round2'
            || room.status === 'round3' || room.status === 'round4'
            || room.status === 'round5');
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
        if (!room) return 0;
        const n = Number(room.current_round);
        if (n) return n;
        if (room.status === 'round5') return 5;
        if (room.status === 'round4') return 4;
        if (room.status === 'round3') return 3;
        if (room.status === 'round2') return 2;
        return 1;
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
        if (!room) return PSEngine.HOST.DEFAULT_ROUNDS;
        return PSEngine.roomRoundCount(room.settings || {});
    }

    function roundConfig(n) {
        if (!room) return null;
        return PSEngine.roundConfig(room.settings || {}, n, room);
    }

    function tugState() {
        return PSEngine.normalizeTugState(room && room.tug_state);
    }

    function tugBank() {
        const fromRoom = asArray(room && room.tug_questions);
        if (fromRoom.length) return fromRoom;
        return tugQuestions;
    }

    function tugTeamOf(player) {
        return player && (player.tug_team === 'red' || player.tug_team === 'blue') ? player.tug_team : '';
    }

    function dalgonaDuration() {
        const cfg = roundConfig(4);
        return cfg && cfg.dalgonaDuration
            ? cfg.dalgonaDuration
            : PSEngine.ROUND4.DEFAULT_MS;
    }

    function finalsDuration() {
        const cfg = roundConfig(5);
        return cfg && cfg.finalsDuration
            ? cfg.finalsDuration
            : PSEngine.ROUND5.DEFAULT_MS;
    }

    function finalsDeck() {
        const stored = asArray(room && room.finals_questions);
        if (stored.length) return stored;
        return finalsQuestions;
    }

    function ghostDeck() {
        if (ghostQuestions.length) return ghostQuestions;
        if (typeof PSEngine === 'undefined' || !PSEngine.buildGhostDeck) return [];
        ghostQuestions = PSEngine.buildGhostDeck({
            seed: PSEngine.coerceSeed((room && room.seed ? room.seed : 1) + 211),
            count: 12
        });
        return ghostQuestions;
    }

    function isFinalsRelevant(p) {
        return !!(p && p.is_playing !== false && (
            p.finals_progress != null || p.finals_combo != null
            || p.finals_eliminated_at != null || p.dalgona_finished_at != null
            || p.advanced_round3 === true
        ));
    }

    function myFinalsState() {
        if (!me) return null;
        return {
            progress: PSEngine.finalsProgress(me),
            combo: Math.max(0, Number(me.finals_combo) || 0),
            ghostCorrect: Math.max(0, Number(me.finals_ghost_correct) || 0),
            questionIndex: Math.max(0, Number(me.finals_question_index) || 0),
            eliminated: !PSEngine.isFinalsAlive(me),
            inkUntil: me.ink_until || null
        };
    }

    function inkActive() {
        if (!me || !me.ink_until) return false;
        const until = Date.parse(me.ink_until);
        return isFinite(until) && until > serverNow();
    }

    function inkRemainingMs() {
        if (!me || !me.ink_until) return 0;
        const until = Date.parse(me.ink_until);
        return isFinite(until) ? Math.max(0, until - serverNow()) : 0;
    }

    /* The current student's own assignment (item + units). Live rows keep
       the item out of the class-wide poll; the demo stores it directly. */
    function myDalgonaState() {
        if (!me) return PSEngine.normalizeDalgonaState({});
        const merged = Object.assign({}, me);
        if (myDalgonaItem) {
            merged.dalgona_item = myDalgonaItem.item || myDalgonaItem;
            if (!Array.isArray(merged.dalgona_units) || !merged.dalgona_units.length) {
                merged.dalgona_units = myDalgonaItem.units || [];
            }
            if (!merged.dalgona_pattern) merged.dalgona_pattern = myDalgonaItem.pattern || '';
            if (!merged.dalgona_finished_at && myDalgonaItem.finishedAt) {
                merged.dalgona_finished_at = myDalgonaItem.finishedAt;
            }
        }
        if ((!Array.isArray(merged.dalgona_units) || !merged.dalgona_units.length)
            && Array.isArray(me.dalgona_units)) {
            merged.dalgona_units = me.dalgona_units;
        }
        return PSEngine.normalizeDalgonaState(merged);
    }

    function dalgonaBoard() {
        return (typeof PSEngine.teacherRound4Board === 'function')
            ? PSEngine.teacherRound4Board(players, {})
            : [];
    }

    /* Round 5 canvas rows. Living finalists stand inside the fence; ghosts
       (anyone knocked out earlier or electrocuted in the finals) stand
       outside. The renderer only needs cosmetic fields. */
    function finalsArenaRows() {
        return players.filter(isPlayingPlayer).map(function (p) {
            const finalist = PSEngine.isFinalsFinalist(p);
            const alive = PSEngine.isFinalsAlive(p);
            return {
                user_id: p.user_id,
                name: p.nickname || 'Player',
                progress: PSEngine.finalsProgress(p),
                combo: Math.max(0, Number(p.finals_combo) || 0),
                isMe: !!(me && String(me.user_id) === String(p.user_id)),
                finalist: finalist,
                eliminated: !alive,
                ghost: p.ghost === true || !alive,
                ink: p.ink_until && Date.parse(p.ink_until) > serverNow(),
                look: playerLook(p)
            };
        });
    }

    function finalsGhostRows() {
        return finalsArenaRows().filter(function (row) { return row.ghost; });
    }

    function finalsLivingCount() {
        return players.filter(function (p) {
            return isPlayingPlayer(p) && PSEngine.isFinalsAlive(p);
        }).length;
    }

    /* Visual cat-lick window on the Hint button. The lick result itself is
       applied immediately (demo) or by the server (live); the renderer masks
       the newest carved dash until the tongue swipes past it. */
    function reducedMotionPref() {
        try {
            const mq = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)');
            return !!(mq && mq.matches);
        } catch (e) {
            return false;
        }
    }

    function lickAnimProgress() {
        if (typeof PSEngine === 'undefined' || !PSEngine.lickAnimProgress) return null;
        return PSEngine.lickAnimProgress(lickAnimStart, Date.now(), PSEngine.ROUND4.LICK_ANIM_MS);
    }

    function lickAnimActive() {
        return lickAnimProgress() != null;
    }

    function beginLickAnim() {
        if (reducedMotionPref()) {
            lickAnimStart = 0;
            return;
        }
        lickAnimStart = Date.now();
        sfxLick();
    }

    function setLickButtonPending(pending) {
        const btn = $('ps-lick-btn');
        if (!btn) return;
        if (pending) {
            btn.disabled = true;
            btn.classList.add('hidden');
        } else {
            btn.disabled = false;
        }
    }

    function dalgonaQualifierActive() {
        if (!room || room.status !== 'round4') return false;
        const start = room.round4_started_at ? Date.parse(room.round4_started_at) : 0;
        if (!start) return false;
        return serverNow() - start < PSEngine.ROUND4.QUALIFIER_MS;
    }

    function finishDistance() {
        const cfg = roundConfig(1);
        return cfg ? cfg.finishDistance : PSEngine.ROUND1.FINISH_DISTANCE;
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
        return 'Run supabase/purrfect_survival_round5_finals.sql in the Supabase SQL editor (project mggnwzirjmibreimrwiq). Paste it after the older Survival incrementals, clear the editor first, do not re-run older incrementals, then reload this page.';
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
        if (m.includes('ROUNDS_NOT_IMPLEMENTED')) return 'That round count is not available on this server yet. Run supabase/purrfect_survival_round5_finals.sql first (rounds 1–5 are supported after it runs).';
        if (m.includes('INVALID_ROUND_COUNT')) return 'Choose 1–5 rounds for this class.';
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

    /* Round 4: crisp steel-needle scratch, then the 咔嚓 crack. */
    function sfxScratch() {
        tone(2100, 0.045, 'sawtooth', 0.035);
        tone(1450, 0.06, 'square', 0.025, 0.03);
        tone(2600, 0.04, 'sawtooth', 0.022, 0.07);
    }

    function sfxCrack() {
        tone(150, 0.12, 'square', 0.10);
        tone(90, 0.18, 'sawtooth', 0.09, 0.03);
        tone(1200, 0.05, 'square', 0.035, 0.01);
    }

    /* Soft, short "lick" blip for the Round 4 hint animation. */
    function sfxLick() {
        tone(480, 0.09, 'sine', 0.035);
        tone(260, 0.08, 'triangle', 0.028, 0.05);
    }

    function sfxWin() {
        [520, 660, 780, 1040].forEach((f, i) => tone(f, 0.16, 'sine', 0.07, i * 0.09));
    }

    /* Three Survival tracks, shared by the live path and the official demo.
       None of the mp3s are in the service-worker precache; the browser
       caches them after the first play.
         lobby     — waiting room, /music/survival_lobby_music.mp3
         game      — rounds, the teacher's Survival track /music/survival_music.mp3
         ceremony  — prize ceremony, same /music/trophyMusic.mp3 as Word Battle
                     and Drive & Go! */
    const MUSIC_SPEC = {
        lobby: { src: '/music/survival_lobby_music.mp3', volume: 0.3, loop: true },
        game: { src: '/music/survival_music.mp3', volume: 0.3, loop: true },
        ceremony: { src: '/music/trophyMusic.mp3', volume: 0.45, loop: false }
    };

    function ensureTrack(kind) {
        const spec = MUSIC_SPEC[kind];
        if (!spec) return null;
        if (musicTracks[kind]) return musicTracks[kind];
        try {
            const track = new Audio(spec.src);
            track.loop = !!spec.loop;
            track.volume = spec.volume;
            track.preload = 'none';
            musicTracks[kind] = track;
        } catch (e) {
            musicTracks[kind] = null;
        }
        return musicTracks[kind];
    }

    function stopTrack(kind) {
        const track = musicTracks[kind];
        if (!track) return;
        try { track.pause(); track.currentTime = 0; } catch (e) { /* ignore */ }
    }

    function stopAllMusic() {
        stopTrack('lobby');
        stopTrack('game');
        stopTrack('ceremony');
        musicKind = '';
    }

    function desiredMusicKind() {
        if (!soundOn || !room) return '';
        if (room.status === 'waiting') return 'lobby';
        if (room.status === 'finished') return 'ceremony';
        if (room.status === 'round1' || room.status === 'round2'
            || room.status === 'round3' || room.status === 'round4'
            || room.status === 'round5') {
            return 'game';
        }
        return '';
    }

    function startTrack(kind) {
        if (!kind) {
            stopAllMusic();
            return;
        }
        if (musicKind && musicKind !== kind) {
            stopTrack('lobby');
            stopTrack('game');
            stopTrack('ceremony');
            musicKind = '';
        }
        const track = ensureTrack(kind);
        if (!track) return;
        musicKind = kind;
        try {
            const played = track.play();
            if (played && typeof played.catch === 'function') played.catch(() => {});
        } catch (e) { /* autoplay may still need a click */ }
    }

    function syncMusic() {
        startTrack(desiredMusicKind());
    }

    function startBgm() {
        syncMusic();
    }

    function stopBgm() {
        stopAllMusic();
    }

    /* Called from the public demo's parent bar (a real user gesture) and
       from the first in-iframe tap. Resumes the AudioContext and starts the
       track that matches the current room (lobby, gameplay, or ceremony). */
    PS.unlockAudio = function () {
        const ctx = audio();
        if (ctx && ctx.state === 'suspended') {
            try { ctx.resume().catch(() => {}); } catch (e) { /* ignore */ }
        }
        startBgm();
        return true;
    };

    PS.toggleSound = function () {
        soundOn = !soundOn;
        try { localStorage.setItem('learniTY_ps_sound', soundOn ? '1' : '0'); } catch (e) { /* ignore */ }
        const btn = $('ps-sound-btn');
        if (btn) {
            btn.textContent = soundOn ? '🔊' : '🔇';
            btn.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Turn sound on');
        }
        if (soundOn) {
            tone(660, 0.1, 'sine', 0.06);
            startBgm();
        } else {
            stopBgm();
        }
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
        show(roundId(r, 'vocab-scope-wrap'), source === 'New Vocab');
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
        if (subject === 'vocab') populateVocabSources(r);
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
        show('ps-round3-card', count >= 3);
        show('ps-round4-card', count >= 4);
        show('ps-round5-card', count >= 5);
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
        // The public demo sets currentUser through demoEnsureUser(), but
        // isGuestUser() can still report true inside the iframe. Never hide
        // the host settings there; live guest blocking stays unchanged.
        const guest = !demoMode && isGuest();
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
            vocabForm: selectValue(roundId(r, 'vocab-form'), ''),
            vocabScope: selectValue(roundId(r, 'vocab-scope'), 'all')
        };
    }

    PS.createRoom = async function () {
        if (demoMode) { PS.demoJump('round1'); return; }
        if (busy || !assertCanPlay()) return;
        setError('');
        const roundCount = syncRoundCount();
        const rounds = [];
        // Round 4 has no subject picker: it always uses all three banks.
        for (let r = 1; r <= Math.min(3, roundCount); r++) rounds.push(readRoundSetup(r));

        const validated = PSEngine.validateHostSettings({
            roundCount: roundCount,
            finishDistance: selectValue('ps-finish-distance', '100'),
            glassSteps: selectValue('ps-glass-steps', '9'),
            tugDuration: selectValue('ps-tug-duration', '60'),
            dalgonaDuration: selectValue('ps-dalgona-duration', '180'),
            finalsDuration: selectValue('ps-finals-duration', '120'),
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
                vocabScope: r1.vocabScope || 'all',
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
        tugQuestions = asArray(room.tug_questions);
        finalsQuestions = asArray(room.finals_questions);
        ghostQuestions = [];
        myDalgonaItem = null;
        lastInkUntil = '';
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
        return (room.status === 'round1' || room.status === 'round2'
            || room.status === 'round3' || room.status === 'round4'
            || room.status === 'round5') ? POLL_ACTIVE_MS : POLL_WAITING_MS;
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
            if (roundIsPlayable()) {
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

            const columns = (tugQuestions.length ? ROOM_COLUMNS_LIGHT : ROOM_COLUMNS)
                + (questions.length ? '' : ',questions');
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
            const fetchedTug = asArray(room.tug_questions);
            if (fetchedTug.length) tugQuestions = fetchedTug;
            glassSteps = asArray(room.glass_steps);
            const fetchedFinals = asArray(room.finals_questions);
            if (fetchedFinals.length) finalsQuestions = fetchedFinals;

            /* 4/5-round rooms store hidden answer payloads, so never select
               * (that would leak classmates' remaining answers during
               Rounds 1–3 as well). */
            const playerColumns = (room.status === 'round4' || room.status === 'round5'
                || roomRoundCount() >= 4)
                ? PLAYER_COLUMNS
                : '*';
            const result = await sb.from('purrfect_survival_players')
                .select(playerColumns)
                .eq('room_id', room.id);
            if (!result.error) players = result.data || [];
            me = myPlayer();
            if (room.status === 'round4') await loadMyDalgonaItem();
            else myDalgonaItem = null;
            if (room.status === 'finished') ceremonyCache = null;

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

    /* Round 4 keeps everyone's hidden remaining answer server-side. Only
       the signed-in student's own row is pulled into the browser. */
    async function loadMyDalgonaItem() {
        if (demoMode || !room || !me) return;
        const haveUnits = myDalgonaItem
            && myDalgonaItem.user_id === me.user_id
            && myDalgonaItem.room_id === room.id
            && Array.isArray(myDalgonaItem.units)
            && myDalgonaItem.units.length;
        if (haveUnits) return;
        try {
            const { data, error } = await sb.rpc('purrfect_survival_dalgona_item', {
                p_room_id: room.id
            });
            if (error || !data) return;
            const units = asArray(data.units);
            myDalgonaItem = {
                room_id: room.id,
                user_id: me.user_id,
                pattern: data.pattern || '',
                units: units,
                item: data.item || null,
                progress: Number(data.progress) || 0,
                cracks: Number(data.cracks) || 0,
                lickUsed: data.lick_used === true,
                finishedAt: data.finished_at || null
            };
            me.dalgona_pattern = data.pattern || me.dalgona_pattern || '';
            me.dalgona_progress = Number(data.progress) || 0;
            me.dalgona_cracks = Number(data.cracks) || 0;
            me.dalgona_lick_used = data.lick_used === true;
            me.dalgona_finished_at = data.finished_at || null;
            if (units.length) me.dalgona_units = units;
        } catch (e) { /* older SQL: item stays null, board still works */ }
    }

    function roomGone() {
        room = null;
        players = [];
        me = null;
        questions = [];
        glassSteps = [];
        tugQuestions = [];
        finalsQuestions = [];
        ghostQuestions = [];
        myDalgonaItem = null;
        lastInkUntil = '';
        introPlaying = false;
        resetLobbyRules();
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

    /* Compact waiting-lobby chips: names only, never the long rule text. */
    function lobbyChips() {
        if (typeof PSEngine === 'undefined' || !PSEngine.lobbyRoundChips) return [];
        const settings = Object.assign({}, (room && room.settings) || {});
        settings.roundCount = roomRoundCount();
        if (room && room.finish_distance != null && settings.finishDistance == null) {
            settings.finishDistance = room.finish_distance;
        }
        return PSEngine.lobbyRoundChips(settings);
    }

    function paintCineRules() {
        const host = $('ps-cine-rules');
        if (host) {
            const chips = lobbyChips();
            const key = JSON.stringify(chips);
            if (key !== cineChipKey || !host.innerHTML) {
                cineChipKey = key;
                host.innerHTML = chips.map((chip) =>
                    '<span class="ps-round-chip" data-round="' + chip.n + '">' +
                        '<span class="ps-round-chip-n">R' + chip.n + '</span>' +
                        '<span class="ps-round-chip-name">' + escapeText(chip.short) + '</span>' +
                        (chip.note ? '<span class="ps-round-chip-note">' + escapeText(chip.note) + '</span>' : '') +
                    '</span>'
                ).join('');
            }
        }
        paintCineHowto();
    }

    const LOBBY_RULE_TITLES = {
        1: '1-2-3 Meow!',
        2: 'Glass Stepping Stones',
        3: 'Tug of War',
        4: 'Dalgona Candy Carving',
        5: 'Grammar Finals'
    };

    /* The full bilingual instructions the waiting lobby used before the
       compact chips. They live in a collapsed panel so the chips, room
       code, player list and Start stay uncluttered. */
    function paintCineHowto() {
        const host = $('ps-cine-howto');
        if (!host) return;
        const count = roomRoundCount();
        const key = count + '|' + (room && room.id ? room.id : '');
        if (key === cineRuleKey && host.innerHTML) return;
        cineRuleKey = key;
        const en = (typeof PSEngine !== 'undefined' && PSEngine.RULE_TEXT) ? PSEngine.RULE_TEXT : null;
        const zh = (typeof PSEngine !== 'undefined' && PSEngine.RULE_TEXT_ZH) ? PSEngine.RULE_TEXT_ZH : null;
        let html = '';
        for (let n = 1; n <= count; n++) {
            html += '<div id="ps-cine-rule' + n + '" class="ps-rule-card">' +
                '<h3><span class="ps-rule-tag">ROUND ' + n + '</span> ' + escapeText(LOBBY_RULE_TITLES[n] || '') + '</h3>' +
                '<p id="ps-cine-rule' + n + '-en" class="ps-rule-en">' +
                    escapeText(en ? en['round' + n] : '') + '</p>' +
                '<p id="ps-cine-rule' + n + '-zh" class="ps-rule-zh">' +
                    escapeText(zh ? zh['round' + n] : '') + '</p>' +
                '</div>';
        }
        host.innerHTML = html;
    }

    /* The host detection for the rules toggle matches the Start button:
       a live host stays host even when they also joined as a player. The
       official demo teacher / projector mirrors that. */
    function hostCanToggleRules() {
        return isHost() || !!(demoMode && demoRole === 'teacher');
    }

    function applyLobbyRulesUI() {
        const can = hostCanToggleRules();
        const btn = $('ps-rules-toggle');
        const panel = $('ps-cine-howto');
        if (btn) {
            btn.classList.toggle('hidden', !can);
            btn.textContent = lobbyRulesOpen ? 'Hide rules' : 'Show rules';
            btn.setAttribute('aria-expanded', lobbyRulesOpen ? 'true' : 'false');
        }
        if (panel) panel.classList.toggle('hidden', !(can && lobbyRulesOpen));
    }

    PS.toggleLobbyRules = function (force) {
        if (!hostCanToggleRules()) return false;
        lobbyRulesOpen = typeof force === 'boolean' ? force : !lobbyRulesOpen;
        applyLobbyRulesUI();
        return lobbyRulesOpen;
    };

    PS.lobbyRulesOpen = function () {
        return !!lobbyRulesOpen;
    };

    function resetLobbyRules() {
        lobbyRulesOpen = false;
        lobbyRulesRoomKey = '';
        cineRuleKey = '';
    }

    function updateIntroChrome() {
        if (!room || room.status !== 'waiting') return;
        const elapsed = introElapsedMs();
        const revealAll = !introPlaying;
        const chips = $('ps-cine-rules');
        if (chips) chips.classList.toggle('is-in', revealAll || elapsed >= 6800);
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
        const roomKey = room ? String(room.id || room.code || '') : '';
        if (roomKey !== lobbyRulesRoomKey) {
            lobbyRulesRoomKey = roomKey;
            lobbyRulesOpen = false;
        }
        paintCineRules();
        applyLobbyRulesUI();

        setText('ps-code', room.code || '----');
        const total = totalPlayers();
        setText('ps-player-count', total + ' player' + (total === 1 ? '' : 's') + ' joined');
        const count = roomRoundCount();
        setText('ps-room-meta', count + ' round' + (count === 1 ? '' : 's') + ' · get ready');
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
    /* Teacher / projector side list                                      */
    /* ------------------------------------------------------------------ */

    function progressTitle(round) {
        if (round === 5) return 'ROUND 5 · Grammar Finals';
        if (round === 4) return 'ROUND 4 · Dalgona Candy Carving';
        if (round === 3) return 'ROUND 3 · Tug of War';
        if (round === 2) return 'ROUND 2 · Glass Stepping Stones';
        return 'ROUND 1 · 1-2-3 Meow!';
    }

    function progressStatusClass(status) {
        return String(status || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    function renderTeacherProgress() {
        const panel = $('ps-progress');
        if (!panel) return;
        const active = !!room && roundIsPlayable() && isHostView();
        show('ps-progress', active);
        if (!active) {
            progressSig = '';
            return;
        }
        const round = roomRound();
        const rows = (round === 4 && typeof PSEngine.teacherRound4Board === 'function')
            ? PSEngine.teacherRound4Board(players, {})
            : ((typeof PSEngine !== 'undefined' && PSEngine.teacherProgress)
                ? PSEngine.teacherProgress(players, {
                    round: round,
                    finishDistance: room.finish_distance || finishDistance(),
                    stepCount: glassSteps.length || PSEngine.ROUND2.STEP_COUNT,
                    tug: round === 3 ? tugState() : null,
                    phase: round === 1 ? ((phaseInfo() || {}).phase || '') : ''
                })
                : []);
        const sig = round + '|' + rows.map(r =>
            [r.user_id, r.place, r.name, r.detail, r.status, r.team, r.combo, r.near ? 1 : 0].join(':')
        ).join('|');
        if (sig === progressSig) return;
        progressSig = sig;
        setText('ps-progress-title', progressTitle(round));
        setText('ps-progress-count', rows.length + ' playing');
        const list = $('ps-progress-list');
        if (list) {
            list.innerHTML = rows.map(row => {
                const team = row.team && row.team !== 'Watching'
                    ? '<span class="ps-progress-team ps-progress-team-' + progressStatusClass(row.team) + '">' + escapeText(row.team) + '</span>'
                    : '';
                return '<div class="ps-progress-row ps-progress-' + progressStatusClass(row.status) + (row.near ? ' ps-progress-near' : '') + '">' +
                    '<span class="ps-progress-place">' + escapeText(row.place) + '</span>' +
                    '<span class="ps-progress-name">' + escapeText(row.name) + team + '</span>' +
                    '<span class="ps-progress-detail">' + escapeText(row.detail) + '</span>' +
                    '<span class="ps-progress-status">' + escapeText(row.status) + '</span>' +
                    '</div>';
            }).join('');
        }
    }

    /* ------------------------------------------------------------------ */
    /* Qualifier beat between rounds                                      */
    /* ------------------------------------------------------------------ */

    function qualifierInfo() {
        if (!room) return null;
        if (room.status === 'round2' && roomRoundCount() > 1) {
            const start = room.round2_started_at ? Date.parse(room.round2_started_at) : 0;
            if (!start) return null;
            const key = 'qualifier:1:' + room.id + ':' + String(room.round2_started_at);
            if (qualifierDismissed[key]) return null;
            const remaining = QUALIFIER_MS - Math.max(0, serverNow() - start);
            if (remaining <= 0) return null;
            return { key: key, fromRound: 1, remaining: remaining };
        }
        if (room.status === 'round3' && roomRoundCount() >= 3) {
            const tug = tugState();
            if (tug.phase !== 'briefing') return null;
            const key = 'qualifier:2:' + room.id;
            if (qualifierDismissed[key]) return null;
            const now = Date.now();
            if (!qualifierShownAt[key]) qualifierShownAt[key] = now;
            const remaining = QUALIFIER_MS - (now - qualifierShownAt[key]);
            if (remaining <= 0) return null;
            return { key: key, fromRound: 2, remaining: remaining };
        }
        if (room.status === 'round4' && roomRoundCount() >= 4) {
            const start = room.round4_started_at ? Date.parse(room.round4_started_at) : 0;
            if (!start) return null;
            const key = 'qualifier:3:' + room.id + ':' + String(room.round4_started_at);
            if (qualifierDismissed[key]) return null;
            const remaining = PSEngine.ROUND4.QUALIFIER_MS - Math.max(0, serverNow() - start);
            if (remaining <= 0) return null;
            return { key: key, fromRound: 3, remaining: remaining };
        }
        return null;
    }

    function qualifierRosterRows(fromRound) {
        if (typeof PSEngine === 'undefined' || !PSEngine.qualifierRoster) return [];
        return PSEngine.qualifierRoster(players, {
            fromRound: fromRound,
            tug: room && room.status === 'round4' ? tugState() : null,
            finishDistance: room && room.finish_distance ? room.finish_distance : finishDistance()
        });
    }

    function renderQualifier() {
        const info = qualifierInfo();
        const panel = $('ps-qualifier');
        if (room && room.status === 'round3') {
            /* The board auto-hides after QUALIFIER_MS; do not leave the
               host's Start button hidden until the next poll. */
            show('ps-tug-start-btn', isHost() && tugState().phase === 'briefing' && !info);
        }
        if (!info) {
            if (panel) panel.classList.add('hidden');
            qualifierKeyRendered = '';
            return;
        }
        if (qualifierKeyRendered !== info.key) {
            qualifierKeyRendered = info.key;
            setText('ps-qualifier-title', (typeof PSEngine !== 'undefined' && PSEngine.qualifierTitle)
                ? PSEngine.qualifierTitle(info.fromRound)
                : 'Advancing players');
            const roster = qualifierRosterRows(info.fromRound);
            setText('ps-qualifier-sub', info.fromRound >= 3
                ? 'These students won the Tug of War. Their dalgona candy is stamped next — no carving clock until this board ends.'
                : (info.fromRound >= 2
                    ? 'These students crossed the glass bridge. The Tug of War briefing follows — no clock until the host starts.'
                    : 'These students are moving on to the glass bridge. The first pane opens after this board.'));
            setText('ps-qualifier-count', roster.length + ' player' + (roster.length === 1 ? '' : 's') + ' advancing');
            const list = $('ps-qualifier-list');
            if (list) {
                list.innerHTML = roster.map(row => {
                    const team = row.team === 'red' || row.team === 'blue'
                        ? '<span class="ps-qualifier-team ps-qualifier-team-' + row.team + '">' + (row.team === 'red' ? 'RED' : 'BLUE') + '</span>'
                        : '';
                    return '<div class="ps-qualifier-row">' +
                        '<span class="ps-qualifier-place">' + escapeText(row.place) + '</span>' +
                        '<span class="ps-qualifier-name">' + escapeText(row.name) + team + '</span>' +
                        '<span class="ps-qualifier-detail">' + escapeText(row.detail) + '</span>' +
                        '</div>';
                }).join('');
            }
        }
        show('ps-qualifier', true);
        setText('ps-qualifier-timer', 'Auto-continue in ' + Math.max(1, Math.ceil(info.remaining / 1000)) + 's');
    }

    PS.dismissQualifier = function () {
        const info = qualifierInfo();
        if (info) qualifierDismissed[info.key] = true;
        if (info && info.fromRound === 1 && !demoMode) {
            toast('The first glass pane opens when the 7-second qualifier window ends.');
        }
        qualifierKeyRendered = '';
        renderQualifier();
        renderTeacherProgress();
    };

    function resetQualifierState() {
        qualifierKeyRendered = '';
        qualifierShownAt = {};
        qualifierDismissed = {};
        progressSig = '';
        show('ps-qualifier', false);
    }

    /* ------------------------------------------------------------------ */
    /* Game rendering                                                     */
    /* ------------------------------------------------------------------ */

    function render() {
        setRound4StudentClass(!!room && room.status === 'round4' && !isHostView());
        if (!room) {
            setPanel('lobby');
            setLive(false);
            show('ps-code-chip', false);
            show('ps-progress', false);
            show('ps-qualifier', false);
            renderRejoin();
            syncMusic();
            return;
        }
        if (room.status === 'waiting') {
            hideCeremony();
            show('ps-progress', false);
            show('ps-qualifier', false);
            renderWaiting();
            syncMusic();
            return;
        }
        if (room.status === 'finished') {
            if (introPlaying) markIntroSeen(room.id);
            show('ps-progress', false);
            show('ps-qualifier', false);
            renderCeremony();
            return;
        }
        hideCeremony();
        if (introPlaying) markIntroSeen(room.id);
        setPanel('game');
        setLive(roundIsPlayable());
        const isR5 = room.status === 'round5' || (room.status === 'finished' && roomRound() === 5);
        const isR4 = !isR5 && (room.status === 'round4' || (room.status === 'finished' && roomRound() === 4));
        const isR3 = !isR5 && !isR4 && (room.status === 'round3' || (room.status === 'finished' && roomRound() === 3));
        const isR2 = !isR5 && !isR4 && !isR3 && roomRound() === 2;
        setText('ps-hud-round', isR5
            ? 'ROUND 5 · Grammar Finals'
            : (isR4
                ? 'ROUND 4 · Dalgona Candy Carving'
                : (isR3 ? 'ROUND 3 · Tug of War'
                    : (isR2 ? 'ROUND 2 · Glass Stepping Stones' : 'ROUND 1 · 1-2-3 Meow!'))));
        /* Student phones get a deliberately text-light Round 4 card: the
           long rule paragraph is hidden there, and restored for every other
           round and for the teacher / projector view. */
        const studentR4 = isR4 && !isHostView();
        const ruleEl = $('ps-hud-rule');
        setText('ps-hud-rule', studentR4
            ? ''
            : (isR5 ? PSEngine.RULE_TEXT.round5
                : (isR4 ? PSEngine.RULE_TEXT.round4
                    : (isR3 ? PSEngine.RULE_TEXT.round3
                        : (isR2 ? PSEngine.RULE_TEXT.round2 : PSEngine.RULE_TEXT.round1)))));
        if (ruleEl) ruleEl.classList.toggle('hidden', studentR4);
        const alive = isR5 ? finalsLivingCount() : alivePlayers().length;
        const total = totalPlayers();
        setText('ps-hud-alive', 'Alive: ' + alive + ' / ' + total);
        lastAlive = alive;
        const codeChip = $('ps-code-chip');
        if (codeChip) {
            codeChip.classList.remove('hidden');
            codeChip.textContent = 'Room ' + (room.code || '----');
        }
        const host = isHost();
        const tug = isR3 ? tugState() : null;
        const briefing = !!(tug && tug.phase === 'briefing');
        const qualifying = !!qualifierInfo();
        const endable = hostEndableRound();
        show('ps-host-end', !!endable);
        const endBtn = $('ps-host-end');
        if (endBtn && endable) endBtn.textContent = endRoundLabel(endable);
        show('ps-tug-start-btn', host && isR3 && briefing && !qualifying);
        if (me && isPlayingPlayer(me)) renderPlayerQuestion(isR2, isR3, isR4, isR5);
        else renderSpectator(isR2, isR3, isR4, isR5);
        renderTeacherProgress();
        renderQualifier();
        checkMilestones();
        syncMusic();
        requestAnimationFrame(() => startFrames());
    }

    function renderSpectator(isR2, isR3, isR4, isR5) {
        if (!me || (demoMode && !isPlayingPlayer(me))) {
            // Teacher / host spectating with no player seat: keep the whole
            // track, bridge, candy grid or arena unobstructed.
            show('ps-question', false);
            show('ps-lick-btn', false);
            show('ps-ink-btn', false);
            return;
        }
        show('ps-question', true);
        show('ps-lick-btn', false);
        show('ps-ink-btn', false);
        setText('ps-carved', '');
        setText('ps-prompt', 'Live class view');
        const opts = $('ps-options');
        if (opts) opts.innerHTML = '';
        if (isR5) {
            toast('👀 Watching the Grammar Finals.');
        } else if (isR4) {
            toast('👀 Watching Round 4.');
        } else if (isR3) {
            const t = tugState();
            toast(t.phase === 'briefing'
                ? 'Waiting for the host to start the Tug of War.'
                : 'Watching the tug of war — red ' + t.redPull + ' · blue ' + t.bluePull + '.');
        } else {
            toast(isR2
                ? 'Watching the glass bridge — ' + alivePlayers().length + ' still standing.'
                : 'Watching the race — ' + alivePlayers().length + ' still running.');
        }
    }

    function renderPlayerQuestion(isR2, isR3, isR4, isR5) {
        const box = $('ps-question');
        if (!box) return;
        box.classList.remove('hidden');
        if (isR5) {
            renderFinalsTurn();
            return;
        }
        show('ps-ink-btn', false);
        if (me.status === 'eliminated' || me.ghost) {
            show('ps-lick-btn', false);
            setText('ps-prompt', isR4 ? '💥' : '👻 You are out — but you can watch your classmates.');
            setText('ps-carved', '');
            const opts = $('ps-options');
            if (opts) opts.innerHTML = '';
            if (!isR4) toast('Eliminated. Stay and watch the rest of the class.');
            return;
        }
        if (isR4) renderDalgonaTurn();
        else {
            setText('ps-carved', '');
            show('ps-lick-btn', false);
            if (isR3) renderTugTurn();
            else if (isR2) renderGlassTurn();
            else renderRound1Question();
        }
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

    /* One shared topic bank; each player gets their own sequence. Live rows
       carry the server-generated glass_order so the phone and the jump RPC
       always agree. Older rows (or the demo) fall back to the pure engine. */
    function playerGlassSteps(p) {
        if (!p) return [];
        const seed = room ? room.seed : PSEngine.coerceSeed(0);
        return PSEngine.glassStepsForPlayer(glassSteps, p.user_id, seed, p.glass_order);
    }

    function glassStepsForViewer() {
        if (!glassSteps.length) return [];
        const host = isHostView();
        let who = null;
        if (host) {
            who = players.find(function (p) {
                return p && p.is_playing !== false && p.glass_active === true && p.status === 'alive';
            }) || null;
        } else if (me && isPlayingPlayer(me)) {
            who = me;
        }
        if (!who) {
            return glassSteps.map(function (src, i) {
                return {
                    index: i,
                    bank_index: i,
                    prompt: src.prompt || '',
                    left: src.left || '',
                    right: src.right || '',
                    correct_side: src.correct_side === 'right' ? 'right' : 'left',
                    revealed: false,
                    revealed_side: null,
                    shattered_side: null
                };
            });
        }
        const steps = playerGlassSteps(who);
        const done = Math.max(0, Number(who.glass_step) || 0);
        for (let i = 0; i < Math.min(done, steps.length); i++) {
            steps[i].revealed = true;
            steps[i].revealed_side = steps[i].correct_side;
        }
        if (who.glass_shattered && done < steps.length && who.glass_side) {
            steps[done].shattered_side = who.glass_side === 'right' ? 'right' : 'left';
        }
        return steps;
    }

    function renderGlassTurn() {
        const steps = Math.max(1, Number(glassSteps.length) || PSEngine.ROUND2.STEP_COUNT);
        if (me.crossed_glass || me.status === 'advanced') {
            const tugNext = roomRoundCount() >= 3;
            setText('ps-prompt', tugNext
                ? '🎉 You crossed the glass bridge. Get ready for the Tug of War!'
                : '🎉 You crossed the glass bridge. Waiting for the mid-victory screen.');
            const opts = $('ps-options');
            if (opts) opts.innerHTML = '';
            toast(tugNext ? 'Survivor! Wait for the host to start the Tug of War.' : 'Survivor! Stay for the mid-victory screen.');
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
        const mySteps = playerGlassSteps(me);
        const step = mySteps[stepIndex];
        if (!step) {
            setText('ps-prompt', 'Waiting for the next pane…');
            const opts = $('ps-options');
            if (opts) opts.innerHTML = '';
            return;
        }
        const key = 'r2:' + stepIndex + ':' + step.left + '|' + step.right + ':' + String(me.glass_order ? me.glass_order.join(',') : '');
        if (key !== questionsKey) {
            questionsKey = key;
            setText('ps-prompt', (step.prompt ? step.prompt + '  ' : '') + 'Pick the tempered pane!');
            const opts = $('ps-options');
            if (opts) {
                opts.classList.add('ps-options-glass');
                opts.innerHTML =
                    '<button type="button" class="ps-opt ps-glass-opt" data-choice="0" onclick="PS.jump(\'left\')">' +
                    '<span class="ps-opt-key">←</span><span class="ps-opt-text">' + escapeText(step.left) + '</span></button>' +
                    '<button type="button" class="ps-opt ps-glass-opt" data-choice="1" onclick="PS.jump(\'right\')">' +
                    '<span class="ps-opt-key">1</span><span class="ps-opt-text">' + escapeText(step.right) + '</span></button>';
            }
        }
    }

    function renderTugTurn() {
        const state = tugState();
        const team = tugTeamOf(me);
        const opts = $('ps-options');
        if (opts) {
            opts.classList.remove('ps-options-glass', 'ps-options-red', 'ps-options-busy');
        }
        if (!team) {
            setText('ps-prompt', '👀 You are spectating this Tug of War — only the glass-bridge survivors have a team.');
            if (opts) opts.innerHTML = '';
            return;
        }
        const teamLabel = team === 'red' ? '🔴 RED team' : '🔵 BLUE team';
        if (state.phase === 'briefing') {
            setText('ps-prompt', teamLabel + ' · ' + (isHost()
                ? 'Press Start Tug of War when the class is ready.'
                : 'Waiting for the host to start the Tug of War…'));
            if (opts) opts.innerHTML = '';
            return;
        }
        if (state.phase === 'done') {
            setText('ps-prompt', state.winner
                ? (state.winner === team ? '🏆 Your team won the Tug of War!' : '💀 Your team fell into the abyss.')
                : 'The Tug of War is over.');
            if (opts) opts.innerHTML = '';
            return;
        }
        const bank = tugBank();
        const qIndex = (Number(me.question_index) || 0) % Math.max(1, bank.length);
        const q = bank[qIndex];
        if (!q) {
            setText('ps-prompt', 'Loading the Tug of War question bank…');
            if (opts) opts.innerHTML = '';
            return;
        }
        const combo = team === 'red' ? state.redCombo : state.blueCombo;
        const rage = PSEngine.tugRageActive(state, team, serverNow());
        const lead = state.position === 0 ? 'Level' : (state.position > 0 ? 'Blue +' + state.position : 'Red +' + Math.abs(state.position));
        setText('ps-prompt', teamLabel + ' · ' + lead + ' · Combo ' + combo + '/' + PSEngine.ROUND3.COMBO
            + (rage ? ' · 爆走拉力 2x' : '') + ' — ' + (q.prompt || ''));
        const key = 'r3:' + qIndex + ':' + (q.options || []).join('|') + ':' + team;
        if (key !== questionsKey) {
            questionsKey = key;
            if (opts) {
                opts.innerHTML = (q.options || []).map((label, i) =>
                    '<button type="button" class="ps-opt ps-tug-opt" data-choice="' + i + '" onclick="PS.tugAnswer(' + i + ')">' +
                    '<span class="ps-opt-key">' + (i + 1) + '</span>' +
                    '<span class="ps-opt-text">' + escapeText(label) + '</span>' +
                    '</button>'
                ).join('');
            }
        }
    }

    function dalgonaUsedCounts(units, progress) {
        const used = {};
        for (let i = 0; i < Math.min(progress, units.length); i++) {
            const key = String(units[i]).toLowerCase();
            used[key] = (used[key] || 0) + 1;
        }
        return used;
    }

    function renderDalgonaTurn() {
        const st = myDalgonaState();
        const opts = $('ps-options');
        const lick = $('ps-lick-btn');
        const box = $('ps-question');
        if (opts) {
            opts.classList.remove('ps-options-glass', 'ps-options-red', 'ps-options-busy');
        }
        if (box) box.classList.remove('ps-danger-frame');
        if (!st.pattern || !st.units.length) {
            setText('ps-prompt', '🍬');
            setText('ps-carved', '');
            if (opts) opts.innerHTML = '';
            show('ps-lick-btn', false);
            return;
        }
        const total = st.units.length;
        const prog = Math.min(st.progress, total);
        /* Hold back the newest dash while the cat's tongue is still swiping. */
        const anim = lickAnimProgress();
        const carvedProg = anim != null && anim < 0.55 ? Math.max(0, prog - 1) : prog;

        if (st.status === 'finished') {
            setText('ps-prompt', '✅');
            setText('ps-carved', '');
            if (opts) opts.innerHTML = '';
            show('ps-lick-btn', false);
            return;
        }
        if (st.status === 'shattered') {
            setText('ps-prompt', '💥');
            setText('ps-carved', '');
            if (opts) opts.innerHTML = '';
            show('ps-lick-btn', false);
            return;
        }
        if (dalgonaQualifierActive()) {
            setText('ps-prompt', '🏁');
            setText('ps-carved', '');
            if (opts) opts.innerHTML = '';
            show('ps-lick-btn', false);
            return;
        }
        if (box && st.status === 'danger') box.classList.add('ps-danger-frame');
        /* Minimal question only: Chinese hint (fishbone) or the source
           sentences (paw / crown). The carved answer lives on its own compact
           line with no extra wording. */
        const prompt = st.pattern === 'fishbone'
            ? (st.prompt ? '「' + st.prompt + '」' : '')
            : (st.prompt || '');
        setText('ps-prompt', prompt);
        const carved = st.units.slice(0, carvedProg).join(st.pattern === 'fishbone' ? '' : ' ');
        setText('ps-carved', carved);
        if (lick) {
            const canLick = !st.lickUsed && prog < total && !lickPending && !lickAnimActive();
            show('ps-lick-btn', canLick);
            lick.disabled = !canLick;
        }
        if (!opts) return;
        const key = 'r4:' + st.pattern + ':' + prog + ':' + String(st.lickUsed) + ':' + st.target + ':' + (st.cracks || 0);
        if (key === questionsKey) return;
        questionsKey = key;
        if (st.pattern === 'fishbone') {
            opts.classList.add('ps-options-letters');
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
            opts.innerHTML = letters.map(function (ch) {
                return '<button type="button" class="ps-opt ps-opt-dalgona" data-choice="' + ch + '" ' +
                    'onclick="PS.dalgonaInput(\'' + ch + '\')">' +
                    '<span class="ps-opt-text">' + ch + '</span></button>';
            }).join('');
            return;
        }
        opts.classList.remove('ps-options-letters');
        opts.classList.add('ps-options-dalgona');
        const tiles = Array.isArray(st.tiles) && st.tiles.length ? st.tiles : st.units;
        const used = dalgonaUsedCounts(st.units, prog);
        const seen = {};
        opts.innerHTML = tiles.map(function (token, i) {
            const norm = String(token).toLowerCase();
            const needed = st.units.filter(function (u) { return String(u).toLowerCase() === norm; }).length;
            const already = used[norm] || 0;
            const left = Math.max(0, needed - already);
            let taken = seen[norm] || 0;
            seen[norm] = taken + 1;
            const disabled = taken >= (needed - already) && needed > 0 ? ' ps-opt-used' : '';
            const encoded = encodeURIComponent(String(token));
            return '<button type="button" class="ps-opt ps-opt-dalgona' + disabled + '" data-choice="' + i + '" ' +
                'onclick="PS.dalgonaInput(decodeURIComponent(\'' + encoded + '\'))">' +
                '<span class="ps-opt-text">' + escapeText(token) + '</span></button>';
        }).join('');
    }

    /* ------------------------------------------------------------------ */
    /* Round 5 — Grammar Finals                                           */
    /* ------------------------------------------------------------------ */

    function finalsKeyFor(q, ghost) {
        if (!q) return '';
        return (ghost ? 'g:' : 'f:') + q.id + ':' + (q.prompt || '') + ':' + String(q.answer);
    }

    function clearFinalsTimer() {
        if (finalsTimer) clearTimeout(finalsTimer);
        finalsTimer = 0;
        finalsDeadline = 0;
        finalsTimerKey = '';
    }

    function armFinalsTimer(q, ghost, key) {
        if (finalsTimerKey === key) return;
        clearFinalsTimer();
        finalsTimerKey = key;
        /* Force the options to rebuild for this question. */
        finalsShownKey = '';
        finalsPicks = [];
        if (ghost || !q) return;
        const ms = Number(q.ms) || (q.type === 'double_trap' ? PSEngine.ROUND5.DOUBLE_TRAP_MS : PSEngine.ROUND5.ERROR_MS);
        finalsDeadline = Date.now() + ms;
        finalsTimer = setTimeout(function () {
            finalsTimer = 0;
            if (!room || room.status !== 'round5' || !me) return;
            if (!PSEngine.isFinalsAlive(me)) return;
            PS.finalsAnswer(null);
        }, ms + 40);
    }

    function setInkCover(on, remainingMs) {
        const cover = $('ps-ink-cover');
        if (!cover) return;
        cover.classList.toggle('hidden', !on);
        if (on) {
            const label = cover.querySelector ? cover.querySelector('.ps-ink-time') : null;
            if (label) label.textContent = Math.max(0.1, (remainingMs || 0) / 1000).toFixed(1) + 's';
        }
    }

    function renderFinalsTurn() {
        const opts = $('ps-options');
        const box = $('ps-question');
        if (opts) opts.classList.remove('ps-options-glass', 'ps-options-red', 'ps-options-busy', 'ps-options-letters', 'ps-options-dalgona');
        if (box) box.classList.remove('ps-danger-frame');
        show('ps-lick-btn', false);

        const st = myFinalsState();
        const ghostView = !st || st.eliminated || me.ghost === true || me.status === 'eliminated';
        const deck = ghostView ? ghostDeck() : finalsDeck();
        const ink = !ghostView && inkActive();

        setInkCover(ink, inkRemainingMs());
        if (ink) {
            clearFinalsTimer();
            finalsShownKey = '';
            setText('ps-prompt', '🖤 Ink bomb! Your question is covered.');
            setText('ps-carved', '');
            show('ps-ink-btn', false);
            if (opts) opts.innerHTML = '';
            return;
        }

        if (ghostView) {
            const qIndex = (Number(me.finals_question_index) || 0) % Math.max(1, deck.length);
            const q = deck[qIndex];
            if (!q) {
                setText('ps-prompt', '👻 Waiting for the next revival question…');
                setText('ps-carved', '');
                if (opts) opts.innerHTML = '';
                show('ps-ink-btn', false);
                return;
            }
            const correctCount = Math.max(0, Number(me.finals_ghost_correct) || 0);
            const leader = PSEngine.leaderForInk(players);
            setText('ps-prompt', '👻 Ghost revival · ' + correctCount + '/' + PSEngine.ROUND5.GHOST_NEED
                + ' · ' + (q.prompt || 'Choose the correct sentence.'));
            setText('ps-carved', '');
            const key = finalsKeyFor(q, true) + ':' + correctCount;
            show('ps-ink-btn', correctCount >= PSEngine.ROUND5.GHOST_NEED && !!leader);
            const inkBtn = $('ps-ink-btn');
            if (inkBtn) {
                inkBtn.textContent = leader
                    ? '🖤 Throw ink bomb at ' + (leader.nickname || 'the leader')
                    : '🖤 Throw ink bomb';
                inkBtn.disabled = !leader || correctCount < PSEngine.ROUND5.GHOST_NEED;
            }
            if (key === finalsShownKey || !opts) return;
            finalsShownKey = key;
            opts.innerHTML = (q.options || []).map(function (label, i) {
                return '<button type="button" class="ps-opt ps-finals-opt" data-choice="' + i + '" onclick="PS.ghostAnswer(' + i + ')">' +
                    '<span class="ps-opt-key">' + (i + 1) + '</span>' +
                    '<span class="ps-opt-text">' + escapeText(label) + '</span>' +
                    '</button>';
            }).join('');
            return;
        }

        show('ps-ink-btn', false);
        const qIndex = (Number(me.finals_question_index) || 0) % Math.max(1, deck.length);
        const q = deck[qIndex];
        if (!q) {
            setText('ps-prompt', 'Loading the Grammar Finals…');
            setText('ps-carved', '');
            if (opts) opts.innerHTML = '';
            return;
        }
        const key = finalsKeyFor(q, false);
        armFinalsTimer(q, false, key);

        const progress = PSEngine.finalsProgress(me);
        const combo = Math.max(0, Number(me.finals_combo) || 0);
        const timeLeft = finalsDeadline ? Math.max(0, finalsDeadline - Date.now()) : 0;
        setText('ps-carved', '⚡ ' + progress + ' · combo ' + combo + '/' + PSEngine.ROUND5.COMBO
            + (timeLeft ? ' · ' + (timeLeft / 1000).toFixed(1) + 's' : ''));
        setText('ps-prompt', q.type === 'double_trap'
            ? 'Double-Trap Cloze · both blanks must be right. ' + (q.prompt || '')
            : 'Error Spotting · tap the part with the mistake. ' + (q.prompt || ''));

        if (opts && key !== finalsShownKey) {
            finalsShownKey = key;
            finalsPicks = [];
            if (q.type === 'error_spotting') {
                opts.innerHTML = (q.tokens || []).map(function (token, i) {
                    return '<button type="button" class="ps-opt ps-finals-opt ps-finals-token" data-choice="' + (i + 1) + '" onclick="PS.finalsAnswer(' + (i + 1) + ')">' +
                        '<span class="ps-opt-key">' + (i + 1) + '</span>' +
                        '<span class="ps-opt-text">' + escapeText(token) + '</span>' +
                        '</button>';
                }).join('');
            } else {
                opts.innerHTML = (q.blanks || []).map(function (blank, b) {
                    return '<div class="ps-finals-blank" data-blank="' + b + '">' +
                        '<span class="ps-finals-blank-n">' + (b + 1) + '</span>' +
                        (blank.options || []).map(function (label, i) {
                            return '<button type="button" class="ps-opt ps-finals-opt" data-blank="' + b + '" data-choice="' + i + '" onclick="PS.finalsPick(' + b + ',' + i + ')">' +
                                escapeText(label) + '</button>';
                        }).join('') +
                        '</div>';
                }).join('') +
                '<button id="ps-finals-submit" type="button" class="ps-primary ps-finals-submit" onclick="PS.finalsSubmitTrap()" disabled>Answer both</button>';
            }
        }
        if (q.type === 'double_trap') {
            const btn = $('ps-finals-submit');
            const blanks = q.blanks || [];
            const complete = blanks.every(function (_, i) {
                const pick = Number(finalsPicks[i]);
                return isFinite(pick) && finalsPicks[i] != null && finalsPicks[i] !== '';
            });
            if (btn) btn.disabled = !complete;
            const rows = (opts && typeof opts.querySelectorAll === 'function')
                ? opts.querySelectorAll('.ps-finals-blank') : [];
            for (let b = 0; b < rows.length; b++) {
                const chosen = finalsPicks[b];
                const buttons = (rows[b] && typeof rows[b].querySelectorAll === 'function')
                    ? rows[b].querySelectorAll('button') : [];
                for (let i = 0; i < buttons.length; i++) {
                    buttons[i].classList.toggle('ps-opt-picked', Number(chosen) === i);
                }
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Round 4 actions                                                    */
    /* ------------------------------------------------------------------ */

    function dalgonaShake() {
        const box = $('ps-question');
        if (!box) return;
        box.classList.remove('ps-options-wrong');
        void box.offsetWidth;
        box.classList.add('ps-options-wrong');
        setTimeout(function () { box.classList.remove('ps-options-wrong'); }, 340);
    }

    PS.dalgonaInput = async function (value) {
        if (demoMode) { demoDalgonaInput(value); return; }
        if (busy || !room || room.status !== 'round4' || !me || !isPlayingPlayer(me)) return;
        if (me.ghost || me.status === 'eliminated') return;
        if (dalgonaQualifierActive()) return;
        if (Date.now() < answerLockUntil) return;
        busy = true;
        answerLockUntil = Date.now() + 220;
        try {
            const { data, error } = await sb.rpc('submit_purrfect_survival_dalgona', {
                p_room_id: room.id,
                p_value: String(value == null ? '' : value)
            });
            if (error) return setError(errorMessage(error));
            const res = Array.isArray(data) ? data[0] : data;
            if (!res) return;
            if (res.ok === false) {
                if (res.error === 'NOT_CARVING') toast('You are spectating this round.');
                return;
            }
            if (res.player) {
                me = res.player;
                const idx = players.findIndex(p => String(p.user_id) === String(me.user_id));
                if (idx >= 0) players[idx] = me;
            }
            if (res.correct) {
                sfxScratch();
                if (res.finished) sfxWin();
                toast('');
            } else if (res.eliminated) {
                sfxShatter();
                dalgonaShake();
                toast('');
                showGlassOutOverlay('💥 Candy split', 'You can watch the class.');
            } else {
                sfxCrack();
                dalgonaShake();
                toast('咔嚓！');
            }
            questionsKey = '';
            renderPlayerQuestion(false, false, true);
        } finally {
            busy = false;
        }
    };

    PS.dalgonaLick = async function () {
        if (demoMode) { demoDalgonaLick(); return; }
        if (busy || lickPending || lickAnimActive() || !room || room.status !== 'round4' || !me || !isPlayingPlayer(me)) return;
        if (me.ghost || me.status === 'eliminated' || dalgonaQualifierActive()) return;
        const st = myDalgonaState();
        if (st.lickUsed || st.status === 'finished' || st.status === 'shattered') return;
        lickPending = true;
        busy = true;
        setLickButtonPending(true);
        beginLickAnim();
        let applied = false;
        try {
            const { data, error } = await sb.rpc('lick_purrfect_survival_dalgona', { p_room_id: room.id });
            if (error) {
                lickAnimStart = 0;
                return setError(errorMessage(error));
            }
            const res = Array.isArray(data) ? data[0] : data;
            if (!res || res.applied === false || res.ok === false) {
                lickAnimStart = 0;
                return;
            }
            if (res.player) {
                me = res.player;
                const idx = players.findIndex(p => String(p.user_id) === String(me.user_id));
                if (idx >= 0) players[idx] = me;
            }
            applied = true;
            /* No toast: the tongue and the newly filled dash are the feedback.
               The animation keeps playing for its full window. */
            toast('');
            questionsKey = '';
        } finally {
            busy = false;
            lickPending = false;
            if (!applied) lickAnimStart = 0;
            setLickButtonPending(false);
            if (room && room.status === 'round4') renderPlayerQuestion(false, false, true);
        }
    };

    /* ---- Round 5 actions --------------------------------------------- */

    PS.finalsPick = function (blank, option) {
        if (!room || room.status !== 'round5') return;
        finalsPicks[Number(blank)] = Number(option);
        renderFinalsTurn();
    };

    PS.finalsSubmitTrap = function () {
        if (!room || room.status !== 'round5') return;
        const deck = finalsDeck();
        const q = deck[(Number(me && me.finals_question_index) || 0) % Math.max(1, deck.length)];
        if (!q || q.type !== 'double_trap') return;
        const blanks = q.blanks || [];
        const complete = blanks.every(function (_, i) {
            return finalsPicks[i] != null && finalsPicks[i] !== '';
        });
        if (!complete) {
            toast('Answer both blanks first.');
            return;
        }
        PS.finalsAnswer(finalsPicks.slice(0, blanks.length));
    };

    PS.finalsAnswer = async function (answer) {
        if (demoMode) { demoFinalsAnswer(answer); return; }
        if (busy || !room || room.status !== 'round5' || !me || !isPlayingPlayer(me)) return;
        if (!PSEngine.isFinalsAlive(me) || inkActive()) return;
        if (Date.now() < answerLockUntil) return;
        clearFinalsTimer();
        busy = true;
        answerLockUntil = Date.now() + 320;
        try {
            const { data, error } = await sb.rpc('submit_purrfect_survival_finals', {
                p_room_id: room.id,
                p_answer: answer == null ? null : answer
            });
            if (error) return setError(errorMessage(error));
            const res = Array.isArray(data) ? data[0] : data;
            if (res && res.player) {
                me = res.player;
                const idx = players.findIndex(p => String(p.user_id) === String(me.user_id));
                if (idx >= 0) players[idx] = me;
            }
            if (res && res.room && res.room.id) room = res.room;
            if (res && res.correct) {
                sfxCorrect();
                let msg = '✅ +0 slip · ' + PSEngine.finalsProgress(me) + ' left';
                if (res.knockback && res.knockback.user_id) {
                    msg += ' · 🐾 paw-wave knocks #' + String(res.knockback.user_id).slice(0, 4) + ' back ' + (res.knockback.amount || PSEngine.ROUND5.KNOCKBACK);
                }
                toast(msg);
            } else if (res && res.eliminated) {
                sfxShatter();
                toast('⚡ Electrocuted at the fence — you are a ghost now.');
                showGlassOutOverlay('⚡ Electrocuted', 'You reached the fence. Ghosts can still answer revival questions and throw ink.');
            } else {
                sfxWrong();
                toast('❌ Slip 25 · now ' + PSEngine.finalsProgress(me) + ' — one more wrong at 0 is out.');
            }
            questionsKey = '';
            finalsShownKey = '';
            render();
        } finally {
            busy = false;
        }
    };

    PS.ghostAnswer = async function (choice) {
        if (demoMode) { demoGhostAnswer(choice); return; }
        if (busy || !room || room.status !== 'round5' || !me || !isPlayingPlayer(me)) return;
        if (PSEngine.isFinalsAlive(me)) return;
        if (Date.now() < answerLockUntil) return;
        busy = true;
        answerLockUntil = Date.now() + 300;
        try {
            const { data, error } = await sb.rpc('submit_purrfect_survival_ghost', {
                p_room_id: room.id,
                p_answer: Number(choice) || 0
            });
            if (error) return setError(errorMessage(error));
            const res = Array.isArray(data) ? data[0] : data;
            if (res && res.player) {
                me = res.player;
                const idx = players.findIndex(p => String(p.user_id) === String(me.user_id));
                if (idx >= 0) players[idx] = me;
            }
            if (res && res.correct) {
                sfxCorrect();
                const n = Math.max(0, Number(me.finals_ghost_correct) || 0);
                toast(n >= PSEngine.ROUND5.GHOST_NEED
                    ? '🖤 Ink bomb ready — throw it at the leader!'
                    : '✅ Revival ' + n + '/' + PSEngine.ROUND5.GHOST_NEED);
            } else {
                sfxWrong();
                toast('❌ Not that one — try the next revival question.');
            }
            finalsShownKey = '';
            render();
        } finally {
            busy = false;
        }
    };

    PS.throwInk = async function () {
        if (demoMode) { demoThrowInk(); return; }
        if (busy || !room || room.status !== 'round5' || !me || !isPlayingPlayer(me)) return;
        if (Math.max(0, Number(me.finals_ghost_correct) || 0) < PSEngine.ROUND5.GHOST_NEED) return;
        busy = true;
        try {
            const { data, error } = await sb.rpc('throw_purrfect_survival_ink', {
                p_room_id: room.id
            });
            if (error) return setError(errorMessage(error));
            const res = Array.isArray(data) ? data[0] : data;
            if (res && res.player) {
                me = res.player;
                const idx = players.findIndex(p => String(p.user_id) === String(me.user_id));
                if (idx >= 0) players[idx] = me;
            }
            toast(res && res.ok === false ? 'No leader to ink right now.' : '🖤 Ink bomb thrown — the leader is covered for 1.5s.');
            finalsShownKey = '';
            render();
        } finally {
            busy = false;
        }
    };

    /* ------------------------------------------------------------------ */
    /* HUD / canvas frames                                                */
    /* ------------------------------------------------------------------ */

    function startFrames() {
        if (rafId) return;
        if (!room) return;
        if (room.status !== 'waiting' && room.status !== 'round1' && room.status !== 'round2'
            && room.status !== 'round3' && room.status !== 'round4'
            && room.status !== 'round5' && room.status !== 'finished') return;
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
        const playing = room.status === 'round1' || room.status === 'round2'
            || room.status === 'round3' || room.status === 'round4'
            || room.status === 'round5';
        const finished = room.status === 'finished';
        if (!waiting && !playing && !finished) return;

        // Canvas art at ~30 fps keeps 30 cats smooth on phones; the DOM HUD
        // and phase sounds still update on every animation frame.
        if (!lastFrame || ts - lastFrame >= 30) {
            const surface = resizeCanvas();
            if (surface) {
                const isR2 = room.status === 'round2';
                const isR3 = room.status === 'round3';
                const isR4 = room.status === 'round4';
                const isR5 = room.status === 'round5';
                const info = (isR2 || isR3 || isR4 || isR5) ? null : phaseInfo();
                const tug = isR3 ? tugState() : null;
                const nowMs = serverNow();
                const viewerGlass = isR2 ? glassStepsForViewer() : glassSteps;
                const state = {
                    mode: waiting ? 'intro' : 'round',
                    status: room.status,
                    round: (waiting || finished) ? 0 : (isR5 ? 5 : (isR4 ? 4 : (isR3 ? 3 : (isR2 ? 2 : 1)))),
                    ceremonyElapsed: finished ? Math.max(0, Date.now() - (ceremonyStart || Date.now())) : 0,
                    ceremony: finished ? ceremonyRows() : null,
                    introElapsed: waiting ? introElapsedMs() : 0,
                    role: (demoMode && demoRole === 'teacher') || (isHost() && (!me || !isPlayingPlayer(me))) ? 'host' : 'player',
                    w: surface.w,
                    h: surface.h,
                    dpr: surface.dpr,
                    players: players,
                    meId: me ? me.user_id : '',
                    finishDistance: room.finish_distance || finishDistance(),
                    phase: info && !info.done ? info.phase : (isR2 ? 'green' : 'done'),
                    phaseElapsed: info ? info.elapsed_ms : 0,
                    phaseDuration: info ? info.duration_ms : 2000,
                    elapsed: room.round1_started_at ? Math.max(0, nowMs - Date.parse(room.round1_started_at)) : 0,
                    now: (root.performance && root.performance.now) ? root.performance.now() : Date.now(),
                    bang: Math.max(0, 1 - (Date.now() - lastBang) / 420),
                    glassSteps: viewerGlass,
                    stepCount: viewerGlass.length || glassSteps.length || PSEngine.ROUND2.STEP_COUNT,
                    myTeam: tugTeamOf(me),
                    tug: tug ? {
                        position: tug.position,
                        redPull: tug.redPull,
                        bluePull: tug.bluePull,
                        redCombo: tug.redCombo,
                        blueCombo: tug.blueCombo,
                        redRage: PSEngine.tugRageActive(tug, 'red', nowMs),
                        blueRage: PSEngine.tugRageActive(tug, 'blue', nowMs),
                        winner: tug.winner,
                        phase: tug.phase,
                        suddenDeath: tug.suddenDeath
                    } : null
                };
                if (isR4) {
                    const st = me && isPlayingPlayer(me) ? myDalgonaState() : null;
                    state.round4 = {
                        /* where the student's question pad sits, so the tin
                           is drawn in the free space above it */
                        padBottom: dalgonaPadBottom(),
                        me: st ? {
                            pattern: st.pattern,
                            pattern_label: PSEngine.dalgonaPatternLabel(st.pattern),
                            progress: st.progress,
                            total: st.units.length,
                            units: st.units,
                            tiles: st.tiles,
                            prompt: st.prompt,
                            target: st.target,
                            cracks: st.cracks,
                            lickUsed: st.lickUsed,
                            lickAnim: lickAnimProgress(),
                            status: st.status,
                            /* the student's own LearniTY cat (store look) */
                            look: playerLook(me)
                        } : null,
                        board: dalgonaBoard()
                    };
                }
                if (isR5) {
                    const st = myFinalsState();
                    state.round5 = {
                        padBottom: dalgonaPadBottom(),
                        me: st ? {
                            progress: st.progress,
                            combo: st.combo,
                            ghostCorrect: st.ghostCorrect,
                            questionIndex: st.questionIndex,
                            eliminated: st.eliminated,
                            inkUntil: st.inkUntil,
                            ink: inkActive(),
                            look: playerLook(me)
                        } : null,
                        board: finalsArenaRows(),
                        ghosts: finalsGhostRows(),
                        living: finalsLivingCount(),
                        remainingMs: room.round5_ends_at
                            ? Math.max(0, Date.parse(room.round5_ends_at) - serverNow())
                            : 0,
                        nowMs: serverNow()
                    };
                }
                if (finished) state.mode = 'ceremony';
                if (typeof PSRender !== 'undefined' && PSRender.drawScene) {
                    PSRender.drawScene(surface.ctx, state);
                }
            }
            lastFrame = ts;
        }

        if (waiting) {
            updateIntroChrome();
        } else if (playing) {
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
            const order = (typeof PSEngine !== 'undefined' && PSEngine.raceOrder)
                ? PSEngine.raceOrder(players.filter(isPlayingPlayer), { finishDistance: finishDistance() })
                : [];
            const myPlace = me ? order.findIndex(p => String(p.user_id) === String(me.user_id)) : -1;
            if (myPlace >= 0) {
                setText('ps-hud-place', '🏅 ' + PSEngine.formatPlace(myPlace + 1, order.length));
                show('ps-hud-place', true);
            } else {
                show('ps-hud-place', false);
            }
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
            show('ps-hud-place', false);
            setText('ps-hud-phase', '🧊 Glass Stepping Stones');
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
        } else if (room.status === 'round3') {
            show('ps-hud-place', false);
            const tug = tugState();
            const nowMs = serverNow();
            const redRage = PSEngine.tugRageActive(tug, 'red', nowMs);
            const blueRage = PSEngine.tugRageActive(tug, 'blue', nowMs);
            const team = tugTeamOf(me);
            const hudPhase = $('ps-hud-phase');
            if (hudPhase) hudPhase.className = 'ps-phase ps-phase-tug';
            setText('ps-hud-phase', tug.phase === 'briefing'
                ? '🪢 BRIEFING'
                : (tug.phase === 'done' ? '🏁 TUG OVER' : '🪢 RED ' + tug.redPull + ' · BLUE ' + tug.bluePull));
            if (!team) {
                setText('ps-hud-you', 'Spectating');
            } else {
                const combo = team === 'red' ? tug.redCombo : tug.blueCombo;
                const rage = team === 'red' ? redRage : blueRage;
                setText('ps-hud-you', (team === 'red' ? '🔴 RED' : '🔵 BLUE')
                    + ' · Combo ' + combo + '/' + PSEngine.ROUND3.COMBO
                    + (rage ? ' · 爆走拉力 2x' : ''));
            }
            if (tug.phase === 'briefing') {
                setText('ps-hud-timer', 'Ready');
            } else if (tug.suddenDeath) {
                setText('ps-hud-timer', 'SUDDEN DEATH');
            } else {
                const ends = room.round3_ends_at ? Date.parse(room.round3_ends_at) : 0;
                setText('ps-hud-timer', ends ? PSEngine.formatClock(ends - nowMs) : '—');
            }
            const lead = tug.position === 0 ? 'Level' : (tug.position > 0 ? 'Blue +' + tug.position : 'Red +' + Math.abs(tug.position));
            setText('ps-hud-alive', 'Tug: ' + lead + (redRage || blueRage ? ' · RAGE' : ''));
        } else if (room.status === 'round4') {
            show('ps-hud-place', false);
            const st = me && isPlayingPlayer(me) ? myDalgonaState() : null;
            const hudPhase = $('ps-hud-phase');
            if (hudPhase) hudPhase.className = 'ps-phase ps-phase-tug';
            const qualifier = dalgonaQualifierActive();
            setText('ps-hud-phase', qualifier
                ? '🍬 ADVANCING TO DALGONA'
                : (st && st.status === 'finished' ? '🏁 CARVED'
                    : (st && st.status === 'shattered' ? '💥 SHATTERED'
                        : (st && st.status === 'danger' ? '⚡ ONE CRACK' : '🍬 CARVING'))));
            if (st && st.pattern) {
                setText('ps-hud-you', PSEngine.dalgonaPatternLabel(st.pattern)
                    + ' · ' + Math.min(st.progress, st.units.length) + ' / ' + st.units.length
                    + (st.cracks ? ' · ' + st.cracks + ' crack' + (st.cracks === 1 ? '' : 's') : ''));
            } else {
                setText('ps-hud-you', 'Spectating');
            }
            if (qualifier) {
                setText('ps-hud-timer', 'Get ready');
            } else {
                const ends = room.round4_ends_at ? Date.parse(room.round4_ends_at) : 0;
                setText('ps-hud-timer', ends ? PSEngine.formatClock(ends - serverNow()) : '—');
            }
        } else if (room.status === 'round5') {
            show('ps-hud-place', false);
            const st = myFinalsState();
            const hudPhase = $('ps-hud-phase');
            if (hudPhase) hudPhase.className = 'ps-phase ps-phase-finals';
            setText('ps-hud-phase', !st ? '⚡ GRAMMAR FINALS'
                : (st.eliminated
                    ? (st.ghostCorrect > 0 ? '👻 GHOST · ' + st.ghostCorrect + '/' + PSEngine.ROUND5.GHOST_NEED : '👻 GHOST')
                    : '⚡ GRAMMAR FINALS'));
            if (st && !st.eliminated) {
                setText('ps-hud-you', '⚡ ' + st.progress + ' · combo ' + st.combo + '/' + PSEngine.ROUND5.COMBO
                    + (inkActive() ? ' · 🖤 inked' : ''));
            } else if (st) {
                setText('ps-hud-you', '👻 Ghost · ' + st.ghostCorrect + '/' + PSEngine.ROUND5.GHOST_NEED + ' to ink');
            } else {
                setText('ps-hud-you', 'Spectating');
            }
            const ends = room.round5_ends_at ? Date.parse(room.round5_ends_at) : 0;
            setText('ps-hud-timer', ends ? PSEngine.formatClock(ends - serverNow()) : '—');
            setText('ps-hud-alive', 'Alive: ' + finalsLivingCount() + ' / ' + totalPlayers());
        }
        renderTeacherProgress();
        renderQualifier();
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
    /* Round 3 actions                                                    */
    /* ------------------------------------------------------------------ */

    PS.tugAnswer = async function (choice) {
        if (demoMode) { demoTugAnswer(choice); return; }
        if (busy || !room || room.status !== 'round3' || !me || !isPlayingPlayer(me)) return;
        if (me.ghost || me.status === 'eliminated') return;
        if (!tugTeamOf(me)) return;
        const state = tugState();
        if (state.phase !== 'playing') return;
        if (Date.now() < answerLockUntil) return;

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
            if (res && res.room && res.room.id) {
                room = res.room;
                tugQuestions = asArray(room.tug_questions).length ? asArray(room.tug_questions) : tugQuestions;
            }
            const nextTug = res && res.tug_state
                ? PSEngine.normalizeTugState(res.tug_state)
                : tugState();
            if (res && res.ok === false) {
                toast(res.error === 'NOT_PLAYING'
                    ? 'You do not have a team in this Tug of War.'
                    : 'Wait for the host to start the Tug of War.');
            } else if (res && res.correct) {
                sfxCorrect();
                toast('✅ Pull +' + (Number(res.pull) || 1) + (res.rage ? ' · 爆走拉力 2x!' : '')
                    + ' — ' + (nextTug.position === 0 ? 'Level' : (nextTug.position > 0 ? 'Blue +' + nextTug.position : 'Red +' + Math.abs(nextTug.position))));
            } else {
                sfxWrong();
                if (opts) {
                    opts.classList.add('ps-options-wrong');
                    setTimeout(() => opts.classList.remove('ps-options-wrong'), 340);
                }
                toast('❌ No pull — the combo is broken.');
            }
            questionsKey = '';
            render();
            poll(true);
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
                if (me) me.glass_shattered = true;
                toast('💥 Normal glass! You fell — the correct pane is lit for the class.');
                showGlassOutOverlay('💥 You fell', 'The pane shattered. The correct side is now lit for the classmates behind you.');
            } else if (res.outcome === 'timeout') {
                sfxShatter();
                toast('⏱ Time up! No jump — you fell.');
                showGlassOutOverlay('⏱ No jump', 'The 7-second window closed and you fell. The correct pane was not revealed.');
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
            tugQuestions = asArray(built.tugQuestions).slice();
            finalsQuestions = asArray(built.finalsQuestions).slice();
            ghostQuestions = asArray(built.ghostQuestions).slice();
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
            const startArgs = {
                p_room_id: room.id,
                p_questions: built.questions,
                p_glass: glass,
                p_schedule: phaseSchedule,
                p_round_ms: roundMs
            };
            // Preload the tug bank only for 3-round rooms. This keeps the
            // existing 1–2 round call valid against older SQL while the
            // new incremental stores the round-3 bank for a host refresh.
            if (built.roundCount >= 3 && tugQuestions.length) {
                startArgs.p_tug_questions = tugQuestions;
            }
            // Round 4 assignments ship once, at start. The server stores each
            // student's own units/item; the host grid only reads progress.
            if (built.roundCount >= 4 && built.dalgonaAssignments.length) {
                startArgs.p_dalgona = built.dalgonaAssignments;
            }
            if (built.roundCount >= 5 && built.finalsQuestions.length) {
                startArgs.p_finals = {
                    questions: built.finalsQuestions,
                    ghosts: built.ghostQuestions || []
                };
            }
            const { data, error } = await sb.rpc('start_purrfect_survival', startArgs);
            if (error) return setError(errorMessage(error));
            const started = Array.isArray(data) ? data[0] : data;
            if (started && started.id) room = started;
            syncClock();
            questions = asArray(room.questions);
            glassSteps = asArray(room.glass_steps);
            tugQuestions = asArray(room.tug_questions).length ? asArray(room.tug_questions) : tugQuestions;
            finalsQuestions = asArray(room.finals_questions).length ? asArray(room.finals_questions) : finalsQuestions;
            myDalgonaItem = null;
            finalsShownKey = '';
            lastPhaseKey = '';
            lastRedSent = -1;
            overlayAction = null;
            hideOverlay();
            markIntroSeen(room.id);
            startBgm();
            render();
            retunePolling();
            poll(true);
        } finally {
            busy = false;
            if (btn) btn.disabled = false;
        }
    };

    function endRoundLabel(round) {
        if (round === 5) return '⏹ End round 5';
        if (round === 4) return '⏹ End round 4';
        if (round === 3) return '⏹ End round 3';
        if (round === 2) return '⏹ End round 2';
        return '⏹ End round 1';
    }

    /* Which round the host can end right now, or 0 when the button should
       stay hidden. Only rounds that are actually in this room's plan and
       still in play count; a briefing / sudden-death tug is not endable. */
    function hostEndableRound() {
        if (!room || !isHost()) return 0;
        const count = roomRoundCount();
        if (room.status === 'round1') return count >= 1 ? 1 : 0;
        if (room.status === 'round2') {
            if (count < 2 || qualifierInfo()) return 0;
            return 2;
        }
        if (room.status === 'round3') {
            if (count < 3 || qualifierInfo()) return 0;
            const tug = tugState();
            if (tug.phase !== 'playing') return 0;
            if (tug.suddenDeath) return 0;
            return 3;
        }
        if (room.status === 'round4') {
            if (count < 4 || dalgonaQualifierActive()) return 0;
            return 4;
        }
        if (room.status === 'round5') {
            if (count < 5) return 0;
            return 5;
        }
        return 0;
    }

    function endRoundConfirmText(round) {
        if (round === 2) {
            return 'End Glass Stepping Stones now? Every student still crossing will drop out and the room will move on.';
        }
        if (round === 3) {
            return 'End Tug of War now? The team that is ahead wins; a level rope goes to sudden death.';
        }
        if (round === 4) {
            return 'End Dalgona Candy Carving now? Students who have not finished carving will be out.';
        }
        if (round === 5) {
            return 'End the Grammar Finals now? The room will finish immediately and the prize ceremony will rank the cats by their final fence progress.';
        }
        return roomRoundCount() === 1
            ? 'End 1-2-3 Meow! now? The game will finish and every surviving student wins.'
            : 'End Round 1 now and move the first 15 survivors to the glass bridge?';
    }

    PS.endRoundNow = async function () {
        if (demoMode) {
            if (!isHost()) return;
            demoEndRoundNow();
            render();
            return;
        }
        const round = hostEndableRound();
        if (busy || !round) return;
        if (typeof window.confirm === 'function' && !window.confirm(endRoundConfirmText(round))) return;
        busy = true;
        try {
            /* Round 1 keeps the original RPC so older installs still work;
               rounds 2–4 use the newer host-only end-round function. */
            const rpc = round === 1
                ? 'end_purrfect_survival_round1'
                : 'end_purrfect_survival_round';
            const { data, error } = await sb.rpc(rpc, { p_room_id: room.id });
            if (error) {
                const missing = round > 1 && /does not exist|Could not find|PGRST20|42P01|schema cache/i
                    .test(String(error.message || error));
                return setError(missing
                    ? 'Run supabase/purrfect_survival_end_rounds.sql in the Supabase SQL editor (project mggnwzirjmibreimrwiq), clear the editor first, then reload this page.'
                    : errorMessage(error));
            }
            const updated = Array.isArray(data) ? data[0] : data;
            if (updated && updated.id) room = updated;
            poll(true);
        } finally {
            busy = false;
        }
    };

    PS.endRound1Now = PS.endRoundNow;

    PS.startRound2Now = PS.endRound1Now;

    PS.startRound3Now = async function () {
        if (demoMode) { demoStartTug(); render(); return; }
        if (busy || !room || !isHost() || room.status !== 'round3') return;
        const state = tugState();
        if (state.phase !== 'briefing') return;
        if (qualifierInfo()) {
            toast('Read the advancing survivors first — the board continues in a moment.');
            return;
        }
        setError('');
        busy = true;
        const btn = $('ps-tug-start-btn');
        if (btn) btn.disabled = true;
        try {
            const bank = tugBank();
            const { data, error } = await sb.rpc('start_purrfect_survival_round3', {
                p_room_id: room.id,
                p_questions: bank
            });
            if (error) return setError(errorMessage(error));
            const updated = Array.isArray(data) ? data[0] : data;
            if (updated && updated.id) room = updated;
            tugQuestions = asArray(room.tug_questions).length ? asArray(room.tug_questions) : tugQuestions;
            questionsKey = '';
            hideOverlay();
            render();
            retunePolling();
            poll(true);
        } finally {
            busy = false;
            if (btn) btn.disabled = false;
        }
    };

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

    async function loadVocabWords(source, form, scope) {
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
        const dateScope = typeof normalizeVocabDateScope === 'function'
            ? normalizeVocabDateScope(scope)
            : (scope === 'today' || scope === 'yesterday' ? scope : 'all');
        try {
            let query = sb.from('new_vocab_words').select('en,zh,form,created_at').order('id');
            if (resolvedForm && resolvedForm !== 'ALL') query = query.eq('form', resolvedForm);
            else if (typeof FORM_LEVELS !== 'undefined') query = query.in('form', FORM_LEVELS.map(f => f.id));
            const { data, error } = await query;
            if (error) {
                setError('Could not load New Vocab: ' + (error.message || 'unknown error'));
                return [];
            }
            const rows = (data || []).filter(w => w && String(w.en || '').trim() && String(w.zh || '').trim());
            const scoped = typeof filterNewVocabByScope === 'function'
                ? filterNewVocabByScope(rows, dateScope)
                : (dateScope === 'all' ? rows.slice() : []);
            return scoped.map(w => ({ en: String(w.en || '').trim(), zh: String(w.zh || '').trim() }));
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
        const words = await loadVocabWords(config.vocabSource || config.topic, config.vocabForm, config.vocabScope);
        if (!words.length) {
            const scope = typeof normalizeVocabDateScope === 'function'
                ? normalizeVocabDateScope(config.vocabScope)
                : (config.vocabScope === 'today' || config.vocabScope === 'yesterday' ? config.vocabScope : 'all');
            if (scope !== 'all') {
                setError('No usable New Vocab words were added ' + scope + '. Switch that round to All, or add the English first.');
            } else {
                setError('No usable words in that vocab bank. New Vocab cards need both English and Chinese.');
            }
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
            && String(a.vocabScope || 'all') === String(b.vocabScope || 'all')
            && String(a.bankMode || '') === String(b.bankMode || '');
    }

    /* Round 4 always uses all three banks together: New Vocab + every
       Dictation Master tab, the five Grammar Quest topics, and the local
       participle-combining bank (Q251+). No single-subject picker. */
    async function loadDalgonaBanks(seed) {
        const form = (() => {
            const r1 = roundConfig(1) || {};
            const r3 = roundConfig(3) || {};
            return r1.vocabForm || r3.vocabForm || '';
        })();

        const dictation = [];
        if (typeof categories === 'undefined' || !Object.keys(categories || {}).length) {
            if (typeof loadAllCategoriesFromSheet === 'function') loadAllCategoriesFromSheet();
            await waitForSheet(15000);
        }
        const names = (typeof SHEET_NAMES !== 'undefined' && Array.isArray(SHEET_NAMES)) ? SHEET_NAMES : [];
        names.forEach(name => {
            const rows = (typeof categories !== 'undefined' && categories && categories[name]) ? categories[name] : [];
            rows.forEach(w => {
                if (w && w.en && w.zh) dictation.push({ en: String(w.en).trim(), zh: String(w.zh).trim() });
            });
        });
        let newVocab = [];
        if (typeof sb !== 'undefined' && sb && typeof sb.from === 'function') {
            newVocab = await loadVocabWords('New Vocab', form || 'ALL', 'all');
        }
        let fishboneWords = PSEngine.buildFishboneBank({ newVocab: newVocab, dictation: dictation });
        if (!fishboneWords.length) {
            // Both live banks were empty (offline Sheet + empty New Vocab):
            // keep the round playable with the built-in school bank.
            fishboneWords = PSEngine.DEMO_VOCAB.slice();
        }

        const pawQuestions = [];
        let grammarFailures = 0;
        if (typeof DG !== 'undefined' && typeof DG.loadBank === 'function') {
            for (const topic of PSEngine.GRAMMAR_TOPICS) {
                const modes = PSEngine.GRAMMAR_MODES[topic] || ['mixed'];
                const mode = modes.indexOf('mixed') !== -1 ? 'mixed' : modes[0];
                try {
                    const bank = await DG.loadBank(topic, mode);
                    (Array.isArray(bank) ? bank : []).forEach(q => {
                        if (q && (q.primary || q.a)) pawQuestions.push(q);
                    });
                } catch (e) {
                    grammarFailures++;
                }
            }
        } else {
            grammarFailures = PSEngine.GRAMMAR_TOPICS.length;
        }
        if (!pawQuestions.length) {
            setError('Round 4 could not load the Grammar Quest banks. Check the connection and try again.');
            return null;
        }

        let crownQuestions = (typeof window !== 'undefined' && Array.isArray(window.DG_PARTICIPLE_CLAUSES_COMBINING))
            ? window.DG_PARTICIPLE_CLAUSES_COMBINING
            : [];
        if (!crownQuestions.length) crownQuestions = PSEngine.DEMO_COMBINING;
        crownQuestions = crownQuestions.filter(q => q && Number(q.id) >= 251 && q.q && q.a);

        const roster = players.filter(isPlayingPlayer);
        const assignments = PSEngine.buildDalgonaAssignments({
            players: roster,
            seed: seed,
            fishboneWords: fishboneWords,
            pawQuestions: pawQuestions,
            crownQuestions: crownQuestions
        });
        if (!assignments.length) {
            setError('Round 4 has no usable candy questions. Add New Vocab words or check the grammar banks.');
            return null;
        }
        dalgonaBanks = {
            fishbone: fishboneWords.length,
            paw: pawQuestions.length,
            crown: crownQuestions.length,
            grammarFailures: grammarFailures
        };
        return { assignments: assignments, banks: dalgonaBanks };
    }

    /* Round 5 uses the existing Grammar Quest banks (tenses / agreement /
       indefinite pronouns) when they load, and always falls back to the
       engine's built-in school bank so a demo or offline lesson still has
       a full deck. No Conditionals items are invented here: if a later
       generated file sets window.PS_FINALS_CONDITIONALS, the engine adds
       the unit automatically. */
    async function loadFinalsBanks(seed) {
        const raw = [];
        let grammarFailures = 0;
        if (typeof DG !== 'undefined' && typeof DG.loadBank === 'function') {
            for (const topic of PSEngine.FINALS_UNITS) {
                const modes = PSEngine.GRAMMAR_MODES[topic] || ['mixed'];
                const mode = modes.indexOf('mixed') !== -1 ? 'mixed' : modes[0];
                try {
                    const bank = await DG.loadBank(topic, mode);
                    (Array.isArray(bank) ? bank : []).forEach(function (q) {
                        if (q) raw.push(Object.assign({ unit: topic }, q));
                    });
                } catch (e) {
                    grammarFailures++;
                }
            }
        } else {
            grammarFailures = PSEngine.FINALS_UNITS.length;
        }
        const conditionals = (typeof window !== 'undefined' && Array.isArray(window.PS_FINALS_CONDITIONALS))
            ? window.PS_FINALS_CONDITIONALS
            : [];
        const questions = PSEngine.buildFinalsDeck({
            seed: seed + 401,
            count: 60,
            errorItems: raw,
            conditionals: conditionals
        });
        const ghosts = PSEngine.buildGhostDeck({
            seed: seed + 211,
            count: 12
        });
        finalsBanks = {
            grammarItems: raw.length,
            grammarFailures: grammarFailures,
            conditionals: conditionals.length,
            deck: questions.length
        };
        return { questions: questions, ghosts: ghosts, banks: finalsBanks };
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

        let tugQuestions = [];
        if (roundCount >= 3) {
            const r3 = roundConfig(3);
            const bank3 = sameRoundBank(r1, r3) ? bank1
                : (sameRoundBank(r2, r3) ? await loadRoundBank(r2) : await loadRoundBank(r3));
            if (!bank3) return null;
            tugQuestions = bank3.subject === 'grammar'
                ? PSEngine.buildGrammarMC({ questions: bank3.grammar, seed: seed + 31, count: count })
                : PSEngine.buildVocabMC({ words: bank3.words, seed: seed + 31, count: count });
        }

        let dalgonaAssignments = [];
        if (roundCount >= 4) {
            const dalgona = await loadDalgonaBanks(seed);
            if (!dalgona) return null;
            dalgonaAssignments = dalgona.assignments;
        }

        let finals = null;
        if (roundCount >= 5) {
            finals = await loadFinalsBanks(seed);
            if (!finals) return null;
        }

        return {
            questions: questions,
            glassPairs: glassPairs,
            tugQuestions: tugQuestions,
            dalgonaAssignments: dalgonaAssignments,
            finalsQuestions: finals ? finals.questions : [],
            ghostQuestions: finals ? finals.ghosts : [],
            roundCount: roundCount,
            round1: r1,
            round2: r2
        };
    }

    /* ------------------------------------------------------------------ */
    /* Prize ceremony / Paws                                              */
    /* ------------------------------------------------------------------ */

    function ceremonyRoundNames(count) {
        if (count >= 5) return ['1-2-3 Meow!', 'Glass Stepping Stones', 'Tug of War', 'Dalgona Candy Carving', 'Grammar Finals'];
        if (count >= 4) return ['1-2-3 Meow!', 'Glass Stepping Stones', 'Tug of War', 'Dalgona Candy Carving'];
        if (count === 3) return ['1-2-3 Meow!', 'Glass Stepping Stones', 'Tug of War'];
        if (count === 2) return ['1-2-3 Meow!', 'Glass Stepping Stones'];
        return ['1-2-3 Meow!'];
    }

    function ceremonyRows() {
        if (!room) return [];
        if (!ceremonyCache) {
            ceremonyCache = PSEngine.ceremonyResults(players.map(p => Object.assign({}, p)), {
                roundCount: roomRoundCount(),
                tug: tugState(),
                finishDistance: finishDistance()
            });
        }
        return ceremonyCache;
    }

    function ceremonyDetailText(row) {
        const r = (row && row.rounds) || {};
        const parts = [];
        if (r.r1) {
            parts.push(r.r1.eliminated && !r.r1.reached_finish
                ? 'R1 out'
                : 'R1 ' + r.r1.distance + ' m' + (r.r1.reached_finish ? ' 🏁' : ''));
        }
        if (r.r2) {
            parts.push(r.r2.crossed_glass ? 'R2 crossed' : 'R2 step ' + (r.r2.glass_step || 0));
        }
        if (r.r3) {
            if (r.r3.tug_team) {
                parts.push('R3 ' + r.r3.tug_team + (r.r3.won === true ? ' won' : (r.r3.won === false ? ' lost' : '')));
            } else {
                parts.push('R3 no team');
            }
        }
        if (r.r4) {
            const pattern = PSEngine.dalgonaPatternLabel(r.r4.pattern);
            if (r.r4.status === 'finished') parts.push('R4 ' + pattern + ' carved');
            else if (r.r4.status === 'shattered') parts.push('R4 ' + pattern + ' shattered');
            else parts.push('R4 ' + pattern + ' ' + (r.r4.progress || 0) + ' carved');
        }
        if (r.r5 && r.r5.entered) {
            parts.push(r.r5.eliminated
                ? 'R5 ⚡ out at ' + (r.r5.progress || 0)
                : 'R5 ⚡ ' + (r.r5.progress || 0) + ' · combo ' + (r.r5.combo || 0));
        }
        return parts.join(' · ');
    }

    function ceremonySummaryHTML(rows, count) {
        const items = [];
        const r1Survivors = rows.filter(row => !row.rounds.r1.eliminated).length;
        const r1Finishers = rows.filter(row => row.rounds.r1.reached_finish).length;
        items.push('Round 1 · 1-2-3 Meow! — ' + r1Survivors + ' standing'
            + (r1Finishers ? ' · ' + r1Finishers + ' finished' : ''));
        if (count >= 2) {
            const crossed = rows.filter(row => row.rounds.r2 && row.rounds.r2.crossed_glass).length;
            const fell = rows.filter(row => row.rounds.r2 && !row.rounds.r2.crossed_glass).length;
            items.push('Round 2 · Glass Stepping Stones — ' + crossed + ' crossed'
                + (fell ? ' · ' + fell + ' fell' : ''));
        }
        if (count >= 3) {
            const tug = tugState();
            if (tug.winner) {
                items.push('Round 3 · Tug of War — ' + (tug.winner === 'red' ? 'Red' : 'Blue') + ' team won');
            } else {
                items.push('Round 3 · Tug of War — skipped (not enough survivors); bridge survivors win');
            }
        }
        if (count >= 4) {
            const carved = rows.filter(row => row.rounds.r4 && row.rounds.r4.status === 'finished').length;
            const shattered = rows.filter(row => row.rounds.r4 && row.rounds.r4.status === 'shattered').length;
            items.push('Round 4 · Dalgona Candy Carving — ' + carved + ' carved'
                + (shattered ? ' · ' + shattered + ' shattered' : ''));
        }
        if (count >= 5) {
            const entered = rows.filter(row => row.rounds.r5 && row.rounds.r5.entered).length;
            const stillIn = rows.filter(row => row.rounds.r5 && row.rounds.r5.entered && !row.rounds.r5.eliminated).length;
            items.push('Round 5 · Grammar Finals — ' + entered + ' entered'
                + (stillIn ? ' · ' + stillIn + ' still in' : ' · skipped (fewer than 2 survivors)'));
        }
        return items.map(item => '<div class="ps-ceremony-summary-row">' + escapeText(item) + '</div>').join('');
    }

    function ceremonyRowsHTML(rows) {
        const mine = signedInUser() ? String(signedInUser().id) : '';
        return rows.map(row => {
            const place = Number(row.place) || 0;
            const medal = place === 1 ? '🥇' : (place === 2 ? '🥈' : (place === 3 ? '🥉' : '#' + place));
            const isMine = mine && String(row.user_id) === mine;
            return '<div class="ps-ceremony-row' + (isMine ? ' ps-ceremony-me' : '') + '">' +
                '<span class="ps-ceremony-medal">' + medal + '</span>' +
                '<span class="ps-ceremony-name">' + escapeText(row.nickname || 'Player') +
                (isMine ? ' (you)' : '') + '</span>' +
                '<span class="ps-ceremony-detail">' + escapeText(ceremonyDetailText(row)) + '</span>' +
                '<span class="ps-ceremony-paws">+' + (Number(row.paws) || 0) + ' 🐾</span>' +
                '</div>';
        }).join('');
    }

    function mistakeEntryText(entry) {
        const e = entry || {};
        const round = e.round ? 'R' + e.round : '';
        if (e.kind === 'red') {
            return round + ' · 🔴 ' + (e.note || 'Moved on red light')
                + (e.penalty ? ' (' + e.penalty + ' m)' : '');
        }
        if (e.kind === 'glass_timeout') {
            return round + ' · ⏱ Panes “' + (e.left || '?') + '” / “' + (e.right || '?') + '” — no jump'
                + (e.answer ? ' · correct: ' + e.answer : '');
        }
        if (e.kind === 'glass') {
            return round + ' · “' + (e.left || '?') + '” / “' + (e.right || '?') + '” — you chose '
                + (e.choice || '?') + ' · correct: ' + (e.answer || '?');
        }
        if (e.kind === 'dalgona') {
            const pattern = typeof PSEngine !== 'undefined' && PSEngine.dalgonaPatternLabel
                ? PSEngine.dalgonaPatternLabel(e.pattern)
                : 'Candy';
            return round + ' · 🍬 ' + pattern + ' — you carved “' + (e.choice || '?')
                + '” · next was “' + (e.answer || '?') + '”'
                + (e.note ? ' · ' + e.note : '');
        }
        if (e.kind === 'answer' || e.kind === 'tug') {
            return round + ' · ' + (e.prompt || 'Question')
                + ' — you chose “' + (e.choice || '?') + '” · answer “' + (e.answer || '?') + '”';
        }
        return round + ' · ' + (e.note || e.prompt || 'Mistake');
    }

    function renderMistakeReport() {
        const host = isHostView();
        const report = (typeof PSEngine !== 'undefined' && PSEngine.mistakeReport)
            ? PSEngine.mistakeReport(players, {
                meId: me ? me.user_id : '',
                viewer: host ? 'teacher' : 'student'
            })
            : { viewer: host ? 'teacher' : 'student', rows: [], total: 0 };
        const title = $('ps-mistake-title');
        const sub = $('ps-mistake-sub');
        const list = $('ps-mistake-list');
        if (title) {
            title.textContent = host ? '📕 Whole-class mistakes' : '📕 Your mistakes';
        }
        if (sub) {
            sub.textContent = host
                ? report.rows.length + ' student' + (report.rows.length === 1 ? '' : 's')
                    + ' · ' + report.total + ' mistake' + (report.total === 1 ? '' : 's')
                : 'Only your own answers are shown here.';
        }
        if (!list) return;
        if (!report.rows.length) {
            list.innerHTML = '<p class="ps-mistake-empty">' + (host
                ? '✅ No mistakes logged — a clean class run!'
                : '✅ No mistakes on your run — clean sweep!') + '</p>';
            return;
        }
        list.innerHTML = report.rows.map(function (row) {
            const items = row.mistakes.length
                ? row.mistakes.map(function (entry) {
                    return '<li class="ps-mistake-item">' + escapeText(mistakeEntryText(entry)) + '</li>';
                }).join('')
                : '<li class="ps-mistake-item ps-mistake-none">✅ No mistakes</li>';
            return '<div class="ps-mistake-student">' +
                '<div class="ps-mistake-name">' + escapeText(row.nickname || 'Player') + '</div>' +
                '<ul class="ps-mistake-items">' + items + '</ul>' +
                '</div>';
        }).join('');
    }

    function ceremonyNoteText() {
        if (demoMode) return 'Demo mode — these are the Paws the class would earn. Nothing is saved.';
        if (isGuest()) return 'Sign in with a school account to earn Paws.';
        if (ceremonySaveState === 'saved') return '🐾 Paws saved to the class ledger.';
        if (ceremonySaveState === 'local') {
            return 'Paws are shown for this screen only — run supabase/purrfect_survival_ceremony.sql to save them.';
        }
        return 'Saving Paws…';
    }

    function hideCeremony() {
        const overlay = $('ps-ceremony');
        if (overlay) overlay.classList.add('hidden');
        const hud = document.querySelector('#ps-game .ps-hud');
        if (hud) hud.classList.remove('hidden');
    }

    function renderCeremony() {
        if (!room || room.status !== 'finished') {
            hideCeremony();
            return;
        }
        if (ceremonyRoomId !== room.id) {
            ceremonyRoomId = room.id;
            ceremonyStart = Date.now();
            ceremonyCache = null;
            ceremonyOfficial = null;
            ceremonySaveState = '';
        }
        setPanel('game');
        setLive(true);
        show('ps-question', false);
        const hud = document.querySelector('#ps-game .ps-hud');
        if (hud) hud.classList.add('hidden');
        show('ps-ceremony', true);

        const count = roomRoundCount();
        const names = ceremonyRoundNames(count);
        const localRows = ceremonyRows();
        const rows = (ceremonyOfficial && Array.isArray(ceremonyOfficial.results) && ceremonyOfficial.results.length)
            ? ceremonyOfficial.results
            : localRows;

        setText('ps-ceremony-title', '🏆 Prize Ceremony');
        setText('ps-ceremony-sub', count + ' round' + (count === 1 ? '' : 's') + ' · ' + names.join(' → '));
        const summary = $('ps-ceremony-summary');
        if (summary) summary.innerHTML = ceremonySummaryHTML(localRows, count);
        const list = $('ps-ceremony-list');
        if (list) list.innerHTML = ceremonyRowsHTML(rows);
        renderMistakeReport();
        setText('ps-ceremony-note', ceremonyNoteText());

        claimCeremonyPaws();
        syncMusic();
        if (!rafId) startFrames();
    }

    /* Live only: ask the security-definer RPC to award the ledger once per
       room. Demo mode and guests never reach this function. Missing SQL is
       shown honestly as "screen only" — the client never pretends to pay. */
    function claimCeremonyPaws() {
        if (demoMode || isGuest()) return;
        if (!room || room.status !== 'finished') return;
        if (!once('ceremony-claim:' + room.id)) return;
        ceremonySaveState = 'pending';
        if (typeof sb === 'undefined' || !sb || typeof sb.rpc !== 'function') {
            ceremonySaveState = 'local';
            return;
        }
        Promise.resolve(sb.rpc('purrfect_survival_ceremony', { p_room_id: room.id }))
            .then(result => {
                const error = result && result.error;
                let payload = result && result.data;
                if (typeof payload === 'string') {
                    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
                }
                if (error) {
                    ceremonySaveState = 'local';
                    console.warn('Purr-fect Survival ceremony RPC failed:', error.message || error);
                } else {
                    if (payload && Array.isArray(payload.results) && payload.results.length) {
                        ceremonyOfficial = payload;
                    }
                    ceremonySaveState = 'saved';
                }
                if (room && room.status === 'finished'
                    && typeof currentView !== 'undefined' && currentView === VIEW_ID) {
                    render();
                }
            })
            .catch(err => {
                ceremonySaveState = 'local';
                console.warn('Purr-fect Survival ceremony RPC failed:', err && err.message ? err.message : err);
            });
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
        const n = Number(roundNo) || 1;
        if (n === 4) {
            el.innerHTML = '<b>🍬 ROUND 4 · Dalgona Candy Carving</b><span>Carve every dash · one wrong = crack · two = split</span>';
        } else if (n === 3) {
            el.innerHTML = '<b>🪢 ROUND 3 · Tug of War</b><span>Answer 1–4 · pull +1 · five in a row = 爆走拉力 2x</span>';
        } else if (n === 2) {
            el.innerHTML = '<b>🧊 ROUND 2 · Glass Stepping Stones</b><span>Pick the tempered pane before 7 s</span>';
        } else {
            el.innerHTML = '<b>🟢 ROUND 1 · 1-2-3 Meow!</b><span>Green = answer · Red = freeze</span>';
        }
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
        const tugNext = roomRoundCount() >= 3;
        PS.showOverlay(
            '🎉 You survived the glass bridge!',
            tugNext
                ? 'Get ready for the Tug of War — the host will start it when the class is ready. Your team is picked from the survivors.'
                : 'You crossed the bridge. Stay to watch the rest of the class — this class chose two rounds.',
            '🎉',
            'Continue'
        );
    }

    function checkMilestones() {
        if (!room || !me) return;
        if (room.status === 'round1' && once('cue1:' + room.id)) {
            showRoundCue(1);
        }
        if (room.status === 'round2' && once('cue2:' + room.id)) {
            showRoundCue(2);
        }
        if (room.status === 'round3' && tugState().phase === 'playing' && once('cue3:' + room.id)) {
            showRoundCue(3);
        }
        if (room.status === 'round4' && once('cue4:' + room.id)) {
            showRoundCue(4);
        }
        if ((me.status === 'eliminated' || me.ghost) && (room.status === 'round1' || room.status === 'round2'
            || room.status === 'round3' || room.status === 'round4')) {
            showEliminatedOverlay();
        }
        if (room.status === 'finished') {
            claimCeremonyPaws();
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
        if (!room || (room.status !== 'round1' && room.status !== 'round2'
            && room.status !== 'round3' && room.status !== 'round5')) return;
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

        if (room.status === 'round3') {
            if (key >= '1' && key <= '4') {
                event.preventDefault();
                PS.tugAnswer(Number(key) - 1);
            }
            return;
        }

        if (room.status === 'round5') {
            if (!me || !isPlayingPlayer(me)) return;
            if (!PSEngine.isFinalsAlive(me)) {
                if (key === '1' || key === '2') {
                    event.preventDefault();
                    PS.ghostAnswer(Number(key) - 1);
                }
                return;
            }
            const deck = finalsDeck();
            const q = deck[(Number(me.finals_question_index) || 0) % Math.max(1, deck.length)];
            if (!q) return;
            if (q.type === 'error_spotting' && key >= '1' && key <= '4') {
                event.preventDefault();
                PS.finalsAnswer(Number(key));
            } else if (q.type === 'double_trap' && key >= '1' && key <= '4') {
                event.preventDefault();
                const n = Number(key);
                const blank = n <= 2 ? 0 : 1;
                const option = n <= 2 ? n - 1 : n - 3;
                PS.finalsPick(blank, option);
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
            populateLobby();
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
            startBgm();
        } else {
            setPanel('lobby');
            setLive(false);
        }
        updateMascot('Purr-fect Survival — survive the doll and the glass bridge!');
    };

    PS.stop = function () {
        stopPolling();
        stopFrames();
        hideCeremony();
        setLive(false);
        stopBgm();
        setRound4StudentClass(false);
        clearFinalsTimer();
        resetLobbyRules();
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
        tugQuestions = [];
        finalsQuestions = [];
        ghostQuestions = [];
        myDalgonaItem = null;
        lastInkUntil = '';
        introPlaying = false;
        resetLobbyRules();
        clearResume();
        stopPolling();
        stopBgm();
        setLive(false);
        setPanel('lobby');
        show('ps-code-chip', false);
        renderRejoin();
        setError('');
        updateMascot('You left the room.');
    };

    PS.render = render;
    PS.populateLobby = populateLobby;
    PS.syncSubjectFields = syncSubjectFields;
    PS.syncVocabForm = syncVocabForm;
    PS.sameRoundBank = sameRoundBank;
    PS.syncGrammarModes = syncGrammarModes;
    PS.syncRoundCount = syncRoundCount;
    PS.state = function () {
        return {
            room: room ? JSON.parse(JSON.stringify(room)) : null,
            players: players.map(p => Object.assign({}, p)),
            me: me ? Object.assign({}, me) : null,
            lickAnim: lickAnimProgress()
        };
    };

    /* Small test / renderer hook: true while the student's cat-lick window
       is still playing, false before the tap and after LICK_ANIM_MS. */
    PS.lickAnimActive = function () {
        return lickAnimActive();
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
            advanced_round2: false,
            tug_team: null,
            advanced_round3: false,
            tug_attempts: 0,
            dalgona_pattern: '',
            dalgona_progress: 0,
            dalgona_cracks: 0,
            dalgona_lick_used: false,
            dalgona_finished_at: null,
            dalgona_units: [],
            dalgona_item: null,
            dalgona_attempts: 0,
            finals_progress: 100,
            finals_combo: 0,
            finals_ghost_correct: 0,
            finals_question_index: 0,
            ink_until: null,
            finals_eliminated_at: null,
            answer_log: []
        };
    }

    function demoRoundMs() {
        return Math.max(PSEngine.ROUND1.MIN_ROUND_MS, Math.round(DEMO_ROUND_MS * (demoFinishDistance / PSEngine.ROUND1.FINISH_DISTANCE)));
    }

    function demoSettings() {
        const isGrammar = demoSubject === 'grammar';
        const rounds = [
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
        ];
        if (demoRoundCount >= 3) {
            rounds.push({
                round: 3,
                kind: 'tug',
                subject: demoSubject,
                topic: isGrammar ? 'demo' : 'Demo Vocab',
                vocabSource: isGrammar ? '' : 'Demo Vocab',
                vocabForm: '',
                bankMode: '',
                tugDuration: demoTugDuration
            });
        }
        if (demoRoundCount >= 4) {
            rounds.push({
                round: 4,
                kind: 'dalgona',
                subject: demoSubject,
                topic: isGrammar ? 'demo' : 'Demo Vocab',
                vocabSource: isGrammar ? '' : 'Demo Vocab',
                vocabForm: '',
                bankMode: '',
                dalgonaDuration: demoDalgonaDuration
            });
        }
        if (demoRoundCount >= 5) {
            rounds.push({
                round: 5,
                kind: 'finals',
                subject: demoSubject,
                topic: isGrammar ? 'demo' : 'Demo Vocab',
                vocabSource: isGrammar ? '' : 'Demo Vocab',
                vocabForm: '',
                bankMode: '',
                finalsDuration: demoFinalsDuration
            });
        }
        return {
            version: 1,
            roundCount: demoRoundCount,
            rounds: rounds,
            roundMs: demoRoundMs(),
            finishDistance: demoFinishDistance,
            glassSteps: demoGlassStepCount,
            tugDuration: demoTugDuration,
            dalgonaDuration: demoDalgonaDuration,
            finalsDuration: demoFinalsDuration
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
            round3_started_at: null,
            round3_ends_at: null,
            phase_schedule: [],
            glass_steps: glassSteps,
            questions: questions,
            tug_questions: questions.slice(),
            tug_state: PSEngine.emptyTugState(),
            settings: demoSettings(),
            server_now: new Date().toISOString(),
            created_at: new Date().toISOString(),
            started_at: null,
            finished_at: null
        };
        clockOffset = 0;
        resetQualifierState();
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
            p.tug_team = null;
            p.advanced_round3 = false;
            p.tug_attempts = 0;
            p.dalgona_pattern = '';
            p.dalgona_progress = 0;
            p.dalgona_cracks = 0;
            p.dalgona_lick_used = false;
            p.dalgona_finished_at = null;
            p.dalgona_units = [];
            p.dalgona_item = null;
            p.dalgona_attempts = 0;
            p.finals_progress = 100;
            p.finals_combo = 0;
            p.finals_ghost_correct = 0;
            p.finals_question_index = 0;
            p.ink_until = null;
            p.finals_eliminated_at = null;
            p.eliminated_reason = null;
            p.answer_log = [];
        });
        demoDalgonaAssignments = null;
        demoFinalsSurvivorOverride = null;
        finalsShownKey = '';
        finalsPicks = [];
        clearFinalsTimer();
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
        resetLobbyRules();
        room.status = 'waiting';
        room.current_round = 1;
        room.round1_started_at = null;
        room.round1_ends_at = null;
        room.round2_started_at = null;
        room.round2_ends_at = null;
        room.round3_started_at = null;
        room.round3_ends_at = null;
        room.round4_started_at = null;
        room.round4_ends_at = null;
        room.finished_at = null;
        room.tug_state = PSEngine.emptyTugState();
        room.phase_schedule = [];
        glassSteps = demoBuildGlassSteps();
        room.glass_steps = glassSteps;
        resetQualifierState();
        shownKeys = {};
        questionsKey = '';
        me = myPlayer();
        populateLobby();
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
        room.round3_started_at = null;
        room.round3_ends_at = null;
        room.finished_at = null;
        room.tug_state = PSEngine.emptyTugState();
        room.phase_schedule = PSEngine.buildPhaseSchedule(DEMO_SEED, { roundMs: roundMs });
        glassSteps = demoBuildGlassSteps();
        room.glass_steps = glassSteps;
        room.questions = questions;
        resetQualifierState();
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
            p.tug_team = null;
            p.glass_finished_at = null;
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
        room.round3_started_at = null;
        room.round3_ends_at = null;
        room.finished_at = null;
        room.tug_state = PSEngine.emptyTugState();
        glassSteps = demoBuildGlassSteps();
        room.glass_steps = glassSteps;
        room.questions = questions;
        resetQualifierState();
        /* Direct scene-picker jump: skip the qualifier beat so the teacher
           can inspect the glass arena immediately. */
        qualifierDismissed['qualifier:1:' + room.id + ':' + String(room.round2_started_at)] = true;
        shownKeys = {};
        shownKeys['intro2:' + room.id] = true;
        questionsKey = '';
        me = myPlayer();
        demoReleaseGlass(now);
        PS.hideOverlay();
    }

    function demoSeedMistakes() {
        const visitor = players.find(function (p) { return p.user_id === DEMO_VISITOR_ID; });
        const samples = [
            { round: 1, kind: 'answer', prompt: 'Choose the correct meaning of “charity”.', choice: 'a place to sleep', answer: 'an organisation that helps people' },
            { round: 1, kind: 'red', note: 'Moved on red light', penalty: -30 },
            { round: 2, kind: 'glass', prompt: 'Pick the tempered pane!', left: 'borrow', right: 'lend', choice: 'left', answer: 'right' },
            { round: 2, kind: 'glass_timeout', prompt: 'Pick the tempered pane!', left: 'quiet', right: 'quite', choice: null, answer: 'right' },
            { round: 3, kind: 'tug', prompt: 'Choose the correct past tense of “go”.', choice: 'goed', answer: 'went' }
        ];
        const writes = players.filter(function (p) {
            return p && p.is_playing !== false && p.user_id !== DEMO_VISITOR_ID;
        }).slice(0, 6);
        writes.forEach(function (p, i) {
            if ((p.answer_log || []).length) return;
            PSEngine.recordMistake(p, samples[i % samples.length]);
        });
        if (visitor && !(visitor.answer_log || []).length) {
            PSEngine.recordMistake(visitor, samples[2]);
            PSEngine.recordMistake(visitor, samples[4]);
        }
    }

    function demoJumpVictory() {
        const savedLogs = {};
        players.forEach(function (p) {
            if (p && Array.isArray(p.answer_log)) savedLogs[p.user_id] = p.answer_log.slice();
        });
        demoResetPlayers();
        players.forEach(function (p) {
            if (p && savedLogs[p.user_id] && savedLogs[p.user_id].length) {
                p.answer_log = savedLogs[p.user_id];
            }
        });
        const now = Date.now();
        const playing = players.filter(isPlayingPlayer);
        const visitor = playing.find(function (p) { return p.user_id === DEMO_VISITOR_ID; });
        const bots = playing.filter(function (p) { return p.user_id !== DEMO_VISITOR_ID; });

        if (demoRoundCount <= 1) {
            /* One-round ending: the class finishes in 1-2-3 Meow!. */
            const survivors = [];
            if (visitor && demoRole === 'student') survivors.push(visitor);
            bots.slice(0, 9).forEach(function (p) { survivors.push(p); });
            const kept = {};
            survivors.forEach(function (p, i) {
                kept[p.user_id] = true;
                p.status = 'alive';
                p.ghost = false;
                p.distance = i < 4 ? demoFinishDistance : Math.max(10, demoFinishDistance - (i + 1) * 8);
                p.reached_finish = i < 4;
                p.finished_at = i < 4 ? new Date(now - (4 - i) * 900).toISOString() : null;
            });
            playing.forEach(function (p) {
                if (kept[p.user_id]) return;
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = 'red_light';
                p.distance = Math.max(0, 30 - p.demo_attempts * 5);
            });
            room.status = 'finished';
            room.current_round = 1;
            room.round2_started_at = null;
            room.round2_ends_at = null;
            room.round3_started_at = null;
            room.round3_ends_at = null;
            room.tug_state = PSEngine.emptyTugState();
            room.finished_at = new Date(now).toISOString();
            resetQualifierState();
            shownKeys = {};
            questionsKey = '';
            me = myPlayer();
            demoSeedMistakes();
            PS.hideOverlay();
            return;
        }

        bots.slice(0, 5).forEach(function (p, i) {
            p.status = 'advanced';
            p.crossed_glass = true;
            p.survived_round2 = true;
            p.advanced_round2 = true;
            p.glass_step = demoGlassStepCount;
            p.glass_active = false;
            p.round1_rank = i + 1;
            p.glass_finished_at = new Date(now - (9 - i) * 1200).toISOString();
        });
        if (visitor && demoRole === 'student') {
            visitor.status = 'advanced';
            visitor.crossed_glass = true;
            visitor.survived_round2 = true;
            visitor.advanced_round2 = true;
            visitor.glass_step = demoGlassStepCount;
            visitor.glass_active = false;
            visitor.round1_rank = 1;
            visitor.glass_finished_at = new Date(now - 12000).toISOString();
        }
        playing.forEach(function (p) {
            if (p.status !== 'advanced') {
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = 'glass';
                p.glass_active = false;
            }
        });

        if (demoRoundCount >= 3) {
            /* Three/four-round ending: the glass survivors play the Tug of War. */
            const crossers = playing.filter(function (p) {
                return p.status === 'advanced' || p.crossed_glass === true;
            });
            let winner = 'red';
            const split = PSEngine.splitTugTeams(crossers);
            split.forEach(function (s) {
                const p = crossers.find(function (x) { return x.user_id === s.user_id; });
                if (p) p.tug_team = s.tug_team;
            });
            if (visitor && visitor.tug_team) winner = visitor.tug_team;
            PSEngine.applyTugResult(playing, winner);
            room.tug_state = Object.assign(PSEngine.emptyTugState(), { phase: 'done', winner: winner });
            room.round3_started_at = new Date(now - 45000).toISOString();
            room.round3_ends_at = new Date(now).toISOString();
            if (demoRoundCount >= 4) {
                const tugWinners = playing.filter(function (p) { return p.tug_team === winner; });
                const assignments = demoBuildDalgonaAssignments(tugWinners);
                const byId = {};
                assignments.forEach(function (a) { byId[a.user_id] = a; });
                tugWinners.forEach(function (p, i) {
                    const a = byId[p.user_id];
                    if (!a) return;
                    p.dalgona_pattern = a.pattern;
                    p.dalgona_units = a.units.slice();
                    p.dalgona_item = a.item;
                    p.dalgona_prompt = a.prompt;
                    p.dalgona_target = a.target;
                    p.dalgona_tiles = a.tiles.slice();
                    const finished = i < 3 || (visitor && p.user_id === visitor.user_id);
                    if (finished) {
                        p.dalgona_progress = a.units.length;
                        p.dalgona_finished_at = new Date(now - (i + 1) * 800).toISOString();
                    } else if (i % 3 === 0) {
                        p.dalgona_cracks = 2;
                        p.dalgona_progress = Math.floor(a.units.length * 0.4);
                        p.status = 'eliminated';
                        p.ghost = true;
                        p.eliminated_reason = 'dalgona';
                    } else {
                        p.dalgona_progress = Math.floor(a.units.length * 0.55);
                        p.dalgona_cracks = i % 2;
                    }
                });
                room.current_round = 4;
                room.round4_started_at = new Date(now - 60000).toISOString();
                room.round4_ends_at = new Date(now).toISOString();
                if (demoRoundCount >= 5) {
                    const finalists = tugWinners.filter(function (p) { return p.dalgona_finished_at != null; });
                    finalists.forEach(function (p, i) {
                        p.finals_progress = Math.max(10, PSEngine.ROUND5.START_PROGRESS - i * 12);
                        p.finals_combo = i % 3;
                        p.finals_question_index = i + 1;
                        p.finals_eliminated_at = i >= 3 ? new Date(now - 4000).toISOString() : null;
                        if (p.finals_eliminated_at) {
                            p.status = 'eliminated';
                            p.ghost = true;
                            p.eliminated_reason = 'finals';
                        }
                    });
                    room.current_round = 5;
                    room.round5_started_at = new Date(now - 90000).toISOString();
                    room.round5_ends_at = new Date(now).toISOString();
                }
            } else {
                room.current_round = 3;
            }
        } else {
            room.current_round = 2;
            room.round3_started_at = null;
            room.round3_ends_at = null;
            room.tug_state = PSEngine.emptyTugState();
        }

        room.status = 'finished';
        room.round2_started_at = room.round2_started_at || new Date(now - 40000).toISOString();
        room.round2_ends_at = new Date(now).toISOString();
        room.finished_at = new Date(now).toISOString();
        glassSteps = demoBuildGlassSteps();
        for (let i = 0; i < glassSteps.length; i++) PSEngine.revealGlassStep(glassSteps[i], 'correct');
        room.glass_steps = glassSteps;
        room.questions = questions;
        resetQualifierState();
        shownKeys = {};
        questionsKey = '';
        me = myPlayer();
        demoSeedMistakes();
        PS.hideOverlay();
    }

    function demoAdvanceToRound2() {
        if (!room || room.status !== 'round1') return;
        if (demoRoundCount <= 1) {
            demoFinishRound1Victory(Date.now());
            return;
        }
        const now = Date.now();
        resetQualifierState();
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
            p.tug_team = null;
            p.advanced_round3 = false;
            p.tug_attempts = 0;
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
        room.round3_started_at = null;
        room.round3_ends_at = null;
        room.finished_at = null;
        room.tug_state = PSEngine.emptyTugState();
        shownKeys['intro2:' + room.id] = true;
        questionsKey = '';
        me = myPlayer();
        PS.hideOverlay();
        /* Sequential advance deliberately does NOT release the first glass
           jumper here: the qualifier board owns the next QUALIFIER_MS, then
           demoTickRound2 releases the queue. */
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

    /* Host "End round" for the demo: mirrors the demo time-up paths, so the
       same elimination rules apply whether the clock runs out or the
       teacher stops the round early. */
    function demoEndRoundNow() {
        if (!room) return;
        const now = Date.now();
        if (room.status === 'round1') { demoEndRound1(); return; }
        if (room.status === 'round2') {
            if (qualifierInfo()) return;
            players.filter(isPlayingPlayer).forEach(function (p) {
                if (p.status !== 'alive') return;
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = 'round2_timeout';
                p.glass_active = false;
            });
            demoFinishRound2(now);
            return;
        }
        if (room.status === 'round3') {
            if (qualifierInfo()) return;
            const state = PSEngine.normalizeTugState(room.tug_state);
            if (state.phase !== 'playing' || state.suddenDeath) return;
            const resolved = PSEngine.resolveTugAtTimeUp(state, now);
            room.tug_state = resolved;
            if (resolved.winner) {
                demoFinishTug(resolved.winner, now);
                return;
            }
            /* Level rope: sudden death exactly like the time-up tick. */
            room.round3_ends_at = null;
            return;
        }
        if (room.status === 'round4') {
            if (qualifierInfo()) return;
            players.filter(isPlayingPlayer).forEach(function (p) {
                if (!p.dalgona_pattern || p.dalgona_finished_at) return;
                if (p.status === 'eliminated') return;
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = 'dalgona_timeout';
            });
            demoFinishRound4(now);
            return;
        }
        if (room.status === 'round5') {
            room.status = 'finished';
            room.current_round = 5;
            room.finished_at = new Date(now).toISOString();
            finalsShownKey = '';
            clearFinalsTimer();
            me = myPlayer();
        }
    }

    function demoFinishRound2(now) {
        if (!room || room.status !== 'round2') return;
        if (demoRoundCount >= 3) {
            const at = now || Date.now();
            room.status = 'round3';
            room.current_round = 3;
            room.round2_ends_at = new Date(at).toISOString();
            room.round3_started_at = null;
            room.round3_ends_at = null;
            room.finished_at = null;
            room.tug_state = PSEngine.emptyTugState();
            room.tug_questions = (questions.length ? questions : room.questions || []).slice();
            resetQualifierState();
            questionsKey = '';
            return;
        }
        room.status = 'finished';
        room.current_round = 2;
        room.finished_at = new Date(now || Date.now()).toISOString();
    }

    function demoPrepareTugSurvivors(now) {
        const playing = players.filter(isPlayingPlayer);
        let survivors = playing.filter(function (p) {
            return p.status === 'advanced' || p.crossed_glass === true;
        });
        if (survivors.length < 2) {
            playing.forEach(function (p) {
                p.status = 'alive';
                p.ghost = false;
                p.eliminated_reason = null;
                p.tug_team = null;
            });
            const visitor = playing.find(function (p) { return p.user_id === DEMO_VISITOR_ID; });
            const bots = playing.filter(function (p) { return p.user_id !== DEMO_VISITOR_ID; });
            bots.sort(function (a, b) {
                return demoHash01('tugsurvive:' + a.user_id) - demoHash01('tugsurvive:' + b.user_id);
            });
            survivors = [];
            if (visitor && demoRole === 'student') survivors.push(visitor);
            while (survivors.length < 12 && bots.length) survivors.push(bots.shift());
            const kept = {};
            survivors.forEach(function (p, i) {
                kept[p.user_id] = true;
                p.status = 'advanced';
                p.ghost = false;
                p.crossed_glass = true;
                p.advanced_round2 = true;
                p.glass_step = demoGlassStepCount;
                p.glass_active = false;
                p.round1_rank = p.round1_rank || i + 1;
                p.glass_finished_at = p.glass_finished_at
                    || new Date(now - (survivors.length - i) * 1200).toISOString();
            });
            playing.forEach(function (p) {
                if (kept[p.user_id]) return;
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = 'glass';
                p.glass_active = false;
            });
            survivors = playing.filter(function (p) {
                return p.status === 'advanced' || p.crossed_glass === true;
            });
        }

        const split = PSEngine.splitTugTeams(survivors);
        const teams = {};
        split.forEach(function (s) {
            const p = playing.find(function (x) { return x.user_id === s.user_id; });
            if (!p) return;
            teams[p.user_id] = s.tug_team;
            p.tug_team = s.tug_team;
            p.question_index = 0;
            p.advanced_round3 = false;
            p.tug_attempts = 0;
        });
        playing.forEach(function (p) {
            if (!teams[p.user_id]) p.tug_team = null;
        });
        return survivors;
    }

    function demoStartTug() {
        if (!room || room.status !== 'round3' || demoRoundCount < 3) return;
        const state = PSEngine.normalizeTugState(room.tug_state);
        if (state.phase !== 'briefing') return;
        if (qualifierInfo()) return;
        const now = Date.now();
        demoPrepareTugSurvivors(now);
        room.tug_state = Object.assign(PSEngine.emptyTugState(), { phase: 'playing' });
        room.round3_started_at = new Date(now).toISOString();
        room.round3_ends_at = new Date(now + demoTugDuration).toISOString();
        room.finished_at = null;
        room.tug_questions = (questions.length ? questions : asArray(room.questions)).slice();
        const playing = players.filter(isPlayingPlayer);
        playing.forEach(function (p) {
            if (!p.tug_team) return;
            p.next_answer_at = now + 300 + demoHash01(p.user_id + ':tugstart') * 1400;
        });
        questionsKey = '';
        me = myPlayer();
        PS.hideOverlay();
    }

    function demoJumpRound3() {
        demoResetPlayers();
        if (!questions.length) {
            const built = PSEngine.buildDemoQuestionSet({ subject: demoSubject, seed: DEMO_SEED });
            questions = built.questions.slice();
            demoGlassPairs = built.glassPairs.slice();
        }
        const now = Date.now();
        demoPrepareTugSurvivors(now);
        room.status = 'round3';
        room.current_round = 3;
        room.round1_started_at = room.round1_started_at || new Date(now - 90000).toISOString();
        room.round1_ends_at = room.round1_ends_at || new Date(now - 30000).toISOString();
        room.round2_started_at = room.round2_started_at || new Date(now - 40000).toISOString();
        room.round2_ends_at = new Date(now).toISOString();
        room.tug_state = Object.assign(PSEngine.emptyTugState(), { phase: 'playing' });
        room.round3_started_at = new Date(now).toISOString();
        room.round3_ends_at = new Date(now + demoTugDuration).toISOString();
        room.finished_at = null;
        room.tug_questions = questions.slice();
        glassSteps = demoBuildGlassSteps();
        for (let i = 0; i < glassSteps.length; i++) PSEngine.revealGlassStep(glassSteps[i], 'correct');
        room.glass_steps = glassSteps;
        room.questions = questions;
        const playing = players.filter(isPlayingPlayer);
        playing.forEach(function (p) {
            if (!p.tug_team) return;
            p.next_answer_at = now + 300 + demoHash01(p.user_id + ':tugjump') * 1500;
        });
        resetQualifierState();
        qualifierDismissed['qualifier:2:' + room.id] = true;
        shownKeys = {};
        questionsKey = '';
        me = myPlayer();
        PS.hideOverlay();
    }

    /* ------------------------- demo Round 4 --------------------------- */

    function demoBuildDalgonaAssignments(list) {
        const crown = (typeof window !== 'undefined' && Array.isArray(window.DG_PARTICIPLE_CLAUSES_COMBINING))
            ? window.DG_PARTICIPLE_CLAUSES_COMBINING
            : PSEngine.DEMO_COMBINING;
        return PSEngine.buildDalgonaAssignments({
            players: list,
            seed: DEMO_SEED,
            fishboneWords: PSEngine.DEMO_VOCAB,
            pawQuestions: PSEngine.DEMO_GRAMMAR,
            crownQuestions: crown
        });
    }

    function demoApplyDalgonaState(p, res) {
        if (!p || !res || !res.state) return;
        const st = res.state;
        p.dalgona_progress = st.progress;
        p.dalgona_cracks = st.cracks;
        p.dalgona_lick_used = st.lickUsed;
        p.dalgona_finished_at = st.finishedAt == null ? null : (typeof st.finishedAt === 'number' ? new Date(st.finishedAt).toISOString() : st.finishedAt);
        p.dalgona_status = st.status;
        if (st.status === 'shattered') {
            p.status = 'eliminated';
            p.ghost = true;
            p.eliminated_reason = 'dalgona';
        }
    }

    function demoEnterRound4(now, skipQualifier) {
        const at = now || Date.now();
        const playing = players.filter(isPlayingPlayer);
        const winners = playing.filter(function (p) {
            return p.status === 'advanced' && !p.ghost;
        });
        winners.forEach(function (p) {
            p.ghost = false;
            p.eliminated_reason = null;
            p.dalgona_progress = 0;
            p.dalgona_cracks = 0;
            p.dalgona_lick_used = false;
            p.dalgona_finished_at = null;
            p.dalgona_attempts = 0;
            p.dalgona_item = null;
            p.dalgona_units = [];
        });
        playing.forEach(function (p) {
            if (winners.indexOf(p) !== -1) return;
            if (p.status !== 'eliminated') {
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = p.eliminated_reason || 'tug';
            }
        });
        const assignments = demoBuildDalgonaAssignments(winners);
        demoDalgonaAssignments = assignments;
        const byId = {};
        assignments.forEach(function (a) { byId[a.user_id] = a; });
        winners.forEach(function (p) {
            const a = byId[p.user_id];
            if (!a) return;
            p.dalgona_pattern = a.pattern;
            p.dalgona_units = a.units.slice();
            p.dalgona_item = a.item;
            p.dalgona_prompt = a.prompt;
            p.dalgona_target = a.target;
            p.dalgona_tiles = a.tiles.slice();
            /* Teacher grid should already look live, not empty. */
            if (!demoIsVisitor(p)) {
                const pct = 0.15 + demoHash01('dg-progress:' + p.user_id) * 0.45;
                p.dalgona_progress = Math.min(a.units.length, Math.floor(a.units.length * pct));
                if (demoHash01('dg-cracks:' + p.user_id) < 0.18) p.dalgona_cracks = 1;
            }
            p.next_dalgona_at = at + 900 + demoHash01(p.user_id + ':dgstart') * 2200;
        });
        room.status = 'round4';
        room.current_round = 4;
        room.settings = demoSettings();
        room.server_now = new Date(at).toISOString();
        clockOffset = 0;
        room.round4_started_at = new Date(skipQualifier ? at - PSEngine.ROUND4.QUALIFIER_MS : at).toISOString();
        room.round4_ends_at = new Date(Date.parse(room.round4_started_at) + PSEngine.ROUND4.QUALIFIER_MS + demoDalgonaDuration).toISOString();
        room.finished_at = null;
        resetQualifierState();
        if (skipQualifier) {
            qualifierDismissed['qualifier:3:' + room.id + ':' + String(room.round4_started_at)] = true;
        }
        shownKeys = {};
        questionsKey = '';
        me = myPlayer();
        PS.hideOverlay();
    }

    function demoJumpRound4() {
        demoResetPlayers();
        if (!questions.length) {
            const built = PSEngine.buildDemoQuestionSet({ subject: demoSubject, seed: DEMO_SEED });
            questions = built.questions.slice();
            demoGlassPairs = built.glassPairs.slice();
        }
        const now = Date.now();
        demoPrepareTugSurvivors(now);
        const playing = players.filter(isPlayingPlayer);
        const visitor = playing.find(function (p) { return p.user_id === DEMO_VISITOR_ID; });
        let winner = 'red';
        if (visitor && visitor.tug_team) winner = visitor.tug_team;
        PSEngine.applyTugResult(playing, winner);
        room.tug_state = Object.assign(PSEngine.emptyTugState(), { phase: 'done', winner: winner });
        room.round3_started_at = room.round3_started_at || new Date(now - 45000).toISOString();
        room.round3_ends_at = new Date(now).toISOString();
        demoEnterRound4(now, true);
    }

    function demoFinishRound4(now) {
        if (!room || room.status !== 'round4') return;
        const at = now || Date.now();
        if (demoRoundCount >= 5) {
            demoEnterRound5(at);
            return;
        }
        room.status = 'finished';
        room.current_round = 4;
        room.finished_at = new Date(at).toISOString();
        shownKeys = {};
        questionsKey = '';
        me = myPlayer();
    }

    function demoTickRound4(now) {
        if (!room || room.status !== 'round4') return;
        if (qualifierInfo()) return;
        const ends = room.round4_ends_at ? Date.parse(room.round4_ends_at) : 0;
        if (ends && now >= ends) {
            players.filter(isPlayingPlayer).forEach(function (p) {
                if (!p.dalgona_pattern || p.dalgona_finished_at) return;
                if (p.status === 'eliminated') return;
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = 'dalgona_timeout';
            });
            demoFinishRound4(now);
            return;
        }
        const carving = players.filter(function (p) {
            return isPlayingPlayer(p) && p.dalgona_pattern && !p.dalgona_finished_at
                && p.status !== 'eliminated' && !p.ghost;
        });
        carving.forEach(function (p) {
            if (demoIsVisitor(p)) return;
            if (p.next_dalgona_at && now < p.next_dalgona_at) return;
            const st = PSEngine.normalizeDalgonaState(p);
            if (st.status === 'finished' || st.status === 'shattered') return;
            const expected = st.units[st.progress];
            const good = demoHash01(p.user_id + ':dg:' + (Number(p.dalgona_attempts) || 0)) < 0.86;
            const value = good ? expected : '__wrong__';
            const res = PSEngine.dalgonaApplyInput(st, value, { now: now });
            demoApplyDalgonaState(p, res);
            p.dalgona_attempts = (Number(p.dalgona_attempts) || 0) + 1;
            p.next_dalgona_at = now + 900 + demoHash01(p.user_id + ':dgpace:' + p.dalgona_attempts) * 1900;
        });
        const left = players.filter(function (p) {
            return isPlayingPlayer(p) && p.dalgona_pattern && !p.dalgona_finished_at
                && p.status !== 'eliminated' && !p.ghost;
        });
        if (!left.length) demoFinishRound4(now);
    }

    /* ------------------------- demo Round 5 --------------------------- */

    function demoFinalsDeck() {
        if (!finalsQuestions.length) {
            finalsQuestions = PSEngine.buildFinalsDeck({
                seed: DEMO_SEED + 401,
                count: 60,
                errorItems: PSEngine.DEMO_GRAMMAR.map(function (q, i) {
                    return Object.assign({ unit: PSEngine.FINALS_UNITS[i % PSEngine.FINALS_UNITS.length] }, q);
                })
            });
        }
        return finalsQuestions;
    }

    function demoHonourFinalsEnd(now) {
        if (!room || room.status !== 'round5') return false;
        const living = players.filter(function (p) {
            return isPlayingPlayer(p) && PSEngine.isFinalsAlive(p);
        });
        const ends = room.round5_ends_at ? Date.parse(room.round5_ends_at) : 0;
        if (living.length <= 1 || (ends && now >= ends)) {
            room.status = 'finished';
            room.current_round = 5;
            room.finished_at = new Date(now).toISOString();
            clearFinalsTimer();
            finalsShownKey = '';
            me = myPlayer();
            return true;
        }
        return false;
    }

    function demoEnterRound5(now) {
        if (!room) return;
        const at = now || Date.now();
        const playing = players.filter(isPlayingPlayer);
        let survivors = playing.filter(function (p) {
            return p.dalgona_finished_at != null || PSEngine.normalizeDalgonaState(p).status === 'finished';
        });
        if (demoFinalsSurvivorOverride != null) {
            const visitor = survivors.find(function (p) { return p.user_id === DEMO_VISITOR_ID; });
            const keep = [];
            if (visitor && demoRole === 'student') keep.push(visitor);
            survivors.forEach(function (p) {
                if (keep.length >= demoFinalsSurvivorOverride) return;
                if (keep.indexOf(p) === -1) keep.push(p);
            });
            survivors = keep.slice(0, Math.max(0, demoFinalsSurvivorOverride));
            const kept = {};
            survivors.forEach(function (p) { kept[p.user_id] = true; });
            playing.forEach(function (p) {
                if (kept[p.user_id]) return;
                p.status = 'eliminated';
                p.ghost = true;
                p.eliminated_reason = p.eliminated_reason || 'dalgona_timeout';
            });
        }

        if (demoRoundCount < 5 || survivors.length < PSEngine.ROUND5.MIN_FINALISTS) {
            room.status = 'finished';
            room.current_round = demoRoundCount >= 5 ? 5 : 4;
            room.finished_at = new Date(at).toISOString();
            finalsShownKey = '';
            me = myPlayer();
            return;
        }

        const kept = {};
        survivors.forEach(function (p, i) {
            kept[p.user_id] = true;
            p.status = 'advanced';
            p.ghost = false;
            p.eliminated_reason = null;
            p.advanced_round3 = true;
            p.finals_progress = PSEngine.ROUND5.START_PROGRESS;
            p.finals_combo = 0;
            p.finals_ghost_correct = 0;
            p.finals_question_index = 0;
            p.ink_until = null;
            p.finals_eliminated_at = null;
            p.next_finals_at = at + 500 + demoHash01(p.user_id + ':finals') * 2200;
        });
        playing.forEach(function (p) {
            if (kept[p.user_id]) return;
            p.status = 'eliminated';
            p.ghost = true;
            p.eliminated_reason = p.eliminated_reason || 'finals_bench';
            p.finals_progress = 0;
        });
        demoFinalsDeck();
        ghostQuestions = PSEngine.buildGhostDeck({ seed: DEMO_SEED + 211, count: 12 });
        room.status = 'round5';
        room.current_round = 5;
        room.settings = demoSettings();
        room.server_now = new Date(at).toISOString();
        clockOffset = 0;
        room.round5_started_at = new Date(at).toISOString();
        room.round5_ends_at = new Date(at + demoFinalsDuration).toISOString();
        room.finals_questions = finalsQuestions;
        room.finished_at = null;
        finalsShownKey = '';
        finalsPicks = [];
        clearFinalsTimer();
        me = myPlayer();
        PS.hideOverlay();
    }

    function demoJumpRound5() {
        demoResetPlayers();
        if (!questions.length) {
            const built = PSEngine.buildDemoQuestionSet({ subject: demoSubject, seed: DEMO_SEED });
            questions = built.questions.slice();
            demoGlassPairs = built.glassPairs.slice();
        }
        const now = Date.now();
        demoPrepareTugSurvivors(now);
        const playing = players.filter(isPlayingPlayer);
        const visitor = playing.find(function (p) { return p.user_id === DEMO_VISITOR_ID; });
        let winner = 'red';
        if (visitor && visitor.tug_team) winner = visitor.tug_team;
        PSEngine.applyTugResult(playing, winner);
        room.tug_state = Object.assign(PSEngine.emptyTugState(), { phase: 'done', winner: winner });
        room.round3_started_at = room.round3_started_at || new Date(now - 45000).toISOString();
        room.round3_ends_at = new Date(now).toISOString();
        demoEnterRound4(now, true);
        const winners = players.filter(function (p) {
            return isPlayingPlayer(p) && p.status === 'advanced' && !p.ghost;
        });
        winners.forEach(function (p, i) {
            p.dalgona_pattern = p.dalgona_pattern || 'fishbone';
            p.dalgona_units = p.dalgona_units && p.dalgona_units.length ? p.dalgona_units : ['a', 'b'];
            p.dalgona_progress = p.dalgona_units.length;
            p.dalgona_finished_at = new Date(now - (i + 1) * 700).toISOString();
        });
        room.round4_started_at = new Date(now - PSEngine.ROUND4.QUALIFIER_MS - 3000).toISOString();
        room.round4_ends_at = new Date(now).toISOString();
        demoEnterRound5(now);
    }

    function demoFinalsAnswer(answer) {
        if (!room || room.status !== 'round5' || !me || !isPlayingPlayer(me)) return;
        if (!PSEngine.isFinalsAlive(me) || inkActive()) return;
        if (Date.now() < answerLockUntil) return;
        const deck = demoFinalsDeck();
        const q = deck[(Number(me.finals_question_index) || 0) % Math.max(1, deck.length)];
        if (!q) return;
        answerLockUntil = Date.now() + 280;
        const res = PSEngine.applyFinalsTurn({
            player: me, players: players, question: q, answer: answer, now: Date.now()
        });
        if (!res.ok) return;
        if (res.correct) {
            sfxCorrect();
            toast('✅ +0 slip · ' + res.progress + ' left'
                + (res.knockback ? ' · 🐾 paw-wave pushes an opponent back ' + res.knockback.amount : ''));
        } else if (res.eliminated) {
            sfxShatter();
            toast('⚡ Electrocuted at the fence — you are a ghost now.');
            showGlassOutOverlay('⚡ Electrocuted', 'Ghosts can still answer revival questions and throw ink.');
        } else {
            sfxWrong();
            toast('❌ Slip 25 · now ' + res.progress + ' — one more wrong at 0 is out.');
        }
        finalsShownKey = '';
        clearFinalsTimer();
        render();
        demoHonourFinalsEnd(Date.now());
        if (room.status === 'finished') render();
    }

    function demoGhostAnswer(choice) {
        if (!room || room.status !== 'round5' || !me || PSEngine.isFinalsAlive(me)) return;
        const deck = ghostDeck();
        const q = deck[(Number(me.finals_question_index) || 0) % Math.max(1, deck.length)];
        if (!q) return;
        const graded = PSEngine.gradeFinalsAnswer(q, Number(choice));
        me.finals_question_index = (Number(me.finals_question_index) || 0) + 1;
        if (graded.correct) {
            me.finals_ghost_correct = Math.max(0, Number(me.finals_ghost_correct) || 0) + 1;
            sfxCorrect();
            toast(me.finals_ghost_correct >= PSEngine.ROUND5.GHOST_NEED
                ? '🖤 Ink bomb ready — throw it at the leader!'
                : '✅ Revival ' + me.finals_ghost_correct + '/' + PSEngine.ROUND5.GHOST_NEED);
        } else {
            sfxWrong();
            toast('❌ Not that one — try the next revival question.');
        }
        finalsShownKey = '';
        render();
    }

    function demoThrowInk() {
        if (!room || room.status !== 'round5' || !me) return;
        if (Math.max(0, Number(me.finals_ghost_correct) || 0) < PSEngine.ROUND5.GHOST_NEED) return;
        const leader = PSEngine.leaderForInk(players);
        if (!leader) {
            toast('No leader to ink right now.');
            return;
        }
        leader.ink_until = new Date(Date.now() + PSEngine.ROUND5.INK_MS).toISOString();
        me.finals_ghost_correct = Math.max(0, (Number(me.finals_ghost_correct) || 0) - PSEngine.ROUND5.GHOST_NEED);
        toast('🖤 Ink bomb thrown — ' + (leader.nickname || 'the leader') + ' is covered for 1.5s.');
        finalsShownKey = '';
        render();
    }

    function demoTickRound5(now) {
        if (!room || room.status !== 'round5') return;
        const deck = demoFinalsDeck();
        const playing = players.filter(isPlayingPlayer);
        playing.forEach(function (p) {
            if (p.ghost || !PSEngine.isFinalsAlive(p)) return;
            if (demoIsVisitor(p)) return;
            if (p.ink_until && Date.parse(p.ink_until) > now) return;
            if (p.next_finals_at && now < p.next_finals_at) return;
            const q = deck[(Number(p.finals_question_index) || 0) % Math.max(1, deck.length)];
            if (!q) return;
            const good = demoHash01(p.user_id + ':finals:' + (Number(p.finals_question_index) || 0)) < 0.78;
            let answer = null;
            if (good) {
                if (q.type === 'error_spotting') answer = q.answer;
                else if (q.type === 'double_trap') answer = q.blanks.map(function (b) { return b.answerIndex; });
                else answer = q.answer;
            }
            PSEngine.applyFinalsTurn({ player: p, players: playing, question: q, answer: answer, now: now });
            p.next_finals_at = now + 1200 + demoHash01(p.user_id + ':finalspace:' + p.finals_question_index) * 1900;
        });
        if (!demoHonourFinalsEnd(now)) room.server_now = new Date(now).toISOString();
    }

    function demoDalgonaInput(value) {
        if (!room || room.status !== 'round4' || !me || !isPlayingPlayer(me)) return;
        if (qualifierInfo()) return;
        if (me.ghost || me.status === 'eliminated') return;
        if (Date.now() < answerLockUntil) return;
        const st = PSEngine.normalizeDalgonaState(me);
        if (st.status === 'finished' || st.status === 'shattered') return;
        answerLockUntil = Date.now() + 180;
        const res = PSEngine.dalgonaApplyInput(st, value, { now: Date.now() });
        if (!res.ok || res.ignored) return;
        demoApplyDalgonaState(me, res);
        me.dalgona_attempts = (Number(me.dalgona_attempts) || 0) + 1;
        if (res.correct) {
            sfxScratch();
            if (res.finished) sfxWin();
            toast('');
        } else {
            PSEngine.recordMistake(me, {
                round: 4,
                kind: 'dalgona',
                pattern: st.pattern,
                prompt: st.prompt,
                choice: value,
                answer: res.expected || '',
                note: res.eliminated ? 'candy split' : 'crack'
            });
            if (res.eliminated) {
                sfxShatter();
                dalgonaShake();
                toast('');
                showGlassOutOverlay('💥 Candy split', 'You can watch the class.');
            } else {
                sfxCrack();
                dalgonaShake();
                if (root.navigator && root.navigator.vibrate) { try { root.navigator.vibrate(90); } catch (e) { /* ignore */ } }
                toast('咔嚓！');
            }
        }
        questionsKey = '';
        renderPlayerQuestion(false, false, true);
    }

    function demoDalgonaLick() {
        if (!room || room.status !== 'round4' || !me || !isPlayingPlayer(me)) return;
        if (lickPending || lickAnimActive()) return;
        if (qualifierInfo() || me.ghost || me.status === 'eliminated') return;
        const st = PSEngine.normalizeDalgonaState(me);
        if (st.lickUsed || st.status === 'finished' || st.status === 'shattered') return;
        lickPending = true;
        setLickButtonPending(true);
        beginLickAnim();
        const res = PSEngine.dalgonaLick(st, { now: Date.now() });
        if (!res.applied) {
            lickAnimStart = 0;
            lickPending = false;
            setLickButtonPending(false);
            return;
        }
        demoApplyDalgonaState(me, res);
        toast('');
        questionsKey = '';
        lickPending = false;
        setLickButtonPending(false);
        renderPlayerQuestion(false, false, true);
    }

    function createdQuestionsKeyReset() {
        questionsKey = '';
    }

    function demoFinishTug(winner, now) {
        if (!room) return;
        const at = now || Date.now();
        const state = PSEngine.normalizeTugState(room.tug_state);
        state.phase = 'done';
        state.winner = winner === 'red' || winner === 'blue' ? winner : state.winner;
        room.tug_state = state;
        PSEngine.applyTugResult(players.filter(isPlayingPlayer), state.winner);
        if (demoRoundCount >= 4) {
            demoEnterRound4(at, false);
            return;
        }
        room.status = 'finished';
        room.current_round = 3;
        room.finished_at = new Date(at).toISOString();
        shownKeys = {};
        questionsKey = '';
        me = myPlayer();
    }

    function demoTugAnswer(choice) {
        if (!room || room.status !== 'round3' || !me || !isPlayingPlayer(me)) return;
        if (!me.tug_team || me.ghost || me.status === 'eliminated') return;
        if (Date.now() < answerLockUntil) return;
        const state = PSEngine.normalizeTugState(room.tug_state);
        if (state.phase !== 'playing') return;
        const bank = room.tug_questions && room.tug_questions.length ? room.tug_questions : questions;
        const qIndex = (Number(me.question_index) || 0) % Math.max(1, bank.length);
        const q = bank[qIndex];
        if (!q) return;
        answerLockUntil = Date.now() + 260;
        const now = Date.now();
        const correct = Number(choice) === Number(q.answer);
        const res = PSEngine.applyTugAnswer(state, { team: me.tug_team, correct: correct, now: now });
        room.tug_state = res.state;
        me.question_index = (Number(me.question_index) || 0) + 1;
        me.tug_attempts = (Number(me.tug_attempts) || 0) + 1;
        if (correct) {
            sfxCorrect();
            toast('✅ Pull +' + res.pull + (res.rageTriggered ? ' · 爆走拉力 2x!' : '')
                + ' — ' + (res.state.position === 0 ? 'Level' : (res.state.position > 0 ? 'Blue +' + res.state.position : 'Red +' + Math.abs(res.state.position))));
        } else {
            sfxWrong();
            PSEngine.recordMistake(me, {
                round: 3,
                kind: 'tug',
                prompt: q.prompt,
                choice: (q.options || [])[Number(choice)] || '',
                answer: (q.options || [])[Number(q.answer)] || ''
            });
            const optsEl = $('ps-options');
            if (optsEl) {
                optsEl.classList.add('ps-options-wrong');
                setTimeout(function () { optsEl.classList.remove('ps-options-wrong'); }, 340);
            }
            toast('❌ No pull — the combo is broken.');
        }
        if (res.state.winner) demoFinishTug(res.state.winner, now);
        questionsKey = '';
        render();
    }

    function demoTickRound3(now) {
        if (!room || room.status !== 'round3') return;
        const state = PSEngine.normalizeTugState(room.tug_state);
        if (state.phase !== 'playing') return;
        const ends = room.round3_ends_at ? Date.parse(room.round3_ends_at) : 0;
        if (ends && now >= ends && !state.suddenDeath) {
            const resolved = PSEngine.resolveTugAtTimeUp(state, now);
            room.tug_state = resolved;
            if (resolved.winner) {
                demoFinishTug(resolved.winner, now);
                return;
            }
            // Sudden death: the clock stays open until the next score.
            room.round3_ends_at = null;
        }
        const playing = players.filter(isPlayingPlayer);
        playing.forEach(function (p) {
            if (!p.tug_team || p.ghost || p.status === 'eliminated') return;
            if (demoIsVisitor(p)) return;
            if (p.next_answer_at && now < p.next_answer_at) return;
            const skill = 0.58 + demoHash01(p.user_id + ':tugskill') * 0.18;
            const correct = demoHash01(p.user_id + ':tug:' + (Number(p.tug_attempts) || 0)) < skill;
            const res = PSEngine.applyTugAnswer(room.tug_state, { team: p.tug_team, correct: correct, now: now });
            room.tug_state = res.state;
            p.question_index = (Number(p.question_index) || 0) + 1;
            p.tug_attempts = (Number(p.tug_attempts) || 0) + 1;
            p.next_answer_at = now + 1200 + demoHash01(p.user_id + ':tugpace:' + p.tug_attempts) * 1900;
            if (res.state.winner) demoFinishTug(res.state.winner, now);
        });
    }

    function demoReleaseGlass(now) {
        if (!room || room.status !== 'round2') return;
        const playing = players.filter(isPlayingPlayer);
        const queue = PSEngine.glassQueueIds(playing);
        PSEngine.releaseGlassQueue(playing, queue, { now: now || Date.now() });
    }

    function demoBotGlassJump(p, now) {
        const steps = playerGlassSteps(p);
        const stepIndex = Math.max(0, Number(p.glass_step) || 0);
        const step = steps[stepIndex];
        if (!step) { p.glass_active = false; return; }
        const stepCount = Math.max(1, steps.length || PSEngine.ROUND2.STEP_COUNT);
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
        if (result.outcome === 'wrong') {
            PSEngine.recordMistake(p, {
                round: 2,
                kind: 'glass',
                prompt: step.prompt,
                left: step.left,
                right: step.right,
                choice: side,
                answer: step.correct_side
            });
        }
        if (result.outcome === 'correct' && !p.crossed_glass && p.status === 'alive') {
            // The live SQL keeps the same player on the bridge for the next
            // pane until they cross or fall; mirror that turn continuation.
            p.glass_active = true;
            p.glass_started_at = now;
        }
    }

    function demoGlassTimeout(p, now) {
        const steps = playerGlassSteps(p);
        const stepIndex = Math.max(0, Number(p.glass_step) || 0);
        const step = steps[stepIndex];
        if (!step) { p.glass_active = false; return; }
        const stepCount = Math.max(1, steps.length || PSEngine.ROUND2.STEP_COUNT);
        PSEngine.applyGlassJump(p, step, '', { stepCount: stepCount, timedOut: true, at: now });
        PSEngine.recordMistake(p, {
            round: 2,
            kind: 'glass_timeout',
            prompt: step.prompt,
            left: step.left,
            right: step.right,
            choice: null,
            answer: step.correct_side
        });
        if (demoIsVisitor(p)) {
            sfxShatter();
            toast('⏱ Time up! No jump — you fell.');
            showGlassOutOverlay('⏱ No jump', 'The 7-second window closed and you fell. The correct pane was not revealed.');
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
        /* Sequential advance: the qualifier board owns the first
           QUALIFIER_MS so no glass clock runs under it. */
        if (qualifierInfo()) return;
        demoReleaseGlass(now);
        const playing = players.filter(isPlayingPlayer);
        playing.forEach(function (p) {
            if (!PSEngine.isAlive(p) || !p.glass_active) return;
            const steps = playerGlassSteps(p);
            const stepIndex = Math.max(0, Number(p.glass_step) || 0);
            const step = steps[stepIndex];
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
        else if (room.status === 'round3') demoTickRound3(Date.now());
        else if (room.status === 'round4') demoTickRound4(Date.now());
        else if (room.status === 'round5') demoTickRound5(Date.now());
        render();
        if (room && (room.status === 'round1' || room.status === 'round2'
            || room.status === 'round3' || room.status === 'round4'
            || room.status === 'round5')) startFrames();
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
        PSEngine.recordMistake(me, {
            round: 1,
            kind: 'red',
            note: result.action === 'eliminated' ? 'Eliminated on red light' : 'Moved on red light',
            penalty: result.penalty || 0
        });
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
            PSEngine.recordMistake(me, {
                round: 1,
                kind: 'answer',
                prompt: q.prompt,
                choice: (q.options || [])[Number(choice)] || '',
                answer: (q.options || [])[Number(q.answer)] || ''
            });
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
        if (qualifierInfo()) return;
        if (!me.glass_active || me.status !== 'alive') return;
        if (side !== 'left' && side !== 'right') return;
        const stepIndex = Math.max(0, Number(me.glass_step) || 0);
        const mySteps = playerGlassSteps(me);
        const step = mySteps[stepIndex];
        if (!step) return;
        const stepCount = Math.max(1, mySteps.length || PSEngine.ROUND2.STEP_COUNT);
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
            me.glass_shattered = true;
            PSEngine.recordMistake(me, {
                round: 2, kind: 'glass', prompt: step.prompt,
                left: step.left, right: step.right, choice: side, answer: step.correct_side
            });
            toast('💥 Normal glass! You fell — the correct pane is lit for the class.');
            showGlassOutOverlay('💥 You fell', 'The pane shattered. The correct side is now lit for the classmates behind you.');
        } else if (result.outcome === 'timeout') {
            sfxShatter();
            PSEngine.recordMistake(me, {
                round: 2, kind: 'glass_timeout', prompt: step.prompt,
                left: step.left, right: step.right, choice: null, answer: step.correct_side
            });
            toast('⏱ Time up! No jump — you fell.');
            showGlassOutOverlay('⏱ No jump', 'The 7-second window closed and you fell. The correct pane was not revealed.');
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
        if (cfg.tugDuration != null) demoTugDuration = PSEngine.normalizeTugDuration(cfg.tugDuration);
        if (cfg.dalgonaDuration != null) demoDalgonaDuration = PSEngine.normalizeDalgonaDuration(cfg.dalgonaDuration);
        if (cfg.finalsDuration != null) demoFinalsDuration = PSEngine.normalizeFinalsDuration(cfg.finalsDuration);
        if (room) {
            room.finish_distance = demoFinishDistance;
            room.settings = demoSettings();
            glassSteps = demoBuildGlassSteps();
            room.glass_steps = glassSteps;
            if (room.status === 'round3' && cfg.tugDuration != null && room.round3_started_at) {
                room.round3_ends_at = new Date(Date.parse(room.round3_started_at) + demoTugDuration).toISOString();
            }
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
        populateLobby();
        demoOpenView();
        demoStartLoop();
        startBgm();
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

    /* Demo/test helper: force a 5-round room with only one Dalgona survivor
       so the finals are skipped and the prize ceremony begins. */
    PS.demoForceFinalsSkip = function () {
        if (!demoMode) return false;
        demoRoundCount = 5;
        if (room) room.settings = demoSettings();
        demoJumpRound5();
        demoFinalsSurvivorOverride = 1;
        demoEnterRound5(Date.now());
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
        else if (target === 'round3' || target === 'tug') {
            if (demoRoundCount >= 3) demoJumpRound3();
            else demoJumpVictory();
        } else if (target === 'round4' || target === 'dalgona') {
            if (demoRoundCount < 4) {
                demoRoundCount = 4;
                if (room) room.settings = demoSettings();
            }
            demoJumpRound4();
        } else if (target === 'round5' || target === 'finals') {
            if (demoRoundCount < 5) {
                demoRoundCount = 5;
                if (room) room.settings = demoSettings();
            }
            demoJumpRound5();
        } else if (target === 'victory' || target === 'finished') demoJumpVictory();
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
        PS.unlockAudio();
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

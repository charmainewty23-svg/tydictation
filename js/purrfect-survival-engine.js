/* LearniTY — Purr-fect Survival engine.
 *
 * Pure game rules for the class survival game. No DOM, no network, no
 * Supabase and no clock: every function takes the values it needs, so the
 * same rules run in the browser, inside the SQL mirror and in node:test.
 *
 * Round 1  — 1-2-3 Meow! (Red Light, Green Light)
 * Round 2  — Glass Stepping Stones
 * Later rounds (tug of war, a second bridge, Squid Circle) are deliberately
 * not implemented; the room keeps current_round / status extensible.
 */
(function (root) {
    'use strict';

    const PS = {};

    /* ------------------------------------------------------------------ */
    /* Constants                                                           */
    /* ------------------------------------------------------------------ */

    PS.VERSION = '1.0.0';

    PS.ROUND1 = {
        GREEN_MIN_MS: 4000,
        GREEN_MAX_MS: 8000,
        YELLOW_MS: 2000,
        RED_MS: 3000,
        DEFAULT_ROUND_MS: 180000,
        FINISH_DISTANCE: 100,
        SPRINT_METERS: 10,
        ADVANCE_LIMIT: 15,
        PENALTY_FIRST: 30,
        PENALTY_SECOND: 15
    };

    PS.ROUND2 = {
        STEP_COUNT: 9,
        WINDOW_MS: 5000,
        DEFAULT_ROUND_MS: 600000
    };

    PS.LIMITS = {
        STUDENTS: 30,
        PLAYERS: 31
    };

    PS.PHASES = ['green', 'yellow', 'red'];

    PS.GRAMMAR_TOPICS = ['tenses', 'agreement', 'articles', 'indefinite_pronouns'];

    PS.GRAMMAR_MODES = {
        tenses: ['av', 'pv', 'mixed'],
        agreement: ['gapfill', 'choose', 'mixed'],
        articles: ['mixed'],
        indefinite_pronouns: ['mixed']
    };

    PS.RULE_TEXT = {
        round1: 'Green: answer to sprint +10 m. Yellow: 2 s warning, answers still count. Red: 3 s — do not answer. Pressing in red costs 30 m, then 15 m, then you are out. Reach 100 m. First 15 survivors cross to the bridge.',
        round2: 'Pick the tempered pane before the 5 s timer runs out. A wrong pane (or no jump) drops you out. Every jump, right or wrong, lights the correct pane for the classmates behind you.'
    };

    /* Traditional Chinese (Hong Kong) sibling of RULE_TEXT. The English
       strings above stay untouched because the in-game HUD uses them. */
    PS.RULE_TEXT_ZH = {
        round1: '綠燈：作答向前衝 +10 米。黃燈：2 秒警告，作答仍然計分。紅燈：3 秒——唔好作答。紅燈時撳會扣 30 米，再撳扣 15 米，第三次出局。跑到 100 米，最先 15 位生存者過橋。',
        round2: '5 秒內揀強化玻璃。揀錯（或者唔跳）就會跌落。無論啱定錯，每次跳都會點亮正確嘅玻璃，等後面同學睇到。'
    };

    /* ------------------------------------------------------------------ */
    /* Small deterministic helpers                                         */
    /* ------------------------------------------------------------------ */

    function coerceSeed(seed) {
        if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0;
        if (typeof seed === 'bigint') return Number(seed & 0xFFFFFFFFn) >>> 0;
        const text = String(seed == null ? 1 : seed);
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    PS.coerceSeed = coerceSeed;

    PS.hashString = function (text) {
        return coerceSeed(text);
    };

    PS.mulberry32 = function (seed) {
        let a = coerceSeed(seed);
        return function () {
            a |= 0;
            a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    };

    PS.shuffleInPlace = function (list, rng) {
        const arr = Array.isArray(list) ? list : [];
        const rnd = typeof rng === 'function' ? rng : Math.random;
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    };

    PS.timeValue = function (value) {
        if (value == null || value === '') return Infinity;
        if (typeof value === 'number') return isFinite(value) ? value : Infinity;
        if (value instanceof Date) return value.getTime();
        const parsed = Date.parse(value);
        return isFinite(parsed) ? parsed : Infinity;
    };

    PS.userKey = function (player) {
        return String((player && (player.user_id || player.id || player.userId)) || '');
    };

    PS.round1Distance = function (player) {
        return Math.max(0, Number(player && player.distance) || 0);
    };

    /* ------------------------------------------------------------------ */
    /* Room rules                                                          */
    /* ------------------------------------------------------------------ */

    PS.normalizeSubject = function (value) {
        const s = String(value == null ? '' : value).trim().toLowerCase();
        if (s === 'grammar') return 'grammar';
        if (s === 'vocab' || s === 'vocabulary' || s === 'new_vocab') return 'vocab';
        return '';
    };

    PS.isGuestBlocked = function (flags) {
        const f = flags || {};
        if (f.guest === true || f.isGuest === true) return true;
        if (f.signedIn === false || f.signed_in === false) return true;
        return false;
    };

    PS.canPlayPurrfect = function (flags) {
        const f = flags || {};
        if (PS.isGuestBlocked(f)) {
            return { ok: false, error: f.signedIn === false ? 'NOT_SIGNED_IN' : 'GUEST_NOT_ALLOWED' };
        }
        return { ok: true, error: '' };
    };

    PS.studentCapacity = function () {
        return PS.LIMITS.STUDENTS;
    };

    PS.playerCapacity = function (teacherPlays) {
        return teacherPlays === false ? PS.LIMITS.STUDENTS : PS.LIMITS.PLAYERS;
    };

    /* One room is either vocab or grammar. The helper both validates that
       and strips the fields that belong to the other subject, so callers
       cannot accidentally mix a vocab bank with a grammar topic. */
    PS.isOneSubject = function (setup) {
        const s = setup || {};
        const hasVocab = !!(s.vocabSource || s.vocab_source || s.topic && PS.normalizeSubject(s.subject) === 'vocab');
        const hasGrammar = !!(s.grammarTopic || s.grammar_topic || s.bankMode || s.bank_mode);
        return !(hasVocab && hasGrammar);
    };

    PS.validateRoomSetup = function (input) {
        const raw = input || {};
        const subject = PS.normalizeSubject(raw.subject);
        if (!subject) return { ok: false, error: 'INVALID_SUBJECT' };

        if (subject === 'grammar') {
            if (raw.vocabSource || raw.vocab_source || raw.newVocabForm || raw.new_vocab_form) {
                return { ok: false, error: 'ONE_SUBJECT_ONLY' };
            }
            const topic = String(raw.grammarTopic || raw.grammar_topic || raw.topic || '').trim().toLowerCase();
            if (PS.GRAMMAR_TOPICS.indexOf(topic) === -1) {
                return { ok: false, error: 'INVALID_TOPIC' };
            }
            const modes = PS.GRAMMAR_MODES[topic] || ['mixed'];
            let mode = String(raw.bankMode || raw.bank_mode || '').trim().toLowerCase();
            if (modes.indexOf(mode) === -1) {
                mode = topic === 'tenses' ? 'av' : (topic === 'agreement' ? 'gapfill' : 'mixed');
            }
            return {
                ok: true,
                error: '',
                setup: {
                    subject: 'grammar',
                    topic: topic,
                    bankMode: mode,
                    vocabSource: '',
                    vocabForm: ''
                }
            };
        }

        if (raw.grammarTopic || raw.grammar_topic || raw.bankMode || raw.bank_mode) {
            return { ok: false, error: 'ONE_SUBJECT_ONLY' };
        }
        const source = String(raw.vocabSource || raw.vocab_source || raw.topic || '').trim();
        if (!source) return { ok: false, error: 'MISSING_VOCAB_SOURCE' };
        return {
            ok: true,
            error: '',
            setup: {
                subject: 'vocab',
                topic: source,
                bankMode: '',
                vocabSource: source,
                vocabForm: String(raw.vocabForm || raw.vocab_form || raw.form || '').trim().toUpperCase()
            }
        };
    };

    /* ------------------------------------------------------------------ */
    /* Round 1 — light cycle                                               */
    /* ------------------------------------------------------------------ */

    PS.buildPhaseSchedule = function (seed, opts) {
        const o = opts || {};
        const roundMs = Math.max(0, Number(o.roundMs) || PS.ROUND1.DEFAULT_ROUND_MS);
        const rng = PS.mulberry32(coerceSeed(seed));
        const greenMin = Math.max(1000, Number(o.greenMinMs) || PS.ROUND1.GREEN_MIN_MS);
        const greenMax = Math.max(greenMin, Number(o.greenMaxMs) || PS.ROUND1.GREEN_MAX_MS);
        const yellow = Math.max(500, Number(o.yellowMs) || PS.ROUND1.YELLOW_MS);
        const red = Math.max(500, Number(o.redMs) || PS.ROUND1.RED_MS);

        const schedule = [];
        let total = 0;
        let guard = 0;
        while (total < roundMs && guard < 10000) {
            guard++;
            const green = greenMin + Math.floor(rng() * (greenMax - greenMin + 1));
            schedule.push({ phase: 'green', duration_ms: green });
            schedule.push({ phase: 'yellow', duration_ms: yellow });
            schedule.push({ phase: 'red', duration_ms: red });
            total += green + yellow + red;
        }
        return schedule;
    };

    PS.phaseAt = function (schedule, elapsedMs) {
        const list = Array.isArray(schedule) ? schedule : [];
        const t = Math.max(0, Number(elapsedMs) || 0);
        if (!list.length) {
            return { phase: 'done', index: 0, elapsed_ms: 0, remaining_ms: 0, duration_ms: 0, cycle: 0, done: true };
        }
        let acc = 0;
        for (let i = 0; i < list.length; i++) {
            const item = list[i] || {};
            const duration = Math.max(0, Number(item.duration_ms) || 0);
            if (t < acc + duration) {
                return {
                    phase: String(item.phase || 'green'),
                    index: i,
                    elapsed_ms: t - acc,
                    remaining_ms: acc + duration - t,
                    duration_ms: duration,
                    cycle: Math.floor(i / 3),
                    done: false
                };
            }
            acc += duration;
        }
        return {
            phase: 'done',
            index: list.length,
            elapsed_ms: 0,
            remaining_ms: 0,
            duration_ms: 0,
            cycle: Math.floor(list.length / 3),
            done: true
        };
    };

    PS.isAnswerPhase = function (phaseOrResult) {
        const phase = typeof phaseOrResult === 'string'
            ? phaseOrResult
            : (phaseOrResult && phaseOrResult.phase) || '';
        return phase === 'green' || phase === 'yellow';
    };

    PS.isRedPhase = function (phaseOrResult) {
        const phase = typeof phaseOrResult === 'string'
            ? phaseOrResult
            : (phaseOrResult && phaseOrResult.phase) || '';
        return phase === 'red';
    };

    PS.elapsedMs = function (startedAt, nowMs) {
        const start = PS.timeValue(startedAt);
        if (!isFinite(start)) return 0;
        const now = nowMs == null ? Date.now() : Number(nowMs);
        return Math.max(0, now - start);
    };

    /* ------------------------------------------------------------------ */
    /* Round 1 — player updates                                            */
    /* ------------------------------------------------------------------ */

    PS.isAlive = function (player) {
        if (!player) return false;
        if (player.ghost === true) return false;
        const status = String(player.status || 'alive');
        return status !== 'eliminated' && status !== 'out' && status !== 'ghost' && status !== 'advanced';
    };

    PS.isRound1Finished = function (player, finishDistance) {
        if (!player) return false;
        const finish = finishDistance == null ? PS.ROUND1.FINISH_DISTANCE : Number(finishDistance);
        return player.reached_finish === true || PS.round1Distance(player) >= finish;
    };

    function eliminate(player, reason) {
        player.status = 'eliminated';
        player.ghost = true;
        player.eliminated_reason = reason || 'eliminated';
        player.eliminated_at = player.eliminated_at || null;
        return player;
    }

    PS.eliminate = eliminate;

    PS.applyRedPenalty = function (player) {
        if (!player) return player;
        if (!PS.isAlive(player)) return player;

        const offences = Math.max(0, Number(player.red_offences != null ? player.red_offences : player.offences) || 0) + 1;
        player.red_offences = offences;
        player.offences = offences;
        player.last_penalty = 0;

        if (offences === 1) {
            player.distance = Math.max(0, PS.round1Distance(player) - PS.ROUND1.PENALTY_FIRST);
            player.last_penalty = -PS.ROUND1.PENALTY_FIRST;
        } else if (offences === 2) {
            player.distance = Math.max(0, PS.round1Distance(player) - PS.ROUND1.PENALTY_SECOND);
            player.last_penalty = -PS.ROUND1.PENALTY_SECOND;
        } else {
            eliminate(player, 'red_light');
            player.red_death = true;
        }
        return player;
    };

    PS.applyGreenCorrect = function (player, meters, opts) {
        if (!player) return player;
        if (!PS.isAlive(player)) return player;
        const o = opts || {};
        const gain = meters == null ? PS.ROUND1.SPRINT_METERS : Number(meters);
        const finish = o.finishDistance == null ? PS.ROUND1.FINISH_DISTANCE : Number(o.finishDistance);
        player.distance = PS.round1Distance(player) + (isFinite(gain) ? gain : PS.ROUND1.SPRINT_METERS);
        if (player.distance >= finish) {
            player.distance = finish;
            player.reached_finish = true;
            if (!player.finished_at && o.at != null) player.finished_at = o.at;
        }
        return player;
    };

    /* A wrong answer on green is a small fail: no distance, no offence. */
    PS.applyGreenWrong = function (player) {
        return player;
    };

    /* Central press decision. The caller resolves the actual answer for
       green / yellow; this helper only decides whether the press is a
       red-light penalty, a normal answer, or ignored. */
    PS.handleRound1Press = function (player, phase, opts) {
        const o = opts || {};
        if (!player || !PS.isAlive(player)) {
            return { action: 'ignored', phase: phase, player: player, penalty: 0 };
        }
        if (PS.isRedPhase(phase)) {
            PS.applyRedPenalty(player);
            return {
                action: player.status === 'eliminated' ? 'eliminated' : 'penalty',
                phase: phase,
                player: player,
                penalty: Number(player.last_penalty) || 0
            };
        }
        if (PS.isAnswerPhase(phase)) {
            return { action: 'answer', phase: phase, player: player, penalty: 0 };
        }
        return { action: 'ignored', phase: phase, player: player, penalty: 0 };
    };

    /* ------------------------------------------------------------------ */
    /* Round 1 — advancement                                               */
    /* ------------------------------------------------------------------ */

    function compareFinish(a, b) {
        const ta = PS.timeValue(a.finished_at != null ? a.finished_at : (a.finished_at_ms != null ? a.finished_at_ms : a.finishedAt));
        const tb = PS.timeValue(b.finished_at != null ? b.finished_at : (b.finished_at_ms != null ? b.finished_at_ms : b.finishedAt));
        if (ta !== tb) return ta < tb ? -1 : 1;
        const da = PS.round1Distance(a);
        const db = PS.round1Distance(b);
        if (da !== db) return db - da;
        return PS.userKey(a) < PS.userKey(b) ? -1 : (PS.userKey(a) > PS.userKey(b) ? 1 : 0);
    }

    function compareFurthest(a, b) {
        const da = PS.round1Distance(a);
        const db = PS.round1Distance(b);
        if (da !== db) return db - da;
        return PS.userKey(a) < PS.userKey(b) ? -1 : (PS.userKey(a) > PS.userKey(b) ? 1 : 0);
    }

    PS.compareFinish = compareFinish;
    PS.compareFurthest = compareFurthest;

    /* Order used by the glass bridge: round-1 finishers first (by time),
       then the remaining living players by distance. */
    PS.round1Order = function (players, opts) {
        const o = opts || {};
        const finish = o.finishDistance == null ? PS.ROUND1.FINISH_DISTANCE : Number(o.finishDistance);
        const alive = (Array.isArray(players) ? players : []).filter(PS.isAlive);
        const finishers = alive.filter(p => PS.isRound1Finished(p, finish)).sort(compareFinish);
        const others = alive.filter(p => !PS.isRound1Finished(p, finish)).sort(compareFurthest);
        return finishers.concat(others);
    };

    /* Takes the first 15 to cross, or the 15 furthest living players when
       fewer than 15 crossed. Ties use finish time, distance, then user_id.
       The survivors keep status=alive and gain round1_advanced / rank. The
       rest are marked eliminated so they become ghost cats and can watch. */
    PS.advanceRound1 = function (players, opts) {
        const o = opts || {};
        const limit = Math.max(1, Number(o.limit) || PS.ROUND1.ADVANCE_LIMIT);
        const markStatus = o.markStatus !== false;
        const ordered = PS.round1Order(players, o);
        const picked = ordered.slice(0, limit);

        picked.forEach((p, i) => {
            p.round1_advanced = true;
            p.round1_rank = i + 1;
        });
        if (markStatus) {
            const pickedIds = new Set(picked.map(PS.userKey));
            (Array.isArray(players) ? players : []).forEach(p => {
                if (!PS.isAlive(p)) return;
                if (pickedIds.has(PS.userKey(p))) return;
                eliminate(p, 'round1_cut');
            });
        }
        return picked;
    };

    /* ------------------------------------------------------------------ */
    /* Round 2 — glass bridge                                              */
    /* ------------------------------------------------------------------ */

    PS.buildGlassSteps = function (opts, seed, count) {
        let o = opts;
        if (Array.isArray(o)) o = { pairs: o, seed: seed, count: count };
        o = o || {};
        const pairs = Array.isArray(o.pairs) ? o.pairs : [];
        const stepCount = Math.max(1, Number(o.count) || PS.ROUND2.STEP_COUNT);
        const rng = PS.mulberry32(coerceSeed(o.seed));
        const out = [];
        for (let i = 0; i < stepCount; i++) {
            const pair = pairs.length ? pairs[i % pairs.length] : { left: 'left', right: 'right', correct: 'left' };
            const hasTexts = pair && (pair.left != null || pair.right != null);
            let left;
            let right;
            let correctSide;
            let prompt = String((pair && pair.prompt) || '');

            if (hasTexts && (
                pair.correctSide === 'left' || pair.correctSide === 'right' ||
                pair.correct === 'left' || pair.correct === 'right' ||
                pair.correct === pair.left || pair.correct === pair.right
            )) {
                left = String(pair.left == null ? '' : pair.left);
                right = String(pair.right == null ? '' : pair.right);
                if (pair.correctSide === 'left' || pair.correctSide === 'right') correctSide = pair.correctSide;
                else if (pair.correct === 'left' || pair.correct === 'right') correctSide = pair.correct;
                else correctSide = pair.correct === pair.left ? 'left' : 'right';
            } else {
                const correctText = String(
                    pair && (pair.correctText != null ? pair.correctText
                        : (pair.correct != null ? pair.correct : (pair.answer != null ? pair.answer : '')))
                );
                const wrongText = String(
                    pair && (pair.wrongText != null ? pair.wrongText
                        : (pair.wrong != null ? pair.wrong : (pair.distractor != null ? pair.distractor : '')))
                );
                correctSide = rng() < 0.5 ? 'left' : 'right';
                left = correctSide === 'left' ? correctText : wrongText;
                right = correctSide === 'left' ? wrongText : correctText;
            }

            out.push({
                index: i,
                prompt: prompt,
                left: left,
                right: right,
                correct_side: correctSide,
                revealed: false,
                revealed_side: null,
                shattered_side: null
            });
        }
        return out;
    };

    PS.revealGlassStep = function (step, outcome) {
        if (!step) return step;
        const o = String(outcome || 'correct');
        if (o === 'timeout' || o === 'invalid') return step;
        step.revealed = true;
        step.revealed_side = step.correct_side;
        step.shattered_side = o === 'wrong'
            ? (step.correct_side === 'left' ? 'right' : 'left')
            : null;
        return step;
    };

    PS.resolveGlassJump = function (input) {
        const o = input || {};
        const step = o.step;
        if (!step) return { outcome: 'invalid', advance: false, eliminated: false, reveal: false, correctSide: null };
        if (o.timedOut) {
            return { outcome: 'timeout', advance: false, eliminated: true, reveal: false, correctSide: step.correct_side || null };
        }
        const side = String(o.side || '').toLowerCase();
        if (side !== 'left' && side !== 'right') {
            return { outcome: 'invalid', advance: false, eliminated: false, reveal: false, correctSide: step.correct_side || null };
        }
        const correct = side === step.correct_side;
        return {
            outcome: correct ? 'correct' : 'wrong',
            advance: correct,
            eliminated: !correct,
            reveal: true,
            correctSide: step.correct_side || null
        };
    };

    PS.applyGlassJump = function (player, step, side, opts) {
        const o = opts || {};
        const stepCount = Math.max(1, Number(o.stepCount) || PS.ROUND2.STEP_COUNT);
        if (!player || !step) {
            return { player: player, outcome: 'invalid', advance: false, eliminated: false, reveal: false };
        }
        if (!PS.isAlive(player)) {
            return { player: player, outcome: 'ignored', advance: false, eliminated: false, reveal: false };
        }

        const result = PS.resolveGlassJump({ step: step, side: side, timedOut: o.timedOut });
        if (result.outcome === 'timeout') {
            eliminate(player, 'glass_timeout');
            player.glass_active = false;
            return Object.assign({ player: player, step: step }, result);
        }
        if (result.outcome === 'invalid') {
            return Object.assign({ player: player, step: step }, result);
        }

        PS.revealGlassStep(step, result.outcome);
        player.glass_side = String(side).toLowerCase();
        player.glass_active = false;

        if (result.outcome === 'correct') {
            player.glass_step = Math.max(0, Number(player.glass_step) || 0) + 1;
            if (player.glass_step >= stepCount) {
                player.glass_step = stepCount;
                player.crossed_glass = true;
                player.survived_round2 = true;
                player.status = 'advanced';
                player.advanced_round2 = true;
                player.glass_finished_at = o.at != null ? o.at : (player.glass_finished_at || null);
                player.glass_active = false;
            } else {
                player.status = 'alive';
            }
        } else {
            eliminate(player, 'glass');
            player.glass_shattered = true;
        }
        return Object.assign({ player: player, step: step }, result);
    };

    PS.glassWindowExpired = function (startedAt, nowMs, windowMs) {
        const start = PS.timeValue(startedAt);
        if (!isFinite(start)) return false;
        const now = nowMs == null ? Date.now() : Number(nowMs);
        const win = windowMs == null ? PS.ROUND2.WINDOW_MS : Number(windowMs);
        return now - start >= win;
    };

    PS.glassWindowRemaining = function (startedAt, nowMs, windowMs) {
        const start = PS.timeValue(startedAt);
        const win = windowMs == null ? PS.ROUND2.WINDOW_MS : Number(windowMs);
        if (!isFinite(start)) return win;
        const now = nowMs == null ? Date.now() : Number(nowMs);
        return Math.max(0, win - (now - start));
    };

    PS.glassAlivePlayers = function (players) {
        return (Array.isArray(players) ? players : []).filter(PS.isAlive);
    };

    PS.glassSurvivors = function (players) {
        return (Array.isArray(players) ? players : []).filter(p => p && (p.crossed_glass === true || p.status === 'advanced'));
    };

    /* Queue = round-1 rank, then distance, then stable user_id. */
    PS.glassQueueOrder = function (players, opts) {
        const o = opts || {};
        const finish = o.finishDistance == null ? PS.ROUND1.FINISH_DISTANCE : Number(o.finishDistance);
        const alive = PS.glassAlivePlayers(players);
        return alive.slice().sort((a, b) => {
            const ra = a.round1_rank != null ? Number(a.round1_rank) : Infinity;
            const rb = b.round1_rank != null ? Number(b.round1_rank) : Infinity;
            if (ra !== rb) return ra < rb ? -1 : 1;
            const da = PS.round1Distance(a);
            const db = PS.round1Distance(b);
            if (da !== db && !PS.isRound1Finished(a, finish) && !PS.isRound1Finished(b, finish)) return db - da;
            return PS.userKey(a) < PS.userKey(b) ? -1 : (PS.userKey(a) > PS.userKey(b) ? 1 : 0);
        });
    };

    PS.glassQueueIds = function (players, opts) {
        return PS.glassQueueOrder(players, opts).map(PS.userKey);
    };

    /* Releases one queued player onto step 0 when nobody living is still
       standing on step 0. A player who has moved to step 1+ (or fallen)
       unblocks the classmate behind them. Mutates glass_active /
       glass_released and returns the ids released this call. */
    PS.releaseGlassQueue = function (players, queueIds, opts) {
        const o = opts || {};
        const list = Array.isArray(players) ? players : [];
        const map = {};
        list.forEach(p => { const id = PS.userKey(p); if (id) map[id] = p; });
        const ids = Array.isArray(queueIds) ? queueIds : PS.glassQueueIds(list, o);

        let blocked = list.some(p => PS.isAlive(p) && p.glass_active === true && Number(p.glass_step) === 0);
        const released = [];
        for (let i = 0; i < ids.length; i++) {
            const p = map[ids[i]];
            if (!p || !PS.isAlive(p)) continue;
            if (p.glass_active === true) continue;
            if (p.glass_released === true) continue;
            if (Number(p.glass_step) > 0) continue;
            if (blocked) break;
            p.glass_active = true;
            p.glass_released = true;
            if (o.now != null) p.glass_started_at = o.now;
            released.push(PS.userKey(p));
            blocked = true;
        }
        return released;
    };

    PS.glassFinished = function (players) {
        return PS.glassAlivePlayers(players).length === 0;
    };

    /* ------------------------------------------------------------------ */
    /* Question building                                                   */
    /* ------------------------------------------------------------------ */

    function uniqueTexts(list) {
        const seen = {};
        const out = [];
        (Array.isArray(list) ? list : []).forEach(v => {
            const text = String(v == null ? '' : v).trim();
            const key = text.toLowerCase();
            if (!text || seen[key]) return;
            seen[key] = true;
            out.push(text);
        });
        return out;
    }

    function pickDistractors(correct, pool, rng, n, preferred) {
        const correctKey = String(correct).trim().toLowerCase();
        const pref = [];
        const rest = [];
        (Array.isArray(pool) ? pool : []).forEach(v => {
            const text = String(v == null ? '' : v).trim();
            if (!text) return;
            if (text.toLowerCase() === correctKey) return;
            if (preferred && preferred(text)) pref.push(text);
            else rest.push(text);
        });
        const chosen = [];
        [pref, rest].forEach(group => {
            const copy = uniqueTexts(group);
            PS.shuffleInPlace(copy, rng);
            for (let i = 0; i < copy.length && chosen.length < n; i++) {
                if (chosen.some(x => x.toLowerCase() === copy[i].toLowerCase())) continue;
                chosen.push(copy[i]);
            }
        });
        while (chosen.length < n) chosen.push('option ' + (chosen.length + 2));
        return chosen;
    }

    function assembleOptions(correct, distractors, rng) {
        const options = [String(correct)].concat(distractors.slice());
        PS.shuffleInPlace(options, rng);
        let answer = options.indexOf(String(correct));
        if (answer === -1) {
            options[0] = String(correct);
            answer = 0;
            PS.shuffleInPlace(options, rng);
            answer = options.indexOf(String(correct));
        }
        return { options: options, answer: answer };
    }

    PS.buildVocabMC = function (opts, seed, count) {
        let o = opts;
        if (Array.isArray(o)) o = { words: o, seed: seed, count: count };
        o = o || {};
        const words = (Array.isArray(o.words) ? o.words : [])
            .map(w => ({
                en: String(w && w.en || '').trim(),
                zh: String(w && w.zh || '').trim()
            }))
            .filter(w => w.en && w.zh);
        if (!words.length) return [];
        const n = Math.max(1, Number(o.count) || Math.min(120, words.length));
        const optionCount = Math.max(2, Number(o.optionCount) || 4);
        const rng = PS.mulberry32(coerceSeed(o.seed));
        const pool = words.map(w => w.en);

        const deck = [];
        let last = '';
        let guard = 0;
        while (deck.length < n && guard < n * 4 + 100) {
            guard++;
            const cycle = PS.shuffleInPlace(words.slice(), rng);
            if (cycle.length > 1 && cycle[0].en === last) {
                const tmp = cycle[0];
                cycle[0] = cycle[1];
                cycle[1] = tmp;
            }
            for (let i = 0; i < cycle.length && deck.length < n; i++) {
                deck.push(cycle[i]);
                last = cycle[i].en;
            }
        }

        return deck.map((word, i) => {
            const distractors = pickDistractors(word.en, pool, rng, optionCount - 1);
            const built = assembleOptions(word.en, distractors, rng);
            return {
                id: 'vocab:' + i,
                prompt: word.zh,
                prompt_en: word.en,
                options: built.options,
                answer: built.answer,
                answer_text: word.en,
                zh: word.zh
            };
        });
    };

    PS.buildGrammarMC = function (opts, seed, count) {
        let o = opts;
        if (Array.isArray(o)) o = { questions: o, seed: seed, count: count };
        o = o || {};
        const questions = (Array.isArray(o.questions) ? o.questions : []).filter(q => q && q.primary);
        if (!questions.length) return [];
        const n = Math.max(1, Number(o.count) || Math.min(120, questions.length));
        const optionCount = Math.max(2, Number(o.optionCount) || 4);
        const rng = PS.mulberry32(coerceSeed(o.seed));
        const pool = [];
        questions.forEach(q => {
            uniqueTexts([q.primary].concat(q.variants || [], q.options || [])).forEach(v => pool.push(v));
        });

        const deck = [];
        let last = '';
        let guard = 0;
        while (deck.length < n && guard < n * 4 + 100) {
            guard++;
            const cycle = PS.shuffleInPlace(questions.slice(), rng);
            if (cycle.length > 1 && cycle[0].primary === last) {
                const tmp = cycle[0];
                cycle[0] = cycle[1];
                cycle[1] = tmp;
            }
            for (let i = 0; i < cycle.length && deck.length < n; i++) {
                deck.push(cycle[i]);
                last = cycle[i].primary;
            }
        }

        return deck.map((q, i) => {
            const section = String(q.sectionKey || q.section || '');
            const preferred = section
                ? (text => {
                    const hit = questions.find(other => String(other.sectionKey || other.section || '') === section && other !== q);
                    return !!hit && uniqueTexts([hit.primary].concat(hit.variants || [], hit.options || [])).indexOf(text) !== -1;
                })
                : null;
            const distractors = pickDistractors(q.primary, pool, rng, optionCount - 1, preferred);
            const built = assembleOptions(q.primary, distractors, rng);
            return {
                id: 'grammar:' + i,
                prompt: String(q.prompt || ''),
                options: built.options,
                answer: built.answer,
                answer_text: String(q.primary),
                section: section
            };
        });
    };

    function commonPrefix(a, b) {
        const x = String(a).toLowerCase();
        const y = String(b).toLowerCase();
        let i = 0;
        while (i < x.length && i < y.length && x[i] === y[i]) i++;
        return i;
    }

    function similarWord(target, candidates) {
        const t = String(target);
        const scored = candidates
            .filter(w => String(w).toLowerCase() !== t.toLowerCase())
            .map(w => {
                const word = String(w);
                let score = commonPrefix(t, word) * 4;
                if (word[0] && t[0] && word[0].toLowerCase() === t[0].toLowerCase()) score += 6;
                score -= Math.abs(word.length - t.length);
                return { word: word, score: score };
            })
            .sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1));
        return scored.length ? scored[0].word : '';
    }

    PS.buildGlassPairs = function (opts, seed, count) {
        let o = opts;
        if (Array.isArray(o)) o = { questions: o, seed: seed, count: count };
        o = o || {};
        const n = Math.max(1, Number(o.count) || PS.ROUND2.STEP_COUNT);
        const rng = PS.mulberry32(coerceSeed(o.seed));
        const out = [];
        const questions = (Array.isArray(o.questions) ? o.questions : []).filter(q => q && q.primary);

        if (questions.length) {
            const primaries = uniqueTexts(questions.map(q => q.primary));
            const deck = PS.shuffleInPlace(questions.slice(), rng);
            for (let i = 0; i < n; i++) {
                const q = deck[i % deck.length];
                const sameSection = questions
                    .filter(other => other !== q && String(other.sectionKey || other.section || '') === String(q.sectionKey || q.section || ''))
                    .map(other => other.primary);
                const candidatePool = sameSection.length ? sameSection.concat(primaries) : primaries;
                const wrong = similarWord(q.primary, uniqueTexts(candidatePool)) || uniqueTexts(candidatePool).find(x => x !== q.primary) || 'none';
                out.push({
                    prompt: String(q.prompt || ''),
                    correct: String(q.primary),
                    wrong: wrong
                });
            }
            return out;
        }

        const words = (Array.isArray(o.words) ? o.words : [])
            .map(w => ({ en: String(w && w.en || '').trim(), zh: String(w && w.zh || '').trim() }))
            .filter(w => w.en);
        const pool = uniqueTexts(words.map(w => w.en));
        const deck = PS.shuffleInPlace(words.slice(), rng);
        for (let i = 0; i < n && deck.length; i++) {
            const word = deck[i % deck.length];
            out.push({
                prompt: word.zh || word.en,
                correct: word.en,
                wrong: similarWord(word.en, pool) || pool.find(x => x !== word.en) || 'none'
            });
        }
        return out;
    };

    /* Build a complete glass bridge. Pairs are used in order (wrapping)
       and the correct side is chosen deterministically from the seed. */
    PS.buildGlassBridge = function (opts) {
        const o = opts || {};
        return PS.buildGlassSteps({
            pairs: o.pairs || [],
            count: o.count == null ? PS.ROUND2.STEP_COUNT : o.count,
            seed: o.seed
        });
    };

    /* ------------------------------------------------------------------ */
    /* Built-in demo banks (no Google Sheet / Supabase required)           */
    /* ------------------------------------------------------------------ */

    /* School-English vocabulary. Every card has English + Chinese so the
       MC builder can use the Chinese prompt and English answer, exactly
       like the live Vocab rooms. Keep this list small and safe: it is
       used by the public no-login demo only. */
    PS.DEMO_VOCAB = [
        { en: 'backpack', zh: '背包' },
        { en: 'library', zh: '圖書館' },
        { en: 'laboratory', zh: '實驗室' },
        { en: 'timetable', zh: '時間表' },
        { en: 'uniform', zh: '校服' },
        { en: 'homework', zh: '功課' },
        { en: 'classroom', zh: '課室' },
        { en: 'principal', zh: '校長' },
        { en: 'excursion', zh: '參觀活動' },
        { en: 'examination', zh: '考試' },
        { en: 'dictionary', zh: '字典' },
        { en: 'assignment', zh: '作業' },
        { en: 'certificate', zh: '證書' },
        { en: 'competition', zh: '比賽' },
        { en: 'audience', zh: '觀眾' },
        { en: 'volunteer', zh: '義工' },
        { en: 'environment', zh: '環境' },
        { en: 'recycling', zh: '回收' },
        { en: 'pollution', zh: '污染' },
        { en: 'nutrition', zh: '營養' },
        { en: 'festival', zh: '節日' },
        { en: 'tradition', zh: '傳統' },
        { en: 'celebrate', zh: '慶祝' },
        { en: 'decorate', zh: '佈置' }
    ];

    /* Grammar prompts with a primary answer and close distractors in the
       same section. buildGrammarMC picks four options; buildGlassPairs
       turns each pair into two near-identical panes. */
    PS.DEMO_GRAMMAR = [
        { prompt: 'Neither of them ___ ready.', primary: 'is', sectionKey: 'is-are' },
        { prompt: 'Both of them ___ ready.', primary: 'are', sectionKey: 'is-are' },
        { prompt: 'Everyone ___ finished the test.', primary: 'has', sectionKey: 'has-have' },
        { prompt: 'The students ___ finished the test.', primary: 'have', sectionKey: 'has-have' },
        { prompt: 'She has lived here ___ 2019.', primary: 'since', sectionKey: 'since-for' },
        { prompt: 'She has lived here ___ five years.', primary: 'for', sectionKey: 'since-for' },
        { prompt: 'The teacher ___ helped us is kind.', primary: 'who', sectionKey: 'who-whom' },
        { prompt: 'The student ___ we met is kind.', primary: 'whom', sectionKey: 'who-whom' },
        { prompt: 'There is not ___ water left.', primary: 'much', sectionKey: 'much-many' },
        { prompt: 'There are not ___ chairs left.', primary: 'many', sectionKey: 'much-many' },
        { prompt: 'He is ___ honest boy.', primary: 'an', sectionKey: 'a-an' },
        { prompt: 'He is ___ university student.', primary: 'a', sectionKey: 'a-an' },
        { prompt: 'I ___ at home yesterday.', primary: 'was', sectionKey: 'was-were' },
        { prompt: 'They ___ at home yesterday.', primary: 'were', sectionKey: 'was-were' },
        { prompt: 'She ___ her homework every day.', primary: 'does', sectionKey: 'do-does' },
        { prompt: 'They ___ their homework every day.', primary: 'do', sectionKey: 'do-does' },
        { prompt: 'The book is ___ the desk.', primary: 'on', sectionKey: 'in-on' },
        { prompt: 'The pencil is ___ the pencil case.', primary: 'in', sectionKey: 'in-on' },
        { prompt: 'There are ___ students this year.', primary: 'fewer', sectionKey: 'fewer-less' },
        { prompt: 'There is ___ water this year.', primary: 'less', sectionKey: 'fewer-less' },
        { prompt: 'I taught ___ to play the piano.', primary: 'myself', sectionKey: 'self' },
        { prompt: 'You taught ___ to play the piano.', primary: 'yourself', sectionKey: 'self' },
        { prompt: 'If it rains, we ___ stay at home.', primary: 'will', sectionKey: 'will-would' },
        { prompt: 'If I were you, I ___ stay at home.', primary: 'would', sectionKey: 'will-would' },
        { prompt: 'She ___ swim when she was five.', primary: 'could', sectionKey: 'can-could' },
        { prompt: 'She ___ swim very well now.', primary: 'can', sectionKey: 'can-could' },
        { prompt: '___ shoes are mine.', primary: 'These', sectionKey: 'this-these' },
        { prompt: '___ bag is mine.', primary: 'This', sectionKey: 'this-these' },
        { prompt: 'This book is ___ interesting than that one.', primary: 'more', sectionKey: 'more-most' },
        { prompt: 'This is the ___ interesting book.', primary: 'most', sectionKey: 'more-most' },
        { prompt: 'You ___ wear a seatbelt. It is the law.', primary: 'must', sectionKey: 'must-should' },
        { prompt: 'You ___ drink more water. It is a good idea.', primary: 'should', sectionKey: 'must-should' },
        { prompt: 'She ___ arrives late. She is very punctual.', primary: 'never', sectionKey: 'always-never' },
        { prompt: 'She ___ arrives early.', primary: 'always', sectionKey: 'always-never' },
        { prompt: 'We stayed at home ___ it was raining.', primary: 'because', sectionKey: 'because-although' },
        { prompt: '___ it was raining, we went out.', primary: 'Although', sectionKey: 'because-although' },
        { prompt: 'I want ___ go home.', primary: 'to', sectionKey: 'to-too' },
        { prompt: 'It is ___ hot today.', primary: 'too', sectionKey: 'to-too' },
        { prompt: '___ bags are in the classroom.', primary: 'Their', sectionKey: 'their-there' },
        { prompt: '___ is a book on the desk.', primary: 'There', sectionKey: 'their-there' },
        { prompt: 'The cat licked ___ paw.', primary: 'its', sectionKey: 'its-its' },
        { prompt: '___ raining outside.', primary: "It's", sectionKey: 'its-its' },
        { prompt: 'Is this ___ book?', primary: 'your', sectionKey: 'your-youre' },
        { prompt: '___ welcome to our school.', primary: "You're", sectionKey: 'your-youre' }
    ];

    /* Build a complete demo question paper from the built-in banks.
       One subject per room: subject defaults to vocab; grammar is used
       only when explicitly requested. Every builder receives the same
       seed, so the public demo replays identically. */
    PS.buildDemoQuestionSet = function (opts) {
        const o = opts || {};
        const subject = PS.normalizeSubject(o.subject) || 'vocab';
        const seed = o.seed == null ? 20261125 : o.seed;
        const count = Math.max(12, Number(o.count) || 60);
        if (subject === 'grammar') {
            const questions = PS.buildGrammarMC({ questions: PS.DEMO_GRAMMAR, seed: seed, count: count });
            const glassPairs = PS.buildGlassPairs({
                questions: PS.DEMO_GRAMMAR,
                seed: PS.coerceSeed(seed) + 3,
                count: PS.ROUND2.STEP_COUNT
            });
            const glassSteps = PS.buildGlassSteps({
                pairs: glassPairs,
                seed: PS.coerceSeed(seed) + 17,
                count: PS.ROUND2.STEP_COUNT
            });
            return { subject: 'grammar', seed: seed, questions: questions, glassPairs: glassPairs, glassSteps: glassSteps };
        }
        const questions = PS.buildVocabMC({ words: PS.DEMO_VOCAB, seed: seed, count: count });
        const glassPairs = PS.buildGlassPairs({
            words: PS.DEMO_VOCAB,
            seed: PS.coerceSeed(seed) + 3,
            count: PS.ROUND2.STEP_COUNT
        });
        const glassSteps = PS.buildGlassSteps({
            pairs: glassPairs,
            seed: PS.coerceSeed(seed) + 17,
            count: PS.ROUND2.STEP_COUNT
        });
        return { subject: 'vocab', seed: seed, questions: questions, glassPairs: glassPairs, glassSteps: glassSteps };
    };

    PS.DEMO_SURNAMES = ['Chan', 'Lee', 'Wong', 'Ho', 'Lam', 'Yip', 'Cheung', 'Lau', 'Ng', 'Tsang', 'Pang', 'Chow'];

    /* A deterministic class of demo classmates (bots). Pure: the demo
       module adds the live player fields. 20–28 keeps the track busy
       without overwhelming a phone. */
    PS.buildDemoClassmates = function (opts) {
        const o = opts || {};
        const count = Math.max(0, Math.min(28, o.count == null ? 24 : Number(o.count)));
        const rng = PS.mulberry32(coerceSeed(o.seed == null ? 20261125 : o.seed));
        const cats = ['Ginger', 'Ragdoll', 'British Shorthair', 'Garfield'];
        const hats = ['None', 'Party Hat', 'Crown', 'Lo-Fi Headphones', 'None', 'None'];
        const glasses = ['None', 'Glasses', 'Sunglasses', 'None', 'Cyber Visor', 'None'];
        const outfits = ['None', 'Racing Jacket', 'Red Scarf', 'School Blazer', 'Football Kit', 'None'];
        const surnames = PS.DEMO_SURNAMES;
        const out = [];
        for (let i = 1; i <= count; i++) {
            const n = String(i).padStart(2, '0');
            out.push({
                user_id: 'demo-' + n,
                email: 's' + n + '@lstyoungkhl.edu.hk',
                nickname: '4C ' + n + ' ' + surnames[(i - 1) % surnames.length],
                form: 'F4',
                cat: cats[i % cats.length],
                hat: hats[Math.floor(rng() * hats.length)],
                glasses: glasses[Math.floor(rng() * glasses.length)],
                outfit: outfits[Math.floor(rng() * outfits.length)]
            });
        }
        return out;
    };

    /* ------------------------------------------------------------------ */
    /* Misc UI helpers (pure)                                              */
    /* ------------------------------------------------------------------ */

    PS.advancementRule = function () {
        return PS.RULE_TEXT.round1;
    };

    PS.phaseLabel = function (phase) {
        if (phase === 'green') return 'GREEN LIGHT — run!';
        if (phase === 'yellow') return 'YELLOW — heads turning…';
        if (phase === 'red') return 'RED LIGHT — freeze!';
        return 'Round over';
    };

    PS.formatClock = function (ms) {
        const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
        const m = Math.floor(total / 60);
        const s = total % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    };

    /* ------------------------------------------------------------------ */
    /* Export                                                              */
    /* ------------------------------------------------------------------ */

    if (typeof module !== 'undefined' && module && module.exports) {
        module.exports = PS;
    }
    if (root) root.PSEngine = PS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* LearniTY — Purr-fect Survival engine.
 *
 * Pure game rules for the class survival game. No DOM, no network, no
 * Supabase and no clock: every function takes the values it needs, so the
 * same rules run in the browser, inside the SQL mirror and in node:test.
 *
 * Round 1  — 1-2-3 Meow! (Red Light, Green Light)
 * Round 2  — Glass Stepping Stones
 * Round 3  — Tug of War (team life-or-death)
 * Round 4  — Dalgona Candy Carving (carve a shape before the clock)
 * Round 5 (Squid Circle) is deliberately not implemented; the room keeps
 * current_round / status extensible. When each later round ships, its host
 * settings must ship in the same change.
 */
(function (root) {
    'use strict';

    const PS = {};

    /* ------------------------------------------------------------------ */
    /* Constants                                                           */
    /* ------------------------------------------------------------------ */

    PS.VERSION = '1.3.0';

    PS.ROUND1 = {
        GREEN_MIN_MS: 4000,
        GREEN_MAX_MS: 8000,
        YELLOW_MS: 2000,
        RED_MS: 3000,
        DEFAULT_ROUND_MS: 180000,
        FINISH_DISTANCE: 100,
        MIN_FINISH_DISTANCE: 30,
        MAX_FINISH_DISTANCE: 300,
        FINISH_DISTANCE_STEP: 10,
        MIN_ROUND_MS: 60000,
        SPRINT_METERS: 10,
        ADVANCE_LIMIT: 15,
        PENALTY_FIRST: 30,
        PENALTY_SECOND: 15
    };

    PS.ROUND2 = {
        STEP_COUNT: 9,
        MIN_STEPS: 3,
        MAX_STEPS: 15,
        WINDOW_MS: 5000,
        DEFAULT_ROUND_MS: 600000
    };

    /* Round 3 — Tug of War. Both teams speed-quiz at the same time; every
       correct answer pulls the rope. A team combo of five correct answers
       triggers a 5 s "爆走拉力 2x" burst. The golden salmon sits at
       (bluePull - redPull); |position| >= WIN_PULL ends instantly. */
    PS.ROUND3 = {
        DEFAULT_MS: 60000,
        MIN_MS: 30000,
        MAX_MS: 120000,
        COMBO: 5,
        RAGE_MULT: 2,
        RAGE_MS: 5000,
        WIN_PULL: 20
    };

    /* Round 4 — Dalgona Candy Carving. Three candy patterns are assigned
       seeded among the living tug winners; each correct letter / word block
       carves one dash segment. Two mistakes break the candy. One lick per
       player auto-fills the next unit. */
    PS.ROUND4 = {
        DEFAULT_MS: 180000,
        MIN_MS: 60000,
        MAX_MS: 600000,
        CRACKS_TO_BREAK: 2,
        LICKS: 1,
        QUALIFIER_MS: 7000,
        PATTERNS: ['fishbone', 'paw', 'crown'],
        /* Student cat-lick animation on the Hint button. Purely visual; the
           lick result is applied immediately and the renderer masks the new
           segment until the tongue has swiped past it. */
        LICK_ANIM_MS: 1000
    };

    /* Pure helper for the visual cat-lick window. Returns null outside the
       window, otherwise a 0..1 progress value. The window is inclusive at
       both ends so a renderer never sees a gap between clear frames. */
    PS.lickAnimProgress = function (startMs, nowMs, durationMs) {
        const start = Number(startMs);
        const now = Number(nowMs);
        const duration = Number(durationMs);
        if (!isFinite(start) || !isFinite(now) || !isFinite(duration)) return null;
        if (start <= 0 || duration <= 0) return null;
        const p = (now - start) / duration;
        if (p < 0 || p > 1) return null;
        return p;
    };

    /* Host settings are extensible by design. Rounds 1–4 are implemented;
       Round 5 (Squid Circle) is NOT playable yet. When it is implemented,
       that game AND its host settings must ship in the same change. */
    PS.HOST = {
        MAX_IMPLEMENTED: 4,
        MAX_PLANNED: 5,
        DEFAULT_ROUNDS: 2,
        KINDS: {
            1: 'meow',
            2: 'glass',
            3: 'tug',
            4: 'dalgona',
            5: 'squid'
        }
    };

    PS.LIMITS = {
        STUDENTS: 30,
        PLAYERS: 31
    };

    /* Prize ceremony Paws (🐾) table. One source of truth for the UI, the
       tests and the SQL mirror. Purr-fect Survival is a longer class game
       than a Word Battle, so it follows the Drive & Go! class top-3 scale
       plus a smaller amount for everyone who actually played. */
    PS.CEREMONY_PAWS = {
        first: 20,
        second: 13,
        third: 8,
        survivor: 5,
        participant: 2
    };

    PS.PHASES = ['green', 'yellow', 'red'];

    PS.GRAMMAR_TOPICS = ['tenses', 'agreement', 'articles', 'indefinite_pronouns', 'participle_phrases'];

    PS.GRAMMAR_MODES = {
        tenses: ['av', 'pv', 'mixed'],
        agreement: ['gapfill', 'choose', 'mixed'],
        articles: ['mixed'],
        indefinite_pronouns: ['mixed'],
        participle_phrases: ['mixed']
    };

    PS.RULE_TEXT = {
        round1: 'Green: answer to sprint +10 m. Yellow: 2 s warning, answers still count. Red: 3 s — do not answer. Pressing in red costs 30 m, then 15 m, then you are out. Reach 100 m. First 15 survivors cross to the bridge.',
        round2: 'Pick the tempered pane before the 5 s timer runs out. A wrong pane (or no jump) drops you out. Every jump, right or wrong, lights the correct pane for the classmates behind you.',
        round3: 'Survivors are split into a red team and a blue team. Both teams answer at the same time: every correct answer pulls the rope +1. Five correct answers in a row trigger 爆走拉力 2x for 5 seconds (each correct then pulls +2). A wrong answer breaks the combo. Pull the golden salmon 20 steps past the centre to win — or be ahead when the clock runs out. The losing team falls into the abyss.',
        round4: 'The Tug of War winners each receive a golden dalgona candy with a stamped shape: fishbone (spell the word from its Chinese hint), cat paw (build the grammar answer from word blocks) or crown cat (combine the two participle-clause sentences). Carve every dash before the clock runs out. The Cat Needle fills one segment per correct letter or block. A first mistake is a black crack and a warning; a second mistake splits the candy and you are out. One lick per player auto-fills the next segment. Finish the pattern to survive.'
    };

    /* Traditional Chinese (Hong Kong) sibling of RULE_TEXT. The English
       strings above stay untouched because the in-game HUD uses them. */
    PS.RULE_TEXT_ZH = {
        round1: '綠燈：作答向前衝 +10 米。黃燈：2 秒警告，作答仍然計分。紅燈：3 秒——唔好作答。紅燈時撳會扣 30 米，再撳扣 15 米，第三次出局。跑到 100 米，最先 15 位生存者過橋。',
        round2: '5 秒內揀強化玻璃。揀錯（或者唔跳）就會跌落。無論啱定錯，每次跳都會點亮正確嘅玻璃，等後面同學睇到。',
        round3: '生存者會平均分去紅隊同藍隊。兩隊同時作答：每答啱一題，條繩就會向自己隊拉 +1。連續答啱 5 題會爆發「爆走拉力 2x」5 秒，期間每題 +2。答錯會斷連勝。將金色三文魚拉過中線 20 步就贏；時間到就由三文魚喺邊一邊定勝負。輸咗嗰隊會跌落深淵。',
        round4: '拔河勝出嘅同學每人會得到一塊金色椪糖，上面有一個壓印圖案：魚骨（睇中文提示串英文字）、貓掌（用字塊砌出文法答案）或者皇冠貓（合併兩句分詞子句）。時間完之前要雕好所有虛線。每答啱一個字母或字塊，貓爪鋼針就會雕好一段。第一次錯會爆出黑色裂痕兼警告；第二次錯椪糖會裂開，你就會出局。每人有一次「舔一口椪糖」機會，會自動填下一個正確答案。雕完成個圖案就過關。'
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

    /* A single round is either vocab or grammar. (A ROOM may use vocab in
       round 1 and grammar in round 2 — that is validated by
       validateHostSettings, not here.) The helper both validates that a
       round does not mix fields and strips the fields that belong to the
       other subject, so callers cannot accidentally pass a vocab bank with
       a grammar topic. */
    PS.isOneSubject = function (setup) {
        const s = setup || {};
        const hasVocab = !!(s.vocabSource || s.vocab_source || s.topic && PS.normalizeSubject(s.subject) === 'vocab');
        const hasGrammar = !!(s.grammarTopic || s.grammar_topic || s.bankMode || s.bank_mode);
        return !(hasVocab && hasGrammar);
    };

    /* New Vocab date scope. The shared helper is authoritative in the app;
       this fallback keeps the pure engine usable on its own. */
    function normalizeVocabScope(value) {
        if (typeof normalizeVocabDateScope === 'function') return normalizeVocabDateScope(value);
        const v = String(value == null ? '' : value).trim().toLowerCase();
        return v === 'today' || v === 'yesterday' ? v : 'all';
    }
    PS.normalizeVocabScope = normalizeVocabScope;

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
                    vocabForm: '',
                    vocabScope: 'all'
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
                vocabForm: String(raw.vocabForm || raw.vocab_form || raw.form || '').trim().toUpperCase(),
                vocabScope: normalizeVocabScope(raw.vocabScope || raw.vocab_scope)
            }
        };
    };

    /* ------------------------------------------------------------------ */
    /* Host settings (roundCount + per-round configuration)               */
    /*                                                                    */
    /* The room settings JSON is versioned and shaped like:                */
    /* { version: 1, roundCount: 2, rounds: [ ...round 1..., ...round 2... ] } */
    /* Each round entry stores subject + topic but round-specific options  */
    /* hang off that entry (finishDistance / roundMs on round 1,           */
    /* glassSteps on round 2, and later tug duration etc.).                */
    /* ------------------------------------------------------------------ */

    function settingsObject(value) {
        if (!value) return {};
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }
        return typeof value === 'object' ? value : {};
    }

    PS.settingsObject = settingsObject;

    /* Finish distance: default 100 m, clamped to 30–300 m on a 10 m step. */
    PS.normalizeFinishDistance = function (value) {
        if (value == null || value === '') return PS.ROUND1.FINISH_DISTANCE;
        let n = Number(value);
        if (!isFinite(n)) return PS.ROUND1.FINISH_DISTANCE;
        n = Math.round(n / PS.ROUND1.FINISH_DISTANCE_STEP) * PS.ROUND1.FINISH_DISTANCE_STEP;
        return Math.max(PS.ROUND1.MIN_FINISH_DISTANCE, Math.min(PS.ROUND1.MAX_FINISH_DISTANCE, n));
    };

    /* Glass bridge length: default 9, clamped to 3–15. */
    PS.normalizeGlassSteps = function (value) {
        if (value == null || value === '') return PS.ROUND2.STEP_COUNT;
        let n = Number(value);
        if (!isFinite(n)) return PS.ROUND2.STEP_COUNT;
        n = Math.round(n);
        return Math.max(PS.ROUND2.MIN_STEPS, Math.min(PS.ROUND2.MAX_STEPS, n));
    };

    /* Round-3 tug duration. The lobby input is in SECONDS, but this helper
       also accepts milliseconds: a value <= 120 is read as seconds, anything
       larger as milliseconds. Default 60 s, clamped to 30–120 s. */
    PS.normalizeTugDuration = function (value) {
        if (value == null || value === '') return PS.ROUND3.DEFAULT_MS;
        let n = Number(value);
        if (!isFinite(n) || n <= 0) return PS.ROUND3.DEFAULT_MS;
        if (n <= 120) n = n * 1000;
        n = Math.round(n);
        return Math.max(PS.ROUND3.MIN_MS, Math.min(PS.ROUND3.MAX_MS, n));
    };

    /* Round-4 carving duration. The lobby input is in SECONDS; a value
       <= 600 is read as seconds, larger values as milliseconds. Default
       180 s, clamped to 60–600 s (10 minutes). */
    PS.normalizeDalgonaDuration = function (value) {
        if (value == null || value === '') return PS.ROUND4.DEFAULT_MS;
        let n = Number(value);
        if (!isFinite(n) || n <= 0) return PS.ROUND4.DEFAULT_MS;
        if (n <= 600) n = n * 1000;
        n = Math.round(n);
        return Math.max(PS.ROUND4.MIN_MS, Math.min(PS.ROUND4.MAX_MS, n));
    };

    function clampRoundMs(value) {
        const n = Number(value);
        if (!isFinite(n) || n <= 0) return PS.ROUND1.DEFAULT_ROUND_MS;
        return Math.max(PS.ROUND1.MIN_ROUND_MS, Math.min(600000, Math.round(n)));
    }

    /* Linear scale from the 100 m / 180 s default; never below 60 s.
       50 m -> 90 s, 100 m -> 180 s, 200 m -> 360 s, 300 m -> 540 s. */
    PS.scaleRound1Ms = function (distance) {
        const metres = PS.normalizeFinishDistance(distance);
        const ms = Math.round(PS.ROUND1.DEFAULT_ROUND_MS * (metres / PS.ROUND1.FINISH_DISTANCE));
        return Math.max(PS.ROUND1.MIN_ROUND_MS, ms);
    };

    /* Single-round validator. Kept separate from validateRoomSetup so the
       existing single-round tests keep their meaning and a host settings
       round entry can be validated on its own. */
    PS.validateRoundSetup = function (input) {
        const raw = input || {};
        const result = PS.validateRoomSetup(raw);
        if (!result.ok) return result;
        const roundNo = Math.floor(Number(raw.round) || 0);
        result.setup.round = roundNo > 0 ? roundNo : 0;
        result.setup.kind = result.setup.round ? (PS.HOST.KINDS[result.setup.round] || '') : '';
        return result;
    };

    function legacySetupInput(raw) {
        const subject = PS.normalizeSubject(raw.subject);
        return {
            subject: raw.subject,
            topic: raw.topic,
            vocabSource: raw.vocabSource || raw.vocab_source || raw.source
                || (subject === 'vocab' ? (raw.topic || '') : ''),
            vocabForm: raw.vocabForm || raw.vocab_form || raw.form || '',
            vocabScope: raw.vocabScope || raw.vocab_scope || '',
            grammarTopic: raw.grammarTopic || raw.grammar_topic
                || (subject === 'grammar' ? (raw.topic || '') : ''),
            bankMode: raw.bankMode || raw.bank_mode || ''
        };
    }

    /* Room round count: 1, 2 or 3 today. Old rooms with no roundCount
       default to 2 (today's behaviour) and anything above the implemented
       maximum is clamped. */
    PS.roomRoundCount = function (settings) {
        const s = settingsObject(settings);
        if (!Object.prototype.hasOwnProperty.call(s, 'roundCount')) return PS.HOST.DEFAULT_ROUNDS;
        const n = Number(s.roundCount);
        if (!isFinite(n)) return PS.HOST.DEFAULT_ROUNDS;
        if (n < 1) return 1;
        return Math.max(1, Math.min(PS.HOST.MAX_IMPLEMENTED, Math.floor(n)));
    };

    PS.shouldPlayRound2 = function (settings) {
        return PS.roomRoundCount(settings) > 1;
    };

    PS.shouldPlayRound3 = function (settings) {
        return PS.roomRoundCount(settings) >= 3;
    };

    /* 'bridge' when round 1 advances into the glass bridge, 'finish' when
       this class only selected 1-2-3 Meow! and survivors win immediately. */
    PS.round1EndAction = function (settings) {
        return PS.shouldPlayRound2(settings) ? 'bridge' : 'finish';
    };

    PS.shouldPlayRound4 = function (settings) {
        return PS.roomRoundCount(settings) >= 4;
    };

    /* 'tug' when the glass bridge advances into the Tug of War, 'finish'
       when the class only selected 1 or 2 rounds. */
    PS.round2EndAction = function (settings) {
        return PS.shouldPlayRound3(settings) ? 'tug' : 'finish';
    };

    /* 'dalgona' when the tug winners go on to carve candy, 'finish' when
       the class selected only 1–3 rounds. */
    PS.round3EndAction = function (settings) {
        return PS.shouldPlayRound4(settings) ? 'dalgona' : 'finish';
    };

    /* Round 5 (Squid Circle) is not implemented, so Round 4 always leads to
       the prize ceremony. */
    PS.round4EndAction = function () {
        return 'finish';
    };

    /* Config for round n (1-based) with old-room fallback: missing or
       legacy settings read the flat room-level subject/source/topic and
       behave like the previous shared bank. */
    PS.roundConfig = function (settings, n, room) {
        const s = settingsObject(settings);
        const r = settingsObject(room);
        const roundNo = Math.max(1, Math.floor(Number(n) || 1));
        const entries = Array.isArray(s.rounds) ? s.rounds : (Array.isArray(r.rounds) ? r.rounds : []);
        const entry = entries.find(item => item && Number(item.round) === roundNo) || {};
        const hasEntry = Object.keys(entry).length > 0;

        const flatSubject = PS.normalizeSubject(s.subject || r.subject)
            || (s.grammarTopic || s.bankMode ? 'grammar' : 'vocab');
        const flatSource = String(
            s.vocabSource || s.vocab_source || s.source || r.source
            || (flatSubject === 'vocab' ? (s.topic || r.topic || '') : '') || ''
        ).trim();
        const flatForm = String(s.vocabForm || s.vocab_form || s.form || r.vocabForm || '').trim().toUpperCase();
        const flatScope = normalizeVocabScope(s.vocabScope || s.vocab_scope || r.vocabScope || r.vocab_scope);
        const flatGrammarTopic = String(
            s.grammarTopic || s.grammar_topic
            || (flatSubject === 'grammar' ? (s.topic || r.topic || 'tenses') : '')
            || ''
        ).trim().toLowerCase();
        const flatMode = String(s.bankMode || s.bank_mode || r.bank_mode || '').trim().toLowerCase();

        let subject = flatSubject;
        let topic = subject === 'grammar' ? (flatGrammarTopic || 'tenses') : (flatSource || String(s.topic || r.topic || ''));
        let vocabSource = subject === 'vocab' ? flatSource : '';
        let vocabForm = subject === 'vocab' ? flatForm : '';
        let vocabScope = subject === 'vocab' ? flatScope : 'all';
        let bankMode = subject === 'grammar' ? flatMode : '';

        if (hasEntry) {
            const entrySubject = PS.normalizeSubject(entry.subject);
            if (entrySubject) {
                subject = entrySubject;
                if (subject === 'grammar') {
                    topic = String(entry.topic || flatGrammarTopic || 'tenses').trim().toLowerCase();
                    bankMode = String(entry.bankMode || entry.bank_mode || flatMode || '').trim().toLowerCase();
                    vocabSource = '';
                    vocabForm = '';
                    vocabScope = 'all';
                } else {
                    vocabSource = String(entry.vocabSource || entry.vocab_source || entry.topic || flatSource || '').trim();
                    topic = vocabSource;
                    vocabForm = String(entry.vocabForm || entry.vocab_form || entry.form || flatForm || '').trim().toUpperCase();
                    vocabScope = normalizeVocabScope(entry.vocabScope || entry.vocab_scope || flatScope);
                    bankMode = '';
                }
            }
        }

        const finishRaw = entry.finishDistance != null ? entry.finishDistance
            : (s.finishDistance != null ? s.finishDistance
                : (r.finish_distance != null ? r.finish_distance : undefined));
        const finishDistance = PS.normalizeFinishDistance(finishRaw);
        const msRaw = entry.roundMs != null ? entry.roundMs : s.roundMs;
        const roundMs = msRaw != null ? clampRoundMs(msRaw) : PS.scaleRound1Ms(finishDistance);
        const stepsRaw = entry.glassSteps != null ? entry.glassSteps : s.glassSteps;
        const glassSteps = PS.normalizeGlassSteps(stepsRaw);
        const tugRaw = entry.tugDuration != null ? entry.tugDuration
            : (s.tugDuration != null ? s.tugDuration : undefined);
        const tugDuration = PS.normalizeTugDuration(tugRaw);
        const dalgonaRaw = entry.dalgonaDuration != null ? entry.dalgonaDuration
            : (s.dalgonaDuration != null ? s.dalgonaDuration : undefined);
        const dalgonaDuration = PS.normalizeDalgonaDuration(dalgonaRaw);

        return {
            round: roundNo,
            kind: PS.HOST.KINDS[roundNo] || String(entry.kind || ''),
            subject: subject,
            topic: topic,
            vocabSource: vocabSource,
            vocabForm: vocabForm,
            vocabScope: vocabScope,
            bankMode: bankMode,
            finishDistance: finishDistance,
            roundMs: roundMs,
            glassSteps: glassSteps,
            tugDuration: tugDuration,
            dalgonaDuration: dalgonaDuration
        };
    };

    /* Validate the full host config. A room-level mix is allowed (round 1
       vocab, round 2 grammar), but each individual round must not mix the
       two subjects. Returns the normalized settings plus the room-level
       round-1 summary columns. */
    PS.validateHostSettings = function (input) {
        const raw = input || {};
        const rawRounds = Array.isArray(raw.rounds) ? raw.rounds : [];
        let roundCount = raw.roundCount;
        if (roundCount == null || roundCount === '') roundCount = PS.HOST.DEFAULT_ROUNDS;
        roundCount = Number(roundCount);
        if (!isFinite(roundCount) || Math.floor(roundCount) !== roundCount || roundCount < 1) {
            return { ok: false, error: 'INVALID_ROUND_COUNT' };
        }
        // Round 5 is not implemented yet: a request above 4 clamps to 4
        // instead of failing the whole room (old behaviour kept 4 and 5
        // unplayable, but a clamped class is friendlier and matches
        // roomRoundCount).
        roundCount = Math.min(PS.HOST.MAX_IMPLEMENTED, roundCount);

        const finishDistance = PS.normalizeFinishDistance(
            raw.finishDistance != null ? raw.finishDistance
                : (raw.finish_distance != null ? raw.finish_distance : undefined)
        );
        const glassSteps = PS.normalizeGlassSteps(
            raw.glassSteps != null ? raw.glassSteps
                : (raw.glass_steps != null ? raw.glass_steps : undefined)
        );
        const tugEntry = rawRounds.find(item => item && Number(item.round) === 3);
        const tugDuration = PS.normalizeTugDuration(
            tugEntry && tugEntry.tugDuration != null ? tugEntry.tugDuration
                : (raw.tugDuration != null ? raw.tugDuration
                    : (raw.tug_duration != null ? raw.tug_duration : undefined))
        );
        const dalgonaEntry = rawRounds.find(item => item && Number(item.round) === 4);
        const dalgonaDuration = PS.normalizeDalgonaDuration(
            dalgonaEntry && dalgonaEntry.dalgonaDuration != null ? dalgonaEntry.dalgonaDuration
                : (raw.dalgonaDuration != null ? raw.dalgonaDuration
                    : (raw.dalgona_duration != null ? raw.dalgona_duration : undefined))
        );

        const rounds = [];
        let previous = null;
        for (let n = 1; n <= roundCount; n++) {
            const entry = rawRounds.find(item => item && Number(item.round) === n);
            let setupInput;
            if (entry) setupInput = entry;
            else if (previous) setupInput = previous; // old rooms shared one bank
            else setupInput = legacySetupInput(raw);

            const validated = PS.validateRoundSetup(setupInput);
            if (!validated.ok) return { ok: false, error: validated.error };

            const cfg = {
                round: n,
                kind: PS.HOST.KINDS[n] || '',
                subject: validated.setup.subject,
                topic: validated.setup.topic,
                bankMode: validated.setup.bankMode,
                vocabSource: validated.setup.vocabSource,
                vocabForm: validated.setup.vocabForm,
                vocabScope: normalizeVocabScope(validated.setup.vocabScope)
            };

            if (n === 1) {
                const distRaw = entry && entry.finishDistance != null ? entry.finishDistance : finishDistance;
                cfg.finishDistance = PS.normalizeFinishDistance(distRaw);
                const msRaw = entry && entry.roundMs != null ? entry.roundMs : raw.roundMs;
                cfg.roundMs = msRaw != null ? clampRoundMs(msRaw) : PS.scaleRound1Ms(cfg.finishDistance);
            }
            if (n === 2) {
                const stepsRaw = entry && entry.glassSteps != null ? entry.glassSteps : glassSteps;
                cfg.glassSteps = PS.normalizeGlassSteps(stepsRaw);
            }
            if (n === 3) {
                const tugRaw = entry && entry.tugDuration != null ? entry.tugDuration : tugDuration;
                cfg.tugDuration = PS.normalizeTugDuration(tugRaw);
            }
            if (n === 4) {
                const dalgonaRaw = entry && entry.dalgonaDuration != null ? entry.dalgonaDuration : dalgonaDuration;
                cfg.dalgonaDuration = PS.normalizeDalgonaDuration(dalgonaRaw);
            }
            rounds.push(cfg);
            previous = cfg;
        }

        const r1 = rounds[0];
        const settings = {
            version: 1,
            roundCount: roundCount,
            rounds: rounds.map(item => Object.assign({}, item)),
            roundMs: r1.roundMs,
            finishDistance: r1.finishDistance,
            glassSteps: rounds[1] ? rounds[1].glassSteps : null,
            tugDuration: rounds[2] ? rounds[2].tugDuration : tugDuration,
            dalgonaDuration: rounds[3] ? rounds[3].dalgonaDuration : dalgonaDuration
        };

        return {
            ok: true,
            error: '',
            settings: settings,
            roundCount: roundCount,
            rounds: rounds,
            subject: r1.subject,
            source: r1.subject === 'vocab' ? r1.vocabSource : '',
            topic: r1.topic,
            bankMode: r1.bankMode,
            finishDistance: r1.finishDistance,
            roundMs: r1.roundMs,
            glassSteps: rounds[1] ? rounds[1].glassSteps : null,
            tugDuration: rounds[2] ? rounds[2].tugDuration : tugDuration,
            dalgonaDuration: rounds[3] ? rounds[3].dalgonaDuration : dalgonaDuration
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
    /* Live class presentation helpers                                    */
    /*                                                                    */
    /* Pure helpers for the teacher/projector side list, the student race  */
    /* ranks and the qualifier board between rounds. They only read fields  */
    /* the game already stores, so tests and the SQL mirror can reproduce   */
    /* the same order without a DOM.                                        */
    /* ------------------------------------------------------------------ */

    PS.playerName = function (player) {
        const nickname = String((player && player.nickname) || '').trim();
        if (nickname) return nickname;
        const email = String((player && player.email) || '').trim();
        if (email) return email.split('@')[0];
        return 'Player';
    };

    /* Playing students only, finishers first by finish time, then the rest
       by distance (same spirit as round1Order). */
    PS.raceOrder = function (players, opts) {
        return PS.round1Order(players, opts).filter(p => p && p.is_playing !== false);
    };

    /* 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, then " / total". */
    PS.formatPlace = function (place, total) {
        const n = Math.max(0, Math.floor(Number(place) || 0));
        const t = Math.floor(Number(total) || 0);
        const mod100 = n % 100;
        const suffix = (mod100 >= 11 && mod100 <= 13)
            ? 'th'
            : (n % 10 === 1 ? 'st' : (n % 10 === 2 ? 'nd' : (n % 10 === 3 ? 'rd' : 'th')));
        return n + suffix + (t > 0 ? ' / ' + t : '');
    };

    /* The student plus a couple of runners ahead and behind by race place.
       Always includes the student; returns an empty list only when the id is
       not in the room at all. */
    PS.nearbyRunners = function (players, meId, opts) {
        const o = opts || {};
        const list = Array.isArray(players) ? players : [];
        const id = String(meId == null ? '' : meId);
        const ordered = PS.raceOrder(list, o);
        const ahead = Math.max(0, Math.floor(o.ahead == null ? 2 : Number(o.ahead) || 0));
        const behind = Math.max(0, Math.floor(o.behind == null ? 2 : Number(o.behind) || 0));
        const index = ordered.findIndex(p => PS.userKey(p) === id);
        if (index === -1) {
            const lone = list.find(p => p && PS.userKey(p) === id);
            return lone ? [lone] : [];
        }
        return ordered.slice(Math.max(0, index - ahead), Math.min(ordered.length, index + behind + 1));
    };

    function teacherRound1Row(p, place, finish, phase) {
        const alive = PS.isAlive(p);
        const finished = PS.isRound1Finished(p, finish);
        const status = !alive ? 'Out' : (finished ? 'Finished' : (phase === 'red' ? 'Frozen' : 'Running'));
        return {
            user_id: PS.userKey(p),
            name: PS.playerName(p),
            place: place,
            detail: PS.round1Distance(p) + ' / ' + finish + ' m',
            status: status,
            team: '',
            combo: 0,
            near: alive && !finished && PS.round1Distance(p) >= finish * 0.8,
            distance: PS.round1Distance(p),
            step: 0
        };
    }

    function teacherRound2Row(p, place, stepCount) {
        const crossed = p.crossed_glass === true || String(p.status || '') === 'advanced';
        const alive = PS.isAlive(p);
        const active = alive && p.glass_active === true;
        const status = crossed ? 'Crossed' : (!alive ? 'Fell' : (active ? 'Jumping' : 'Queued'));
        const step = Math.max(0, Math.min(stepCount, Number(p.glass_step) || 0));
        return {
            user_id: PS.userKey(p),
            name: PS.playerName(p),
            place: place,
            detail: 'Step ' + (crossed ? stepCount : step) + ' / ' + stepCount,
            status: status,
            team: '',
            combo: 0,
            near: !crossed && alive && active && step >= stepCount - 1,
            distance: PS.round1Distance(p),
            step: crossed ? stepCount : step
        };
    }

    function teacherRound3Row(p, place, tug) {
        const team = p.tug_team === 'red' || p.tug_team === 'blue' ? p.tug_team : '';
        const out = !PS.isAlive(p) || p.ghost === true || String(p.status || '') === 'eliminated';
        const status = out ? 'Out' : (tug.phase === 'playing' ? 'Answering' : 'Idle');
        const combo = team === 'red' ? tug.redCombo : (team === 'blue' ? tug.blueCombo : 0);
        return {
            user_id: PS.userKey(p),
            name: PS.playerName(p),
            place: place,
            detail: team ? 'Combo ' + combo + '/' + PS.ROUND3.COMBO : (out ? 'Out' : 'Watching'),
            status: status,
            team: team === 'red' ? 'Red' : (team === 'blue' ? 'Blue' : 'Watching'),
            combo: combo,
            near: false,
            distance: PS.round1Distance(p),
            step: Number(p.glass_step) || 0
        };
    }

    /* Sorted rows for the teacher/projector side list. Round 1 and 2 put
       the leaders first; round 3 groups Red, Blue, then watchers. */
    PS.teacherProgress = function (players, opts) {
        const o = opts || {};
        const round = Math.max(1, Math.min(3, Math.floor(Number(o.round) || 1)));
        const finish = o.finishDistance == null ? PS.ROUND1.FINISH_DISTANCE : Number(o.finishDistance);
        const stepCount = Math.max(1, Number(o.stepCount) || PS.ROUND2.STEP_COUNT);
        const list = (Array.isArray(players) ? players : []).filter(p => p && p.is_playing !== false);

        if (round === 1) {
            const ordered = list.slice().sort((a, b) => {
                const aa = PS.isAlive(a) ? 0 : 1;
                const bb = PS.isAlive(b) ? 0 : 1;
                if (aa !== bb) return aa - bb;
                if (aa === 0) {
                    const fa = PS.isRound1Finished(a, finish) ? 0 : 1;
                    const fb = PS.isRound1Finished(b, finish) ? 0 : 1;
                    if (fa !== fb) return fa - fb;
                    if (fa === 0) {
                        const ca = compareFinish(a, b);
                        if (ca !== 0) return ca;
                    }
                }
                return compareFurthest(a, b);
            });
            const phase = String(o.phase || '');
            return ordered.map((p, i) => teacherRound1Row(p, i + 1, finish, phase));
        }

        if (round === 2) {
            const category = (p) => {
                if (p.crossed_glass === true || String(p.status || '') === 'advanced') return 0;
                if (PS.isAlive(p) && p.glass_active === true) return 1;
                if (PS.isAlive(p)) return 2;
                return 3;
            };
            const ordered = list.slice().sort((a, b) => {
                const ca = category(a);
                const cb = category(b);
                if (ca !== cb) return ca - cb;
                const sa = Number(a.glass_step) || 0;
                const sb = Number(b.glass_step) || 0;
                if (sa !== sb) return sb - sa;
                const ra = a.round1_rank == null ? Infinity : Number(a.round1_rank);
                const rb = b.round1_rank == null ? Infinity : Number(b.round1_rank);
                if (ra !== rb) return ra < rb ? -1 : 1;
                return compareFurthest(a, b);
            });
            return ordered.map((p, i) => teacherRound2Row(p, i + 1, stepCount));
        }

        const tug = PS.normalizeTugState(o.tug);
        const teamRank = (p) => {
            if (p.tug_team === 'red') return 0;
            if (p.tug_team === 'blue') return 1;
            return 2;
        };
        const ordered = list.slice().sort((a, b) => {
            const ta = teamRank(a);
            const tb = teamRank(b);
            if (ta !== tb) return ta - tb;
            const oa = PS.isAlive(a) ? 0 : 1;
            const ob = PS.isAlive(b) ? 0 : 1;
            if (oa !== ob) return oa - ob;
            const ra = a.round1_rank == null ? Infinity : Number(a.round1_rank);
            const rb = b.round1_rank == null ? Infinity : Number(b.round1_rank);
            if (ra !== rb) return ra < rb ? -1 : 1;
            return PS.userKey(a) < PS.userKey(b) ? -1 : (PS.userKey(a) > PS.userKey(b) ? 1 : 0);
        });
        return ordered.map((p, i) => teacherRound3Row(p, i + 1, tug));
    };

    /* Advancing players between rounds. fromRound 1 = the first 15 (or the
       furthest living players) out of 1-2-3 Meow!; fromRound 2 = the class
       that crossed the glass bridge. Stable order, no server fields. */
    PS.qualifierRoster = function (players, opts) {
        const o = opts || {};
        const fromRound = Math.max(1, Math.min(3, Math.floor(Number(o.fromRound) || 1)));
        const finish = o.finishDistance == null ? PS.ROUND1.FINISH_DISTANCE : Number(o.finishDistance);
        const list = (Array.isArray(players) ? players : []).filter(p => p && p.is_playing !== false);

        /* Round 3 -> Round 4: the Tug of War winners advance to Dalgona
           Candy Carving. The winning team is used when the host state is
           known; otherwise every still-living player is listed (older rows
           already mark losers as eliminated). */
        if (fromRound >= 3) {
            const tug = PS.normalizeTugState(o.tug);
            const winner = tug.winner === 'red' || tug.winner === 'blue' ? tug.winner : '';
            let survivors;
            if (winner) {
                survivors = list.filter(p => p.tug_team === winner);
            } else {
                survivors = list.filter(p => {
                    if (p.ghost === true) return false;
                    const status = String(p.status || 'alive');
                    return status !== 'eliminated' && status !== 'out' && status !== 'ghost';
                });
                if (!survivors.length) survivors = PS.tugSurvivors(list);
            }
            survivors = survivors.slice().sort((a, b) => {
                const ra = a.round1_rank == null ? Infinity : Number(a.round1_rank);
                const rb = b.round1_rank == null ? Infinity : Number(b.round1_rank);
                if (ra !== rb) return ra < rb ? -1 : 1;
                return PS.userKey(a) < PS.userKey(b) ? -1 : (PS.userKey(a) > PS.userKey(b) ? 1 : 0);
            });
            return survivors.map((p, i) => ({
                user_id: PS.userKey(p),
                name: PS.playerName(p),
                place: i + 1,
                detail: winner ? 'Won the Tug of War' : 'Survived the Tug of War',
                team: p.tug_team === 'red' || p.tug_team === 'blue' ? p.tug_team : '',
                distance: PS.round1Distance(p),
                step: Number(p.glass_step) || 0
            }));
        }

        if (fromRound >= 2) {
            const survivors = PS.tugSurvivors(list).slice().sort((a, b) => {
                const fa = PS.timeValue(a.glass_finished_at != null ? a.glass_finished_at : a.glass_finished_at_ms);
                const fb = PS.timeValue(b.glass_finished_at != null ? b.glass_finished_at : b.glass_finished_at_ms);
                if (fa !== fb) return fa < fb ? -1 : 1;
                const ra = a.round1_rank == null ? Infinity : Number(a.round1_rank);
                const rb = b.round1_rank == null ? Infinity : Number(b.round1_rank);
                if (ra !== rb) return ra < rb ? -1 : 1;
                return PS.userKey(a) < PS.userKey(b) ? -1 : (PS.userKey(a) > PS.userKey(b) ? 1 : 0);
            });
            return survivors.map((p, i) => {
                const crossed = p.crossed_glass === true || String(p.status || '') === 'advanced';
                return {
                    user_id: PS.userKey(p),
                    name: PS.playerName(p),
                    place: i + 1,
                    detail: crossed ? 'Crossed the glass bridge' : 'Advanced from Round 1',
                    team: p.tug_team === 'red' || p.tug_team === 'blue' ? p.tug_team : '',
                    distance: PS.round1Distance(p),
                    step: Number(p.glass_step) || 0
                };
            });
        }

        const limit = Math.max(1, Number(o.limit) || PS.ROUND1.ADVANCE_LIMIT);
        return PS.round1Order(list, { finishDistance: finish }).slice(0, limit).map((p, i) => {
            const finished = PS.isRound1Finished(p, finish);
            return {
                user_id: PS.userKey(p),
                name: PS.playerName(p),
                place: i + 1,
                detail: finished ? 'Finished' : PS.round1Distance(p) + ' m',
                team: p.tug_team === 'red' || p.tug_team === 'blue' ? p.tug_team : '',
                distance: PS.round1Distance(p),
                step: 0
            };
        });
    };

    PS.qualifierTitle = function (fromRound) {
        const n = Math.floor(Number(fromRound) || 1);
        if (n >= 3) return 'Advancing to Dalgona Candy Carving';
        return n >= 2 ? 'Advancing to Tug of War' : 'Advancing to Glass Stepping Stones';
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

    /* Round 2 uses one shared topic bank (the same pairs for the whole
       class) but every student gets their own deterministic order, so the
       classmate ahead cannot hand the answers to the next jumper. The seed
       mixes the room seed with the student id; the same inputs always give
       the same order. */
    PS.glassOrderSeed = function (seed, userId) {
        return coerceSeed(String(seed == null ? 1 : seed) + '|' + String(userId == null ? '' : userId) + '|glass');
    };

    PS.glassOrderForPlayer = function (userId, stepCount, seed) {
        const n = Math.max(1, Math.min(PS.ROUND2.MAX_STEPS, Math.floor(Number(stepCount) || PS.ROUND2.STEP_COUNT)));
        const order = [];
        for (let i = 0; i < n; i++) order.push(i);
        PS.shuffleInPlace(order, PS.mulberry32(PS.glassOrderSeed(seed, userId)));
        return order;
    };

    function validOrder(order, n) {
        if (!Array.isArray(order) || order.length !== n) return null;
        const seen = {};
        const out = [];
        for (let i = 0; i < order.length; i++) {
            const idx = Math.floor(Number(order[i]));
            if (!isFinite(idx) || idx < 0 || idx >= n || seen[idx]) return null;
            seen[idx] = true;
            out.push(idx);
        }
        return out;
    }

    /* Clone the shared bank into one student's sequence. Revealed/shattered
       lights from anybody else are always stripped, so a queued student is
       never handed a classmate's answer. */
    PS.glassStepsForPlayer = function (baseSteps, userId, seed, orderOverride) {
        const base = Array.isArray(baseSteps) ? baseSteps : [];
        const n = base.length;
        if (!n) return [];
        const order = validOrder(orderOverride, n)
            || PS.glassOrderForPlayer(userId, n, seed);
        return order.map(function (idx, seq) {
            const src = base[idx] || {};
            return {
                index: seq,
                bank_index: idx,
                prompt: src.prompt == null ? '' : String(src.prompt),
                left: src.left == null ? '' : String(src.left),
                right: src.right == null ? '' : String(src.right),
                correct_side: src.correct_side === 'right' ? 'right' : 'left',
                revealed: false,
                revealed_side: null,
                shattered_side: null
            };
        });
    };

    /* The step this student is standing on, taken from their own sequence.
       Never reads the shared room array's reveal flags. */
    PS.playerGlassStep = function (baseSteps, player, seed) {
        if (!player) return null;
        const steps = PS.glassStepsForPlayer(baseSteps, PS.userKey(player), seed, player.glass_order);
        const idx = Math.max(0, Number(player.glass_step) || 0);
        return steps[idx] || null;
    };

    /* Append-only mistake log. Safe to call with a plain player object in
       the demo (no SQL required); live rooms get the same entries appended
       by the server RPCs. */
    PS.recordMistake = function (player, entry) {
        if (!player || !entry) return player;
        const list = Array.isArray(player.answer_log)
            ? player.answer_log.slice()
            : (Array.isArray(player.mistakes) ? player.mistakes.slice() : []);
        const clean = {};
        ['round', 'kind', 'prompt', 'left', 'right', 'choice', 'answer', 'note', 'penalty',
            'pattern', 'unit'].forEach(function (key) {
            if (entry[key] != null) clean[key] = entry[key];
        });
        clean.correct = false;
        list.push(clean);
        player.answer_log = list;
        player.mistakes = list;
        return player;
    };

    function mistakeList(player) {
        if (!player) return [];
        const raw = Array.isArray(player.answer_log) ? player.answer_log
            : (Array.isArray(player.mistakes) ? player.mistakes : []);
        return raw.filter(function (entry) { return entry && typeof entry === 'object'; })
            .map(function (entry) {
                const clean = {};
                ['round', 'kind', 'prompt', 'left', 'right', 'choice', 'answer', 'note', 'penalty',
                    'pattern', 'unit'].forEach(function (key) {
                    if (entry[key] != null) clean[key] = entry[key];
                });
                clean.correct = false;
                return clean;
            });
    }

    /* Student view: only their own rows. Teacher / projector: every player
       with at least one mistake, grouped by student. */
    PS.mistakeReport = function (players, opts) {
        const o = opts || {};
        const viewer = o.viewer === 'teacher' ? 'teacher' : 'student';
        const list = (Array.isArray(players) ? players : []).filter(function (p) {
            return p && p.is_playing !== false;
        });
        const rows = [];
        if (viewer === 'student') {
            const meId = String(o.meId == null ? '' : o.meId);
            const p = list.find(function (x) { return PS.userKey(x) === meId; });
            if (p) {
                rows.push({
                    user_id: PS.userKey(p),
                    nickname: String(p.nickname || ''),
                    mistakes: mistakeList(p)
                });
            }
        } else {
            list.forEach(function (p) {
                const mistakes = mistakeList(p);
                if (!mistakes.length) return;
                rows.push({
                    user_id: PS.userKey(p),
                    nickname: String(p.nickname || ''),
                    mistakes: mistakes
                });
            });
            rows.sort(function (a, b) {
                if (a.nickname !== b.nickname) return a.nickname < b.nickname ? -1 : 1;
                return a.user_id < b.user_id ? -1 : (a.user_id > b.user_id ? 1 : 0);
            });
        }
        return {
            viewer: viewer,
            rows: rows,
            total: rows.reduce(function (n, row) { return n + row.mistakes.length; }, 0)
        };
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
    /* Round 3 — Tug of War                                                */
    /* ------------------------------------------------------------------ */

    function isTugCandidate(player) {
        if (!player) return false;
        if (player.is_playing === false) return false;
        if (player.ghost === true) return false;
        const status = String(player.status || 'alive');
        if (status === 'eliminated' || status === 'out' || status === 'ghost') return false;
        return player.crossed_glass === true
            || status === 'advanced'
            || player.advanced_round2 === true;
    }

    /* The players who actually reached the far side of the glass bridge.
       If a 3-round class somehow has no glass survivors (older/odd rooms),
       fall back to the living players who advanced out of round 1. */
    PS.tugSurvivors = function (players) {
        const list = Array.isArray(players) ? players : [];
        const crossed = list.filter(isTugCandidate);
        if (crossed.length) return crossed;
        return list.filter(p => {
            if (!p || p.is_playing === false || p.ghost === true) return false;
            const status = String(p.status || 'alive');
            if (status === 'eliminated' || status === 'out' || status === 'ghost') return false;
            return p.round1_advanced === true || p.advanced_round1 === true;
        });
    };

    PS.shouldSkipTug = function (players) {
        return PS.tugSurvivors(players).length < 2;
    };

    /* Fair snake split by prior finish order:
       glass_finished_at asc, round1_rank asc, user_id asc.
       Teams: index 0 red, 1 blue, 2 blue, 3 red, 4 red, 5 blue, ... so
       consecutive finishers alternate in ABBA pairs and an odd class is
       never stacked with the strongest players on one team.
       Returns a NEW array of shallow-copied players with tug_team set; the
       input array and its player objects are not mutated. */
    PS.splitTugTeams = function (players) {
        const ordered = PS.tugSurvivors(players).slice().sort((a, b) => {
            const fa = PS.timeValue(a.glass_finished_at != null ? a.glass_finished_at : a.glass_finished_at_ms);
            const fb = PS.timeValue(b.glass_finished_at != null ? b.glass_finished_at : b.glass_finished_at_ms);
            if (fa !== fb) return fa < fb ? -1 : 1;
            const ra = a.round1_rank != null ? Number(a.round1_rank) : Infinity;
            const rb = b.round1_rank != null ? Number(b.round1_rank) : Infinity;
            if (ra !== rb) return ra < rb ? -1 : 1;
            return PS.userKey(a) < PS.userKey(b) ? -1 : (PS.userKey(a) > PS.userKey(b) ? 1 : 0);
        });
        return ordered.map((player, i) => {
            const team = (i % 4 === 0 || i % 4 === 3) ? 'red' : 'blue';
            return Object.assign({}, player, { tug_team: team });
        });
    };

    PS.emptyTugState = function () {
        return {
            phase: 'briefing',
            redPull: 0,
            bluePull: 0,
            redCombo: 0,
            blueCombo: 0,
            redRageUntil: 0,
            blueRageUntil: 0,
            position: 0,
            winner: null,
            suddenDeath: false
        };
    };

    PS.normalizeTugState = function (state) {
        const base = PS.emptyTugState();
        let raw = state;
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (e) { raw = null; }
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
        const phase = String(raw.phase || '');
        base.phase = (phase === 'playing' || phase === 'done') ? phase : 'briefing';
        const num = (v) => {
            const n = Number(v);
            return isFinite(n) ? n : 0;
        };
        base.redPull = num(raw.redPull);
        base.bluePull = num(raw.bluePull);
        base.redCombo = Math.max(0, Math.floor(num(raw.redCombo)));
        base.blueCombo = Math.max(0, Math.floor(num(raw.blueCombo)));
        base.redRageUntil = Math.max(0, num(raw.redRageUntil));
        base.blueRageUntil = Math.max(0, num(raw.blueRageUntil));
        base.position = base.bluePull - base.redPull;
        base.winner = raw.winner === 'red' || raw.winner === 'blue' ? raw.winner : null;
        base.suddenDeath = raw.suddenDeath === true;
        if (base.winner) base.phase = 'done';
        return base;
    };

    /* Positive = pulled toward blue. Not clamped: the win check needs the
       true value; the renderer may clamp the visual position. */
    PS.tugPosition = function (state) {
        const s = PS.normalizeTugState(state);
        return s.bluePull - s.redPull;
    };

    PS.tugRageActive = function (state, team, now) {
        const s = PS.normalizeTugState(state);
        const t = team === 'red' ? 'redRageUntil' : (team === 'blue' ? 'blueRageUntil' : '');
        if (!t) return false;
        const at = now == null ? Date.now() : Number(now);
        return isFinite(at) && at < Number(s[t] || 0);
    };

    /* Pure answer application. Returns a new state plus a small result
       summary. Ignore answers when the phase is not 'playing' or no team. */
    PS.applyTugAnswer = function (state, input) {
        const o = input || {};
        const current = PS.normalizeTugState(state);
        const team = o.team === 'red' || o.team === 'blue' ? o.team : '';
        const now = o.now == null ? Date.now() : Number(o.now);
        if (!team || current.phase !== 'playing') {
            return { state: current, pull: 0, rageTriggered: false, comboBroken: false, rageActive: false, winner: current.winner };
        }
        const next = PS.normalizeTugState(current);
        const comboKey = team + 'Combo';
        const rageKey = team + 'RageUntil';
        const rageWasActive = PS.tugRageActive(next, team, now);
        let pull = 0;
        let rageTriggered = false;
        let comboBroken = false;

        if (o.correct === true) {
            pull = rageWasActive ? PS.ROUND3.RAGE_MULT : 1;
            if (rageWasActive) {
                next[comboKey] = 0;
                // Rage lasts its 5 seconds; a correct answer inside the
                // burst does not extend it.
            } else {
                const combo = Math.max(0, Math.floor(Number(next[comboKey]) || 0)) + 1;
                if (combo >= PS.ROUND3.COMBO) {
                    next[comboKey] = 0;
                    next[rageKey] = now + PS.ROUND3.RAGE_MS;
                    rageTriggered = true;
                } else {
                    next[comboKey] = combo;
                }
            }
        } else {
            next[comboKey] = 0;
            next[rageKey] = 0;
            comboBroken = true;
        }

        if (team === 'red') next.redPull = Math.max(0, Number(next.redPull) || 0) + pull;
        else next.bluePull = Math.max(0, Number(next.bluePull) || 0) + pull;
        next.position = next.bluePull - next.redPull;

        if (next.position >= PS.ROUND3.WIN_PULL) {
            next.winner = 'blue';
            next.phase = 'done';
        } else if (next.position <= -PS.ROUND3.WIN_PULL) {
            next.winner = 'red';
            next.phase = 'done';
        } else if (next.suddenDeath && o.correct === true && next.position !== 0) {
            // Sudden death: the next scoring answer pulls the salmon off
            // centre and decides the tug immediately.
            next.winner = next.position > 0 ? 'blue' : 'red';
            next.phase = 'done';
        }

        return {
            state: next,
            pull: pull,
            rageTriggered: rageTriggered,
            comboBroken: comboBroken,
            rageActive: PS.tugRageActive(next, team, now),
            winner: next.winner
        };
    };

    /* At time-up the side with the golden salmon wins. An exact tie is
       sudden death: keep playing, no winner yet. */
    PS.resolveTugAtTimeUp = function (state, now) {
        const s = PS.normalizeTugState(state);
        if (s.phase === 'done' || s.winner) return s;
        const pos = s.bluePull - s.redPull;
        if (pos > 0) {
            s.winner = 'blue';
            s.phase = 'done';
        } else if (pos < 0) {
            s.winner = 'red';
            s.phase = 'done';
        } else {
            s.suddenDeath = true;
            s.phase = 'playing';
            s.winner = null;
        }
        return s;
    };

    /* Losing team falls + becomes ghosts; winning team is marked advanced.
       Players without a team are left untouched. Mutates the player objects
       and returns the same list (matches advanceRound1's style). */
    PS.applyTugResult = function (players, winner) {
        const list = Array.isArray(players) ? players : [];
        const win = winner === 'red' || winner === 'blue' ? winner : '';
        if (!win) return list;
        list.forEach(p => {
            if (!p || !p.tug_team) return;
            if (p.tug_team === win) {
                p.status = 'advanced';
                p.ghost = false;
                p.eliminated_reason = null;
                p.advanced_round3 = true;
            } else {
                eliminate(p, 'tug');
            }
        });
        return list;
    };

    /* ------------------------------------------------------------------ */
    /* Round 4 — Dalgona Candy Carving                                     */
    /*                                                                    */
    /* Three patterns, each with its own question bank:                    */
    /*   fishbone — spell the English word from its Chinese hint           */
    /*              (New Vocab + Dictation Master words)                   */
    /*   paw      — build the grammar answer from word blocks              */
    /*              (the same five Grammar Quest topics as Drive & Go!)    */
    /*   crown    — combine two participle-clause sentences (Q251+)        */
    /*                                                                    */
    /* Units are always the carve path: one correct letter / word block    */
    /* advances the Cat Needle by one dash segment.                        */
    /* ------------------------------------------------------------------ */

    PS.DALGONA_PATTERN_LABEL = {
        fishbone: 'Fishbone',
        paw: 'Cat paw',
        crown: 'Crown cat'
    };

    PS.dalgonaPatternLabel = function (pattern) {
        return PS.DALGONA_PATTERN_LABEL[String(pattern || '')] || 'Candy';
    };

    /* Split an official answer into typed word blocks. Punctuation stays
       attached to its word (same rule in the browser and the SQL mirror). */
    PS.dalgonaTokenize = function (text) {
        return String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    };

    /* Letters only, in order. Spaces / hyphens / apostrophes / punctuation
       are ignored when building the fishbone carve path. */
    PS.fishboneLetters = function (word) {
        return (String(word == null ? '' : word).match(/[A-Za-z]/g) || []);
    };

    /* Merge New Vocab and Dictation Master rows. Both columns are required,
       English is deduped case-insensitively (first row wins). */
    PS.buildFishboneBank = function (input) {
        const o = input || {};
        const seen = {};
        const out = [];
        [o.newVocab, o.dictation].forEach(function (list) {
            (Array.isArray(list) ? list : []).forEach(function (row) {
                const en = String(row && row.en != null ? row.en : '').trim();
                const zh = String(row && row.zh != null ? row.zh : '').trim();
                if (!en || !zh) return;
                const key = en.toLowerCase();
                if (seen[key]) return;
                seen[key] = true;
                out.push({ en: en, zh: zh });
            });
        });
        return out;
    };

    PS.buildFishboneItem = function (word, seed) {
        const en = String(word && word.en != null ? word.en : (typeof word === 'string' ? word : '')).trim();
        const zh = String(word && word.zh != null ? word.zh : '').trim();
        const units = PS.fishboneLetters(en);
        return {
            id: 'fishbone:' + (seed == null ? 1 : seed) + ':' + en.toLowerCase(),
            pattern: 'fishbone',
            mode: 'letters',
            prompt: zh,
            target: en,
            units: units,
            tiles: [],
            accept: en ? [en] : [],
            topic: ''
        };
    };

    function stripQuestionPrefix(text) {
        return String(text == null ? '' : text)
            .replace(/^\s*\d+\.\s*(?:gap-?fill|choose)\s*:\s*/i, '')
            .trim();
    }

    PS.buildPawItem = function (question, seed) {
        const q = question || {};
        const answer = String(q.primary != null ? q.primary : (q.a != null ? q.a : (q.answer != null ? q.answer : ''))).trim();
        const prompt = stripQuestionPrefix(q.prompt != null ? q.prompt : (q.q != null ? q.q : ''));
        const units = PS.dalgonaTokenize(answer);
        const optionTiles = Array.isArray(q.options) ? q.options.map(function (x) { return String(x).trim(); }).filter(Boolean) : [];
        const tiles = units.slice();
        if (units.length === 1) {
            optionTiles.forEach(function (opt) {
                if (!tiles.some(function (t) { return t.toLowerCase() === opt.toLowerCase(); })) tiles.push(opt);
            });
        }
        PS.shuffleInPlace(tiles, PS.mulberry32(coerceSeed('paw-tiles:' + (seed == null ? 1 : seed) + ':' + answer)));
        return {
            id: 'paw:' + (q.id != null ? q.id : (seed == null ? 1 : seed)),
            pattern: 'paw',
            mode: 'blocks',
            prompt: prompt,
            target: answer,
            units: units,
            tiles: tiles,
            accept: answer ? [answer] : [],
            topic: String(q.topic || q.sheet || q.section || ''),
            options: optionTiles
        };
    };

    PS.buildCrownItem = function (question, seed) {
        const q = question || {};
        const answer = String(q.a != null ? q.a : (q.primary != null ? q.primary : '')).trim();
        const units = PS.dalgonaTokenize(answer);
        const tiles = units.slice();
        PS.shuffleInPlace(tiles, PS.mulberry32(coerceSeed('crown-tiles:' + (q.id != null ? q.id : (seed == null ? 1 : seed)))));
        const accept = Array.isArray(q.accept) && q.accept.length
            ? q.accept.map(function (s) { return String(s).trim(); }).filter(Boolean)
            : (answer ? [answer] : []);
        return {
            id: 'crown:' + (q.id != null ? q.id : (seed == null ? 1 : seed)),
            source_id: q.id != null ? Number(q.id) : null,
            pattern: 'crown',
            mode: 'blocks',
            prompt: String(q.q != null ? q.q : (q.prompt != null ? q.prompt : '')).trim(),
            target: answer,
            units: units,
            tiles: tiles,
            accept: accept,
            topic: 'participle_phrases'
        };
    };

    /* Seeded, roughly even mix of the three patterns among the living tug
       winners. Stable by user_id; a demo that jumps straight to Round 4
       simply uses the living players. */
    PS.assignDalgonaPatterns = function (players, seed) {
        const living = (Array.isArray(players) ? players : []).filter(function (p) {
            if (!p || p.is_playing === false || p.ghost === true) return false;
            const status = String(p.status || 'alive');
            return status !== 'eliminated' && status !== 'out' && status !== 'ghost';
        }).sort(function (a, b) {
            return PS.userKey(a) < PS.userKey(b) ? -1 : (PS.userKey(a) > PS.userKey(b) ? 1 : 0);
        });
        const winners = living.filter(function (p) { return p.advanced_round3 === true; });
        const base = winners.length ? winners : living;
        const rng = PS.mulberry32(coerceSeed('dalgona-patterns:' + (seed == null ? 1 : seed)));
        const offset = Math.floor(rng() * PS.ROUND4.PATTERNS.length);
        return base.map(function (p, i) {
            return {
                user_id: PS.userKey(p),
                pattern: PS.ROUND4.PATTERNS[(offset + i) % PS.ROUND4.PATTERNS.length]
            };
        });
    };

    function dalgonaDeck(items, pattern) {
        const deck = (Array.isArray(items) ? items : []).filter(function (it) {
            return it && Array.isArray(it.units) && it.units.length;
        });
        if (pattern === 'crown') {
            return deck.sort(function (a, b) { return b.units.length - a.units.length; });
        }
        if (pattern === 'paw') {
            return deck.sort(function (a, b) {
                return Math.abs(a.units.length - 10) - Math.abs(b.units.length - 10);
            });
        }
        return deck.sort(function (a, b) { return a.units.length - b.units.length; });
    }

    /* Assign one unused item per player. Decks run longest-first for the
       crown (harder patterns get longer items), medium for the paw and
       shortest-first for the fishbone. If a bank is short the deck wraps,
       re-shuffled, so the order stays varied but deterministic. */
    PS.buildDalgonaAssignments = function (input) {
        const o = input || {};
        const seed = o.seed == null ? 1 : o.seed;
        const rows = PS.assignDalgonaPatterns(o.players, seed);
        const pawItems = (Array.isArray(o.pawQuestions) ? o.pawQuestions : []).map(function (q, i) {
            return PS.buildPawItem(q, coerceSeed(seed + ':paw:' + i));
        });
        const pawPool = uniqueTexts(pawItems.map(function (it) { return it.target; }));
        pawItems.forEach(function (it) {
            if (it.units.length !== 1) return;
            if (it.tiles.length >= 2) return;
            const extras = pawPool.filter(function (t) {
                return t.toLowerCase() !== it.target.toLowerCase();
            }).slice(0, 3);
            it.tiles = [it.target].concat(extras);
            PS.shuffleInPlace(it.tiles, PS.mulberry32(coerceSeed('paw-single:' + it.id + ':' + seed)));
        });
        const decks = {
            fishbone: dalgonaDeck((Array.isArray(o.fishboneWords) ? o.fishboneWords : []).map(function (w, i) {
                return PS.buildFishboneItem(w, coerceSeed(seed + ':' + i));
            }), 'fishbone'),
            paw: dalgonaDeck(pawItems, 'paw'),
            crown: dalgonaDeck((Array.isArray(o.crownQuestions) ? o.crownQuestions : []).map(function (q, i) {
                return PS.buildCrownItem(q, coerceSeed(seed + ':crown:' + i));
            }), 'crown')
        };
        const cursor = { fishbone: 0, paw: 0, crown: 0 };
        const rng = PS.mulberry32(coerceSeed('dalgona-pick:' + seed));
        return rows.map(function (row) {
            const deck = decks[row.pattern] || [];
            if (!deck.length) return null;
            if (cursor[row.pattern] >= deck.length) {
                cursor[row.pattern] = 0;
                PS.shuffleInPlace(deck, rng);
            }
            const item = deck[cursor[row.pattern]++];
            return {
                user_id: row.user_id,
                pattern: row.pattern,
                prompt: item.prompt,
                target: item.target,
                units: item.units.slice(),
                tiles: (item.tiles || []).slice(),
                accept: (item.accept || []).slice(),
                topic: item.topic || '',
                item: Object.assign({}, item, {
                    units: item.units.slice(),
                    tiles: (item.tiles || []).slice(),
                    accept: (item.accept || []).slice()
                }),
                progress: 0,
                cracks: 0,
                lickUsed: false,
                status: 'carving',
                finishedAt: null
            };
        }).filter(Boolean);
    };

    /* Accepts a live player row (dalgona_* columns) or a plain demo state. */
    PS.normalizeDalgonaState = function (playerOrState) {
        const raw = playerOrState || {};
        const item = raw.item || (raw.dalgona_item && typeof raw.dalgona_item === 'object' ? raw.dalgona_item : null);
        const pattern = String(raw.dalgona_pattern || raw.pattern || (item && item.pattern) || '');
        const units = Array.isArray(raw.dalgona_units) ? raw.dalgona_units.slice()
            : (Array.isArray(raw.units) ? raw.units.slice()
                : (Array.isArray(item && item.units) ? item.units.slice() : []));
        const num = function (v, fallback) {
            const n = Number(v);
            return isFinite(n) ? n : fallback;
        };
        let progress = num(raw.dalgona_progress != null ? raw.dalgona_progress : raw.progress, 0);
        progress = Math.max(0, Math.floor(progress));
        if (units.length) progress = Math.min(units.length, progress);
        const cracks = Math.max(0, Math.floor(num(raw.dalgona_cracks != null ? raw.dalgona_cracks : raw.cracks, 0)));
        const lickUsed = (raw.dalgona_lick_used != null ? raw.dalgona_lick_used : raw.lickUsed) === true;
        const finishedRaw = raw.dalgona_finished_at != null ? raw.dalgona_finished_at : raw.finishedAt;
        const finishedAt = finishedRaw == null || finishedRaw === '' ? null : finishedRaw;
        const complete = !!finishedAt || (units.length > 0 && progress >= units.length);
        let status = 'carving';
        if (complete) status = 'finished';
        else if (cracks >= PS.ROUND4.CRACKS_TO_BREAK) status = 'shattered';
        else if (cracks > 0) status = 'danger';
        return {
            pattern: pattern,
            units: units,
            target: String(raw.target || (item && item.target) || ''),
            prompt: String(raw.prompt || (item && item.prompt) || ''),
            tiles: Array.isArray(raw.tiles) ? raw.tiles.slice() : (Array.isArray(item && item.tiles) ? item.tiles.slice() : []),
            accept: Array.isArray(raw.accept) ? raw.accept.slice() : (Array.isArray(item && item.accept) ? item.accept.slice() : []),
            topic: String(raw.topic || (item && item.topic) || ''),
            progress: complete ? Math.max(progress, units.length) : progress,
            cracks: cracks,
            lickUsed: lickUsed,
            status: status,
            finishedAt: finishedAt
        };
    };

    PS.dalgonaNextUnit = function (state) {
        const st = PS.normalizeDalgonaState(state);
        if (st.status === 'finished' || st.status === 'shattered') return null;
        return st.units[st.progress] == null ? null : String(st.units[st.progress]);
    };

    function dalgonaSameUnit(expected, value) {
        return String(expected == null ? '' : expected).trim().toLowerCase()
            === String(value == null ? '' : value).trim().toLowerCase();
    }

    /* Apply one letter / block. Returns the engine's decision plus a new
       state object; the caller persists progress / cracks / finishedAt. */
    PS.dalgonaApplyInput = function (state, unitValue, opts) {
        const o = opts || {};
        const current = PS.normalizeDalgonaState(state);
        if (current.status === 'finished' || current.status === 'shattered') {
            return {
                ok: false, correct: false, ignored: true, state: current,
                finished: current.status === 'finished', eliminated: current.status === 'shattered', crack: false
            };
        }
        /* Crown-cat items may list more than one official combined sentence
           in `accept`. The word tiles are built from the first sentence, but
           a complete alternative sentence is still accepted. */
        const acceptList = (current.accept || []).map(function (s) { return String(s).trim().toLowerCase(); });
        const candidate = o.assembled != null
            ? String(o.assembled).trim().toLowerCase()
            : (current.progress === 0 ? String(unitValue == null ? '' : unitValue).trim().toLowerCase() : '');
        if (candidate && acceptList.indexOf(candidate) !== -1) {
            const won = PS.normalizeDalgonaState(current);
            won.progress = won.units.length;
            won.status = 'finished';
            won.finishedAt = o.now != null ? o.now : (current.finishedAt == null ? true : current.finishedAt);
            return {
                ok: true, correct: true, acceptedSentence: true, state: won,
                finished: true, eliminated: false, crack: false
            };
        }
        const expected = current.units[current.progress];
        if (expected == null) {
            return { ok: false, correct: false, ignored: true, state: current, finished: false, eliminated: false, crack: false };
        }
        const next = PS.normalizeDalgonaState(current);
        if (dalgonaSameUnit(expected, unitValue)) {
            next.progress = current.progress + 1;
            const complete = next.progress >= next.units.length;
            if (complete) {
                next.status = 'finished';
                next.finishedAt = o.now != null ? o.now : (current.finishedAt == null ? true : current.finishedAt);
            }
            return {
                ok: true, correct: true, expected: String(expected), state: next,
                finished: complete, eliminated: false, crack: false
            };
        }
        next.cracks = current.cracks + 1;
        next.status = next.cracks >= PS.ROUND4.CRACKS_TO_BREAK ? 'shattered' : 'danger';
        return {
            ok: true, correct: false, expected: String(expected), state: next,
            finished: false, eliminated: next.status === 'shattered', crack: true
        };
    };

    /* One lick per player per round: fills the next correct unit without a
       crack. No unit left → not consumed. */
    PS.dalgonaLick = function (state, opts) {
        const o = opts || {};
        const current = PS.normalizeDalgonaState(state);
        if (current.lickUsed || current.status === 'finished' || current.status === 'shattered') {
            return { applied: false, ok: false, state: current, finished: false, eliminated: false };
        }
        const expected = current.units[current.progress];
        if (expected == null) {
            return { applied: false, ok: false, state: current, finished: false, eliminated: false };
        }
        const next = PS.normalizeDalgonaState(current);
        next.lickUsed = true;
        next.progress = current.progress + 1;
        const complete = next.progress >= next.units.length;
        if (complete) {
            next.status = 'finished';
            next.finishedAt = o.now != null ? o.now : (current.finishedAt == null ? true : current.finishedAt);
        }
        return {
            applied: true, ok: true, correct: true, unit: String(expected), state: next,
            finished: complete, eliminated: false
        };
    };

    /* Host / projector board rows. Same order and fields the client list
       and the SQL mirror use: finished first, then carvers by progress,
       then shattered / non-carvers. */
    PS.teacherRound4Board = function (players, opts) {
        const o = opts || {};
        const list = (Array.isArray(players) ? players : []).filter(function (p) {
            if (!p || p.is_playing === false) return false;
            /* Only the Round 4 carvers (the tug winners) and students who
               were eliminated by this candy belong on the host grid. */
            const reason = String(p.eliminated_reason || '');
            return p.advanced_round3 === true
                || p.dalgona_finished_at != null
                || reason === 'dalgona' || reason === 'dalgona_timeout';
        });
        const rows = list.map(function (p) {
            const st = PS.normalizeDalgonaState(p);
            const total = st.units.length || Number(o.total) || 0;
            const finished = st.status === 'finished';
            const shattered = st.status === 'shattered' || !st.pattern;
            const timedOut = !finished && String(p.eliminated_reason || '') === 'dalgona_timeout';
            const status = finished ? 'Finished'
                : (shattered ? 'Shattered'
                    : (timedOut ? 'Out'
                        : (st.status === 'danger' ? 'Danger' : (st.pattern ? 'Carving' : 'Watching'))));
            return {
                user_id: PS.userKey(p),
                name: PS.playerName(p),
                pattern: st.pattern,
                pattern_label: PS.dalgonaPatternLabel(st.pattern),
                progress: st.progress,
                total: total,
                cracks: st.cracks,
                status: status,
                status_key: finished ? 'finished' : (shattered ? 'shattered' : (st.status === 'danger' ? 'danger' : 'carving')),
                detail: st.pattern ? (st.progress + ' / ' + total) : '—',
                finished_at: st.finishedAt,
                near: !finished && !shattered && total > 0 && st.progress >= total - 3,
                team: '',
                combo: 0,
                distance: PS.round1Distance(p),
                step: 0
            };
        });
        rows.sort(function (a, b) {
            const rank = function (r) {
                if (r.status_key === 'finished') return 0;
                if (r.status_key === 'shattered' || !r.pattern) return 2;
                return 1;
            };
            const ra = rank(a);
            const rb = rank(b);
            if (ra !== rb) return ra - rb;
            if (ra === 1 && a.progress !== b.progress) return b.progress - a.progress;
            if (ra === 0) {
                const ta = PS.timeValue(a.finished_at);
                const tb = PS.timeValue(b.finished_at);
                if (ta !== tb) return ta < tb ? -1 : 1;
            }
            return a.user_id < b.user_id ? -1 : (a.user_id > b.user_id ? 1 : 0);
        });
        return rows.map(function (row, i) {
            row.place = i + 1;
            return row;
        });
    };

    /* Mini official-sheet bank for the public demo when the vendored Q251+
       file is unavailable. Ids match the official sheet. */
    PS.DEMO_COMBINING = [
        { id: 251, q: 'She was anxious about the oral exam. She rehearsed her answers on the way to school.', a: 'Being anxious about the oral exam, she rehearsed her answers on the way to school.', accept: ['Being anxious about the oral exam, she rehearsed her answers on the way to school.', 'Feeling anxious about the oral exam, she rehearsed her answers on the way to school.'] },
        { id: 252, q: 'When he stepped off the tram, he noticed a wallet on the seat.', a: 'Stepping off the tram, he noticed a wallet on the seat.', accept: ['Stepping off the tram, he noticed a wallet on the seat.'] },
        { id: 253, q: 'If the herbs are stored in a dry cupboard, they keep their flavour for months.', a: 'Stored in a dry cupboard, the herbs keep their flavour for months.', accept: ['Stored in a dry cupboard, the herbs keep their flavour for months.'] },
        { id: 254, q: 'He did not want to spoil the surprise. He hid the tickets in a drawer.', a: 'Not wanting to spoil the surprise, he hid the tickets in a drawer.', accept: ['Not wanting to spoil the surprise, he hid the tickets in a drawer.'] }
    ];

    /* ------------------------------------------------------------------ */
    /* Prize ceremony — ranking + Paws                                     */
    /*                                                                    */
    /* This is the single source of truth for the end-of-class ceremony.  */
    /* It only reads fields the game already stores, so the SQL mirror can */
    /* reproduce exactly the same order and amounts.                       */
    /* ------------------------------------------------------------------ */

    PS.pawsForPlace = function (place, survived) {
        const n = Math.floor(Number(place) || 0);
        if (n === 1) return PS.CEREMONY_PAWS.first;
        if (n === 2) return PS.CEREMONY_PAWS.second;
        if (n === 3) return PS.CEREMONY_PAWS.third;
        return survived ? PS.CEREMONY_PAWS.survivor : PS.CEREMONY_PAWS.participant;
    };

    function ceremonyRankValue(value) {
        if (value == null || value === '') return Infinity;
        const n = Number(value);
        return isFinite(n) ? n : Infinity;
    }

    function ceremonyTimeValue(value) {
        return PS.timeValue(value);
    }

    function ceremonyNickname(player) {
        const nickname = String((player && player.nickname) || '').trim();
        if (nickname) return nickname;
        const email = String((player && player.email) || '').trim();
        if (email) return email.split('@')[0];
        return 'Player';
    }

    function compareCeremonyUser(a, b) {
        const ua = PS.userKey(a);
        const ub = PS.userKey(b);
        return ua < ub ? -1 : (ua > ub ? 1 : 0);
    }

    function ceremonyRole(place, survived) {
        if (place === 1) return 'first';
        if (place === 2) return 'second';
        if (place === 3) return 'third';
        return survived ? 'survivor' : 'participant';
    }

    function round1Survivor(player) {
        if (!player) return false;
        if (player.ghost === true) return false;
        const status = String(player.status || 'alive');
        return status !== 'eliminated' && status !== 'out' && status !== 'ghost';
    }

    function round2Survivor(player) {
        if (!player) return false;
        return player.crossed_glass === true || String(player.status || '') === 'advanced';
    }

    PS.ceremonyResults = function (players, opts) {
        const o = opts || {};
        const roundCount = PS.roomRoundCount({ roundCount: o.roundCount == null ? PS.HOST.DEFAULT_ROUNDS : o.roundCount });
        const finishDistance = o.finishDistance == null ? PS.ROUND1.FINISH_DISTANCE : Number(o.finishDistance);
        const tug = PS.normalizeTugState(o.tug);
        const winner = tug.winner === 'red' || tug.winner === 'blue' ? tug.winner : '';
        const eligible = (Array.isArray(players) ? players : []).filter(p => p && p.is_playing !== false);
        let survivedOf = round1Survivor;

        const ordered = eligible.slice().sort((a, b) => {
            if (roundCount >= 4) {
                /* Round 4 ranking: carvers who finished first (by finish
                   time), then still-carving / danger by progress desc, then
                   shattered / non-players. */
                const dg = (p) => PS.normalizeDalgonaState(p);
                const carver = (p) => p.advanced_round3 === true
                    || p.dalgona_finished_at != null
                    || String(p.eliminated_reason || '') === 'dalgona'
                    || String(p.eliminated_reason || '') === 'dalgona_timeout';
                const bucket = (p) => {
                    const st = dg(p);
                    if (st.status === 'finished') return 0;
                    return carver(p) ? 1 : 2;
                };
                const sa = dg(a);
                const sb = dg(b);
                const fa = bucket(a);
                const fb = bucket(b);
                if (fa !== fb) return fa - fb;
                if (fa === 0) {
                    const ta = ceremonyTimeValue(sa.finishedAt != null ? sa.finishedAt : a.dalgona_finished_at);
                    const tb = ceremonyTimeValue(sb.finishedAt != null ? sb.finishedAt : b.dalgona_finished_at);
                    if (ta !== tb) return ta < tb ? -1 : 1;
                    return compareCeremonyUser(a, b);
                }
                if (sa.progress !== sb.progress) return sb.progress - sa.progress;
                const ta = ceremonyTimeValue(a.glass_finished_at != null ? a.glass_finished_at : a.glass_finished_at_ms);
                const tb = ceremonyTimeValue(b.glass_finished_at != null ? b.glass_finished_at : b.glass_finished_at_ms);
                if (ta !== tb) return ta < tb ? -1 : 1;
                const ra = ceremonyRankValue(a.round1_rank);
                const rb = ceremonyRankValue(b.round1_rank);
                if (ra !== rb) return ra < rb ? -1 : 1;
                return compareCeremonyUser(a, b);
            }

            if (roundCount >= 3) {
                const groupOf = (p) => {
                    if (winner) {
                        if (p.tug_team === winner) return 0;
                        if (p.tug_team === 'red' || p.tug_team === 'blue') return 1;
                        return 2;
                    }
                    return round2Survivor(p) ? 0 : 1;
                };
                const ga = groupOf(a);
                const gb = groupOf(b);
                if (ga !== gb) return ga - gb;
                const ta = ceremonyTimeValue(a.glass_finished_at != null ? a.glass_finished_at : a.glass_finished_at_ms);
                const tb = ceremonyTimeValue(b.glass_finished_at != null ? b.glass_finished_at : b.glass_finished_at_ms);
                if (ta !== tb) return ta < tb ? -1 : 1;
                const ra = ceremonyRankValue(a.round1_rank);
                const rb = ceremonyRankValue(b.round1_rank);
                if (ra !== rb) return ra < rb ? -1 : 1;
                return compareCeremonyUser(a, b);
            }

            if (roundCount === 2) {
                const sa = round2Survivor(a) ? 0 : 1;
                const sb = round2Survivor(b) ? 0 : 1;
                if (sa !== sb) return sa - sb;
                if (sa === 0) {
                    const ta = ceremonyTimeValue(a.glass_finished_at != null ? a.glass_finished_at : a.glass_finished_at_ms);
                    const tb = ceremonyTimeValue(b.glass_finished_at != null ? b.glass_finished_at : b.glass_finished_at_ms);
                    if (ta !== tb) return ta < tb ? -1 : 1;
                    const ra = ceremonyRankValue(a.round1_rank);
                    const rb = ceremonyRankValue(b.round1_rank);
                    if (ra !== rb) return ra < rb ? -1 : 1;
                    return compareCeremonyUser(a, b);
                }
                const gsa = Number(a.glass_step) || 0;
                const gsb = Number(b.glass_step) || 0;
                if (gsa !== gsb) return gsb - gsa;
                const ra = ceremonyRankValue(a.round1_rank);
                const rb = ceremonyRankValue(b.round1_rank);
                if (ra !== rb) return ra < rb ? -1 : 1;
                const da = PS.round1Distance(a);
                const db = PS.round1Distance(b);
                if (da !== db) return db - da;
                return compareCeremonyUser(a, b);
            }

            const sa = round1Survivor(a) ? 0 : 1;
            const sb = round1Survivor(b) ? 0 : 1;
            if (sa !== sb) return sa - sb;
            if (sa === 0) {
                const fa = PS.isRound1Finished(a, finishDistance) ? 0 : 1;
                const fb = PS.isRound1Finished(b, finishDistance) ? 0 : 1;
                if (fa !== fb) return fa - fb;
                const ta = ceremonyTimeValue(a.finished_at != null ? a.finished_at : a.finished_at_ms);
                const tb = ceremonyTimeValue(b.finished_at != null ? b.finished_at : b.finished_at_ms);
                if (ta !== tb) return ta < tb ? -1 : 1;
            }
            const da = PS.round1Distance(a);
            const db = PS.round1Distance(b);
            if (da !== db) return db - da;
            return compareCeremonyUser(a, b);
        });

        if (roundCount >= 4) {
            survivedOf = function (p) {
                return PS.normalizeDalgonaState(p).status === 'finished';
            };
        } else {
            survivedOf = roundCount >= 3
                ? function (p) {
                    if (winner) return p.tug_team === winner;
                    return round2Survivor(p);
                }
                : (roundCount === 2 ? round2Survivor : round1Survivor);
        }

        return ordered.map((player, index) => {
            const place = index + 1;
            const survived = survivedOf(player) === true;
            const rounds = {
                r1: {
                    distance: PS.round1Distance(player),
                    reached_finish: PS.isRound1Finished(player, finishDistance),
                    finished_at: player.finished_at != null ? player.finished_at : null,
                    round1_rank: player.round1_rank == null ? null : Number(player.round1_rank),
                    eliminated: !round1Survivor(player),
                    eliminated_reason: player.eliminated_reason || null
                }
            };
            if (roundCount >= 2) {
                rounds.r2 = {
                    glass_step: Number(player.glass_step) || 0,
                    glass_finished_at: player.glass_finished_at != null ? player.glass_finished_at : null,
                    crossed_glass: player.crossed_glass === true || String(player.status || '') === 'advanced'
                };
            }
            if (roundCount >= 3) {
                rounds.r3 = {
                    tug_team: player.tug_team === 'red' || player.tug_team === 'blue' ? player.tug_team : null,
                    won: winner ? player.tug_team === winner : null
                };
            }
            if (roundCount >= 4) {
                const dg = PS.normalizeDalgonaState(player);
                rounds.r4 = {
                    pattern: dg.pattern || null,
                    progress: dg.progress,
                    cracks: dg.cracks,
                    finished_at: dg.finishedAt != null ? dg.finishedAt : null,
                    status: dg.status
                };
            }
            return {
                place: place,
                user_id: PS.userKey(player),
                nickname: ceremonyNickname(player),
                paws: PS.pawsForPlace(place, survived),
                role: ceremonyRole(place, survived),
                survived: survived,
                rounds: rounds
            };
        });
    };

    /* --- Idempotent award helpers (mirrors the SQL ledger insert) ------ */

    PS.ceremonyAwardPlan = function (results, roomId) {
        const prefix = 'purrfect_survival:' + String(roomId == null ? '' : roomId) + ':';
        return (Array.isArray(results) ? results : [])
            .filter(r => r && r.user_id)
            .map(r => ({
                user_id: String(r.user_id),
                amount: Math.max(0, Number(r.paws) || 0),
                reason: 'purrfect_survival',
                ref_key: prefix + String(r.user_id)
            }))
            .filter(a => a.amount > 0);
    };

    /* Applies a plan into a fake ledger keyed by user_id + '|' + ref_key.
       A second call for the same room/user is a no-op, exactly like the
       `on conflict (user_id, ref_key) do nothing` SQL clause. */
    PS.applyCeremonyAwards = function (plan, ledger) {
        const store = ledger || {};
        const added = [];
        (Array.isArray(plan) ? plan : []).forEach(award => {
            if (!award || !award.user_id || !award.ref_key) return;
            const key = award.user_id + '|' + award.ref_key;
            if (store[key]) return;
            store[key] = {
                user_id: award.user_id,
                amount: Number(award.amount) || 0,
                reason: award.reason || 'purrfect_survival',
                ref_key: award.ref_key
            };
            added.push(store[key]);
        });
        return added;
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
       One subject per demo paper: subject defaults to vocab; grammar is
       used only when explicitly requested. Every builder receives the same
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

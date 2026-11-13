/* LearniTY Dictation — Drive & Go! Mario Kart-style grammar racing game.
   This file owns the pre-race flow (topic → challenge → cat → controls →
   question count → course), the Google-Sheets question bank for both topics
   (Tenses: tenses / Passives; Agreement: Agreement), same-verb tense
   distractors, Agreement Gap-fill / Choose gates, local preferences and
   shared helpers. The canvas race engine lives in drive-and-go-race.js and
   the realtime 2–5 player lobby/race sync lives in
   drive-and-go-multiplayer.js.
   All three files are classic scripts: no modules, no defer/async. */

const DG = {
    SETTINGS_KEY: 'learniTY_dg_settings',
    BEST_SCORE_KEY: 'learniTY_dg_best_score',
    BEST_DISTANCE_KEY: 'learniTY_dg_best_distance',
    BEST_RUNS_KEY: 'learniTY_dg_best_runs',
    // Two topics share one Drive & Go! tile. `TAB_FOR_MODE` stays the Tenses
    // map so existing tests and cached links keep working; the Agreement tab
    // is case-sensitive and lives on its own.
    TOPICS: ['tenses', 'agreement'],
    TOPIC_LABEL: { tenses: 'Tenses', agreement: 'Agreement' },
    MODES_FOR_TOPIC: {
        tenses: ['av', 'pv', 'mixed'],
        agreement: ['gapfill', 'choose', 'mixed']
    },
    AGREEMENT_TAB: 'Agreement',
    TAB_FOR_MODE: { av: ['tenses'], pv: ['Passives'], mixed: ['tenses', 'Passives'] },
    MODE_LABEL: { av: 'Active Voice (AV)', pv: 'Passive Voice (PV)', mixed: 'Mixed' },
    MODE_SHORT: { av: 'AV', pv: 'PV', mixed: 'Mixed' },
    AGREEMENT_MODE_LABEL: { gapfill: 'Gap-fill', choose: 'Choose', mixed: 'Mixed' },
    AGREEMENT_MODE_SHORT: { gapfill: 'Gap-fill', choose: 'Choose', mixed: 'Mixed' },
    QUESTION_COUNTS: [20, 25, 30, 35, 40, 50],
    // Three playable courses. The exact ids / names are stored in Supabase
    // (drive_and_go_rooms.scene) and remembered in learniTY_dg_settings.
    SCENES: ['desert', 'stadium', 'jungle'],
    SCENE_LABEL: { desert: 'Desert Hills', stadium: 'Peach Stadium', jungle: 'Dino Dino Jungle' },
    SCENE_EMOJI: { desert: '🏜️', stadium: '🏟️', jungle: '🦕' },
    SCENE_FLAVOUR: {
        desert: 'Pale-gold dunes, cactus and sun-bleached rocks.',
        stadium: 'Peach grandstands, floodlights and painted kerbs.',
        jungle: 'Humid canopy, palms and friendly dinosaurs.'
    },
    // Race constants shared by the engine and the tests.
    NITRO_KMH: 40,
    SPIN_TIME: 1.5,
    GATE_GAP: 420,
    START_GATE_DIST: 320,
    FINISH_DISTANCE: 4200,
    RACE_SECONDS: 180,
    // Hold-to-speed: +110 km/h while ACCEL is held, hard-capped so stacked
    // nitro / mushroom / star bonuses cannot run away.
    ACCEL_KMH: 110,
    SPEED_CAP: 340,
    // Analog tilt: a soft deadzone so a resting phone does not wander, and
    // full left / right at 12° of lean. 12° (instead of the old 16°) means a
    // normal wrist lean crosses into the next lane at ~7°, so tilt actually
    // steers on a phone instead of only drifting a little.
    TILT_DEAD: 1.5,
    TILT_FULL: 12,
    // Lane tracking speed for analog tilt (snappier than the old discrete 12).
    TILT_LERP: 18,
    // Time bonus factor used by DG.timeBonus / DG.scoreRun (see those helpers).
    TIME_BONUS_FACTOR: 4000,
    CATS: ['Ginger', 'Ragdoll', 'Black', 'Siamese'],
    GLASSES: ['None', 'Sunglasses', 'Glasses'],
    HATS: ['None', 'Party Hat', 'Crown'],
    OUTFITS: ['None', 'Red Scarf', 'Racing Jacket', 'Superhero Cape', 'Gentleman Bowtie', 'Sports Vest', 'Pink Floral Scarf'],
    ITEM_EMOJI: { banana: '🍌', star: '⭐', redshell: '🔴', lightning: '⚡', mushroom: '🍄' },
    ITEM_NAME: { banana: 'Banana', star: 'Star', redshell: 'Red shell', lightning: 'Lightning', mushroom: 'Mushroom' },
    ITEM_HELP: {
        banana: 'Throws a peel backwards. A racer behind you spins out for 1.5s.',
        star: '6s invincibility + 5s boost. Earned with 6 correct answers in a row.',
        redshell: 'Fires at the racer ahead. They burst a tyre for 2s. Earned when you are not 1st.',
        lightning: 'Slows every rival for 4.5s and shrinks their question text. Earned on a challenging question.',
        mushroom: '3s speed burst. Earned with 3 correct answers in a row.'
    },
    bankCache: {},
    bankPoolCache: {},
    // Raw gviz CSV per tab. The Agreement tab is fetched once and filtered
    // into gapfill / choose / mixed, instead of three network requests.
    sheetCache: {},
    settings: null,
    // Pre-race flow. The very first question is Solo or Multiplayer; Solo and
    // a multiplayer host then pick the topic (Tenses / Agreement), then the
    // challenge. The old "Game mode" step at the end is gone. sessionMode is
    // '' until the player picks, 'solo' or 'multi'. mpRole is 'create'
    // (host) or 'join'.
    menuStep: 'session',
    sessionMode: '',
    mpRole: '',
    // Teacher-only 30-player room. Set by chooseMultiRole('class'); create
    // then calls create_drive_and_go_class_room instead of the 5-player RPC.
    mpClassRoom: false,
    tiltPermission: 'unknown',

    /* ---------------- preferences ---------------- */

    defaultSettings() {
        return { topic: 'tenses', bankMode: 'av', cat: 'Ginger', glasses: 'None', hat: 'None', outfit: 'None', controls: 'tilt', questionCount: 20, scene: 'desert' };
    },

    normalizeTopic(value) {
        const id = String(value == null ? '' : value).trim().toLowerCase();
        return DG.TOPICS.indexOf(id) !== -1 ? id : 'tenses';
    },

    // A challenge type is only valid for its own topic. `mixed` is shared.
    // Legacy / missing values fall back to AV for Tenses and Gap-fill for
    // Agreement.
    normalizeBankMode(topic, mode) {
        const t = DG.normalizeTopic(topic);
        const id = String(mode == null ? '' : mode).trim().toLowerCase();
        const list = DG.MODES_FOR_TOPIC[t] || DG.MODES_FOR_TOPIC.tenses;
        if (list.indexOf(id) !== -1) return id;
        return t === 'agreement' ? 'gapfill' : 'av';
    },

    topicLabel(value) {
        return DG.TOPIC_LABEL[DG.normalizeTopic(value)];
    },

    modeLabel(topic, mode) {
        const t = DG.normalizeTopic(topic);
        const id = DG.normalizeBankMode(t, mode);
        if (t === 'agreement') return DG.AGREEMENT_MODE_LABEL[id];
        return DG.MODE_LABEL[id];
    },

    modeShort(topic, mode) {
        const t = DG.normalizeTopic(topic);
        const id = DG.normalizeBankMode(t, mode);
        if (t === 'agreement') return DG.AGREEMENT_MODE_SHORT[id];
        return DG.MODE_SHORT[id];
    },

    // Short topic-aware challenge label used by boards / lobby / results,
    // e.g. "Tenses · PV" or "Agreement · Gap-fill".
    challengeShort(topic, mode) {
        return DG.topicLabel(topic) + ' · ' + DG.modeShort(topic, mode);
    },

    topicChallenge(topic, mode) {
        return DG.challengeShort(topic, mode);
    },

    // The exact gviz tab(s) for a topic + challenge. Tenses keeps its
    // existing map; Agreement always uses the single case-sensitive tab.
    tabsFor(topic, mode) {
        if (DG.normalizeTopic(topic) === 'agreement') return [DG.AGREEMENT_TAB];
        return DG.TAB_FOR_MODE[DG.normalizeBankMode(topic, mode)] || [];
    },

    // Cache key: mixed must never overwrite the other topic's mixed bank.
    bankKey(topic, mode) {
        const t = DG.normalizeTopic(topic);
        return t + ':' + DG.normalizeBankMode(t, mode);
    },

    normalizeQuestionCount(value) {
        const n = Number(value);
        return DG.QUESTION_COUNTS.indexOf(n) !== -1 ? n : 20;
    },

    normalizeScene(value) {
        const id = String(value == null ? '' : value).trim().toLowerCase();
        return DG.SCENES.indexOf(id) !== -1 ? id : 'desert';
    },

    sceneLabel(value) {
        return DG.SCENE_LABEL[DG.normalizeScene(value)];
    },

    /* Analog tilt helpers, shared by the race engine and the unit tests.
       delta is degrees, already wrapped to [-180, 180]. The result is a
       fractional lane position: 0 = hard left, 1 = centre, 2 = hard right.
       A soft deadzone (±TILT_DEAD) keeps a resting phone from wandering;
       full lock arrives at ±TILT_FULL (12°). The smoothstep curve makes small
       leans gentle, while a normal ~7° wrist lean already crosses into the
       next lane. Holding a lean keeps the kart in that lane. */
    tiltLaneTarget(delta) {
        const d = Number(delta);
        if (!isFinite(d)) return 1;
        const mag = Math.abs(d);
        if (mag <= DG.TILT_DEAD) return 1;
        const t = Math.max(0, Math.min(1, (mag - DG.TILT_DEAD) / (DG.TILT_FULL - DG.TILT_DEAD)));
        const eased = t * t * (3 - 2 * t);
        return d < 0 ? 1 - eased : 1 + eased;
    },

    /* Clamp + round a fractional lane position to 0, 1 or 2. */
    nearestLane(laneX) {
        const v = Number(laneX);
        if (!isFinite(v)) return 1;
        return Math.round(Math.max(0, Math.min(2, v)));
    },

    /* Advance the kart's lane one frame. This is the single authoritative
       steering step, shared by updateRace() and the unit tests.

       state = { lane, laneX } where lane is the discrete target (button /
       key / swipe) and laneX is the on-screen position.

       tiltTarget == null  → discrete mode: laneX chases `lane`, and `lane`
                             is NEVER overwritten from laneX. Overwriting it
                             every frame was the PR #26 bug that snapped the
                             kart straight back to the centre before it could
                             reach the next lane, so buttons / keys / swipes
                             appeared dead.
       tiltTarget = 0..2   → analog tilt: laneX chases the lean, and `lane`
                             follows the actual position so gates are judged
                             where the kart really is. */
    laneStep(state, dt, tiltTarget) {
        const st = state || {};
        const secs = Math.max(0, Number(dt) || 0);
        const lane = DG.nearestLane(st.lane);
        let laneX = Number(st.laneX);
        if (!isFinite(laneX)) laneX = lane;
        const tilt = (tiltTarget == null) ? null : Number(tiltTarget);
        if (tilt == null || !isFinite(tilt)) {
            laneX += (lane - laneX) * Math.min(1, secs * 12);
            if (Math.abs(lane - laneX) < 0.002) laneX = lane;
            return { lane, laneX };
        }
        const target = Math.max(0, Math.min(2, tilt));
        laneX += (target - laneX) * Math.min(1, secs * (DG.TILT_LERP || 18));
        if (Math.abs(target - laneX) < 0.002) laneX = target;
        return { lane: DG.nearestLane(laneX), laneX };
    },

    readSettings() {
        if (DG.settings) return DG.settings;
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(DG.SETTINGS_KEY) || 'null'); } catch (e) { saved = null; }
        DG.settings = Object.assign(DG.defaultSettings(), DG.normalizeLook(saved || {}));
        DG.settings.topic = DG.normalizeTopic(saved && saved.topic);
        DG.settings.bankMode = DG.normalizeBankMode(DG.settings.topic, saved && saved.bankMode);
        if (saved && ['tilt', 'swipe', 'buttons'].indexOf(saved.controls) !== -1) DG.settings.controls = saved.controls;
        DG.settings.questionCount = DG.normalizeQuestionCount(saved && saved.questionCount);
        DG.settings.scene = DG.normalizeScene(saved && saved.scene);
        DG.rememberLook(DG.settings);
        return DG.settings;
    },

    saveSettings() {
        try { localStorage.setItem(DG.SETTINGS_KEY, JSON.stringify(DG.readSettings())); } catch (e) {}
    },

    rememberLook(look) {
        const s = DG.readSettings();
        s.cat = look.cat; s.glasses = look.glasses; s.hat = look.hat; s.outfit = look.outfit;
        DG.saveSettings();
        return s;
    },

    normalizeLook(raw) {
        const pick = (value, list, fallback) => list.indexOf(value) !== -1 ? value : fallback;
        return {
            cat: pick(raw && raw.cat, DG.CATS, 'Ginger'),
            glasses: pick(raw && raw.glasses, DG.GLASSES, 'None'),
            hat: pick(raw && raw.hat, DG.HATS, 'None'),
            outfit: pick(raw && raw.outfit, DG.OUTFITS, 'None')
        };
    },

    currentLook() {
        const s = DG.readSettings();
        return { cat: s.cat, glasses: s.glasses, hat: s.hat, outfit: s.outfit };
    },

    /* ---------------- CSV / question bank ---------------- */

    parseCSVLine(line) {
        const out = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (c === ',' && !inQuotes) {
                out.push(cur);
                cur = '';
            } else {
                cur += c;
            }
        }
        out.push(cur);
        return out.map(s => s.trim());
    },

    answerVariants(raw) {
        return String(raw || '').split('/').map(s => s.trim()).filter(Boolean);
    },

    normAnswer(raw) {
        return String(raw || '')
            .replace(/[\u2018\u2019\u201B`\u00B4]/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    },

    // "1. Gap-fill: ..." / "2. Choose: ..." (case-insensitive). Returns
    // 'gapfill' / 'choose' / '' so the Agreement tab can skip rows without a
    // recognisable type prefix instead of guessing.
    parseQuestionType(question) {
        const m = /^\d+[.)]\s*(Gap-fill|Choose)\s*:\s*/i.exec(String(question || ''));
        if (!m) return '';
        return /^gap-?fill$/i.test(m[1]) ? 'gapfill' : 'choose';
    },

    // Trailing slash-separated options on a Choose prompt, e.g. "(is / are)".
    // Gap-fill's "(leave)" hint has only one part and is therefore ignored.
    chooseOptions(prompt) {
        const m = /\(([^)]*)\)\s*$/.exec(String(prompt || ''));
        if (!m) return [];
        const parts = m[1].split('/').map(s => s.trim()).filter(Boolean);
        return parts.length >= 2 ? parts : [];
    },

    stripQuestionPrefix(prompt) {
        return String(prompt || '')
            .replace(/^\d+[.)]\s*/, '')
            .replace(/^(?:Gap-fill|Choose)\s*:\s*/i, '')
            .trim();
    },

    /* Parse one gviz CSV tab. The sheet uses:
       - a header row ("Question (Column A)", "Answer (Column B)")
       - section heading rows (A = tense name, B empty)
       - "Challenging" heading rows (questions after it are challenging)
       - question rows (A = numbered sentence with ____, B = answer(s)).
       The Agreement tab prefixes each question with "Gap-fill:" or
       "Choose:"; the Tenses / Passives tabs do not and must keep working
       exactly as before. */
    parseQuestionSheet(csvText, sheetName) {
        const questions = [];
        const bySection = {};
        const bySheet = [];
        const lines = String(csvText || '').split(/\r?\n/);
        let section = 'General';
        let challenging = false;
        const agreementSheet = String(sheetName || '') === DG.AGREEMENT_TAB;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            const parts = DG.parseCSVLine(line);
            const question = (parts[0] || '').trim();
            const answer = (parts[1] || '').trim();
            if (!question && !answer) continue;
            if (i === 0 && !answer && /^question\b/i.test(question)) continue;
            if (!answer) {
                if (/^challenging$/i.test(question)) challenging = true;
                else if (question) { section = question; challenging = false; }
                continue;
            }
            if (!question || !/^\d+[.)]/.test(question) || question.indexOf('____') === -1) continue;
            const qType = DG.parseQuestionType(question);
            // On the Agreement tab a numbered row without "Gap-fill:" or
            // "Choose:" is not a question we can trust.
            if (agreementSheet && !qType) continue;
            const variants = DG.answerVariants(answer);
            if (!variants.length) continue;
            const hintMatch = /\(([^)]*)\)/.exec(question);
            const hintRaw = hintMatch ? hintMatch[1].trim() : '';
            const hint = hintRaw.split('/').pop().trim().replace(/^not\s+/i, '');
            const sectionKey = sheetName + '|' + section;
            const q = {
                id: sheetName + ':' + questions.length,
                sheet: sheetName,
                section,
                sectionKey,
                challenging,
                prompt: question,
                answerRaw: answer,
                variants,
                primary: variants[0],
                hint,
                hintRaw,
                qType: qType,
                options: qType === 'choose' ? DG.chooseOptions(question) : []
            };
            questions.push(q);
            bySheet.push({ primary: q.primary, variants, item: q });
            if (!bySection[sectionKey]) bySection[sectionKey] = [];
            bySection[sectionKey].push({ primary: q.primary, variants, item: q });
        }
        return { questions, bySection, bySheet };
    },

    // Agreement + challenge filtering. Mixed keeps both types.
    filterAgreementQuestions(questions, mode) {
        const list = Array.isArray(questions) ? questions : [];
        const m = DG.normalizeBankMode('agreement', mode);
        if (m === 'gapfill') return list.filter(q => q && q.qType === 'gapfill');
        if (m === 'choose') return list.filter(q => q && q.qType === 'choose');
        return list.filter(q => q && (q.qType === 'gapfill' || q.qType === 'choose'));
    },

    loadBank(topic, mode, force) {
        const t = DG.normalizeTopic(topic);
        const m = DG.normalizeBankMode(t, mode);
        const tabs = DG.tabsFor(t, m);
        if (!tabs || !tabs.length) return Promise.reject(new Error('Unknown challenge mode: ' + mode));
        const key = DG.bankKey(t, m);
        if (!force && DG.bankCache[key] && DG.bankCache[key].length) return Promise.resolve(DG.bankCache[key]);
        const sections = {};
        const sheets = {};
        let all = [];
        let chain = Promise.resolve();
        tabs.forEach(tab => {
            chain = chain.then(() => {
                const cached = !force && DG.sheetCache[tab];
                const textPromise = cached
                    ? Promise.resolve(cached)
                    : fetch('https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID +
                        '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(tab), { credentials: 'omit' })
                        .then(response => {
                            if (!response.ok) throw new Error('The "' + tab + '" tab returned HTTP ' + response.status + '.');
                            return response.text();
                        })
                        .then(text => {
                            DG.sheetCache[tab] = text;
                            return text;
                        });
                return textPromise.then(text => {
                    const parsed = DG.parseQuestionSheet(text, tab);
                    if (t === 'agreement') {
                        const filtered = DG.filterAgreementQuestions(parsed.questions, m);
                        parsed.questions = filtered;
                        parsed.bySection = {};
                        parsed.bySheet = [];
                        filtered.forEach(q => {
                            parsed.bySheet.push({ primary: q.primary, variants: q.variants, item: q });
                            if (!parsed.bySection[q.sectionKey]) parsed.bySection[q.sectionKey] = [];
                            parsed.bySection[q.sectionKey].push({ primary: q.primary, variants: q.variants, item: q });
                        });
                    }
                    if (!parsed.questions.length) throw new Error('The "' + tab + '" tab has no usable questions.');
                    Object.keys(parsed.bySection).forEach(k => { sections[k] = parsed.bySection[k]; });
                    sheets[tab] = parsed.bySheet;
                    all = all.concat(parsed.questions);
                });
            });
        });
        return chain.then(() => {
            if (!all.length) throw new Error('The question bank is empty.');
            DG.bankCache[key] = all;
            DG.bankPoolCache[key] = { bySection: sections, bySheet: sheets };
            return all;
        });
    },

    makeRng(seed) {
        let a = (Number(seed) || 1) >>> 0;
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    },

    hashString(text) {
        let h = 2166136261;
        const s = String(text || '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    },

    shuffleInPlace(list, rng) {
        const rnd = rng || Math.random;
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
        }
        return list;
    },

    /* ---------------- same-verb tense conjugator ---------------- */

    // Compact irregular table for common sheet verbs. Regular verbs use the
    // helpers below (-s / -ed / -ing / past participle).
    VERB_IRREGULAR: {
        be: { special: 'be', s: 'is', past: 'was', pp: 'been', ing: 'being' },
        have: { s: 'has', past: 'had', pp: 'had', ing: 'having' },
        do: { s: 'does', past: 'did', pp: 'done', ing: 'doing' },
        go: { s: 'goes', past: 'went', pp: 'gone', ing: 'going' },
        write: { past: 'wrote', pp: 'written' },
        leave: { past: 'left', pp: 'left' },
        see: { past: 'saw', pp: 'seen' },
        take: { past: 'took', pp: 'taken' },
        come: { past: 'came', pp: 'come', ing: 'coming' },
        make: { past: 'made', pp: 'made' },
        get: { past: 'got', pp: 'got' },
        give: { past: 'gave', pp: 'given' },
        find: { past: 'found', pp: 'found' },
        think: { past: 'thought', pp: 'thought' },
        know: { past: 'knew', pp: 'known' },
        say: { s: 'says', past: 'said', pp: 'said' },
        tell: { past: 'told', pp: 'told' },
        become: { past: 'became', pp: 'become' },
        begin: { past: 'began', pp: 'begun' },
        break: { past: 'broke', pp: 'broken' },
        bring: { past: 'brought', pp: 'brought' },
        build: { past: 'built', pp: 'built' },
        buy: { past: 'bought', pp: 'bought' },
        catch: { past: 'caught', pp: 'caught' },
        choose: { past: 'chose', pp: 'chosen' },
        cut: { past: 'cut', pp: 'cut' },
        draw: { past: 'drew', pp: 'drawn' },
        drink: { past: 'drank', pp: 'drunk' },
        drive: { past: 'drove', pp: 'driven' },
        eat: { past: 'ate', pp: 'eaten' },
        fall: { past: 'fell', pp: 'fallen' },
        feel: { past: 'felt', pp: 'felt' },
        fight: { past: 'fought', pp: 'fought' },
        forget: { past: 'forgot', pp: 'forgotten' },
        grow: { past: 'grew', pp: 'grown' },
        hear: { past: 'heard', pp: 'heard' },
        hold: { past: 'held', pp: 'held' },
        keep: { past: 'kept', pp: 'kept' },
        lose: { past: 'lost', pp: 'lost' },
        meet: { past: 'met', pp: 'met' },
        pay: { past: 'paid', pp: 'paid' },
        put: { past: 'put', pp: 'put' },
        read: { past: 'read', pp: 'read' },
        ride: { past: 'rode', pp: 'ridden' },
        rise: { past: 'rose', pp: 'risen' },
        run: { past: 'ran', pp: 'run' },
        sell: { past: 'sold', pp: 'sold' },
        send: { past: 'sent', pp: 'sent' },
        set: { past: 'set', pp: 'set' },
        show: { past: 'showed', pp: 'shown' },
        shut: { past: 'shut', pp: 'shut' },
        sing: { past: 'sang', pp: 'sung' },
        sit: { past: 'sat', pp: 'sat' },
        sleep: { past: 'slept', pp: 'slept' },
        speak: { past: 'spoke', pp: 'spoken' },
        spend: { past: 'spent', pp: 'spent' },
        stand: { past: 'stood', pp: 'stood' },
        steal: { past: 'stole', pp: 'stolen' },
        swim: { past: 'swam', pp: 'swum' },
        teach: { past: 'taught', pp: 'taught' },
        throw: { past: 'threw', pp: 'thrown' },
        understand: { past: 'understood', pp: 'understood' },
        wear: { past: 'wore', pp: 'worn' },
        win: { past: 'won', pp: 'won' },
        broadcast: { past: 'broadcast', pp: 'broadcast' },
        beat: { past: 'beat', pp: 'beaten' },
        bite: { past: 'bit', pp: 'bitten' },
        blow: { past: 'blew', pp: 'blown' },
        cost: { past: 'cost', pp: 'cost' },
        deal: { past: 'dealt', pp: 'dealt' },
        feed: { past: 'fed', pp: 'fed' },
        fly: { s: 'flies', past: 'flew', pp: 'flown', ing: 'flying' },
        forgive: { past: 'forgave', pp: 'forgiven' },
        freeze: { past: 'froze', pp: 'frozen' },
        hang: { past: 'hung', pp: 'hung' },
        hide: { past: 'hid', pp: 'hidden' },
        hit: { past: 'hit', pp: 'hit' },
        hurt: { past: 'hurt', pp: 'hurt' },
        lay: { past: 'laid', pp: 'laid' },
        lead: { past: 'led', pp: 'led' },
        lend: { past: 'lent', pp: 'lent' },
        let: { past: 'let', pp: 'let' },
        lie: { past: 'lay', pp: 'lain', ing: 'lying' },
        light: { past: 'lit', pp: 'lit' },
        mean: { past: 'meant', pp: 'meant' },
        quit: { past: 'quit', pp: 'quit' },
        ring: { past: 'rang', pp: 'rung' },
        shake: { past: 'shook', pp: 'shaken' },
        shine: { past: 'shone', pp: 'shone' },
        shoot: { past: 'shot', pp: 'shot' },
        shrink: { past: 'shrank', pp: 'shrunk' },
        sink: { past: 'sank', pp: 'sunk' },
        slide: { past: 'slid', pp: 'slid' },
        spit: { past: 'spat', pp: 'spat' },
        split: { past: 'split', pp: 'split' },
        spread: { past: 'spread', pp: 'spread' },
        stick: { past: 'stuck', pp: 'stuck' },
        strike: { past: 'struck', pp: 'struck' },
        swear: { past: 'swore', pp: 'sworn' },
        sweep: { past: 'swept', pp: 'swept' },
        swing: { past: 'swung', pp: 'swung' },
        tear: { past: 'tore', pp: 'torn' },
        wake: { past: 'woke', pp: 'woken' },
        weep: { past: 'wept', pp: 'wept' },
        withdraw: { past: 'withdrew', pp: 'withdrawn' },
        bear: { past: 'bore', pp: 'born' },
        bend: { past: 'bent', pp: 'bent' },
        bind: { past: 'bound', pp: 'bound' },
        bleed: { past: 'bled', pp: 'bled' },
        burst: { past: 'burst', pp: 'burst' },
        cast: { past: 'cast', pp: 'cast' },
        cling: { past: 'clung', pp: 'clung' },
        creep: { past: 'crept', pp: 'crept' },
        dig: { past: 'dug', pp: 'dug' },
        dream: { past: 'dreamt', pp: 'dreamt' },
        flee: { past: 'fled', pp: 'fled' },
        grind: { past: 'ground', pp: 'ground' },
        kneel: { past: 'knelt', pp: 'knelt' },
        lean: { past: 'leant', pp: 'leant' },
        leap: { past: 'leapt', pp: 'leapt' },
        learn: { past: 'learnt', pp: 'learnt' },
        mistake: { past: 'mistook', pp: 'mistaken' },
        overcome: { past: 'overcame', pp: 'overcome' },
        rewrite: { past: 'rewrote', pp: 'rewritten' },
        seek: { past: 'sought', pp: 'sought' },
        sew: { past: 'sewed', pp: 'sewn' },
        shed: { past: 'shed', pp: 'shed' },
        smell: { past: 'smelt', pp: 'smelt' },
        spell: { past: 'spelt', pp: 'spelt' },
        spill: { past: 'spilt', pp: 'spilt' },
        spin: { past: 'spun', pp: 'spun' },
        spoil: { past: 'spoilt', pp: 'spoilt' },
        spring: { past: 'sprang', pp: 'sprung' },
        sting: { past: 'stung', pp: 'stung' },
        swell: { past: 'swelled', pp: 'swollen' },
        undergo: { s: 'undergoes', past: 'underwent', pp: 'undergone' },
        upset: { past: 'upset', pp: 'upset' },
        weave: { past: 'wove', pp: 'woven' },
        wind: { past: 'wound', pp: 'wound' }
    },

    TENSE_KEYS: [
        'presentSimple', 'pastSimple', 'futureSimple',
        'presentContinuous', 'pastContinuous', 'futureContinuous',
        'presentPerfect', 'pastPerfect', 'futurePerfect'
    ],

    TENSE_NEIGHBORS: {
        presentSimple: ['presentContinuous', 'pastSimple', 'presentPerfect', 'futureSimple', 'pastContinuous', 'pastPerfect', 'futureContinuous', 'futurePerfect'],
        pastSimple: ['presentPerfect', 'pastContinuous', 'pastPerfect', 'presentSimple', 'presentContinuous', 'futureSimple', 'futurePerfect', 'futureContinuous'],
        futureSimple: ['presentSimple', 'futureContinuous', 'futurePerfect', 'presentContinuous', 'pastSimple', 'presentPerfect', 'pastPerfect', 'pastContinuous'],
        presentContinuous: ['presentSimple', 'pastContinuous', 'futureContinuous', 'presentPerfect', 'pastSimple', 'futureSimple', 'pastPerfect', 'futurePerfect'],
        pastContinuous: ['pastSimple', 'presentContinuous', 'pastPerfect', 'presentSimple', 'presentPerfect', 'futureContinuous', 'futureSimple', 'futurePerfect'],
        presentPerfect: ['pastSimple', 'pastPerfect', 'presentSimple', 'presentContinuous', 'futurePerfect', 'pastContinuous', 'futureSimple', 'futureContinuous'],
        pastPerfect: ['pastSimple', 'presentPerfect', 'pastContinuous', 'futurePerfect', 'presentSimple', 'presentContinuous', 'futureSimple', 'futureContinuous'],
        futurePerfect: ['futureSimple', 'presentPerfect', 'pastPerfect', 'futureContinuous', 'pastSimple', 'presentSimple', 'presentContinuous', 'pastContinuous'],
        futureContinuous: ['futureSimple', 'presentContinuous', 'pastContinuous', 'futurePerfect', 'presentSimple', 'pastSimple', 'presentPerfect', 'pastPerfect'],
        modal: ['presentSimple', 'pastSimple', 'futureSimple', 'presentPerfect', 'presentContinuous', 'pastPerfect', 'futurePerfect', 'futureContinuous']
    },

    verbEscapeRe(text) {
        return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    verbDoublesFinal(verb) {
        return /^[^aeiou]*[aeiou][^aeiouwxy]$/i.test(verb);
    },

    verbPresentS(verb) {
        if (/[^aeiou]y$/i.test(verb)) return verb.slice(0, -1) + 'ies';
        if (/(?:s|sh|ch|x|z|o)$/i.test(verb)) return verb + 'es';
        return verb + 's';
    },

    verbIng(verb) {
        if (/ie$/i.test(verb)) return verb.slice(0, -2) + 'ying';
        if (/e$/i.test(verb) && !/(?:ee|oe|ye)$/i.test(verb)) return verb.slice(0, -1) + 'ing';
        if (DG.verbDoublesFinal(verb)) return verb + verb.slice(-1) + 'ing';
        return verb + 'ing';
    },

    verbRegularPast(verb) {
        if (/[^aeiou]y$/i.test(verb)) return verb.slice(0, -1) + 'ied';
        if (/e$/i.test(verb)) return verb + 'd';
        if (DG.verbDoublesFinal(verb)) return verb + verb.slice(-1) + 'ed';
        return verb + 'ed';
    },

    verbParts(lemma) {
        const v = String(lemma || '').toLowerCase().trim();
        const irr = DG.VERB_IRREGULAR[v] || {};
        return {
            lemma: v,
            s: irr.s || DG.verbPresentS(v),
            past: irr.past || DG.verbRegularPast(v),
            pp: irr.pp || irr.past || DG.verbRegularPast(v),
            ing: irr.ing || DG.verbIng(v),
            special: irr.special || ''
        };
    },

    /* Lemma is the last "/" part of the bracket hint, with a leading "not"
       stripped. Negatives come from "not/" or "not " in the hint, or from
       answers such as "doesn't like". */
    parseVerbHint(question) {
        const prompt = String(question && question.prompt || '');
        const hintStored = String(question && (question.hintRaw != null ? question.hintRaw : question.hint) || '');
        const m = /\(([^)]*)\)/.exec(prompt);
        const raw = (m ? m[1] : hintStored).trim();
        const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
        let last = parts.length ? parts[parts.length - 1] : raw;
        last = last.replace(/^not\s+/i, '').trim();
        const lemma = last.toLowerCase();
        const fromHint = /\bnot\b/i.test(raw) || parts.some(p => /^not$/i.test(p));
        const ans = String(question && (question.primary || (question.variants && question.variants[0]) || '') || '');
        const fromAnswer = /n['\u2019]t\b|\bnot\b/i.test(ans);
        return { lemma, negative: fromHint || fromAnswer, hintRaw: raw };
    },

    detectAgreement(question) {
        const prompt = String(question && question.prompt || '').replace(/^\d+[.)]\s*/, '');
        const ans = DG.normAnswer(question && question.primary);
        const subject = prompt.split('____')[0] || '';
        if (/^(are|were|have|do|don'?t|aren'?t|weren'?t|haven'?t)\b/.test(ans)) return { person: 3, number: 'pl' };
        if (/^am\b/.test(ans) || /^I\b/.test(subject)) return { person: 1, number: 'sg' };
        if (/^(is|was|has|does|isn'?t|wasn'?t|hasn'?t|doesn'?t)\b/.test(ans)) return { person: 3, number: 'sg' };
        if (/^You\b/i.test(subject)) return { person: 2, number: 'sg' };
        if (/^(We|They|These|Those)\b/i.test(subject)) return { person: 3, number: 'pl' };
        if (/^(He|She|It|This|That)\b/i.test(subject)) return { person: 3, number: 'sg' };
        if (/\b(and|&)\b/.test(subject) || /\b(people|children|students|teachers|they|we)\b/i.test(subject)) return { person: 3, number: 'pl' };
        if (/\b(is|was|has|does)\b/.test(subject)) return { person: 3, number: 'sg' };
        if (/\b(are|were|have|do)\b/.test(subject)) return { person: 3, number: 'pl' };
        return { person: 3, number: 'sg' };
    },

    verbBePresent(agr) {
        if (agr.person === 1 && agr.number === 'sg') return 'am';
        if (agr.number === 'pl' || agr.person === 2) return 'are';
        return 'is';
    },

    verbBePast(agr) {
        if (agr.number === 'pl' || agr.person === 2) return 'were';
        return 'was';
    },

    verbHaveAux(agr) {
        return (agr.person === 3 && agr.number === 'sg') ? 'has' : 'have';
    },

    verbDoAux(agr) {
        return (agr.person === 3 && agr.number === 'sg') ? 'does' : 'do';
    },

    verbUsesContraction(question) {
        return /n['\u2019]t\b/.test(String(question && question.primary || ''));
    },

    verbNegAux(aux, contracted) {
        if (!contracted) {
            if (aux === 'will') return 'will not';
            if (aux === 'can') return 'cannot';
            if (aux === 'am') return 'am not';
            return aux + ' not';
        }
        const map = {
            am: "I'm not",
            is: "isn't", are: "aren't", was: "wasn't", were: "weren't",
            has: "hasn't", have: "haven't", had: "hadn't",
            do: "don't", does: "doesn't", did: "didn't",
            will: "won't", would: "wouldn't", can: "can't", could: "couldn't",
            must: 'must not', should: "shouldn't", may: 'may not', might: 'might not'
        };
        return map[aux] || (aux + "n't");
    },

    verbWithAux(aux, rest, negative, contracted) {
        const body = rest ? (' ' + rest) : '';
        if (negative) {
            const neg = DG.verbNegAux(aux, contracted);
            // "I'm not writing" already includes the subject pronoun; use "am not".
            if (aux === 'am' && contracted) return "am not" + body;
            return neg + body;
        }
        return aux + body;
    },

    /* Generate active and passive tense forms of one verb, matching the
       person / number / polarity of the correct answer when possible. */
    formsForVerb(lemma, opts) {
        const options = opts || {};
        const parts = DG.verbParts(lemma);
        if (!parts.lemma) return [];
        const agr = options.agreement || { person: 3, number: 'sg' };
        const negative = !!options.negative;
        const contracted = options.contracted !== false;
        const beNow = DG.verbBePresent(agr);
        const bePast = DG.verbBePast(agr);
        const have = DG.verbHaveAux(agr);
        const doAux = DG.verbDoAux(agr);
        const base = parts.lemma;
        const out = [];
        const add = (key, voice, label) => {
            const text = String(label || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            out.push({ key, voice, label: text });
        };

        if (parts.special === 'be') {
            add('presentSimple', 'active', DG.verbWithAux(beNow, '', negative, contracted));
            add('pastSimple', 'active', DG.verbWithAux(bePast, '', negative, contracted));
        } else if (negative) {
            add('presentSimple', 'active', DG.verbWithAux(doAux, base, true, contracted));
            add('pastSimple', 'active', DG.verbWithAux('did', base, true, contracted));
        } else {
            const present = (agr.person === 3 && agr.number === 'sg') ? parts.s : base;
            add('presentSimple', 'active', present);
            add('pastSimple', 'active', parts.past);
        }
        add('futureSimple', 'active', DG.verbWithAux('will', base, negative, contracted));
        add('presentContinuous', 'active', DG.verbWithAux(beNow, parts.ing, negative, contracted));
        add('pastContinuous', 'active', DG.verbWithAux(bePast, parts.ing, negative, contracted));
        add('futureContinuous', 'active', DG.verbWithAux('will', 'be ' + parts.ing, negative, contracted));
        add('presentPerfect', 'active', DG.verbWithAux(have, parts.pp, negative, contracted));
        add('pastPerfect', 'active', DG.verbWithAux('had', parts.pp, negative, contracted));
        add('futurePerfect', 'active', DG.verbWithAux('will', 'have ' + parts.pp, negative, contracted));

        add('presentSimple', 'passive', DG.verbWithAux(beNow, parts.pp, negative, contracted));
        add('pastSimple', 'passive', DG.verbWithAux(bePast, parts.pp, negative, contracted));
        add('futureSimple', 'passive', DG.verbWithAux('will', 'be ' + parts.pp, negative, contracted));
        add('presentContinuous', 'passive', DG.verbWithAux(beNow, 'being ' + parts.pp, negative, contracted));
        add('pastContinuous', 'passive', DG.verbWithAux(bePast, 'being ' + parts.pp, negative, contracted));
        add('presentPerfect', 'passive', DG.verbWithAux(have, 'been ' + parts.pp, negative, contracted));
        add('pastPerfect', 'passive', DG.verbWithAux('had', 'been ' + parts.pp, negative, contracted));
        add('futurePerfect', 'passive', DG.verbWithAux('will', 'have been ' + parts.pp, negative, contracted));

        const modals = ['can', 'must', 'should', 'may', 'could', 'might'];
        for (let i = 0; i < modals.length; i++) {
            add('modal', 'passive', DG.verbWithAux(modals[i], 'be ' + parts.pp, negative, contracted));
        }
        return out;
    },

    classifyAnswer(question, parts) {
        const ans = DG.normAnswer(question && question.primary);
        const pp = DG.verbEscapeRe(parts.pp);
        const ing = DG.verbEscapeRe(parts.ing);
        const voice = (
            new RegExp('\\b(?:be|been|being)\\s+' + pp + '\\s*$').test(ans) ||
            new RegExp('\\b(?:is|are|am|was|were|isn\'t|aren\'t|wasn\'t|weren\'t)\\s+' + pp + '\\s*$').test(ans)
        ) ? 'passive' : 'active';
        let tense = 'presentSimple';
        if (/\b(?:can|could|must|should|may|might|cannot|can'?t)\b/.test(ans) && voice === 'passive') {
            tense = 'modal';
        } else if (/\bwill have been\b/.test(ans) || (voice === 'active' && /\bwill have\b/.test(ans))) {
            tense = 'futurePerfect';
        } else if (voice === 'passive' && /\bwill be\b/.test(ans) && !/\bbeing\b/.test(ans)) {
            tense = 'futureSimple';
        } else if (/\bwill be\b/.test(ans) && new RegExp(ing).test(ans)) {
            tense = 'futureContinuous';
        } else if (/\b(?:will|won'?t)\b/.test(ans)) {
            tense = 'futureSimple';
        } else if (/\bhad been\b/.test(ans) || (voice === 'active' && /\bhad\b/.test(ans))) {
            tense = 'pastPerfect';
        } else if (/\b(?:has|have|hasn'?t|haven'?t) been\b/.test(ans) || (voice === 'active' && /\b(?:has|have|hasn'?t|haven'?t)\b/.test(ans))) {
            tense = 'presentPerfect';
        } else if (/\b(?:is|are|am|isn'?t|aren'?t) being\b/.test(ans)) {
            tense = 'presentContinuous';
        } else if (/\b(?:was|were|wasn'?t|weren'?t) being\b/.test(ans)) {
            tense = 'pastContinuous';
        } else if (new RegExp('\\b(?:is|are|am|isn\'?t|aren\'?t)\\s+' + ing + '\\b').test(ans)) {
            tense = 'presentContinuous';
        } else if (new RegExp('\\b(?:was|were|wasn\'?t|weren\'?t)\\s+' + ing + '\\b').test(ans)) {
            tense = 'pastContinuous';
        } else if (voice === 'passive' && /\b(?:was|were|wasn'?t|weren'?t)\b/.test(ans)) {
            tense = 'pastSimple';
        } else if (voice === 'passive' && /\b(?:is|are|am|isn'?t|aren'?t)\b/.test(ans)) {
            tense = 'presentSimple';
        } else if (/\b(?:did|didn'?t|did not)\b/.test(ans)) {
            tense = 'pastSimple';
        } else if (/\b(?:does|do|doesn'?t|don'?t|does not|do not)\b/.test(ans)) {
            tense = 'presentSimple';
        } else if (ans === DG.normAnswer(parts.past)) {
            tense = 'pastSimple';
        } else if (ans === DG.normAnswer(parts.s) || ans === DG.normAnswer(parts.lemma)) {
            tense = 'presentSimple';
        }
        return { voice, tense };
    },

    /* Pick two other tense forms of the same verb. Stay in the same voice
       when possible (Mixed only crosses voice after that). Prefer confusable
       nearby tenses. */
    distractSameVerb(question, rng) {
        const rnd = rng || Math.random;
        const hint = DG.parseVerbHint(question);
        if (!hint.lemma || hint.lemma === 'not') return [];
        const parts = DG.verbParts(hint.lemma);
        const agr = DG.detectAgreement(question);
        const classified = DG.classifyAnswer(question, parts);
        const contracted = DG.verbUsesContraction(question);
        const forms = DG.formsForVerb(hint.lemma, {
            agreement: agr,
            negative: hint.negative,
            contracted
        });
        const forbidden = new Set((question.variants || []).concat([question.primary]).map(DG.normAnswer).filter(Boolean));
        const seen = new Set(forbidden);
        const usable = [];
        forms.forEach(form => {
            const key = DG.normAnswer(form.label);
            if (!key || seen.has(key)) return;
            seen.add(key);
            usable.push(form);
        });
        const sameVoice = usable.filter(f => f.voice === classified.voice);
        const pool = sameVoice.length >= 2 ? sameVoice : usable;
        const neighbors = DG.TENSE_NEIGHBORS[classified.tense] || DG.TENSE_NEIGHBORS.presentSimple;
        const rank = (form) => {
            const idx = neighbors.indexOf(form.key);
            return (idx === -1 ? 40 : idx) + rnd() * 0.4;
        };
        const ranked = pool.slice().sort((a, b) => rank(a) - rank(b));
        const picked = [];
        const pickedKeys = new Set();
        for (let i = 0; i < ranked.length && picked.length < 2; i++) {
            const key = DG.normAnswer(ranked[i].label);
            if (pickedKeys.has(key)) continue;
            pickedKeys.add(key);
            picked.push(ranked[i].label);
        }
        return picked;
    },

    /* Two wrong gates come from other tense forms of the same verb first.
       Only if conjugation cannot fill two unique forms do we fall back to
       same-section / same-sheet answers, then a tiny filler list. Never
       reuse the correct answer or its slash-alternatives. */
    buildGates(question, sectionPool, sheetPool, rng) {
        const rnd = rng || Math.random;
        const forbidden = new Set((question.variants || []).concat([question.primary]).map(DG.normAnswer).filter(Boolean));
        const chosen = [];
        const takeLabel = (label) => {
            const text = String(label || '').trim();
            const key = DG.normAnswer(text);
            if (!key || forbidden.has(key) || chosen.some(c => DG.normAnswer(c.label) === key)) return false;
            chosen.push({ label: text, score: 1 });
            return true;
        };
        DG.distractSameVerb(question, rnd).forEach(takeLabel);

        const consider = (pool, list) => {
            (pool || []).forEach(entry => {
                const label = String(entry && entry.primary ? entry.primary : entry || '').trim();
                const key = DG.normAnswer(label);
                if (!key || forbidden.has(key) || chosen.some(c => DG.normAnswer(c.label) === key)) return;
                if (list.some(c => DG.normAnswer(c.label) === key)) return;
                list.push({ label, score: DG.answerAffinity(question, label) + rnd() * 0.9 });
            });
        };
        const takeFrom = (list) => {
            const ranked = list.slice().sort((a, b) => b.score - a.score);
            while (chosen.length < 2 && ranked.length) {
                const idx = Math.floor(rnd() * Math.min(ranked.length, 8));
                const item = ranked.splice(idx, 1)[0];
                takeLabel(item.label);
            }
        };
        if (chosen.length < 2) {
            const section = [];
            consider(sectionPool, section);
            takeFrom(section);
        }
        if (chosen.length < 2) {
            const extra = [];
            consider(sheetPool, extra);
            takeFrom(extra);
        }
        if (chosen.length < 2) {
            const fillers = ['is', 'are', 'was', 'were', 'has', 'have', 'had', 'does', 'did', 'will'];
            for (let i = 0; i < fillers.length && chosen.length < 2; i++) takeLabel(fillers[i]);
        }
        const labels = [question.primary, chosen[0].label, chosen[1].label];
        DG.shuffleInPlace(labels, rnd);
        const correctLane = labels.indexOf(question.primary);
        return labels.map((label, lane) => ({ label, lane, correct: lane === correctLane }));
    },

    /* ---------------- Agreement gates ---------------- */

    // Common agreement families. A gap-fill answer that starts with one of
    // these auxiliaries gets the rest of the family as plausible distractors.
    AGREEMENT_AUX_PAIRS: [
        ['is', 'are', 'am', 'was', 'were'],
        ['has', 'have', 'had'],
        ['do', 'does', 'did', "don't", "doesn't", "didn't"],
        ["isn't", "aren't", "wasn't", "weren't"],
        ["hasn't", "haven't", "hadn't"],
        ["doesn't", "don't", "didn't"],
        ['their', 'his or her', 'his', 'her', 'its']
    ],

    /* Agreement/tense cousins of the answer's verb: lemma, 3sg and past are
       exactly the leave / leaves / left set the teacher asked for. */
    agreementForms(question) {
        const q = question || {};
        const out = [];
        const push = (value) => {
            const text = String(value == null ? '' : value).trim();
            if (text) out.push(text);
        };
        const hint = DG.parseVerbHint(q);
        const ans = DG.normAnswer(q.primary);
        const lemma = hint.lemma && hint.lemma !== 'not' ? hint.lemma : '';
        // Auxiliary + participle answers ("is cleaned", "has finished"):
        // swap only the auxiliary so the distractor stays the same verb and
        // the same voice. This comes first for multi-word answers.
        const auxMatch = /^(is|are|am|was|were|has|have|had|do|does|did)\s+(.+)$/.exec(ans);
        if (auxMatch && !/^not\b/i.test(auxMatch[2])) {
            const rest = ' ' + auxMatch[2];
            const be = ['is', 'are', 'am', 'was', 'were'];
            const have = ['has', 'have', 'had'];
            const doAux = ['do', 'does', 'did'];
            let family = doAux;
            if (be.indexOf(auxMatch[1]) !== -1) family = be;
            else if (have.indexOf(auxMatch[1]) !== -1) family = have;
            family.forEach(aux => push(aux + rest));
        }
        // Same-verb forms next: for "don't want" the best distractors are
        // "doesn't want" / "didn't want", not bare "do" / "does". On a Choose
        // prompt the brackets are options, not a verb lemma, so they must not
        // be conjugated into nonsense like "ares".
        const chooseOptions = q.qType === 'choose' && Array.isArray(q.options) && q.options.length >= 2;
        if (lemma && !chooseOptions) {
            const parts = DG.verbParts(lemma);
            if (parts.special === 'be') {
                ['am', 'is', 'are', 'was', 'were', 'being', 'been'].forEach(push);
            } else if (hint.negative) {
                ["doesn't " + parts.lemma, "don't " + parts.lemma, "didn't " + parts.lemma,
                    'does not ' + parts.lemma, 'do not ' + parts.lemma, 'did not ' + parts.lemma].forEach(push);
            } else {
                push(parts.lemma);
                push(parts.s);
                push(parts.past);
                push(parts.ing);
            }
        }
        // Common agreement families for answers that are just an auxiliary
        // (is / are / was / have / do / their ...). Multi-word answers already
        // got their same-verb forms above, so bare auxiliaries would be a
        // weaker distractor than "doesn't want".
        if (ans && (!lemma || ans.indexOf(' ') === -1)) {
            DG.AGREEMENT_AUX_PAIRS.forEach(group => {
                const hit = group.some(a => ans === a || ans.indexOf(a + ' ') === 0 || ans.indexOf(a + "'") === 0);
                if (hit) group.forEach(push);
            });
        }
        return out;
    },

    /* Exactly three gates for an Agreement question.
       - Gap-fill: the correct form + two same-verb agreement / tense cousins,
         then other Agreement-tab answers, then a small filler list.
       - Choose: the options printed in the sentence. Two options get one
         extra plausible gate; three options are used as-is (no fourth).
       Any listed variant marks its gate correct, and no listed variant is
       ever placed on a wrong gate. */
    agreementGates(question, sheetPool, rng) {
        const rnd = rng || Math.random;
        const q = question || {};
        const variantKeys = new Set((q.variants || []).concat([q.primary]).map(DG.normAnswer).filter(Boolean));
        const isVariant = (label) => variantKeys.has(DG.normAnswer(label));
        const hasLabel = (list, label) => {
            const key = DG.normAnswer(label);
            return list.some(l => DG.normAnswer(l) === key);
        };
        const filler = ['is', 'are', 'was', 'were', 'has', 'have', 'do', 'does', "don't", "doesn't"];
        let labels = [];
        const options = Array.isArray(q.options) ? q.options.slice() : [];
        const candidates = DG.agreementForms(q).concat((sheetPool || []).map(entry =>
            String(entry && entry.primary ? entry.primary : entry || '').trim())).concat(filler);

        if (q.qType === 'choose' && options.length >= 2) {
            labels = options.slice();
            if (labels.length > 3) {
                const keep = labels.filter(isVariant).slice(0, 3);
                labels.forEach(l => { if (keep.length < 3 && keep.indexOf(l) === -1) keep.push(l); });
                labels = keep;
            }
            // Two options (or a malformed Choose) need exactly one extra gate.
            // A three-option Choose never gets a fourth.
            if (labels.length === 2) {
                for (let i = 0; i < candidates.length && labels.length < 3; i++) {
                    const cand = candidates[i];
                    const key = DG.normAnswer(cand);
                    if (!key || variantKeys.has(key) || hasLabel(labels, cand)) continue;
                    labels.push(cand);
                }
            }
        } else {
            labels = [q.primary];
            for (let i = 0; i < candidates.length && labels.length < 3; i++) {
                const cand = candidates[i];
                const key = DG.normAnswer(cand);
                if (!key || variantKeys.has(key) || hasLabel(labels, cand)) continue;
                labels.push(cand);
            }
        }

        // Belt and braces: always exactly three unique gates, never a listed
        // variant on a wrong gate.
        for (let i = 0; i < filler.length && labels.length < 3; i++) {
            const cand = filler[i];
            const key = DG.normAnswer(cand);
            if (!key || variantKeys.has(key) || hasLabel(labels, cand)) continue;
            labels.push(cand);
        }
        labels = labels.slice(0, 3);

        DG.shuffleInPlace(labels, rnd);
        return labels.map((label, lane) => ({
            label,
            lane,
            correct: isVariant(label)
        }));
    },

    // The HUD sentence. Tenses is untouched; Agreement strips the bank label
    // ("1. Gap-fill:") and, for Choose, the options that are already on the
    // gates so the sentence does not repeat them.
    displayPrompt(question, gates) {
        const q = question || {};
        const prompt = String(q.prompt || '');
        if (!q.qType) return prompt;
        let text = DG.stripQuestionPrefix(prompt);
        if (q.qType === 'choose') {
            const options = (Array.isArray(q.options) && q.options.length)
                ? q.options
                : DG.chooseOptions(prompt);
            const labels = (gates || []).map(g => DG.normAnswer(g && g.label));
            const allOnGates = options.length > 0 && options.every(o => labels.indexOf(DG.normAnswer(o)) !== -1);
            if (allOnGates) text = text.replace(/\s*\([^)]*\)\s*$/, '');
        }
        return text.trim();
    },

    gateIsCorrect(gates, lane) {
        const wanted = Number(lane);
        return (gates || []).some(g => g && g.correct && Number(g.lane) === wanted);
    },

    correctGateLabels(gates) {
        return (gates || []).filter(g => g && g.correct).map(g => String(g.label));
    },

    answerAffinity(question, label) {
        const correct = DG.normAnswer(question.primary);
        const other = DG.normAnswer(label);
        let score = 0;
        const hint = DG.normAnswer(question.hint);
        if (hint) {
            const stem = hint.replace(/e$/, '');
            if (other.indexOf(hint) !== -1 || hint.indexOf(other) !== -1) score += 8;
            else if (stem.length >= 3 && other.indexOf(stem) !== -1) score += 6;
        }
        const aux = /^(is|are|was|were|has|have|had|will|would|can|could|must|should|may|might|do|does|did)\b/;
        const a1 = aux.exec(correct), a2 = aux.exec(other);
        if (a1 && a2 && a1[1] === a2[1]) score += 4;
        if (/ing\b/.test(correct) && /ing\b/.test(other)) score += 3;
        if (/ed\b/.test(correct) && /ed\b/.test(other)) score += 2;
        if (/\bbeen\b/.test(correct) && /\bbeen\b/.test(other)) score += 2;
        score += Math.max(0, 3 - Math.abs(correct.length - other.length) / 4);
        return score;
    },

    gatesFor(question, topic, mode, rng) {
        const t = DG.normalizeTopic(topic);
        const key = DG.bankKey(t, mode);
        const pools = DG.bankPoolCache[key] || { bySection: {}, bySheet: {} };
        if (t === 'agreement' || (question && question.qType)) {
            return DG.agreementGates(
                question,
                (pools.bySheet && pools.bySheet[question.sheet]) || [],
                rng
            );
        }
        return DG.buildGates(
            question,
            pools.bySection[question.sectionKey] || [],
            (pools.bySheet && pools.bySheet[question.sheet]) || [],
            rng
        );
    },

    raceQuestionQueue(topic, mode, seed) {
        const bank = DG.bankCache[DG.bankKey(topic, mode)] || [];
        const list = bank.slice();
        DG.shuffleInPlace(list, seed == null ? Math.random : DG.makeRng(seed));
        return list;
    },

    /* ---------------- item rules ---------------- */

    /* Pure rule table. Every unlock condition is checked in a stable order so
       a challenging question still gives Lightning even on a 6-combo. */
    itemForCorrect(stats, rng) {
        const s = stats || {};
        if (s.item) return null;
        const rnd = rng || Math.random;
        if (s.challenging) return 'lightning';
        if (s.combo > 0 && s.combo % 6 === 0) return 'star';
        if (s.combo > 0 && s.combo % 3 === 0) return 'mushroom';
        if (s.rank > 1) return 'redshell';
        if (rnd() < 0.35) return 'banana';
        return null;
    },

    /* ---------------- screens / pre-race flow ---------------- */

    /* The ordered steps of the current pre-race flow. The first step is
       always Solo / Multiplayer. Solo then picks a topic (Tenses or
       Agreement) and goes through the settings; the old last "Game mode"
       step is gone. A multiplayer host goes through Create first, then picks
       the topic and every room setting. A joiner only picks a cat and
       controls, then enters the code — topic / challenge / count / course
       belong to the host. */
    flowOrder() {
        if (!DG.sessionMode) return ['session'];
        if (DG.sessionMode === 'solo') {
            return ['session', 'topic', 'challenge', 'cat', 'controls', 'count', 'scene'];
        }
        if (DG.mpRole === 'join') {
            return ['session', 'multi-entry', 'cat', 'controls', 'join'];
        }
        if (DG.mpRole === 'create') {
            return ['session', 'multi-entry', 'topic', 'challenge', 'cat', 'controls', 'count', 'scene'];
        }
        return ['session', 'multi-entry'];
    },

    stepIndex(step) {
        const i = DG.flowOrder().indexOf(step);
        return i === -1 ? 0 : i;
    },

    // Only the host (or a Solo player) may change challenge / question count
    // / course. A joiner follows the host's room settings.
    canEditHostSettings() {
        return !(DG.sessionMode === 'multi' && DG.mpRole === 'join');
    },

    menuContent() {
        return document.getElementById('grammar-detail-content');
    },

    backToTenses() {
        DG.stopRace();
        if (typeof DG.exitRaceFullscreen === 'function') DG.exitRaceFullscreen();
        if (typeof DG.mpStopPoll === 'function') DG.mpAbandon();
        changeView('grammar-revision-view');
    },

    // changeView() calls this for every view change. Keep the race alive only
    // while the dedicated race view is on screen; stop lobby polling when the
    // player navigates away from the grammar detail page.
    onLeaveView(viewId) {
        if (viewId === 'drive-and-go-view') return;
        if (typeof DG.stopRace === 'function') DG.stopRace();
        if (typeof DG.exitRaceFullscreen === 'function') DG.exitRaceFullscreen();
        if (viewId !== 'grammar-detail-view') {
            if (typeof DG.mpStopPoll === 'function') DG.mpStopPoll();
            // A freshly joined racer keeps their seat for a short settle
            // window. Token refreshes or an accidental view change must not
            // call leave_drive_and_go_room and delete their player row, which
            // would make the next poll think they were never in the room.
            const canAbandon = typeof DG.mpCanAbandon !== 'function' || DG.mpCanAbandon();
            if (typeof DG.mpAbandon === 'function' && canAbandon) DG.mpAbandon();
            else if (typeof DG.mpDetachDuringSettle === 'function') DG.mpDetachDuringSettle();
        }
    },

    showLoading(message) {
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        content.innerHTML = '<div class="text-center py-16"><div class="loader mx-auto mb-5"></div>' +
            '<p class="text-xl font-bold text-orange-500">' + DG.esc(message) + '</p></div>';
    },

    showLoadError(topic, mode, err) {
        if (typeof DG.stopMusic === 'function') DG.stopMusic();
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const t = DG.normalizeTopic(topic);
        const label = DG.modeLabel(t, mode);
        content.innerHTML =
            '<div class="text-center mb-6"><div class="text-7xl mb-3">📡</div>' +
            '<h2 class="text-3xl font-bold text-orange-600">Question bank not loaded</h2></div>' +
            '<div class="dg-menu-panel text-center">' +
            '<p class="font-bold text-gray-700 mb-2">Could not load the ' + DG.esc(label) + ' questions from Google Sheets.</p>' +
            '<p class="text-sm text-gray-500 mb-6">' + DG.esc(err && err.message ? err.message : 'Please check your connection and try again.') + '</p>' +
            '<div class="flex gap-3 justify-center flex-wrap">' +
            '<button type="button" class="btn-paw" onclick="DG.retryBank()">Retry</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showTopicStep()">Back</button>' +
            '</div></div>';
    },

    retryBank() {
        const s = DG.readSettings();
        const topic = DG.normalizeTopic(s.topic);
        const mode = DG.normalizeBankMode(topic, s.bankMode);
        DG.showLoading('Loading ' + DG.modeLabel(topic, mode) + ' questions…');
        DG.loadBank(topic, mode, true).then(() => {
            if (DG.menuStep === 'launch') DG.startSingle();
            else DG.showSceneStep();
        }).catch(err => DG.showLoadError(topic, mode, err));
    },

    // The dot rail follows flowOrder(), so Solo shows 7 steps, a multiplayer
    // host 8 (Create comes before the topic and settings) and a joiner 5.
    stepDots(step) {
        const order = DG.flowOrder();
        const activeIndex = Math.max(0, order.indexOf(step));
        const bits = [];
        for (let i = 0; i < order.length; i++) {
            bits.push('<span class="' + (i < activeIndex ? 'done' : (i === activeIndex ? 'active' : '')) + '"></span>');
        }
        return '<div class="dg-step-dots">' + bits.join('') + '</div>';
    },

    stepHeading(step, title) {
        return '<h3 class="text-2xl font-bold text-green-600 text-center mb-4">' +
            (DG.stepIndex(step) + 1) + '. ' + title + '</h3>';
    },

    /* Step 1 — Solo or Multiplayer. This is always the first question after
       the player taps Drive & Go!. */
    showSessionStep() {
        DG.menuStep = 'session';
        DG.sessionMode = '';
        DG.mpRole = '';
        DG.mpClassRoom = false;
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const guest = (typeof isGuestUser === 'function') && isGuestUser();
        const signedIn = (typeof canUseCloud === 'function') && canUseCloud();
        const multiOff = guest || !signedIn;
        const note = guest
            ? '<div class="dg-note warn">Guests can play Single Player only. Sign in with a school Google account for Multiplayer.</div>'
            : (!signedIn
                ? '<div class="dg-note warn">Sign in with your school Google account to open Multiplayer. Single Player works right away.</div>'
                : '');
        content.innerHTML =
            '<div class="text-center mb-6"><div class="text-7xl mb-2">🏎️</div>' +
            '<h2 class="text-4xl font-bold text-orange-600">Drive & Go!</h2>' +
            '<p class="text-gray-500 font-bold mt-2">Read the sentence, steer into the correct gate, and race the track.</p></div>' +
            DG.stepDots('session') +
            DG.stepHeading('session', 'Solo or Multiplayer?') +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">' +
            '<button type="button" class="dg-choice" onclick="DG.chooseSession(\'solo\')">' +
            '<span class="dg-choice-emoji">🏁</span>' +
            '<span class="dg-choice-title">Solo</span>' +
            '<span class="dg-choice-sub">Race on your own. A run ends after your chosen number of correct answers.</span></button>' +
            '<button type="button" class="dg-choice' + (multiOff ? ' opacity-50' : '') + '"' +
            (multiOff ? ' disabled aria-disabled="true"' : ' onclick="DG.chooseSession(\'multi\')"') + '>' +
            '<span class="dg-choice-emoji">🏎️</span>' +
            '<span class="dg-choice-title">Multiplayer</span>' +
            '<span class="dg-choice-sub">' + (multiOff ? 'School account needed — 2–5 players.' : '2–5 players. Create a room or join one with a code.') + '</span></button>' +
            '</div>' +
            note;
    },

    chooseSession(mode) {
        if (mode === 'multi') {
            DG.sessionMode = 'multi';
            if (typeof DG.openMultiplayer === 'function') DG.openMultiplayer();
            return;
        }
        DG.sessionMode = 'solo';
        DG.mpRole = '';
        DG.showTopicStep();
    },

    /* Step 2a — multiplayer Create / Join. The host fills the settings after
       choosing Create; joiners go straight to their cat and controls. */
    showMultiplayerEntryStep() {
        DG.menuStep = 'multi-entry';
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const teacher = (typeof isTeacherAccount === 'function') && isTeacherAccount()
            && !(typeof previewStudentForm === 'function' && previewStudentForm());
        content.innerHTML =
            '<div class="text-center mb-5"><div class="text-7xl mb-2">🏎️</div>' +
            '<h2 class="text-3xl font-bold text-green-600">Multiplayer</h2>' +
            '<p class="text-gray-500 font-bold">2–5 players · the host sets the challenge, the number of questions and the course for everyone.</p></div>' +
            DG.stepDots('multi-entry') +
            DG.stepHeading('multi-entry', 'Create or join a room?') +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">' +
            '<button type="button" class="dg-choice" onclick="DG.chooseMultiRole(\'create\')">' +
            '<span class="dg-choice-emoji">➕</span>' +
            '<span class="dg-choice-title">Create a room</span>' +
            '<span class="dg-choice-sub">You are the host. Pick the challenge, questions and course, then share the code.</span></button>' +
            '<button type="button" class="dg-choice" onclick="DG.chooseMultiRole(\'join\')">' +
            '<span class="dg-choice-emoji">🔑</span>' +
            '<span class="dg-choice-title">Join someone\'s room</span>' +
            '<span class="dg-choice-sub">Enter the host\'s 4-character code. Challenge, questions and course are set by the host.</span></button>' +
            (teacher
                ? '<button type="button" class="dg-choice" onclick="DG.chooseMultiRole(\'class\')">' +
                  '<span class="dg-choice-emoji">👩‍🏫</span>' +
                  '<span class="dg-choice-title">Class room (30 students)</span>' +
                  '<span class="dg-choice-sub">Teacher only. You plus 30 students share one code; you race too and watch the live board.</span></button>'
                : '') +
            '</div>' +
            '<div class="text-center"><button type="button" class="dg-menu-button" onclick="DG.showSessionStep()">← Solo / Multiplayer</button></div>';
    },

    chooseMultiRole(role) {
        DG.sessionMode = 'multi';
        const join = role === 'join';
        DG.mpRole = join ? 'join' : 'create';
        DG.mpClassRoom = role === 'class';
        if (join) DG.showCatStep();
        else DG.showTopicStep();
    },

    /* Topic step — after Solo, or after Create for a host. Joiners follow the
       host and never see it. Tenses keeps AV / PV / Mixed; Agreement gets
       Gap-fill / Choose / Mixed from the single Agreement tab. */
    showTopicStep() {
        DG.menuStep = 'topic';
        if (!DG.canEditHostSettings()) {
            DG.showCatStep();
            return;
        }
        const s = DG.readSettings();
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const card = (topic, emoji, title, sub) => {
            const active = s.topic === topic ? ' active' : '';
            return '<button type="button" class="dg-choice' + active + '" onclick="DG.setTopic(\'' + topic + '\')">' +
                '<span class="dg-choice-emoji">' + emoji + '</span>' +
                '<span class="dg-choice-title">' + title + '</span>' +
                '<span class="dg-choice-sub">' + sub + '</span></button>';
        };
        const back = (DG.sessionMode === 'multi' && DG.mpRole === 'create')
            ? 'DG.showMultiplayerEntryStep()' : 'DG.showSessionStep()';
        content.innerHTML =
            '<div class="text-center mb-6"><div class="text-7xl mb-2">🏎️</div>' +
            '<h2 class="text-4xl font-bold text-orange-600">Drive & Go!</h2>' +
            '<p class="text-gray-500 font-bold mt-2">Pick a topic, then steer into the correct gate.</p></div>' +
            DG.stepDots('topic') +
            DG.stepHeading('topic', 'Choose your topic') +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">' +
            card('tenses', '⏳', 'Tenses', 'Active voice, passive voice or both') +
            card('agreement', '🤝', 'Agreement', 'Gap-fill, Choose, or both from the Agreement bank') +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="' + back + '">← Back</button>' +
            '<button type="button" class="btn-paw" onclick="DG.showChallengeStep()">Next: Challenge →</button></div>';
    },

    setTopic(topic) {
        if (!DG.canEditHostSettings()) return;
        const t = DG.normalizeTopic(topic);
        if (DG.TOPICS.indexOf(t) === -1) return;
        const s = DG.readSettings();
        s.topic = t;
        // Switching topic invalidates the other topic's challenge type.
        s.bankMode = DG.normalizeBankMode(t, s.bankMode);
        DG.saveSettings();
        DG.showTopicStep();
    },

    showChallengeStep() {
        DG.menuStep = 'challenge';
        const s = DG.readSettings();
        const topic = DG.normalizeTopic(s.topic);
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const card = (mode, emoji, title, sub) => {
            const active = s.bankMode === mode ? ' active' : '';
            return '<button type="button" class="dg-choice' + active + '" onclick="DG.setBankMode(\'' + mode + '\')">' +
                '<span class="dg-choice-emoji">' + emoji + '</span>' +
                '<span class="dg-choice-title">' + title + '</span>' +
                '<span class="dg-choice-sub">' + sub + '</span></button>';
        };
        const cards = topic === 'agreement'
            ? (card('gapfill', '✏️', 'Gap-fill', 'Complete the sentence with the right form') +
               card('choose', '✅', 'Choose', 'Pick the correct option from the sentence') +
               card('mixed', '🌈', 'Mixed', 'Gap-fill and Choose shuffled together'))
            : (card('av', '🟢', 'Active Voice', 'AV — tenses tab') +
               card('pv', '🔵', 'Passive Voice', 'PV — Passives tab') +
               card('mixed', '🌈', 'Mixed', 'Both tabs shuffled together'));
        content.innerHTML =
            '<div class="text-center mb-6"><div class="text-7xl mb-2">🏎️</div>' +
            '<h2 class="text-4xl font-bold text-orange-600">Drive & Go!</h2>' +
            '<p class="text-gray-500 font-bold mt-2">Topic: ' + DG.esc(DG.topicLabel(topic)) + '</p></div>' +
            DG.stepDots('challenge') +
            DG.stepHeading('challenge', 'Choose your challenge') +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">' +
            cards +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showTopicStep()">← Topic</button>' +
            '<button type="button" class="btn-paw" onclick="DG.showCatStep()">Next: Cat driver →</button></div>';
    },

    setBankMode(mode) {
        if (!DG.canEditHostSettings()) return;
        const s = DG.readSettings();
        const next = DG.normalizeBankMode(s.topic, mode);
        if (DG.MODES_FOR_TOPIC[DG.normalizeTopic(s.topic)].indexOf(String(mode).toLowerCase()) === -1) return;
        s.bankMode = next;
        DG.saveSettings();
        DG.showChallengeStep();
    },

    showCatStep() {
        DG.menuStep = 'cat';
        const s = DG.readSettings();
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const row = (label, key, options, current) => {
            return '<div class="mb-4"><p class="font-bold text-gray-600 mb-2">' + label + '</p><div class="flex flex-wrap gap-2">' +
                options.map(opt => '<button type="button" class="dg-chip' + (opt === current ? ' active' : '') +
                    '" onclick="DG.setLook(\'' + key + '\',\'' + DG.esc(opt).replace(/'/g, '&#39;') + '\')">' + DG.esc(opt) + '</button>').join('') +
                '</div></div>';
        };
        content.innerHTML =
            DG.stepDots('cat') +
            DG.stepHeading('cat', 'Customize your cat driver') +
            '<div class="dg-preview-wrap"><canvas id="dg-cat-preview" width="520" height="400" aria-label="Cat driver preview"></canvas></div>' +
            row('Cat', 'cat', DG.CATS, s.cat) +
            row('Glasses', 'glasses', DG.GLASSES, s.glasses) +
            row('Hat', 'hat', DG.HATS, s.hat) +
            row('Outfit', 'outfit', DG.OUTFITS, s.outfit) +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="' +
            ((DG.sessionMode === 'multi' && DG.mpRole === 'join') ? 'DG.showMultiplayerEntryStep()' : 'DG.showChallengeStep()') +
            '">← Back</button>' +
            '<button type="button" class="btn-paw" onclick="DG.showControlsStep()">Next: Controls →</button></div>';
        requestAnimationFrame(() => DG.renderCatPreview());
    },

    setLook(key, value) {
        if (['cat', 'glasses', 'hat', 'outfit'].indexOf(key) === -1) return;
        const s = DG.readSettings();
        s[key] = value;
        DG.saveSettings();
        DG.showCatStep();
    },

    renderCatPreview() {
        const canvas = document.getElementById('dg-cat-preview');
        if (!canvas || typeof DG.drawKart !== 'function') return;
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cssW = canvas.clientWidth || 260;
        const cssH = canvas.clientHeight || 200;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const grd = ctx.createLinearGradient(0, 0, 0, cssH);
        grd.addColorStop(0, '#dbeafe');
        grd.addColorStop(1, '#fef3c7');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.fillStyle = 'rgba(120,113,108,.22)';
        ctx.beginPath();
        ctx.ellipse(cssW / 2, cssH * 0.86, cssW * 0.28, cssH * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        DG.drawKart(ctx, cssW / 2, cssH * 0.82, Math.min(cssW / 250, cssH / 190), DG.currentLook(), { preview: true });
    },

    showControlsStep() {
        DG.menuStep = 'controls';
        const s = DG.readSettings();
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const card = (value, emoji, title, sub) => {
            const active = s.controls === value ? ' active' : '';
            return '<button type="button" class="dg-choice' + active + '" onclick="DG.chooseControls(\'' + value + '\')">' +
                '<span class="dg-choice-emoji">' + emoji + '</span>' +
                '<span class="dg-choice-title">' + title + '</span>' +
                '<span class="dg-choice-sub">' + sub + '</span></button>';
        };
        const note = DG.tiltPermission === 'denied'
            ? '<div class="dg-note warn">Tilt permission was denied or no motion sensor was found. The LEFT / CENTER / RIGHT buttons will be used instead.</div>'
            : (DG.tiltPermission === 'granted'
                ? '<div class="dg-note ok">Tilt is ready. Hold your phone level when the race starts.</div>' : '');
        content.innerHTML =
            DG.stepDots('controls') +
            DG.stepHeading('controls', 'Choose your controls') +
            '<p class="text-center text-gray-500 font-bold mb-2">Tilt is recommended on a phone. Buttons always stay on screen as a backup.</p>' +
            '<p class="text-center text-gray-400 text-sm font-bold mb-4">📱 Turn your phone sideways for a wider track. Tap ⛶ during the race for full screen — on iPhone, add this page to your Home Screen to hide the browser bar.</p>' +
            note +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">' +
            card('tilt', '📱', 'Tilt (recommended)', 'Lean left / right to steer — lean further for the next lane') +
            card('swipe', '👆', 'Swipe', 'Swipe left or right on the track') +
            card('buttons', '🔘', 'LEFT / CENTER / RIGHT', 'Tap the on-screen buttons') +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showCatStep()">← Cat</button>' +
            '<button type="button" class="btn-paw" onclick="' +
            ((DG.sessionMode === 'multi' && DG.mpRole === 'join') ? 'DG.showJoinStep()' : 'DG.showCountStep()') +
            '">' + ((DG.sessionMode === 'multi' && DG.mpRole === 'join') ? 'Next: Room code →' : 'Next: Questions →') + '</button></div>';
    },

    chooseControls(value) {
        if (['tilt', 'swipe', 'buttons'].indexOf(value) === -1) return;
        const s = DG.readSettings();
        s.controls = value;
        DG.saveSettings();
        if (value !== 'tilt') {
            DG.showControlsStep();
            return;
        }
        DG.requestTiltPermission().then(ok => {
            DG.tiltPermission = ok ? 'granted' : 'denied';
            if (!ok) {
                DG.readSettings().controls = 'buttons';
                DG.saveSettings();
            }
            DG.showControlsStep();
        });
    },

    requestTiltPermission() {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            return DeviceOrientationEvent.requestPermission().then(res => res === 'granted').catch(() => false);
        }
        return Promise.resolve(typeof window !== 'undefined' && 'DeviceOrientationEvent' in window);
    },

    showCountStep() {
        DG.menuStep = 'count';
        const s = DG.readSettings();
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const cards = DG.QUESTION_COUNTS.map(n => {
            const active = s.questionCount === n ? ' active' : '';
            return '<button type="button" class="dg-choice' + active + '" onclick="DG.setQuestionCount(' + n + ')">' +
                '<span class="dg-choice-title">' + n + '</span>' +
                '<span class="dg-choice-sub">questions</span></button>';
        }).join('');
        content.innerHTML =
            DG.stepDots('count') +
            DG.stepHeading('count', 'How many questions?') +
            '<p class="text-center text-gray-500 font-bold mb-4">A run ends when you get this many answers correct. Wrong answers do not count toward the total.</p>' +
            '<div class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">' + cards + '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showControlsStep()">← Controls</button>' +
            '<button type="button" class="btn-paw" onclick="DG.showSceneStep()">Next: Choose a course →</button></div>';
    },

    setQuestionCount(value) {
        if (!DG.canEditHostSettings()) return;
        const n = DG.normalizeQuestionCount(value);
        DG.readSettings().questionCount = n;
        DG.saveSettings();
        DG.showCountStep();
    },

    showSceneStep() {
        DG.menuStep = 'scene';
        const s = DG.readSettings();
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const cards = DG.SCENES.map(id => {
            const active = DG.normalizeScene(s.scene) === id ? ' active' : '';
            return '<button type="button" class="dg-choice' + active + '" onclick="DG.setScene(\'' + id + '\')">' +
                '<span class="dg-choice-emoji">' + DG.SCENE_EMOJI[id] + '</span>' +
                '<span class="dg-choice-title">' + DG.esc(DG.SCENE_LABEL[id]) + '</span>' +
                '<span class="dg-choice-sub">' + DG.esc(DG.SCENE_FLAVOUR[id]) + '</span></button>';
        }).join('');
        const host = DG.sessionMode === 'multi';
        content.innerHTML =
            DG.stepDots('scene') +
            DG.stepHeading('scene', 'Choose a course') +
            '<p class="text-center text-gray-500 font-bold mb-4">Same track, three different worlds. In multiplayer the host picks the course for everyone.</p>' +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">' + cards + '</div>' +
            (host ? '<div id="dg-mp-status" class="dg-note hidden mb-4"></div>' : '') +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showCountStep()">← Questions</button>' +
            (host
                ? '<button type="button" class="btn-paw" onclick="DG.mpCreate()">Create room →</button>'
                : '<button type="button" class="btn-paw" onclick="DG.launchSolo()">Start race →</button>') +
            '</div>';
    },

    setScene(value) {
        if (!DG.canEditHostSettings()) return;
        DG.readSettings().scene = DG.normalizeScene(value);
        DG.saveSettings();
        DG.showSceneStep();
    },

    /* Joiner’s last step: the host owns the challenge / question count /
       course, so the joiner only enters the code (their cat and controls were
       already chosen on the previous steps). */
    showJoinStep() {
        DG.menuStep = 'join';
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        content.innerHTML =
            DG.stepDots('join') +
            DG.stepHeading('join', 'Join the room') +
            '<div class="dg-menu-panel">' +
            '<p class="text-center text-gray-500 font-bold mb-4">Enter the host’s 4-character room code. The host’s challenge, number of questions and course apply to everyone.</p>' +
            '<div class="flex gap-2 justify-center mb-4">' +
            '<input id="dg-join-code" type="text" inputmode="latin" autocomplete="off" maxlength="4" placeholder="CODE" ' +
            'class="dg-code-input" onkeydown="if(event.key===\'Enter\'){event.preventDefault();DG.mpJoin();}" aria-label="Room code">' +
            '<button type="button" class="dg-menu-button" onclick="DG.mpJoin()">Join</button></div>' +
            '<div id="dg-mp-status" class="dg-note hidden"></div>' +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showControlsStep()">← Controls</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showMultiplayerEntryStep()">← Create / Join</button></div>';
    },

    launchSolo() {
        DG.sessionMode = 'solo';
        DG.mpRole = '';
        DG.startSingle();
    },

    // Backwards-compatible alias: older inline handlers and cached links may
    // still call showModeStep(). The game-mode step itself is gone.
    showModeStep() {
        DG.showSessionStep();
    },

    startSingle() {
        DG.menuStep = 'launch';
        const settings = DG.readSettings();
        const topic = DG.normalizeTopic(settings.topic);
        const mode = DG.normalizeBankMode(topic, settings.bankMode);
        // Called from the Start race tap, so this is a valid audio gesture.
        if (typeof DG.startMusic === 'function') DG.startMusic();
        DG.showLoading('Loading ' + DG.modeLabel(topic, mode) + ' questions…');
        DG.loadBank(topic, mode).then(() => {
            DG.startRace({
                mode: 'single',
                topic: topic,
                bankMode: mode,
                questionCount: settings.questionCount,
                scene: settings.scene
            });
        }).catch(err => DG.showLoadError(topic, mode, err));
    },

    /* ---------------- scoring / personal bests ---------------- */

    // Composite = existing race score + a time bonus that is higher when the
    // player finishes faster.
    //   timeBonus = max(0, round(TIME_BONUS_FACTOR * N / max(elapsedSeconds, 1)))
    // so the bonus is proportional to N / elapsed (questions per second).
    // With TIME_BONUS_FACTOR = 4000: 20 questions in 100s → 800 bonus;
    // 20 questions in 200s → 400 bonus. Wrong answers do not count toward N
    // but they still lower the race score (and therefore the composite).
    timeBonus(elapsedSeconds, questionCount) {
        const n = DG.normalizeQuestionCount(questionCount);
        const elapsed = Math.max(1, Number(elapsedSeconds) || 0);
        return Math.max(0, Math.round(DG.TIME_BONUS_FACTOR * n / elapsed));
    },

    scoreRun(stats, elapsedSeconds, questionCount) {
        const s = stats || {};
        const raceScore = Math.max(0, Math.floor(Number(s.score) || 0));
        const correct = Math.max(0, Math.floor(Number(s.correct) || 0));
        const wrong = Math.max(0, Math.floor(Number(s.wrong) || 0));
        const attempts = correct + wrong;
        const accuracy = attempts ? correct / attempts : 0;
        const n = DG.normalizeQuestionCount(questionCount);
        const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
        const bonus = DG.timeBonus(elapsed, n);
        return {
            raceScore,
            timeBonus: bonus,
            composite: raceScore + bonus,
            accuracy,
            correct,
            wrong,
            attempts,
            elapsed,
            questionCount: n
        };
    },

    formatRaceTime(seconds) {
        const t = Math.max(0, Number(seconds) || 0);
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    },

    formatAccuracy(accuracy) {
        return Math.round((Number(accuracy) || 0) * 100) + '%';
    },

    bestRunStorageKey(topic, bankMode, questionCount) {
        return DG.normalizeTopic(topic) + ':' +
            DG.normalizeBankMode(topic, bankMode) + ':' +
            DG.normalizeQuestionCount(questionCount);
    },

    readBestRuns() {
        try {
            const raw = JSON.parse(localStorage.getItem(DG.BEST_RUNS_KEY) || 'null');
            return raw && typeof raw === 'object' ? raw : {};
        } catch (e) {
            return {};
        }
    },

    readBestRun(topic, bankMode, questionCount) {
        const t = DG.normalizeTopic(topic);
        const mode = DG.normalizeBankMode(t, bankMode);
        const n = DG.normalizeQuestionCount(questionCount);
        const all = DG.readBestRuns();
        // Before the topic column the key was "av:20". Keep showing those
        // Tenses personal bests; new runs write the topic-aware key.
        const legacy = (t === 'tenses') ? all[mode + ':' + n] : null;
        const row = all[DG.bestRunStorageKey(t, mode, n)] || legacy;
        if (!row || typeof row !== 'object') return null;
        const composite = Number(row.composite);
        const time = Number(row.time);
        if (!isFinite(composite) || composite <= 0) return null;
        return {
            composite: Math.floor(composite),
            time: isFinite(time) && time > 0 ? time : 0,
            score: Math.max(0, Math.floor(Number(row.score) || 0))
        };
    },

    recordBestRun(topic, bankMode, questionCount, result) {
        if (!result || !result.composite) return false;
        const key = DG.bestRunStorageKey(topic, bankMode, questionCount);
        const all = DG.readBestRuns();
        const prev = all[key];
        const better = !prev
            || result.composite > prev.composite
            || (result.composite === prev.composite && result.elapsed < (prev.time || Infinity));
        if (!better) return false;
        all[key] = {
            composite: Math.floor(result.composite),
            time: Number(result.elapsed) || 0,
            score: Math.floor(result.raceScore || 0)
        };
        try { localStorage.setItem(DG.BEST_RUNS_KEY, JSON.stringify(all)); } catch (e) {}
        return true;
    },

    readBestScore() {
        const n = Number(localStorage.getItem(DG.BEST_SCORE_KEY) || 0);
        return isFinite(n) && n > 0 ? n : 0;
    },

    readBestDistance() {
        const n = Number(localStorage.getItem(DG.BEST_DISTANCE_KEY) || 0);
        return isFinite(n) && n > 0 ? n : 0;
    },

    recordBest(score, distance) {
        let changed = false;
        if (score > DG.readBestScore()) {
            try { localStorage.setItem(DG.BEST_SCORE_KEY, String(Math.floor(score))); } catch (e) {}
            changed = true;
        }
        if (distance > DG.readBestDistance()) {
            try { localStorage.setItem(DG.BEST_DISTANCE_KEY, String(Math.floor(distance))); } catch (e) {}
            changed = true;
        }
        return changed;
    },

    /* ---------------- cloud boards (Drive & Go! Solo / Multi) ---------------- */

    // Both boards are separate Supabase tables + views created by
    // supabase/drive_and_go_scenes_and_boards.sql. Single Player itself never
    // needs the SQL: a failed insert just skips the cloud board.
    cloudBoardTable(kind) {
        return kind === 'multi' ? 'drive_and_go_multi_scores' : 'drive_and_go_solo_scores';
    },

    cloudRunRow(result, extra) {
        if (typeof previewStudentForm === 'function' && previewStudentForm()) return null;
        if (typeof canUseCloud !== 'function' || !canUseCloud()) return null;
        if (typeof sb === 'undefined' || !sb) return null;
        if (typeof currentUser === 'undefined' || !currentUser || !currentUser.id) return null;
        const r = result || {};
        const s = DG.readSettings();
        const topic = DG.normalizeTopic(r.topic || s.topic);
        const n = DG.normalizeQuestionCount(r.questionCount || s.questionCount);
        const bankMode = DG.normalizeBankMode(topic, r.bankMode || s.bankMode);
        const accuracy = isFinite(Number(r.accuracy)) ? Math.max(0, Math.min(1, Number(r.accuracy))) : 0;
        const row = {
            user_id: currentUser.id,
            email: currentUser.email || '',
            nickname: (currentUser.user_metadata && currentUser.user_metadata.full_name) ||
                String(currentUser.email || '').split('@')[0] || 'Player',
            bank_mode: bankMode,
            question_count: n,
            scene: DG.normalizeScene(r.scene || s.scene),
            composite: Math.max(0, Math.floor(Number(r.composite) || 0)),
            race_score: Math.max(0, Math.floor(Number(r.raceScore) || 0)),
            time_bonus: Math.max(0, Math.floor(Number(r.timeBonus) || 0)),
            correct: Math.max(0, Math.floor(Number(r.correct) || 0)),
            wrong: Math.max(0, Math.floor(Number(r.wrong) || 0)),
            accuracy: Math.round(accuracy * 10000) / 10000,
            elapsed_ms: Math.max(0, Math.round((Number(r.elapsed) || 0) * 1000))
        };
        // Tenses must still insert into the current schema (no topic column
        // yet). Only an Agreement run sends the new column.
        if (topic === 'agreement') row.topic = 'agreement';
        if (extra && extra.room_id) {
            row.room_id = extra.room_id;
            row.place = extra.place == null ? null : Math.max(1, Math.floor(extra.place));
            row.player_count = extra.player_count == null ? null : Math.max(2, Math.floor(extra.player_count));
        }
        return row;
    },

    // Fire-and-forget: never blocks the results screen. A missing table only
    // shows a short SQL hint (once a minute).
    submitCloudRun(kind, result, extra) {
        const row = DG.cloudRunRow(result, extra);
        if (!row) return;
        try {
            sb.from(DG.cloudBoardTable(kind)).insert(row).then(({ error }) => {
                if (!error) return;
                console.warn('Drive & Go! ' + kind + ' score not saved:', error.message);
                DG.cloudBoardSqlHint(error);
            }, () => {});
        } catch (e) {}
    },

    cloudBoardSqlHint(error) {
        const now = Date.now();
        if (DG._cloudBoardHintAt && now - DG._cloudBoardHintAt < 60000) return;
        DG._cloudBoardHintAt = now;
        const text = [error && error.code, error && error.message, error && error.details, error && error.hint]
            .filter(Boolean).join(' ');
        // A topic / gapfill / choose failure is the new incremental, not the
        // older scene / board files the teacher already ran.
        const agreement = /topic|gapfill|choose/i.test(text)
            || (/23514/i.test(text) && /question_mode|bank_mode/i.test(text));
        if (typeof DG.toastSafe === 'function') {
            DG.toastSafe(agreement
                ? 'Leaderboard not saved — run supabase/drive_and_go_agreement_topic.sql.'
                : 'Leaderboard not saved — run supabase/drive_and_go_scenes_and_boards.sql.');
        }
    },

    /* ---------------- small helpers used by all three files ---------------- */

    esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    ordinal(n) {
        const x = Math.max(1, Number(n) || 1);
        const mod100 = x % 100;
        if (mod100 >= 11 && mod100 <= 13) return x + 'th';
        if (x % 10 === 1) return x + 'st';
        if (x % 10 === 2) return x + 'nd';
        if (x % 10 === 3) return x + 'rd';
        return x + 'th';
    },

    lookName(look) {
        const l = DG.normalizeLook(look);
        const bits = [l.cat];
        if (l.glasses !== 'None') bits.push(l.glasses);
        if (l.hat !== 'None') bits.push(l.hat);
        if (l.outfit !== 'None') bits.push(l.outfit);
        return bits.join(' · ');
    },

    catPalette(cat) {
        if (cat === 'Ragdoll') return { body: '#fffaf3', shade: '#efe4d8', points: '#6b5a51', eye: '#4dabf7', nose: '#f2a6b8' };
        if (cat === 'Black') return { body: '#34343c', shade: '#222228', points: '#18181d', eye: '#f5c542', nose: '#e88a9b' };
        if (cat === 'Siamese') return { body: '#f3e3c8', shade: '#e3d0b0', points: '#5b4636', eye: '#63b3ed', nose: '#e7a0ae' };
        return { body: '#e8893c', shade: '#c96f2b', points: '#a9541b', eye: '#5aa9e6', nose: '#f2a6b8' };
    },

    /* Inline SVG used by the multiplayer lobby (so each player's chosen cat
       is visible before the race). */
    catAvatarSVG(look, size) {
        const l = DG.normalizeLook(look);
        const p = DG.catPalette(l.cat);
        const s = size || 58;
        let glasses = '';
        if (l.glasses === 'Sunglasses') {
            glasses = '<rect x="21" y="30" width="16" height="7" rx="3" fill="#111827"/><rect x="43" y="30" width="16" height="7" rx="3" fill="#111827"/><rect x="36" y="32" width="8" height="2" fill="#111827"/>';
        } else if (l.glasses === 'Glasses') {
            glasses = '<circle cx="29" cy="33" r="7" fill="none" stroke="#374151" stroke-width="2"/><circle cx="51" cy="33" r="7" fill="none" stroke="#374151" stroke-width="2"/><path d="M36 33h8" stroke="#374151" stroke-width="2"/>';
        }
        let hat = '';
        if (l.hat === 'Party Hat') {
            hat = '<path d="M40 15 L25 1 L55 1 Z" fill="#f472b6"/><circle cx="35" cy="8" r="2" fill="#fde047"/><circle cx="45" cy="6" r="2" fill="#60a5fa"/><circle cx="40" cy="13" r="2" fill="#facc15"/>';
        } else if (l.hat === 'Crown') {
            hat = '<path d="M25 10 L29 1 L35 8 L40 0 L45 8 L51 1 L55 10 Z" fill="#fbbf24" stroke="#d97706" stroke-width="1.5"/>';
        }
        let outfit = '';
        if (l.outfit === 'Red Scarf' || l.outfit === 'Pink Floral Scarf') {
            const col = l.outfit === 'Red Scarf' ? '#ef4444' : '#f472b6';
            outfit = '<path d="M24 55 Q40 64 56 55 L56 61 Q40 69 24 61 Z" fill="' + col + '"/><path d="M50 61l7 12" stroke="' + col + '" stroke-width="5" stroke-linecap="round"/>';
        } else if (l.outfit === 'Racing Jacket') {
            outfit = '<path d="M22 54h36v11H22z" fill="#ef4444"/><path d="M38 54h4v11h-4z" fill="#fff" opacity=".8"/>';
        } else if (l.outfit === 'Superhero Cape') {
            outfit = '<path d="M20 54 Q8 68 16 80 L30 63 Z" fill="#dc2626"/><path d="M60 54 Q72 68 64 80 L50 63 Z" fill="#dc2626"/>';
        } else if (l.outfit === 'Gentleman Bowtie') {
            outfit = '<path d="M29 58 L40 63 L51 58 L51 68 L40 63 L29 68 Z" fill="#111827"/>';
        } else if (l.outfit === 'Sports Vest') {
            outfit = '<path d="M24 54h32v12H24z" fill="#22c55e"/><path d="M38 54h4v12h-4z" fill="#fef08a"/>';
        }
        return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 80 82" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<ellipse cx="40" cy="77" rx="25" ry="4" fill="rgba(0,0,0,.12)"/>' +
            outfit +
            '<path d="M20 18 L16 3 L31 12 Z" fill="' + p.points + '"/><path d="M60 18 L64 3 L49 12 Z" fill="' + p.points + '"/>' +
            '<path d="M22 18 L20 10 L28 15 Z" fill="#f9a8b8"/><path d="M58 18 L60 10 L52 15 Z" fill="#f9a8b8"/>' +
            '<ellipse cx="40" cy="38" rx="26" ry="27" fill="' + p.body + '"/>' +
            '<ellipse cx="40" cy="50" rx="15" ry="13" fill="' + p.points + '" opacity="' + (l.cat === 'Ragdoll' || l.cat === 'Siamese' ? '.85' : '.25') + '"/>' +
            '<circle cx="29" cy="34" r="6" fill="' + p.eye + '"/><circle cx="51" cy="34" r="6" fill="' + p.eye + '"/>' +
            '<circle cx="29" cy="34" r="3" fill="#111827"/><circle cx="51" cy="34" r="3" fill="#111827"/>' +
            '<circle cx="27.5" cy="32" r="1.2" fill="#fff"/><circle cx="49.5" cy="32" r="1.2" fill="#fff"/>' +
            '<path d="M37 46 L43 46 L40 50 Z" fill="' + p.nose + '"/>' +
            '<path d="M40 50 Q36 54 33 51 M40 50 Q44 54 47 51" fill="none" stroke="' + p.points + '" stroke-width="1.6" stroke-linecap="round"/>' +
            '<path d="M24 44 L10 41 M24 48 L10 50 M56 44 L70 41 M56 48 L70 50" stroke="' + p.points + '" stroke-width="1.1" opacity=".65"/>' +
            glasses + hat +
            '</svg>';
    }
};

function showDriveAndGo() {
    DG.menuStep = 'session';
    DG.sessionMode = '';
    DG.mpRole = '';
    DG.readSettings();
    // A room held during the join settle window resumes its lobby; otherwise
    // start the normal Solo / Multiplayer flow.
    const resumed = (typeof DG.mpResumeRoom === 'function') && DG.mpResumeRoom();
    if (!resumed) DG.showSessionStep();
    changeView('grammar-detail-view');
    recordGuestUsage('Grammar Quest', 'Drive & Go!');
}

// Classic scripts share the global lexical `DG`, but exposing it on window too
// keeps inline onclick handlers and the sibling race/sync files simple.
if (typeof window !== 'undefined') window.DG = DG;
if (typeof globalThis !== 'undefined') globalThis.DG = DG;

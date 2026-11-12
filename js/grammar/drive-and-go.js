/* LearniTY Dictation — Drive & Go! Mario Kart-style grammar racing game.
   This file owns the pre-race flow (challenge → cat → controls → question
   count → mode), the Google-Sheets question bank, same-verb tense
   distractors, local preferences and shared helpers. The canvas race engine
   lives in drive-and-go-race.js and the realtime 2–5 player lobby/race sync
   lives in drive-and-go-multiplayer.js.
   All three files are classic scripts: no modules, no defer/async. */

const DG = {
    SETTINGS_KEY: 'learniTY_dg_settings',
    BEST_SCORE_KEY: 'learniTY_dg_best_score',
    BEST_DISTANCE_KEY: 'learniTY_dg_best_distance',
    BEST_RUNS_KEY: 'learniTY_dg_best_runs',
    TAB_FOR_MODE: { av: ['tenses'], pv: ['Passives'], mixed: ['tenses', 'Passives'] },
    MODE_LABEL: { av: 'Active Voice (AV)', pv: 'Passive Voice (PV)', mixed: 'Mixed' },
    MODE_SHORT: { av: 'AV', pv: 'PV', mixed: 'Mixed' },
    QUESTION_COUNTS: [20, 25, 30, 35, 40, 50],
    // Race constants shared by the engine and the tests.
    NITRO_KMH: 40,
    SPIN_TIME: 1.5,
    GATE_GAP: 420,
    START_GATE_DIST: 320,
    FINISH_DISTANCE: 4200,
    RACE_SECONDS: 180,
    // Hold-to-speed: +60 km/h while ACCEL is held, hard-capped so stacked
    // nitro / mushroom / star bonuses cannot run away.
    ACCEL_KMH: 60,
    SPEED_CAP: 280,
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
    settings: null,
    menuStep: 'challenge',
    tiltPermission: 'unknown',

    /* ---------------- preferences ---------------- */

    defaultSettings() {
        return { bankMode: 'av', cat: 'Ginger', glasses: 'None', hat: 'None', outfit: 'None', controls: 'tilt', questionCount: 20 };
    },

    normalizeQuestionCount(value) {
        const n = Number(value);
        return DG.QUESTION_COUNTS.indexOf(n) !== -1 ? n : 20;
    },

    readSettings() {
        if (DG.settings) return DG.settings;
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(DG.SETTINGS_KEY) || 'null'); } catch (e) { saved = null; }
        DG.settings = Object.assign(DG.defaultSettings(), DG.normalizeLook(saved || {}));
        if (saved && DG.TAB_FOR_MODE[saved.bankMode]) DG.settings.bankMode = saved.bankMode;
        if (saved && ['tilt', 'swipe', 'buttons'].indexOf(saved.controls) !== -1) DG.settings.controls = saved.controls;
        DG.settings.questionCount = DG.normalizeQuestionCount(saved && saved.questionCount);
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

    /* Parse one gviz CSV tab. The sheet uses:
       - a header row ("Question (Column A)", "Answer (Column B)")
       - section heading rows (A = tense name, B empty)
       - "Challenging" heading rows (questions after it are challenging)
       - question rows (A = numbered sentence with ____, B = answer(s)). */
    parseQuestionSheet(csvText, sheetName) {
        const questions = [];
        const bySection = {};
        const bySheet = [];
        const lines = String(csvText || '').split(/\r?\n/);
        let section = 'General';
        let challenging = false;
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
                hintRaw
            };
            questions.push(q);
            bySheet.push({ primary: q.primary, variants, item: q });
            if (!bySection[sectionKey]) bySection[sectionKey] = [];
            bySection[sectionKey].push({ primary: q.primary, variants, item: q });
        }
        return { questions, bySection, bySheet };
    },

    loadBank(mode, force) {
        const tabs = DG.TAB_FOR_MODE[mode];
        if (!tabs) return Promise.reject(new Error('Unknown challenge mode: ' + mode));
        if (!force && DG.bankCache[mode] && DG.bankCache[mode].length) return Promise.resolve(DG.bankCache[mode]);
        const sections = {};
        const sheets = {};
        const all = [];
        let chain = Promise.resolve();
        tabs.forEach(tab => {
            chain = chain.then(() => {
                const url = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID +
                    '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(tab);
                return fetch(url, { credentials: 'omit' }).then(response => {
                    if (!response.ok) throw new Error('The "' + tab + '" tab returned HTTP ' + response.status + '.');
                    return response.text();
                }).then(text => {
                    const parsed = DG.parseQuestionSheet(text, tab);
                    if (!parsed.questions.length) throw new Error('The "' + tab + '" tab has no usable questions.');
                    Object.keys(parsed.bySection).forEach(k => { sections[k] = parsed.bySection[k]; });
                    sheets[tab] = parsed.bySheet;
                    all.push.apply(all, parsed.questions);
                });
            });
        });
        return chain.then(() => {
            if (!all.length) throw new Error('The question bank is empty.');
            DG.bankCache[mode] = all;
            DG.bankPoolCache[mode] = { bySection: sections, bySheet: sheets };
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

    gatesFor(question, mode, rng) {
        const pools = DG.bankPoolCache[mode] || { bySection: {}, bySheet: {} };
        return DG.buildGates(
            question,
            pools.bySection[question.sectionKey] || [],
            (pools.bySheet && pools.bySheet[question.sheet]) || [],
            rng
        );
    },

    raceQuestionQueue(mode, seed) {
        const bank = DG.bankCache[mode] || [];
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

    menuContent() {
        return document.getElementById('grammar-detail-content');
    },

    backToTenses() {
        DG.stopRace();
        if (typeof DG.mpStopPoll === 'function') DG.mpAbandon();
        changeView('grammar-revision-view');
    },

    // changeView() calls this for every view change. Keep the race alive only
    // while the dedicated race view is on screen; stop lobby polling when the
    // player navigates away from the grammar detail page.
    onLeaveView(viewId) {
        if (viewId === 'drive-and-go-view') return;
        if (typeof DG.stopRace === 'function') DG.stopRace();
        if (viewId !== 'grammar-detail-view') {
            if (typeof DG.mpStopPoll === 'function') DG.mpStopPoll();
            if (typeof DG.mpAbandon === 'function') DG.mpAbandon();
        }
    },

    showLoading(message) {
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        content.innerHTML = '<div class="text-center py-16"><div class="loader mx-auto mb-5"></div>' +
            '<p class="text-xl font-bold text-orange-500">' + DG.esc(message) + '</p></div>';
    },

    showLoadError(mode, err) {
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const label = DG.MODE_LABEL[mode] || 'grammar';
        content.innerHTML =
            '<div class="text-center mb-6"><div class="text-7xl mb-3">📡</div>' +
            '<h2 class="text-3xl font-bold text-orange-600">Question bank not loaded</h2></div>' +
            '<div class="dg-menu-panel text-center">' +
            '<p class="font-bold text-gray-700 mb-2">Could not load the ' + DG.esc(label) + ' questions from Google Sheets.</p>' +
            '<p class="text-sm text-gray-500 mb-6">' + DG.esc(err && err.message ? err.message : 'Please check your connection and try again.') + '</p>' +
            '<div class="flex gap-3 justify-center flex-wrap">' +
            '<button type="button" class="btn-paw" onclick="DG.retryBank()">Retry</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showModeStep()">Back</button>' +
            '</div></div>';
    },

    retryBank() {
        const mode = DG.readSettings().bankMode;
        DG.showLoading('Loading ' + (DG.MODE_LABEL[mode] || '') + ' questions…');
        DG.loadBank(mode, true).then(() => {
            if (DG.menuStep === 'mode') DG.showModeStep();
            else DG.startSingle();
        }).catch(err => DG.showLoadError(mode, err));
    },

    stepDots(activeIndex) {
        const bits = [];
        for (let i = 0; i < 5; i++) {
            bits.push('<span class="' + (i < activeIndex ? 'done' : (i === activeIndex ? 'active' : '')) + '"></span>');
        }
        return '<div class="dg-step-dots">' + bits.join('') + '</div>';
    },

    showChallengeStep() {
        DG.menuStep = 'challenge';
        const s = DG.readSettings();
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
        content.innerHTML =
            '<div class="text-center mb-6"><div class="text-7xl mb-2">🏎️</div>' +
            '<h2 class="text-4xl font-bold text-orange-600">Drive & Go!</h2>' +
            '<p class="text-gray-500 font-bold mt-2">Read the sentence, steer into the correct gate, and race the track.</p></div>' +
            DG.stepDots(0) +
            '<h3 class="text-2xl font-bold text-green-600 text-center mb-4">1. Choose your challenge</h3>' +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">' +
            card('av', '🟢', 'Active Voice', 'AV — tenses tab') +
            card('pv', '🔵', 'Passive Voice', 'PV — Passives tab') +
            card('mixed', '🌈', 'Mixed', 'Both tabs shuffled together') +
            '</div>' +
            '<div class="text-center"><button type="button" class="btn-paw" onclick="DG.showCatStep()">Next: Cat driver →</button></div>';
    },

    setBankMode(mode) {
        if (!DG.TAB_FOR_MODE[mode]) return;
        DG.readSettings().bankMode = mode;
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
            DG.stepDots(1) +
            '<h3 class="text-2xl font-bold text-green-600 text-center mb-4">2. Customize your cat driver</h3>' +
            '<div class="dg-preview-wrap"><canvas id="dg-cat-preview" width="520" height="400" aria-label="Cat driver preview"></canvas></div>' +
            row('Cat', 'cat', DG.CATS, s.cat) +
            row('Glasses', 'glasses', DG.GLASSES, s.glasses) +
            row('Hat', 'hat', DG.HATS, s.hat) +
            row('Outfit', 'outfit', DG.OUTFITS, s.outfit) +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showChallengeStep()">← Challenge</button>' +
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
            DG.stepDots(2) +
            '<h3 class="text-2xl font-bold text-green-600 text-center mb-2">3. Choose your controls</h3>' +
            '<p class="text-center text-gray-500 font-bold mb-4">Tilt is recommended on a phone. Buttons always stay on screen as a backup.</p>' +
            note +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">' +
            card('tilt', '📱', 'Tilt (recommended)', 'Lean left / right to change lane') +
            card('swipe', '👆', 'Swipe', 'Swipe left or right on the track') +
            card('buttons', '🔘', 'LEFT / CENTER / RIGHT', 'Tap the on-screen buttons') +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showCatStep()">← Cat</button>' +
            '<button type="button" class="btn-paw" onclick="DG.showCountStep()">Next: Questions →</button></div>';
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
            DG.stepDots(3) +
            '<h3 class="text-2xl font-bold text-green-600 text-center mb-2">4. How many questions?</h3>' +
            '<p class="text-center text-gray-500 font-bold mb-4">A run ends when you get this many answers correct. Wrong answers do not count toward the total.</p>' +
            '<div class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">' + cards + '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showControlsStep()">← Controls</button>' +
            '<button type="button" class="btn-paw" onclick="DG.showModeStep()">Next: Game mode →</button></div>';
    },

    setQuestionCount(value) {
        const n = DG.normalizeQuestionCount(value);
        DG.readSettings().questionCount = n;
        DG.saveSettings();
        DG.showCountStep();
    },

    showModeStep() {
        DG.menuStep = 'mode';
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const s = DG.readSettings();
        const modeText = DG.MODE_LABEL[s.bankMode] || '';
        const n = DG.normalizeQuestionCount(s.questionCount);
        content.innerHTML =
            DG.stepDots(4) +
            '<h3 class="text-2xl font-bold text-green-600 text-center mb-2">5. Choose a game mode</h3>' +
            '<p class="text-center text-gray-500 font-bold mb-5">Challenge: <span class="text-orange-600">' + DG.esc(modeText) + '</span> · <span class="text-orange-600">' + n + ' questions</span></p>' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">' +
            '<button type="button" class="dg-choice" onclick="DG.startSingle()"><span class="dg-choice-emoji">🏁</span>' +
            '<span class="dg-choice-title">Single Player</span><span class="dg-choice-sub">Finish when you get ' + n + ' correct. Beat your best composite score and time.</span></button>' +
            '<button type="button" class="dg-choice" onclick="DG.openMultiplayer()"><span class="dg-choice-emoji">🏎️</span>' +
            '<span class="dg-choice-title">Multiplayer</span><span class="dg-choice-sub">2–5 players. First to ' + n + ' correct, then highest composite score wins.</span></button>' +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showCountStep()">← Questions</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showControlsStep()">← Controls</button></div>';
    },

    startSingle() {
        const mode = DG.readSettings().bankMode;
        DG.showLoading('Loading ' + (DG.MODE_LABEL[mode] || '') + ' questions…');
        DG.loadBank(mode).then(() => {
            DG.startRace({ mode: 'single', bankMode: mode, questionCount: DG.readSettings().questionCount });
        }).catch(err => DG.showLoadError(mode, err));
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

    bestRunStorageKey(bankMode, questionCount) {
        return String(bankMode || 'av') + ':' + DG.normalizeQuestionCount(questionCount);
    },

    readBestRuns() {
        try {
            const raw = JSON.parse(localStorage.getItem(DG.BEST_RUNS_KEY) || 'null');
            return raw && typeof raw === 'object' ? raw : {};
        } catch (e) {
            return {};
        }
    },

    readBestRun(bankMode, questionCount) {
        const row = DG.readBestRuns()[DG.bestRunStorageKey(bankMode, questionCount)];
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

    recordBestRun(bankMode, questionCount, result) {
        if (!result || !result.composite) return false;
        const key = DG.bestRunStorageKey(bankMode, questionCount);
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
    DG.menuStep = 'challenge';
    DG.readSettings();
    DG.showChallengeStep();
    changeView('grammar-detail-view');
    recordGuestUsage('Grammar Quest', 'Drive & Go!');
}

// Classic scripts share the global lexical `DG`, but exposing it on window too
// keeps inline onclick handlers and the sibling race/sync files simple.
if (typeof window !== 'undefined') window.DG = DG;
if (typeof globalThis !== 'undefined') globalThis.DG = DG;

// Agreement topic + Gap-fill / Choose gates for Drive & Go!.
// Unit tests only: no browser, no network, no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/grammar/drive-and-go.js'), 'utf8');
const raceSource = fs.readFileSync(path.join(__dirname, '../js/grammar/drive-and-go-race.js'), 'utf8');
const mpSource = fs.readFileSync(path.join(__dirname, '../js/grammar/drive-and-go-multiplayer.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8');
const leaderboardSource = fs.readFileSync(path.join(__dirname, '../js/leaderboard.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function makeElementStore() {
    const elements = {};
    const element = (id) => {
        if (!elements[id]) {
            elements[id] = {
                id,
                innerHTML: '',
                textContent: '',
                value: '',
                onclick: null,
                classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
            };
        }
        return elements[id];
    };
    return { elements, element };
}

function loadDG(store, opts) {
    const ls = store || {};
    const options = opts || {};
    const context = vm.createContext({
        window: {},
        globalThis: {},
        localStorage: {
            getItem(k) { return Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null; },
            setItem(k, v) { ls[k] = String(v); },
            removeItem(k) { delete ls[k]; }
        },
        document: { getElementById() { return null; } },
        SPREADSHEET_ID: 'SHEET_ID',
        fetch: options.fetch || (() => Promise.reject(new Error('no network in tests'))),
        isGuestUser: () => !!options.guest,
        canUseCloud: () => options.cloud !== false && !options.guest,
        currentUser: options.currentUser || null,
        sb: options.sb || null,
        previewStudentForm: () => false,
        console
    });
    vm.runInContext(source, context);
    return vm.runInContext('DG', context);
}

function loadDGWithDom(store, opts) {
    const ls = store || {};
    const options = opts || {};
    const { elements, element } = makeElementStore();
    const context = vm.createContext({
        window: {},
        globalThis: {},
        localStorage: {
            getItem(k) { return Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null; },
            setItem(k, v) { ls[k] = String(v); },
            removeItem(k) { delete ls[k]; }
        },
        document: { getElementById: element },
        requestAnimationFrame() { return 0; },
        SPREADSHEET_ID: 'SHEET_ID',
        fetch: options.fetch || (() => Promise.reject(new Error('no network in tests'))),
        isGuestUser: () => !!options.guest,
        canUseCloud: () => options.cloud !== false && !options.guest,
        currentUser: options.currentUser || null,
        sb: options.sb || null,
        previewStudentForm: () => false,
        console
    });
    vm.runInContext(source, context);
    const DG = vm.runInContext('DG', context);
    const content = () => element('grammar-detail-content').innerHTML;
    return { DG, context, elements, element, content };
}

// A compact Agreement tab sample, matching the live sheet layout:
// heading rows have an empty answer column, "Challenging" only flips the flag.
const AGREEMENT = [
    'Question (Column A),Answer (Column B)',
    '"Basic Singular and Plural Subjects",""',
    '"1. Gap-fill: The school bus ____ (leave) at seven o\'clock every morning.","leaves"',
    '"2. Choose: The students ____ already in the hall for the assembly. (is / are)","are"',
    '"3. Gap-fill: My cousins ____ (not/want) to join the choir this year.","don\'t want / do not want"',
    '"4. Choose: Everyone ____ happy with the new timetable. (am / is / are)","is"',
    '"5. Gap-fill: The winning team ____ (be) very tired after the match.","was / were"',
    '"6. Choose: Neither of the twins ____ the answer. (know / knows)","knows"',
    '"Challenging",""',
    '"7. Choose: Each of the players ____ a water bottle. (has / have)","has"',
    '"8. Just a numbered row without a type ____ (stay).","stays"'
].join('\n');

function agreementQuestions(DG) {
    return DG.parseQuestionSheet(AGREEMENT, 'Agreement').questions;
}

/* ---------------- topic model ---------------- */

test('topic model: defaults, normalisation, labels and exact Agreement tab', () => {
    const DG = loadDG();
    assert.deepEqual(Array.from(DG.TOPICS), ['tenses', 'agreement']);
    assert.equal(DG.defaultSettings().topic, 'tenses');
    assert.equal(DG.defaultSettings().bankMode, 'av');
    assert.equal(DG.readSettings().topic, 'tenses');
    assert.equal(DG.readSettings().bankMode, 'av');

    assert.equal(DG.normalizeTopic('Agreement'), 'agreement');
    assert.equal(DG.normalizeTopic('AGREEMENT'), 'agreement');
    assert.equal(DG.normalizeTopic('nonsense'), 'tenses');
    assert.equal(DG.normalizeTopic(null), 'tenses');

    assert.equal(DG.normalizeBankMode('tenses', 'pv'), 'pv');
    assert.equal(DG.normalizeBankMode('tenses', 'gapfill'), 'av');
    assert.equal(DG.normalizeBankMode('agreement', 'choose'), 'choose');
    assert.equal(DG.normalizeBankMode('agreement', 'pv'), 'gapfill');
    assert.equal(DG.normalizeBankMode('agreement', 'mixed'), 'mixed');

    assert.equal(DG.topicLabel('agreement'), 'Agreement');
    assert.equal(DG.topicLabel(''), 'Tenses');
    assert.equal(DG.modeShort('tenses', 'pv'), 'PV');
    assert.equal(DG.modeShort('agreement', 'gapfill'), 'Gap-fill');
    assert.equal(DG.modeShort('agreement', 'choose'), 'Choose');
    assert.equal(DG.modeLabel('tenses', 'av'), 'Active Voice (AV)');
    assert.equal(DG.modeLabel('agreement', 'mixed'), 'Mixed');
    assert.equal(DG.topicChallenge('tenses', 'pv'), 'Tenses · PV');
    assert.equal(DG.topicChallenge('agreement', 'gapfill'), 'Agreement · Gap-fill');
    assert.equal(DG.topicChallenge(undefined, 'mixed'), 'Tenses · Mixed');

    // Tenses tab map is unchanged and still exactly the live names.
    assert.deepEqual(Array.from(DG.TAB_FOR_MODE.av), ['tenses']);
    assert.deepEqual(Array.from(DG.TAB_FOR_MODE.pv), ['Passives']);
    assert.deepEqual(Array.from(DG.TAB_FOR_MODE.mixed), ['tenses', 'Passives']);
    assert.deepEqual(Array.from(DG.tabsFor('tenses', 'av')), ['tenses']);
    assert.deepEqual(Array.from(DG.tabsFor('tenses', 'pv')), ['Passives']);
    assert.deepEqual(Array.from(DG.tabsFor('tenses', 'mixed')), ['tenses', 'Passives']);
    assert.deepEqual(Array.from(DG.tabsFor('agreement', 'gapfill')), ['Agreement']);
    assert.deepEqual(Array.from(DG.tabsFor('agreement', 'choose')), ['Agreement']);
    assert.deepEqual(Array.from(DG.tabsFor('agreement', 'mixed')), ['Agreement']);

    // Mixed must not share a cache slot across topics.
    assert.notEqual(DG.bankKey('tenses', 'mixed'), DG.bankKey('agreement', 'mixed'));
    assert.equal(DG.bankKey('tenses', 'mixed'), 'tenses:mixed');
    assert.equal(DG.bankKey('agreement', 'mixed'), 'agreement:mixed');
});

test('settings persist topic and reset an invalid challenge when the topic changes', () => {
    const { DG } = loadDGWithDom();
    assert.equal(DG.readSettings().topic, 'tenses');

    DG.setTopic('agreement');
    assert.equal(DG.readSettings().topic, 'agreement');
    assert.equal(DG.readSettings().bankMode, 'gapfill');
    DG.setBankMode('choose');
    assert.equal(DG.readSettings().bankMode, 'choose');

    DG.setTopic('tenses');
    assert.equal(DG.readSettings().topic, 'tenses');
    assert.equal(DG.readSettings().bankMode, 'av');

    // Saved settings from a previous visit are honoured.
    const { DG: saved } = loadDGWithDom({
        learniTY_dg_settings: JSON.stringify({ topic: 'agreement', bankMode: 'mixed' })
    });
    assert.equal(saved.readSettings().topic, 'agreement');
    assert.equal(saved.readSettings().bankMode, 'mixed');

    // A legacy file with no topic counts as Tenses.
    const { DG: legacy } = loadDGWithDom({
        learniTY_dg_settings: JSON.stringify({ bankMode: 'pv', questionCount: 30 })
    });
    assert.equal(legacy.readSettings().topic, 'tenses');
    assert.equal(legacy.readSettings().bankMode, 'pv');
});

test('legacy Tenses personal bests still display after the topic-aware key change', () => {
    const DG = loadDG({
        learniTY_dg_best_runs: JSON.stringify({ 'pv:20': { composite: 900, time: 45, score: 600 } })
    });
    const best = DG.readBestRun('tenses', 'pv', 20);
    assert.ok(best);
    assert.equal(best.composite, 900);
    assert.equal(best.time, 45);
    assert.equal(DG.readBestRun('agreement', 'gapfill', 20), null,
        'a Tenses personal best must not leak into Agreement');
});

/* ---------------- parsing ---------------- */

test('Agreement parser reads Gap-fill / Choose, skips headings and untyped rows', () => {
    const DG = loadDG();
    const parsed = DG.parseQuestionSheet(AGREEMENT, 'Agreement');
    assert.equal(parsed.questions.length, 7, 'the untyped numbered row must be skipped');

    const gap = parsed.questions[0];
    assert.equal(gap.qType, 'gapfill');
    assert.equal(gap.primary, 'leaves');
    assert.equal(gap.section, 'Basic Singular and Plural Subjects');
    assert.equal(gap.challenging, false);

    const choose2 = parsed.questions[1];
    assert.equal(choose2.qType, 'choose');
    assert.deepEqual(Array.from(choose2.options), ['is', 'are']);
    assert.equal(choose2.primary, 'are');

    const alt = parsed.questions[2];
    assert.deepEqual(Array.from(alt.variants), ["don't want", 'do not want']);

    const choose3 = parsed.questions[3];
    assert.equal(choose3.qType, 'choose');
    assert.deepEqual(Array.from(choose3.options), ['am', 'is', 'are']);

    const slashAlt = parsed.questions[4];
    assert.deepEqual(Array.from(slashAlt.variants), ['was', 'were']);
    assert.equal(slashAlt.qType, 'gapfill');

    // The "Challenging" heading is not a question; it only flips the flag.
    const challenging = parsed.questions[6];
    assert.equal(challenging.challenging, true);
    assert.equal(challenging.section, 'Basic Singular and Plural Subjects');
    assert.deepEqual(Array.from(challenging.options), ['has', 'have']);

    // Section headings never become questions.
    parsed.questions.forEach(q => {
        assert.match(q.prompt, /^\d+[.)]/);
        assert.ok(q.prompt.indexOf('____') !== -1);
    });
});

test('Tenses parsing is unchanged: no type prefix required and no qType added', () => {
    const DG = loadDG();
    const csv = [
        'Question (Column A),Answer (Column B)',
        '"Present Simple",""',
        '"1. She ____ (go) to school every day.","goes"',
        '"Challenging",""',
        '"2. Neither twin ____ (enjoy) winter swimming.","enjoys"'
    ].join('\n');
    const parsed = DG.parseQuestionSheet(csv, 'tenses');
    assert.equal(parsed.questions.length, 2);
    parsed.questions.forEach(q => assert.equal(q.qType, ''));
    assert.equal(parsed.questions[1].challenging, true);
    assert.equal(DG.displayPrompt(parsed.questions[0], []), parsed.questions[0].prompt);
});

test('Agreement filtering keeps only the requested type and Mixed keeps both', () => {
    const DG = loadDG();
    const all = agreementQuestions(DG);
    const gap = DG.filterAgreementQuestions(all, 'gapfill');
    const choose = DG.filterAgreementQuestions(all, 'choose');
    const mixed = DG.filterAgreementQuestions(all, 'mixed');
    assert.ok(gap.length > 0 && gap.every(q => q.qType === 'gapfill'));
    assert.ok(choose.length > 0 && choose.every(q => q.qType === 'choose'));
    assert.equal(mixed.length, all.length);
    assert.equal(gap.length + choose.length, mixed.length);
    assert.ok(!gap.some(q => q.qType === 'choose'));
    assert.ok(!choose.some(q => q.qType === 'gapfill'));
});

test('loadBank fetches the exact Agreement tab once and filters per challenge', async () => {
    const urls = [];
    const DG = loadDG({}, {
        fetch(url) {
            urls.push(url);
            return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(AGREEMENT) });
        }
    });

    const gap = await DG.loadBank('agreement', 'gapfill');
    assert.ok(gap.length > 0 && gap.every(q => q.qType === 'gapfill'));
    assert.equal(urls.length, 1);
    assert.ok(urls[0].indexOf('sheet=Agreement') !== -1, 'the gviz tab must be exactly Agreement');
    assert.ok(!/sheet=agreement\b/.test(urls[0]));
    assert.ok(!/sheet=AGREEMENTS?/.test(urls[0]));
    assert.ok(!/sheet=Charity/i.test(urls[0]));

    const choose = await DG.loadBank('agreement', 'choose');
    assert.ok(choose.length > 0 && choose.every(q => q.qType === 'choose'));
    assert.equal(urls.length, 1, 'the Agreement tab must be fetched only once');

    const mixed = await DG.loadBank('agreement', 'mixed');
    assert.equal(mixed.length, gap.length + choose.length);
    assert.equal(urls.length, 1);
    assert.ok(DG.bankCache['agreement:mixed']);
    assert.equal(DG.bankCache['tenses:mixed'], undefined, 'Agreement Mixed must not touch Tenses Mixed');
});

/* ---------------- prompts and gates ---------------- */

test('displayPrompt strips the bank label and Choose options that are already on gates', () => {
    const DG = loadDG();
    const qs = agreementQuestions(DG);
    const gap = qs[0];
    assert.equal(
        DG.displayPrompt(gap, []),
        "The school bus ____ (leave) at seven o'clock every morning."
    );

    const choose2 = qs[1];
    assert.equal(
        DG.displayPrompt(choose2, [{ label: 'is' }, { label: 'are' }]),
        'The students ____ already in the hall for the assembly.'
    );

    const choose3 = qs[3];
    assert.equal(
        DG.displayPrompt(choose3, [{ label: 'am' }, { label: 'is' }, { label: 'are' }]),
        'Everyone ____ happy with the new timetable.'
    );

    // A tense prompt is returned byte-for-byte.
    const tense = { prompt: '1. She ____ (go) to school every day.', primary: 'goes', variants: ['goes'] };
    assert.equal(DG.displayPrompt(tense, [{ label: 'goes' }]), tense.prompt);
});

test('Gap-fill gets the correct form plus same-verb agreement / tense cousins', () => {
    const DG = loadDG();
    const q = agreementQuestions(DG)[0]; // leaves
    const lanes = new Set();
    for (let seed = 1; seed <= 12; seed++) {
        const gates = DG.agreementGates(q, [], DG.makeRng(seed));
        assert.equal(gates.length, 3);
        assert.equal(gates.filter(g => g.correct).length, 1);
        const correct = gates.find(g => g.correct);
        assert.equal(DG.normAnswer(correct.label), 'leaves');
        lanes.add(correct.lane);
        const wrong = Array.from(gates.filter(g => !g.correct).map(g => DG.normAnswer(g.label))).sort();
        assert.deepEqual(wrong, ['leave', 'left'], 'expected leave / leaves / left');
        assert.equal(new Set(gates.map(g => DG.normAnswer(g.label))).size, 3);
    }
    assert.ok(lanes.size >= 2, 'the correct gate must move between lanes across seeds');

    // A negative multi-word answer keeps the same verb on both wrong gates.
    const neg = agreementQuestions(DG)[2]; // don't want / do not want
    for (let seed = 1; seed <= 8; seed++) {
        const gates = DG.agreementGates(neg, [], DG.makeRng(seed));
        gates.filter(g => !g.correct).forEach(g => {
            assert.match(g.label, /\bwant\b/i, 'expected a same-verb distractor, got ' + g.label);
        });
    }
});

test('two-option Choose uses both options plus exactly one extra plausible gate', () => {
    const DG = loadDG();
    const q = agreementQuestions(DG)[1]; // (is / are), answer are
    for (let seed = 1; seed <= 12; seed++) {
        const gates = DG.agreementGates(q, [], DG.makeRng(seed));
        assert.equal(gates.length, 3);
        const labels = gates.map(g => DG.normAnswer(g.label)).sort();
        assert.ok(labels.indexOf('is') !== -1);
        assert.ok(labels.indexOf('are') !== -1);
        const extra = gates.filter(g => ['is', 'are'].indexOf(DG.normAnswer(g.label)) === -1);
        assert.equal(extra.length, 1, 'exactly one extra distractor');
        assert.equal(extra[0].correct, false);
        assert.equal(DG.normAnswer(extra[0].label), 'am', 'the extra gate is an agreement cousin');
        assert.equal(gates.filter(g => g.correct).length, 1);
        assert.equal(DG.normAnswer(gates.find(g => g.correct).label), 'are');
    }
});

test('three-option Choose uses all three options and never adds a fourth', () => {
    const DG = loadDG();
    const q = agreementQuestions(DG)[3]; // (am / is / are), answer is
    for (let seed = 1; seed <= 12; seed++) {
        const gates = DG.agreementGates(q, [], DG.makeRng(seed));
        assert.equal(gates.length, 3);
        assert.deepEqual(
            Array.from(gates.map(g => DG.normAnswer(g.label))).sort(),
            ['am', 'are', 'is']
        );
        assert.equal(gates.filter(g => g.correct).length, 1);
        assert.equal(DG.normAnswer(gates.find(g => g.correct).label), 'is');
    }
});

test('slash alternatives are accepted and never become a wrong gate', () => {
    const DG = loadDG();

    // Gap-fill uses the primary form on the correct gate, and the other
    // accepted spelling is never placed on a wrong gate.
    const gapAlt = agreementQuestions(DG)[4]; // was / were
    for (let seed = 1; seed <= 12; seed++) {
        const gates = DG.agreementGates(gapAlt, [], DG.makeRng(seed));
        assert.equal(gates.length, 3);
        assert.equal(gates.filter(g => g.correct).length, 1, 'gap-fill shows its primary form');
        assert.equal(DG.normAnswer(gates.find(g => g.correct).label), 'was');
        gates.filter(g => !g.correct).forEach(g => {
            gapAlt.variants.forEach(v => {
                assert.notEqual(DG.normAnswer(g.label), DG.normAnswer(v),
                    'a listed alternative was placed on a wrong gate');
            });
        });
    }

    // A Choose answer that lists two accepted options marks both gates
    // correct, and the one extra distractor is never one of them.
    const chooseAlt = {
        prompt: '10. Choose: The cakes ____ delicious. (was / were)',
        primary: 'was',
        variants: ['was', 'were'],
        qType: 'choose',
        options: ['was', 'were'],
        sheet: 'Agreement',
        sectionKey: 'Agreement|General'
    };
    for (let seed = 1; seed <= 12; seed++) {
        const gates = DG.agreementGates(chooseAlt, [], DG.makeRng(seed));
        assert.equal(gates.length, 3);
        const correct = Array.from(gates.filter(g => g.correct).map(g => DG.normAnswer(g.label))).sort();
        assert.deepEqual(correct, ['was', 'were'], 'both listed alternatives are correct');
        const wrong = gates.filter(g => !g.correct);
        assert.equal(wrong.length, 1);
        assert.ok(['was', 'were'].indexOf(DG.normAnswer(wrong[0].label)) === -1,
            'a listed alternative was placed on a wrong gate');
    }

    // A gap-fill answer with two accepted spellings never puts the other
    // one on a wrong gate either.
    const negAlt = agreementQuestions(DG)[2]; // don't want / do not want
    for (let seed = 1; seed <= 8; seed++) {
        const gates = DG.agreementGates(negAlt, [], DG.makeRng(seed));
        gates.filter(g => !g.correct).forEach(g => {
            negAlt.variants.forEach(v => {
                assert.notEqual(DG.normAnswer(g.label), DG.normAnswer(v));
            });
        });
    }
});

test('Agreement gates fall back to other Agreement answers when no verb hint helps', () => {
    const DG = loadDG();
    const q = {
        prompt: '9. Choose: The children ____ their books. (has / have)',
        primary: 'have',
        variants: ['have'],
        qType: 'choose',
        options: ['has', 'have'],
        sheet: 'Agreement',
        sectionKey: 'Agreement|General'
    };
    const pool = [
        { primary: 'is', variants: ['is'] },
        { primary: 'are', variants: ['are'] },
        { primary: 'was', variants: ['was'] }
    ];
    const gates = DG.agreementGates(q, pool, DG.makeRng(5));
    assert.equal(gates.length, 3);
    assert.equal(gates.filter(g => g.correct).length, 1);
    assert.equal(gates.filter(g => !g.correct).length, 2);
});

test('answerGate accepts a hit on ANY correct gate (Agreement alternatives)', () => {
    const DG = loadDG();
    const context = vm.createContext({
        window: { DG },
        globalThis: {},
        document: { getElementById() { return null; } },
        console
    });
    vm.runInContext(raceSource, context);
    const S = DG.raceState;
    S.active = true;
    S.mode = 'single';
    S.topic = 'agreement';
    S.bankMode = 'gapfill';
    S.phase = 'racing';
    S.clock = 1;
    S.questionCount = 20;
    S.player = {
        lane: 0, laneX: 0, dist: 100, speed: 0, score: 0, combo: 0, maxCombo: 0,
        correct: 0, wrong: 0, item: null, spinUntil: 0, slowUntil: 0,
        nitroUntil: 0, boostUntil: 0, starUntil: 0, shrinkUntil: 0, finished: false
    };
    S.activeQ = { qType: 'choose', prompt: '1. Choose: It ____ cold. (was / were)', primary: 'was', variants: ['was', 'were'] };
    S.gates = [
        { label: 'was', lane: 0, correct: true, dist: 100 },
        { label: 'am', lane: 1, correct: false, dist: 100 },
        { label: 'were', lane: 2, correct: true, dist: 100 }
    ];
    S.gatesResolved = false;
    S.gateDist = 100;
    S.nextGateAt = 0;
    S.nextGateDist = 0;
    S.lastResult = null;
    S.hudDirty = true;

    DG.answerGate(2);
    assert.equal(S.player.correct, 1, 'the second accepted alternative also scores');
    assert.equal(S.player.wrong, 0);
    assert.equal(S.lastResult.correct, true);

    S.activeQ = { qType: 'choose', prompt: '2. Choose: It ____ cold. (was / were)', primary: 'was', variants: ['was', 'were'] };
    S.gates = [
        { label: 'was', lane: 0, correct: true, dist: 200 },
        { label: 'am', lane: 1, correct: false, dist: 200 },
        { label: 'were', lane: 2, correct: true, dist: 200 }
    ];
    S.gatesResolved = false;
    S.gateDist = 200;
    S.nextGateAt = 0;
    S.nextGateDist = 0;
    DG.answerGate(1);
    assert.equal(S.player.wrong, 1, 'the extra distractor is still wrong');
});

/* ---------------- pre-race flow ---------------- */

test('Solo starts with Solo/Multiplayer then Topic then Challenge', () => {
    const { DG, content } = loadDGWithDom();
    DG.sessionMode = 'solo';
    assert.deepEqual(Array.from(DG.flowOrder()),
        ['session', 'topic', 'challenge', 'cat', 'controls', 'count', 'scene']);
    assert.ok(DG.flowOrder().indexOf('mode') === -1);

    DG.showTopicStep();
    assert.equal(DG.menuStep, 'topic');
    assert.ok(content().indexOf('2. Choose your topic') !== -1);
    assert.ok(content().indexOf("DG.setTopic('tenses')") !== -1);
    assert.ok(content().indexOf("DG.setTopic('agreement')") !== -1);

    DG.showChallengeStep();
    assert.equal(DG.menuStep, 'challenge');
    assert.ok(content().indexOf('3. Choose your challenge') !== -1);
    assert.ok(content().indexOf('DG.showTopicStep()') !== -1);
});

test('Tenses still shows AV / PV / Mixed; Agreement shows Gap-fill / Choose / Mixed', () => {
    const { DG, content } = loadDGWithDom();
    DG.sessionMode = 'solo';

    DG.setTopic('tenses');
    DG.setBankMode('av');
    DG.showChallengeStep();
    let html = content();
    assert.ok(html.indexOf('Active Voice') !== -1);
    assert.ok(html.indexOf('Passive Voice') !== -1);
    assert.ok(html.indexOf("DG.setBankMode('mixed')") !== -1);
    assert.ok(html.indexOf('Gap-fill') === -1);
    assert.ok(html.indexOf('Topic: Tenses') !== -1);

    DG.setTopic('agreement');
    assert.equal(DG.readSettings().bankMode, 'gapfill');
    DG.showChallengeStep();
    html = content();
    assert.ok(html.indexOf('Gap-fill') !== -1);
    assert.ok(html.indexOf('Choose') !== -1);
    assert.ok(html.indexOf("DG.setBankMode('mixed')") !== -1);
    assert.ok(html.indexOf('Active Voice') === -1);
    assert.ok(html.indexOf('Topic: Agreement') !== -1);
    assert.ok(html.indexOf("DG.setBankMode('av')") === -1);
});

test('chooseSession / chooseMultiRole go to Topic; joiners never get the step', () => {
    const { DG } = loadDGWithDom();
    DG.chooseSession('solo');
    assert.equal(DG.sessionMode, 'solo');
    assert.equal(DG.menuStep, 'topic');

    const host = loadDGWithDom();
    host.DG.chooseMultiRole('create');
    assert.equal(host.DG.menuStep, 'topic');
    assert.deepEqual(Array.from(host.DG.flowOrder()),
        ['session', 'multi-entry', 'topic', 'challenge', 'cat', 'controls', 'count', 'scene']);

    const joiner = loadDGWithDom();
    joiner.DG.sessionMode = 'multi';
    joiner.DG.mpRole = 'join';
    assert.deepEqual(Array.from(joiner.DG.flowOrder()),
        ['session', 'multi-entry', 'cat', 'controls', 'join']);
    assert.ok(joiner.DG.flowOrder().indexOf('topic') === -1);
    assert.ok(joiner.DG.flowOrder().indexOf('challenge') === -1);
});

test('host can set topic + challenge type, a joiner cannot', () => {
    const { DG } = loadDGWithDom();
    DG.sessionMode = 'multi';
    DG.mpRole = 'create';
    assert.equal(DG.canEditHostSettings(), true);
    DG.setTopic('agreement');
    assert.equal(DG.readSettings().topic, 'agreement');
    assert.equal(DG.readSettings().bankMode, 'gapfill');
    DG.setBankMode('choose');
    assert.equal(DG.readSettings().bankMode, 'choose');
    // Not a valid Agreement challenge: ignored, not silently AV.
    DG.setBankMode('av');
    assert.equal(DG.readSettings().bankMode, 'choose');

    const joiner = loadDGWithDom();
    joiner.DG.sessionMode = 'multi';
    joiner.DG.mpRole = 'join';
    assert.equal(joiner.DG.canEditHostSettings(), false);
    joiner.DG.setTopic('agreement');
    assert.equal(joiner.DG.readSettings().topic, 'tenses');
    joiner.DG.setBankMode('gapfill');
    assert.equal(joiner.DG.readSettings().bankMode, 'av');
});

test('guests are still Solo only, then get the Topic step', () => {
    const { DG, content } = loadDGWithDom({}, { guest: true });
    DG.showSessionStep();
    assert.ok(content().indexOf('Guests can play Single Player only') !== -1);
    assert.ok(/disabled aria-disabled="true"/.test(content()));
    DG.chooseSession('solo');
    assert.equal(DG.menuStep, 'topic');
});

/* ---------------- multiplayer topic plumbing ---------------- */

function loadMultiplayer(DG) {
    const rpcCalls = [];
    const { element } = makeElementStore();
    const fakeSb = {
        from() {
            const chain = {
                select() { return chain; },
                eq() { return chain; },
                order() { return Promise.resolve({ data: [], error: null }); },
                maybeSingle() { return Promise.resolve({ data: null, error: null }); },
                update() {
                    return { eq() { return { eq() { return Promise.resolve({ data: null, error: null }); } }; } };
                }
            };
            return chain;
        },
        rpc(name, args) {
            rpcCalls.push({ name, args });
            return Promise.resolve({ data: { id: 'room-1', code: 'ABCD' }, error: null });
        }
    };
    const context = vm.createContext({
        window: { DG },
        globalThis: {},
        document: { getElementById: element },
        console,
        Math,
        Date,
        currentUser: { id: 'me', email: 'me@school.test' },
        isGuestUser: () => false,
        canUseCloud: () => true,
        previewStudentForm: () => false,
        changeView() {},
        backToTenses() {},
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout: () => 1,
        clearTimeout: () => {},
        navigator: { clipboard: null },
        sb: fakeSb
    });
    vm.runInContext(mpSource, context);
    if (!DG.raceState) DG.raceState = { active: false, mode: 'multi' };
    return { DG, rpcCalls, element };
}

test('Tenses rooms omit p_topic; Agreement rooms send it (and own hint file)', async () => {
    const { DG: base } = loadDGWithDom();
    const mp = loadMultiplayer(base);
    const DG = mp.DG;

    DG.readSettings().topic = 'tenses';
    DG.readSettings().bankMode = 'pv';
    DG.readSettings().questionCount = 30;
    DG.readSettings().scene = 'jungle';
    DG.mpCreate();
    await Promise.resolve();
    await Promise.resolve();
    let call = mp.rpcCalls.find(c => c.name === 'create_drive_and_go_room');
    assert.ok(call);
    assert.equal(call.args.p_question_mode, 'pv');
    assert.equal(Object.prototype.hasOwnProperty.call(call.args, 'p_topic'), false,
        'Tenses must still call the existing 7-argument function');

    DG.readSettings().topic = 'agreement';
    DG.readSettings().bankMode = 'choose';
    DG.mpCreate();
    await Promise.resolve();
    await Promise.resolve();
    call = mp.rpcCalls.filter(c => c.name === 'create_drive_and_go_room').pop();
    assert.equal(call.args.p_question_mode, 'choose');
    assert.equal(call.args.p_topic, 'agreement');

    assert.ok(DG.mpIsAgreementSqlMissing({ code: 'PGRST202', message: 'Could not find the function public.create_drive_and_go_room(p_topic)' }));
    assert.equal(DG.mpIsAgreementSqlMissing({ message: 'column "scene" does not exist' }), false);
    const hint = DG.mpSqlHintHTML('agreement');
    assert.ok(hint.indexOf('supabase/drive_and_go_agreement_topic.sql') !== -1);
    assert.ok(hint.indexOf('drive_and_go_scenes_and_boards.sql') === -1,
        'Agreement failures must not send the teacher to the older increments');
});

/* ---------------- SQL files ---------------- */

test('the incremental and full SQL both carry topic, widened modes and per-topic PBs', () => {
    const incremental = fs.readFileSync(path.join(__dirname, '../supabase/drive_and_go_agreement_topic.sql'), 'utf8');
    const full = fs.readFileSync(path.join(__dirname, '../supabase/drive_and_go.sql'), 'utf8');
    [incremental, full].forEach(sql => {
        assert.ok(/add column if not exists topic text not null default 'tenses'/.test(sql));
        assert.ok(sql.indexOf('gapfill') !== -1 && sql.indexOf('choose') !== -1);
        assert.ok(/p_topic text default 'tenses'/.test(sql));
        assert.ok(/partition by s\.user_id, s\.topic/.test(sql));
        assert.ok(/security_invoker = true/.test(sql));
    });
    assert.ok(/drop function if exists public\.create_drive_and_go_room\(text, text, text, text, text, int, text\);/.test(incremental),
        'the old 7-arg function must be dropped before the 8-arg one is created');
    assert.ok(/notify pgrst, 'reload schema'/.test(incremental));
});

/* ---------------- cloud rows + boards ---------------- */

test('cloudRunRow omits topic for Tenses and includes it for Agreement', () => {
    const user = { id: 'u1', email: 's1@school.test', user_metadata: { full_name: 'S1 Cat' } };
    const DG = loadDG({}, { currentUser: user, sb: {} });
    const pv = DG.cloudRunRow({
        bankMode: 'pv', questionCount: 30, composite: 1200, raceScore: 900,
        timeBonus: 300, correct: 30, wrong: 2, accuracy: 0.9, elapsed: 60, scene: 'jungle'
    }, null);
    assert.ok(pv);
    assert.equal(pv.bank_mode, 'pv');
    assert.equal(Object.prototype.hasOwnProperty.call(pv, 'topic'), false,
        'Tenses must insert without the new topic column');

    DG.readSettings().topic = 'agreement';
    DG.readSettings().bankMode = 'choose';
    const agreement = DG.cloudRunRow({
        topic: 'agreement', bankMode: 'choose', questionCount: 20, composite: 800,
        raceScore: 600, timeBonus: 200, correct: 20, wrong: 1, accuracy: 0.95, elapsed: 40, scene: 'desert'
    }, null);
    assert.ok(agreement);
    assert.equal(agreement.topic, 'agreement');
    assert.equal(agreement.bank_mode, 'choose');
});

test('dashboard + leaderboard row meta show topic and challenge, defaulting to Tenses', () => {
    const DG = loadDG();
    const ctx = vm.createContext({
        console,
        DG,
        isAdmin: () => false,
        sb: { from() { throw new Error('not queried in this test'); } },
        document: { getElementById() { return null; } },
        displayName: (r) => (r && (r.nickname || r.email)) || '?',
        escapeHtml: (t) => String(t == null ? '' : t),
        classBadge: () => '',
        formAssignControl: () => '',
        groupRowsByForm: (rows) => [{ id: '', label: 'Unassigned', rows: rows || [] }],
        renderFormSections: () => '',
        isMissingSchema: () => false,
        ensureFormDirectory: async () => ({})
    });
    vm.runInContext(adminSource, ctx);
    const meta = vm.runInContext('driveAndGoRowMeta', ctx);

    assert.ok(meta({ bank_mode: 'pv', question_count: 20, accuracy: 0.8, elapsed_ms: 60000 }).indexOf('Tenses · PV') !== -1);
    assert.ok(meta({ topic: 'agreement', bank_mode: 'gapfill', question_count: 20, accuracy: 0.8, elapsed_ms: 60000 }).indexOf('Agreement · Gap-fill') !== -1);
    assert.ok(meta({ topic: 'agreement', bank_mode: 'choose' }).indexOf('Agreement · Choose') !== -1);

    // The leaderboard renders the same label, and falls back to the old
    // column list before the Agreement SQL is pasted.
    assert.ok(leaderboardSource.indexOf('topicChallenge') !== -1);
    assert.ok(leaderboardSource.indexOf('baseColumns') !== -1);
    assert.ok(adminSource.indexOf('baseColumns') !== -1);
});

test('dashboard falls back to the old view columns when topic is missing', async () => {
    const DG = loadDG();
    const { element } = makeElementStore();
    const rows = [
        { nickname: 'Alice', email: 'a@school', bank_mode: 'pv', question_count: 20, composite: 900, elapsed_ms: 60000, accuracy: 0.8, plays: 2 }
    ];
    const selects = [];
    const fakeSb = {
        from(view) {
            let cols = '';
            const chain = {
                select(value) { cols = value; selects.push({ view, cols }); return chain; },
                order() { return chain; },
                limit() {
                    if (cols.indexOf('topic') !== -1) {
                        return Promise.resolve({ data: null, error: { message: 'column ' + view + '.topic does not exist' } });
                    }
                    return Promise.resolve({ data: rows, error: null });
                }
            };
            return chain;
        }
    };
    const ctx = vm.createContext({
        console,
        DG,
        isAdmin: () => true,
        sb: fakeSb,
        document: { getElementById: (id) => element(id) },
        displayName: (r) => (r && (r.nickname || r.email)) || '?',
        escapeHtml: (t) => String(t == null ? '' : t),
        classBadge: () => '',
        formAssignControl: () => '',
        groupRowsByForm: (list) => [{ id: '', label: 'Unassigned', rows: list || [] }],
        renderFormSections: (sections, fn, opts) => {
            const list = (sections && sections[0] && sections[0].rows) || [];
            return list.length ? fn(list) : ((opts && opts.emptyAll) || '');
        },
        isMissingSchema: () => false,
        ensureFormDirectory: async () => ({})
    });
    vm.runInContext(adminSource, ctx);
    await vm.runInContext('loadDriveAndGoAdmin()', ctx);

    assert.ok(selects.some(s => s.cols.indexOf('topic') !== -1), 'topic is requested first');
    assert.ok(selects.some(s => s.cols.indexOf('topic') === -1), 'falls back to the old columns');
    const html = element('dg-admin-solo-container').innerHTML;
    assert.ok(html.indexOf('Tenses · PV') !== -1, 'missing topic is shown as Tenses: ' + html);
    assert.equal(element('dg-admin-solo-container').innerHTML.indexOf('undefined'), -1);
});

/* ---------------- no bank-size label ---------------- */

test('no bank-size label is shown anywhere in the Drive & Go! UI', () => {
    const combined = source + '\n' + raceSource + '\n' + mpSource + '\n' + htmlSource;
    assert.ok(!/bank\s*size/i.test(combined));
    assert.ok(!/questions\s+in\s+(?:the\s+)?bank/i.test(combined));
    assert.ok(!/items\s+in\s+(?:the\s+)?bank/i.test(combined));
    assert.ok(!/\b\d+\s+questions?\s+(?:available|loaded)\b/i.test(combined));
});

// No network, credentials or database writes. Exercises the pure Drive & Go!
// question-bank / gate / item helpers used by the real game.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/grammar/drive-and-go.js'), 'utf8');
const raceSource = fs.readFileSync(path.join(__dirname, '../js/grammar/drive-and-go-race.js'), 'utf8');
const mpSource = fs.readFileSync(path.join(__dirname, '../js/grammar/drive-and-go-multiplayer.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function loadDG(store) {
    const ls = store || {};
    const context = vm.createContext({
        window: {},
        globalThis: {},
        localStorage: {
            getItem(k) { return Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null; },
            setItem(k, v) { ls[k] = String(v); },
            removeItem(k) { delete ls[k]; }
        },
        document: { getElementById() { return null; } },
        console
    });
    vm.runInContext(source, context);
    return vm.runInContext('DG', context);
}

// Loads drive-and-go.js with enough fake DOM to render every pre-race step
// (the functions themselves are what we assert on; nothing touches a browser).
function loadDGWithDom(store, opts) {
    const ls = store || {};
    const options = opts || {};
    const elements = {};
    const element = (id) => {
        if (!elements[id]) {
            elements[id] = {
                id,
                innerHTML: '',
                onclick: null,
                classList: {
                    add() {}, remove() {}, toggle() {}, contains() { return false; }
                }
            };
        }
        return elements[id];
    };
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
        isGuestUser: () => !!options.guest,
        canUseCloud: () => !options.guest,
        console
    });
    vm.runInContext(source, context);
    const DG = vm.runInContext('DG', context);
    const content = () => element('grammar-detail-content').innerHTML;
    return { DG, context, elements, element, content };
}

const SAMPLE = [
    'Question (Column A),Answer (Column B)',
    '"Present Simple",""',
    '"1. She ____ (go) to school every day.","goes"',
    '"2. My father ____ (work) in an office.","works"',
    '"3. Tom ____ (not/like) spicy food.","doesn\'t like / does not like"',
    '"Challenging",""',
    '"4. Neither twin ____ (enjoy) winter swimming.","enjoys"',
    '"Past Simple",""',
    '"5. We ____ (visit) the museum yesterday.","visited"',
    '"6. She ____ (go) to the party last night.","went"'
].join('\n');

test('AV/PV/Mixed map to the live tabs exactly, and PV never uses the wrong passive tab', () => {
    const DG = loadDG();
    assert.deepEqual(Array.from(DG.TAB_FOR_MODE.av), ['tenses']);
    assert.deepEqual(Array.from(DG.TAB_FOR_MODE.pv), ['Passives']);
    assert.deepEqual(Array.from(DG.TAB_FOR_MODE.mixed), ['tenses', 'Passives']);
    assert.ok(!/\bsheet=passive\b/i.test(source), 'the dictation topic "passive" must not be a question source');
    assert.ok(!/TAB_FOR_MODE[\s\S]{0,180}['"]passive['"]/.test(source), 'PV must use the exact tab name Passives');
});

test('CSV parser keeps tense sections, challenging flags and slash alternatives', () => {
    const DG = loadDG();
    const parsed = DG.parseQuestionSheet(SAMPLE, 'tenses');
    assert.equal(parsed.questions.length, 6);
    const go = parsed.questions[0];
    assert.equal(go.section, 'Present Simple');
    assert.equal(go.challenging, false);
    assert.equal(go.primary, 'goes');
    const like = parsed.questions[2];
    assert.deepEqual(Array.from(like.variants), ["doesn't like", 'does not like']);
    assert.equal(DG.normAnswer("doesn\u2019t like"), DG.normAnswer(like.variants[0]));
    const challenging = parsed.questions[3];
    assert.equal(challenging.challenging, true);
    assert.equal(challenging.section, 'Present Simple');
    const past = parsed.questions[4];
    assert.equal(past.section, 'Past Simple');
    assert.equal(past.challenging, false);
    assert.ok(parsed.bySection['tenses|Present Simple'].length >= 4);
});

test('every question gets three gates, one correct, never reusing the answer or an alternative', () => {
    const DG = loadDG();
    const parsed = DG.parseQuestionSheet(SAMPLE, 'tenses');
    const q = parsed.questions[2]; // doesn't like / does not like
    const section = parsed.bySection[q.sectionKey];
    const gates = DG.buildGates(q, section, parsed.bySheet, DG.makeRng(7));
    assert.equal(gates.length, 3);
    assert.equal(gates.filter(g => g.correct).length, 1);
    const labels = gates.map(g => DG.normAnswer(g.label));
    assert.equal(new Set(labels).size, 3);
    gates.forEach(g => {
        if (g.correct) return;
        assert.notEqual(DG.normAnswer(g.label), DG.normAnswer(q.primary));
        q.variants.forEach(v => assert.notEqual(DG.normAnswer(g.label), DG.normAnswer(v)));
    });
    // The correct lane is part of the shuffle, not a fixed lane.
    const lanes = new Set();
    for (let seed = 1; seed <= 20; seed++) {
        const shuffled = DG.buildGates(q, section, parsed.bySheet, DG.makeRng(seed));
        lanes.add(shuffled.find(g => g.correct).lane);
    }
    assert.ok(lanes.size >= 2, 'correct gate should move between lanes across seeds');
});

test('gates fall back to other sections of the same sheet when a section is too small', () => {
    const DG = loadDG();
    const parsed = DG.parseQuestionSheet(SAMPLE, 'tenses');
    const q = parsed.questions[0];
    const tiny = [parsed.bySection[q.sectionKey][0]];
    const gates = DG.buildGates(q, tiny, parsed.bySheet, DG.makeRng(3));
    assert.equal(gates.length, 3);
    assert.equal(gates.filter(g => g.correct).length, 1);
});

test('the five items follow their unlock rules', () => {
    const DG = loadDG();
    const rngLow = () => 0.01;
    const rngHigh = () => 0.99;
    assert.equal(DG.itemForCorrect({ item: null, combo: 1, challenging: true, rank: 3 }, rngHigh), 'lightning');
    assert.equal(DG.itemForCorrect({ item: null, combo: 6, challenging: false, rank: 3 }, rngHigh), 'star');
    assert.equal(DG.itemForCorrect({ item: null, combo: 3, challenging: false, rank: 3 }, rngHigh), 'mushroom');
    assert.equal(DG.itemForCorrect({ item: null, combo: 1, challenging: false, rank: 2 }, rngHigh), 'redshell');
    assert.equal(DG.itemForCorrect({ item: null, combo: 1, challenging: false, rank: 1 }, rngLow), 'banana');
    assert.equal(DG.itemForCorrect({ item: null, combo: 1, challenging: false, rank: 1 }, rngHigh), null);
    assert.equal(DG.itemForCorrect({ item: 'banana', combo: 6, challenging: true, rank: 3 }, rngLow), null, 'one simple item slot');
});

test('nitro and spin-out constants match the requested gameplay', () => {
    const DG = loadDG();
    assert.equal(DG.NITRO_KMH, 40);
    assert.equal(DG.SPIN_TIME, 1.5);
    assert.equal(DG.GATE_GAP, 420);
    assert.equal(DG.START_GATE_DIST, 320);
    assert.equal(DG.RACE_SECONDS, 180);
    assert.equal(DG.FINISH_DISTANCE, 4200);
});

test('same-verb distractors: wrote uses other write-forms, not unrelated verbs', () => {
    const DG = loadDG();
    const question = {
        prompt: '7. She ____ (write) a letter yesterday.',
        primary: 'wrote',
        variants: ['wrote'],
        hint: 'write',
        hintRaw: 'write',
        section: 'Past Simple',
        sectionKey: 'tenses|Past Simple',
        sheet: 'tenses'
    };
    const section = [
        { primary: 'wrote', variants: ['wrote'] },
        { primary: 'visited', variants: ['visited'] },
        { primary: 'went', variants: ['went'] },
        { primary: 'works', variants: ['works'] }
    ];
    const sheet = section.concat([
        { primary: 'goes', variants: ['goes'] },
        { primary: 'enjoys', variants: ['enjoys'] }
    ]);
    const writeLike = /\b(?:write|writes|wrote|written|writing)\b/i;
    const unrelated = /\b(?:visit|visited|go|goes|went|work|works|enjoy|enjoys)\b/i;
    for (let seed = 1; seed <= 12; seed++) {
        const gates = DG.buildGates(question, section, sheet, DG.makeRng(seed));
        assert.equal(gates.length, 3);
        const wrong = gates.filter(g => !g.correct);
        assert.equal(wrong.length, 2);
        wrong.forEach(g => {
            assert.ok(writeLike.test(g.label), 'expected a write-form, got ' + g.label);
            assert.ok(!unrelated.test(g.label), 'unrelated verb leaked: ' + g.label);
            assert.notEqual(DG.normAnswer(g.label), 'wrote');
        });
    }
});

test('same-verb distractors: is cleaned uses other clean passives', () => {
    const DG = loadDG();
    const question = {
        prompt: '3. The classroom ____ (clean) every morning.',
        primary: 'is cleaned',
        variants: ['is cleaned'],
        hint: 'clean',
        hintRaw: 'clean',
        section: 'Present Simple',
        sectionKey: 'Passives|Present Simple',
        sheet: 'Passives'
    };
    const section = [
        { primary: 'is cleaned', variants: ['is cleaned'] },
        { primary: 'was delivered', variants: ['was delivered'] },
        { primary: 'are written', variants: ['are written'] }
    ];
    const cleanPassive = /\bclean(?:ed|ing)?\b/i;
    const otherVerb = /\b(?:deliver|delivered|write|written|wrote)\b/i;
    const gates = DG.buildGates(question, section, section, DG.makeRng(4));
    const wrong = gates.filter(g => !g.correct);
    assert.equal(wrong.length, 2);
    wrong.forEach(g => {
        assert.ok(cleanPassive.test(g.label), 'expected a clean form, got ' + g.label);
        assert.ok(/\b(?:is|are|was|were|be|been|being|has|have|had|will)\b/i.test(g.label),
            'expected a passive, got ' + g.label);
        assert.ok(!otherVerb.test(g.label), 'unrelated verb leaked: ' + g.label);
        assert.notEqual(DG.normAnswer(g.label), 'is cleaned');
    });
});

test('parseVerbHint reads the lemma and polarity from (not/like)', () => {
    const DG = loadDG();
    const parsed = DG.parseVerbHint({
        prompt: '3. Tom ____ (not/like) spicy food.',
        primary: "doesn't like",
        variants: ["doesn't like", 'does not like']
    });
    assert.equal(parsed.lemma, 'like');
    assert.equal(parsed.negative, true);
});

test('question-count settings validate against 20/25/30/35/40/50 and default to 20', () => {
    const DG = loadDG();
    assert.deepEqual(Array.from(DG.QUESTION_COUNTS), [20, 25, 30, 35, 40, 50]);
    assert.equal(DG.normalizeQuestionCount(25), 25);
    assert.equal(DG.normalizeQuestionCount(50), 50);
    assert.equal(DG.normalizeQuestionCount(15), 20);
    assert.equal(DG.normalizeQuestionCount(60), 20);
    assert.equal(DG.normalizeQuestionCount('nope'), 20);
    assert.equal(DG.defaultSettings().questionCount, 20);
    assert.equal(DG.readSettings().questionCount, 20);

    const saved = loadDG({
        learniTY_dg_settings: JSON.stringify({ bankMode: 'pv', controls: 'swipe', questionCount: 35 })
    });
    assert.equal(saved.readSettings().questionCount, 35);
    assert.equal(saved.readSettings().bankMode, 'pv');

    const bad = loadDG({
        learniTY_dg_settings: JSON.stringify({ questionCount: 12 })
    });
    assert.equal(bad.readSettings().questionCount, 20);
});

test('composite score adds a faster-finish time bonus of TIME_BONUS_FACTOR * N / elapsed', () => {
    const DG = loadDG();
    assert.equal(DG.TIME_BONUS_FACTOR, 4000);
    assert.equal(DG.timeBonus(100, 20), 800);
    assert.equal(DG.timeBonus(200, 20), 400);
    assert.equal(DG.timeBonus(200, 50), 1000);
    assert.ok(DG.timeBonus(80, 20) > DG.timeBonus(160, 20));
    const result = DG.scoreRun({ score: 500, correct: 20, wrong: 2 }, 100, 20);
    assert.equal(result.raceScore, 500);
    assert.equal(result.timeBonus, 800);
    assert.equal(result.composite, 1300);
    assert.equal(result.questionCount, 20);
    assert.equal(result.attempts, 22);
    assert.ok(Math.abs(result.accuracy - 20 / 22) < 1e-9);
});

test('accel constants are a bounded hold-to-speed bonus', () => {
    const DG = loadDG();
    assert.equal(DG.ACCEL_KMH, 110);
    assert.equal(DG.SPEED_CAP, 340);
    assert.ok(DG.ACCEL_KMH > 0);
    assert.ok(DG.SPEED_CAP >= 100 + DG.ACCEL_KMH);
    assert.ok(DG.SPEED_CAP < 400);
});

test('three courses: exact ids, labels and a remembered default', () => {
    const DG = loadDG();
    assert.deepEqual(Array.from(DG.SCENES), ['desert', 'stadium', 'jungle']);
    assert.equal(DG.SCENE_LABEL.desert, 'Desert Hills');
    assert.equal(DG.SCENE_LABEL.stadium, 'Peach Stadium');
    assert.equal(DG.SCENE_LABEL.jungle, 'Dino Dino Jungle');
    assert.equal(DG.defaultSettings().scene, 'desert');
    assert.equal(DG.readSettings().scene, 'desert');
    assert.equal(DG.normalizeScene('stadium'), 'stadium');
    assert.equal(DG.normalizeScene('JUNGLE'), 'jungle');
    assert.equal(DG.normalizeScene('moon'), 'desert');
    assert.equal(DG.normalizeScene(null), 'desert');

    const saved = loadDG({
        learniTY_dg_settings: JSON.stringify({ bankMode: 'mixed', controls: 'tilt', questionCount: 30, scene: 'jungle' })
    });
    assert.equal(saved.readSettings().scene, 'jungle');
    assert.equal(saved.readSettings().questionCount, 30);

    const bad = loadDG({
        learniTY_dg_settings: JSON.stringify({ scene: 'volcano' })
    });
    assert.equal(bad.readSettings().scene, 'desert');
});

test('analog tilt maps a lean to a continuous lane target (0 left, 2 right)', () => {
    const DG = loadDG();
    assert.ok(DG.TILT_DEAD > 0 && DG.TILT_DEAD < 4);
    assert.ok(DG.TILT_FULL >= 12);

    // At rest (and inside the soft deadzone) the kart stays centred.
    assert.equal(DG.tiltLaneTarget(0), 1);
    assert.ok(Math.abs(DG.tiltLaneTarget(1) - 1) < 1e-9);
    assert.ok(Math.abs(DG.tiltLaneTarget(-1.5) - 1) < 1e-9);
    assert.ok(Math.abs(DG.tiltLaneTarget(DG.TILT_DEAD - 0.01) - 1) < 1e-9);

    // Hard lean reaches the edges, and values in between are continuous.
    assert.equal(DG.tiltLaneTarget(-90), 0);
    assert.equal(DG.tiltLaneTarget(-DG.TILT_FULL), 0);
    assert.equal(DG.tiltLaneTarget(DG.TILT_FULL), 2);
    assert.equal(DG.tiltLaneTarget(90), 2);

    const middle = [3, 4, 6, 8, 10, 11].map(deg => DG.tiltLaneTarget(deg));
    middle.forEach(v => assert.ok(v > 1 && v < 2, 'expected a fractional lane, got ' + v));
    const negMiddle = [-3, -4, -6, -8, -10, -11].map(deg => DG.tiltLaneTarget(deg));
    negMiddle.forEach(v => assert.ok(v >= 0 && v < 1, 'expected a fractional lane, got ' + v));

    // Monotonic and symmetric: more lean = further out, and sign mirrors.
    for (let i = 1; i < middle.length; i++) assert.ok(middle[i] > middle[i - 1]);
    middle.forEach((v, i) => assert.ok(Math.abs((2 - v) - negMiddle[i]) < 1e-9));

    // A normal ~7° wrist lean already reaches the next lane (full tilt at 12°).
    assert.ok(DG.tiltLaneTarget(7) >= 1.5, 'a normal lean should cross into the next lane');
    assert.ok(DG.tiltLaneTarget(-7) <= 0.5, 'a normal lean should cross into the next lane');
    assert.ok(Math.abs(DG.tiltLaneTarget(4) - 1) < 0.5, 'small leans stay gentle');

    // A non-numeric reading never throws and stays centred.
    assert.equal(DG.tiltLaneTarget(NaN), 1);
    assert.equal(DG.tiltLaneTarget(undefined), 1);
});

test('nearestLane rounds a fractional lane position and clamps to 0..2', () => {
    const DG = loadDG();
    assert.equal(DG.nearestLane(0), 0);
    assert.equal(DG.nearestLane(0.49), 0);
    assert.equal(DG.nearestLane(0.5), 1);
    assert.equal(DG.nearestLane(1), 1);
    assert.equal(DG.nearestLane(1.5), 2);
    assert.equal(DG.nearestLane(1.94), 2);
    assert.equal(DG.nearestLane(-3), 0);
    assert.equal(DG.nearestLane(9), 2);
    assert.equal(DG.nearestLane(NaN), 1);
});

test('all three Drive & Go scripts are classic scripts and parse', () => {
    assert.ok(!/\bexport\s|\bimport\s/.test(source + raceSource + mpSource));
    assert.ok(mpSource.indexOf('drive_and_go_question_count.sql') !== -1);
    assert.ok(mpSource.indexOf('p_question_count') !== -1);
    new vm.Script(source);
    new vm.Script(raceSource);
    new vm.Script(mpSource);
});

/* ---------------- pre-race flow: Solo / Multi first ---------------- */

test('Drive & Go! opens on Solo or Multiplayer and never on the old game-mode step', () => {
    const { DG, content } = loadDGWithDom();
    DG.showSessionStep();
    assert.equal(DG.menuStep, 'session');
    const html = content();
    assert.ok(/Solo or Multiplayer\?/.test(html));
    assert.ok(html.indexOf("DG.chooseSession('solo')") !== -1);
    assert.ok(html.indexOf("DG.chooseSession('multi')") !== -1);
    // No challenge / cat / course yet — and no final "Game mode" question.
    assert.ok(html.indexOf('Choose your challenge') === -1);
    assert.ok(html.indexOf('Game mode') === -1);
    assert.ok(!/DG\.showModeStep\(\)/.test(html));
    assert.ok(/showDriveAndGo[\s\S]{0,360}showSessionStep/.test(source),
        'a fresh Drive & Go! entry still opens the Solo / Multiplayer step');
});

test('Solo flow is session → challenge → cat → controls → count → scene and skips game mode', () => {
    const { DG, content } = loadDGWithDom();
    DG.sessionMode = 'solo';
    assert.deepEqual(Array.from(DG.flowOrder()), ['session', 'challenge', 'cat', 'controls', 'count', 'scene']);
    assert.ok(DG.flowOrder().indexOf('mode') === -1);

    DG.showChallengeStep();
    assert.equal(DG.menuStep, 'challenge');
    assert.ok(content().indexOf('2. Choose your challenge') !== -1);
    assert.ok(content().indexOf('DG.showSessionStep()') !== -1);

    DG.showCatStep();
    assert.equal(DG.menuStep, 'cat');
    assert.ok(content().indexOf('3. Customize your cat driver') !== -1);

    DG.showControlsStep();
    assert.equal(DG.menuStep, 'controls');
    assert.ok(content().indexOf('4. Choose your controls') !== -1);

    DG.showCountStep();
    assert.equal(DG.menuStep, 'count');
    assert.ok(content().indexOf('5. How many questions?') !== -1);

    DG.showSceneStep();
    assert.equal(DG.menuStep, 'scene');
    const html = content();
    assert.ok(html.indexOf('6. Choose a course') !== -1);
    // Solo starts immediately after the course; there is no game-mode step.
    assert.ok(html.indexOf('DG.launchSolo()') !== -1);
    assert.ok(html.indexOf('Start race') !== -1);
    assert.ok(html.indexOf('DG.showModeStep()') === -1);
    assert.ok(html.indexOf('Game mode') === -1);
});

test('Multiplayer asks Create or Join before any settings', () => {
    const { DG, content } = loadDGWithDom();
    DG.sessionMode = 'multi';
    DG.mpRole = '';
    assert.deepEqual(Array.from(DG.flowOrder()), ['session', 'multi-entry']);

    DG.showMultiplayerEntryStep();
    assert.equal(DG.menuStep, 'multi-entry');
    const html = content();
    assert.ok(html.indexOf("DG.chooseMultiRole('create')") !== -1);
    assert.ok(html.indexOf("DG.chooseMultiRole('join')") !== -1);
    // Create / Join is asked before challenge, count or course.
    assert.ok(html.indexOf('Choose your challenge') === -1);
    assert.ok(html.indexOf('How many questions') === -1);
    assert.ok(html.indexOf('Choose a course') === -1);
    // The very first step is still Solo / Multiplayer.
    assert.deepEqual(Array.from(DG.flowOrder()).slice(0, 2), ['session', 'multi-entry']);
});

test('multiplayer host picks challenge, count and course, then creates the room', () => {
    const { DG, content } = loadDGWithDom();
    DG.sessionMode = 'multi';
    DG.mpRole = 'create';
    assert.deepEqual(Array.from(DG.flowOrder()),
        ['session', 'multi-entry', 'challenge', 'cat', 'controls', 'count', 'scene']);
    assert.equal(DG.canEditHostSettings(), true);

    DG.showChallengeStep();
    assert.ok(content().indexOf('3. Choose your challenge') !== -1);
    assert.ok(content().indexOf('DG.showMultiplayerEntryStep()') !== -1);

    DG.setBankMode('mixed');
    assert.equal(DG.readSettings().bankMode, 'mixed');
    DG.setQuestionCount(40);
    assert.equal(DG.readSettings().questionCount, 40);
    DG.setScene('stadium');
    assert.equal(DG.readSettings().scene, 'stadium');

    DG.showSceneStep();
    const html = content();
    assert.ok(html.indexOf('7. Choose a course') !== -1);
    assert.ok(html.indexOf('DG.mpCreate()') !== -1);
    assert.ok(html.indexOf('Create room') !== -1);
    assert.ok(html.indexOf('DG.launchSolo()') === -1);
    // The existing RPC already takes the count and the scene.
    assert.ok(/create_drive_and_go_room/.test(mpSource));
    assert.ok(/p_question_count/.test(mpSource) && /p_scene/.test(mpSource));
});

test('a joiner follows the host settings but still picks a character and controls', () => {
    const { DG, content } = loadDGWithDom({
        learniTY_dg_settings: JSON.stringify({ bankMode: 'av', questionCount: 20, scene: 'desert' })
    });
    DG.sessionMode = 'multi';
    DG.mpRole = 'join';
    assert.deepEqual(Array.from(DG.flowOrder()), ['session', 'multi-entry', 'cat', 'controls', 'join']);
    assert.equal(DG.canEditHostSettings(), false);

    // Host-owned settings cannot be changed by a joiner.
    DG.setBankMode('pv');
    DG.setQuestionCount(50);
    DG.setScene('jungle');
    assert.equal(DG.readSettings().bankMode, 'av');
    assert.equal(DG.readSettings().questionCount, 20);
    assert.equal(DG.readSettings().scene, 'desert');

    // Per-player look and controls still work.
    DG.setLook('cat', 'Black');
    assert.equal(DG.readSettings().cat, 'Black');
    DG.chooseControls('swipe');
    assert.equal(DG.readSettings().controls, 'swipe');

    DG.showJoinStep();
    assert.equal(DG.menuStep, 'join');
    const html = content();
    assert.ok(html.indexOf('5. Join the room') !== -1);
    assert.ok(html.indexOf('dg-join-code') !== -1);
    assert.ok(html.indexOf('DG.mpJoin()') !== -1);
    // No challenge / count / course controls for joiners.
    assert.ok(html.indexOf('Choose your challenge') === -1);
    assert.ok(html.indexOf('How many questions') === -1);
    assert.ok(html.indexOf('Choose a course') === -1);
});

test('guests only get Solo on the first step', () => {
    const { DG, content } = loadDGWithDom({}, { guest: true });
    DG.showSessionStep();
    const html = content();
    assert.ok(html.indexOf('Guests can play Single Player only') !== -1);
    assert.ok(/disabled aria-disabled="true"/.test(html));
    assert.ok(html.indexOf("DG.chooseSession('multi')") === -1);
});

/* ---------------- steering ---------------- */

function loadRace(DG) {
    const context = vm.createContext({
        window: { DG },
        globalThis: {},
        document: { getElementById() { return null; } },
        console
    });
    vm.runInContext(raceSource, context);
    return DG;
}

/* Loads drive-and-go-multiplayer.js with a fake DOM + fake Supabase so the
   join / poll sequence can be exercised without a browser or a database. */
function loadMultiplayer(DG, options) {
    const opts = options || {};
    const calls = {
        changeView: [],
        backToTenses: 0,
        abandons: 0,
        begins: 0,
        showSessionStep: 0,
        showMultiplayerMenu: 0,
        rpc: [],
        intervals: 0,
        timeouts: []
    };
    const elements = {};
    // Share the DOM store with drive-and-go.js when the caller passes the
    // element helper from loadDGWithDom(), so menuContent() sees the same
    // #grammar-detail-content node as the multiplayer helpers.
    const element = opts.element || ((id) => {
        if (!elements[id]) {
            elements[id] = {
                id,
                innerHTML: '',
                textContent: '',
                value: '',
                onclick: null,
                classList: {
                    add() {}, remove() {}, toggle() {}, contains() { return false; }
                }
            };
        }
        return elements[id];
    });
    const db = opts.db || { room: null, players: [] };
    const fake = {
        from(table) {
            if (table === 'drive_and_go_rooms') {
                return {
                    select() { return this; },
                    eq() { return this; },
                    maybeSingle() { return Promise.resolve({ data: db.room, error: db.error || null }); }
                };
            }
            return {
                select() { return this; },
                eq() { return this; },
                order() { return Promise.resolve({ data: db.players, error: db.error || null }); },
                update() {
                    return { eq() { return { eq() { return Promise.resolve({ data: null, error: null }); } }; } };
                }
            };
        },
        rpc(name, args) {
            calls.rpc.push({ name, args });
            if (name === 'leave_drive_and_go_room') calls.leaveCalls = (calls.leaveCalls || 0) + 1;
            if (name === 'join_drive_and_go_room') return Promise.resolve({ data: opts.joinRoom || db.room, error: opts.joinError || null });
            return Promise.resolve({ data: db.room, error: null });
        }
    };
    const context = vm.createContext({
        window: { DG },
        globalThis: {},
        document: {
            getElementById: (id) => (opts.missingContent && id === 'grammar-detail-content') ? null : element(id)
        },
        console,
        Math,
        Date,
        currentUser: opts.currentUser === undefined ? { id: 'me', email: 'me@school.test' } : opts.currentUser,
        isGuestUser: () => !!opts.guest,
        canUseCloud: () => !opts.guest,
        previewStudentForm: () => false,
        changeView: (view) => calls.changeView.push(view),
        backToTenses: () => { calls.backToTenses += 1; },
        setInterval: () => { calls.intervals += 1; return 1; },
        clearInterval: () => {},
        setTimeout: (fn) => { calls.timeouts.push(fn); return calls.timeouts.length; },
        clearTimeout: () => {},
        navigator: { clipboard: null },
        sb: fake
    });
    vm.runInContext(mpSource, context);
    if (!DG.raceState) DG.raceState = { active: false, mode: 'multi' };
    DG.mpAbandon = function () { calls.abandons += 1; };
    DG.mpBeginRace = function () { calls.begins += 1; };
    const showSession = DG.showSessionStep;
    DG.showSessionStep = function () { calls.showSessionStep += 1; return showSession.apply(DG, arguments); };
    const showMenu = DG.showMultiplayerMenu;
    DG.showMultiplayerMenu = function () { calls.showMultiplayerMenu += 1; return showMenu.apply(DG, arguments); };
    return { DG, context, element, calls, db };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

const MP_ROOM = {
    id: 'room-1',
    code: 'ABCD',
    host_id: 'host',
    status: 'waiting',
    question_mode: 'av',
    question_count: 20,
    scene: 'desert',
    seed: 7
};

const MP_PLAYERS = [
    { user_id: 'host', email: 'host@school.test', nickname: 'Host Cat', correct: 0, distance: 0 },
    { user_id: 'me', email: 'me@school.test', nickname: 'Joiner Cat', correct: 0, distance: 0 }
];

test('discrete steering keeps its lane target instead of snapping back to centre (PR #26 regression)', () => {
    const DG = loadDG();
    assert.equal(typeof DG.laneStep, 'function');

    // Press LEFT from the centre lane: lane becomes 0 at once and laneX moves
    // toward it. It must never be overwritten back to lane 1 mid-move.
    let state = { lane: 1, laneX: 1 };
    state.lane = 0;
    let snappedBack = false;
    for (let i = 0; i < 120; i++) {
        state = DG.laneStep(state, 1 / 120, null);
        if (state.lane !== 0) snappedBack = true;
    }
    assert.equal(snappedBack, false, 'the discrete lane target was overwritten by laneX');
    assert.equal(state.lane, 0);
    assert.ok(state.laneX < 0.001, 'kart never reached the left lane');

    // RIGHT from the left lane works the same way.
    state.lane = 2;
    for (let i = 0; i < 120; i++) state = DG.laneStep(state, 1 / 120, null);
    assert.equal(state.lane, 2);
    assert.ok(state.laneX > 1.999);

    // CENTER returns to the middle lane.
    state.lane = 1;
    for (let i = 0; i < 120; i++) state = DG.laneStep(state, 1 / 120, null);
    assert.equal(state.lane, 1);
    assert.ok(Math.abs(state.laneX - 1) < 0.001);

    // The race loop must use the shared helper and must not write lane back
    // from laneX (the exact bug).
    assert.match(raceSource, /DG\.laneStep\(p, dt, laneTarget\)/);
    assert.ok(!/p\.lane\s*=\s*DG\.nearestLane\(p\.laneX\)/.test(raceSource),
        'updateRace must not overwrite the button / key / swipe lane from laneX');
});

test('analog tilt moves laneX and the gate lane follows the real position', () => {
    const DG = loadDG();
    let state = { lane: 1, laneX: 1 };
    for (let i = 0; i < 120; i++) state = DG.laneStep(state, 1 / 120, DG.tiltLaneTarget(16));
    assert.equal(state.lane, 2);
    assert.ok(Math.abs(state.laneX - 2) < 0.001);

    for (let i = 0; i < 120; i++) state = DG.laneStep(state, 1 / 120, DG.tiltLaneTarget(-16));
    assert.equal(state.lane, 0);
    assert.ok(Math.abs(state.laneX) < 0.001);

    for (let i = 0; i < 120; i++) state = DG.laneStep(state, 1 / 120, DG.tiltLaneTarget(0));
    assert.equal(state.lane, 1);
    assert.ok(Math.abs(state.laneX - 1) < 0.001);

    // A gentle lean rounds to the nearest gate lane but keeps a fractional
    // screen position, so the kart still moves smoothly.
    const gentle = DG.laneStep({ lane: 1, laneX: 1 }, 1 / 60, DG.tiltLaneTarget(4));
    assert.ok(gentle.laneX > 1);
    assert.equal(gentle.lane, DG.nearestLane(gentle.laneX));
});

test('swipe direction maps to left / right and ignores taps', () => {
    const DG = loadRace(loadDG());
    assert.equal(DG.swipeStep(-80), -1);
    assert.equal(DG.swipeStep(80), 1);
    assert.equal(DG.swipeStep(-32), -1);
    assert.equal(DG.swipeStep(31), 0);
    assert.equal(DG.swipeStep(0), 0);
    assert.equal(DG.swipeStep(NaN), 0);
    assert.ok(/DG\.swipeStep\(e\.clientX - S\.swipe\.x\)/.test(raceSource));
});

test('every control path calls setLane / steer, which only changes the discrete target', () => {
    // Keyboard, the three on-screen buttons and swipe all end in setLane.
    assert.ok(/onclick="DG\.setLane\(0\)"/.test(htmlSource));
    assert.ok(/onclick="DG\.setLane\(1\)"/.test(htmlSource));
    assert.ok(/onclick="DG\.setLane\(2\)"/.test(htmlSource));
    assert.match(raceSource, /key === 'ArrowLeft'[\s\S]{0,120}DG\.steer\(-1\)/);
    assert.match(raceSource, /key === 'ArrowRight'[\s\S]{0,120}DG\.steer\(1\)/);
    assert.match(raceSource, /DG\.swipeStep\([\s\S]{0,120}DG\.steer\(dir\)/);
    assert.match(raceSource, /DG\.setLane = function \(lane\)[\s\S]{0,400}S\.player\.lane = n/);
    assert.ok(!/S\.player\.laneX\s*=\s*n/.test(raceSource));
});

/* ---------------- multiplayer join must never bounce the player home ---------------- */

test('a successful join stays in the room lobby and never navigates home', async () => {
    const loaded = loadDGWithDom();
    const { DG, element, calls } = loadMultiplayer(loaded.DG, { element: loaded.element, db: { room: MP_ROOM, players: MP_PLAYERS } });
    element('dg-join-code').value = 'abcd';

    DG.mpJoin();
    await tick();
    await tick();

    assert.equal(DG.mpState.room && DG.mpState.room.id, 'room-1');
    assert.equal(DG.mpState.joinCode, 'ABCD');
    assert.ok(DG.mpState.joinedAt > 0, 'the join settle window should start at join time');
    assert.deepEqual(Array.from(calls.changeView), [], 'join must not call changeView');
    assert.equal(calls.backToTenses, 0, 'join must not call backToTenses');
    assert.equal(calls.showSessionStep, 0, 'join must not drop back to the Solo / Multiplayer step');
    assert.equal(calls.showMultiplayerMenu, 0, 'join must not show the Create / Join screen');
    assert.equal(calls.leaveCalls || 0, 0, 'join must not call leave_drive_and_go_room');
    assert.equal(calls.abandons, 0, 'join must not abandon the room');
    assert.ok(element('grammar-detail-content').innerHTML.indexOf('Race lobby') !== -1,
        'the joiner must see the lobby');
});

test('lobby and mid-race room updates never call changeView or backToTenses', async () => {
    const loaded = loadDGWithDom();
    const { DG, element, calls, db } = loadMultiplayer(loaded.DG, { element: loaded.element, db: { room: MP_ROOM, players: MP_PLAYERS } });
    DG.mpState.room = MP_ROOM;
    DG.mpState.joinedAt = Date.now();

    DG.mpPoll();
    await tick();
    await tick();
    assert.equal(calls.changeView.length, 0);
    assert.equal(calls.backToTenses, 0);
    assert.equal(calls.abandons, 0);
    assert.equal(calls.showSessionStep, 0);
    assert.equal(calls.showMultiplayerMenu, 0);
    assert.ok(element('grammar-detail-content').innerHTML.indexOf('Race lobby') !== -1);

    // The host started: the joiner is told to begin the race, not sent home.
    db.room = Object.assign({}, MP_ROOM, { status: 'playing' });
    db.players = MP_PLAYERS.map(p => Object.assign({}, p, { correct: 3 }));
    DG.mpPoll();
    await tick();
    await tick();
    assert.equal(calls.begins, 1, 'a playing room should begin the race');
    assert.equal(calls.changeView.length, 0);
    assert.equal(calls.backToTenses, 0);
    assert.equal(calls.abandons, 0);
    assert.equal(calls.leaveCalls || 0, 0);

    // A later update while the race is already live must be ignored, not
    // treated as a reason to leave the race view.
    DG.raceState.active = true;
    DG.mpPoll();
    await tick();
    await tick();
    assert.equal(calls.begins, 1, 'an active race does not restart');
    assert.equal(calls.changeView.length, 0);
    assert.equal(calls.backToTenses, 0);
    assert.equal(calls.abandons, 0);
    assert.equal(calls.leaveCalls || 0, 0);
});

test('a transient missing membership row waits and rejoins instead of ejecting', async () => {
    const loaded = loadDGWithDom();
    const { DG, element, calls, db } = loadMultiplayer(loaded.DG, {
        element: loaded.element,
        db: { room: MP_ROOM, players: [] },
        joinRoom: MP_ROOM
    });
    DG.mpState.room = MP_ROOM;
    DG.mpState.joinedAt = Date.now();
    const before = element('grammar-detail-content').innerHTML = '<p>join step</p>';

    DG.mpPoll();
    await tick();
    assert.equal(calls.changeView.length, 0);
    assert.equal(calls.backToTenses, 0);
    assert.equal(calls.leaveCalls || 0, 0);
    assert.equal(DG.mpState.missingMePolls, 1, 'the first miss is just a retry');
    assert.equal(element('grammar-detail-content').innerHTML, before, 'the join step must not be replaced');

    DG.mpPoll();
    await tick();
    assert.equal(calls.changeView.length, 0);
    assert.equal(DG.mpState.missingMePolls, 2);

    DG.mpPoll();
    await tick();
    await tick();
    assert.ok(calls.rpc.some(r => r.name === 'join_drive_and_go_room'),
        'the third miss should re-enter the same room by code');
    assert.equal(calls.changeView.length, 0);
    assert.equal(calls.backToTenses, 0);
    assert.equal(calls.leaveCalls || 0, 0);
});

test('a room update that cannot find the room shows a local panel, not the Hub', async () => {
    const loaded = loadDGWithDom();
    const { DG, element, calls, db } = loadMultiplayer(loaded.DG, { element: loaded.element, db: { room: null, players: [] } });
    DG.mpState.room = MP_ROOM;
    DG.mpState.joinedAt = Date.now() - 20000;

    DG.mpPoll();
    await tick();
    DG.mpPoll();
    await tick();
    DG.mpPoll();
    await tick();
    await tick();

    assert.equal(calls.changeView.length, 0);
    assert.equal(calls.backToTenses, 0);
    assert.equal(calls.leaveCalls || 0, 0);
    assert.ok(element('grammar-detail-content').innerHTML.indexOf('Room closed') !== -1);
    assert.equal(db.room, null);
});

test('a settling joiner keeps their seat on a passive view change', () => {
    const loaded = loadDGWithDom();
    const { DG, calls } = loadMultiplayer(loaded.DG, { element: loaded.element, db: { room: MP_ROOM, players: MP_PLAYERS } });
    DG.mpState.room = MP_ROOM;
    DG.mpState.joinedAt = Date.now();

    DG.onLeaveView('hub-view');
    assert.equal(calls.abandons, 0, 'a view change during join settling must not leave the room');
    assert.ok(DG.mpState.detachTimer, 'the seat should be released later if the player really left');

    DG.mpState.joinedAt = Date.now() - 20000;
    DG.onLeaveView('hub-view');
    assert.equal(calls.abandons, 1, 'after settling, an ordinary leave still abandons the room');
});

test('the poll planner never navigates and classifies lobby / race / results / closed', () => {
    const loaded = loadDGWithDom();
    const { DG } = loadMultiplayer(loaded.DG, { element: loaded.element, db: { room: MP_ROOM, players: MP_PLAYERS } });
    const plan = (room, players, ctx) => DG.mpRoomUpdatePlan(room, players, ctx);
    const notMember = [{ user_id: 'host', nickname: 'Host' }];

    const lobby = plan(MP_ROOM, MP_PLAYERS, { meId: 'me' });
    assert.equal(lobby.kind, 'lobby');
    assert.equal(lobby.navigate, false);

    const begin = plan(Object.assign({}, MP_ROOM, { status: 'playing' }), MP_PLAYERS, { meId: 'me' });
    assert.equal(begin.kind, 'begin');
    assert.equal(begin.navigate, false);

    const sync = plan(Object.assign({}, MP_ROOM, { status: 'playing' }), MP_PLAYERS, { meId: 'me', raceActive: true });
    assert.equal(sync.kind, 'sync');
    assert.equal(sync.navigate, false);

    const results = plan(Object.assign({}, MP_ROOM, { status: 'finished' }), MP_PLAYERS, { meId: 'me', raceActive: true });
    assert.equal(results.kind, 'results');
    assert.equal(results.navigate, false);

    const retry = plan(MP_ROOM, notMember, { meId: 'me', missingMePolls: 1 });
    assert.equal(retry.kind, 'wait');
    assert.equal(retry.missingMePolls, 2);

    const rejoin = plan(MP_ROOM, notMember, { meId: 'me', missingMePolls: 2 });
    assert.equal(rejoin.kind, 'rejoin');
    assert.equal(rejoin.navigate, false);

    const waitRoom = plan(null, [], { meId: 'me', missingMePolls: 0 });
    assert.equal(waitRoom.kind, 'wait');
    const closed = plan(null, [], { meId: 'me', missingMePolls: 2 });
    assert.equal(closed.kind, 'closed');
    assert.equal(closed.navigate, false);
});

/* ---------------- multiplayer progress corner board ---------------- */

test('progress board lists remaining racers by correct answers with N as the bar', () => {
    const loaded = loadDGWithDom();
    const { DG } = loadMultiplayer(loaded.DG, { element: loaded.element, db: { room: MP_ROOM, players: MP_PLAYERS } });
    const board = DG.mpProgressBoard([
        { user_id: 'me', nickname: 'Joiner Cat', correct: 3, distance: 40 },
        { user_id: 'host', nickname: 'Host Cat', correct: 8, distance: 120 },
        { user_id: 'done', nickname: 'Done Cat', correct: 20, distance: 900, finished_at: '2026-01-01T00:00:00Z' }
    ], { meId: 'me', questionCount: 20, mode: 'multi' });

    assert.equal(board.visible, true);
    assert.equal(board.total, 20);
    assert.deepEqual(Array.from(board.rows.map(r => r.name)), ['Host Cat', 'Joiner Cat']);
    assert.equal(board.rows[0].fraction, 0.4);
    assert.equal(board.rows[0].barWidth, 40);
    assert.equal(board.rows[0].percent, 40);
    assert.equal(board.rows[1].isMe, true);
    assert.equal(board.rows[1].fraction, 0.15);
    assert.equal(board.finishedCount, 1);
    assert.equal(board.remainingCount, 2);
    assert.ok(board.finished.every(r => r.finished));
    assert.equal(board.me.correct, 3);

    const html = DG.mpProgressHTML(board);
    assert.ok(html.indexOf('Race to 20 correct') !== -1);
    assert.ok(html.indexOf('width:40%') !== -1);
    assert.ok(html.indexOf('(you)') !== -1);
    assert.ok(html.indexOf('8/20') !== -1);
    assert.ok(html.indexOf('120 m') !== -1);
});

test('progress board uses distance only as a tie-break and stays hidden in solo', () => {
    const loaded = loadDGWithDom();
    const { DG } = loadMultiplayer(loaded.DG, { element: loaded.element, db: { room: MP_ROOM, players: MP_PLAYERS } });
    const board = DG.mpProgressBoard([
        { user_id: 'a', nickname: 'A', correct: 5, distance: 10 },
        { user_id: 'b', nickname: 'B', correct: 5, distance: 90 },
        { user_id: 'c', nickname: 'C', correct: 4, distance: 500 }
    ], { meId: 'c', questionCount: 20, mode: 'multi' });
    assert.deepEqual(Array.from(board.rows.map(r => r.name)), ['B', 'A', 'C']);

    const solo = DG.mpProgressBoard([
        { user_id: 'me', nickname: 'Me', correct: 5, distance: 10 }
    ], { meId: 'me', questionCount: 20, mode: 'single' });
    assert.equal(solo.visible, false);
    assert.equal(DG.mpProgressHTML(solo), '');
});

test('the race view owns the progress overlay markup and updates it from sync', () => {
    const overlayAt = htmlSource.indexOf('id="dg-mp-progress"');
    const stageAt = htmlSource.indexOf('id="dg-stage"');
    const viewEnd = htmlSource.indexOf('<!-- Dictation Master Views -->');
    assert.ok(overlayAt > stageAt && overlayAt < viewEnd, 'the overlay must live inside the race stage');
    assert.ok(/\.dg-mp-progress\s*\{[\s\S]{0,600}pointer-events:\s*none/.test(htmlSource),
        'the overlay must never block steering / ACCEL');
    assert.ok(/DG\.updateMpProgress\(players\)/.test(mpSource), 'room sync must refresh the board');
    assert.ok(/DG\.updateMpProgress\(\(opts && opts\.players\) \|\| \[\]\)/.test(raceSource),
        'the board should be seeded with the lobby roster when the race starts');
    assert.ok(/DG\.hideMpProgress\(\)/.test(raceSource), 'leaving the race hides the board');
});

/* ---------------- teacher dashboard ---------------- */

test('Drive & Go! Solo and Multi boards sit inside the Grammar Quest dashboard card', () => {
    const grammarAt = htmlSource.indexOf('📜 Grammar Quest');
    const soloAt = htmlSource.indexOf('id="dg-admin-solo-container"');
    const multiAt = htmlSource.indexOf('id="dg-admin-multi-container"');
    const loginsAt = htmlSource.indexOf('🕒 Student Logins');
    assert.ok(grammarAt !== -1 && soloAt !== -1 && multiAt !== -1 && loginsAt !== -1);
    assert.ok(soloAt > grammarAt, 'Solo board must be inside the Grammar Quest card');
    assert.ok(multiAt > soloAt, 'Multi board must follow the Solo board');
    assert.ok(multiAt < loginsAt, 'Drive & Go! boards must stay in the Grammar Quest card');
    assert.ok(htmlSource.indexOf('loadDriveAndGoAdmin(true)') !== -1);
    assert.ok(/id="dg-admin-stats"/.test(htmlSource));
});

test('the dashboard reads the existing Solo / Multi views and never invents a table', () => {
    assert.ok(adminSource.indexOf('drive_and_go_solo_leaderboard') !== -1);
    assert.ok(adminSource.indexOf('drive_and_go_multi_leaderboard') !== -1);
    assert.ok(!/create table|from\(['"]drive_and_go_(?:solo|multi)_scores/.test(adminSource));
    assert.match(adminSource, /async function loadDriveAndGoAdmin[\s\S]{0,80}if \(!isAdmin\(\)\) return;/);
    assert.ok(/loadDriveAndGoAdmin\(\)/.test(fs.readFileSync(path.join(__dirname, '../js/shared.js'), 'utf8')));
});

function loadAdminUtils(DG) {
    const context = vm.createContext({
        console,
        DG,
        isAdmin: () => false,
        sb: { from() { throw new Error('a guest must not query the board'); } },
        document: { getElementById() { return null; } },
        displayName: (r) => (r && (r.nickname || r.email)) || '?',
        escapeHtml: (t) => String(t == null ? '' : t),
        classBadge: () => '',
        formAssignControl: () => '',
        groupRowsByForm: (rows) => [{ id: '', label: 'Unassigned', rows: rows || [] }],
        renderFormSections: () => '<rows></rows>',
        isMissingSchema: () => true,
        ensureFormDirectory: async () => ({})
    });
    vm.runInContext(adminSource, context);
    return context;
}

test('dashboard summary and row meta are unit-testable and use the composite board fields', async () => {
    const DG = loadDG();
    const ctx = loadAdminUtils(DG);
    const rows = [
        { nickname: 'Alice', email: 'a@school', composite: 900, elapsed_ms: 60000, accuracy: 0.8, question_count: 20, bank_mode: 'pv', scene: 'jungle', plays: 3 },
        { nickname: 'Bob', email: 'b@school', composite: 1200, elapsed_ms: 90000, accuracy: 0.5, question_count: 30, bank_mode: 'mixed', scene: 'stadium', plays: 1 }
    ];
    const summary = vm.runInContext('driveAndGoBoardSummary', ctx)(rows);
    assert.equal(summary.players, 2);
    assert.equal(summary.runs, 4);
    assert.equal(summary.best, 1200);
    assert.equal(summary.bestName, 'Bob');

    const meta = vm.runInContext('driveAndGoRowMeta', ctx)(rows[0]);
    assert.ok(meta.indexOf('1:00') !== -1);
    assert.ok(meta.indexOf('80%') !== -1);
    assert.ok(meta.indexOf('20 Q') !== -1);
    assert.ok(meta.indexOf('PV') !== -1);
    assert.ok(meta.indexOf('Dino Dino Jungle') !== -1);
    assert.ok(meta.indexOf('3 runs') !== -1);

    // A guest (isAdmin false) gets an early return instead of a board query.
    await vm.runInContext('loadDriveAndGoAdmin()', ctx);
});

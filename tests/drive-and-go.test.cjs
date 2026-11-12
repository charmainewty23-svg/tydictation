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

    const middle = [3, 4, 6, 9, 12, 15].map(deg => DG.tiltLaneTarget(deg));
    middle.forEach(v => assert.ok(v > 1 && v < 2, 'expected a fractional lane, got ' + v));
    const negMiddle = [-3, -4, -6, -9, -12, -15].map(deg => DG.tiltLaneTarget(deg));
    negMiddle.forEach(v => assert.ok(v >= 0 && v < 1, 'expected a fractional lane, got ' + v));

    // Monotonic and symmetric: more lean = further out, and sign mirrors.
    for (let i = 1; i < middle.length; i++) assert.ok(middle[i] > middle[i - 1]);
    middle.forEach((v, i) => assert.ok(Math.abs((2 - v) - negMiddle[i]) < 1e-9));

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

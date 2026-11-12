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

function loadDG() {
    const context = vm.createContext({
        window: {},
        globalThis: {},
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
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
    assert.ok(!/['"]passive['"]/.test(source), 'PV must use the exact tab name Passives');
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

test('all three Drive & Go scripts are classic scripts and parse', () => {
    assert.ok(!/\bexport\s|\bimport\s/.test(source + raceSource + mpSource));
    new vm.Script(source);
    new vm.Script(raceSource);
    new vm.Script(mpSource);
});

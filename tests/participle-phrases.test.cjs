// No network, credentials or database writes. Exercises the prepared
// Participle phrases bank, the Drive & Go! fifth-topic wiring, the
// Purr-fect Survival grammar topic list, and the static HTML / SW hooks.
// Run: node --test tests/participle-phrases.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BANK_PATH = path.join(ROOT, 'js/grammar/participle-phrases-data.js');
const DG_PATH = path.join(ROOT, 'js/grammar/drive-and-go.js');
const PS_PATH = path.join(ROOT, 'js/purrfect-survival-engine.js');
const INDEX_PATH = path.join(ROOT, 'index.html');
const SW_PATH = path.join(ROOT, 'sw.js');

const bankSource = fs.readFileSync(BANK_PATH, 'utf8');
const dgSource = fs.readFileSync(DG_PATH, 'utf8');
const psSource = fs.readFileSync(PS_PATH, 'utf8');
const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');
const swSource = fs.readFileSync(SW_PATH, 'utf8');

// Shared normalisation for "unique choices" checks. The real app uses
// DG.normAnswer; this mirrors its intent without depending on load order.
function norm(text) {
    return String(text == null ? '' : text)
        .toLowerCase()
        .replace(/[.,!?;:"'\u2018\u2019\u201c\u201d()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function loadBank() {
    const context = vm.createContext({ window: {}, console });
    vm.runInContext(bankSource, context, { filename: 'participle-phrases-data.js' });
    const rows = context.window.DG_PARTICIPLE_PHRASES;
    assert.ok(Array.isArray(rows), 'DG_PARTICIPLE_PHRASES is an array');
    return rows;
}

function loadDG() {
    const context = vm.createContext({
        window: {},
        globalThis: {},
        localStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        document: { getElementById() { return null; } },
        console
    });
    // The local bank must exist before loadBank() runs.
    vm.runInContext(bankSource, context, { filename: 'participle-phrases-data.js' });
    vm.runInContext(dgSource, context, { filename: 'drive-and-go.js' });
    return vm.runInContext('DG', context);
}

function loadPS() {
    const sandbox = {
        window: {}, console, Date, Math, JSON, Set, Map, Number, String,
        Array, Object, isFinite
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(psSource, sandbox, { filename: 'purrfect-survival-engine.js' });
    assert.ok(sandbox.window.PSEngine, 'engine attaches window.PSEngine');
    return sandbox.window.PSEngine;
}

function countOccurrences(haystack, needle) {
    return haystack.split(needle).length - 1;
}

/* ------------------------------ 1. bank ------------------------------ */

test('bank has exactly items 1-250 with no gaps and no 251+', () => {
    const rows = loadBank();
    assert.equal(rows.length, 250);
    const ids = rows.map(r => Number(r.id));
    assert.deepEqual(Array.from(ids), Array.from({ length: 250 }, (_, i) => i + 1));
    assert.equal(ids.filter(id => id > 250).length, 0);
    assert.equal(new Set(ids).size, 250);
});

test('every item has a stem, an official answer and exactly three unique choices', () => {
    const rows = loadBank();
    rows.forEach((row) => {
        assert.equal(typeof row.q, 'string', 'q is a string for ' + row.id);
        assert.ok(row.q.trim().length > 0, 'q is not empty for ' + row.id);
        assert.ok(row.q.indexOf('____') !== -1, 'stem keeps the ____ blank for ' + row.id);
        assert.equal(typeof row.a, 'string', 'a is a string for ' + row.id);
        assert.ok(row.a.trim().length > 0, 'a is not empty for ' + row.id);
        assert.ok(Array.isArray(row.choices), 'choices is an array for ' + row.id);
        assert.equal(row.choices.length, 3, 'exactly three choices for ' + row.id);
        const keys = row.choices.map(norm);
        assert.equal(new Set(keys).size, 3, 'choices are unique (case-insensitive) for ' + row.id);
        assert.ok(keys.indexOf(norm(row.a)) !== -1, 'choices include the official answer for ' + row.id);
    });
});

test('no stem looks like a sentence-combining question 251+', () => {
    const rows = loadBank();
    rows.forEach((row) => {
        // No leading 251+ numbering or "Q251".
        assert.ok(!/^\s*Q?\s*(25[1-9]|[3-9]\d\d)\s*[.):]/i.test(row.q), 'no 251+ numbering in ' + row.id);
        // Sentence combining joins two full sentences: "... . He ...".
        assert.ok(!/[.!?]\s+[A-Z][a-z]/.test(row.q), 'stem is a single sentence for ' + row.id);
    });
});

/* --------------------------- 2. Drive & Go! --------------------------- */

test('Drive & Go! exposes participle_phrases as the fifth topic', () => {
    const DG = loadDG();
    assert.deepEqual(Array.from(DG.TOPICS),
        ['tenses', 'agreement', 'articles', 'indefinite_pronouns', 'participle_phrases']);
    assert.equal(DG.normalizeTopic('participle_phrases'), 'participle_phrases');
    assert.equal(DG.normalizeTopic('PARTICIPLE_PHRASES'), 'participle_phrases');
    assert.equal(DG.normalizeBankMode('participle_phrases', 'av'), 'mixed');
    assert.equal(DG.normalizeBankMode('participle_phrases', 'anything'), 'mixed');
    assert.equal(DG.topicLabel('participle_phrases'), 'Participle phrases');
    assert.equal(DG.modeLabel('participle_phrases', 'mixed'), 'Participle phrases (3 options)');
    assert.equal(DG.modeShort('participle_phrases', 'mixed'), '3 options');
});

test('Participle phrases races three gates; Articles / Indefinite stay at four', () => {
    const DG = loadDG();
    assert.equal(DG.laneCountFor('participle_phrases'), 3);
    assert.equal(DG.laneCountFor('tenses'), 3);
    assert.equal(DG.laneCountFor('agreement'), 3);
    assert.equal(DG.laneCountFor('articles'), 4);
    assert.equal(DG.laneCountFor('indefinite_pronouns'), 4);
});

test('the local bank spec and loader resolve the 250-row participle bank', async () => {
    const DG = loadDG();
    assert.deepEqual({ ...DG.localBankSpec('participle_phrases') },
        { globalName: 'DG_PARTICIPLE_PHRASES', label: 'Participle phrases' });
    // Articles / Indefinite Pronouns keep their own specs.
    assert.equal(DG.localBankSpec('articles').globalName, 'DG_ARTICLES');
    assert.equal(DG.localBankSpec('indefinite_pronouns').globalName, 'DG_INDEFINITE_PRONOUNS');

    const bank = await DG.loadBank('participle_phrases', 'mixed');
    assert.equal(bank.length, 250);
    // choices are carried through onto each question for the gates.
    assert.deepEqual(Array.from(bank[0].options), ['Feeling', 'Felt', 'Feel']);
    assert.equal(bank[0].primary, 'Feeling');
    assert.equal(bank[249].primary, 'let');
});

test('gatesFor gives three gates, one correct, using the item choices', async () => {
    const DG = loadDG();
    const bank = await DG.loadBank('participle_phrases', 'mixed');
    [0, 2, 249].forEach((index) => {
        const q = bank[index];
        const gates = DG.gatesFor(q, 'participle_phrases', 'mixed', DG.makeRng(11 + index));
        assert.equal(gates.length, 3, 'three gates for ' + q.id);
        assert.equal(gates.filter(g => g.correct).length, 1, 'exactly one correct gate for ' + q.id);
        const labels = gates.map(g => norm(g.label));
        assert.equal(new Set(labels).size, 3, 'gate labels are unique for ' + q.id);
        assert.deepEqual(new Set(labels), new Set(q.options.map(norm)), 'gate labels are the item choices for ' + q.id);
        const correct = gates.filter(g => g.correct)[0];
        assert.equal(norm(correct.label), norm(q.primary), 'correct gate is the official answer for ' + q.id);
        assert.equal(correct.label, q.primary, 'correct gate keeps the official capitalisation for ' + q.id);
    });
});

test('participleGates survives a bare question and never marks a distractor correct', () => {
    const DG = loadDG();
    const gates = DG.participleGates({ primary: 'Feeling' }, DG.makeRng(2));
    assert.equal(gates.length, 3);
    assert.equal(gates.filter(g => g.correct).length, 1);
    assert.ok(gates.some(g => g.correct && g.label === 'Feeling'));
    // Unknown primary with no bank row cannot invent a correct answer.
    const empty = DG.participleGates({ primary: 'zzzznotinthebank' }, DG.makeRng(2));
    assert.equal(empty.length, 0);
});

/* ------------------------- 3. Purr-fect Survival ------------------------ */

test('Survival accepts participle_phrases as a grammar topic', () => {
    const PS = loadPS();
    assert.ok(PS.GRAMMAR_TOPICS.indexOf('participle_phrases') !== -1);
    assert.deepEqual(Array.from(PS.GRAMMAR_MODES.participle_phrases), ['mixed']);

    const ok = PS.validateRoomSetup({
        subject: 'grammar',
        grammarTopic: 'participle_phrases',
        bankMode: 'mixed'
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.error, '');
    assert.equal(ok.setup.topic, 'participle_phrases');
    assert.equal(ok.setup.bankMode, 'mixed');

    // A bad mode falls back to mixed instead of rejecting the room.
    const relaxed = PS.validateRoomSetup({
        subject: 'grammar',
        grammarTopic: 'participle_phrases',
        bankMode: 'av'
    });
    assert.equal(relaxed.ok, true);
    assert.equal(relaxed.setup.bankMode, 'mixed');

    const bad = PS.validateRoomSetup({ subject: 'grammar', grammarTopic: 'nonsense_topic' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'INVALID_TOPIC');
});

/* ---------------------------- 4. HTML / SW ---------------------------- */

test('index.html shows Participle phrases in Grammar Quest and the intro card', () => {
    // Home-grid card after Indefinite Pronouns.
    assert.ok(indexSource.indexOf('showStructureDetail(\'participle_clauses\')') !== -1);
    assert.ok(countOccurrences(indexSource, 'Participle phrases') >= 3,
        'home card, Sentence Structures card and admin button all use the display name');
    assert.equal(indexSource.indexOf('Participle Clauses'), -1, 'the old display title is gone');
    assert.equal(indexSource.indexOf('RACE · 4 topics'), -1, 'the Drive & Go! tile is updated');
    assert.ok(indexSource.indexOf('RACE · 5 topics') !== -1);
});

test('index.html loads the data file before Drive & Go! and offers Survival options', () => {
    const dataAt = indexSource.indexOf('<script src="js/grammar/participle-phrases-data.js"></script>');
    const dgAt = indexSource.indexOf('<script src="js/grammar/drive-and-go.js"></script>');
    assert.ok(dataAt !== -1, 'data script tag exists');
    assert.ok(dgAt !== -1, 'drive-and-go.js script tag exists');
    assert.ok(dataAt < dgAt, 'the bank loads before drive-and-go.js');

    assert.equal(countOccurrences(indexSource, '<option value="participle_phrases">Participle phrases</option>'), 3,
        'all three Survival round grammar-topic selects offer it');
    ['ps-r1-grammar-topic', 'ps-r2-grammar-topic', 'ps-r3-grammar-topic'].forEach((id) => {
        assert.ok(indexSource.indexOf('id="' + id + '"') !== -1, id + ' exists');
    });
});

test('service worker is v124 and precaches the new bank', () => {
    assert.ok(swSource.indexOf("learnity-pwa-v124") !== -1, 'CACHE_NAME is v124');
    assert.equal(swSource.indexOf("learnity-pwa-v123"), -1, 'the v123 cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v122"), -1, 'the v122 cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v121"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf('learnity-pwa-v119'), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf('learnity-pwa-v120'), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v117"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf('learnity-pwa-v118'), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v116"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v115"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v114"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v113"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v111"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v110"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v109"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v108"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v107"), -1, 'the old cache name is gone');
    assert.equal(swSource.indexOf("learnity-pwa-v106"), -1, 'the old cache name is gone');
    assert.ok(swSource.indexOf("'/js/grammar/participle-phrases-data.js'") !== -1,
        'the data file is in CORE_ASSETS');
});

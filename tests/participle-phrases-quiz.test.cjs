// No network, credentials or database writes. Exercises the Grammar Quest
// Participle phrases type-in quiz: wrong-answer explanations, the 1–250 bank
// data path, the removed My Record tab, and the service-worker version.
// Run: node --test tests/participle-phrases-quiz.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BANK_PATH = path.join(ROOT, 'js/grammar/participle-phrases-data.js');
const GQ_PATH = path.join(ROOT, 'js/grammar-quest.js');
const SW_PATH = path.join(ROOT, 'sw.js');

const bankSource = fs.readFileSync(BANK_PATH, 'utf8');
const gqSource = fs.readFileSync(GQ_PATH, 'utf8');
const swSource = fs.readFileSync(SW_PATH, 'utf8');

function makeSandbox(options) {
    const opts = options || {};
    const input = { value: '', focus() {} };
    const inner = {
        innerHTML: '',
        appended: [],
        querySelector() { return null; },
        appendChild(node) { this.appended.push(node); }
    };
    const container = { innerHTML: '' };
    const document = {
        getElementById(id) {
            if (id === 'pc-answer') return input;
            if (id === 'pc-tab-content' || id === 'if-clause-tab-content') return inner;
            return null;
        },
        createElement() { return { className: '', innerHTML: '' }; },
        querySelectorAll() { return []; }
    };
    const sandbox = {
        window: {},
        console,
        document,
        setTimeout() {},
        localStorage: { getItem() { return null; }, setItem() {} },
        SPREADSHEET_ID: 'test-sheet',
        input,
        container,
        inner
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    if (!opts.noBank) vm.runInContext(bankSource, sandbox, { filename: 'participle-phrases-data.js' });
    vm.runInContext(gqSource, sandbox, { filename: 'grammar-quest.js' });
    return sandbox;
}

function call(sandbox, expression) {
    return vm.runInContext(expression, sandbox, { filename: 'query.js' });
}

function bankRows(sandbox) {
    return call(sandbox, 'window.DG_PARTICIPLE_PHRASES');
}

function quotesIn(text) {
    return String(text).match(/"[^"]*"/g) || [];
}

/* ------------------------- explanations ------------------------- */

test('explainParticipleAnswer covers the five bank patterns with the official answer verbatim', () => {
    const sandbox = makeSandbox();
    const rows = bankRows(sandbox);
    const explain = call(sandbox, 'explainParticipleAnswer');
    const byId = new Map(rows.map(row => [Number(row.id), row]));

    const feeling = explain(byId.get(1));
    assert.ok(feeling.indexOf('"Feeling"') !== -1, 'quotes the official Feeling');
    assert.ok(/present participle \(V-ing\)/.test(feeling));
    assert.ok(/subject does the action/.test(feeling));
    assert.ok(!/past participle/.test(feeling), 'item 1 is not past');

    const standing = explain(byId.get(2));
    assert.ok(standing.indexOf('"standing"') !== -1, 'quotes the official standing');
    assert.ok(/present participle/.test(standing));
    assert.ok(/adjective after the noun/.test(standing));

    const notKnowing = explain(byId.get(3));
    assert.ok(notKnowing.indexOf('"Not knowing"') !== -1, 'quotes the official Not knowing');
    assert.ok(/negative present participle/.test(notKnowing));
    assert.ok(/put Not before/.test(notKnowing));

    const damaged = explain(byId.get(127));
    assert.ok(damaged.indexOf('"Damaged"') !== -1, 'quotes the official Damaged');
    assert.ok(/past participle \(V3\)/.test(damaged));
    assert.ok(/action is done to the subject/.test(damaged));
    assert.ok(!/present participle/.test(damaged), 'item 127 is not present');

    const parked = explain(byId.get(128));
    assert.ok(parked.indexOf('"parked"') !== -1, 'quotes the official parked');
    assert.ok(/past participle/.test(parked));
    assert.ok(/adjective after the noun/.test(parked));

    [feeling, standing, notKnowing, damaged, parked].forEach((text, index) => {
        const id = [1, 2, 3, 127, 128][index];
        const quoted = quotesIn(text);
        assert.deepEqual(quoted, ['"' + byId.get(id).a + '"'],
            'only the official answer is quoted for item ' + id);
    });
});

test('explainParticipleAnswer falls back to morphology and explains Not + V3', () => {
    const sandbox = makeSandbox();
    const explain = call(sandbox, 'explainParticipleAnswer');

    const present = explain({ q: '____ (feel) tired, she went to bed early.', a: 'Feeling' });
    assert.ok(/present participle/.test(present));
    assert.ok(present.indexOf('"Feeling"') !== -1);

    const pastAdjective = explain({ q: 'The car ____ (park) outside belongs to the manager.', a: 'parked' });
    assert.ok(/past participle/.test(pastAdjective));
    assert.ok(/adjective after the noun/.test(pastAdjective));

    const irregular = explain({ q: 'Books ____ (write) by George Orwell are famous.', a: 'written' });
    assert.ok(/past participle/.test(irregular), 'written is V3 even without an id');
    assert.ok(!/present participle/.test(irregular));

    // Constructed only for this test; not part of the bank.
    const negativePast = explain({ q: '____ (not/invite) to the party, he stayed at home.', a: 'Not invited' });
    assert.ok(negativePast.indexOf('"Not invited"') !== -1);
    assert.ok(/negative past participle/.test(negativePast));
    assert.ok(/put Not before the past participle \(V3\)/.test(negativePast));

    assert.equal(explain({}), '');
    assert.equal(explain({ a: '' }), '');
});

/* ------------------------- quiz data ------------------------- */

test('loadPCData copies the official 1–250 bank and never fetches 251+', async () => {
    const sandbox = makeSandbox();
    let fetched = false;
    sandbox.fetch = async () => { fetched = true; throw new Error('should not fetch when the bank is present'); };
    const loadPCData = call(sandbox, 'loadPCData');
    await loadPCData();

    const rows = bankRows(sandbox);
    const pcData = call(sandbox, 'pcData');
    assert.equal(fetched, false, 'the local bank is preferred over the sheet');
    assert.equal(pcData.length, 250);
    assert.deepEqual(
        Array.from(pcData, row => Number(row.id)),
        Array.from({ length: 250 }, (_, i) => i + 1)
    );
    pcData.forEach((row, index) => {
        assert.equal(row.id, rows[index].id);
        assert.equal(row.q, rows[index].q, 'stem is unchanged for id ' + row.id);
        assert.equal(row.a, rows[index].a, 'official answer is unchanged for id ' + row.id);
    });
    assert.equal(pcData.filter(row => Number(row.id) > 250).length, 0);
});

test('loadPCData sheet fallback skips headers, 251+ and sentence combining', async () => {
    const sandbox = makeSandbox({ noBank: true });
    const csv = [
        'Question,Answer',
        'Participle phrases,,',
        '"1. ____ (feel) tired, she went to bed early.",Feeling',
        '"250. ____ (let) the cat out.",let',
        '"251. Combine the two sentences: feeling tired, she went to bed.",Feeling',
        '"Sentence combining practice.",foo',
        '"12. The man ____ (stand) by the door is my uncle.",standing'
    ].join('\n');
    sandbox.fetch = async () => ({ ok: true, text: async () => csv });
    const loadPCData = call(sandbox, 'loadPCData');
    await loadPCData();

    const pcData = call(sandbox, 'pcData');
    assert.deepEqual(Array.from(pcData, row => row.q), [
        '____ (feel) tired, she went to bed early.',
        '____ (let) the cat out.',
        'The man ____ (stand) by the door is my uncle.'
    ]);
    assert.deepEqual(Array.from(pcData, row => row.a), ['Feeling', 'let', 'standing']);
    assert.equal(pcData.length, 3);
    assert.equal(pcData.filter(row => /251|Sentence combining/i.test(row.q)).length, 0);
});

/* ------------------------- tabs / UI ------------------------- */

test('Participle phrases tabs no longer show My Record; Conditionals still do', () => {
    const sandbox = makeSandbox();
    const structureData = call(sandbox, 'structureData');

    call(sandbox, "pcTab = 'revision'");
    call(sandbox, 'renderPCTabs')(sandbox.container, structureData.participle_clauses);
    const pcHTML = sandbox.container.innerHTML;
    assert.ok(pcHTML.indexOf('📖 Revision') !== -1);
    assert.ok(pcHTML.indexOf('✏️ Quiz') !== -1);
    assert.equal(pcHTML.indexOf('My Record'), -1);
    assert.equal(pcHTML.indexOf('switchPCTab(\'record\')'), -1);

    sandbox.container.innerHTML = '';
    sandbox.inner.innerHTML = '';
    call(sandbox, "ifClauseTab = 'revision'");
    call(sandbox, 'renderConditionalsTabs')(sandbox.container, structureData.conditionals);
    const ifHTML = sandbox.container.innerHTML;
    assert.ok(ifHTML.indexOf('📋 My Record') !== -1, 'Conditionals keeps My Record');
    assert.ok(ifHTML.indexOf('switchIfClauseTab(\'record\')') !== -1);
});

test('the third wrong try shows the official answer plus the explanation', () => {
    const sandbox = makeSandbox();
    call(sandbox, "showTryAgain = function () {}; showEncouragement = function () {};");
    call(sandbox, "pcQuizWords = [{ q: '____ (feel) tired, she went to bed early.', a: 'Feeling', id: 1 }]");
    call(sandbox, 'pcQuizIdx = 0; pcQuizScore = 0; pcQuizResults = []; pcTryCount = 0');

    for (let attempt = 0; attempt < 3; attempt++) {
        sandbox.input.value = 'felt';
        call(sandbox, 'checkPCAnswer')();
    }

    assert.equal(call(sandbox, 'pcQuizResults').length, 1);
    assert.equal(call(sandbox, 'pcQuizResults')[0].correct, false);
    assert.equal(sandbox.inner.appended.length, 1);
    const html = sandbox.inner.appended[0].innerHTML;
    assert.ok(html.indexOf('Correct answer:') !== -1);
    assert.ok(html.indexOf('Feeling') !== -1);
    assert.ok(html.indexOf('present participle') !== -1, 'explanation sits in the red answer box');
    assert.ok(html.indexOf('subject does the action') !== -1);
});

test('end-of-quiz review explains wrong items only', () => {
    const sandbox = makeSandbox();
    call(sandbox, `pcQuizWords = [
        { q: '____ (feel) tired, she went to bed early.', a: 'Feeling', id: 1 },
        { q: 'The man ____ (stand) by the door is my uncle.', a: 'standing', id: 2 }
    ]`);
    call(sandbox, `pcQuizResults = [
        { q: '____ (feel) tired, she went to bed early.', userA: 'felt', a: 'Feeling', id: 1, correct: false },
        { q: 'The man ____ (stand) by the door is my uncle.', userA: 'standing', a: 'standing', id: 2, correct: true }
    ]`);
    call(sandbox, 'pcQuizScore = 10');
    const result = { innerHTML: '' };
    call(sandbox, 'showPCResult')(result);

    assert.ok(result.innerHTML.indexOf('Your answer: felt') !== -1);
    assert.ok(result.innerHTML.indexOf('Correct: Feeling') !== -1);
    assert.ok(result.innerHTML.indexOf('present participle (V-ing)') !== -1,
        'wrong item gets the explanation');
    assert.equal((result.innerHTML.match(/"Feeling"/g) || []).length, 1,
        'explanation quotes the official answer');
    assert.equal((result.innerHTML.match(/Use "/g) || []).length, 1,
        'correct items do not get an explanation block');
    assert.ok(result.innerHTML.indexOf('✓ standing') !== -1);
});

/* ------------------------- service worker ------------------------- */

test('service worker is v125', () => {
    assert.ok(swSource.indexOf("learnity-pwa-v125") !== -1, 'CACHE_NAME is v125');
    assert.equal(swSource.indexOf("learnity-pwa-v124"), -1, 'the v124 cache name is gone');
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
    assert.ok(swSource.indexOf("'/js/grammar-quest.js'") !== -1,
        'grammar-quest.js stays in CORE_ASSETS');
});

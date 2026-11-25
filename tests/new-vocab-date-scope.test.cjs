/* Unit tests for the shared New Vocab date scopes (All / Added today /
   Added yesterday). No browser, no network, no database: js/shared.js and
   js/word-battle.js are vm-loaded so the real helpers run. */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sharedSource = fs.readFileSync(path.join(root, 'js', 'shared.js'), 'utf8');
const wordBattleSource = fs.readFileSync(path.join(root, 'js', 'word-battle.js'), 'utf8');
const newVocabSource = fs.readFileSync(path.join(root, 'js', 'new-vocab.js'), 'utf8');
const dictationSource = fs.readFileSync(path.join(root, 'js', 'dictation.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const agentsSource = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

function makeStorage() {
    const map = new Map();
    return {
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { map.set(k, String(v)); },
        removeItem(k) { map.delete(k); },
        clear() { map.clear(); }
    };
}

function makeClassList() {
    const set = new Set();
    return {
        add(...names) { names.forEach(n => set.add(n)); },
        remove(...names) { names.forEach(n => set.delete(n)); },
        contains(n) { return set.has(n); },
        toggle(n, force) {
            const on = force === undefined ? !set.has(n) : !!force;
            if (on) set.add(n); else set.delete(n);
            return on;
        }
    };
}

function loadApp() {
    const noop = function () {};
    const el = {
        id: '',
        innerHTML: '',
        textContent: '',
        style: {},
        dataset: {},
        classList: makeClassList(),
        value: '',
        src: '',
        setAttribute: noop,
        getAttribute() { return ''; },
        appendChild: noop,
        addEventListener: noop,
        removeEventListener: noop,
        focus: noop,
        getContext() { return null; }
    };
    const document = {
        readyState: 'complete',
        body: el,
        documentElement: el,
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return el; },
        addEventListener: noop,
        removeEventListener: noop
    };
    const sb = {
        auth: {
            onAuthStateChange() { return { data: { subscription: { unsubscribe: noop } } }; },
            getSession() { return Promise.resolve({ data: { session: null } }); },
            signOut() { return Promise.resolve({ error: null }); }
        },
        from() { return { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [], error: null }); }, then(res) { return Promise.resolve({ data: [], error: null }).then(res); } }; },
        rpc() { return Promise.resolve({ data: null, error: null }); }
    };
    const window = {
        supabase: { createClient() { return sb; } },
        location: { origin: 'https://tydictation.vercel.app', href: 'https://tydictation.vercel.app/', search: '' },
        addEventListener: noop,
        removeEventListener: noop,
        setTimeout: function () { return 0; },
        clearTimeout: noop,
        setInterval: function () { return 0; },
        clearInterval: noop,
        requestAnimationFrame() { return 0; },
        cancelAnimationFrame: noop,
        confirm() { return true; }
    };
    const sandbox = {
        console: { log: noop, warn: noop, error: noop },
        window,
        document,
        navigator: { userAgent: 'unit-test-agent' },
        localStorage: makeStorage(),
        sessionStorage: makeStorage(),
        location: window.location,
        addEventListener: noop,
        removeEventListener: noop,
        setTimeout: function () { return 0; },
        clearTimeout: noop,
        setInterval: function () { return 0; },
        clearInterval: noop,
        requestAnimationFrame() { return 0; },
        cancelAnimationFrame: noop,
        fetch() { return Promise.resolve({ ok: true, json() { return Promise.resolve([]); } }); },
        Intl, Date, Math, JSON, Set, Map, Number, String, Array, Object,
        isFinite, parseInt, parseFloat, Promise, RegExp, Error, encodeURIComponent, decodeURIComponent
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(sharedSource, sandbox, { filename: 'shared.js' });
    vm.runInContext(wordBattleSource, sandbox, { filename: 'word-battle.js' });
    return sandbox;
}

const app = loadApp();

/* ------------------------------------------------------------------ */
/* 1) Hong Kong calendar windows, including midnight                  */
/* ------------------------------------------------------------------ */

test('today/yesterday are Asia/Hong_Kong calendar days, not UTC days', () => {
    assert.equal(app.hkDayKey('2026-11-25T15:59:59.000Z'), '2026-11-25', '23:59:59 HKT is still 25 Nov');
    assert.equal(app.hkDayKey('2026-11-25T16:00:00.000Z'), '2026-11-26', '16:00Z is 00:00 HKT on 26 Nov');

    // A word added at 23:59:59 HKT is "today" at that instant...
    assert.equal(app.vocabWordAddedOnHkDay('2026-11-25T15:59:59.000Z', 0, '2026-11-25T15:59:59.000Z'), true);
    // ...and "yesterday" one second later, when Hong Kong has crossed midnight.
    assert.equal(app.vocabWordAddedOnHkDay('2026-11-25T15:59:59.000Z', -1, '2026-11-25T16:00:00.000Z'), true);
    // A word added at 00:00 HKT on 26 Nov is not in 25 Nov's today window.
    assert.equal(app.vocabWordAddedOnHkDay('2026-11-25T16:00:00.000Z', 0, '2026-11-25T15:59:59.000Z'), false);
    assert.equal(app.vocabWordAddedOnHkDay('2026-11-25T16:00:00.000Z', 0, '2026-11-25T16:00:00.000Z'), true);

    // Invalid / missing timestamps never match a window.
    assert.equal(app.vocabWordAddedOnHkDay('', 0, '2026-11-25T16:00:00.000Z'), false);
    assert.equal(app.vocabWordAddedOnHkDay(null, 0, '2026-11-25T16:00:00.000Z'), false);
    assert.equal(app.vocabWordAddedOnHkDay('not-a-date', 0, '2026-11-25T16:00:00.000Z'), false);
});

/* ------------------------------------------------------------------ */
/* 2) Defaults / legacy booleans                                      */
/* ------------------------------------------------------------------ */

test('normalizeVocabDateScope defaults missing and legacy values to All', () => {
    ['all', 'All', ' ALL ', 'full', 'all words', 'Full bank', 'Added today only', '', '   ', null, undefined, 'bogus', 'yesterdays']
        .forEach(value => assert.equal(app.normalizeVocabDateScope(value), 'all', String(value)));
    assert.equal(app.normalizeVocabDateScope('today'), 'today');
    assert.equal(app.normalizeVocabDateScope('TODAY'), 'today');
    assert.equal(app.normalizeVocabDateScope('yesterday'), 'yesterday');
    assert.equal(app.normalizeVocabDateScope(' Yesterday '), 'yesterday');

    // Word Battle room fallback: legacy vocab_today=false = All, true = today.
    assert.equal(app.battleRoomVocabScope(null), 'all');
    assert.equal(app.battleRoomVocabScope({}), 'all');
    assert.equal(app.battleRoomVocabScope({ vocab_today: false }), 'all');
    assert.equal(app.battleRoomVocabScope({ vocab_today: true }), 'today');
    assert.equal(app.battleRoomVocabScope({ vocab_scope: 'today', vocab_today: false }), 'today');
    assert.equal(app.battleRoomVocabScope({ vocab_scope: 'yesterday' }), 'yesterday');
    assert.equal(app.battleRoomVocabScope({ vocab_scope: 'nonsense' }), 'all');
});

/* ------------------------------------------------------------------ */
/* 3) Filtering                                                       */
/* ------------------------------------------------------------------ */

test('filterNewVocabByScope returns copies and handles empty / missing dates', () => {
    const rows = [
        { id: 1, en: 'apple', created_at: '2026-11-25T04:00:00.000Z' }, // 25 Nov HKT
        { id: 2, en: 'banana', created_at: '2026-11-26T04:00:00.000Z' }, // 26 Nov HKT
        { id: 3, en: 'cherry' } // legacy row with no created_at
    ];
    const now = '2026-11-26T04:00:00.000Z';

    assert.deepEqual(app.filterNewVocabByScope(rows, 'today', now).map(w => w.id), [2]);
    assert.deepEqual(app.filterNewVocabByScope(rows, 'yesterday', now).map(w => w.id), [1]);
    assert.deepEqual(app.filterNewVocabByScope(rows, 'all', now).map(w => w.id), [1, 2, 3]);
    assert.deepEqual(app.filterNewVocabByScope(rows, 'nonsense', now).map(w => w.id), [1, 2, 3]);

    const noneToday = app.filterNewVocabByScope([rows[0], rows[2]], 'today', now);
    assert.deepEqual(noneToday, [], 'zero matches returns an empty list');
    assert.deepEqual(app.filterNewVocabByScope([], 'yesterday', now), []);

    const before = rows.map(w => Object.assign({}, w));
    const result = app.filterNewVocabByScope(rows, 'all', now);
    assert.notEqual(result, rows, 'All returns a shallow copy');
    assert.deepEqual(rows, before, 'the input array is never mutated');
    result.push({ id: 99 });
    assert.equal(rows.length, 3, 'mutating the result does not change the input');
});

/* ------------------------------------------------------------------ */
/* 4) created_at is the primary key, not updated_at                   */
/* ------------------------------------------------------------------ */

test('a word added yesterday and edited today stays in yesterday', () => {
    const word = {
        id: 7,
        en: 'pencil',
        created_at: '2026-11-25T04:00:00.000Z', // 25 Nov HKT (yesterday)
        updated_at: '2026-11-26T04:00:00.000Z'  // edited today
    };
    const now = '2026-11-26T04:00:00.000Z';
    assert.deepEqual(app.filterNewVocabByScope([word], 'today', now), [], 'editing does not move it into today');
    assert.deepEqual(app.filterNewVocabByScope([word], 'yesterday', now).map(w => w.id), [7]);
    assert.deepEqual(app.filterNewVocabByScope([word], 'all', now).map(w => w.id), [7]);
});

/* ------------------------------------------------------------------ */
/* 5) Every New Vocab picker uses the exact labels and defaults        */
/* ------------------------------------------------------------------ */

test('Dictation Master scope chips show All / Added today / Added yesterday, default All', () => {
    const scope = indexSource.slice(indexSource.indexOf('id="nv-scope"'), indexSource.indexOf('id="nv-status"'));
    assert.ok(scope.indexOf('>Added today</button>') !== -1, 'Added today label');
    assert.ok(scope.indexOf('>Added yesterday</button>') !== -1, 'Added yesterday label');
    assert.ok(scope.indexOf('>All</button>') !== -1, 'All label');
    assert.equal(scope.indexOf('>All words</button>'), -1, 'old All words label is gone');
    assert.ok(/id="nv-scope-all"[^>]*bg-orange-500 text-white/.test(scope), 'All is selected by default');
    assert.equal(/id="nv-scope-yesterday"[^>]*\bhidden\b/.test(scope), false, 'yesterday is visible to students too');

    assert.ok(newVocabSource.indexOf("let nvScope = 'all';") !== -1, 'default scope is all');
    assert.ok(newVocabSource.indexOf('filterNewVocabByScope(nvRows, nvScope)') !== -1, 'practice rows use the shared helper');
    assert.equal(newVocabSource.indexOf("scope === 'yesterday' && !isAdmin()"), -1, 'students are not blocked from yesterday');
    assert.ok(dictationSource.indexOf('Switch to All to practise the bank.') !== -1, 'empty today/yesterday copy says All');
});

test('Word Battle offers only All and Added today, and never asks for new SQL', () => {
    const start = indexSource.indexOf('id="battle-vocab-scope"');
    assert.ok(start !== -1, 'battle scope select exists');
    const block = indexSource.slice(start, indexSource.indexOf('</select>', start));
    assert.ok(block.indexOf('<option value="all" selected>All</option>') !== -1, 'default All');
    assert.ok(block.indexOf('<option value="today">Added today</option>') !== -1, 'Added today');
    assert.equal(block.indexOf('<option value="yesterday">Added yesterday</option>'), -1, 'no yesterday in Word Battle');

    assert.ok(wordBattleSource.indexOf('function battleVocabScope()') !== -1, 'scope reader');
    assert.ok(wordBattleSource.indexOf('function battleRoomVocabScope(room)') !== -1, 'room label helper');
    assert.ok(wordBattleSource.indexOf('vocab_today ? \'today\' : \'all\'') !== -1, 'legacy room fallback');
    assert.ok(wordBattleSource.indexOf('p_scope: scope') !== -1, 'new RPC argument is sent');
    assert.ok(wordBattleSource.indexOf('p_today_only: scope === \'today\'') !== -1, 'old today flag stays compatible');
    assert.ok(wordBattleSource.indexOf('const retry = await sb.rpc(\'set_battle_vocab\', baseArgs);') !== -1, '3-arg fallback kept');
    assert.ok(wordBattleSource.indexOf('NO_VOCAB_TODAY') !== -1, 'empty today is handled');
    assert.equal(wordBattleSource.indexOf('NO_VOCAB_YESTERDAY'), -1, 'yesterday error branch is gone');
    assert.equal(wordBattleSource.indexOf('new_vocab_date_scope.sql'), -1, 'no SQL hint for yesterday');
});

test('Purr-fect Survival lobby has the same three choices for rounds 1–3', () => {
    [1, 2, 3].forEach(r => {
        const start = indexSource.indexOf('id="ps-r' + r + '-vocab-scope"');
        assert.ok(start !== -1, 'round ' + r + ' scope select exists');
        const block = indexSource.slice(start, indexSource.indexOf('</select>', start));
        assert.ok(block.indexOf('<option value="all" selected>All</option>') !== -1, 'round ' + r + ' default All');
        assert.ok(block.indexOf('<option value="today">Added today</option>') !== -1, 'round ' + r + ' today');
        assert.ok(block.indexOf('<option value="yesterday">Added yesterday</option>') !== -1, 'round ' + r + ' yesterday');
    });
});

/* ------------------------------------------------------------------ */
/* 6) Empty today/yesterday never starts a broken run                 */
/* ------------------------------------------------------------------ */

test('an empty today/yesterday bank stops before a quiz or round starts', () => {
    const main = fs.readFileSync(path.join(root, 'js', 'purrfect-survival.js'), 'utf8');
    assert.ok(main.indexOf('if (!words.length) {') !== -1, 'loadRoundBank checks the filtered bank');
    assert.ok(main.indexOf('if (!bank1) return null;') !== -1, 'question building stops on an empty round-1 bank');
    assert.ok(main.indexOf("scope !== 'all'") !== -1, 'today/yesterday gets its own empty message');

    // Dictation Master's startQuiz returns before touching the quiz when the
    // current scope produced no usable words.
    const quizStart = dictationSource.indexOf('function startQuiz(mode, source)');
    const quizBody = dictationSource.slice(quizStart, dictationSource.indexOf('// Filter by sub-category', quizStart));
    assert.ok(quizBody.indexOf('if (!allWords || allWords.length === 0)') !== -1, 'empty bank guard');
    assert.ok(quizBody.indexOf('return;') !== -1, 'does not start an empty quiz');
});

/* ------------------------------------------------------------------ */
/* 7) The Word Battle date-scope SQL is gone and no longer needed      */
/* ------------------------------------------------------------------ */

test('Word Battle needs no incremental date-scope SQL', () => {
    assert.equal(fs.existsSync(path.join(root, 'supabase', 'new_vocab_date_scope.sql')), false, 'the incremental SQL file is deleted');
    assert.equal(/new_vocab_date_scope\.sql/.test(agentsSource), false, 'AGENTS.md does not tell anyone to run it');
    assert.equal(/new_vocab_date_scope\.sql/.test(wordBattleSource), false, 'Word Battle does not mention it');

    // Canonical files may still carry the vocab_scope body; the teacher is not
    // told to re-run them for this change, and All / today keep working through
    // the existing 3-arg set_battle_vocab fallback.
    const unassigned = fs.readFileSync(path.join(root, 'supabase', 'new_vocab_unassigned_read.sql'), 'utf8');
    assert.ok(unassigned.indexOf('(v_all or w.form = v_form)') !== -1, 'unassigned file keeps ALL-form support');
});

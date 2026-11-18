/* PurrStack — two-step game over (review -> Top 7) and the teacher
   dashboard card. No browser, no network, no database: the real iframe
   helpers, js/shared.js and js/admin.js are exercised in a vm. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const gameHtml = fs.readFileSync(path.join(root, 'vocab-tetris-demo.html'), 'utf8');
const sharedSource = fs.readFileSync(path.join(root, 'js/shared.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');

const ORIGIN = 'https://tydictation.vercel.app';

/* ---------------- helpers ---------------- */

function makeStorage() {
    const map = new Map();
    return {
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { map.set(k, String(v)); },
        removeItem(k) { map.delete(k); },
        clear() { map.clear(); }
    };
}

function makeEl(id) {
    return {
        id,
        innerHTML: '',
        textContent: '',
        attrs: {},
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k]; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {}
    };
}

/* Fake supabase client: every table returns rows / errors from state. */
function makeSb(state) {
    function result(table) {
        if (state.errorTables[table]) return { data: null, error: { message: 'relation "' + table + '" does not exist' } };
        return { data: state.rows[table] || [], error: null, count: state.counts[table] };
    }
    function chain(table) {
        const query = { table, select: null, orders: [], limit: null, count: null, gte: [] };
        state.queries.push(query);
        const api = {
            select(cols, opts) {
                query.select = cols;
                if (opts && opts.count) query.count = opts.count;
                return api;
            },
            insert(payload) {
                state.inserts.push({ table, payload });
                return api;
            },
            order(col, opts) {
                query.orders.push([col, opts ? !!opts.ascending : true]);
                return api;
            },
            gte(col, value) { query.gte.push([col, value]); return api; },
            limit(n) { query.limit = n; return Promise.resolve(result(table)); },
            then(resolve, reject) { return Promise.resolve(result(table)).then(resolve, reject); },
            catch(reject) { return Promise.resolve(result(table)).catch(reject); }
        };
        return api;
    }
    return {
        from(table) {
            state.events.push('from:' + table);
            return chain(table);
        }
    };
}

function makeContext(extra) {
    const byId = (extra && extra.byId) || {};
    const context = vm.createContext(Object.assign({
        console: { log() {}, warn() {}, error() {} },
        window: {
            supabase: { createClient: () => (extra && extra.sb) || makeSb({}) },
            addEventListener() {},
            removeEventListener() {},
            location: { origin: ORIGIN, search: '', href: ORIGIN + '/' }
        },
        document: {
            getElementById: (id) => byId[id] || null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {},
            removeEventListener() {},
            body: makeEl('body'),
            createElement: () => makeEl('created')
        },
        navigator: { userAgent: 'unit-test-agent' },
        localStorage: makeStorage(),
        sessionStorage: makeStorage(),
        location: { origin: ORIGIN, search: '', href: ORIGIN + '/' },
        requestAnimationFrame: (fn) => fn,
        alert() {},
        confirm: () => true
    }, extra && extra.globals));
    if (extra && extra.sb) context.window.supabase.createClient = () => extra.sb;
    context.document.defaultView = context.window;
    return context;
}

/* ---------------- 1) iframe game-over helpers ---------------- */

function loadGameHelpers() {
    const start = gameHtml.indexOf('/* ---- purrstack end-of-game helpers');
    const end = gameHtml.indexOf('/* ---- end purrstack end-of-game helpers');
    assert.ok(start !== -1 && end !== -1, 'the two-step game-over helpers are marked');
    const code = gameHtml.slice(start, end) + '\nthis.H = { purrEndStep, purrNextStep, purrBoardHTML, purrCanPeek };';
    const context = vm.createContext({ console });
    vm.runInContext(code, context);
    return context.H;
}

test('zero wrong words skips the review step and goes straight to ranking', () => {
    const H = loadGameHelpers();
    assert.equal(H.purrEndStep(0), 'rank');
    assert.equal(H.purrEndStep(undefined), 'rank');
    assert.equal(H.purrNextStep('rank'), 'rank');
});

test('with wrong words the first step is review, and Next switches to ranking', () => {
    const H = loadGameHelpers();
    assert.equal(H.purrEndStep(2), 'review');
    assert.equal(H.purrNextStep('review'), 'rank');
    // The game itself wires endGame to that decision and Next to that switch.
    assert.match(gameHtml, /setOverlay\(purrEndStep\(wrongWords\.length\)\)/);
    assert.match(gameHtml, /overlayMode === 'review'\) setOverlay\(purrNextStep\(overlayMode\)\)/);
    assert.match(gameHtml, /overlayBtn\.textContent = 'Next →'/);
});

test('the game still posts the score before the ranking step', () => {
    const endGameAt = gameHtml.indexOf('function endGame()');
    const postAt = gameHtml.indexOf("type: 'purrstack-score'", endGameAt);
    const overlayAt = gameHtml.indexOf('setOverlay(purrEndStep', endGameAt);
    assert.ok(postAt !== -1, 'endGame posts purrstack-score');
    assert.ok(overlayAt !== -1 && postAt < overlayAt, 'the score is saved before the card changes');
    assert.match(gameHtml, /event\.origin !== window\.location\.origin/, 'iframe only accepts same-origin replies');
    assert.match(gameHtml, /data\.type !== 'purrstack-board'/);
});

test('the ranking card shows Loading, guest, SQL hint and Top 7 rows', () => {
    const H = loadGameHelpers();
    const me = 'user-1';
    assert.match(H.purrBoardHTML({ status: 'loading' }), /Loading…/);

    const guest = H.purrBoardHTML({ status: 'ready', guest: true });
    assert.match(guest, /Leaderboards are hidden in guest mode/);
    assert.doesNotMatch(guest, /rank-row/);

    const missing = H.purrBoardHTML({ status: 'ready', error: true });
    assert.match(missing, /supabase\/purrstack_scores\.sql/);
    // A missing view never breaks the rest of the helpers.
    assert.equal(H.purrEndStep(1), 'review');

    const rows = [
        { user_id: 'a', nickname: 'Alice', score: 300, words: 12 },
        { user_id: me, nickname: 'Me <b>', score: 200, words: 9 },
        { user_id: 'c', email: 'c@school.hk', score: 100, words: 4 }
    ];
    const board = H.purrBoardHTML({ status: 'ready', rows, me });
    assert.match(board, /🏆 Top 7/);
    assert.match(board, /🥇/);
    assert.match(board, /300 pts/);
    assert.match(board, /12 words/);
    assert.match(board, /200 pts/);
    assert.match(board, /Me &lt;b&gt; \(you\)/);
    assert.match(board, /class="rank-row me"/);
    assert.match(board, /rank-name">c</, 'a missing nickname falls back to the email local part');
    assert.equal((board.match(/class="rank-row/g) || []).length, 3);
});

/* ---------------- 1b) pre-game Top 7 peek (header chip) ---------------- */

test('the start screen header has a Top 7 chip between the logo and the score', () => {
    const brandAt = gameHtml.indexOf('<div class="brand">');
    const btnAt = gameHtml.indexOf('id="top7-btn"');
    const scoreAt = gameHtml.indexOf('<div class="scorebox">');
    assert.ok(brandAt !== -1 && btnAt !== -1 && scoreAt !== -1);
    assert.ok(brandAt < btnAt && btnAt < scoreAt, 'the chip sits in the header gap');

    const open = gameHtml.lastIndexOf('<button', btnAt);
    const tag = gameHtml.slice(open, gameHtml.indexOf('</button>', btnAt) + '</button>'.length);
    assert.ok(open > brandAt && open < scoreAt, 'it is a real button element in the header');
    assert.match(tag, /type="button"/);
    assert.match(tag, /🏆 Top 7/, 'the visible label keeps the trophy and Top 7');
    assert.match(tag, /aria-label="[^"]*Top 7[^"]*"/, 'the chip has an accessible name');

    /* Compact cream / brown chip, in the same family as the scorebox. */
    assert.match(gameHtml, /\.top7-btn \{[^}]*border: 2px solid var\(--linebrown\);/);
    assert.match(gameHtml, /\.top7-btn \{[^}]*background: var\(--cream\);/);
    assert.match(gameHtml, /\.top7-btn \{[^}]*white-space: nowrap;/);

    /* The chip lives on the start screen only: the play HUD keeps no copy. */
    const hudAt = gameHtml.indexOf('<div class="hud">');
    const hudEnd = gameHtml.indexOf('<div class="stage"', hudAt);
    assert.doesNotMatch(gameHtml.slice(hudAt, hudEnd), /top7-btn/);
});

test('opening the peek board asks the parent for the Top 7 and never posts a score', () => {
    const requestAt = gameHtml.indexOf('function requestPeekBoard()');
    const openAt = gameHtml.indexOf('function openPeek()');
    const endAt = gameHtml.indexOf('function endGame()', openAt);
    assert.ok(requestAt !== -1 && openAt !== -1 && endAt !== -1, 'the peek helpers exist');

    const requestSrc = gameHtml.slice(requestAt, openAt);
    assert.match(requestSrc, /type: 'purrstack-board-request'/);
    assert.match(requestSrc, /window\.location\.origin/, 'the request is posted same-origin only');
    assert.doesNotMatch(requestSrc, /purrstack-score/);

    const openSrc = gameHtml.slice(openAt, endAt);
    assert.match(openSrc, /purrCanPeek\(running, gameOver\)/, 'a live run is guarded');
    assert.match(openSrc, /setOverlay\('peek'\)/);
    assert.match(openSrc, /requestPeekBoard\(\)/);
    assert.doesNotMatch(openSrc, /purrstack-score/);
    assert.doesNotMatch(openSrc, /startGame\(\)/, 'peeking never starts or resets a run');

    assert.match(gameHtml, /top7Btn\.addEventListener\('click', openPeek\)/);
    assert.equal((gameHtml.match(/type: 'purrstack-score'/g) || []).length, 1,
        'only endGame saves a run score');
});

test('the peek chip does nothing during a run but opens on the start / finished card', () => {
    const H = loadGameHelpers();
    assert.equal(H.purrCanPeek(true, false), false, 'a run in progress is never interrupted');
    assert.equal(H.purrCanPeek(false, false), true, 'the start card can peek');
    assert.equal(H.purrCanPeek(true, true), true, 'the finished game can peek');
    assert.equal(H.purrCanPeek(false, true), true);
});

test('the peek card is a Top 7 board, not a game-over card, and hides the run stats', () => {
    const at = gameHtml.indexOf("} else if (mode === 'peek') {");
    assert.ok(at !== -1, 'setOverlay has a dedicated peek mode');
    const end = gameHtml.indexOf('} else {', at);
    assert.ok(end !== -1, 'the peek branch is closed');
    const src = gameHtml.slice(at, end);

    assert.match(src, /overlayTitle\.textContent = 'Top 7'/);
    assert.doesNotMatch(src, /Game over/);
    assert.doesNotMatch(src, /New best/);
    assert.match(src, /renderPeekStep\(\)/);
    assert.match(src, /overlayBtn\.textContent = '← Back'/);

    /* score / best / words stay on the finished-run card only. */
    assert.match(gameHtml, /overlayStats\.style\.display = mode === 'rank' \? 'flex' : 'none'/);
    assert.match(gameHtml, /overlayBoard\.style\.display = \(mode === 'rank' \|\| mode === 'peek'\) \? 'block' : 'none'/);

    /* Same rows / guest / SQL-missing rendering as the post-game board. */
    const peekAt = gameHtml.indexOf('function renderPeekStep()');
    const peekSrc = gameHtml.slice(peekAt, gameHtml.indexOf('function openPeek()', peekAt));
    assert.ok(peekAt !== -1);
    assert.match(peekSrc, /purrBoardHTML\(rankBoard\)/);
    assert.match(gameHtml, /overlayMode === 'peek'\) renderPeekStep\(\)/,
        'a late board reply refreshes the peek card too');
    assert.ok(gameHtml.indexOf('function requestPeekBoard()') < gameHtml.indexOf('function openPeek()'),
        'the peek board is requested after the card opens');
});

test('Back from the peek card returns to the start card and never starts a run', () => {
    const at = gameHtml.indexOf('overlayBtn.addEventListener');
    const end = gameHtml.indexOf('startBtn.addEventListener', at);
    assert.ok(at !== -1 && end !== -1);
    const src = gameHtml.slice(at, end);

    assert.match(src, /overlayMode === 'paused'\) togglePause\(\)/);
    assert.match(src, /overlayMode === 'review'\) setOverlay\(purrNextStep\(overlayMode\)\)/);

    const peekAt = src.indexOf("overlayMode === 'peek'");
    assert.ok(peekAt !== -1, 'the peek branch exists');
    assert.match(src.slice(peekAt), /^overlayMode === 'peek'\) setOverlay\('start'\);/,
        'Back restores the start card');

    const fallbackAt = src.indexOf('else startGame();');
    assert.ok(fallbackAt !== -1 && fallbackAt > peekAt,
        'startGame stays the fallback for a finished / start card only');
});

/* ---------------- 2) parent side: submit + board reply ---------------- */

function loadShared(options) {
    const opts = options || {};
    const state = {
        events: [],
        queries: [],
        inserts: [],
        posts: [],
        rows: opts.rows || {},
        counts: opts.counts || {},
        errorTables: opts.errorTables || {}
    };
    const sb = makeSb(state);
    const frame = makeEl('purrstack-frame');
    frame.contentWindow = {
        postMessage(message, target) { state.posts.push({ message, target }); }
    };
    const context = makeContext({ sb, byId: { 'purrstack-frame': frame } });
    vm.runInContext(sharedSource, context);
    return { context, state, frame, run: (code) => vm.runInContext(code, context) };
}

const RUN = "{ type:'purrstack-score', score:120, words:8, correct:6, wrong:2, bestCombo:4 }";

test('a guest score is not inserted and the board reply is marked guest', async () => {
    const { run, state } = loadShared();
    const reply = await run('submitPurrStackScore(' + RUN + ')');
    assert.equal(state.inserts.length, 0, 'guests never upload');
    assert.equal(state.queries.length, 0, 'guests do not query the board');
    assert.equal(reply.guest, true);
    assert.equal(state.posts.length, 1);
    assert.equal(state.posts[0].target, ORIGIN);
    assert.equal(state.posts[0].message.type, 'purrstack-board');
    assert.equal(state.posts[0].message.guest, true);
});

test('a teacher preview score is not inserted either', async () => {
    const { run, state } = loadShared();
    run('currentUser = { id: "u1", email: "4C 01 Chan@lstyoungkhl.edu.hk", user_metadata: {} };');
    run('previewStudentForm = function () { return "F4"; };');
    const reply = await run('submitPurrStackScore(' + RUN + ')');
    assert.equal(state.inserts.length, 0);
    assert.equal(reply.guest, true);
    assert.equal(state.posts[0].message.guest, true);
});

test('a signed-in run is saved, then the top 7 board is posted back', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
        user_id: i === 1 ? 'u1' : 'u' + i,
        nickname: 'Player ' + i,
        email: 's' + i + '@lstyoungkhl.edu.hk',
        score: 700 - i * 10,
        words: 20 - i,
        created_at: '2026-11-' + (10 + i) + 'T00:00:00Z'
    }));
    const { run, state } = loadShared({ rows: { purrstack_scores: [], purrstack_leaderboard: rows } });
    run('currentUser = { id: "u1", email: "4C 01 Chan@lstyoungkhl.edu.hk", user_metadata: { full_name: "4C 01 Chan" } };');

    const reply = await run('submitPurrStackScore(' + RUN + ')');

    assert.equal(state.inserts.length, 1);
    const insert = state.inserts[0];
    assert.equal(insert.table, 'purrstack_scores');
    assert.equal(insert.payload.user_id, 'u1');
    assert.equal(insert.payload.score, 120);
    assert.equal(insert.payload.words, 8);
    assert.equal(insert.payload.correct, 6);
    assert.equal(insert.payload.wrong, 2);
    assert.equal(insert.payload.best_combo, 4);

    const boardQuery = state.queries.find((q) => q.table === 'purrstack_leaderboard');
    assert.ok(boardQuery, 'the board is fetched after the insert');
    assert.deepEqual(boardQuery.orders, [['score', false], ['words', false], ['created_at', true]]);
    assert.equal(boardQuery.limit, 7);

    assert.equal(reply.guest, false);
    assert.equal(reply.error, false);
    assert.equal(reply.me, 'u1');
    assert.equal(reply.rows.length, 7);
    assert.equal(state.posts.length, 1, 'exactly one reply is posted');
    assert.equal(state.posts[0].message.rows.length, 7);
    assert.equal(state.posts[0].target, ORIGIN);
});

test('a missing leaderboard view surfaces the SQL hint without breaking the score post', async () => {
    const { run, state } = loadShared({ errorTables: { purrstack_leaderboard: true } });
    run('currentUser = { id: "u1", email: "4C 01 Chan@lstyoungkhl.edu.hk", user_metadata: {} };');
    const reply = await run('submitPurrStackScore(' + RUN + ')');
    assert.equal(state.inserts.length, 1, 'the run is still saved when the view is missing');
    assert.equal(reply.error, true);
    assert.deepEqual(Array.from(reply.rows), []);
    const posted = state.posts[0].message;
    assert.equal(posted.type, 'purrstack-board');
    assert.equal(posted.error, true);
    assert.equal(posted.guest, false);
});

/* ---------------- 2b) parent side: pre-game board request ---------------- */

test('a board request from a signed-in student reads the top 7 and saves nothing', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
        user_id: i === 1 ? 'u1' : 'u' + i,
        nickname: 'Player ' + i,
        email: 's' + i + '@lstyoungkhl.edu.hk',
        score: 700 - i * 10,
        words: 20 - i,
        created_at: '2026-11-' + (10 + i) + 'T00:00:00Z'
    }));
    const { run, state } = loadShared({ rows: { purrstack_leaderboard: rows } });
    run('currentUser = { id: "u1", email: "4C 01 Chan@lstyoungkhl.edu.hk", user_metadata: { full_name: "4C 01 Chan" } };');

    const reply = await run('requestPurrStackBoard()');

    assert.equal(state.inserts.length, 0, 'viewing the board never saves a score');
    const boardQuery = state.queries.find((q) => q.table === 'purrstack_leaderboard');
    assert.ok(boardQuery, 'the board is fetched');
    assert.deepEqual(boardQuery.orders, [['score', false], ['words', false], ['created_at', true]]);
    assert.equal(boardQuery.limit, 7);

    assert.equal(reply.type, 'purrstack-board');
    assert.equal(reply.guest, false);
    assert.equal(reply.error, false);
    assert.equal(reply.me, 'u1');
    assert.equal(reply.rows.length, 7);

    assert.equal(state.posts.length, 1, 'exactly one board reply is posted');
    assert.equal(state.posts[0].message.type, 'purrstack-board');
    assert.equal(state.posts[0].target, ORIGIN);
});

test('a guest board request is marked guest and neither queries nor inserts', async () => {
    const { run, state } = loadShared();
    const reply = await run('requestPurrStackBoard()');
    assert.equal(state.inserts.length, 0);
    assert.equal(state.queries.length, 0, 'guests do not query the shared board');
    assert.equal(reply.guest, true);
    assert.deepEqual(Array.from(reply.rows), []);
    assert.equal(state.posts.length, 1);
    assert.equal(state.posts[0].message.guest, true);
});

test('a board request from a teacher preview is also marked guest', async () => {
    const { run, state } = loadShared();
    run('currentUser = { id: "u1", email: "4C 01 Chan@lstyoungkhl.edu.hk", user_metadata: {} };');
    run('previewStudentForm = function () { return "F4"; };');
    const reply = await run('requestPurrStackBoard()');
    assert.equal(state.inserts.length, 0);
    assert.equal(state.queries.length, 0);
    assert.equal(reply.guest, true);
});

test('a board request with a missing view returns the SQL hint and never inserts', async () => {
    const { run, state } = loadShared({ errorTables: { purrstack_leaderboard: true } });
    run('currentUser = { id: "u1", email: "4C 01 Chan@lstyoungkhl.edu.hk", user_metadata: {} };');
    const reply = await run('requestPurrStackBoard()');
    assert.equal(state.inserts.length, 0, 'a failed read must not write anything either');
    assert.equal(reply.error, true);
    assert.equal(reply.guest, false);
    assert.deepEqual(Array.from(reply.rows), []);
    assert.equal(state.posts[0].message.type, 'purrstack-board');
    assert.equal(state.posts[0].message.error, true);
});

test('the page listens for the peek request next to the score post', () => {
    assert.match(sharedSource, /data\.type === 'purrstack-score'/);
    assert.match(sharedSource, /data\.type === 'purrstack-board-request'/);
    const requestAt = sharedSource.indexOf("data.type === 'purrstack-board-request'");
    const handler = sharedSource.slice(requestAt, sharedSource.indexOf('});', requestAt));
    assert.doesNotMatch(handler, /purrstack_scores/, 'the request path never touches the table');
    assert.match(handler, /requestPurrStackBoard\(\)/);
});

/* ---------------- 3) admin dashboard ---------------- */

test('index.html has a PurrStack admin card between Word Jump and Speak Flap', () => {
    const wj = htmlSource.indexOf('id="wj-admin-stats"');
    const purr = htmlSource.indexOf('id="purrstack-admin-stats"');
    const flap = htmlSource.indexOf('id="flap-admin-stats"');
    assert.ok(wj !== -1 && purr !== -1 && flap !== -1);
    assert.ok(wj < purr && purr < flap, 'PurrStack stats sit after Word Jump and before Speak Flap');
    assert.ok(htmlSource.indexOf('>🐾 PurrStack</h2>') !== -1);
    assert.ok(htmlSource.indexOf('id="purrstack-admin-container"') !== -1);
    assert.ok(htmlSource.indexOf('onclick="loadPurrStackAdmin(true)"') !== -1);
    assert.ok(sharedSource.indexOf('loadPurrStackAdmin()') !== -1, 'the admin view loads it');
});

function loadAdmin(options) {
    const opts = options || {};
    const stats = makeEl('purrstack-admin-stats');
    const list = makeEl('purrstack-admin-container');
    const state = {
        events: [],
        queries: [],
        inserts: [],
        posts: [],
        rows: opts.rows || {},
        counts: opts.counts || {},
        errorTables: opts.errorTables || {}
    };
    const sb = makeSb(state);
    const context = makeContext({
        sb,
        byId: { 'purrstack-admin-stats': stats, 'purrstack-admin-container': list },
        globals: { ensureFormDirectory: () => Promise.resolve() }
    });
    vm.runInContext(sharedSource, context);
    vm.runInContext(adminSource, context);
    vm.runInContext('currentUser = { email: ADMIN_EMAIL };', context);
    return { context, state, stats, list, run: (code) => vm.runInContext(code, context) };
}

test('loadPurrStackAdmin groups personal bests by form with Word Jump style stats', async () => {
    const rows = [
        { user_id: 'a', nickname: '4C 01 Chan', email: 'a@lstyoungkhl.edu.hk', score: 640, words: 18, created_at: '2026-11-17T02:00:00Z' },
        { user_id: 'b', nickname: '3A 08 Lee', email: 'b@lstyoungkhl.edu.hk', score: 410, words: 11, created_at: '2026-11-16T02:00:00Z' }
    ];
    const { run, state, stats, list } = loadAdmin({
        rows: { purrstack_leaderboard: rows, purrstack_scores: [] },
        counts: { purrstack_scores: 12 }
    });
    await run('loadPurrStackAdmin()');

    const boardQuery = state.queries.find((q) => q.table === 'purrstack_leaderboard');
    assert.ok(boardQuery);
    assert.deepEqual(boardQuery.orders, [['score', false], ['words', false], ['created_at', true]]);
    assert.equal(boardQuery.limit, 1000);
    const totals = state.queries.filter((q) => q.table === 'purrstack_scores');
    assert.equal(totals.length, 2, 'one total count plus one today count');
    assert.deepEqual(totals[0].count, 'exact');
    assert.equal(totals[1].gte.length, 1, 'today uses the Hong Kong day start');

    assert.match(stats.innerHTML, /Students/);
    assert.match(stats.innerHTML, /Games played/);
    assert.match(stats.innerHTML, /Top score/);
    assert.match(stats.innerHTML, /Today/);
    assert.match(stats.innerHTML, /640/, 'top score');
    assert.match(list.innerHTML, /4C 01 Chan/);
    assert.match(list.innerHTML, /3A 08 Lee/);
    assert.match(list.innerHTML, /640 pts/);
    assert.match(list.innerHTML, /18 words/);
    assert.match(list.innerHTML, /data-form-scope="purrstack-admin"/);
    assert.match(list.innerHTML, /aria-label="Expand/);
});

test('a missing PurrStack table shows the SQL hint and leaves the game helpers alone', async () => {
    const { run, stats, list } = loadAdmin({ errorTables: { purrstack_leaderboard: true } });
    await run('loadPurrStackAdmin()');
    assert.equal(stats.innerHTML, '');
    assert.match(list.innerHTML, /supabase\/purrstack_scores\.sql/);
    assert.doesNotMatch(list.innerHTML, /No PurrStack games recorded yet/);

    const H = loadGameHelpers();
    assert.equal(H.purrEndStep(0), 'rank', 'the game itself still finishes');
    assert.match(H.purrBoardHTML({ status: 'ready', error: true }), /supabase\/purrstack_scores\.sql/);
});

/* ---------------- 4) phone play inside the site iframe ---------------- */

function cssRule(source, selector) {
    const at = source.indexOf(selector + ' {');
    assert.ok(at !== -1, 'CSS rule ' + selector + ' exists');
    const end = source.indexOf('}', at);
    assert.ok(end !== -1, 'CSS rule ' + selector + ' is closed');
    return source.slice(at, end + 1);
}

test('phone play fills the iframe and never re-adds the bottom safe area', () => {
    const app = cssRule(gameHtml, 'body.playing-phone .app');
    assert.match(app, /height:\s*100%;/, 'the iframe height, not the phone screen');
    assert.doesNotMatch(app, /100dvh/, 'no dvh: that measures the wrong box inside an iframe');
    assert.doesNotMatch(app, /safe-area/, 'the parent iframe already sits above the home indicator');
    assert.match(app, /padding:\s*2px 2px 3px;/, '3px bottom is the start bar shadow, not a safe-area gap');
    assert.match(app, /max-width:\s*none;/, 'allowed to use the full iframe width');
    assert.match(app, /display:\s*flex;/);
    assert.match(app, /flex-direction:\s*column;/);

    /* The document fills the iframe (height chain), never the phone screen. */
    const phoneBody = cssRule(gameHtml, 'body.playing-phone,\n  body.playing-phone.css-fs');
    assert.match(phoneBody, /height:\s*100%;/);
    assert.match(phoneBody, /overflow:\s*hidden;/, 'no page scroll: that reopens the wallpaper gap');
    assert.doesNotMatch(phoneBody, /overflow-y:\s*auto/);
    assert.doesNotMatch(phoneBody, /100dvh/);

    const cssFs = cssRule(gameHtml, 'body.css-fs .app');
    assert.doesNotMatch(cssFs, /100dvh/);
    assert.match(cssFs, /min-height:\s*100%;/);

    /* No phone-play rule may reserve the bottom inset a second time. */
    const phoneRules = gameHtml.slice(
        gameHtml.indexOf('/* ---- Phone play inside the site iframe'),
        gameHtml.indexOf('</style>'));
    assert.ok(phoneRules.length > 0);
    assert.doesNotMatch(phoneRules, /env\(safe-area-inset-bottom\)/);
    assert.doesNotMatch(phoneRules, /100dvh/);
});

test('phone play pins the start bar to the bottom and gives the rest to the stage', () => {
    const stage = cssRule(gameHtml, 'body.playing-phone .app > .stage');
    assert.match(stage, /flex:\s*1 1 0;/, 'the board area is exactly the leftover height');
    assert.match(stage, /min-height:\s*0;/);

    const bar = cssRule(gameHtml, 'body.playing-phone .app > .startbar');
    assert.match(bar, /flex:\s*0 0 auto;/, 'the bar never shrinks');
    assert.match(bar, /margin-top:\s*3px;/);
    assert.match(bar, /margin-bottom:\s*0;/, 'nothing under the bar, so it sits flush');

    /* The parent iframe is what reserves room for the tab bar. */
    assert.match(htmlSource, /#purrstack-view \{[^}]*bottom: calc\(58px \+ env\(safe-area-inset-bottom\)\)/);
});

function loadSizingHelpers() {
    const start = gameHtml.indexOf('/* ---- purrstack phone-play sizing');
    const end = gameHtml.indexOf('/* ---- end purrstack phone-play sizing');
    assert.ok(start !== -1 && end !== -1, 'the phone-play sizing helpers are marked');
    const code = gameHtml.slice(start, end)
        + '\nthis.S = { purrContainerHeight, purrBoardHeight, purrBoardLeftover, purrStageFrame, PURR_STAGE_FRAME };';
    const context = vm.createContext({ console });
    vm.runInContext(code, context);
    return context.S;
}

test('the board height comes from the game container, not the phone screen', () => {
    const S = loadSizingHelpers();

    /* 560px of iframe inside a 900px phone screen: only 560 may be used. */
    assert.equal(S.purrContainerHeight(
        { clientHeight: 560 },
        { innerHeight: 900 },
        { documentElement: { clientHeight: 900 } }), 560);
    /* Falls back to the document, then the window, when nothing is measurable. */
    assert.equal(S.purrContainerHeight(
        { clientHeight: 0 },
        { innerHeight: 900 },
        { documentElement: { clientHeight: 640 } }), 640);
    assert.equal(S.purrContainerHeight(
        null,
        { innerHeight: 900 },
        { documentElement: { clientHeight: 0 } }), 900);

    /* 560 for the app minus 240 of chrome AND the 6px stage frame leaves 314
       for the canvas, minus rounding. The old 320 (no border) is gone. */
    const budget = S.purrBoardHeight(560, 240);
    assert.ok(budget >= 309 && budget <= 314, 'the board budget removes the stage frame, got ' + budget);
    assert.ok(budget < 560 - 240, 'the too-tall board that ignored the 3px borders is no longer used');
    assert.ok(S.purrBoardLeftover(320) <= 4);
    assert.equal(S.purrBoardLeftover(0), 0);
    assert.ok(S.purrBoardHeight(560, 240) > S.purrBoardHeight(560, 300), 'more chrome = smaller board');

    /* The frame is measured from the live stage style, with a 3px+3px default. */
    assert.equal(S.PURR_STAGE_FRAME, 6);
    assert.equal(S.purrStageFrame({ borderTopWidth: '3px', borderBottomWidth: '3px' }), 6);
    assert.equal(S.purrStageFrame({ borderTopWidth: '0px', borderBottomWidth: '0px' }), 6, 'falls back to the default frame');
    assert.equal(S.purrStageFrame(null), 6);
    assert.equal(S.purrBoardHeight(560, 240, 0), 319, 'an explicit zero frame restores the old maths');

    /* Never negative, and keeps a usable board on a cramped screen. */
    assert.equal(S.purrBoardHeight(100, 240), 120);
    assert.equal(S.purrBoardHeight(undefined, undefined), 120);
});

test('the canvas, the stage border, the chrome and the bar shadow all fit the container', () => {
    const S = loadSizingHelpers();
    const containerH = 640;
    const chrome = 210; /* hud + zones + controls + start bar + 3px bar shadow */
    const frame = S.purrStageFrame({ borderTopWidth: '3px', borderBottomWidth: '3px' });
    const board = S.purrBoardHeight(containerH, chrome, frame);
    assert.ok(board + frame + chrome <= containerH,
        'canvas ' + board + ' + border ' + frame + ' + chrome ' + chrome + ' must not push the bar out');
    /* There is real leftover for the button shadow / rounding, but never a
       safe-area-sized strip of wallpaper. */
    assert.ok(containerH - (board + frame + chrome) >= 0);
    assert.ok(containerH - (board + frame + chrome) <= 4);
});

test('resizeCanvas measures the container and keeps the 12:20 board ratio', () => {
    const at = gameHtml.indexOf('function resizeCanvas()');
    assert.ok(at !== -1);
    const src = gameHtml.slice(at, gameHtml.indexOf('function roundedRect', at));
    assert.match(src, /purrContainerHeight\(app, window, document\)/);
    assert.match(src, /purrStageFrame\(stageStyle\)/, 'the 3px stage border is measured, not assumed');
    assert.match(src, /purrBoardHeight\(containerH, chrome, frameY\)/, 'the frame is removed from the board budget');
    assert.doesNotMatch(src, /purrBoardHeight\(containerH, chrome\)/, 'the border-less budget is gone');
    assert.match(src, /Math\.max\(0, appW - frameX\) \/ COLS/, 'the side borders are not part of the board width');
    assert.doesNotMatch(src, /window\.innerHeight - chrome/, 'the old innerHeight - chrome - 12 maths is gone');
    assert.doesNotMatch(src, /- chrome - 12/);
    assert.match(src, /Math\.min\(byW, byH\)/, 'cell = min(width / 12, height / 20)');
    assert.match(gameHtml, /const COLS = 12;/);
    assert.match(gameHtml, /const ROWS = 20;/);
});

test('game over keeps the start bar fully on screen in enlarged phone play', () => {
    /* The two-step cards open inside .stage, so the pinned start bar below it
       is never covered or removed. */
    const stageAt = gameHtml.indexOf('<div class="stage" id="stage">');
    const overlayAt = gameHtml.indexOf('<div class="overlay" id="overlay">');
    const zonesAt = gameHtml.indexOf('<div class="zones">');
    const barAt = gameHtml.indexOf('<div class="startbar">');
    assert.ok(stageAt !== -1 && overlayAt !== -1 && zonesAt !== -1 && barAt !== -1);
    assert.ok(stageAt < overlayAt && overlayAt < zonesAt && zonesAt < barAt,
        'the overlay lives inside the stage; the start bar stays after it');

    /* endGame only swaps the card: it never hides the start bar. */
    const endAt = gameHtml.indexOf('function endGame()');
    const endSrc = gameHtml.slice(endAt, gameHtml.indexOf('function resetGame()', endAt));
    assert.doesNotMatch(endSrc, /startbar/);
    assert.doesNotMatch(endSrc, /startBtn\.style/);
    assert.match(endSrc, /setOverlay\(purrEndStep\(wrongWords\.length\)\)/, 'review / Top 7 card');
    assert.match(endSrc, /updateStartBtn\(\)/, 'the Restart button label is refreshed');

    /* Opening the card re-runs the phone sizing, so the board cannot grow past
       the bar while the enlarged layout is still on. */
    const overlaySrc = gameHtml.slice(
        gameHtml.indexOf('function setOverlay(mode)'),
        gameHtml.indexOf('function loop(ts)', gameHtml.indexOf('function setOverlay(mode)')));
    assert.match(overlaySrc, /classList\.contains\('playing-phone'\)/);
    assert.match(overlaySrc, /resizeCanvas\(\)/);

    /* The bar itself is never hidden by CSS in phone play. */
    const phoneRules = gameHtml.slice(
        gameHtml.indexOf('/* ---- Phone play inside the site iframe'),
        gameHtml.indexOf('</style>'));
    assert.doesNotMatch(phoneRules, /\.startbar[^}]*display:\s*none/);
});

/* ---------------- 5) hold-to-slide on ◀ ▶ (delayed auto-shift) ---------------- */

function holdBlock() {
    const at = gameHtml.indexOf('/* Hold to slide (delayed auto-shift)');
    const end = gameHtml.indexOf('function softDrop()', at);
    assert.ok(at !== -1 && end !== -1, 'the hold-to-slide block is marked');
    return gameHtml.slice(at, end);
}

test('◀ ▶ step once on pointerdown then auto-repeat on a delay, not on click', () => {
    const src = holdBlock();
    assert.doesNotMatch(gameHtml, /leftBtn\.addEventListener\('click'/, 'no click-only movement');
    assert.doesNotMatch(gameHtml, /rightBtn\.addEventListener\('click'/);
    assert.match(gameHtml, /bindHoldButton\(leftBtn, -1\);/);
    assert.match(gameHtml, /bindHoldButton\(rightBtn, 1\);/);

    assert.match(src, /addEventListener\('pointerdown'/);
    assert.match(src, /'pointerup'/);
    assert.match(src, /'pointercancel'/);
    assert.match(src, /'lostpointercapture'/);
    assert.match(src, /setPointerCapture\(e\.pointerId\)/, 'capture is attempted when allowed');
    assert.match(src, /contextmenu/, 'the long-press context menu is suppressed');

    /* One immediate column on tap, then a DAS delay (180-220ms) and a fast
       repeat (45-70ms) that steps one column at a time. */
    assert.match(src, /move\(dir\);\s+\/\* a short tap must not feel delayed \*\//);
    const delay = Number((src.match(/HOLD_DAS_DELAY = (\d+)/) || [])[1]);
    const repeat = Number((src.match(/HOLD_DAS_REPEAT = (\d+)/) || [])[1]);
    assert.ok(delay >= 180 && delay <= 220, 'DAS delay is short but not instant, got ' + delay);
    assert.ok(repeat >= 45 && repeat <= 70, 'repeat is fast but still one column at a time, got ' + repeat);
    assert.match(src, /holdDelayTimer = setTimeout\(/);
    assert.match(src, /holdRepeatTimer = setInterval\(function \(\) \{ holdStep\(dir\); \}, HOLD_DAS_REPEAT\)/);
    assert.doesNotMatch(src, /while \(/, 'the piece never flies to the wall in one step');
});

test('the hold stops on release, when blocked, and on pause / end / blur', () => {
    const src = holdBlock();
    /* Release and cancelled touches clear both timers. */
    assert.match(src, /function stopHoldMove\(\) \{[\s\S]*?clearTimeout\(holdDelayTimer\)[\s\S]*?clearInterval\(holdRepeatTimer\)/);
    assert.match(src, /btn\.addEventListener\(name, stopHoldMove\)/);

    /* Blocked / edge / paused / finished clears the repeat instead of idling. */
    assert.match(src, /function holdStep\(dir\) \{[\s\S]*?current\.x === x0\) stopHoldMove\(\)/);

    const pauseAt = gameHtml.indexOf('function togglePause()');
    const pauseSrc = gameHtml.slice(pauseAt, gameHtml.indexOf('function setOverlay(mode)', pauseAt));
    assert.match(pauseSrc, /stopHoldMove\(\)/, 'pausing clears the repeat timer');

    const endAt = gameHtml.indexOf('function endGame()');
    const endSrc = gameHtml.slice(endAt, gameHtml.indexOf('function resetGame()', endAt));
    assert.match(endSrc, /stopHoldMove\(\)/, 'game over clears the repeat timer');

    const startAt = gameHtml.indexOf('function startGame()');
    const startSrc = gameHtml.slice(startAt, gameHtml.indexOf('function togglePause()', startAt));
    assert.match(startSrc, /stopHoldMove\(\)/, 'restarting/starting clears the repeat timer');

    assert.match(gameHtml, /window\.addEventListener\('blur', stopHoldMove\)/);
    const visibilityAt = gameHtml.indexOf("document.addEventListener('visibilitychange'");
    assert.ok(visibilityAt !== -1, 'a hidden tab stops the repeat');
    assert.match(gameHtml.slice(visibilityAt, visibilityAt + 160), /stopHoldMove\(\)/);

    /* The parent's pause message (leaving the PurrStack tab) stops it too. */
    const msgAt = gameHtml.indexOf("e.data === 'purrstack-pause'");
    assert.ok(msgAt !== -1);
    assert.match(gameHtml.slice(msgAt, msgAt + 200), /stopHoldMove\(\)/);
});

test('◀ ▶ are not turned into page scroll while held', () => {
    const rule = cssRule(gameHtml, '#left, #right');
    assert.match(rule, /touch-action:\s*none;/, 'a held button must not cancel on page scroll');
});

test('the arrow / A D keys use the same hold and ignore OS key repeat', () => {
    const keyAt = gameHtml.indexOf("window.addEventListener('keydown'");
    const upAt = gameHtml.indexOf("window.addEventListener('keyup'", keyAt);
    assert.ok(keyAt !== -1 && upAt !== -1);
    const down = gameHtml.slice(keyAt, upAt);

    assert.match(down, /e\.key === 'ArrowLeft' \|\| e\.key === 'a' \|\| e\.key === 'A'/);
    assert.match(down, /e\.key === 'ArrowRight' \|\| e\.key === 'd' \|\| e\.key === 'D'/);
    assert.match(down, /if \(e\.repeat\) return;/, 'our timer owns the repeat');
    assert.match(down, /startHoldMove\(-1\)/);
    assert.match(down, /startHoldMove\(1\)/);
    assert.doesNotMatch(down, /move\(-1\)/, 'a keydown no longer steps on its own');
    assert.doesNotMatch(down, /move\(1\)/);

    const up = gameHtml.slice(upAt, gameHtml.indexOf("window.addEventListener('message'", upAt));
    assert.match(up, /stopHoldMove\(\)/, 'releasing the key stops the slide');
});

/* ---------------- 6) start-screen how-to (point form) ---------------- */

function howtoMarkup() {
    const at = gameHtml.indexOf('<div id="overlay-howto">');
    const end = gameHtml.indexOf('id="overlay-review"', at);
    assert.ok(at !== -1 && end !== -1, 'the guide sits in its own element on the start card');
    return gameHtml.slice(at, end);
}

test('the start card has a point-form How to play + Scoring guide', () => {
    const src = howtoMarkup();
    assert.match(src, /class="howto-head">How to play</);
    assert.match(src, /class="howto-head">Scoring</);
    assert.equal((src.match(/<ul>/g) || []).length, 2, 'two lists');
    assert.ok((src.match(/<li>/g) || []).length >= 12, 'the steps are bullet points');

    /* How to play: zone, hold-to-slide, buttons, board gestures, hold, forms, end. */
    assert.match(src, /matching zone \(Noun \/ Verb \/ Adjective\)/);
    assert.match(src, /◀ ▶ move one column/);
    assert.match(src, /hold either button/);
    assert.match(src, /release to stop/);
    assert.match(src, /⟳ rotates/);
    assert.match(src, /⬇ DROP lands at once/);
    assert.match(src, /🅿 PARK sits the piece fully in its zone/);
    assert.match(src, /tap = rotate/);
    assert.match(src, /drag left\/right = move/);
    assert.match(src, /double-tap, swipe down or long-press = drop/);
    assert.match(src, /5 times per game/);
    assert.match(src, /base forms/);
    assert.match(src, /-ed\) and past participle \(pp\)/);
    assert.match(src, /ends when a new piece cannot fit/);

    /* Scoring: the documented numbers, unchanged. */
    assert.match(src, /Correct placement: <b>\+10<\/b>/);
    assert.match(src, /Wrong placement: <b>−20<\/b>/);
    assert.match(src, /never below 0/);
    assert.match(src, /combo resets/);
    assert.match(src, /Straddling two zones: <b>0 points<\/b>/);
    assert.match(src, /combo is kept/);
    assert.match(src, /Hard drop on a correct piece: <b>\+20 extra<\/b>/);
    assert.match(src, /Line clear: <b>\+100 × lines × combo<\/b>/);
    assert.match(src, /Every 3rd combo triggers a <b>RESCUE<\/b>/);
    assert.match(src, /review missed words/);
    assert.match(src, /Top 7/);
});

test('the guide is a div, never a paragraph, and is not collapsed to one line', () => {
    assert.doesNotMatch(gameHtml, /<p[^>]*id="overlay-howto"/, 'the guide is not a bare p');
    assert.doesNotMatch(gameHtml, /class="overlay-mini"/, 'the truncated start line is retired');
    assert.doesNotMatch(gameHtml, /class="overlay-short"/, 'the one-line phone help is retired');

    const rule = cssRule(gameHtml, '#overlay-howto');
    assert.match(rule, /display:\s*none;/, 'hidden until the start card asks for it');
    assert.match(rule, /max-height:\s*min\(42vh, 280px\)/, 'it scrolls instead of pushing Start away');
    assert.match(rule, /overflow-y:\s*auto/);
    assert.match(rule, /text-align:\s*left;/, 'the lists are left-aligned');
});

test('short and narrow phones keep the guide and never display:none it', () => {
    function mediaBlock(header) {
        const at = gameHtml.indexOf(header);
        assert.ok(at !== -1, 'media query ' + header + ' exists');
        const open = gameHtml.indexOf('{', at);
        let depth = 0;
        let i = open;
        for (; i < gameHtml.length; i += 1) {
            if (gameHtml[i] === '{') depth += 1;
            else if (gameHtml[i] === '}') {
                depth -= 1;
                if (depth === 0) break;
            }
        }
        return gameHtml.slice(at, i + 1);
    }

    ['@media (max-height: 620px)', '@media (max-width: 380px)'].forEach((header) => {
        const block = mediaBlock(header);
        assert.match(block, /#overlay-howto/, 'the guide is tuned for ' + header);
        assert.doesNotMatch(block, /#overlay-howto[^{]*\{[^}]*display:\s*none/,
            header + ' must not hide the guide');
    });

    /* The old collapse rules are gone, so nothing replaces the guide with a line. */
    assert.doesNotMatch(gameHtml, /\.overlay-short/);
    assert.doesNotMatch(gameHtml, /\.overlay-mini/);
});

test("setOverlay('start') shows the how-to and the other cards hide it", () => {
    const at = gameHtml.indexOf('function setOverlay(mode)');
    const end = gameHtml.indexOf('function loop(ts)', at);
    assert.ok(at !== -1 && end !== -1);
    const src = gameHtml.slice(at, end);

    assert.match(src, /const startMode = mode === 'start';/);
    assert.match(src, /overlayHowto\.style\.display = startMode \? 'block' : 'none'/);
    assert.match(src, /overlayText\.style\.display = startMode \? 'none' : ''/,
        'the old paragraph is not repeated on the start card');

    /* The toggle runs before every mode branch, so pause / review / rank / peek
       all keep the guide hidden. */
    const toggleAt = src.indexOf('overlayHowto.style.display');
    ['paused', 'review', 'rank', 'peek'].forEach((mode) => {
        const branchAt = src.indexOf("mode === '" + mode + "'");
        assert.ok(branchAt !== -1, 'the ' + mode + ' card still exists');
        assert.ok(toggleAt < branchAt, 'the guide is hidden for ' + mode);
    });
    assert.ok(gameHtml.indexOf("setOverlay('start')") !== -1, 'the game opens on the start card');
    assert.match(gameHtml, /overlayMode === 'peek'\) setOverlay\('start'\)/);
});

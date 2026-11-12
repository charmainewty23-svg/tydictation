/* Unit tests for the teacher dashboard's "🕵️ Guest logins" card:
   - the + / - expand-collapse controls (same pattern as F3 / F4 / F6 groups)
   - the rolling last-24-hours retention / filter window
   - the prune RPC + 24h cutoff used by loadGuestAdmin
   No browser, no network, no database. js/shared.js and js/admin.js are
   vm-loaded so the real helpers and the real dashboard code are exercised. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sharedSource = fs.readFileSync(path.join(root, 'js/shared.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pruneSql = fs.readFileSync(path.join(root, 'supabase/guest_tracking_prune.sql'), 'utf8');
const guestSql = fs.readFileSync(path.join(root, 'supabase/guest_tracking.sql'), 'utf8');

const HOUR = 3600 * 1000;

/* ---------------- tiny fake DOM / storage / supabase ---------------- */

function makeClassList(initial) {
    const set = new Set(initial || []);
    return {
        add(...names) { names.forEach(n => set.add(n)); },
        remove(...names) { names.forEach(n => set.delete(n)); },
        contains(name) { return set.has(name); },
        toggle(name, force) {
            const on = force === undefined ? !set.has(name) : !!force;
            if (on) set.add(name); else set.delete(name);
            return on;
        },
        _all() { return Array.from(set); }
    };
}

function makeEl(id, classes) {
    const el = {
        id,
        innerHTML: '',
        textContent: '',
        classList: makeClassList(classes),
        attrs: {},
        children: {},
        setAttribute(k, v) { el.attrs[k] = String(v); },
        getAttribute(k) { return el.attrs[k]; },
        querySelector(sel) { return el.children[sel] || null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {}
    };
    return el;
}

function buildGuestDom() {
    const stats = makeEl('guest-admin-stats');
    const list = makeEl('guest-admin-container');
    const body = makeEl('guest-admin-body', ['admin-form-body', 'hidden']);
    const toggles = makeEl('guest-admin-toggles');
    // Mirrors the markup produced by adminFormToggleButtons while collapsed.
    const plus = makeEl('guest-admin-plus', ['admin-form-expand', 'bg-orange-500', 'text-white']);
    const minus = makeEl('guest-admin-minus', ['admin-form-collapse', 'bg-orange-100', 'text-orange-600']);
    const card = makeEl('guest-admin-card');
    card.children = {
        '.admin-form-body': body,
        '.admin-form-expand': plus,
        '.admin-form-collapse': minus
    };
    const byId = {
        'guest-admin-stats': stats,
        'guest-admin-container': list,
        'guest-admin-body': body,
        'guest-admin-toggles': toggles
    };
    return {
        stats,
        list,
        body,
        toggles,
        plus,
        minus,
        card,
        get(id) { return byId[id] || null; },
        querySelector(sel) {
            return /data-form-scope="guest-admin"[\s\S]*data-form-group="all"/.test(sel) ? card : null;
        }
    };
}

function makeStorage() {
    const map = new Map();
    return {
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { map.set(k, String(v)); },
        removeItem(k) { map.delete(k); },
        clear() { map.clear(); }
    };
}

/* Records call order so "prune before select" can be asserted. */
function makeSb(state) {
    function payload(table) {
        const rows = state.rows[table] || [];
        return { data: rows, count: state.counts[table] != null ? state.counts[table] : rows.length, error: null };
    }
    return {
        rpc(name, args) {
            state.events.push('rpc:' + name);
            state.rpc.push({ name, args });
            return Promise.resolve({ data: null, error: state.rpcError || null });
        },
        from(table) {
            state.events.push('from:' + table);
            const query = { table, select: null, count: null, gte: [], order: [], limit: null };
            state.from.push(query);
            const chain = {
                select(cols, opts) { query.select = cols; query.count = opts && opts.count; return chain; },
                gte(col, value) { query.gte.push([col, value]); return chain; },
                order(col, opts) { query.order.push([col, opts]); return chain; },
                limit(n) { query.limit = n; return Promise.resolve(payload(table)); },
                then(res, rej) { return Promise.resolve(payload(table)).then(res, rej); },
                catch(rej) { return Promise.resolve(payload(table)).catch(rej); }
            };
            return chain;
        }
    };
}

function loadAdmin(opts) {
    const options = opts || {};
    const dom = options.dom || buildGuestDom();
    const state = {
        events: [],
        rpc: [],
        from: [],
        rows: options.rows || {},
        counts: options.counts || {},
        rpcError: options.rpcError || null
    };
    const sb = options.sb || makeSb(state);
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        window: {
            supabase: { createClient: () => sb },
            addEventListener() {},
            removeEventListener() {},
            location: { origin: 'https://tydictation.vercel.app', search: '', href: 'https://tydictation.vercel.app/' }
        },
        document: {
            getElementById: (id) => dom.get(id),
            querySelector: (sel) => dom.querySelector(sel),
            querySelectorAll: () => [],
            addEventListener() {},
            removeEventListener() {},
            body: makeEl('body'),
            createElement: () => makeEl('created')
        },
        navigator: { userAgent: 'unit-test-agent' },
        localStorage: makeStorage(),
        sessionStorage: makeStorage(),
        location: { origin: 'https://tydictation.vercel.app', search: '', href: 'https://tydictation.vercel.app/' },
        requestAnimationFrame: (fn) => fn,
        alert() {},
        confirm: () => true
    });
    context.document.defaultView = context.window;
    vm.runInContext(sharedSource, context);
    vm.runInContext(adminSource, context);
    if (options.admin !== false) {
        vm.runInContext('currentUser = { email: ADMIN_EMAIL };', context);
    }
    return { context, dom, state, sb, run: (code) => vm.runInContext(code, context) };
}

/* ---------------- 1) markup / default collapsed ---------------- */

test('the guest card wraps stats and the usage list in a collapsible body', () => {
    const cardAt = htmlSource.indexOf('data-form-scope="guest-admin"');
    const headingAt = htmlSource.indexOf('🕵️ Guest logins');
    const togglesAt = htmlSource.indexOf('id="guest-admin-toggles"');
    const bodyAt = htmlSource.indexOf('id="guest-admin-body"');
    const statsAt = htmlSource.indexOf('id="guest-admin-stats"');
    const listAt = htmlSource.indexOf('id="guest-admin-container"');
    assert.ok(cardAt !== -1 && headingAt !== -1 && togglesAt !== -1, 'guest card must expose the heading toggle slot');
    assert.ok(bodyAt !== -1 && statsAt !== -1 && listAt !== -1);
    assert.ok(togglesAt > cardAt && togglesAt < bodyAt, 'the + / - controls live next to the heading, outside the body');
    assert.ok(bodyAt < statsAt && statsAt < listAt, 'both the stats block and the usage list live inside the body');
    assert.match(htmlSource.slice(bodyAt, bodyAt + 80), /id="guest-admin-body"[^>]*class="admin-form-body hidden"/,
        'the body must start collapsed');
    assert.ok(htmlSource.indexOf('data-form-group="all"') !== -1);
    assert.ok(htmlSource.indexOf('loadGuestAdmin(true)') !== -1, 'the Refresh button stays wired up');
    assert.ok(htmlSource.indexOf('last 24 hours only') !== -1, 'the card description mentions the 24h window');
});

test('guest section starts collapsed, + expands it and - collapses it again', () => {
    const { dom, run } = loadAdmin();

    // Default: unset state is falsy, exactly like the F3 / F4 / F6 groups.
    assert.equal(run('isGuestAdminOpen()'), false);
    assert.equal(run('syncGuestAdminChrome()'), false);
    assert.ok(dom.body.classList.contains('hidden'), 'body hidden by default');
    assert.match(dom.toggles.innerHTML, /class="admin-form-expand[^"]*\bbg-orange-500 text-white\b[^"]*"[^>]*aria-pressed="true"/,
        'the + control is highlighted while collapsed');
    assert.match(dom.toggles.innerHTML, /class="admin-form-collapse[^"]*\bbg-orange-100 text-orange-600\b[^"]*"[^>]*aria-pressed="false"/);
    assert.match(dom.toggles.innerHTML, /aria-label="Expand Guest logins"/);
    assert.match(dom.toggles.innerHTML, /aria-label="Collapse Guest logins"/);
    assert.match(dom.toggles.innerHTML, /w-7 h-7 rounded-full/, 'same circular control as the form groups');
    assert.match(dom.toggles.innerHTML, /onclick="event\.stopPropagation\(\); setAdminFormOpen\('guest-admin','all',true\)"/);

    // Teacher presses +: body opens and the button states flip.
    run("setAdminFormOpen('guest-admin','all',true)");
    assert.equal(run('isGuestAdminOpen()'), true);
    assert.equal(dom.body.classList.contains('hidden'), false);
    assert.equal(run('syncGuestAdminChrome()'), true);
    assert.match(dom.toggles.innerHTML, /class="admin-form-expand[^"]*\bbg-orange-100 text-orange-600\b[^"]*"[^>]*aria-pressed="false"/);
    assert.match(dom.toggles.innerHTML, /class="admin-form-collapse[^"]*\bbg-orange-500 text-white\b[^"]*"[^>]*aria-pressed="true"/);

    // Teacher presses -: back to compact.
    run("setAdminFormOpen('guest-admin','all',false)");
    assert.equal(dom.body.classList.contains('hidden'), true);
    run('syncGuestAdminChrome()');
    assert.match(dom.toggles.innerHTML, /admin-form-expand[^>]*aria-pressed="true"/);
});

test('an expanded guest section stays open across a Refresh', async () => {
    const { dom, run, state } = loadAdmin();
    run("setAdminFormOpen('guest-admin','all',true)");
    await run('loadGuestAdmin(true)');
    assert.ok(state.events.length, 'the refresh really did load');
    assert.equal(dom.body.classList.contains('hidden'), false, 'open/closed state is remembered');
    assert.equal(run('isGuestAdminOpen()'), true);
});

/* ---------------- 2) rolling 24-hour helpers ---------------- */

test('rolling 24h cutoff helpers keep recent rows and drop older ones', () => {
    const { context } = loadAdmin();
    const runIn = (code) => vm.runInContext(code, context);
    const now = Date.parse('2026-11-12T04:00:00Z'); // 12:00 in Hong Kong
    vm.runInContext('var T = ' + now + ';', context);
    assert.equal(runIn('guestRetentionCutoffMs(T)'), now - 24 * HOUR);
    assert.equal(runIn('guestCutoffIso(T)'), new Date(now - 24 * HOUR).toISOString());
    // Rolling window, not a calendar day: 23:30 HK yesterday is still inside it.
    assert.equal(runIn("isWithinGuestLogWindow('2026-11-11T15:30:00Z', T)"), true);
    assert.equal(runIn("isWithinGuestLogWindow('2026-11-12T03:55:00Z', T)"), true);
    assert.equal(runIn("isWithinGuestLogWindow('2026-11-11T03:00:00Z', T)"), false, '25h old is out');
    assert.equal(runIn('isWithinGuestLogWindow(null, T)'), false);
    assert.equal(runIn("isWithinGuestLogWindow('', T)"), false);

    const rows = runIn('filterGuestRecords')([
        { id: 1, created_at: '2026-11-12T03:55:00Z' },
        { id: 2, created_at: '2026-11-11T04:30:00Z' }, // 23.5h old, kept
        { id: 3, created_at: '2026-11-11T03:00:00Z' }  // 25h old, dropped
    ], 'created_at', now);
    assert.deepEqual(Array.from(rows.map(r => r.id)), [1, 2]);

    const summary = runIn('guestAdminSummary')([
        { logged_in_at: '2026-11-12T03:55:00Z' }, // today in HK, inside 24h
        { logged_in_at: '2026-11-11T15:30:00Z' }, // yesterday in HK, still inside 24h
        { logged_in_at: '2026-11-11T03:00:00Z' }  // 25h old, deleted from the DB
    ], [
        { created_at: '2026-11-12T03:50:00Z' },
        { created_at: '2026-11-11T02:00:00Z' }
    ], now);
    assert.equal(summary.logins, 2, 'only the retained logins are counted');
    assert.equal(summary.todayHk, 1, 'HK calendar count is a subcount of the 24h window');
    assert.equal(summary.usage, 1);
});

/* ---------------- 3) loadGuestAdmin: prune then select 24h ---------------- */

test('loadGuestAdmin prunes first, then selects only the last 24 hours', async () => {
    const before = Date.now();
    const { run, state, dom } = loadAdmin({
        rows: {
            guest_logins: [{ id: 1, logged_in_at: new Date().toISOString(), user_agent: 'ua', session_key: 's1' }],
            guest_usage: [{ id: 2, session_key: 's1', feature: 'Word Jump', detail: 'school', created_at: new Date().toISOString() }]
        }
    });
    await run('loadGuestAdmin(true)');

    assert.deepEqual(state.events.slice(0, 3), ['rpc:prune_guest_records', 'from:guest_logins', 'from:guest_usage'],
        'the prune RPC runs before the dashboard selects');
    assert.equal(state.rpc[0].name, 'prune_guest_records');

    const loginsQuery = state.from.find(q => q.table === 'guest_logins');
    const usageQuery = state.from.find(q => q.table === 'guest_usage');
    assert.ok(loginsQuery && usageQuery);
    assert.deepEqual(loginsQuery.gte.map(g => g[0]), ['logged_in_at']);
    assert.deepEqual(usageQuery.gte.map(g => g[0]), ['created_at']);
    const loginCutoff = Date.parse(loginsQuery.gte[0][1]);
    const usageCutoff = Date.parse(usageQuery.gte[0][1]);
    assert.ok(Number.isFinite(loginCutoff) && Number.isFinite(usageCutoff));
    assert.ok(Math.abs((before - 24 * HOUR) - loginCutoff) < 5000, 'cutoff is now minus 24 hours');
    assert.ok(Math.abs(loginCutoff - usageCutoff) < 1000);
    assert.equal(loginsQuery.limit, 500);
    assert.equal(usageQuery.limit, 60);
    assert.equal(loginsQuery.count, 'exact');

    assert.equal(dom.body.classList.contains('hidden'), true, 'a refresh never force-opens the card');
    assert.match(dom.stats.innerHTML, /Guest Logins \(24h\)/);
    assert.ok(dom.stats.innerHTML.indexOf('Last 7 Days') === -1, 'the 7-day card is gone');
    assert.ok(dom.list.innerHTML.indexOf('Word Jump') !== -1);
});

test('loadGuestAdmin does nothing at all for a non-admin', async () => {
    const { run, state } = loadAdmin({ admin: false });
    await run('loadGuestAdmin()');
    assert.deepEqual(state.events, []);
    assert.equal(state.rpc.length, 0);
    assert.equal(state.from.length, 0);
});

test('a failed prune still lets the dashboard load its window', async () => {
    const { run, state, dom } = loadAdmin({
        rpcError: { message: 'function public.prune_guest_records() does not exist' },
        rows: { guest_usage: [{ id: 1, session_key: 's', feature: 'New Vocab', detail: null, created_at: new Date().toISOString() }] }
    });
    await run('loadGuestAdmin()');
    assert.equal(state.from.length, 2);
    assert.ok(dom.list.innerHTML.indexOf('New Vocab') !== -1);
});

/* ---------------- 4) render filters stale rows out ---------------- */

test('rendered list and 24h stats never show a 25-hour-old record', () => {
    const { run, dom } = loadAdmin();
    const now = Date.parse('2026-11-12T04:00:00Z');
    run(`adminCache.guest = ${JSON.stringify({
        logins: [
            { id: 1, logged_in_at: new Date(now - 10 * 60 * 1000).toISOString(), user_agent: 'ua', session_key: 's1' },
            { id: 2, logged_in_at: new Date(now - 25 * HOUR).toISOString(), user_agent: 'ua', session_key: 's2' }
        ],
        loginsCount: 2,
        loginsError: null,
        usage: [
            { id: 3, session_key: 's1', feature: 'Recent Topic', detail: 'school', created_at: new Date(now - 5 * 60 * 1000).toISOString() },
            { id: 4, session_key: 's2', feature: 'Stale Topic', detail: 'animals', created_at: new Date(now - 25 * HOUR).toISOString() }
        ],
        usageError: null,
        loadedAt: now
    })}; renderGuestAdmin();`);

    assert.ok(dom.list.innerHTML.indexOf('Recent Topic') !== -1, 'a few minutes old is shown');
    assert.ok(dom.list.innerHTML.indexOf('Stale Topic') === -1, 'a 25-hour-old browsing record is not shown');
    assert.match(dom.stats.innerHTML, /<div class="text-3xl font-bold text-cyan-600">1<\/div>[\s\S]*Guest Logins \(24h\)/);
    assert.match(dom.stats.innerHTML, /<div class="text-3xl font-bold text-green-600">1<\/div>[\s\S]*Today \(HK\)/);
    assert.match(dom.stats.innerHTML, /<div class="text-3xl font-bold text-purple-600">1<\/div>[\s\S]*Browsing Records \(24h\)/);
    assert.ok(dom.stats.innerHTML.indexOf('Last 7 Days') === -1);
});

/* ---------------- 5) SQL deliverable ---------------- */

test('guest_tracking_prune.sql prunes both tables on a rolling 24 hours', () => {
    assert.match(pruneSql, /mggnwzirjmibreimrwiq\/sql\/new/, 'header points at the live SQL editor');
    assert.match(pruneSql, /Safe to re-run/i);
    assert.match(pruneSql, /incremental/i);
    assert.match(pruneSql, /guest_tracking\.sql/);
    assert.match(pruneSql, /Do NOT paste/i);
    assert.match(pruneSql, /drive_and_go\.sql/);
    assert.match(pruneSql, /drive_and_go_question_count\.sql/);
    assert.match(pruneSql, /drive_and_go_scenes_and_boards\.sql/);
    assert.match(pruneSql, /plugin\/CLI/i, 'the header says not to apply it with a plugin/CLI');

    assert.match(pruneSql, /create or replace function public\.prune_guest_records\(\)/);
    assert.match(pruneSql, /security definer/);
    assert.match(pruneSql, /delete from public\.guest_logins\s+where logged_in_at < now\(\) - interval '24 hours'/);
    assert.match(pruneSql, /delete from public\.guest_usage\s+where created_at < now\(\) - interval '24 hours'/);
    assert.match(pruneSql, /grant execute on function public\.prune_guest_records\(\) to anon, authenticated/);
    assert.ok(pruneSql.indexOf('drop table') === -1, 'existing rows/tables are never dropped');

    const loginFn = pruneSql.slice(pruneSql.indexOf('create or replace function public.record_guest_login'));
    const usageFn = pruneSql.slice(pruneSql.indexOf('create or replace function public.record_guest_usage'));
    assert.ok(loginFn.indexOf('perform public.prune_guest_records();') !== -1, 'login writes prune first');
    assert.ok(usageFn.indexOf('perform public.prune_guest_records();') !== -1, 'usage writes prune first');
});

test('a brand-new install of guest_tracking.sql also ships the 24h prune', () => {
    assert.match(guestSql, /create or replace function public\.prune_guest_records\(\)/);
    assert.match(guestSql, /Rolling last 24 hours/);
    assert.match(guestSql, /delete from public\.guest_logins\s+where logged_in_at < now\(\) - interval '24 hours'/);
    assert.match(guestSql, /delete from public\.guest_usage\s+where created_at < now\(\) - interval '24 hours'/);
    assert.match(guestSql, /grant execute on function public\.prune_guest_records\(\) to anon, authenticated/);
    const loginFn = guestSql.slice(guestSql.indexOf('create or replace function public.record_guest_login'));
    assert.ok(loginFn.indexOf('perform public.prune_guest_records();') !== -1);
    const usageFn = guestSql.slice(guestSql.indexOf('create or replace function public.record_guest_usage'));
    assert.ok(usageFn.indexOf('perform public.prune_guest_records();') !== -1);
    assert.ok(guestSql.indexOf('drop table') === -1, 'tables are never dropped');
});

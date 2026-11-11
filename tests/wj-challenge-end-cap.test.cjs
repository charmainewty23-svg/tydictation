// No network, credentials, dependencies or database writes. Exercise the actual Word Jump Challenge code in js/word-jump.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
// The app JavaScript now lives in js/ files; Word Jump + Challenge is js/word-jump.js.
const wordJump = fs.readFileSync(path.join(__dirname, '../js/word-jump.js'), 'utf8');
const APP_SCRIPTS = ['shared', 'dictation', 'new-vocab', 'grammar-quest', 'grammar/drive-and-go',
    'grammar/drive-and-go-race', 'grammar/drive-and-go-multiplayer',
    'leaderboard', 'admin', 'word-battle', 'word-jump'];

function setup(extra = {}) {
    let now = 0, timer = 0;
    const intervals = new Map(), channels = [], writes = [], removed = [], rpcs = [], overlays = [];
    const WJ = {
        W: 400, H: 600, GRAVITY: 1217, BOOST_G: 668, challenge: true,
        state: 'playing', paused: false, running: true, raf: 7,
        player: { x: 200, y: -80, vx: 80, vy: -882, face: 1, boostHang: true },
        maxClimb: 400,
        score() { return 1200; },
        setOverlay(html) { overlays.push(html); },
        hideOverlay() {},
        beep() {},
        draw() {}
    };
    const box = { WJC: null };
    const chain = (result) => {
        const obj = {
            select() { return obj; }, eq() { return obj; }, update(patch) { writes.push(patch); return obj; },
            maybeSingle() { return Promise.resolve(result()); },
            then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); }
        };
        return obj;
    };
    const sb = {
        channel(topic, options) {
            const ch = { topic, options, messages: [], handlers: {},
                on(type, filter, cb) {
                    this.handlers[type + ':' + (filter && filter.event)] = cb;
                    return this;
                },
                subscribe(cb) { this.status = cb; return this; },
                send(msg) { this.messages.push(msg); return Promise.resolve('ok'); } };
            channels.push(ch); return ch;
        },
        removeChannel(ch) { removed.push(ch); return Promise.resolve('ok'); },
        from(table) {
            return chain(() => table === 'wj_challenge_rooms'
                ? { data: (box.WJC && box.WJC.room) || extra.room || null, error: null }
                : { data: (box.WJC && box.WJC.players) || [], error: null });
        },
        rpc(name, args) {
            rpcs.push({ name, args });
            const room = extra.heartbeatRoom || extra.room || { id: 'room', status: 'playing', started_at: 'match1' };
            return Promise.resolve({ data: [room], error: null });
        }
    };
    const context = vm.createContext({
        WJ, sb, currentUser: { id: 'me' },
        previewStudentForm: () => false, isGuestUser: () => false,
        escapeHtml: (s) => String(s == null ? '' : s),
        performance: { now: () => now }, Date,
        crypto: { randomUUID: () => `session-${++timer}` },
        document: { getElementById() { return null; } },
        cancelAnimationFrame(id) { context.cancelled = (context.cancelled || []).concat(id); },
        setInterval(fn, ms) { intervals.set(++timer, { fn, ms }); return timer; },
        clearInterval(id) { intervals.delete(id); },
        console
    });
    const start = wordJump.indexOf('        const WJC = {');
    const end = wordJump.indexOf('        /* ---------------- live birds', start);
    vm.runInContext(wordJump.slice(start, end) + '\nthis.WJC = WJC;', context);
    const { WJC } = context;
    box.WJC = WJC;
    WJC.room = extra.room || { id: 'room', status: 'playing', started_at: 'match1' };
    WJC.players = extra.players || [{ user_id: 'me' }, { user_id: 'a' }, { user_id: 'b' }];
    WJC.transportKey = 'room:match1';
    WJC.epoch = 1;
    return { WJC, WJ, context, sb, channels, intervals, writes, removed, rpcs, overlays, time(t) { now = t; } };
}

// Mirrors join_wj_challenge / try_finish in supabase/wj_challenge_end_cap.sql
function joinChallenge({ members, joinerId }) {
    if (members.some(p => p.user_id === joinerId)) return 'ok';
    if (members.length >= 4) return 'ROOM_FULL';
    return 'ok';
}

function tryFinish({ players, now = Date.now(), staleMs = 10000, duel = 'last_standing' }) {
    if (players.length < 2) return { status: 'playing' };
    const outOf = (p) => !!(p.fallen || p.left_at || (now - p.last_seen) > staleMs);
    const alive = players.filter(p => !outOf(p));
    const out = players.filter(outOf);
    if (duel === 'target_score') {
        const hit = players.filter(p => p.reached_at).sort((a, b) => a.reached_at - b.reached_at);
        if (hit[0]) return { status: 'finished', winner_id: hit[0].user_id, result_reason: 'target' };
        if (alive.length === 0) {
            const top = players.slice().sort((a, b) => b.score - a.score)[0];
            return { status: 'finished', winner_id: top.user_id, result_reason: 'closest' };
        }
        return { status: 'playing' };
    }
    if (out.length >= 1 && alive.length <= 1) {
        if (alive.length === 1) return { status: 'finished', winner_id: alive[0].user_id, result_reason: 'last_standing' };
        const top = players.slice().sort((a, b) => b.score - a.score)[0];
        return { status: 'finished', winner_id: top.user_id, result_reason: 'highest' };
    }
    return { status: 'playing' };
}

test('all production scripts parse', () => {
    for (const [, code] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(code);
    for (const name of APP_SCRIPTS) new vm.Script(fs.readFileSync(path.join(__dirname, '../js', name + '.js'), 'utf8'));
});

test('3 players, 2 fallen: remaining client freezes mid-jump and shows the end screen', () => {
    const e = setup();
    const { WJC, WJ } = e;
    WJC.players = [
        { user_id: 'me', score: 1200, height: 400, fallen: false },
        { user_id: 'a', score: 200, height: 80, fallen: true },
        { user_id: 'b', score: 100, height: 40, fallen: true }
    ];
    assert.equal(WJ.state, 'playing');
    assert.equal(WJ.running, true);
    WJC.onFinishedEvent({
        id: 'room', status: 'finished', started_at: 'match1',
        winner_id: 'me', result_reason: 'last_standing', finished_at: 't1'
    });
    assert.equal(WJC.room.status, 'finished');
    assert.equal(WJ.running, false);
    assert.equal(WJ.state, 'over');
    assert.equal(WJ.paused, true);
    assert.equal(WJ.player.vx, 0);
    assert.equal(WJ.raf, 0);
    assert.deepEqual(e.context.cancelled, [7]);
    assert.equal(WJC.overlayMode, 'results');
    assert.ok(e.overlays.length >= 1, 'end/results overlay is shown to the winner');
    assert.match(e.overlays.at(-1), /You win!/);
    const finished = e.channels[0] && e.channels[0].messages.find(m => m.event === 'finished');
    // broadcast only fires when the pose channel is already live
});

test('winner still mid-jump is frozen when a Broadcast finished event arrives on the pose channel', () => {
    const e = setup();
    const { WJC, WJ } = e;
    WJC.transportKey = '';
    WJC.startTransport();
    const ch = e.channels[0];
    ch.status('SUBSCRIBED');
    WJC.broadcastReady = true;
    WJ.state = 'playing';
    WJ.running = true;
    WJ.player.vy = -882;
    const handler = ch.handlers['broadcast:finished'];
    assert.equal(typeof handler, 'function');
    handler({ payload: { id: 'room', status: 'finished', started_at: 'match1', winner_id: 'me', result_reason: 'last_standing' } });
    assert.equal(WJ.running, false);
    assert.equal(WJC.overlayMode, 'results');
    assert.match(e.overlays.at(-1), /You win!/);
});

test('5th distinct join is rejected; an existing member may rejoin at 4/4', () => {
    const four = [1, 2, 3, 4].map(i => ({ user_id: 'p' + i }));
    assert.equal(joinChallenge({ members: four, joinerId: 'p5' }), 'ROOM_FULL');
    assert.equal(joinChallenge({ members: four, joinerId: 'p1' }), 'ok');
    assert.equal(joinChallenge({ members: four.slice(0, 3), joinerId: 'p5' }), 'ok');
    // Mid-game: a leaver still occupies a distinct seat, so a new 5th is rejected.
    const withLeaver = four.map((p, i) => i === 3 ? { ...p, left_at: 't' } : p);
    assert.equal(joinChallenge({ members: withLeaver, joinerId: 'p5' }), 'ROOM_FULL');
    assert.equal(joinChallenge({ members: withLeaver, joinerId: 'p4' }), 'ok');

    const e = setup();
    const { WJC } = e;
    assert.equal(WJC.MAX_PLAYERS, 4);
    assert.equal(WJC.canJoinAs('p5', four), false);
    assert.equal(WJC.canJoinAs('p1', four), true);
    assert.equal(WJC.canJoinAs('p5', withLeaver), false);
    assert.equal(WJC.canJoinAs('p4', withLeaver), true);
    assert.equal(WJC.errorMessage({ message: 'ROOM_FULL' }), 'Room is full (4/4).');
});

test('SQL finish rules: last one standing, all-out, and a silent disconnect', () => {
    const now = 100_000;
    const last = tryFinish({
        now,
        players: [
            { user_id: 'me', fallen: false, left_at: null, last_seen: now, score: 9 },
            { user_id: 'a', fallen: true, left_at: null, last_seen: now, score: 2 },
            { user_id: 'b', fallen: true, left_at: null, last_seen: now, score: 1 }
        ]
    });
    assert.deepEqual(last, { status: 'finished', winner_id: 'me', result_reason: 'last_standing' });

    const stillTwo = tryFinish({
        now,
        players: [
            { user_id: 'me', fallen: false, left_at: null, last_seen: now, score: 9 },
            { user_id: 'a', fallen: true, left_at: null, last_seen: now, score: 2 },
            { user_id: 'b', fallen: false, left_at: null, last_seen: now, score: 1 }
        ]
    });
    assert.equal(stillTwo.status, 'playing');

    const left = tryFinish({
        now,
        players: [
            { user_id: 'me', fallen: false, left_at: null, last_seen: now, score: 9 },
            { user_id: 'a', fallen: false, left_at: 't', last_seen: now, score: 2 }
        ]
    });
    assert.deepEqual(left, { status: 'finished', winner_id: 'me', result_reason: 'last_standing' });

    const silent = tryFinish({
        now,
        players: [
            { user_id: 'me', fallen: false, left_at: null, last_seen: now, score: 9 },
            { user_id: 'a', fallen: false, left_at: null, last_seen: now - 11_000, score: 2 }
        ]
    });
    assert.deepEqual(silent, { status: 'finished', winner_id: 'me', result_reason: 'last_standing' });
});

test('a fallen heartbeat is queued if one is already in flight, then finishes the room', async () => {
    let resolveHb;
    const e = setup();
    const { WJC, sb } = e;
    sb.rpc = (name, args) => {
        e.rpcs.push({ name, args });
        if (e.rpcs.length === 1) {
            return new Promise(resolve => {
                resolveHb = () => resolve({
                    data: [{ id: 'room', status: 'playing', started_at: 'match1' }],
                    error: null
                });
            });
        }
        return Promise.resolve({
            data: [{ id: 'room', status: 'finished', started_at: 'match1', winner_id: 'me', result_reason: 'last_standing' }],
            error: null
        });
    };
    const first = WJC.pushNow(false);
    assert.equal(WJC.pushing, true);
    const queued = WJC.pushNow(true);
    assert.equal(WJC.queuedHeartbeat.fallen, true);
    assert.equal(e.rpcs.length, 1, 'second call must not start a concurrent RPC');
    resolveHb();
    await first;
    await queued;
    assert.equal(e.rpcs.length, 2);
    assert.equal(e.rpcs[1].args.p_fallen, true);
    assert.equal(WJC.room.status, 'finished');
    assert.equal(WJC.overlayMode, 'results');
    assert.equal(e.WJ.running, false);
});

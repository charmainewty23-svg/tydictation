// No network, credentials, dependencies or database writes. Exercise the actual inline code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function setup() {
    let now = 0, timer = 0;
    const intervals = new Map(), channels = [], writes = [], removed = [];
    const WJ = { W: 400, H: 600, GRAVITY: 1217, BOOST_G: 668, challenge: true,
        state: 'playing', paused: false, player: { x: 200, y: 0, vx: 80, vy: -882, face: 1 } };
    const sb = {
        channel(topic, options) {
            const ch = { topic, options, messages: [],
                on(type, filter, cb) { this.receive = cb; return this; },
                subscribe(cb) { this.status = cb; return this; },
                send(msg) { this.messages.push(msg); return Promise.resolve('ok'); } };
            channels.push(ch); return ch;
        },
        removeChannel(ch) { removed.push(ch); return Promise.resolve('ok'); },
        from() { return { update(patch) { writes.push(patch); return this; }, eq() { return this; },
            then(resolve) { return Promise.resolve({ error: null }).then(resolve); } }; }
    };
    const context = vm.createContext({ WJ, sb, currentUser: { id: 'me' },
        previewStudentForm: () => false, isGuestUser: () => false,
        performance: { now: () => now }, crypto: { randomUUID: () => `session-${++timer}` },
        setInterval(fn, ms) { intervals.set(++timer, { fn, ms }); return timer; },
        clearInterval(id) { intervals.delete(id); }, console });
    const start = html.indexOf('        const WJC = {');
    const end = html.indexOf('        /* ---------------- live birds', start);
    vm.runInContext(html.slice(start, end) + '\nthis.WJC = WJC;', context);
    const { WJC } = context;
    WJC.room = { id: 'room', status: 'playing', started_at: 'match1' };
    WJC.players = [{ user_id: 'me' }, { user_id: 'rival' }];
    WJC.transportKey = 'room:match1';
    function pose(t, seq, extra = {}) {
        return { match: WJC.transportKey, user: 'rival', session: 'remote-session',
            t, seq, x: 200, y: 0, vx: 80, vy: -882, gravity: 1217, face: 1, ...extra };
    }
    return { WJC, WJ, context, pose, channels, intervals, writes, removed, time(t) { now = t; } };
}

test('all production inline scripts parse', () => {
    for (const [, code] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(code);
});

test('broadcast lifecycle, pause/boost/powerups, jump impulse and zero SQL dependency', async () => {
    const e = setup(), { WJC, WJ } = e;
    WJC.transportKey = '';
    WJC.startTransport();
    const ch = e.channels[0];
    assert.equal(ch.topic, 'wjc:room');
    assert.equal(ch.options.config.broadcast.self, false);
    ch.status('SUBSCRIBED');
    assert.equal(ch.messages.length, 1);
    WJC.startTransport();
    assert.equal(e.channels.length, 1);
    WJC.pushPose(true);
    assert.equal(ch.messages.at(-1).payload.jump, true);
    assert.equal(ch.messages.at(-1).payload.vy, -882);
    WJ.player.boostHang = true; WJC.pushPose();
    assert.equal(ch.messages.at(-1).payload.gravity, 668);
    WJ.player.jet = 1; WJC.pushPose();
    assert.equal(ch.messages.at(-1).payload.gravity, 0);
    WJ.paused = true; WJC.pushPose();
    assert.equal(ch.messages.at(-1).payload.vy, 0);
    assert.equal(ch.messages.at(-1).payload.vx, 0);
    assert.equal(e.writes.length, 0, 'healthy broadcast makes NO independent DB pose writes');
    ch.status('CHANNEL_ERROR'); WJC.pushPose();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(e.writes.length, 1, 'unavailable websocket uses DB fallback');
    WJC.stopTransport();
    assert.equal(e.intervals.size, 0);
    assert.deepEqual(e.removed, [ch]);
    ch.status('SUBSCRIBED');
    assert.equal(WJC.broadcastReady, false, 'late subscribe callback cannot revive removed channel');
    WJC.room.started_at = 'match2'; WJC.startTransport();
    assert.equal(WJC.transportKey, 'room:match2');
    assert.equal(e.channels.length, 2);
});

test('member/match validation; old sequences, old sessions and invalid payloads are rejected', () => {
    const e = setup(), { WJC } = e;
    e.time(1000); WJC.receivePose(e.pose(100, 2));
    const g = WJC.ghosts.rival;
    WJC.receivePose(e.pose(90, 1));
    WJC.receivePose(e.pose(110, 3, { user: 'outsider' }));
    WJC.receivePose(e.pose(110, 3, { match: 'old-match' }));
    WJC.receivePose(e.pose(110, 3, { y: NaN }));
    assert.equal(g.snaps.length, 1);
    e.time(1100); WJC.receivePose(e.pose(1, 1, { session: 'rejoined' }));
    assert.equal(g.session, 'rejoined');
    WJC.receivePose(e.pose(120, 4));
    assert.equal(g.snaps.length, 1);
    assert.equal(g.session, 'rejoined');
});

test('DB polling never overwrites live poses; missing velocity columns and duplicate reads work', () => {
    const e = setup(), { WJC } = e;
    e.time(1000); WJC.receivePose(e.pose(100, 1));
    WJC.adoptSnapshots([{ user_id: 'rival', x: 5, y: 99 }]);
    assert.equal(WJC.ghosts.rival.snaps[0].x, 200);
    e.time(2500); WJC.adoptSnapshots([{ user_id: 'rival', x: 5, y: 99 }]);
    e.time(3000); WJC.adoptSnapshots([{ user_id: 'rival', x: 5, y: 99 }]);
    assert.equal(WJC.ghosts.rival.snaps.length, 1, 'unchanged DB positions are not new frames');
    e.time(3300); WJC.adoptSnapshots([{ user_id: 'rival', x: 25, y: 19 }]);
    assert.ok(Number.isFinite(WJC.ghosts.rival.snaps[1].vy));
    e.time(3400); WJC.receivePose(e.pose(2500, 2));
    assert.equal(WJC.ghosts.rival.source, 'broadcast');
    assert.equal(WJC.ghosts.rival.snaps.length, 1);
});

test('different sender clock, wrap period, monotonic playback, pause and lost-link convergence', () => {
    const e = setup(), { WJC } = e;
    assert.equal(WJC.wrapDx(-432), 2);
    assert.equal(WJC.wrapX(418), -16);
    e.time(1000); WJC.receivePose(e.pose(900000, 1, { x: 416, y: -300, vx: 100, vy: 0, gravity: 0 }));
    e.time(1080); WJC.receivePose(e.pose(900080, 2, { x: -10, y: -300, vx: 100, vy: 0, gravity: 0 }));
    const g = WJC.ghosts.rival;
    assert.equal(g.offset, -899000);
    let prev, maxDx = 0, lastT = -Infinity;
    for (let now = 1000; now < 4000; now += 1000 / 60) {
        const point = WJC.sampleGhost(g, now);
        if (prev) maxDx = Math.max(maxDx, Math.abs(WJC.wrapDx(point.x - prev.x)));
        assert.ok(g.renderAt >= lastT); lastT = g.renderAt; prev = point;
        assert.equal(point.y, -300);
    }
    assert.ok(maxDx < 4, `no 34px edge-wrap glitch: max dx ${maxDx}`);
    assert.ok(Math.abs(WJC.wrapDx(prev.x - WJC.predictPose(g.snaps.at(-1), 10).x)) < 0.1);
});

test('guests, teacher preview and Solo cannot send live poses', () => {
    const e = setup(), { WJC } = e;
    WJC.transportKey = '';
    e.context.previewStudentForm = () => true;
    WJC.startTransport(); WJC.pushPose(true);
    assert.equal(e.channels.length, 0); assert.equal(e.writes.length, 0);
    e.context.previewStudentForm = () => false;
    e.context.isGuestUser = () => true;
    WJC.startTransport(); WJC.pushPose(true);
    assert.equal(e.channels.length, 0); assert.equal(e.writes.length, 0);
    e.context.isGuestUser = () => false;
    e.WJ.challenge = false;
    WJC.pushPose(true);
    assert.equal(e.writes.length, 0);
});

test('poll reads are serialized and discarded after leaving a room', async () => {
    const e = setup(), { WJC } = e;
    const pending = []; let reads = 0, reacted = false;
    e.context.sb.from = () => {
        reads++;
        return { select() { return this; }, eq() { return this; }, maybeSingle() { return this; },
            then(resolve) { return new Promise(done => pending.push(value => { resolve(value); done(); })); } };
    };
    WJC.reactToState = () => { reacted = true; };
    const first = WJC.poll();
    await WJC.poll();
    assert.equal(reads, 2, 'no overlapping room/player query pairs');
    WJC.syncTopicLock = () => {}; WJC.clearResume = () => {};
    WJC.resetLocal();
    for (const done of pending) done({ data: { id: 'room', status: 'playing' } });
    await first;
    assert.equal(WJC.room, null);
    assert.equal(reacted, false, 'late poll cannot reopen an abandoned game');
});

// Deterministic 30s motion stream with sender-clock skew, boosted bounces, moving
// world camera, delayed/reordered/duplicate messages, 8% packet loss and 900ms outage.
// Check accuracy as well as continuity so a frozen bird cannot pass the test.
test('30s jitter/loss simulation at 60fps: continuous, accurate moving birds', t => {
    const e = setup(), { WJC } = e;
    let seed = 9817;
    const rand = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
    const events = [], truth = [];
    let x = 200, y = 0, vx = 100, vy = -882, gravity = 1217, floor = 0, seq = 0;
    const step = 1000 / 120, clockSkew = 67234;
    for (let time = 0; time < 30000; time += step) {
        let jump = false;
        vy += gravity / 120; y += vy / 120; x = WJC.wrapX(x + vx / 120);
        if (y >= floor && vy > 0) {
            y = floor; floor -= 70; gravity = rand() < 0.3 ? 668 : 1217;
            vy = gravity === 668 ? -788 : -882; jump = true;
        }
        truth.push({ time, x, y });
        if (Math.round(time / step) % 10 === 0 || jump) {
            const packet = e.pose(time + clockSkew, ++seq, { x, y, vx, vy, gravity, jump });
            const loss = rand() < 0.08 || (time > 15000 && time < 15900);
            if (!loss) {
                const arrival = time + 45 + rand() * 115 + (rand() < 0.12 ? 180 : 0);
                events.push({ arrival, packet });
                if (rand() < 0.1) events.push({ arrival: arrival + 100, packet });
            }
        }
    }
    events.sort((a, b) => a.arrival - b.arrival);
    let next = 0, previous, maxDelta = 0, errorSum = 0, count = 0, travel = 0;
    for (let time = 0; time < 30000; time += 1000 / 60) {
        e.time(time);
        while (next < events.length && events[next].arrival <= time) WJC.receivePose(events[next++].packet);
        const g = WJC.ghosts.rival;
        if (!g) continue;
        const point = WJC.sampleGhost(g, time);
        if (previous) {
            const dy = Math.abs(point.y - previous.y);
            maxDelta = Math.max(maxDelta, dy); travel += dy;
            assert.ok(Math.abs(WJC.wrapDx(point.x - previous.x)) < 34);
        }
        const senderTime = g.renderAt - clockSkew;
        if (time > 1000 && !(time > 15000 && time < 17000)) {
            const ref = truth[Math.max(0, Math.min(truth.length - 1, Math.round(senderTime / step)))];
            errorSum += Math.abs(ref.y - point.y); count++;
        }
        // Camera conversion only happens when drawing; it never corrupts world buffers.
        assert.ok(Number.isFinite(point.y - (-Math.floor(time / 400) * 10)));
        previous = point;
    }
    const meanError = errorSum / count;
    assert.ok(maxDelta <= 33.334, `max frame delta ${maxDelta}`);
    assert.ok(meanError < 65, `mean error ${meanError}`);
    assert.ok(travel > 6000, 'bird moves through real bounces instead of freezing');
    t.diagnostic(JSON.stringify({ maxFrameDeltaPx: +maxDelta.toFixed(2),
        meanVerticalErrorPx: +meanError.toFixed(2), travelPx: Math.round(travel), packets: events.length }));
});

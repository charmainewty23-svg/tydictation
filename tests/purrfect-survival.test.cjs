/* Unit tests for the Purr-fect Survival pure engine.
 * Run: node --test tests/purrfect-survival.test.cjs
 * No browser, no network, no Supabase.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE_PATH = path.join(__dirname, '..', 'js', 'purrfect-survival-engine.js');
const RENDER_PATH = path.join(__dirname, '..', 'js', 'purrfect-survival-render.js');
const MAIN_PATH = path.join(__dirname, '..', 'js', 'purrfect-survival.js');
const INDEX_PATH = path.join(__dirname, '..', 'index.html');

function loadEngine() {
    const code = fs.readFileSync(ENGINE_PATH, 'utf8');
    const sandbox = { window: {}, console, Date, Math, JSON, Set, Map, Number, String, Array, Object, isFinite };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'purrfect-survival-engine.js' });
    assert.ok(sandbox.window.PSEngine, 'engine attaches window.PSEngine');
    return sandbox.window.PSEngine;
}

const PS = loadEngine();

/* A deliberately complete 2D context stub: the renderer must only touch the
   standard Canvas2D API (no browser, no bitmap assets). */
function mockContext(canvas) {
    const gradient = { addColorStop() {} };
    const ctx = {
        canvas: canvas,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        font: '10px sans-serif',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        shadowColor: 'transparent',
        shadowBlur: 0,
        save() {}, restore() {},
        beginPath() {}, closePath() {},
        moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {},
        arc() {}, arcTo() {}, ellipse() {}, rect() {}, roundRect() {},
        fill() {}, stroke() {}, clip() {},
        fillRect() {}, strokeRect() {}, clearRect() {},
        translate() {}, scale() {}, rotate() {}, transform() {}, setTransform() {}, resetTransform() {},
        setLineDash() {}, getLineDash() { return []; },
        createLinearGradient() { return gradient; },
        createRadialGradient() { return gradient; },
        createPattern() { return null; },
        fillText() {}, strokeText() {},
        measureText(text) { return { width: String(text == null ? '' : text).length * 6 }; },
        drawImage() {}, putImageData() {}, getImageData() { return { data: new Uint8ClampedArray(4) }; }
    };
    return ctx;
}

function loadRenderer() {
    const code = fs.readFileSync(RENDER_PATH, 'utf8');
    const sandbox = { console, Date, Math, JSON, Number, String, Array, Object, isFinite, parseInt, parseFloat };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'purrfect-survival-render.js' });
    assert.ok(sandbox.PSRender, 'renderer attaches window.PSRender');
    return sandbox.PSRender;
}

function loadMain() {
    const code = fs.readFileSync(MAIN_PATH, 'utf8');
    const store = {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    };
    const sandbox = { console, Date, Math, JSON, Number, String, Array, Object, isFinite, parseInt, parseFloat };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.localStorage = store;
    sandbox.sessionStorage = store;
    sandbox.document = {
        getElementById() { return null; },
        querySelector() { return null; },
        addEventListener() {},
        createElement() { return { getContext() { return null; } }; },
        body: { classList: { toggle() {}, add() {}, remove() {} } }
    };
    sandbox.addEventListener = function () {};
    sandbox.removeEventListener = function () {};
    sandbox.requestAnimationFrame = function () { return 0; };
    sandbox.cancelAnimationFrame = function () {};
    sandbox.setInterval = function () { return 0; };
    sandbox.clearInterval = function () {};
    sandbox.setTimeout = function () { return 0; };
    sandbox.clearTimeout = function () {};
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'purrfect-survival.js' });
    assert.ok(sandbox.PS, 'main module attaches window.PS');
    return sandbox.PS;
}

/* A small but real DOM surface for the lobby code. Element.innerHTML parses
   <option> tags the way a browser select would, so populateVocabSources() and
   syncSubjectFields() can be exercised without a browser. */
function loadMainWithDom(options) {
    const opts = options || {};
    const code = fs.readFileSync(MAIN_PATH, 'utf8');
    const store = {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    };
    const elements = Object.create(null);

    function decodeEntities(text) {
        return String(text == null ? '' : text)
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }

    function makeClassList() {
        const set = new Set();
        return {
            add(name) { set.add(name); },
            remove(name) { set.delete(name); },
            contains(name) { return set.has(name); },
            toggle(name, on) {
                const next = on === undefined ? !set.has(name) : !!on;
                if (next) set.add(name); else set.delete(name);
                return next;
            },
            has(name) { return set.has(name); }
        };
    }

    function makeEl(id, tag, value) {
        const el = {
            id: id,
            tagName: String(tag || 'div').toUpperCase(),
            style: {},
            disabled: false,
            checked: false,
            textContent: '',
            _options: [],
            _html: '',
            _value: value === undefined ? '' : String(value),
            setAttribute(name, val) { el[name] = val; },
            getAttribute(name) { return el[name]; },
            appendChild() {},
            focus() {},
            getContext() { return null; }
        };
        el.classList = makeClassList();
        Object.defineProperty(el, 'className', {
            get() { return ''; },
            set(val) {
                String(val || '').split(/\s+/).filter(Boolean).forEach(name => el.classList.add(name));
            }
        });
        Object.defineProperty(el, 'options', {
            get() { return el._options; },
            set(list) { el._options = Array.from(list || []); }
        });
        Object.defineProperty(el, 'innerHTML', {
            get() { return el._html; },
            set(html) {
                el._html = String(html == null ? '' : html);
                const parsed = [];
                const re = /<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
                let m;
                while ((m = re.exec(el._html))) {
                    parsed.push({
                        value: decodeEntities(m[1]),
                        text: decodeEntities(String(m[2]).replace(/<[^>]*>/g, '')).trim()
                    });
                }
                el._options = parsed;
                el._value = parsed.length ? parsed[0].value : '';
            }
        });
        Object.defineProperty(el, 'value', {
            get() { return el._value; },
            set(val) { el._value = String(val == null ? '' : val); }
        });
        elements[id] = el;
        return el;
    }

    function add(id, tag, value) {
        return makeEl(id, tag, value);
    }

    add('ps-lobby', 'div');
    add('ps-game', 'div');
    add('ps-cine', 'div');
    add('ps-stage', 'div');
    add('ps-question', 'div');
    add('ps-round-overlay', 'div');
    add('ps-room-actions', 'div');
    add('ps-host-note', 'div');
    add('ps-guest-notice', 'div').classList.add('hidden');
    add('ps-rejoin-banner', 'div').classList.add('hidden');
    add('ps-rejoin-code', 'span');
    add('ps-teacher-row', 'label');
    add('ps-teacher-plays', 'input');
    add('ps-round-count', 'select', '2');
    add('ps-round2-card', 'section');
    add('ps-round3-card', 'section').classList.add('hidden');
    add('ps-sound-btn', 'button');
    add('ps-code', 'span');
    add('ps-code-chip', 'div');
    add('ps-room-meta', 'div');
    add('ps-player-list', 'div');
    add('ps-start-btn', 'button');
    add('ps-wait-msg', 'p');
    add('ps-host-end', 'button');
    add('ps-canvas', 'canvas');
    add('purrfect-survival-view', 'div');
    add('login-view', 'div');
    add('app', 'div');
    add('bottom-nav', 'nav');
    add('home-music-btn', 'button');
    add('me-store-music-btn', 'button');

    for (let r = 1; r <= 3; r++) {
        add('ps-r' + r + '-subject', 'select', 'vocab');
        add('ps-r' + r + '-vocab-wrap', 'div');
        add('ps-r' + r + '-grammar-wrap', 'div').classList.add('hidden');
        add('ps-r' + r + '-vocab-source', 'select');
        add('ps-r' + r + '-vocab-form-wrap', 'div');
        add('ps-r' + r + '-vocab-form', 'select');
        add('ps-r' + r + '-grammar-topic', 'select', 'tenses');
        add('ps-r' + r + '-grammar-mode', 'select');
    }

    const sandbox = { console, Date, Math, JSON, Number, String, Array, Object, isFinite, parseInt, parseFloat };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.PSEngine = loadEngine();
    sandbox.updateMascot = function () {};
    sandbox.SHEET_NAMES = opts.sheetNames || ['Food', 'School'];
    if (opts.currentUser !== undefined) sandbox.currentUser = opts.currentUser;
    if (opts.isGuestUser) sandbox.isGuestUser = opts.isGuestUser;
    sandbox.localStorage = store;
    sandbox.sessionStorage = store;
    sandbox.devicePixelRatio = 1;
    sandbox.document = {
        readyState: 'complete',
        getElementById(id) { return elements[id] || null; },
        querySelector() { return null; },
        addEventListener() {},
        createElement(tag) { return makeEl('created-' + tag, tag); },
        body: makeEl('body', 'body')
    };
    sandbox.addEventListener = function () {};
    sandbox.removeEventListener = function () {};
    sandbox.requestAnimationFrame = function () { return 0; };
    sandbox.cancelAnimationFrame = function () {};
    sandbox.setInterval = function () { return 0; };
    sandbox.clearInterval = function () {};
    sandbox.setTimeout = function () { return 0; };
    sandbox.clearTimeout = function () {};
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'purrfect-survival.js' });
    assert.ok(sandbox.PS, 'main module attaches window.PS');
    return {
        PS: sandbox.PS,
        sandbox: sandbox,
        el(id) { return elements[id] || null; },
        optionValues(id) {
            const el = elements[id];
            return el ? Array.from(el.options).map(o => o.value) : [];
        }
    };
}

function player(id, distance, extra) {
    return Object.assign({
        user_id: id,
        status: 'alive',
        distance: distance || 0,
        red_offences: 0,
        ghost: false
    }, extra || {});
}

/* ---------------------------------------------------------------- */
/* Round 1 scoring                                                   */
/* ---------------------------------------------------------------- */

test('a correct green answer sprints exactly +10 m and never overshoots the finish', () => {
    const p = player('a', 0);
    PS.applyGreenCorrect(p);
    assert.equal(p.distance, 10);
    PS.applyGreenCorrect(p);
    assert.equal(p.distance, 20);

    const near = player('b', 95);
    PS.applyGreenCorrect(near);
    assert.equal(near.distance, 100);
    assert.equal(near.reached_finish, true);
});

test('red-light penalties are 30 m, then 15 m, then elimination; distance never goes below 0', () => {
    const p = player('a', 5);
    PS.applyRedPenalty(p);
    assert.equal(p.red_offences, 1);
    assert.equal(p.distance, 0, 'first penalty clamps at 0');
    assert.equal(p.status, 'alive');

    p.distance = 40;
    PS.applyRedPenalty(p);
    assert.equal(p.red_offences, 2);
    assert.equal(p.distance, 25);
    assert.equal(p.status, 'alive');

    PS.applyRedPenalty(p);
    assert.equal(p.red_offences, 3);
    assert.equal(p.status, 'eliminated');
    assert.equal(p.ghost, true);
    assert.equal(p.eliminated_reason, 'red_light');
});

test('a wrong green answer changes neither distance nor offences', () => {
    const p = player('a', 40);
    PS.applyGreenWrong(p);
    assert.equal(p.distance, 40);
    assert.equal(p.red_offences, 0);
    assert.equal(p.status, 'alive');
});

test('yellow presses are answers, not penalties', () => {
    const p = player('a', 40);
    const result = PS.handleRound1Press(p, 'yellow');
    assert.equal(result.action, 'answer');
    assert.equal(result.penalty, 0);
    assert.equal(p.distance, 40);
    assert.equal(p.red_offences, 0);

    const red = PS.handleRound1Press(p, 'red');
    assert.equal(red.action, 'penalty');
    assert.equal(red.penalty, -30);
    assert.equal(p.distance, 10);
});

test('eliminated players cannot be penalised or scored again', () => {
    const p = player('a', 80, { status: 'eliminated', ghost: true });
    PS.applyRedPenalty(p);
    PS.applyGreenCorrect(p);
    assert.equal(p.distance, 80);
    assert.equal(p.red_offences, 0);
});

/* ---------------------------------------------------------------- */
/* Light schedule                                                    */
/* ---------------------------------------------------------------- */

test('phase schedule is deterministic and always green -> yellow 2 s -> red 3 s', () => {
    const a = PS.buildPhaseSchedule(12345);
    const b = PS.buildPhaseSchedule(12345);
    assert.deepEqual(a, b, 'same seed gives the same schedule');

    assert.equal(a[0].phase, 'green');
    assert.ok(a[0].duration_ms >= PS.ROUND1.GREEN_MIN_MS);
    assert.ok(a[0].duration_ms <= PS.ROUND1.GREEN_MAX_MS);
    assert.equal(a[1].phase, 'yellow');
    assert.equal(a[1].duration_ms, 2000);
    assert.equal(a[2].phase, 'red');
    assert.equal(a[2].duration_ms, 3000);

    const total = a.reduce((sum, item) => sum + item.duration_ms, 0);
    assert.ok(total >= PS.ROUND1.DEFAULT_ROUND_MS, 'schedule covers the 3 minute round');
});

test('phaseAt walks the schedule with exact boundaries', () => {
    const schedule = [
        { phase: 'green', duration_ms: 5000 },
        { phase: 'yellow', duration_ms: 2000 },
        { phase: 'red', duration_ms: 3000 },
        { phase: 'green', duration_ms: 6000 },
        { phase: 'yellow', duration_ms: 2000 },
        { phase: 'red', duration_ms: 3000 }
    ];

    assert.equal(PS.phaseAt(schedule, 0).phase, 'green');
    assert.equal(PS.phaseAt(schedule, 4999).phase, 'green');
    assert.equal(PS.phaseAt(schedule, 5000).phase, 'yellow');
    assert.equal(PS.phaseAt(schedule, 6999).phase, 'yellow');
    assert.equal(PS.phaseAt(schedule, 7000).phase, 'red');
    assert.equal(PS.phaseAt(schedule, 9999).phase, 'red');
    assert.equal(PS.phaseAt(schedule, 10000).phase, 'green');
    assert.equal(PS.phaseAt(schedule, 10000).index, 3);
    assert.equal(PS.phaseAt(schedule, 99999).done, true);
});

test('answer phases are green and yellow only', () => {
    assert.equal(PS.isAnswerPhase('green'), true);
    assert.equal(PS.isAnswerPhase('yellow'), true);
    assert.equal(PS.isAnswerPhase('red'), false);
    assert.equal(PS.isAnswerPhase('done'), false);
    assert.equal(PS.isRedPhase('red'), true);
});

/* ---------------------------------------------------------------- */
/* Advancement                                                       */
/* ---------------------------------------------------------------- */

function advance(players, extra) {
    return PS.advanceRound1(players, Object.assign({ limit: 15 }, extra || {}));
}

test('the first 15 players to reach the finish advance, by finish time', () => {
    const players = [];
    for (let i = 0; i < 20; i++) {
        players.push(player('u' + String(i).padStart(2, '0'), 100, {
            reached_finish: true,
            finished_at: 1000 + i * 100
        }));
    }
    // Shuffle the input order to prove finishing order wins.
    players.reverse();
    const advanced = advance(players);
    assert.equal(advanced.length, 15);
    assert.deepEqual(advanced.map(p => p.user_id), [
        'u00', 'u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07',
        'u08', 'u09', 'u10', 'u11', 'u12', 'u13', 'u14'
    ]);
    assert.equal(advanced[0].round1_rank, 1);
    assert.equal(advanced[14].round1_rank, 15);
    assert.equal(players.find(p => p.user_id === 'u15').status, 'eliminated');
});

test('when fewer than 15 reach the finish, the furthest living players fill the bridge', () => {
    const players = [];
    for (let i = 0; i < 10; i++) {
        players.push(player('f' + i, 100, { reached_finish: true, finished_at: 1000 + i }));
    }
    players.push(player('slow', 62));
    players.push(player('mid', 71));
    players.push(player('tail', 4));
    players.push(player('tail2', 3));
    players.push(player('tail3', 2));
    players.push(player('tail4', 1));
    players.push(player('gone', 99, { status: 'eliminated', ghost: true }));

    const advanced = advance(players);
    assert.equal(advanced.length, 15, 'all 10 finishers + the 5 furthest living');
    assert.ok(advanced.some(p => p.user_id === 'mid'));
    assert.ok(advanced.some(p => p.user_id === 'slow'));
    assert.equal(advanced.some(p => p.user_id === 'tail4'), false, 'the 16th living player is cut');
    assert.equal(advanced.some(p => p.user_id === 'gone'), false, 'eliminated players never advance');
});

test('time-up takes the 15 furthest living players and excludes ghosts', () => {
    const players = [];
    for (let i = 0; i < 18; i++) {
        players.push(player('u' + String(i).padStart(2, '0'), 90 - i));
    }
    players.push(player('ghost1', 100, { status: 'eliminated', ghost: true }));
    players.push(player('ghost2', 99, { status: 'eliminated', ghost: true }));

    const advanced = advance(players, { timeUp: true });
    assert.equal(advanced.length, 15);
    assert.equal(advanced[0].user_id, 'u00');
    assert.equal(advanced[14].user_id, 'u14');
    assert.equal(advanced.some(p => p.user_id === 'ghost1'), false);
    assert.equal(advanced.some(p => p.user_id === 'u15'), false);
});

test('last-slot ties break by finish time, then distance, then stable user_id', () => {
    const players = [];
    // Two finishers at the same distance, different finish times.
    players.push(player('late', 100, { reached_finish: true, finished_at: 5000 }));
    players.push(player('early', 100, { reached_finish: true, finished_at: 4000 }));
    // Non-finishers with the same distance: stable user_id decides.
    players.push(player('zebra', 70));
    players.push(player('alpha', 70));

    const ordered = PS.round1Order(players);
    assert.deepEqual(ordered.map(p => p.user_id), ['early', 'late', 'alpha', 'zebra']);

    const advanced = PS.advanceRound1(players, { limit: 3 });
    assert.deepEqual(advanced.map(p => p.user_id), ['early', 'late', 'alpha']);
    assert.equal(players.find(p => p.user_id === 'zebra').status, 'eliminated');
});

test('round1Order puts finishers first even if a non-finisher is closer on paper', () => {
    const players = [
        player('runner', 100, { reached_finish: true, finished_at: 8000 }),
        player('stuck', 99)
    ];
    assert.deepEqual(PS.round1Order(players).map(p => p.user_id), ['runner', 'stuck']);
});

/* ---------------------------------------------------------------- */
/* Glass bridge                                                      */
/* ---------------------------------------------------------------- */

function glassStep(correctSide) {
    return {
        index: 0,
        prompt: 'Neither of them ___ ready.',
        left: 'is',
        right: 'are',
        correct_side: correctSide || 'left',
        revealed: false,
        revealed_side: null,
        shattered_side: null
    };
}

test('a correct jump advances one step and lights the correct pane', () => {
    const step = glassStep('left');
    const p = player('a', 100, { glass_step: 0, round1_rank: 1 });
    const result = PS.applyGlassJump(p, step, 'left', { stepCount: 9 });
    assert.equal(result.outcome, 'correct');
    assert.equal(p.glass_step, 1);
    assert.equal(p.status, 'alive');
    assert.equal(step.revealed, true);
    assert.equal(step.revealed_side, 'left');
});

test('a wrong jump eliminates the player but reveals the correct pane for the class', () => {
    const step = glassStep('left');
    const p = player('a', 100, { glass_step: 0, round1_rank: 1 });
    const result = PS.applyGlassJump(p, step, 'right', { stepCount: 9 });
    assert.equal(result.outcome, 'wrong');
    assert.equal(p.status, 'eliminated');
    assert.equal(p.ghost, true);
    assert.equal(p.eliminated_reason, 'glass');
    assert.equal(step.revealed, true);
    assert.equal(step.revealed_side, 'left', 'correct pane stays lit');
    assert.equal(step.shattered_side, 'right');
});

test('a 5 s timeout eliminates the player and does NOT reveal the pane', () => {
    const step = glassStep('right');
    const p = player('a', 100, { glass_step: 0, round1_rank: 1 });
    const result = PS.applyGlassJump(p, step, '', { stepCount: 9, timedOut: true });
    assert.equal(result.outcome, 'timeout');
    assert.equal(p.status, 'eliminated');
    assert.equal(p.eliminated_reason, 'glass_timeout');
    assert.equal(step.revealed, false);
    assert.equal(step.revealed_side, null);

    assert.equal(PS.glassWindowExpired(1000, 5999, 5000), false);
    assert.equal(PS.glassWindowExpired(1000, 6000, 5000), true);
});

test('crossing all 9 steps advances the player to the mid-victory state', () => {
    const p = player('a', 100, { glass_step: 8, round1_rank: 1 });
    const step = glassStep('right');
    const result = PS.applyGlassJump(p, step, 'right', { stepCount: 9 });
    assert.equal(result.outcome, 'correct');
    assert.equal(p.glass_step, 9);
    assert.equal(p.status, 'advanced');
    assert.equal(p.crossed_glass, true);
    assert.equal(p.survived_round2, true);
    assert.deepEqual(PS.glassSurvivors([p]).map(x => x.user_id), ['a']);
});

test('glass steps are deterministic from the seed and only one pane is correct', () => {
    const pairs = [
        { prompt: 'q1', correct: 'is', wrong: 'are' },
        { prompt: 'q2', correct: 'has', wrong: 'have' },
        { prompt: 'q3', correct: 'a', wrong: 'an' }
    ];
    const a = PS.buildGlassSteps({ pairs: pairs, seed: 77, count: 9 });
    const b = PS.buildGlassSteps({ pairs: pairs, seed: 77, count: 9 });
    assert.deepEqual(a, b);
    assert.equal(a.length, 9);
    a.forEach(step => {
        assert.ok(step.correct_side === 'left' || step.correct_side === 'right');
        const correctText = step.correct_side === 'left' ? step.left : step.right;
        const wrongText = step.correct_side === 'left' ? step.right : step.left;
        assert.ok(correctText && wrongText);
        assert.notEqual(correctText, wrongText);
        assert.equal(step.revealed, false);
    });
});

test('glass queue order follows round-1 rank, then distance, then user_id', () => {
    const players = [
        player('third', 50, { round1_rank: 3 }),
        player('first', 100, { round1_rank: 1 }),
        player('second', 80, { round1_rank: 2 }),
        player('unrankedB', 20),
        player('unrankedA', 20),
        player('out', 90, { status: 'eliminated', ghost: true })
    ];
    assert.deepEqual(PS.glassQueueIds(players), ['first', 'second', 'third', 'unrankedA', 'unrankedB']);
});

test('queue release: next player waits while someone is still on step 0, then starts once they move on', () => {
    const players = [
        player('a', 100, { round1_rank: 1, glass_step: 0, glass_active: false }),
        player('b', 90, { round1_rank: 2, glass_step: 0, glass_active: false }),
        player('c', 80, { round1_rank: 3, glass_step: 0, glass_active: false })
    ];
    const queue = ['a', 'b', 'c'];

    assert.deepEqual(PS.releaseGlassQueue(players, queue, { now: 1000 }), ['a']);
    assert.equal(players[0].glass_active, true);
    assert.equal(players[1].glass_active, false);

    // a is still standing on step 0 -> b may not start yet
    assert.deepEqual(PS.releaseGlassQueue(players, queue, { now: 2000 }), []);

    // a moved safely to step 1 -> b may start
    players[0].glass_step = 1;
    assert.deepEqual(PS.releaseGlassQueue(players, queue, { now: 3000 }), ['b']);

    // b falls at step 0 -> c starts
    players[1].status = 'eliminated';
    players[1].ghost = true;
    players[1].glass_active = false;
    assert.deepEqual(PS.releaseGlassQueue(players, queue, { now: 4000 }), ['c']);

    // everyone either advanced, fell or got their turn; none re-released
    players[2].status = 'advanced';
    assert.deepEqual(PS.releaseGlassQueue(players, queue, { now: 5000 }), []);
});

/* ---------------------------------------------------------------- */
/* Room rules                                                        */
/* ---------------------------------------------------------------- */

test('guests are blocked from create/join/play, signed-in students are not', () => {
    assert.equal(PS.isGuestBlocked({ guest: true }), true);
    assert.equal(PS.isGuestBlocked({ isGuest: true }), true);
    assert.equal(PS.isGuestBlocked({ signedIn: false }), true);
    assert.equal(PS.isGuestBlocked({ guest: false, signedIn: true }), false);

    assert.deepEqual(PS.canPlayPurrfect({ guest: true, signedIn: true }), { ok: false, error: 'GUEST_NOT_ALLOWED' });
    assert.deepEqual(PS.canPlayPurrfect({ signedIn: false }), { ok: false, error: 'NOT_SIGNED_IN' });
    assert.deepEqual(PS.canPlayPurrfect({ guest: false, signedIn: true }), { ok: true, error: '' });

    assert.equal(PS.studentCapacity(), 30);
    assert.equal(PS.playerCapacity(true), 31);
    assert.equal(PS.playerCapacity(false), 30);
});

test('one subject per room: vocab and grammar fields cannot be mixed', () => {
    assert.equal(PS.isOneSubject({ subject: 'vocab', vocabSource: 'Food' }), true);
    assert.equal(PS.isOneSubject({ subject: 'grammar', grammarTopic: 'tenses' }), true);
    assert.equal(PS.isOneSubject({ subject: 'vocab', vocabSource: 'Food', grammarTopic: 'tenses' }), false);

    const bad = PS.validateRoomSetup({ subject: 'vocab', vocabSource: 'Food', grammarTopic: 'tenses' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'ONE_SUBJECT_ONLY');

    const vocab = PS.validateRoomSetup({ subject: 'vocab', vocabSource: 'Food', form: 'f4' });
    assert.equal(vocab.ok, true);
    assert.equal(vocab.setup.subject, 'vocab');
    assert.equal(vocab.setup.vocabSource, 'Food');
    assert.equal(vocab.setup.vocabForm, 'F4');
    assert.equal(vocab.setup.topic, 'Food');

    const grammar = PS.validateRoomSetup({ subject: 'grammar', topic: 'agreement', bankMode: 'choose' });
    assert.equal(grammar.ok, true);
    assert.equal(grammar.setup.subject, 'grammar');
    assert.equal(grammar.setup.topic, 'agreement');
    assert.equal(grammar.setup.bankMode, 'choose');

    assert.equal(PS.validateRoomSetup({ subject: 'grammar', topic: 'nope' }).error, 'INVALID_TOPIC');
    assert.equal(PS.validateRoomSetup({ subject: 'nope' }).error, 'INVALID_SUBJECT');
});

/* ---------------------------------------------------------------- */
/* Question helpers                                                  */
/* ---------------------------------------------------------------- */

test('vocab MC builds a seeded 4-option question with one correct answer', () => {
    const words = [
        { en: 'apple', zh: '蘋果' },
        { en: 'banana', zh: '香蕉' },
        { en: 'cherry', zh: '車厘子' },
        { en: 'dragon fruit', zh: '火龍果' },
        { en: 'elderberry', zh: '接骨木莓' }
    ];
    const questions = PS.buildVocabMC({ words: words, seed: 9, count: 12 });
    assert.equal(questions.length, 12);
    questions.forEach(q => {
        assert.equal(q.options.length, 4);
        assert.equal(q.options[q.answer], q.answer_text);
        assert.equal(q.options.filter(o => o === q.answer_text).length, 1);
    });
    assert.deepEqual(
        PS.buildVocabMC({ words: words, seed: 9, count: 12 }),
        questions,
        'same seed gives the same paper'
    );
    // Consecutive questions avoid an immediate repeat where possible.
    for (let i = 1; i < questions.length; i++) {
        assert.notEqual(questions[i].answer_text, questions[i - 1].answer_text);
    }
});

test('grammar MC reuses the question bank and produces exactly one correct option', () => {
    const bank = [
        { prompt: '1. She ___ to school.', primary: 'goes', sectionKey: 'Present' },
        { prompt: '2. They ___ to school.', primary: 'go', sectionKey: 'Present' },
        { prompt: '3. He ___ yesterday.', primary: 'went', sectionKey: 'Past' },
        { prompt: '4. I ___ tomorrow.', primary: 'will go', sectionKey: 'Future' },
        { prompt: '5. We ___ now.', primary: 'are going', sectionKey: 'Present continuous' }
    ];
    const questions = PS.buildGrammarMC({ questions: bank, seed: 4, count: 20 });
    assert.equal(questions.length, 20);
    questions.forEach(q => {
        assert.equal(q.options.length, 4);
        assert.equal(q.options[q.answer], q.answer_text);
    });
});

test('glass pairs for grammar put the correct answer against a close distractor', () => {
    const bank = [
        { prompt: '1. Neither of them ___ ready.', primary: 'is', sectionKey: 'agreement' },
        { prompt: '2. Neither of them ___ ready.', primary: 'are', sectionKey: 'agreement' },
        { prompt: '3. He ___ finished.', primary: 'has', sectionKey: 'tense' },
        { prompt: '4. They ___ finished.', primary: 'have', sectionKey: 'tense' }
    ];
    const pairs = PS.buildGlassPairs({ questions: bank, seed: 2, count: 4 });
    assert.equal(pairs.length, 4);
    pairs.forEach(pair => {
        assert.ok(pair.correct);
        assert.ok(pair.wrong);
        assert.notEqual(pair.correct, pair.wrong);
    });
});

/* ---------------------------------------------------------------- */
/* Wiring checks (static files, no browser)                          */
/* ---------------------------------------------------------------- */

test('index.html has the homepage tile, full-screen view and script order', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.indexOf('id="hub-purrfect-entry"') !== -1, 'hub tile exists');
    assert.ok(html.indexOf('id="purrfect-survival-view"') !== -1, 'game view exists');
    assert.ok(html.indexOf('id="ps-canvas"') !== -1, 'canvas exists');
    assert.ok(html.indexOf('id="ps-options"') !== -1, 'answer pad exists');

    const battle = html.indexOf('id="hub-battle-entry"');
    const tile = html.indexOf('id="hub-purrfect-entry"');
    const records = html.indexOf('id="hub-records-entry"');
    assert.ok(battle !== -1 && tile !== -1 && records !== -1);
    assert.ok(battle < tile && tile < records, 'tile sits after Word Battle and before My Records');

    const race = html.indexOf('js/grammar/drive-and-go-race.js');
    const engine = html.indexOf('js/purrfect-survival-engine.js');
    const render = html.indexOf('js/purrfect-survival-render.js');
    const main = html.indexOf('js/purrfect-survival.js');
    assert.ok(race !== -1 && engine !== -1 && render !== -1 && main !== -1);
    assert.ok(race < engine && engine < render && render < main, 'scripts load after DG race, engine -> render -> main');
});

test('service worker precaches the new modules and the SQL file is complete', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    ['purrfect-survival-engine.js', 'purrfect-survival-render.js', 'purrfect-survival.js'].forEach(name => {
        assert.ok(sw.indexOf(name) !== -1, name + ' is in CORE_ASSETS');
    });

    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    assert.ok(sql.indexOf('create table if not exists public.purrfect_survival_rooms') !== -1);
    assert.ok(sql.indexOf('create table if not exists public.purrfect_survival_players') !== -1);
    ['create_purrfect_survival', 'join_purrfect_survival', 'start_purrfect_survival',
        'tick_purrfect_survival', 'submit_purrfect_survival_answer',
        'glass_jump_purrfect_survival', 'end_purrfect_survival_round1'].forEach(fn => {
        assert.ok(sql.indexOf(fn) !== -1, fn + ' exists');
    });
    assert.ok(sql.indexOf("notify pgrst, 'reload schema';") !== -1);
    assert.ok(sql.indexOf('enable row level security') !== -1);
});

/* ---------------------------------------------------------------- */
/* Public demo (no login / no Supabase)                              */
/* ---------------------------------------------------------------- */

test('demo banks are built in and have enough entries', () => {
    assert.ok(Array.isArray(PS.DEMO_VOCAB), 'DEMO_VOCAB exists');
    assert.ok(PS.DEMO_VOCAB.length >= 20, 'at least 20 vocab pairs');
    PS.DEMO_VOCAB.forEach(word => {
        assert.ok(word.en && word.zh, 'vocab card needs English + Chinese');
    });

    assert.ok(Array.isArray(PS.DEMO_GRAMMAR), 'DEMO_GRAMMAR exists');
    assert.ok(PS.DEMO_GRAMMAR.length >= 20, 'at least 20 grammar prompts');
    PS.DEMO_GRAMMAR.forEach(q => {
        assert.ok(q.prompt && q.primary && q.sectionKey, 'grammar card needs prompt + primary + section');
    });
});

test('buildDemoQuestionSet builds a seeded vocab paper and a 9-step glass bridge', () => {
    const set = PS.buildDemoQuestionSet({ subject: 'vocab', seed: 4242 });
    assert.equal(set.subject, 'vocab');
    assert.ok(set.questions.length >= 12, 'at least 12 MC questions');
    set.questions.forEach(q => {
        assert.equal(q.options.length, 4, 'four options per MC question');
        assert.equal(q.options[q.answer], q.answer_text, 'answer index points at the correct text');
        assert.equal(q.options.filter(o => o === q.answer_text).length, 1, 'exactly one correct option');
        assert.ok(q.prompt, 'prompt is present');
    });

    assert.equal(set.glassPairs.length, 9, 'nine glass pairs');
    assert.equal(set.glassSteps.length, 9, 'nine glass steps');
    set.glassSteps.forEach(step => {
        assert.ok(step.correct_side === 'left' || step.correct_side === 'right', 'one correct side');
        assert.ok(step.left && step.right, 'both panes have text');
        assert.notEqual(step.left, step.right, 'panes are not identical');
        assert.equal(step.revealed, false);
    });

    assert.deepEqual(
        PS.buildDemoQuestionSet({ subject: 'vocab', seed: 4242 }),
        set,
        'same seed replays the same demo paper'
    );
});

test('buildDemoQuestionSet can use the grammar bank and never mixes subjects', () => {
    const set = PS.buildDemoQuestionSet({ subject: 'grammar', seed: 7 });
    assert.equal(set.subject, 'grammar');
    assert.ok(set.questions.length >= 12);
    set.questions.forEach(q => {
        assert.equal(q.options.length, 4);
        assert.equal(q.options[q.answer], q.answer_text);
        assert.equal(q.options.filter(o => o === q.answer_text).length, 1);
    });
    assert.equal(set.glassPairs.length, 9);
    set.glassSteps.forEach(step => {
        assert.ok(step.correct_side === 'left' || step.correct_side === 'right');
        assert.notEqual(step.left, step.right);
    });

    assert.equal(PS.buildDemoQuestionSet({ seed: 1 }).subject, 'vocab', 'defaults to vocab');
    assert.equal(PS.buildDemoQuestionSet({ subject: 'nope', seed: 1 }).subject, 'vocab', 'unknown falls back to vocab');
});

test('demo classmate builder returns 20–28 unique bots with cat looks', () => {
    const bots = PS.buildDemoClassmates({ count: 24, seed: 99 });
    assert.equal(bots.length, 24);
    const ids = new Set(bots.map(b => b.user_id));
    assert.equal(ids.size, 24, 'user_ids are unique');
    bots.forEach(bot => {
        assert.match(bot.nickname, /^4C \d\d /);
        assert.ok(bot.cat && bot.glasses && bot.hat && bot.outfit, 'mixed cat / hat / glasses / outfit');
    });
    assert.deepEqual(PS.buildDemoClassmates({ count: 24, seed: 99 }), bots, 'seeded builder is stable');
    assert.equal(PS.buildDemoClassmates({ count: 99 }).length, 28, 'clamped to the class size');
});

test('demo page and demo mode stay gated without weakening guest blocking', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'purrfect-survival.js'), 'utf8');
    ['isGuest', 'GUEST_NOT_ALLOWED', 'assertCanPlay', 'psdemo', 'startDemo',
        'demoMode', 'isDemoMode', 'demoJump', 'setDemoRole'].forEach(token => {
        assert.ok(src.indexOf(token) !== -1, token + ' is present');
    });
    assert.ok(src.indexOf('function demoAnswer') !== -1, 'visitor answers apply locally');
    assert.ok(src.indexOf('function demoGlassJump') !== -1, 'visitor jumps apply locally');
    assert.ok(src.indexOf('if (demoMode) return;') !== -1, 'const guards short-circuit Supabase work');
    assert.ok(src.indexOf('if (!info) return;') !== -1, 'missing phase clock does not skip to the bridge');

    const shared = fs.readFileSync(path.join(__dirname, '..', 'js', 'shared.js'), 'utf8');
    assert.ok(shared.indexOf('function isPurrfectSurvivalDemo') !== -1, 'shared.js recognises the demo');
    assert.ok(shared.indexOf('psdemo=1') !== -1, 'shared.js checks the psdemo flag');

    const demo = fs.readFileSync(path.join(__dirname, '..', 'purrfect-survival-demo.html'), 'utf8');
    assert.ok(demo.indexOf('psdemo=1') !== -1, 'iframe uses the psdemo=1 flag');
    assert.ok(demo.indexOf('id="demo-app"') !== -1, 'iframe element exists');
    assert.ok(demo.indexOf('src="/index.html?psdemo=1"') !== -1, 'iframe points at index.html');
    assert.ok(demo.indexOf('Replay') !== -1, 'Replay control');
    assert.ok(demo.indexOf('Student') !== -1, 'Student control');
    assert.ok(demo.indexOf('Teacher') !== -1 && demo.indexOf('Projector') !== -1, 'teacher/projector control');
    assert.ok(demo.indexOf('Round 1') !== -1 && demo.indexOf('Round 2') !== -1, 'round controls');
    assert.ok(demo.indexOf('Mid-victory') !== -1, 'mid-victory control');
});

test('demo lobby fills the vocab word-bank even when isGuestUser() is still true', async () => {
    const dom = loadMainWithDom({
        sheetNames: ['Food', 'School'],
        isGuestUser: function () { return true; }
    });

    dom.PS.startDemo({ role: 'student', scene: 'lobby' });

    ['ps-r1-vocab-source', 'ps-r2-vocab-source', 'ps-r3-vocab-source'].forEach(id => {
        const values = dom.optionValues(id);
        assert.ok(values.indexOf('New Vocab') !== -1, id + ' has New Vocab');
        assert.ok(values.indexOf('Food') !== -1, id + ' has the Food sheet topic');
        assert.ok(values.indexOf('School') !== -1, id + ' has the School sheet topic');
    });
    assert.ok(!dom.el('ps-room-actions').classList.contains('hidden'), 'demo keeps the host topic pickers visible');
    assert.ok(!dom.el('ps-host-note').classList.contains('hidden'), 'demo keeps the host note visible');
    assert.ok(dom.el('ps-guest-notice').classList.contains('hidden'), 'demo does not show the sign-in block');

    // PS.enter() is the other demo entry path (e.g. returning from another view).
    dom.el('ps-r1-vocab-source').innerHTML = '';
    assert.deepEqual(dom.optionValues('ps-r1-vocab-source'), []);
    await dom.PS.enter();
    assert.ok(dom.optionValues('ps-r1-vocab-source').indexOf('New Vocab') !== -1, 'demo enter refills the word bank');

    // Switching to Vocab must refill the list even if populateLobby was missed.
    dom.el('ps-r1-vocab-source').innerHTML = '';
    const subject = dom.el('ps-r1-subject');
    subject.value = 'grammar';
    dom.PS.syncSubjectFields(1);
    subject.value = 'vocab';
    dom.PS.syncSubjectFields(1);
    const values = dom.optionValues('ps-r1-vocab-source');
    assert.ok(values.indexOf('New Vocab') !== -1, 'vocab switch restores New Vocab');
    assert.ok(values.indexOf('Food') !== -1, 'vocab switch restores the sheet topics');
    assert.ok(values.indexOf('School') !== -1, 'vocab switch restores every sheet topic');
});

test('live guest path still hides the host settings', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'], isGuestUser: function () { return false; } });
    dom.PS.populateLobby();
    assert.ok(dom.el('ps-room-actions').classList.contains('hidden'), 'live guests cannot see the create-room card');
    assert.ok(dom.el('ps-host-note').classList.contains('hidden'), 'live guests do not see host settings');
    assert.ok(!dom.el('ps-guest-notice').classList.contains('hidden'), 'live guests see the sign-in notice');
});

test('demo entry paths call populateLobby', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'purrfect-survival.js'), 'utf8');
    const enterDemo = src.slice(src.indexOf('PS.enter = async function'), src.indexOf('if (!signedInUser() || isGuest())'));
    assert.ok(enterDemo.indexOf('populateLobby();') !== -1, 'demo enter calls populateLobby');
    const jumpLobby = src.slice(src.indexOf('function demoJumpLobby()'), src.indexOf('function demoJumpRound1()'));
    assert.ok(jumpLobby.indexOf('populateLobby();') !== -1, 'demoJumpLobby calls populateLobby');
});

/* 3D renderer: exports, drawing safety and original artwork         */
/* ---------------------------------------------------------------- */

const RENDERER = loadRenderer();

function samplePlayers() {
    const list = [];
    for (let i = 0; i < 18; i++) {
        list.push({
            user_id: 'u' + i,
            nickname: '4C ' + String(i + 1).padStart(2, '0') + ' Student',
            status: i === 5 ? 'eliminated' : 'alive',
            ghost: i === 5,
            distance: Math.min(100, i * 6),
            glass_step: (i % 9),
            glass_active: i < 2,
            glass_side: i % 2 ? 'right' : 'left',
            cat: 'Ginger',
            glasses: 'None',
            hat: 'None',
            outfit: 'None'
        });
    }
    return list;
}

function sampleGlass() {
    const steps = [];
    for (let i = 0; i < 9; i++) {
        steps.push({
            index: i,
            prompt: 'Neither of them ___ ready.',
            left: 'is',
            right: 'are',
            correct_side: i % 2 ? 'left' : 'right',
            revealed: i < 3,
            revealed_side: i < 3 ? (i % 2 ? 'left' : 'right') : null,
            shattered_side: i === 2 ? 'left' : null
        });
    }
    return steps;
}

function sampleState(round, extra) {
    return Object.assign({
        mode: 'round',
        round: round,
        role: 'player',
        w: 390,
        h: 844,
        introElapsed: 0,
        players: samplePlayers(),
        meId: 'u1',
        finishDistance: 100,
        phase: 'green',
        phaseElapsed: 0,
        phaseDuration: 4000,
        elapsed: 14000,
        now: 4200,
        bang: 0,
        glassSteps: sampleGlass(),
        stepCount: 9
    }, extra || {});
}

test('renderer exports the public API and bumps its version for the 3D rewrite', () => {
    ['drawScene', 'drawRound1', 'drawRound2', 'drawIntro', 'drawDoll', 'drawCat', 'drawLobbyCat', 'layout']
        .forEach(name => assert.equal(typeof RENDERER[name], 'function', name + ' is exported'));
    assert.match(RENDERER.VERSION, /^2\./);
    const L = RENDERER.layout(390, 844, 'player');
    ['w', 'h', 'startY', 'finishY', 'bridgeNearY', 'bridgeFarY', 'centerX'].forEach(key => {
        assert.ok(key in L, 'layout keeps ' + key);
    });
    assert.ok(L.cam1 && L.cam1.eye && L.cam1.target, 'round 1 camera preset exists');
    assert.ok(L.cam2 && L.cam2.eye && L.cam2.target, 'round 2 camera preset exists');
    assert.ok(L.startY > L.finishY, 'start is nearer the viewer than the finish');
});

test('drawScene paints intro, Round 1 and Round 2 without throwing (portrait + landscape)', () => {
    const sizes = [[390, 844, 'player'], [1024, 768, 'host'], [844, 390, 'player']];
    sizes.forEach(size => {
        const canvas = { width: size[0] * 2, height: size[1] * 2 };
        const ctx = mockContext(canvas);
        const base = { w: size[0], h: size[1], role: size[2] };

        [0, 3200, 6100, 9000, 15000].forEach(t => {
            assert.doesNotThrow(() => RENDERER.drawScene(ctx, sampleState(0, Object.assign({}, base, {
                mode: 'intro', introElapsed: t
            }))), 'intro @' + t + 'ms paints');
        });

        ['green', 'yellow', 'red', 'done'].forEach(phase => {
            assert.doesNotThrow(() => RENDERER.drawRound1(ctx, sampleState(1, Object.assign({}, base, {
                phase: phase, phaseElapsed: 1200, dollTurn: phase === 'red' ? 1 : 0.4
            }))), 'round 1 ' + phase + ' paints');
        });

        assert.doesNotThrow(() => RENDERER.drawRound2(ctx, sampleState(2, base)), 'round 2 paints');
        assert.doesNotThrow(() => RENDERER.drawDoll(ctx, 100, 200, 1.2, { turn: 1, red: true, warning: true }));
        assert.doesNotThrow(() => RENDERER.drawCat(ctx, 60, 300, 0.8, { cat: 'Garfield' }, { ring: true }));
        assert.doesNotThrow(() => RENDERER.drawLobbyCat(ctx, 30, 30, 0.3, { cat: 'Ragdoll' }));
    });
});

test('the 3D renderer uses no photographic assets or reference stills', () => {
    const src = fs.readFileSync(RENDER_PATH, 'utf8');
    assert.equal(/drawImage/.test(src), false, 'renderer never blits bitmaps');
    ['intro-hallway-ref', 'intro-stairs-ref', 'round1-playground-ref', 'round2-glass-bridge-ref']
        .forEach(name => assert.equal(src.indexOf(name), -1, name + ' is not referenced'));
    assert.equal(/data:image\/(jpeg|jpg|png)/i.test(src), false, 'no embedded image data URLs');
    assert.equal(/base64,[A-Za-z0-9+/]{200,}/.test(src), false, 'no large base64 payloads');
    assert.equal(/@font-face/.test(src), false, 'no imported typography');
});

test('the old flat sunset and cyan-sky backdrops are gone', () => {
    const src = fs.readFileSync(RENDER_PATH, 'utf8').toLowerCase();
    ['#2b1a52', '#f7b267', '#7c3d78', '#e27a6f', '#0ea5e9', '#bae6fd']
        .forEach(hex => assert.equal(src.indexOf(hex), -1, hex + ' must not be a world backdrop any more'));
    assert.ok(src.indexOf('#dbeaf6') !== -1, 'pale painted-sky mural is used');
    assert.ok(src.indexOf('#08050c') !== -1 || src.indexOf('#0d0713') !== -1, 'dark theatre base is used');
});

/* ---------------------------------------------------------------- */
/* Entrance sequencing (waiting room)                                */
/* ---------------------------------------------------------------- */

const MAIN = loadMain();

test('intro stages follow the hallway -> stairs -> hold schedule', () => {
    assert.equal(MAIN.introStage(0), 'hall');
    assert.equal(MAIN.introStage(5999), 'hall');
    assert.equal(MAIN.introStage(6000), 'stairs');
    assert.equal(MAIN.introStage(11000), 'stairs');
    assert.equal(MAIN.introStage(14400), 'hold');
    assert.equal(MAIN.introStage(999999), 'hold');
    assert.equal(RENDERER.INTRO.hallMs, 6000);
    assert.ok(RENDERER.INTRO.stairsMs >= 7000, 'the stair briefing is long enough to read');
});

test('the entrance only plays once, in a waiting room, and never after the round starts', () => {
    assert.equal(MAIN.shouldPlayIntro({ status: 'waiting', seen: false }), true);
    assert.equal(MAIN.shouldPlayIntro({ status: 'waiting', seen: true }), false);
    assert.equal(MAIN.shouldPlayIntro({ status: 'round1', seen: false }), false);
    assert.equal(MAIN.shouldPlayIntro({ status: 'round2', seen: false }), false);
    assert.equal(MAIN.shouldPlayIntro({ status: 'finished', seen: false }), false);
    assert.equal(typeof MAIN.skipIntro, 'function');
    assert.equal(typeof MAIN.introElapsedMs, 'function');
});

test('the waiting room goes full-stage with the live canvas and keeps the Start button', () => {
    const src = fs.readFileSync(MAIN_PATH, 'utf8');
    const start = src.indexOf('function renderWaiting');
    const end = src.indexOf('function render()', start);
    assert.ok(start !== -1 && end > start);
    const fn = src.slice(start, end);
    assert.ok(fn.indexOf('setLive(true)') !== -1, 'waiting uses the live canvas');
    assert.ok(fn.indexOf('ps-start-btn') !== -1, 'host Start button is still wired');
    assert.ok(fn.indexOf('ps-player-list') !== -1, 'player list is still wired');

    const frameStart = src.indexOf('function frame(ts)');
    const frameEnd = src.indexOf('function updateHud', frameStart);
    const frameFn = src.slice(frameStart, frameEnd);
    assert.ok(frameFn.indexOf("mode: waiting ? 'intro' : 'round'") !== -1, 'frames paint the intro while waiting');

    assert.equal(src.indexOf('showRoundIntro'), -1, 'blocking showRoundIntro is gone');
    assert.equal(src.indexOf("PS.showOverlay('Round 1"), -1, 'Round 1 is not covered by a modal');
    assert.ok(src.indexOf('showRoundCue') !== -1, 'a non-blocking round cue exists');
});

test('index.html hosts the cinematic waiting overlay, rules cards and skip control', () => {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    ['ps-cine', 'ps-cine-rule1', 'ps-cine-rule2', 'ps-cine-rule1-zh', 'ps-cine-rule2-zh',
        'ps-intro-skip', 'ps-round-cue', 'ps-player-list', 'ps-start-btn']
        .forEach(id => assert.ok(html.indexOf('id="' + id + '"') !== -1, id + ' exists'));
    assert.ok(html.indexOf('Skip intro') !== -1, 'a discreet skip control exists');
    assert.ok(html.indexOf('玻璃橋') !== -1, 'Traditional Chinese copy is used');
    assert.ok(html.indexOf('1-2-3 Meow!') !== -1, 'Round 1 uses the official 1-2-3 Meow! title');
});

test('bilingual rules are faithful to the English engine copy', () => {
    assert.equal(typeof PS.RULE_TEXT_ZH, 'object');
    assert.match(PS.RULE_TEXT_ZH.round1, /綠燈/);
    assert.match(PS.RULE_TEXT_ZH.round1, /100 米/);
    assert.match(PS.RULE_TEXT_ZH.round2, /5 秒/);
    assert.match(PS.RULE_TEXT_ZH.round2, /玻璃/);
    assert.equal(typeof PS.RULE_TEXT.round1, 'string');
    assert.ok(PS.RULE_TEXT.round1.indexOf('+10 m') !== -1);
});

/* ---------------------------------------------------------------- */
/* Host settings (roundCount + per-round configuration)              */
/* ---------------------------------------------------------------- */

test('host settings expose an extensible round map and default to two rounds', () => {
    assert.equal(PS.HOST.MAX_IMPLEMENTED, 3);
    assert.equal(PS.HOST.MAX_PLANNED, 5);
    assert.equal(PS.HOST.KINDS[1], 'meow');
    assert.equal(PS.HOST.KINDS[2], 'glass');
    assert.equal(PS.HOST.KINDS[3], 'tug');
    assert.equal(PS.HOST.KINDS[4], 'glass2');
    assert.equal(PS.HOST.KINDS[5], 'squid');

    assert.equal(PS.roomRoundCount({}), 2, 'old rooms default to 2 rounds');
    assert.equal(PS.roomRoundCount({ roundCount: 1 }), 1);
    assert.equal(PS.roomRoundCount({ roundCount: 2 }), 2);
    assert.equal(PS.roomRoundCount({ roundCount: 3 }), 3);
    assert.equal(PS.roomRoundCount({ roundCount: 0 }), 1, 'below 1 clamps to 1');
    assert.equal(PS.roomRoundCount({ roundCount: 4 }), 3, 'above the implemented max clamps to 3');
    assert.equal(PS.roomRoundCount(JSON.stringify({ roundCount: 1 })), 1, 'JSON strings are accepted');

    assert.equal(PS.shouldPlayRound2({ roundCount: 1 }), false);
    assert.equal(PS.shouldPlayRound2({}), true);
    assert.equal(PS.round1EndAction({ roundCount: 1 }), 'finish');
    assert.equal(PS.round1EndAction({ roundCount: 2 }), 'bridge');

    assert.equal(PS.shouldPlayRound3({ roundCount: 1 }), false);
    assert.equal(PS.shouldPlayRound3({ roundCount: 2 }), false);
    assert.equal(PS.shouldPlayRound3({ roundCount: 3 }), true);
    assert.equal(PS.round2EndAction({ roundCount: 1 }), 'finish');
    assert.equal(PS.round2EndAction({ roundCount: 2 }), 'finish');
    assert.equal(PS.round2EndAction({ roundCount: 3 }), 'tug');
});

test('validateHostSettings allows mixed subjects across rounds and keeps round-1 summary', () => {
    const result = PS.validateHostSettings({
        roundCount: 2,
        finishDistance: 200,
        glassSteps: 12,
        rounds: [
            { round: 1, subject: 'vocab', vocabSource: 'Food', vocabForm: 'F4' },
            { round: 2, subject: 'grammar', topic: 'agreement', bankMode: 'choose' }
        ]
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.settings.version, 1);
    assert.equal(result.settings.roundCount, 2);
    assert.equal(result.settings.rounds.length, 2);
    assert.equal(result.rounds[0].subject, 'vocab');
    assert.equal(result.rounds[0].topic, 'Food');
    assert.equal(result.rounds[0].vocabSource, 'Food');
    assert.equal(result.rounds[0].vocabForm, 'F4');
    assert.equal(result.rounds[0].finishDistance, 200);
    assert.equal(result.rounds[0].roundMs, 360000);
    assert.equal(result.rounds[1].subject, 'grammar');
    assert.equal(result.rounds[1].topic, 'agreement');
    assert.equal(result.rounds[1].bankMode, 'choose');
    assert.equal(result.rounds[1].glassSteps, 12);

    // Room-level columns summarise round 1, not a mixed subject string.
    assert.equal(result.subject, 'vocab');
    assert.equal(result.source, 'Food');
    assert.equal(result.topic, 'Food');
    assert.equal(result.bankMode, '');
    assert.equal(result.finishDistance, 200);
    assert.equal(result.roundMs, 360000);
});

test('a single round still cannot mix vocab and grammar fields', () => {
    const bad = PS.validateHostSettings({
        roundCount: 1,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'Food', grammarTopic: 'tenses' }]
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'ONE_SUBJECT_ONLY');

    assert.equal(PS.isOneSubject({ subject: 'vocab', vocabSource: 'Food' }), true);
    assert.equal(PS.isOneSubject({ subject: 'grammar', grammarTopic: 'tenses' }), true);
    assert.equal(PS.isOneSubject({ subject: 'vocab', vocabSource: 'Food', bankMode: 'mixed' }), false);

    const round = PS.validateRoundSetup({ round: 1, subject: 'grammar', topic: 'tenses', bankMode: 'mixed' });
    assert.equal(round.ok, true);
    assert.equal(round.setup.subject, 'grammar');
    assert.equal(round.setup.round, 1);
    assert.equal(round.setup.kind, 'meow');
});

test('finish distance defaults to 100 m and clamps to 30–300 m on a 10 m step', () => {
    assert.equal(PS.normalizeFinishDistance(), 100);
    assert.equal(PS.normalizeFinishDistance(''), 100);
    assert.equal(PS.normalizeFinishDistance('nope'), 100);
    assert.equal(PS.normalizeFinishDistance(50), 50);
    assert.equal(PS.normalizeFinishDistance(200), 200);
    assert.equal(PS.normalizeFinishDistance(300), 300);
    assert.equal(PS.normalizeFinishDistance(20), 30, 'below the range clamps up');
    assert.equal(PS.normalizeFinishDistance(500), 300, 'above the range clamps down');
    assert.equal(PS.normalizeFinishDistance(137), 140, 'rounds to the nearest 10 m step');

    const clamped = PS.validateHostSettings({
        roundCount: 1,
        finishDistance: 20,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'Food' }]
    });
    assert.equal(clamped.ok, true);
    assert.equal(clamped.finishDistance, 30);
    assert.equal(clamped.settings.rounds[0].finishDistance, 30);
});

test('round-1 time cap scales with distance and never drops below 60 s', () => {
    assert.equal(PS.scaleRound1Ms(50), 90000);
    assert.equal(PS.scaleRound1Ms(100), 180000);
    assert.equal(PS.scaleRound1Ms(200), 360000);
    assert.equal(PS.scaleRound1Ms(300), 540000);
    assert.equal(PS.scaleRound1Ms(30), 60000, 'minimum cap is 60 s');

    const result = PS.validateHostSettings({
        roundCount: 1,
        finishDistance: 50,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'Food' }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.roundMs, 90000);
    assert.equal(result.settings.rounds[0].roundMs, 90000);
});

test('glass step count defaults to 9, clamps to 3–15 and builders honour it', () => {
    assert.equal(PS.normalizeGlassSteps(), 9);
    assert.equal(PS.normalizeGlassSteps(''), 9);
    assert.equal(PS.normalizeGlassSteps('nope'), 9);
    assert.equal(PS.normalizeGlassSteps(3), 3);
    assert.equal(PS.normalizeGlassSteps(15), 15);
    assert.equal(PS.normalizeGlassSteps(1), 3, 'below the range clamps up');
    assert.equal(PS.normalizeGlassSteps(99), 15, 'above the range clamps down');

    const pairs = [
        { prompt: 'q1', correct: 'is', wrong: 'are' },
        { prompt: 'q2', correct: 'has', wrong: 'have' }
    ];
    assert.equal(PS.buildGlassSteps({ pairs: pairs, seed: 5, count: 3 }).length, 3);
    assert.equal(PS.buildGlassSteps({ pairs: pairs, seed: 5, count: 15 }).length, 15);
    assert.equal(PS.buildGlassPairs({
        questions: [
            { prompt: 'a', primary: 'is', sectionKey: 's' },
            { prompt: 'b', primary: 'are', sectionKey: 's' }
        ],
        seed: 2,
        count: 5
    }).length, 5);

    const result = PS.validateHostSettings({
        roundCount: 2,
        glassSteps: 15,
        rounds: [
            { round: 1, subject: 'vocab', vocabSource: 'Food' },
            { round: 2, subject: 'vocab', vocabSource: 'Food' }
        ]
    });
    assert.equal(result.ok, true);
    assert.equal(result.rounds[1].glassSteps, 15);
    assert.equal(result.settings.glassSteps, 15);
});

test('legacy settings behave as 2 rounds, 100 m and 9 glass steps', () => {
    const legacy = PS.roundConfig({ vocabSource: 'Food', roundMs: 180000 }, 1);
    assert.equal(legacy.subject, 'vocab');
    assert.equal(legacy.topic, 'Food');
    assert.equal(legacy.finishDistance, 100);
    assert.equal(legacy.roundMs, 180000);
    assert.equal(legacy.glassSteps, 9);

    const second = PS.roundConfig({ vocabSource: 'Food', roundMs: 180000 }, 2);
    assert.equal(second.subject, 'vocab', 'old rooms share one bank');
    assert.equal(second.topic, 'Food');
    assert.equal(second.glassSteps, 9);

    const flat = PS.validateHostSettings({ roundCount: 2, subject: 'vocab', vocabSource: 'Food' });
    assert.equal(flat.ok, true, flat.error);
    assert.equal(flat.rounds.length, 2);
    assert.equal(flat.rounds[1].vocabSource, 'Food', 'missing round 2 falls back to round 1');
    assert.equal(flat.finishDistance, 100);
    assert.equal(flat.rounds[1].glassSteps, 9);
});

test('roundConfig reads per-round entries and room-level fallback', () => {
    const settings = {
        roundCount: 2,
        rounds: [
            { round: 1, subject: 'vocab', vocabSource: 'Food', finishDistance: 150, roundMs: 270000 },
            { round: 2, subject: 'grammar', topic: 'articles', bankMode: 'mixed', glassSteps: 6 }
        ]
    };
    const r1 = PS.roundConfig(settings, 1);
    const r2 = PS.roundConfig(settings, 2);
    assert.equal(r1.kind, 'meow');
    assert.equal(r1.finishDistance, 150);
    assert.equal(r1.roundMs, 270000);
    assert.equal(r2.kind, 'glass');
    assert.equal(r2.subject, 'grammar');
    assert.equal(r2.topic, 'articles');
    assert.equal(r2.bankMode, 'mixed');
    assert.equal(r2.glassSteps, 6);

    // Old room row only: room-level summary fields are used.
    assert.equal(PS.roundConfig({}, 1, { subject: 'grammar', topic: 'tenses', bank_mode: 'pv' }).topic, 'tenses');
    assert.equal(PS.roundConfig({}, 1, { subject: 'grammar', topic: 'tenses', bank_mode: 'pv' }).bankMode, 'pv');
    assert.equal(PS.roundConfig({}, 1, { subject: 'vocab', source: 'Shopping' }).vocabSource, 'Shopping');
});

test('host settings reject unimplemented rounds and invalid subjects/topics', () => {
    assert.equal(PS.validateHostSettings({
        roundCount: 4,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'Food' }]
    }).error, 'ROUNDS_NOT_IMPLEMENTED');
    assert.equal(PS.validateHostSettings({
        roundCount: 5,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'Food' }]
    }).error, 'ROUNDS_NOT_IMPLEMENTED');
    assert.equal(PS.validateHostSettings({
        roundCount: 0,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'Food' }]
    }).error, 'INVALID_ROUND_COUNT');
    assert.equal(PS.validateHostSettings({
        roundCount: 1,
        rounds: [{ round: 1, subject: 'maths', topic: 'algebra' }]
    }).error, 'INVALID_SUBJECT');
    assert.equal(PS.validateHostSettings({
        roundCount: 1,
        rounds: [{ round: 1, subject: 'grammar', topic: 'nope' }]
    }).error, 'INVALID_TOPIC');
    assert.equal(PS.validateHostSettings({
        roundCount: 1,
        rounds: [{ round: 1, subject: 'vocab' }]
    }).error, 'MISSING_VOCAB_SOURCE');
});

/* ---------------------------------------------------------------- */
/* Host settings wiring (static files, no browser)                   */
/* ---------------------------------------------------------------- */

test('lobby HTML has the new host-setting controls and no old one-subject rule', () => {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    ['ps-round-count', 'ps-finish-distance', 'ps-glass-steps',
        'ps-r1-subject', 'ps-r1-vocab-source', 'ps-r1-grammar-topic',
        'ps-r2-subject', 'ps-r2-vocab-source', 'ps-r2-grammar-topic',
        'ps-r3-subject', 'ps-r3-vocab-source', 'ps-r3-grammar-topic',
        'ps-tug-duration', 'ps-tug-start-btn',
        'ps-round1-card', 'ps-round2-card', 'ps-round3-card'].forEach(id => {
        assert.ok(html.indexOf('id="' + id + '"') !== -1, id + ' exists');
    });
    assert.ok(html.indexOf('min="30" max="300" step="10"') !== -1, 'distance input range 30–300 step 10');
    assert.ok(html.indexOf('min="3" max="15" step="1"') !== -1, 'glass steps input range 3–15');
    assert.ok(html.indexOf('id="ps-tug-duration" type="number" min="30" max="120" step="5" value="60"') !== -1,
        'tug duration input range 30–120 step 5');
    assert.equal(html.indexOf('value="3" disabled'), -1, 'round 3 is no longer coming soon');
    assert.ok(html.indexOf('value="3">3 rounds') !== -1, 'round 3 is selectable');
    assert.ok(html.indexOf('value="4" disabled') !== -1, 'round 4 still coming soon');
    assert.ok(html.indexOf('value="5" disabled') !== -1, 'round 5 still coming soon');
    assert.equal(html.indexOf('One subject per room'), -1, 'the old one-subject-per-room copy is gone');
    assert.ok(html.indexOf('Each round can use a different subject') !== -1, 'copy explains per-round subjects');
});

test('main module reads and sends the host settings without the old room-level rule', () => {
    const src = fs.readFileSync(MAIN_PATH, 'utf8');
    ['validateHostSettings', 'roomRoundCount', 'roundConfig', 'syncRoundCount',
        'ps-round-count', 'ps-finish-distance', 'ps-glass-steps',
        'ROUNDS_NOT_IMPLEMENTED', 'demoGlassStepCount'].forEach(token => {
        assert.ok(src.indexOf(token) !== -1, token + ' is wired');
    });
    assert.equal(src.indexOf('One subject per room — do not mix Vocab and Grammar.'), -1,
        'the old user-facing one-subject error is gone');
    assert.ok(src.indexOf('One subject per round') !== -1, 'the error now mentions a single round');
    assert.ok(src.indexOf("demoRoundCount") !== -1, 'demo accepts a round count');
});

test('incremental host-settings SQL exists with teacher instructions and new functions', () => {
    const file = path.join(__dirname, '..', 'supabase', 'purrfect_survival_host_settings.sql');
    assert.ok(fs.existsSync(file), 'incremental SQL file exists');
    const sql = fs.readFileSync(file, 'utf8');
    assert.ok(sql.indexOf('https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new') !== -1, 'live project URL');
    assert.ok(/Do NOT re-run older incrementals/i.test(sql), 'tells the teacher not to re-run older files');
    assert.ok(/Safe to re-run/i.test(sql), 'safe to re-run');
    assert.ok(/plugin, CLI or agent/i.test(sql), 'never run via a plugin');
    ['purrfect_survival_round_count', 'purrfect_survival_finish_value',
        'purrfect_survival_glass_count', 'purrfect_survival_complete_round1',
        'create_purrfect_survival', 'start_purrfect_survival',
        'end_purrfect_survival_round1', 'start_purrfect_survival_round2',
        'tick_purrfect_survival'].forEach(fn => {
        assert.ok(sql.indexOf(fn) !== -1, fn + ' exists');
    });
    assert.ok(sql.indexOf('ROUNDS_NOT_IMPLEMENTED') !== -1);
    assert.ok(sql.indexOf("notify pgrst, 'reload schema';") !== -1);

    const canonical = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    assert.ok(canonical.indexOf('purrfect_survival_complete_round1') !== -1, 'canonical SQL has the new helper');
    assert.ok(canonical.indexOf('purrfect_survival_round_count') !== -1, 'canonical SQL has the round count helper');
    assert.ok(canonical.indexOf('ROUNDS_NOT_IMPLEMENTED') !== -1, 'canonical SQL rejects rounds 3–5');
});

test('service worker cache is bumped for the tug-of-war change', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    assert.ok(sw.indexOf("learnity-pwa-v105") !== -1, 'CACHE_NAME is v105');
    assert.equal(sw.indexOf("learnity-pwa-v104"), -1, 'the old cache name is gone');
});

test('demo page exposes round count, metres, glass step and tug controls', () => {
    const demo = fs.readFileSync(path.join(__dirname, '..', 'purrfect-survival-demo.html'), 'utf8');
    ['demo-round-count', 'demo-finish-distance', 'demo-glass-steps', 'demo-tug-duration', 'demo-round3'].forEach(id => {
        assert.ok(demo.indexOf('id="' + id + '"') !== -1, id + ' control exists');
    });
    assert.ok(demo.indexOf('<option value="3">3</option>') !== -1, 'round 3 is selectable in the demo');
    assert.ok(demo.indexOf('applyDemoSettings') !== -1, 'controls re-apply the demo settings');
    assert.ok(demo.indexOf('setDemoSettings') !== -1, 'main demo API is used');
});

/* ---------------------------------------------------------------- */
/* Round 3 — Tug of War (engine)                                     */
/* ---------------------------------------------------------------- */

const ROUND3 = PS.ROUND3;

function tugPlayer(id, rank, finishedAt, extra) {
    return Object.assign({
        user_id: id,
        status: 'advanced',
        crossed_glass: true,
        ghost: false,
        is_playing: true,
        round1_rank: rank,
        glass_finished_at: finishedAt == null ? null : 1000 + finishedAt
    }, extra || {});
}

test('tug constants and duration clamp match the round-3 brief', () => {
    assert.equal(ROUND3.DEFAULT_MS, 60000);
    assert.equal(ROUND3.MIN_MS, 30000);
    assert.equal(ROUND3.MAX_MS, 120000);
    assert.equal(ROUND3.COMBO, 5);
    assert.equal(ROUND3.RAGE_MULT, 2);
    assert.equal(ROUND3.RAGE_MS, 5000);
    assert.equal(ROUND3.WIN_PULL, 20);

    assert.equal(PS.normalizeTugDuration(), 60000);
    assert.equal(PS.normalizeTugDuration(''), 60000);
    assert.equal(PS.normalizeTugDuration('nope'), 60000);
    assert.equal(PS.normalizeTugDuration(60), 60000, 'seconds are accepted');
    assert.equal(PS.normalizeTugDuration(30), 30000);
    assert.equal(PS.normalizeTugDuration(120), 120000);
    assert.equal(PS.normalizeTugDuration(60000), 60000, 'milliseconds are accepted');
    assert.equal(PS.normalizeTugDuration(1000), 30000, 'below range clamps up');
    assert.equal(PS.normalizeTugDuration(200000), 120000, 'above range clamps down');
});

test('tug survivors are advanced/crossed players only and skip with fewer than two', () => {
    const players = [
        tugPlayer('a', 1, 1),
        tugPlayer('b', 2, 2),
        tugPlayer('out', 3, 3, { status: 'eliminated', ghost: true }),
        tugPlayer('alive', 4, 4, { status: 'alive', crossed_glass: false }),
        tugPlayer('ghost', 5, 5, { ghost: true })
    ];
    const survivors = PS.tugSurvivors(players).map(p => p.user_id);
    assert.deepEqual(survivors, ['a', 'b']);
    assert.equal(PS.shouldSkipTug(players.slice(0, 1)), true);
    assert.equal(PS.shouldSkipTug(players.slice(0, 2)), false);
});

test('tug teams use a deterministic fair snake split (odd counts included)', () => {
    const even = [
        tugPlayer('A', 1, 1), tugPlayer('B', 2, 2), tugPlayer('C', 3, 3),
        tugPlayer('D', 4, 4), tugPlayer('E', 5, 5), tugPlayer('F', 6, 6)
    ];
    const split = PS.splitTugTeams(even);
    assert.deepEqual(split.map(p => p.user_id), ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.deepEqual(split.map(p => p.tug_team), ['red', 'blue', 'blue', 'red', 'red', 'blue']);

    const odd = even.slice(0, 5);
    const oddSplit = PS.splitTugTeams(odd);
    assert.deepEqual(oddSplit.map(p => p.user_id), ['A', 'B', 'C', 'D', 'E']);
    assert.deepEqual(oddSplit.map(p => p.tug_team), ['red', 'blue', 'blue', 'red', 'red']);
    assert.equal(oddSplit.filter(p => p.tug_team === 'red').length, 3, 'odd class gives one team +1');

    // Input is not mutated; split returns fresh player copies.
    even.forEach(p => assert.equal('tug_team' in p, false));
    assert.notStrictEqual(split[0], even[0]);

    // Finish order is glass_finished_at, then round1_rank, then user_id.
    const shuffled = [even[3], even[1], even[5], even[0], even[4], even[2]];
    assert.deepEqual(PS.splitTugTeams(shuffled).map(p => p.user_id), ['A', 'B', 'C', 'D', 'E', 'F']);

    const tied = [
        tugPlayer('z', 2, 10), tugPlayer('y', 1, 10), tugPlayer('x', 2, null)
    ];
    assert.deepEqual(PS.splitTugTeams(tied).map(p => p.user_id), ['y', 'z', 'x']);
});

test('a correct tug answer pulls +1, a wrong answer pulls nothing and breaks combo', () => {
    let state = PS.normalizeTugState({ phase: 'playing' });
    let result = PS.applyTugAnswer(state, { team: 'red', correct: true, now: 1000 });
    assert.equal(result.state.redPull, 1);
    assert.equal(result.state.bluePull, 0);
    assert.equal(result.state.position, -1);
    assert.equal(result.state.redCombo, 1);
    assert.equal(result.pull, 1);
    assert.equal(result.winner, null);

    result = PS.applyTugAnswer(result.state, { team: 'blue', correct: true, now: 1100 });
    assert.equal(result.state.blueCombo, 1);
    assert.equal(result.state.position, 0);
    result = PS.applyTugAnswer(result.state, { team: 'blue', correct: false, now: 1200 });
    assert.equal(result.state.blueCombo, 0, 'a miss breaks that team combo');
    assert.equal(result.state.bluePull, 1, 'a miss gives the other team no pull');
    assert.equal(result.comboBroken, true);

    // Answers outside the playing phase are ignored.
    const briefing = PS.normalizeTugState({ phase: 'briefing' });
    const ignored = PS.applyTugAnswer(briefing, { team: 'red', correct: true, now: 2000 });
    assert.equal(ignored.state.redPull, 0);
    assert.equal(PS.applyTugAnswer(state, { team: '', correct: true, now: 1 }).pull, 0);
});

test('five team combo triggers 2x rage, rage answers pull +2, and a miss cancels rage', () => {
    let state = PS.normalizeTugState({ phase: 'playing' });
    let triggered = false;
    for (let i = 1; i <= 5; i++) {
        const res = PS.applyTugAnswer(state, { team: 'red', correct: true, now: 1000 + i * 100 });
        state = res.state;
        if (i < 5) assert.equal(res.rageTriggered, false);
        else {
            triggered = true;
            assert.equal(res.rageTriggered, true);
            assert.equal(res.state.redCombo, 0, 'triggering rage resets the combo meter');
            assert.equal(res.state.redRageUntil, 1500 + ROUND3.RAGE_MS);
        }
    }
    assert.equal(triggered, true);
    assert.equal(state.redPull, 5);
    assert.equal(PS.tugRageActive(state, 'red', 2000), true);

    const during = PS.applyTugAnswer(state, { team: 'red', correct: true, now: 2500 });
    assert.equal(during.pull, 2, 'a rage answer is worth +2');
    assert.equal(during.state.redPull, 7);
    assert.equal(during.state.redCombo, 0);

    const miss = PS.applyTugAnswer(during.state, { team: 'red', correct: false, now: 2600 });
    assert.equal(miss.state.redRageUntil, 0, 'a miss cancels rage');
    assert.equal(PS.tugRageActive(miss.state, 'red', 2600), false);
    assert.equal(miss.state.redCombo, 0);
});

test('the tug ends instantly once the salmon is pulled 20 steps past centre', () => {
    const state = PS.normalizeTugState({ phase: 'playing', redPull: 19, bluePull: 0 });
    const result = PS.applyTugAnswer(state, { team: 'red', correct: true, now: 1000 });
    assert.equal(result.state.position, -20);
    assert.equal(result.state.winner, 'red');
    assert.equal(result.state.phase, 'done');

    const blue = PS.normalizeTugState({ phase: 'playing', bluePull: 19, redPull: 0 });
    const win = PS.applyTugAnswer(blue, { team: 'blue', correct: true, now: 1000 });
    assert.equal(win.state.winner, 'blue');
    assert.equal(win.state.phase, 'done');
});

test('time-up gives the win to the side with the salmon, and exact centre is sudden death', () => {
    const red = PS.resolveTugAtTimeUp({ phase: 'playing', redPull: 4, bluePull: 2 }, 1000);
    assert.equal(red.winner, 'red');
    assert.equal(red.phase, 'done');

    const blue = PS.resolveTugAtTimeUp({ phase: 'playing', redPull: 1, bluePull: 5 }, 1000);
    assert.equal(blue.winner, 'blue');

    const tied = PS.resolveTugAtTimeUp({ phase: 'playing', redPull: 3, bluePull: 3 }, 1000);
    assert.equal(tied.winner, null);
    assert.equal(tied.suddenDeath, true);
    assert.equal(tied.phase, 'playing', 'sudden death keeps playing');

    const decided = PS.applyTugAnswer(tied, { team: 'red', correct: true, now: 1100 });
    assert.equal(decided.state.position, -1);
    assert.equal(decided.state.winner, 'red');
    assert.equal(decided.state.phase, 'done', 'the next scoring answer ends sudden death');

    const stillTied = PS.applyTugAnswer(tied, { team: 'red', correct: false, now: 1200 });
    assert.equal(stillTied.state.position, 0);
    assert.equal(stillTied.state.winner, null, 'a miss does not end sudden death');

    const already = PS.resolveTugAtTimeUp({ phase: 'done', winner: 'red', redPull: 9 }, 1000);
    assert.equal(already.winner, 'red');
});

test('applyTugResult eliminates the losing team and advances the winning team', () => {
    const players = [
        { user_id: 'r1', tug_team: 'red', status: 'advanced', ghost: false },
        { user_id: 'r2', tug_team: 'red', status: 'advanced', ghost: false },
        { user_id: 'b1', tug_team: 'blue', status: 'advanced', ghost: false },
        { user_id: 'none', status: 'advanced', ghost: false }
    ];
    PS.applyTugResult(players, 'blue');
    assert.equal(players[0].status, 'eliminated');
    assert.equal(players[0].ghost, true);
    assert.equal(players[0].eliminated_reason, 'tug');
    assert.equal(players[1].ghost, true);
    assert.equal(players[2].status, 'advanced');
    assert.equal(players[2].ghost, false);
    assert.equal(players[2].advanced_round3, true);
    assert.equal(players[3].status, 'advanced', 'players without a team are unchanged');
    assert.equal('advanced_round3' in players[3], false);
});

test('three-round host settings keep per-round subjects and persist tugDuration', () => {
    const result = PS.validateHostSettings({
        roundCount: 3,
        finishDistance: 150,
        glassSteps: 6,
        tugDuration: 45,
        rounds: [
            { round: 1, subject: 'vocab', vocabSource: 'Food', vocabForm: 'F4' },
            { round: 2, subject: 'grammar', topic: 'agreement', bankMode: 'choose' },
            { round: 3, subject: 'grammar', topic: 'articles', bankMode: 'mixed', tugDuration: 45 }
        ]
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.roundCount, 3);
    assert.equal(result.rounds.length, 3);
    assert.equal(result.rounds[0].subject, 'vocab');
    assert.equal(result.rounds[1].subject, 'grammar');
    assert.equal(result.rounds[1].topic, 'agreement');
    assert.equal(result.rounds[2].subject, 'grammar');
    assert.equal(result.rounds[2].topic, 'articles');
    assert.equal(result.rounds[2].tugDuration, 45000);
    assert.equal(result.settings.tugDuration, 45000);
    assert.equal(result.tugDuration, 45000);
    assert.equal(result.settings.rounds.length, 3);

    const cfg = PS.roundConfig(result.settings, 3);
    assert.equal(cfg.kind, 'tug');
    assert.equal(cfg.subject, 'grammar');
    assert.equal(cfg.topic, 'articles');
    assert.equal(cfg.tugDuration, 45000);

    assert.equal(PS.validateHostSettings({
        roundCount: 3,
        rounds: [
            { round: 1, subject: 'vocab', vocabSource: 'Food' },
            { round: 2, subject: 'vocab', vocabSource: 'Food' },
            { round: 3, subject: 'vocab', vocabSource: 'Food', grammarTopic: 'tenses' }
        ]
    }).error, 'ONE_SUBJECT_ONLY');
});

test('one- and two-round classes never enter the tug', () => {
    assert.equal(PS.shouldPlayRound3({ roundCount: 1 }), false);
    assert.equal(PS.shouldPlayRound3({ roundCount: 2 }), false);
    assert.equal(PS.round2EndAction({ roundCount: 1 }), 'finish');
    assert.equal(PS.round2EndAction({ roundCount: 2 }), 'finish');
    assert.equal(PS.shouldPlayRound3({}), false, 'legacy rooms default to 2 rounds');
});

/* ---------------------------------------------------------------- */
/* Round 3 — wiring / SQL / renderer / demo                          */
/* ---------------------------------------------------------------- */

test('incremental tug SQL exists with teacher instructions and new functions', () => {
    const file = path.join(__dirname, '..', 'supabase', 'purrfect_survival_tug.sql');
    assert.ok(fs.existsSync(file), 'incremental SQL file exists');
    const sql = fs.readFileSync(file, 'utf8');
    assert.ok(sql.indexOf('https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new') !== -1, 'live project URL');
    assert.ok(/Do NOT re-run older incrementals/i.test(sql), 'tells the teacher not to re-run older files');
    assert.ok(/Safe to re-run/i.test(sql), 'safe to re-run');
    assert.ok(/plugin, CLI or agent/i.test(sql), 'never run via a plugin');
    assert.ok(sql.indexOf('purrfect_survival_host_settings.sql') !== -1, 'says to run after PR #51');
    ['purrfect_survival_round_count', 'purrfect_survival_tug_duration',
        'purrfect_survival_empty_tug', 'purrfect_survival_apply_tug',
        'purrfect_survival_finish_if_done', 'start_purrfect_survival_round3',
        'create_purrfect_survival', 'start_purrfect_survival',
        'tick_purrfect_survival', 'submit_purrfect_survival_answer',
        'glass_jump_purrfect_survival'].forEach(fn => {
        assert.ok(sql.indexOf(fn) !== -1, fn + ' exists');
    });
    assert.ok(sql.indexOf("'round3'") !== -1, 'round3 status is allowed');
    assert.ok(sql.indexOf('glass_finished_at') !== -1, 'glass finish timestamp exists');
    assert.ok(sql.indexOf('tug_team') !== -1, 'tug teams exist');
    assert.ok(sql.indexOf("notify pgrst, 'reload schema';") !== -1);
    assert.ok(sql.indexOf('ROUNDS_NOT_IMPLEMENTED') !== -1);
});

test('canonical SQL is consistent with the three-round reality', () => {
    const canonical = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    assert.ok(canonical.indexOf("'round3'") !== -1, 'canonical status includes round3');
    assert.ok(canonical.indexOf('least(3, greatest(1') !== -1, 'round_count clamps to 3');
    ['purrfect_survival_tug_duration', 'purrfect_survival_empty_tug',
        'purrfect_survival_apply_tug', 'start_purrfect_survival_round3',
        'tug_questions', 'glass_finished_at', 'tug_team'].forEach(token => {
        assert.ok(canonical.indexOf(token) !== -1, token + ' exists in canonical SQL');
    });
    assert.ok(canonical.indexOf('ROUNDS_NOT_IMPLEMENTED') !== -1, 'canonical rejects rounds 4–5');
});

test('renderer exports drawRound3 and paints it without throwing', () => {
    assert.equal(typeof RENDERER.drawRound3, 'function');
    assert.match(RENDERER.VERSION, /^2\./);

    const sizes = [[390, 844, 'player'], [1024, 768, 'host'], [844, 390, 'player']];
    const players = samplePlayers().map((p, i) => Object.assign({}, p, {
        status: 'advanced',
        ghost: false,
        crossed_glass: true,
        tug_team: i % 2 ? 'blue' : 'red'
    }));
    sizes.forEach(size => {
        const canvas = { width: size[0] * 2, height: size[1] * 2 };
        const ctx = mockContext(canvas);
        [['briefing', 0, null], ['playing', 5, null], ['done', 0, 'blue']].forEach(triple => {
            const state = {
                w: size[0], h: size[1], role: size[2], round: 3,
                now: 12000, meId: 'u1', myTeam: 'red',
                players: players,
                tug: {
                    position: triple[2] ? 12 : -triple[1],
                    redPull: triple[1],
                    bluePull: 5,
                    redCombo: 3,
                    blueCombo: 1,
                    redRage: true,
                    blueRage: false,
                    winner: triple[2],
                    phase: triple[0],
                    suddenDeath: false
                }
            };
            assert.doesNotThrow(() => RENDERER.drawRound3(ctx, state), 'round 3 ' + triple[0] + ' paints');
            assert.doesNotThrow(() => RENDERER.drawScene(ctx, state), 'drawScene dispatches round 3');
        });
    });

    const src = fs.readFileSync(RENDER_PATH, 'utf8');
    assert.equal(/drawImage/.test(src), false, 'renderer still never blits bitmaps');
    ['round3-tug-side-ref', 'round3-tug-overview-ref'].forEach(name =>
        assert.equal(src.indexOf(name), -1, name + ' is not referenced'));
});

test('main module wires the round-3 status, tug start and duration', () => {
    const src = fs.readFileSync(MAIN_PATH, 'utf8');
    ['start_purrfect_survival_round3', 'round3_started_at', 'round3_ends_at',
        'tug_state', 'tug_questions', 'ps-tug-start-btn', 'ps-tug-duration',
        'startRound3Now', 'tugAnswer', 'demoJumpRound3', 'demoStartTug'].forEach(token => {
        assert.ok(src.indexOf(token) !== -1, token + ' is wired');
    });
    assert.ok(src.indexOf("room.status === 'round3'") !== -1, 'round3 is handled in render/frame');
    assert.ok(src.indexOf('shouldSkipTug') !== -1 || src.indexOf('splitTugTeams') !== -1, 'engine tug helpers are used');
});

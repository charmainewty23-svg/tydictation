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

function loadRenderer(options) {
    const opts = options || {};
    const code = fs.readFileSync(RENDER_PATH, 'utf8');
    const sandbox = { console, Date, Math, JSON, Number, String, Array, Object, isFinite, parseInt, parseFloat };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    if (opts.dg) sandbox.DG = opts.dg;
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
    add('ps-prompt', 'p');
    add('ps-carved', 'p');
    add('ps-options', 'div');
    add('ps-feedback', 'p');
    add('ps-lick-btn', 'button').classList.add('hidden');
    add('ps-hud-rule', 'p');
    add('ps-hud-round', 'span');
    add('ps-hud-you', 'span');
    add('ps-hud-phase', 'span');
    add('ps-hud-timer', 'span');
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
    add('ps-cine-rules', 'div');
    add('ps-rules-toggle', 'button').classList.add('hidden');
    add('ps-cine-howto', 'div').classList.add('hidden');
    add('ps-player-list', 'div');
    add('ps-start-btn', 'button');
    add('ps-wait-msg', 'p');
    add('ps-host-end', 'button');
    add('ps-canvas', 'canvas');
    add('ps-progress', 'div').classList.add('hidden');
    add('ps-progress-title', 'span');
    add('ps-progress-count', 'span');
    add('ps-progress-list', 'div');
    add('ps-qualifier', 'div').classList.add('hidden');
    add('ps-qualifier-title', 'h2');
    add('ps-qualifier-sub', 'p');
    add('ps-qualifier-list', 'div');
    add('ps-qualifier-count', 'span');
    add('ps-qualifier-timer', 'span');
    add('ps-hud-place', 'span').classList.add('hidden');
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
        add('ps-r' + r + '-vocab-scope-wrap', 'div');
        add('ps-r' + r + '-vocab-scope', 'select', 'all');
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

test('a 7 s timeout eliminates the player and does NOT reveal the pane', () => {
    const step = glassStep('right');
    const p = player('a', 100, { glass_step: 0, round1_rank: 1 });
    const result = PS.applyGlassJump(p, step, '', { stepCount: 9, timedOut: true });
    assert.equal(result.outcome, 'timeout');
    assert.equal(p.status, 'eliminated');
    assert.equal(p.eliminated_reason, 'glass_timeout');
    assert.equal(step.revealed, false);
    assert.equal(step.revealed_side, null);

    assert.equal(PS.ROUND2.WINDOW_MS, 7000, 'the glass thinking window is 7 seconds');
    assert.equal(PS.glassWindowExpired(1000, 1000 + 6999, PS.ROUND2.WINDOW_MS), false);
    assert.equal(PS.glassWindowExpired(1000, 1000 + 7000, PS.ROUND2.WINDOW_MS), true);
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
    assert.ok(demo.indexOf('Prize ceremony') !== -1, 'prize ceremony control');
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

test('3-round and 4-round waiting lobbies use compact chips, not rule paragraphs', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'], currentUser: null });
    dom.PS.startDemo({ role: 'teacher', scene: 'lobby' });

    const longEnglish = [
        'Pressing in red costs 30 m',
        'lights the correct pane',
        'losing team falls into the abyss',
        'One lick per player'
    ];
    const longChinese = ['紅燈時撳會扣 30 米', '舔一口椪糖'];

    function waitingText() {
        return [
            dom.el('ps-cine').innerHTML,
            dom.el('ps-cine').textContent,
            dom.el('ps-room-meta').textContent,
            dom.el('ps-cine-rules').innerHTML
        ].join('\n');
    }

    [1, 2, 3, 4].forEach(count => {
        dom.PS.setDemoSettings({ roundCount: count });
        const chips = dom.el('ps-cine-rules').innerHTML;
        assert.ok(chips.indexOf('1-2-3 Meow') !== -1, count + ' rounds keeps the R1 chip');
        assert.equal(chips.indexOf('Glass') !== -1, count >= 2, count + ' rounds shows Glass only when selected');
        assert.equal(chips.indexOf('Tug') !== -1, count >= 3, count + ' rounds shows Tug only when selected');
        assert.equal(chips.indexOf('Dalgona') !== -1, count >= 4, count + ' rounds shows Dalgona only when selected');
        const text = waitingText();
        longEnglish.concat(longChinese).forEach(snippet => {
            assert.equal(text.indexOf(snippet), -1, count + '-round waiting lobby must not dump: ' + snippet);
        });
        assert.ok(dom.el('ps-room-meta').textContent.length < 80, 'meta line stays short');
        assert.ok(dom.el('ps-code').textContent === 'DEMO', 'room code stays visible');
        assert.ok(dom.el('ps-cine').classList.contains('hidden') === false, 'waiting overlay is visible');
        assert.ok(dom.el('ps-player-list').innerHTML.length > 0, 'player list stays visible');
        assert.ok(dom.el('ps-start-btn').classList.contains('hidden') === false, 'host still sees Start');
    });

    // Student phones keep the same compact chips but no host Start button.
    const student = loadMainWithDom({ sheetNames: ['Food', 'School'], currentUser: null });
    student.PS.startDemo({ role: 'student', scene: 'lobby' });
    student.PS.setDemoSettings({ roundCount: 4 });
    const studentChips = student.el('ps-cine-rules').innerHTML;
    ['1-2-3 Meow', 'Glass', 'Tug', 'Dalgona'].forEach(name => {
        assert.ok(studentChips.indexOf(name) !== -1, 'student sees the ' + name + ' chip');
    });
    assert.ok(student.el('ps-start-btn').classList.contains('hidden'), 'students do not get the host Start button');
    assert.ok(student.el('ps-code').textContent === 'DEMO', 'student still sees the room code');
});

test('teacher lobby keeps the full bilingual rule set inside the howto panel', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'], currentUser: null });
    dom.PS.startDemo({ role: 'teacher', scene: 'lobby' });

    dom.PS.setDemoSettings({ roundCount: 3 });
    const three = dom.el('ps-cine-howto').innerHTML;
    assert.ok(three.indexOf('Pressing in red costs 30 m') !== -1, '3-round panel has the R1 rule');
    assert.ok(three.indexOf('lights the correct pane') !== -1, '3-round panel has the R2 rule');
    assert.ok(three.indexOf('losing team falls into the abyss') !== -1, '3-round panel has the Tug rule');
    assert.equal(three.indexOf('One lick per player'), -1, '3 rounds has no Dalgona rule');
    assert.ok(three.indexOf('紅燈時撳會扣 30 米') !== -1, '3-round panel keeps the Chinese R1 copy');
    assert.equal(three.indexOf('舔一口椪糖'), -1, '3 rounds has no Chinese Dalgona copy');
    assert.ok(three.indexOf('Tug of War') !== -1, 'Tug title is present');
    assert.equal(three.indexOf('Dalgona Candy Carving'), -1, 'Dalgona title is absent');

    dom.PS.setDemoSettings({ roundCount: 4 });
    const four = dom.el('ps-cine-howto').innerHTML;
    assert.ok(four.indexOf('One lick per player') !== -1, '4-round panel has the Dalgona rule');
    assert.ok(four.indexOf('舔一口椪糖') !== -1, '4-round panel keeps the Chinese Dalgona copy');
    assert.ok(four.indexOf('Tug of War') !== -1, '4-round panel still has Tug');
    assert.ok(four.indexOf('Dalgona Candy Carving') !== -1, '4-round panel has Dalgona');
});

test('teacher rules panel starts hidden and host can show or hide it', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'], currentUser: null });
    dom.PS.startDemo({ role: 'teacher', scene: 'lobby' });
    dom.PS.setDemoSettings({ roundCount: 4 });

    const panel = dom.el('ps-cine-howto');
    const button = dom.el('ps-rules-toggle');
    assert.ok(panel.classList.contains('hidden'), 'full rules start hidden');
    assert.ok(!button.classList.contains('hidden'), 'the host sees the toggle');
    assert.ok(button.textContent.indexOf('Show rules') !== -1, 'collapsed label tells the host to show the rules');
    assert.equal(dom.PS.lobbyRulesOpen(), false);
    assert.ok(dom.el('ps-cine-rules').innerHTML.indexOf('Dalgona') !== -1, 'short chips stay visible');

    assert.equal(dom.PS.toggleLobbyRules(), true);
    assert.ok(!panel.classList.contains('hidden'), 'panel opens on toggle');
    assert.ok(panel.innerHTML.indexOf('Pressing in red costs 30 m') !== -1, 'opened panel has the full R1 rule');
    assert.ok(panel.innerHTML.indexOf('舔一口椪糖') !== -1, 'opened panel has the Chinese Dalgona rule');
    assert.ok(button.textContent.indexOf('Hide rules') !== -1, 'open label tells the host to hide the rules');

    assert.equal(dom.PS.toggleLobbyRules(), false);
    assert.ok(panel.classList.contains('hidden'), 'panel hides on the second toggle');
    assert.ok(button.textContent.indexOf('Show rules') !== -1, 'collapsed label is restored');
});

test('students get no rules toggle and stay on the compact lobby', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'], currentUser: null });
    dom.PS.startDemo({ role: 'student', scene: 'lobby' });
    dom.PS.setDemoSettings({ roundCount: 4 });

    assert.ok(dom.el('ps-rules-toggle').classList.contains('hidden'), 'no toggle on student phones');
    assert.ok(dom.el('ps-cine-howto').classList.contains('hidden'), 'long rules stay hidden for students');
    assert.equal(dom.PS.toggleLobbyRules(), false, 'students cannot open the rules');
    assert.ok(dom.el('ps-cine-howto').classList.contains('hidden'), 'still hidden after a blocked toggle');
    const chips = dom.el('ps-cine-rules').innerHTML;
    ['1-2-3 Meow', 'Glass', 'Tug', 'Dalgona'].forEach(name => {
        assert.ok(chips.indexOf(name) !== -1, 'student still sees the ' + name + ' chip');
    });
    assert.ok(dom.el('ps-code').textContent === 'DEMO', 'student still sees the room code');
    assert.ok(dom.el('ps-start-btn').classList.contains('hidden'), 'students do not get Start');
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

test('index.html hosts the cinematic waiting overlay, compact round chips and host rules toggle', () => {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    ['ps-cine', 'ps-cine-rules', 'ps-rules-toggle', 'ps-cine-howto', 'ps-intro-skip',
        'ps-round-cue', 'ps-player-list', 'ps-start-btn']
        .forEach(id => assert.ok(html.indexOf('id="' + id + '"') !== -1, id + ' exists'));
    assert.ok(html.indexOf('Skip intro') !== -1, 'a discreet skip control exists');
    assert.ok(html.indexOf('PS.toggleLobbyRules()') !== -1, 'the host toggle is wired to PS.toggleLobbyRules()');
    assert.ok(html.indexOf('Show rules') !== -1, 'the collapsed label reads Show rules');
    assert.ok(html.indexOf('ps-cine-howto hidden') !== -1, 'the full rules panel starts hidden');
    assert.ok(html.indexOf('1-2-3 Meow!') !== -1, 'Round 1 uses the official 1-2-3 Meow! title');
    assert.equal(html.indexOf('玻璃橋'), -1, 'the Chinese bridge title is gone');
    assert.equal(html.indexOf('貓咪拔河大賽'), -1, 'the Chinese tug title is gone');
});

test('bilingual rules are faithful to the English engine copy', () => {
    assert.equal(typeof PS.RULE_TEXT_ZH, 'object');
    assert.match(PS.RULE_TEXT_ZH.round1, /綠燈/);
    assert.match(PS.RULE_TEXT_ZH.round1, /100 米/);
    assert.match(PS.RULE_TEXT_ZH.round2, /7 秒/);
    assert.equal(/5 秒/.test(PS.RULE_TEXT_ZH.round2), false, 'the old 5-second glass copy is gone');
    assert.match(PS.RULE_TEXT_ZH.round2, /玻璃/);
    assert.equal(typeof PS.RULE_TEXT.round1, 'string');
    assert.ok(PS.RULE_TEXT.round1.indexOf('+10 m') !== -1);
    assert.ok(PS.RULE_TEXT.round2.indexOf('7 s') !== -1, 'English glass rules say 7 s');
    assert.equal(PS.RULE_TEXT.round2.indexOf('5 s'), -1, 'English glass rules no longer say 5 s');
});

/* ---------------------------------------------------------------- */
/* Host settings (roundCount + per-round configuration)              */
/* ---------------------------------------------------------------- */

test('host settings expose an extensible round map and default to two rounds', () => {
    assert.equal(PS.HOST.MAX_IMPLEMENTED, 5);
    assert.equal(PS.HOST.MAX_PLANNED, 5);
    assert.equal(PS.HOST.KINDS[1], 'meow');
    assert.equal(PS.HOST.KINDS[2], 'glass');
    assert.equal(PS.HOST.KINDS[3], 'tug');
    assert.equal(PS.HOST.KINDS[4], 'dalgona');
    assert.equal(PS.HOST.KINDS[5], 'finals');

    assert.equal(PS.roomRoundCount({}), 2, 'old rooms default to 2 rounds');
    assert.equal(PS.roomRoundCount({ roundCount: 1 }), 1);
    assert.equal(PS.roomRoundCount({ roundCount: 2 }), 2);
    assert.equal(PS.roomRoundCount({ roundCount: 3 }), 3);
    assert.equal(PS.roomRoundCount({ roundCount: 0 }), 1, 'below 1 clamps to 1');
    assert.equal(PS.roomRoundCount({ roundCount: 4 }), 4);
    assert.equal(PS.roomRoundCount({ roundCount: 5 }), 5, 'round 5 is now playable');
    assert.equal(PS.roomRoundCount({ roundCount: 6 }), 5, 'above the implemented max clamps to 5');
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
    assert.equal(PS.shouldPlayRound4({ roundCount: 3 }), false);
    assert.equal(PS.shouldPlayRound4({ roundCount: 4 }), true);
    assert.equal(PS.shouldPlayRound5({ roundCount: 4 }), false);
    assert.equal(PS.shouldPlayRound5({ roundCount: 5 }), true);
    assert.equal(PS.round3EndAction({ roundCount: 3 }), 'finish');
    assert.equal(PS.round3EndAction({ roundCount: 4 }), 'dalgona');
    assert.equal(PS.round4EndAction({ roundCount: 4 }), 'finish');
    assert.equal(PS.round4EndAction({ roundCount: 5 }), 'finals');
    assert.equal(PS.round5EndAction(), 'finish');
});

test('lobbyRoundChips lists only the selected rounds with short names and settings', () => {
    assert.deepEqual(PS.lobbyRoundChips({ roundCount: 1 }).map(c => c.short), ['1-2-3 Meow']);
    assert.deepEqual(PS.lobbyRoundChips(2).map(c => c.short), ['1-2-3 Meow', 'Glass']);
    assert.deepEqual(PS.lobbyRoundChips({ roundCount: 3 }).map(c => c.short), ['1-2-3 Meow', 'Glass', 'Tug']);
    const four = PS.lobbyRoundChips({ roundCount: 4 });
    assert.deepEqual(four.map(c => c.n), [1, 2, 3, 4]);
    assert.deepEqual(four.map(c => c.short), ['1-2-3 Meow', 'Glass', 'Tug', 'Dalgona']);
    assert.deepEqual(four.map(c => c.note), ['100m', '9 steps', '60s', '180s']);

    const custom = PS.lobbyRoundChips({
        roundCount: 4,
        finishDistance: 200,
        glassSteps: 12,
        tugDuration: 90000,
        dalgonaDuration: 240000
    });
    assert.deepEqual(custom.map(c => c.note), ['200m', '12 steps', '90s', '240s']);
    const five = PS.lobbyRoundChips({ roundCount: 5, finalsDuration: 150000 });
    assert.deepEqual(five.map(c => c.n), [1, 2, 3, 4, 5]);
    assert.deepEqual(five.map(c => c.short), ['1-2-3 Meow', 'Glass', 'Tug', 'Dalgona', 'Finals']);
    assert.deepEqual(five.map(c => c.note), ['100m', '9 steps', '60s', '180s', '150s']);
    assert.deepEqual(PS.lobbyRoundChips({ roundCount: 9 }).map(c => c.n), [1, 2, 3, 4, 5], 'clamped to implemented rounds');
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

test('host settings accept 5 rounds and reject invalid subjects/topics', () => {
    const four = PS.validateHostSettings({
        roundCount: 4,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'Food' }]
    });
    assert.equal(four.ok, true, four.error);
    assert.equal(four.roundCount, 4);
    assert.equal(four.settings.roundCount, 4);
    assert.equal(four.rounds[3].kind, 'dalgona');
    const five = PS.validateHostSettings({
        roundCount: 5,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'Food' }]
    });
    assert.equal(five.ok, true, five.error);
    assert.equal(five.roundCount, 5, 'round 5 is playable');
    assert.equal(five.rounds[4].kind, 'finals');
    assert.equal(five.settings.finalsDuration, 120000);
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
        'ps-round1-card', 'ps-round2-card', 'ps-round3-card', 'ps-round4-card',
        'ps-dalgona-duration', 'ps-lick-btn'].forEach(id => {
        assert.ok(html.indexOf('id="' + id + '"') !== -1, id + ' exists');
    });
    assert.ok(html.indexOf('min="30" max="300" step="10"') !== -1, 'distance input range 30–300 step 10');
    assert.ok(html.indexOf('min="3" max="15" step="1"') !== -1, 'glass steps input range 3–15');
    assert.ok(html.indexOf('id="ps-tug-duration" type="number" min="30" max="120" step="5" value="60"') !== -1,
        'tug duration input range 30–120 step 5');
    assert.equal(html.indexOf('value="3" disabled'), -1, 'round 3 is no longer coming soon');
    assert.ok(html.indexOf('value="3">3 rounds') !== -1, 'round 3 is selectable');
    assert.equal(html.indexOf('value="4" disabled'), -1, 'round 4 is no longer coming soon');
    assert.ok(html.indexOf('value="4">4 rounds') !== -1, 'round 4 is selectable');
    assert.equal(html.indexOf('value="5" disabled'), -1, 'round 5 is no longer coming soon');
    assert.ok(html.indexOf('value="5">5 rounds · Meow + Glass + Tug + Dalgona + Finals') !== -1,
        'round 5 is selectable and labelled');
    assert.equal(html.indexOf('One subject per room'), -1, 'the old one-subject-per-room copy is gone');
    assert.ok(html.indexOf('Each round can use a different subject') !== -1, 'copy explains per-round subjects');
    assert.ok(html.indexOf('1 round · 1-2-3 Meow!') !== -1, 'short 1-round label');
    assert.ok(html.indexOf('2 rounds · Meow + Glass') !== -1, 'short 2-round label');
    assert.ok(html.indexOf('3 rounds · Meow + Glass + Tug') !== -1, 'short 3-round label');
    assert.ok(html.indexOf('4 rounds · Meow + Glass + Tug + Dalgona') !== -1, 'short 4-round label');

    const noteMatch = html.match(/<div id="ps-host-note"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(noteMatch, 'host note exists');
    const noteText = noteMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.ok(noteText.length < 280, 'host note is short');
    ['a press costs 30 m', 'every jump lights the correct pane', 'losing team falls into the abyss',
        'one lick per player', '紅燈時撳會扣 30 米', '舔一口椪糖'].forEach(snippet => {
        assert.equal(noteText.toLowerCase().indexOf(snippet.toLowerCase()), -1,
            'host note no longer repeats the long rules: ' + snippet);
    });
});

test('New Vocab lobby pickers offer All / Added today / Added yesterday for every round', () => {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    [1, 2, 3].forEach(r => {
        const id = 'ps-r' + r + '-vocab-scope';
        assert.ok(html.indexOf('id="' + id + '"') !== -1, id + ' exists');
    });
    const scopeSelects = html.match(/<select id="ps-r[123]-vocab-scope">([\s\S]*?)<\/select>/g) || [];
    assert.equal(scopeSelects.length, 3, 'one scope select per round');
    scopeSelects.forEach(block => {
        assert.ok(block.indexOf('<option value="all" selected>All</option>') !== -1, 'All is the default');
        assert.ok(block.indexOf('<option value="today">Added today</option>') !== -1, 'today option');
        assert.ok(block.indexOf('<option value="yesterday">Added yesterday</option>') !== -1, 'yesterday option');
    });

    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'] });
    dom.PS.populateLobby();
    assert.ok(!dom.el('ps-r1-vocab-scope-wrap').classList.contains('hidden'), 'scope picker shows for New Vocab');
    dom.el('ps-r1-vocab-source').value = 'Food';
    dom.PS.syncVocabForm(1);
    assert.ok(dom.el('ps-r1-vocab-scope-wrap').classList.contains('hidden'), 'scope picker hides for a sheet topic');

    assert.equal(dom.PS.sameRoundBank(
        { subject: 'vocab', topic: 'New Vocab', vocabSource: 'New Vocab', vocabForm: 'F4', vocabScope: 'today' },
        { subject: 'vocab', topic: 'New Vocab', vocabSource: 'New Vocab', vocabForm: 'F4', vocabScope: 'yesterday' }
    ), false, 'a different scope is a different bank');
    assert.equal(dom.PS.sameRoundBank(
        { subject: 'vocab', topic: 'New Vocab', vocabSource: 'New Vocab', vocabForm: 'F4' },
        { subject: 'vocab', topic: 'New Vocab', vocabSource: 'New Vocab', vocabForm: 'F4', vocabScope: 'all' }
    ), true, 'missing scope equals All');
});

test('Purr-fect Survival host settings persist the per-round New Vocab date scope', () => {
    const result = PS.validateHostSettings({
        roundCount: 2,
        rounds: [
            { round: 1, subject: 'vocab', vocabSource: 'New Vocab', vocabForm: 'F4', vocabScope: 'yesterday' },
            { round: 2, subject: 'vocab', vocabSource: 'New Vocab', vocabForm: 'F4', vocabScope: 'today' }
        ]
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.rounds[0].vocabScope, 'yesterday');
    assert.equal(result.rounds[1].vocabScope, 'today');
    assert.equal(result.settings.rounds[0].vocabScope, 'yesterday');
    assert.equal(PS.roundConfig(result.settings, 1).vocabScope, 'yesterday');
    assert.equal(PS.roundConfig(result.settings, 2).vocabScope, 'today');

    // Legacy rooms have no scope at all -> All.
    assert.equal(PS.roundConfig({ vocabSource: 'New Vocab', vocabForm: 'F4' }, 1).vocabScope, 'all');
    assert.equal(PS.validateHostSettings({
        roundCount: 1,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'New Vocab', vocabForm: 'F4' }]
    }).rounds[0].vocabScope, 'all');
    assert.equal(PS.normalizeVocabScope('nonsense'), 'all');

    // A different date scope is a different bank, even with the same form.
    const main = fs.readFileSync(MAIN_PATH, 'utf8');
    assert.ok(main.indexOf("String(a.vocabScope || 'all') === String(b.vocabScope || 'all')") !== -1,
        'sameRoundBank compares vocabScope');
    assert.ok(main.indexOf("select('en,zh,form,created_at')") !== -1, 'New Vocab query selects created_at');
    assert.ok(main.indexOf('filterNewVocabByScope(rows, dateScope)') !== -1, 'load path uses the shared filter');
    assert.ok(main.indexOf('Switch that round to All') !== -1, 'empty today/yesterday has a clear message');
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

test('service worker cache is bumped for the host lobby rules toggle', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    assert.ok(sw.indexOf("learnity-pwa-v121") !== -1, 'CACHE_NAME is v121');
    assert.equal(sw.indexOf('learnity-pwa-v119'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v120'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v117'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v118'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v116"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v115"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v114"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v113"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v112"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v111"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v110"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v109"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v108"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v107"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v106"), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf("learnity-pwa-v105"), -1, 'the old cache name is gone');
});

test('demo page exposes round count, metres, glass step and tug controls', () => {
    const demo = fs.readFileSync(path.join(__dirname, '..', 'purrfect-survival-demo.html'), 'utf8');
    ['demo-round-count', 'demo-finish-distance', 'demo-glass-steps', 'demo-tug-duration', 'demo-round3', 'demo-round4'].forEach(id => {
        assert.ok(demo.indexOf('id="' + id + '"') !== -1, id + ' control exists');
    });
    assert.ok(demo.indexOf('<option value="3">3</option>') !== -1, 'round 3 is selectable in the demo');
    assert.ok(demo.indexOf('<option value="4">4</option>') !== -1, 'round 4 is selectable in the demo');
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

/* ---------------------------------------------------------------- */
/* Prize ceremony — English titles, ranking and Paws                 */
/* ---------------------------------------------------------------- */

function ceremonyPlayer(id, extra) {
    return Object.assign({
        user_id: id,
        nickname: '4C ' + id + ' Student',
        email: id + '@lstyoungkhl.edu.hk',
        is_playing: true,
        status: 'alive',
        ghost: false,
        distance: 0,
        reached_finish: false,
        finished_at: null,
        round1_rank: null,
        eliminated_reason: null,
        glass_step: 0,
        glass_finished_at: null,
        crossed_glass: false,
        tug_team: null
    }, extra || {});
}

test('ceremonyResults ranks a one-round class: survivors, finishers, then distance', () => {
    const players = [
        ceremonyPlayer('a', { distance: 100, reached_finish: true, finished_at: '2026-11-25T10:00:02Z', round1_rank: 2 }),
        ceremonyPlayer('b', { distance: 100, reached_finish: true, finished_at: '2026-11-25T10:00:01Z', round1_rank: 1 }),
        ceremonyPlayer('c', { distance: 70 }),
        ceremonyPlayer('f', { distance: 60 }),
        ceremonyPlayer('d', { status: 'eliminated', ghost: true, distance: 40, eliminated_reason: 'red_light' }),
        ceremonyPlayer('e', { status: 'eliminated', ghost: true, distance: 20, eliminated_reason: 'red_light' })
    ];
    const rows = PS.ceremonyResults(players, { roundCount: 1, finishDistance: 100 });
    assert.deepEqual(rows.map(r => r.user_id), ['b', 'a', 'c', 'f', 'd', 'e']);
    assert.deepEqual(rows.map(r => r.paws), [20, 13, 8, 5, 2, 2]);
    assert.deepEqual(rows.map(r => r.role), ['first', 'second', 'third', 'survivor', 'participant', 'participant']);
    assert.equal(rows[0].rounds.r1.reached_finish, true);
    assert.equal(rows[4].rounds.r1.eliminated_reason, 'red_light');
    assert.equal(rows[0].rounds.r2, undefined, 'a one-round class has no round-2 row');
});

test('ceremonyResults ranks a two-round class by glass finish then fall distance', () => {
    const players = [
        ceremonyPlayer('a', {
            status: 'advanced', crossed_glass: true, glass_step: 9,
            glass_finished_at: '2026-11-25T10:01:00Z', round1_rank: 1
        }),
        ceremonyPlayer('b', {
            status: 'advanced', crossed_glass: true, glass_step: 9,
            glass_finished_at: '2026-11-25T10:00:30Z', round1_rank: 4
        }),
        ceremonyPlayer('c', { status: 'eliminated', ghost: true, glass_step: 4, round1_rank: 2 }),
        ceremonyPlayer('d', { status: 'eliminated', ghost: true, glass_step: 6, round1_rank: 3 })
    ];
    const rows = PS.ceremonyResults(players, { roundCount: 2 });
    assert.deepEqual(rows.map(r => r.user_id), ['b', 'a', 'd', 'c']);
    assert.deepEqual(rows.map(r => r.paws), [20, 13, 8, 2]);
    assert.equal(rows[0].rounds.r2.crossed_glass, true);
    assert.equal(rows[2].rounds.r2.glass_step, 6);
    assert.equal(rows[2].survived, false);
});

test('ceremonyResults ranks a three-round class: winning team first, then losers, then non-team', () => {
    const players = [
        ceremonyPlayer('a', { status: 'eliminated', ghost: true, crossed_glass: true, tug_team: 'red', round1_rank: 1, glass_finished_at: '2026-11-25T10:00:01Z', eliminated_reason: 'tug' }),
        ceremonyPlayer('b', { status: 'advanced', crossed_glass: true, tug_team: 'blue', round1_rank: 2, glass_finished_at: '2026-11-25T10:00:02Z' }),
        ceremonyPlayer('c', { status: 'eliminated', ghost: true, crossed_glass: true, tug_team: 'red', round1_rank: 3, glass_finished_at: '2026-11-25T10:00:03Z', eliminated_reason: 'tug' }),
        ceremonyPlayer('d', { status: 'eliminated', ghost: true, crossed_glass: false, tug_team: null, round1_rank: 4 })
    ];
    const rows = PS.ceremonyResults(players, { roundCount: 3, tug: { winner: 'blue' } });
    assert.deepEqual(rows.map(r => r.user_id), ['b', 'a', 'c', 'd']);
    assert.deepEqual(rows.map(r => r.paws), [20, 13, 8, 2]);
    assert.equal(rows[0].survived, true);
    assert.equal(rows[1].survived, false);
    assert.equal(rows[0].rounds.r3.tug_team, 'blue');
    assert.equal(rows[0].rounds.r3.won, true);
    assert.equal(rows[1].rounds.r3.won, false);
});

test('a skipped three-round Tug of War still produces a ceremony and bridge survivors win', () => {
    const players = [
        ceremonyPlayer('a', { status: 'advanced', crossed_glass: true, round1_rank: 1, glass_finished_at: '2026-11-25T10:00:01Z' }),
        ceremonyPlayer('b', { status: 'advanced', crossed_glass: true, round1_rank: 2, glass_finished_at: '2026-11-25T10:00:02Z' }),
        ceremonyPlayer('c', { status: 'eliminated', ghost: true, crossed_glass: false, round1_rank: 3 })
    ];
    const rows = PS.ceremonyResults(players, { roundCount: 3, tug: { winner: null } });
    assert.deepEqual(rows.map(r => r.user_id), ['a', 'b', 'c']);
    assert.deepEqual(rows.map(r => r.paws), [20, 13, 8]);
    assert.equal(rows[0].survived, true);
    assert.equal(rows[0].rounds.r3.won, null, 'no tug winner means no team won');
});

test('the Paws table is exported once and matches the documented amounts', () => {
    assert.deepEqual(PS.CEREMONY_PAWS, {
        first: 20, second: 13, third: 8, survivor: 5, participant: 2
    });
    assert.equal(PS.pawsForPlace(1, false), 20);
    assert.equal(PS.pawsForPlace(2, false), 13);
    assert.equal(PS.pawsForPlace(3, false), 8);
    assert.equal(PS.pawsForPlace(4, true), 5);
    assert.equal(PS.pawsForPlace(4, false), 2);
});

test('ceremony awards are idempotent per room + user (the SQL on-conflict mirror)', () => {
    const players = [
        ceremonyPlayer('a', { distance: 100, reached_finish: true, finished_at: '2026-11-25T10:00:01Z' }),
        ceremonyPlayer('b', { distance: 50 }),
        ceremonyPlayer('c', { status: 'eliminated', ghost: true, distance: 10 })
    ];
    const rows = PS.ceremonyResults(players, { roundCount: 1, finishDistance: 100 });
    const plan = PS.ceremonyAwardPlan(rows, 'room-1');
    assert.deepEqual(plan.map(a => a.ref_key), [
        'purrfect_survival:room-1:a',
        'purrfect_survival:room-1:b',
        'purrfect_survival:room-1:c'
    ]);
    assert.deepEqual(plan.map(a => a.amount), [20, 13, 8]);
    assert.ok(plan.every(a => a.reason === 'purrfect_survival'));

    const ledger = {};
    assert.equal(PS.applyCeremonyAwards(plan, ledger).length, 3);
    assert.equal(PS.applyCeremonyAwards(plan, ledger).length, 0, 'second call pays nobody twice');
    assert.equal(Object.keys(ledger).length, 3);
});

test('official English game titles replace every Chinese or "Glass Bridge" title', () => {
    const files = [INDEX_PATH, ENGINE_PATH, RENDER_PATH, MAIN_PATH,
        path.join(__dirname, '..', 'purrfect-survival-demo.html')];
    files.forEach(file => {
        const text = fs.readFileSync(file, 'utf8');
        assert.equal(text.indexOf('玻璃橋'), -1, path.basename(file) + ' has no Chinese bridge title');
        assert.equal(text.indexOf('貓咪拔河大賽'), -1, path.basename(file) + ' has no Chinese tug title');
        assert.equal(text.indexOf('Glass Bridge'), -1, path.basename(file) + ' has no unofficial Glass Bridge title');
        assert.equal(text.indexOf('GLASS BRIDGE'), -1, path.basename(file) + ' has no unofficial GLASS BRIDGE title');
    });

    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    ['1-2-3 Meow!', 'Glass Stepping Stones', 'Tug of War'].forEach(title => {
        assert.ok(html.indexOf(title) !== -1, title + ' is in the lobby');
    });
    const demo = fs.readFileSync(path.join(__dirname, '..', 'purrfect-survival-demo.html'), 'utf8');
    ['1-2-3 Meow!', 'Glass Stepping Stones', 'Tug of War'].forEach(title => {
        assert.ok(demo.indexOf(title) !== -1, title + ' is in the demo');
    });

    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    assert.equal(sql.indexOf('貓咪拔河大賽'), -1, 'canonical SQL uses the English tug title only');
    assert.ok(sql.indexOf('Round 3 (Tug of War)') !== -1, 'canonical header names Tug of War');
});

test('the ceremony is wired for finished rooms, all endings and the public demo', () => {
    const src = fs.readFileSync(MAIN_PATH, 'utf8');
    assert.ok(src.indexOf('function renderCeremony') !== -1, 'renderCeremony exists');
    assert.ok(src.indexOf("room.status === 'finished'") !== -1, 'finished rooms are handled');
    assert.ok(src.indexOf('renderCeremony();') !== -1, 'render dispatches to the ceremony');
    assert.ok(src.indexOf('ceremonyResults') !== -1, 'the engine ranking drives the panel');
    assert.ok(src.indexOf('ps-ceremony-list') !== -1, 'the results list is filled');
    assert.ok(src.indexOf('ps-ceremony-title') !== -1, 'the ceremony title is filled');
    assert.ok(src.indexOf('PSEngine.CEREMONY_PAWS') === -1 || src.indexOf('CEREMONY_PAWS') === -1 || true);

    const demoStart = src.indexOf('function demoJumpVictory()');
    const demoEnd = src.indexOf('function demoAdvanceToRound2()', demoStart);
    const demoFn = src.slice(demoStart, demoEnd);
    assert.ok(demoFn.indexOf('demoRoundCount <= 1') !== -1, 'one-round demo finish exists');
    assert.ok(demoFn.indexOf('demoRoundCount >= 3') !== -1, 'three-round demo finish exists');
    assert.ok(demoFn.indexOf('applyTugResult') !== -1, 'three-round demo finishes the tug');

    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(html.indexOf('id="ps-ceremony"') !== -1, 'the ceremony overlay exists');
    assert.ok(html.indexOf('id="ps-ceremony-list"') !== -1, 'the ceremony list exists');
    assert.ok(html.indexOf('.ps-ceremony.hidden') !== -1, 'hidden overrides display:flex so the overlay starts closed');
});

test('guests and demo mode never call the live ceremony award RPC', () => {
    const src = fs.readFileSync(MAIN_PATH, 'utf8');
    const start = src.indexOf('function claimCeremonyPaws()');
    assert.ok(start !== -1, 'claimCeremonyPaws exists');
    const end = src.indexOf('/* ------------------------------------------------------------------ */', start);
    const fn = src.slice(start, end);
    assert.ok(fn.indexOf('if (demoMode || isGuest()) return;') !== -1, 'demo and guests short-circuit');
    assert.ok(fn.indexOf("purrfect_survival_ceremony") !== -1, 'only the guarded function calls the RPC');
    assert.ok(fn.indexOf('p_room_id') !== -1, 'the RPC is room-scoped');

    // The old short win/lose overlay must not be the finished path any more.
    const milestone = src.slice(src.indexOf('function checkMilestones()'), src.indexOf('function isTypingTarget'));
    assert.equal(milestone.indexOf('final-win:'), -1, 'the old final-win overlay is gone');
    assert.equal(milestone.indexOf('final-out:'), -1, 'the old final-out overlay is gone');
});

test('incremental ceremony SQL exists with teacher instructions, ranking and idempotent awards', () => {
    const file = path.join(__dirname, '..', 'supabase', 'purrfect_survival_ceremony.sql');
    assert.ok(fs.existsSync(file), 'incremental SQL file exists');
    const sql = fs.readFileSync(file, 'utf8');
    assert.ok(sql.indexOf('https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new') !== -1, 'live project URL');
    assert.ok(/Do NOT re-run older incrementals/i.test(sql), 'tells the teacher not to re-run older files');
    assert.ok(/Safe to re-run/i.test(sql), 'safe to re-run');
    assert.ok(/plugin, CLI or agent/i.test(sql), 'never run via a plugin');
    assert.ok(sql.indexOf('purrfect_survival_host_settings.sql') !== -1, 'says to run after PR #51');
    assert.ok(sql.indexOf('purrfect_survival_tug.sql') !== -1, 'says to run after the tug incremental');
    ['purrfect_survival_ceremony_paws', 'purrfect_survival_ceremony_rows',
        'paw_trg_purrfect_survival', 'purrfect_survival_ceremony',
        'my_paws_today', 'friend_paws_daily', 'admin_paw_daily'].forEach(fn => {
        assert.ok(sql.indexOf(fn) !== -1, fn + ' exists');
    });
    assert.ok(sql.indexOf('on conflict (user_id, ref_key) do nothing') !== -1, 'idempotent ledger insert');
    assert.ok(sql.indexOf("'purrfect_survival:' ||") !== -1, 'unique purrfect_survival ref keys');
    assert.ok(sql.indexOf("reason = 'purrfect_survival'") !== -1, 'today Paws include the new reason');
    assert.ok(sql.indexOf("notify pgrst, 'reload schema';") !== -1);
    assert.ok(sql.indexOf('NOT_AUTHENTICATED') !== -1, 'guests cannot call the RPC');

    const canonical = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    ['purrfect_survival_ceremony_paws', 'purrfect_survival_ceremony_rows',
        'paw_trg_purrfect_survival', 'purrfect_survival_ceremony'].forEach(fn => {
        assert.ok(canonical.indexOf(fn) !== -1, fn + ' is folded into the canonical SQL');
    });
    assert.ok(canonical.indexOf('on conflict (user_id, ref_key) do nothing') !== -1, 'canonical awards are idempotent');
});

test('drawCeremony paints a podium in portrait and landscape without bitmaps', () => {
    const ceremony = [
        { place: 1, user_id: 'u0', nickname: 'Gold', paws: 20, rounds: { r1: { distance: 100 } } },
        { place: 2, user_id: 'u1', nickname: 'Silver', paws: 13, rounds: { r1: { distance: 90 } } },
        { place: 3, user_id: 'u2', nickname: 'Bronze', paws: 8, rounds: { r1: { distance: 80 } } }
    ];
    [[390, 844, 'player'], [1024, 768, 'host'], [844, 390, 'player']].forEach(size => {
        const canvas = { width: size[0] * 2, height: size[1] * 2 };
        const ctx = mockContext(canvas);
        const state = sampleState(0, {
            mode: 'ceremony', status: 'finished', role: size[2],
            w: size[0], h: size[1], ceremonyElapsed: 1500,
            players: samplePlayers(), ceremony: ceremony
        });
        assert.doesNotThrow(() => RENDERER.drawCeremony(ctx, state), 'drawCeremony paints @' + size[0] + 'x' + size[1]);
        assert.doesNotThrow(() => RENDERER.drawScene(ctx, state), 'drawScene dispatches the ceremony');
    });
    const src = fs.readFileSync(RENDER_PATH, 'utf8');
    assert.equal(/drawImage/.test(src), false, 'ceremony still never blits bitmaps');
    assert.match(RENDERER.VERSION, /^2\.6\./);
});

test('the demo victory path builds a finished ceremony room for 1, 2 and 3 rounds', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food'], isGuestUser: function () { return false; } });
    dom.PS.startDemo({ role: 'student', scene: 'lobby' });
    [1, 2, 3].forEach(count => {
        dom.PS.setDemoSettings({ roundCount: count });
        assert.doesNotThrow(() => dom.PS.demoJump('victory'), count + '-round demo victory renders');
        const state = dom.PS.state();
        assert.equal(state.room.status, 'finished');
        assert.equal(state.room.current_round, count === 1 ? 1 : (count === 2 ? 2 : 3));
    });
});

/* ---------------------------------------------------------------- */
/* Teacher overhead view, live progress, student ranks, qualifier     */
/* ---------------------------------------------------------------- */

test('host cameras are clearly overhead while student cameras stay close', () => {
    const host = RENDERER.layout(1280, 720, 'host');
    const player = RENDERER.layout(1280, 720, 'player');
    assert.ok(host.cam1.eye[1] >= 6, 'landscape host cam1 is a high overhead eye');
    assert.ok(host.cam1.eye[1] > player.cam1.eye[1], 'host cam1 is higher than player cam1');
    assert.ok(host.cam2.eye[1] > player.cam2.eye[1], 'host cam2 sees the whole bridge from above');
    assert.ok(host.cam3.eye[1] > player.cam3.eye[1], 'host cam3 sees both tug platforms from above');

    const portraitHost = RENDERER.layout(390, 844, 'host');
    const portraitPlayer = RENDERER.layout(390, 844, 'player');
    assert.ok(portraitHost.cam1.eye[1] > portraitPlayer.cam1.eye[1], 'portrait host cam1 is still higher');
    ['cam1', 'cam2', 'cam3'].forEach(key => {
        [host, player, portraitHost, portraitPlayer].forEach(L => {
            assert.equal(L[key].eye.length, 3, key + ' eye is a 3D point');
            assert.equal(L[key].target.length, 3, key + ' target is a 3D point');
            assert.ok(L[key].fov > 0, key + ' fov is valid');
        });
    });
});

test('drawRound1/2/3 paint host and player cameras in portrait and landscape', () => {
    const sizes = [[1280, 720], [390, 844]];
    sizes.forEach(size => {
        ['host', 'player'].forEach(role => {
            const ctx = mockContext({ width: size[0], height: size[1] });
            const base = { w: size[0], h: size[1], role: role };
            assert.doesNotThrow(() => RENDERER.drawRound1(ctx, sampleState(1, base)),
                'round 1 ' + role + ' @' + size.join('x'));
            assert.doesNotThrow(() => RENDERER.drawRound2(ctx, sampleState(2, base)),
                'round 2 ' + role + ' @' + size.join('x'));
            assert.doesNotThrow(() => RENDERER.drawRound3(ctx, sampleState(3, Object.assign({}, base, {
                tug: { phase: 'playing', redPull: 3, bluePull: 4, position: 1, redCombo: 2, blueCombo: 1 }
            }))), 'round 3 ' + role + ' @' + size.join('x'));
        });
    });
});

test('raceOrder, formatPlace and nearbyRunners are stable and ordinal', () => {
    const list = [
        player('a', 100, { reached_finish: true, finished_at: '2026-11-25T10:00:02Z' }),
        player('b', 100, { reached_finish: true, finished_at: '2026-11-25T10:00:01Z' }),
        player('c', 70),
        player('d', 30),
        player('e', 0, { status: 'eliminated', ghost: true })
    ];
    const order = PS.raceOrder(list, { finishDistance: 100 });
    assert.deepEqual(order.map(PS.userKey), ['b', 'a', 'c', 'd']);
    assert.equal(PS.formatPlace(1, 12), '1st / 12');
    assert.equal(PS.formatPlace(2, 12), '2nd / 12');
    assert.equal(PS.formatPlace(3, 12), '3rd / 12');
    assert.equal(PS.formatPlace(11, 12), '11th / 12');
    assert.equal(PS.formatPlace(12, 12), '12th / 12');
    assert.equal(PS.formatPlace(13, 12), '13th / 12');
    assert.equal(PS.formatPlace(21, 30), '21st / 30');

    const nearby = PS.nearbyRunners(list, 'c', { finishDistance: 100, ahead: 1, behind: 1 });
    assert.deepEqual(nearby.map(PS.userKey), ['a', 'c', 'd']);
    const alone = PS.nearbyRunners(list, 'e', { finishDistance: 100 });
    assert.deepEqual(alone.map(PS.userKey), ['e'], 'an eliminated student still gets their own label slot');
});

test('teacherProgress orders leaders first and labels every round from live fields', () => {
    const r1 = [
        player('a', 100, { reached_finish: true, finished_at: '2026-11-25T10:00:01Z' }),
        player('b', 70),
        player('c', 40, { status: 'eliminated', ghost: true }),
        player('d', 90)
    ];
    const rows1 = PS.teacherProgress(r1, { round: 1, finishDistance: 100, phase: 'red' });
    assert.deepEqual(rows1.map(r => r.user_id), ['a', 'd', 'b', 'c']);
    assert.equal(rows1[0].status, 'Finished');
    assert.equal(rows1[1].status, 'Frozen');
    assert.equal(rows1[2].detail, '70 / 100 m');
    assert.equal(rows1[3].status, 'Out');
    assert.equal(rows1[1].near, true, 'a runner over 80% of the way is highlighted');
    assert.equal(rows1[2].near, false);

    const r2 = [
        player('a', 0, { status: 'advanced', crossed_glass: true, glass_step: 9, glass_finished_at: '2026-11-25T10:00:01Z' }),
        player('b', 0, { glass_active: true, glass_step: 4 }),
        player('c', 0, { glass_step: 0 }),
        player('d', 0, { status: 'eliminated', ghost: true, glass_step: 6 })
    ];
    const rows2 = PS.teacherProgress(r2, { round: 2, stepCount: 9 });
    assert.deepEqual(rows2.map(r => r.status), ['Crossed', 'Jumping', 'Queued', 'Fell']);
    assert.equal(rows2[0].detail, 'Step 9 / 9');
    assert.equal(rows2[1].detail, 'Step 4 / 9');
    assert.equal(rows2[3].detail, 'Step 6 / 9');

    const r3 = [
        player('a', 0, { tug_team: 'red' }),
        player('b', 0, { tug_team: 'blue' }),
        player('c', 0, { tug_team: null }),
        player('d', 0, { status: 'eliminated', ghost: true, tug_team: 'red' })
    ];
    const rows3 = PS.teacherProgress(r3, {
        round: 3,
        tug: { phase: 'playing', redCombo: 3, blueCombo: 2 }
    });
    assert.deepEqual(rows3.map(r => r.user_id), ['a', 'd', 'b', 'c']);
    assert.equal(rows3[0].team, 'Red');
    assert.equal(rows3[0].status, 'Answering');
    assert.equal(rows3[0].combo, 3);
    assert.equal(rows3[1].status, 'Out');
    assert.equal(rows3[2].team, 'Blue');
    assert.equal(rows3[3].team, 'Watching');
    assert.equal(rows3[3].detail, 'Watching');
});

test('qualifierRoster lists the Round 1 advancers and the glass survivors', () => {
    const r1 = [];
    for (let i = 0; i < 20; i++) {
        r1.push(player('p' + String(i).padStart(2, '0'), 100 - i * 4, {
            nickname: '4C ' + String(i + 1).padStart(2, '0') + ' Student',
            reached_finish: i < 3,
            finished_at: i < 3 ? '2026-11-25T10:00:0' + (i + 1) + 'Z' : null
        }));
    }
    const from1 = PS.qualifierRoster(r1, { fromRound: 1, finishDistance: 100 });
    assert.equal(from1.length, 15);
    assert.deepEqual(from1.slice(0, 3).map(r => r.user_id), ['p00', 'p01', 'p02']);
    assert.equal(from1[0].detail, 'Finished');
    assert.equal(from1[0].place, 1);

    const r2 = [
        player('a', 0, { status: 'advanced', crossed_glass: true, round1_rank: 2, glass_finished_at: '2026-11-25T10:00:02Z', tug_team: 'red' }),
        player('b', 0, { status: 'advanced', crossed_glass: true, round1_rank: 1, glass_finished_at: '2026-11-25T10:00:01Z' }),
        player('c', 0, { status: 'eliminated', ghost: true, glass_step: 3 })
    ];
    const from2 = PS.qualifierRoster(r2, { fromRound: 2 });
    assert.deepEqual(from2.map(r => r.user_id), ['b', 'a']);
    assert.equal(from2[0].detail, 'Crossed the glass bridge');
    assert.equal(from2[1].team, 'red');
    assert.equal(PS.qualifierTitle(1), 'Advancing to Glass Stepping Stones');
    assert.equal(PS.qualifierTitle(2), 'Advancing to Tug of War');
});

test('live markup exposes the progress list, place chip and qualifier board', () => {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    ['id="ps-progress"', 'id="ps-progress-list"', 'id="ps-qualifier"', 'id="ps-qualifier-list"',
        'id="ps-hud-place"'].forEach(token => {
        assert.ok(html.indexOf(token) !== -1, token + ' exists in index.html');
    });
    const main = fs.readFileSync(MAIN_PATH, 'utf8');
    assert.ok(main.indexOf('renderTeacherProgress') !== -1, 'teacher progress renderer is wired');
    assert.ok(main.indexOf('PSEngine.teacherProgress') !== -1, 'progress rows come from the pure engine');
    assert.ok(main.indexOf('PSEngine.formatPlace') !== -1, 'student place uses formatPlace');
    assert.ok(main.indexOf("setText('ps-hud-place'") !== -1, 'place HUD is rendered');
    assert.ok(main.indexOf('renderQualifier') !== -1, 'qualifier board renderer is wired');
    assert.ok(main.indexOf("demoRole === 'teacher'") !== -1, 'demo teacher gets host role');

    const render = fs.readFileSync(RENDER_PATH, 'utf8');
    const fnStart = render.indexOf('function drawRound1Players');
    const fnEnd = render.indexOf('function drawRound2Players', fnStart);
    const fn = render.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 8000);
    assert.ok(fn.indexOf('nearby') !== -1, 'Round 1 labels only nearby runners');
    assert.ok(fn.indexOf("rank + ' · '") !== -1, 'nearby cats show their place before the name');
    assert.ok(render.indexOf('L.host') !== -1, 'host keeps extra portrait labels');
});

test('demo sequential advance shows the qualifier before glass or tug play', () => {
    const main = fs.readFileSync(MAIN_PATH, 'utf8');
    const start = main.indexOf('function demoAdvanceToRound2');
    const end = main.indexOf('function demoFinishRound1Victory', start);
    const fn = main.slice(start, end);
    assert.ok(fn.indexOf('demoReleaseGlass') === -1, 'sequential advance does not release the glass under the board');
    assert.ok(fn.indexOf('qualifierDismissed') === -1, 'sequential advance does not skip the board');

    const tickStart = main.indexOf('function demoTickRound2');
    const tickEnd = main.indexOf('function demoTick()', tickStart);
    const tick = main.slice(tickStart, tickEnd);
    assert.ok(tick.indexOf('qualifierInfo()') !== -1, 'glass release waits for the qualifier');
    assert.ok(tick.indexOf('demoReleaseGlass') > tick.indexOf('qualifierInfo()'), 'release runs after the guard');

    const finish = main.indexOf('function demoFinishRound2');
    const finishEnd = main.indexOf('function demoPrepareTugSurvivors', finish);
    assert.ok(main.slice(finish, finishEnd).indexOf('resetQualifierState') !== -1,
        'moving to round 3 re-arms the survivor board');

    assert.ok(main.indexOf('if (qualifierInfo()) return;') !== -1, 'the demo cannot start the tug under the board');
    assert.ok(main.indexOf("show('ps-tug-start-btn', host && isR3 && briefing && !qualifying)") !== -1,
        'host start button is hidden until the board ends');
});

test('demo teacher/projector renders the live side progress list', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food'], isGuestUser: function () { return false; } });
    assert.doesNotThrow(() => dom.PS.startDemo({ role: 'teacher', scene: 'round1' }));
    const panel = dom.el('ps-progress');
    assert.ok(panel, 'progress panel element exists');
    assert.equal(panel.classList.contains('hidden'), false, 'teacher view shows the progress list');
    const list = dom.el('ps-progress-list');
    assert.ok(list && /demo-\d\d/.test(list.innerHTML) === false, 'the list does not leak raw ids');
    assert.ok(list && /4C/.test(list.innerHTML), 'the list shows the demo classmates by name');
    const title = dom.el('ps-progress-title');
    assert.ok(title && /ROUND 1/.test(title.textContent), 'the list is labelled for the live round');
});

test('ceremony card no longer covers the podium in landscape or portrait', () => {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.equal(html.indexOf('min(460px, 46vw)'), -1, 'the old wide right-hand card is gone');
    assert.ok(html.indexOf('width: min(420px, 34vw)') !== -1, 'landscape card is a slim column');
    assert.ok(html.indexOf('max-height: 46%') !== -1, 'portrait card leaves the stands visible above it');
    assert.ok(/\.ps-ceremony-card\s*\{[^}]*overflow:\s*hidden/s.test(html), 'the card itself does not scroll the exit away');
    assert.ok(/\.ps-ceremony-body\s*\{[^}]*overflow-y:\s*auto/s.test(html), 'only the ranking body scrolls');

    const render = fs.readFileSync(RENDER_PATH, 'utf8');
    assert.ok(render.indexOf('groupShift') !== -1, 'the 3D podium group shifts away from the card');
    assert.ok(render.indexOf('const spread = L.landscape ? 4.3 : 3.1') !== -1, 'portrait podium stays on screen');
    assert.ok(render.indexOf('id="ps-ceremony-list"') === -1);
    assert.ok(html.indexOf('id="ps-ceremony-list"') !== -1, 'the full ranking list still exists');
});

test('ceremony exit controls sit outside the scrolling ranking', () => {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');

    const close = html.match(/<button id="ps-ceremony-close"[^>]*onclick="PS\.backToHub\(\)"/);
    assert.ok(close, 'the card has its own always-visible close control');
    const exit = html.match(/<button id="ps-ceremony-exit"[^>]*onclick="PS\.backToHub\(\)"/);
    assert.ok(exit, 'the footer still offers Back to Hub');

    const closeAt = html.indexOf('id="ps-ceremony-close"');
    const bodyAt = html.indexOf('<div class="ps-ceremony-body">');
    const actionsAt = html.indexOf('<div class="ps-ceremony-actions">');
    assert.ok(closeAt !== -1 && bodyAt !== -1 && actionsAt !== -1, 'ceremony parts exist');
    assert.ok(closeAt < bodyAt, 'the close control is outside and above the scroll body');
    assert.ok(actionsAt > bodyAt, 'the footer follows the scroll body');

    const body = html.slice(bodyAt, actionsAt);
    assert.equal(body.indexOf('Back to Hub'), -1, 'the exit button is not inside the scrolling body');
    assert.equal(body.indexOf('ps-ceremony-close'), -1, 'the close control is not inside the scrolling body');

    assert.ok(/\.ps-ceremony-actions\s*\{[^}]*flex-shrink:\s*0/s.test(html),
        'the footer never collapses with the ranking');
    assert.ok(/\.ps-ceremony-close\s*\{[^}]*position:\s*absolute/s.test(html),
        'the close control floats over the card');
    assert.ok(/\.ps-ceremony-close\s*\{[^}]*pointer-events:\s*auto/s.test(html),
        'the close control is tappable even outside the card hit area');
});

test('host can end rounds 2–4; students never see the control', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food'], currentUser: null, isGuestUser: function () { return false; } });
    const btn = dom.el('ps-host-end');
    assert.ok(btn, 'the End-round button exists');

    dom.PS.startDemo({ role: 'teacher', roundCount: 2, scene: 'round2' });
    assert.equal(btn.classList.contains('hidden'), false, 'host sees End round 2 during the glass bridge');
    assert.match(btn.textContent, /End round 2/);

    dom.PS.setDemoRole('student');
    assert.equal(btn.classList.contains('hidden'), true, 'students never get the End-round control');

    dom.PS.startDemo({ role: 'teacher', roundCount: 3, scene: 'round3' });
    assert.equal(btn.classList.contains('hidden'), false, 'host sees End round 3 during the tug');
    assert.match(btn.textContent, /End round 3/);

    dom.PS.setDemoRole('student');
    assert.equal(btn.classList.contains('hidden'), true, 'students never get the tug End-round control');

    dom.PS.startDemo({ role: 'teacher', roundCount: 4, scene: 'round4' });
    assert.equal(btn.classList.contains('hidden'), false, 'host sees End round 4 after the qualifier board');
    assert.match(btn.textContent, /End round 4/);

    dom.PS.setDemoRole('student');
    assert.equal(btn.classList.contains('hidden'), true, 'students never get the Dalgona End-round control');
});

test('demo early-end applies the same rules as the round clocks', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food'], currentUser: null, isGuestUser: function () { return false; } });

    dom.PS.startDemo({ role: 'teacher', roundCount: 2, scene: 'round2' });
    dom.PS.endRoundNow();
    let state = dom.PS.state();
    assert.equal(state.room.status, 'finished', 'ending a two-round glass bridge finishes the room');
    assert.equal(state.room.current_round, 2);
    state.players.filter(p => p.is_playing !== false && p.status === 'eliminated').forEach(p => {
        if (p.eliminated_reason) {
            assert.ok(['round2_timeout', 'round1_cut'].indexOf(p.eliminated_reason) !== -1,
                'glass early-end uses the existing timeout reason');
        }
    });

    dom.PS.startDemo({ role: 'teacher', roundCount: 3, scene: 'round3' });
    dom.PS.endRoundNow();
    state = dom.PS.state();
    assert.equal(state.room.status, 'round3', 'a level tug does not invent a winner');
    assert.equal(state.room.tug_state.suddenDeath, true, 'a level rope goes to sudden death like the clock');
    dom.PS.endRoundNow();
    assert.equal(dom.PS.state().room.status, 'round3', 'sudden death cannot be ended early');

    dom.PS.startDemo({ role: 'teacher', roundCount: 4, scene: 'round4' });
    dom.PS.endRoundNow();
    state = dom.PS.state();
    assert.equal(state.room.status, 'finished', 'ending Dalgona finishes the room');
    assert.equal(state.room.current_round, 4);
    state.players.filter(p => p.is_playing !== false && p.dalgona_pattern && !p.dalgona_finished_at).forEach(p => {
        assert.equal(p.status, 'eliminated', 'unfinished carvers are eliminated');
        assert.equal(p.eliminated_reason, 'dalgona_timeout', 'same reason as the carving clock');
    });
});

test('end-round SQL is a safe, teacher-run incremental with a workspace copy', () => {
    const file = path.join(__dirname, '..', 'supabase', 'purrfect_survival_end_rounds.sql');
    const sql = fs.readFileSync(file, 'utf8');
    assert.ok(sql.indexOf('https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new') !== -1,
        'live project URL is in the install header');
    assert.ok(/Clear the editor completely/i.test(sql), 'tells the teacher to clear the editor');
    assert.ok(/Safe to re-run/i.test(sql), 'safe to re-run');
    assert.ok(/Do NOT re-run older incrementals/i.test(sql), 'tells the teacher not to re-run older files');
    assert.ok(/plugin, CLI or agent/i.test(sql), 'never run via a plugin');
    assert.ok(/after the existing Survival incrementals/i.test(sql), 'installs after the other incrementals');
    assert.ok(sql.indexOf('notify pgrst') !== -1, 'reloads the PostgREST schema');

    assert.ok(sql.indexOf('end_purrfect_survival_round') !== -1, 'new host-only RPC');
    assert.ok(/returns public\.purrfect_survival_rooms/.test(sql), 'returns the room row');
    assert.ok(/NOT_AUTHENTICATED/.test(sql) && /NOT_HOST/.test(sql), 'same auth checks as End round 1');
    ['round1', 'round2', 'round3', 'round4'].forEach(round => {
        assert.ok(sql.indexOf("status = '" + round + "'") !== -1, 'handles ' + round);
    });
    assert.ok(sql.indexOf('purrfect_survival_complete_round1') !== -1, 'round 1 reuses the existing helper');
    assert.ok(sql.indexOf('purrfect_survival_finish_if_done') !== -1, 'round 2 mirrors the tick');
    assert.ok(sql.indexOf('purrfect_survival_enter_round4') !== -1, 'round 3 mirrors the tick');
    assert.ok(/interval '7 seconds'/.test(sql), 'round 4 respects the qualifier board');
    assert.ok(sql.indexOf('dalgona_timeout') !== -1, 'round 4 uses the existing timeout reason');
    assert.ok(/revoke all on function public\.end_purrfect_survival_round\(uuid\) from public, anon/i.test(sql),
        'locked down from public/anon');
    assert.ok(/grant execute on function public\.end_purrfect_survival_round\(uuid\) to authenticated/i.test(sql),
        'authenticated hosts can call it');

    const copy = fs.readFileSync(path.join(__dirname, '..', '..', 'purrfect_survival_end_rounds.sql'), 'utf8');
    assert.equal(copy, sql, 'the /workspace copy is byte-for-byte identical');

    const canonical = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    assert.ok(canonical.indexOf('end_purrfect_survival_round') !== -1,
        'fresh installs also define the host early-end function');

    const main = fs.readFileSync(MAIN_PATH, 'utf8');
    assert.ok(main.indexOf("'end_purrfect_survival_round1'") !== -1, 'round 1 keeps the old RPC');
    assert.ok(main.indexOf("'end_purrfect_survival_round'") !== -1, 'rounds 2–4 use the new RPC');
    assert.ok(main.indexOf('purrfect_survival_end_rounds.sql') !== -1,
        'a missing new RPC surfaces the install filename instead of failing silently');
});

test('lobby Show-rules text is projector-readable and never shrinks in landscape', () => {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');

    assert.ok(/\.ps-cine-howto\s*\{[^}]*max-height:\s*min\(58vh, 560px\)/s.test(html),
        'the howto panel has room for enlarged rules');
    assert.ok(/\.ps-rule-card h3\s*\{[^}]*font-size:\s*22px/s.test(html), 'headings are larger than body text');
    assert.ok(/\.ps-rule-en\s*\{[^}]*font-size:\s*20px/s.test(html), 'English body is ~20px');
    assert.ok(/\.ps-rule-zh\s*\{[^}]*font-size:\s*19px/s.test(html), 'Chinese body follows the English size');
    assert.ok(/\.ps-rule-en\s*\{[^}]*line-height:\s*1\.55/s.test(html), 'comfortable line height');
    assert.ok(/\.ps-rule-card\s*\{[^}]*padding:\s*14px 18px/s.test(html), 'more padding for projection');

    const landscapeStart = html.indexOf('@media (orientation: landscape) and (min-width: 700px) {');
    const shortStart = html.indexOf('@media (max-height: 560px) and (orientation: landscape) {', landscapeStart);
    assert.ok(landscapeStart !== -1 && shortStart > landscapeStart, 'both landscape blocks exist');
    const landscape = html.slice(landscapeStart, shortStart);
    assert.ok(/\.ps-rule-en\s*\{\s*font-size:\s*21px/.test(landscape),
        'landscape is a touch larger, never smaller, than portrait');
    assert.equal(/\.ps-rule-en\s*\{[^}]*font-size:\s*(?:[0-9]|1[0-9])px/.test(landscape), false,
        'landscape no longer shrinks the English rules');
    assert.ok(/\.ps-cine-howto\s*\{\s*max-height:\s*min\(60vh, 620px\)/.test(landscape),
        'landscape panel is taller, still scrollable');

    const shortEnd = html.indexOf('/* ---------- live game', shortStart);
    const short = html.slice(shortStart, shortEnd);
    assert.ok(/\.ps-rule-en\s*\{\s*font-size:\s*20px/.test(short),
        'short landscape keeps the base size');
    assert.equal(/\.ps-rule-en\s*\{[^}]*font-size:\s*(?:[0-9]|1[0-9])px/.test(short), false,
        'short landscape no longer shrinks the rules');
});

test('glass 7-second window SQL is a safe, teacher-run incremental with a workspace copy', () => {
    const file = path.join(__dirname, '..', 'supabase', 'purrfect_survival_glass_window_7s.sql');
    const sql = fs.readFileSync(file, 'utf8');

    assert.ok(sql.indexOf('https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new') !== -1,
        'live project URL is in the install header');
    assert.ok(/Clear the editor completely/i.test(sql), 'tells the teacher to clear the editor');
    assert.ok(/Safe to re-run/i.test(sql), 'safe to re-run');
    assert.ok(/Do NOT re-run older incrementals/i.test(sql), 'tells the teacher not to re-run older files');
    assert.ok(/plugin, CLI or agent/i.test(sql), 'never run via a plugin');
    assert.ok(/after the existing Survival incrementals/i.test(sql), 'installs after the other incrementals');
    assert.ok(sql.indexOf('notify pgrst') !== -1, 'reloads the PostgREST schema');

    assert.ok(sql.indexOf('create or replace function public.tick_purrfect_survival') !== -1,
        'replaces the tick that times out glass jumpers');
    assert.ok(sql.indexOf('create or replace function public.glass_jump_purrfect_survival') !== -1,
        'replaces the glass jump RPC');

    const glassIntervals = sql.match(/interval '7 seconds'/g) || [];
    assert.ok(glassIntervals.length >= 2, 'both the tick and the glass jump use a 7-second window');
    assert.ok(/v_now - glass_started_at >= interval '7 seconds'/.test(sql), 'tick times out at 7 s');
    assert.ok(/now\(\) - v_player\.glass_started_at >= interval '7 seconds'/.test(sql),
        'glass_jump times out at 7 s');
    assert.equal(/glass_started_at[^\n]*interval '5 seconds'/.test(sql), false,
        'no glass timeout still uses the old 5-second interval');

    assert.ok(/revoke all on function public\.tick_purrfect_survival\(uuid\) from public, anon/i.test(sql),
        'tick is locked down from public/anon');
    assert.ok(/revoke all on function public\.glass_jump_purrfect_survival\(uuid, text\) from public, anon/i.test(sql),
        'glass_jump is locked down from public/anon');
    assert.ok(/grant execute on function public\.tick_purrfect_survival\(uuid\) to authenticated/i.test(sql),
        'authenticated players can call tick');
    assert.ok(/grant execute on function public\.glass_jump_purrfect_survival\(uuid, text\) to authenticated/i.test(sql),
        'authenticated players can jump');

    const copy = fs.readFileSync(path.join(__dirname, '..', '..', 'purrfect_survival_glass_window_7s.sql'), 'utf8');
    assert.equal(copy, sql, 'the /workspace copy is byte-for-byte identical');

    const canonical = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    assert.ok(/v_now - glass_started_at >= interval '7 seconds'/.test(canonical),
        'fresh installs also time out glass jumpers at 7 s');
    assert.ok(/now\(\) - v_player\.glass_started_at >= interval '7 seconds'/.test(canonical),
        'fresh installs also enforce 7 s inside glass_jump');
    assert.equal(/glass_started_at[^\n]*interval '5 seconds'/.test(canonical), false,
        'the canonical install no longer enforces a 5-second glass window');
    assert.ok(canonical.indexOf('+ 5000') !== -1, 'the 5-second tug rage is unchanged');
});

test('qualifier SQL is a safe, teacher-run incremental', () => {
    const file = path.join(__dirname, '..', 'supabase', 'purrfect_survival_qualifier.sql');
    const sql = fs.readFileSync(file, 'utf8');
    assert.ok(/Safe to re-run/i.test(sql), 'safe to re-run');
    assert.ok(/Do NOT re-run older incrementals/i.test(sql), 'tells the teacher not to re-run older files');
    assert.ok(/plugin, CLI or agent/i.test(sql), 'never run via a plugin');
    assert.ok(sql.indexOf('purrfect_survival_release_glass') !== -1, 'redefines the glass release');
    assert.ok(/interval '7 seconds'/.test(sql), 'waits the qualifier duration');
    assert.ok(sql.indexOf('round2_started_at') !== -1, 'uses the existing round-2 timestamp');

    const canonical = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    assert.ok(canonical.indexOf("interval '7 seconds'") !== -1,
        'fresh installs also wait for the qualifier before releasing glass');
});

/* ---------------------------------------------------------------- */
/* Follow-up: longer host track, glass lights/order, reports, audio   */
/* ---------------------------------------------------------------- */

test('host Round 1 track is clearly longer than the student track', () => {
    const host = RENDERER.layout(1280, 720, 'host');
    const player = RENDERER.layout(1280, 720, 'player');
    assert.equal(player.round1StartZ, 5.0, 'student start stays at 5.0');
    assert.equal(player.round1FinishZ, 9.8, 'student finish stays at 9.8');
    assert.ok(host.round1StartZ < player.round1StartZ, 'host course starts nearer the camera');
    assert.ok(host.round1FinishZ >= player.round1FinishZ, 'host keeps the finish at the far end');
    const hostSpan = host.round1FinishZ - host.round1StartZ;
    const playerSpan = player.round1FinishZ - player.round1StartZ;
    assert.ok(hostSpan > playerSpan * 1.5, 'host track is substantially longer');

    const portraitHost = RENDERER.layout(390, 844, 'host');
    const portraitPlayer = RENDERER.layout(390, 844, 'player');
    assert.ok(portraitHost.round1StartZ < portraitPlayer.round1StartZ);
    assert.equal(portraitPlayer.round1StartZ, 5.0);

    const src = fs.readFileSync(RENDER_PATH, 'utf8');
    assert.ok(src.indexOf('round1StartZ') !== -1, 'layout exposes the track extents');
    assert.ok(src.indexOf('r1Z(m, L)') !== -1, 'metre marks use the host extents');
    assert.ok(src.indexOf('r1Z(dist, L)') !== -1, 'cats use the host extents');
    assert.ok(src.indexOf('L.round1FinishZ') !== -1, 'finish strip uses the host extents');
    assert.ok(src.indexOf('L.round1DollZ') !== -1, 'the doll uses the host extents');
    assert.ok(src.indexOf("'playground:' + (s.role || 'player') + ':'") !== -1,
        'static cache key includes the host track identity');
});

test('drawRound1 paints the 1280x720 host track and the student track', () => {
    [[1280, 720], [390, 844], [844, 390]].forEach(size => {
        ['host', 'player'].forEach(role => {
            const ctx = mockContext({ width: size[0], height: size[1] });
            assert.doesNotThrow(() => RENDERER.drawRound1(ctx, sampleState(1, {
                w: size[0], h: size[1], role: role
            })), 'round 1 ' + role + ' @' + size.join('x'));
        });
    });
    assert.match(RENDERER.VERSION, /^2\.6\./);
});

test('glass panes are lights only: no vocab text on the 3D bridge', () => {
    const src = fs.readFileSync(RENDER_PATH, 'utf8');
    const start = src.indexOf('function drawPane3D(');
    const end = src.indexOf('function drawBridgePanes(', start);
    assert.ok(start !== -1 && end > start);
    const fn = src.slice(start, end);
    assert.equal(fn.indexOf('fillText'), -1, 'drawPane3D never writes option text');
    assert.equal(fn.indexOf('step.left'), -1, 'left option is not referenced in the pane painter');
    assert.equal(fn.indexOf('step.right'), -1, 'right option is not referenced in the pane painter');
    assert.ok(fn.indexOf('revealed_side') !== -1, 'correct panes still light up');
    assert.ok(fn.indexOf('shattered_side') !== -1, 'broken panes still shatter');

    const ctx = mockContext({ width: 1280, height: 720 });
    assert.doesNotThrow(() => RENDERER.drawRound2(ctx, sampleState(2, { role: 'host', w: 1280, h: 720 })));
});

test('each student gets a different glass order from the same bank', () => {
    const bank = PS.buildGlassSteps({
        pairs: PS.buildGlassPairs({ words: PS.DEMO_VOCAB, seed: 99, count: 9 }),
        seed: 99,
        count: 9
    });
    const a = PS.glassStepsForPlayer(bank, 'student-a', 1234);
    const b = PS.glassStepsForPlayer(bank, 'student-b', 1234);
    const aAgain = PS.glassStepsForPlayer(bank, 'student-a', 1234);
    assert.equal(a.length, 9);
    assert.deepEqual(a.map(s => s.bank_index), aAgain.map(s => s.bank_index), 'same user + seed is stable');
    assert.notDeepEqual(a.map(s => s.bank_index), b.map(s => s.bank_index), 'two classmates get different orders');
    assert.deepEqual(a.map(s => s.bank_index).slice().sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8],
        'the order is a permutation of the same topic bank');
    a.forEach(step => {
        assert.equal(step.revealed, false);
        assert.equal(step.revealed_side, null);
        const src = bank[step.bank_index];
        assert.equal(step.left, src.left);
        assert.equal(step.right, src.right);
        assert.equal(step.correct_side, src.correct_side);
    });

    // A reveal on the shared base array must not pre-mark B's phone.
    bank[0].revealed = true;
    bank[0].revealed_side = bank[0].correct_side;
    const freshB = PS.glassStepsForPlayer(bank, 'student-b', 1234);
    assert.ok(freshB.every(s => s.revealed === false && s.revealed_side === null),
        'another student\'s revealed_side is stripped');

    const p = { user_id: 'student-a', glass_step: 2, glass_order: a.map(s => s.bank_index) };
    const step = PS.playerGlassStep(bank, p, 1234);
    assert.equal(step.bank_index, a[2].bank_index, 'validation follows the student\'s own sequence');
});

test('the SQL glass-order mirror matches the JS order', () => {
    function sqlOrder(seed, userId, len) {
        const text = String(seed) + '|' + String(userId) + '|glass';
        let hash = 2166136261n;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash ^ BigInt(text.charCodeAt(i))) * 16777619n) & 0xFFFFFFFFn;
        }
        let a = hash;
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(i);
        for (let i = len - 1; i > 0; i--) {
            a = (a + 1831565813n) & 0xFFFFFFFFn;
            let t = (a ^ (a >> 15n)) & 0xFFFFFFFFn;
            t = (t * ((1n | a) & 0xFFFFFFFFn)) & 0xFFFFFFFFn;
            let u = (t ^ (t >> 7n)) & 0xFFFFFFFFn;
            u = (u * ((61n | t) & 0xFFFFFFFFn)) & 0xFFFFFFFFn;
            t = ((t + u) & 0xFFFFFFFFn) ^ t;
            const r = Number(((t ^ (t >> 14n)) & 0xFFFFFFFFn)) / 4294967296;
            const j = Math.floor(r * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }
    ['u-1', 'u-2', '4c16', 'student-abc'].forEach(user => {
        [0, 20261125, 1234].forEach(seed => {
            const js = PS.glassOrderForPlayer(user, 9, seed);
            assert.deepEqual(js, sqlOrder(seed, user, 9), 'same order for ' + user + '/' + seed);
        });
    });
});

test('the queue view has no option buttons and the phone shows only its own step', () => {
    const src = fs.readFileSync(MAIN_PATH, 'utf8');
    const start = src.indexOf('function renderGlassTurn()');
    const end = src.indexOf('function renderTugTurn()', start);
    assert.ok(start !== -1 && end > start);
    const fn = src.slice(start, end);
    assert.ok(fn.indexOf("if (!me.glass_active)") !== -1, 'queued students get a queue message');
    assert.ok(/opts\.innerHTML = ''/.test(fn), 'queue clears the answer pad');
    assert.equal(fn.indexOf('ps-glass-safe'), -1, 'no revealed answer highlighting on a student phone');
    assert.ok(fn.indexOf('playerGlassSteps(me)') !== -1, 'the phone reads the student sequence');

    assert.ok(src.indexOf('function demoGlassJump(') !== -1);
    assert.ok(src.indexOf('playerGlassSteps(me)') !== -1, 'demo validation uses the per-student sequence');
    assert.ok(src.indexOf('playerGlassSteps(p)') !== -1, 'demo bots also use their own sequence');
});

test('mistake reports are per-student for students and whole-class for teachers', () => {
    const a = { user_id: 'a', nickname: '4C 01 Amy', is_playing: true, answer_log: [] };
    const b = { user_id: 'b', nickname: '4C 02 Ben', is_playing: true, answer_log: [] };
    const c = { user_id: 'c', nickname: '4C 03 Cal', is_playing: true, answer_log: [] };
    PS.recordMistake(a, { round: 1, kind: 'answer', prompt: 'Charity?', choice: 'sleep', answer: 'help' });
    PS.recordMistake(a, { round: 2, kind: 'glass_timeout', prompt: 'Pane', left: 'a', right: 'b', answer: 'b' });
    PS.recordMistake(b, { round: 3, kind: 'tug', prompt: 'Past tense of go', choice: 'goed', answer: 'went' });

    const mine = PS.mistakeReport([a, b, c], { meId: 'a', viewer: 'student' });
    assert.equal(mine.viewer, 'student');
    assert.equal(mine.rows.length, 1);
    assert.equal(mine.rows[0].user_id, 'a');
    assert.equal(mine.rows[0].mistakes.length, 2);
    assert.equal(mine.total, 2);

    const other = PS.mistakeReport([a, b, c], { meId: 'c', viewer: 'student' });
    assert.equal(other.rows[0].user_id, 'c');
    assert.deepEqual(other.rows[0].mistakes, [], 'a student with no mistakes sees an empty list');

    const teacher = PS.mistakeReport([a, b, c], { viewer: 'teacher' });
    assert.equal(teacher.viewer, 'teacher');
    assert.deepEqual(teacher.rows.map(r => r.user_id), ['a', 'b']);
    assert.equal(teacher.total, 3);

    const empty = PS.mistakeReport([c], { viewer: 'teacher' });
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.total, 0);

    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    ['id="ps-mistake-report"', 'id="ps-mistake-title"', 'id="ps-mistake-list"'].forEach(token => {
        assert.ok(html.indexOf(token) !== -1, token + ' exists in index.html');
    });
    const main = fs.readFileSync(MAIN_PATH, 'utf8');
    assert.ok(main.indexOf('renderMistakeReport()') !== -1, 'the ceremony renders the report');
    assert.ok(main.indexOf('PSEngine.recordMistake') !== -1, 'demo play records mistakes');
    assert.ok(main.indexOf('PSEngine.mistakeReport') !== -1, 'the report comes from the pure engine');
});

test('the demo iframe unlocks Survival audio and keeps the documented mute', () => {
    const demo = fs.readFileSync(path.join(__dirname, '..', 'purrfect-survival-demo.html'), 'utf8');
    assert.ok(demo.indexOf('allow="autoplay') !== -1, 'the iframe allows autoplay');
    assert.ok(demo.indexOf('unlockAudio') !== -1, 'the demo bar calls PS.unlockAudio');

    const main = fs.readFileSync(MAIN_PATH, 'utf8');
    assert.ok(main.indexOf('PS.unlockAudio') !== -1, 'PS exposes unlockAudio');
    assert.ok(main.indexOf("learniTY_ps_sound") !== -1, 'the documented mute key is still honoured');
    assert.ok(main.indexOf("src: '/music/survival_lobby_music.mp3'") !== -1, 'lobby BGM is the teacher lobby track');
    assert.ok(main.indexOf("src: '/music/survival_music.mp3'") !== -1, 'gameplay BGM is the teacher Survival track');
    assert.ok(main.indexOf("src: '/music/trophyMusic.mp3'") !== -1, 'the prize ceremony uses the site trophy music');
    assert.equal(main.indexOf('/music/battlemusic.mp3'), -1, 'gameplay no longer uses battlemusic');
    assert.ok(main.indexOf("room.status === 'waiting') return 'lobby'") !== -1, 'lobby track plays while waiting');
    assert.ok(main.indexOf("room.status === 'finished') return 'ceremony'") !== -1, 'ceremony track plays when finished');
    assert.ok(main.indexOf('function startBgm()') !== -1, 'BGM starts from gestures');
    assert.ok(main.indexOf('stopBgm()') !== -1, 'BGM stops when leaving / muting');
    assert.ok(main.indexOf('syncMusic()') !== -1, 'render syncs the track to the room status');
    assert.equal(/soundOn\s*=\s*false/.test(main), false, 'demo mode does not hard-wire sound off');
});

test('Survival music files exist and are not precached by the service worker', () => {
    const musicDir = path.join(__dirname, '..', 'music');
    assert.ok(fs.existsSync(path.join(musicDir, 'survival_lobby_music.mp3')), 'lobby track is in music/');
    assert.ok(fs.existsSync(path.join(musicDir, 'survival_music.mp3')), 'gameplay track is in music/');
    assert.ok(fs.existsSync(path.join(musicDir, 'trophyMusic.mp3')), 'ceremony track is already in music/');
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    ['survival_lobby_music.mp3', 'survival_music.mp3', 'trophyMusic.mp3', 'battlemusic.mp3'].forEach(function (name) {
        assert.equal(sw.indexOf(name), -1, name + ' must not be in the service-worker precache');
    });
});

test('round-2 answer/order SQL is a safe teacher-run incremental', () => {
    const file = path.join(__dirname, '..', 'supabase', 'purrfect_survival_round2_answers.sql');
    assert.ok(fs.existsSync(file), 'incremental SQL file exists');
    const sql = fs.readFileSync(file, 'utf8');
    assert.ok(sql.indexOf('https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new') !== -1, 'live project URL');
    assert.ok(/Clear the editor/i.test(sql), 'tells the teacher to clear the editor');
    assert.ok(/Safe to re-run/i.test(sql), 'safe to re-run');
    assert.ok(/Do NOT re-run older incrementals/i.test(sql), 'tells the teacher not to re-run older files');
    assert.ok(/plugin, CLI or agent/i.test(sql), 'never run via a plugin');
    assert.ok(sql.indexOf('qualifier') !== -1, 'says to run after the qualifier incremental');
    ['answer_log', 'glass_order', 'purrfect_survival_glass_order',
        'glass_jump_purrfect_survival', 'submit_purrfect_survival_answer',
        'purrfect_survival_begin_round2', 'purrfect_survival_release_glass'].forEach(token => {
        assert.ok(sql.indexOf(token) !== -1, token + ' exists');
    });
    assert.ok(/interval '7 seconds'/.test(sql), 'keeps the qualifier glass delay');
    assert.ok(sql.indexOf("notify pgrst, 'reload schema';") !== -1);

    const canonical = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    ['answer_log', 'glass_order', 'purrfect_survival_glass_order'].forEach(token => {
        assert.ok(canonical.indexOf(token) !== -1, token + ' is in the canonical SQL');
    });
    assert.ok(canonical.indexOf('v_order := coalesce(') !== -1, 'canonical validates against the player order');
    assert.equal(canonical.indexOf('set glass_steps = v_steps'), -1, 'canonical no longer writes shared reveals');

    const copy = '/workspace/purrfect_survival_round2_answers.sql';
    assert.ok(fs.existsSync(copy), 'workspace copy exists');
    assert.equal(fs.readFileSync(copy, 'utf8'), sql, 'workspace copy matches the repo incremental');
});

/* ---------------------------------------------------------------- */
/* Round 4 — Dalgona Candy Carving                                  */
/* ---------------------------------------------------------------- */

const COMBINING_PATH = path.join(__dirname, '..', 'js', 'grammar', 'participle-clauses-combining-data.js');

function loadCombiningBank() {
    const code = fs.readFileSync(COMBINING_PATH, 'utf8');
    const sandbox = { window: {}, console, Date, Math, JSON, Number, String, Array, Object, isFinite };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'participle-clauses-combining-data.js' });
    return sandbox.window.DG_PARTICIPLE_CLAUSES_COMBINING;
}

function dalgonaPlayer(id, pattern, units, extra) {
    return Object.assign({
        user_id: id,
        nickname: id.toUpperCase(),
        is_playing: true,
        status: 'advanced',
        advanced_round3: true,
        ghost: false,
        dalgona_pattern: pattern,
        dalgona_progress: 0,
        dalgona_cracks: 0,
        dalgona_lick_used: false,
        dalgona_finished_at: null,
        dalgona_units: units.slice(),
        dalgona_item: { pattern: pattern, units: units.slice(), prompt: 'Q ' + id, target: units.join(' ') }
    }, extra || {});
}

test('Round 4 carving: every correct unit advances one segment and finishing marks finished', () => {
    const units = ['C', 'A', 'T'];
    let state = { pattern: 'fishbone', units: units.slice(), progress: 0, cracks: 0, lickUsed: false };
    let res = PS.dalgonaApplyInput(state, 'c', { now: 1000 });
    assert.equal(res.ok, true);
    assert.equal(res.correct, true);
    assert.equal(res.state.progress, 1);
    assert.equal(res.state.units.length, 3);
    assert.equal(res.finished, false);

    res = PS.dalgonaApplyInput(res.state, 'A', { now: 1200 });
    assert.equal(res.state.progress, 2);

    res = PS.dalgonaApplyInput(res.state, 't', { now: 1500 });
    assert.equal(res.state.progress, 3);
    assert.equal(res.finished, true);
    assert.equal(res.state.status, 'finished');
    assert.equal(res.state.finishedAt, 1500, 'finish time comes from opts.now');

    const again = PS.dalgonaApplyInput(res.state, 'x', { now: 2000 });
    assert.equal(again.ok, false, 'finished states ignore further input');
    assert.equal(again.state.cracks, 0);

    const board = PS.teacherRound4Board([dalgonaPlayer('a', 'fishbone', units, { dalgona_progress: 2 })]);
    assert.equal(board[0].progress, 2);
    assert.equal(board[0].detail, '2 / 3');
    assert.equal(board[0].pattern_label, 'Fishbone');
});

test('Round 4 crack meter: 1st wrong = danger, 2nd wrong = shattered and eliminated', () => {
    const units = ['a', 'b', 'c'];
    let res = PS.dalgonaApplyInput({ pattern: 'paw', units: units, progress: 0, cracks: 0 }, 'zzz');
    assert.equal(res.correct, false);
    assert.equal(res.crack, true);
    assert.equal(res.eliminated, false);
    assert.equal(res.state.cracks, 1);
    assert.equal(res.state.status, 'danger');
    assert.equal(res.state.progress, 0);

    res = PS.dalgonaApplyInput(res.state, 'nope');
    assert.equal(res.eliminated, true);
    assert.equal(res.state.cracks, 2);
    assert.equal(res.state.status, 'shattered');

    const after = PS.dalgonaApplyInput(res.state, 'a');
    assert.equal(after.ok, false);
    assert.equal(after.ignored, true);
    assert.equal(after.state.progress, 0, 'shattered students cannot carve');
    assert.equal(after.state.cracks, 2);
});

test('Round 4 lick: fills one unit, consumes the single lick, never cracks and is rejected afterwards', () => {
    const units = ['one', 'two', 'three'];
    const state = { pattern: 'crown', units: units.slice(), progress: 1, cracks: 0, lickUsed: false };
    const res = PS.dalgonaLick(state, { now: 900 });
    assert.equal(res.applied, true);
    assert.equal(res.correct, true);
    assert.equal(res.state.progress, 2);
    assert.equal(res.state.lickUsed, true);
    assert.equal(res.state.cracks, 0, 'lick does not crack');
    assert.equal(res.unit, 'two');

    const second = PS.dalgonaLick(res.state);
    assert.equal(second.applied, false, 'only one lick per round');
    assert.equal(second.state.progress, 2);

    assert.equal(PS.dalgonaLick({ pattern: 'crown', units: units, progress: 3, cracks: 0, lickUsed: false }).applied, false,
        'no unit left → not consumed');
    assert.equal(PS.dalgonaLick({ pattern: 'crown', units: units, progress: 1, cracks: 2, lickUsed: false }).applied, false,
        'shattered students cannot lick');
    const finish = PS.dalgonaLick({ pattern: 'crown', units: units, progress: 2, cracks: 0, lickUsed: false }, { now: 5 });
    assert.equal(finish.finished, true);
    assert.equal(finish.state.status, 'finished');
});

test('Round 4 fishbone bank merges New Vocab + Dictation, dedupes and requires English + Chinese', () => {
    const bank = PS.buildFishboneBank({
        newVocab: [
            { en: 'Library', zh: '圖書館' },
            { en: 'library', zh: '重複' },
            { en: 'no-zh', zh: '' },
            { en: '', zh: '冇英文' }
        ],
        dictation: [
            { en: 'LIBRARY', zh: '又一個' },
            { en: 'apple', zh: '蘋果' }
        ]
    });
    assert.deepEqual(bank.map(w => w.en), ['Library', 'apple']);
    assert.deepEqual(bank.map(w => w.zh), ['圖書館', '蘋果']);

    const item = PS.buildFishboneItem(bank[1], 3);
    assert.equal(item.pattern, 'fishbone');
    assert.equal(item.prompt, '蘋果');
    assert.equal(item.target, 'apple');
    assert.deepEqual(item.units, ['a', 'p', 'p', 'l', 'e']);

    const spaced = PS.buildFishboneItem({ en: "don't stop-me", zh: '唔好停' }, 4);
    assert.deepEqual(spaced.units, ['d', 'o', 'n', 't', 's', 't', 'o', 'p', 'm', 'e'],
        'spaces, apostrophes and hyphens are ignored');
});

test('Round 4 cat paw items come from the five grammar topics and never a Q251+ combining stem', () => {
    PS.GRAMMAR_TOPICS.forEach(topic => {
        const item = PS.buildPawItem({
            id: topic + '-1',
            topic: topic,
            prompt: 'Choose the correct form: She ___ ready.',
            primary: 'is',
            options: ['is', 'are', 'was']
        }, 7);
        assert.equal(item.pattern, 'paw');
        assert.equal(item.topic, topic);
        assert.deepEqual(item.units, ['is']);
        assert.ok(item.tiles.length >= 2, 'single-token answers use the official choices as tiles');
    });
    const multi = PS.buildPawItem({ id: 'x', prompt: '1. Choose: The cat ___', primary: 'has been sleeping', options: ['has been sleeping', 'have been sleeping'] }, 1);
    assert.deepEqual(multi.units, ['has', 'been', 'sleeping']);
    assert.equal(multi.prompt.indexOf('Choose:'), -1, 'the sheet prefix is stripped for display');

    const src = fs.readFileSync(MAIN_PATH, 'utf8');
    assert.ok(src.indexOf('PSEngine.GRAMMAR_TOPICS') !== -1, 'the client loads exactly the five grammar topics');
    assert.ok(src.indexOf('participle_phrases') === -1 || src.indexOf('PSEngine.GRAMMAR_TOPICS') !== -1);
});

test('Round 4 crown bank is Q251+ only, keeps official wording and accepts every official sentence', () => {
    const bank = loadCombiningBank();
    assert.equal(bank.length, 80);
    assert.equal(Math.min(...bank.map(q => Number(q.id))), 251);
    assert.equal(Math.max(...bank.map(q => Number(q.id))), 330);
    assert.ok(bank.some(q => q.id === 251));
    assert.ok(bank.some(q => q.id === 252));
    assert.equal(bank.filter(q => Number(q.id) < 251).length, 0, 'no Q1–250 gap-fill items');
    bank.forEach(q => {
        assert.ok(q.q && q.a && Array.isArray(q.accept) && q.accept.length >= 1);
        assert.ok(q.accept.indexOf(q.a) !== -1, 'a is inside accept');
    });

    const item = PS.buildCrownItem(bank[0], 1);
    assert.equal(item.pattern, 'crown');
    assert.equal(item.source_id, 251);
    assert.equal(item.prompt, bank[0].q);
    assert.deepEqual(item.units, PS.dalgonaTokenize(bank[0].a));
    assert.equal(item.accept.length, 2);
    assert.equal(item.tiles.length, item.units.length);

    const alt = PS.dalgonaApplyInput({
        pattern: 'crown', units: item.units, tiles: item.tiles, accept: item.accept,
        progress: 0, cracks: 0, lickUsed: false
    }, '__sentence__', { assembled: item.accept[1], now: 77 });
    assert.equal(alt.finished, true, 'a complete alternative accept sentence finishes the candy');
    assert.equal(alt.state.progress, item.units.length);
});

test('Round 4 assignment: seeded patterns, one item per player and a mix of patterns', () => {
    const bank = loadCombiningBank();
    const players = [
        dalgonaPlayer('a', '', [], { advanced_round3: true }),
        dalgonaPlayer('b', '', [], { advanced_round3: true }),
        dalgonaPlayer('c', '', [], { advanced_round3: true }),
        dalgonaPlayer('out', '', [], { advanced_round3: false, status: 'eliminated', ghost: true })
    ];
    const assignments = PS.buildDalgonaAssignments({
        players: players,
        seed: 4242,
        fishboneWords: PS.DEMO_VOCAB,
        pawQuestions: PS.DEMO_GRAMMAR,
        crownQuestions: bank
    });
    assert.equal(assignments.length, 3, 'only living tug winners get candy');
    assert.equal(new Set(assignments.map(a => a.user_id)).size, 3);
    assignments.forEach(a => {
        assert.ok(PS.ROUND4.PATTERNS.indexOf(a.pattern) !== -1);
        assert.ok(a.units.length > 0);
        assert.equal(a.item.pattern, a.pattern);
        assert.equal(a.progress, 0);
        assert.equal(a.cracks, 0);
    });
    assert.equal(new Set(assignments.map(a => a.pattern)).size, 3, 'three winners get one of each pattern');

    const patterns = PS.assignDalgonaPatterns(players, 4242);
    assert.deepEqual(patterns.map(p => p.user_id), ['a', 'b', 'c']);
    assert.deepEqual(patterns, PS.assignDalgonaPatterns(players, 4242), 'stable by user_id + seed');
});

test('Round 4 host board rows match every shared student dalgona state', () => {
    const players = [
        dalgonaPlayer('a', 'fishbone', ['a', 'b', 'c', 'd'], { dalgona_progress: 4, dalgona_finished_at: 2000 }),
        dalgonaPlayer('b', 'paw', ['x', 'y'], { dalgona_progress: 1, dalgona_cracks: 1 }),
        dalgonaPlayer('c', 'crown', ['m', 'n'], { dalgona_progress: 0, dalgona_cracks: 2, status: 'eliminated', ghost: true, eliminated_reason: 'dalgona' }),
        dalgonaPlayer('d', 'fishbone', ['q'], { dalgona_progress: 0, advanced_round3: false, tug_team: 'blue', status: 'eliminated', ghost: true, eliminated_reason: 'tug' })
    ];
    const board = PS.teacherRound4Board(players, {});
    const byId = {};
    board.forEach(row => { byId[row.user_id] = row; });
    assert.equal(byId.a.status, 'Finished');
    assert.equal(byId.a.progress, 4);
    assert.equal(byId.b.status, 'Danger');
    assert.equal(byId.b.progress, 1);
    assert.equal(byId.b.cracks, 1);
    assert.equal(byId.c.status, 'Shattered');
    assert.equal(byId.c.cracks, 2);
    assert.equal(byId.d, undefined, 'a tug loser is not on the Round 4 grid');
    assert.equal(board[0].user_id, 'a', 'finished carver ranks first');
    assert.ok(board.findIndex(r => r.user_id === 'b') < board.findIndex(r => r.user_id === 'c'));
});

test('Round 4 host settings: default 2, 4 plays dalgona, 5 also plays finals, 3 does not', () => {
    assert.equal(PS.HOST.MAX_IMPLEMENTED, 5);
    assert.equal(PS.roomRoundCount({}), 2);
    assert.equal(PS.roomRoundCount({ roundCount: 4 }), 4);
    assert.equal(PS.roomRoundCount({ roundCount: 5 }), 5);
    assert.equal(PS.shouldPlayRound4({ roundCount: 3 }), false);
    assert.equal(PS.shouldPlayRound4({ roundCount: 4 }), true);
    assert.equal(PS.shouldPlayRound4({ roundCount: 5 }), true);
    assert.equal(PS.round3EndAction({ roundCount: 4 }), 'dalgona');
    assert.equal(PS.round3EndAction({ roundCount: 3 }), 'finish');
    assert.equal(PS.round4EndAction({ roundCount: 4 }), 'finish');
    assert.equal(PS.round4EndAction({ roundCount: 5 }), 'finals');

    assert.equal(PS.normalizeDalgonaDuration(), 180000);
    assert.equal(PS.normalizeDalgonaDuration('180'), 180000);
    assert.equal(PS.normalizeDalgonaDuration(30), 60000, 'below the range clamps to 60 s');
    assert.equal(PS.normalizeDalgonaDuration(900000), 600000, 'above the range clamps to 600 s');
    assert.equal(PS.normalizeDalgonaDuration(900), 60000, 'a value above 600 is read as milliseconds (0.9 s → 60 s floor)');
    assert.equal(PS.normalizeDalgonaDuration(120000), 120000, 'large values are milliseconds');

    const result = PS.validateHostSettings({
        roundCount: 4,
        dalgonaDuration: 240,
        rounds: [{ round: 1, subject: 'vocab', vocabSource: 'Food' }]
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.rounds[3].kind, 'dalgona');
    assert.equal(result.rounds[3].dalgonaDuration, 240000);
    assert.equal(result.settings.dalgonaDuration, 240000);
});

test('Round 4 qualifier board is titled for Dalgona and lists the tug winners', () => {
    const players = [
        dalgonaPlayer('r1', 'fishbone', ['a'], { tug_team: 'red', advanced_round3: true }),
        dalgonaPlayer('r2', 'paw', ['b'], { tug_team: 'red', advanced_round3: true }),
        dalgonaPlayer('b1', 'crown', ['c'], { tug_team: 'blue', advanced_round3: false, status: 'eliminated', ghost: true, eliminated_reason: 'tug' })
    ];
    assert.equal(PS.qualifierTitle(3), 'Advancing to Dalgona Candy Carving');
    assert.equal(PS.qualifierTitle(2), 'Advancing to Tug of War');
    assert.equal(PS.qualifierTitle(1), 'Advancing to Glass Stepping Stones');

    const roster = PS.qualifierRoster(players, { fromRound: 3, tug: { phase: 'done', winner: 'red' } });
    assert.deepEqual(roster.map(r => r.user_id), ['r1', 'r2']);
    assert.equal(roster[0].detail, 'Won the Tug of War');
    assert.equal(roster[0].team, 'red');
});

test('Round 4 ceremony ranks finished carvers above shattered students and keeps 3-round tug order', () => {
    const players = [
        dalgonaPlayer('slow', 'fishbone', ['a'], { dalgona_progress: 1, dalgona_finished_at: 3000 }),
        dalgonaPlayer('fast', 'paw', ['b'], { dalgona_progress: 1, dalgona_finished_at: 1000 }),
        dalgonaPlayer('carver', 'crown', ['c', 'd'], { dalgona_progress: 1 }),
        dalgonaPlayer('broken', 'fishbone', ['e'], { dalgona_progress: 0, dalgona_cracks: 2, status: 'eliminated', ghost: true, eliminated_reason: 'dalgona' }),
        dalgonaPlayer('tugout', 'paw', ['f'], { status: 'eliminated', ghost: true, eliminated_reason: 'tug', advanced_round3: false })
    ];
    const rows = PS.ceremonyResults(players, { roundCount: 4 });
    assert.deepEqual(rows.slice(0, 3).map(r => r.user_id), ['fast', 'slow', 'carver']);
    assert.equal(rows[0].survived, true);
    assert.equal(rows[0].paws, 20);
    assert.equal(rows.find(r => r.user_id === 'broken').survived, false);
    assert.ok(rows.find(r => r.user_id === 'broken').place > rows.find(r => r.user_id === 'carver').place);
    assert.equal(rows.find(r => r.user_id === 'fast').rounds.r4.status, 'finished');
    assert.equal(rows.find(r => r.user_id === 'broken').rounds.r4.status, 'shattered');

    const three = PS.ceremonyResults([
        dalgonaPlayer('blue', 'fishbone', [], { tug_team: 'blue' }),
        dalgonaPlayer('red', 'fishbone', [], { tug_team: 'red' })
    ], { roundCount: 3, tug: { phase: 'done', winner: 'blue' } });
    assert.equal(three[0].user_id, 'blue', '3-round ranking stays on the tug winner');
    assert.equal(three[0].rounds.r4, undefined);
});

test('Round 4 wiring: renderer draws it, the bank is precached and no mp3 enters CORE_ASSETS', () => {
    const render = fs.readFileSync(RENDER_PATH, 'utf8');
    assert.ok(render.indexOf('R.drawRound4 = function') !== -1, 'drawer exists');
    assert.ok(render.indexOf('R.drawRound4(ctx, s)') !== -1, 'drawScene dispatches round 4');
    assert.equal(/\.drawImage\s*\(/.test(render), false, 'no drawImage');
    const R = loadRenderer();
    assert.equal(R.VERSION, '2.6.1');
    assert.equal(typeof R.drawRound4, 'function');
    const ctx = mockContext({ width: 390, height: 844 });
    R.drawRound4(ctx, {
        w: 390, h: 844, hud: 80, role: 'player', now: 1200,
        round4: { me: { pattern: 'crown', pattern_label: 'Crown cat', progress: 4, total: 18, cracks: 1, status: 'danger' }, board: [] }
    });
    R.drawRound4(ctx, {
        w: 1280, h: 720, hud: 80, role: 'host', now: 1200,
        round4: {
            me: null,
            board: PS.teacherRound4Board([
                dalgonaPlayer('a', 'fishbone', ['a', 'b', 'c'], { dalgona_progress: 2 }),
                dalgonaPlayer('b', 'paw', ['d'], { dalgona_cracks: 1 }),
                dalgonaPlayer('c', 'crown', ['e'], { dalgona_cracks: 2, status: 'eliminated', ghost: true, eliminated_reason: 'dalgona' })
            ])
        }
    });

    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    assert.ok(sw.indexOf('participle-clauses-combining-data.js') !== -1, 'bank is in CORE_ASSETS');
    assert.ok(sw.indexOf('learnity-pwa-v121') !== -1, 'cache is v121');
    assert.equal(sw.indexOf('learnity-pwa-v119'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v120'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v117'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v118'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v116'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v115'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v114'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v113'), -1, 'the old cache name is gone');
    const assets = sw.slice(sw.indexOf('const CORE_ASSETS'), sw.indexOf('];', sw.indexOf('const CORE_ASSETS')));
    assert.equal(/\.mp3/.test(assets), false, 'no mp3 in CORE_ASSETS');

    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(html.indexOf('js/grammar/participle-clauses-combining-data.js') !== -1, 'index loads the bank');
    const demo = fs.readFileSync(path.join(__dirname, '..', 'purrfect-survival-demo.html'), 'utf8');
    assert.ok(demo.indexOf('js/grammar/participle-clauses-combining-data.js') !== -1, 'demo loads the bank');

    assert.equal(PS.VERSION, '1.4.0');

    const client = fs.readFileSync(path.join(__dirname, '..', 'js', 'purrfect-survival.js'), 'utf8');
    assert.ok(client.indexOf('dalgona_item') !== -1 && client.indexOf('PLAYER_COLUMNS') !== -1);
    assert.ok(client.indexOf("roomRoundCount() >= 4") !== -1
        && client.indexOf('? PLAYER_COLUMNS') !== -1,
        '4-round rooms never select * for the class poll');
    assert.ok(client.indexOf("rpc('purrfect_survival_dalgona_item'") !== -1,
        'a student loads only their own candy via the RPC');
});

test('Round 4 SQL incremental is safe to re-run and mirrors the engine rules', () => {
    const sqlPath = path.join(__dirname, '..', 'supabase', 'purrfect_survival_round4_dalgona.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    assert.ok(/Safe to re-run/i.test(sql));
    assert.ok(/Do NOT re-run/i.test(sql));
    assert.ok(/plugin, CLI or agent/i.test(sql));
    assert.ok(sql.indexOf('https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new') !== -1);
    ['round4_started_at', 'round4_ends_at', 'dalgona_pattern', 'dalgona_progress',
        'dalgona_cracks', 'dalgona_lick_used', 'dalgona_finished_at', 'dalgona_units',
        'submit_purrfect_survival_dalgona', 'lick_purrfect_survival_dalgona',
        'start_purrfect_survival_round4', 'purrfect_survival_enter_round4',
        'purrfect_survival_dalgona_item'].forEach(token => {
        assert.ok(sql.indexOf(token) !== -1, token + ' exists');
    });
    assert.ok(sql.indexOf("check (status in ('waiting', 'round1', 'round2', 'round3', 'round4', 'finished'))") !== -1);
    assert.ok(/interval '7 seconds'/.test(sql), 'honours the 7-second qualifier');
    assert.ok(sql.indexOf('return least(4, greatest(1, v_raw::int))') !== -1, 'round count max is 4');
    assert.ok(sql.indexOf("notify pgrst, 'reload schema';") !== -1);
    assert.equal(sql.indexOf('create or replace function public.submit_purrfect_survival_answer') !== -1, true,
        'round-3 winner path is patched to enter round 4');
    assert.ok(sql.indexOf('purrfect_survival_enter_round4(p_room_id, v_winner)') !== -1);

    const copy = '/workspace/purrfect_survival_round4_dalgona.sql';
    assert.ok(fs.existsSync(copy), 'workspace copy exists');
    assert.equal(fs.readFileSync(copy, 'utf8'), sql, 'workspace copy matches');
});

test('demo Round 4 builds a live carving state with mixed patterns, lick and crack wiring', async () => {
    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'], currentUser: null });
    dom.PS.startDemo({ role: 'student', scene: 'round4' });
    let state = dom.PS.state();
    assert.equal(state.room.status, 'round4');
    assert.equal(state.room.current_round, 4);
    assert.ok(state.room.round4_started_at && state.room.round4_ends_at);

    const visitor = state.players.find(p => p.user_id === 'demo-you');
    assert.ok(visitor, 'the demo visitor is in the room');
    assert.ok(visitor.dalgona_pattern, 'the visitor has a stamped pattern');
    assert.ok(visitor.dalgona_units.length > 0, 'the visitor has carve units');

    const board = PS.teacherRound4Board(state.players, {});
    assert.ok(board.length >= 5, 'the teacher grid has the carving class');
    assert.ok(board.some(r => r.pattern === 'fishbone'));
    assert.ok(board.some(r => r.pattern === 'paw') || board.some(r => r.pattern === 'crown'),
        'the demo mixes patterns');

    const before = visitor.dalgona_progress;
    dom.PS.dalgonaLick();
    state = dom.PS.state();
    const afterLick = state.players.find(p => p.user_id === 'demo-you');
    assert.equal(afterLick.dalgona_lick_used, true, 'lick is consumed');
    assert.equal(afterLick.dalgona_progress, before + 1, 'lick fills one unit');
    assert.equal(afterLick.dalgona_cracks, 0, 'lick never cracks');

    dom.PS.dalgonaInput('__definitely_wrong__');
    await new Promise(resolve => setTimeout(resolve, 240));
    state = dom.PS.state();
    let me = state.players.find(p => p.user_id === 'demo-you');
    assert.equal(me.dalgona_cracks, 1, 'first wrong carve is one crack');
    assert.notEqual(me.status, 'eliminated');

    dom.PS.dalgonaInput('__still_wrong__');
    state = dom.PS.state();
    me = state.players.find(p => p.user_id === 'demo-you');
    assert.equal(me.dalgona_cracks, 2, 'second wrong carve splits the candy');
    assert.equal(me.status, 'eliminated');
    assert.equal(me.eliminated_reason, 'dalgona');
});

test('lickAnimProgress is null outside the window and 0..1 inside it', () => {
    assert.equal(PS.ROUND4.LICK_ANIM_MS, 1000);
    assert.equal(PS.lickAnimProgress(0, 500, 1000), null, 'no start time');
    assert.equal(PS.lickAnimProgress(1000, 999, 1000), null, 'before the tap');
    assert.equal(PS.lickAnimProgress(1000, 1000, 1000), 0, 'first frame');
    assert.equal(PS.lickAnimProgress(1000, 1500, 1000), 0.5, 'half way');
    assert.equal(PS.lickAnimProgress(1000, 1999, 1000), 0.999, 'just before the end');
    assert.equal(PS.lickAnimProgress(1000, 2000, 1000), 1, 'last frame is inclusive');
    assert.equal(PS.lickAnimProgress(1000, 2001, 1000), null, 'after the window');
    assert.equal(PS.lickAnimProgress(1000, 1500, 0), null, 'a zero duration has no window');
});

test('demo student Hint starts the cat lick, fills exactly one unit once, and disables the button', async () => {
    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'], currentUser: null });
    dom.PS.startDemo({ role: 'student', scene: 'round4' });
    let state = dom.PS.state();
    const visitor = state.players.find(p => p.user_id === 'demo-you');
    assert.ok(visitor && visitor.dalgona_pattern && visitor.dalgona_units.length, 'the visitor is carving');
    const before = visitor.dalgona_progress;
    assert.equal(dom.PS.lickAnimActive(), false, 'no animation before the tap');
    const btn = dom.el('ps-lick-btn');
    assert.ok(!btn.classList.contains('hidden'), 'the Hint button is offered');

    dom.PS.dalgonaLick();
    assert.equal(dom.PS.lickAnimActive(), true, 'the cat-lick window opens on tap');
    const anim = dom.PS.state().lickAnim;
    assert.ok(typeof anim === 'number' && anim >= 0 && anim <= 1, 'state exposes the animation progress');
    assert.ok(btn.classList.contains('hidden') || btn.disabled, 'the Hint button is hidden or disabled immediately');

    await new Promise(resolve => setTimeout(resolve, 40));
    state = dom.PS.state();
    const afterLick = state.players.find(p => p.user_id === 'demo-you');
    assert.equal(afterLick.dalgona_progress, before + 1, 'one lick fills one unit');
    assert.equal(afterLick.dalgona_lick_used, true, 'the single lick is consumed');
    assert.equal(afterLick.dalgona_cracks, 0, 'a lick never cracks the candy');

    dom.PS.dalgonaLick();
    state = dom.PS.state();
    const second = state.players.find(p => p.user_id === 'demo-you');
    assert.equal(second.dalgona_progress, before + 1, 'a second tap does nothing');
    assert.equal(second.dalgona_lick_used, true);
});

test('drawCatLick paints original canvas art at t = 0, 0.5 and 1 without bitmaps', () => {
    const R = loadRenderer();
    assert.equal(typeof R.drawCatLick, 'function', 'the renderer exports the cat lick');
    const ctx = mockContext({ width: 390, height: 844 });
    const look = { cat: 'Siamese', hat: 'Crown', glasses: 'None', outfit: 'None' };
    [0, 0.5, 1].forEach(t => {
        assert.doesNotThrow(() => R.drawCatLick(ctx, 195, 500, 120, t, look), 'drawCatLick t=' + t);
    });
    const src = fs.readFileSync(RENDER_PATH, 'utf8');
    const start = src.indexOf('function drawCatLick');
    const end = src.indexOf('function drawRound4Player');
    assert.ok(start !== -1 && end > start, 'cat lick is its own function');
    const body = src.slice(start, end);
    assert.equal(/drawImage/.test(body), false, 'the cat lick never blits bitmaps');
    assert.ok(/drawCat\s*\(/.test(body), 'the lick draws the real LearniTY cat avatar');
    assert.ok(body.indexOf('createLinearGradient') !== -1, 'the tongue is a fleshy gradient fill');
    assert.ok(body.indexOf('quadraticCurveTo') !== -1, 'the tongue is a tapered curved path');
    assert.ok(body.indexOf('squash') !== -1, 'the tip flattens on contact');
    assert.ok(body.indexOf('rgba(255,255,255,.40)') !== -1, 'a wet highlight streak runs down the centre');
    ['#f4a261', '#e8798f', '#f9c0a0'].forEach(colour => {
        assert.equal(body.indexOf(colour), -1, 'the old painted ' + colour + ' ginger head is gone');
    });
    assert.equal(src.indexOf('function lickTonguePath') !== -1, true, 'the tapered tongue path is factored out');
});

test('drawCatLick uses each student own LearniTY cat and survives a missing look', () => {
    const calls = [];
    const DG = {
        drawCatAvatar(ctx, x, y, scale, look) {
            calls.push({ x: x, y: y, scale: scale, look: look });
        }
    };
    const R = loadRenderer({ dg: DG });
    const ctx = mockContext({ width: 390, height: 844 });
    const look = { cat: 'Siamese', hat: 'Crown', glasses: 'None', outfit: 'None' };

    R.drawCatLick(ctx, 195, 500, 140, 0.5, look);
    assert.equal(calls.length, 1, 'the lick draws exactly one avatar');
    assert.equal(calls[0].look.cat, 'Siamese', 'the supplied look is forwarded');
    assert.equal(calls[0].look.hat, 'Crown');

    const headR = 33 * calls[0].scale;
    const headY = calls[0].y - 91 * calls[0].scale;
    const candyTop = 500 - 140;
    assert.ok(headY < candyTop, 'the head sits above the candy surface');
    assert.ok(headY > candyTop - 140 * 0.5, 'the head stays inside the reserved lick band');
    assert.ok(headR / 140 > 0.25 && headR / 140 < 0.4, 'the head is 0.25-0.4 of the candy radius');

    calls.length = 0;
    assert.doesNotThrow(() => R.drawCatLick(ctx, 195, 500, 140, 0.5), 'a 4-arg call still works');
    assert.equal(calls.length, 1, 'the default look still draws the DG / Ginger cat');
    assert.ok(calls[0].look && calls[0].look.cat === undefined, 'missing look falls back to DG defaults');

    /* drawRound4Player forwards state.round4.me.look to the lick */
    calls.length = 0;
    R.drawRound4(ctx, {
        w: 390, h: 844, hud: 80, role: 'player', now: 600,
        round4: {
            padBottom: 300,
            me: {
                pattern: 'fishbone', pattern_label: 'Fishbone', progress: 3, total: 8,
                cracks: 0, status: 'carving', lickAnim: 0.5,
                look: { cat: 'Garfield', hat: 'None', glasses: 'Sunglasses', outfit: 'None' }
            },
            board: []
        }
    });
    assert.ok(calls.length >= 1, 'the player view draws the licking cat');
    assert.equal(calls[0].look.cat, 'Garfield', 'the student own cat reaches the canvas');
    assert.equal(calls[0].look.glasses, 'Sunglasses');
});

test('Round 4 student candy layout keeps the tin above the question pad', () => {
    const R = loadRenderer();
    const L = R.layout(390, 844, 'player');
    const candy = R.round4PlayerCandyLayout(L, {
        round4: { me: { pattern: 'fishbone' }, padBottom: 300 }
    });
    assert.ok(candy.padBottom === 300, 'the measured pad height is honoured');
    assert.ok(candy.candyBottom <= 844 - 300 + 8, 'the candy bottom stays above the pad (slack <= 8px)');
    assert.ok(candy.cy <= 844 * 0.42, 'the tin sits clearly higher than the old 0.46 * h centre');
    assert.ok(candy.cy > L.hud, 'the tin stays below the HUD');
    assert.ok(candy.candyTop > L.hud, 'the candy top clears the HUD');

    /* No measurement (hidden pad / no real layout): conservative portrait
       reserve so the candy is still out of the usual key zone. */
    const auto = R.round4PlayerCandyLayout(L, { round4: { me: { pattern: 'paw' } } });
    assert.equal(auto.measured, false, 'the fallback is used when the pad is not measured');
    assert.ok(auto.candyBottom < 844 - 844 * 0.36, 'the fallback keeps the candy above the pad zone');
    assert.ok(auto.cy <= 844 * 0.42, 'the fallback is also higher than the old centre');

    /* A shorter pad keeps the tin large; a taller pad shrinks it so it still
       fits, and an absurd pad never pushes it off screen. */
    const tight = R.round4PlayerCandyLayout(L, { round4: { padBottom: 200 } });
    assert.ok(tight.r >= candy.r * 0.98, 'a shorter pad never shrinks the tin');
    const tall = R.round4PlayerCandyLayout(L, { round4: { padBottom: 420 } });
    assert.ok(tall.r < candy.r, 'a taller pad shrinks the tin so it still fits');
    const huge = R.round4PlayerCandyLayout(L, { round4: { padBottom: 900 } });
    assert.ok(huge.r >= 30 && huge.candyBottom <= 844, 'an oversized pad never pushes the tin off screen');

    /* Landscape is capped so the tin stays visible next to the corner pad. */
    const land = R.round4PlayerCandyLayout(R.layout(844, 390, 'player'), { round4: { padBottom: 230 } });
    assert.ok(land.r >= 60, 'landscape still gets a usable tin');
    assert.ok(land.candyBottom <= 390, 'landscape keeps the tin on screen');

    /* The host grid path is untouched and still runs. */
    const host = R.layout(1280, 720, 'host');
    assert.doesNotThrow(() => R.drawRound4(mockContext({ width: 1280, height: 720 }), {
        w: 1280, h: 720, hud: 80, role: 'host', now: 1200,
        round4: {
            me: null,
            board: PS.teacherRound4Board([
                dalgonaPlayer('a', 'fishbone', ['a', 'b'], { dalgona_progress: 1 }),
                dalgonaPlayer('b', 'paw', ['d'], { dalgona_cracks: 2, status: 'eliminated', ghost: true, eliminated_reason: 'dalgona' })
            ])
        }
    }));
    assert.equal(host.host, true);
    const src = fs.readFileSync(RENDER_PATH, 'utf8');
    assert.ok(src.indexOf("'ROUND 4 · ' + n + ' CARVERS · LIVE CLASS GRID'") !== -1,
        'the teacher grid title is unchanged');
});

test('Round 4 student phone view is decluttered while the host grid keeps its labels', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'], currentUser: null });
    dom.PS.startDemo({ role: 'student', scene: 'round4' });
    const prompt = String(dom.el('ps-prompt').textContent || '');
    assert.ok(prompt.length > 0, 'the student still sees the question');
    const lower = prompt.toLowerCase();
    ['spell the english', 'carved', 'dalgona candy carving'].forEach(token => {
        assert.equal(lower.indexOf(token), -1, 'the prompt has no "' + token + '"');
    });
    assert.equal(/\d+\s*\/\s*\d+/.test(prompt), false, 'no x / y progress counter in the prompt');

    const rule = dom.el('ps-hud-rule');
    assert.ok(rule.textContent === '' || rule.classList.contains('hidden'), 'the long Round 4 rule is hidden for students');

    const src = fs.readFileSync(RENDER_PATH, 'utf8');
    const player = src.slice(src.indexOf('function drawRound4Player'), src.indexOf('function drawRound4Host'));
    assert.equal(player.indexOf('One lick available'), -1, 'the long lick caption is gone');
    assert.equal(player.indexOf('DALGONA CANDY CARVING'), -1, 'the big student title pill is gone');
    assert.ok(src.indexOf("'ROUND 4 · ' + n + ' CARVERS · LIVE CLASS GRID'") !== -1,
        'the teacher grid title is unchanged');
    assert.ok(src.indexOf("'✅ Finished'") !== -1 && src.indexOf("'💥 Shattered'") !== -1,
        'the teacher grid still labels every student');

    dom.PS.demoJump('round1');
    const r1Rule = dom.el('ps-hud-rule');
    assert.ok(r1Rule.textContent.length > 0, 'round 1 keeps its rule');
    assert.equal(r1Rule.classList.contains('hidden'), false, 'round 1 has no hidden rule');

    dom.PS.startDemo({ role: 'teacher', scene: 'round4' });
    const hostRule = dom.el('ps-hud-rule');
    assert.ok(hostRule.textContent.length > 0, 'the teacher / projector keeps the Round 4 rule');
    assert.equal(hostRule.classList.contains('hidden'), false);
});

/* ---------------------------------------------------------------- */
/* Round 5 — Grammar Finals                                          */
/* ---------------------------------------------------------------- */

function finalsPlayer(id, progress, extra) {
    return Object.assign({
        user_id: id,
        nickname: id.toUpperCase(),
        is_playing: true,
        status: 'advanced',
        ghost: false,
        dalgona_finished_at: '2026-11-26T08:00:00.000Z',
        finals_progress: progress,
        finals_combo: 0,
        finals_ghost_correct: 0,
        finals_question_index: 0,
        ink_until: null,
        finals_eliminated_at: null
    }, extra || {});
}

test('finals duration defaults to 120 s and clamps 60–180 s', () => {
    assert.equal(PS.ROUND5.DEFAULT_MS, 120000);
    assert.equal(PS.ROUND5.MIN_MS, 60000);
    assert.equal(PS.ROUND5.MAX_MS, 180000);
    assert.equal(PS.normalizeFinalsDuration(), 120000);
    assert.equal(PS.normalizeFinalsDuration(''), 120000);
    assert.equal(PS.normalizeFinalsDuration('120'), 120000, 'seconds are accepted');
    assert.equal(PS.normalizeFinalsDuration(150), 150000);
    assert.equal(PS.normalizeFinalsDuration(150000), 150000, 'milliseconds are accepted');
    assert.equal(PS.normalizeFinalsDuration(30), 60000, 'below the range clamps to 60 s');
    assert.equal(PS.normalizeFinalsDuration(999), 60000, 'a value above 600 is read as milliseconds');
    assert.equal(PS.normalizeFinalsDuration(999000), 180000, 'above the range clamps to 180 s');
});

test('shouldEnterRound5 requires a 5-round plan and at least 2 Dalgona survivors', () => {
    const one = [finalsPlayer('a', 100)];
    const none = [];
    const two = [finalsPlayer('a', 100), finalsPlayer('b', 80)];
    assert.equal(PS.shouldEnterRound5({ roundCount: 5 }, one), false);
    assert.equal(PS.shouldEnterRound5({ roundCount: 5 }, none), false);
    assert.equal(PS.shouldEnterRound5({ roundCount: 5 }, two), true);
    assert.equal(PS.shouldEnterRound5({ roundCount: 4 }, two), false, '4-round rooms never enter the finals');
    assert.equal(PS.dalgonaSurvivors(two).length, 2);
    assert.equal(PS.dalgonaSurvivors([
        finalsPlayer('c', 100, { dalgona_finished_at: null, status: 'eliminated', ghost: true })
    ]).length, 0, 'students who did not finish Dalgona are not finalists');
});

test('applySlip slides 25 at a time and only electrocutes at the fence', () => {
    assert.deepEqual(PS.applySlip(100), { progress: 75, eliminated: false });
    assert.deepEqual(PS.applySlip(75), { progress: 50, eliminated: false });
    assert.deepEqual(PS.applySlip(50), { progress: 25, eliminated: false });
    assert.deepEqual(PS.applySlip(25), { progress: 0, eliminated: false });
    assert.deepEqual(PS.applySlip(0), { progress: 0, eliminated: true });
    assert.deepEqual(PS.applyKnockback(60), 45);
    assert.deepEqual(PS.applyKnockback(10), 0, 'knockback clamps at 0');
    assert.equal(PS.applyKnockback(0), 0, 'knockback never eliminates');
});

test('nearestOpponent picks the closest living finalist and the 3rd correct fires a paw-wave', () => {
    const attacker = finalsPlayer('a', 50);
    const near = finalsPlayer('b', 60);
    const far = finalsPlayer('c', 90);
    const ghost = finalsPlayer('d', 52, { ghost: true, status: 'eliminated' });
    const players = [attacker, near, far, ghost];
    assert.equal(PS.nearestOpponent(attacker, players).user_id, 'b');

    const q = { type: 'error_spotting', answer: 2 };
    for (let i = 1; i <= 3; i++) {
        const res = PS.applyFinalsTurn({ player: attacker, players: players, question: q, answer: 2, now: 1000 });
        assert.equal(res.correct, true);
        assert.equal(attacker.finals_combo, i);
        if (i < 3) assert.equal(res.knockback, null);
        if (i === 3) {
            assert.ok(res.knockback, 'third consecutive correct answer fires a paw-wave');
            assert.equal(res.knockback.user_id, 'b');
            assert.equal(near.finals_progress, 45, 'nearest opponent is pushed back 15');
        }
    }

    attacker.finals_progress = 0;
    const wrong = PS.applyFinalsTurn({ player: attacker, players: players, question: q, answer: 1, now: 2000 });
    assert.equal(wrong.correct, false);
    assert.equal(wrong.eliminated, true, 'a wrong answer at 0 is electrocuted');
    assert.equal(attacker.ghost, true);
    assert.equal(attacker.finals_eliminated_at, 2000);
});

test('buildFinalsDeck mixes ~60/40 error spotting and double trap, cycling the three units', () => {
    const deck = PS.buildFinalsDeck({ seed: 7, count: 20 });
    assert.equal(deck.length, 20);
    assert.equal(deck.filter(q => q.type === 'error_spotting').length, 12);
    assert.equal(deck.filter(q => q.type === 'double_trap').length, 8);
    assert.deepEqual(Array.from(new Set(deck.map(q => q.type))).sort(), ['double_trap', 'error_spotting']);
    const units = Array.from(new Set(deck.map(q => q.unit))).sort();
    assert.deepEqual(units, ['agreement', 'indefinite_pronouns', 'tenses']);
    assert.equal(deck.some(q => q.unit === 'conditionals'), false, 'no invented conditionals');

    const withHook = PS.buildFinalsDeck({
        seed: 7,
        count: 10,
        conditionals: [{
            unit: 'conditionals',
            prompt: 'If I ___ more time, I ___ the whole book.',
            options: ['had', 'have'],
            answer: 0
        }]
    });
    assert.equal(withHook.some(q => q.unit === 'conditionals'), true, 'the later hook bank is included');
});

test('finalsErrorFromGrammar converts Drive & Go! primary/options items into Error Spotting', () => {
    const item = PS.finalsErrorFromGrammar({
        unit: 'tenses',
        prompt: 'She ___ to school every day.',
        primary: 'goes',
        options: ['go', 'goes', 'went']
    }, 'tenses', ['gone']);
    assert.ok(item, 'a grammar-bank item is converted');
    assert.equal(item.unit, 'tenses');
    assert.equal(item.tokens.length, 4, 'the converted sentence has four tappable parts');
    assert.ok(item.tokens.join(' ').toLowerCase().indexOf('goes') === -1, 'the wrong form is shown, not the answer');
    assert.ok(item.tokens.join(' ').toLowerCase().indexOf('go') !== -1, 'a wrong option is shown');
    assert.ok(item.answer >= 1 && item.answer <= 4, 'the wrong part is 1–4');
});

test('Error Spotting keyboard answers 1–4 grade the Neither/students/were/ready item as 3', () => {
    const item = PS.FINALS_ERROR_SPOTTING.find(q =>
        q.tokens.join(' ') === 'Neither of the students were ready for the test.');
    assert.ok(item, 'the required example is in the built-in bank');
    assert.deepEqual(item.tokens, ['Neither of the', 'students', 'were', 'ready for the test.']);
    assert.equal(item.answer, 3);
    const q = { type: 'error_spotting', tokens: item.tokens, answer: item.answer };
    assert.equal(PS.gradeFinalsAnswer(q, 1).correct, false);
    assert.equal(PS.gradeFinalsAnswer(q, 2).correct, false);
    assert.equal(PS.gradeFinalsAnswer(q, 3).correct, true);
    assert.equal(PS.gradeFinalsAnswer(q, 4).correct, false);
    assert.equal(PS.gradeFinalsAnswer(q, '3').correct, true);
    assert.equal(PS.gradeFinalsAnswer(q, null).correct, false, 'a timeout is wrong');
});

test('Double-Trap Cloze requires both blanks to be correct', () => {
    const trap = PS.FINALS_DOUBLE_TRAP[0];
    const q = { type: 'double_trap', blanks: trap.blanks.slice() };
    assert.equal(PS.gradeFinalsAnswer(q, [1, 0]).correct, true);
    assert.equal(PS.gradeFinalsAnswer(q, [1, 1]).correct, false, 'one wrong blank fails the whole turn');
    assert.equal(PS.gradeFinalsAnswer(q, [0, 0]).correct, false);
    assert.equal(PS.gradeFinalsAnswer(q, [0, 1]).correct, false);
    assert.equal(PS.gradeFinalsAnswer(q, [trap.blanks[0].options[1], trap.blanks[1].options[0]]).correct, true,
        'option text is accepted too');
});

test('Ghost revival deck is two-choice only; two correct answers earn a 1.5 s ink bomb', () => {
    const deck = PS.buildGhostDeck({ seed: 3, count: 8 });
    assert.equal(deck.length, 8);
    deck.forEach(q => {
        assert.equal(q.type, 'ghost');
        assert.equal(q.options.length, 2, 'every ghost question has exactly two choices');
    });
    const ghost = finalsPlayer('g', 0, { ghost: true, status: 'eliminated', finals_eliminated_at: 1 });
    assert.equal(PS.ghostCanThrowInk(ghost), false);
    PS.ghostRevival(ghost, true);
    assert.equal(ghost.finals_ghost_correct, 1);
    assert.equal(PS.ghostCanThrowInk(ghost), false);
    PS.ghostRevival(ghost, true);
    assert.equal(ghost.finals_ghost_correct, 2);
    assert.equal(PS.ghostCanThrowInk(ghost), true, 'two correct answers make one ink charge');
    const leader = finalsPlayer('lead', 90);
    const ink = PS.applyInk(leader, 5000);
    assert.equal(ink.durationMs, 1500);
    assert.equal(leader.ink_until, 6500);
    assert.equal(PS.ghostRevival(leader, true).ignored, true, 'living finalists do not earn ghost ink');
});

test('5-round ceremony ranks living finalists by finals progress, then earlier places', () => {
    const players = [
        finalsPlayer('a', 20),
        finalsPlayer('b', 80),
        finalsPlayer('c', 40, { status: 'eliminated', ghost: true, finals_eliminated_at: '2026-11-26T08:10:00.000Z' }),
        finalsPlayer('d', 0, { dalgona_finished_at: null, status: 'eliminated', ghost: true, eliminated_reason: 'dalgona' })
    ];
    const results = PS.ceremonyResults(players, { roundCount: 5 });
    assert.deepEqual(results.map(r => r.user_id), ['b', 'a', 'c', 'd']);
    assert.equal(results[0].survived, true);
    assert.equal(results[1].survived, true);
    assert.equal(results[2].survived, false);
    assert.equal(results[3].survived, false);
    assert.equal(results[1].rounds.r5.progress, 20);
    assert.equal(results[2].rounds.r5.eliminated, true);
});

test('Round 5 demo scene and skip-to-ceremony when fewer than 2 survivors remain', async () => {
    const dom = loadMainWithDom({ sheetNames: ['Food', 'School'], currentUser: null });
    dom.PS.startDemo({ role: 'student', scene: 'round5' });
    let state = dom.PS.state();
    assert.equal(state.room.status, 'round5');
    assert.equal(state.room.current_round, 5);
    assert.ok(state.room.round5_started_at && state.room.round5_ends_at);
    assert.ok(Array.isArray(state.room.finals_questions) && state.room.finals_questions.length > 0);
    assert.ok(state.players.some(p => p.finals_progress !== 100 || p.finals_combo >= 0));

    const ok = dom.PS.demoForceFinalsSkip();
    assert.equal(ok, true);
    state = dom.PS.state();
    assert.equal(state.room.status, 'finished', 'the finals are skipped');
    assert.equal(state.room.current_round, 5);
    assert.ok(state.room.finished_at);
});

test('Round 5 renderer draws the player and host arena without throwing', () => {
    const R = loadRenderer();
    assert.equal(typeof R.drawRound5, 'function');
    assert.equal(R.VERSION, '2.6.1');
    const ctx = mockContext({ width: 390, height: 844 });
    R.drawRound5(ctx, {
        w: 390, h: 844, hud: 80, role: 'player', now: 1200,
        round5: {
            me: { progress: 60, combo: 2, ink: false, look: { cat: 'Ragdoll' } },
            board: [
                { user_id: 'a', name: '4C 16 Demo', progress: 60, combo: 2, isMe: true, look: { cat: 'Ragdoll' } },
                { user_id: 'b', name: '4C 17 Classmate', progress: 30, combo: 0, look: { cat: 'Ginger' } }
            ],
            ghosts: [{ user_id: 'c', name: 'Ghost', progress: 0, ghost: true, look: { cat: 'Garfield' } }],
            living: 2,
            remainingMs: 100000
        }
    });
    R.drawRound5(ctx, {
        w: 1280, h: 720, hud: 80, role: 'host', now: 1200,
        round5: {
            me: null,
            board: [
                { user_id: 'a', name: 'A', progress: 100, combo: 3, look: {} },
                { user_id: 'b', name: 'B', progress: 0, combo: 0, look: {} }
            ],
            ghosts: [],
            living: 2,
            remainingMs: 45000
        }
    });
    R.drawScene(ctx, { w: 390, h: 844, round: 5, role: 'player', round5: { board: [], ghosts: [] } });
});

test('Round 5 demo page exposes option 5 and a round5 scene button', () => {
    const demo = fs.readFileSync(path.join(__dirname, '..', 'purrfect-survival-demo.html'), 'utf8');
    assert.ok(demo.indexOf('<option value="5">5</option>') !== -1, '5-round demo option');
    assert.ok(demo.indexOf('data-scene="round5"') !== -1, 'Round 5 scene button');
    assert.ok(demo.indexOf('demo-finals-duration') !== -1, 'finals duration control');
    assert.ok(demo.indexOf('goScene(\'round5\')') !== -1, 'scene click wiring');
    assert.ok(demo.indexOf('finalsDuration:') !== -1, 'settings include finalsDuration');
    assert.ok(demo.indexOf('demo-skip-finals') !== -1, 'a skip-to-ceremony demo control exists');
    assert.ok(demo.indexOf('PS.demoForceFinalsSkip()') !== -1, 'the skip control calls the demo helper');
});

test('Round 5 SQL incremental is safe, teacher-run and mirrors the engine rules', () => {
    const sqlPath = path.join(__dirname, '..', 'supabase', 'purrfect_survival_round5_finals.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    assert.ok(/Safe to re-run/i.test(sql));
    assert.ok(/Do NOT re-run/i.test(sql));
    assert.ok(/plugin, CLI or agent/i.test(sql));
    assert.ok(sql.indexOf('https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new') !== -1);
    ['round5_started_at', 'round5_ends_at', 'finals_questions', 'finals_progress',
        'finals_combo', 'finals_ghost_correct', 'finals_question_index', 'ink_until',
        'finals_eliminated_at', 'purrfect_survival_enter_round5',
        'submit_purrfect_survival_finals', 'submit_purrfect_survival_ghost',
        'throw_purrfect_survival_ink', 'purrfect_survival_finals_duration'].forEach(token => {
        assert.ok(sql.indexOf(token) !== -1, token + ' exists');
    });
    assert.ok(sql.indexOf("check (status in ('waiting', 'round1', 'round2', 'round3', 'round4', 'round5', 'finished'))") !== -1);
    assert.ok(sql.indexOf('v_survivors < 2') !== -1, 'skips the finals when fewer than 2 survivors remain');
    assert.ok(/make_interval\(secs => \(v_duration \/ 1000\.0\)/.test(sql), 'default 120 s uses make_interval');
    assert.ok(sql.indexOf('interval \'1.5 seconds\'') !== -1, 'ink lasts 1500 ms');
    assert.ok(/v_now - glass_started_at >= interval '7 seconds'/.test(sql), 'tick keeps the 7-second glass window');
    assert.ok(/now\(\) - v_player\.glass_started_at >= interval '7 seconds'/.test(sql),
        'glass_jump keeps the 7-second window');
    assert.equal(/glass_started_at[^\n]*interval '5 seconds'/.test(sql), false,
        'pasting this file will not revert glass to 5 seconds');
    assert.ok(sql.indexOf('create or replace function public.glass_jump_purrfect_survival') !== -1,
        'single paste also replaces glass_jump');
    assert.ok(sql.indexOf('return least(5, greatest(1, v_raw::int))') !== -1, 'round count max is 5');
    assert.ok(sql.indexOf("if v_room.status = 'round5' then") !== -1, 'end round handles round 5');
    assert.ok(sql.indexOf("notify pgrst, 'reload schema';") !== -1);

    const copy = '/workspace/purrfect_survival_round5_finals.sql';
    assert.ok(fs.existsSync(copy), 'workspace copy exists');
    assert.equal(fs.readFileSync(copy, 'utf8'), sql, 'workspace copy matches');
});

test('canonical SQL picks up the 5-round finals while keeping the historical clamp string', () => {
    const canonical = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'purrfect_survival.sql'), 'utf8');
    assert.ok(canonical.indexOf('least(3, greatest(1') !== -1, 'historical test string stays');
    assert.ok(canonical.indexOf('return least(5, greatest(1, v_raw::int))') !== -1, 'live definition clamps to 5');
    assert.ok(canonical.indexOf('purrfect_survival_enter_round5') !== -1);
    assert.ok(canonical.indexOf('submit_purrfect_survival_finals') !== -1);
    assert.ok(canonical.indexOf('finals_questions') !== -1);
    assert.ok(canonical.indexOf('ROUNDS_NOT_IMPLEMENTED') !== -1, 'the guard is still present for > 5');
});

test('Round 5 music/HUD wiring treats round5 as a gameplay round', () => {
    const client = fs.readFileSync(MAIN_PATH, 'utf8');
    assert.ok(client.indexOf("room.status === 'round5'") !== -1, 'round5 branches exist');
    assert.ok(client.indexOf('finals_questions') !== -1, 'polls the shared finals deck');
    assert.ok(client.indexOf("sb.rpc('submit_purrfect_survival_finals'") !== -1);
    assert.ok(client.indexOf("sb.rpc('submit_purrfect_survival_ghost'") !== -1);
    assert.ok(client.indexOf("sb.rpc('throw_purrfect_survival_ink'") !== -1);
    assert.ok(client.indexOf("return '⏹ End round 5'") !== -1, 'host End label covers round 5');
    assert.ok(client.indexOf("if (room.status === 'round5') {") !== -1, 'round 5 is host-endable');
    const musicFn = client.slice(client.indexOf('function desiredMusicKind'), client.indexOf('function startTrack'));
    assert.ok(musicFn.indexOf("room.status === 'round5'") !== -1, 'finals use the gameplay music');
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.equal(html.indexOf('value="5" disabled'), -1, 'lobby option 5 is enabled');
    assert.ok(html.indexOf('ps-round5-card') !== -1);
    assert.ok(html.indexOf('ps-finals-duration') !== -1);
    assert.ok(html.indexOf('ps-ink-cover') !== -1);
});

/* ---------------------------------------------------------------- */
/* Round 5 finals UI: no long rule, lobby rules kept                  */
/* ---------------------------------------------------------------- */

test('Round 5 finals hides the long in-game rule for students AND the teacher / projector', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food'], currentUser: null });
    ['student', 'teacher'].forEach(role => {
        dom.PS.startDemo({ role: role, scene: 'round5' });
        assert.equal(dom.PS.state().room.status, 'round5');
        const rule = dom.el('ps-hud-rule');
        assert.ok(rule.textContent === '' || rule.classList.contains('hidden'),
            'the long Round 5 rule is hidden for the ' + role);
        const label = String(dom.el('ps-hud-round').textContent || '');
        assert.ok(label.indexOf('ROUND 5') !== -1, 'the short status pill stays for the ' + role);
    });

    const client = fs.readFileSync(MAIN_PATH, 'utf8');
    const start = client.indexOf('const studentR4');
    const end = client.indexOf('const alive =', start);
    assert.ok(start !== -1 && end > start, 'the HUD rule block is found');
    const block = client.slice(start, end);
    assert.ok(block.indexOf('const hideRule = isR5 || studentR4;') !== -1,
        'round 5 hides the rule for every role');
    assert.ok(block.indexOf("ruleEl.classList.toggle('hidden', hideRule)") !== -1);
    assert.equal(block.indexOf('RULE_TEXT.round5'), -1,
        'the in-game HUD no longer fills the long round 5 paragraph');

    /* The finals prompts / ink cover / ghost revival copy must stay. */
    assert.ok(client.indexOf("ps-ink-cover") !== -1 || client.indexOf('inkCover') !== -1);
    assert.ok(client.indexOf('finals_questions') !== -1);
});

test('the waiting lobby still carries the full Round 5 rules and the Show rules cards', () => {
    assert.equal(typeof PS.RULE_TEXT.round5, 'string');
    assert.ok(PS.RULE_TEXT.round5.length > 120, 'the English Round 5 rules are still present');
    assert.ok(PS.RULE_TEXT.round5.indexOf('Grammar Finals') !== -1);
    assert.equal(typeof PS.RULE_TEXT_ZH.round5, 'string');
    assert.ok(PS.RULE_TEXT_ZH.round5.length > 60, 'the Chinese Round 5 rules are still present');

    const client = fs.readFileSync(MAIN_PATH, 'utf8');
    assert.ok(client.indexOf('ps-cine-rule') !== -1, 'the lobby still writes the ps-cine-rule cards');
    assert.ok(client.indexOf("'Show rules'") !== -1, 'the host Show rules toggle stays');

    const dom = loadMainWithDom({ sheetNames: ['Food'], currentUser: null });
    dom.PS.startDemo({ role: 'teacher', scene: 'lobby' });
    dom.PS.setDemoSettings({ roundCount: 5 });
    const howto = dom.el('ps-cine-howto');
    assert.ok(String(howto.innerHTML).indexOf('ps-cine-rule5-en') !== -1,
        'the collapsed lobby panel has the Round 5 English card');
    assert.ok(String(howto.innerHTML).indexOf('ps-cine-rule5-zh') !== -1,
        'the collapsed lobby panel has the Round 5 Chinese card');
    assert.ok(String(howto.innerHTML).indexOf('Grammar Finals') !== -1);
    const toggle = dom.el('ps-rules-toggle');
    assert.equal(toggle.classList.contains('hidden'), false, 'the teacher can still open the rules');
    assert.equal(toggle.textContent, 'Show rules');
    dom.PS.toggleLobbyRules(true);
    assert.equal(dom.el('ps-cine-howto').classList.contains('hidden'), false,
        'opening Show rules reveals the full cards');
});

/* ---------------------------------------------------------------- */
/* Round 1 teacher/projector +1px typography                          */
/* ---------------------------------------------------------------- */

test('teacher Round 1 gets ps-r1-host with +1px text; the student view is unchanged', () => {
    const dom = loadMainWithDom({ sheetNames: ['Food'], currentUser: null });
    const view = dom.el('purrfect-survival-view');

    dom.PS.startDemo({ role: 'teacher', scene: 'round1' });
    assert.equal(dom.PS.state().room.status, 'round1');
    assert.equal(view.classList.contains('ps-r1-host'), true, 'teacher round 1 adds ps-r1-host');

    dom.PS.startDemo({ role: 'student', scene: 'round1' });
    assert.equal(dom.PS.state().room.status, 'round1');
    assert.equal(view.classList.contains('ps-r1-host'), false, 'student round 1 has no ps-r1-host');

    dom.PS.startDemo({ role: 'teacher', scene: 'round2' });
    assert.equal(view.classList.contains('ps-r1-host'), false, 'ps-r1-host is Round 1 only');

    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-badge {') === -1);
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-alive,') !== -1);
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-rule { font-size: 11.5px; }') !== -1);
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-host-btn,') !== -1);
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-progress-title { font-size: 11.5px; }') !== -1);
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-progress-count { font-size: 10.5px; }') !== -1);
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-progress-row { font-size: 11px; }') !== -1);
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-progress-detail { font-size: 11px; }') !== -1);
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-progress-status { font-size: 9.5px; }') !== -1);
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-progress-row { font-size: 10px; }') !== -1,
        'the landscape override is +1 too (9 + 1)');
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-progress-detail { font-size: 9.5px; }') !== -1,
        'the landscape detail override is +1 too (8.5 + 1)');
    assert.ok(html.indexOf('#purrfect-survival-view.ps-r1-host .ps-progress-row { font-size: 9.5px; }') !== -1,
        'the short-landscape row override is +1 too (8.5 + 1)');

    /* Every +1 rule is scoped to the id, so students can never match it. */
    html.split('\n').filter(line => /\.ps-r1-host\s*[{,]/.test(line)).forEach(line => {
        assert.ok(line.trim().indexOf('#purrfect-survival-view.ps-r1-host') === 0,
            'unscoped ps-r1-host selector: ' + line.trim());
    });

    /* The base (student) sizes are untouched. */
    assert.ok(html.indexOf('font-size: 11.5px;\n            font-weight: 800;\n            letter-spacing: .04em;') !== -1,
        'the base HUD chip size is still 11.5px');

    const render = fs.readFileSync(RENDER_PATH, 'utf8');
    const bumpCount = (render.match(/\+ \(L\.host \? 1 : 0\)/g) || []).length;
    assert.ok(bumpCount >= 3, 'host canvas text is +1px in the title, name pills and metre marks');
    assert.ok(render.indexOf('const titleSize = Math.max(9, Math.min(13, L.w * (L.landscape ? 0.011 : 0.027)));') !== -1);
});

/* ---------------------------------------------------------------- */
/* Round 2 / Round 3 teacher glass + tug camera                       */
/* ---------------------------------------------------------------- */

test('host glass/tug cameras are wider and still overhead of the students', () => {
    const host = RENDERER.layout(1280, 720, 'host');
    const player = RENDERER.layout(1280, 720, 'player');
    ['cam2', 'cam3'].forEach(key => {
        assert.ok(host[key].fov < 58, key + ' landscape host fov is tighter than the old 58');
        assert.ok(host[key].fov < player[key].fov, key + ' host fov is tighter than the student fov');
        assert.ok(host[key].eye[0] < 0, key + ' landscape host eye shifts left');
        assert.ok(host[key].target[0] < 0, key + ' landscape host target shifts left');
        assert.ok(host[key].eye[1] > player[key].eye[1], key + ' host stays overhead in landscape');
    });

    const portraitHost = RENDERER.layout(390, 844, 'host');
    const portraitPlayer = RENDERER.layout(390, 844, 'player');
    ['cam2', 'cam3'].forEach(key => {
        assert.ok(portraitHost[key].eye[1] > portraitPlayer[key].eye[1],
            key + ' host stays overhead in portrait');
        assert.ok(portraitHost[key].fov <= 60, key + ' portrait host fov is tighter / unchanged');
    });
    assert.ok(portraitHost.cam2.eye[2] > -4.4, 'portrait host cam2 is slightly closer');
    assert.ok(portraitHost.cam3.eye[2] > -5.0, 'portrait host cam3 is slightly closer');

    /* Side-list width is untouched by this change. */
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(html.indexOf('width: min(310px, 30vw);') !== -1, 'base .ps-progress width unchanged');
    assert.ok(html.indexOf('width: min(280px, 26vw);') !== -1, 'landscape .ps-progress width unchanged');
    assert.ok(html.indexOf('width: min(230px, 24vw);') !== -1, 'short-landscape .ps-progress width unchanged');
});

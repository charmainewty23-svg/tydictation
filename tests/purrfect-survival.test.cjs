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
    assert.ok(html.indexOf('木頭貓') !== -1);
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

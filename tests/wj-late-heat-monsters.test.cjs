// No network, credentials, dependencies or database writes. Exercise the actual Word Jump code in js/word-jump.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
// The app JavaScript now lives in js/ files; Word Jump is js/word-jump.js.
const wordJump = fs.readFileSync(path.join(__dirname, '../js/word-jump.js'), 'utf8');
const APP_SCRIPTS = ['shared', 'dictation', 'new-vocab', 'grammar-quest', 'grammar/tenses-quiz',
    'leaderboard', 'admin', 'word-battle', 'word-jump'];

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function loadWJ() {
    const context = vm.createContext({
        SHEET_NAMES: ['animals and pets', 'space', 'colours'],
        categories: {},
        primaryAnswer: (en) => String(en || '').split('/')[0].trim(),
        currentTopic: '',
        currentUser: null,
        localStorage: { getItem() { return '0'; }, setItem() {}, removeItem() {} },
        sessionStorage: { getItem() { return '0'; }, setItem() {}, removeItem() {} },
        document: {
            body: { classList: { contains() { return false; }, add() {}, remove() {} } },
            getElementById() { return null; },
            fullscreenElement: null,
            webkitFullscreenElement: null
        },
        window: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
        requestAnimationFrame() { return 1; },
        cancelAnimationFrame() {},
        console,
        escapeHtml: (s) => String(s == null ? '' : s),
        topicLabel: (s) => s,
        isGuestUser: () => false,
        canUseCloud: () => false,
        previewStudentForm: () => false,
        recordGuestUsage() {},
        Math, Date, Number, String, Array, Object, parseInt, isFinite
    });
    context.window = context;
    const start = wordJump.indexOf('        const WJ = {');
    const end = wordJump.indexOf('        /* ==========================================================\n           Word Jump Challenge friends', start);
    assert.ok(start > 0 && end > start, 'could not slice WJ block');
    vm.runInContext(wordJump.slice(start, end) + '\nthis.WJ = WJ;', context);
    return context.WJ;
}

test('all production scripts parse', () => {
    for (const [, code] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(code);
    for (const name of APP_SCRIPTS) new vm.Script(fs.readFileSync(path.join(__dirname, '../js', name + '.js'), 'utf8'));
});

test('similar-meaning distractors prefer the same topic and never copy the answer', () => {
    const WJ = loadWJ();
    WJ.rng = mulberry32(7);
    const pool = WJ.BACKUP_WORDS.map(p => ({ en: p[0], zh: p[1], topic: p[2] }));
    const target = pool.find(w => w.en === 'tiger');
    const got = WJ.pickDistractors(target, pool, 3, true);
    assert.equal(got.length, 3);
    assert.ok(got.every(w => w.en !== 'tiger'));
    const ens = got.map(w => w.en);
    assert.equal(new Set(ens).size, ens.length, 'no duplicate distractors');
    assert.ok(ens.includes('dragon') && ens.includes('rabbit'), 'same-topic animals first: ' + ens.join(','));
    assert.equal(got[0].topic, 'animals');
    assert.equal(got[1].topic, 'animals');
});

test('below 10000, distractors stay random and are not forced to the same topic', () => {
    const WJ = loadWJ();
    WJ.bonus = 0; WJ.maxClimb = 60000; // score 6000
    assert.equal(WJ.lateHeat3(), 0);
    WJ.rng = () => 0.99; // pick last items when shuffling
    const pool = WJ.BACKUP_WORDS.map(p => ({ en: p[0], zh: p[1], topic: p[2] }));
    const target = pool.find(w => w.en === 'tiger');
    const got = WJ.pickDistractors(target, pool, 3, false);
    assert.equal(got.length, 3);
    assert.ok(got.every(w => w.en !== 'tiger'));
    // With similar=false the shuffle is random, not ranked by topic — at least
    // one of the three need not be an animal when the pool is mixed.
    assert.ok(got.some(w => w.topic !== 'animals'), 'random fallback is not topic-locked: ' + got.map(w => w.en).join(','));
});

test('backup-only wordPool still yields similar-meaning distractors', () => {
    const WJ = loadWJ();
    WJ.topic = '__all__';
    const pool = WJ.wordPool();
    assert.ok(pool.length >= 20);
    assert.ok(pool.every(w => w.topic));
    const target = pool.find(w => w.en === 'yellow');
    const got = WJ.pickDistractors(target, pool, 3, true);
    const colourHits = got.filter(w => w.topic === 'colours').map(w => w.en);
    assert.ok(colourHits.includes('orange') && colourHits.includes('silver'));
    assert.ok(got.every(w => w.en !== 'yellow'));
});

test('twin monsters only after 10000, same altitude, with a passable gap, and never on a quiz row', () => {
    const WJ = loadWJ();
    const pl = { x: 160, w: 80, y: -20000 };
    const always = () => 0; // spawn chance and twin chance both fire

    WJ.challenge = false;
    WJ.bonus = 0;
    WJ.maxClimb = 60000; // score 6000 — no heat3
    WJ.quizRows = [];
    WJ.nextQuizY = -999999;
    WJ.monsters = [];
    WJ.rng = always;
    const before = WJ.trySpawnMonsters(pl, -20000);
    assert.equal(before, 1, 'below 10000 only a single monster');
    assert.equal(WJ.monsters.length, 1);

    WJ.monsters = [];
    WJ.maxClimb = 110000; // score 11000
    assert.equal(WJ.lateHeat3(), 1);
    WJ.rng = always;
    const twins = WJ.trySpawnMonsters(pl, -20000);
    assert.equal(twins, 2);
    assert.equal(WJ.monsters.length, 2);
    assert.equal(WJ.monsters[0].y, WJ.monsters[1].y);
    const a = WJ.monsters[0], b = WJ.monsters[1];
    const left = a.baseX < b.baseX ? a : b;
    const right = a.baseX < b.baseX ? b : a;
    const gap = (right.baseX - right.range - right.r) - (left.baseX + left.range + left.r);
    assert.ok(gap >= 70, 'passable gap between twins, got ' + gap);

    WJ.monsters = [];
    WJ.quizRows = [{ y: -20000, resolved: false }];
    WJ.rng = always;
    assert.equal(WJ.trySpawnMonsters(pl, -20000), 0, 'no monsters on a quiz-tile row');
    assert.equal(WJ.monsters.length, 0);

    WJ.quizRows = [];
    WJ.placeMonster(200, -20000, 26);
    assert.equal(WJ.monsters.length, 1);
    WJ.cullMonstersNearQuiz(-20000);
    assert.equal(WJ.monsters.length, 0, 'cull removes monsters sitting on a new quiz row');
});

test('shield gadgets stop after 7000; streak grant is unchanged', () => {
    const WJ = loadWJ();
    WJ.challenge = false;
    WJ.bonus = 0;
    WJ.maxClimb = 60000; // 6000
    assert.ok(WJ.gadgetKindsAt(-60000).includes('shield'));
    WJ.maxClimb = 70000; // 7000
    assert.equal(WJ.lateHeat() >= 0.5, true);
    assert.equal(WJ.gadgetKindsAt(-70000).includes('shield'), false);

    WJ.challenge = true;
    WJ.maxClimb = 0;
    WJ.bonus = 99999; // local score must not affect Challenge world-gen
    assert.ok(WJ.gadgetKindsAt(-60000).includes('shield'), 'challenge at 6000 height still has shield gadgets');
    assert.equal(WJ.gadgetKindsAt(-70000).includes('shield'), false);

    const src = wordJump;
    assert.match(src, /if \(WJ\.streak > 0 && WJ\.streak % 5 === 0\)/);
    assert.match(src, /WJ\.player\.shield = Math\.max\(WJ\.player\.shield, 8\)/);
});

test('after 10000, horizontal speed rises modestly and maxGap is unchanged', () => {
    const WJ = loadWJ();
    WJ.challenge = false;
    WJ.bonus = 0;
    WJ.maxClimb = 3200; // fully ramped
    const gap = 80;
    const baseCap = WJ.speedCap();
    const baseAt = WJ.speedAt(3200);
    const baseBudget = WJ.horizBudget(gap, 3200);
    const gapLimit = WJ.maxGap();
    assert.equal(baseCap, WJ.MOVE_MAX);
    assert.equal(baseAt, WJ.MOVE_MAX);

    WJ.maxClimb = 99990; // score 9999
    assert.equal(WJ.lateHeat3(), 0);
    assert.equal(WJ.speedCap(), WJ.MOVE_MAX);
    assert.equal(WJ.maxGap(), gapLimit);

    WJ.maxClimb = 100000; // score 10000
    assert.equal(WJ.lateHeat3(), 1);
    assert.equal(WJ.speedMulAt(0), 1 + WJ.HEAT3_SPEED_BONUS);
    assert.ok(Math.abs(WJ.speedCap() - WJ.MOVE_MAX * 1.12) < 1e-9);
    assert.ok(Math.abs(WJ.speedAt(100000) - WJ.MOVE_MAX * 1.12) < 1e-9);
    assert.equal(WJ.maxGap(), gapLimit, 'jump height / maxGap must not change');
    const hotBudget = WJ.horizBudget(gap, 100000);
    assert.ok(hotBudget > baseBudget, 'faster speed must widen the reach budget, not shrink it');

    // Challenge: heat3 follows climb, not bonus points
    WJ.challenge = true;
    WJ.bonus = 50000;
    WJ.maxClimb = 90000;
    assert.equal(WJ.heat3At(-90000), 0);
    assert.equal(WJ.speedMulAt(90000), 1);
    WJ.maxClimb = 100000;
    assert.equal(WJ.heat3At(-100000), 1);
    assert.equal(WJ.speedMulAt(100000), 1 + WJ.HEAT3_SPEED_BONUS);
});

test('platforms generated after 10000 still respect maxGap', () => {
    const WJ = loadWJ();
    WJ.challenge = true;
    WJ.rng = mulberry32(42);
    WJ.platforms = [];
    WJ.quizRows = [];
    WJ.monsters = [];
    WJ.ufos = [];
    WJ.holes = [];
    WJ.anchors = [];
    WJ.durable = [];
    WJ.afterQuiz = false;
    WJ.maxClimb = 100000;
    WJ.bonus = 0;
    WJ.topY = -100000;
    WJ.nextQuizY = -100400;
    const start = { x: WJ.W / 2 - 46, y: -100000, w: 92, h: 13, type: 'green', baseX: WJ.W / 2 - 46, baseY: -100000, amp: 0 };
    WJ.platforms.push(start);
    WJ.commitLayer([start], true);
    WJ.genUpTo(-103500);
    assert.ok(WJ.platforms.length > 8, 'generated a stretch of late-heat platforms');
    const maxGap = WJ.maxGap();
    const byY = WJ.platforms.slice().sort((a, b) => b.y - a.y);
    let lastFoot = byY[0].y + (byY[0].type === 'gray' ? (byY[0].amp || 0) : 0);
    for (let i = 1; i < byY.length; i++) {
        const pl = byY[i];
        const destTop = pl.y - (pl.type === 'gray' ? (pl.amp || 0) : 0);
        const rise = lastFoot - destTop;
        assert.ok(rise <= maxGap + 1.5, `gap ${rise.toFixed(1)} exceeds maxGap ${maxGap} at y=${pl.y}`);
        if (pl.type !== 'brown') lastFoot = pl.y + (pl.type === 'gray' ? (pl.amp || 0) : 0);
    }
    for (const row of WJ.quizRows) {
        for (const m of WJ.monsters) {
            assert.ok(Math.abs(m.y - row.y) >= 90, 'monster sits on a quiz row at ' + row.y);
        }
    }
    const twins = {};
    for (const m of WJ.monsters) {
        const key = String(Math.round(m.y));
        twins[key] = (twins[key] || 0) + 1;
    }
    // Not required to roll a twin in this stretch, but if one appears it must be exactly two at that y with a gap.
    Object.keys(twins).forEach(k => {
        if (twins[k] < 2) return;
        assert.equal(twins[k], 2);
        const pair = WJ.monsters.filter(m => String(Math.round(m.y)) === k);
        const left = pair[0].baseX < pair[1].baseX ? pair[0] : pair[1];
        const right = pair[0].baseX < pair[1].baseX ? pair[1] : pair[0];
        const gap = (right.baseX - right.range - right.r) - (left.baseX + left.range + left.r);
        assert.ok(gap >= 70, 'generated twin gap ' + gap);
    });
});

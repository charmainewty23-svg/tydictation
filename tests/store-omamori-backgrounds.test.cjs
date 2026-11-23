// Omamori props + Japanese PNG backgrounds: catalogue, cover-fit maths,
// preview wiring and SQL. No network, no browser, no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const storePath = path.join(root, 'js/store.js');
const racePath = path.join(root, 'js/grammar/drive-and-go-race.js');
const dgPath = path.join(root, 'js/grammar/drive-and-go.js');
const battlePath = path.join(root, 'js/word-battle.js');
const htmlPath = path.join(root, 'index.html');
const storeSqlPath = path.join(root, 'supabase/store.sql');
const incrementalSqlPath = path.join(root, 'supabase/store_omamori_and_backgrounds.sql');
const shrineFujiSqlPath = path.join(root, 'supabase/store_shrine_fuji_prices.sql');

const storeSource = fs.readFileSync(storePath, 'utf8');
const raceSource = fs.readFileSync(racePath, 'utf8');
const dgSource = fs.readFileSync(dgPath, 'utf8');
const battleSource = fs.readFileSync(battlePath, 'utf8');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');
const storeSql = fs.readFileSync(storeSqlPath, 'utf8');
const incrementalSql = fs.readFileSync(incrementalSqlPath, 'utf8');
const shrineFujiSql = fs.readFileSync(shrineFujiSqlPath, 'utf8');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ASSETS = [
    { file: 'assets/props/omamori-pass-exam.png', w: 591, h: 900 },
    { file: 'assets/props/omamori-academic.png', w: 900, h: 785 },
    { file: 'assets/backgrounds/bg-shrine.png', w: 1600, h: 900 },
    { file: 'assets/backgrounds/bg-fuji.png', w: 1382, h: 776 }
];

const noop = () => {};
const escapeHtml = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadStore() {
    const context = vm.createContext({
        window: { addEventListener: noop },
        document: {
            getElementById() { return null; },
            querySelectorAll() { return []; },
            addEventListener: noop,
            body: { classList: { add: noop, remove: noop } }
        },
        console,
        localStorage: { getItem() { return null; }, setItem: noop, removeItem: noop },
        sessionStorage: { getItem() { return null; }, setItem: noop, removeItem: noop },
        escapeHtml,
        sb: {},
        setTimeout,
        clearTimeout,
        canUseCloud: () => false,
        isGuestUser: () => false,
        previewStudentForm: () => false,
        isAdmin: () => false,
        updateMascot: noop
    });
    vm.runInContext(storeSource, context);
    return context;
}

test('the four PNGs exist with the expected IHDR size and alpha', () => {
    for (const asset of ASSETS) {
        const p = path.join(root, asset.file);
        assert.ok(fs.existsSync(p), asset.file + ' is committed');
        const buf = fs.readFileSync(p);
        assert.ok(buf.length > 100, asset.file + ' is not an empty placeholder');
        assert.deepEqual([...buf.subarray(0, 8)], PNG_SIGNATURE, asset.file + ' has a PNG signature');
        assert.equal(buf.toString('ascii', 12, 16), 'IHDR', asset.file + ' IHDR comes first');
        assert.equal(buf.readUInt32BE(16), asset.w, asset.file + ' width');
        assert.equal(buf.readUInt32BE(20), asset.h, asset.file + ' height');
        assert.equal(buf[25], 6, asset.file + ' is RGBA (colour type 6)');
    }
});

test('catalog: the four items carry the right ids, paths, prices and zh', () => {
    const store = loadStore();
    const items = store.window.STORE_ITEMS;
    const expected = [
        { id: 'prop_omamori_exam', name: 'Pass the Exam / 逢考必過', zh: '逢考必過', slot: 'prop', price: 240, emoji: '🧧', img: '/assets/props/omamori-pass-exam.png' },
        { id: 'prop_omamori_study', name: 'Academic Success / 學業成就', zh: '學業成就', slot: 'prop', price: 240, emoji: '🎓', img: '/assets/props/omamori-academic.png' },
        { id: 'bg_shrine', name: 'Shrine / 神社', zh: '神社', slot: 'background', price: 519, emoji: '⛩️', img: '/assets/backgrounds/bg-shrine.png' },
        { id: 'bg_fuji', name: 'Mount Fuji / 富士山', zh: '富士山', slot: 'background', price: 528, emoji: '🗻', img: '/assets/backgrounds/bg-fuji.png' }
    ];
    for (const want of expected) {
        const item = items.find(it => it.id === want.id);
        assert.ok(item, want.id + ' exists');
        assert.equal(item.name, want.name);
        assert.equal(item.zh, want.zh, want.id + ' has Chinese text (never undefined)');
        assert.equal(item.slot, want.slot);
        assert.equal(item.price, want.price, want.id + ' price is the BASE price');
        assert.equal(item.rarity, 'Epic', want.id + ' rarity is Title Case');
        assert.equal(item.emoji, want.emoji);
        assert.equal(item.img, want.img, want.id + ' uses a leading-slash path');
        assert.ok(item.desc && item.desc.length > 5, want.id + ' has a description');
    }
});

test('displayed shop prices use storeBasePrice (10% rise included)', () => {
    const store = loadStore();
    const items = store.window.STORE_ITEMS;
    const shrine = items.find(it => it.id === 'bg_shrine');
    const fuji = items.find(it => it.id === 'bg_fuji');
    assert.equal(store.storeBasePrice(shrine), 570, 'Shrine displays 570');
    assert.equal(store.storeBasePrice(fuji), 580, 'Mount Fuji displays 580');
});

test('storeLayerGroup: omamori get their own group, other props stay props', () => {
    const store = loadStore();
    const items = store.window.STORE_ITEMS;
    const byId = id => items.find(it => it.id === id);

    assert.equal(store.storeLayerGroup(byId('prop_omamori_exam')), 'omamori');
    assert.equal(store.storeLayerGroup(byId('prop_omamori_study')), 'omamori');
    assert.equal(store.storeLayerGroup(byId('prop_corgi')), 'prop');
    assert.equal(store.storeLayerGroup(byId('prop_boombox')), 'prop');
    assert.equal(store.storeLayerGroup(byId('bg_shrine')), 'background');
    assert.equal(store.storeLayerGroup(byId('bg_fuji')), 'background');

    // A bare slot string must keep its old meaning.
    assert.equal(store.storeLayerGroup('prop'), 'prop');
    assert.equal(store.storeLayerGroup('background'), 'background');
});

test('STORE_NEW_IDS lists all four new ids first, existing ids still present', () => {
    const store = loadStore();
    const newIds = vm.runInContext('STORE_NEW_IDS', store);
    assert.deepEqual(
        Array.from(newIds.slice(0, 4)),
        ['prop_omamori_exam', 'prop_omamori_study', 'bg_shrine', 'bg_fuji']
    );
    for (const id of ['prop_white_flag', 'prop_rubber_duck', 'prop_red_pen', 'prop_tea_scone', 'prop_corgi', 'prop_boombox', 'prop_cozy_desk']) {
        assert.ok(newIds.indexOf(id) !== -1, id + ' is still in STORE_NEW_IDS');
    }
});

test('storeCoverFitRect: 1600×900 into a square covers and centres', () => {
    const store = loadStore();
    const r = store.storeCoverFitRect(1600, 900, 200, 200);
    assert.equal(r.scale, 200 / 900);
    assert.equal(r.dh, 200);
    assert.ok(r.dw >= 200);
    assert.ok(Math.abs(r.dx - (200 - (1600 * (200 / 900))) / 2) < 1e-9);
    assert.equal(r.dy, 0);
});

test('storeCoverFitRect: wide short frame is fully covered with no gaps', () => {
    const store = loadStore();
    const w = 1000, h = 300;
    const r = store.storeCoverFitRect(1382, 776, w, h);
    assert.ok(r.dx <= 0 && r.dy <= 0, 'drawn rect starts outside the top/left edges');
    assert.ok(r.dx + r.dw >= w - 1e-9, 'covers the full width');
    assert.ok(r.dy + r.dh >= h - 1e-9, 'covers the full height');
    assert.ok(r.dw >= w && r.dh >= h);

    // And the actual helper forwards those coordinates to drawImage.
    const calls = [];
    const ok = store.storeDrawImageCover(
        { drawImage(...args) { calls.push(args); } },
        { naturalWidth: 1382, naturalHeight: 776 },
        w, h
    );
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(Array.from(calls[0].slice(1)), [r.dx, r.dy, r.dw, r.dh]);
    assert.equal(store.storeDrawImageCover(null, null, w, h), false, 'missing args are safe');
});

test('shop markup: omamori use <img>, background cards keep their canvas', () => {
    const store = loadStore();
    const items = store.window.STORE_ITEMS;
    const exam = items.find(it => it.id === 'prop_omamori_exam');
    const study = items.find(it => it.id === 'prop_omamori_study');
    const shrine = items.find(it => it.id === 'bg_shrine');

    for (const item of [exam, study]) {
        const thumb = store.storeItemThumbHTML(item, 'card');
        assert.match(thumb, /^<img /);
        assert.ok(thumb.includes('src="' + item.img + '"'));
        assert.ok(thumb.includes('alt="' + item.name + '"'));
        const card = store.storeCardHTML(item);
        assert.ok(card.includes('src="' + item.img + '"'), item.id + ' card shows the PNG');
        assert.ok(card.includes(item.zh), item.id + ' card shows the Chinese name');
    }

    const shrineCard = store.storeCardHTML(shrine);
    assert.ok(shrineCard.includes('<canvas class="store-card-bg" data-store-bg="bg_shrine"'));
    assert.ok(!shrineCard.includes('<img '), 'background cards paint their own canvas');
});

test('storePaintBackground has an img cover-fit branch before the hand-drawn art', () => {
    const start = storeSource.indexOf('function storePaintBackground');
    const end = storeSource.indexOf("if (bg.id === 'bg_pink')", start);
    assert.ok(start !== -1 && end > start);
    const early = storeSource.slice(start, end);
    assert.ok(early.includes('bg.img'), 'checks for an image');
    assert.ok(early.includes('storeDrawImageCover'), 'uses the shared cover-fit helper');
    assert.ok(early.includes('storeCatalogImage'), 'uses the shared image cache');
    assert.ok(early.includes('return;'), 'stops before the hand-drawn branches');
});

test('previews render image backgrounds on every store surface', () => {
    const dgPreview = dgSource.slice(dgSource.indexOf('renderCatPreview()'), dgSource.indexOf('renderCatPreview()') + 2600);
    assert.ok(dgPreview.includes('storePaintBackground'), 'Drive & Go lobby calls storePaintBackground');

    const battlePreview = battleSource.slice(
        battleSource.indexOf('function battleDrawCatPreview'),
        battleSource.indexOf('function battleRenderCatCustomizer')
    );
    assert.ok(battlePreview.includes('storeFillBackgroundBase'), 'Word Battle paints the base');
    assert.ok(battlePreview.includes('storePaintBackground'), 'Word Battle paints the image background');
});

test('store items preview wiring and preloader exist', () => {
    assert.match(storeSource, /function storeCatalogImage\(src\)/);
    assert.match(storeSource, /function storePreloadCatalogImages\(\)/);
    assert.match(storeSource, /typeof Image === 'undefined'/, 'safe in Node');
    assert.ok(storeSource.includes('storePaintCardBackgrounds(document)'), 'reloads shop cards');
    assert.ok(storeSource.includes('DG.redrawCatPreviews()'), 'repaints Me / lobby previews');
    assert.ok(storeSource.includes("if (typeof Image !== 'undefined')"), 'guarded at script load');
});

test('DG.drawCatProps forwards the catalog item and any img prop uses drawImage', () => {
    assert.ok(raceSource.includes('DG.drawCatProp(ctx, name, x, h * 0.86, S, item)'), 'item passed through');
    assert.ok(raceSource.includes('storeItemByName(name)'), 'falls back to the catalog by name');

    const drawStart = raceSource.indexOf('DG.drawCatProp = function (ctx, name, x, y, S, item)');
    const cozy = raceSource.indexOf("} else if (name === 'Cozy Desk')", drawStart);
    assert.ok(drawStart !== -1 && cozy > drawStart);
    const generic = raceSource.slice(drawStart, cozy);
    assert.ok(generic.includes("catalog && catalog.img && name !== 'Mini Corgi'"), 'generic img branch');
    assert.ok(generic.includes('ctx.drawImage(img'), 'draws the PNG');
    assert.ok(generic.includes('img.naturalWidth / img.naturalHeight'), 'preserves aspect ratio');
    assert.ok(generic.includes('ground(0, 30)'), 'stands on a ground shadow');

    // Mini Corgi's own branch must still exist and use its dedicated image.
    const corgiStart = raceSource.indexOf("} else if (name === 'Mini Corgi') {");
    const boombox = raceSource.indexOf("} else if (name === 'Boombox') {", corgiStart);
    assert.ok(corgiStart !== -1 && boombox > corgiStart);
    const corgi = raceSource.slice(corgiStart, boombox);
    assert.ok(corgi.includes('DG.corgiArtImage()'), 'Mini Corgi preloader untouched');
    assert.ok(corgi.includes('ctx.drawImage(img'), 'Mini Corgi still draws its PNG');

    assert.match(raceSource, /'Pass the Exam \/ 逢考必過': 1\.06,/);
    assert.match(raceSource, /'Academic Success \/ 學業成就': 1\.06,/);
});

test('index.html has the Omamori tab and the New group is retitled', () => {
    assert.ok(htmlSource.includes('data-store-cat="omamori"'));
    assert.ok(htmlSource.includes("storeSetCategory('omamori')"));
    assert.ok(storeSource.includes("omamori: 'Omamori / 御守'"));
    assert.ok(storeSource.includes("'prop', 'omamori', 'background'"), 'All tab order');
    assert.ok(storeSource.includes("✨ New</h3>"));
    assert.ok(!storeSource.includes('✨ New in Props'), 'old group title is gone');
});

test('SQL: main insert and historic incremental keep their rows; new file reprices shrine/fuji', () => {
    const rowRe = (id, slot, name, zh, price, sort) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
        return new RegExp("\\('" + id + "',\\s*'" + slot + "',\\s*'" + escaped + "',\\s*'" + zh + "',\\s*" + price + ",\\s*'Epic',[^,]+,\\s*" + sort + "\\)");
    };

    // Main install SQL carries the four rows with the current shrine/fuji bases.
    for (const [id, slot, name, zh, price, sort] of [
        ['prop_omamori_exam', 'prop', 'Pass the Exam / 逢考必過', '逢考必過', 240, 67],
        ['prop_omamori_study', 'prop', 'Academic Success / 學業成就', '學業成就', 240, 68],
        ['bg_shrine', 'background', 'Shrine / 神社', '神社', 519, 69],
        ['bg_fuji', 'background', 'Mount Fuji / 富士山', '富士山', 528, 70]
    ]) {
        assert.match(storeSql, rowRe(id, slot, name, zh, price, sort), id + ' main row with price ' + price + ' and sort ' + sort);
    }

    // The already-run omamori incremental is historical: it may keep 220/240.
    assert.match(incrementalSql, rowRe('bg_shrine', 'background', 'Shrine / 神社', '神社', 220, 69));
    assert.match(incrementalSql, rowRe('bg_fuji', 'background', 'Mount Fuji / 富士山', '富士山', 240, 70));
    assert.match(incrementalSql, /on conflict \(id\) do update set/i);
    assert.match(incrementalSql, /notify pgrst, 'reload schema';/);
    assert.match(incrementalSql, /Safe to re-run/i);
    assert.match(incrementalSql, /Supabase SQL editor/i);

    // The new incremental only reprices shrine/fuji.
    assert.match(shrineFujiSql, rowRe('bg_shrine', 'background', 'Shrine / 神社', '神社', 519, 69));
    assert.match(shrineFujiSql, rowRe('bg_fuji', 'background', 'Mount Fuji / 富士山', '富士山', 528, 70));
    assert.match(shrineFujiSql, /on conflict \(id\) do update set/i);
    assert.match(shrineFujiSql, /notify pgrst, 'reload schema';/);
    assert.match(shrineFujiSql, /Safe to re-run/i);
    assert.match(shrineFujiSql, /Supabase SQL editor/i);
    assert.ok(!shrineFujiSql.includes('prop_omamori_exam'), 'new file does not touch omamori');
    assert.ok(!shrineFujiSql.includes('prop_omamori_study'), 'new file does not touch omamori');
});

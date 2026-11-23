// Mini Corgi art: pre-cut PNG for the shop thumbnails and the in-game prop.
// No network, no browser, no database. Source inspection + a real PNG header
// check, plus the catalog helper executed in a tiny vm sandbox.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'assets/props/mini-corgi.png');
const storeSource = fs.readFileSync(path.join(root, 'js/store.js'), 'utf8');
const raceSource = fs.readFileSync(path.join(root, 'js/grammar/drive-and-go-race.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const PNG_SRC = '/assets/props/mini-corgi.png';

const noop = () => {};
const escapeHtml = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Load js/store.js just far enough to use the catalog and the thumbnail
   helper. The file is a classic script, so its top-level functions become
   properties of the sandbox global. */
function loadStore() {
    const context = vm.createContext({
        window: { addEventListener: noop },
        document: {
            getElementById() { return null; },
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

/* Text of one Mini Corgi branch in DG.drawCatProp. */
function corgiBranch() {
    const start = raceSource.indexOf("} else if (name === 'Mini Corgi') {");
    assert.ok(start !== -1, 'Mini Corgi branch exists in DG.drawCatProp');
    const end = raceSource.indexOf("} else if (name === 'Boombox') {", start);
    assert.ok(end > start, 'Mini Corgi branch is followed by the Boombox branch');
    return raceSource.slice(start, end);
}

test('assets/props/mini-corgi.png is a 818×905 PNG with an alpha channel', () => {
    assert.ok(fs.existsSync(pngPath), 'PNG is committed in assets/props/');
    const buf = fs.readFileSync(pngPath);
    assert.ok(buf.length > 100, 'PNG is not an empty placeholder');
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
    assert.equal(buf.toString('ascii', 12, 16), 'IHDR', 'IHDR chunk comes first');
    assert.equal(buf.readUInt32BE(16), 818, 'IHDR width');
    assert.equal(buf.readUInt32BE(20), 905, 'IHDR height');
    const colorType = buf[25];
    assert.ok(colorType === 6 || colorType === 4, 'IHDR colour type is RGBA (6) or gray+alpha (4), got ' + colorType);
});

test('catalog: only Mini Corgi gets the cut-out PNG', () => {
    const store = loadStore();
    const items = store.window.STORE_ITEMS;
    const corgi = items.find(it => it.id === 'prop_corgi');
    assert.ok(corgi, 'prop_corgi exists');
    assert.equal(corgi.name, 'Mini Corgi');
    assert.equal(corgi.zh, '迷你哥基犬');
    assert.equal(corgi.slot, 'prop');
    assert.equal(corgi.price, 510);
    assert.equal(corgi.rarity, 'Legendary');
    assert.equal(corgi.emoji, '🐕', 'emoji stays as a fallback');
    assert.equal(corgi.img, PNG_SRC);

    for (const id of ['prop_boombox', 'prop_rubber_duck', 'prop_white_flag', 'prop_cozy_desk', 'prop_tea_scone']) {
        const item = items.find(it => it.id === id);
        assert.ok(item, id + ' still exists');
        assert.ok(!item.img, id + ' must stay a vector / emoji prop');
    }
});

test('storeItemThumbHTML renders an <img> for Mini Corgi and emoji for everything else', () => {
    const store = loadStore();
    const items = store.window.STORE_ITEMS;
    const corgi = items.find(it => it.id === 'prop_corgi');
    const boombox = items.find(it => it.id === 'prop_boombox');

    const card = store.storeItemThumbHTML(corgi, 'card');
    assert.match(card, /^<img /);
    assert.match(card, /class="store-card-emoji store-thumb-img"/);
    assert.ok(card.includes('src="' + PNG_SRC + '"'));
    assert.ok(card.includes('alt="Mini Corgi"'));
    assert.doesNotMatch(card, /🐕/);

    // Market rows only carry item_id + emoji from the server.
    const market = store.storeItemThumbHTML({ item_id: 'prop_corgi', emoji: '🐕' }, 'market');
    assert.match(market, /^<img /);
    assert.match(market, /class="store-market-emoji store-thumb-img"/);
    assert.ok(market.includes('src="' + PNG_SRC + '"'));

    // Gacha RPC returns the item id in `item`.
    const gacha = store.storeItemThumbHTML({ item: 'prop_corgi', name: 'Mini Corgi', emoji: '🐕' }, 'gacha');
    assert.match(gacha, /class="store-gacha-emoji store-thumb-img"/);
    assert.ok(gacha.includes('src="' + PNG_SRC + '"'));

    // Other props keep the existing emoji markup.
    const other = store.storeItemThumbHTML(boombox, 'card');
    assert.equal(other, '<div class="store-card-emoji" aria-hidden="true">📻</div>');
    const unknown = store.storeItemThumbHTML({ item_id: 'nope', emoji: '🦆' }, 'market');
    assert.equal(unknown, '<div class="store-market-emoji" aria-hidden="true">🦆</div>');

    // src/alt are escaped.
    const weird = store.storeItemThumbHTML({ id: 'nope', img: '/a".png', name: '<Corgi>' }, 'card');
    assert.ok(weird.includes('src="/a&quot;.png"'));
    assert.ok(weird.includes('alt="&lt;Corgi&gt;"'));
});

test('storeCardHTML uses the thumbnail helper for the Mini Corgi card', () => {
    const store = loadStore();
    const corgi = store.window.STORE_ITEMS.find(it => it.id === 'prop_corgi');
    const html = store.storeCardHTML(corgi);
    assert.ok(html.includes('<img '), 'shop card shows an image');
    assert.ok(html.includes('src="' + PNG_SRC + '"'));
    assert.ok(html.includes('Mini Corgi'));
});

test('shop, market, sell list and gacha all call storeItemThumbHTML', () => {
    assert.match(storeSource, /function storeItemThumbHTML\(itemOrRow, kind\)/);
    assert.match(storeSource, /window\.storeItemThumbHTML = storeItemThumbHTML;/);

    const card = storeSource.slice(storeSource.indexOf('function storeCardHTML(item)'), storeSource.indexOf('/* ---------------- Fitting room'));
    assert.ok(card.includes("storeItemThumbHTML(item, 'card')"), 'storeCardHTML uses the helper');
    assert.ok(!/item\.emoji/.test(card), 'storeCardHTML no longer prints item.emoji directly');

    const market = storeSource.slice(storeSource.indexOf('function storeRenderMarketList(rows)'), storeSource.indexOf('function storeBuybackPrice'));
    assert.ok(market.includes("storeItemThumbHTML(row, 'market')"), 'market rows use the helper');

    const sell = storeSource.slice(storeSource.indexOf('function storeRenderSellList(rows)'), storeSource.indexOf('async function storeSellItem'));
    assert.ok(sell.includes("storeItemThumbHTML(it, 'market')"), 'sell rows use the helper');

    const gacha = storeSource.slice(storeSource.indexOf('async function storePullGacha()'), storeSource.indexOf('function storeRenderMarket'));
    assert.ok(gacha.includes("storeItemThumbHTML({ id: r.item, name: r.name, emoji: r.emoji }, 'gacha')"), 'gacha resolves the catalog item from r.item');
    // The generic error fallbacks keep their emoji.
    assert.ok(gacha.includes('store-gacha-emoji" aria-hidden="true">🐾'));
    assert.ok(gacha.includes('store-gacha-emoji" aria-hidden="true">🛠️'));
    assert.ok(gacha.includes('store-gacha-emoji" aria-hidden="true">😿'));
});

test('index.html CSS sizes the image inside the emoji slots', () => {
    assert.ok(htmlSource.includes('.store-thumb-img'));
    assert.match(htmlSource, /\.store-thumb-img\s*\{[^}]*object-fit:\s*contain/);
    assert.match(htmlSource, /img\.store-card-emoji\s*\{[^}]*width/);
    assert.match(htmlSource, /img\.store-market-emoji\s*\{[^}]*width/);
    assert.match(htmlSource, /img\.store-gacha-emoji\s*\{[^}]*width/);
    // Emoji sizing rules are untouched.
    assert.match(htmlSource, /\.store-card-emoji\s*\{\s*font-size:\s*2\.6rem/);
    assert.match(htmlSource, /\.store-market-emoji\s*\{\s*font-size:\s*1\.7rem/);
    assert.match(htmlSource, /\.store-gacha-emoji\s*\{\s*font-size:\s*2\.6rem/);
});

test('DG.drawCatProp draws the preloaded PNG with a ground shadow', () => {
    const branch = corgiBranch();
    assert.ok(branch.includes('ground(0, 30)'), 'shadow stays');
    assert.ok(branch.includes('DG.corgiArtImage()'), 'uses the shared preload');
    assert.ok(branch.includes('ctx.drawImage(img'), 'draws the PNG');
    assert.ok(branch.includes('DG.CORGI_ART_W / DG.CORGI_ART_H'), 'keeps the PNG aspect ratio');
    assert.ok(branch.includes('img.complete && img.naturalWidth'), 'waits for the image instead of flashing a vector');
    assert.ok(!branch.includes('#d97706'), 'old vector legs removed');
    assert.ok(!branch.includes('#fb7185'), 'old vector nose removed');
    assert.ok(!branch.includes('// ears'), 'old vector ears comment removed');
    assert.ok(!branch.includes('quadraticCurveTo'), 'old vector tail removed');
    assert.ok(!branch.includes('#f59e0b'), 'no old corgi body fill remains under this branch');
});

test('Mini Corgi PNG is preloaded and triggers a preview redraw', () => {
    assert.match(raceSource, /DG\.CORGI_ART_SRC = '\/assets\/props\/mini-corgi\.png';/);
    assert.match(raceSource, /DG\.CORGI_ART_W = 818;/);
    assert.match(raceSource, /DG\.CORGI_ART_H = 905;/);

    const preload = raceSource.slice(raceSource.indexOf('DG.corgiArtImage = function'), raceSource.indexOf('DG.redrawCatPreviews = function'));
    assert.ok(preload.includes("typeof Image === 'undefined'"), 'Node vm without Image does not throw');
    assert.ok(preload.includes('new Image()'));
    assert.ok(preload.includes('img.src = DG.CORGI_ART_SRC'));
    assert.ok(preload.includes('DG.redrawCatPreviews()'), 'redraws when the PNG finishes loading');

    const redraw = raceSource.slice(raceSource.indexOf('DG.redrawCatPreviews = function'), raceSource.indexOf('if (typeof Image !=='));
    for (const fn of ['storeRenderProfileLook', 'storeRepaintFitting', 'DG.renderCatPreview', 'battleDrawCatPreview']) {
        assert.ok(redraw.includes(fn), 'redraw calls ' + fn);
    }
    assert.ok((redraw.match(/try \{/g) || []).length >= 1, 'each preview repaint is wrapped in try/catch');

    assert.match(raceSource, /if \(typeof Image !== 'undefined'\) \{\s*try \{ DG\.corgiArtImage\(\); \} catch \(e\)/);
    assert.equal((raceSource.match(/DG\.PROP_SCALE =/g) || []).length, 1);
    assert.match(raceSource, /'Mini Corgi': 1\.02,/);
});

test('other props are still vector drawings', () => {
    const branches = ['Boombox', 'Rubber Duck', 'White Flag', 'Cozy Desk'];
    for (const name of branches) {
        const marker = "name === '" + name + "'";
        const at = raceSource.indexOf(marker);
        assert.ok(at !== -1, name + ' branch exists');
        const start = raceSource.lastIndexOf('if (', at);
        const rest = raceSource.slice(at);
        const stop = rest.search(/\n        \} else/);
        const body = raceSource.slice(start, stop === -1 ? at + 600 : at + stop);
        assert.ok(body.includes('fillStyle') || body.includes('strokeStyle'), name + ' still paints a vector shape');
        assert.ok(!body.includes('drawImage'), name + ' is not using the corgi PNG');
    }
});

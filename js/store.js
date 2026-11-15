/* LearniTY — Store, Paws, owned skins.
   Loaded after shared.js and before the games. Catalog prices must match
   supabase/store.sql (the server checks the price again when buying). */

const STORE_ITEMS = [
    // Hats & headwear
    { id:'hat_sprout', slot:'hat', name:'Sprout Clip', zh:'小草髮夾', price:80, rarity:'Common', emoji:'🌱', color:'#22c55e', desc:'A tiny green sprout on the head.' },
    { id:'hat_lofi', slot:'hat', name:'Lo-Fi Headphones', zh:'復古耳機', price:140, rarity:'Rare', emoji:'🎧', color:'#92400e', desc:'Wooden headphones for listening practice.' },
    { id:'hat_straw', slot:'hat', name:'Straw Hat', zh:'草帽', price:100, rarity:'Common', emoji:'👒', color:'#fbbf24', desc:'A summer straw hat with a red ribbon.' },
    { id:'hat_frog', slot:'hat', name:'Frog Hood', zh:'青蛙頭套', price:160, rarity:'Rare', emoji:'🐸', color:'#4ade80', desc:'A green frog hood.' },
    { id:'hat_chef', slot:'hat', name:'Chef Hat', zh:'廚師高帽', price:120, rarity:'Rare', emoji:'👨‍🍳', color:'#f8fafc', desc:'A tall white chef hat.' },
    { id:'hat_sherlock', slot:'hat', name:'Sherlock Cap', zh:'偵探獵鹿帽', price:150, rarity:'Rare', emoji:'🕵️', color:'#a16207', desc:'A checked deerstalker cap.' },
    { id:'hat_grad', slot:'hat', name:'Graduation Cap', zh:'學士四方帽', price:180, rarity:'Rare', emoji:'🎓', color:'#111827', desc:'A black mortarboard with a gold tassel.' },
    { id:'hat_bearskin', slot:'hat', name:'Bearskin Hat', zh:'英國衛兵高帽', price:220, rarity:'Epic', emoji:'🐻', color:'#111827', desc:'The tall black hat of a royal guard.' },
    { id:'hat_wizard', slot:'hat', name:'Wizard Hat', zh:'魔法師尖帽', price:240, rarity:'Epic', emoji:'🧙', color:'#312e81', desc:'A navy pointed hat with stars and moons.' },
    { id:'hat_astro', slot:'hat', name:'Astro Helmet', zh:'太空人頭罩', price:280, rarity:'Epic', emoji:'🚀', color:'#7dd3fc', desc:'A clear bubble space helmet.' },
    { id:'hat_gold_crown', slot:'hat', name:'Golden Crown', zh:'黃金皇冠', price:450, rarity:'Legendary', emoji:'👑', color:'#f59e0b', desc:'A king’s crown with red rubies.' },

    // Face & eyewear
    { id:'face_blush', slot:'face', name:'Blush Stickers', zh:'害羞紅暈', price:60, rarity:'Common', emoji:'😊', color:'#fb7185', desc:'Two pink blush lines.' },
    { id:'face_round', slot:'face', name:'Round Glasses', zh:'圓框學霸眼鏡', price:90, rarity:'Common', emoji:'👓', color:'#111827', desc:'Thin black round glasses.' },
    { id:'face_star', slot:'face', name:'Star Sunglasses', zh:'星星太陽眼鏡', price:170, rarity:'Rare', emoji:'⭐', color:'#fbbf24', desc:'Bold gold star-shaped sunglasses.' },
    { id:'face_pixel', slot:'face', name:'Pixel Sunglasses', zh:'像素黑超', price:140, rarity:'Rare', emoji:'😎', color:'#111827', desc:'Classic pixel “Thug Life” shades.' },
    { id:'face_patch', slot:'face', name:'Pirate Eyepatch', zh:'海盜眼罩', price:100, rarity:'Rare', emoji:'🏴‍☠️', color:'#111827', desc:'A black one-eye patch.' },
    { id:'face_monocle', slot:'face', name:'Monocle', zh:'紳士單片眼鏡', price:190, rarity:'Epic', emoji:'🧐', color:'#b45309', desc:'A gold monocle with a chain.' },
    { id:'face_visor', slot:'face', name:'Cyber Visor', zh:'賽博龐克護目鏡', price:240, rarity:'Epic', emoji:'🥽', color:'#22d3ee', desc:'A glowing neon-blue visor.' },

    // Neck & outfits
    { id:'outfit_scarf', slot:'outfit', name:'Red Scarf', zh:'紅色小領巾', price:80, rarity:'Common', emoji:'🧣', color:'#ef4444', desc:'A simple red neckerchief.' },
    { id:'outfit_bowtie', slot:'outfit', name:'Tweed Bow Tie', zh:'學院風煲呔', price:120, rarity:'Rare', emoji:'🎀', color:'#92400e', desc:'A brown checked tweed bow tie.' },
    { id:'outfit_bread', slot:'outfit', name:'Bread Collar', zh:'方包頸圈', price:150, rarity:'Rare', emoji:'🍞', color:'#fde68a', desc:'A slice of bread worn as a collar.' },
    { id:'outfit_boba', slot:'outfit', name:'Boba Apron', zh:'珍珠奶茶圍裙', price:140, rarity:'Rare', emoji:'🧋', color:'#16a34a', desc:'A green boba shop apron.' },
    { id:'outfit_raincoat', slot:'outfit', name:'Yellow Raincoat', zh:'黃色小雨衣', price:170, rarity:'Rare', emoji:'🧥', color:'#facc15', desc:'A bright yellow raincoat.' },
    { id:'outfit_guard', slot:'outfit', name:'Royal Guard Tunic', zh:'英國衛兵紅制服', price:220, rarity:'Epic', emoji:'🛡️', color:'#dc2626', desc:'A red royal guard tunic.' },
    { id:'outfit_ruff', slot:'outfit', name:'Shakespeare Ruff', zh:'莎士比亞蕾絲領', price:200, rarity:'Epic', emoji:'🎭', color:'#f8fafc', desc:'A white ruffled Elizabethan collar.' },
    { id:'outfit_shark', slot:'outfit', name:'Shark Onesie', zh:'鯊魚連身衣', price:260, rarity:'Epic', emoji:'🦈', color:'#64748b', desc:'A grey shark onesie.' },
    { id:'outfit_dragon', slot:'outfit', name:'Dragon Suit', zh:'恐龍連身衣', price:300, rarity:'Epic', emoji:'🐉', color:'#16a34a', desc:'A green spiky dragon suit.' },

    // Props & companions (Me / lobby only)
    { id:'prop_pencil', slot:'prop', name:'Pencil', zh:'巨大鉛筆', price:60, rarity:'Common', emoji:'✏️', color:'#facc15', desc:'A giant yellow HB pencil.' },
    { id:'prop_boba', slot:'prop', name:'Boba Tea', zh:'珍珠奶茶', price:90, rarity:'Common', emoji:'🧋', color:'#a16207', desc:'A brown sugar boba tea.' },
    { id:'prop_magnifier', slot:'prop', name:'Magnifying Glass', zh:'放大鏡', price:110, rarity:'Rare', emoji:'🔍', color:'#0f766e', desc:'A detective magnifying glass.' },
    { id:'prop_quill', slot:'prop', name:'Quill & Scroll', zh:'羽毛筆與羊皮紙', price:160, rarity:'Rare', emoji:'🪶', color:'#b45309', desc:'A quill and a scroll.' },
    { id:'prop_box', slot:'prop', name:'Cardboard Box', zh:'紙皮箱', price:120, rarity:'Rare', emoji:'📦', color:'#b45309', desc:'A “Fragile” delivery box.' },
    { id:'prop_dictionary', slot:'prop', name:'Floating Dictionary', zh:'懸浮魔法字典', price:220, rarity:'Epic', emoji:'📖', color:'#2563eb', desc:'A glowing dictionary that turns its own pages.' },
    { id:'prop_parrot', slot:'prop', name:'Mini Parrot', zh:'肩膀小鸚鵡', price:240, rarity:'Epic', emoji:'🦜', color:'#22c55e', desc:'A colourful parrot on your shoulder.' },

    // Backgrounds & effects (Me / lobby only)
    { id:'bg_desk', slot:'background', name:'Cozy Desk', zh:'溫書書桌', price:120, rarity:'Rare', emoji:'🛋️', color:'#d97706', desc:'A wooden desk with a lamp and tea.' },
    { id:'bg_library', slot:'background', name:'Oxford Library', zh:'牛津古書庫', price:200, rarity:'Epic', emoji:'📚', color:'#92400e', desc:'Tall wooden shelves and old lamps.' },
    { id:'bg_bigben', slot:'background', name:'Big Ben Rain', zh:'倫敦雨夜', price:220, rarity:'Epic', emoji:'🕰️', color:'#334155', desc:'Big Ben and rain at night.' },
    { id:'bg_galaxy', slot:'background', name:'Starry Galaxy', zh:'星空宇宙', price:240, rarity:'Epic', emoji:'🌌', color:'#1e1b4b', desc:'Planets and shooting stars.' },
    { id:'bg_aplus', slot:'background', name:'Floating A+', zh:'滿分飄浮特效', price:300, rarity:'Legendary', emoji:'💯', color:'#f59e0b', desc:'Glowing A+ marks and gold stars.' },
    { id:'bg_sakura', slot:'background', name:'Cherry Blossoms', zh:'櫻花飄落', price:180, rarity:'Rare', emoji:'🌸', color:'#f9a8d4', desc:'Pink cherry blossom petals.' },
    { id:'bg_cyber', slot:'background', name:'Cyber Grid', zh:'霓虹網格', price:260, rarity:'Epic', emoji:'🌐', color:'#7c3aed', desc:'Purple-blue neon grid lines.' }
];

window.STORE_ITEMS = STORE_ITEMS;

const STORE_BY_ID = {};
const STORE_BY_NAME = {};
STORE_ITEMS.forEach(it => {
    STORE_BY_ID[it.id] = it;
    STORE_BY_NAME[it.name] = it;
});
window.storeItemById = id => STORE_BY_ID[id] || null;
window.storeItemByName = name => STORE_BY_NAME[name] || null;

const STORE_FREE = {
    hat: ['None', 'Party Hat'],
    face: ['None', 'Glasses'],
    outfit: ['None', 'Racing Jacket']
};

let STORE_OWNED = {};
let STORE_EQUIPPED = {};
let STORE_BALANCE = 0;
let STORE_PAWS_TODAY = 0;
let STORE_MY_LOOK = null;
let STORE_LOADED = false;
let STORE_LOAD_ERROR = '';
let STORE_LOAD_PROMISE = null;
let STORE_CATEGORY = 'all';
let STORE_SYNCED_USER = '';

window.STORE_OWNED = STORE_OWNED;
window.STORE_EQUIPPED = STORE_EQUIPPED;

function storeAvailable() {
    return canUseCloud() && !isGuestUser() && !previewStudentForm();
}

function storeOwnedForSlot(slot) {
    return STORE_ITEMS.filter(it => it.slot === slot && (it.price === 0 || STORE_OWNED[it.id]));
}

/* Free items stay available; purchased store items appear only when owned. */
function storeLookOptions(slot, current) {
    const base = (STORE_FREE[slot] || ['None']).slice();
    storeOwnedForSlot(slot).forEach(it => {
        if (base.indexOf(it.name) === -1) base.push(it.name);
    });
    if (current && base.indexOf(current) === -1) base.push(current);
    return base;
}

function storeExtendDG() {
    if (typeof DG === 'undefined') return;
    const add = (arr, slot) => {
        STORE_ITEMS.filter(it => it.slot === slot).forEach(it => {
            if (arr.indexOf(it.name) === -1) arr.push(it.name);
        });
    };
    add(DG.HATS, 'hat');
    add(DG.GLASSES, 'face');
    add(DG.OUTFITS, 'outfit');
}

window.addEventListener('load', storeExtendDG);

async function loadStoreState(force) {
    if (STORE_LOAD_PROMISE && !force) return STORE_LOAD_PROMISE;
    if (!force && STORE_LOADED && !STORE_LOAD_ERROR && STORE_SYNCED_USER === (currentUser && currentUser.id)) return Promise.resolve();
    STORE_SYNCED_USER = currentUser && currentUser.id || '';
    STORE_LOAD_PROMISE = (async function () {
        const free = {};
        STORE_ITEMS.forEach(it => { if (it.price === 0) free[it.id] = true; });
        if (!storeAvailable()) {
            STORE_OWNED = free;
            STORE_EQUIPPED = {};
            STORE_BALANCE = 0;
            STORE_PAWS_TODAY = 0;
            STORE_LOADED = true;
            STORE_LOAD_ERROR = '';
            window.STORE_OWNED = STORE_OWNED;
            window.STORE_EQUIPPED = STORE_EQUIPPED;
            storeApplyEquippedToDG();
            return;
        }
        try {
            const [bal, purchases, equipped] = await Promise.all([
                sb.rpc('my_paw_balance'),
                sb.from('store_purchases').select('item_id').eq('user_id', currentUser.id),
                sb.from('store_equipped').select('slot,item_id').eq('user_id', currentUser.id)
            ]);
            if (bal.error) throw bal.error;
            if (purchases.error) throw purchases.error;
            if (equipped.error) throw equipped.error;
            STORE_OWNED = free;
            (purchases.data || []).forEach(row => { if (row && row.item_id) STORE_OWNED[row.item_id] = true; });
            STORE_EQUIPPED = {};
            (equipped.data || []).forEach(row => {
                if (row && row.slot && row.item_id) STORE_EQUIPPED[row.slot] = row.item_id;
            });
            STORE_BALANCE = Math.max(0, Number(bal.data) || 0);
            try {
                const todayRes = await sb.rpc('my_paws_today');
                STORE_PAWS_TODAY = (!todayRes.error) ? Math.max(0, Number(todayRes.data) || 0) : 0;
            } catch (e) { STORE_PAWS_TODAY = 0; }
            STORE_LOAD_ERROR = '';
            STORE_LOADED = true;
            window.STORE_OWNED = STORE_OWNED;
            window.STORE_EQUIPPED = STORE_EQUIPPED;
            // Cross-device look (cat + free/store names). Optional: older
            // installs without profile_looks still work.
            try {
                const lookRes = await sb.from('profile_looks')
                    .select('cat,hat,face,outfit')
                    .eq('user_id', currentUser.id)
                    .maybeSingle();
                if (!lookRes.error && lookRes.data) storeApplyProfileLookToDG(lookRes.data);
                STORE_MY_LOOK = (!lookRes.error && lookRes.data) ? lookRes.data : null;
            } catch (e) {}
            storeApplyEquippedToDG();
        } catch (e) {
            STORE_OWNED = free;
            STORE_EQUIPPED = {};
            STORE_BALANCE = 0;
            STORE_PAWS_TODAY = 0;
            STORE_LOAD_ERROR = 'Store needs supabase/store.sql in the Supabase SQL editor.';
            STORE_LOADED = true;
            window.STORE_OWNED = STORE_OWNED;
            window.STORE_EQUIPPED = STORE_EQUIPPED;
            console.warn('Store unavailable:', e && (e.message || e));
        }
    })();
    const result = await STORE_LOAD_PROMISE;
    STORE_LOAD_PROMISE = null;
    if (typeof storeRenderProfileLook === 'function') storeRenderProfileLook();
    if (currentView === 'store-view') renderStore();
    return result;
}

function storeApplyEquippedToDG() {
    if (typeof DG === 'undefined' || !DG.readSettings) return;
    const s = DG.readSettings();
    let changed = false;
    ['hat', 'face', 'outfit'].forEach(slot => {
        const id = STORE_EQUIPPED[slot];
        if (!id) return;
        const item = STORE_BY_ID[id];
        if (!item) return;
        const key = slot === 'face' ? 'glasses' : slot;
        if (s[key] !== item.name) { s[key] = item.name; changed = true; }
    });
    // Never let a saved store name be used before it is owned (or free).
    ['hat', 'face', 'outfit'].forEach(slot => {
        const key = slot === 'face' ? 'glasses' : slot;
        const item = STORE_BY_NAME[s[key]];
        if (item && item.price > 0 && !STORE_OWNED[item.id]) {
            s[key] = 'None';
            changed = true;
        }
    });
    if (changed) DG.saveSettings();
}

function storeApplyProfileLookToDG(look) {
    if (!look || typeof DG === 'undefined' || !DG.readSettings) return;
    const s = DG.readSettings();
    if (look.cat && DG.CATS.indexOf(look.cat) !== -1) s.cat = look.cat;
    if (look.hat) s.hat = look.hat;
    if (look.face) s.glasses = look.face;
    if (look.outfit) s.outfit = look.outfit;
    DG.saveSettings();
}

function saveProfileLook() {
    if (!storeAvailable() || typeof DG === 'undefined' || !DG.readSettings) return;
    const s = DG.readSettings();
    STORE_MY_LOOK = { cat: s.cat, hat: s.hat, face: s.glasses, outfit: s.outfit };
    try {
        sb.rpc('save_profile_look', {
            p_cat: s.cat,
            p_hat: s.hat,
            p_face: s.glasses,
            p_outfit: s.outfit
        }).then(() => {}, () => {});
    } catch (e) {}
}

function storeMyLook() {
    const s = (typeof DG !== 'undefined' && DG.readSettings) ? DG.readSettings() : {};
    const own = STORE_MY_LOOK || {};
    const equippedName = slot => {
        const id = STORE_EQUIPPED[slot];
        const item = id ? STORE_BY_ID[id] : null;
        return item ? item.name : '';
    };
    return {
        cat: own.cat || s.cat || 'Ginger',
        hat: equippedName('hat') || own.hat || s.hat || 'None',
        glasses: equippedName('face') || own.face || s.glasses || 'None',
        outfit: equippedName('outfit') || own.outfit || s.outfit || 'None'
    };
}

function storeUseMyLook() {
    if (typeof DG === 'undefined' || !DG.readSettings) return;
    const look = storeMyLook();
    const s = DG.readSettings();
    s.cat = look.cat;
    s.hat = look.hat;
    s.glasses = look.glasses;
    s.outfit = look.outfit;
    DG.saveSettings();
    if (typeof saveProfileLook === 'function') saveProfileLook();
    if (typeof DG.showCatStep === 'function' && DG.menuStep === 'cat' && document.getElementById('dg-cat-preview')) {
        DG.showCatStep();
    }
    if (typeof battleRenderCatCustomizer === 'function' && document.getElementById('battle-cat-options')) {
        battleRenderCatCustomizer();
    }
    updateMascot('Your own look is on! ✨');
}

function storeEquippedItem(slot) {
    const id = STORE_EQUIPPED[slot];
    return id ? STORE_BY_ID[id] : null;
}

function storeBalanceLabel() {
    if (!storeAvailable()) return 'Sign in to earn Paws';
    if (STORE_LOAD_ERROR) return '—';
    return STORE_BALANCE + ' 🐾 Paws';
}

/* ---------------- Store view ---------------- */

function openStore() {
    changeView('store-view');
}

function storeSetCategory(cat) {
    STORE_CATEGORY = cat;
    renderStore();
}

function storeShowPawsHelp() {
    const el = document.getElementById('paws-help');
    if (!el) return;
    el.classList.remove('hidden');
    document.addEventListener('keydown', storePawsHelpKeydown);
}

function storeClosePawsHelp() {
    const el = document.getElementById('paws-help');
    if (el) el.classList.add('hidden');
    document.removeEventListener('keydown', storePawsHelpKeydown);
}

function storePawsHelpKeydown(event) {
    if (event.key === 'Escape') storeClosePawsHelp();
}

function renderStore() {
    const grid = document.getElementById('store-grid');
    const balance = document.getElementById('store-balance');
    const note = document.getElementById('store-note');
    const tabs = document.querySelectorAll('#store-categories [data-store-cat]');
    if (!grid) return;
    if (balance) balance.innerText = storeBalanceLabel();
    tabs.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-store-cat') === STORE_CATEGORY));
    if (note) {
        note.classList.toggle('hidden', !STORE_LOAD_ERROR);
        note.innerText = STORE_LOAD_ERROR || '';
    }
    const slots = ['hat', 'face', 'outfit', 'prop', 'background'];
    const labels = { hat: 'Hats & Headwear', face: 'Face & Eyewear', outfit: 'Neck & Outfits', prop: 'Props & Companions', background: 'Backgrounds & Effects' };
    const groups = STORE_CATEGORY === 'all' ? slots : [STORE_CATEGORY];
    grid.innerHTML = groups.map(slot => {
        const items = STORE_ITEMS.filter(it => it.slot === slot);
        if (!items.length) return '';
        return '<div class="store-group"><h3 class="store-group-title">' + labels[slot] + '</h3>' +
            '<div class="store-grid-inner">' + items.map(storeCardHTML).join('') + '</div></div>';
    }).join('');
    if (!grid.innerHTML) grid.innerHTML = '<p class="text-gray-400 text-center py-8">Nothing here yet.</p>';
}

function storeCardHTML(item) {
    const owned = item.price === 0 || !!STORE_OWNED[item.id];
    const equipped = STORE_EQUIPPED[item.slot] === item.id;
    let action;
    if (!storeAvailable()) {
        action = '<span class="store-card-note">Sign in to buy</span>';
    } else if (equipped) {
        action = '<button type="button" class="store-btn store-btn-quiet" onclick="storeUnequip(\'' + item.slot + '\')">Unequip</button>';
    } else if (owned) {
        action = '<button type="button" class="store-btn" onclick="storeEquipItem(\'' + item.id + '\')">Equip</button>';
    } else {
        action = '<button type="button" class="store-btn" onclick="storeBuyItem(\'' + item.id + '\')">Buy · ' + item.price + ' 🐾</button>';
    }
    return '<div class="store-card' + (equipped ? ' equipped' : '') + '">' +
        '<div class="store-card-emoji" aria-hidden="true">' + item.emoji + '</div>' +
        '<p class="store-card-name">' + escapeHtml(item.name) + '</p>' +
        '<p class="store-card-zh">' + escapeHtml(item.zh) + '</p>' +
        '<p class="store-card-rarity store-rarity-' + item.rarity.toLowerCase() + '">' + escapeHtml(item.rarity) + '</p>' +
        (owned && item.price > 0 ? '<p class="store-card-owned">Owned</p>' : '') +
        action +
        '</div>';
}

async function storeBuyItem(id) {
    const item = STORE_BY_ID[id];
    if (!item) return;
    if (!storeAvailable()) { updateMascot('Sign in with your school account to buy items.'); return; }
    if (item.price === 0) { await storeEquipItem(id); return; }
    if (!window.confirm('Buy ' + item.name + ' for ' + item.price + ' Paws?')) return;
    try {
        const { data, error } = await sb.rpc('buy_store_item', { p_item: id });
        if (error) throw error;
        STORE_BALANCE = Math.max(0, Number(data) || 0);
        STORE_OWNED[id] = true;
        updateMascot('Bought ' + item.name + '! 🐾');
        await loadStoreState(true);
        await storeEquipItem(id);
    } catch (e) {
        const msg = String(e && (e.message || e));
        updateMascot(/NOT_ENOUGH_PAWS/.test(msg)
            ? 'Not enough Paws yet — practise to earn more!'
            : (/ALREADY_OWNED/.test(msg) ? 'You already own that item.' : 'Could not buy that item. Ask your teacher to run supabase/store.sql.'));
    }
}

async function storeEquipItem(id) {
    const item = STORE_BY_ID[id];
    if (!item) return;
    if (!storeAvailable()) { updateMascot('Sign in with your school account to equip items.'); return; }
    try {
        const { error } = await sb.rpc('equip_store_item', { p_slot: item.slot, p_item: id });
        if (error) throw error;
        STORE_EQUIPPED[item.slot] = id;
        storeApplyEquippedToDG();
        saveProfileLook();
        await loadStoreState(true);
        updateMascot(item.name + ' equipped!');
    } catch (e) {
        updateMascot('Could not equip that item. Ask your teacher to run supabase/store.sql.');
    }
}

async function storeUnequip(slot) {
    if (!storeAvailable()) return;
    try {
        const { error } = await sb.rpc('equip_store_item', { p_slot: slot, p_item: '' });
        if (error) throw error;
        delete STORE_EQUIPPED[slot];
        if (typeof DG !== 'undefined' && DG.readSettings) {
            const s = DG.readSettings();
            const key = slot === 'face' ? 'glasses' : slot;
            if (key === 'hat' || key === 'glasses' || key === 'outfit') s[key] = 'None';
            DG.saveSettings();
        }
        saveProfileLook();
        await loadStoreState(true);
        updateMascot('Item unequipped.');
    } catch (e) {
        updateMascot('Could not unequip that item.');
    }
}

/* ---------------- Me profile look ---------------- */

function storeLookBits(look, prop, bg) {
    const bits = [];
    if (look && look.hat && look.hat !== 'None') bits.push('🎩 ' + look.hat);
    if (look && look.glasses && look.glasses !== 'None') bits.push('😎 ' + look.glasses);
    if (look && look.outfit && look.outfit !== 'None') bits.push('👕 ' + look.outfit);
    if (prop) bits.push('✨ ' + prop.name);
    if (bg) bits.push('🖼️ ' + bg.name);
    return bits;
}

function storePaintLook(canvas, labelEl, look, prop, bg, emptyText) {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 190;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grd = ctx.createLinearGradient(0, 0, 0, cssH);
    if (bg) {
        grd.addColorStop(0, bg.color);
        grd.addColorStop(1, '#fff7ed');
    } else {
        grd.addColorStop(0, '#dbeafe');
        grd.addColorStop(1, '#fef3c7');
    }
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = 'rgba(120,113,108,.22)';
    ctx.beginPath();
    ctx.ellipse(cssW / 2, cssH * 0.88, cssW * 0.2, cssH * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    if (typeof DG !== 'undefined' && DG.drawCatAvatar) {
        DG.drawCatAvatar(ctx, cssW / 2, cssH * 0.9, Math.min(cssW / 260, cssH / 220), look);
    } else if (typeof DG !== 'undefined' && DG.drawKart) {
        DG.drawKart(ctx, cssW / 2, cssH * 0.84, Math.min(cssW / 250, cssH / 190), look, { preview: true });
    }
    if (prop) {
        ctx.font = '32px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(prop.emoji, cssW * 0.7, cssH * 0.58);
    }
    if (bg) {
        ctx.font = '22px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(bg.emoji, cssW - 12, 26);
    }
    if (labelEl) {
        const bits = storeLookBits(look, prop, bg);
        labelEl.innerText = bits.length ? bits.join(' · ') : (emptyText || 'Nothing equipped yet.');
    }
}

function storeRenderProfileLook() {
    // If the Me tab is currently showing someone else, keep their look.
    if (typeof profileFriendId !== 'undefined' && profileFriendId) {
        storeRenderFriendLook(profileFriendId);
        return;
    }
    const canvas = document.getElementById('profile-look-canvas');
    const label = document.getElementById('profile-look-items');
    const balance = document.getElementById('profile-look-balance');
    const today = document.getElementById('profile-paws-today');
    if (!canvas) return;
    if (balance) balance.innerText = storeAvailable() ? (STORE_BALANCE + ' 🐾 Total') : 'Sign in to earn Paws';
    if (today) today.innerText = storeAvailable() ? ('+' + STORE_PAWS_TODAY + ' 🐾 Today') : '';
    const look = (typeof DG !== 'undefined' && DG.currentLook) ? DG.currentLook() : { hat: 'None', glasses: 'None', outfit: 'None', cat: 'Ginger' };
    storePaintLook(canvas, label, look, storeEquippedItem('prop'), storeEquippedItem('background'), 'No store items equipped yet.');
    document.querySelectorAll('#profile-cat-picker [data-profile-cat]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-profile-cat') === look.cat);
    });
}

function storeSetProfileCat(cat) {
    if (['Ginger', 'Ragdoll'].indexOf(cat) === -1 || typeof DG === 'undefined') return;
    const s = DG.readSettings();
    s.cat = cat;
    DG.saveSettings();
    if (typeof saveProfileLook === 'function') saveProfileLook();
    storeRenderProfileLook();
    updateMascot(cat + ' is now your profile cat! 🐱');
}

async function storeRenderFriendLook(userId) {
    const canvas = document.getElementById('profile-look-canvas');
    const label = document.getElementById('profile-look-items');
    if (!canvas || !userId) return;
    let data = null;
    try {
        const res = await sb.rpc('friend_store_look', { p_user_id: userId });
        if (res.error) throw res.error;
        data = res.data;
    } catch (e) {
        storePaintLook(canvas, label, { cat: 'Ginger', hat: 'None', glasses: 'None', outfit: 'None' },
            null, null, 'Their look is unavailable until the teacher runs supabase/store.sql.');
        return;
    }
    if (!data) data = {};
    const item = id => (id ? STORE_BY_ID[id] || null : null);
    const look = {
        cat: data.cat || 'Ginger',
        hat: data.hat || 'None',
        glasses: data.face || 'None',
        outfit: data.outfit || 'None'
    };
    storePaintLook(canvas, label, look, item(data.prop), item(data.background), 'Nothing equipped yet.');
}

async function storeRenderFriendPaws(userId) {
    const box = document.getElementById('profile-friend-paws');
    const chips = document.getElementById('profile-friend-paws-chips');
    const totalEl = document.getElementById('profile-friend-paws-total');
    if (!box || !chips || !totalEl || !userId) return;
    box.classList.add('hidden');
    try {
        const { data, error } = await sb.rpc('friend_paws_daily', { p_user_id: userId, p_days: 7 });
        if (error) throw error;
        const rows = Array.isArray(data) ? data : (data ? [data] : []);
        if (!rows.length) return;
        let total = 0;
        chips.innerHTML = rows.map(r => {
            const earned = Math.max(0, Number(r.earned) || 0);
            total += earned;
            const d = new Date(r.day + 'T12:00:00+08:00');
            const label = d.toLocaleDateString('en-HK', { weekday: 'short', timeZone: 'Asia/Hong_Kong' });
            const title = hkDateOnly(r.day + 'T12:00:00+08:00');
            return '<span class="friend-paw-day' + (earned ? '' : ' zero') + '" title="' + escapeHtml(title) + '">' +
                '<b>' + escapeHtml(label) + '</b><em>+' + earned + '</em></span>';
        }).join('');
        totalEl.innerText = '+' + total + ' Paws in the last 7 days';
        box.classList.remove('hidden');
    } catch (e) {
        box.classList.add('hidden');
    }
}

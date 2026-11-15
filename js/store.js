/* LearniTY — Store, Paws, owned skins.
   Loaded after shared.js and before the games. Catalog prices must match
   supabase/store.sql (the server checks the price again when buying). */

const STORE_ITEMS = [
    // Hats & headwear
    { id:'hat_sprout', slot:'head', name:'Sprout Clip', zh:'小草髮夾', price:80, rarity:'Common', emoji:'🌱', color:'#22c55e', desc:'A tiny green sprout on the head.' },
    { id:'hat_lofi', slot:'ears', name:'Lo-Fi Headphones', zh:'復古耳機', price:140, rarity:'Rare', emoji:'🎧', color:'#92400e', desc:'Wooden headphones for listening practice.' },
    { id:'hat_straw', slot:'head', name:'Straw Hat', zh:'草帽', price:100, rarity:'Common', emoji:'👒', color:'#fbbf24', desc:'A summer straw hat with a red ribbon.' },
    { id:'hat_frog', slot:'head', name:'Frog Hood', zh:'青蛙頭套', price:160, rarity:'Rare', emoji:'🐸', color:'#4ade80', desc:'A green frog hood.' },
    { id:'hat_chef', slot:'head', name:'Chef Hat', zh:'廚師高帽', price:120, rarity:'Rare', emoji:'👨‍🍳', color:'#f8fafc', desc:'A tall white chef hat.' },
    { id:'hat_sherlock', slot:'head', name:'Sherlock Cap', zh:'偵探獵鹿帽', price:150, rarity:'Rare', emoji:'🕵️', color:'#a16207', desc:'A checked deerstalker cap.' },
    { id:'hat_grad', slot:'head', name:'Graduation Cap', zh:'學士四方帽', price:180, rarity:'Rare', emoji:'🎓', color:'#111827', desc:'A black mortarboard with a gold tassel.' },
    { id:'hat_bearskin', slot:'head', name:'Bearskin Hat', zh:'英國衛兵高帽', price:220, rarity:'Epic', emoji:'🐻', color:'#111827', desc:'The tall black hat of a royal guard.' },
    { id:'hat_wizard', slot:'head', name:'Wizard Hat', zh:'魔法師尖帽', price:240, rarity:'Epic', emoji:'🧙', color:'#312e81', desc:'A navy pointed hat with stars and moons.' },
    { id:'hat_astro', slot:'head', name:'Astro Helmet', zh:'太空人頭罩', price:280, rarity:'Epic', emoji:'🚀', color:'#7dd3fc', desc:'A clear bubble space helmet.' },
    { id:'hat_gold_crown', slot:'head', name:'Golden Crown', zh:'黃金皇冠', price:450, rarity:'Legendary', emoji:'👑', color:'#f59e0b', desc:'A king’s crown with red rubies.' },

    // Face & eyewear
    { id:'face_blush', slot:'cheeks', name:'Blush Stickers', zh:'害羞紅暈', price:60, rarity:'Common', emoji:'😊', color:'#fb7185', desc:'Two pink blush lines.' },
    { id:'face_round', slot:'eyes', name:'Round Glasses', zh:'圓框學霸眼鏡', price:90, rarity:'Common', emoji:'👓', color:'#111827', desc:'Thin black round glasses.' },
    { id:'face_star', slot:'eyes', name:'Star Sunglasses', zh:'星星太陽眼鏡', price:170, rarity:'Rare', emoji:'⭐', color:'#fbbf24', desc:'Bold gold star-shaped sunglasses.' },
    { id:'face_pixel', slot:'eyes', name:'Pixel Sunglasses', zh:'像素黑超', price:140, rarity:'Rare', emoji:'😎', color:'#111827', desc:'Classic pixel “Thug Life” shades.' },
    { id:'face_patch', slot:'eyes', name:'Pirate Eyepatch', zh:'海盜眼罩', price:100, rarity:'Rare', emoji:'🏴‍☠️', color:'#111827', desc:'A black one-eye patch.' },
    { id:'face_monocle', slot:'eyes', name:'Monocle', zh:'紳士單片眼鏡', price:190, rarity:'Epic', emoji:'🧐', color:'#b45309', desc:'A gold monocle with a chain.' },
    { id:'face_visor', slot:'eyes', name:'Cyber Visor', zh:'賽博龐克護目鏡', price:240, rarity:'Epic', emoji:'🥽', color:'#22d3ee', desc:'A glowing neon-blue visor.' },

    // Neck & outfits
    { id:'outfit_scarf', slot:'neck', name:'Red Scarf', zh:'紅色小領巾', price:80, rarity:'Common', emoji:'🧣', color:'#ef4444', desc:'A simple red neckerchief.' },
    { id:'outfit_bowtie', slot:'neck', name:'Tweed Bow Tie', zh:'學院風煲呔', price:120, rarity:'Rare', emoji:'🎀', color:'#92400e', desc:'A brown checked tweed bow tie.' },
    { id:'outfit_bread', slot:'neck', name:'Bread Collar', zh:'方包頸圈', price:150, rarity:'Rare', emoji:'🍞', color:'#fde68a', desc:'A slice of bread worn as a collar.' },
    { id:'outfit_boba', slot:'body', name:'Boba Apron', zh:'珍珠奶茶圍裙', price:140, rarity:'Rare', emoji:'🧋', color:'#16a34a', desc:'A green boba shop apron.' },
    { id:'outfit_raincoat', slot:'body', name:'Yellow Raincoat', zh:'黃色小雨衣', price:170, rarity:'Rare', emoji:'🧥', color:'#facc15', desc:'A bright yellow raincoat.' },
    { id:'outfit_guard', slot:'body', name:'Royal Guard Tunic', zh:'英國衛兵紅制服', price:220, rarity:'Epic', emoji:'🛡️', color:'#dc2626', desc:'A red royal guard tunic.' },
    { id:'outfit_ruff', slot:'neck', name:'Shakespeare Ruff', zh:'莎士比亞蕾絲領', price:200, rarity:'Epic', emoji:'🎭', color:'#f8fafc', desc:'A white ruffled Elizabethan collar.' },
    { id:'outfit_shark', slot:'body', name:'Shark Onesie', zh:'鯊魚連身衣', price:260, rarity:'Epic', emoji:'🦈', color:'#64748b', desc:'A grey shark onesie.' },
    { id:'outfit_dragon', slot:'body', name:'Dragon Suit', zh:'恐龍連身衣', price:300, rarity:'Epic', emoji:'🐉', color:'#16a34a', desc:'A green spiky dragon suit.' },

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
    { id:'bg_cyber', slot:'background', name:'Cyber Grid', zh:'霓虹網格', price:260, rarity:'Epic', emoji:'🌐', color:'#7c3aed', desc:'Purple-blue neon grid lines.' },
    { id:'bg_pink', slot:'background', name:'Pink', zh:'粉紅', price:400, rarity:'Epic', emoji:'🩷', color:'#f9a8d4', desc:'A soft pink background.' },
    { id:'bg_blue', slot:'background', name:'Blue', zh:'藍色', price:420, rarity:'Epic', emoji:'🩵', color:'#93c5fd', desc:'A calm sky-blue background.' },
    { id:'bg_floral', slot:'background', name:'Floral', zh:'碎花', price:520, rarity:'Legendary', emoji:'🌷', color:'#fda4af', desc:'A floral pattern with soft petals.' },
    { id:'bg_yellow', slot:'background', name:'Yellow', zh:'黃色', price:160, rarity:'Common', emoji:'💛', color:'#fde047', desc:'A bright plain yellow background.' },
    { id:'bg_black', slot:'background', name:'Black', zh:'黑色', price:220, rarity:'Rare', emoji:'🖤', color:'#1f2937', desc:'A plain black background.' },
    { id:'bg_gray', slot:'background', name:'Grey', zh:'灰色', price:220, rarity:'Rare', emoji:'🩶', color:'#9ca3af', desc:'A plain grey background.' }
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

/* Items now live on a layer (head, ears, eyes, cheeks, neck, body) while the
   Store still groups them as Hats / Face / Outfits. One item per layer can be
   worn at the same time, so glasses + blush, scarf + coat, hat + headphones
   all stack. */
const STORE_LAYER_KEY = {
    head: 'hat',
    ears: 'ears',
    eyes: 'glasses',
    cheeks: 'cheeks',
    neck: 'neck',
    body: 'outfit'
};

function storeLayerKey(layer) {
    return STORE_LAYER_KEY[layer] || layer;
}

function storeLayerGroup(value) {
    const slot = typeof value === 'string' ? value : (value && value.slot);
    if (slot === 'head' || slot === 'ears') return 'hat';
    if (slot === 'eyes' || slot === 'cheeks') return 'face';
    if (slot === 'neck' || slot === 'body') return 'outfit';
    return slot;
}

function storePrimaryLayer(group) {
    if (group === 'hat') return 'head';
    if (group === 'face') return 'eyes';
    if (group === 'outfit') return 'body';
    return group;
}

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
    const group = storeLayerGroup(slot);
    return STORE_ITEMS.filter(it => storeLayerGroup(it) === group && (it.price === 0 || STORE_OWNED[it.id]));
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
    const add = (arr, slots) => {
        STORE_ITEMS.filter(it => slots.indexOf(it.slot) !== -1).forEach(it => {
            if (arr.indexOf(it.name) === -1) arr.push(it.name);
        });
    };
    // Group arrays keep the legacy single-slot customizer working, while
    // the layer arrays let the renderer stack extras.
    add(DG.HATS, ['head', 'ears']);
    add(DG.EARS, ['ears']);
    add(DG.GLASSES, ['eyes', 'cheeks']);
    add(DG.CHEEKS, ['cheeks']);
    add(DG.OUTFITS, ['body', 'neck']);
    add(DG.NECKS, ['neck']);
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
            // installs without profile_looks still work from the local copy.
            try {
                storeReadLocalProfileLook();
                const lookRes = await sb.from('profile_looks')
                    .select('cat,hat,face,outfit,ears,cheeks,neck')
                    .eq('user_id', currentUser.id)
                    .maybeSingle();
                if (!lookRes.error && lookRes.data) {
                    storeApplyProfileLookToDG(lookRes.data);
                } else if (!lookRes.error && !lookRes.data) {
                    // First visit after the Store update: create the row from
                    // the local profile look so Use my look has a stable source.
                    saveProfileLook();
                }
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
    Object.keys(STORE_LAYER_KEY).forEach(layer => {
        const id = STORE_EQUIPPED[layer];
        if (!id) return;
        const item = STORE_BY_ID[id];
        if (!item) return;
        const key = STORE_LAYER_KEY[layer];
        if (s[key] !== item.name) { s[key] = item.name; changed = true; }
    });
    // Never let a saved store name be used before it is owned (or free).
    Object.keys(STORE_LAYER_KEY).forEach(layer => {
        const key = STORE_LAYER_KEY[layer];
        const item = STORE_BY_NAME[s[key]];
        if (item && item.price > 0 && !STORE_OWNED[item.id]) {
            s[key] = 'None';
            changed = true;
        }
    });
    if (changed) DG.saveSettings();
}

/* The Me profile look is stored separately from the Drive & Go / Word Battle
   game look. That way changing a game chip never changes the profile, and
   "Use my look" always has something stable to restore. */
let STORE_PROFILE_LOOK = { cat: 'Ginger', hat: 'None', ears: 'None', glasses: 'None', cheeks: 'None', outfit: 'None', neck: 'None' };
let STORE_PROFILE_LOOK_SOURCE = 'local';

function storeNormalizeProfileLook(raw) {
    const s = raw || {};
    const pick = (value, fallback) => (value && value !== 'undefined') ? value : fallback;
    return {
        cat: pick(s.cat, 'Ginger'),
        hat: pick(s.hat, 'None'),
        ears: pick(s.ears, 'None'),
        glasses: pick(s.glasses !== undefined && s.glasses !== null ? s.glasses : s.face, 'None'),
        cheeks: pick(s.cheeks, 'None'),
        outfit: pick(s.outfit, 'None'),
        neck: pick(s.neck, 'None')
    };
}

function storeProfileLookStorageKey() {
    if (typeof previewStudentForm === 'function' && previewStudentForm()) {
        return 'learniTY_profile_look:preview:' + previewStudentForm();
    }
    if (typeof isGuestUser === 'function' && isGuestUser()) return 'learniTY_profile_look:guest';
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || 'local';
    return 'learniTY_profile_look:' + uid;
}

function storeSaveLocalProfileLook() {
    try {
        localStorage.setItem(storeProfileLookStorageKey(), JSON.stringify(STORE_PROFILE_LOOK));
    } catch (e) {}
}

function storeReadLocalProfileLook() {
    try {
        const raw = localStorage.getItem(storeProfileLookStorageKey());
        if (raw) {
            STORE_PROFILE_LOOK = storeNormalizeProfileLook(JSON.parse(raw));
            return STORE_PROFILE_LOOK;
        }
    } catch (e) {}
    // First visit for this account/device. Guests and previews start from the
    // clean look instead of whatever a game last selected.
    STORE_PROFILE_LOOK = { cat: 'Ginger', hat: 'None', ears: 'None', glasses: 'None', cheeks: 'None', outfit: 'None', neck: 'None' };
    storeSaveLocalProfileLook();
    return STORE_PROFILE_LOOK;
}

function storeApplyProfileLookToDG(look) {
    if (!look) return;
    STORE_PROFILE_LOOK = storeNormalizeProfileLook({
        cat: look.cat,
        hat: look.hat,
        ears: look.ears,
        glasses: look.face,
        cheeks: look.cheeks,
        outfit: look.outfit,
        neck: look.neck
    });
    STORE_PROFILE_LOOK_SOURCE = 'cloud';
    storeSaveLocalProfileLook();
    // Do not copy the profile over the game settings here: a student may be
    // halfway through choosing a race look. "Use my look" applies it.
}

function saveProfileLook() {
    storeSaveLocalProfileLook();
    STORE_MY_LOOK = {
        cat: STORE_PROFILE_LOOK.cat,
        hat: STORE_PROFILE_LOOK.hat,
        face: STORE_PROFILE_LOOK.glasses,
        outfit: STORE_PROFILE_LOOK.outfit
    };
    if (!storeAvailable()) return;
    try {
        sb.rpc('save_profile_look', {
            p_cat: STORE_PROFILE_LOOK.cat,
            p_hat: STORE_PROFILE_LOOK.hat,
            p_face: STORE_PROFILE_LOOK.glasses,
            p_outfit: STORE_PROFILE_LOOK.outfit,
            p_ears: STORE_PROFILE_LOOK.ears,
            p_cheeks: STORE_PROFILE_LOOK.cheeks,
            p_neck: STORE_PROFILE_LOOK.neck
        }).then(() => {}, () => {});
    } catch (e) {}
}

function storeMyLook() {
    const p = storeReadLocalProfileLook();
    const equippedName = slot => {
        const id = STORE_EQUIPPED[slot];
        const item = id ? STORE_BY_ID[id] : null;
        return item ? item.name : '';
    };
    return {
        cat: p.cat || 'Ginger',
        hat: equippedName('head') || p.hat || 'None',
        ears: equippedName('ears') || p.ears || 'None',
        glasses: equippedName('eyes') || p.glasses || 'None',
        cheeks: equippedName('cheeks') || p.cheeks || 'None',
        outfit: equippedName('body') || p.outfit || 'None',
        neck: equippedName('neck') || p.neck || 'None'
    };
}

let storeUseLookBusy = false;

async function storeUseMyLook() {
    if (typeof DG === 'undefined' || !DG.readSettings) return;
    if (storeUseLookBusy) return;
    storeUseLookBusy = true;
    try {
        // The profile look may not be in memory yet when Drive & Go is opened
        // straight from the Hub, so pull it before applying.
        let cloudLook = STORE_PROFILE_LOOK_SOURCE === 'cloud';
        if (storeAvailable()) {
            try {
                await loadStoreState(true);
                cloudLook = STORE_PROFILE_LOOK_SOURCE === 'cloud';
            } catch (e) {}
        }
        const look = storeMyLook();
        const s = DG.readSettings();
        s.cat = look.cat;
        s.hat = look.hat;
        s.ears = look.ears;
        s.glasses = look.glasses;
        s.cheeks = look.cheeks;
        s.outfit = look.outfit;
        s.neck = look.neck;
        DG.saveSettings();
        if (typeof DG.showCatStep === 'function' && DG.menuStep === 'cat' && document.getElementById('dg-cat-preview')) {
            DG.showCatStep();
            storeShowLookNote(cloudLook ? '✅ Your profile look is on' : '✅ Your saved look is on');
        }
        if (typeof battleRenderCatCustomizer === 'function' && document.getElementById('battle-cat-options')) {
            battleRenderCatCustomizer();
        }
        updateMascot('Your own look is on! ✨');
    } finally {
        storeUseLookBusy = false;
    }
}

function storeShowLookNote(text) {
    const note = document.getElementById('dg-look-note');
    if (!note) return;
    note.innerText = text;
    note.classList.remove('hidden');
    clearTimeout(storeShowLookNote._timer);
    storeShowLookNote._timer = setTimeout(function () {
        note.classList.add('hidden');
    }, 2400);
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
    const groups = ['hat', 'face', 'outfit', 'prop', 'background'];
    const labels = { hat: 'Hats & Headwear', face: 'Face & Eyewear', outfit: 'Neck & Outfits', prop: 'Props & Companions', background: 'Backgrounds & Effects' };
    const shown = STORE_CATEGORY === 'all' ? groups : [STORE_CATEGORY];
    grid.innerHTML = shown.map(group => {
        const items = STORE_ITEMS.filter(it => storeLayerGroup(it) === group);
        if (!items.length) return '';
        return '<div class="store-group"><h3 class="store-group-title">' + labels[group] + '</h3>' +
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
        const profile = storeReadLocalProfileLook();
        const key = storeLayerKey(item.slot);
        if (key !== 'prop' && key !== 'background') profile[key] = item.name;
        STORE_PROFILE_LOOK = profile;
        storeSaveLocalProfileLook();
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
        const profile = storeReadLocalProfileLook();
        const key = storeLayerKey(slot);
        if (key !== 'prop' && key !== 'background') profile[key] = 'None';
        STORE_PROFILE_LOOK = profile;
        storeSaveLocalProfileLook();
        if (typeof DG !== 'undefined' && DG.readSettings) {
            const s = DG.readSettings();
            if (key !== 'prop' && key !== 'background') s[key] = 'None';
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
    if (look && look.ears && look.ears !== 'None') bits.push('🎧 ' + look.ears);
    if (look && look.glasses && look.glasses !== 'None') bits.push('😎 ' + look.glasses);
    if (look && look.cheeks && look.cheeks !== 'None') bits.push('😊 ' + look.cheeks);
    if (look && look.outfit && look.outfit !== 'None') bits.push('👕 ' + look.outfit);
    if (look && look.neck && look.neck !== 'None') bits.push('🧣 ' + look.neck);
    if (prop) bits.push('✨ ' + prop.name);
    if (bg) bits.push('🖼️ ' + bg.name);
    return bits;
}

/* Soft decorations for the three plain-colour backgrounds. The gradient
   itself comes from the item colour, so unknown backgrounds still work. */
function storePaintBackground(ctx, bg, w, h) {
    if (!bg || !w || !h) return;
    ctx.save();
    if (bg.id === 'bg_pink') {
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        for (let y = 26; y < h; y += 44) {
            for (let x = 20 + (Math.round(y / 44) % 2) * 26; x < w; x += 54) {
                const r = 4.4;
                ctx.beginPath();
                ctx.moveTo(x, y + r * 1.6);
                ctx.bezierCurveTo(x - r * 2.4, y - r * 0.6, x - r * 0.8, y - r * 2, x, y - r * 0.6);
                ctx.bezierCurveTo(x + r * 0.8, y - r * 2, x + r * 2.4, y - r * 0.6, x, y + r * 1.6);
                ctx.fill();
            }
        }
    } else if (bg.id === 'bg_blue') {
        ctx.fillStyle = 'rgba(255,255,255,.72)';
        const cloud = (x, y, s) => {
            ctx.beginPath();
            ctx.arc(x, y, 11 * s, 0, Math.PI * 2);
            ctx.arc(x + 13 * s, y + 3 * s, 8 * s, 0, Math.PI * 2);
            ctx.arc(x - 13 * s, y + 3 * s, 7 * s, 0, Math.PI * 2);
            ctx.arc(x + 2 * s, y - 6 * s, 8 * s, 0, Math.PI * 2);
            ctx.fill();
        };
        cloud(w * 0.22, h * 0.2, 1);
        cloud(w * 0.76, h * 0.32, 0.8);
        cloud(w * 0.42, h * 0.72, 0.65);
    } else if (bg.id === 'bg_floral') {
        const petal = (x, y, r, color) => {
            ctx.fillStyle = color;
            for (let i = 0; i < 5; i++) {
                const a = (Math.PI * 2 / 5) * i - Math.PI / 2;
                ctx.beginPath();
                ctx.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.72, r * 0.48, a, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = '#fde68a';
            ctx.beginPath();
            ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
            ctx.fill();
        };
        const colors = ['rgba(255,255,255,.85)', 'rgba(251,113,133,.7)', 'rgba(196,181,253,.75)'];
        let n = 0;
        for (let y = 24; y < h; y += 52) {
            for (let x = 24 + (Math.round(y / 52) % 2) * 30; x < w; x += 64) {
                petal(x, y, 6.5, colors[n % colors.length]);
                n++;
            }
        }
    }
    ctx.restore();
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
    storePaintBackground(ctx, bg, cssW, cssH);
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
    const look = (typeof storeMyLook === 'function') ? storeMyLook() : { hat: 'None', glasses: 'None', outfit: 'None', cat: 'Ginger' };
    storePaintLook(canvas, label, look, storeEquippedItem('prop'), storeEquippedItem('background'), 'No store items equipped yet.');
    document.querySelectorAll('#profile-cat-picker [data-profile-cat]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-profile-cat') === look.cat);
    });
}

function storeSetProfileCat(cat) {
    if (['Ginger', 'Ragdoll'].indexOf(cat) === -1 || typeof DG === 'undefined') return;
    const profile = storeReadLocalProfileLook();
    profile.cat = cat;
    STORE_PROFILE_LOOK = profile;
    storeSaveLocalProfileLook();
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
        ears: data.ears || 'None',
        glasses: data.face || 'None',
        cheeks: data.cheeks || 'None',
        outfit: data.outfit || 'None',
        neck: data.neck || 'None'
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

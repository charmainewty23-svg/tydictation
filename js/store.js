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
    // School sets (2026-11): two looks for each side, all gender-neutral.
    { id:'outfit_housetie', slot:'neck', name:'House Tie', zh:'學院風領呔', price:110, rarity:'Common', emoji:'🎗️', color:'#1d4ed8', desc:'A striped school house tie.' },
    { id:'outfit_blazer', slot:'body', name:'School Blazer', zh:'校服西裝外套', price:240, rarity:'Rare', emoji:'🧥', color:'#1e3a8a', desc:'A navy blazer with gold buttons and a crest.' },
    { id:'outfit_teamscarf', slot:'neck', name:'Team Scarf', zh:'球隊頸巾', price:130, rarity:'Rare', emoji:'🧣', color:'#dc2626', desc:'A red and white team scarf.' },
    { id:'outfit_football', slot:'body', name:'Football Kit', zh:'足球球衣', price:270, rarity:'Epic', emoji:'⚽', color:'#22c55e', desc:'A green football jersey with a number 9.' },
    { id:'outfit_sailorcollar', slot:'neck', name:'Sailor Collar', zh:'水手領', price:140, rarity:'Rare', emoji:'⚓', color:'#1d4ed8', desc:'A navy sailor collar with white stripes.' },
    { id:'outfit_sailortop', slot:'body', name:'Sailor Top', zh:'水手上衣', price:250, rarity:'Rare', emoji:'👕', color:'#f8fafc', desc:'A white sailor top with a navy stripe.' },
    { id:'outfit_ribbonchoker', slot:'neck', name:'Ribbon Choker', zh:'蝴蝶結頸帶', price:110, rarity:'Common', emoji:'🎀', color:'#db2777', desc:'A pink ribbon choker with a tiny bow.' },
    { id:'outfit_tutu', slot:'body', name:'Ballet Tutu', zh:'芭蕾紗裙', price:290, rarity:'Epic', emoji:'🩰', color:'#fbcfe8', desc:'A layered pink tutu with sparkles.' },

    // Props & companions (Me / lobby only)
    { id:'prop_pencil', slot:'prop', name:'Pencil', zh:'巨大鉛筆', price:60, rarity:'Common', emoji:'✏️', color:'#facc15', desc:'A giant yellow HB pencil.' },
    { id:'prop_boba', slot:'prop', name:'Boba Tea', zh:'珍珠奶茶', price:90, rarity:'Common', emoji:'🧋', color:'#a16207', desc:'A brown sugar boba tea.' },
    { id:'prop_magnifier', slot:'prop', name:'Magnifying Glass', zh:'放大鏡', price:110, rarity:'Rare', emoji:'🔍', color:'#0f766e', desc:'A detective magnifying glass.' },
    { id:'prop_quill', slot:'prop', name:'Quill & Scroll', zh:'羽毛筆與羊皮紙', price:160, rarity:'Rare', emoji:'🪶', color:'#b45309', desc:'A quill and a scroll.' },
    { id:'prop_box', slot:'prop', name:'Cardboard Box', zh:'紙皮箱', price:120, rarity:'Rare', emoji:'📦', color:'#b45309', desc:'A “Fragile” delivery box.' },
    { id:'prop_dictionary', slot:'prop', name:'Floating Dictionary', zh:'懸浮魔法字典', price:220, rarity:'Epic', emoji:'📖', color:'#2563eb', desc:'A glowing dictionary that turns its own pages.' },
    { id:'prop_parrot', slot:'prop', name:'Mini Parrot', zh:'肩膀小鸚鵡', price:240, rarity:'Epic', emoji:'🦜', color:'#22c55e', desc:'A colourful parrot on your shoulder.' },
    { id:'prop_white_flag', slot:'prop', name:'White Flag', zh:'投降小白旗', price:470, rarity:'Epic', emoji:'🏳️', color:'#f8fafc', desc:'A little white flag that says “Too Hard!”.' },
    { id:'prop_rubber_duck', slot:'prop', name:'Rubber Duck', zh:'沖涼黃色小鴨', price:480, rarity:'Epic', emoji:'🦆', color:'#facc15', desc:'The classic yellow debugging duck.' },
    { id:'prop_red_pen', slot:'prop', name:'Red Pen', zh:'老師改卷紅筆', price:490, rarity:'Epic', emoji:'🖊️', color:'#dc2626', desc:'A giant red marking pen, ready for homework.' },
    { id:'prop_tea_scone', slot:'prop', name:'Tea & Scone', zh:'英式下午茶', price:500, rarity:'Epic', emoji:'🫖', color:'#f59e0b', desc:'Earl Grey tea and a strawberry-jam scone.' },
    { id:'prop_corgi', slot:'prop', name:'Mini Corgi', zh:'迷你哥基犬', price:510, rarity:'Legendary', emoji:'🐕', color:'#f59e0b', desc:'A tiny royal corgi sitting beside your cat.' },
    { id:'prop_boombox', slot:'prop', name:'Boombox', zh:'復古卡式錄音機', price:520, rarity:'Legendary', emoji:'📻', color:'#334155', desc:'An 80s boombox playing English listening tapes.' },
    { id:'prop_cozy_desk', slot:'prop', name:'Cozy Desk', zh:'溫暖書桌', price:560, rarity:'Legendary', emoji:'🪵', color:'#a9763f', desc:'A real wooden desk with a lamp, books and a hot mug — right beside your cat.' },
    // Drive & Go! car skins
    { id:'car_sunset', slot:'car', name:'Sunset Racer', zh:'日落賽車', price:600, rarity:'Rare', emoji:'🏎️', color:'#ef4444', speed:2, desc:'A red-orange racer with gold trim. Top speed +2%.' },
    { id:'car_ocean', slot:'car', name:'Ocean Bolt', zh:'海洋閃電', price:650, rarity:'Rare', emoji:'🏎️', color:'#38bdf8', speed:3, desc:'A sky-blue kart with a white stripe. Top speed +3%.' },
    { id:'car_neon', slot:'car', name:'Neon Drift', zh:'霓虹漂移', price:700, rarity:'Epic', emoji:'🏎️', color:'#a855f7', speed:4, desc:'Purple body with a cyan glow stripe. Top speed +4%.' },
    { id:'car_jungle', slot:'car', name:'Jungle Buggy', zh:'森林越野車', price:750, rarity:'Epic', emoji:'🏎️', color:'#22c55e', speed:5, desc:'A green off-road buggy with yellow trim. Top speed +5%.' },
    { id:'car_gold', slot:'car', name:'Golden GT', zh:'黃金跑車', price:900, rarity:'Legendary', emoji:'🏎️', color:'#fbbf24', speed:7, desc:'A gold grand tourer with black trim. Top speed +7%.' },

    // Victory animations (class-battle flex, 3 price tiers)
    { id:'victory_confetti', slot:'victory', name:'Confetti Cannon', zh:'彩帶禮炮', price:250, rarity:'Common', emoji:'🎉', tier:1, desc:'A cannon of confetti and streamers at the champion’s feet.' },
    { id:'victory_spotlight', slot:'victory', name:'Spotlight', zh:'巨星聚光燈', price:300, rarity:'Common', emoji:'🔦', tier:1, desc:'The stage goes dark and one gold beam finds the champion.' },
    { id:'victory_emojirain', slot:'victory', name:'Emoji Rain', zh:'表情符號雨', price:350, rarity:'Rare', emoji:'😎', tier:1, desc:'😎 🔥 💯 👑 rain over the whole screen.' },
    { id:'victory_micdrop', slot:'victory', name:'Mic Drop', zh:'掉咪走人', price:450, rarity:'Rare', emoji:'🎤', tier:2, desc:'“Peace out!” — then the mic hits the floor.' },
    { id:'victory_dealwithit', slot:'victory', name:'Deal With It', zh:'像素黑超降臨', price:550, rarity:'Epic', emoji:'🕶️', tier:2, desc:'8-bit shades drop onto the champion’s eyes.' },
    { id:'victory_bananaslip', slot:'victory', name:'Banana Slip', zh:'全場滑倒', price:600, rarity:'Epic', emoji:'🍌', tier:2, desc:'2nd and 3rd place slip on a banana and fly away.' },
    { id:'victory_moneygun', slot:'victory', name:'Money Gun', zh:'積分噴鈔機', price:900, rarity:'Legendary', emoji:'💸', tier:3, desc:'The champion sprays TyDictation paw bills over the class.' },

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
    outfit: ['None', 'Racing Jacket'],
    car: ['Stock']
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
    body: 'outfit',
    car: 'car'
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
let STORE_PAID = {};
let STORE_EQUIPPED = {};
let STORE_BALANCE = 0;
let STORE_PAWS_TODAY = 0;
let STORE_MY_LOOK = null;
let STORE_LOADED = false;
let STORE_LOAD_ERROR = '';
let STORE_LOAD_PROMISE = null;
let STORE_CATEGORY = 'all';
let STORE_SYNCED_USER = '';
let STORE_SALE = { active: false, off_pct: 0, label: '', sale_key: '', ends_at: null };
let STORE_VICTORY_TOP = [];
let STORE_VICTORY_RENTAL = '';
let STORE_SALE_ANNOUNCED = false;

window.STORE_OWNED = STORE_OWNED;
window.STORE_EQUIPPED = STORE_EQUIPPED;

function storeAvailable() {
    return canUseCloud() && !isGuestUser() && !previewStudentForm();
}

/* One-time 10% catalog price rise, effective 20 Nov 2026 in Hong Kong.
   This mirrors public.store_base_price() so the Store display and the
   server charge always agree. */
const STORE_PRICE_RISE_DATE = '2026-11-20';

function storeHkDateKey() {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
    } catch (e) {
        return new Date().toISOString().slice(0, 10);
    }
}

function storeBasePrice(item) {
    if (!item) return 0;
    const base = Number(item.price) || 0;
    if (base <= 0) return base;
    return storeHkDateKey() >= STORE_PRICE_RISE_DATE ? Math.floor(base * 1.1) : base;
}

function storePrice(item) {
    if (!item) return 0;
    const base = storeBasePrice(item);
    if (!STORE_SALE.active || !base) return base;
    return Math.max(0, Math.floor(base * (100 - STORE_SALE.off_pct) / 100));
}

function storeVictoryRent(item) {
    return item ? Math.max(40, Math.floor(storeBasePrice(item) * 0.2)) : 0;
}

function storeVictoryTopRank(itemId) {
    for (let i = 0; i < STORE_VICTORY_TOP.length; i++) {
        if (STORE_VICTORY_TOP[i] && STORE_VICTORY_TOP[i].item_id === itemId) return i;
    }
    return -1;
}

function storeSaleBannerHTML() {
    if (!STORE_SALE.active) return '';
    const ends = STORE_SALE.ends_at ? new Date(STORE_SALE.ends_at) : null;
    const when = ends ? ' · ends ' + ends.toLocaleString('en-HK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return '<div class="store-sale-banner" role="status">' +
        '<b>' + escapeHtml(STORE_SALE.label || ('Flash Sale · ' + STORE_SALE.off_pct + '% off')) + '</b>' +
        '<span>Every item is ' + STORE_SALE.off_pct + '% off today' + when + '</span></div>';
}

function storeAnnounceSale() {
    if (STORE_SALE_ANNOUNCED || !STORE_SALE.active || !STORE_SALE.sale_key || !storeAvailable()) return;
    STORE_SALE_ANNOUNCED = true;
    const msg = '⚡ ' + (STORE_SALE.label || ('Flash Sale · ' + STORE_SALE.off_pct + '% off')) +
        ': every item in the Store is ' + STORE_SALE.off_pct + '% off today. Spend your Paws before it ends!';
    try {
        sb.rpc('announce_store_sale', { p_key: STORE_SALE.sale_key, p_message: msg }).catch(function () {});
    } catch (e) {}
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
    add(DG.KARTS, ['car']);
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
            STORE_PAID = {};
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
            // Read the wallet first and publish it immediately: one broken
            // extra RPC (sale / victory tables) must never make the balance
            // look like 0 Paws.
            const bal = await sb.rpc('my_paw_balance');
            if (bal.error) throw bal.error;
            STORE_BALANCE = Math.max(0, Number(bal.data) || 0);
            const safeRpc = function (name, args) {
                try {
                    const res = sb.rpc(name, args);
                    return (res && typeof res.catch === 'function')
                        ? res.catch(function () { return { data: null, error: true }; })
                        : Promise.resolve({ data: null, error: true });
                } catch (e) { return Promise.resolve({ data: null, error: true }); }
            };
            const [purchasesResult, equipped, saleRes, topRes, rentalRes] = await Promise.all([
                sb.from('store_purchases').select('item_id,paid_price').eq('user_id', currentUser.id),
                sb.from('store_equipped').select('slot,item_id').eq('user_id', currentUser.id),
                safeRpc('store_sale_now'),
                safeRpc('store_victory_top', { p_days: 7 }),
                safeRpc('my_victory_rental')
            ]);
            const saleRow = Array.isArray(saleRes && saleRes.data) ? saleRes.data[0] : (saleRes && saleRes.data);
            STORE_SALE = (saleRow && saleRow.active)
                ? {
                    active: true,
                    off_pct: Number(saleRow.off_pct) || 0,
                    label: saleRow.label || 'Flash Sale',
                    sale_key: saleRow.sale_key || '',
                    ends_at: saleRow.ends_at || null
                }
                : { active: false, off_pct: 0, label: '', sale_key: '', ends_at: null };
            STORE_VICTORY_TOP = Array.isArray(topRes && topRes.data) ? topRes.data : [];
            STORE_VICTORY_RENTAL = (rentalRes && !rentalRes.error && rentalRes.data) ? String(rentalRes.data) : '';
            storeAnnounceSale();
            if (bal.error) throw bal.error;
            let purchases = purchasesResult;
            if (purchases.error && /paid_price|column|42703/i.test(purchases.error.message || '')) {
                // Older install without store_buyback.sql: keep the Store usable.
                purchases = await sb.from('store_purchases').select('item_id').eq('user_id', currentUser.id);
            }
            if (purchases.error) throw purchases.error;
            if (equipped.error) throw equipped.error;
            STORE_OWNED = free;
            STORE_PAID = {};
            (purchases.data || []).forEach(row => {
                if (!row || !row.item_id) return;
                STORE_OWNED[row.item_id] = true;
                STORE_PAID[row.item_id] = Math.max(0, Number(row.paid_price) || 0);
            });
            STORE_EQUIPPED = { prop: [] };
            (equipped.data || []).forEach(row => {
                if (!row || !row.slot || !row.item_id) return;
                if (row.slot === 'prop') STORE_EQUIPPED.prop.push(row.item_id);
                else STORE_EQUIPPED[row.slot] = row.item_id;
            });
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
            STORE_PAID = {};
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
        neck: equippedName('neck') || p.neck || 'None',
        car: equippedName('car') || ((typeof DG !== 'undefined' && DG.readSettings) ? (DG.readSettings().car || 'Stock') : 'Stock'),
        props: (STORE_EQUIPPED.prop || []).map(id => STORE_BY_ID[id] && STORE_BY_ID[id].name).filter(Boolean)
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
        s.car = look.car || 'Stock';
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

function storeEquippedItems(slot) {
    if (slot === 'prop') {
        return (STORE_EQUIPPED.prop || []).map(id => STORE_BY_ID[id]).filter(Boolean);
    }
    const id = STORE_EQUIPPED[slot];
    const item = id ? STORE_BY_ID[id] : null;
    return item ? [item] : [];
}

function storeEquippedItem(slot) {
    if (slot === 'prop') return storeEquippedItems('prop')[0] || null;
    const id = STORE_EQUIPPED[slot];
    return id ? STORE_BY_ID[id] : null;
}

function storeBalanceLabel() {
    if (!storeAvailable()) return 'Sign in to earn Paws';
    if (STORE_LOAD_ERROR) return '—';
    return STORE_BALANCE + ' 🐾 Paws';
}

/* ---------------- Mystery Gacha ---------------- */

const STORE_GACHA_COST = 200;
const STORE_NEW_IDS = [
    'prop_white_flag', 'prop_rubber_duck', 'prop_red_pen',
    'prop_tea_scone', 'prop_corgi', 'prop_boombox', 'prop_cozy_desk'
];

function storeShowGachaResult(html) {
    const box = document.getElementById('store-gacha-result');
    if (!box) return;
    box.innerHTML = html;
    box.classList.remove('hidden');
}

async function storePullGacha() {
    if (!storeAvailable()) {
        updateMascot('Sign in with your school account to open the Mystery Gacha.');
        return;
    }
    const card = document.getElementById('store-gacha-card');
    const btn = document.getElementById('store-gacha-btn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.innerText = '🎁 Opening…';
    if (card) card.classList.add('opening');
    try {
        await loadStoreState(true);
        if (STORE_BALANCE < STORE_GACHA_COST) {
            throw new Error('NOT_ENOUGH_PAWS');
        }
        const { data, error } = await sb.rpc('pull_store_gacha');
        if (error) throw error;
        const r = Array.isArray(data) ? data[0] : data;
        if (!r || !r.item) throw new Error('NO_ITEMS');
        if (r.duplicate) {
            storeShowGachaResult(
                '<div class="store-gacha-emoji" aria-hidden="true">' + escapeHtml(r.emoji || '🎁') + '</div>' +
                '<div><b>Duplicate: ' + escapeHtml(r.name || 'item') + '</b>' +
                (r.zh ? ' · ' + escapeHtml(r.zh) : '') +
                '<p>You already own it — <b>+' + Number(r.refund || 100) + ' 🐾</b> refunded.</p></div>'
            );
            updateMascot('Duplicate ' + (r.name || 'item') + ' — half your Paws are back! 🐾');
        } else {
            storeShowGachaResult(
                '<div class="store-gacha-emoji" aria-hidden="true">' + escapeHtml(r.emoji || '🎁') + '</div>' +
                '<div><b>You got ' + escapeHtml(r.name || 'a new item') + '!</b>' +
                (r.zh ? ' · ' + escapeHtml(r.zh) : '') +
                '<p>Added to your Store — equip it whenever you like.</p></div>'
            );
            updateMascot('Mystery Gacha: ' + (r.name || 'new item') + '! 🎉');
        }
        await loadStoreState(true);
        renderStore();
    } catch (e) {
        const msg = String(e && (e.message || e));
        if (msg.indexOf('NOT_ENOUGH_PAWS') !== -1) {
            storeShowGachaResult('<div class="store-gacha-emoji" aria-hidden="true">🐾</div><div><b>Not enough Paws.</b><p>You need 200 Paws to open the Mystery Gacha.</p></div>');
            updateMascot('Not enough Paws for the Mystery Gacha — practise to earn more!');
        } else if (/PGRST202|Could not find the function|does not exist/i.test(msg)) {
            storeShowGachaResult('<div class="store-gacha-emoji" aria-hidden="true">🛠️</div><div><b>Gacha needs SQL.</b><p>Ask the teacher to run <code>supabase/store_gacha.sql</code>.</p></div>');
            updateMascot('The Mystery Gacha needs supabase/store_gacha.sql.');
        } else {
            storeShowGachaResult('<div class="store-gacha-emoji" aria-hidden="true">😿</div><div><b>The box would not open.</b><p>Try again in a moment.</p></div>');
            updateMascot('Could not open the Mystery Gacha.');
        }
    } finally {
        btn.disabled = false;
        btn.innerText = '🎁 Open · ' + STORE_GACHA_COST + ' 🐾';
        if (card) card.classList.remove('opening');
    }
}

/* ---------------- Second-hand Market ---------------- */

let STORE_MARKET_ROWS = [];

function storeMarketNote(text) {
    const el = document.getElementById('store-market-note');
    if (!el) return;
    el.innerText = text || '';
    el.classList.toggle('hidden', !text);
}

function storeItemEquipped(item) {
    if (!item) return false;
    if (item.slot === 'prop') return (STORE_EQUIPPED.prop || []).indexOf(item.id) !== -1;
    return STORE_EQUIPPED[item.slot] === item.id;
}

function storeMarketError(e) {
    const msg = String(e && (e.message || e));
    if (/PGRST202|Could not find the function|does not exist/i.test(msg)) {
        return 'The Market needs the teacher to run supabase/store_market.sql.';
    }
    const map = {
        NOT_ENOUGH_PAWS: 'Not enough Paws.',
        ITEM_EQUIPPED: 'Unequip that item before listing it.',
        ITEM_LISTED: 'Cancel the Market listing before selling it to the buyback.',
        ALREADY_LISTED: 'That item is already listed.',
        NOT_OWNED: 'You do not own that item.',
        BAD_PRICE: 'Choose a price from 1 to 5000 Paws.',
        OWN_LISTING: 'That is your own listing.',
        ALREADY_OWNED: 'You already own that item.',
        LISTING_GONE: 'That listing is no longer available.',
        SELLER_EQUIPPED: 'The seller equipped that item — try again later.',
        SELLER_NO_LONGER_OWNS: 'The seller no longer owns that item.'
    };
    for (const key in map) {
        if (msg.indexOf(key) !== -1) return map[key];
    }
    return 'Could not complete that Market action.';
}

async function loadStoreMarket(force) {
    if (STORE_CATEGORY !== 'market') return;
    const listEl = document.getElementById('store-market-list');
    const sellEl = document.getElementById('store-market-sell');
    if (!listEl || !sellEl) return;
    storeMarketNote('');
    if (!storeAvailable()) {
        STORE_MARKET_ROWS = [];
        listEl.innerHTML = '<p class="store-market-empty">Sign in with your school account to use the Market.</p>';
        sellEl.innerHTML = '<p class="store-market-empty">Your sellable items will appear here.</p>';
        return;
    }
    listEl.innerHTML = '<div class="flex items-center gap-2 py-3"><div class="loader"></div><p class="text-orange-400 font-bold text-sm">Loading Market…</p></div>';
    sellEl.innerHTML = '';
    try {
        const { data, error } = await sb.rpc('store_market_listings');
        if (error) throw error;
        STORE_MARKET_ROWS = Array.isArray(data) ? data : (data ? [data] : []);
        storeRenderMarketList(STORE_MARKET_ROWS);
        storeRenderSellList(STORE_MARKET_ROWS);
    } catch (e) {
        STORE_MARKET_ROWS = [];
        storeMarketNote(storeMarketError(e));
        listEl.innerHTML = '<p class="store-market-empty">Market unavailable right now.</p>';
        sellEl.innerHTML = '<p class="store-market-empty">Market unavailable right now.</p>';
    }
}

function storeRenderMarketList(rows) {
    const listEl = document.getElementById('store-market-list');
    if (!listEl) return;
    const list = rows || [];
    if (!list.length) {
        listEl.innerHTML = '<p class="store-market-empty">No items for sale yet.</p>';
        return;
    }
    listEl.innerHTML = list.map(row => {
        const name = escapeHtml(row.name_en || row.item_id || 'Item');
        const zh = row.name_zh ? escapeHtml(row.name_zh) : '';
        const seller = escapeHtml(row.seller_name || 'Student');
        const form = row.seller_form ? ' · ' + escapeHtml(row.seller_form) : '';
        const mine = !!row.is_mine;
        return '<div class="store-market-row">' +
            '<div class="store-market-emoji" aria-hidden="true">' + escapeHtml(row.emoji || '🎁') + '</div>' +
            '<div class="store-market-info"><b>' + name + (mine ? ' <span class="text-[10px] text-orange-500">(your listing)</span>' : '') + '</b><small>' + zh + (zh ? ' · ' : '') + seller + form + (row.original_price ? ' · Original ' + Number(row.original_price) + ' 🐾' : '') + '</small></div>' +
            '<div class="store-market-price">' + Number(row.price || 0) + ' 🐾</div>' +
            (mine
                ? '<button type="button" class="store-market-btn quiet" onclick="storeCancelListing(\'' + row.listing_id + '\')">Cancel</button>'
                : '<button type="button" class="store-market-btn" onclick="storeBuyListing(\'' + row.listing_id + '\')">Buy</button>') +
            '</div>';
    }).join('');
}

function storeBuybackPrice(item) {
    if (!item) return 0;
    const paid = Number(STORE_PAID[item.id]) || Number(item.price) || 0;
    return Math.max(1, Math.floor(paid * 0.35));
}

async function storeBuybackItem(itemId) {
    if (!storeAvailable()) { updateMascot('Sign in to sell items.'); return; }
    const item = STORE_BY_ID[itemId];
    if (!item) return;
    const refund = storeBuybackPrice(item);
    if (!window.confirm('Sell ' + item.name + ' to the official buyback for ' + refund + ' Paws? (35% of what you paid — 65% off)')) return;
    try {
        const { error } = await sb.rpc('sell_item_to_store', { p_item: itemId });
        if (error) throw error;
        updateMascot('Official buyback: +' + refund + ' 🐾 for ' + item.name + '.');
        await loadStoreState(true);
        renderStore();
    } catch (e) {
        storeMarketNote(storeMarketError(e));
    }
}

function storeRenderSellList(rows) {
    const sellEl = document.getElementById('store-market-sell');
    if (!sellEl) return;
    const listed = {};
    (rows || []).forEach(r => { if (r.is_mine) listed[r.item_id] = true; });
    const mine = STORE_ITEMS.filter(it => STORE_OWNED[it.id] && !storeItemEquipped(it) && !listed[it.id]);
    if (!mine.length) {
        sellEl.innerHTML = '<p class="store-market-empty">No unequipped, unlisted items. Unequip something first.</p>';
        return;
    }
    sellEl.innerHTML = mine.map(it => {
        const basePrice = storeBasePrice(it);
        const suggested = Math.max(10, Math.round((Number(basePrice) || 100) / 2));
        return '<div class="store-market-row">' +
            '<div class="store-market-emoji" aria-hidden="true">' + escapeHtml(it.emoji || '🎁') + '</div>' +
            '<div class="store-market-info"><b>' + escapeHtml(it.name) + '</b><small>' + escapeHtml(it.zh || '') + ' · Original ' + Number(basePrice) + ' 🐾</small></div>' +
            '<input id="market-price-' + it.id + '" class="store-market-price-input" type="number" min="1" max="5000" value="' + suggested + '" aria-label="Price for ' + escapeHtml(it.name) + '">' +
            '<button type="button" class="store-market-btn" onclick="storeSellItem(\'' + it.id + '\')">List</button>' +
            '<button type="button" class="store-market-btn buyback" onclick="storeBuybackItem(\'' + it.id + '\')" title="Official buyback: 35% of what you paid (65% off)">↩ +' + storeBuybackPrice(it) + ' 🐾</button>' +
            '</div>';
    }).join('');
}

async function storeSellItem(itemId) {
    if (!storeAvailable()) { updateMascot('Sign in to sell items.'); return; }
    const item = STORE_BY_ID[itemId];
    const input = document.getElementById('market-price-' + itemId);
    const price = input ? parseInt(input.value, 10) : 0;
    if (!item) return;
    if (!price || price < 1 || price > 5000) { storeMarketNote('Choose a price from 1 to 5000 Paws.'); return; }
    if (!window.confirm('List ' + item.name + ' for ' + price + ' Paws?')) return;
    try {
        const { error } = await sb.rpc('create_store_listing', { p_item: itemId, p_price: price });
        if (error) throw error;
        storeMarketNote('');
        updateMascot(item.name + ' is now for sale at ' + price + ' 🐾');
        await loadStoreMarket(true);
    } catch (e) {
        storeMarketNote(storeMarketError(e));
    }
}

async function storeCancelListing(listingId) {
    if (!storeAvailable()) return;
    if (!window.confirm('Cancel this listing?')) return;
    try {
        const { error } = await sb.rpc('cancel_store_listing', { p_listing: listingId });
        if (error) throw error;
        updateMascot('Listing cancelled.');
        await loadStoreMarket(true);
    } catch (e) {
        storeMarketNote(storeMarketError(e));
    }
}

async function storeBuyListing(listingId) {
    if (!storeAvailable()) { updateMascot('Sign in to buy items.'); return; }
    const row = STORE_MARKET_ROWS.find(r => String(r.listing_id) === String(listingId));
    if (!row) return;
    if (!window.confirm('Buy ' + (row.name_en || 'this item') + ' for ' + row.price + ' Paws?')) return;
    try {
        const { data, error } = await sb.rpc('buy_store_listing', { p_listing: listingId });
        if (error) throw error;
        const r = Array.isArray(data) ? data[0] : data;
        updateMascot('Bought ' + ((r && r.name) || row.name_en) + ' from the Market! 🛒');
        await loadStoreState(true);
        renderStore();
    } catch (e) {
        storeMarketNote(storeMarketError(e));
    }
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
    const gachaBtn = document.getElementById('store-gacha-btn');
    if (gachaBtn && !gachaBtn.dataset.busy) {
        gachaBtn.disabled = !storeAvailable();
        gachaBtn.innerText = storeAvailable() ? ('🎁 Open · ' + STORE_GACHA_COST + ' 🐾') : 'Sign in to open';
    }
    tabs.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-store-cat') === STORE_CATEGORY));
    if (note) {
        note.classList.toggle('hidden', !STORE_LOAD_ERROR);
        note.innerText = STORE_LOAD_ERROR || '';
    }
    const saleEl = document.getElementById('store-sale');
    if (saleEl) {
        const html = storeSaleBannerHTML();
        saleEl.innerHTML = html;
        saleEl.classList.toggle('hidden', !html);
    }
    const market = STORE_CATEGORY === 'market';
    const marketBtn = document.getElementById('store-market-btn');
    if (marketBtn) marketBtn.classList.toggle('active', market);
    const marketEl = document.getElementById('store-market');
    const gachaCard = document.getElementById('store-gacha-card');
    const gachaResult = document.getElementById('store-gacha-result');
    if (market) {
        grid.classList.add('hidden');
        if (marketEl) marketEl.classList.remove('hidden');
        if (gachaCard) gachaCard.classList.add('hidden');
        if (gachaResult) gachaResult.classList.add('hidden');
        loadStoreMarket(true);
        return;
    }
    grid.classList.remove('hidden');
    if (marketEl) marketEl.classList.add('hidden');
    if (gachaCard) gachaCard.classList.remove('hidden');
    if (STORE_CATEGORY === 'new') {
        const fresh = STORE_ITEMS.filter(it => STORE_NEW_IDS.indexOf(it.id) !== -1);
        grid.innerHTML = fresh.length
            ? '<div class="store-group"><h3 class="store-group-title">✨ New in Props</h3><div class="store-grid-inner">' + fresh.map(storeCardHTML).join('') + '</div></div>'
            : '<p class="text-gray-400 text-center py-8">New items are loading…</p>';
        storePaintCardBackgrounds(grid);
        return;
    }
    const groups = ['victory', 'hat', 'face', 'outfit', 'car', 'prop', 'background'];
    const labels = {
        victory: '🏆 Victory Animations (勝利晒命特效)',
        hat: 'Hats & Headwear',
        face: 'Face & Eyewear',
        outfit: 'Neck & Outfits',
        car: '🏎️ Drive & Go! Cars',
        prop: 'Props & Companions',
        background: 'Backgrounds & Effects'
    };
    const shown = STORE_CATEGORY === 'all' ? groups : [STORE_CATEGORY];
    grid.innerHTML = (STORE_CATEGORY === 'victory' ? storeVictoryTopHTML() : '') + shown.map(group => {
        const items = STORE_ITEMS.filter(it => storeLayerGroup(it) === group);
        if (!items.length) return '';
        const trialItem = STORE_VICTORY_RENTAL ? STORE_BY_ID[STORE_VICTORY_RENTAL] : null;
        const intro = group === 'victory'
            ? '<p class="store-victory-intro">Win a class battle and your champion cat plays this effect. Preview any card — what you see is what the class sees.' +
              (trialItem ? '<br><b class="store-victory-trial">🎟 Trial pass ready: ' + escapeHtml(trialItem.name) + ' (next class battle)</b>' : '') +
              '</p>'
            : '';
        return '<div class="store-group"><h3 class="store-group-title">' + labels[group] + '</h3>' + intro +
            '<div class="store-grid-inner">' + items.map(storeCardHTML).join('') + '</div></div>';
    }).join('');
    if (!grid.innerHTML) grid.innerHTML = '<p class="text-gray-400 text-center py-8">Nothing here yet.</p>';
    storePaintCardBackgrounds(grid);
}

function storeCardHTML(item) {
    const owned = item.price === 0 || !!STORE_OWNED[item.id];
    const equipped = item.slot === 'prop'
        ? (STORE_EQUIPPED.prop || []).indexOf(item.id) !== -1
        : STORE_EQUIPPED[item.slot] === item.id;
    const basePrice = storeBasePrice(item);
    const price = storePrice(item);
    const onSale = STORE_SALE.active && basePrice > 0;
    let action;
    if (!storeAvailable()) {
        action = '<span class="store-card-note">Sign in to buy</span>';
    } else if (equipped) {
        action = '<button type="button" class="store-btn store-btn-quiet" onclick="storeUnequip(\'' + item.slot + '\',\'' + item.id + '\')">Unequip</button>';
    } else if (owned) {
        action = '<button type="button" class="store-btn" onclick="storeEquipItem(\'' + item.id + '\')">Equip</button>';
    } else {
        action = '<button type="button" class="store-btn" onclick="storeBuyItem(\'' + item.id + '\')">Buy · ' + price + ' 🐾</button>';
    }
    const victoryBtns = item.slot === 'victory' ? (
        '<button type="button" class="store-btn store-btn-preview" onclick="victoryPreview(\'' + item.id + '\')">▶ Preview effect</button>' +
        (!owned && storeAvailable()
            ? '<button type="button" class="store-btn store-btn-rent" onclick="storeRentVictory(\'' + item.id + '\')">🎟 1-battle trial · ' + storeVictoryRent(item) + ' 🐾</button>'
            : '')
    ) : '';
    const topRank = item.slot === 'victory' ? storeVictoryTopRank(item.id) : -1;
    const topBadge = topRank === 0
        ? '<span class="store-victory-badge">🔥 Most used this week</span>'
        : (topRank === 1 ? '<span class="store-victory-badge">👑 Class battle favourite</span>' : '');
    const tryBtn = (!owned && storeAvailable())
        ? '<button type="button" class="store-btn store-btn-try" onclick="storeTryOnItem(\'' + item.id + '\')">👀 Try on</button>'
        : '';
    return '<div class="store-card' + (equipped ? ' equipped' : '') + '">' +
        (STORE_NEW_IDS.indexOf(item.id) !== -1 ? '<span class="store-card-new">NEW</span>' : '') +
        (item.slot === 'background'
            ? '<canvas class="store-card-bg" data-store-bg="' + item.id + '" aria-hidden="true"></canvas>'
            : '<div class="store-card-emoji" aria-hidden="true">' + item.emoji + '</div>') +
        '<p class="store-card-name">' + escapeHtml(item.name) + '</p>' +
        '<p class="store-card-zh">' + escapeHtml(item.zh) + '</p>' +
        topBadge +
        '<p class="store-card-rarity store-rarity-' + item.rarity.toLowerCase() + '">' + escapeHtml(item.rarity) + '</p>' +
        (item.slot === 'car' ? '<p class="store-card-stat">🏁 Top speed +' + Number(item.speed || 0) + '%</p>' : '') +
        (onSale ? '<p class="store-card-stat">⚡ Sale: <s>' + basePrice + '</s> → ' + price + ' 🐾</p>' : '') +
        (owned && item.price > 0 ? '<p class="store-card-owned">Owned</p>' : '') +
        action + tryBtn + victoryBtns +
        '</div>';
}

/* ---------------- Fitting room: try before you buy ----------------
   Try-on is free and never saves anything. It only opens when the student
   can already afford the item (or already owns it), so it never becomes a
   window-shopping loop; short on Paws gets an encouraging message instead. */

let STORE_TRY_ON = null;
let STORE_FITTING_ESC = false;

function storeFittingShell(html) {
    const el = document.getElementById('store-fitting');
    if (!el) return null;
    el.innerHTML = '<div class="store-fitting-card" role="dialog" aria-modal="true" aria-labelledby="store-fitting-title">' +
        '<button type="button" class="store-fitting-close" onclick="storeCloseFitting()" aria-label="Close">✕</button>' +
        html + '</div>';
    el.classList.remove('hidden');
    el.onclick = function (event) { if (event.target === el) storeCloseFitting(); };
    if (!STORE_FITTING_ESC) {
        STORE_FITTING_ESC = true;
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') storeCloseFitting();
        });
    }
    return el;
}

function storeCloseFitting() {
    STORE_TRY_ON = null;
    const el = document.getElementById('store-fitting');
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
}

function storeTryOnLook(item) {
    const look = storeMyLook();
    const key = storeLayerKey(item.slot);
    let prop = storeEquippedItems('prop');
    let bg = storeEquippedItem('background');
    let mode = '';
    if (key === 'prop') {
        prop = prop.filter(x => x && x.id !== item.id).concat([item]);
    } else if (key === 'background') {
        bg = item;
    } else if (key === 'car') {
        look.car = item.name;
        mode = 'kart';
    } else if (key !== 'prop' && key !== 'background') {
        look[key] = item.name;
    }
    return { look, prop, bg, mode };
}

function storeTryOnItem(id) {
    const item = STORE_BY_ID[id];
    if (!item) return;
    if (!storeAvailable()) {
        updateMascot('Sign in with your school account to try items on.');
        return;
    }
    const owned = item.price === 0 || !!STORE_OWNED[item.id];
    if (owned) {
        storeCloseFitting();
        storeEquipItem(id);
        return;
    }
    const basePrice = storeBasePrice(item);
    if (STORE_BALANCE < basePrice) {
        storeTryOnDenied(item);
        return;
    }

    STORE_TRY_ON = id;
    const view = storeTryOnLook(item);
    storeFittingShell(
        '<h3 id="store-fitting-title" class="text-lg font-bold text-orange-700 mb-1">Fitting room</h3>' +
        '<p class="text-sm text-gray-500 font-bold mb-2">Trying on ' + escapeHtml(item.name) + ' · ' + basePrice + ' 🐾</p>' +
        (item.slot === 'car' ? '<p class="text-xs font-bold text-emerald-600 mb-1">🏁 Top speed +' + Number(item.speed || 0) + '% in Drive &amp; Go</p>' : '') +
        '<canvas id="store-fitting-canvas" aria-label="Item preview"></canvas>' +
        '<p id="store-fitting-items" class="text-xs text-gray-500"></p>' +
        '<p class="text-xs text-gray-400 mt-2">Free to try — buy it to keep it on your cat.</p>' +
        '<div class="store-fitting-actions">' +
        '<button type="button" class="store-btn" onclick="storeBuyFromFitting()">Buy · ' + basePrice + ' 🐾</button>' +
        '<button type="button" class="dg-menu-button" onclick="storeCloseFitting()">Keep looking</button>' +
        '</div>'
    );
    const canvas = document.getElementById('store-fitting-canvas');
    storePaintLook(canvas, document.getElementById('store-fitting-items'), view.look, view.prop, view.bg, '', view.mode);
    updateMascot('Trying on ' + item.name + ' ✨');
}

function storeTryOnDenied(item) {
    STORE_TRY_ON = null;
    const basePrice = storeBasePrice(item);
    const need = Math.max(0, basePrice - STORE_BALANCE);
    storeFittingShell(
        '<div class="text-4xl mb-1" aria-hidden="true">💪</div>' +
        '<h3 id="store-fitting-title" class="text-lg font-bold text-orange-700 mb-1">Keep earning!</h3>' +
        '<p class="text-sm text-gray-600 font-bold">' + escapeHtml(item.name) + ' costs ' + basePrice + ' 🐾.<br>' +
        'You have ' + STORE_BALANCE + ' 🐾, so you need ' + need + ' more.</p>' +
        '<p class="text-xs text-gray-500 mt-2">Try-on opens once you can afford the item. Every correct answer in Dictation, Drive &amp; Go or Word Battle earns a Paw — keep going! 🐾</p>' +
        '<div class="store-fitting-actions">' +
        '<button type="button" class="store-btn" onclick="storeCloseFitting();storeShowPawsHelp()">🐾 How to earn</button>' +
        '<button type="button" class="dg-menu-button" onclick="storeCloseFitting()">OK</button>' +
        '</div>'
    );
    updateMascot('You need ' + need + ' more 🐾 — keep practising!');
}

function storeBuyFromFitting() {
    const id = STORE_TRY_ON;
    storeCloseFitting();
    if (id) storeBuyItem(id);
}

function storeVictoryTopHTML() {
    if (!STORE_VICTORY_TOP.length) return '';
    const rows = STORE_VICTORY_TOP.slice(0, 5).map((row, i) => {
        const item = STORE_BY_ID[row.item_id];
        if (!item) return '';
        const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : (i + 1) + '.'));
        return '<li><span>' + medal + '</span><b>' + escapeHtml(item.name) + '</b>' +
            '<span class="store-victory-top-uses">' + (Number(row.uses) || 0) + ' champion' +
            ((Number(row.uses) || 0) === 1 ? '' : 's') + '</span></li>';
    }).join('');
    if (!rows) return '';
    return '<div class="store-victory-top"><h3>🔥 Top Sellers · this week</h3><ol>' + rows + '</ol>' +
        '<p>Most-used victory animations in class battles over the last 7 days.</p></div>';
}

async function storeRentVictory(id) {
    const item = STORE_BY_ID[id];
    if (!item) return;
    if (!storeAvailable()) {
        updateMascot('Sign in with your school account to rent a victory effect.');
        return;
    }
    if (STORE_OWNED[id]) {
        updateMascot('You already own ' + item.name + '. Equip it instead.');
        return;
    }
    const cost = storeVictoryRent(item);
    if (STORE_BALANCE < cost) {
        updateMascot('You need ' + (cost - STORE_BALANCE) + ' more 🐾 to rent ' + item.name + '. Keep practising!');
        return;
    }
    if (!window.confirm('Rent ' + item.name + ' for your next class battle for ' + cost + ' Paws?')) return;
    try {
        const { data, error } = await sb.rpc('rent_victory_effect', { p_item: id });
        if (error) throw error;
        STORE_BALANCE = Math.max(0, Number(data) || 0);
        STORE_VICTORY_RENTAL = id;
        updateMascot('Trial pass ready — ' + item.name + ' plays after your next class battle win! 🎟');
        await loadStoreState(true);
    } catch (e) {
        const msg = String(e && (e.message || e));
        if (/NOT_ENOUGH_PAWS/.test(msg)) updateMascot('Not enough Paws for that trial pass.');
        else if (/ALREADY_OWNED/.test(msg)) updateMascot('You already own this effect.');
        else if (/ITEM_NOT_FOUND|PGRST202|Could not find/i.test(msg)) updateMascot('Run supabase/store_victory.sql to enable victory effects.');
        else updateMascot('Could not rent that effect. Please try again.');
    }
}

async function storeBuyItem(id) {
    const item = STORE_BY_ID[id];
    if (!item) return;
    if (!storeAvailable()) { updateMascot('Sign in with your school account to buy items.'); return; }
    if (item.price === 0) { await storeEquipItem(id); return; }
    if (!window.confirm('Buy ' + item.name + ' for ' + storePrice(item) + ' Paws?')) return;
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
        if (/NOT_ENOUGH_PAWS/.test(msg)) {
            updateMascot('Not enough Paws — this item costs ' + storePrice(item) + ' 🐾 and you have ' + STORE_BALANCE + ' 🐾.');
        } else if (/ALREADY_OWNED/.test(msg)) {
            updateMascot('You already own that item.');
        } else if (/ITEM_NOT_FOUND/.test(msg)) {
            updateMascot('This item is not in the Store catalog yet — the teacher needs to run supabase/store_gacha.sql.');
        } else {
            updateMascot('Could not buy that item. Ask your teacher to run supabase/store.sql.');
        }
    }
}

async function storeEquipItem(id) {
    const item = STORE_BY_ID[id];
    if (!item) return;
    if (!storeAvailable()) { updateMascot('Sign in with your school account to equip items.'); return; }
    try {
        const { error } = await sb.rpc('equip_store_item', { p_slot: item.slot, p_item: id });
        if (error) throw error;
        if (item.slot === 'prop') {
            const list = STORE_EQUIPPED.prop || [];
            if (list.indexOf(id) === -1) list.push(id);
            STORE_EQUIPPED.prop = list;
        } else {
            STORE_EQUIPPED[item.slot] = id;
        }
        const profile = storeReadLocalProfileLook();
        const key = storeLayerKey(item.slot);
        if (key !== 'prop' && key !== 'background' && key !== 'car' && key !== 'victory') profile[key] = item.name;
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

async function storeUnequip(slot, itemId) {
    if (!storeAvailable()) return;
    try {
        let res = await sb.rpc('unequip_store_item', { p_slot: slot, p_item: itemId || '' });
        if (res.error && /PGRST202|Could not find the function|does not exist/i.test(res.error.message || '')) {
            res = await sb.rpc('equip_store_item', { p_slot: slot, p_item: '' });
        }
        if (res.error) throw res.error;
        if (slot === 'prop') {
            const list = STORE_EQUIPPED.prop || [];
            STORE_EQUIPPED.prop = itemId ? list.filter(id => id !== itemId) : [];
        } else {
            delete STORE_EQUIPPED[slot];
        }
        const key = storeLayerKey(slot);
        if (key !== 'prop' && key !== 'background') {
            const profile = storeReadLocalProfileLook();
            profile[key] = 'None';
            STORE_PROFILE_LOOK = profile;
            storeSaveLocalProfileLook();
            if (typeof DG !== 'undefined' && DG.readSettings) {
                const s = DG.readSettings();
                s[key] = 'None';
                DG.saveSettings();
            }
            saveProfileLook();
        }
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
    if (look && look.car && look.car !== 'Stock') bits.push('🏎️ ' + look.car);
    const props = Array.isArray(prop) ? prop : (prop ? [prop] : []);
    props.forEach(p => { if (p && p.name) bits.push('✨ ' + p.name); });
    if (bg) bits.push('🖼️ ' + bg.name);
    return bits;
}

function storeFillBackgroundBase(ctx, bg, w, h) {
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    if (bg) {
        let bottom = '#fff7ed';
        if (bg.id === 'bg_black') bottom = '#0b1220';
        else if (bg.id === 'bg_grey') bottom = '#6b7280';
        else if (bg.id === 'bg_yellow') bottom = '#fef9c3';
        grd.addColorStop(0, bg.color || '#dbeafe');
        grd.addColorStop(1, bottom);
    } else {
        grd.addColorStop(0, '#dbeafe');
        grd.addColorStop(1, '#fef3c7');
    }
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
}

/* Hand-drawn Store backgrounds. The caller paints the item-colour gradient
   first, so unknown IDs still get a usable colour; these branches add real
   artwork for the room/effect backgrounds instead of a floating emoji. */
function storePaintBackground(ctx, bg, w, h) {
    if (!bg || !w || !h) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

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
    } else if (bg.id === 'bg_library') {
        /* Oxford library: tall shelves, an arched moonlit window, warm lamps. */
        const wall = ctx.createLinearGradient(0, 0, 0, h);
        wall.addColorStop(0, '#2b1a10');
        wall.addColorStop(0.55, '#5a3a22');
        wall.addColorStop(1, '#2a170d');
        ctx.fillStyle = wall;
        ctx.fillRect(0, 0, w, h);
        const floorY = h * 0.72;
        const floor = ctx.createLinearGradient(0, floorY, 0, h);
        floor.addColorStop(0, '#7c4a2a');
        floor.addColorStop(1, '#2b160c');
        ctx.fillStyle = floor;
        ctx.fillRect(0, floorY, w, h - floorY);
        ctx.strokeStyle = 'rgba(0,0,0,.28)';
        ctx.lineWidth = 1;
        for (let i = -2; i <= 2; i += 1) {
            ctx.beginPath();
            ctx.moveTo(w * 0.5 + i * w * 0.18, floorY);
            ctx.lineTo(w * 0.5 + i * w * 0.42, h);
            ctx.stroke();
        }
        for (let j = 1; j <= 2; j += 1) {
            const y = floorY + (h - floorY) * (j / 3);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
        const shelf = (x, sw) => {
            const top = h * 0.12;
            ctx.fillStyle = '#2e1a0e';
            ctx.fillRect(x, top, sw, floorY - top);
            ctx.fillStyle = 'rgba(255,255,255,.06)';
            ctx.fillRect(x, top, sw * 0.15, floorY - top);
            ctx.strokeStyle = '#7c4a2a';
            ctx.lineWidth = Math.max(1.5, w * 0.008);
            const rows = 4;
            for (let r = 0; r <= rows; r += 1) {
                const y = top + (floorY - top) * (r / rows);
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + sw, y);
                ctx.stroke();
                if (r === rows) break;
                const bh = (floorY - top) / rows - 6;
                let bx = x + 3;
                let k = 0;
                while (bx < x + sw - 4) {
                    const bw = 3 + ((k * 7 + r * 5) % 5);
                    const bh2 = bh * (0.62 + ((k + r * 3) % 28) / 100);
                    const colors = ['#b45309', '#7f1d1d', '#1e3a8a', '#166534', '#6b21a8', '#a16207', '#0f766e'];
                    ctx.fillStyle = colors[(k + r) % colors.length];
                    ctx.fillRect(bx, y + 4 + bh - bh2, bw, bh2);
                    ctx.fillStyle = 'rgba(255,255,255,.16)';
                    ctx.fillRect(bx, y + 4 + bh - bh2, 1, bh2);
                    bx += bw + 2;
                    k += 1;
                }
            }
        };
        shelf(w * 0.015, w * 0.2);
        shelf(w * 0.785, w * 0.2);
        const cx = w * 0.5;
        const ww = w * 0.2;
        const wy = h * 0.12;
        const wh = h * 0.3;
        const win = ctx.createLinearGradient(0, wy, 0, wy + wh);
        win.addColorStop(0, '#0b1b33');
        win.addColorStop(1, '#1d3557');
        ctx.fillStyle = win;
        ctx.beginPath();
        ctx.moveTo(cx - ww / 2, wy + wh);
        ctx.lineTo(cx - ww / 2, wy + ww / 2);
        ctx.arc(cx, wy + ww / 2, ww / 2, Math.PI, 0);
        ctx.lineTo(cx + ww / 2, wy + wh);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(253,224,71,.8)';
        ctx.beginPath();
        ctx.arc(cx + ww * 0.18, wy + wh * 0.42, ww * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7c4a2a';
        ctx.lineWidth = Math.max(2, w * 0.012);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, wy + 2);
        ctx.lineTo(cx, wy + wh);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - ww / 2, wy + wh * 0.62);
        ctx.lineTo(cx + ww / 2, wy + wh * 0.62);
        ctx.stroke();
        const lamp = (x, y, r) => {
            const glow = ctx.createRadialGradient(x, y, 1, x, y, r * 4);
            glow.addColorStop(0, 'rgba(253,224,71,.55)');
            glow.addColorStop(1, 'rgba(253,224,71,0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(x, y, r * 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fde68a';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#3b2416';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, y - r);
            ctx.lineTo(x, y - r * 3);
            ctx.stroke();
        };
        lamp(w * 0.26, h * 0.3, Math.max(3, w * 0.014));
        lamp(w * 0.74, h * 0.3, Math.max(3, w * 0.014));
        ctx.fillStyle = 'rgba(120,53,15,.55)';
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.88, w * 0.3, h * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();
    } else if (bg.id === 'bg_bigben') {
        /* Big Ben at night: clock tower, city windows, rain and wet street. */
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#070d1a');
        sky.addColorStop(0.55, '#172554');
        sky.addColorStop(1, '#334155');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 30; i += 1) {
            const x = (i * 73 + 17) % w;
            const y = (i * 41 + 9) % (h * 0.55);
            ctx.fillStyle = 'rgba(226,232,240,' + (0.18 + ((i * 7) % 50) / 100) + ')';
            ctx.fillRect(x, y, 1.2, 1.2);
        }
        const moon = ctx.createRadialGradient(w * 0.16, h * 0.16, 2, w * 0.16, h * 0.16, 18);
        moon.addColorStop(0, 'rgba(241,245,249,.95)');
        moon.addColorStop(1, 'rgba(241,245,249,0)');
        ctx.fillStyle = moon;
        ctx.beginPath();
        ctx.arc(w * 0.16, h * 0.16, Math.max(8, w * 0.06), 0, Math.PI * 2);
        ctx.fill();
        const base = h * 0.78;
        ctx.fillStyle = '#0b1220';
        const blds = [
            [0, 0.11, 0.2], [0.09, 0.08, 0.3], [0.16, 0.13, 0.25],
            [0.28, 0.1, 0.35], [0.37, 0.15, 0.22], [0.51, 0.09, 0.3],
            [0.6, 0.16, 0.18], [0.75, 0.1, 0.28], [0.85, 0.14, 0.33]
        ];
        blds.forEach(([x, bw, bh]) => {
            ctx.fillRect(w * x, base - h * bh, w * bw, h * bh);
        });
        ctx.fillStyle = 'rgba(250,204,21,.55)';
        for (let i = 0; i < 24; i += 1) {
            const x = w * (0.02 + ((i * 23) % 92) / 100);
            const y = base - h * (0.05 + ((i * 17) % 22) / 100);
            ctx.fillRect(x, y, 1.8, 2.6);
        }
        const tx = w * 0.77;
        const tw = w * 0.11;
        const ty = h * 0.15;
        const tower = ctx.createLinearGradient(tx, 0, tx + tw, 0);
        tower.addColorStop(0, '#334155');
        tower.addColorStop(0.45, '#94a3b8');
        tower.addColorStop(1, '#1e293b');
        ctx.fillStyle = tower;
        ctx.fillRect(tx, ty, tw, base - ty);
        const ccx = tx + tw / 2;
        const ccy = h * 0.31;
        const cr = tw * 0.38;
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(ccx, ccy, cr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ccx, ccy);
        ctx.lineTo(ccx, ccy - cr * 0.62);
        ctx.moveTo(ccx, ccy);
        ctx.lineTo(ccx + cr * 0.48, ccy);
        ctx.stroke();
        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + tw / 2, ty - h * 0.08);
        ctx.lineTo(tx + tw, ty);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(148,163,184,.4)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 80; i += 1) {
            const x = (i * 43 + 11) % w;
            const y = (i * 29 + 7) % h;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - 4, y + 10);
            ctx.stroke();
        }
        const street = ctx.createLinearGradient(0, base, 0, h);
        street.addColorStop(0, 'rgba(30,41,59,.35)');
        street.addColorStop(1, 'rgba(2,6,23,.9)');
        ctx.fillStyle = street;
        ctx.fillRect(0, base, w, h - base);
        ctx.strokeStyle = 'rgba(250,204,21,.18)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i += 1) {
            const x = w * (0.1 + i * 0.14);
            ctx.beginPath();
            ctx.moveTo(x, base + 4);
            ctx.lineTo(x + 6, h - 6);
            ctx.stroke();
        }
    } else if (bg.id === 'bg_aplus') {
        /* Floating A+ marks with gold stars and a radial glow. */
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#0b1026');
        sky.addColorStop(0.55, '#1e1b4b');
        sky.addColorStop(1, '#312e81');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        const glow = ctx.createRadialGradient(w * 0.5, h * 0.4, 4, w * 0.5, h * 0.4, w * 0.6);
        glow.addColorStop(0, 'rgba(253,224,71,.35)');
        glow.addColorStop(1, 'rgba(253,224,71,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        const base = Math.max(16, Math.min(46, Math.min(w, h) * 0.3));
        const marks = [
            [0.18, 0.25, 0.45, -0.2], [0.5, 0.16, 0.8, 0.08],
            [0.81, 0.33, 0.5, 0.22], [0.3, 0.58, 0.38, -0.12],
            [0.68, 0.62, 0.42, 0.16]
        ];
        marks.forEach(([x, y, s, rot]) => {
            ctx.save();
            ctx.translate(w * x, h * y);
            ctx.rotate(rot);
            ctx.scale(s, s);
            ctx.font = '800 ' + base + 'px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(253,224,71,.85)';
            ctx.shadowBlur = 16;
            ctx.fillStyle = '#f59e0b';
            ctx.fillText('A+', 0, 2);
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#fef3c7';
            ctx.fillText('A+', 0, -1);
            ctx.restore();
        });
        for (let i = 0; i < 22; i += 1) {
            const x = (i * 61 + 13) % w;
            const y = (i * 37 + 11) % h;
            const s = 1 + ((i * 5) % 3);
            ctx.fillStyle = 'rgba(253,224,71,' + (0.3 + ((i * 9) % 50) / 100) + ')';
            ctx.beginPath();
            ctx.moveTo(x, y - s * 2);
            ctx.lineTo(x + s * 0.6, y - s * 0.6);
            ctx.lineTo(x + s * 2, y);
            ctx.lineTo(x + s * 0.6, y + s * 0.6);
            ctx.lineTo(x, y + s * 2);
            ctx.lineTo(x - s * 0.6, y + s * 0.6);
            ctx.lineTo(x - s * 2, y);
            ctx.lineTo(x - s * 0.6, y - s * 0.6);
            ctx.closePath();
            ctx.fill();
        }
    } else if (bg.id === 'bg_sakura') {
        /* Cherry blossoms: layered branches, foreground blossoms, falling petals. */
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#fdf2f8');
        sky.addColorStop(0.55, '#fce7f3');
        sky.addColorStop(1, '#fbcfe8');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(251,207,232,.55)';
        ctx.beginPath();
        ctx.ellipse(w * 0.2, h * 0.78, w * 0.45, h * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(249,168,212,.35)';
        ctx.beginPath();
        ctx.ellipse(w * 0.8, h * 0.82, w * 0.5, h * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        const branch = (x1, y1, cx, cy, x2, y2, lw, color, alpha) => {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.quadraticCurveTo(cx, cy, x2, y2);
            ctx.stroke();
            ctx.restore();
        };
        branch(-10, h * 0.12, w * 0.3, h * 0.02, w * 0.55, h * 0.05, Math.max(2, w * 0.024), '#9d174d', 0.18);
        branch(-10, h * 0.1, w * 0.28, h * 0.0, w * 0.58, h * 0.02, Math.max(2.5, w * 0.032), '#4c0519', 1);
        branch(w * 0.18, h * 0.08, w * 0.26, h * 0.2, w * 0.3, h * 0.32, Math.max(1.5, w * 0.016), '#4c0519', 1);
        branch(w * 0.45, h * 0.06, w * 0.56, h * 0.1, w * 0.62, h * 0.2, Math.max(1.2, w * 0.013), '#4c0519', 1);
        const blossom = (x, y, r, alpha) => {
            ctx.save();
            ctx.globalAlpha = alpha;
            for (let i = 0; i < 5; i += 1) {
                const a = (Math.PI * 2 / 5) * i - Math.PI / 2;
                ctx.fillStyle = '#fb7185';
                ctx.beginPath();
                ctx.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.9, r * 0.55, a, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = '#fde68a';
            ctx.beginPath();
            ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };
        const br = Math.max(2.5, w * 0.02);
        [[0.13, 0.13], [0.22, 0.09], [0.3, 0.2], [0.52, 0.08], [0.6, 0.16], [0.4, 0.3], [0.68, 0.24]]
            .forEach(([x, y]) => blossom(w * x, h * y, br, 0.95));
        for (let i = 0; i < 30; i += 1) {
            const x = (i * 53 + 17) % w;
            const y = (i * 31 + 9) % h;
            const s = 0.5 + ((i * 7) % 10) / 10;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((i * 29) % 360);
            ctx.fillStyle = 'rgba(251,113,133,' + (0.25 + ((i * 11) % 50) / 100) + ')';
            ctx.beginPath();
            ctx.ellipse(0, 0, 3.2 * s, 1.7 * s, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    } else if (bg.id === 'bg_cyber') {
        /* Neon perspective grid with a glowing horizon and skyline. */
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#090014');
        sky.addColorStop(0.55, '#1e1b4b');
        sky.addColorStop(1, '#0f172a');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        const horizon = h * 0.58;
        const sun = ctx.createRadialGradient(w * 0.5, horizon, 2, w * 0.5, horizon, w * 0.3);
        sun.addColorStop(0, 'rgba(244,114,182,.85)');
        sun.addColorStop(0.4, 'rgba(236,72,153,.4)');
        sun.addColorStop(1, 'rgba(236,72,153,0)');
        ctx.fillStyle = sun;
        ctx.beginPath();
        ctx.arc(w * 0.5, horizon, w * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(15,23,42,.65)';
        ctx.fillRect(0, horizon - 2, w, 4);
        ctx.fillStyle = '#0b1220';
        for (let i = 0; i < 10; i += 1) {
            const bw = w * 0.09;
            const bx = i * bw * 0.95;
            const bh = h * (0.05 + ((i * 13) % 12) / 100);
            ctx.fillRect(bx, horizon - bh, bw * 0.8, bh);
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(34,211,238,.7)';
        ctx.shadowColor = 'rgba(34,211,238,.8)';
        ctx.shadowBlur = 4;
        ctx.lineWidth = 1;
        for (let i = -5; i <= 5; i += 1) {
            ctx.beginPath();
            ctx.moveTo(w * 0.5 + i * w * 0.16, h);
            ctx.lineTo(w * 0.5 + i * w * 0.02, horizon);
            ctx.stroke();
        }
        for (let j = 0; j < 8; j += 1) {
            const t = j / 8;
            const y = horizon + (h - horizon) * t * t;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(236,72,153,.85)';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(236,72,153,.9)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(0, horizon);
        ctx.lineTo(w, horizon);
        ctx.stroke();
        ctx.shadowBlur = 0;
    } else if (bg.id === 'bg_desk') {
        /* Cozy desk: warm room, night window, lamp glow, books and a mug. */
        const wall = ctx.createLinearGradient(0, 0, 0, h);
        wall.addColorStop(0, '#3b2416');
        wall.addColorStop(0.6, '#5a3a22');
        wall.addColorStop(1, '#2a170d');
        ctx.fillStyle = wall;
        ctx.fillRect(0, 0, w, h);
        const wx = w * 0.6;
        const wy = h * 0.12;
        const ww = w * 0.28;
        const wh = h * 0.38;
        const win = ctx.createLinearGradient(0, wy, 0, wy + wh);
        win.addColorStop(0, '#0b1b33');
        win.addColorStop(1, '#1e3a5f');
        ctx.fillStyle = win;
        ctx.fillRect(wx, wy, ww, wh);
        ctx.strokeStyle = '#7c4a2a';
        ctx.lineWidth = 3;
        ctx.strokeRect(wx, wy, ww, wh);
        ctx.beginPath();
        ctx.moveTo(wx + ww / 2, wy);
        ctx.lineTo(wx + ww / 2, wy + wh);
        ctx.moveTo(wx, wy + wh / 2);
        ctx.lineTo(wx + ww, wy + wh / 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(253,224,71,.8)';
        ctx.beginPath();
        ctx.arc(wx + ww * 0.7, wy + wh * 0.3, ww * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(127,29,29,.75)';
        ctx.beginPath();
        ctx.moveTo(wx - 8, wy - 6);
        ctx.quadraticCurveTo(wx - 18, wy + wh * 0.5, wx - 6, wy + wh + 8);
        ctx.lineTo(wx + 4, wy + wh + 8);
        ctx.quadraticCurveTo(wx - 4, wy + wh * 0.5, wx + 2, wy - 6);
        ctx.fill();
        const dy = h * 0.72;
        ctx.fillStyle = '#7c4a2a';
        ctx.beginPath();
        ctx.moveTo(0, dy + 8);
        ctx.lineTo(w * 0.18, dy);
        ctx.lineTo(w * 0.82, dy);
        ctx.lineTo(w, dy + 8);
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
        const top = ctx.createLinearGradient(0, dy, 0, h);
        top.addColorStop(0, 'rgba(255,255,255,.18)');
        top.addColorStop(0.2, 'rgba(255,255,255,0)');
        ctx.fillStyle = top;
        ctx.fillRect(0, dy, w, h - dy);
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.fillRect(0, h * 0.86, w, h * 0.14);
        const lx = w * 0.18;
        const ly = h * 0.52;
        const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, w * 0.22);
        glow.addColorStop(0, 'rgba(253,224,71,.6)');
        glow.addColorStop(1, 'rgba(253,224,71,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lx, ly, w * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(lx - 10, ly);
        ctx.lineTo(lx + 10, ly);
        ctx.lineTo(lx + 5, ly - 10);
        ctx.lineTo(lx - 5, ly - 10);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 10);
        ctx.lineTo(lx, ly - 26);
        ctx.stroke();
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(w * 0.32, h * 0.7, w * 0.08, h * 0.1);
        ctx.fillStyle = '#7f1d1d';
        ctx.fillRect(w * 0.34, h * 0.66, w * 0.06, h * 0.06);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(w * 0.73, h * 0.66, w * 0.06, h * 0.08);
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w * 0.79, h * 0.7, h * 0.02, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.5)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i += 1) {
            ctx.beginPath();
            ctx.moveTo(w * (0.74 + i * 0.015), h * 0.65);
            ctx.quadraticCurveTo(w * (0.72 + i * 0.02), h * 0.62, w * (0.75 + i * 0.015), h * 0.59);
            ctx.stroke();
        }
    } else if (bg.id === 'bg_galaxy') {
        /* Starry galaxy: ringed planet, nebula and shooting star. */
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#020617');
        sky.addColorStop(0.6, '#1e1b4b');
        sky.addColorStop(1, '#312e81');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        const neb = ctx.createRadialGradient(w * 0.7, h * 0.3, 4, w * 0.7, h * 0.3, w * 0.5);
        neb.addColorStop(0, 'rgba(167,139,250,.28)');
        neb.addColorStop(1, 'rgba(167,139,250,0)');
        ctx.fillStyle = neb;
        ctx.fillRect(0, 0, w, h);
        const px = w * 0.22;
        const py = h * 0.32;
        const pr = Math.max(10, w * 0.12);
        const planet = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.2, px, py, pr);
        planet.addColorStop(0, '#c4b5fd');
        planet.addColorStop(0.6, '#7c3aed');
        planet.addColorStop(1, '#2e1065');
        ctx.fillStyle = planet;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-0.35);
        ctx.strokeStyle = 'rgba(253,224,71,.75)';
        ctx.lineWidth = Math.max(2, pr * 0.18);
        ctx.beginPath();
        ctx.ellipse(0, 0, pr * 1.7, pr * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        for (let i = 0; i < 45; i += 1) {
            const x = (i * 73 + 17) % w;
            const y = (i * 41 + 9) % h;
            ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + ((i * 7) % 60) / 100) + ')';
            const s = 1 + ((i * 3) % 2);
            ctx.fillRect(x, y, s, s);
        }
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(w * 0.68, h * 0.12);
        ctx.lineTo(w * 0.54, h * 0.22);
        ctx.stroke();
    } else if (bg.id === 'bg_yellow' || bg.id === 'bg_black' || bg.id === 'bg_grey') {
        const v = ctx.createRadialGradient(w * 0.5, h * 0.42, 8, w * 0.5, h * 0.42, w * 0.8);
        v.addColorStop(0, 'rgba(255,255,255,.07)');
        v.addColorStop(1, 'rgba(0,0,0,.16)');
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
}

function storePaintLook(canvas, labelEl, look, prop, bg, emptyText, mode) {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 190;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    storeFillBackgroundBase(ctx, bg, cssW, cssH);
    storePaintBackground(ctx, bg, cssW, cssH);
    ctx.fillStyle = 'rgba(120,113,108,.22)';
    ctx.beginPath();
    ctx.ellipse(cssW / 2, cssH * 0.88, cssW * 0.2, cssH * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    if (mode === 'kart' && typeof DG !== 'undefined' && DG.drawKart) {
        DG.drawKart(ctx, cssW / 2, cssH * 0.88, Math.min(cssW / 250, cssH / 190), look, { preview: true });
    } else if (typeof DG !== 'undefined' && DG.drawCatAvatar) {
        DG.drawCatAvatar(ctx, cssW / 2, cssH * 0.9, Math.min(cssW / 260, cssH / 220), look);
    } else if (typeof DG !== 'undefined' && DG.drawKart) {
        DG.drawKart(ctx, cssW / 2, cssH * 0.84, Math.min(cssW / 250, cssH / 190), look, { preview: true });
    }
    if (typeof DG !== 'undefined' && DG.drawCatProps) {
        DG.drawCatProps(ctx, prop, cssW, cssH);
    }
    if (labelEl) {
        const bits = storeLookBits(look, prop, bg);
        labelEl.innerText = bits.length ? bits.join(' · ') : (emptyText || 'Nothing equipped yet.');
    }
}

function storePaintCardBackgrounds(root) {
    (root || document).querySelectorAll('canvas[data-store-bg]').forEach((cv) => {
        const item = STORE_BY_ID[cv.getAttribute('data-store-bg')];
        if (!item) return;
        const w = cv.clientWidth || 140;
        const h = cv.clientHeight || 74;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        storeFillBackgroundBase(ctx, item, w, h);
        storePaintBackground(ctx, item, w, h);
    });
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
    storePaintLook(canvas, label, look, storeEquippedItems('prop'), storeEquippedItem('background'), 'No store items equipped yet.');
    document.querySelectorAll('#profile-cat-picker [data-profile-cat]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-profile-cat') === look.cat);
    });
}

function storeSetProfileCat(cat) {
    if (typeof DG === 'undefined') return;
    const pickable = DG.CAT_OPTIONS || DG.CATS || ['Ginger', 'Ragdoll'];
    if (pickable.indexOf(cat) === -1) return;
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
    const props = Array.isArray(data.props)
        ? data.props.map(item).filter(Boolean)
        : (data.prop ? [item(data.prop)].filter(Boolean) : []);
    storePaintLook(canvas, label, look, props, item(data.background), 'Nothing equipped yet.');
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

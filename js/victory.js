/* LearniTY — Victory Animations (勝利晒命特效).
   Self-contained canvas stage used by the Store preview button and by the
   class-battle winner screens. Everything is drawn on one canvas so it works
   on phones, and it never touches game state or scores. */

(function () {
    'use strict';

    // DG is defined by a later script, so look it up at call time.
    function cat() { return window.DG; }
    const VICTORY = window.VICTORY = {};

    const EFFECTS = {
        victory_confetti: { name: 'Confetti Cannon', zh: '彩帶禮炮' },
        victory_spotlight: { name: 'Spotlight', zh: '巨星聚光燈' },
        victory_emojirain: { name: 'Emoji Rain', zh: '表情符號雨' },
        victory_micdrop: { name: 'Mic Drop', zh: '掉咪走人' },
        victory_dealwithit: { name: 'Deal With It', zh: '像素黑超降臨' },
        victory_bananaslip: { name: 'Banana Slip', zh: '全場滑倒' },
        victory_moneygun: { name: 'Money Gun', zh: '積分噴鈔機' }
    };

    const DURATION = 6.4;
    let overlay = null;
    let canvas = null;
    let raf = 0;
    let startedAt = 0;
    let audio = null;
    let currentId = '';
    const claimed = Object.create(null);
    const EMOJIS = ['😎', '🔥', '💯', '👑'];
    const CONFETTI_COLORS = ['#f87171', '#fbbf24', '#34d399', '#38bdf8', '#a78bfa', '#f472b6'];

    VICTORY.has = function (id) { return !!EFFECTS[id]; };
    VICTORY.name = function (id) { return (EFFECTS[id] && EFFECTS[id].name) || ''; };

    function championLook(opts) {
        if (opts && opts.look) {
            const l = opts.look;
            return { cat: l.cat || 'Ginger', hat: l.hat, ears: l.ears, glasses: l.glasses, cheeks: l.cheeks, outfit: l.outfit, neck: l.neck, car: 'Stock' };
        }
        // Teacher preview: show the teacher account's own cat.
        try {
            if (typeof isTeacherAccount === 'function' && isTeacherAccount() &&
                window.DG && typeof window.DG.readSettings === 'function') {
                const t = window.DG.readSettings();
                return { cat: t.cat || 'Ginger', hat: t.hat, ears: t.ears, glasses: t.glasses, cheeks: t.cheeks, outfit: t.outfit, neck: t.neck, car: 'Stock' };
            }
        } catch (e) {}
        try {
            if (typeof storeMyLook === 'function') {
                const l = storeMyLook();
                return { cat: l.cat || 'Ginger', hat: l.hat, ears: l.ears, glasses: l.glasses, cheeks: l.cheeks, outfit: l.outfit, neck: l.neck, car: 'Stock' };
            }
        } catch (e) {}
        return { cat: 'Ginger', hat: 'None', glasses: 'None', outfit: 'None' };
    }

    function ensureOverlay() {
        if (overlay && document.body.contains(overlay)) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'victory-stage';
        overlay.innerHTML =
            '<div class="victory-head">' +
            '<div><p class="victory-kicker">Victory animation</p>' +
            '<h2 class="victory-title">🏆 Class champion</h2></div>' +
            '<button type="button" class="victory-close" aria-label="Close">✕</button>' +
            '</div>' +
            '<canvas id="victory-canvas"></canvas>' +
            '<div class="victory-foot"><span id="victory-caption"></span>' +
            '<button type="button" class="victory-done" id="victory-done">Continue</button></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('.victory-close').addEventListener('click', VICTORY.close);
        overlay.querySelector('#victory-done').addEventListener('click', VICTORY.close);
        canvas = overlay.querySelector('#victory-canvas');
        return overlay;
    }

    VICTORY.close = function () {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (audio) {
            try { audio.pause(); audio.currentTime = 0; } catch (e) {}
            audio = null;
        }
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        canvas = null;
        currentId = '';
    };

    VICTORY.play = function (itemId, opts) {
        if (!EFFECTS[itemId]) return false;
        const o = opts || {};
        VICTORY.close();
        ensureOverlay();
        currentId = itemId;
        startedAt = performance.now();
        const meta = EFFECTS[itemId];
        const caption = overlay.querySelector('#victory-caption');
        caption.textContent = meta.name + ' · ' + meta.zh + (o.trial ? ' · trial pass' : '');
        const done = overlay.querySelector('#victory-done');
        done.style.visibility = 'hidden';
        overlay.querySelector('.victory-title').textContent = o.title || '🏆 Class champion';

        try {
            audio = new Audio('/music/trophyMusic.mp3');
            audio.volume = 0.42;
            audio.play().catch(function () {});
        } catch (e) { audio = null; }

        const look = championLook(o);
        const state = makeState(itemId, o);

        const loop = function (now) {
            if (!canvas) return;
            const t = (now - startedAt) / 1000;
            drawFrame(t, state, look, o);
            if (t > DURATION - 0.8) done.style.visibility = 'visible';
            if (t < DURATION || o.hold) raf = requestAnimationFrame(loop);
            else raf = 0;
        };
        raf = requestAnimationFrame(loop);
        return true;
    };

    /* ---------- scene ---------- */

    function metrics() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = canvas.clientWidth || 640;
        const h = canvas.clientHeight || 420;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const k = Math.min(w / 620, h / 380);      // layout unit
        return { ctx, w, h, k };
    }

    function makeState(itemId, o) {
        const s = { id: itemId, parts: [], bills: [], emojis: [], puffs: [] };
        return s;
    }

    function podium(ctx, w, h, k, t) {
        const baseY = h * 0.9;
        const firstH = 54 * k;
        const sideH = 36 * k;
        const firstW = 150 * k;
        const sideW = 116 * k;
        const cx = w / 2;
        ctx.save();
        // 2nd
        ctx.fillStyle = '#243349';
        ctx.fillRect(cx - sideW - firstW / 2 - 8 * k, baseY - sideH, sideW, sideH);
        // 3rd
        ctx.fillRect(cx + firstW / 2 + 8 * k, baseY - sideH, sideW, sideH);
        // 1st
        const g = ctx.createLinearGradient(0, baseY - firstH, 0, baseY);
        g.addColorStop(0, '#f59e0b');
        g.addColorStop(1, '#b45309');
        ctx.fillStyle = g;
        ctx.fillRect(cx - firstW / 2, baseY - firstH, firstW, firstH);
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.fillRect(cx - firstW / 2, baseY - firstH, firstW, 6 * k);
        ctx.restore();
    }

    function catAt(ctx, x, y, scale, look, extra) {
        const d = window.DG;
        if (d && d.drawCatAvatar) d.drawCatAvatar(ctx, x, y, scale, look, extra || {});
    }

    function drawFrame(t, state, look, o) {
        const m = metrics();
        const { ctx, w, h, k } = m;
        const showPodium = true;
        const cx = w / 2;
        const catScale = Math.min(w / 620, h / 380) * 1.55;
        const baseY = h * 0.9;
        const winnerY = baseY - 54 * k;

        ctx.clearRect(0, 0, w, h);
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, state.id === 'victory_spotlight' ? '#020617' : '#0b1220');
        bg.addColorStop(1, '#111b2e');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        if (state.id === 'victory_spotlight') spotlightBg(ctx, w, h, cx, winnerY, catScale, t);

        if (showPodium) podium(ctx, w, h, k, t);

        // runner-up cats (banana slip needs them; other effects keep it clean)
        if (state.id === 'victory_bananaslip') {
            drawRunnerUps(ctx, w, h, k, catScale, t);
        }

        // champion
        catAt(ctx, cx, winnerY, catScale, look);

        if (state.id === 'victory_confetti') effectConfetti(ctx, w, h, k, cx, winnerY, catScale, t, state);
        else if (state.id === 'victory_spotlight') effectSpotlight(ctx, w, h, k, cx, winnerY, catScale, t, state);
        else if (state.id === 'victory_emojirain') effectEmojiRain(ctx, w, h, k, t, state);
        else if (state.id === 'victory_micdrop') effectMicDrop(ctx, w, h, k, cx, winnerY, catScale, t);
        else if (state.id === 'victory_dealwithit') effectDealWithIt(ctx, w, h, k, cx, winnerY, catScale, t);
        else if (state.id === 'victory_bananaslip') effectBananaSlip(ctx, w, h, k, cx, winnerY, catScale, t, state);
        else if (state.id === 'victory_moneygun') effectMoneyGun(ctx, w, h, k, cx, winnerY, catScale, t, state);

        // title strip
        if (t > 0.35) {
            const a = Math.min(1, (t - 0.35) * 2);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(250,204,21,.95)';
            ctx.font = '800 ' + Math.round(20 * k + 12) + 'px Fredoka, system-ui, sans-serif';
            ctx.fillText('CHAMPION', w / 2, 34 * k + 10);
            ctx.restore();
        }
    }

    function spotlightBg(ctx, w, h, cx, y, scale, t) {
        const beam = ctx.createLinearGradient(cx, 0, cx, y);
        beam.addColorStop(0, 'rgba(253,224,71,.34)');
        beam.addColorStop(1, 'rgba(253,224,71,.05)');
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(cx - 30, 0);
        ctx.lineTo(cx + 30, 0);
        ctx.lineTo(cx + 120 * scale, y + 10);
        ctx.lineTo(cx - 120 * scale, y + 10);
        ctx.closePath();
        ctx.fill();
    }

    /* ---------- effects ---------- */

    function effectConfetti(ctx, w, h, k, cx, y, scale, t, st) {
        const cannons = [cx - 120 * k, cx + 120 * k];
        if (st.parts.length < 260 && Math.random() < 0.9) {
            const side = Math.random() < 0.5 ? -1 : 1;
            for (let i = 0; i < 3; i++) {
                st.parts.push({
                    x: cx + side * 120 * k,
                    y: y - 40 * k,
                    vx: side * (60 + Math.random() * 190) * k,
                    vy: -(320 + Math.random() * 260) * k,
                    w: (5 + Math.random() * 7) * k,
                    h: (10 + Math.random() * 12) * k,
                    rot: Math.random() * 6.28,
                    vr: (Math.random() - 0.5) * 9,
                    color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
                    strip: Math.random() < 0.4
                });
            }
        }
        ctx.save();
        st.parts.forEach(p => {
            p.vy += 620 * k * 0.016;
            p.x += p.vx * 0.016;
            p.y += p.vy * 0.016;
            p.rot += p.vr * 0.016;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.strip ? p.h * 1.8 : p.h);
            ctx.restore();
        });
        ctx.restore();
    }

    function effectSpotlight(ctx, w, h, k, cx, y, scale, t, st) {
        // sweeping light cone
        const sway = Math.sin(t * 1.6) * 14;
        ctx.save();
        const g = ctx.createLinearGradient(cx + sway, 0, cx, y);
        g.addColorStop(0, 'rgba(253,224,71,.45)');
        g.addColorStop(1, 'rgba(253,224,71,.06)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx + sway - 26, 0);
        ctx.lineTo(cx + sway + 26, 0);
        ctx.lineTo(cx + 150 * scale, y + 20);
        ctx.lineTo(cx - 150 * scale, y + 20);
        ctx.closePath();
        ctx.fill();
        // dust
        for (let i = 0; i < 26; i++) {
            const a = (i * 37 + t * 40) % 360;
            const r = (i % 7) * 18 * k;
            ctx.fillStyle = 'rgba(253,230,138,' + (0.12 + 0.18 * Math.abs(Math.sin(t + i))) + ')';
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, y - 120 * k + Math.sin(a) * 70 * k, 1.6 * k, 0, 6.28);
            ctx.fill();
        }
        ctx.restore();
    }

    function effectEmojiRain(ctx, w, h, k, t, st) {
        if (st.emojis.length < 60) {
            for (let i = 0; i < 2; i++) {
                st.emojis.push({
                    x: Math.random() * w,
                    y: -30 * k,
                    vy: (90 + Math.random() * 150) * k,
                    size: (20 + Math.random() * 22) * k,
                    rot: Math.random() * 6.28,
                    vr: (Math.random() - 0.5) * 3,
                    e: EMOJIS[(Math.random() * EMOJIS.length) | 0]
                });
            }
        }
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        st.emojis.forEach(p => {
            p.y += p.vy * 0.016;
            p.rot += p.vr * 0.016;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.font = Math.round(p.size) + 'px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
            ctx.fillText(p.e, 0, 0);
            ctx.restore();
        });
        ctx.restore();
    }

    function effectMicDrop(ctx, w, h, k, cx, y, scale, t) {
        const micX = cx + 62 * scale;
        const micY = y - 96 * scale;
        const fall = Math.max(0, t - 1.15);
        if (t < 2.6) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,.95)';
            roundRect(ctx, cx + 52 * scale, y - 190 * scale, 150 * scale, 54 * scale, 12 * scale);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(cx + 66 * scale, y - 138 * scale);
            ctx.lineTo(cx + 92 * scale, y - 138 * scale);
            ctx.lineTo(cx + 70 * scale, y - 116 * scale);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#0f172a';
            ctx.font = '800 ' + Math.round(18 * k + 6) + 'px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('Peace out!', cx + 68 * scale, y - 152 * scale);
            ctx.restore();
        }
        // mic
        ctx.save();
        const micFall = Math.min(1, fall / 0.5);
        const bounce = fall > 0.5 ? Math.abs(Math.sin(fall * 6)) * 10 * k * Math.max(0, 1 - (fall - 0.5)) : 0;
        ctx.translate(micX, micY + micFall * 150 * scale - bounce);
        ctx.rotate(micFall * 1.5);
        ctx.fillStyle = '#e2e8f0';
        roundRect(ctx, -7 * k, -26 * k, 14 * k, 42 * k, 6 * k);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        roundRect(ctx, -10 * k, -34 * k, 20 * k, 18 * k, 8 * k);
        ctx.fill();
        ctx.fillStyle = '#475569';
        roundRect(ctx, -6 * k, 16 * k, 12 * k, 8 * k, 3 * k);
        ctx.fill();
        ctx.restore();
        if (fall > 0.55) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - (fall - 0.55) * 1.4);
            ctx.fillStyle = '#fbbf24';
            ctx.font = '800 ' + Math.round(26 * k + 10) + 'px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('砰!', micX, y - 10 * k);
            ctx.restore();
        }
    }

    function effectDealWithIt(ctx, w, h, k, cx, y, scale, t) {
        const eyeY = y - 112 * scale;
        const drop = Math.min(1, Math.max(0, (t - 0.35) / 1.2));
        const sy = -80 * k + drop * (eyeY + 80 * k);
        // pixel sunglasses
        const gw = 150 * scale;
        const gh = 44 * scale;
        const px = cx - gw / 2;
        ctx.save();
        ctx.fillStyle = '#0b0b0b';
        ctx.fillRect(px, sy, gw * 0.44, gh * 0.8);
        ctx.fillRect(px + gw * 0.56, sy, gw * 0.44, gh * 0.8);
        ctx.fillRect(px + gw * 0.42, sy + gh * 0.18, gw * 0.16, gh * 0.22);
        ctx.fillRect(px - gw * 0.04, sy + gh * 0.1, gw * 0.08, gh * 0.16);
        ctx.fillRect(px + gw * 0.96, sy + gh * 0.1, gw * 0.08, gh * 0.16);
        ctx.fillStyle = 'rgba(56,189,248,.5)';
        ctx.fillRect(px + gw * 0.08, sy + gh * 0.12, gw * 0.12, gh * 0.18);
        ctx.fillRect(px + gw * 0.64, sy + gh * 0.12, gw * 0.12, gh * 0.18);
        ctx.restore();
        if (drop >= 1 && t > 1.7) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, (t - 1.7) * 2);
            ctx.fillStyle = '#f8fafc';
            ctx.font = '800 ' + Math.round(20 * k + 8) + 'px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('DEAL WITH IT', cx, h * 0.16);
            ctx.restore();
        }
    }

    function drawRunnerUps(ctx, w, h, k, scale, t) {
        const baseY = h * 0.9 - 36 * k;
        const away = Math.max(0, t - 0.6);
        const fly = Math.min(1, away / 1.5);
        ctx.save();
        ctx.translate(w / 2 - 220 * k - fly * 260 * k, baseY - fly * 90 * k);
        ctx.rotate(-fly * 1.5);
        catAt(ctx, 0, 0, scale * 0.72, { cat: 'Ginger', hat: 'Party Hat', glasses: 'None', outfit: 'None' });
        ctx.restore();
        ctx.save();
        ctx.translate(w / 2 + 220 * k + fly * 260 * k, baseY - fly * 110 * k);
        ctx.rotate(fly * 1.7);
        catAt(ctx, 0, 0, scale * 0.72, { cat: 'Ragdoll', hat: 'None', glasses: 'Glasses', outfit: 'None' });
        ctx.restore();
    }

    function effectBananaSlip(ctx, w, h, k, cx, y, scale, t, st) {
        const bananaY = h * 0.9 - 8 * k;
        ctx.save();
        [-220, 220].forEach(dx => {
            ctx.save();
            ctx.translate(cx + dx * k, bananaY);
            ctx.rotate(-0.2);
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.ellipse(0, 0, 26 * k, 8 * k, 0, 0, 6.28);
            ctx.fill();
            ctx.fillStyle = '#fde68a';
            ctx.beginPath();
            ctx.ellipse(-8 * k, -3 * k, 10 * k, 4 * k, 0, 0, 6.28);
            ctx.fill();
            ctx.restore();
        });
        ctx.restore();
        if (t > 0.6) {
            ctx.save();
            ctx.fillStyle = '#fef3c7';
            ctx.font = '800 ' + Math.round(22 * k + 6) + 'px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('WIPEOUT! 💥', cx, h * 0.16);
            ctx.restore();
        }
    }

    function effectMoneyGun(ctx, w, h, k, cx, y, scale, t, st) {
        // gun in the champion's paw
        ctx.save();
        ctx.translate(cx + 66 * scale, y - 92 * scale);
        ctx.rotate(-0.35);
        ctx.fillStyle = '#334155';
        roundRect(ctx, -8 * k, -10 * k, 58 * k, 20 * k, 5 * k);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        roundRect(ctx, -8 * k, -2 * k, 22 * k, 26 * k, 5 * k);
        ctx.fill();
        ctx.restore();
        if (st.bills.length < 90) {
            for (let i = 0; i < 2; i++) {
                st.bills.push({
                    x: cx + 92 * scale,
                    y: y - 96 * scale,
                    vx: (170 + Math.random() * 260) * k,
                    vy: (-260 + Math.random() * 200) * k,
                    rot: Math.random() * 6.28,
                    vr: (Math.random() - 0.5) * 10,
                    s: (12 + Math.random() * 8) * k
                });
            }
        }
        ctx.save();
        st.bills.forEach(p => {
            p.vy += 520 * k * 0.016;
            p.x += p.vx * 0.016;
            p.y += p.vy * 0.016;
            p.rot += p.vr * 0.016;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = '#bbf7d0';
            roundRect(ctx, -p.s, -p.s * 0.55, p.s * 2, p.s * 1.1, 2 * k);
            ctx.fill();
            ctx.fillStyle = '#16a34a';
            ctx.beginPath();
            ctx.arc(-p.s * 0.35, 0, p.s * 0.16, 0, 6.28);
            ctx.arc(p.s * 0.05, -p.s * 0.12, p.s * 0.11, 0, 6.28);
            ctx.arc(p.s * 0.34, p.s * 0.1, p.s * 0.1, 0, 6.28);
            ctx.fill();
            ctx.restore();
        });
        ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /* ---------- class-battle winner hook ---------- */

    /* Resolve which effect (if any) the winner has: equipped, owned, or a
       1-battle trial. Returns '' when there is none. */
    VICTORY.winnerEffect = async function () {
        let id = '';
        try {
            if (typeof STORE_EQUIPPED !== 'undefined' && STORE_EQUIPPED && STORE_EQUIPPED.victory) {
                id = STORE_EQUIPPED.victory;
            }
        } catch (e) {}
        try {
            if (typeof loadStoreState === 'function' && typeof storeAvailable === 'function' && storeAvailable()) {
                await loadStoreState(true);
            }
        } catch (e) {}
        try {
            if (typeof STORE_EQUIPPED !== 'undefined' && STORE_EQUIPPED && STORE_EQUIPPED.victory) {
                id = STORE_EQUIPPED.victory;
            }
            if (!id && typeof STORE_OWNED !== 'undefined' && STORE_OWNED) {
                const owned = Object.keys(STORE_OWNED).filter(function (k) { return /^victory_/.test(k) && STORE_OWNED[k]; });
                if (owned.length === 1) id = owned[0];
            }
        } catch (e) {}
        if (!id) {
            try {
                const res = await sb.rpc('my_victory_rental');
                if (!res.error && res.data) id = String(res.data);
            } catch (e) {}
        }
        return (id && EFFECTS[id]) ? id : '';
    };

    VICTORY.claimForWin = async function (roomId, opts) {
        const key = String(roomId || 'once');
        if (claimed[key]) return '';
        let id = '';
        try {
            if (typeof STORE_EQUIPPED !== 'undefined' && STORE_EQUIPPED && STORE_EQUIPPED.victory) {
                id = STORE_EQUIPPED.victory;
            }
        } catch (e) {}
        // The equipped effect may not be in memory yet (the student may not
        // have opened the Store this session), so pull the Store state first.
        try {
            if (typeof loadStoreState === 'function' && typeof storeAvailable === 'function' && storeAvailable()) {
                await loadStoreState(true);
            }
        } catch (e) {}
        try {
            if (typeof STORE_EQUIPPED !== 'undefined' && STORE_EQUIPPED && STORE_EQUIPPED.victory) {
                id = STORE_EQUIPPED.victory;
            }
        } catch (e) {}
        let trial = false;
        if (!id) {
            try {
                const res = await sb.rpc('my_victory_rental');
                if (!res.error && res.data) { id = res.data; trial = true; }
            } catch (e) {}
        }
        // No effect (and no trial pass): keep the 3-cat podium and allow a
        // later retry once the Store state is known.
        if (!id || !EFFECTS[id]) return '';
        claimed[key] = true;
        try { sb.rpc('log_victory_use', { p_item: id, p_room: key }); } catch (e) {}
        if (trial) { try { sb.rpc('consume_victory_rental'); } catch (e) {} }
        // Let the class trophy ceremony finish first: the victory effect is
        // the encore, not a replacement.
        const started = Date.now();
        const waitForTrophy = function () {
            const trophy = document.getElementById('battle-trophy-overlay') ||
                document.getElementById('dg-trophy-overlay');
            if (!trophy) {
                VICTORY.play(id, Object.assign({}, opts || {}, { trial: trial }));
                return;
            }
            const champ = trophy.querySelector('.battle-trophy-place.champion') ||
                trophy.querySelector('[data-trophy-place="0"]');
            const shown = (champ && champ.classList.contains('show')) ||
                (!!document.getElementById('victory-podium') && Date.now() - startedAt > 5200);
            if ((shown && Date.now() - started > 900) || Date.now() - started > 9000) {
                setTimeout(function () {
                    VICTORY.play(id, Object.assign({}, opts || {}, { trial: trial }));
                }, 1200);
                return;
            }
            setTimeout(waitForTrophy, 250);
        };
        setTimeout(waitForTrophy, 400);
        return id;
    };

    /* ---------- ceremony extras: class photo + cheers ---------- */

    const CHEERS = {
        clap: { emoji: '👏', label: 'Clap' },
        heart: { emoji: '❤️', label: 'Hearts' },
        ribbon: { emoji: '🎀', label: 'Ribbon' },
        lek: { emoji: '💪', label: '叻!' }
    };

    VICTORY.ceremonyExtras = function (overlay, opts) {
        if (!overlay || !opts || !opts.roomId) return;
        const card = overlay.querySelector('.battle-trophy-card');
        if (!card || card.querySelector('.victory-extras')) return;
        const players = (opts.players || []).filter(Boolean).slice(0, 12);
        const nameOf = function (p) {
            const n = (opts.nameOf ? opts.nameOf(p) : '') || p.nickname || p.name || p.email || '';
            return String(n).split('@')[0];
        };
        const strip = players.map(function (p, i) {
            return '<div class="victory-photo' + (p.user_id === opts.championId ? ' champ' : '') + '">' +
                '<canvas data-photo="' + i + '" width="96" height="96"></canvas>' +
                '<span>' + escapeHtml(nameOf(p)) + '</span></div>';
        }).join('');
        const btns = Object.keys(CHEERS).map(function (kind) {
            return '<button type="button" class="victory-cheer-btn" data-cheer="' + kind + '">' +
                CHEERS[kind].emoji + ' ' + CHEERS[kind].label +
                (kind === 'lek' ? '' : ' <b>0</b>') + '</button>';
        }).join('');
        const wrap = document.createElement('div');
        wrap.className = 'victory-extras';
        wrap.innerHTML =
            '<p class="victory-photo-title">📸 Class photo · everyone who played</p>' +
            '<div class="victory-photo-strip">' + strip + '</div>' +
            '<p class="victory-cheer-title">Cheer for the champion — spam these!</p>' +
            '<div class="victory-cheers">' + btns + '</div>' +
            '<div class="victory-float" aria-hidden="true"></div>';
        card.appendChild(wrap);

        // draw each student's cat once
        wrap.querySelectorAll('canvas[data-photo]').forEach(function (cv, i) {
            const p = players[i];
            const d = window.DG;
            if (!p || !d || !d.drawCatAvatar) return;
            const ctx = cv.getContext('2d');
            const look = d.normalizeLook ? d.normalizeLook({ cat: p.cat, glasses: p.glasses, hat: p.hat, outfit: p.outfit, ears: p.ears, cheeks: p.cheeks, neck: p.neck }) : { cat: 'Ginger' };
            d.drawCatAvatar(ctx, 48, 88, 0.34, look);
        });

        const totals = { clap: 0, heart: 0, ribbon: 0, lek: 0 };
        const pending = { clap: 0, heart: 0, ribbon: 0, lek: 0 };
        let flushTimer = 0;
        let pollTimer = 0;
        let alive = true;

        function paint() {
            Object.keys(CHEERS).forEach(function (kind) {
                const b = wrap.querySelector('[data-cheer="' + kind + '"] b');
                if (b) b.textContent = String(totals[kind] || 0);
            });
        }

        function floatEmoji(btn, kind) {
            const layer = wrap.querySelector('.victory-float');
            if (!layer || !btn) return;
            const r = btn.getBoundingClientRect();
            const host = wrap.getBoundingClientRect();
            const el = document.createElement('span');
            el.textContent = CHEERS[kind].emoji;
            el.className = 'victory-float-item';
            el.style.left = (r.left - host.left + r.width / 2 + (Math.random() * 40 - 20)) + 'px';
            el.style.top = (r.top - host.top) + 'px';
            layer.appendChild(el);
            setTimeout(function () { el.remove(); }, 1400);
        }

        function flush() {
            flushTimer = 0;
            const batch = Object.keys(pending).filter(function (k) { return pending[k] > 0; });
            if (!batch.length) return;
            batch.forEach(function (kind) {
                const n = pending[kind];
                pending[kind] = 0;
                try {
                    sb.rpc('cheer_class_battle', { p_room: String(opts.roomId), p_kind: kind, p_count: n })
                        .then(function (res) {
                            if (res && !res.error && Array.isArray(res.data)) {
                                res.data.forEach(function (row) {
                                    if (row && row.kind) totals[row.kind] = Number(row.taps) || totals[row.kind] || 0;
                                });
                                paint();
                            }
                        }, function () {});
                } catch (e) {}
            });
        }

        wrap.querySelectorAll('[data-cheer]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const kind = btn.getAttribute('data-cheer');
                totals[kind] = (totals[kind] || 0) + 1;
                pending[kind] += 1;
                paint();
                floatEmoji(btn, kind);
                if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
                if (!flushTimer) flushTimer = setTimeout(flush, 450);
            });
        });

        pollTimer = setInterval(function () {
            if (!alive || !document.body.contains(wrap)) { clearInterval(pollTimer); alive = false; return; }
            try {
                sb.rpc('class_battle_cheers', { p_room: String(opts.roomId) }).then(function (res) {
                    if (res && !res.error && Array.isArray(res.data)) {
                        res.data.forEach(function (row) {
                            if (row && row.kind) totals[row.kind] = Number(row.taps) || 0;
                        });
                        paint();
                    }
                }, function () {});
            } catch (e) {}
        }, 1500);

        paint();

        // Auto-scroll to the photo + cheers once the champion has been
        // revealed and the victory effect (if any) is closed.
        let scrolled = false;
        const startedAt = Date.now();
        const autoScroll = function () {
            if (scrolled || !document.body.contains(wrap)) return;
            const champ = overlay.querySelector('.battle-trophy-place.champion') ||
                overlay.querySelector('[data-trophy-place="0"]');
            const shown = (champ && champ.classList.contains('show')) ||
                (!!document.getElementById('victory-podium') && Date.now() - started > 3200);
            const effectOpen = !!document.getElementById('victory-stage');
            if (shown && !effectOpen) {
                scrolled = true;
                try { wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
                return;
            }
            if (Date.now() - startedAt > 25000) return;
            setTimeout(autoScroll, 500);
        };
        setTimeout(autoScroll, 900);
    };

    /* ---------- prize stand (podium) ceremony ---------- */

    VICTORY.showPodium = function (opts) {
        const o = opts || {};
        const top = (o.top || []).slice(0, 3);
        const rest = (o.rest || []).filter(Boolean).slice(0, 40);
        const nameOf = o.nameOf || function (p) { return (p && (p.nickname || p.name || p.email)) || ''; };
        const ptsOf = o.ptsOf || function (p) { return Number(p && (p.composite_score != null ? p.composite_score : p.score)) || 0; };
        const prev = document.getElementById('victory-podium');
        if (prev) prev.remove();
        const box = document.createElement('div');
        box.id = 'victory-podium';
        box.className = 'victory-podium-overlay';
        box.innerHTML =
            '<div class="vp-head"><div><p class="vp-kicker">' + escapeHtml(o.kicker || 'Class battle') + '</p>' +
            '<h2 class="vp-title">' + escapeHtml(o.title || '🏆 Prize stand') + '</h2></div>' +
            '<button type="button" class="vp-close" aria-label="Close">✕</button></div>' +
            '<canvas id="vp-canvas"></canvas>' +
            '<div class="vp-extras"></div>';
        document.body.appendChild(box);
        document.body.classList.add('ceremony-on');
        const canvas = box.querySelector('#vp-canvas');
        const extras = box.querySelector('.vp-extras');

        let audio = null;
        try { audio = new Audio('/music/trophyMusic.mp3'); audio.volume = 0.42; audio.play().catch(function () {}); } catch (e) {}

        function close() {
            if (audio) { try { audio.pause(); } catch (e) {} }
            if (box.parentNode) box.remove();
            document.body.classList.remove('ceremony-on');
            if (typeof o.onClose === 'function') o.onClose();
        }
        box.querySelector('.vp-close').addEventListener('click', close);

        const t0 = performance.now();
        const ORDER = [2, 1, 0];           // reveal 3rd -> 2nd -> 1st
        const AT = { 2: 0.4, 1: 1.5, 0: 2.6, rest: 4.0 };
        let raf = 0;
        let extrasShown = false;

        function draw() {
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const w = canvas.clientWidth || 640, h = canvas.clientHeight || 400;
            canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const t = (performance.now() - t0) / 1000;
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, '#13203a'); g.addColorStop(1, '#050a14');
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

            const k = Math.min(w / 720, h / 420);
            const baseY = h * 0.86;
            // decorations: bunting + warm glow + sparkles
            const colours = ['#f87171', '#fbbf24', '#34d399', '#38bdf8', '#a78bfa'];
            ctx.save();
            ctx.strokeStyle = 'rgba(226,232,240,.35)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 26 * k);
            ctx.quadraticCurveTo(w / 2, 54 * k, w, 26 * k);
            ctx.stroke();
            for (let i = 0; i < 14; i++) {
                const bx = (w / 14) * i + w / 28;
                const by = 26 * k + Math.sin((i / 13) * Math.PI) * 26 * k;
                ctx.fillStyle = colours[i % colours.length];
                ctx.beginPath();
                ctx.moveTo(bx - 9 * k, by);
                ctx.lineTo(bx + 9 * k, by);
                ctx.lineTo(bx, by + 18 * k);
                ctx.closePath();
                ctx.fill();
            }
            const halo = ctx.createRadialGradient(w / 2, baseY - 90 * k, 10 * k, w / 2, baseY - 90 * k, 260 * k);
            halo.addColorStop(0, 'rgba(251,191,36,.22)');
            halo.addColorStop(1, 'rgba(251,191,36,0)');
            ctx.fillStyle = halo;
            ctx.fillRect(0, 0, w, h);
            for (let i = 0; i < 22; i++) {
                const sx = ((i * 97) % w), sy = ((i * 53) % (h * 0.7)) + 30;
                ctx.globalAlpha = 0.25 + 0.45 * Math.abs(Math.sin(t * 1.4 + i));
                ctx.fillStyle = '#fde68a';
                ctx.beginPath(); ctx.arc(sx, sy, 1.6 * k, 0, 6.28); ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.restore();
            const cx = w / 2;
            const stepW = 150 * k, sideW = 120 * k;
            const heights = [64 * k, 46 * k, 34 * k];    // 1st, 2nd, 3rd
            const xFor = [-1, 1, 2].map((v, i) => cx + (i === 0 ? 0 : (i === 1 ? -(sideW + stepW / 2 + 6 * k) : (sideW + stepW / 2 + 6 * k))));

            // steps + cats, revealed in order
            ORDER.forEach(function (idx, n) {
                const start = AT[idx];
                if (t < start) return;
                const pop = Math.min(1, (t - start) / 0.4);
                const x = xFor[idx];
                const hh = heights[idx];
                ctx.fillStyle = idx === 0 ? '#f59e0b' : '#334155';
                const bw = idx === 0 ? stepW : sideW;
                ctx.fillRect(x - bw / 2, baseY - hh, bw, hh);
                ctx.fillStyle = 'rgba(255,255,255,.16)';
                ctx.fillRect(x - bw / 2, baseY - hh, bw, 5 * k);
                // big placing number on the step
                ctx.fillStyle = idx === 0 ? '#7c2d12' : '#cbd5f5';
                ctx.font = '900 ' + Math.round((idx === 0 ? 32 : 24) * k) + 'px Fredoka, system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(String(idx + 1), x, baseY - hh / 2 + 10 * k);
                const p = top[idx];
                if (!p) return;
                const look = window.DG && window.DG.normalizeLook
                    ? window.DG.normalizeLook({ cat: p.cat, glasses: p.glasses, hat: p.hat, outfit: p.outfit, ears: p.ears, cheeks: p.cheeks, neck: p.neck })
                    : { cat: 'Ginger' };
                const catScale = 1.15 * k * (0.6 + 0.4 * pop);
                if (window.DG && window.DG.drawCatAvatar) {
                    window.DG.drawCatAvatar(ctx, x, baseY - hh, catScale, look);
                }
                ctx.textAlign = 'center';
                ctx.fillStyle = '#f8fafc';
                ctx.font = '800 ' + Math.round(17 * k) + 'px Fredoka, system-ui, sans-serif';
                ctx.fillText(String(nameOf(p)).slice(0, 18), x, baseY - hh - 150 * k * (0.6 + 0.4 * pop));
                ctx.fillStyle = '#fbbf24';
                ctx.font = '800 ' + Math.round(14 * k) + 'px Fredoka, system-ui, sans-serif';
                ctx.fillText(['🥇', '🥈', '🥉'][idx] + ' ' + ptsOf(p) + ' pts', x, baseY - hh - 132 * k * (0.6 + 0.4 * pop));
            });

            // everyone else gathers around the stand
            const restCap = rest.slice(0, 24);
            if (t >= AT.rest && restCap.length) {
                const done = Math.min(1, (t - AT.rest) / 1.2);
                ctx.textAlign = 'center';
                const perRow = Math.min(12, Math.ceil(restCap.length / 2));
                restCap.forEach(function (p, i) {
                    const row = Math.floor(i / perRow);
                    const inRow = i % perRow;
                    const rowCount = Math.min(perRow, restCap.length - row * perRow);
                    const span = Math.min(w * 0.96, 54 * k * rowCount);
                    const x = cx - span / 2 + (rowCount === 1 ? span / 2 : (span * inRow) / (rowCount - 1));
                    const y = baseY + 4 * k - row * 34 * k - (inRow % 2) * 6 * k * done;
                    const look = window.DG && window.DG.normalizeLook
                        ? window.DG.normalizeLook({ cat: p.cat, glasses: p.glasses, hat: p.hat, outfit: p.outfit })
                        : { cat: 'Ginger' };
                    if (window.DG && window.DG.drawCatAvatar) {
                        window.DG.drawCatAvatar(ctx, x, y, 0.3 * k * done, look);
                    }
                    ctx.fillStyle = 'rgba(226,232,240,.9)';
                    ctx.font = '700 ' + Math.round(10 * k) + 'px system-ui, sans-serif';
                    ctx.fillText(String(nameOf(p)).split('@')[0].slice(0, 10), x, y + 12 * k);
                });
            }

            if (!o._effectDone && o.effectId && t >= AT[0] + 0.45) {
                o._effectDone = true;
                try { sb.rpc('log_victory_use', { p_item: o.effectId, p_room: String(o.roomId || '') }); } catch (e) {}
                if (o.trial) { try { sb.rpc('consume_victory_rental'); } catch (e) {} }
                VICTORY.play(o.effectId, { look: o.effectLook, title: '🏆 Class champion', trial: o.trial });
            }
            if (!extrasShown && t >= AT.rest + 0.6) {
                extrasShown = true;
                VICTORY.ceremonyExtras(box, {
                    roomId: o.roomId,
                    players: (o.top || []).concat(o.rest || []),
                    championId: top[0] && top[0].user_id,
                    nameOf: nameOf
                });
            }
            if (t < 30) raf = requestAnimationFrame(draw);
        }
        raf = requestAnimationFrame(draw);
        return { close: close };
    };

    VICTORY.quickBuy = function (o) {
        const old = document.getElementById('vp-quick'); if (old) old.remove();
        const box = document.createElement('div'); box.id='vp-quick'; box.className='vp-quick';
        box.innerHTML='<div class="vp-quick-card"><button type="button" class="vp-close" aria-label="Close">✕</button>'+
          '<h3>'+escapeHtml(o.title||'Victory effects')+'</h3><p>'+escapeHtml(o.message||'')+'</p>'+
          '<div class="vp-quick-list">'+Object.keys(EFFECTS).map(function(id){
             return '<div class="vp-quick-row"><b>'+escapeHtml(EFFECTS[id].name)+'</b>'+
               '<button data-rent="'+id+'">🎟 Rent 20%</button>'+
               '<button data-buy="'+id+'">Buy</button></div>';
          }).join('')+'</div>'+
          '<button type="button" class="vp-quick-notify">📣 Notify the class</button></div>';
        document.body.appendChild(box);
        const done=()=>box.remove();
        box.querySelector('.vp-close').onclick=done;
        box.onclick=e=>{if(e.target===box)done();};
        box.querySelectorAll('[data-rent]').forEach(b=>b.onclick=()=>{sb.rpc('rent_victory_effect',{p_item:b.getAttribute('data-rent')}).then(()=>updateMascot('Trial pass bought for the next class battle! 🎟'),()=>{});});
        box.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{sb.rpc('buy_store_item',{p_item:b.getAttribute('data-buy')}).then(()=>updateMascot('Effect bought! Equip it in Store → 🏆 Victory.'),()=>{});});
        box.querySelector('.vp-quick-notify').onclick=()=>{try{sb.rpc('announce_store_sale',{p_key:o.roomKey,p_message:o.message}).then(()=>updateMascot('Class notified 🔔'),()=>{});}catch(e){}};
    };

    window.victoryPreview = function (id) { VICTORY.play(id, { preview: true, title: '✨ Preview' }); };
})();

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

    function championLook() {
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

        const look = championLook();
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

    VICTORY.claimForWin = async function (roomId, opts) {
        const key = String(roomId || 'once');
        if (claimed[key]) return '';
        claimed[key] = true;
        let id = '';
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
        if (!id || !EFFECTS[id]) return '';
        try { sb.rpc('log_victory_use', { p_item: id, p_room: key }); } catch (e) {}
        if (trial) { try { sb.rpc('consume_victory_rental'); } catch (e) {} }
        setTimeout(function () { VICTORY.play(id, Object.assign({}, opts || {}, { trial: trial })); }, 350);
        return id;
    };

    window.victoryPreview = function (id) { VICTORY.play(id, { preview: true, title: '✨ Preview' }); };
})();

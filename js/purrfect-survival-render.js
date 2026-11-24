/* LearniTY — Purr-fect Survival canvas renderer.
 *
 * Pure drawing code: no network, no Supabase, no timers. The main game
 * module passes a state snapshot each animation frame. Player cats reuse
 * DG.drawCatAvatar when it is available, so store hats / glasses / outfits
 * appear on the track and on the glass bridge.
 */
(function (root) {
    'use strict';

    const R = {};

    R.VERSION = '1.0.0';

    /* ------------------------------------------------------------------ */
    /* Helpers                                                            */
    /* ------------------------------------------------------------------ */

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function easeOut(t) {
        return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
    }

    function hash01(text) {
        let h = 2166136261;
        const s = String(text || '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0) / 4294967296;
    }

    function ell(ctx, x, y, rx, ry) {
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
        ctx.fill();
    }

    function roundRect(ctx, x, y, w, h, r) {
        const radius = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    function drawCat(ctx, x, y, scale, look, opts) {
        const o = opts || {};
        ctx.save();
        if (o.alpha != null) ctx.globalAlpha = o.alpha;
        if (o.ghost) {
            ctx.globalAlpha = (o.alpha == null ? 0.4 : o.alpha) * 0.85;
        }
        if (typeof root.DG !== 'undefined' && root.DG && typeof root.DG.drawCatAvatar === 'function') {
            root.DG.drawCatAvatar(ctx, x, y, scale, look || {}, { preview: true });
        } else {
            // Tiny fallback so the renderer never crashes if Drive & Go!
            // failed to load. The real game always has DG.
            ctx.fillStyle = '#f59e0b';
            ell(ctx, x, y - 26 * scale, 26 * scale, 32 * scale);
            ctx.beginPath();
            ctx.arc(x, y - 66 * scale, 22 * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff8ee';
            ell(ctx, x, y - 22 * scale, 13 * scale, 18 * scale);
            ctx.fillStyle = '#1f2937';
            [[-7, -70], [7, -70]].forEach(pair => {
                ctx.beginPath();
                ctx.arc(x + pair[0] * scale, y + pair[1] * scale, 2.4 * scale, 0, Math.PI * 2);
                ctx.fill();
            });
        }
        if (o.halo) {
            ctx.globalAlpha = o.alpha == null ? 0.55 : o.alpha;
            ctx.strokeStyle = o.haloColor || '#38bdf8';
            ctx.lineWidth = Math.max(1.5, 3 * scale);
            ctx.beginPath();
            ctx.ellipse(x, y - 4 * scale, 34 * scale, 10 * scale, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (o.ring) {
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = o.ringColor || '#fde047';
            ctx.lineWidth = Math.max(2, 4 * scale);
            ctx.beginPath();
            ctx.ellipse(x, y - 2 * scale, 40 * scale, 13 * scale, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    R.drawCat = drawCat;

    /* ------------------------------------------------------------------ */
    /* Layout                                                             */
    /* ------------------------------------------------------------------ */

    R.layout = function (w, h, role) {
        const width = Math.max(1, Number(w) || 1);
        const height = Math.max(1, Number(h) || 1);
        const landscape = width > height;
        const host = role === 'host';
        const hud = landscape ? Math.min(96, height * 0.18) : Math.min(130, height * 0.17);
        return {
            w: width,
            h: height,
            landscape: landscape,
            portrait: !landscape,
            host: host,
            hud: hud,
            startY: height * (landscape ? 0.80 : 0.72),
            finishY: height * (landscape ? 0.29 : 0.31),
            bridgeFarY: height * (landscape ? 0.24 : 0.28),
            bridgeNearY: height * (landscape ? 0.80 : 0.72),
            centerX: width * 0.5
        };
    };

    /* ------------------------------------------------------------------ */
    /* Round 1 backdrop                                                   */
    /* ------------------------------------------------------------------ */

    function drawRound1Sky(ctx, L, t) {
        const sky = ctx.createLinearGradient(0, 0, 0, L.h);
        sky.addColorStop(0, '#2b1a52');
        sky.addColorStop(0.32, '#7c3d78');
        sky.addColorStop(0.58, '#e27a6f');
        sky.addColorStop(0.74, '#f7b267');
        sky.addColorStop(1, '#e8b46b');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, L.w, L.h);

        // Low sun and haze.
        const sunY = L.h * 0.5;
        const glow = ctx.createRadialGradient(L.w * 0.5, sunY, 10, L.w * 0.5, sunY, L.w * 0.55);
        glow.addColorStop(0, 'rgba(255,240,180,.55)');
        glow.addColorStop(0.4, 'rgba(255,190,120,.18)');
        glow.addColorStop(1, 'rgba(255,160,100,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, L.w, L.h);

        // Distant hills / trees.
        ctx.fillStyle = 'rgba(74,47,84,.55)';
        ctx.beginPath();
        ctx.moveTo(0, L.h * 0.55);
        for (let i = 0; i <= 12; i++) {
            const x = (L.w / 12) * i;
            const y = L.h * 0.52 - Math.sin(i * 1.7 + 0.8) * L.h * 0.035;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(L.w, L.h * 0.62);
        ctx.lineTo(0, L.h * 0.62);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(43,24,52,.55)';
        for (let i = 0; i < 18; i++) {
            const x = (L.w / 17) * i + hash01('tree' + i) * 18;
            const size = L.h * (0.03 + hash01('treeSize' + i) * 0.025);
            ctx.beginPath();
            ctx.moveTo(x, L.h * 0.58);
            ctx.lineTo(x - size * 0.55, L.h * 0.58);
            ctx.lineTo(x, L.h * 0.58 - size);
            ctx.lineTo(x + size * 0.55, L.h * 0.58);
            ctx.closePath();
            ctx.fill();
        }

        // Sand field with perspective seams.
        const sand = ctx.createLinearGradient(0, L.h * 0.58, 0, L.h);
        sand.addColorStop(0, '#d9a45f');
        sand.addColorStop(0.4, '#e7b977');
        sand.addColorStop(1, '#cf9455');
        ctx.fillStyle = sand;
        ctx.beginPath();
        ctx.moveTo(-L.w * 0.1, L.h * 0.60);
        ctx.lineTo(L.w * 1.1, L.h * 0.60);
        ctx.lineTo(L.w * 1.05, L.h);
        ctx.lineTo(-L.w * 0.05, L.h);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(120,75,35,.16)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 14; i++) {
            const p = i / 14;
            const x0 = lerp(-L.w * 0.1, L.w * 1.1, p);
            const x1 = lerp(-L.w * 0.05, L.w * 1.05, p);
            ctx.beginPath();
            ctx.moveTo(x0, L.h * 0.60);
            ctx.lineTo(x1, L.h);
            ctx.stroke();
        }

        // Subtle moving dust.
        ctx.fillStyle = 'rgba(255,235,190,.22)';
        for (let i = 0; i < 24; i++) {
            const sx = (hash01('dust' + i) * L.w + t * (6 + hash01('dustV' + i) * 12)) % L.w;
            const sy = L.h * 0.62 + hash01('dustY' + i) * L.h * 0.34;
            ctx.fillRect(sx, sy, 1.6, 1.6);
        }
    }

    /* Distance markers and finish line. */
    function drawRound1Track(ctx, L, state) {
        const finish = Math.max(1, Number(state.finishDistance) || 100);
        for (let m = 0; m <= finish; m += 20) {
            const p = m / finish;
            const y = lerp(L.startY, L.finishY, p);
            const width = lerp(L.w * 0.94, L.w * 0.42, p);
            ctx.save();
            ctx.strokeStyle = m === 0 ? 'rgba(255,255,255,.9)' : 'rgba(90,55,25,.30)';
            ctx.lineWidth = m === 0 ? 4 : 2;
            ctx.setLineDash(m === 0 ? [] : [8, 8]);
            ctx.beginPath();
            ctx.moveTo(L.centerX - width / 2, y);
            ctx.lineTo(L.centerX + width / 2, y);
            ctx.stroke();
            ctx.restore();

            if (m % 20 === 0 && m <= finish) {
                ctx.save();
                ctx.fillStyle = 'rgba(74,45,20,.72)';
                ctx.font = '700 ' + Math.max(9, Math.round(L.w * (L.landscape ? 0.012 : 0.027))) + 'px Fredoka, system-ui, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(m + ' m', L.centerX - width / 2 + 6, y - 8);
                ctx.restore();
            }
        }

        // Checkered finish band.
        const fy = L.finishY;
        const half = L.w * 0.23;
        const rows = 2;
        const cols = 16;
        const cellW = (half * 2) / cols;
        const cellH = Math.max(4, L.h * 0.012);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                ctx.fillStyle = (r + c) % 2 ? '#f8fafc' : '#111827';
                ctx.fillRect(L.centerX - half + c * cellW, fy - rows * cellH + r * cellH, cellW, cellH);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Young-hee-style cat doll                                          */
    /* ------------------------------------------------------------------ */

    /**
     * state: {
     *   turn: 0 = back view, 1 = facing the field,
     *   red: boolean (laser eyes),
     *   warning: boolean
     * }
     */
    R.drawDoll = function (ctx, x, y, scale, state) {
        const s = Math.max(0.1, Number(scale) || 1);
        const o = state || {};
        const turn = clamp(Number(o.turn) || 0, 0, 1);
        ctx.save();
        ctx.translate(x, y);

        // Shadow.
        ctx.fillStyle = 'rgba(40,20,30,.25)';
        ell(ctx, 0, 6 * s, 46 * s, 9 * s);

        // Legs.
        ctx.fillStyle = '#f6d7c8';
        [ -16, 16 ].forEach(dx => {
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(dx * s - 6 * s, -40 * s, 12 * s, 44 * s, 5 * s)
                : ctx.rect(dx * s - 6 * s, -40 * s, 12 * s, 44 * s);
            ctx.fill();
            ctx.fillStyle = '#2b1a52';
            ctx.beginPath();
            ctx.ellipse(dx * s, 4 * s, 12 * s, 6 * s, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#f6d7c8';
        });

        // Pink dress: a giant triangular shape.
        const dress = ctx.createLinearGradient(0, -120 * s, 0, -35 * s);
        dress.addColorStop(0, '#f9a8d4');
        dress.addColorStop(0.5, '#f472b6');
        dress.addColorStop(1, '#db2777');
        ctx.fillStyle = dress;
        ctx.beginPath();
        ctx.moveTo(0, -132 * s);
        ctx.lineTo(44 * s, -38 * s);
        ctx.quadraticCurveTo(0, -26 * s, -44 * s, -38 * s);
        ctx.closePath();
        ctx.fill();

        // Apron / dress highlight.
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.beginPath();
        ctx.moveTo(0, -118 * s);
        ctx.lineTo(18 * s, -46 * s);
        ctx.lineTo(-18 * s, -46 * s);
        ctx.closePath();
        ctx.fill();

        // Arms.
        ctx.strokeStyle = '#f6d7c8';
        ctx.lineWidth = 9 * s;
        ctx.lineCap = 'round';
        [-1, 1].forEach(side => {
            ctx.beginPath();
            ctx.moveTo(side * 20 * s, -108 * s);
            ctx.quadraticCurveTo(side * 42 * s, -80 * s, side * 36 * s, -54 * s);
            ctx.stroke();
        });

        // Neck.
        ctx.fillStyle = '#f6d7c8';
        ctx.fillRect(-6 * s, -144 * s, 12 * s, 16 * s);

        // Head with a bob haircut. When turn is 0 we see the back of the
        // head (no face). Turning cross-fades to the front face.
        ctx.save();
        ctx.translate(0, -168 * s);
        // Head
        ctx.fillStyle = '#f8ddcf';
        ell(ctx, 0, 0, 26 * s, 28 * s);
        // Bob hair: dark mass with a blunt fringe.
        ctx.fillStyle = '#17121f';
        ctx.beginPath();
        ctx.arc(0, -3 * s, 29 * s, Math.PI * 0.02, Math.PI * 0.98, true);
        ctx.lineTo(24 * s, 22 * s);
        ctx.quadraticCurveTo(0, 30 * s, -24 * s, 22 * s);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#17121f';
        ctx.beginPath();
        ctx.ellipse(0, -24 * s, 30 * s, 9 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        // Back view: a small ribbon / seam.
        if (turn < 0.55) {
            ctx.globalAlpha = 1 - turn / 0.55;
            ctx.fillStyle = 'rgba(255,255,255,.16)';
            ctx.beginPath();
            ctx.arc(0, 2 * s, 12 * s, 0.2, Math.PI - 0.2);
            ctx.strokeStyle = 'rgba(255,255,255,.22)';
            ctx.lineWidth = 2 * s;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Front view: eyes / mouth fade in.
        if (turn > 0.45) {
            ctx.globalAlpha = (turn - 0.45) / 0.55;
            const eyeGlow = o.red ? 1 : 0;
            if (eyeGlow) {
                ctx.shadowColor = '#ff2d2d';
                ctx.shadowBlur = 18 * s;
                ctx.fillStyle = '#ff3b3b';
            } else {
                ctx.fillStyle = '#2a2030';
            }
            [ -9, 9 ].forEach(dx => {
                ctx.beginPath();
                ctx.ellipse(dx * s, 0, 3.2 * s, eyeGlow ? 5.2 * s : 3.6 * s, 0, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.shadowBlur = 0;

            // Tiny nose / mouth line.
            ctx.strokeStyle = 'rgba(80,40,50,.5)';
            ctx.lineWidth = 1.2 * s;
            ctx.beginPath();
            ctx.moveTo(-4 * s, 11 * s);
            ctx.quadraticCurveTo(0, 13 * s, 4 * s, 11 * s);
            ctx.stroke();

            if (o.red) {
                // Laser beams sweeping across the field.
                ctx.save();
                ctx.globalAlpha = 0.55;
                ctx.strokeStyle = '#ff2d2d';
                ctx.shadowColor = '#ff2d2d';
                ctx.shadowBlur = 14 * s;
                ctx.lineWidth = 2 * s;
                for (let i = -1; i <= 1; i++) {
                    ctx.beginPath();
                    ctx.moveTo(i * 9 * s, 0);
                    ctx.lineTo(i * 80 * s, 120 * s);
                    ctx.stroke();
                }
                ctx.restore();
            }
            ctx.globalAlpha = 1;
        }
        ctx.restore();

        // Warning glow ring while the head turns.
        if (o.warning) {
            ctx.save();
            ctx.strokeStyle = 'rgba(250,204,21,.65)';
            ctx.lineWidth = 3 * s;
            ctx.beginPath();
            ctx.arc(0, -168 * s, 34 * s, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.restore();
    };

    function drawLight(ctx, L, state) {
        const phase = state.phase || 'green';
        const colors = {
            green: ['#22c55e', 'rgba(34,197,94,.25)'],
            yellow: ['#facc15', 'rgba(250,204,21,.25)'],
            red: ['#ef4444', 'rgba(239,68,68,.28)']
        };
        const active = colors[phase] || colors.green;
        const bulb = Math.max(6, Math.min(L.w, L.h) * 0.022);
        const x = L.w - bulb * 2.4;
        const y = L.hud + bulb * 1.5;
        ctx.save();
        ctx.fillStyle = 'rgba(15,23,42,.68)';
        roundRect(ctx, x - bulb * 1.25, y - bulb * 1.25, bulb * 2.5, bulb * 5.6, bulb);
        ctx.fill();

        ['red', 'yellow', 'green'].forEach((name, i) => {
            const cy = y + i * bulb * 1.75;
            const isOn = name === phase || (phase === 'done' && name === 'red');
            ctx.fillStyle = isOn ? colors[name][0] : 'rgba(255,255,255,.14)';
            if (isOn) {
                ctx.shadowColor = colors[name][0];
                ctx.shadowBlur = bulb * 1.4;
            } else {
                ctx.shadowBlur = 0;
            }
            ctx.beginPath();
            ctx.arc(x, cy, bulb * 0.62, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    function drawPhaseFlash(ctx, L, state) {
        const phase = state.phase;
        if (phase === 'yellow') {
            const pulse = 0.10 + 0.10 * Math.abs(Math.sin((Number(state.phaseElapsed) || 0) / 140));
            ctx.fillStyle = 'rgba(250,204,21,' + pulse.toFixed(3) + ')';
            ctx.fillRect(0, 0, L.w, L.h);
        } else if (phase === 'red') {
            const grad = ctx.createRadialGradient(L.w / 2, L.h / 2, L.w * 0.12, L.w / 2, L.h / 2, L.w * 0.75);
            grad.addColorStop(0, 'rgba(220,38,38,0)');
            grad.addColorStop(0.72, 'rgba(220,38,38,.16)');
            grad.addColorStop(1, 'rgba(150,20,20,.42)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, L.w, L.h);

            // Scanlines for the "do not move" warning.
            ctx.save();
            ctx.globalAlpha = 0.10;
            ctx.strokeStyle = '#fecaca';
            ctx.lineWidth = 1;
            for (let y = 0; y < L.h; y += 7) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(L.w, y);
                ctx.stroke();
            }
            ctx.restore();
        }

        if (state.bang > 0) {
            ctx.save();
            ctx.globalAlpha = clamp(Number(state.bang), 0, 1) * 0.5;
            ctx.fillStyle = '#dc2626';
            ctx.fillRect(0, 0, L.w, L.h);
            ctx.restore();
        }
    }

    /* ------------------------------------------------------------------ */
    /* Round 1 players                                                    */
    /* ------------------------------------------------------------------ */

    function laneFor(player) {
        return Math.floor(hash01(String(player.user_id || player.id || 'x')) * 9);
    }

    function drawRound1Players(ctx, L, state) {
        const players = Array.isArray(state.players) ? state.players : [];
        const finish = Math.max(1, Number(state.finishDistance) || 100);
        const startY = L.startY;
        const finishY = L.finishY;
        const t = Number(state.elapsed) || 0;

        const sorted = players.slice().sort((a, b) => (Number(a.distance) || 0) - (Number(b.distance) || 0));
        sorted.forEach(player => {
            if (!player) return;
            if (player.is_playing === false) return;
            const alive = player.status !== 'eliminated' && player.status !== 'out' && player.ghost !== true;
            const dist = clamp(Number(player.distance) || 0, 0, finish);
            const p = dist / finish;
            const rowY = lerp(startY, finishY, p);
            const lane = laneFor(player);
            const spread = lerp(L.w * 0.43, L.w * 0.18, p);
            const laneUnit = spread / 4;
            let x = L.centerX + (lane - 4) * laneUnit;

            // Small deterministic side-step so 30 cats do not form a grid.
            const jitter = (hash01('jx' + (player.user_id || player.id)) - 0.5) * laneUnit * 0.9;
            x += jitter;

            let y = rowY;
            let alpha = alive ? 1 : 0.32;
            if (!alive) {
                y -= 8 + Math.sin(t / 420 + hash01('g' + (player.user_id || player.id)) * 6) * 6;
            } else {
                // Tiny run bounce when moving.
                const bounce = Math.abs(Math.sin(t / 150 + hash01('b' + (player.user_id || player.id)) * 8));
                y -= bounce * 2.2;
            }

            const scale = lerp(L.landscape ? 0.20 : 0.26, L.landscape ? 0.10 : 0.12, p) *
                (alive ? 1 : 0.9);
            const isMe = state.meId && String(player.user_id) === String(state.meId);

            if (!alive) {
                // Ghost cat: translucent, floating, with a soft ring.
                ctx.save();
                ctx.globalAlpha = 0.11;
                ctx.fillStyle = '#bae6fd';
                ell(ctx, x, y - 24 * scale, 34 * scale, 48 * scale);
                ctx.restore();
            }

            drawCat(ctx, x, y, scale, {
                cat: player.cat || 'Ginger',
                glasses: player.glasses || 'None',
                hat: player.hat || 'None',
                outfit: player.outfit || 'None'
            }, {
                alpha: alpha,
                ghost: !alive,
                ring: isMe,
                ringColor: '#fde047',
                halo: !alive,
                haloColor: '#7dd3fc'
            });

            // Name tag.
            if (isMe || L.landscape) {
                const name = String(player.nickname || player.email || '').split('@')[0].slice(0, 12);
                if (name) {
                    ctx.save();
                    ctx.globalAlpha = alive ? 0.92 : 0.45;
                    ctx.font = '700 ' + Math.max(8, Math.round(L.w * (L.landscape ? 0.008 : 0.018))) + 'px Fredoka, system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    const width = ctx.measureText(name).width + 8;
                    ctx.fillStyle = 'rgba(15,23,42,.55)';
                    roundRect(ctx, x - width / 2, y - 92 * scale, width, Math.max(11, 15 * scale * 0.7), 4);
                    ctx.fill();
                    ctx.fillStyle = isMe ? '#fde047' : '#f8fafc';
                    ctx.fillText(name, x, y - 94 * scale);
                    ctx.restore();
                }
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Round 1 scene                                                      */
    /* ------------------------------------------------------------------ */

    R.drawRound1 = function (ctx, state) {
        const s = state || {};
        const L = R.layout(s.w, s.h, s.role);
        const phase = s.phase || 'green';
        const turnBase = phase === 'red' || phase === 'done' ? 1 : 0;
        let turn = turnBase;
        if (phase === 'yellow') {
            const prog = clamp((Number(s.phaseElapsed) || 0) / Math.max(1, Number(s.phaseDuration) || 2000), 0, 1);
            turn = easeOut(prog);
        }
        if (s.dollTurn != null) turn = clamp(Number(s.dollTurn), 0, 1);

        drawRound1Sky(ctx, L, s.now || 0);
        drawRound1Track(ctx, L, s);

        // The doll stands behind the finish band, facing the field.
        const dollScale = L.landscape
            ? Math.min(L.w / 1100, L.h / 720) * 0.80
            : Math.min(L.w / 440, L.h / 780) * 0.85;
        const dollX = L.centerX;
        const dollY = L.finishY - 4;
        R.drawDoll(ctx, dollX, dollY, dollScale, {
            turn: turn,
            red: phase === 'red' || phase === 'done',
            warning: phase === 'yellow'
        });

        drawRound1Players(ctx, L, s);
        drawPhaseFlash(ctx, L, s);
        drawLight(ctx, L, s);

        // Round label / atmosphere line.
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = '#fff7ed';
        ctx.font = '700 ' + Math.max(10, Math.round(L.w * (L.landscape ? 0.011 : 0.026))) + 'px Fredoka, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('123 木頭貓 · RED LIGHT, GREEN LIGHT', 14, L.hud + 10);
        ctx.restore();
    };

    /* ------------------------------------------------------------------ */
    /* Round 2 — glass bridge                                             */
    /* ------------------------------------------------------------------ */

    function drawGlassSky(ctx, L, t) {
        const sky = ctx.createLinearGradient(0, 0, 0, L.h);
        sky.addColorStop(0, '#0c4a6e');
        sky.addColorStop(0.35, '#0ea5e9');
        sky.addColorStop(0.7, '#bae6fd');
        sky.addColorStop(1, '#e0f2fe');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, L.w, L.h);

        // Sun and clouds.
        const sun = ctx.createRadialGradient(L.w * 0.78, L.h * 0.16, 4, L.w * 0.78, L.h * 0.16, L.w * 0.18);
        sun.addColorStop(0, 'rgba(255,255,240,.95)');
        sun.addColorStop(0.35, 'rgba(255,245,190,.4)');
        sun.addColorStop(1, 'rgba(255,245,190,0)');
        ctx.fillStyle = sun;
        ctx.fillRect(0, 0, L.w, L.h);

        ctx.fillStyle = 'rgba(255,255,255,.55)';
        for (let i = 0; i < 7; i++) {
            const cx = ((hash01('cloud' + i) * L.w + t * 0.004 * (i + 1)) % (L.w + 160)) - 80;
            const cy = L.h * (0.10 + hash01('cloudY' + i) * 0.24);
            const r = 18 + hash01('cloudR' + i) * 30;
            ell(ctx, cx, cy, r, r * 0.55);
            ell(ctx, cx + r * 0.8, cy + 4, r * 0.7, r * 0.4);
            ell(ctx, cx - r * 0.8, cy + 5, r * 0.6, r * 0.35);
        }

        // Void below the bridge.
        const voidGrad = ctx.createLinearGradient(0, L.h * 0.62, 0, L.h);
        voidGrad.addColorStop(0, 'rgba(12,74,110,0)');
        voidGrad.addColorStop(0.55, 'rgba(8,47,73,.55)');
        voidGrad.addColorStop(1, 'rgba(3,15,28,.92)');
        ctx.fillStyle = voidGrad;
        ctx.fillRect(0, L.h * 0.62, L.w, L.h * 0.38);
    }

    function panePosition(L, stepIndex, stepCount, side) {
        const count = Math.max(1, stepCount);
        const t = count <= 1 ? 0 : stepIndex / (count - 1);
        const y = lerp(L.bridgeNearY, L.bridgeFarY, t);
        const halfWidth = lerp(L.w * (L.landscape ? 0.31 : 0.36), L.w * (L.landscape ? 0.10 : 0.12), t);
        const gap = lerp(L.w * 0.028, L.w * 0.008, t);
        const paneH = lerp(L.h * (L.landscape ? 0.055 : 0.040), L.h * 0.016, t);
        const cx = L.centerX + (side === 'left' ? -(halfWidth / 2 + gap / 2) : (halfWidth / 2 + gap / 2));
        return { x: cx, y: y, halfWidth: halfWidth, gap: gap, h: paneH, t: t, left: halfWidth };
    }

    function drawPane(ctx, L, step, side, index, count, meOnThis) {
        const pos = panePosition(L, index, count, side);
        const w = pos.halfWidth;
        const h = Math.max(7, pos.h);
        const x = pos.x;
        const y = pos.y;
        const revealedSide = step.revealed_side;
        const isCorrect = revealedSide === side;
        const isShattered = step.shattered_side === side;

        ctx.save();
        if (isCorrect) {
            const glow = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y);
            glow.addColorStop(0, 'rgba(34,197,94,.92)');
            glow.addColorStop(0.5, 'rgba(190,255,210,.98)');
            glow.addColorStop(1, 'rgba(21,128,61,.92)');
            ctx.fillStyle = glow;
            ctx.shadowColor = 'rgba(34,197,94,.9)';
            ctx.shadowBlur = 18;
        } else if (isShattered) {
            ctx.fillStyle = 'rgba(15,23,42,.65)';
            ctx.shadowBlur = 0;
        } else {
            const glass = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y);
            glass.addColorStop(0, 'rgba(186,230,253,.60)');
            glass.addColorStop(0.45, 'rgba(224,242,254,.88)');
            glass.addColorStop(1, 'rgba(125,211,252,.62)');
            ctx.fillStyle = glass;
            ctx.shadowColor = 'rgba(125,211,252,.5)';
            ctx.shadowBlur = 8;
        }

        ctx.beginPath();
        ctx.moveTo(x - w / 2, y - h / 2);
        ctx.lineTo(x + w / 2, y - h / 2);
        ctx.lineTo(x + w / 2 - 3, y + h / 2);
        ctx.lineTo(x - w / 2 + 3, y + h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;

        if (isShattered) {
            ctx.strokeStyle = 'rgba(148,214,255,.65)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 5; i++) {
                ctx.beginPath();
                ctx.moveTo(x - w / 2 + (w / 5) * i, y - h / 2);
                ctx.lineTo(x - w / 3 + (w / 6) * i, y + h / 2);
                ctx.stroke();
            }
        } else if (!step.revealed) {
            // Faint glint on untouched glass.
            ctx.strokeStyle = 'rgba(255,255,255,.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - w * 0.32, y + h * 0.10);
            ctx.lineTo(x + w * 0.18, y - h * 0.22);
            ctx.stroke();
        }

        if (isCorrect) {
            ctx.strokeStyle = 'rgba(240,253,244,.95)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - w / 2, y - h / 2);
            ctx.lineTo(x + w / 2, y - h / 2);
            ctx.lineTo(x + w / 2 - 3, y + h / 2);
            ctx.lineTo(x - w / 2 + 3, y + h / 2);
            ctx.closePath();
            ctx.stroke();
        }

        if (meOnThis) {
            ctx.strokeStyle = '#fde047';
            ctx.lineWidth = 3;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x - w / 2 - 3, y - h / 2 - 3);
            ctx.lineTo(x + w / 2 + 3, y - h / 2 - 3);
            ctx.stroke();
        }

        // Option text.
        const label = side === 'left' ? step.left : step.right;
        if (label) {
            const fontSize = Math.max(7, Math.round(h * (L.landscape ? 0.58 : 0.5)));
            ctx.font = '800 ' + fontSize + 'px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isCorrect ? '#052e16' : (isShattered ? 'rgba(226,232,240,.55)' : '#0c4a6e');
            const maxWidth = w - 8;
            let text = String(label);
            if (ctx.measureText(text).width > maxWidth) {
                while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) {
                    text = text.slice(0, -1);
                }
                text += '…';
            }
            ctx.fillText(text, x, y + 1);
        }
        ctx.restore();
    }

    function drawBridgeRail(ctx, L, count) {
        // Two rails make the bridge readable even when the panes are busy.
        ['left', 'right'].forEach(side => {
            const sign = side === 'left' ? -1 : 1;
            const near = panePosition(L, 0, count, side);
            const far = panePosition(L, count - 1, count, side);
            const nearX = near.x + sign * (near.halfWidth / 2 + near.gap * 0.2);
            const farX = far.x + sign * (far.halfWidth / 2 + far.gap * 0.2);
            ctx.save();
            ctx.strokeStyle = 'rgba(241,245,249,.65)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(nearX, near.y + near.h);
            ctx.lineTo(farX, far.y + far.h);
            ctx.stroke();
            ctx.restore();
        });
    }

    function drawRound2Players(ctx, L, state) {
        const players = Array.isArray(state.players) ? state.players : [];
        const steps = Math.max(1, Number(state.stepCount) || 9);
        const meId = state.meId ? String(state.meId) : '';

        players.forEach(player => {
            if (!player) return;
            if (player.is_playing === false) return;
            const alive = player.status !== 'eliminated' && player.status !== 'out' && player.ghost !== true;
            const step = clamp(Number(player.glass_step) || 0, 0, steps);
            const side = player.glass_side === 'right' ? 'right' : 'left';
            const isMe = meId && String(player.user_id) === meId;
            let x;
            let y;
            let scale;
            let alpha = alive ? 1 : 0.28;

            if (step >= steps) {
                // Reached the far side.
                x = L.centerX + (hash01('win' + (player.user_id || '')) - 0.5) * L.w * 0.34;
                y = L.bridgeFarY - L.h * 0.06;
                scale = (L.landscape ? 0.135 : 0.17) * 0.9;
            } else if (player.glass_active) {
                const rowIndex = clamp(step, 0, steps - 1);
                const pos = panePosition(L, rowIndex, steps, side);
                x = pos.x;
                y = pos.y - Math.max(4, pos.h * 0.2);
                scale = lerp(L.landscape ? 0.145 : 0.19, 0.09, pos.t) * (isMe ? 1.16 : 1);
            } else if (alive) {
                // Queued at the start platform.
                const idx = players.filter(p => p.status === 'alive' && !p.glass_active).indexOf(player);
                x = L.centerX + (hash01('queue' + (player.user_id || '')) - 0.5) * L.w * 0.46;
                y = L.bridgeNearY + L.h * (0.03 + (Math.max(0, idx) % 3) * 0.028);
                scale = (L.landscape ? 0.13 : 0.165);
            } else {
                // Fell into the void.
                const fallT = (Number(state.now) || 0) / 2200 + hash01('fall' + (player.user_id || '')) * 6;
                x = L.centerX + (hash01('fx' + (player.user_id || '')) - 0.5) * L.w * 0.5;
                y = L.bridgeNearY + L.h * 0.15 + (fallT % 1) * L.h * 0.18;
                scale = 0.10;
            }

            drawCat(ctx, x, y, scale, {
                cat: player.cat || 'Ginger',
                glasses: player.glasses || 'None',
                hat: player.hat || 'None',
                outfit: player.outfit || 'None'
            }, {
                alpha: alpha,
                ghost: !alive,
                ring: isMe && alive,
                ringColor: '#fde047',
                halo: !alive,
                haloColor: '#7dd3fc'
            });

            if ((isMe || L.landscape) && (alive || isMe)) {
                const name = String(player.nickname || player.email || '').split('@')[0].slice(0, 12);
                if (name) {
                    ctx.save();
                    ctx.globalAlpha = alive ? 0.9 : 0.45;
                    ctx.font = '700 ' + Math.max(7, Math.round(L.w * (L.landscape ? 0.008 : 0.018))) + 'px Fredoka, system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    const width = ctx.measureText(name).width + 8;
                    ctx.fillStyle = 'rgba(15,23,42,.55)';
                    roundRect(ctx, x - width / 2, y - 94 * scale, width, Math.max(10, 15 * scale * 0.7), 4);
                    ctx.fill();
                    ctx.fillStyle = isMe ? '#fde047' : '#f8fafc';
                    ctx.fillText(name, x, y - 96 * scale);
                    ctx.restore();
                }
            }
        });

        // Queue count at the start platform.
        const queued = players.filter(p => p.is_playing !== false && p.status === 'alive' && !p.glass_active).length;
        if (queued > 0) {
            ctx.save();
            ctx.fillStyle = 'rgba(15,23,42,.55)';
            ctx.font = '700 ' + Math.max(9, Math.round(L.w * (L.landscape ? 0.010 : 0.022))) + 'px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Queue: ' + queued + ' waiting', L.centerX, L.h - L.h * 0.035);
            ctx.restore();
        }
    }

    R.drawRound2 = function (ctx, state) {
        const s = state || {};
        const L = R.layout(s.w, s.h, s.role);
        const players = Array.isArray(s.players) ? s.players : [];
        const steps = Math.max(1, Number(s.stepCount) || 9);
        const glass = Array.isArray(s.glassSteps) ? s.glassSteps : [];
        const me = s.meId ? players.find(p => String(p.user_id) === String(s.meId)) : null;

        drawGlassSky(ctx, L, s.now || 0);

        // Bridge underside shadow.
        ctx.save();
        ctx.fillStyle = 'rgba(3,15,28,.55)';
        ctx.beginPath();
        ctx.moveTo(L.centerX - L.w * 0.44, L.bridgeNearY + L.h * 0.04);
        ctx.lineTo(L.centerX + L.w * 0.44, L.bridgeNearY + L.h * 0.04);
        ctx.lineTo(L.centerX + L.w * 0.17, L.bridgeFarY - L.h * 0.01);
        ctx.lineTo(L.centerX - L.w * 0.17, L.bridgeFarY - L.h * 0.01);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        drawBridgeRail(ctx, L, steps);

        for (let i = 0; i < steps; i++) {
            const step = glass[i] || { left: '', right: '', correct_side: 'left', revealed: false };
            const onStep = me && me.status !== 'eliminated' && Number(me.glass_step) === i && me.glass_active;
            const mySide = me && me.glass_side === 'right' ? 'right' : 'left';
            drawPane(ctx, L, step, 'left', i, steps, onStep && mySide === 'left');
            drawPane(ctx, L, step, 'right', i, steps, onStep && mySide === 'right');
        }

        // Destination platform.
        const farY = L.bridgeFarY - L.h * 0.015;
        ctx.fillStyle = 'rgba(248,250,252,.75)';
        roundRect(ctx, L.centerX - L.w * 0.18, farY - L.h * 0.025, L.w * 0.36, L.h * 0.05, 10);
        ctx.fill();
        ctx.fillStyle = 'rgba(15,23,42,.75)';
        ctx.font = '800 ' + Math.max(9, Math.round(L.w * (L.landscape ? 0.012 : 0.026))) + 'px Fredoka, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('FINISH', L.centerX, farY);

        drawRound2Players(ctx, L, s);

        // Vignette / frost.
        const vig = ctx.createRadialGradient(L.w / 2, L.h * 0.55, L.w * 0.18, L.w / 2, L.h * 0.55, L.w * 0.78);
        vig.addColorStop(0, 'rgba(255,255,255,0)');
        vig.addColorStop(1, 'rgba(8,47,73,.25)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, L.w, L.h);

        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#f0f9ff';
        ctx.font = '700 ' + Math.max(10, Math.round(L.w * (L.landscape ? 0.011 : 0.026))) + 'px Fredoka, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('GLASS STEPPING STONES · 玻璃橋', 14, L.hud + 10);
        ctx.restore();
    };

    /* ------------------------------------------------------------------ */
    /* Public dispatcher                                                  */
    /* ------------------------------------------------------------------ */

    R.drawScene = function (ctx, state) {
        if (!ctx) return;
        const s = state || {};
        ctx.clearRect(0, 0, s.w || ctx.canvas.width, s.h || ctx.canvas.height);
        if (Number(s.round) === 2) R.drawRound2(ctx, s);
        else R.drawRound1(ctx, s);
    };

    /* Small animated cat portrait used by the lobby waiting list. */
    R.drawLobbyCat = function (ctx, x, y, scale, look) {
        if (!ctx) return;
        drawCat(ctx, x, y, scale, look || {}, {});
    };

    root.PSRender = R;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

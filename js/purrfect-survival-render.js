/* LearniTY — Purr-fect Survival · cinematic 3D canvas renderer.
 *
 * HOW THIS IS DRAWN
 * -----------------
 * A tiny hand-rolled perspective camera (eye / yaw / pitch / focal length)
 * projects world-space triangles and quads with a real perspective divide,
 * near-plane clipping and painter's ordering. There is no 3D library: every
 * set below is built from boxes, planes, tubes and painted sprites in code.
 *
 *   • Entrance  — a first-person institutional hallway (numbered teal doors,
 *                 two-tone walls, glossy floor, ceiling strip lights, CCTV),
 *                 then a pastel stair maze with stylised pink-suited staff
 *                 walking the flights, then a held landing shot.
 *   • Round 1   — an indoor sandy playground: painted pale-blue mural wall
 *                 with soft cartoon clouds, four dalgona door panels, low
 *                 painted picket fence, climbing frame, green slide, sand
 *                 field, staff and the mechanical cat doll at the finish.
 *   • Round 2   — a dark theatre: red velvet curtains with gold trim, LED
 *                 bead strands, spotlight beams, a dark void under a
 *                 reflective two-pane glass bridge and a lit far archway.
 *   • Round 3   — a yellow industrial warehouse: two high steel platforms
 *                 over an abyss, street-lamp lights, a hemp rope with a
 *                 golden salmon at the centre and the class's own cat
 *                 avatars pulling for the red and blue teams.
 *
 * Cats are the game's own DG.drawCatAvatar sprites, billboarded in the same
 * perspective space, so store hats / glasses / outfits keep working.
 *
 * All backdrops are original painted sets drawn procedurally with gradients
 * and paths — no photographs, no bitmap backdrops, no external image assets.
 * Static set dressing is cached as a device-resolution ImageData keyed by
 * canvas size + scene + camera preset, so 30 cats animate at full speed on
 * top of the cached set.
 */
(function (root) {
    'use strict';

    const R = {};

    R.VERSION = '2.6.1';

    /* ================================================================== */
    /* Small maths / colour helpers                                       */
    /* ================================================================== */

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function smoothstep(t) {
        const x = clamp(t, 0, 1);
        return x * x * (3 - 2 * x);
    }

    function easeInOut(t) {
        const x = clamp(t, 0, 1);
        return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
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

    /* Better mixer for short keys (user ids like "u0" badly cluster in the
       raw FNV pass above). Used for lane / queue placement, never for rules. */
    function mix32(text) {
        let h = 2166136261;
        const s = String(text == null ? '' : text);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        h ^= h >>> 16;
        h = Math.imul(h, 2246822507);
        h ^= h >>> 13;
        h = Math.imul(h, 3266489909);
        return (h ^ (h >>> 16)) >>> 0;
    }

    function mix01(text) {
        return mix32(text) / 4294967296;
    }

    function ell(ctx, x, y, rx, ry) {
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
        ctx.fill();
    }

    function rr(ctx, x, y, w, h, r) {
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

    function hexRgb(hex) {
        let h = String(hex || '').replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        const n = parseInt(h, 16);
        if (!isFinite(n)) return [200, 200, 200];
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function shade(hex, amount) {
        const c = hexRgb(hex);
        const k = clamp(amount, -1, 1);
        const mix = k < 0 ? 0 : 255;
        const f = Math.abs(k);
        return 'rgb(' + c.map(v => Math.round(lerp(v, mix, f))).join(',') + ')';
    }

    function rgba(hex, alpha) {
        const c = hexRgb(hex);
        return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(alpha, 0, 1).toFixed(3) + ')';
    }

    function setFont(ctx, size, weight) {
        ctx.font = (weight || 800) + ' ' + Math.max(6, Math.round(size)) + 'px Fredoka, system-ui, sans-serif';
    }

    /* ================================================================== */
    /* Perspective camera                                                 */
    /*                                                                    */
    /* World space: +x right, +y up, +z forward (away from the viewer).   */
    /* ================================================================== */

    const NEAR = 0.45;

    function makeCam(L, spec) {
        const sp = spec || {};
        const eye = sp.eye || [0, 2.5, 0];
        const target = sp.target || [0, 2.2, 10];
        const dx = target[0] - eye[0];
        const dy = target[1] - eye[1];
        const dz = target[2] - eye[2];
        const horiz = Math.sqrt(dx * dx + dz * dz) || 0.0001;
        const yaw = Math.atan2(dx, dz);
        const pitch = Math.atan2(dy, horiz);
        const fov = (sp.fov || 60) * Math.PI / 180;
        const f = (L.h * 0.5) / Math.tan(fov / 2);
        return {
            eye: eye,
            yaw: yaw,
            pitch: pitch,
            f: f,
            cx: L.w * 0.5,
            cy: L.h * 0.5,
            cosY: Math.cos(yaw),
            sinY: Math.sin(yaw),
            cosP: Math.cos(pitch),
            sinP: Math.sin(pitch)
        };
    }

    function toCam(cam, x, y, z) {
        const dx = x - cam.eye[0];
        const dy = y - cam.eye[1];
        const dz = z - cam.eye[2];
        const x1 = dx * cam.cosY - dz * cam.sinY;
        const z1 = dx * cam.sinY + dz * cam.cosY;
        const y1 = dy * cam.cosP - z1 * cam.sinP;
        const z2 = dy * cam.sinP + z1 * cam.cosP;
        return [x1, y1, z2];
    }

    function projectCam(cam, c) {
        return {
            x: cam.cx + cam.f * c[0] / c[2],
            y: cam.cy - cam.f * c[1] / c[2],
            z: c[2],
            s: cam.f / c[2]
        };
    }

    function project(cam, x, y, z) {
        const c = toCam(cam, x, y, z);
        if (c[2] <= NEAR) return null;
        return projectCam(cam, c);
    }

    function clipNear(cam, pts) {
        const out = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const aIn = a[2] >= NEAR;
            const bIn = b[2] >= NEAR;
            if (aIn) out.push(a);
            if (aIn !== bIn) {
                const t = (NEAR - a[2]) / (b[2] - a[2]);
                out.push([
                    a[0] + (b[0] - a[0]) * t,
                    a[1] + (b[1] - a[1]) * t,
                    NEAR
                ]);
            }
        }
        return out;
    }

    /* Draw a closed (or open) world-space polygon. */
    function poly3(ctx, cam, pts, opt) {
        const o = opt || {};
        if (!pts || pts.length < 2) return;
        const camPts = [];
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            camPts.push(toCam(cam, p[0], p[1], p[2]));
        }
        const clipped = clipNear(cam, camPts);
        if (clipped.length < 2) return;
        const screen = clipped.map(c => projectCam(cam, c));
        ctx.save();
        if (o.alpha != null) ctx.globalAlpha = ctx.globalAlpha * o.alpha;
        ctx.beginPath();
        ctx.moveTo(screen[0].x, screen[0].y);
        for (let i = 1; i < screen.length; i++) ctx.lineTo(screen[i].x, screen[i].y);
        if (o.close !== false) ctx.closePath();
        if (o.fill) {
            ctx.fillStyle = o.fill;
            if (o.shadowColor) {
                ctx.shadowColor = o.shadowColor;
                ctx.shadowBlur = o.shadowBlur || 12;
            }
            ctx.fill();
            ctx.shadowBlur = 0;
        }
        if (o.stroke) {
            ctx.strokeStyle = o.stroke;
            ctx.lineWidth = o.lineWidth || 1;
            if (o.dash) ctx.setLineDash(o.dash);
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
        ctx.restore();
    }

    function line3(ctx, cam, a, b, opt) {
        poly3(ctx, cam, [a, b], Object.assign({ close: false }, opt || {}));
    }

    function faceGradient(ctx, screenPts, from, to) {
        const xs = screenPts.map(p => p.x);
        const ys = screenPts.map(p => p.y);
        const g = ctx.createLinearGradient(
            Math.min.apply(null, xs), Math.min.apply(null, ys),
            Math.max.apply(null, xs), Math.max.apply(null, ys)
        );
        g.addColorStop(0, from);
        g.addColorStop(1, to);
        return g;
    }

    /* A world-space axis-aligned box with its three camera-facing faces. */
    function box3(ctx, cam, spec) {
        const o = spec;
        if (o.z + o.d < cam.eye[2] + NEAR) return;
        const x0 = o.x;
        const x1 = o.x + o.w;
        const y0 = o.y;
        const y1 = o.y + o.h;
        const z0 = o.z;
        const z1 = o.z + o.d;
        const base = o.color || '#c9a9c9';
        const topColor = o.top || shade(base, 0.16);
        const sideColor = o.side || shade(base, -0.14);
        const frontColor = o.front || base;
        const edge = o.edge || 'rgba(24,12,32,.16)';
        const alpha = o.alpha == null ? 1 : o.alpha;

        // far face (safety, mostly hidden)
        if (o.back) poly3(ctx, cam, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
            { fill: shade(base, -0.28), alpha: alpha });

        if (cam.eye[1] > y1) {
            poly3(ctx, cam, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
                { fill: topColor, stroke: edge, lineWidth: 0.6, alpha: alpha });
        } else if (cam.eye[1] < y0) {
            poly3(ctx, cam, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
                { fill: shade(base, -0.3), alpha: alpha });
        }

        const sideX = cam.eye[0] < x0 ? x0 : (cam.eye[0] > x1 ? x1 : null);
        if (sideX != null) {
            poly3(ctx, cam, [[sideX, y0, z0], [sideX, y0, z1], [sideX, y1, z1], [sideX, y1, z0]],
                { fill: sideColor, stroke: edge, lineWidth: 0.6, alpha: alpha });
        }

        poly3(ctx, cam, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
            { fill: frontColor, stroke: edge, lineWidth: o.lineWidth || 0.7, alpha: alpha });

        if (typeof o.decor === 'function') o.decor(ctx, cam);
    }

    /* Soft additive glow at a projected point. */
    function glow(ctx, x, y, radius, color, alpha) {
        if (!isFinite(x) || !isFinite(y) || radius <= 0) return;
        const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
        g.addColorStop(0, rgba(color, alpha == null ? 0.8 : alpha));
        g.addColorStop(0.45, rgba(color, (alpha == null ? 0.8 : alpha) * 0.32));
        g.addColorStop(1, rgba(color, 0));
        ctx.save();
        ctx.fillStyle = g;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        ctx.restore();
    }

    /* Dark readable pill for canvas HUD / name tags over any backdrop. */
    function pill(ctx, x, y, text, opt) {
        const o = opt || {};
        const size = o.size || 11;
        setFont(ctx, size, 800);
        const padX = Math.max(5, size * 0.55);
        const h = size + Math.max(6, size * 0.62);
        const w = ctx.measureText(String(text)).width + padX * 2;
        const px = o.align === 'left' ? x : (o.align === 'right' ? x - w : x - w / 2);
        ctx.save();
        ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
        ctx.fillStyle = o.bg || 'rgba(8,12,24,.68)';
        rr(ctx, px, y - h / 2, w, h, h / 2);
        ctx.fill();
        if (o.border) {
            ctx.strokeStyle = o.border;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        setFont(ctx, size, 800);
        ctx.fillStyle = o.color || '#f8fafc';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(text), px + padX, y + 0.5);
        ctx.restore();
    }

    /* ================================================================== */
    /* Cat billboards                                                     */
    /* ================================================================== */

    function drawCat(ctx, x, y, scale, look, opts) {
        const o = opts || {};
        ctx.save();
        if (o.alpha != null) ctx.globalAlpha = o.alpha;
        if (o.ghost) ctx.globalAlpha = (o.alpha == null ? 0.4 : o.alpha) * 0.85;
        if (typeof root.DG !== 'undefined' && root.DG && typeof root.DG.drawCatAvatar === 'function') {
            root.DG.drawCatAvatar(ctx, x, y, scale, look || {}, { preview: true });
        } else {
            // Tiny fallback so the renderer never crashes if Drive & Go! failed
            // to load. The real game always has DG.
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
            ctx.strokeStyle = o.haloColor || '#7dd3fc';
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

    function catLook(player) {
        return {
            cat: player.cat || 'Ginger',
            glasses: player.glasses || 'None',
            hat: player.hat || 'None',
            outfit: player.outfit || 'None'
        };
    }

    /* Billboards a cat at a world point. Returns the projected anchor. */
    function drawCatAt(ctx, cam, x, y, z, scaleWorld, look, opts) {
        const p = project(cam, x, y, z);
        if (!p) return null;
        const scale = p.s * scaleWorld / 110;
        const o = opts || {};
        drawCat(ctx, p.x, p.y, scale, look, o);
        return { x: p.x, y: p.y, scale: scale, s: p.s };
    }

    function shortName(player) {
        return String(player.nickname || player.email || '')
            .split('@')[0]
            .replace(/^\s+|\s+$/g, '')
            .slice(0, 12);
    }

    /* ================================================================== */
    /* Stylised staff — original hooded jumpsuit figures (no weapons)     */
    /* ================================================================== */

    function drawGuard(ctx, cam, x, y, z, t, seed, opts) {
        const p = project(cam, x, y, z);
        if (!p) return;
        const o = opts || {};
        const h = 1.72 * p.s * (o.scale || 1);
        if (h < 4) return;
        const sway = Math.sin(t / 720 + seed * 5.1) * 0.012 * h;
        const step = o.walk ? Math.sin(t / 250 + seed * 3.3) : 0;
        const baseX = p.x;
        const baseY = p.y;
        const w = h * 0.30;
        const suit = o.suit || '#d63a72';
        const suitDark = shade(suit, -0.18);
        const suitLight = shade(suit, 0.16);

        ctx.save();
        // ground shadow
        ctx.fillStyle = 'rgba(20,8,20,.26)';
        ell(ctx, baseX, baseY + h * 0.01, w * 0.72, h * 0.032);

        // legs
        ctx.strokeStyle = suitDark;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1, h * 0.085);
        [-1, 1].forEach(side => {
            ctx.beginPath();
            ctx.moveTo(baseX + side * w * 0.16, baseY - h * 0.54);
            ctx.lineTo(baseX + side * w * 0.20 + step * side * h * 0.03, baseY - h * 0.04);
            ctx.stroke();
        });
        // shoes
        ctx.fillStyle = '#1b1220';
        [-1, 1].forEach(side => {
            ctx.beginPath();
            ctx.ellipse(baseX + side * w * 0.20 + step * side * h * 0.03, baseY - h * 0.015, h * 0.055, h * 0.022, 0, 0, Math.PI * 2);
            ctx.fill();
        });

        // torso: a soft hooded jumpsuit
        const grad = ctx.createLinearGradient(baseX - w * 0.5, 0, baseX + w * 0.5, 0);
        grad.addColorStop(0, suitDark);
        grad.addColorStop(0.45, suitLight);
        grad.addColorStop(1, suit);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(baseX - w * 0.42 + sway, baseY - h * 0.48);
        ctx.quadraticCurveTo(baseX - w * 0.50 + sway, baseY - h * 0.74, baseX - w * 0.34 + sway, baseY - h * 0.86);
        ctx.lineTo(baseX + w * 0.34 + sway, baseY - h * 0.86);
        ctx.quadraticCurveTo(baseX + w * 0.50 + sway, baseY - h * 0.74, baseX + w * 0.42 + sway, baseY - h * 0.48);
        ctx.quadraticCurveTo(baseX, baseY - h * 0.42, baseX - w * 0.42 + sway, baseY - h * 0.48);
        ctx.closePath();
        ctx.fill();

        // belt
        ctx.fillStyle = 'rgba(30,10,26,.35)';
        ctx.fillRect(baseX - w * 0.36 + sway, baseY - h * 0.62, w * 0.72, h * 0.05);

        // arms (hands together in front — no weapons)
        ctx.strokeStyle = suitDark;
        ctx.lineWidth = Math.max(1, h * 0.062);
        [-1, 1].forEach(side => {
            ctx.beginPath();
            ctx.moveTo(baseX + side * w * 0.36 + sway, baseY - h * 0.80);
            ctx.quadraticCurveTo(baseX + side * w * 0.52 + sway, baseY - h * 0.66, baseX + side * w * 0.16 + sway, baseY - h * 0.52);
            ctx.stroke();
        });

        // hood
        ctx.fillStyle = suit;
        ctx.beginPath();
        ctx.arc(baseX + sway, baseY - h * 0.95, h * 0.135, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = suitLight;
        ctx.beginPath();
        ctx.arc(baseX + sway - h * 0.03, baseY - h * 0.98, h * 0.105, 0, Math.PI * 2);
        ctx.fill();

        // mesh mask: stylised, no features that read as a face
        ctx.fillStyle = '#251521';
        ctx.beginPath();
        ctx.ellipse(baseX + sway, baseY - h * 0.945, h * 0.070, h * 0.084, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(240,210,220,.35)';
        ctx.lineWidth = Math.max(0.5, h * 0.008);
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(baseX + sway - h * 0.05, baseY - h * 0.945 + i * h * 0.024);
            ctx.lineTo(baseX + sway + h * 0.05, baseY - h * 0.945 + i * h * 0.024);
            ctx.stroke();
        }

        // fur-trim highlight along the hood edge
        ctx.strokeStyle = 'rgba(255,235,245,.45)';
        ctx.lineWidth = Math.max(0.6, h * 0.012);
        ctx.beginPath();
        ctx.arc(baseX + sway, baseY - h * 0.95, h * 0.135, -0.4, Math.PI * 0.9);
        ctx.stroke();

        ctx.restore();
    }

    /* ================================================================== */
    /* Mechanical cat doll (kept API-compatible with the 2D game)         */
    /* ================================================================== */

    R.drawDoll = function (ctx, x, y, scale, state) {
        const s = Math.max(0.1, Number(scale) || 1);
        const o = state || {};
        const turn = clamp(Number(o.turn) || 0, 0, 1);
        ctx.save();
        ctx.translate(x, y);

        ctx.fillStyle = 'rgba(40,20,30,.25)';
        ell(ctx, 0, 6 * s, 46 * s, 9 * s);

        // Legs.
        ctx.fillStyle = '#f6d7c8';
        [-16, 16].forEach(dx => {
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(dx * s - 6 * s, -40 * s, 12 * s, 44 * s, 5 * s);
            else ctx.rect(dx * s - 6 * s, -40 * s, 12 * s, 44 * s);
            ctx.fill();
            ctx.fillStyle = '#241530';
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

        ctx.fillStyle = '#f6d7c8';
        ctx.fillRect(-6 * s, -144 * s, 12 * s, 16 * s);

        ctx.save();
        ctx.translate(0, -168 * s);
        ctx.fillStyle = '#f8ddcf';
        ell(ctx, 0, 0, 26 * s, 28 * s);
        ctx.fillStyle = '#17121f';
        ctx.beginPath();
        ctx.arc(0, -3 * s, 29 * s, Math.PI * 0.02, Math.PI * 0.98, true);
        ctx.lineTo(24 * s, 22 * s);
        ctx.quadraticCurveTo(0, 30 * s, -24 * s, 22 * s);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -24 * s, 30 * s, 9 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        // mechanical cat ears (the doll is a cat, not the live-action figure)
        ctx.fillStyle = '#17121f';
        [-1, 1].forEach(side => {
            ctx.beginPath();
            ctx.moveTo(side * 23 * s, -6 * s);
            ctx.lineTo(side * 31 * s, -41 * s);
            ctx.lineTo(side * 7 * s, -25 * s);
            ctx.closePath();
            ctx.fill();
        });
        ctx.fillStyle = '#f472b6';
        [-1, 1].forEach(side => {
            ctx.beginPath();
            ctx.moveTo(side * 23 * s, -11 * s);
            ctx.lineTo(side * 28 * s, -34 * s);
            ctx.lineTo(side * 12 * s, -24 * s);
            ctx.closePath();
            ctx.fill();
        });

        if (turn < 0.55) {
            ctx.globalAlpha = 1 - turn / 0.55;
            ctx.strokeStyle = 'rgba(255,255,255,.22)';
            ctx.lineWidth = 2 * s;
            ctx.beginPath();
            ctx.arc(0, 2 * s, 12 * s, 0.2, Math.PI - 0.2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

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
            [-9, 9].forEach(dx => {
                ctx.beginPath();
                ctx.ellipse(dx * s, 0, 3.2 * s, eyeGlow ? 5.2 * s : 3.6 * s, 0, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.shadowBlur = 0;

            ctx.strokeStyle = 'rgba(80,40,50,.5)';
            ctx.lineWidth = 1.2 * s;
            ctx.beginPath();
            ctx.moveTo(-4 * s, 11 * s);
            ctx.quadraticCurveTo(0, 13 * s, 4 * s, 11 * s);
            ctx.stroke();

            if (o.red) {
                ctx.save();
                ctx.globalAlpha = 0.5;
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

    /* ================================================================== */
    /* Layout                                                             */
    /* ================================================================== */

    R.layout = function (w, h, role) {
        const width = Math.max(1, Number(w) || 1);
        const height = Math.max(1, Number(h) || 1);
        const landscape = width > height;
        const host = role === 'host';
        const hud = landscape ? Math.min(96, height * 0.18) : Math.min(130, height * 0.17);
        const eye1 = landscape ? (host ? 3.6 : 1.82) : (host ? 3.2 : 1.48);
        /* The teacher / projector gets a true overhead view of each arena
           so the whole class and the finish are visible at once. Students
           keep the closer, lower, more cinematic camera. */
        /* The projector course is longer (it starts nearer the camera) so
           the host camera is pulled down/forward to frame it tightly. The
           student camera and course are unchanged. */
        const hostCam1 = landscape
            ? { eye: [0, 7.5, -6.0], target: [0, 0.2, 9.0], fov: 60 }
            : { eye: [0, 8.0, -4.0], target: [0, 0.2, 8.4], fov: 64 };
        const r1Track = host
            ? { startZ: 0.8, finishZ: 9.95, dollZ: 10.2 }
            : { startZ: 5.0, finishZ: 9.8, dollZ: 10.15 };
        const hostCam2 = landscape
            ? { eye: [-1.4, 10.6, -8.6], target: [-1.4, 0.0, 7.6], fov: 54 }
            : { eye: [0, 8.0, -4.0], target: [0, 0.0, 7.6], fov: 60 };
        const hostCam3 = landscape
            ? { eye: [-1.4, 10.6, -7.6], target: [-1.4, 0.4, 5.8], fov: 54 }
            : { eye: [0, 8.0, -4.6], target: [0, 0.4, 5.8], fov: 56 };
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
            centerX: width * 0.5,
            round1StartZ: r1Track.startZ,
            round1FinishZ: r1Track.finishZ,
            round1DollZ: r1Track.dollZ,
            // camera presets for the 3D sets
            cam1: host
                ? hostCam1
                : {
                    eye: [0, eye1, landscape ? -1.0 : -0.4],
                    target: [0, eye1, 9.0],
                    fov: landscape ? 58 : 62
                },
            cam2: host
                ? hostCam2
                : ((landscape && height < 560)
                    ? {
                        eye: [0, 4.6, -4.0],
                        target: [0, 0.4, 6.5],
                        fov: 58
                    }
                    : {
                        eye: [0, landscape ? 5.6 : 3.6, landscape ? -7.6 : -5.2],
                        target: [0, landscape ? 0.35 : 0.5, landscape ? 6.8 : 7.0],
                        fov: landscape ? 58 : 61
                    }),
            // Round 3 — host overhead of both platforms; students keep a
            // closer, slightly angled view toward their own team.
            cam3: host
                ? hostCam3
                : {
                    eye: landscape
                        ? [0, 4.2, -12.0]
                        : [0, 4.6, -17.5],
                    target: [0, 3.4, 6.0],
                    fov: landscape ? 58 : 52
                }
        };
    };

    /* ================================================================== */
    /* Static set cache                                                   */
    /*                                                                    */
    /* The expensive set dressing is painted once into a device-resolution */
    /* ImageData and blitted back with putImageData (no bitmap assets are  */
    /* ever loaded). Camera-moving shots skip the cache.                  */
    /* ================================================================== */

    const setCache = new Map();

    function drawCached(ctx, L, key, paint) {
        const canvas = ctx && ctx.canvas;
        const doc = root.document;
        if (!canvas || !doc || typeof doc.createElement !== 'function' ||
            typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') {
            paint(ctx);
            return false;
        }
        const pw = canvas.width || 0;
        const ph = canvas.height || 0;
        if (!pw || !ph || pw * ph > 3000000) {
            paint(ctx);
            return false;
        }
        const ck = key + ':' + pw + 'x' + ph + ':' + Math.round(L.w) + 'x' + Math.round(L.h);
        let data = setCache.get(ck);
        if (!data) {
            let off = null;
            try {
                off = doc.createElement('canvas');
                off.width = pw;
                off.height = ph;
            } catch (e) {
                off = null;
            }
            const octx = off && off.getContext ? off.getContext('2d') : null;
            if (!octx) {
                paint(ctx);
                return false;
            }
            try {
                octx.setTransform(pw / L.w, 0, 0, ph / L.h, 0, 0);
                paint(octx);
                data = octx.getImageData(0, 0, pw, ph);
            } catch (e) {
                data = null;
            }
            if (!data) {
                paint(ctx);
                return false;
            }
            if (setCache.size > 3) setCache.clear();
            setCache.set(ck, data);
        }
        try {
            ctx.putImageData(data, 0, 0);
            return true;
        } catch (e) {
            paint(ctx);
            return false;
        }
    }

    /* ================================================================== */
    /* Entrance · 1. institutional hallway                                */
    /* ================================================================== */

    const HALL = { halfWidth: 2.15, height: 3.15, end: 33 };

    function hallDoors() {
        const left = [];
        const right = [];
        for (let i = 0; i < 10; i++) {
            const z = -0.6 + i * 3.35;
            left.push({ z: z, num: String(40 - i).padStart(3, '0') });
            right.push({ z: z + 1.65, num: String(30 - i).padStart(3, '0') });
        }
        return { left: left, right: right };
    }

    const HALL_DOORS = hallDoors();

    function hallCam(L, t) {
        const k = easeInOut(clamp(t / 6000, 0, 1));
        const z = -2.6 + k * 20.5;
        const sway = Math.sin(t / 2100) * 0.05 + Math.sin(t / 830) * 0.015;
        return makeCam(L, {
            eye: [sway, 1.62 + Math.sin(t / 1500) * 0.012, z],
            target: [sway * 0.3, 1.56, z + 12],
            fov: L.landscape ? 68 : 66
        });
    }

    function hallDoor(ctx, cam, z, sideX, num, side) {
        const W = 0.94;
        const H = 2.04;
        const inset = side === 'left' ? 0.012 : -0.012;
        const x = sideX + inset;
        // frame
        poly3(ctx, cam, [[x, 0, z - 0.06], [x, 0, z + W + 0.06], [x, H + 0.08, z + W + 0.06], [x, H + 0.08, z - 0.06]],
            { fill: '#3d6469' });
        // door leaf
        poly3(ctx, cam, [[x, 0.02, z], [x, 0.02, z + W], [x, H, z + W], [x, H, z]],
            { fill: '#71959a' });
        // lower + upper inset panels
        poly3(ctx, cam, [[x, 0.18, z + 0.10], [x, 0.18, z + W - 0.10], [x, 0.90, z + W - 0.10], [x, 0.90, z + 0.10]],
            { fill: '#678b90', stroke: 'rgba(30,50,52,.30)', lineWidth: 0.8 });
        poly3(ctx, cam, [[x, 1.02, z + 0.10], [x, 1.02, z + W - 0.10], [x, 1.66, z + W - 0.10], [x, 1.66, z + 0.10]],
            { fill: '#678b90', stroke: 'rgba(30,50,52,.30)', lineWidth: 0.8 });

        // number plate + vents
        const plate = project(cam, x, 1.46, z + W * 0.5);
        if (plate) {
            ctx.save();
            setFont(ctx, Math.max(11, Math.min(28, plate.s * 0.22)), 800);
            ctx.fillStyle = 'rgba(22,40,42,.95)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(num, plate.x, plate.y);
            ctx.restore();
        }
        // vent lines near the bottom
        for (let i = 0; i < 4; i++) {
            const vy = 0.28 + i * 0.05;
            line3(ctx, cam, [x, vy, z + 0.14], [x, vy, z + W - 0.14], { stroke: 'rgba(35,58,60,.35)', lineWidth: 0.6 });
        }
        // handle
        const handle = project(cam, x, 1.0, z + (side === 'left' ? W - 0.13 : 0.13));
        if (handle && handle.s > 8) {
            ctx.save();
            ctx.fillStyle = '#2c3f42';
            ell(ctx, handle.x, handle.y, Math.max(1.2, handle.s * 0.012), Math.max(2.6, handle.s * 0.028));
            ctx.restore();
        }
    }

    function drawHall(ctx, L, t) {
        const cam = hallCam(L, t);
        const yTop = HALL.height;
        const xW = HALL.halfWidth;
        const zEnd = HALL.end;
        // start large planes just in front of the eye so their clipped
        // corners never project to absurd screen coordinates
        const zNear = cam.eye[2] + 0.9;

        ctx.fillStyle = '#0d1a18';
        ctx.fillRect(0, 0, L.w, L.h);

        // floor (glossy institutional green)
        const floorG = ctx.createLinearGradient(0, L.h, 0, L.h * 0.46);
        floorG.addColorStop(0, '#336653');
        floorG.addColorStop(0.45, '#25503f');
        floorG.addColorStop(1, '#1a382e');
        poly3(ctx, cam, [[-xW, 0, zNear], [xW, 0, zNear], [xW, 0, zEnd], [-xW, 0, zEnd]], { fill: floorG });
        poly3(ctx, cam, [[-xW, 0, zNear], [xW, 0, zNear], [xW, 0, zEnd], [-xW, 0, zEnd]],
            { fill: 'rgba(46,92,77,.55)' });
        // glossy sheen down the centre
        poly3(ctx, cam, [[-0.9, 0.002, zNear], [0.9, 0.002, zNear], [0.55, 0.002, zEnd], [-0.55, 0.002, zEnd]],
            { fill: 'rgba(168,214,192,.07)' });

        // ceiling
        poly3(ctx, cam, [[-xW, yTop, zNear], [xW, yTop, zNear], [xW, yTop, zEnd], [-xW, yTop, zEnd]], { fill: '#cddcd4' });
        // ceiling side shadows
        poly3(ctx, cam, [[-xW, yTop, zNear], [-xW + 0.7, yTop, zNear], [-xW + 0.7, yTop, zEnd], [-xW, yTop, zEnd]],
            { fill: 'rgba(90,120,110,.35)' });
        poly3(ctx, cam, [[xW - 0.7, yTop, zNear], [xW, yTop, zNear], [xW, yTop, zEnd], [xW - 0.7, yTop, zEnd]],
            { fill: 'rgba(90,120,110,.35)' });

        // walls: white upper band, dark green lower band, sharp dado line
        const upperG = ctx.createLinearGradient(0, 0, 0, L.h * 0.75);
        upperG.addColorStop(0, '#f3f8f3');
        upperG.addColorStop(1, '#d6e3da');
        const lowerG = ctx.createLinearGradient(0, 0, 0, L.h);
        lowerG.addColorStop(0, '#3b6b54');
        lowerG.addColorStop(1, '#22443a');
        ['left', 'right'].forEach(side => {
            const x = side === 'left' ? -xW : xW;
            poly3(ctx, cam, [[x, 0, zNear], [x, 0, zEnd], [x, 1.02, zEnd], [x, 1.02, zNear]], { fill: lowerG });
            poly3(ctx, cam, [[x, 1.02, zNear], [x, 1.02, zEnd], [x, yTop, zEnd], [x, yTop, zNear]], { fill: upperG });
            // dado trim + baseboard
            line3(ctx, cam, [x, 1.02, zNear], [x, 1.02, zEnd], { stroke: '#1f3f33', lineWidth: 2.4 });
            line3(ctx, cam, [x, 1.02, zNear], [x, 1.02, zEnd], { stroke: 'rgba(180,220,196,.28)', lineWidth: 0.8 });
            line3(ctx, cam, [x, 0.10, zNear], [x, 0.10, zEnd], { stroke: 'rgba(18,36,30,.65)', lineWidth: 2 });
            // subtle reflection wash on the lower band
            poly3(ctx, cam, [[x, 0.2, zNear], [x, 0.2, zNear + 14], [x, 0.85, zNear + 14], [x, 0.85, zNear]],
                { fill: 'rgba(120,170,150,.07)' });
        });
        // far end wall + glowing exit
        poly3(ctx, cam, [[-xW, 0, zEnd], [xW, 0, zEnd], [xW, yTop, zEnd], [-xW, yTop, zEnd]], { fill: '#b9c9c1' });
        poly3(ctx, cam, [[-0.9, 0, zEnd - 0.02], [0.9, 0, zEnd - 0.02], [0.9, 2.25, zEnd - 0.02], [-0.9, 2.25, zEnd - 0.02]],
            { fill: '#f2fbf2' });
        const endP = project(cam, 0, 1.1, zEnd);
        if (endP) glow(ctx, endP.x, endP.y, Math.max(20, endP.s * 2.6), '#eafff4', 0.55);

        // ceiling strip lights
        const lights = [];
        for (let z = 1.6; z < zEnd - 2; z += 3.8) lights.push(z);
        lights.forEach((z, idx) => {
            // housing
            poly3(ctx, cam, [[-0.58, yTop - 0.11, z - 0.75], [0.58, yTop - 0.11, z - 0.75],
                [0.58, yTop - 0.11, z + 0.75], [-0.58, yTop - 0.11, z + 0.75]],
                { fill: 'rgba(120,140,132,.55)' });
            poly3(ctx, cam, [[-0.52, yTop - 0.10, z - 0.68], [0.52, yTop - 0.10, z - 0.68],
                [0.52, yTop - 0.10, z + 0.68], [-0.52, yTop - 0.10, z + 0.68]],
                { fill: '#f4ffe8' });
            const lp = project(cam, 0, yTop - 0.1, z);
            if (lp && lp.s > 4) {
                glow(ctx, lp.x, lp.y, Math.max(10, lp.s * 1.4), '#f7ffe9', 0.5);
                // glossy floor reflection streak
                const near = project(cam, 0, 0.005, z - 1.1);
                const far = project(cam, 0, 0.005, z + 2.4);
                if (near && far) {
                    const g = ctx.createLinearGradient(near.x, near.y, far.x, far.y);
                    g.addColorStop(0, 'rgba(240,255,232,.34)');
                    g.addColorStop(0.45, 'rgba(240,255,232,.16)');
                    g.addColorStop(1, 'rgba(240,255,232,0)');
                    poly3(ctx, cam, [[-0.42, 0.004, z - 1.1], [0.42, 0.004, z - 1.1],
                        [0.34, 0.004, z + 2.4], [-0.34, 0.004, z + 2.4]], { fill: g });
                }
            }
        });

        // wall sconces between doors
        for (let z = 0.9; z < zEnd - 3; z += 6.7) {
            ['left', 'right'].forEach(side => {
                const x = side === 'left' ? -xW + 0.03 : xW - 0.03;
                poly3(ctx, cam, [[x, 2.02, z], [x, 2.02, z + 0.34], [x, 2.26, z + 0.34], [x, 2.26, z]], { fill: '#efe4c8' });
                const sp = project(cam, x, 2.14, z + 0.17);
                if (sp && sp.s > 3) glow(ctx, sp.x, sp.y, Math.max(6, sp.s * 0.55), '#ffe9b0', 0.5);
            });
        }

        // doors (far to near so nearer frames overlap)
        const items = HALL_DOORS.left.map(d => ({ z: d.z, num: d.num, side: 'left' }))
            .concat(HALL_DOORS.right.map(d => ({ z: d.z, num: d.num, side: 'right' })))
            .sort((a, b) => b.z - a.z);
        items.forEach(item => {
            hallDoor(ctx, cam, item.z, item.side === 'left' ? -xW + 0.02 : xW - 0.02, item.num, item.side);
        });

        // teal door reflections on the glossy floor
        items.forEach(item => {
            const side = item.side === 'left' ? -1 : 1;
            const xi = side * (xW - 0.04);
            const xo = side * (xW - 0.62);
            poly3(ctx, cam, [[xi, 0.003, item.z], [xi, 0.003, item.z + 0.94],
                [xo, 0.003, item.z + 0.94], [xo, 0.003, item.z]],
                { fill: 'rgba(104,158,158,.09)' });
        });

        // CCTV camera on the left wall (placed down the corridor so it is
        // actually inside the narrow phone field of view)
        const cctv = { x: -xW + 0.20, y: 2.44, z: 9.6 };
        const c0 = project(cam, cctv.x, cctv.y, cctv.z);
        if (c0) {
            const s = c0.s;
            ctx.save();
            ctx.fillStyle = '#1c2b2e';
            rr(ctx, c0.x - s * 0.16, c0.y - s * 0.10, s * 0.32, s * 0.20, s * 0.05);
            ctx.fill();
            ctx.fillStyle = '#0d1417';
            ell(ctx, c0.x + s * 0.14, c0.y + s * 0.03, s * 0.09, s * 0.07);
            ctx.fill();
            ctx.strokeStyle = '#2c4045';
            ctx.lineWidth = Math.max(1, s * 0.015);
            ctx.beginPath();
            ctx.moveTo(c0.x - s * 0.16, c0.y - s * 0.1);
            ctx.lineTo(c0.x - s * 0.3, c0.y - s * 0.22);
            ctx.stroke();
            ctx.restore();
        }

        // cool overhead haze
        const haze = ctx.createRadialGradient(L.w * 0.5, L.h * 0.36, L.w * 0.05, L.w * 0.5, L.h * 0.5, L.w * 0.9);
        haze.addColorStop(0, 'rgba(210,240,225,.10)');
        haze.addColorStop(1, 'rgba(4,12,10,.55)');
        ctx.fillStyle = haze;
        ctx.fillRect(0, 0, L.w, L.h);

        // vignette
        const vig = ctx.createRadialGradient(L.w * 0.5, L.h * 0.5, L.w * 0.25, L.w * 0.5, L.h * 0.5, L.w * 0.85);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(0,6,5,.55)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, L.w, L.h);
    }

    /* ================================================================== */
    /* Entrance · 2. pastel stair maze                                    */
    /* ================================================================== */

    function addCrenellations(list, x0, y, z0, x1, z1, size, color, count) {
        for (let i = 0; i < count; i++) {
            const t = (i + 0.5) / count;
            const cx = lerp(x0, x1, t);
            const cz = lerp(z0, z1, t);
            list.push({
                x: cx - size * 0.5, y: y, z: cz - size * 0.5,
                w: size, h: size * 1.15, d: size, color: color
            });
        }
    }

    function buildStairSet() {
        const list = [];

        // --- background volumes -------------------------------------
        list.push({
            x: -14, y: 0, z: 22, w: 28, h: 16, d: 0.8, color: '#b9a3c9',
            decor: function (ctx, cam) {
                // three lit archways break up the back wall
                [-7.0, 0, 7.0].forEach((ax, i) => {
                    poly3(ctx, cam, [[ax - 1.15, 0.2, 21.96], [ax + 1.15, 0.2, 21.96],
                        [ax + 1.15, 2.5, 21.96], [ax - 1.15, 2.5, 21.96]], { fill: '#2e1c36' });
                    poly3(ctx, cam, [[ax - 0.85, 0.3, 21.95], [ax + 0.85, 0.3, 21.95],
                        [ax + 0.85, 2.1, 21.95], [ax - 0.85, 2.1, 21.95]], { fill: i === 1 ? '#ffe6b8' : '#7fd6de' });
                    const gp = project(cam, ax, 1.2, 21.94);
                    if (gp) glow(ctx, gp.x, gp.y, Math.max(10, gp.s * 1.6), i === 1 ? '#ffdca0' : '#8fe3e8', 0.45);
                    poly3(ctx, cam, [[ax - 1.35, 0.1, 21.97], [ax + 1.35, 0.1, 21.97],
                        [ax + 1.35, 0.3, 21.97], [ax - 1.35, 0.3, 21.97]], { fill: '#7fbfc6' });
                });
                // cornice + painted band
                poly3(ctx, cam, [[-14, 7.1, 21.96], [14, 7.1, 21.96], [14, 7.5, 21.96], [-14, 7.5, 21.96]],
                    { fill: 'rgba(120,90,135,.55)' });
                poly3(ctx, cam, [[-14, 4.6, 21.96], [14, 4.6, 21.96], [14, 4.75, 21.96], [-14, 4.75, 21.96]],
                    { fill: 'rgba(90,140,150,.4)' });
                // high windows so the wall never reads as a blank slab
                [-10.4, -7.4, -3.6, 3.6, 7.4, 10.4].forEach((wx, i) => {
                    poly3(ctx, cam, [[wx - 0.95, 7.9, 21.97], [wx + 0.95, 7.9, 21.97],
                        [wx + 0.95, 10.5, 21.97], [wx - 0.95, 10.5, 21.97]], { fill: '#33203c' });
                    poly3(ctx, cam, [[wx - 0.75, 8.1, 21.96], [wx + 0.75, 8.1, 21.96],
                        [wx + 0.75, 10.25, 21.96], [wx - 0.75, 10.25, 21.96]],
                        { fill: i % 2 ? 'rgba(255,224,186,.55)' : 'rgba(150,224,224,.45)' });
                    const wp = project(cam, wx, 9.2, 21.95);
                    if (wp) glow(ctx, wp.x, wp.y, Math.max(6, wp.s * 1.1), '#ffdca8', 0.2);
                });
                // painted arch motif between the windows
                const ap = project(cam, 0, 8.8, 21.96);
                if (ap) {
                    ctx.save();
                    ctx.strokeStyle = 'rgba(140,110,160,.5)';
                    ctx.lineWidth = Math.max(2, ap.s * 0.055);
                    ctx.beginPath();
                    ctx.arc(ap.x, ap.y, ap.s * 1.9, Math.PI, 0);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        });

        // mid-distance pastel volumes framing the stairwell
        list.push({ x: -13.0, y: 0, z: 12.0, w: 3.4, h: 6.2, d: 4.8, color: '#9fd3d9' });
        list.push({ x: -9.6, y: 0, z: 15.4, w: 3.0, h: 3.2, d: 3.2, color: '#efe29a' });
        list.push({ x: -8.2, y: 0, z: 19.0, w: 2.6, h: 8.6, d: 2.4, color: '#e8aecb' });
        list.push({ x: 9.8, y: 0, z: 18.6, w: 3.2, h: 9.2, d: 2.8, color: '#b8d59a' });
        list.push({ x: 4.2, y: 0, z: 10.4, w: 4.4, h: 5.4, d: 4.0, color: '#cbb8dd' });
        list.push({ x: 6.4, y: 0, z: 6.2, w: 3.2, h: 7.4, d: 3.4, color: '#efe29a' });
        list.push({ x: -6.2, y: 0, z: 5.4, w: 3.0, h: 6.4, d: 3.0, color: '#e8aecb' });

        // left pink tower + aqua doorway block
        list.push({
            x: -10.5, y: 0, z: 5.2, w: 4.6, h: 8.6, d: 7.2, color: '#e2a3c2',
            decor: function (ctx, cam) {
                const px = -10.5 + 4.6 - 0.01;
                poly3(ctx, cam, [[px, 0, 8.1], [px, 0, 10.1], [px, 3.1, 10.1], [px, 3.1, 8.1]], { fill: '#3f9aa4' });
                poly3(ctx, cam, [[px, 3.05, 8.05], [px, 3.05, 10.15], [px, 4.2, 8.6], [px, 4.2, 9.6]], { fill: 'rgba(30,60,70,.85)' });
                const sp = project(cam, px, 3.4, 9.1);
                if (sp) glow(ctx, sp.x, sp.y, Math.max(6, sp.s * 0.8), '#ffe9a8', 0.45);
            }
        });
        list.push({ x: -9.4, y: 0, z: 13.0, w: 3.2, h: 2.6, d: 3.4, color: '#efe29a' });

        // right mint tower + yellow block
        list.push({
            x: 5.2, y: 0, z: 4.6, w: 4.6, h: 7.8, d: 6.4, color: '#b8d59a',
            decor: function (ctx, cam) {
                const px = 5.2 - 0.01;
                poly3(ctx, cam, [[px, 0, 7.0], [px, 0, 9.1], [px, 2.9, 9.1], [px, 2.9, 7.0]], { fill: '#3f8d93' });
                poly3(ctx, cam, [[px, 2.85, 6.95], [px, 2.85, 9.15], [px, 3.9, 7.4], [px, 3.9, 8.7]], { fill: 'rgba(28,58,66,.85)' });
            }
        });
        list.push({ x: 2.6, y: 0, z: 17.4, w: 6.4, h: 6.2, d: 4.6, color: '#cdb7dd' });

        // mezzanine balcony across the back
        list.push({ x: -10.6, y: 5.4, z: 20.4, w: 21.2, h: 0.42, d: 1.5, color: '#b9a3c9', top: '#d6c4e2' });
        addCrenellations(list, -10.6, 5.82, 20.45, 10.6, 20.45, 0.5, '#9fd3d9', 18);

        // mid pink platform
        list.push({
            x: -7.4, y: 0, z: 15.2, w: 4.4, h: 3.4, d: 3.8, color: '#e8aecb',
            decor: function (ctx, cam) {
                poly3(ctx, cam, [[-6.6, 0, 15.19], [-4.2, 0, 15.19], [-4.2, 2.5, 15.19], [-6.6, 2.5, 15.19]], { fill: '#3f9aa4' });
                poly3(ctx, cam, [[-6.4, 0.1, 15.18], [-4.4, 0.1, 15.18], [-4.4, 2.1, 15.18], [-6.4, 2.1, 15.18]], { fill: 'rgba(30,50,58,.9)' });
                const dp = project(cam, -5.4, 1.1, 15.17);
                if (dp) glow(ctx, dp.x, dp.y, Math.max(8, dp.s * 1.2), '#8fe3e8', 0.25);
            }
        });

        // --- central switchback stairs ------------------------------
        // flight 1 (rises away from camera, slightly right)
        const f1 = { x: 0.1, z0: 8.4, z1: 12.2, y0: 0, y1: 2.55, width: 3.6, steps: 9 };
        for (let i = 0; i < f1.steps; i++) {
            const p0 = i / f1.steps;
            const p1 = (i + 1) / f1.steps;
            const zA = lerp(f1.z0, f1.z1, p0);
            const zB = lerp(f1.z0, f1.z1, p1);
            const ya = lerp(f1.y0, f1.y1, p0);
            const yb = lerp(f1.y0, f1.y1, p1);
            list.push({
                x: f1.x, y: 0, z: zA, w: f1.width, h: yb, d: (zB - zA) + 0.02,
                color: i % 2 ? '#c9a9c0' : '#bda0b8',
                top: i % 2 ? '#7fb6c6' : '#6ea8b8'
            });
        }
        // landing 1 with crenellated front edge
        list.push({ x: 0.1, y: 2.55, z: 12.2, w: 4.6, h: 0.38, d: 2.9, color: '#bfa4c4', top: '#d9c5de' });
        addCrenellations(list, 0.1, 2.93, 12.25, 4.7, 12.25, 0.52, '#9fd3d9', 8);
        // support column
        list.push({ x: 1.3, y: 0, z: 12.5, w: 1.9, h: 2.55, d: 1.6, color: '#a98fb4' });

        // flight 2 (left, toward the viewer)
        const f2 = { x: -6.4, z0: 12.4, z1: 9.0, y0: 0, y1: 2.3, width: 2.9, steps: 8 };
        for (let i = 0; i < f2.steps; i++) {
            const p0 = i / f2.steps;
            const p1 = (i + 1) / f2.steps;
            const zA = lerp(f2.z0, f2.z1, p0);
            const zB = lerp(f2.z0, f2.z1, p1);
            const ya = lerp(f2.y0, f2.y1, p0);
            const yb = lerp(f2.y0, f2.y1, p1);
            list.push({
                x: f2.x, y: 0, z: zB, w: f2.width, h: yb, d: (zA - zB) + 0.02,
                color: '#c7a2b6', top: i % 2 ? '#79b0c0' : '#68a1b2'
            });
        }

        // flight 3 (right, up and away from the foreground)
        const f3 = { x: 2.9, z0: 13.2, z1: 16.6, y0: 0, y1: 3.1, width: 3.1, steps: 9 };
        for (let i = 0; i < f3.steps; i++) {
            const p0 = i / f3.steps;
            const p1 = (i + 1) / f3.steps;
            const zA = lerp(f3.z0, f3.z1, p0);
            const zB = lerp(f3.z0, f3.z1, p1);
            const ya = lerp(f3.y0, f3.y1, p0);
            const yb = lerp(f3.y0, f3.y1, p1);
            list.push({
                x: f3.x, y: 0, z: zA, w: f3.width, h: yb, d: (zB - zA) + 0.02,
                color: '#b8c79a', top: i % 2 ? '#7cb4c2' : '#6ba7b6'
            });
        }
        // landing 2
        list.push({ x: 2.6, y: 3.1, z: 16.6, w: 4.4, h: 0.4, d: 2.7, color: '#c9bb96', top: '#e3dbb0' });
        addCrenellations(list, 2.6, 3.5, 16.65, 7.0, 16.65, 0.5, '#e8aecb', 8);

        // far landing where the camera will hold
        list.push({ x: -3.2, y: 4.4, z: 19.2, w: 7.4, h: 0.5, d: 2.6, color: '#b9a3c9', top: '#d6c4e2' });

        // extra mid-level crossings so the set reads as a stacked pastel maze
        list.push({ x: -8.8, y: 3.7, z: 14.0, w: 7.2, h: 0.36, d: 1.2, color: '#9fd3d9', top: '#c5ebe8' });
        addCrenellations(list, -8.8, 4.06, 14.05, -1.6, 14.05, 0.48, '#7fb6c6', 8);
        list.push({ x: 3.4, y: 4.0, z: 13.4, w: 5.6, h: 0.36, d: 1.15, color: '#efe29a', top: '#f6ebad' });
        addCrenellations(list, 3.4, 4.36, 13.45, 9.0, 13.45, 0.48, '#d3a958', 7);
        list.push({ x: -1.8, y: 5.2, z: 16.8, w: 5.0, h: 0.34, d: 1.05, color: '#e8aecb', top: '#f3cfe0' });

        // --- foreground flight (sells the camera climb) --------------
        for (let i = 0; i < 5; i++) {
            const z = -4.8 + i * 0.62;
            const y = 0.2 * i;
            list.push({
                x: -2.8, y: 0, z: z, w: 5.6, h: y + 0.22, d: 0.64,
                color: i % 2 ? '#a98fb4' : '#9d84a9',
                top: i % 2 ? '#7fb6c6' : '#72a9ba'
            });
        }
        // foreground crenellated rail (bottom-right depth cue)
        list.push({ x: 2.4, y: 0.2, z: 0.4, w: 5.4, h: 1.9, d: 0.9, color: '#d3a958', top: '#e6c579' });
        addCrenellations(list, 2.4, 2.1, 0.45, 7.8, 0.45, 0.62, '#d3a958', 7);

        // --- doorway at the top of the stairs ------------------------
        list.push({
            x: -1.7, y: 4.9, z: 21.9, w: 3.4, h: 4.2, d: 0.3, color: '#7c5f86',
            decor: function (ctx, cam) {
                poly3(ctx, cam, [[-1.1, 4.9, 21.84], [1.1, 4.9, 21.84], [1.1, 6.4, 21.84], [-1.1, 6.4, 21.84]],
                    { fill: '#ffe6bd' });
                poly3(ctx, cam, [[-1.25, 4.9, 21.83], [-1.1, 4.9, 21.83], [-1.1, 7.0, 21.83], [-1.25, 7.0, 21.83]],
                    { fill: '#3f8d93' });
                poly3(ctx, cam, [[1.1, 4.9, 21.83], [1.25, 4.9, 21.83], [1.25, 7.0, 21.83], [1.1, 7.0, 21.83]],
                    { fill: '#3f8d93' });
                poly3(ctx, cam, [[-1.25, 6.95, 21.83], [1.25, 6.95, 21.83], [1.25, 7.1, 21.83], [-1.25, 7.1, 21.83]],
                    { fill: '#3f8d93' });
                const dp = project(cam, 0, 5.6, 21.8);
                if (dp) glow(ctx, dp.x, dp.y, Math.max(14, dp.s * 2.4), '#ffe6bd', 0.5);
            }
        });

        // --- wall sconces --------------------------------------------
        const sconceSpots = [
            [-2.6, 6.4, 5.24], [0.6, 7.0, 5.24], [-9.5, 5.6, 12.34], [-5.2, 4.4, 16.6],
            [4.2, 6.0, 11.3], [8.6, 5.0, 15.0], [-3.0, 7.2, 21.9]
        ];
        sconceSpots.forEach((p, i) => {
            list.push({
                x: p[0] - 0.14, y: p[1], z: p[2] - 0.02, w: 0.28, h: 0.34, d: 0.12, color: '#f0dfb0',
                decor: function (ctx, cam) {
                    const sp = project(cam, p[0], p[1] + 0.17, p[2] + 0.1);
                    if (sp) glow(ctx, sp.x, sp.y, Math.max(8, sp.s * (0.8 + (i % 3) * 0.12)), '#ffdca0', 0.55);
                }
            });
        });

        // --- painted wear / rust accents (subtle, not gory) -----------
        const stains = [
            { x: 0.6, y: 2.94, z: 12.4, r: 0.5 }, { x: 3.6, y: 2.94, z: 13.2, r: 0.42 },
            { x: -0.2, y: 3.51, z: 16.8, r: 0.55 }, { x: -6.0, y: 2.31, z: 10.4, r: 0.34 },
            { x: 1.2, y: 3.2, z: 14.4, r: 0.28 }
        ];
        stains.forEach((st, i) => {
            list.push({
                x: st.x, y: st.y, z: st.z, w: 0.001, h: 0.001, d: 0.001, color: '#d8c0c8', decor: function (ctx, cam) {
                    const sp = project(cam, st.x, st.y, st.z);
                    if (!sp) return;
                    ctx.save();
                    ctx.globalAlpha = 0.18;
                    ctx.fillStyle = '#8d2f2a';
                    for (let k = 0; k < 3; k++) {
                        ell(ctx, sp.x + Math.cos(i + k) * sp.s * st.r * 0.5,
                            sp.y + Math.sin(i * 2 + k) * sp.s * st.r * 0.14,
                            sp.s * st.r * (0.55 - k * 0.12), sp.s * st.r * 0.10);
                    }
                    ctx.restore();
                }
            });
        });

        return list;
    }

    let STAIR_SET = null;
    function stairSet() {
        if (!STAIR_SET) STAIR_SET = buildStairSet();
        return STAIR_SET;
    }

    const STAIR_PATH = [
        { eye: [-1.4, 2.2, -8.4], target: [0.4, 3.0, 7.2] },
        { eye: [-3.4, 4.2, -6.2], target: [1.1, 3.1, 9.2] },
        { eye: [-4.4, 6.6, -4.4], target: [1.0, 2.7, 11.6] },
        { eye: [-4.0, 7.8, -3.0], target: [0.9, 2.3, 12.6] }
    ];

    function stairCam(L, t) {
        const u = clamp(t / 8400, 0, 1);
        const seg = Math.min(STAIR_PATH.length - 1.001, u * (STAIR_PATH.length - 1));
        const i = Math.floor(seg);
        const f = smoothstep(seg - i);
        const a = STAIR_PATH[i];
        const b = STAIR_PATH[Math.min(STAIR_PATH.length - 1, i + 1)];
        const eye = [lerp(a.eye[0], b.eye[0], f), lerp(a.eye[1], b.eye[1], f), lerp(a.eye[2], b.eye[2], f)];
        const target = [lerp(a.target[0], b.target[0], f), lerp(a.target[1], b.target[1], f), lerp(a.target[2], b.target[2], f)];
        return makeCam(L, { eye: eye, target: target, fov: L.landscape ? 62 : 66 });
    }

    const STAFF = (function () {
        const list = [];
        const walks = [
            { a: [-4.6, 0.0, 9.6], b: [-4.6, 2.3, 12.6], n: 4 },
            { a: [0.9, 0.0, 8.6], b: [2.6, 2.55, 12.0], n: 4 },
            { a: [4.2, 0.0, 13.4], b: [6.4, 3.1, 16.4], n: 3 },
            { a: [-8.4, 0.0, 13.6], b: [-8.4, 2.6, 16.4], n: 3 },
            { a: [-6.2, 2.3, 9.4], b: [-3.0, 3.1, 12.2], n: 3 },
            { a: [3.0, 3.5, 16.8], b: [6.2, 3.5, 17.4], n: 2 },
            { a: [-3.0, 4.4, 19.6], b: [2.0, 4.4, 19.6], n: 3 },
            { a: [-9.4, 5.82, 20.7], b: [9.4, 5.82, 20.7], n: 6 },
            { a: [-8.2, 3.4, 12.2], b: [-8.2, 6.1, 15.6], n: 3 },
            { a: [6.2, 0.0, 6.4], b: [6.2, 2.6, 10.0], n: 3 },
            { a: [1.0, 3.51, 16.8], b: [4.8, 3.51, 17.2], n: 2 }
        ];
        walks.forEach((w, wi) => {
            for (let i = 0; i < w.n; i++) {
                list.push({
                    a: w.a,
                    b: w.b,
                    phase: (i + 0.35 * wi) / w.n,
                    speed: 0.016 + hash01('staffSpeed' + wi + ':' + i) * 0.014,
                    dir: wi % 2 ? 1 : -1,
                    seed: wi * 7 + i,
                    scale: 0.92 + hash01('staffScale' + wi + ':' + i) * 0.16
                });
            }
        });
        return list;
    })();

    function drawStairStaff(ctx, cam, t) {
        // far staff first
        const drawn = STAFF.map(st => {
            const u = (st.phase + st.speed * (t / 1000) * st.dir) % 1;
            const uu = u < 0 ? u + 1 : u;
            const x = lerp(st.a[0], st.b[0], uu);
            const y = lerp(st.a[1], st.b[1], uu);
            const z = lerp(st.a[2], st.b[2], uu);
            return { st: st, x: x, y: y, z: z, depth: z };
        }).sort((p, q) => p.depth - q.depth);
        drawn.forEach(d => {
            drawGuard(ctx, cam, d.x, d.y + 0.02, d.z, t, d.st.seed, { walk: true, scale: d.st.scale });
        });
    }

    function drawStairsStatic(ctx, L, cam, t) {
        const items = stairSet();
        const order = items.map(it => {
            const cx = it.x + it.w * 0.5;
            const cy = it.y + it.h * 0.5;
            const cz = it.z + it.d * 0.5;
            const dx = cx - cam.eye[0];
            const dy = cy - cam.eye[1];
            const dz = cz - cam.eye[2];
            return { it: it, d: dx * dx + dy * dy + dz * dz };
        }).sort((a, b) => b.d - a.d);

        ctx.fillStyle = '#2a1830';
        ctx.fillRect(0, 0, L.w, L.h);

        // atmospheric back glow behind the set
        const bg = ctx.createLinearGradient(0, 0, 0, L.h);
        bg.addColorStop(0, '#7b4f78');
        bg.addColorStop(0.5, '#9c6a8c');
        bg.addColorStop(1, '#4a2e46');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, L.w, L.h);

        // mauve floor so the stairwell never floats over a void
        const zNear = cam.eye[2] + 0.9;
        const floorG = ctx.createLinearGradient(0, L.h, 0, L.h * 0.52);
        floorG.addColorStop(0, '#4a3345');
        floorG.addColorStop(0.6, '#5c4058');
        floorG.addColorStop(1, '#6d4c66');
        poly3(ctx, cam, [[-8, 0, zNear], [8, 0, zNear], [16, 0, 22], [-16, 0, 22]], { fill: floorG });
        // subtle floor light pools under the sconces
        [[-3.0, 6.0], [1.2, 10.5], [-6.4, 14.0]].forEach(pool => {
            const pp = project(cam, pool[0], 0.006, pool[1]);
            if (!pp) return;
            glow(ctx, pp.x, pp.y, Math.max(14, pp.s * 1.8), '#ffd6a8', 0.10);
        });

        order.forEach(entry => {
            box3(ctx, cam, entry.it);
        });

        // warm haze from the sconces
        const haze = ctx.createRadialGradient(L.w * 0.55, L.h * 0.45, L.w * 0.05, L.w * 0.55, L.h * 0.5, L.w * 1.0);
        haze.addColorStop(0, 'rgba(255,205,220,.12)');
        haze.addColorStop(1, 'rgba(30,12,32,.4)');
        ctx.fillStyle = haze;
        ctx.fillRect(0, 0, L.w, L.h);
    }

    function drawStairs(ctx, L, t, allowCache, role) {
        const cam = stairCam(L, t);
        // The camera is still during the held landing beat, so the set can be
        // cached there. While the camera climbs we paint live.
        if (allowCache && t > 8400) {
            drawCached(ctx, L, 'stairs:' + (role || 'player'), c => drawStairsStatic(c, L, cam, 0));
        } else {
            drawStairsStatic(ctx, L, cam, t);
        }
        drawStairStaff(ctx, cam, t);
        // cinematic top and bottom falloff
        const top = ctx.createLinearGradient(0, 0, 0, L.h * 0.35);
        top.addColorStop(0, 'rgba(20,8,22,.36)');
        top.addColorStop(1, 'rgba(20,8,22,0)');
        ctx.fillStyle = top;
        ctx.fillRect(0, 0, L.w, L.h * 0.35);
        const bot = ctx.createLinearGradient(0, L.h * 0.72, 0, L.h);
        bot.addColorStop(0, 'rgba(14,6,16,0)');
        bot.addColorStop(1, 'rgba(14,6,16,.55)');
        ctx.fillStyle = bot;
        ctx.fillRect(0, L.h * 0.72, L.w, L.h * 0.28);
    }

    /* ================================================================== */
    /* Intro dispatcher                                                   */
    /* ================================================================== */

    R.INTRO = {
        hallMs: 6000,
        stairsStartMs: 6000,
        stairsMs: 8400,
        holdMs: 14400
    };

    R.drawIntro = function (ctx, state) {
        const s = state || {};
        const L = R.layout(s.w, s.h, s.role);
        const t = Math.max(0, Number(s.introElapsed) || 0);

        if (t < R.INTRO.stairsStartMs) {
            drawHall(ctx, L, t);
        } else {
            drawStairs(ctx, L, t - R.INTRO.stairsStartMs, true, s.role);
        }

        // dip-to-black crossfade between the hallway and the stairwell
        const fadeStart = R.INTRO.stairsStartMs - 520;
        const fadeEnd = R.INTRO.stairsStartMs + 620;
        if (t > fadeStart && t < fadeEnd) {
            const k = 1 - Math.abs((t - (fadeStart + fadeEnd) / 2) / ((fadeEnd - fadeStart) / 2));
            ctx.fillStyle = 'rgba(4,4,8,' + clamp(k, 0, 1).toFixed(3) + ')';
            ctx.fillRect(0, 0, L.w, L.h);
        }

        // title card, very brief and non-blocking
        if (t < 5200) {
            const a = clamp(Math.min(t / 900, (5200 - t) / 1200), 0, 1);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            setFont(ctx, Math.max(15, Math.min(L.w * 0.05, 30)), 800);
            ctx.fillStyle = 'rgba(240,255,246,.92)';
            ctx.shadowColor = 'rgba(0,0,0,.6)';
            ctx.shadowBlur = 12;
            ctx.fillText('PURRFECT SURVIVAL', L.w * 0.5, L.h * 0.62);
            setFont(ctx, Math.max(10, Math.min(L.w * 0.026, 15)), 700);
            ctx.fillStyle = 'rgba(214,236,225,.8)';
            ctx.fillText('FOLLOW THE STAFF · 跟住工作人員行', L.w * 0.5, L.h * 0.62 + 28);
            ctx.restore();
        }
    };

    /* ================================================================== */
    /* Round 1 · sandy indoor playground                                  */
    /* ================================================================== */

    const PG = {
        wallZ: 11.5,
        wallHalf: 16,
        wallTop: 12,
        panelY0: 0.16,
        panelY1: 3.85,
        fenceZ: 10.75,
        guardZ: 10.42,
        dollZ: 10.15,
        startZ: 5.0,
        finishZ: 9.8
    };

    function r1Z(metres, L) {
        const start = L && L.round1StartZ != null ? L.round1StartZ : PG.startZ;
        const finish = L && L.round1FinishZ != null ? L.round1FinishZ : PG.finishZ;
        return lerp(start, finish, clamp(metres / 100, 0, 1));
    }

    /* The phone shows a tighter, more cinematic crop of the same room; the
       teacher's landscape board opens the set out so the whole class fits. */
    function pgLayout(L) {
        const wide = !!L.landscape;
        return {
            wide: wide,
            panels: wide ? [-7.2, -2.4, 2.4, 7.2] : [-3.15, -1.05, 1.05, 3.15],
            panelHalf: wide ? 1.55 : 0.86,
            shapeR: wide ? 0.72 : 0.54,
            guards: wide ? [-9.0, -4.4, 4.4, 9.0] : [-3.25, -1.55, 1.55, 3.25],
            fenceHalf: wide ? 10.4 : 4.6,
            frame: wide ? { x: -6.9, z: 8.2, r: 1.9, y: 2.9 } : { x: -4.15, z: 6.5, r: 1.28, y: 2.0 },
            slide: wide ? { x: 6.6, z: 8.2, s: 0.85, dir: -1 } : { x: 2.55, z: 6.5, s: 0.62, dir: 1 }
        };
    }

    function cloudPuff(ctx, cam, x, y, r) {
        const p = project(cam, x, y, PG.wallZ - 0.03);
        if (!p) return;
        ctx.fillStyle = 'rgba(150,190,228,.42)';
        const rp = r * p.s;
        ell(ctx, p.x, p.y, rp, rp * 0.78);
        ell(ctx, p.x - rp * 0.9, p.y + rp * 0.16, rp * 0.62, rp * 0.5);
        ell(ctx, p.x + rp * 0.85, p.y + rp * 0.2, rp * 0.7, rp * 0.55);
        ell(ctx, p.x - rp * 0.2, p.y - rp * 0.42, rp * 0.62, rp * 0.5);
        ell(ctx, p.x + rp * 0.4, p.y - rp * 0.32, rp * 0.5, rp * 0.44);
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ell(ctx, p.x - rp * 0.15, p.y - rp * 0.2, rp * 0.62, rp * 0.38);
    }

    function dalgonaShape(ctx, cam, kind, cx, cy, r, color) {
        const p = project(cam, cx, cy, PG.wallZ - 0.05);
        if (!p) return;
        const R2 = r * p.s;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(4, R2 * 0.30);
        ctx.shadowColor = rgba(color, 0.28);
        ctx.shadowBlur = 10;
        if (kind === 'circle') {
            ctx.beginPath();
            ctx.arc(p.x, p.y, R2 * 0.72, 0, Math.PI * 2);
            ctx.stroke();
        } else if (kind === 'triangle') {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - R2);
            ctx.lineTo(p.x + R2 * 0.9, p.y + R2 * 0.7);
            ctx.lineTo(p.x - R2 * 0.9, p.y + R2 * 0.7);
            ctx.closePath();
            ctx.stroke();
        } else if (kind === 'star') {
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const ang = -Math.PI / 2 + i * Math.PI / 5;
                const rad = i % 2 ? R2 * 0.46 : R2;
                const x = p.x + Math.cos(ang) * rad;
                const y = p.y + Math.sin(ang) * rad;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
        } else {
            // umbrella: canopy arc + handle
            ctx.beginPath();
            ctx.arc(p.x, p.y + R2 * 0.18, R2 * 0.86, Math.PI, 0);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(p.x, p.y + R2 * 0.18);
            ctx.lineTo(p.x, p.y + R2 * 0.78);
            ctx.quadraticCurveTo(p.x, p.y + R2 * 1.02, p.x - R2 * 0.34, p.y + R2 * 0.96);
            ctx.stroke();
            for (let i = -1; i <= 1; i++) {
                ctx.beginPath();
                ctx.moveTo(p.x, p.y + R2 * 0.2);
                ctx.lineTo(p.x + i * R2 * 0.58, p.y - R2 * 0.22);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    function drawFence(ctx, cam, half) {
        const z = PG.fenceZ;
        // rails
        poly3(ctx, cam, [[-half, 0.42, z], [half, 0.42, z], [half, 0.56, z], [-half, 0.56, z]], { fill: '#2f7d4f' });
        poly3(ctx, cam, [[-half, 0.72, z], [half, 0.72, z], [half, 0.84, z], [-half, 0.84, z]], { fill: '#f3d9a8' });
        const colors = ['#2f7d4f', '#b13c3c', '#d9a72e', '#2f6fae'];
        const count = Math.max(16, Math.round(half * 4));
        for (let i = 0; i < count; i++) {
            const x = -half + (half * 2 * i) / (count - 1);
            const col = colors[i % colors.length];
            const p0 = project(cam, x, 0, z + 0.04);
            const p1 = project(cam, x, 0.95, z + 0.04);
            if (!p0 || !p1) continue;
            const wpx = Math.max(2, p0.s * 0.16);
            const top = p1.y;
            ctx.fillStyle = col;
            rr(ctx, p0.x - wpx / 2, top, wpx, p0.y - top, wpx / 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.18)';
            ctx.fillRect(p0.x - wpx * 0.16, top + 1, wpx * 0.18, Math.max(0, p0.y - top - 2));
        }
        // post shadows
        poly3(ctx, cam, [[-half - 0.4, 0.005, z - 0.06], [half + 0.4, 0.005, z - 0.06],
            [half + 0.4, 0.005, z + 0.16], [-half - 0.4, 0.005, z + 0.16]],
            { fill: 'rgba(90,60,30,.10)' });
    }

    function drawClimbingFrame(ctx, cam, spec) {
        const p = project(cam, spec.x, spec.y, spec.z);
        if (!p) return;
        const R2 = p.s * spec.r;
        const ground = project(cam, spec.x, 0, spec.z);
        ctx.save();
        ctx.lineCap = 'round';
        const segs = [
            { a: -Math.PI * 0.95, b: -Math.PI * 0.25, c: '#2f7d4f' },
            { a: -Math.PI * 0.25, b: Math.PI * 0.45, c: '#b13c3c' },
            { a: Math.PI * 0.45, b: Math.PI * 0.95, c: '#d9a72e' }
        ];
        segs.forEach(seg => {
            ctx.strokeStyle = seg.c;
            ctx.lineWidth = Math.max(3, R2 * 0.10);
            ctx.beginPath();
            ctx.arc(p.x, p.y, R2, seg.a, seg.b);
            ctx.stroke();
        });
        // inner ring
        ctx.strokeStyle = '#2f7d4f';
        ctx.lineWidth = Math.max(2, R2 * 0.055);
        ctx.beginPath();
        ctx.arc(p.x, p.y, R2 * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        // spokes + legs
        for (let i = 0; i < 6; i++) {
            const ang = i * Math.PI / 3;
            ctx.beginPath();
            ctx.moveTo(p.x + Math.cos(ang) * R2 * 0.55, p.y + Math.sin(ang) * R2 * 0.55);
            ctx.lineTo(p.x + Math.cos(ang) * R2, p.y + Math.sin(ang) * R2);
            ctx.strokeStyle = i % 2 ? '#b13c3c' : '#d9a72e';
            ctx.lineWidth = Math.max(2, R2 * 0.05);
            ctx.stroke();
        }
        // support legs down to the sand
        if (ground) {
            ctx.strokeStyle = '#2f7d4f';
            ctx.lineWidth = Math.max(3, R2 * 0.07);
            [-0.72, 0.72].forEach(k => {
                ctx.beginPath();
                ctx.moveTo(p.x + k * R2, p.y + R2 * 0.62);
                ctx.lineTo(ground.x + k * R2 * 1.1, ground.y);
                ctx.stroke();
            });
        }
        ctx.restore();
    }

    function drawSlide(ctx, cam, spec) {
        const px = spec.x;
        const pz = spec.z;
        const u = spec.s;
        // platform
        poly3(ctx, cam, [[px - 1.2 * u, 1.55, pz - 1.0 * u], [px + 1.2 * u, 1.55, pz - 1.0 * u],
            [px + 1.2 * u, 1.55, pz + 1.0 * u], [px - 1.2 * u, 1.55, pz + 1.0 * u]],
            { fill: '#3f8f57', stroke: 'rgba(20,50,30,.4)', lineWidth: 1 });
        poly3(ctx, cam, [[px - 1.2 * u, 0, pz - 1.0 * u], [px - 1.2 * u, 1.55, pz - 1.0 * u],
            [px - 1.2 * u, 1.55, pz + 1.0 * u], [px - 1.2 * u, 0, pz + 1.0 * u]],
            { fill: '#34784a' });
        // ramp down toward the field
        const ax = px - 1.2 * u;
        const az = pz - 0.9 * u;
        const bx = px + (spec.dir || -1) * 2.2 * u;
        const bz = pz - 1.7 * u;
        poly3(ctx, cam, [[ax, 1.5, az], [ax, 1.5, az + 2.0 * u], [bx, 0.3, bz + 2.0 * u], [bx, 0.3, bz]],
            { fill: '#57a86c', stroke: 'rgba(20,50,30,.35)', lineWidth: 1 });
        poly3(ctx, cam, [[ax, 1.5, az], [bx, 0.3, bz], [bx, 0.0, bz], [ax, 1.05, az]], { fill: '#2f6f43' });
        poly3(ctx, cam, [[ax, 1.5, az + 2.0 * u], [bx, 0.3, bz + 2.0 * u], [bx, 0.0, bz + 2.0 * u], [ax, 1.05, az + 2.0 * u]],
            { fill: '#2f6f43' });
        // rails
        poly3(ctx, cam, [[ax, 1.62, az], [ax, 1.62, az + 2.0 * u], [ax, 1.78, az + 2.0 * u], [ax, 1.78, az]],
            { fill: '#d9a72e' });
        // support steps
        for (let i = 0; i < 4; i++) {
            poly3(ctx, cam, [[px + 0.9 * u, i * 0.38, pz + 1.1 * u + i * 0.34 * u],
                [px + 1.7 * u, i * 0.38, pz + 1.1 * u + i * 0.34 * u],
                [px + 1.7 * u, (i + 1) * 0.38, pz + 1.1 * u + i * 0.34 * u],
                [px + 0.9 * u, (i + 1) * 0.38, pz + 1.1 * u + i * 0.34 * u]],
                { fill: i % 2 ? '#d9a72e' : '#b13c3c' });
        }
    }

    function drawPlaygroundStatic(ctx, L, cam) {
        const w = PG.wallHalf;
        const pg = pgLayout(L);

        // --- sky / ceiling behind the set ---------------------------
        const bg = ctx.createLinearGradient(0, 0, 0, L.h);
        bg.addColorStop(0, '#9fb8cc');
        bg.addColorStop(0.5, '#cfdde9');
        bg.addColorStop(1, '#d8c6a6');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, L.w, L.h);

        // --- sand floor ---------------------------------------------
        const zNear = cam.eye[2] + 0.9;
        const near = project(cam, 0, 0, zNear);
        const far = project(cam, 0, 0, PG.wallZ);
        const sandG = ctx.createLinearGradient(0, near ? near.y : L.h, 0, far ? far.y : L.h * 0.6);
        sandG.addColorStop(0, '#c49a63');
        sandG.addColorStop(0.35, '#d7b47e');
        sandG.addColorStop(0.8, '#e3c591');
        sandG.addColorStop(1, '#dcc08c');
        poly3(ctx, cam, [[-6, 0, zNear], [6, 0, zNear], [w, 0, PG.wallZ], [-w, 0, PG.wallZ]], { fill: sandG });

        // raked sand detail + soft patches (deterministic)
        for (let i = 0; i < 26; i++) {
            const sx = (hash01('sandX' + i) - 0.5) * 22;
            const sz = 0.5 + hash01('sandZ' + i) * 10.6;
            const sp = project(cam, sx, 0.006, sz);
            if (!sp) continue;
            ctx.fillStyle = i % 3 === 0 ? 'rgba(150,110,66,.07)' : 'rgba(250,228,180,.10)';
            ell(ctx, sp.x, sp.y, sp.s * (0.5 + hash01('sandR' + i) * 1.4), sp.s * 0.10);
        }

        // --- back wall + painted sky mural --------------------------
        const wallG = ctx.createLinearGradient(0, L.h * 0.05, 0, L.h * 0.65);
        wallG.addColorStop(0, '#dbeaf6');
        wallG.addColorStop(0.55, '#e7f1f8');
        wallG.addColorStop(1, '#f2f6f7');
        poly3(ctx, cam, [[-w, 0, PG.wallZ], [w, 0, PG.wallZ], [w, PG.wallTop, PG.wallZ], [-w, PG.wallTop, PG.wallZ]],
            { fill: wallG });
        // wall base shadow
        poly3(ctx, cam, [[-w, 0, PG.wallZ], [w, 0, PG.wallZ], [w, 0.22, PG.wallZ], [-w, 0.22, PG.wallZ]],
            { fill: 'rgba(120,140,160,.22)' });

        // painted clouds
        const clouds = [
            [-9.6, 9.2, 1.15], [-4.2, 10.4, 1.5], [1.6, 8.8, 1.05], [6.4, 10.2, 1.35],
            [11.2, 8.4, 1.0], [-12.4, 6.6, 0.95], [-6.6, 5.9, 0.8], [3.6, 5.4, 0.9],
            [9.0, 6.4, 1.05], [13.2, 5.6, 0.8], [-1.4, 6.9, 0.72], [-10.2, 4.6, 0.7],
            [5.6, 7.6, 0.75], [12.0, 9.6, 0.85], [0.6, 5.1, 0.62], [-3.4, 7.8, 0.7]
        ];
        clouds.forEach(c => cloudPuff(ctx, cam, c[0], c[1], c[2]));

        // wainscot / door panels with dalgona shapes
        const panels = [
            { x: pg.panels[0], kind: 'circle', color: '#2f7d4f' },
            { x: pg.panels[1], kind: 'triangle', color: '#b13c3c' },
            { x: pg.panels[2], kind: 'star', color: '#d9a72e' },
            { x: pg.panels[3], kind: 'umbrella', color: '#2f6fae' }
        ];
        panels.forEach(panel => {
            const x0 = panel.x - pg.panelHalf;
            const x1 = panel.x + pg.panelHalf;
            const topP = project(cam, panel.x, PG.panelY1, PG.wallZ);
            const botP = project(cam, panel.x, PG.panelY0, PG.wallZ);
            let panelFill = '#f7fafb';
            if (topP && botP) {
                const g = ctx.createLinearGradient(0, topP.y, 0, botP.y);
                g.addColorStop(0, '#fbfdfe');
                g.addColorStop(0.7, '#f1f6f9');
                g.addColorStop(1, '#e5edf2');
                panelFill = g;
            }
            poly3(ctx, cam, [[x0, PG.panelY0, PG.wallZ - 0.02], [x1, PG.panelY0, PG.wallZ - 0.02],
                [x1, PG.panelY1, PG.wallZ - 0.02], [x0, PG.panelY1, PG.wallZ - 0.02]],
                { fill: panelFill, stroke: 'rgba(150,170,185,.55)', lineWidth: 1.2 });
            // panel seam
            line3(ctx, cam, [panel.x, PG.panelY0 + 0.05, PG.wallZ - 0.03], [panel.x, PG.panelY1 - 0.05, PG.wallZ - 0.03],
                { stroke: 'rgba(160,178,192,.45)', lineWidth: 1 });
            // soft shadow at the base
            poly3(ctx, cam, [[x0, 0.02, PG.wallZ - 0.04], [x1, 0.02, PG.wallZ - 0.04],
                [x1, 0.16, PG.wallZ - 0.04], [x0, 0.16, PG.wallZ - 0.04]],
                { fill: 'rgba(110,130,150,.16)' });
            dalgonaShape(ctx, cam, panel.kind, panel.x, 2.0, pg.shapeR, panel.color);
        });

        // distant playground silhouettes on the left wall of the set
        poly3(ctx, cam, [[-w, 0, 7.4], [-w + 0.2, 0, 7.4], [-w + 0.2, 2.4, 7.4], [-w, 2.4, 7.4]],
            { fill: 'rgba(120,150,170,.18)' });

        drawFence(ctx, cam, pg.fenceHalf);
        drawClimbingFrame(ctx, cam, pg.frame);
        drawSlide(ctx, cam, pg.slide);

        // distance markers + finish line on the sand
        for (let m = 0; m <= 100; m += 20) {
            const z = r1Z(m, L);
            line3(ctx, cam, [-5.4, 0.012, z], [5.4, 0.012, z],
                { stroke: m === 0 ? 'rgba(255,255,255,.55)' : 'rgba(120,88,44,.28)', lineWidth: m === 0 ? 2 : 1, dash: m === 0 ? null : [6, 8] });
            if (m % 20 === 0) {
                const lp = project(cam, pg.wide ? -5.9 : -3.2, 0.28, z);
                if (lp) pill(ctx, lp.x, lp.y, m + ' m', { size: Math.max(8, Math.min(12, lp.s * 0.16)) + (L.host ? 1 : 0), align: 'right' });
            }
        }
        // checkered finish strip
        const fz = L && L.round1FinishZ != null ? L.round1FinishZ : PG.finishZ;
        const cols = 14;
        for (let i = 0; i < cols; i++) {
            const x0 = -5.2 + (10.4 * i) / cols;
            const x1 = -5.2 + (10.4 * (i + 1)) / cols;
            poly3(ctx, cam, [[x0, 0.014, fz - 0.18], [x1, 0.014, fz - 0.18], [x1, 0.014, fz + 0.18], [x0, 0.014, fz + 0.18]],
                { fill: i % 2 ? '#f4f6f8' : '#22303c' });
        }

        // gentle indoor vignette + warm bounce from the sand
        const warm = ctx.createLinearGradient(0, L.h * 0.55, 0, L.h);
        warm.addColorStop(0, 'rgba(255,226,178,0)');
        warm.addColorStop(1, 'rgba(255,214,150,.20)');
        ctx.fillStyle = warm;
        ctx.fillRect(0, L.h * 0.55, L.w, L.h * 0.45);

        const vig = ctx.createRadialGradient(L.w * 0.5, L.h * 0.46, L.w * 0.32, L.w * 0.5, L.h * 0.5, L.w * 0.92);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(30,24,14,.35)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, L.w, L.h);
    }

    function drawLight(ctx, L, state, cam) {
        const phase = state.phase || 'green';
        const colors = {
            green: ['#22c55e', 'rgba(34,197,94,.35)'],
            yellow: ['#facc15', 'rgba(250,204,21,.35)'],
            red: ['#ef4444', 'rgba(239,68,68,.4)']
        };
        const x = L.w - Math.max(24, Math.min(L.w, L.h) * 0.052);
        const y = L.hud + Math.max(22, Math.min(L.w, L.h) * 0.05);
        const bulb = Math.max(6, Math.min(L.w, L.h) * 0.021);
        ctx.save();
        // dark readable housing so pale walls never wash it out
        ctx.fillStyle = 'rgba(8,12,24,.74)';
        rr(ctx, x - bulb * 1.35, y - bulb * 1.35, bulb * 2.7, bulb * 6.4, bulb * 1.3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ['red', 'yellow', 'green'].forEach((name, i) => {
            const cy = y + i * bulb * 1.9;
            const isOn = name === phase || (phase === 'done' && name === 'red');
            ctx.fillStyle = isOn ? colors[name][0] : 'rgba(255,255,255,.14)';
            if (isOn) {
                ctx.shadowColor = colors[name][0];
                ctx.shadowBlur = bulb * 1.8;
            } else {
                ctx.shadowBlur = 0;
            }
            ctx.beginPath();
            ctx.arc(x, cy, bulb * 0.66, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.shadowBlur = 0;
        ctx.restore();
        return cam;
    }

    function drawPhaseFlash(ctx, L, state) {
        const phase = state.phase;
        if (phase === 'yellow') {
            const pulse = 0.08 + 0.09 * Math.abs(Math.sin((Number(state.phaseElapsed) || 0) / 140));
            ctx.fillStyle = 'rgba(250,204,21,' + pulse.toFixed(3) + ')';
            ctx.fillRect(0, 0, L.w, L.h);
        } else if (phase === 'red') {
            const grad = ctx.createRadialGradient(L.w / 2, L.h / 2, L.w * 0.12, L.w / 2, L.h / 2, L.w * 0.78);
            grad.addColorStop(0, 'rgba(220,38,38,0)');
            grad.addColorStop(0.7, 'rgba(220,38,38,.12)');
            grad.addColorStop(1, 'rgba(140,18,18,.40)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, L.w, L.h);
        }

        if (state.bang > 0) {
            ctx.save();
            ctx.globalAlpha = clamp(Number(state.bang), 0, 1) * 0.45;
            ctx.fillStyle = '#dc2626';
            ctx.fillRect(0, 0, L.w, L.h);
            ctx.restore();
        }
    }

    R.drawRound1 = function (ctx, state) {
        const s = state || {};
        const L = R.layout(s.w, s.h, s.role);
        const cam = makeCam(L, L.cam1);
        const t = Number(s.now) || 0;
        const phase = s.phase || 'green';

        drawCached(ctx, L, 'playground:' + (s.role || 'player') + ':' +
            (L.round1StartZ != null ? L.round1StartZ : PG.startZ) + '-' +
            (L.round1FinishZ != null ? L.round1FinishZ : PG.finishZ), c => {
            drawPlaygroundStatic(c, L, cam);
        });

        // live guards in front of the mural
        const pg = pgLayout(L);
        pg.guards.forEach((x, i) => {
            drawGuard(ctx, cam, x, 0.02, PG.guardZ, t, 11 + i, { scale: 0.98 });
        });

        // the mechanical cat doll at the finish line
        const dollP = project(cam, 0, 0, L.round1DollZ != null ? L.round1DollZ : PG.dollZ);
        if (dollP) {
            const turnBase = phase === 'red' || phase === 'done' ? 1 : 0;
            let turn = turnBase;
            if (phase === 'yellow') {
                const prog = clamp((Number(s.phaseElapsed) || 0) / Math.max(1, Number(s.phaseDuration) || 2000), 0, 1);
                turn = smoothstep(prog);
            }
            if (s.dollTurn != null) turn = clamp(Number(s.dollTurn), 0, 1);
            const dollScale = dollP.s * 2.75 / 200;
            // plinth
            ctx.save();
            ctx.fillStyle = 'rgba(40,32,20,.18)';
            ell(ctx, dollP.x, dollP.y + dollP.s * 0.01, dollP.s * 0.95, dollP.s * 0.16);
            ctx.restore();
            R.drawDoll(ctx, dollP.x, dollP.y, dollScale, {
                turn: turn,
                red: phase === 'red' || phase === 'done',
                warning: phase === 'yellow'
            });
        }

        drawRound1Players(ctx, L, cam, s);
        drawPhaseFlash(ctx, L, s);
        drawLight(ctx, L, s, cam);

        ctx.save();
        /* Teacher / projector Round 1 text is 1px larger (the student
           camera and typography are unchanged). */
        const titleSize = Math.max(9, Math.min(13, L.w * (L.landscape ? 0.011 : 0.027)));
        pill(ctx, 14, L.hud + 16, '1-2-3 Meow! · RED LIGHT, GREEN LIGHT', {
            size: titleSize + (L.host ? 1 : 0), align: 'left'
        });
        ctx.restore();
    };

    /* Local ranking mirror (the renderer can run without the engine in
       unit tests). Finishers first by finish time, then distance. */
    function round1RaceIds(players, finish) {
        const list = (Array.isArray(players) ? players : []).filter(p => p && p.is_playing !== false);
        const timeOf = (p) => {
            const raw = p.finished_at != null ? p.finished_at : (p.finished_at_ms != null ? p.finished_at_ms : null);
            if (raw == null || raw === '') return Infinity;
            const n = typeof raw === 'number' ? raw : Date.parse(raw);
            return isFinite(n) ? n : Infinity;
        };
        const alive = (p) => p.status !== 'eliminated' && p.status !== 'out' && p.status !== 'advanced' && p.ghost !== true;
        const finished = (p) => p.reached_finish === true || (Number(p.distance) || 0) >= finish;
        const id = (p) => String(p.user_id || p.id || '');
        return list.slice().sort((a, b) => {
            const aa = alive(a) ? 0 : 1;
            const bb = alive(b) ? 0 : 1;
            if (aa !== bb) return aa - bb;
            const fa = finished(a) ? 0 : 1;
            const fb = finished(b) ? 0 : 1;
            if (fa !== fb) return fa - fb;
            if (fa === 0) {
                const ta = timeOf(a);
                const tb = timeOf(b);
                if (ta !== tb) return ta < tb ? -1 : 1;
            }
            const da = Number(a.distance) || 0;
            const db = Number(b.distance) || 0;
            if (da !== db) return db - da;
            return id(a) < id(b) ? -1 : (id(a) > id(b) ? 1 : 0);
        }).map(id);
    }

    function drawRound1Players(ctx, L, cam, state) {
        const players = Array.isArray(state.players) ? state.players : [];
        const finish = Math.max(1, Number(state.finishDistance) || 100);
        const t = Number(state.elapsed) || 0;
        const meId = state.meId ? String(state.meId) : '';

        const raceIds = round1RaceIds(players, finish);
        const rankOf = {};
        raceIds.forEach((id, i) => { rankOf[id] = i + 1; });
        const myIndex = meId ? raceIds.indexOf(meId) : -1;
        const nearby = new Set();
        if (myIndex >= 0) {
            for (let i = Math.max(0, myIndex - 2); i <= Math.min(raceIds.length - 1, myIndex + 2); i++) {
                nearby.add(raceIds[i]);
            }
        }
        if (meId) nearby.add(meId);

        const sorted = players.slice().sort((a, b) => (Number(b.distance) || 0) - (Number(a.distance) || 0));
        sorted.forEach(player => {
            if (!player) return;
            if (player.is_playing === false) return;
            const pid = String(player.user_id || player.id || '');
            const alive = player.status !== 'eliminated' && player.status !== 'out' && player.status !== 'advanced' && player.ghost !== true;
            const dist = clamp(Number(player.distance) || 0, 0, finish);
            const z = r1Z(dist, L);
            const lane = Math.floor(mix01(pid + ':lane') * 9);
            const jitter = (mix01('jx:' + pid) - 0.5) * 0.9;
            // Lanes converge with depth like a real running field, which also
            // keeps the nearest cats inside a phone-sized frame.
            const ground = project(cam, 0, 0, z);
            const halfWorld = ground ? (L.w * 0.44) / ground.s : 3.4;
            const laneNorm = clamp((lane - 4 + jitter) / 4, -1, 1);
            const x = laneNorm * halfWorld;
            const isMe = meId && pid === meId;
            let y = 0.02;
            if (!alive) {
                y -= 0.25 + Math.sin(t / 420 + mix01('g' + pid) * 6) * 0.06;
            } else {
                const bounce = Math.abs(Math.sin(t / 150 + mix01('b' + pid) * 8));
                y += bounce * 0.03;
            }
            const scaleWorld = (alive ? 0.92 : 0.86) * (isMe ? 1.16 : 1);
            const anchor = drawCatAt(ctx, cam, x, y, z, scaleWorld, catLook(player), {
                alpha: alive ? 1 : 0.32,
                ghost: !alive,
                ring: isMe && alive,
                ringColor: '#fde047',
                halo: !alive,
                haloColor: '#9bd7f5'
            });
            if (anchor && (isMe || L.landscape || L.host || nearby.has(pid))) {
                const name = shortName(player);
                if (name) {
                    const rank = rankOf[pid];
                    const label = (rank ? rank + ' · ' : '') + name;
                    const fs = Math.max(7, Math.min(12, anchor.scale * 15)) + (L.host ? 1 : 0);
                    pill(ctx, anchor.x, anchor.y - (isMe ? 152 : 140) * anchor.scale - 5, label, {
                        size: fs,
                        bg: isMe ? 'rgba(120,80,0,.8)' : 'rgba(8,12,24,.55)',
                        color: isMe ? '#fde68a' : '#e8eef8',
                        alpha: alive ? 1 : 0.55
                    });
                }
            }
        });
    }

    /* ================================================================== */
    /* Round 2 · dark theatre glass bridge                                */
    /* ================================================================== */

    const R2 = {
        paneHalf: 0.78,
        gap: 0.17,
        firstZ: 2.5,
        lastZ: 11.9,
        stageZ: 14.4,
        platformZ: 1.1,
        deckY: 0,
        edgeX: 1.95
    };

    function r2StepZ(index, count) {
        const n = Math.max(1, count);
        if (n <= 1) return R2.firstZ;
        return lerp(R2.firstZ, R2.lastZ, clamp(index / (n - 1), 0, 1));
    }

    function r2Cam(L, state) {
        const me = state && Array.isArray(state.players) && state.meId
            ? state.players.find(p => String(p.user_id) === String(state.meId))
            : null;
        const steps = Math.max(1, Number(state && state.stepCount) || 9);
        const myStep = (!L.host && me && me.glass_active) ? clamp(Number(me.glass_step) || 0, 0, steps) : 0;
        const eye = L.cam2.eye.slice();
        eye[2] = eye[2] + myStep * 0.26;
        eye[1] = eye[1] - myStep * 0.02;
        return makeCam(L, { eye: eye, target: L.cam2.target, fov: L.cam2.fov });
    }

    function curtainSide(ctx, cam, sign, t) {
        const x = sign * 3.65;
        const z0 = -1.5;
        const z1 = 14.2;
        // deep curtain wall
        poly3(ctx, cam, [[x, 0, z0], [x, 0, z1], [x, 7.7, z1], [x, 7.7, z0]], { fill: '#2b0a12' });
        // folds
        const folds = 9;
        for (let i = 0; i < folds; i++) {
            const za = lerp(z0, z1, i / folds);
            const zb = lerp(z0, z1, (i + 1) / folds);
            const lit = i % 2 === 0;
            const topP = project(cam, x + sign * 0.01, 7.0, za);
            const botP = project(cam, x + sign * 0.01, 0, za);
            let fill = lit ? 'rgba(126,26,40,.94)' : 'rgba(82,14,26,.94)';
            if (topP && botP) {
                const g = ctx.createLinearGradient(0, topP.y, 0, botP.y);
                if (lit) {
                    g.addColorStop(0, '#a52a3d');
                    g.addColorStop(0.45, '#731726');
                    g.addColorStop(1, '#360810');
                } else {
                    g.addColorStop(0, '#781a2b');
                    g.addColorStop(0.45, '#4f0d17');
                    g.addColorStop(1, '#23050a');
                }
                fill = g;
            }
            poly3(ctx, cam, [[x + sign * 0.01, 0, za], [x + sign * 0.01, 0, zb],
                [x + sign * 0.01, 7.0 - (i % 3) * 0.22, zb], [x + sign * 0.01, 7.2 - (i % 3) * 0.22, za]],
                { fill: fill });
            // highlight along the fold
            line3(ctx, cam, [x + sign * 0.02, 0.4, za], [x + sign * 0.02, 6.8, za],
                { stroke: 'rgba(214,90,106,.4)', lineWidth: 2 });
        }
        // gold trim at the top
        line3(ctx, cam, [x + sign * 0.03, 7.15, z0], [x + sign * 0.03, 7.15, z1],
            { stroke: 'rgba(232,196,116,.85)', lineWidth: 3 });
        // swags across the top
        for (let i = 0; i < 6; i++) {
            const za = lerp(z0 + 0.6, z1 - 0.8, i / 6);
            const zb = lerp(z0 + 0.6, z1 - 0.8, (i + 1) / 6);
            const a = project(cam, x + sign * 0.05, 7.15, za);
            const b = project(cam, x + sign * 0.05, 7.15, zb);
            if (!a || !b) continue;
            ctx.save();
            ctx.strokeStyle = 'rgba(206,64,82,.95)';
            ctx.lineWidth = Math.max(2, a.s * 0.10);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + Math.abs(b.x - a.x) * 0.20, b.x, b.y);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(232,196,116,.7)';
            ctx.lineWidth = Math.max(1, a.s * 0.028);
            ctx.stroke();
            ctx.restore();
        }
    }

    function drawLedString(ctx, cam, xs, z0, z1, count, t, opts) {
        const o = opts || {};
        for (let i = 0; i < count; i++) {
            const z = lerp(z0, z1, i / Math.max(1, count - 1));
            const p = project(cam, xs, 0.10, z);
            if (!p) continue;
            const tw = 0.62 + 0.38 * Math.sin(t / 260 + i * 0.9 + (o.phase || 0));
            const r = Math.max(1.1, p.s * 0.032) * (o.size || 1);
            ctx.fillStyle = o.color || 'rgba(255,238,186,' + (0.55 + tw * 0.45).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            if (i % 2 === 0) glow(ctx, p.x, p.y, r * 3.4, o.glow || '#ffe7a6', 0.18 * tw);
        }
    }

    function drawTheatreStatic(ctx, L, cam, t) {
        // deep darkness
        const bg = ctx.createLinearGradient(0, 0, 0, L.h);
        bg.addColorStop(0, '#08050c');
        bg.addColorStop(0.55, '#0d0713');
        bg.addColorStop(1, '#050309');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, L.w, L.h);

        // faint purple ambient behind the bridge
        const amb = ctx.createRadialGradient(L.w * 0.5, L.h * 0.42, L.w * 0.05, L.w * 0.5, L.h * 0.45, L.w * 0.85);
        amb.addColorStop(0, 'rgba(138,62,150,.20)');
        amb.addColorStop(0.5, 'rgba(60,28,74,.12)');
        amb.addColorStop(1, 'rgba(4,2,8,0)');
        ctx.fillStyle = amb;
        ctx.fillRect(0, 0, L.w, L.h);

        // side curtains
        curtainSide(ctx, cam, -1, t);
        curtainSide(ctx, cam, 1, t);

        // gold proscenium line across the top
        const a = project(cam, -3.65, 7.2, 13.6);
        const b = project(cam, 3.65, 7.2, 13.6);
        if (a && b) {
            ctx.save();
            ctx.strokeStyle = 'rgba(232,196,116,.8)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.restore();
        }

        // ceiling panelling + warm cans
        poly3(ctx, cam, [[-3.65, 7.9, -1.5], [3.65, 7.9, -1.5], [3.65, 7.9, 14.4], [-3.65, 7.9, 14.4]],
            { fill: '#0b0711' });
        for (let i = 0; i < 5; i++) {
            const z = 1.0 + i * 2.9;
            const p = project(cam, 0, 7.85, z);
            if (!p) continue;
            glow(ctx, p.x, p.y, Math.max(8, p.s * 1.6), '#ffd9a0', 0.22);
        }

        // far lit archway / stage
        const sz = R2.stageZ;
        // stage platform
        poly3(ctx, cam, [[-2.6, 0.0, sz - 3.0], [2.6, 0.0, sz - 3.0], [2.6, 0.22, sz - 3.0], [-2.6, 0.22, sz - 3.0]],
            { fill: '#1a0d18' });
        // arch glow
        const archCenter = project(cam, 0, 2.1, sz);
        if (archCenter) {
            const rw = archCenter.s * 2.2;
            glow(ctx, archCenter.x, archCenter.y, rw * 1.6, '#ff9ee0', 0.4);
            glow(ctx, archCenter.x, archCenter.y, rw * 0.9, '#ffe3f3', 0.42);
        }
        poly3(ctx, cam, [[-1.9, 0.22, sz], [1.9, 0.22, sz], [1.9, 4.0, sz], [-1.9, 4.0, sz]],
            { fill: '#2a1030' });
        // lit doorway
        poly3(ctx, cam, [[-1.1, 0.25, sz - 0.03], [1.1, 0.25, sz - 0.03], [1.1, 3.1, sz - 0.03], [-1.1, 3.1, sz - 0.03]],
            { fill: 'rgba(255,220,240,.95)' });
        // arch crown
        const archTop = project(cam, 0, 3.15, sz - 0.04);
        if (archTop) {
            ctx.save();
            ctx.strokeStyle = 'rgba(240,160,214,.95)';
            ctx.lineWidth = Math.max(2, archTop.s * 0.10);
            ctx.beginPath();
            ctx.arc(archTop.x, archTop.y, archTop.s * 1.1, Math.PI, 0);
            ctx.stroke();
            ctx.restore();
        }
        // stage edge LEDs
        drawLedString(ctx, cam, -1.9, sz - 2.5, sz - 0.2, 12, t, { color: 'rgba(255,214,240,.95)', glow: '#ffb6e8', size: 1.2, phase: 1 });
        drawLedString(ctx, cam, 1.9, sz - 2.5, sz - 0.2, 12, t, { color: 'rgba(255,214,240,.95)', glow: '#ffb6e8', size: 1.2, phase: 2 });

        // vertical bead strands hang inside the theatre
        for (let i = 0; i < 4; i++) {
            const x = (i < 2 ? -1 : 1) * (2.35 + (i % 2) * 0.38);
            const z = 4.2 + i * 2.1;
            const p = project(cam, x, 0.2, z);
            if (!p) continue;
            for (let k = 0; k < 7; k++) {
                const yy = project(cam, x, 0.4 + k * 0.9, z);
                if (!yy) continue;
                ctx.fillStyle = 'rgba(255,240,200,' + (0.35 + 0.4 * Math.abs(Math.sin(t / 380 + k + i))).toFixed(3) + ')';
                ctx.beginPath();
                ctx.arc(yy.x, yy.y, Math.max(1, yy.s * 0.018), 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // void haze below the bridge
        const voidG = ctx.createLinearGradient(0, L.h * 0.55, 0, L.h);
        voidG.addColorStop(0, 'rgba(6,4,10,0)');
        voidG.addColorStop(1, 'rgba(2,1,4,.85)');
        ctx.fillStyle = voidG;
        ctx.fillRect(0, L.h * 0.55, L.w, L.h * 0.45);

        // Distant sparks in the drop below the bridge: cheap, animated depth.
        const spark = ctx.createRadialGradient(L.w * 0.5, L.h * 0.8, 10, L.w * 0.5, L.h * 0.8, L.w * 0.5);
        spark.addColorStop(0, 'rgba(150,70,170,.14)');
        spark.addColorStop(1, 'rgba(150,70,170,0)');
        ctx.fillStyle = spark;
        ctx.fillRect(0, L.h * 0.55, L.w, L.h * 0.45);
        for (let i = 0; i < 22; i++) {
            const sx = (hash01('vsparkX' + i) - 0.5) * 11;
            const sy = -1.4 - hash01('vsparkY' + i) * 4.6;
            const sz = 3 + hash01('vsparkZ' + i) * 9;
            const sp = project(cam, sx, sy, sz);
            if (!sp) continue;
            const tw = 0.35 + 0.65 * Math.abs(Math.sin(t / 900 + i * 1.7));
            ctx.fillStyle = 'rgba(198,158,226,' + (0.08 + tw * 0.22).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, Math.max(0.8, sp.s * 0.018), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function spotlightBeams(ctx, L, t) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const sweep = Math.sin(t / 4200) * 0.02;
        [
            { x0: 0.04, x1: 0.42, a: 0.14 },
            { x0: 0.96, x1: 0.60, a: 0.14 },
            { x0: 0.20, x1: 0.47, a: 0.07 },
            { x0: 0.80, x1: 0.53, a: 0.07 }
        ].forEach((b, i) => {
            const x0 = L.w * (b.x0 + sweep * (i % 2 ? 1 : -1));
            const x1 = L.w * (b.x1 + sweep * 0.5);
            const y1 = L.h * (0.46 + (i % 2) * 0.03);
            const g = ctx.createLinearGradient(x0, 0, x1, y1);
            g.addColorStop(0, 'rgba(220,232,255,' + b.a + ')');
            g.addColorStop(0.6, 'rgba(180,205,255,' + (b.a * 0.45) + ')');
            g.addColorStop(1, 'rgba(150,180,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(x0 - L.w * 0.015, 0);
            ctx.lineTo(x0 + L.w * 0.015, 0);
            ctx.lineTo(x1 + L.w * 0.10, y1);
            ctx.lineTo(x1 - L.w * 0.10, y1);
            ctx.closePath();
            ctx.fill();
        });
        ctx.restore();
    }

    function drawBridgeDeck(ctx, cam, steps, state, t) {
        // walkway edges (the beams that carry the panes)
        const count = Math.max(1, steps);
        const z0 = R2.firstZ - 0.55;
        const z1 = R2.lastZ + 0.7;
        [-1, 1].forEach(side => {
            const x = side * (R2.paneHalf * 2 + R2.gap);
            poly3(ctx, cam, [[x - 0.10, -0.16, z0], [x + 0.10, -0.16, z0], [x + 0.10, 0.04, z1], [x - 0.10, 0.04, z1]],
                { fill: 'rgba(196,196,220,.30)' });
            // purple-lit outer rail
            poly3(ctx, cam, [[x + side * 0.10, -0.05, z0], [x + side * 0.16, -0.05, z0],
                [x + side * 0.16, 0.10, z1], [x + side * 0.10, 0.10, z1]],
                { fill: 'rgba(214,86,196,.55)' });
        });

        // underside / support truss
        poly3(ctx, cam, [[-2.1, -0.55, z0], [2.1, -0.55, z0], [2.1, -0.55, z1], [-2.1, -0.55, z1]],
            { fill: 'rgba(10,6,16,.8)' });
        // centre divider rail
        poly3(ctx, cam, [[-0.055, -0.02, z0], [0.055, -0.02, z0], [0.055, 0.12, z1], [-0.055, 0.12, z1]],
            { fill: 'rgba(180,170,205,.4)' });

        // start platform
        poly3(ctx, cam, [[-2.5, 0, 0.1], [2.5, 0, 0.1], [2.5, 0.14, 2.5], [-2.5, 0.14, 2.5]],
            { fill: 'rgba(48,38,66,.9)' });
        poly3(ctx, cam, [[-2.5, 0.14, 0.1], [2.5, 0.14, 0.1], [2.5, 0.14, 2.5], [-2.5, 0.14, 2.5]],
            { fill: 'rgba(96,80,124,.35)' });
        // warm LED rim so the stage edge reads clearly over the void
        line3(ctx, cam, [-2.5, 0.15, 0.12], [2.5, 0.15, 0.12], { stroke: 'rgba(255,226,178,.55)', lineWidth: 2 });
        line3(ctx, cam, [-2.5, 0.15, 0.12], [-2.5, 0.15, 2.5], { stroke: 'rgba(255,226,178,.35)', lineWidth: 2 });
        line3(ctx, cam, [2.5, 0.15, 0.12], [2.5, 0.15, 2.5], { stroke: 'rgba(255,226,178,.35)', lineWidth: 2 });
    }

    function drawPane3D(ctx, cam, step, side, index, count, meOnThis, t) {
        const z0 = r2StepZ(index, count) - 0.38;
        const z1 = r2StepZ(index, count) + 0.38;
        const cx = side === 'left' ? -(R2.paneHalf + R2.gap * 0.5) : (R2.paneHalf + R2.gap * 0.5);
        const x0 = cx - R2.paneHalf;
        const x1 = cx + R2.paneHalf;
        const revealedSide = step.revealed_side;
        const isCorrect = revealedSide === side;
        const isShattered = step.shattered_side === side;

        const corners = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]];
        const p = project(cam, cx, 0, (z0 + z1) / 2);
        if (!p) return;

        if (isCorrect) {
            const g = ctx.createLinearGradient(0, p ? p.y - p.s * 0.4 : 0, 0, p ? p.y + p.s * 0.4 : 10);
            g.addColorStop(0, 'rgba(190,255,214,.96)');
            g.addColorStop(0.55, 'rgba(34,197,94,.92)');
            g.addColorStop(1, 'rgba(12,110,50,.92)');
            poly3(ctx, cam, corners, { fill: g, stroke: 'rgba(240,255,244,.95)', lineWidth: 2, shadowColor: 'rgba(74,222,128,.9)', shadowBlur: 22 });
        } else if (isShattered) {
            poly3(ctx, cam, corners, { fill: 'rgba(8,10,18,.92)', stroke: 'rgba(120,130,160,.55)', lineWidth: 1 });
        } else {
            // dark, slightly purple-tinted reflective glass
            const g = ctx.createLinearGradient(0, p ? p.y - p.s * 0.5 : 0, 0, p ? p.y + p.s * 0.5 : 10);
            g.addColorStop(0, 'rgba(66,58,104,.86)');
            g.addColorStop(0.45, 'rgba(40,36,70,.82)');
            g.addColorStop(1, 'rgba(22,20,44,.9)');
            poly3(ctx, cam, corners, { fill: g, stroke: 'rgba(150,140,200,.42)', lineWidth: 1.2 });
            // specular streak
            if (p) {
                ctx.save();
                ctx.globalAlpha = 0.10;
                ctx.strokeStyle = '#dcd6ff';
                ctx.lineWidth = Math.max(1, p.s * 0.05);
                ctx.beginPath();
                ctx.moveTo(p.x - p.s * 0.45, p.y + p.s * 0.16);
                ctx.lineTo(p.x + p.s * 0.30, p.y - p.s * 0.16);
                ctx.stroke();
                ctx.restore();
            }
        }

        if (isShattered) {
            // crack lines across the projected quad
            if (p) {
                ctx.save();
                ctx.strokeStyle = 'rgba(170,200,255,.6)';
                ctx.lineWidth = 1;
                for (let k = 0; k < 6; k++) {
                    const a = -1 + (k / 5) * 2;
                    ctx.beginPath();
                    ctx.moveTo(p.x + a * p.s * 0.5, p.y - p.s * 0.22);
                    ctx.lineTo(p.x + (a * 0.55 + 0.1) * p.s * 0.5, p.y + p.s * 0.2);
                    ctx.stroke();
                }
                ctx.restore();
            }
        } else if (!step.revealed) {
            // faint edge glint on untouched glass
            poly3(ctx, cam, [[x0 + 0.04, 0.002, z0 + 0.07], [x1 - 0.04, 0.002, z0 + 0.07]], {
                close: false, stroke: 'rgba(226,220,255,.4)', lineWidth: 1.4
            });
        }

        // yellow selection outline
        if (meOnThis) {
            poly3(ctx, cam, corners, { stroke: '#fde047', lineWidth: 2.4, dash: [7, 5] });
        }

        // Lights only: the pane choices live on the student's phone, never
        // as text on the 3D bridge (two classmates see different orders).
    }

    function drawBridgePanes(ctx, cam, state, t) {
        const players = Array.isArray(state.players) ? state.players : [];
        const steps = Math.max(1, Number(state.stepCount) || 9);
        const glass = Array.isArray(state.glassSteps) ? state.glassSteps : [];
        const me = state.meId ? players.find(p => String(p.user_id) === String(state.meId)) : null;
        const meOnRow = me && me.glass_active && me.status !== 'eliminated'
            ? clamp(Number(me.glass_step) || 0, 0, steps - 1) : -1;
        const mySide = me ? (me.glass_side === 'right' ? 'right' : 'left') : '';

        // far rows first so nearer panes overlap cleanly
        for (let i = steps - 1; i >= 0; i--) {
            const step = glass[i] || { left: '', right: '', correct_side: 'left', revealed: false };
            drawPane3D(ctx, cam, step, 'left', i, steps, meOnRow === i && mySide === 'left', t);
            drawPane3D(ctx, cam, step, 'right', i, steps, meOnRow === i && mySide === 'right', t);
        }
    }

    function drawRound2Players(ctx, L, cam, state, t) {
        const players = Array.isArray(state.players) ? state.players : [];
        const steps = Math.max(1, Number(state.stepCount) || 9);
        const meId = state.meId ? String(state.meId) : '';
        const queued = players.filter(p => p.is_playing !== false && p.status === 'alive' && !p.glass_active);

        const drawOne = player => {
            if (!player) return;
            if (player.is_playing === false) return;
            const alive = player.status !== 'eliminated' && player.status !== 'out' && player.status !== 'advanced' && player.ghost !== true;
            const advanced = player.status === 'advanced' || player.crossed_glass;
            const step = clamp(Number(player.glass_step) || 0, 0, steps);
            const side = player.glass_side === 'right' ? 'right' : 'left';
            const isMe = meId && String(player.user_id) === meId;
            // Portrait phones keep the shot clean: only my cat, the players
            // actually on the bridge and the survivors at the far stage.
            // The teacher's portrait projector keeps the whole class.
            if (!L.landscape && !L.host && !isMe && !advanced && (!alive || !player.glass_active)) return;
            let x;
            let y;
            let z;
            let scaleWorld = 1.0;

            if (advanced) {
                x = (mix01('win' + (player.user_id || '')) - 0.5) * 3.6;
                y = 0.28;
                z = R2.stageZ - 1.6 - mix01('wz' + (player.user_id || '')) * 0.5;
                scaleWorld = 0.82;
            } else if (player.glass_active && alive) {
                const row = clamp(step, 0, steps - 1);
                x = side === 'left' ? -(R2.paneHalf + R2.gap * 0.5) : (R2.paneHalf + R2.gap * 0.5);
                y = 0.02;
                z = r2StepZ(row, steps) + 0.55;
                scaleWorld = isMe ? 1.08 : 0.98;
            } else if (alive) {
                const idx = Math.max(0, queued.indexOf(player));
                x = (mix01('queue' + (player.user_id || '')) - 0.5) * 3.4;
                y = 0.16;
                z = 0.9 + (idx % 3) * 0.42;
                scaleWorld = isMe ? 1.02 : 0.84;
            } else {
                // falling into the void below the bridge
                const fall = ((t / 2100 + mix01('fall' + (player.user_id || '')) * 6) % 1);
                x = (mix01('fx' + (player.user_id || '')) - 0.5) * 5.0;
                y = -0.7 - fall * 3.2;
                z = 2.6 + mix01('fz' + (player.user_id || '')) * 6.0;
                scaleWorld = 0.78;
            }

            const anchor = drawCatAt(ctx, cam, x, y, z, scaleWorld, catLook(player), {
                alpha: alive ? 1 : 0.28,
                ghost: !alive,
                ring: isMe && alive,
                ringColor: '#fde047',
                halo: !alive,
                haloColor: '#9bd7f5'
            });
            if (anchor && (isMe || L.landscape || L.host)) {
                const name = shortName(player);
                if (name) {
                    const fs = Math.max(7, Math.min(12, anchor.scale * 15));
                    pill(ctx, anchor.x, anchor.y - (isMe ? 152 : 140) * anchor.scale - 5, name, {
                        size: fs,
                        bg: isMe ? 'rgba(120,80,0,.8)' : 'rgba(8,12,24,.55)',
                        color: isMe ? '#fde68a' : '#e8eef8',
                        alpha: alive ? 1 : 0.5
                    });
                }
            }
        };

        players.slice().sort((a, b) => (Number(b.glass_step) || 0) - (Number(a.glass_step) || 0)).forEach(drawOne);

        if (queued.length > 0) {
            ctx.save();
            pill(ctx, L.w * 0.5, L.h - Math.max(16, L.h * 0.035), 'Queue: ' + queued.length + ' waiting', {
                size: Math.max(9, Math.min(13, L.w * (L.landscape ? 0.010 : 0.024)))
            });
            ctx.restore();
        }
    }

    R.drawRound2 = function (ctx, state) {
        const s = state || {};
        const L = R.layout(s.w, s.h, s.role);
        const cam = r2Cam(L, s);
        const t = Number(s.now) || 0;
        const steps = Math.max(1, Number(s.stepCount) || 9);

        drawTheatreStatic(ctx, L, cam, t);
        spotlightBeams(ctx, L, t);

        drawBridgeDeck(ctx, cam, steps, s, t);

        // LED bead strings along both outer edges + down the centre divider
        const count = Math.max(10, Math.round(steps * 3.2));
        drawLedString(ctx, cam, -(R2.paneHalf * 2 + R2.gap), R2.firstZ - 0.3, R2.lastZ + 0.4, count, t, { color: 'rgba(255,240,196,.95)', size: 1.05 });
        drawLedString(ctx, cam, (R2.paneHalf * 2 + R2.gap), R2.firstZ - 0.3, R2.lastZ + 0.4, count, t, { color: 'rgba(255,240,196,.95)', size: 1.05, phase: 1.3 });
        drawLedString(ctx, cam, 0, R2.firstZ, R2.lastZ, count, t, { color: 'rgba(214,255,190,.95)', glow: '#d8ffb0', size: 0.8, phase: 0.6 });

        drawBridgePanes(ctx, cam, s, t);
        drawRound2Players(ctx, L, cam, s, t);

        // stage finish label
        const finishP = project(cam, 0, 4.3, R2.stageZ - 0.1);
        if (finishP) {
            pill(ctx, finishP.x, finishP.y, 'FINISH · 終點', {
                size: Math.max(9, Math.min(13, finishP.s * 0.12)),
                bg: 'rgba(60,10,34,.74)', color: '#ffe0f3', border: 'rgba(255,180,230,.5)'
            });
        }

        // vignette
        const vig = ctx.createRadialGradient(L.w / 2, L.h * 0.5, L.w * 0.22, L.w / 2, L.h * 0.5, L.w * 0.85);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(2,1,5,.72)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, L.w, L.h);

        ctx.save();
        pill(ctx, 14, L.hud + 16, 'Glass Stepping Stones', {
            size: Math.max(9, Math.min(13, L.w * (L.landscape ? 0.011 : 0.027))), align: 'left'
        });
        ctx.restore();
    };

    /* ================================================================== */
    /* Round 3 — Tug of War                                               */
    /*                                                                    */
    /* A yellow industrial warehouse: two high steel platforms on either  */
    /* side of a dark abyss, a hemp rope between them with a golden       */
    /* salmon at the centre. Everything is original procedural canvas art. */
    /* ================================================================== */

    const R3 = {
        platformTop: 3.05,
        platformInner: 3.35,
        platformOuter: 5.05,
        platformNear: 1.6,
        platformFar: 9.4,
        ropeY: 3.62,
        ropeZ: 5.4,
        ropeInner: 3.45,
        deckY: 0.55,
        deckZ: 5.4
    };

    function r3Cam(L, state) {
        const team = state && (state.myTeam === 'red' || state.myTeam === 'blue') ? state.myTeam : '';
        const eye = L.cam3.eye.slice();
        if (!L.host && team) eye[0] = (team === 'red' ? -1 : 1) * (L.landscape ? 0.9 : 1.7);
        return makeCam(L, { eye: eye, target: L.cam3.target, fov: L.cam3.fov });
    }

    function r3Platform(ctx, cam, side) {
        const inner = side * R3.platformInner;
        const outer = side * R3.platformOuter;
        const x0 = Math.min(inner, outer);
        const x1 = Math.max(inner, outer);
        const top = R3.platformTop;
        const z0 = R3.platformNear;
        const z1 = R3.platformFar;

        // steel body
        box3(ctx, cam, {
            x: x0, y: top - 0.52, z: z0, w: x1 - x0, h: 0.52, d: z1 - z0,
            color: '#c98f08', top: '#f2b90a', side: '#8a5c05',
            edge: 'rgba(60,36,2,.35)'
        });
        // bright top plate
        poly3(ctx, cam, [[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]],
            { fill: '#f6c21a', stroke: 'rgba(70,44,0,.4)', lineWidth: 1 });
        // inner safety stripe facing the rope
        const sx = side * (R3.platformInner - 0.02);
        for (let i = 0; i < 7; i++) {
            const za = lerp(z0, z1, i / 7);
            const zb = lerp(z0, z1, (i + 1) / 7);
            poly3(ctx, cam, [[sx, top + 0.004, za], [sx, top + 0.004, zb],
                [sx, top + 0.10, zb], [sx, top + 0.10, za]],
                { fill: i % 2 ? '#17120d' : '#f7d24a' });
        }
        // warning rail
        const railX = side * (R3.platformInner - 0.10);
        poly3(ctx, cam, [[railX, top + 0.62, z0 + 0.3], [railX, top + 0.70, z0 + 0.3],
            [railX, top + 0.70, z1 - 0.3], [railX, top + 0.62, z1 - 0.3]],
            { fill: 'rgba(248,196,26,.55)' });
        for (let i = 0; i < 4; i++) {
            const z = lerp(z0 + 0.7, z1 - 0.7, i / 3);
            poly3(ctx, cam, [[railX - side * 0.02, top, z], [railX + side * 0.02, top, z],
                [railX + side * 0.02, top + 0.66, z], [railX - side * 0.02, top + 0.66, z]],
                { fill: '#6b4a05' });
        }
        // support columns dropping into the abyss
        for (let i = 0; i < 3; i++) {
            const z = lerp(z0 + 0.9, z1 - 0.9, i / 2);
            box3(ctx, cam, {
                x: side * (R3.platformInner + 0.35), y: top - 7.4, z: z - 0.16,
                w: 0.32, h: 6.9, d: 0.32,
                color: '#2a2016', top: '#3a2c1d', side: '#1a130d', edge: 'rgba(0,0,0,.3)'
            });
        }
    }

    function r3LampPost(ctx, cam, side, z) {
        const x = side * (R3.platformOuter - 0.15);
        const top = R3.platformTop;
        box3(ctx, cam, {
            x: x - 0.07, y: top, z: z - 0.07, w: 0.14, h: 3.1, d: 0.14,
            color: '#2b2118', top: '#3b2d20', side: '#1b140e'
        });
        box3(ctx, cam, {
            x: x - side * 0.55, y: top + 2.98, z: z - 0.05, w: 0.62, h: 0.10, d: 0.10,
            color: '#2b2118', top: '#3b2d20', side: '#1b140e'
        });
        const headX = x - side * 0.52;
        box3(ctx, cam, {
            x: headX - 0.20, y: top + 2.78, z: z - 0.16, w: 0.40, h: 0.20, d: 0.30,
            color: '#3b2d20', top: '#55402c', side: '#241a11'
        });
    }

    function paintTugStatic(ctx, L, cam) {
        // dark warehouse sky + haze
        const bg = ctx.createLinearGradient(0, 0, 0, L.h);
        bg.addColorStop(0, '#0c0a0f');
        bg.addColorStop(0.42, '#1c1411');
        bg.addColorStop(0.72, '#241a12');
        bg.addColorStop(1, '#070509');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, L.w, L.h);

        const amb = ctx.createRadialGradient(L.w * 0.5, L.h * 0.34, L.w * 0.06,
            L.w * 0.5, L.h * 0.5, L.w * 0.9);
        amb.addColorStop(0, 'rgba(246,194,26,.14)');
        amb.addColorStop(0.5, 'rgba(140,90,18,.08)');
        amb.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = amb;
        ctx.fillRect(0, 0, L.w, L.h);

        // back wall + roof trusses
        poly3(ctx, cam, [[-11, -6, 15.5], [11, -6, 15.5], [11, 12, 15.5], [-11, 12, 15.5]],
            { fill: '#151019' });
        for (let i = 0; i < 7; i++) {
            const x = -9 + i * 3;
            poly3(ctx, cam, [[x, -6, 15], [x + 0.22, -6, 15], [x + 0.22, 12, 15], [x, 12, 15]],
                { fill: 'rgba(52,41,30,.55)' });
        }
        for (let i = 0; i < 5; i++) {
            const y = 6.4 + i * 1.2;
            line3(ctx, cam, [-10, y, 14.8], [10, y, 14.8], { stroke: 'rgba(58,45,32,.35)', lineWidth: 1.5 });
        }

        // distant hanging bulbs / cables
        for (let i = 0; i < 9; i++) {
            const x = -9 + i * 2.25;
            line3(ctx, cam, [x, 10.6, 12.5], [x, 6.9, 12.5], { stroke: 'rgba(60,48,35,.4)', lineWidth: 1 });
            const p = project(cam, x, 6.8, 12.5);
            if (p) glow(ctx, p.x, p.y, Math.max(4, p.s * 0.22), '#ffd98a', 0.16);
        }

        // abyss floor haze
        const voidG = ctx.createLinearGradient(0, L.h * 0.52, 0, L.h);
        voidG.addColorStop(0, 'rgba(8,5,10,0)');
        voidG.addColorStop(1, 'rgba(2,1,4,.92)');
        ctx.fillStyle = voidG;
        ctx.fillRect(0, L.h * 0.5, L.w, L.h * 0.5);

        // side platforms + lamps
        r3Platform(ctx, cam, -1);
        r3Platform(ctx, cam, 1);
        r3LampPost(ctx, cam, -1, 4.4);
        r3LampPost(ctx, cam, 1, 4.4);
        r3LampPost(ctx, cam, -1, 8.0);
        r3LampPost(ctx, cam, 1, 8.0);

        // lower centre viewing deck
        box3(ctx, cam, {
            x: -1.75, y: R3.deckY - 0.34, z: 3.5, w: 3.5, h: 0.34, d: 3.8,
            color: '#3a2b1b', top: '#5a432a', side: '#241a10', edge: 'rgba(0,0,0,.3)'
        });
        poly3(ctx, cam, [[-1.75, R3.deckY, 3.5], [1.75, R3.deckY, 3.5],
            [1.75, R3.deckY, 7.3], [-1.75, R3.deckY, 7.3]],
            { fill: 'rgba(90,67,42,.9)' });
        for (let i = 0; i < 6; i++) {
            const x = -1.6 + i * 0.64;
            line3(ctx, cam, [x, R3.deckY + 0.6, 3.55], [x, R3.deckY + 0.6, 7.25],
                { stroke: 'rgba(246,194,26,.35)', lineWidth: 1 });
        }
        // deck rail
        line3(ctx, cam, [-1.75, R3.deckY + 0.62, 3.5], [1.75, R3.deckY + 0.62, 3.5],
            { stroke: 'rgba(246,194,26,.55)', lineWidth: 2 });

        // faint sparks / dust in the abyss
        for (let i = 0; i < 16; i++) {
            const sx = (hash01('tugsparkX' + i) - 0.5) * 12;
            const sy = -1.2 - hash01('tugsparkY' + i) * 5.0;
            const sz = 3 + hash01('tugsparkZ' + i) * 9;
            const sp = project(cam, sx, sy, sz);
            if (!sp) continue;
            ctx.fillStyle = 'rgba(246,194,26,' + (0.05 + hash01('tugsparkA' + i) * 0.12).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, Math.max(0.7, sp.s * 0.016), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function r3RopePoints(salmonX, t) {
        const pts = [];
        const n = 26;
        for (let i = 0; i <= n; i++) {
            const k = i / n;
            const x = lerp(-R3.ropeInner, R3.ropeInner, k);
            const sway = Math.sin(t / 900 + k * 7) * 0.018;
            const sag = Math.sin(Math.PI * k) * 0.19;
            const pull = Math.sin(Math.PI * k) * (salmonX / Math.max(0.01, R3.ropeInner)) * 0.06;
            pts.push([x, R3.ropeY - sag - pull + sway, R3.ropeZ]);
        }
        return pts;
    }

    function drawTugRope(ctx, cam, salmonX, t, rageRed, rageBlue) {
        const pts = r3RopePoints(salmonX, t);
        for (let i = 0; i < pts.length - 1; i++) {
            const a = project(cam, pts[i][0], pts[i][1], pts[i][2]);
            const b = project(cam, pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
            if (!a || !b) continue;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineWidth = Math.max(2, a.s * 0.055);
            ctx.strokeStyle = i % 2 ? '#b98b52' : '#8a6234';
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            // braided highlight
            ctx.lineWidth = Math.max(1, a.s * 0.018);
            ctx.strokeStyle = 'rgba(245,221,170,.55)';
            ctx.beginPath();
            ctx.moveTo(a.x, a.y - Math.max(0.5, a.s * 0.012));
            ctx.lineTo(b.x, b.y - Math.max(0.5, b.s * 0.012));
            ctx.stroke();
            ctx.restore();
        }
        // knots near the platforms
        [-R3.ropeInner, R3.ropeInner].forEach(x => {
            const p = project(cam, x, R3.ropeY - 0.01, R3.ropeZ);
            if (!p) return;
            ctx.fillStyle = '#6f4c26';
            ell(ctx, p.x, p.y, Math.max(2, p.s * 0.055), Math.max(2, p.s * 0.045));
        });
        if (rageRed || rageBlue) {
            const centre = project(cam, 0, R3.ropeY, R3.ropeZ);
            if (centre) {
                const col = rageRed && !rageBlue ? '#ef4444' : (rageBlue && !rageRed ? '#3b82f6' : '#f59e0b');
                glow(ctx, centre.x, centre.y, Math.max(40, centre.s * 1.5), col, 0.20 + 0.08 * Math.sin(t / 180));
            }
        }
    }

    function drawTugSalmon(ctx, cam, x, t) {
        const p = project(cam, x, R3.ropeY + 0.04 + Math.sin(t / 420) * 0.025, R3.ropeZ);
        if (!p) return;
        const s = clamp(p.s * 0.62, 11, 84);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.sin(t / 700) * 0.08);
        glow(ctx, 0, 0, s * 1.5, '#fbbf24', 0.32);
        // body
        const grad = ctx.createLinearGradient(-s, -s * 0.4, s, s * 0.4);
        grad.addColorStop(0, '#b45309');
        grad.addColorStop(0.35, '#f59e0b');
        grad.addColorStop(0.7, '#fbbf24');
        grad.addColorStop(1, '#fde68a');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, s, s * 0.44, 0, 0, Math.PI * 2);
        ctx.fill();
        // tail
        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.moveTo(-s * 0.92, 0);
        ctx.lineTo(-s * 1.50, -s * 0.40);
        ctx.lineTo(-s * 1.38, 0);
        ctx.lineTo(-s * 1.50, s * 0.40);
        ctx.closePath();
        ctx.fill();
        // dorsal + pectoral fins
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(-s * 0.15, -s * 0.40);
        ctx.lineTo(s * 0.05, -s * 0.82);
        ctx.lineTo(s * 0.28, -s * 0.34);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(s * 0.18, s * 0.10);
        ctx.lineTo(s * 0.52, s * 0.58);
        ctx.lineTo(s * 0.62, s * 0.10);
        ctx.closePath();
        ctx.fill();
        // eye + mouth
        ctx.fillStyle = '#1f2937';
        ctx.beginPath();
        ctx.arc(s * 0.58, -s * 0.10, Math.max(1, s * 0.075), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7c2d12';
        ctx.lineWidth = Math.max(1, s * 0.055);
        ctx.beginPath();
        ctx.moveTo(s * 0.82, s * 0.06);
        ctx.lineTo(s * 0.97, s * 0.12);
        ctx.stroke();
        // scale hints
        ctx.strokeStyle = 'rgba(146,64,14,.35)';
        ctx.lineWidth = Math.max(0.8, s * 0.035);
        for (let i = -2; i <= 3; i++) {
            ctx.beginPath();
            ctx.arc(i * s * 0.22, 0, s * 0.16, -Math.PI * 0.55, Math.PI * 0.55);
            ctx.stroke();
        }
        ctx.restore();
        return p;
    }

    function tugTeamList(players, team, meId) {
        const list = (Array.isArray(players) ? players : []).filter(p =>
            p && p.is_playing !== false && p.tug_team === team && p.ghost !== true &&
            p.status !== 'eliminated' && p.status !== 'out');
        list.sort((a, b) => {
            const am = meId && String(a.user_id) === String(meId) ? -1 : 0;
            const bm = meId && String(b.user_id) === String(meId) ? -1 : 0;
            if (am !== bm) return am - bm;
            return String(a.user_id) < String(b.user_id) ? -1 : 1;
        });
        return list;
    }

    function drawTugCats(ctx, L, cam, state, t) {
        const players = Array.isArray(state.players) ? state.players : [];
        const tug = state.tug || {};
        const meId = state.meId ? String(state.meId) : '';
        const winner = tug.winner === 'red' || tug.winner === 'blue' ? tug.winner : '';
        const maxPerTeam = L.landscape ? 10 : (L.host ? 8 : 6);
        ['red', 'blue'].forEach(team => {
            const list = tugTeamList(players, team, meId).slice(0, maxPerTeam);
            list.forEach((player, i) => {
                const isMe = meId && String(player.user_id) === meId;
                const losing = !!(winner && winner !== team && (tug.phase === 'done' || winner));
                const z = lerp(3.15, 8.7, list.length <= 1 ? 0.5 : i / (list.length - 1));
                const baseX = team === 'red' ? -(R3.platformInner + 0.48) : (R3.platformInner + 0.48);
                let x = baseX;
                let y = R3.platformTop + 0.01;
                let scaleWorld = isMe ? 0.88 : 0.76;
                let alpha = 1;
                let ghost = false;
                if (losing) {
                    const fall = clamp(((t / 2600) + mix01('tugfall' + player.user_id) * 1.4) % 1.6, 0, 1);
                    y = R3.platformTop - smoothstep(fall) * 8.0;
                    x = baseX + (mix01('tugfx' + player.user_id) - 0.5) * 0.6;
                    alpha = 0.30;
                    ghost = true;
                }
                const anchor = drawCatAt(ctx, cam, x, y, z, scaleWorld, catLook(player), {
                    alpha: alpha,
                    ghost: ghost,
                    ring: isMe && !losing,
                    ringColor: '#fde047',
                    halo: ghost,
                    haloColor: '#fcd34d'
                });
                if (anchor && (isMe || L.landscape || L.host) && !losing) {
                    const name = shortName(player);
                    if (name) {
                        pill(ctx, anchor.x, anchor.y - 128 * anchor.scale - 4, name, {
                            size: Math.max(7, Math.min(11, anchor.scale * 14)),
                            bg: isMe ? 'rgba(120,60,0,.8)' : 'rgba(8,12,24,.55)',
                            color: isMe ? '#fde68a' : '#f5e7cf'
                        });
                    }
                }
            });
        });
    }

    function drawTugGlow(ctx, L, cam, state, t) {
        const tug = state.tug || {};
        if (tug.redRage) {
            const p = project(cam, -(R3.platformInner + 1.2), R3.platformTop + 2.2, R3.ropeZ);
            if (p) {
                glow(ctx, p.x, p.y, Math.max(30, p.s * 1.3), '#ef4444', 0.18 + 0.10 * Math.sin(t / 170));
                pill(ctx, p.x, p.y - 26, '爆走拉力 2x · RED', {
                    size: Math.max(9, Math.min(14, L.w * 0.026)), bg: 'rgba(127,29,29,.85)', color: '#fee2e2', border: 'rgba(248,113,113,.7)'
                });
            }
        }
        if (tug.blueRage) {
            const p = project(cam, (R3.platformInner + 1.2), R3.platformTop + 2.2, R3.ropeZ);
            if (p) {
                glow(ctx, p.x, p.y, Math.max(30, p.s * 1.3), '#3b82f6', 0.18 + 0.10 * Math.sin(t / 170 + 1.4));
                pill(ctx, p.x, p.y - 26, '爆走拉力 2x · BLUE', {
                    size: Math.max(9, Math.min(14, L.w * 0.026)), bg: 'rgba(30,58,138,.85)', color: '#dbeafe', border: 'rgba(96,165,250,.7)'
                });
            }
        }
    }

    R.drawRound3 = function (ctx, state) {
        const s = state || {};
        const L = R.layout(s.w, s.h, s.role);
        const cam = r3Cam(L, s);
        const t = Number(s.now) || 0;
        const tug = s.tug || {};
        const redPull = Number(tug.redPull) || 0;
        const bluePull = Number(tug.bluePull) || 0;
        const position = Number(tug.position) || 0;
        const salmonX = clamp(position / 20, -1, 1) * (R3.ropeInner - 0.30);

        drawCached(ctx, L, 'tug-static:' + (s.role || 'player') + ':' + (s.myTeam || '') + ':' + (L.landscape ? 'l' : 'p'),
            function (paint) { paintTugStatic(paint, L, cam); });

        // animated lamps
        [[-1, 4.4], [1, 4.4], [-1, 8.0], [1, 8.0]].forEach((lamp, i) => {
            const x = lamp[0] * (R3.platformOuter - 0.15) - lamp[0] * 0.52;
            const p = project(cam, x, R3.platformTop + 2.70, lamp[1]);
            if (!p) return;
            const tw = 0.7 + 0.3 * Math.sin(t / 700 + i * 1.7);
            glow(ctx, p.x, p.y, Math.max(8, p.s * 0.85), '#ffe6a3', 0.24 * tw);
        });

        // pink-suited staff on the lower deck (same original drawGuard figure)
        drawGuard(ctx, cam, -1.05, R3.deckY, 6.6, t, 21, { scale: 0.82 });
        drawGuard(ctx, cam, 1.05, R3.deckY, 6.6, t, 22, { scale: 0.82 });

        drawTugRope(ctx, cam, salmonX, t, tug.redRage === true, tug.blueRage === true);
        drawTugSalmon(ctx, cam, salmonX, t);
        drawTugCats(ctx, L, cam, s, t);
        drawTugGlow(ctx, L, cam, s, t);

        // team labels
        const redP = project(cam, -4.2, R3.platformTop + 1.35, 3.4);
        const blueP = project(cam, 4.2, R3.platformTop + 1.35, 3.4);
        if (redP) pill(ctx, redP.x, redP.y, 'RED · 紅隊', { size: Math.max(9, Math.min(14, L.w * 0.026)), bg: 'rgba(127,29,29,.82)', color: '#fee2e2', border: 'rgba(248,113,113,.6)' });
        if (blueP) pill(ctx, blueP.x, blueP.y, 'BLUE · 藍隊', { size: Math.max(9, Math.min(14, L.w * 0.026)), bg: 'rgba(30,58,138,.82)', color: '#dbeafe', border: 'rgba(96,165,250,.6)' });

        // rope score / sudden death
        const scoreY = L.hud + (L.landscape ? 26 : 32);
        pill(ctx, L.w / 2, scoreY, 'RED ' + redPull + '  ·  ' + (position === 0 ? 'LEVEL' : (position > 0 ? 'BLUE +' + position : 'RED +' + Math.abs(position))) + '  ·  BLUE ' + bluePull, {
            size: Math.max(9, Math.min(14, L.w * (L.landscape ? 0.012 : 0.030))),
            bg: 'rgba(20,14,8,.78)', color: '#ffe9b0', border: 'rgba(246,194,26,.5)'
        });
        if (tug.suddenDeath) {
            pill(ctx, L.w / 2, scoreY + 24, '⚡ SUDDEN DEATH — next score wins', {
                size: Math.max(9, Math.min(13, L.w * (L.landscape ? 0.011 : 0.026))),
                bg: 'rgba(120,53,15,.88)', color: '#fef3c7', border: 'rgba(251,191,36,.7)'
            });
        }
        if (tug.phase === 'briefing') {
            pill(ctx, L.w / 2, L.h * 0.52, '🪢 TUG OF WAR — waiting for the host', {
                size: Math.max(10, Math.min(16, L.w * (L.landscape ? 0.014 : 0.034))),
                bg: 'rgba(20,14,8,.82)', color: '#ffe9b0', border: 'rgba(246,194,26,.5)'
            });
        } else if (tug.winner === 'red' || tug.winner === 'blue') {
            pill(ctx, L.w / 2, L.h * 0.52, tug.winner === 'red' ? '🔴 RED TEAM WINS' : '🔵 BLUE TEAM WINS', {
                size: Math.max(11, Math.min(18, L.w * (L.landscape ? 0.016 : 0.038))),
                bg: tug.winner === 'red' ? 'rgba(127,29,29,.88)' : 'rgba(30,58,138,.88)',
                color: '#fef3c7', border: 'rgba(251,191,36,.7)'
            });
        }

        // vignette
        const vig = ctx.createRadialGradient(L.w / 2, L.h * 0.5, L.w * 0.24, L.w / 2, L.h * 0.5, L.w * 0.9);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(2,1,4,.78)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, L.w, L.h);

        ctx.save();
        pill(ctx, 14, L.hud + 16, 'Tug of War', {
            size: Math.max(9, Math.min(13, L.w * (L.landscape ? 0.011 : 0.027))), align: 'left'
        });
        ctx.restore();
    };

    /* ================================================================== */
    /* Round 4 — Dalgona Candy Carving                                    */
    /*                                                                    */
    /* Original art only: a hand-painted golden honeycomb candy in a      */
    /* shallow metal tin, with a dashed stamped shape. No reference       */
    /* stills, no photos and no bitmap loading anywhere in this block.    */
    /*                                                                    */
    /*   player — close-up of THEIR candy + the Cat Needle                */
    /*   host   — overhead grid of the whole class (tins + names + state) */
    /* ================================================================== */

    function dalgonaCircle(cx, cy, r, n) {
        const pts = [];
        const count = Math.max(8, Math.floor(n || 18));
        for (let i = 0; i <= count; i++) {
            const a = (i / count) * Math.PI * 2;
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return pts;
    }

    /* Stamped shapes in a -1..1 box. Fishbone / cat paw / crown cat only. */
    function dalgonaShapeLines(pattern) {
        const kind = String(pattern || '');
        if (kind === 'paw') {
            return [
                dalgonaCircle(0, 0.26, 0.42, 22),
                dalgonaCircle(-0.56, -0.34, 0.20, 14),
                dalgonaCircle(-0.20, -0.60, 0.21, 14),
                dalgonaCircle(0.20, -0.60, 0.21, 14),
                dalgonaCircle(0.56, -0.34, 0.20, 14)
            ];
        }
        if (kind === 'crown') {
            return [[
                [-0.82, 0.42], [-0.82, 0.02], [-0.56, -0.46], [-0.30, 0.02],
                [0, -0.58], [0.30, 0.02], [0.56, -0.46], [0.82, 0.02],
                [0.82, 0.42], [0.30, 0.42], [0.30, 0.58], [0.12, 0.58],
                [0.12, 0.42], [-0.12, 0.42], [-0.12, 0.58], [-0.30, 0.58],
                [-0.30, 0.42], [-0.82, 0.42]
            ], [
                [-0.56, -0.46], [-0.36, -0.70], [-0.16, -0.46]
            ], [
                [0.16, -0.46], [0.36, -0.70], [0.56, -0.46]
            ]];
        }
        const lines = [[[-0.86, 0], [0.86, 0]]];
        [-0.58, -0.30, 0.02, 0.34, 0.66].forEach(function (x) {
            lines.push([[x, 0], [x - 0.26, -0.34]]);
            lines.push([[x, 0], [x - 0.26, 0.34]]);
        });
        return lines;
    }

    function dalgonaLineLength(pts) {
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
            total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        }
        return total;
    }

    function dalgonaPointAt(lines, lengths, total, distance) {
        let d = Math.max(0, Math.min(total, distance));
        for (let i = 0; i < lines.length; i++) {
            const len = lengths[i];
            if (d <= len || i === lines.length - 1) {
                const pts = lines[i];
                const t = len <= 0 ? 0 : d / len;
                const pos = t * (pts.length - 1);
                const idx = Math.min(pts.length - 2, Math.floor(pos));
                const f = pos - idx;
                return [
                    pts[idx][0] + (pts[idx + 1][0] - pts[idx][0]) * f,
                    pts[idx][1] + (pts[idx + 1][1] - pts[idx][1]) * f
                ];
            }
            d -= len;
        }
        return [0, 0];
    }

    /* Resample every stamped shape into exactly `count` dash segments, so
       one correct unit always equals one carved dash. */
    function dalgonaSegments(pattern, count) {
        const n = Math.max(1, Math.floor(count || 1));
        const lines = dalgonaShapeLines(pattern);
        const lengths = lines.map(dalgonaLineLength);
        const total = lengths.reduce(function (a, b) { return a + b; }, 0) || 1;
        const out = [];
        for (let i = 0; i < n; i++) {
            const a = dalgonaPointAt(lines, lengths, total, (i / n) * total);
            const b = dalgonaPointAt(lines, lengths, total, ((i + 1) / n) * total);
            out.push([a[0], a[1], b[0], b[1]]);
        }
        return out;
    }

    function dalgonaSand(ctx, L) {
        const sky = ctx.createLinearGradient(0, 0, 0, L.h);
        sky.addColorStop(0, '#f6d9a0');
        sky.addColorStop(0.55, '#efc27a');
        sky.addColorStop(1, '#d99a4e');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, L.w, L.h);
        /* soft wide playground dunes */
        for (let i = 0; i < 4; i++) {
            const y = L.h * (0.22 + i * 0.19);
            ctx.beginPath();
            ctx.moveTo(-20, y);
            for (let x = 0; x <= L.w + 20; x += 40) {
                const yy = y + Math.sin((x / Math.max(1, L.w)) * Math.PI * 2 + i) * (8 + i * 3);
                ctx.lineTo(x, yy);
            }
            ctx.lineTo(L.w + 20, L.h + 20);
            ctx.lineTo(-20, L.h + 20);
            ctx.closePath();
            ctx.fillStyle = i % 2 ? 'rgba(255,232,183,.28)' : 'rgba(196,137,64,.14)';
            ctx.fill();
        }
        /* distant cat-world fence + palm silhouettes */
        ctx.strokeStyle = 'rgba(120,78,30,.28)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 12; x < L.w; x += 46) {
            ctx.moveTo(x, L.h * 0.17);
            ctx.lineTo(x, L.h * 0.27);
        }
        ctx.moveTo(0, L.h * 0.2);
        ctx.lineTo(L.w, L.h * 0.2);
        ctx.stroke();
        for (let i = 0; i < 5; i++) {
            const x = ((i * 0.23 + 0.08) % 1) * L.w;
            const y = L.h * 0.21;
            ctx.strokeStyle = 'rgba(88,64,32,.18)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(x - 8, y - 26, x - 4, y - 54);
            ctx.stroke();
            for (let f = 0; f < 5; f++) {
                const a = -1.9 + f * 0.55;
                ctx.beginPath();
                ctx.moveTo(x - 4, y - 54);
                ctx.quadraticCurveTo(x - 4 + Math.cos(a) * 26, y - 54 + Math.sin(a) * 20,
                    x - 4 + Math.cos(a) * 40, y - 54 + Math.sin(a) * 34);
                ctx.stroke();
            }
        }
    }

    function paintDalgonaBody(ctx, cx, cy, r, op) {
        const o = op || {};
        ctx.save();
        /* shallow metal tin */
        ctx.beginPath();
        ctx.ellipse(cx, cy + r * 0.14, r * 1.24, r * 1.20, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#6b7280';
        ctx.fill();
        const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        ring.addColorStop(0, '#f8fafc');
        ring.addColorStop(0.35, '#cbd5e1');
        ring.addColorStop(0.65, '#94a3b8');
        ring.addColorStop(1, '#e2e8f0');
        ctx.beginPath();
        ctx.ellipse(cx, cy + r * 0.12, r * 1.20, r * 1.16, 0, 0, Math.PI * 2);
        ctx.fillStyle = ring;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx, cy + r * 0.10, r * 1.02, r * 0.99, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#4b3a22';
        ctx.fill();

        /* honeycomb candy disc */
        const candy = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.36, r * 0.08, cx, cy, r);
        candy.addColorStop(0, '#fff0b8');
        candy.addColorStop(0.35, '#f7c948');
        candy.addColorStop(0.72, '#e09b1a');
        candy.addColorStop(1, '#a9630b');
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = candy;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, r * 0.03);
        ctx.strokeStyle = 'rgba(120,68,8,.55)';
        ctx.stroke();

        /* honeycomb bubbles (deterministic, faint) */
        for (let i = 0; i < 26; i++) {
            const a = hash01('dalgona-bubble-a-' + i) * Math.PI * 2;
            const d = hash01('dalgona-bubble-d-' + i) * 0.86;
            const br = r * (0.018 + hash01('dalgona-bubble-r-' + i) * 0.035);
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * d * r, cy + Math.sin(a) * d * r, br, 0, Math.PI * 2);
            ctx.fillStyle = i % 3 === 0 ? 'rgba(255,248,205,.38)' : 'rgba(139,82,10,.16)';
            ctx.fill();
        }
        ctx.restore();
    }

    function paintDalgonaPattern(ctx, cx, cy, r, pattern, progress, total, status, opts) {
        const o = opts || {};
        if (!pattern || !total) return;
        const segments = dalgonaSegments(pattern, total);
        const scale = r * 0.60;
        const done = Math.max(0, Math.min(total, Number(progress) || 0));
        const shattered = status === 'shattered';
        segments.forEach(function (seg, i) {
            const x1 = cx + seg[0] * scale;
            const y1 = cy + seg[1] * scale;
            const x2 = cx + seg[2] * scale;
            const y2 = cy + seg[3] * scale;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            if (i < done) {
                ctx.setLineDash([]);
                ctx.lineWidth = Math.max(2, r * (o.small ? 0.055 : 0.034));
                ctx.strokeStyle = o.gold || '#ffe066';
                ctx.shadowColor = '#ffd23f';
                ctx.shadowBlur = o.small ? 4 : 12;
                ctx.stroke();
                ctx.shadowBlur = 0;
            } else {
                ctx.setLineDash([Math.max(2, r * 0.035), Math.max(2, r * 0.035)]);
                ctx.lineWidth = Math.max(1, r * (o.small ? 0.035 : 0.022));
                ctx.strokeStyle = shattered
                    ? 'rgba(54,32,8,.42)'
                    : (i === done ? 'rgba(92,52,6,.85)' : 'rgba(92,52,6,.46)');
                ctx.stroke();
                ctx.setLineDash([]);
            }
        });
        /* Cat Needle on the current dash */
        if (!shattered && done < total) {
            const seg = segments[done];
            const x1 = cx + seg[0] * scale;
            const y1 = cy + seg[1] * scale;
            const x2 = cx + seg[2] * scale;
            const y2 = cy + seg[3] * scale;
            const ang = Math.atan2(y2 - y1, x2 - x1);
            ctx.save();
            ctx.translate(x2, y2);
            ctx.rotate(ang);
            const len = Math.max(10, r * 0.26);
            ctx.lineWidth = Math.max(1.5, r * 0.022);
            ctx.strokeStyle = '#e5e7eb';
            ctx.shadowColor = '#f8fafc';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(-len, 0);
            ctx.lineTo(0, 0);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#94a3b8';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-r * 0.06, -r * 0.035);
            ctx.lineTo(-r * 0.06, r * 0.035);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(-len, 0, Math.max(1.5, r * 0.028), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function paintDalgonaCrack(ctx, cx, cy, r) {
        ctx.save();
        ctx.strokeStyle = '#1a1206';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 8;
        ctx.lineWidth = Math.max(2, r * 0.028);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.82, cy - r * 0.46);
        ctx.lineTo(cx - r * 0.26, cy - r * 0.10);
        ctx.lineTo(cx - r * 0.46, cy + r * 0.06);
        ctx.lineTo(cx + r * 0.06, cy + r * 0.26);
        ctx.lineTo(cx - r * 0.12, cy + r * 0.40);
        ctx.lineTo(cx + r * 0.66, cy + r * 0.78);
        ctx.stroke();
        ctx.lineWidth = Math.max(1, r * 0.012);
        ctx.strokeStyle = 'rgba(255,255,255,.22)';
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.80, cy - r * 0.44);
        ctx.lineTo(cx - r * 0.24, cy - r * 0.08);
        ctx.stroke();
        ctx.restore();
    }

    function paintDalgonaCandy(ctx, cx, cy, r, pattern, progress, total, cracks, status, opts) {
        const o = opts || {};
        const shattered = status === 'shattered';
        if (!shattered) {
            paintDalgonaBody(ctx, cx, cy, r, o);
            paintDalgonaPattern(ctx, cx, cy, r, pattern, progress, total, status, o);
            if (cracks >= 1) paintDalgonaCrack(ctx, cx, cy, r);
            return;
        }
        /* Two halves, pulled apart. Clip each half, then draw the dark gap. */
        const half = r * 1.24;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - half, cy - half, half * 2, half);
        ctx.clip();
        ctx.translate(0, -r * 0.075);
        paintDalgonaBody(ctx, cx, cy, r, o);
        paintDalgonaPattern(ctx, cx, cy, r, pattern, progress, total, status, o);
        paintDalgonaCrack(ctx, cx, cy, r);
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - half, cy, half * 2, half);
        ctx.clip();
        ctx.translate(0, r * 0.075);
        paintDalgonaBody(ctx, cx, cy, r, o);
        paintDalgonaPattern(ctx, cx, cy, r, pattern, progress, total, status, o);
        ctx.restore();
        ctx.strokeStyle = 'rgba(30,18,4,.85)';
        ctx.lineWidth = Math.max(3, r * 0.05);
        ctx.beginPath();
        ctx.moveTo(cx - r * 1.26, cy);
        ctx.lineTo(cx + r * 1.26, cy);
        ctx.stroke();
    }

    function dalgonaStatusColor(status) {
        if (status === 'finished') return { ring: '#34d399', glow: 'rgba(52,211,153,.55)' };
        if (status === 'shattered') return { ring: '#ef4444', glow: 'rgba(239,68,68,.5)' };
        if (status === 'danger') return { ring: '#f59e0b', glow: 'rgba(245,158,11,.55)' };
        return { ring: 'rgba(146,64,14,.65)', glow: 'rgba(253,224,71,.35)' };
    }

    function drawDalgonaDangerFrame(ctx, L, alpha) {
        ctx.save();
        ctx.strokeStyle = 'rgba(239,68,68,' + (alpha == null ? 0.85 : alpha) + ')';
        ctx.lineWidth = 5;
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 16;
        ctx.strokeRect(6, 6, L.w - 12, L.h - 12);
        ctx.restore();
    }

    /* Filled, tapered tongue ribbon from the cat's mouth (a) to the tip (b).
       Two curved sides plus a slightly squashed cap give the tongue real
       volume; `bow` bends it sideways so the swipe follows the candy path. */
    function lickTonguePath(ctx, ax, ay, bx, by, baseW, tipW, bow) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;
        const mx = (ax + bx) / 2 + nx * bow;
        const my = (ay + by) / 2 + ny * bow;
        const midW = baseW * 0.55 + tipW * 0.45;
        ctx.beginPath();
        ctx.moveTo(ax + nx * baseW, ay + ny * baseW);
        ctx.quadraticCurveTo(mx + nx * midW, my + ny * midW, bx + nx * tipW, by + ny * tipW);
        /* rounded tip, flattened a little by the contact pressure */
        ctx.quadraticCurveTo(bx + ux * tipW * 0.82, by + uy * tipW * 0.82,
            bx - nx * tipW, by - ny * tipW);
        ctx.quadraticCurveTo(mx - nx * midW, my - ny * midW, ax - nx * baseW, ay - ny * baseW);
        ctx.closePath();
    }

    /* Original stylised cat lick. The cat itself is the student's own
       LearniTY avatar (`DG.drawCatAvatar` via drawCat) peeking over the top
       edge of the tin; the tongue is a filled, tapered, wet-looking ribbon
       that reaches the candy, squashes on contact, swipes across the carved
       path and retracts. All shapes are canvas paths / gradients — no
       bitmaps, no external art. `t` is 0..1 across the one-second lick. */
    function drawCatLick(ctx, cx, cy, r, t, look) {
        const p = clamp(Number(t) || 0, 0, 1);
        const lk = look || {};
        const hr = Math.max(12, r * 0.27);
        const scale = hr / 33;
        const candyTop = cy - r;
        /* Head leans over the tin: its chin just crosses the top edge, so
           the tongue only has to travel a short, natural distance to the
           candy face. DG avatars put the head 91 * scale above the feet. */
        const headCY = candyTop + r * 0.04 - hr;
        const feetY = headCY + 91 * scale;
        const out = p < 0.24 ? smoothstep(p / 0.24)
            : (p > 0.78 ? 1 - smoothstep((p - 0.78) / 0.22) : 1);
        if (out <= 0.004) return;
        const swipe = -1 + 2 * smoothstep(clamp((p - 0.26) / 0.46, 0, 1));
        const lean = -0.10 + 0.07 * swipe;

        ctx.save();

        /* ---- the student's own cat, clipped at the tin's top edge ---- */
        ctx.save();
        ctx.beginPath();
        ctx.rect(-6000, -6000, 12000, 6000 + candyTop + r * 0.07);
        ctx.clip();
        ctx.translate(cx, headCY);
        ctx.rotate(lean);
        ctx.translate(-cx, -headCY);
        drawCat(ctx, cx, feetY, scale, lk, { preview: true });
        ctx.restore();

        /* ---- mouth (just under the avatar head) → candy contact ---- */
        const mouthDrop = hr * 0.62;
        const mouthX = cx - Math.sin(lean) * mouthDrop;
        const mouthY = headCY + Math.cos(lean) * mouthDrop;
        const contactX = cx + r * 0.34 * swipe;
        const contactY = candyTop + r * 0.40;
        const tipX = mouthX + (contactX - mouthX) * out;
        const tipY = mouthY + (contactY - mouthY) * out
            + Math.sin(p * Math.PI * 4) * r * 0.008 * out;
        const squash = clamp((out - 0.72) / 0.28, 0, 1);
        const baseW = Math.max(2.2, hr * 0.34) * (0.55 + 0.45 * out);
        const tipW = baseW * (0.95 + 0.55 * squash);
        const dx = tipX - mouthX;
        const dy = tipY - mouthY;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const bow = r * 0.05 * swipe * out;

        /* ---- wet smear on the candy where the tongue lands ---- */
        if (out > 0.55) {
            const wet = clamp((out - 0.55) / 0.45, 0, 1);
            ctx.save();
            ctx.globalAlpha = 0.26 + wet * 0.32;
            const smear = ctx.createRadialGradient(tipX, tipY, r * 0.01, tipX, tipY, r * 0.20);
            smear.addColorStop(0, 'rgba(255,251,235,.92)');
            smear.addColorStop(0.45, 'rgba(253,224,171,.46)');
            smear.addColorStop(1, 'rgba(253,224,171,0)');
            ctx.fillStyle = smear;
            ctx.beginPath();
            ctx.ellipse(tipX, tipY, r * (0.09 + 0.10 * wet), r * (0.05 + 0.04 * wet), 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        /* ---- fleshy tongue body ---- */
        lickTonguePath(ctx, mouthX, mouthY, tipX, tipY, baseW, tipW, bow);
        const flesh = ctx.createLinearGradient(
            mouthX - nx * baseW * 1.5, mouthY - ny * baseW * 1.5,
            mouthX + nx * baseW * 1.5, mouthY + ny * baseW * 1.5);
        flesh.addColorStop(0, '#b83b6d');
        flesh.addColorStop(0.30, '#d64f7d');
        flesh.addColorStop(0.60, '#ef6f95');
        flesh.addColorStop(0.88, '#ff9fb7');
        flesh.addColorStop(1, '#ffc2cf');
        ctx.fillStyle = flesh;
        ctx.fill();

        /* darker underside edge keeps the ribbon from reading flat */
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(150,38,84,.42)';
        ctx.lineWidth = Math.max(1, baseW * 0.30);
        ctx.beginPath();
        ctx.moveTo(mouthX + nx * baseW * 0.82, mouthY + ny * baseW * 0.82);
        ctx.quadraticCurveTo(
            (mouthX + tipX) / 2 + nx * (baseW * 0.55 + tipW * 0.45 + bow),
            (mouthY + tipY) / 2 + ny * (baseW * 0.55 + tipW * 0.45 + bow),
            tipX + nx * tipW * 0.82, tipY + ny * tipW * 0.82);
        ctx.stroke();
        ctx.restore();

        /* wet highlight streak down the centre */
        ctx.save();
        ctx.lineCap = 'round';
        const hx0 = mouthX + dx * 0.16;
        const hy0 = mouthY + dy * 0.16;
        const hx1 = mouthX + dx * 0.93;
        const hy1 = mouthY + dy * 0.93;
        ctx.strokeStyle = 'rgba(255,255,255,.40)';
        ctx.lineWidth = Math.max(1, baseW * (0.70 - 0.28 * squash));
        ctx.beginPath();
        ctx.moveTo(hx0 - nx * baseW * 0.28, hy0 - ny * baseW * 0.28);
        ctx.quadraticCurveTo(
            (hx0 + hx1) / 2 - nx * baseW * 0.34 + bow,
            (hy0 + hy1) / 2 - ny * baseW * 0.34 + bow,
            hx1 - nx * tipW * 0.22, hy1 - ny * tipW * 0.22);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.55)';
        ctx.lineWidth = Math.max(0.8, baseW * 0.22);
        ctx.beginPath();
        ctx.moveTo(hx0 - nx * baseW * 0.10, hy0 - ny * baseW * 0.10);
        ctx.quadraticCurveTo(
            (hx0 + hx1) / 2 - nx * baseW * 0.12 + bow,
            (hy0 + hy1) / 2 - ny * baseW * 0.12 + bow,
            hx1 - nx * tipW * 0.08, hy1 - ny * tipW * 0.08);
        ctx.stroke();
        ctx.restore();

        /* glossy tip that presses into the candy */
        const tipGloss = ctx.createRadialGradient(
            tipX - nx * tipW * 0.30, tipY - ny * tipW * 0.30, tipW * 0.12,
            tipX, tipY, tipW * 1.08);
        tipGloss.addColorStop(0, 'rgba(255,246,249,.82)');
        tipGloss.addColorStop(0.55, 'rgba(255,190,212,.32)');
        tipGloss.addColorStop(1, 'rgba(255,150,180,0)');
        ctx.fillStyle = tipGloss;
        ctx.beginPath();
        ctx.ellipse(tipX, tipY, tipW * 1.02, tipW * (0.72 + 0.24 * (1 - squash)),
            Math.atan2(dy, dx), 0, Math.PI * 2);
        ctx.fill();

        /* ---- modest wet sparkle at the contact point ---- */
        if (squash > 0.18) {
            ctx.save();
            ctx.globalAlpha = 0.30 + squash * 0.42;
            ctx.fillStyle = '#fffbe8';
            for (let i = 0; i < 2; i++) {
                const ang = -0.75 + i * 1.1;
                ctx.beginPath();
                ctx.arc(tipX + Math.cos(ang) * r * 0.10, tipY + Math.sin(ang) * r * 0.07,
                    Math.max(1.1, r * 0.016), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
        ctx.restore();
    }

    /* Student Round 4 composition. The tin lives in the free rectangle
       between the HUD (top) and the question pad (bottom). `padBottom` is
       measured live from #ps-question; when the pad is hidden (or the
       client could not measure it) a conservative portrait reserve keeps
       the candy out of the letter keys instead of under them. */
    const R4_HEAD_BAND = 0.50;   // leaning-cat head above the candy, × r

    R.round4PlayerCandyLayout = function (L, s) {
        const layout = L || R.layout(390, 844, 'player');
        const r4 = (s && s.round4) || {};
        let padBottom = Number(r4.padBottom);
        if (!isFinite(padBottom) || padBottom < 0) padBottom = 0;
        const measured = padBottom > 0;
        if (!measured) padBottom = layout.h * (layout.landscape ? 0.26 : 0.38);
        /* In landscape the pad sits in the bottom-left corner, so it only
           needs to claim that corner: cap the reserve and bias the tin to
           the right of it instead of shrinking it to nothing. */
        padBottom = clamp(padBottom, 0, layout.h * (layout.landscape ? 0.30 : 0.62));
        const top = layout.hud + Math.max(4, layout.h * 0.01);
        const bottom = Math.max(top + 60, layout.h - padBottom - 6);
        const freeH = Math.max(60, bottom - top);
        const widthCap = layout.w * (layout.landscape ? 0.19 : 0.36);
        const heightCap = (freeH * 0.98) / (2 + R4_HEAD_BAND);
        const r = Math.max(30, Math.min(widthCap, heightCap, layout.h * 0.30, 210));
        const cx = layout.w / 2 + (layout.landscape ? layout.w * 0.06 : 0);
        const cy = top + r * R4_HEAD_BAND + r;
        return {
            cx: cx,
            cy: cy,
            r: r,
            top: top,
            bottom: bottom,
            candyTop: cy - r,
            candyBottom: cy + r,
            headBand: r * R4_HEAD_BAND,
            padBottom: padBottom,
            measured: measured
        };
    };

    function drawRound4Player(ctx, L, s) {
        const r4 = s.round4 || {};
        const st = r4.me || {};
        const status = String(st.status || 'carving');
        const pattern = String(st.pattern || '');
        const total = Math.max(1, Number(st.total) || Number(st.units && st.units.length) || 1);
        const progress = Math.max(0, Math.min(total, Number(st.progress) || 0));
        const cracks = Math.max(0, Number(st.cracks) || 0);
        const lickAnim = (typeof st.lickAnim === 'number' && st.lickAnim >= 0 && st.lickAnim <= 1)
            ? st.lickAnim : null;
        /* While the cat's tongue is still swiping, the newest carved dash is
           held back so the fill lands as the tongue passes it. */
        const shownProgress = lickAnim != null && lickAnim < 0.55
            ? Math.max(0, progress - 1) : progress;
        const candy = R.round4PlayerCandyLayout(L, s);
        const cx = candy.cx;
        const cy = candy.cy;
        const r = candy.r;
        const look = (r4.me && r4.me.look) || {};

        ctx.save();
        /* Student phone view is deliberately text-light: the candy itself is
           the HUD. No title pill, no counter pill, no long status caption. */
        glow(ctx, cx, cy, r * 2.1, '#fff3c4', 0.20);
        paintDalgonaCandy(ctx, cx, cy, r, pattern, shownProgress, total, cracks, status, {});

        if (lickAnim != null && status !== 'finished' && status !== 'shattered') {
            drawCatLick(ctx, cx, cy, r, lickAnim, look);
        }

        /* At most one very short visual tag for the end states. */
        if (status === 'finished' || status === 'shattered') {
            const tag = status === 'finished' ? '✅' : '💥';
            pill(ctx, cx, Math.min(cy + r * 1.34, L.h - 24), tag, {
                size: Math.max(18, Math.min(30, L.w * (L.landscape ? 0.03 : 0.07))),
                bg: status === 'finished' ? 'rgba(6,78,59,.84)' : 'rgba(69,10,10,.84)',
                color: '#fff7ed',
                border: status === 'finished' ? 'rgba(52,211,153,.65)' : 'rgba(248,113,113,.65)'
            });
        }
        if (status === 'shattered') {
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = '#1c0a02';
            ctx.fillRect(0, L.hud, L.w, L.h - L.hud);
            ctx.restore();
        }
        if (status === 'danger') drawDalgonaDangerFrame(ctx, L, 0.65 + 0.25 * Math.sin((Number(s.now) || 0) / 160));
        ctx.restore();
    }

    function drawRound4Host(ctx, L, s) {
        const r4 = s.round4 || {};
        const board = Array.isArray(r4.board) ? r4.board.filter(function (row) {
            return row && row.is_playing !== false;
        }) : [];
        const top = L.hud + 10;
        const bottom = L.h - 10;
        const availH = Math.max(40, bottom - top);
        if (!board.length) {
            pill(ctx, L.w / 2, top + 20, 'Round 4 · waiting for the tug winners', {
                size: Math.max(10, Math.min(15, L.w * 0.02)), bg: 'rgba(69,26,3,.8)', color: '#fde68a'
            });
            return;
        }
        const n = board.length;
        let cols;
        if (L.landscape) cols = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(n * 1.7))));
        else cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(n))));
        const rows = Math.max(1, Math.ceil(n / cols));
        const padX = 14;
        const cellW = (L.w - padX * 2) / cols;
        const cellH = availH / rows;
        const radius = Math.max(18, Math.min(cellW * 0.30, cellH * 0.30, 62));

        pill(ctx, L.w / 2, top + 12, 'ROUND 4 · ' + n + ' CARVERS · LIVE CLASS GRID', {
            size: Math.max(9, Math.min(14, L.w * (L.landscape ? 0.014 : 0.03))),
            bg: 'rgba(69,26,3,.82)', color: '#fde68a', border: 'rgba(251,191,36,.5)'
        });
        const gridTop = top + 30;
        const gridH = Math.max(20, bottom - gridTop);
        const ch = gridH / rows;

        board.forEach(function (row, i) {
            const col = i % cols;
            const rr = Math.floor(i / cols);
            const cx = padX + cellW * (col + 0.5);
            const cy = gridTop + ch * (rr + 0.5) - ch * 0.06;
            const status = row.status_key || 'carving';
            const total = Math.max(1, Number(row.total) || 1);
            const progress = Math.max(0, Math.min(total, Number(row.progress) || 0));
            const colors = dalgonaStatusColor(status);

            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius * 1.48, 0, Math.PI * 2);
            ctx.fillStyle = colors.glow;
            ctx.globalAlpha = status === 'shattered' ? 0.16 : 0.34;
            ctx.fill();
            ctx.restore();

            paintDalgonaCandy(ctx, cx, cy, radius, row.pattern, progress, total, row.cracks, status, { small: true });

            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius * 1.10, 0, Math.PI * 2);
            ctx.lineWidth = status === 'finished' ? 4 : 2.5;
            ctx.strokeStyle = colors.ring;
            ctx.stroke();
            ctx.restore();

            const nameSize = Math.max(8, Math.min(13, cellW * 0.105));
            pill(ctx, cx, cy - radius * 1.34, row.name || 'Player', {
                size: nameSize, bg: 'rgba(30,18,4,.78)', color: '#fef3c7', border: colors.ring
            });
            const statusLabel = status === 'finished' ? '✅ Finished'
                : (status === 'shattered' ? '💥 Shattered'
                    : (status === 'danger' ? '⚡ Danger' : '🔪 Carving'));
            pill(ctx, cx, cy + radius * 1.14, (row.pattern_label || 'Candy') + ' · ' + progress + '/' + total, {
                size: Math.max(7, Math.min(12, cellW * 0.095)),
                bg: 'rgba(30,18,4,.74)', color: '#fde68a', border: colors.ring
            });
            pill(ctx, cx, cy + radius * 1.52, statusLabel, {
                size: Math.max(7, Math.min(11, cellW * 0.088)),
                bg: status === 'shattered' ? 'rgba(69,10,10,.8)'
                    : (status === 'finished' ? 'rgba(6,78,59,.8)' : 'rgba(69,26,3,.75)'),
                color: status === 'shattered' ? '#fecaca' : (status === 'finished' ? '#a7f3d0' : '#fde68a')
            });
        });
    }

    R.drawCatLick = drawCatLick;

    R.drawRound4 = function (ctx, state) {
        if (!ctx) return;
        const s = state || {};
        const L = R.layout(s.w, s.h, s.role);
        const host = String(s.role || '') === 'host';
        const patternKey = host && s.round4 && Array.isArray(s.round4.board)
            ? s.round4.board.map(function (row) { return row.pattern || ''; }).join(',')
            : String((s.round4 && s.round4.me && s.round4.me.pattern) || '');

        drawCached(ctx, L, 'dalgona-bg:' + (s.role || 'player') + ':' + (L.landscape ? 'l' : 'p') + ':' + patternKey,
            function (paint) { dalgonaSand(paint, L); });

        if (host) drawRound4Host(ctx, L, s);
        else drawRound4Player(ctx, L, s);

        /* vignette keeps the candy the brightest thing on screen */
        const vig = ctx.createRadialGradient(L.w / 2, L.h * 0.5, L.w * 0.30, L.w / 2, L.h * 0.5, L.w * 0.92);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(46,24,4,.48)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, L.w, L.h);

        if (host) {
            ctx.save();
            pill(ctx, 14, L.hud + 16, 'Dalgona Candy Carving', {
                size: Math.max(9, Math.min(13, L.w * (L.landscape ? 0.011 : 0.027))), align: 'left'
            });
            ctx.restore();
        }
    };

    /* ================================================================== */
    /* Round 5 — Grammar Finals arena                                     */
    /*                                                                    */
    /* Original stylised 3D: a circular arena inside an electric fence.   */
    /* finals_progress 100 sits near the safe centre; 0 is the fence.     */
    /* Ghost cats stand outside. No photographic assets are used.         */
    /* ================================================================== */

    function finalsAngle(row) {
        return mix01('finals-angle:' + String((row && row.user_id) || '')) * Math.PI * 2;
    }

    function finalsRadius(progress) {
        const p = clamp(Number(progress) || 0, 0, 100) / 100;
        /* progress 100 -> inner safe ring, progress 0 -> outer fence */
        return lerp(8.4, 2.1, p);
    }

    function drawElectricFence(ctx, cam, radius, t) {
        const posts = 28;
        let prev = null;
        for (let i = 0; i <= posts; i++) {
            const a = (i / posts) * Math.PI * 2;
            const x = Math.cos(a) * radius;
            const z = Math.sin(a) * radius + 4.2;
            const p = project(cam, x, 0, z);
            if (p) {
                if (prev) {
                    line3(ctx, cam, [prev.x, prev.y, prev.z], [x, 0, z], {
                        stroke: 'rgba(103,232,249,.30)', lineWidth: 1.2
                    });
                }
                prev = { x: x, z: z, y: 0 };
            }
            if (i % 2 === 0) {
                const h = 1.15 + Math.sin(t * 0.004 + i) * 0.06;
                line3(ctx, cam, [x, 0, z], [x, h, z], {
                    stroke: '#67e8f9', lineWidth: 2
                });
                const top = project(cam, x, h, z);
                if (top) glow(ctx, top.x, top.y, 14, '#22d3ee', 0.38);
            }
        }
        /* crackling arcs along the fence */
        for (let i = 0; i < 9; i++) {
            const seed = hash01('finals-arc:' + i + ':' + Math.floor(t / 160));
            const a = seed * Math.PI * 2;
            const x = Math.cos(a) * radius;
            const z = Math.sin(a) * radius + 4.2;
            const top = project(cam, x, 1.05, z);
            if (!top) continue;
            ctx.save();
            ctx.strokeStyle = 'rgba(165,243,252,.72)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(top.x - 10, top.y + 4);
            ctx.lineTo(top.x - 3, top.y - 3);
            ctx.lineTo(top.x + 4, top.y + 2);
            ctx.lineTo(top.x + 11, top.y - 5);
            ctx.stroke();
            ctx.restore();
        }
    }

    R.drawRound5 = function (ctx, state) {
        if (!ctx) return;
        const s = state || {};
        const L = R.layout(s.w, s.h, s.role);
        const host = String(s.role || '') === 'host';
        const r5 = s.round5 || {};
        const board = (Array.isArray(r5.board) ? r5.board : []).filter(function (row) { return row && row.user_id; });
        const ghosts = (Array.isArray(r5.ghosts) ? r5.ghosts : []).filter(function (row) { return row && row.user_id; });
        const now = Number(s.now) || 0;

        ctx.save();
        const sky = ctx.createLinearGradient(0, 0, 0, L.h);
        sky.addColorStop(0, '#0b1026');
        sky.addColorStop(0.52, '#161b3f');
        sky.addColorStop(1, '#050711');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, L.w, L.h);

        glow(ctx, L.w * 0.5, L.h * 0.30, Math.max(L.w, L.h) * 0.42, '#38bdf8', 0.16);
        glow(ctx, L.w * 0.16, L.h * 0.45, Math.max(L.w, L.h) * 0.22, '#a855f7', 0.11);
        glow(ctx, L.w * 0.86, L.h * 0.45, Math.max(L.w, L.h) * 0.22, '#f472b6', 0.10);

        const cam = makeCam(L, host
            ? { eye: [0, L.landscape ? 12.5 : 9.4, -5.4], target: [0, 0.2, 4.6], fov: 58 }
            : { eye: [0, L.landscape ? 6.2 : 4.8, -6.8], target: [0, 0.4, 4.4], fov: 62 });

        /* Arena floor: a wide oval stone platform. */
        const floorPts = [];
        const RING = 42;
        for (let i = 0; i < RING; i++) {
            const a = (i / RING) * Math.PI * 2;
            floorPts.push([Math.cos(a) * 9.6, 0, Math.sin(a) * 9.6 + 4.2]);
        }
        poly3(ctx, cam, floorPts, { fill: '#1e293b', stroke: 'rgba(148,163,184,.22)', lineWidth: 1 });
        poly3(ctx, cam, floorPts.map(function (p) { return [p[0] * 0.62, 0.02, p[2] * 0.62 + 1.6]; }), {
            fill: 'rgba(30,41,59,.82)'
        });

        /* Safe-centre ring and progress rings. */
        [[2.1, 'rgba(52,211,153,.42)'], [4.4, 'rgba(250,204,21,.16)'], [6.6, 'rgba(248,113,113,.16)']].forEach(function (ring) {
            const pts = [];
            for (let i = 0; i < RING; i++) {
                const a = (i / RING) * Math.PI * 2;
                pts.push([Math.cos(a) * ring[0], 0.04, Math.sin(a) * ring[0] + 4.2]);
            }
            poly3(ctx, cam, pts, { stroke: ring[1], lineWidth: 1.4, close: true });
        });

        drawElectricFence(ctx, cam, 8.4, now);

        /* Ink splat on the student's own covered question. */
        if (r5.me && r5.me.ink && !host) {
            ctx.save();
            ctx.globalAlpha = 0.88;
            ctx.fillStyle = '#0f172a';
            const cx = L.w * 0.5;
            const cy = L.h * 0.48;
            for (let i = 0; i < 9; i++) {
                const a = i / 9 * Math.PI * 2;
                const rr = L.w * (0.12 + hash01('ink:' + i) * 0.08);
                ell(ctx, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.55,
                    L.w * 0.14, L.w * 0.10);
            }
            ell(ctx, cx, cy, L.w * 0.34, L.h * 0.17);
            ctx.restore();
        }

        const catScale = Math.max(0.55, Math.min(1.2, L.h / 680));

        /* Ghosts are behind / outside the fence. */
        ghosts.forEach(function (row, i) {
            const a = finalsAngle(row) + 0.7 + i * 0.31;
            const radius = 9.8 + (i % 3) * 0.55;
            const x = Math.cos(a) * radius;
            const z = Math.sin(a) * radius + 4.2;
            drawCatAt(ctx, cam, x, 0, z, catScale * 0.82, row.look, {
                ghost: true, alpha: 0.50, ring: false
            });
            const p = project(cam, x, 1.1, z);
            if (p && host) pill(ctx, p.x, p.y - 14, '👻 ' + String(row.name || 'Ghost').slice(0, 12), {
                size: Math.max(7, Math.min(11, L.w * 0.011)),
                bg: 'rgba(15,23,42,.72)', color: '#c4b5fd'
            });
        });

        const playerRow = board.find(function (row) { return row.isMe; }) || null;
        const living = board.filter(function (row) { return !row.eliminated; });
        let show = host ? living : living.slice(0, 12);
        if (!host && playerRow && !show.some(function (row) { return row.isMe; })) {
            show = show.slice(0, 11).concat(playerRow);
        }
        const ordered = show.slice().sort(function (a, b) {
            return (Number(b.progress) || 0) - (Number(a.progress) || 0);
        });

        ordered.forEach(function (row, index) {
            const a = finalsAngle(row);
            const radius = finalsRadius(row.progress);
            const x = Math.cos(a) * radius;
            const z = Math.sin(a) * radius + 4.2;
            const colour = row.isMe ? '#fde68a' : (index === 0 ? '#fca5a5' : '#a5f3fc');
            drawCatAt(ctx, cam, x, 0, z, catScale, row.look, {
                ring: true,
                ringColor: colour,
                halo: row.isMe,
                haloColor: row.isMe ? '#fbbf24' : '#38bdf8'
            });
            const p = project(cam, x, 1.15, z);
            if (!p) return;
            const label = host
                ? String(row.name || 'Player').slice(0, 14) + ' · ' + Math.round(row.progress)
                : (row.isMe ? 'YOU · ' + Math.round(row.progress) : String(row.name || 'Player').slice(0, 12));
            pill(ctx, p.x, p.y - 18, label, {
                size: Math.max(7, Math.min(12, L.w * (L.landscape ? 0.011 : 0.026))),
                bg: row.isMe ? 'rgba(113,63,18,.88)' : 'rgba(8,15,31,.74)',
                color: row.isMe ? '#fef3c7' : '#e0f2fe',
                border: row.isMe ? 'rgba(251,191,36,.8)' : 'rgba(56,189,248,.35)'
            });
            if (row.combo >= 3) {
                pill(ctx, p.x, p.y + 2, '🐾 ' + row.combo, {
                    size: Math.max(7, Math.min(10, L.w * 0.010)),
                    bg: 'rgba(124,45,18,.8)', color: '#fed7aa'
                });
            }
            if (host && row.ink) {
                ctx.save();
                ctx.globalAlpha = 0.82;
                ctx.fillStyle = '#0f172a';
                ell(ctx, p.x, p.y - 2, Math.max(12, L.w * 0.025), Math.max(7, L.w * 0.012));
                ctx.restore();
                pill(ctx, p.x, p.y - 30, '🖤 ink', {
                    size: Math.max(7, Math.min(10, L.w * 0.010)),
                    bg: 'rgba(49,46,129,.85)', color: '#e0e7ff'
                });
            }
        });

        /* Paw-wave arcs when any cat is on a combo. */
        living.forEach(function (row) {
            if ((Number(row.combo) || 0) < 3) return;
            const a = finalsAngle(row);
            const radius = finalsRadius(row.progress);
            const p = project(cam, Math.cos(a) * radius, 0.5, Math.sin(a) * radius + 4.2);
            if (!p) return;
            ctx.save();
            ctx.strokeStyle = 'rgba(253,186,116,.42)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 18 + (row.combo % 3) * 8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        });

        if (host) {
            pill(ctx, L.w / 2, L.hud + 16, 'ROUND 5 · GRAMMAR FINALS · ' + living.length + ' STILL IN', {
                size: Math.max(9, Math.min(14, L.w * (L.landscape ? 0.014 : 0.028))),
                bg: 'rgba(12,74,110,.82)', color: '#a5f3fc', border: 'rgba(34,211,238,.5)'
            });
            if (r5.remainingMs != null) {
                pill(ctx, L.w - 16, L.hud + 16, PSEngineLabelClock(r5.remainingMs), {
                    size: Math.max(9, Math.min(13, L.w * 0.012)),
                    bg: 'rgba(8,15,31,.8)', color: '#fef3c7', align: 'right'
                });
            }
        } else if (playerRow) {
            pill(ctx, L.w / 2, L.h - 14, '⚡ ' + Math.round(playerRow.progress)
                + ' · combo ' + (playerRow.combo || 0) + '/3 · stay away from the fence', {
                size: Math.max(8, Math.min(12, L.w * (L.landscape ? 0.013 : 0.025))),
                bg: 'rgba(8,15,31,.78)', color: '#a5f3fc', border: 'rgba(34,211,238,.35)'
            });
        }

        const vig = ctx.createRadialGradient(L.w / 2, L.h * 0.5, L.w * 0.22, L.w / 2, L.h * 0.5, L.w * 0.9);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(2,6,23,.66)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, L.w, L.h);
        ctx.restore();
    };

    /* Local clock label (the renderer does not depend on the engine). */
    function PSEngineLabelClock(ms) {
        const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
        const m = Math.floor(total / 60);
        const s = total % 60;
        return '⏱ ' + m + ':' + (s < 10 ? '0' : '') + s;
    }

    /* ================================================================== */
    /* Prize ceremony — original 3D podium                                */
    /* ================================================================== */

    R.drawCeremony = function (ctx, state) {
        if (!ctx) return;
        const s = state || {};
        const w = Math.max(1, Number(s.w) || 800);
        const h = Math.max(1, Number(s.h) || 600);
        const L = R.layout(w, h, s.role || 'player');
        const elapsed = Math.max(0, Number(s.ceremonyElapsed) || 0);
        const rise = smoothstep(Math.min(1, elapsed / 800));

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        /* theatre / playground hall backdrop */
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#160d2b');
        sky.addColorStop(0.52, '#2a1440');
        sky.addColorStop(1, '#0b0714');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        glow(ctx, w * 0.5, h * 0.22, Math.max(w, h) * 0.5, '#f472b6', 0.13);
        glow(ctx, w * 0.18, h * 0.3, Math.max(w, h) * 0.32, '#60a5fa', 0.1);
        glow(ctx, w * 0.82, h * 0.3, Math.max(w, h) * 0.32, '#fbbf24', 0.1);

        const cam = makeCam(L, {
            eye: [0, L.landscape ? 3.4 : 3.0, L.landscape ? -8.4 : -9.4],
            target: [0, 1.9, 5.2],
            fov: L.landscape ? 60 : 66
        });

        /* stage floor + back wall */
        poly3(ctx, cam, [[-16, 0, -2], [16, 0, -2], [16, 0, 15], [-16, 0, 15]], {
            fill: '#1a1024'
        });
        poly3(ctx, cam, [[-16, 0, 15], [16, 0, 15], [16, 12, 15], [-16, 12, 15]], {
            fill: '#120a1d'
        });
        for (let i = -2; i <= 2; i++) {
            line3(ctx, cam, [i * 6, 0.02, -2], [i * 6, 0.02, 15], {
                stroke: 'rgba(251,191,36,.08)', lineWidth: 1
            });
        }

        /* spotlights */
        const beam = (x, color, alpha) => {
            poly3(ctx, cam, [
                [x, 10, 12], [x - 1.6, 0, 4], [x + 1.6, 0, 4]
            ], { fill: rgba(color, alpha), close: true });
        };
        beam(-5.2, '#93c5fd', 0.09);
        beam(0, '#fef08a', 0.12);
        beam(5.2, '#fca5a5', 0.09);

        const ceremony = Array.isArray(s.ceremony) ? s.ceremony : [];
        const byPlace = {};
        ceremony.forEach(row => {
            if (row && row.place >= 1 && row.place <= 3) byPlace[row.place] = row;
        });
        const playersById = {};
        (Array.isArray(s.players) ? s.players : []).forEach(p => {
            if (p && (p.user_id || p.id)) playersById[String(p.user_id || p.id)] = p;
        });

        /* Keep all three stands clear of the HTML ranking card (which is
           docked on the right in landscape). The group shifts left on wide
           screens and is pulled in on phones so 2nd/3rd stay on screen. */
        const groupShift = L.landscape ? -2.6 : 0;
        const spread = L.landscape ? 4.3 : 3.1;
        const specs = [
            { place: 2, x: groupShift - spread, z: 5.0, height: 1.55, base: '#b7c2d0', top: '#e2e8f0', side: '#8f9bab' },
            { place: 1, x: groupShift, z: 6.3, height: 2.35, base: '#d4a017', top: '#fde68a', side: '#b47c0b' },
            { place: 3, x: groupShift + spread, z: 5.0, height: 1.15, base: '#b9773a', top: '#f3c08a', side: '#8c5527' }
        ];

        specs.forEach((spec, index) => {
            const podH = Math.max(0.05, spec.height * rise);
            const boxW = 2.9;
            box3(ctx, cam, {
                x: spec.x - boxW / 2,
                y: 0,
                z: spec.z,
                w: boxW,
                h: podH,
                d: 2.6,
                color: spec.base,
                top: spec.top,
                side: spec.side,
                edge: 'rgba(8,4,18,.42)',
                lineWidth: 0.8
            });

            /* gold / silver trim */
            const trim = spec.place === 1 ? '#fde047' : (spec.place === 2 ? '#e2e8f0' : '#fdba74');
            line3(ctx, cam, [spec.x - boxW / 2, podH, spec.z], [spec.x + boxW / 2, podH, spec.z], {
                stroke: trim, lineWidth: 2
            });
            line3(ctx, cam, [spec.x - boxW / 2, 0.12, spec.z], [spec.x + boxW / 2, 0.12, spec.z], {
                stroke: rgba(trim, 0.5), lineWidth: 1
            });

            const label = spec.place === 1 ? '1' : (spec.place === 2 ? '2' : '3');
            const anchor = project(cam, spec.x, podH * 0.62, spec.z + 0.02);
            if (anchor) {
                pill(ctx, anchor.x, anchor.y, label, {
                    size: Math.max(10, Math.min(20, h * 0.024)),
                    bg: rgba(trim, 0.92),
                    color: '#241407',
                    border: 'rgba(255,255,255,.6)'
                });
            }

            const row = byPlace[spec.place];
            if (!row || rise < 0.45) return;
            const lookRow = playersById[String(row.user_id)] || row;

            const cat = drawCatAt(
                ctx, cam,
                spec.x, podH + 1.28, spec.z + 0.35,
                Math.max(0.55, h / 620),
                {
                    cat: lookRow.cat || 'Ginger',
                    glasses: lookRow.glasses || 'None',
                    hat: lookRow.hat || 'None',
                    outfit: lookRow.outfit || 'None'
                },
                { ring: true, ringColor: trim, halo: spec.place === 1, haloColor: '#fde047' }
            );
            if (cat) {
                pill(ctx, cat.x, cat.y + 22, row.nickname || 'Player', {
                    size: Math.max(9, Math.min(14, h * 0.018)),
                    bg: 'rgba(8,12,24,.78)',
                    color: '#f8fafc',
                    border: rgba(trim, 0.55)
                });
                if (row.paws) {
                    pill(ctx, cat.x, cat.y + 23 + Math.max(18, h * 0.026), '+' + row.paws + ' 🐾', {
                        size: Math.max(8, Math.min(12, h * 0.016)),
                        bg: 'rgba(190,24,93,.72)',
                        color: '#fff1f2'
                    });
                }
            }
        });

        /* falling confetti, deterministic from the elapsed time */
        const count = L.landscape ? 26 : 34;
        for (let i = 0; i < count; i++) {
            const seed = hash01('ceremony-confetti-' + i);
            const x = ((seed * w * 1.4 + elapsed * (0.012 + seed * 0.02)) % (w + 40)) - 20;
            const y = ((hash01('ceremony-y-' + i) * h * 1.4 + elapsed * (0.03 + seed * 0.05)) % (h + 30)) - 15;
            const size = 2 + seed * 3;
            ctx.save();
            ctx.globalAlpha = 0.55 + seed * 0.35;
            ctx.fillStyle = i % 3 === 0 ? '#fbbf24' : (i % 3 === 1 ? '#f472b6' : '#93c5fd');
            ctx.translate(x, y);
            ctx.rotate(elapsed * 0.001 + seed * 6.28);
            ctx.fillRect(-size, -size / 2, size * 2, size);
            ctx.restore();
        }

        ctx.restore();
    };

    /* ================================================================== */
    /* Public dispatcher / lobby helper                                   */
    /* ================================================================== */

    R.drawScene = function (ctx, state) {
        if (!ctx) return;
        const s = state || {};
        ctx.clearRect(0, 0, s.w || ctx.canvas.width, s.h || ctx.canvas.height);
        if (s.mode === 'ceremony' || s.status === 'finished') {
            R.drawCeremony(ctx, s);
        } else if (s.mode === 'intro' || Number(s.round) === 0) {
            R.drawIntro(ctx, s);
        } else if (Number(s.round) === 5 || (s.round5 && (s.round5.me || s.round5.board))) {
            R.drawRound5(ctx, s);
        } else if (Number(s.round) === 4 || (s.round4 && (s.round4.me || s.round4.board))) {
            R.drawRound4(ctx, s);
        } else if (Number(s.round) === 3) {
            R.drawRound3(ctx, s);
        } else if (Number(s.round) === 2) {
            R.drawRound2(ctx, s);
        } else {
            R.drawRound1(ctx, s);
        }
    };

    /* Small animated cat portrait used by the lobby waiting list. */
    R.drawLobbyCat = function (ctx, x, y, scale, look) {
        if (!ctx) return;
        drawCat(ctx, x, y, scale, look || {}, {});
    };

    /* Exposed for tests / debugging. */
    R.makeCamera = makeCam;
    R.projectPoint = project;

    root.PSRender = R;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

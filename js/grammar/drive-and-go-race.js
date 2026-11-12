/* LearniTY Dictation — Drive & Go! race engine.
   Pseudo-3D 3-lane Mario-Kart-style track, gates, items, CPU rivals and the
   HUD. Loaded as a classic script after drive-and-go.js. The multiplayer
   lobby/sync helpers live in drive-and-go-multiplayer.js. */

(function () {
    'use strict';

    const DG = window.DG;
    const LANES = [0, 1, 2];
    const CPU_NAMES = ['Turbo Tabby', 'Nitro Noodle', 'Mochi Zoom', 'Rocket Whiskers'];
    const RESULT_HOLD = 0.85;

    const S = {
        active: false,
        raf: 0,
        lastTs: 0,
        clock: 0,
        phase: 'idle',
        paused: false,
        mode: 'single',
        bankMode: 'av',
        opts: null,
        room: null,
        questions: [],
        qIndex: 0,
        activeQ: null,
        gates: [],
        gatesResolved: false,
        gateDist: 0,
        nextGateAt: 0,
        nextGateDist: 0,
        lastResult: null,
        player: null,
        rivals: [],
        bananas: [],
        finishDistance: DG.FINISH_DISTANCE,
        raceSeconds: DG.RACE_SECONDS,
        startedAtMs: 0,
        trackSeed: 1,
        scenery: [],
        sceneryNextZ: 0,
        countdown: 3.2,
        toastTimer: 0,
        toastUntil: 0,
        flashUntil: 0,
        moveNotice: '',
        hudDirty: true,
        timeUpSent: false,
        finishSent: false,
        resultShown: false,
        tilt: { enabled: false, zero: null, active: false, left: false, right: false, lastAt: 0, timer: 0, warned: false },
        swipe: { down: false, x: 0 },
        listeners: []
    };
    DG.raceState = S;

    /* ---------------- mount / teardown ---------------- */

    DG.raceEls = null;

    DG.mountRace = function () {
        const stage = document.getElementById('dg-stage');
        const canvas = document.getElementById('dg-canvas');
        const overlay = document.getElementById('dg-overlay');
        if (!stage || !canvas || !overlay) return false;
        DG.raceEls = {
            stage, canvas, overlay,
            question: document.getElementById('dg-question-text'),
            options: document.getElementById('dg-options'),
            score: document.getElementById('dg-stat-score'),
            combo: document.getElementById('dg-stat-combo'),
            speed: document.getElementById('dg-stat-speed'),
            pos: document.getElementById('dg-stat-pos'),
            time: document.getElementById('dg-stat-time'),
            toast: document.getElementById('dg-toast'),
            itemBtn: document.getElementById('dg-item-btn'),
            itemEmoji: document.getElementById('dg-item-emoji'),
            itemName: document.getElementById('dg-item-name')
        };
        DG.resizeCanvas();
        DG.bindRaceInput();
        return true;
    };

    DG.resizeCanvas = function () {
        if (!DG.raceEls) return;
        const stage = DG.raceEls.stage;
        const canvas = DG.raceEls.canvas;
        const w = stage.clientWidth || window.innerWidth || 420;
        const h = stage.clientHeight || window.innerHeight || 720;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        DG.view = { w, h, dpr };
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    DG.startRace = function (opts) {
        DG.stopRace();
        const settings = DG.readSettings();
        const mode = opts.mode === 'multi' ? 'multi' : 'single';
        const bankMode = opts.bankMode || settings.bankMode;
        const bank = DG.bankCache[bankMode] || [];
        if (!bank.length) {
            DG.showLoadError(bankMode, new Error('The question bank is not loaded yet.'));
            return;
        }
        S.opts = Object.assign({}, opts, { mode, bankMode });
        S.active = true;
        S.raf = 0;
        S.lastTs = 0;
        S.clock = 0;
        S.phase = 'countdown';
        S.paused = false;
        S.mode = mode;
        S.bankMode = bankMode;
        S.room = opts.room || null;
        S.questions = DG.raceQuestionQueue(bankMode, opts.seed);
        S.qIndex = 0;
        S.activeQ = null;
        S.gates = [];
        S.gatesResolved = false;
        S.gateDist = DG.START_GATE_DIST;
        S.nextGateAt = 0;
        S.nextGateDist = 0;
        S.lastResult = null;
        S.bananas = [];
        S.finishDistance = Number(opts.room && opts.room.finish_distance) || DG.FINISH_DISTANCE;
        S.raceSeconds = Number(opts.room && opts.room.duration_seconds) || DG.RACE_SECONDS;
        S.startedAtMs = opts.room && opts.room.started_at ? Date.parse(opts.room.started_at) : 0;
        // Multiplayer racers share the room seed so everyone sees the same
        // curves, hills and roadside scenery. Single-player gets a fresh
        // start-of-run seed.
        S.trackSeed = opts.seed != null ? (Number(opts.seed) >>> 0)
            : ((Math.random() * 0xffffffff) >>> 0);
        S.scenery = [];
        S.sceneryNextZ = 0;
        S.countdown = 3.2;
        S.toastUntil = 0;
        S.flashUntil = 0;
        S.moveNotice = '';
        S.hudDirty = true;
        S.timeUpSent = false;
        S.finishSent = false;
        S.resultShown = false;
        S.player = {
            lane: 1, laneX: 1, dist: 0, speed: 0, score: 0, combo: 0, maxCombo: 0,
            correct: 0, wrong: 0, item: null, spinUntil: 0, slowUntil: 0,
            nitroUntil: 0, boostUntil: 0, starUntil: 0, shrinkUntil: 0,
            finished: false, finishAt: 0, look: DG.currentLook(), name: currentUser && currentUser.email ? currentUser.email.split('@')[0] : 'You'
        };
        S.rivals = [];
        if (mode === 'single') {
            const count = 2 + Math.floor(Math.random() * 3);
            const used = {};
            for (let i = 0; i < count; i++) {
                const cat = DG.CATS[(i + 1 + Math.floor(Math.random() * 4)) % DG.CATS.length];
                used[cat] = true;
                S.rivals.push({
                    remote: false,
                    name: CPU_NAMES[i % CPU_NAMES.length],
                    look: DG.normalizeLook({
                        cat,
                        glasses: i % 3 === 0 ? 'Sunglasses' : (i % 3 === 1 ? 'Glasses' : 'None'),
                        hat: i === 1 ? 'Crown' : (i === 2 ? 'Party Hat' : 'None'),
                        outfit: DG.OUTFITS[(i + 1) % DG.OUTFITS.length]
                    }),
                    dist: Math.max(0, 20 - i * 14 + Math.random() * 16),
                    speed: 60 + Math.random() * 25,
                    lane: i % 3,
                    laneX: i % 3,
                    skill: 96 + Math.random() * 22,
                    spinUntil: 0,
                    slowUntil: 0,
                    finished: false
                });
            }
        } else if (typeof DG.mpSyncRivals === 'function') {
            DG.mpSyncRivals(opts.players || [], true);
        }

        changeView('drive-and-go-view');
        document.body.classList.add('dg-racing');
        const raceView = document.getElementById('drive-and-go-view');
        if (raceView) raceView.classList.add('dg-live');
        if (!DG.mountRace()) {
            DG.toast('The race view could not be opened.');
            return;
        }
        DG.spawnGates();
        DG.updateRaceHud(true);
        DG.showOverlay('', true);
        if (mode === 'multi' && typeof DG.mpStartRacePoll === 'function') DG.mpStartRacePoll();
        S.lastTs = 0;
        S.raf = requestAnimationFrame(DG.raceFrame);
    };

    DG.stopRace = function () {
        const wasActive = S.active;
        S.active = false;
        S.phase = 'idle';
        S.paused = false;
        if (S.raf) cancelAnimationFrame(S.raf);
        S.raf = 0;
        DG.unbindRaceInput();
        if (typeof DG.mpStopRacePoll === 'function') DG.mpStopRacePoll();
        document.body.classList.remove('dg-racing');
        const raceView = document.getElementById('drive-and-go-view');
        if (raceView) raceView.classList.remove('dg-live');
        DG.hideOverlay();
        if (DG.raceEls && DG.raceEls.toast) DG.raceEls.toast.classList.remove('show');
        if (wasActive) S.player = null;
    };

    DG.exitRace = function () {
        DG.stopRace();
        changeView('grammar-revision-view');
    };

    DG.restartRace = function () {
        const opts = S.opts ? Object.assign({}, S.opts) : null;
        if (!opts || opts.mode !== 'single') {
            DG.exitRace();
            return;
        }
        DG.startRace(opts);
    };

    /* ---------------- game loop ---------------- */

    DG.raceFrame = function (ts) {
        if (!S.active) return;
        if (!S.lastTs) S.lastTs = ts;
        let dt = (ts - S.lastTs) / 1000;
        S.lastTs = ts;
        if (!isFinite(dt) || dt < 0) dt = 0;
        if (dt > 0.1) dt = 0.1;
        if (!S.paused) {
            const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
            const step = dt / steps;
            for (let i = 0; i < steps; i++) DG.updateRace(step);
        }
        DG.drawRace();
        DG.updateRaceHud(false);
        S.raf = requestAnimationFrame(DG.raceFrame);
    };

    DG.updateRace = function (dt) {
        S.clock += dt;
        if (S.phase === 'countdown') {
            S.countdown -= dt;
            if (S.countdown <= 0) {
                S.phase = 'racing';
                DG.toast('GO!', 900);
            }
            return;
        }
        if (S.phase !== 'racing') return;
        const p = S.player;
        if (!p) return;
        const now = S.clock;

        // Player speed: 100 km/h base, faster with combo, slower while spun.
        const spinning = now < p.spinUntil;
        const slowed = now < p.slowUntil;
        let target = 100 + Math.min(45, p.combo * 3);
        if (now < p.nitroUntil) target += DG.NITRO_KMH * Math.max(0, (p.nitroUntil - now) / 1.2);
        if (now < p.boostUntil) target += 45;
        if (slowed) target *= 0.5;
        if (spinning) target = 0;
        const accel = spinning ? 7 : 2.3;
        p.speed += (target - p.speed) * Math.min(1, dt * accel);
        if (p.speed < 0) p.speed = 0;
        if (p.speed > 340) p.speed = 340;
        p.dist += p.speed * (1000 / 3600) * dt;
        p.laneX += (p.lane - p.laneX) * Math.min(1, dt * 12);

        // Rivals
        for (let i = 0; i < S.rivals.length; i++) {
            const r = S.rivals[i];
            if (r.remote) {
                r.dist += ((r.targetDist == null ? r.dist : r.targetDist) - r.dist) * Math.min(1, dt * 2.6);
                r.laneX += ((r.targetLane == null ? r.lane : r.targetLane) - r.laneX) * Math.min(1, dt * 8);
                continue;
            }
            let rt = r.skill + Math.min(28, Math.max(0, p.combo) * 1.2);
            if (now < r.spinUntil) rt = 0;
            else if (now < r.slowUntil) rt *= 0.5;
            const gap = r.dist - p.dist;
            if (gap < -170) rt += 28;
            else if (gap > 230) rt -= 22;
            r.speed += (rt - r.speed) * Math.min(1, dt * 1.6);
            if (r.speed < 0) r.speed = 0;
            r.dist += r.speed * (1000 / 3600) * dt;
            r.laneX += (r.lane - r.laneX) * Math.min(1, dt * 4);
        }

        // Bananas left behind by the player.
        for (let i = 0; i < S.bananas.length; i++) {
            const b = S.bananas[i];
            if (b.hit) continue;
            for (let j = 0; j < S.rivals.length; j++) {
                const r = S.rivals[j];
                if (r.dist >= b.dist && r.dist <= b.dist + 42 && r.lane === b.lane) {
                    b.hit = true;
                    r.spinUntil = Math.max(r.spinUntil, now + DG.SPIN_TIME);
                    DG.toast('🍌 ' + r.name + ' spun out!', 1400);
                    break;
                }
            }
        }
        S.bananas = S.bananas.filter(b => !b.hit && b.dist > p.dist - 120);

        // Gate crossing.
        if (!S.gatesResolved && S.gates.length && p.dist >= S.gateDist) {
            DG.answerGate(p.lane);
        }
        if (S.gatesResolved && S.nextGateAt && now >= S.nextGateAt) {
            S.gateDist = Math.max(S.nextGateDist, p.dist + 300);
            DG.spawnGates();
        }

        // Multiplayer timer.
        if (S.mode === 'multi') {
            const left = DG.raceTimeLeft();
            if (left <= 0 && !S.timeUpSent) {
                S.timeUpSent = true;
                if (typeof DG.mpTimeUp === 'function') DG.mpTimeUp();
            }
            if (!p.finished && p.dist >= S.finishDistance) {
                p.finished = true;
                p.finishAt = now;
                DG.toast('🏁 Finish!', 1800);
                if (!S.finishSent && typeof DG.mpCrossFinish === 'function') {
                    S.finishSent = true;
                    DG.mpCrossFinish();
                }
            }
        }

        DG.recordBest(p.score, p.dist);
    };

    DG.raceTimeLeft = function () {
        if (!S.startedAtMs) return S.raceSeconds;
        const elapsed = (Date.now() - S.startedAtMs) / 1000;
        return Math.max(0, S.raceSeconds - elapsed);
    };

    /* ---------------- questions / gates ---------------- */

    DG.spawnGates = function () {
        if (!S.questions.length) return;
        if (S.qIndex >= S.questions.length) {
            S.questions = DG.raceQuestionQueue(S.bankMode, S.mode === 'multi' && S.opts ? S.opts.seed : null);
            S.qIndex = 0;
        }
        const q = S.questions[S.qIndex++];
        S.activeQ = q;
        let rng = Math.random;
        if (S.mode === 'multi' && S.opts && S.opts.seed != null) {
            rng = DG.makeRng((Number(S.opts.seed) ^ DG.hashString(q.id)) >>> 0);
        }
        const gates = DG.gatesFor(q, S.bankMode, rng);
        S.gates = gates.map(g => ({
            label: g.label,
            lane: g.lane,
            correct: g.correct,
            dist: S.gateDist
        }));
        S.gatesResolved = false;
        S.lastResult = null;
        S.nextGateAt = 0;
        S.hudDirty = true;
        DG.updateRaceHud(true);
    };

    DG.answerGate = function (lane) {
        if (!S.activeQ || S.gatesResolved || !S.gates.length) return;
        const p = S.player;
        const correctGate = S.gates.find(g => g.correct);
        if (!correctGate) return;
        const correct = Number(lane) === correctGate.lane;
        S.gatesResolved = true;
        S.lastResult = { correct, lane: Number(lane), correctLane: correctGate.lane };
        const now = S.clock;
        if (correct) {
            p.combo += 1;
            p.maxCombo = Math.max(p.maxCombo, p.combo);
            p.correct += 1;
            p.score += 100 + Math.min(150, p.combo * 10);
            p.speed = Math.min(340, p.speed + DG.NITRO_KMH);
            p.nitroUntil = now + 1.2;
            const rank = DG.playerRank();
            const item = DG.itemForCorrect({
                item: p.item,
                combo: p.combo,
                challenging: !!S.activeQ.challenging,
                rank
            }, Math.random);
            if (item) {
                p.item = item;
                DG.toast('✅ +' + DG.NITRO_KMH + ' km/h · ' + DG.ITEM_EMOJI[item] + ' ' + DG.ITEM_NAME[item], 1600);
            } else {
                DG.toast('✅ +' + DG.NITRO_KMH + ' km/h', 1100);
            }
            DG.recordBest(p.score, p.dist);
        } else {
            p.combo = 0;
            p.wrong += 1;
            p.score = Math.max(0, p.score - 25);
            p.speed = Math.min(p.speed, 25);
            p.spinUntil = now + DG.SPIN_TIME;
            DG.toast('❌ Correct: ' + correctGate.label, 2200);
        }
        S.nextGateDist = Math.max(S.gateDist + DG.GATE_GAP, p.dist + 300);
        S.nextGateAt = now + RESULT_HOLD;
        S.hudDirty = true;
        DG.updateRaceHud(true);
        DG.updateItemSlot();
    };

    DG.playerRank = function () {
        if (!S.player) return 1;
        const list = [S.player].concat(S.rivals || []);
        list.sort((a, b) => (b.dist || 0) - (a.dist || 0));
        return Math.max(1, list.indexOf(S.player) + 1);
    };

    DG.raceTarget = function (direction) {
        if (!S.player) return null;
        const ahead = direction !== 'behind';
        const list = (S.rivals || []).filter(r => ahead ? r.dist > S.player.dist + 2 : r.dist < S.player.dist - 2);
        list.sort((a, b) => ahead ? a.dist - b.dist : b.dist - a.dist);
        return list[0] || null;
    };

    /* ---------------- controls ---------------- */

    DG.setLane = function (lane) {
        if (!S.active || S.phase !== 'racing' || S.paused) return;
        const n = Math.max(0, Math.min(2, Number(lane)));
        S.player.lane = n;
    };

    DG.steer = function (dir) {
        if (!S.active || S.phase !== 'racing' || S.paused) return;
        DG.setLane(S.player.lane + (dir < 0 ? -1 : 1));
    };

    DG.onKeyDown = function (e) {
        if (!S.active) return;
        const key = e.key;
        if (key === 'ArrowLeft' || key === 'a' || key === 'A') { DG.steer(-1); e.preventDefault(); }
        else if (key === 'ArrowRight' || key === 'd' || key === 'D') { DG.steer(1); e.preventDefault(); }
        else if (key === 'ArrowDown' || key === 's' || key === 'S') { DG.setLane(1); e.preventDefault(); }
        else if (key === ' ' || key === 'Enter') { DG.useItem(); e.preventDefault(); }
        else if (key === 'p' || key === 'P' || key === 'Escape') { DG.togglePause(); e.preventDefault(); }
    };

    DG.onTilt = function (e) {
        if (!S.active || S.paused || S.phase !== 'racing') return;
        const reading = DG.tiltReading(e);
        if (!isFinite(reading)) return;
        S.tilt.lastAt = Date.now();
        if (S.tilt.zero == null) S.tilt.zero = reading;
        let delta = reading - S.tilt.zero;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        const dead = 4.5;
        const fire = 9;
        if (delta < -fire && !S.tilt.left) {
            S.tilt.left = true; S.tilt.right = false; DG.steer(-1);
        } else if (delta > fire && !S.tilt.right) {
            S.tilt.right = true; S.tilt.left = false; DG.steer(1);
        } else if (Math.abs(delta) < dead) {
            S.tilt.left = false; S.tilt.right = false;
        }
    };

    DG.tiltReading = function (e) {
        const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
        const portrait = Math.abs(angle) % 180 === 0;
        const value = portrait ? e.gamma : e.beta;
        return Number(value);
    };

    DG.onPointerDown = function (e) {
        if (!S.active || S.paused) return;
        if (e.target && e.target.closest && e.target.closest('button')) return;
        S.swipe.down = true;
        S.swipe.x = e.clientX;
    };

    DG.onPointerUp = function (e) {
        if (!S.active || !S.swipe.down) return;
        S.swipe.down = false;
        const dx = e.clientX - S.swipe.x;
        if (Math.abs(dx) < 32) return;
        DG.steer(dx < 0 ? -1 : 1);
    };

    DG.onResize = function () {
        if (!S.active) return;
        DG.resizeCanvas();
    };

    DG.bindRaceInput = function () {
        DG.unbindRaceInput();
        const add = (target, type, fn, opts) => {
            if (!target) return;
            target.addEventListener(type, fn, opts);
            S.listeners.push({ target, type, fn, opts });
        };
        add(window, 'keydown', DG.onKeyDown);
        add(window, 'resize', DG.onResize);
        if (DG.raceEls) {
            add(DG.raceEls.stage, 'pointerdown', DG.onPointerDown);
            add(DG.raceEls.stage, 'pointerup', DG.onPointerUp);
            add(DG.raceEls.stage, 'pointercancel', DG.onPointerUp);
        }
        const settings = DG.readSettings();
        if (settings.controls === 'tilt') {
            S.tilt.enabled = true;
            S.tilt.zero = null;
            S.tilt.active = false;
            S.tilt.left = false;
            S.tilt.right = false;
            S.tilt.lastAt = Date.now();
            add(window, 'deviceorientation', DG.onTilt);
            S.tilt.timer = window.setTimeout(() => {
                if (!S.active) return;
                if (Date.now() - S.tilt.lastAt > 1400) {
                    S.tilt.warned = true;
                    DG.toast('Tilt sensor not available — use LEFT / CENTER / RIGHT.', 3200);
                }
            }, 1800);
        } else {
            S.tilt.enabled = false;
        }
    };

    DG.unbindRaceInput = function () {
        S.listeners.forEach(item => {
            try { item.target.removeEventListener(item.type, item.fn, item.opts); } catch (e) {}
        });
        S.listeners = [];
        if (S.tilt.timer) { clearTimeout(S.tilt.timer); S.tilt.timer = 0; }
        S.tilt.enabled = false;
        S.tilt.zero = null;
        S.tilt.left = false;
        S.tilt.right = false;
        S.swipe.down = false;
    };

    /* ---------------- items ---------------- */

    DG.useItem = function () {
        if (!S.active || S.phase !== 'racing' || S.paused || !S.player) return;
        const p = S.player;
        const kind = p.item;
        if (!kind) {
            DG.toast('No item yet — answer a question correctly.', 1400);
            return;
        }
        const now = S.clock;
        if (kind === 'redshell') {
            const target = DG.raceTarget('ahead');
            if (!target) {
                DG.toast('No racer ahead — keep the red shell.', 1500);
                return;
            }
            p.item = null;
            target.spinUntil = Math.max(target.spinUntil || 0, now + 2);
            DG.remoteEffect(target, 'spin', 2000);
            DG.toast('🔴 Red shell hit ' + target.name + '!', 1600);
        } else if (kind === 'banana') {
            p.item = null;
            S.bananas.push({ dist: Math.max(0, p.dist - 18), lane: p.lane, hit: false });
            const target = DG.raceTarget('behind');
            if (target) {
                target.spinUntil = Math.max(target.spinUntil || 0, now + DG.SPIN_TIME);
                DG.remoteEffect(target, 'spin', DG.SPIN_TIME * 1000);
                DG.toast('🍌 ' + target.name + ' spun out!', 1600);
            } else {
                DG.toast('🍌 Banana dropped behind you.', 1300);
            }
        } else if (kind === 'lightning') {
            p.item = null;
            p.shrinkUntil = now + 4.5;
            S.flashUntil = now + 0.45;
            let hit = 0;
            S.rivals.forEach(r => {
                r.slowUntil = Math.max(r.slowUntil || 0, now + 4.5);
                if (r.remote) DG.remoteEffect(r, 'slow', 4500);
                hit++;
            });
            DG.toast('⚡ Lightning! ' + hit + ' rival' + (hit === 1 ? '' : 's') + ' slowed.', 1800);
        } else if (kind === 'star') {
            p.item = null;
            p.starUntil = Math.max(p.starUntil, now + 6);
            p.boostUntil = Math.max(p.boostUntil, now + 5);
            DG.toast('⭐ Star power! Invincible + boost.', 1600);
        } else if (kind === 'mushroom') {
            p.item = null;
            p.boostUntil = Math.max(p.boostUntil, now + 3);
            p.speed = Math.min(340, p.speed + 18);
            DG.toast('🍄 Mushroom boost!', 1400);
        }
        DG.updateItemSlot();
    };

    DG.remoteEffect = function (target, kind, ms) {
        if (S.mode !== 'multi' || !target || !target.userId) return;
        if (typeof DG.mpApplyEffect === 'function') DG.mpApplyEffect(target.userId, kind, ms);
    };

    DG.receiveEffect = function (kind, seconds) {
        if (!S.active || !S.player) return;
        const p = S.player;
        if (S.clock < p.starUntil) return; // star immunity
        if (kind === 'spin') {
            p.spinUntil = Math.max(p.spinUntil, S.clock + seconds);
            p.speed = Math.min(p.speed, 20);
            p.combo = 0;
            DG.toast('💥 Hit! You spun out.', 1600);
        } else if (kind === 'slow') {
            p.slowUntil = Math.max(p.slowUntil, S.clock + seconds);
            p.shrinkUntil = Math.max(p.shrinkUntil, S.clock + seconds);
            S.flashUntil = S.clock + 0.4;
            DG.toast('⚡ Lightning! Question text shrunk.', 1600);
        }
        DG.updateRaceHud(true);
    };

    DG.updateItemSlot = function () {
        const els = DG.raceEls;
        if (!els || !S.player) return;
        const item = S.player.item;
        if (els.itemEmoji) els.itemEmoji.textContent = item ? DG.ITEM_EMOJI[item] : '—';
        if (els.itemName) els.itemName.textContent = item ? DG.ITEM_NAME[item].toUpperCase() : 'ITEM';
        if (els.itemBtn) {
            els.itemBtn.classList.toggle('empty', !item);
            els.itemBtn.setAttribute('aria-label', item ? 'Use ' + DG.ITEM_NAME[item] : 'No item');
            els.itemBtn.title = item ? DG.ITEM_HELP[item] : 'Answer correctly to earn an item';
        }
    };

    /* ---------------- HUD ---------------- */

    DG.updateRaceHud = function (force) {
        const els = DG.raceEls;
        const p = S.player;
        if (!els || !p || !S.active) return;
        const q = S.activeQ;
        const qText = q ? q.prompt : 'Get ready…';
        if (force || els.question.textContent !== qText) {
            els.question.textContent = qText;
        }
        if (q && (force || S.hudDirty)) {
            els.options.innerHTML = S.gates.map(g => {
                let cls = 'dg-option-chip';
                if (S.gatesResolved) {
                    if (g.correct) cls += ' dg-good';
                    else if (S.lastResult && g.lane === S.lastResult.lane && !S.lastResult.correct) cls += ' dg-bad';
                }
                return '<div class="' + cls + '"><b>' + ['LEFT', 'CENTER', 'RIGHT'][g.lane] + '</b>' + DG.esc(g.label) + '</div>';
            }).join('');
            S.hudDirty = false;
        }
        if (!q) els.options.innerHTML = '';
        els.score.textContent = '⭐ ' + Math.floor(p.score);
        els.combo.textContent = '🔥 x' + p.combo;
        els.speed.textContent = Math.round(p.speed) + ' km/h';
        els.pos.textContent = DG.ordinal(DG.playerRank());
        if (S.mode === 'multi') {
            const left = DG.raceTimeLeft();
            const m = Math.floor(left / 60);
            const sec = Math.floor(left % 60);
            els.time.classList.remove('hidden');
            els.time.textContent = m + ':' + (sec < 10 ? '0' : '') + sec;
        } else if (els.time) {
            els.time.classList.add('hidden');
        }
        const shrunk = S.clock < p.shrinkUntil;
        els.question.classList.toggle('dg-shrunk', shrunk);
        DG.updateItemSlot();
    };

    DG.toast = function (text, ms) {
        const el = DG.raceEls && DG.raceEls.toast;
        if (!el) return;
        el.textContent = text;
        el.classList.add('show');
        if (S.toastTimer) clearTimeout(S.toastTimer);
        S.toastTimer = setTimeout(() => {
            el.classList.remove('show');
        }, ms || 1600);
    };

    /* ---------------- overlays ---------------- */

    DG.showOverlay = function (html, quiet) {
        const overlay = DG.raceEls && DG.raceEls.overlay;
        if (!overlay) return;
        if (!html) {
            overlay.innerHTML = '';
            overlay.classList.add('hidden');
            return;
        }
        overlay.innerHTML = '<div class="dg-panel">' + html + '</div>';
        overlay.classList.remove('hidden');
        if (!quiet) overlay.scrollTop = 0;
    };

    DG.hideOverlay = function () {
        const overlay = DG.raceEls && DG.raceEls.overlay;
        if (!overlay) return;
        overlay.innerHTML = '';
        overlay.classList.add('hidden');
    };

    DG.togglePause = function () {
        if (!S.active || S.phase === 'finished') return;
        S.paused = !S.paused;
        if (S.paused) {
            DG.showOverlay(
                '<div class="text-center"><div class="text-6xl mb-2">⏸</div><h3 class="text-2xl font-bold text-orange-600 mb-2">Paused</h3>' +
                '<p class="text-gray-500 font-bold mb-5">' + (S.mode === 'multi' ? 'The 3-minute race clock keeps running for everyone.' : 'Take a breath. Your run is waiting.') + '</p>' +
                '<div class="flex gap-3 justify-center flex-wrap">' +
                '<button type="button" class="btn-paw" onclick="DG.togglePause()">Resume</button>' +
                (S.mode === 'multi'
                    ? '<button type="button" class="dg-menu-button" onclick="DG.mpLeaveRace()">Leave race</button>'
                    : '<button type="button" class="dg-menu-button" onclick="DG.endRun()">End run</button>') +
                '</div></div>'
            );
        } else {
            DG.hideOverlay();
            S.lastTs = 0;
        }
    };

    DG.endRun = function () {
        if (S.phase === 'finished') return;
        S.phase = 'finished';
        S.paused = false;
        if (S.raf) cancelAnimationFrame(S.raf);
        S.raf = 0;
        S.resultShown = true;
        DG.unbindRaceInput();
        if (S.mode === 'multi') {
            if (typeof DG.mpLeaveRace === 'function') DG.mpLeaveRace();
            return;
        }
        const p = S.player;
        DG.recordBest(p.score, p.dist);
        const bestScore = DG.readBestScore();
        const bestDistance = DG.readBestDistance();
        DG.showOverlay(
            '<div class="text-center"><div class="text-6xl mb-1">🏁</div>' +
            '<h3 class="text-3xl font-bold text-orange-600 mb-1">Run finished</h3>' +
            '<p class="text-gray-400 font-bold mb-4">' + DG.esc(DG.MODE_LABEL[S.bankMode] || '') + '</p>' +
            '<div class="dg-result-grid mb-5">' +
            '<div><span>Score</span><b>' + Math.floor(p.score) + '</b></div>' +
            '<div><span>Max combo</span><b>x' + p.maxCombo + '</b></div>' +
            '<div><span>Correct</span><b>' + p.correct + '</b></div>' +
            '<div><span>Wrong</span><b>' + p.wrong + '</b></div>' +
            '<div><span>Distance</span><b>' + Math.floor(p.dist) + ' m</b></div>' +
            '<div><span>Top speed</span><b>' + Math.round(p.speed) + ' km/h</b></div>' +
            '</div>' +
            '<p class="text-sm font-bold text-gray-500 mb-5">Personal best: ' + bestScore + ' pts · ' + bestDistance + ' m</p>' +
            '<div class="flex gap-3 justify-center flex-wrap">' +
            '<button type="button" class="btn-paw" onclick="DG.restartRace()">Race again</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.exitRace()">Back to Tenses</button>' +
            '</div></div>'
        );
    };

    DG.showMultiplayerResults = function (room, players) {
        if (S.resultShown) return;
        S.resultShown = true;
        S.phase = 'finished';
        S.paused = false;
        if (S.raf) cancelAnimationFrame(S.raf);
        S.raf = 0;
        DG.unbindRaceInput();
        if (typeof DG.mpStopRacePoll === 'function') DG.mpStopRacePoll();
        const rows = (players || []).slice().sort((a, b) => {
            const fa = a.finished_at ? Date.parse(a.finished_at) : Infinity;
            const fb = b.finished_at ? Date.parse(b.finished_at) : Infinity;
            if (fa !== fb) return fa - fb;
            if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
            return (b.distance || 0) - (a.distance || 0);
        });
        const winnerId = room && room.winner_id;
        let winner = rows.find(r => r.user_id === winnerId);
        if (!winner) winner = rows[0];
        const youWin = winner && currentUser && winner.user_id === currentUser.id;
        const reason = room && room.result_reason === 'time'
            ? 'The 3-minute limit ended — highest score wins.'
            : 'First across the finish line wins.';
        const medal = (i) => i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : (i + 1) + '.'));
        DG.showOverlay(
            '<div class="text-center"><div class="text-6xl mb-1">' + (youWin ? '🏆' : '🏁') + '</div>' +
            '<h3 class="text-3xl font-bold ' + (youWin ? 'text-amber-600' : 'text-orange-600') + ' mb-1">' +
            (youWin ? 'You win!' : DG.esc((winner && DG.mpPlayerName(winner)) || 'Race finished') + ' wins!') + '</h3>' +
            '<p class="text-sm font-bold text-gray-500 mb-4">' + DG.esc(reason) + '</p>' +
            '<div class="dg-standings mb-5">' + rows.map((r, i) =>
                '<div class="dg-standing' + (currentUser && r.user_id === currentUser.id ? ' me' : '') + '">' +
                '<span class="dg-medal">' + medal(i) + '</span>' +
                '<span class="dg-who">' + DG.esc(DG.mpPlayerName(r)) + '</span>' +
                '<span class="dg-points">' + (r.score || 0) + ' pts</span>' +
                '<span class="dg-dist">' + Math.floor(r.distance || 0) + ' m</span>' +
                '</div>').join('') + '</div>' +
            '<button type="button" class="btn-paw" onclick="DG.exitRace()">Back to Tenses</button></div>'
        );
    };

    /* ---------------- drawing ---------------- */

    // Deterministic pseudo-3D course. World Z is the driver's distance in
    // metres. trackCurve()/trackHill() are smooth sums of sines; their
    // seed-derived phases give every racer in a room the same route without
    // storing any track data.
    const CAM_DEPTH = 420;
    const FAR_REL = 2400;
    const NEAR_REL = 4;
    const HORIZON_BASE = 0.30;
    const ROAD_BOTTOM = 0.96;
    const SEGMENT_COUNT = 96;
    const SCENERY_STEP = 26;
    const SCENERY_AHEAD = 1500;
    const SCENERY_BEHIND = 90;
    const SCENERY_KINDS = {
        city: ['building', 'building', 'lamp', 'sign', 'car', 'tree'],
        open: ['tree', 'tree', 'tree', 'lamp', 'sign']
    };

    DG.trackSeedValue = function () {
        if (S.mode === 'multi' && S.opts && S.opts.seed != null) return Number(S.opts.seed) >>> 0;
        return (S.trackSeed || 1) >>> 0;
    };

    DG.trackPhases = function () {
        const seed = DG.trackSeedValue();
        const cache = DG._trackPhaseCache || (DG._trackPhaseCache = { seed: -1, phases: [0, 0, 0] });
        if (cache.seed === seed) return cache.phases;
        cache.seed = seed;
        cache.phases = [
            (seed % 6283) / 1000,
            ((seed >>> 10) % 6283) / 1000,
            ((seed >>> 21) % 6283) / 1000
        ];
        return cache.phases;
    };

    // Track heading (radians) relative to a straight road.
    DG.trackCurve = function (z) {
        const ph = DG.trackPhases();
        return 0.62 * Math.sin(z * 0.0016 + ph[0]) +
            0.26 * Math.sin(z * 0.0038 + ph[1]) +
            0.10 * Math.sin(z * 0.0091 + ph[2]);
    };

    // Antiderivative of trackCurve(): lateral road position at world Z.
    DG.trackLateral = function (z) {
        const ph = DG.trackPhases();
        return -0.62 / 0.0016 * Math.cos(z * 0.0016 + ph[0]) -
            0.26 / 0.0038 * Math.cos(z * 0.0038 + ph[1]) -
            0.10 / 0.0091 * Math.cos(z * 0.0091 + ph[2]);
    };

    // Road elevation (world units) at world Z.
    DG.trackHill = function (z) {
        const ph = DG.trackPhases();
        return 34 * Math.sin(z * 0.0011 + ph[0] * 0.7) +
            15 * Math.sin(z * 0.0027 + ph[1] * 1.4) +
            5 * Math.sin(z * 0.0063 + ph[2] * 2.1);
    };

    DG.trackHorizonY = function () {
        const h = DG.view.h;
        const camZ = S.player ? S.player.dist : 0;
        const cache = DG._horizonCache || (DG._horizonCache = { camZ: null, h: 0, y: 0 });
        if (cache.camZ === camZ && cache.h === h) return cache.y;
        const slope = (DG.trackHill(camZ + 260) - DG.trackHill(camZ)) / 260;
        const pitch = Math.max(-1, Math.min(1, slope * 900));
        cache.camZ = camZ;
        cache.h = h;
        cache.y = h * HORIZON_BASE - pitch * h * 0.04;
        return cache.y;
    };

    // Core projection for a point `rel` world units in front of the camera.
    // Lane 0/1/2 (or a fractional laneX) is returned in screen space.
    DG.projectRel = function (rel, lane) {
        const w = DG.view.w, h = DG.view.h;
        const camZ = S.player ? S.player.dist : 0;
        const r = Math.max(-40, Number(rel) || 0);
        const raw = 1 / (1 + Math.max(0, r) / CAM_DEPTH);
        const rawFar = 1 / (1 + FAR_REL / CAM_DEPTH);
        const persp = (raw - rawFar) / (1 - rawFar);
        const horizonY = DG.trackHorizonY();
        const bottom = h * ROAD_BOTTOM;
        const elev = DG.trackHill(camZ + r) - DG.trackHill(camZ);
        const y = horizonY + (bottom - horizonY) * persp - elev * h * 0.0022 * persp;
        const lat = (DG.trackLateral(camZ + r) - DG.trackLateral(camZ)) -
            DG.trackCurve(camZ) * r;
        const centerX = w / 2 + lat * (w / 180) * persp;
        const roadHalf = w * (0.02 + 0.49 * persp);
        const laneN = lane == null ? 1 : lane;
        return {
            x: centerX + (laneN - 1) * roadHalf * 0.64,
            y: y,
            scale: persp,
            roadHalf: roadHalf,
            centerX: centerX
        };
    };

    DG.project = function (rel, lane) {
        return DG.projectRel(rel, lane);
    };

    /* ---------------- roadside scenery ---------------- */

    DG.ensureScenery = function (camZ) {
        if (!S.scenery) S.scenery = [];
        if (!S.sceneryNextZ || S.sceneryNextZ < camZ - SCENERY_BEHIND) {
            S.sceneryNextZ = camZ - SCENERY_BEHIND;
        }
        const limit = camZ + SCENERY_AHEAD;
        while (S.sceneryNextZ < limit) {
            const z = S.sceneryNextZ;
            S.sceneryNextZ += SCENERY_STEP;
            const rng = DG.makeRng((DG.hashString('dg-scenery') ^ DG.trackSeedValue() ^ Math.floor(z * 13)) >>> 0);
            const city = 0.5 + 0.5 * Math.sin(z * 0.0013 + DG.trackPhases()[0]) > 0.48;
            const kinds = city ? SCENERY_KINDS.city : SCENERY_KINDS.open;
            for (let s = 0; s < 2; s++) {
                const side = s === 0 ? -1 : 1;
                if (rng() > (city ? 0.82 : 0.48)) continue;
                const kind = kinds[Math.floor(rng() * kinds.length)];
                let offset = 1.5 + rng() * 0.9;
                if (kind === 'lamp') offset = 1.28 + rng() * 0.14;
                else if (kind === 'car') offset = 1.26 + rng() * 0.2;
                else if (kind === 'building') offset = 1.6 + rng() * 1.1;
                S.scenery.push({
                    z: z + rng() * SCENERY_STEP * 0.8,
                    side: side,
                    kind: kind,
                    offset: offset,
                    size: 0.72 + rng() * 0.7,
                    tone: Math.floor(rng() * 3)
                });
            }
        }
        S.scenery = S.scenery.filter(it => it.z > camZ - SCENERY_BEHIND);
    };

    DG.drawSceneryItem = function (ctx, it, x, baseY, sc, w, h) {
        const size = it.size;
        if (it.kind === 'building') {
            const bw = w * 0.13 * sc * size;
            const bh = h * 0.34 * sc * size;
            if (bw < 2 || bh < 3) return;
            const top = baseY - bh;
            const tones = ['#64748b', '#7c8794', '#55606f'];
            ctx.fillStyle = tones[it.tone % tones.length];
            ctx.fillRect(x - bw / 2, top, bw, bh);
            ctx.fillStyle = 'rgba(15,23,42,.35)';
            ctx.fillRect(x - bw / 2, top, bw * 0.18, bh);
            ctx.fillStyle = '#334155';
            ctx.fillRect(x - bw / 2 - 1.5 * sc, top - 3 * sc, bw + 3 * sc, Math.max(1, 3 * sc));
            if (bw > 16 && bh > 28) {
                const cols = Math.min(4, Math.max(1, Math.floor(bw / 12)));
                const rows = Math.min(6, Math.max(1, Math.floor(bh / 20)));
                const gapX = bw / (cols + 1);
                const gapY = bh / (rows + 1);
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        ctx.fillStyle = ((r + c + it.tone) % 3 === 0)
                            ? 'rgba(253,224,71,.85)' : 'rgba(15,23,42,.45)';
                        ctx.fillRect(x - bw / 2 + gapX * (c + 1) - bw * 0.045,
                            top + gapY * (r + 1) - bh * 0.018,
                            bw * 0.09, bh * 0.036);
                    }
                }
            }
            return;
        }
        if (it.kind === 'tree') {
            const trunkW = Math.max(1, w * 0.009 * sc * size);
            const trunkH = h * 0.11 * sc * size;
            const r = w * 0.055 * sc * size;
            ctx.fillStyle = '#78350f';
            ctx.fillRect(x - trunkW / 2, baseY - trunkH, trunkW, trunkH);
            ctx.fillStyle = it.tone === 0 ? '#166534' : (it.tone === 1 ? '#15803d' : '#14532d');
            ctx.beginPath();
            ctx.arc(x, baseY - trunkH - r * 0.2, r, 0, Math.PI * 2);
            ctx.arc(x - r * 0.7, baseY - trunkH + r * 0.25, r * 0.72, 0, Math.PI * 2);
            ctx.arc(x + r * 0.7, baseY - trunkH + r * 0.25, r * 0.72, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        if (it.kind === 'lamp') {
            const poleH = h * 0.17 * sc * size;
            const poleW = Math.max(1, 2.2 * sc);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = poleW;
            ctx.beginPath();
            ctx.moveTo(x, baseY);
            ctx.lineTo(x, baseY - poleH);
            ctx.stroke();
            ctx.fillStyle = '#fde68a';
            ctx.beginPath();
            ctx.arc(x, baseY - poleH, Math.max(1.5, 3.4 * sc), 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        if (it.kind === 'sign') {
            const bw = w * 0.095 * sc * size;
            const bh = h * 0.052 * sc * size;
            if (bw < 2 || bh < 2) return;
            const postH = h * 0.05 * sc;
            const postW = Math.max(1, 1.6 * sc);
            ctx.fillStyle = '#64748b';
            ctx.fillRect(x - postW / 2, baseY - postH, postW, postH);
            ctx.fillStyle = it.tone === 0 ? '#0ea5e9' : (it.tone === 1 ? '#22c55e' : '#f59e0b');
            ctx.fillRect(x - bw / 2, baseY - postH - bh, bw, bh);
            ctx.strokeStyle = 'rgba(255,255,255,.85)';
            ctx.lineWidth = Math.max(1, 1.4 * sc);
            ctx.strokeRect(x - bw / 2, baseY - postH - bh, bw, bh);
            return;
        }
        // Parked car.
        const bw = w * 0.09 * sc * size;
        const bh = h * 0.045 * sc * size;
        if (bw < 2 || bh < 2) return;
        const top = baseY - bh;
        const colors = ['#ef4444', '#3b82f6', '#facc15'];
        ctx.fillStyle = colors[it.tone % colors.length];
        ctx.fillRect(x - bw / 2, top, bw, bh);
        ctx.fillStyle = 'rgba(15,23,42,.55)';
        ctx.fillRect(x - bw * 0.32, top - bh * 0.45, bw * 0.64, bh * 0.5);
        ctx.fillStyle = '#111827';
        const wheel = Math.max(1, bw * 0.14);
        ctx.beginPath();
        ctx.arc(x - bw * 0.3, baseY, wheel, 0, Math.PI * 2);
        ctx.arc(x + bw * 0.3, baseY, wheel, 0, Math.PI * 2);
        ctx.fill();
    };

    DG.drawScenery = function (ctx, camZ, horizonY) {
        if (!S.scenery.length) return;
        const w = DG.view.w, h = DG.view.h;
        const items = [];
        for (let i = 0; i < S.scenery.length; i++) {
            const it = S.scenery[i];
            const rel = it.z - camZ;
            if (rel < -30 || rel > FAR_REL) continue;
            it._rel = rel;
            items.push(it);
        }
        items.sort((a, b) => b._rel - a._rel);
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const pr = DG.projectRel(it._rel, 1);
            if (pr.scale < 0.02 || pr.y > h + 120 || pr.y < horizonY - 12) continue;
            const x = pr.centerX + it.side * it.offset * pr.roadHalf;
            if (x < -w * 0.2 || x > w * 1.2) continue;
            DG.drawSceneryItem(ctx, it, x, pr.y, pr.scale, w, h);
        }
    };

    DG.drawBackdrop = function (ctx, camZ, horizonY) {
        const w = DG.view.w, h = DG.view.h;
        const heading = DG.trackCurve(camZ);
        const scroll = (camZ * 0.06) % (w * 2);
        const shift = scroll + heading * w * 0.45;

        // Distant skyline (slow parallax with distance and curve).
        ctx.fillStyle = 'rgba(30,58,86,.55)';
        ctx.beginPath();
        ctx.moveTo(0, horizonY);
        for (let x = 0; x <= w; x += 6) {
            const t = (x + shift * 0.5) / w;
            const bh = h * (0.035 + 0.026 * (Math.sin(t * Math.PI * 7 + 1.1) + 1) / 2 +
                0.014 * (Math.sin(t * Math.PI * 17 + 2.3) + 1) / 2);
            ctx.lineTo(x, horizonY - bh);
        }
        ctx.lineTo(w, horizonY);
        ctx.closePath();
        ctx.fill();

        // Far hills.
        ctx.fillStyle = '#1f4d3a';
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 2);
        for (let x = 0; x <= w; x += w / 12) {
            const hy = horizonY - Math.sin((x + shift) / w * Math.PI * 2.2 + 1.2) * h * 0.035;
            ctx.lineTo(x, hy);
        }
        ctx.lineTo(w, horizonY + h * 0.05);
        ctx.lineTo(0, horizonY + h * 0.05);
        ctx.closePath();
        ctx.fill();

        // Nearer hills, moving a little faster.
        ctx.fillStyle = '#155e3b';
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 6);
        for (let x = 0; x <= w; x += w / 10) {
            const hy = horizonY - Math.sin((x + shift * 1.6) / w * Math.PI * 2.8 + 3.4) * h * 0.022;
            ctx.lineTo(x, hy);
        }
        ctx.lineTo(w, horizonY + h * 0.06);
        ctx.lineTo(0, horizonY + h * 0.06);
        ctx.closePath();
        ctx.fill();
    };

    DG.drawTrack = function (ctx, camZ, horizonY) {
        const w = DG.view.w, h = DG.view.h;
        const pts = [];
        for (let i = 0; i <= SEGMENT_COUNT; i++) {
            const t = i / SEGMENT_COUNT;
            const rel = NEAR_REL * Math.pow(FAR_REL / NEAR_REL, t);
            pts.push({ z: camZ + rel, p: DG.projectRel(rel, 1) });
        }

        // Grass bands behind the road; they scroll because they follow world Z.
        for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
            const far = pts[i + 1], near = pts[i];
            ctx.fillStyle = (Math.floor(far.z / SCENERY_STEP) % 2 === 0) ? '#14532d' : '#166534';
            ctx.beginPath();
            ctx.moveTo(0, far.p.y);
            ctx.lineTo(w, far.p.y);
            ctx.lineTo(w, near.p.y);
            ctx.lineTo(0, near.p.y);
            ctx.closePath();
            ctx.fill();
        }

        // Road surface, kerbs and lane dashes, far to near.
        for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
            const far = pts[i + 1], near = pts[i];
            const band = Math.floor(far.z / 22) % 2 === 0;
            ctx.fillStyle = band ? '#3f4753' : '#374151';
            ctx.beginPath();
            ctx.moveTo(far.p.centerX - far.p.roadHalf, far.p.y);
            ctx.lineTo(far.p.centerX + far.p.roadHalf, far.p.y);
            ctx.lineTo(near.p.centerX + near.p.roadHalf, near.p.y);
            ctx.lineTo(near.p.centerX - near.p.roadHalf, near.p.y);
            ctx.closePath();
            ctx.fill();

            // Alternating red/white kerbs just outside the road.
            const kerb = band ? '#dc2626' : '#f8fafc';
            const sides = [[-1, 1.13, 1.0], [1, 1.0, 1.13]];
            for (let s = 0; s < sides.length; s++) {
                const side = sides[s][0], outer = sides[s][1], inner = sides[s][2];
                ctx.fillStyle = kerb;
                ctx.beginPath();
                ctx.moveTo(far.p.centerX + side * far.p.roadHalf * outer, far.p.y);
                ctx.lineTo(far.p.centerX + side * far.p.roadHalf * inner, far.p.y);
                ctx.lineTo(near.p.centerX + side * near.p.roadHalf * inner, near.p.y);
                ctx.lineTo(near.p.centerX + side * near.p.roadHalf * outer, near.p.y);
                ctx.closePath();
                ctx.fill();
            }

            // Dashes between the three lanes (divider offsets ±0.32).
            if (Math.floor(far.z / 40) % 2 === 0) {
                ctx.fillStyle = 'rgba(248,250,252,.78)';
                const offs = [-0.32, 0.32];
                for (let d = 0; d < offs.length; d++) {
                    const farW = Math.max(0.6, far.p.roadHalf * 0.032);
                    const nearW = Math.max(0.8, near.p.roadHalf * 0.032);
                    const fx = far.p.centerX + offs[d] * far.p.roadHalf;
                    const nx = near.p.centerX + offs[d] * near.p.roadHalf;
                    ctx.beginPath();
                    ctx.moveTo(fx - farW, far.p.y);
                    ctx.lineTo(fx + farW, far.p.y);
                    ctx.lineTo(nx + nearW, near.p.y);
                    ctx.lineTo(nx - nearW, near.p.y);
                    ctx.closePath();
                    ctx.fill();
                }
            }
        }

        // Continuous white edge lines.
        ctx.strokeStyle = 'rgba(255,255,255,.55)';
        ctx.lineWidth = 1.5;
        for (let side = -1; side <= 1; side += 2) {
            ctx.beginPath();
            for (let i = 0; i <= SEGMENT_COUNT; i++) {
                const p = pts[i].p;
                const x = p.centerX + side * p.roadHalf;
                if (i === 0) ctx.moveTo(x, p.y);
                else ctx.lineTo(x, p.y);
            }
            ctx.stroke();
        }
    };

    DG.drawRace = function () {
        if (!DG.raceEls || !DG.view) return;
        const ctx = DG.raceEls.canvas.getContext('2d');
        if (!ctx) return;
        const w = DG.view.w, h = DG.view.h;
        const p = S.player;
        if (!p) return;
        ctx.clearRect(0, 0, w, h);

        // Sky / ground
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#0b1020');
        sky.addColorStop(0.24, '#1d4ed8');
        sky.addColorStop(0.42, '#93c5fd');
        sky.addColorStop(0.58, '#dbeafe');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        const horizonY = DG.trackHorizonY();
        DG.drawBackdrop(ctx, p.dist, horizonY);
        ctx.fillStyle = '#14532d';
        ctx.fillRect(0, horizonY, w, h - horizonY);

        DG.ensureScenery(p.dist);
        DG.drawTrack(ctx, p.dist, horizonY);
        DG.drawScenery(ctx, p.dist, horizonY);

        // Finish line in multiplayer
        if (S.mode === 'multi' && S.finishDistance) {
            const rel = S.finishDistance - p.dist;
            if (rel > -20 && rel < FAR_REL) {
                const a = DG.project(rel, 0);
                const size = Math.max(4, a.roadHalf * 0.14);
                const left = a.centerX - a.roadHalf;
                const cellW = a.roadHalf * 2 / 12;
                for (let row = 0; row < 2; row++) {
                    for (let i = 0; i < 12; i++) {
                        ctx.fillStyle = (row + i) % 2 ? '#111827' : '#f9fafb';
                        ctx.fillRect(left + i * cellW, a.y - row * size, cellW, size);
                    }
                }
                ctx.fillStyle = '#fef08a';
                ctx.font = '700 ' + Math.max(9, 22 * a.scale) + 'px Fredoka, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('FINISH', a.centerX, a.y - size * 2.6);
            }
        }

        // Bananas on the track
        S.bananas.forEach(b => {
            const rel = b.dist - p.dist;
            if (rel < -20) return;
            const pr = DG.project(rel, b.lane);
            if (pr.y < horizonY + 4 || pr.y > h + 30) return;
            ctx.font = Math.max(12, 26 * pr.scale) + 'px serif';
            ctx.textAlign = 'center';
            ctx.fillText('🍌', pr.x, pr.y);
        });

        // Draw far → near: gates and rivals (kept on top of the scenery).
        const drawables = [];
        S.gates.forEach(g => {
            drawables.push({ kind: 'gate', z: g.dist - p.dist, gate: g });
        });
        S.rivals.forEach(r => {
            drawables.push({ kind: 'rival', z: r.dist - p.dist, rival: r });
        });
        drawables.sort((a, b) => b.z - a.z);
        drawables.forEach(d => {
            if (d.z > FAR_REL) return;
            if (d.kind === 'gate') DG.drawGate(ctx, d.gate, d.z);
            else DG.drawRival(ctx, d.rival, d.z);
        });

        // Player kart: stays in its lane on the near road.
        const nearLane = DG.projectRel(0, p.laneX);
        const px = nearLane.x;
        const py = h - 138;
        const scale = Math.min(w / 430, h / 700) * 1.12;
        DG.drawKart(ctx, px, py, scale, p.look, {
            spin: S.clock < p.spinUntil ? (S.clock * 15) % (Math.PI * 2) : 0,
            star: S.clock < p.starUntil,
            boost: S.clock < p.boostUntil,
            player: true
        });

        // Countdown
        if (S.phase === 'countdown') {
            const n = Math.ceil(S.countdown);
            const label = n > 0 ? String(Math.min(3, n)) : 'GO!';
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '900 ' + Math.round(Math.min(w, h) * 0.24) + 'px Fredoka, sans-serif';
            ctx.lineWidth = 12;
            ctx.strokeStyle = 'rgba(15,23,42,.85)';
            ctx.strokeText(label, w / 2, h * 0.46);
            ctx.fillStyle = '#fde047';
            ctx.fillText(label, w / 2, h * 0.46);
            ctx.restore();
        }

        // Lightning flash
        if (S.clock < S.flashUntil) {
            ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0, Math.min(0.65, (S.flashUntil - S.clock) * 2)) + ')';
            ctx.fillRect(0, 0, w, h);
        }

        // Speed lines
        if (p.speed > 175 && S.phase === 'racing') {
            ctx.strokeStyle = 'rgba(255,255,255,.35)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 10; i++) {
                const side = i % 2 ? 1 : -1;
                const x = w / 2 + side * (w * (0.18 + (i / 10) * 0.3));
                const y = horizonY + ((i * 57 + S.clock * 320) % Math.max(1, h - horizonY));
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + side * 12, y + 34);
                ctx.stroke();
            }
        }
    };

    DG.drawGate = function (ctx, gate, rel) {
        if (rel < -40) return;
        const w = DG.view.w, h = DG.view.h;
        const pr = DG.project(rel, gate.lane);
        if (pr.scale <= 0.02 || pr.y > h + 120) return;
        const gateW = Math.max(32, pr.roadHalf * 0.58);
        const gateH = Math.max(24, h * 0.085 * pr.scale + 16);
        const x = pr.x - gateW / 2;
        const y = pr.y - gateH;
        let color = '#f59e0b';
        let glow = 'rgba(251,191,36,.55)';
        if (S.gatesResolved && S.lastResult) {
            if (gate.correct) { color = '#22c55e'; glow = 'rgba(34,197,94,.65)'; }
            else if (gate.lane === S.lastResult.lane && !S.lastResult.correct) { color = '#ef4444'; glow = 'rgba(239,68,68,.6)'; }
            else { color = '#64748b'; glow = 'rgba(100,116,139,.35)'; }
        }
        ctx.save();
        ctx.shadowColor = glow;
        ctx.shadowBlur = 16 * pr.scale;
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.lineWidth = Math.max(1.5, 3 * pr.scale);
        ctx.beginPath();
        ctx.roundRect(x, y, gateW, gateH, Math.max(4, 10 * pr.scale));
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Posts
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, 5 * pr.scale);
        ctx.beginPath();
        ctx.moveTo(x + 4, y + gateH);
        ctx.lineTo(x + 4, pr.y + 2);
        ctx.moveTo(x + gateW - 4, y + gateH);
        ctx.lineTo(x + gateW - 4, pr.y + 2);
        ctx.stroke();

        // Label
        const label = gate.label;
        let fs = Math.max(8, Math.min(26, 26 * pr.scale));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        do {
            ctx.font = '700 ' + fs + 'px Fredoka, system-ui, sans-serif';
            if (ctx.measureText(label).width <= gateW - 8) break;
            fs -= 1;
        } while (fs > 8);
        const textY = y + gateH / 2;
        ctx.lineWidth = Math.max(2, fs * 0.22);
        ctx.strokeStyle = 'rgba(15,23,42,.8)';
        ctx.strokeText(label, pr.x, textY);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, pr.x, textY);
        ctx.restore();
    };

    DG.drawRival = function (ctx, r, rel) {
        if (rel < -10 || rel > FAR_REL) return;
        const pr = DG.project(rel, r.laneX);
        if (pr.y < DG.trackHorizonY() - 6) return;
        const scale = Math.max(0.32, pr.scale) * Math.min(DG.view.w / 430, DG.view.h / 700) * 0.96;
        const spin = S.clock < (r.spinUntil || 0) ? (S.clock * 14) % (Math.PI * 2) : 0;
        DG.drawKart(ctx, pr.x, pr.y, scale, r.look, {
            spin,
            slow: S.clock < (r.slowUntil || 0),
            tag: r.name
        });
    };

    /* Draw a rear-view kart with the chosen cat. Reused by the pre-race
       preview and the multiplayer lobby SVG. */
    DG.drawKart = function (ctx, x, y, scale, look, opts) {
        const o = opts || {};
        const l = DG.normalizeLook(look);
        const pal = DG.catPalette(l.cat);
        const s = scale || 1;
        ctx.save();
        ctx.translate(x, y);
        if (o.spin) ctx.rotate(o.spin);
        if (o.preview) ctx.scale(s * 1.05, s * 1.05);

        // Ground shadow
        ctx.fillStyle = 'rgba(0,0,0,.22)';
        ctx.beginPath();
        ctx.ellipse(0, 8 * s, 64 * s, 15 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        // Star glow
        if (o.star) {
            ctx.save();
            ctx.shadowColor = '#fde047';
            ctx.shadowBlur = 30;
            ctx.strokeStyle = '#fde047';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.ellipse(0, -30 * s, 62 * s, 76 * s, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Cape (behind the seat)
        if (l.outfit === 'Superhero Cape') {
            ctx.fillStyle = '#dc2626';
            ctx.beginPath();
            ctx.moveTo(-38 * s, -34 * s);
            ctx.quadraticCurveTo(-72 * s, -6 * s, -48 * s, 22 * s);
            ctx.lineTo(-14 * s, 2 * s);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(38 * s, -34 * s);
            ctx.quadraticCurveTo(72 * s, -6 * s, 48 * s, 22 * s);
            ctx.lineTo(14 * s, 2 * s);
            ctx.closePath();
            ctx.fill();
        }

        // Rear wheels
        ctx.fillStyle = '#1f2937';
        ctx.beginPath();
        ctx.ellipse(-48 * s, -6 * s, 15 * s, 24 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(48 * s, -6 * s, 15 * s, 24 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        // Kart body
        const body = ctx.createLinearGradient(0, -40 * s, 0, 16 * s);
        body.addColorStop(0, l.outfit === 'Racing Jacket' ? '#ef4444' : '#f97316');
        body.addColorStop(1, l.outfit === 'Racing Jacket' ? '#991b1b' : '#c2410c');
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.roundRect(-46 * s, -38 * s, 92 * s, 48 * s, 14 * s);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.25)';
        ctx.lineWidth = 2 * s;
        ctx.stroke();

        // Racing jacket stripes / sports vest
        if (l.outfit === 'Racing Jacket') {
            ctx.fillStyle = '#fde047';
            ctx.fillRect(-46 * s, -18 * s, 92 * s, 5 * s);
            ctx.fillStyle = '#fff';
            ctx.fillRect(-6 * s, -38 * s, 12 * s, 48 * s);
        } else if (l.outfit === 'Sports Vest') {
            ctx.fillStyle = '#22c55e';
            ctx.beginPath();
            ctx.roundRect(-34 * s, -30 * s, 68 * s, 24 * s, 8 * s);
            ctx.fill();
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(-4 * s, -30 * s, 8 * s, 24 * s);
        }

        // Rear wing
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.roundRect(-40 * s, -45 * s, 80 * s, 8 * s, 4 * s);
        ctx.fill();
        ctx.fillStyle = '#475569';
        ctx.fillRect(-34 * s, -45 * s, 5 * s, 12 * s);
        ctx.fillRect(29 * s, -45 * s, 5 * s, 12 * s);

        // Cat body / seat
        ctx.fillStyle = pal.body;
        ctx.beginPath();
        ctx.roundRect(-24 * s, -74 * s, 48 * s, 40 * s, 14 * s);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.18)';
        ctx.lineWidth = 2 * s;
        ctx.stroke();

        // Cat head
        const hy = -96 * s;
        ctx.fillStyle = pal.points;
        ctx.beginPath();
        ctx.moveTo(-24 * s, hy - 8 * s);
        ctx.lineTo(-34 * s, hy - 34 * s);
        ctx.lineTo(-8 * s, hy - 20 * s);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(24 * s, hy - 8 * s);
        ctx.lineTo(34 * s, hy - 34 * s);
        ctx.lineTo(8 * s, hy - 20 * s);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f9a8b8';
        ctx.beginPath();
        ctx.moveTo(-22 * s, hy - 12 * s);
        ctx.lineTo(-28 * s, hy - 28 * s);
        ctx.lineTo(-13 * s, hy - 19 * s);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(22 * s, hy - 12 * s);
        ctx.lineTo(28 * s, hy - 28 * s);
        ctx.lineTo(13 * s, hy - 19 * s);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = pal.body;
        ctx.beginPath();
        ctx.ellipse(0, hy, 30 * s, 28 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.16)';
        ctx.stroke();
        if (l.cat === 'Ragdoll' || l.cat === 'Siamese') {
            ctx.fillStyle = pal.points;
            ctx.beginPath();
            ctx.ellipse(0, hy + 8 * s, 15 * s, 13 * s, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ginger stripes
        if (l.cat === 'Ginger') {
            ctx.strokeStyle = 'rgba(150,70,20,.45)';
            ctx.lineWidth = 2.5 * s;
            ctx.beginPath();
            ctx.moveTo(-7 * s, hy - 24 * s);
            ctx.lineTo(-3 * s, hy - 16 * s);
            ctx.moveTo(7 * s, hy - 24 * s);
            ctx.lineTo(3 * s, hy - 16 * s);
            ctx.stroke();
        }

        // Eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(-11 * s, hy - 2 * s, 7 * s, 8 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(11 * s, hy - 2 * s, 7 * s, 8 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pal.eye;
        ctx.beginPath();
        ctx.arc(-11 * s, hy - 1 * s, 4 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(11 * s, hy - 1 * s, 4 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111827';
        ctx.beginPath();
        ctx.arc(-11 * s, hy - 1 * s, 2 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(11 * s, hy - 1 * s, 2 * s, 0, Math.PI * 2);
        ctx.fill();

        // Nose & mouth
        ctx.fillStyle = pal.nose;
        ctx.beginPath();
        ctx.moveTo(-4 * s, hy + 9 * s);
        ctx.lineTo(4 * s, hy + 9 * s);
        ctx.lineTo(0, hy + 14 * s);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = pal.points;
        ctx.lineWidth = 1.6 * s;
        ctx.beginPath();
        ctx.moveTo(0, hy + 14 * s);
        ctx.quadraticCurveTo(-4 * s, hy + 19 * s, -8 * s, hy + 16 * s);
        ctx.moveTo(0, hy + 14 * s);
        ctx.quadraticCurveTo(4 * s, hy + 19 * s, 8 * s, hy + 16 * s);
        ctx.stroke();

        // Whiskers
        ctx.strokeStyle = 'rgba(255,255,255,.75)';
        ctx.lineWidth = 1.2 * s;
        ctx.beginPath();
        ctx.moveTo(-18 * s, hy + 12 * s); ctx.lineTo(-36 * s, hy + 9 * s);
        ctx.moveTo(-18 * s, hy + 16 * s); ctx.lineTo(-36 * s, hy + 19 * s);
        ctx.moveTo(18 * s, hy + 12 * s); ctx.lineTo(36 * s, hy + 9 * s);
        ctx.moveTo(18 * s, hy + 16 * s); ctx.lineTo(36 * s, hy + 19 * s);
        ctx.stroke();

        // Glasses
        if (l.glasses === 'Sunglasses') {
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.roundRect(-22 * s, hy - 7 * s, 18 * s, 9 * s, 3 * s);
            ctx.fill();
            ctx.beginPath();
            ctx.roundRect(4 * s, hy - 7 * s, 18 * s, 9 * s, 3 * s);
            ctx.fill();
            ctx.fillRect(-5 * s, hy - 4 * s, 10 * s, 2 * s);
        } else if (l.glasses === 'Glasses') {
            ctx.strokeStyle = '#1f2937';
            ctx.lineWidth = 2 * s;
            ctx.beginPath();
            ctx.arc(-11 * s, hy - 2 * s, 9 * s, 0, Math.PI * 2);
            ctx.arc(11 * s, hy - 2 * s, 9 * s, 0, Math.PI * 2);
            ctx.moveTo(-2 * s, hy - 2 * s);
            ctx.lineTo(2 * s, hy - 2 * s);
            ctx.stroke();
        }

        // Hats
        if (l.hat === 'Party Hat') {
            ctx.fillStyle = '#ec4899';
            ctx.beginPath();
            ctx.moveTo(0, hy - 58 * s);
            ctx.lineTo(-22 * s, hy - 25 * s);
            ctx.lineTo(22 * s, hy - 25 * s);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fde047';
            ctx.beginPath(); ctx.arc(-7 * s, hy - 40 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(7 * s, hy - 33 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#60a5fa';
            ctx.beginPath(); ctx.arc(0, hy - 28 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill();
        } else if (l.hat === 'Crown') {
            ctx.fillStyle = '#fbbf24';
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 1.6 * s;
            ctx.beginPath();
            ctx.moveTo(-22 * s, hy - 24 * s);
            ctx.lineTo(-18 * s, hy - 44 * s);
            ctx.lineTo(-7 * s, hy - 34 * s);
            ctx.lineTo(0, hy - 50 * s);
            ctx.lineTo(7 * s, hy - 34 * s);
            ctx.lineTo(18 * s, hy - 44 * s);
            ctx.lineTo(22 * s, hy - 24 * s);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        // Outfits (front)
        if (l.outfit === 'Red Scarf' || l.outfit === 'Pink Floral Scarf') {
            const col = l.outfit === 'Red Scarf' ? '#ef4444' : '#f472b6';
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.roundRect(-27 * s, -70 * s, 54 * s, 8 * s, 4 * s);
            ctx.fill();
            if (l.outfit === 'Pink Floral Scarf') {
                ctx.fillStyle = '#fde68a';
                for (let i = -2; i <= 2; i++) {
                    ctx.beginPath();
                    ctx.arc(i * 9 * s, -66 * s, 1.8 * s, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        } else if (l.outfit === 'Gentleman Bowtie') {
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.moveTo(-14 * s, -66 * s);
            ctx.lineTo(0, -60 * s);
            ctx.lineTo(14 * s, -66 * s);
            ctx.lineTo(14 * s, -54 * s);
            ctx.lineTo(0, -60 * s);
            ctx.lineTo(-14 * s, -54 * s);
            ctx.closePath();
            ctx.fill();
        }

        // Boost flame
        if (o.boost) {
            const flick = 1 + Math.sin(S.clock * 40) * 0.25;
            ctx.fillStyle = 'rgba(251,191,36,.9)';
            ctx.beginPath();
            ctx.moveTo(-16 * s, 12 * s);
            ctx.lineTo(0, (34 + 16 * flick) * s);
            ctx.lineTo(16 * s, 12 * s);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(239,68,68,.85)';
            ctx.beginPath();
            ctx.moveTo(-8 * s, 12 * s);
            ctx.lineTo(0, (24 + 10 * flick) * s);
            ctx.lineTo(8 * s, 12 * s);
            ctx.closePath();
            ctx.fill();
        }

        // Slow indicator
        if (o.slow) {
            ctx.font = '700 ' + Math.max(12, 18 * s) + 'px Fredoka, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('⚡', 0, hy - 62 * s);
        }

        // Name tag for CPU / remote rivals
        if (o.tag) {
            ctx.font = '700 ' + Math.max(10, 13 * s) + 'px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(15,23,42,.75)';
            const ty = hy - 62 * s;
            ctx.strokeText(o.tag, 0, ty);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(o.tag, 0, ty);
        }
        ctx.restore();
    };

    /* ---------------- multiplayer hooks used by the sync file ---------------- */

    DG.mpSyncRivals = function (players, replace) {
        if (!S.active) return;
        const me = currentUser && currentUser.id;
        const list = (players || []).filter(p => p && p.user_id !== me);
        const seen = {};
        if (replace) S.rivals = [];
        list.forEach(p => {
            seen[p.user_id] = true;
            let r = S.rivals.find(x => x.remote && x.userId === p.user_id);
            if (!r) {
                r = {
                    remote: true,
                    userId: p.user_id,
                    name: DG.mpPlayerName(p),
                    look: DG.normalizeLook({ cat: p.cat, glasses: p.glasses, hat: p.hat, outfit: p.outfit }),
                    dist: Number(p.distance) || 0,
                    targetDist: Number(p.distance) || 0,
                    lane: Number(p.lane) || 1,
                    targetLane: Number(p.lane) || 1,
                    laneX: Number(p.lane) || 1,
                    speed: 100,
                    spinUntil: 0,
                    slowUntil: 0,
                    finished: !!p.finished_at
                };
                S.rivals.push(r);
            } else {
                r.name = DG.mpPlayerName(p);
                r.look = DG.normalizeLook({ cat: p.cat, glasses: p.glasses, hat: p.hat, outfit: p.outfit });
                r.targetDist = Number(p.distance) || 0;
                r.targetLane = Number(p.lane) || 1;
                r.finished = !!p.finished_at;
            }
        });
        S.rivals = S.rivals.filter(r => !r.remote || seen[r.userId]);
    };

    // Exposed for the multiplayer file / tests.
    DG.raceState = S;
})();

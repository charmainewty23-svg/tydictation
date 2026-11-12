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
        scene: 'desert',
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
        questionCount: 20,
        accelHeld: false,
        accelKeys: {},
        accelSources: { key: false, button: false },
        tilt: { enabled: false, zero: null, active: false, left: false, right: false, lastAt: 0, timer: 0, warned: false, target: 1, delta: 0, manualUntil: 0 },
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
            itemName: document.getElementById('dg-item-name'),
            progress: document.getElementById('dg-stat-progress'),
            accelBtn: document.getElementById('dg-accel-btn')
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
        S.scene = DG.normalizeScene(opts.scene || (opts.room && opts.room.scene) || (settings && settings.scene));
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
        S.questionCount = DG.normalizeQuestionCount(
            opts.questionCount || (opts.room && opts.room.question_count) || (settings && settings.questionCount)
        );
        DG.releaseAccel();
        S.tilt.target = 1;
        S.tilt.delta = 0;
        S.tilt.active = false;
        S.tilt.manualUntil = 0;
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
        DG.releaseAccel();
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
                if (!S.startedAtMs) S.startedAtMs = Date.now();
                DG.toast('GO!', 900);
            }
            return;
        }
        if (S.phase !== 'racing') return;
        const p = S.player;
        if (!p) return;
        const now = S.clock;

        // Player speed: 100 km/h base, faster with combo, slower while spun.
        // ACCEL is a hold-to-speed bonus; it does not fire the mushroom item.
        // Spin-out overrides it. Star / mushroom boosts may stack, but a hard
        // SPEED_CAP keeps the total bounded.
        const spinning = now < p.spinUntil;
        const slowed = now < p.slowUntil;
        const cap = DG.SPEED_CAP || 340;
        let target;
        if (p.finished) {
            target = 0;
        } else {
            target = 100 + Math.min(45, p.combo * 3);
            if (now < p.nitroUntil) target += DG.NITRO_KMH * Math.max(0, (p.nitroUntil - now) / 1.2);
            if (now < p.boostUntil) target += 45;
            if (S.accelHeld && !spinning && !S.paused) target += (DG.ACCEL_KMH || 110);
            if (slowed) target *= 0.5;
            if (spinning) target = 0;
        }
        // Holding ACCEL uses a snappy lerp so the bonus arrives almost at once;
        // coasting (no ACCEL) keeps the gentler 2.3 lerp.
        const accel = spinning || p.finished ? 7 : (S.accelHeld ? 8 : 2.3);
        p.speed += (target - p.speed) * Math.min(1, dt * accel);
        if (p.speed < 0) p.speed = 0;
        if (p.speed > cap) p.speed = cap;
        p.dist += p.speed * (1000 / 3600) * dt;

        // Steering. Analog tilt drives laneX toward a fractional lane target
        // every frame, so holding a lean keeps the kart in that lane. Buttons,
        // swipe and arrow keys stay discrete (setLane / steer) and briefly win
        // over tilt so the on-screen buttons remain usable as a backup.
        const tiltFresh = S.tilt.active && (Date.now() - (S.tilt.lastAt || 0) < 2000);
        const tiltLive = S.tilt.enabled && tiltFresh && now >= (S.tilt.manualUntil || 0);
        if (tiltLive) {
            const targetLane = DG.tiltLaneTarget(S.tilt.delta);
            S.tilt.target = targetLane;
            p.laneX += (targetLane - p.laneX) * Math.min(1, dt * (DG.TILT_LERP || 18));
        } else {
            p.laneX += (p.lane - p.laneX) * Math.min(1, dt * 12);
        }
        p.laneX = Math.max(0, Math.min(2, p.laneX));
        p.lane = DG.nearestLane(p.laneX);

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

        // Gate crossing. A finished racer no longer answers gates. The lane is
        // the kart's actual position (analog tilt gives fractional laneX).
        if (!p.finished && !S.gatesResolved && S.gates.length && p.dist >= S.gateDist) {
            DG.answerGate(DG.nearestLane(p.laneX));
        }
        if (S.gatesResolved && S.nextGateAt && now >= S.nextGateAt) {
            if (p.finished) {
                if (S.mode === 'single') DG.endRun();
            } else {
                S.gateDist = Math.max(S.nextGateDist, p.dist + 300);
                DG.spawnGates();
            }
        }

        if (!p.finished) DG.recordBest(p.score, p.dist);
    };

    DG.raceTimeLeft = function () {
        if (!S.startedAtMs) return S.raceSeconds;
        const elapsed = (Date.now() - S.startedAtMs) / 1000;
        return Math.max(0, S.raceSeconds - elapsed);
    };

    DG.raceElapsedSeconds = function () {
        const p = S.player;
        if (p && p.finished && p.elapsed != null) return p.elapsed;
        if (!S.startedAtMs) return 0;
        return Math.max(0, (Date.now() - S.startedAtMs) / 1000);
    };

    /* ---------------- questions / gates ---------------- */

    DG.spawnGates = function () {
        if (S.player && S.player.finished) return;
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
            p.speed = Math.min(DG.SPEED_CAP || 340, p.speed + DG.NITRO_KMH);
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
            if (p.correct >= S.questionCount) DG.finishPlayer();
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

    DG.finishPlayer = function () {
        const p = S.player;
        if (!p || p.finished) return;
        const elapsed = DG.raceElapsedSeconds();
        const result = DG.scoreRun(p, elapsed, S.questionCount);
        p.finished = true;
        p.finishAt = S.clock;
        p.elapsed = result.elapsed;
        p.timeBonus = result.timeBonus;
        p.composite = result.composite;
        p.accuracy = result.accuracy;
        p.runResult = result;
        DG.releaseAccel();
        if (S.mode === 'single') {
            DG.recordBestRun(S.bankMode, S.questionCount, result);
            DG.recordBest(p.score, p.dist);
            DG.toast('🏁 ' + S.questionCount + ' correct — finished!', 1800);
            // Cloud board is fire-and-forget; the results screen never waits for it.
            DG.submitCloudRun('single', Object.assign({}, result, {
                bankMode: S.bankMode,
                scene: S.scene
            }), null);
        } else {
            DG.toast('🏁 ' + S.questionCount + ' correct — waiting for the others…', 2200);
            if (!S.finishSent && typeof DG.mpCrossFinish === 'function') {
                S.finishSent = true;
                DG.mpCrossFinish();
            }
        }
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
        // An explicit button / key / swipe press wins over analog tilt for a
        // moment, so the on-screen buttons still work as a backup.
        if (S.tilt.enabled) S.tilt.manualUntil = S.clock + 1.2;
    };

    DG.steer = function (dir) {
        if (!S.active || S.phase !== 'racing' || S.paused) return;
        DG.setLane(S.player.lane + (dir < 0 ? -1 : 1));
    };

    DG.isAccelKey = function (key) {
        return key === 'ArrowUp' || key === 'w' || key === 'W' || key === ' ';
    };

    DG.accelKeyId = function (key) {
        if (key === ' ') return 'Space';
        if (key === 'w' || key === 'W') return 'w';
        return key;
    };

    DG.syncAccelHeld = function () {
        if (S.paused || S.phase === 'finished' || (S.player && S.player.finished)) {
            S.accelHeld = false;
            return;
        }
        S.accelHeld = !!(S.accelSources.key || S.accelSources.button);
        const btn = DG.raceEls && DG.raceEls.accelBtn;
        if (btn) btn.classList.toggle('held', S.accelHeld);
    };

    DG.setAccelSource = function (source, on) {
        if (!S.accelSources) S.accelSources = { key: false, button: false };
        S.accelSources[source] = !!on;
        DG.syncAccelHeld();
    };

    DG.releaseAccel = function () {
        S.accelKeys = {};
        S.accelSources = { key: false, button: false };
        S.accelHeld = false;
        const btn = DG.raceEls && DG.raceEls.accelBtn;
        if (btn) btn.classList.remove('held');
    };

    DG.onAccelDown = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.currentTarget && e.pointerId != null && e.currentTarget.setPointerCapture) {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
        }
        if (!S.active || S.paused || S.phase !== 'racing') return;
        if (S.player && S.player.finished) return;
        DG.setAccelSource('button', true);
    };

    DG.onAccelUp = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        DG.setAccelSource('button', false);
    };

    DG.onKeyDown = function (e) {
        if (!S.active) return;
        const key = e.key;
        if (DG.isAccelKey(key)) {
            S.accelKeys[DG.accelKeyId(key)] = true;
            DG.setAccelSource('key', true);
            e.preventDefault();
            return;
        }
        if (key === 'ArrowLeft' || key === 'a' || key === 'A') { DG.steer(-1); e.preventDefault(); }
        else if (key === 'ArrowRight' || key === 'd' || key === 'D') { DG.steer(1); e.preventDefault(); }
        else if (key === 'ArrowDown' || key === 's' || key === 'S') { DG.setLane(1); e.preventDefault(); }
        else if (key === 'Enter') { DG.useItem(); e.preventDefault(); }
        else if (key === 'p' || key === 'P' || key === 'Escape') { DG.togglePause(); e.preventDefault(); }
    };

    DG.onKeyUp = function (e) {
        const key = e.key;
        if (!DG.isAccelKey(key)) return;
        delete S.accelKeys[DG.accelKeyId(key)];
        const still = S.accelKeys && Object.keys(S.accelKeys).length > 0;
        DG.setAccelSource('key', still);
        e.preventDefault();
    };

    DG.onWindowBlur = function () {
        DG.releaseAccel();
    };

    DG.onTilt = function (e) {
        if (!S.active || S.paused) return;
        // Track the lean during the countdown too, so the first lean is already
        // known when GO! appears. The lane only moves once racing starts.
        if (S.phase !== 'racing' && S.phase !== 'countdown') return;
        const reading = DG.tiltReading(e);
        if (!isFinite(reading)) return;
        S.tilt.lastAt = Date.now();
        if (S.tilt.zero == null) S.tilt.zero = reading;
        let delta = reading - S.tilt.zero;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        S.tilt.delta = delta;
        S.tilt.target = DG.tiltLaneTarget(delta);
        // Analog: no one-shot steer and no need to return to centre first.
        // updateRace() lerps laneX toward this target every frame.
        S.tilt.active = true;
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
        add(window, 'keyup', DG.onKeyUp);
        add(window, 'blur', DG.onWindowBlur);
        add(document, 'visibilitychange', DG.onWindowBlur);
        add(window, 'resize', DG.onResize);
        if (DG.raceEls) {
            add(DG.raceEls.stage, 'pointerdown', DG.onPointerDown);
            add(DG.raceEls.stage, 'pointerup', DG.onPointerUp);
            add(DG.raceEls.stage, 'pointercancel', DG.onPointerUp);
            if (DG.raceEls.accelBtn) {
                add(DG.raceEls.accelBtn, 'pointerdown', DG.onAccelDown);
                add(DG.raceEls.accelBtn, 'pointerup', DG.onAccelUp);
                add(DG.raceEls.accelBtn, 'pointercancel', DG.onAccelUp);
                add(DG.raceEls.accelBtn, 'lostpointercapture', DG.onAccelUp);
            }
        }
        const settings = DG.readSettings();
        if (settings.controls === 'tilt') {
            S.tilt.enabled = true;
            S.tilt.zero = null;
            S.tilt.active = false;
            S.tilt.target = 1;
            S.tilt.delta = 0;
            S.tilt.manualUntil = 0;
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
        S.tilt.active = false;
        S.tilt.target = 1;
        S.tilt.delta = 0;
        S.swipe.down = false;
        DG.releaseAccel();
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
            p.speed = Math.min(DG.SPEED_CAP || 340, p.speed + 18);
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
        if (els.progress) {
            els.progress.classList.remove('hidden');
            els.progress.textContent = p.correct + '/' + S.questionCount;
        }
        if (els.time) {
            els.time.classList.remove('hidden');
            els.time.textContent = DG.formatRaceTime(DG.raceElapsedSeconds());
        }
        if (els.accelBtn) els.accelBtn.classList.toggle('held', !!S.accelHeld);
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
            DG.releaseAccel();
            DG.showOverlay(
                '<div class="text-center"><div class="text-6xl mb-2">⏸</div><h3 class="text-2xl font-bold text-orange-600 mb-2">Paused</h3>' +
                '<p class="text-gray-500 font-bold mb-5">' + (S.mode === 'multi' ? 'Other racers keep going. Accel is released until you resume.' : 'Take a breath. Your run is waiting. Accel is released.') + '</p>' +
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
        if (!p) return;
        if (!p.finished) {
            const elapsed = DG.raceElapsedSeconds();
            const result = DG.scoreRun(p, elapsed, S.questionCount);
            p.elapsed = result.elapsed;
            p.timeBonus = result.timeBonus;
            p.composite = result.composite;
            p.accuracy = result.accuracy;
            p.runResult = result;
        }
        const result = p.runResult || DG.scoreRun(p, p.elapsed || DG.raceElapsedSeconds(), S.questionCount);
        if (p.correct >= S.questionCount) DG.recordBestRun(S.bankMode, S.questionCount, result);
        DG.recordBest(p.score, p.dist);
        const best = DG.readBestRun(S.bankMode, S.questionCount);
        const bestLine = best
            ? ('Personal best for ' + result.questionCount + ' questions: ' + best.composite + ' pts · ' + DG.formatRaceTime(best.time))
            : 'No personal best for this question count yet.';
        const reached = p.correct >= S.questionCount;
        DG.showOverlay(
            '<div class="text-center"><div class="text-6xl mb-1">🏁</div>' +
            '<h3 class="text-3xl font-bold text-orange-600 mb-1">' + (reached ? 'Run finished' : 'Run ended') + '</h3>' +
            '<p class="text-gray-400 font-bold mb-4">' + DG.esc(DG.MODE_LABEL[S.bankMode] || '') + ' · ' + result.questionCount + ' questions</p>' +
            '<div class="dg-result-grid mb-5">' +
            '<div><span>Composite</span><b>' + Math.floor(result.composite) + '</b></div>' +
            '<div><span>Race score</span><b>' + Math.floor(result.raceScore) + '</b></div>' +
            '<div><span>Time bonus</span><b>+' + Math.floor(result.timeBonus) + '</b></div>' +
            '<div><span>Time</span><b>' + DG.formatRaceTime(result.elapsed) + '</b></div>' +
            '<div><span>Accuracy</span><b>' + DG.formatAccuracy(result.accuracy) + '</b></div>' +
            '<div><span>Correct</span><b>' + result.correct + '/' + result.questionCount + '</b></div>' +
            '<div><span>Wrong</span><b>' + result.wrong + '</b></div>' +
            '<div><span>Max combo</span><b>x' + p.maxCombo + '</b></div>' +
            '</div>' +
            '<p class="text-sm font-bold text-gray-500 mb-5">' + DG.esc(bestLine) + '</p>' +
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
        // Every signed-in, non-guest racer records their own finished row once
        // the room results exist (place / player count are only known here).
        if (typeof DG.mpSubmitMultiBoard === 'function') DG.mpSubmitMultiBoard(room, players);
        const rows = typeof DG.rankMultiplayerRows === 'function'
            ? DG.rankMultiplayerRows(players)
            : (players || []).slice();
        const n = DG.normalizeQuestionCount(room && room.question_count || S.questionCount);
        const winnerId = room && room.winner_id;
        let winner = rows.find(r => r.user_id === winnerId);
        if (!winner) winner = rows[0];
        const youWin = winner && currentUser && winner.user_id === currentUser.id;
        const reason = 'Highest composite score after ' + n + ' correct answers wins.';
        const medal = (i) => i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : (i + 1) + '.'));
        const points = (r) => (r.composite_score != null ? r.composite_score : r.score) || 0;
        const acc = (r) => {
            const c = Number(r.correct) || 0, w = Number(r.wrong) || 0;
            return DG.formatAccuracy((c + w) ? c / (c + w) : 0);
        };
        const time = (r) => r.elapsed_ms ? DG.formatRaceTime(r.elapsed_ms / 1000) : (r.finished_at ? 'done' : '—');
        DG.showOverlay(
            '<div class="text-center"><div class="text-6xl mb-1">' + (youWin ? '🏆' : '🏁') + '</div>' +
            '<h3 class="text-3xl font-bold ' + (youWin ? 'text-amber-600' : 'text-orange-600') + ' mb-1">' +
            (youWin ? 'You win!' : DG.esc((winner && DG.mpPlayerName(winner)) || 'Race finished') + ' wins!') + '</h3>' +
            '<p class="text-sm font-bold text-gray-500 mb-4">' + DG.esc(reason) + '</p>' +
            '<div class="dg-standings mb-5">' + rows.map((r, i) =>
                '<div class="dg-standing' + (currentUser && r.user_id === currentUser.id ? ' me' : '') + '">' +
                '<span class="dg-medal">' + medal(i) + '</span>' +
                '<span class="dg-who">' + DG.esc(DG.mpPlayerName(r)) + '</span>' +
                '<span class="dg-points">' + points(r) + ' pts</span>' +
                '<span class="dg-dist">' + acc(r) + ' · ' + time(r) + '</span>' +
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

    // One palette + roadside set per course. Track geometry (curves, hills,
    // projection, gate spacing) is identical for all three; only the colours,
    // backdrop and scenery kinds change.
    const SCENE_STYLES = {
        desert: {
            sky: [[0, '#9fc6dc'], [0.22, '#cfe2ec'], [0.40, '#f2d79c'], [0.58, '#f8e6bb']],
            ground: '#d7b06b',
            bandA: '#d7b06b', bandB: '#c9a25c',
            roadA: '#8f7a56', roadB: '#836f4d',
            kerbA: '#b45309', kerbB: '#fde68a',
            dash: 'rgba(255,250,235,.72)', edge: 'rgba(255,255,255,.5)',
            kinds: ['cactus', 'rock', 'rock', 'bone', 'plant', 'sign', 'lamp'],
            density: 0.46
        },
        stadium: {
            sky: [[0, '#6fb7e8'], [0.22, '#a9d9f6'], [0.40, '#ffd9e4'], [0.58, '#fff0e0']],
            ground: '#e7d3cf',
            bandA: '#e7d3cf', bandB: '#dcc3be',
            roadA: '#66707d', roadB: '#5b6572',
            kerbA: '#e11d48', kerbB: '#f8fafc',
            dash: 'rgba(255,255,255,.8)', edge: 'rgba(255,255,255,.62)',
            kinds: ['grandstand', 'floodlight', 'flag', 'stall', 'lamp'],
            density: 0.64
        },
        jungle: {
            sky: [[0, '#1c4a32'], [0.22, '#3c7d4b'], [0.40, '#a8d888'], [0.58, '#e4f6c3']],
            ground: '#2f5d2c',
            bandA: '#2f5d2c', bandB: '#386b31',
            roadA: '#6b5a41', roadB: '#5e4f39',
            kerbA: '#4d7c0f', kerbB: '#d9f99d',
            dash: 'rgba(240,253,230,.62)', edge: 'rgba(236,252,203,.55)',
            kinds: ['palm', 'jungleTree', 'jungleTree', 'fern', 'dino', 'rock'],
            density: 0.6
        }
    };

    DG.sceneStyle = function () {
        return SCENE_STYLES[DG.normalizeScene(S.scene)] || SCENE_STYLES.desert;
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
        const style = DG.sceneStyle();
        const kinds = style.kinds;
        while (S.sceneryNextZ < limit) {
            const z = S.sceneryNextZ;
            S.sceneryNextZ += SCENERY_STEP;
            const rng = DG.makeRng((DG.hashString('dg-scenery') ^ DG.trackSeedValue() ^ Math.floor(z * 13)) >>> 0);
            for (let s = 0; s < 2; s++) {
                const side = s === 0 ? -1 : 1;
                if (rng() > style.density) continue;
                const kind = kinds[Math.floor(rng() * kinds.length)];
                let offset = 1.5 + rng() * 0.9;
                if (kind === 'lamp' || kind === 'floodlight') offset = 1.3 + rng() * 0.16;
                else if (kind === 'car' || kind === 'stall') offset = 1.3 + rng() * 0.24;
                else if (kind === 'grandstand') offset = 1.72 + rng() * 1.1;
                else if (kind === 'dino') offset = 1.9 + rng() * 0.9;
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
        if (it.kind === 'cactus') {
            const bh = h * 0.14 * sc * size;
            const bw = Math.max(2, w * 0.016 * sc * size);
            if (bh < 5) return;
            ctx.fillStyle = it.tone === 0 ? '#4d7c0f' : (it.tone === 1 ? '#3f6212' : '#65a30d');
            ctx.beginPath();
            ctx.roundRect(x - bw / 2, baseY - bh, bw, bh, bw / 2);
            ctx.fill();
            const armY = baseY - bh * 0.62;
            ctx.fillRect(x - bw * 2.1, armY, bw * 1.6, Math.max(1.5, bw * 0.85));
            ctx.fillRect(x - bw * 2.1, armY - bh * 0.24, Math.max(1.5, bw * 0.85), bh * 0.26);
            const armY2 = baseY - bh * 0.48;
            ctx.fillRect(x + bw * 0.5, armY2, bw * 1.5, Math.max(1.5, bw * 0.8));
            ctx.fillRect(x + bw * 1.3, armY2 - bh * 0.2, Math.max(1.5, bw * 0.8), bh * 0.22);
            if (bw > 3) {
                ctx.fillStyle = '#fde68a';
                ctx.beginPath();
                ctx.arc(x, baseY - bh, Math.max(1, bw * 0.5), 0, Math.PI * 2);
                ctx.fill();
            }
            return;
        }
        if (it.kind === 'rock') {
            const rw = w * 0.075 * sc * size;
            const rh = h * 0.05 * sc * size;
            if (rw < 2 || rh < 2) return;
            ctx.fillStyle = it.tone === 0 ? '#b08a5a' : (it.tone === 1 ? '#9c7a4f' : '#c6a06c');
            ctx.beginPath();
            ctx.moveTo(x - rw / 2, baseY);
            ctx.lineTo(x - rw * 0.32, baseY - rh * 0.85);
            ctx.lineTo(x + rw * 0.1, baseY - rh);
            ctx.lineTo(x + rw / 2, baseY - rh * 0.35);
            ctx.lineTo(x + rw * 0.38, baseY);
            ctx.closePath();
            ctx.fill();
            return;
        }
        if (it.kind === 'bone') {
            const bw = w * 0.07 * sc * size;
            const bh = Math.max(1, h * 0.012 * sc * size);
            if (bw < 3) return;
            ctx.strokeStyle = 'rgba(248,244,227,.9)';
            ctx.lineWidth = bh;
            ctx.beginPath();
            ctx.moveTo(x - bw / 2, baseY - bh);
            ctx.lineTo(x + bw / 2, baseY - bh);
            ctx.stroke();
            ctx.fillStyle = 'rgba(248,244,227,.9)';
            ctx.beginPath();
            ctx.arc(x - bw / 2, baseY - bh * 1.6, Math.max(1, bh * 1.2), 0, Math.PI * 2);
            ctx.arc(x - bw / 2, baseY - bh * 0.4, Math.max(1, bh * 1.2), 0, Math.PI * 2);
            ctx.arc(x + bw / 2, baseY - bh * 1.6, Math.max(1, bh * 1.2), 0, Math.PI * 2);
            ctx.arc(x + bw / 2, baseY - bh * 0.4, Math.max(1, bh * 1.2), 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        if (it.kind === 'plant') {
            const ph = h * 0.045 * sc * size;
            if (ph < 2) return;
            ctx.strokeStyle = it.tone === 0 ? '#8a9a3b' : '#a3b04a';
            ctx.lineWidth = Math.max(1, 1.4 * sc);
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.moveTo(x, baseY);
                ctx.quadraticCurveTo(x + i * ph * 0.5, baseY - ph * 0.7, x + i * ph * 0.8, baseY - ph);
                ctx.stroke();
            }
            return;
        }
        if (it.kind === 'palm') {
            const trunkH = h * 0.16 * sc * size;
            const trunkW = Math.max(1, w * 0.011 * sc * size);
            if (trunkH < 4) return;
            ctx.strokeStyle = '#7c5a2e';
            ctx.lineWidth = trunkW;
            ctx.beginPath();
            ctx.moveTo(x, baseY);
            ctx.quadraticCurveTo(x - trunkW * 2, baseY - trunkH * 0.6, x - trunkW * 1.2, baseY - trunkH);
            ctx.stroke();
            const crownY = baseY - trunkH;
            const frond = w * 0.055 * sc * size;
            ctx.strokeStyle = it.tone === 0 ? '#15803d' : (it.tone === 1 ? '#166534' : '#4d7c0f');
            ctx.lineWidth = Math.max(1.4, 2.6 * sc);
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.moveTo(x - trunkW * 1.2, crownY);
                ctx.quadraticCurveTo(x + i * frond * 0.8, crownY - frond * 0.55, x + i * frond, crownY + frond * 0.28);
                ctx.stroke();
            }
            ctx.fillStyle = '#a16207';
            ctx.beginPath();
            ctx.arc(x - trunkW * 1.2 + frond * 0.15, crownY + frond * 0.18, Math.max(1, frond * 0.14), 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        if (it.kind === 'jungleTree') {
            const trunkW = Math.max(1, w * 0.012 * sc * size);
            const trunkH = h * 0.13 * sc * size;
            const r = w * 0.075 * sc * size;
            if (trunkH < 3) return;
            ctx.fillStyle = '#4b3621';
            ctx.fillRect(x - trunkW / 2, baseY - trunkH, trunkW, trunkH);
            const tones = ['#14532d', '#166534', '#15803d'];
            ctx.fillStyle = tones[it.tone % tones.length];
            ctx.beginPath();
            ctx.arc(x, baseY - trunkH - r * 0.35, r, 0, Math.PI * 2);
            ctx.arc(x - r * 0.85, baseY - trunkH + r * 0.2, r * 0.74, 0, Math.PI * 2);
            ctx.arc(x + r * 0.85, baseY - trunkH + r * 0.2, r * 0.74, 0, Math.PI * 2);
            ctx.arc(x, baseY - trunkH + r * 0.55, r * 0.8, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        if (it.kind === 'fern') {
            const fh = h * 0.055 * sc * size;
            if (fh < 2) return;
            ctx.strokeStyle = it.tone === 0 ? '#22c55e' : '#15803d';
            ctx.lineWidth = Math.max(1, 1.8 * sc);
            for (let i = -3; i <= 3; i++) {
                ctx.beginPath();
                ctx.moveTo(x, baseY);
                ctx.quadraticCurveTo(x + i * fh * 0.45, baseY - fh * 0.8, x + i * fh * 0.9, baseY - fh * 1.2);
                ctx.stroke();
            }
            return;
        }
        if (it.kind === 'dino') {
            const s2 = h * 0.09 * sc * size;
            if (s2 < 4) return;
            ctx.fillStyle = it.tone === 0 ? '#3f6212' : (it.tone === 1 ? '#365314' : '#4d7c0f');
            ctx.beginPath();
            ctx.ellipse(x, baseY - s2 * 0.95, s2 * 0.95, s2 * 0.55, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x + s2 * 0.35, baseY - s2 * 1.25);
            ctx.quadraticCurveTo(x + s2 * 0.9, baseY - s2 * 1.9, x + s2 * 1.15, baseY - s2 * 2.0);
            ctx.lineTo(x + s2 * 1.35, baseY - s2 * 1.75);
            ctx.quadraticCurveTo(x + s2 * 0.95, baseY - s2 * 1.55, x + s2 * 0.7, baseY - s2 * 1.1);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x - s2 * 0.8, baseY - s2 * 1.1);
            ctx.quadraticCurveTo(x - s2 * 1.7, baseY - s2 * 1.35, x - s2 * 2.1, baseY - s2 * 0.8);
            ctx.lineTo(x - s2 * 0.9, baseY - s2 * 0.75);
            ctx.closePath();
            ctx.fill();
            ctx.fillRect(x - s2 * 0.55, baseY - s2 * 0.55, s2 * 0.28, s2 * 0.55);
            ctx.fillRect(x + s2 * 0.25, baseY - s2 * 0.55, s2 * 0.28, s2 * 0.55);
            if (s2 > 10) {
                ctx.fillStyle = '#fef9c3';
                ctx.beginPath();
                ctx.arc(x + s2 * 1.08, baseY - s2 * 1.88, Math.max(1, s2 * 0.08), 0, Math.PI * 2);
                ctx.fill();
            }
            return;
        }
        if (it.kind === 'grandstand') {
            const gw = w * 0.16 * sc * size;
            const gh = h * 0.11 * sc * size;
            if (gw < 4 || gh < 4) return;
            const top = baseY - gh;
            ctx.fillStyle = it.tone === 0 ? '#f9a8b8' : (it.tone === 1 ? '#fbcfe8' : '#fda4af');
            ctx.fillRect(x - gw / 2, top, gw, gh);
            ctx.fillStyle = 'rgba(255,255,255,.85)';
            ctx.fillRect(x - gw / 2, top - Math.max(1, gh * 0.14), gw, Math.max(1, gh * 0.14));
            if (gw > 18 && gh > 16) {
                const cols = Math.min(8, Math.max(2, Math.floor(gw / 10)));
                const rows = Math.min(4, Math.max(1, Math.floor(gh / 12)));
                const gx = gw / (cols + 1);
                const gy = gh / (rows + 1);
                const palette = ['#ef4444', '#3b82f6', '#facc15', '#a855f7'];
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        ctx.fillStyle = palette[(r + c + it.tone) % palette.length];
                        ctx.fillRect(x - gw / 2 + gx * (c + 1) - gw * 0.018,
                            top + gy * (r + 1) - gh * 0.03,
                            gw * 0.036, gh * 0.06);
                    }
                }
            }
            return;
        }
        if (it.kind === 'floodlight') {
            const poleH = h * 0.19 * sc * size;
            const poleW = Math.max(1, 2.4 * sc);
            if (poleH < 4) return;
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = poleW;
            ctx.beginPath();
            ctx.moveTo(x, baseY);
            ctx.lineTo(x, baseY - poleH);
            ctx.stroke();
            const bankW = w * 0.055 * sc * size;
            const bankH = Math.max(2, h * 0.014 * sc);
            ctx.fillStyle = '#1f2937';
            ctx.fillRect(x - bankW / 2, baseY - poleH - bankH, bankW, bankH);
            const lamps = Math.max(2, Math.min(4, Math.floor(bankW / 6)));
            const stepX = bankW / lamps;
            for (let i = 0; i < lamps; i++) {
                ctx.fillStyle = '#fef9c3';
                ctx.fillRect(x - bankW / 2 + stepX * i + stepX * 0.2, baseY - poleH - bankH * 0.75, stepX * 0.6, bankH * 0.5);
            }
            return;
        }
        if (it.kind === 'flag') {
            const poleH = h * 0.085 * sc * size;
            const poleW = Math.max(1, 1.4 * sc);
            if (poleH < 3) return;
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = poleW;
            ctx.beginPath();
            ctx.moveTo(x, baseY);
            ctx.lineTo(x, baseY - poleH);
            ctx.stroke();
            const fw = w * 0.05 * sc * size;
            const fh = h * 0.028 * sc * size;
            ctx.fillStyle = it.tone === 0 ? '#ec4899' : (it.tone === 1 ? '#f97316' : '#8b5cf6');
            ctx.beginPath();
            ctx.moveTo(x, baseY - poleH);
            ctx.lineTo(x + fw, baseY - poleH + fh * 0.4);
            ctx.lineTo(x, baseY - poleH + fh);
            ctx.closePath();
            ctx.fill();
            return;
        }
        if (it.kind === 'stall') {
            const sw = w * 0.085 * sc * size;
            const sh = h * 0.05 * sc * size;
            if (sw < 3 || sh < 3) return;
            const top = baseY - sh;
            ctx.fillStyle = '#fef3c7';
            ctx.fillRect(x - sw / 2, top, sw, sh);
            const stripes = 4;
            for (let i = 0; i < stripes; i++) {
                ctx.fillStyle = i % 2 ? '#f8fafc' : '#f472b6';
                ctx.fillRect(x - sw / 2 + (sw / stripes) * i, top - sh * 0.28, sw / stripes, sh * 0.3);
            }
            ctx.fillStyle = 'rgba(15,23,42,.4)';
            ctx.fillRect(x - sw * 0.18, top + sh * 0.3, sw * 0.36, sh * 0.7);
            return;
        }
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
        const scene = DG.normalizeScene(S.scene);
        if (scene === 'stadium') return DG.drawStadiumBackdrop(ctx, camZ, horizonY);
        if (scene === 'jungle') return DG.drawJungleBackdrop(ctx, camZ, horizonY);
        return DG.drawDesertBackdrop(ctx, camZ, horizonY);
    };

    DG.drawDesertBackdrop = function (ctx, camZ, horizonY) {
        const w = DG.view.w, h = DG.view.h;
        const heading = DG.trackCurve(camZ);
        const scroll = (camZ * 0.05) % (w * 2);
        const shift = scroll + heading * w * 0.5;

        // Sun.
        ctx.fillStyle = 'rgba(255,247,214,.9)';
        ctx.beginPath();
        ctx.arc(w * 0.72 - heading * w * 0.12, horizonY - h * 0.13, h * 0.05, 0, Math.PI * 2);
        ctx.fill();

        // Far flat-top mesas.
        ctx.fillStyle = '#c99a5f';
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 2);
        for (let x = 0; x <= w; x += 8) {
            const t = (x + shift * 0.4) / w;
            const mesa = Math.max(0, Math.sin(t * Math.PI * 5 + 0.7)) * 0.7 +
                Math.max(0, Math.sin(t * Math.PI * 11 + 2.1)) * 0.3;
            ctx.lineTo(x, horizonY - h * (0.045 + 0.05 * mesa));
        }
        ctx.lineTo(w, horizonY + 2);
        ctx.closePath();
        ctx.fill();

        // Nearer dunes.
        ctx.fillStyle = '#b4833f';
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 4);
        for (let x = 0; x <= w; x += w / 10) {
            const hy = horizonY - (0.5 + 0.5 * Math.sin((x + shift) / w * Math.PI * 2.1 + 1.4)) * h * 0.035;
            ctx.lineTo(x, hy);
        }
        ctx.lineTo(w, horizonY + h * 0.06);
        ctx.lineTo(0, horizonY + h * 0.06);
        ctx.closePath();
        ctx.fill();

        // Distant cacti silhouettes.
        ctx.fillStyle = 'rgba(87,83,35,.5)';
        for (let i = 0; i < 4; i++) {
            const cx = ((i * 0.27 + 0.08) * w + shift * 0.6) % w;
            const ch = h * (0.022 + (i % 2) * 0.012);
            ctx.fillRect(cx - 1, horizonY - ch, 2, ch);
            ctx.fillRect(cx - ch * 0.28, horizonY - ch * 0.7, ch * 0.3, 1.6);
        }
    };

    DG.drawStadiumBackdrop = function (ctx, camZ, horizonY) {
        const w = DG.view.w, h = DG.view.h;
        const heading = DG.trackCurve(camZ);
        const scroll = (camZ * 0.07) % (w * 2);
        const shift = scroll + heading * w * 0.45;

        // Distant roof / upper tier.
        ctx.fillStyle = '#f7b7c8';
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 2);
        for (let x = 0; x <= w; x += 6) {
            const t = (x + shift * 0.35) / w;
            const bh = h * (0.05 + 0.018 * (Math.sin(t * Math.PI * 9 + 1.1) + 1) / 2);
            ctx.lineTo(x, horizonY - bh);
        }
        ctx.lineTo(w, horizonY + 2);
        ctx.closePath();
        ctx.fill();

        // Crowd blocks along the far straight.
        const blockW = w * 0.11;
        const blockShift = (shift * 0.6) % blockW;
        for (let i = -1; i <= Math.ceil(w / blockW); i++) {
            const bx = i * blockW - blockShift;
            const bh = h * (0.036 + ((i % 2) ? 0.016 : 0));
            const top = horizonY - bh;
            ctx.fillStyle = (i % 2) ? '#fbcfe8' : '#fda4af';
            ctx.fillRect(bx, top, blockW * 0.94, bh);
            const cols = 7, rows = 3;
            const cw = blockW * 0.94 / cols;
            const chh = bh / rows;
            const palette = ['#ef4444', '#2563eb', '#facc15', '#f8fafc', '#a855f7'];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    ctx.fillStyle = palette[(r + c + i + 6) % palette.length];
                    ctx.fillRect(bx + c * cw + cw * 0.2, top + r * chh + chh * 0.25, cw * 0.55, chh * 0.42);
                }
            }
        }

        // Banners hanging from the roof.
        const bannerCols = ['#ec4899', '#f97316', '#8b5cf6', '#22c55e'];
        for (let i = 0; i < 6; i++) {
            const bx = ((i * 0.19 + 0.05) * w - (shift * 0.9) % (w * 0.3) + w) % w;
            ctx.fillStyle = bannerCols[i % bannerCols.length];
            ctx.fillRect(bx, horizonY - h * 0.025, w * 0.035, h * 0.018);
        }

        // Floodlight towers.
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = Math.max(1, w * 0.0035);
        for (let i = 0; i < 4; i++) {
            const fx = ((i * 0.28 + 0.1) * w - heading * w * 0.2 + w) % w;
            const fh = h * (0.12 + (i % 2) * 0.02);
            ctx.beginPath();
            ctx.moveTo(fx, horizonY);
            ctx.lineTo(fx, horizonY - fh);
            ctx.stroke();
            ctx.fillStyle = '#1f2937';
            ctx.fillRect(fx - w * 0.02, horizonY - fh - h * 0.012, w * 0.04, h * 0.014);
            ctx.fillStyle = '#fef9c3';
            for (let l = 0; l < 3; l++) {
                ctx.fillRect(fx - w * 0.016 + l * w * 0.012, horizonY - fh - h * 0.008, w * 0.008, h * 0.007);
            }
        }
    };

    DG.drawJungleBackdrop = function (ctx, camZ, horizonY) {
        const w = DG.view.w, h = DG.view.h;
        const heading = DG.trackCurve(camZ);
        const scroll = (camZ * 0.06) % (w * 2);
        const shift = scroll + heading * w * 0.5;

        // Distant canopy haze.
        ctx.fillStyle = '#2f6b3d';
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 2);
        for (let x = 0; x <= w; x += 7) {
            const t = (x + shift * 0.3) / w;
            const bh = h * (0.05 + 0.026 * (Math.sin(t * Math.PI * 6 + 0.6) + 1) / 2);
            ctx.lineTo(x, horizonY - bh);
        }
        ctx.lineTo(w, horizonY + 2);
        ctx.closePath();
        ctx.fill();

        // Nearer tree line.
        ctx.fillStyle = '#245a34';
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 6);
        for (let x = 0; x <= w; x += 9) {
            const t = (x + shift * 1.4) / w;
            const th = h * (0.03 + 0.022 * (Math.sin(t * Math.PI * 9 + 2.0) + 1) / 2);
            ctx.lineTo(x, horizonY - th - Math.max(0, Math.sin(t * Math.PI * 14 + 0.4)) * h * 0.028);
        }
        ctx.lineTo(w, horizonY + h * 0.05);
        ctx.lineTo(0, horizonY + h * 0.05);
        ctx.closePath();
        ctx.fill();

        // Palm silhouettes at the horizon.
        ctx.strokeStyle = 'rgba(20,83,45,.85)';
        for (let i = 0; i < 5; i++) {
            const px = ((i * 0.23 + 0.06) * w + shift * 0.5 + w) % w;
            const ph = h * (0.045 + (i % 3) * 0.01);
            ctx.lineWidth = Math.max(1, w * 0.0025);
            ctx.beginPath();
            ctx.moveTo(px, horizonY);
            ctx.lineTo(px - h * 0.004, horizonY - ph);
            ctx.stroke();
            for (let f = -2; f <= 2; f++) {
                ctx.beginPath();
                ctx.moveTo(px - h * 0.004, horizonY - ph);
                ctx.quadraticCurveTo(px + f * ph * 0.28, horizonY - ph - ph * 0.24, px + f * ph * 0.46, horizonY - ph - ph * 0.02);
                ctx.stroke();
            }
        }
    };

    DG.drawTrack = function (ctx, camZ, horizonY) {
        const w = DG.view.w, h = DG.view.h;
        const style = DG.sceneStyle();
        const pts = [];
        for (let i = 0; i <= SEGMENT_COUNT; i++) {
            const t = i / SEGMENT_COUNT;
            const rel = NEAR_REL * Math.pow(FAR_REL / NEAR_REL, t);
            pts.push({ z: camZ + rel, p: DG.projectRel(rel, 1) });
        }

        // Shoulder bands behind the road; they scroll because they follow world Z.
        for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
            const far = pts[i + 1], near = pts[i];
            ctx.fillStyle = (Math.floor(far.z / SCENERY_STEP) % 2 === 0) ? style.bandA : style.bandB;
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
            ctx.fillStyle = band ? style.roadA : style.roadB;
            ctx.beginPath();
            ctx.moveTo(far.p.centerX - far.p.roadHalf, far.p.y);
            ctx.lineTo(far.p.centerX + far.p.roadHalf, far.p.y);
            ctx.lineTo(near.p.centerX + near.p.roadHalf, near.p.y);
            ctx.lineTo(near.p.centerX - near.p.roadHalf, near.p.y);
            ctx.closePath();
            ctx.fill();

            // Alternating kerbs just outside the road.
            const kerb = band ? style.kerbA : style.kerbB;
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
                ctx.fillStyle = style.dash;
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

        // Continuous edge lines.
        ctx.strokeStyle = style.edge;
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

        // Sky / ground (palette depends on the chosen course).
        const style = DG.sceneStyle();
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        style.sky.forEach(stop => sky.addColorStop(stop[0], stop[1]));
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        const horizonY = DG.trackHorizonY();
        DG.drawBackdrop(ctx, p.dist, horizonY);
        ctx.fillStyle = style.ground;
        ctx.fillRect(0, horizonY, w, h - horizonY);

        DG.ensureScenery(p.dist);
        DG.drawTrack(ctx, p.dist, horizonY);
        DG.drawScenery(ctx, p.dist, horizonY);

        // Finish line in multiplayer
        // The 4200 m finish line is no longer a win condition (racers
        // finish at N correct), so it is not drawn.

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

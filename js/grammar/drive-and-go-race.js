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
        topic: 'tenses',
        bankMode: 'av',
        scene: 'desert',
        opts: null,
        room: null,
        questions: [],
        qIndex: 0,
        activeQ: null,
        gates: [],
        gatesResolved: false,
        wrongList: [],
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
        // The local racer reached N correct: their own results panel is up
        // while the rest of the room is still racing. Kept apart from
        // resultShown so the final room ranking can still replace it.
        ownResultShown: false,
        questionCount: 20,
        accelHeld: false,
        accelKeys: {},
        accelSources: { key: false, button: false },
        tilt: { enabled: false, zero: null, active: false, left: false, right: false, lastAt: 0, timer: 0, warned: false, target: 1, delta: 0, manualUntil: 0 },
        swipe: { down: false, x: 0 },
        listeners: []
    };
    DG.raceState = S;

    /* ---------------- background music ---------------- */
    const DG_MUSIC_KEY = 'learniTY_dg_music';
    DG.musicOn = (() => {
        try { return localStorage.getItem(DG_MUSIC_KEY) !== '0'; } catch (e) { return true; }
    })();
    DG.music = null;

    DG.ensureMusic = function () {
        if (DG.music) return;
        DG.music = new Audio('/music/battlemusic.mp3');
        DG.music.loop = true;
        DG.music.volume = 0.35;
        DG.music.preload = 'none';
    };

    DG.syncMusicUi = function () {
        const btn = DG.raceEls && DG.raceEls.musicBtn;
        if (!btn) return;
        btn.innerText = DG.musicOn ? '🔊' : '🔇';
        btn.classList.toggle('on', DG.musicOn);
        btn.setAttribute('aria-label', DG.musicOn ? 'Mute music' : 'Play music');
        btn.title = DG.musicOn ? 'Mute music' : 'Play music';
    };

    DG.startMusic = function () {
        if (!DG.musicOn) return;
        DG.ensureMusic();
        try { DG.music.play().catch(() => {}); } catch (e) {}
    };

    DG.stopMusic = function () {
        if (!DG.music) return;
        try {
            DG.music.pause();
            DG.music.currentTime = 0;
        } catch (e) {}
    };

    DG.toggleMusic = function () {
        DG.musicOn = !DG.musicOn;
        try { localStorage.setItem(DG_MUSIC_KEY, DG.musicOn ? '1' : '0'); } catch (e) {}
        DG.syncMusicUi();
        if (DG.musicOn) DG.startMusic();
        else DG.stopMusic();
    };

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
            accelBtn: document.getElementById('dg-accel-btn'),
            fsBtn: document.getElementById('dg-fs-btn'),
            musicBtn: document.getElementById('dg-music-btn')
        };
        DG.resizeCanvas();
        DG.bindRaceInput();
        DG.syncRaceFsUi();
        DG.syncMusicUi();
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
        if (DG.three) {
            DG.three.renderer.setSize(w, h, false);
            DG.three.camera.aspect = w / Math.max(1, h);
            DG.three.camera.updateProjectionMatrix();
        }
    };

    DG.startRace = function (opts) {
        DG.stopRace();
        const settings = DG.readSettings();
        const mode = opts.mode === 'multi' ? 'multi' : 'single';
        const topic = DG.normalizeTopic(opts.topic || (opts.room && opts.room.topic) || settings.topic);
        const bankMode = DG.normalizeBankMode(topic, opts.bankMode || settings.bankMode);
        const bank = DG.bankCache[DG.bankKey(topic, bankMode)] || [];
        if (!bank.length) {
            DG.showLoadError(topic, bankMode, new Error('The question bank is not loaded yet.'));
            return;
        }
        S.opts = Object.assign({}, opts, { mode, topic, bankMode });
        S.active = true;
        S.raf = 0;
        S.lastTs = 0;
        S.clock = 0;
        S.phase = 'countdown';
        S.paused = false;
        S.mode = mode;
        S.topic = topic;
        S.bankMode = bankMode;
        S.room = opts.room || null;
        S.scene = DG.normalizeScene(opts.scene || (opts.room && opts.room.scene) || (settings && settings.scene));
        S.questions = DG.raceQuestionQueue(topic, bankMode, opts.seed);
        S.qIndex = 0;
        S.activeQ = null;
        S.gates = [];
        S.gatesResolved = false;
        S.wrongList = [];
        S.gateDist = DG.START_GATE_DIST;
        S.nextGateAt = 0;
        S.nextGateDist = 0;
        S.lastResult = null;
        S.bananas = [];
        S.pendingHits = [];
        S.blockedNoticeAt = 0;
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
        S.ownResultShown = false;
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
            finished: false, finishAt: 0, look: DG.raceLook(), name: currentUser && currentUser.email ? currentUser.email.split('@')[0] : 'You'
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
        DG.initThree();
        DG.startMusic();
        DG.spawnGates();
        DG.updateRaceHud(true);
        DG.showOverlay('', true);
        if (mode === 'multi') {
            DG.updateMpProgress((opts && opts.players) || []);
            if (typeof DG.mpStartRacePoll === 'function') DG.mpStartRacePoll();
        } else {
            DG.hideMpProgress();
        }
        S.lastTs = 0;
        S.raf = requestAnimationFrame(DG.raceFrame);
    };

    DG.stopRace = function () {
        const wasActive = S.active;
        S.active = false;
        S.phase = 'idle';
        S.paused = false;
        DG.stopMusic();
        DG.disposeThree();
        DG.releaseAccel();
        if (S.raf) cancelAnimationFrame(S.raf);
        S.raf = 0;
        DG.unbindRaceInput();
        if (typeof DG.mpStopRacePoll === 'function') DG.mpStopRacePoll();
        document.body.classList.remove('dg-racing');
        const raceView = document.getElementById('drive-and-go-view');
        if (raceView) raceView.classList.remove('dg-live');
        DG.hideMpProgress();
        DG.hideOverlay();
        if (DG.raceEls && DG.raceEls.toast) DG.raceEls.toast.classList.remove('show');
        if (wasActive) S.player = null;
    };

    DG.exitRace = function () {
        DG.exitRaceFullscreen();
        DG.stopRace();
        changeView('grammar-revision-view');
    };

    /* Stop the animation loop but keep the race view + overlay on screen. Used
       when a results panel must stay up and the run is over (final room
       results, room gone) so a dead track is not redrawn forever. */
    DG.freezeRaceLoop = function () {
        S.phase = 'finished';
        if (S.raf) cancelAnimationFrame(S.raf);
        S.raf = 0;
        DG.stopMusic();
        DG.releaseAccel();
        DG.unbindRaceInput();
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
        // A finished run is a static results screen: stop the loop instead of
        // drawing an invisible frame forever behind the overlay.
        S.raf = S.phase === 'finished' ? 0 : requestAnimationFrame(DG.raceFrame);
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
        DG.updatePendingHits();
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
        // DG.laneStep() is the one place that advances the lane: in discrete
        // mode it must NEVER overwrite the button / key / swipe target from
        // laneX, or the kart snaps back to the centre before it can move.
        const tiltFresh = S.tilt.active && (Date.now() - (S.tilt.lastAt || 0) < 2000);
        const tiltLive = S.tilt.enabled && tiltFresh && now >= (S.tilt.manualUntil || 0);
        const laneTarget = tiltLive ? DG.tiltLaneTarget(S.tilt.delta) : null;
        if (tiltLive) S.tilt.target = laneTarget;
        const laneState = DG.laneStep(p, dt, laneTarget);
        p.laneX = laneState.laneX;
        p.lane = laneState.lane;

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

        if (S.mode === 'multi') DG.applyMultiCollision();

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

        // Gate crossing. A finished racer no longer answers gates. laneStep()
        // keeps p.lane in sync with the kart: it is the pressed target in
        // button / key / swipe mode and the nearest lane while tilting.
        if (!p.finished && !S.gatesResolved && S.gates.length && p.dist >= S.gateDist) {
            DG.answerGate(p.lane);
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
            S.questions = DG.raceQuestionQueue(S.topic, S.bankMode, S.mode === 'multi' && S.opts ? S.opts.seed : null);
            S.qIndex = 0;
        }
        const q = S.questions[S.qIndex++];
        S.activeQ = q;
        let rng = Math.random;
        if (S.mode === 'multi' && S.opts && S.opts.seed != null) {
            rng = DG.makeRng((Number(S.opts.seed) ^ DG.hashString(q.id)) >>> 0);
        }
        const gates = DG.gatesFor(q, S.topic, S.bankMode, rng);
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
        const correctGates = S.gates.filter(g => g.correct);
        if (!correctGates.length) return;
        const correct = (typeof DG.gateIsCorrect === 'function')
            ? DG.gateIsCorrect(S.gates, lane)
            : Number(lane) === correctGates[0].lane;
        S.gatesResolved = true;
        S.lastResult = { correct, lane: Number(lane), correctLane: correctGates[0].lane };
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
            const chosenGate = S.gates.find(g => Number(g.lane) === Number(lane));
            const prompt = (typeof DG.displayPrompt === 'function')
                ? DG.displayPrompt(S.activeQ, S.gates)
                : String((S.activeQ && S.activeQ.prompt) || '');
            S.wrongList.push({
                prompt: prompt,
                correct: correctGates.map(g => g.label).join(' / '),
                chosen: chosenGate ? chosenGate.label : '',
                section: S.activeQ && S.activeQ.section ? S.activeQ.section : ''
            });
            DG.toast('❌ Correct: ' + correctGates.map(g => g.label).join(' / '), 2200);
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
        DG.stopMusic();
        p.elapsed = result.elapsed;
        p.timeBonus = result.timeBonus;
        p.composite = result.composite;
        p.accuracy = result.accuracy;
        p.runResult = result;
        DG.releaseAccel();
        if (S.mode === 'single') {
            DG.recordBestRun(S.topic, S.bankMode, S.questionCount, result);
            DG.recordBest(p.score, p.dist);
            DG.toast('🏁 ' + S.questionCount + ' correct — finished!', 1800);
            // Cloud board is fire-and-forget; the results screen never waits for it.
            DG.submitCloudRun('single', Object.assign({}, result, {
                topic: S.topic,
                bankMode: S.bankMode,
                scene: S.scene
            }), null);
            // Show the results at once and keep them up until the player taps
            // a button. Never navigate for them.
            DG.showSoloResults(result, { reached: true, maxCombo: p.maxCombo });
        } else {
            DG.toast('🏁 ' + S.questionCount + ' correct — waiting for the others…', 2200);
            if (!S.finishSent && typeof DG.mpCrossFinish === 'function') {
                S.finishSent = true;
                DG.mpCrossFinish();
            }
            // An early finisher gets their own results panel straight away and
            // stays in the room; the final ranking replaces it when the room
            // finishes. No view change, no leave RPC.
            DG.showMpOwnResults(result);
        }
        recordDailyPractice('Drive & Go!', { delayMs: 800 });
    };

    DG.playerRank = function () {
        if (!S.player) return 1;
        const list = [S.player].concat(S.rivals || []);
        list.sort((a, b) => (b.dist || 0) - (a.dist || 0));
        return Math.max(1, list.indexOf(S.player) + 1);
    };

    DG.applyMultiCollision = function () {
        const p = S.player;
        if (!p || p.finished) return;
        let blocked = null;
        S.rivals.forEach(r => {
            const gap = (r.dist || 0) - p.dist;
            const lane = (r.laneX == null ? r.lane : r.laneX);
            if (gap > 0 && gap < 9 && Math.abs(lane - p.laneX) < 0.55) {
                if (!blocked || r.dist < blocked.dist) blocked = r;
            }
        });
        if (!blocked) {
            S.blockedNoticeAt = 0;
            return;
        }
        const keep = Math.max(0, blocked.dist - 9);
        if (p.dist > keep) p.dist = keep;
        p.speed = Math.min(p.speed, Math.max(0, blocked.speed || 0));
        if (!S.blockedNoticeAt || S.clock > S.blockedNoticeAt + 4) {
            S.blockedNoticeAt = S.clock;
            DG.toast('↔️ Steer left or right to pass!', 1200);
        }
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
        else if (key === 'f' || key === 'F') { DG.toggleRaceFullscreen(); e.preventDefault(); }
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
        // Keep the release on the stage even if the finger drifts over the HUD
        // buttons, otherwise pointerup never reaches us and the swipe is lost.
        if (e.currentTarget && e.pointerId != null && e.currentTarget.setPointerCapture) {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
        }
    };

    DG.onPointerUp = function (e) {
        if (!S.active || !S.swipe.down) return;
        S.swipe.down = false;
        if (e && e.type === 'pointercancel') return;
        const dir = DG.swipeStep(e.clientX - S.swipe.x);
        if (dir) DG.steer(dir);
    };

    /* Pure swipe → steer mapping: -1 = left, 1 = right, 0 = a tap. Shared
       with the unit tests so a broken threshold / direction is caught. */
    DG.swipeStep = function (dx) {
        const d = Number(dx);
        if (!isFinite(d) || Math.abs(d) < 32) return 0;
        return d < 0 ? -1 : 1;
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
        add(document, 'fullscreenchange', DG.onRaceFsChange);
        add(document, 'webkitfullscreenchange', DG.onRaceFsChange);
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
        if (p.finished) return;
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
            const rel = Math.max(18, target.dist - p.dist);
            const duration = 0.45 + Math.min(0.4, rel / 1100);
            DG.scheduleHit(target, 'spin', 2000, '🔴 Red shell hit ' + target.name + '!', duration);
            if (typeof DG.spawnThreeProjectile === 'function') {
                DG.spawnThreeProjectile('redshell', {
                    fromRel: 2,
                    toRel: rel,
                    fromLane: p.laneX,
                    toLane: target.laneX,
                    duration: duration,
                    arc: 1.0
                });
            }
            if (typeof DG.mpSendProjectile === 'function' && S.mode === 'multi') {
                DG.mpSendProjectile({
                    kind: 'redshell', userId: currentUser && currentUser.id,
                    fromDist: p.dist + 2, toDist: target.dist,
                    fromLane: p.laneX, toLane: target.laneX,
                    duration: duration, arc: 1.0
                });
            }
            DG.toast('🔴 Red shell fired!', 900);
        } else if (kind === 'banana') {
            p.item = null;
            S.bananas.push({ dist: Math.max(0, p.dist - 18), lane: p.lane, hit: false });
            if (typeof DG.spawnThreeProjectile === 'function') {
                DG.spawnThreeProjectile('banana', {
                    fromRel: 0,
                    toRel: -5,
                    fromLane: p.laneX,
                    toLane: p.laneX,
                    duration: 0.5,
                    arc: 3.0
                });
            }
            if (typeof DG.mpSendProjectile === 'function' && S.mode === 'multi') {
                DG.mpSendProjectile({
                    kind: 'banana', userId: currentUser && currentUser.id,
                    fromDist: p.dist, toDist: p.dist - 5,
                    fromLane: p.laneX, toLane: p.laneX,
                    duration: 0.5, arc: 3.0
                });
            }
            const target = DG.raceTarget('behind');
            if (target) {
                DG.scheduleHit(target, 'spin', DG.SPIN_TIME * 1000, '🍌 ' + target.name + ' spun out!', 0.5);
                DG.toast('🍌 Banana thrown!', 1000);
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
            if (typeof DG.spawnThreeBurst === 'function') {
                S.rivals.forEach(r => {
                    const rel = r.dist - p.dist;
                    if (rel > -20 && rel < 1200) {
                        DG.spawnThreeBurst(DG.threeLaneX(rel, r.laneX), DG.threeRoadY(rel) + 1.0, -rel, 0xfacc15);
                    }
                });
            }
            DG.toast('⚡ Lightning! ' + hit + ' rival' + (hit === 1 ? '' : 's') + ' slowed.', 1800);
        } else if (kind === 'star') {
            p.item = null;
            p.starUntil = Math.max(p.starUntil, now + 6);
            p.boostUntil = Math.max(p.boostUntil, now + 5);
            if (typeof DG.threePlayerBurst === 'function') DG.threePlayerBurst(0xfde047);
            DG.toast('⭐ Star power! Invincible + boost.', 1600);
        } else if (kind === 'mushroom') {
            p.item = null;
            p.boostUntil = Math.max(p.boostUntil, now + 3);
            p.speed = Math.min(DG.SPEED_CAP || 340, p.speed + 18);
            if (typeof DG.threePlayerBurst === 'function') DG.threePlayerBurst(0x22c55e);
            DG.toast('🍄 Mushroom boost!', 1400);
        }
        DG.updateItemSlot();
    };

    DG.remoteEffect = function (target, kind, ms) {
        if (S.mode !== 'multi' || !target || !target.userId) return;
        if (typeof DG.mpApplyEffect === 'function') DG.mpApplyEffect(target.userId, kind, ms);
    };

    DG.scheduleHit = function (target, kind, ms, toastText, delaySec) {
        if (!target) return;
        if (!S.pendingHits) S.pendingHits = [];
        S.pendingHits.push({
            at: S.clock + Math.max(0, Number(delaySec) || 0),
            target: target,
            kind: kind,
            ms: Math.max(100, Number(ms) || 1500),
            toastText: toastText || ''
        });
    };

    DG.updatePendingHits = function () {
        if (!S.pendingHits || !S.pendingHits.length) return;
        for (let i = S.pendingHits.length - 1; i >= 0; i--) {
            const h = S.pendingHits[i];
            if (S.clock < h.at) continue;
            const target = h.target;
            if (target) {
                if (h.kind === 'spin') {
                    target.spinUntil = Math.max(target.spinUntil || 0, S.clock + h.ms / 1000);
                    DG.remoteEffect(target, 'spin', h.ms);
                } else if (h.kind === 'slow') {
                    target.slowUntil = Math.max(target.slowUntil || 0, S.clock + h.ms / 1000);
                    DG.remoteEffect(target, 'slow', h.ms);
                }
            }
            if (h.toastText) DG.toast(h.toastText, 1600);
            S.pendingHits.splice(i, 1);
        }
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
        const qText = q
            ? (typeof DG.displayPrompt === 'function' ? DG.displayPrompt(q, S.gates) : q.prompt)
            : 'Get ready…';
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
        // A racer who already reached N correct is on their results panel;
        // the pause menu must not cover it while the room finishes.
        if (S.player && S.player.finished) return;
        S.paused = !S.paused;
        if (S.paused) {
            DG.releaseAccel();
            DG.showOverlay(
                '<div class="text-center"><div class="text-6xl mb-2">⏸</div><h3 class="text-2xl font-bold text-orange-600 mb-2">Paused</h3>' +
                '<p class="text-gray-500 font-bold mb-5">' + (S.mode === 'multi' ? 'Other racers keep going. Accel is released until you resume.' : 'Take a breath. Your run is waiting. Accel is released.') + '</p>' +
                '<div class="flex gap-3 justify-center flex-wrap">' +
                '<button type="button" class="btn-paw" onclick="DG.togglePause()">Resume</button>' +
                '<button type="button" class="dg-menu-button" onclick="DG.toggleRaceFullscreen()">' +
                '<span id="dg-pause-fs">' + (DG.raceFsOn() ? '✕ Exit full screen' : '⛶ Full screen') + '</span></button>' +
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

    /* ---------------- results screens ---------------- */

    /* One stat grid shared by the Solo results, the early Multiplayer
       finisher panel and the room summary. The question count always comes
       from the run itself (20 / 25 / 30 / 35 / 40 / 50), never a fixed 20. */
    DG.resultGridHTML = function (result, extra) {
        const r = result || {};
        const o = extra || {};
        const n = DG.normalizeQuestionCount(r.questionCount);
        const num = (v) => Math.floor(Number(v) || 0);
        const cells = [
            '<div><span>Composite</span><b>' + num(r.composite) + '</b></div>',
            '<div><span>Race score</span><b>' + num(r.raceScore) + '</b></div>',
            '<div><span>Time bonus</span><b>+' + num(r.timeBonus) + '</b></div>',
            '<div><span>Time</span><b>' + DG.formatRaceTime(r.elapsed) + '</b></div>',
            '<div><span>Accuracy</span><b>' + DG.formatAccuracy(r.accuracy) + '</b></div>',
            '<div><span>Correct</span><b>' + num(r.correct) + '/' + n + '</b></div>'
        ];
        const wrong = r.wrong == null ? o.wrong : r.wrong;
        if (wrong != null) cells.push('<div><span>Wrong</span><b>' + num(wrong) + '</b></div>');
        const combo = o.maxCombo == null ? r.maxCombo : o.maxCombo;
        if (combo != null) cells.push('<div><span>Max combo</span><b>x' + num(combo) + '</b></div>');
        return '<div class="dg-result-grid mb-5">' + cells.join('') + '</div>';
    };

    DG.wrongQuestionsHTML = function () {
        const list = (S.wrongList || []).slice(0, 12);
        if (!list.length) return '';
        return '<div class="dg-wrong-list">' +
            '<p class="dg-wrong-title">❌ Review these questions</p>' +
            '<ol>' + list.map(w =>
                '<li><span class="dg-wrong-prompt">' + DG.esc(w.prompt) + '</span>' +
                '<span class="dg-wrong-answer">Answer: <b>' + DG.esc(w.correct) + '</b></span>' +
                (w.chosen ? '<span class="dg-wrong-chosen">You chose: ' + DG.esc(w.chosen) + '</span>' : '') +
                '</li>').join('') + '</ol>' +
            ((S.wrongList || []).length > list.length
                ? '<p class="dg-wrong-more">… and ' + (S.wrongList.length - list.length) + ' more</p>'
                : '') +
            '</div>';
    };

    DG.bestRunLine = function (result) {
        const r = result || {};
        const n = DG.normalizeQuestionCount(r.questionCount);
        const best = DG.readBestRun(S.topic, S.bankMode, n);
        if (!best) return 'No personal best for ' + n + ' questions yet.';
        return 'Personal best for ' + n + ' questions: ' + best.composite + ' pts · ' + DG.formatRaceTime(best.time);
    };

    /* A Word-Jump-style board on the results screen. Only runs with the SAME
       topic, challenge (AV / PV / Mixed / Gap-fill / Choose) and question
       count are compared, because a 50-question run earns a much bigger time
       bonus than a 20-question run. Each student appears once with their best
       run for that exact setup. */
    DG.resultsBoardHTML = function (kind, topic, bankMode, count) {
        const n = DG.normalizeQuestionCount(count);
        const t = DG.normalizeTopic(topic);
        const m = DG.normalizeBankMode(t, bankMode);
        const label = DG.challengeShort(t, m) + ' · ' + n + ' questions';
        return '<div id="dg-results-board" class="dg-results-board" data-kind="' + DG.esc(kind) +
            '" data-topic="' + DG.esc(t) + '" data-mode="' + DG.esc(m) + '" data-count="' + n + '">' +
            '<p class="dg-board-title">🏆 Top 7 · ' + DG.esc(label) + '</p>' +
            '<p class="dg-board-note">Personal best per student for this exact setup.</p>' +
            '<p class="dg-board-empty">Loading…</p></div>';
    };

    DG.scheduleResultsBoard = function (kind, topic, bankMode, count) {
        setTimeout(function () {
            DG.loadResultsBoard(kind, topic, bankMode, count);
        }, 500);
    };

    DG.loadResultsBoard = async function (kind, topic, bankMode, count) {
        const board = document.getElementById('dg-results-board');
        if (!board) return;
        const n = DG.normalizeQuestionCount(count);
        const t = DG.normalizeTopic(topic);
        const m = DG.normalizeBankMode(t, bankMode);
        const label = DG.challengeShort(t, m) + ' · ' + n + ' questions';
        const fail = function (message) {
            if (!board.isConnected) return;
            board.innerHTML = '<p class="dg-board-title">🏆 Top 7 · ' + DG.esc(label) + '</p>' +
                '<p class="dg-board-empty">' + DG.esc(message) + '</p>';
        };
        if (isGuestUser()) {
            fail('Leaderboards are hidden in guest mode. Sign in with your school account to compare.');
            return;
        }
        if (typeof sb === 'undefined' || !sb) {
            fail('The leaderboard needs a connection.');
            return;
        }
        const table = kind === 'multi' ? 'drive_and_go_multi_scores' : 'drive_and_go_solo_scores';
        try {
            const { data, error } = await sb.from(table)
                .select('user_id,nickname,email,composite,elapsed_ms,accuracy,created_at')
                .eq('topic', t)
                .eq('bank_mode', m)
                .eq('question_count', n)
                .order('composite', { ascending: false })
                .order('elapsed_ms', { ascending: true })
                .order('accuracy', { ascending: false })
                .order('created_at', { ascending: true })
                .limit(500);
            if (!board.isConnected || document.getElementById('dg-results-board') !== board) return;
            if (error) throw error;
            const seen = {};
            const rows = (data || []).filter(row => {
                if (!row || !row.user_id) return false;
                const key = String(row.user_id);
                if (seen[key]) return false;
                seen[key] = 1;
                return true;
            });
            if (!rows.length) {
                fail('No runs for this setup yet — be the first!');
                return;
            }
            const me = currentUser ? currentUser.id : null;
            const myIndex = rows.findIndex(row => me && row.user_id === me);
            const top = rows.slice(0, 7);
            const medal = i => i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : (i + 1) + '.'));
            const nameOf = row => (typeof DG.mpPlayerName === 'function')
                ? DG.mpPlayerName(row)
                : (row.nickname || String(row.email || '').split('@')[0] || 'Player');
            const time = row => DG.formatRaceTime((Number(row.elapsed_ms) || 0) / 1000);
            const acc = row => DG.formatAccuracy(Number(row.accuracy) || 0);
            board.innerHTML = '<p class="dg-board-title">🏆 Top 7 · ' + DG.esc(label) + '</p>' +
                '<p class="dg-board-note">Personal best per student for this exact setup.</p>' +
                '<div class="dg-board">' + top.map((row, i) => {
                    const mine = me && row.user_id === me;
                    return '<div class="dg-board-row' + (mine ? ' me' : '') + '">' +
                        '<span class="dg-board-medal">' + medal(i) + '</span>' +
                        '<span class="dg-board-name">' + DG.esc(DG.mpPlayerName(row)) + (mine ? ' (you)' : '') + '</span>' +
                        '<span class="dg-board-score">' + (Number(row.composite) || 0) + '<small> pts</small></span>' +
                        '<span class="dg-board-meta">' + time(row) + ' · ' + acc(row) + '</span>' +
                        '</div>';
                }).join('') + '</div>' +
                (myIndex > 6
                    ? '<p class="dg-board-you">Your best for this setup: #' + (myIndex + 1) + ' · ' +
                        (Number(rows[myIndex].composite) || 0) + ' pts</p>'
                    : '');
        } catch (e) {
            if (board.isConnected) fail('Leaderboard unavailable right now.');
        }
    };

    DG.soloResultsHTML = function (result, opts) {
        const r = result || {};
        const o = opts || {};
        const n = DG.normalizeQuestionCount(r.questionCount);
        const reached = o.reached == null
            ? (Number(r.correct) || 0) >= n
            : !!o.reached;
        return '<div class="text-center"><div class="text-6xl mb-1">🏁</div>' +
            '<h3 class="text-3xl font-bold text-orange-600 mb-1">' + (reached ? 'Run finished' : 'Run ended') + '</h3>' +
            '<p class="text-gray-400 font-bold mb-4">' + DG.esc(DG.topicChallenge(S.topic, S.bankMode)) + ' · ' + n + ' questions</p>' +
            DG.resultGridHTML(r, { maxCombo: o.maxCombo }) +
            '<p class="text-sm font-bold text-gray-500 mb-5">' + DG.esc(DG.bestRunLine(r)) + '</p>' +
            DG.wrongQuestionsHTML() +
            DG.resultsBoardHTML('single', S.topic, S.bankMode, n) +
            '<div class="flex gap-3 justify-center flex-wrap">' +
            '<button type="button" class="btn-paw" onclick="DG.restartRace()">Race again</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.exitRace()">Back to Tenses</button>' +
            '</div></div>';
    };

    /* Solo results. Marks the run as over but does NOT call changeView, so the
       player stays on this screen until they tap Race again / Back. */
    DG.showSoloResults = function (result, opts) {
        const p = S.player;
        const r = result || (p && p.runResult) ||
            DG.scoreRun(p || {}, p && p.elapsed != null ? p.elapsed : DG.raceElapsedSeconds(), S.questionCount);
        S.resultShown = true;
        S.phase = 'finished';
        S.paused = false;
        DG.releaseAccel();
        DG.unbindRaceInput();
        DG.showOverlay(DG.soloResultsHTML(r, Object.assign({
            maxCombo: p ? p.maxCombo : undefined
        }, opts)));
        DG.scheduleResultsBoard('single', S.topic, S.bankMode, DG.normalizeQuestionCount(r.questionCount));
        return r;
    };

    DG.mpOwnResultsHTML = function (result, board, opts) {
        const r = result || {};
        const o = opts || {};
        const n = DG.normalizeQuestionCount(r.questionCount);
        const progress = (typeof DG.mpProgressHTML === 'function') ? DG.mpProgressHTML(board) : '';
        return '<div class="text-center"><div class="text-6xl mb-1">🏁</div>' +
            '<h3 class="text-3xl font-bold text-orange-600 mb-1">You finished!</h3>' +
            '<p class="text-gray-500 font-bold mb-4">' + DG.esc(DG.topicChallenge(S.topic, S.bankMode)) + ' · ' + n + ' questions</p>' +
            DG.resultGridHTML(r, { maxCombo: o.maxCombo }) +
            DG.wrongQuestionsHTML() +
            DG.resultsBoardHTML('multi', S.topic, S.bankMode, n) +
            '<p class="text-sm font-bold text-gray-500 mb-3">' +
            (o.closed
                ? 'The room is no longer available. Your run still counts.'
                : 'Waiting for the other racers — your run is locked in.') +
            '</p>' +
            '<div class="dg-results-progress" id="dg-results-progress">' +
            (progress || '<p class="dg-results-wait">Waiting for the room…</p>') +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap">' +
            '<button type="button" class="dg-menu-button" onclick="DG.mpDetachRace()">Leave race</button>' +
            '</div></div>';
    };

    /* The early Multiplayer finisher panel. The race stays live (rivals keep
       moving, the room poll keeps running) while this is on screen, so the
       final ranking can still arrive and replace it. */
    DG.showMpOwnResults = function (result, opts) {
        if (S.resultShown) return;
        const p = S.player;
        if (!p || !p.finished) return;
        const r = result || p.runResult ||
            DG.scoreRun(p, p.elapsed != null ? p.elapsed : DG.raceElapsedSeconds(), S.questionCount);
        S.ownResultShown = true;
        const players = (DG.mpState && DG.mpState.players) || (S.opts && S.opts.players) || [];
        const board = (typeof DG.mpProgressBoard === 'function')
            ? DG.mpProgressBoard(players, {
                mode: 'multi',
                meId: currentUser && currentUser.id,
                questionCount: S.questionCount
            })
            : null;
        DG.showOverlay(DG.mpOwnResultsHTML(r, board, Object.assign({
            maxCombo: p.maxCombo
        }, opts)));
        DG.scheduleResultsBoard('multi', S.topic, S.bankMode, DG.normalizeQuestionCount(r.questionCount));
        return r;
    };

    DG.endRun = function () {
        if (S.phase === 'finished') return;
        S.paused = false;
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
        const reached = p.correct >= S.questionCount;
        if (reached) DG.recordBestRun(S.topic, S.bankMode, S.questionCount, result);
        DG.recordBest(p.score, p.dist);
        DG.showSoloResults(result, { reached: reached, maxCombo: p.maxCombo });
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
        const roomTopic = DG.normalizeTopic((room && room.topic) || S.topic);
        const roomMode = DG.normalizeBankMode(roomTopic, (room && room.question_mode) || S.bankMode);
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
        // Your own run keeps the full breakdown (composite / race score / time
        // bonus / time / accuracy / correct out of N) even in the room summary.
        const mine = rows.find(r => currentUser && r.user_id === currentUser.id);
        const myRun = mine ? {
            composite: points(mine),
            raceScore: Number(mine.score) || 0,
            timeBonus: Math.max(0, points(mine) - (Number(mine.score) || 0)),
            elapsed: (Number(mine.elapsed_ms) || 0) / 1000,
            accuracy: (Number(mine.correct) + Number(mine.wrong))
                ? Number(mine.correct) / (Number(mine.correct) + Number(mine.wrong))
                : 0,
            correct: Number(mine.correct) || 0,
            wrong: Number(mine.wrong) || 0,
            questionCount: n
        } : null;
        DG.showOverlay(
            '<div class="text-center"><div class="text-6xl mb-1">' + (youWin ? '🏆' : '🏁') + '</div>' +
            '<h3 class="text-3xl font-bold ' + (youWin ? 'text-amber-600' : 'text-orange-600') + ' mb-1">' +
            (youWin ? 'You win!' : DG.esc((winner && DG.mpPlayerName(winner)) || 'Race finished') + ' wins!') + '</h3>' +
            '<p class="text-sm font-bold text-gray-500 mb-1">' + DG.esc(DG.topicChallenge(roomTopic, roomMode)) + '</p>' +
            '<p class="text-sm font-bold text-gray-500 mb-4">' + DG.esc(reason) + '</p>' +
            (myRun
                ? '<p class="text-sm font-bold text-gray-500 mb-2">Your run</p>' + DG.resultGridHTML(myRun)
                : '') +
            DG.wrongQuestionsHTML() +
            '<div class="dg-standings mb-5">' + rows.map((r, i) =>
                '<div class="dg-standing' + (currentUser && r.user_id === currentUser.id ? ' me' : '') + '">' +
                '<span class="dg-medal">' + medal(i) + '</span>' +
                '<span class="dg-who">' + DG.esc(DG.mpPlayerName(r)) + '</span>' +
                '<span class="dg-points">' + points(r) + ' pts</span>' +
                '<span class="dg-dist">' + acc(r) + ' · ' + time(r) + '</span>' +
                '</div>').join('') + '</div>' +
            DG.resultsBoardHTML('multi', roomTopic, roomMode, n) +
            '<button type="button" class="btn-paw" onclick="DG.exitRace()">Back to Tenses</button></div>'
        );
        DG.scheduleResultsBoard('multi', roomTopic, roomMode, n);
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
            fog: '#f2d89a',
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
            fog: '#fbe0da',
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
            fog: '#b8d88e',
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

    // Track heading (radians) relative to a straight road. More pronounced
    // and slightly quicker than the first version so the course visibly bends.
    DG.trackCurve = function (z) {
        const ph = DG.trackPhases();
        return 0.68 * Math.sin(z * 0.0019 + ph[0]) +
            0.28 * Math.sin(z * 0.0044 + ph[1]) +
            0.11 * Math.sin(z * 0.0102 + ph[2]);
    };

    // Antiderivative of trackCurve(): lateral road position at world Z.
    DG.trackLateral = function (z) {
        const ph = DG.trackPhases();
        return -0.68 / 0.0019 * Math.cos(z * 0.0019 + ph[0]) -
            0.28 / 0.0044 * Math.cos(z * 0.0044 + ph[1]) -
            0.11 / 0.0102 * Math.cos(z * 0.0102 + ph[2]);
    };

    // Road elevation (world units) at world Z. Taller and more frequent
    // crests / dips than the first version, so uphill and downhill sections
    // arrive regularly instead of one long gentle rise.
    DG.trackHill = function (z) {
        const ph = DG.trackPhases();
        return 36 * Math.sin(z * 0.0016 + ph[0] * 0.7) +
            18 * Math.sin(z * 0.0038 + ph[1] * 1.4) +
            6 * Math.sin(z * 0.0085 + ph[2] * 2.1);
    };

    // Keep the first stretch after the start line straight and level, then
    // ease into the full curves / hills. z is the world distance from the
    // start line, so the player always begins with a clean straight view.
    DG.trackSettle = function (z) {
        const t = Math.max(0, Math.min(1, ((Number(z) || 0) - 200) / 900));
        return t * t * (3 - 2 * t);
    };

    DG.trackHorizonY = function () {
        const h = DG.view.h;
        const camZ = S.player ? S.player.dist : 0;
        const cache = DG._horizonCache || (DG._horizonCache = { camZ: null, h: 0, y: 0 });
        if (cache.camZ === camZ && cache.h === h) return cache.y;
        const slope = (DG.trackHill(camZ + 260) - DG.trackHill(camZ)) / 260;
        const pitch = Math.max(-1, Math.min(1, slope * 14 * DG.trackSettle(camZ + 130)));
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
        const settle = DG.trackSettle(camZ + r);
        const elev = (DG.trackHill(camZ + r) - DG.trackHill(camZ)) * settle;
        const y = horizonY + (bottom - horizonY) * persp - elev * h * 0.0028 * persp;
        const lat = ((DG.trackLateral(camZ + r) - DG.trackLateral(camZ)) -
            DG.trackCurve(camZ) * r) * settle;
        // Slide the whole 2D world so the player's lane stays at the bottom
        // centre. Steering then moves the road, not the kart.
        const nearHalf = w * 0.51;
        const camShift = S.player ? (S.player.laneX - 1) * nearHalf * 0.64 : 0;
        const centerX = w / 2 + lat * (w / 180) * persp - camShift;
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

    /* ---------------- kart placement ---------------- */

    // A phone held sideways is short and wide (e.g. 844 x 390 logical px).
    // The portrait layout parks the kart 138px above the bottom edge, which
    // costs a quarter of the screen height there and pushes the kart up over
    // the answer gates, so short/wide viewports get a slightly smaller kart
    // resting just above the LEFT / CENTER / RIGHT buttons.
    DG.sideways = function () {
        const v = DG.view;
        return !!v && v.h < 560 && v.w > v.h;
    };

    DG.kartScale = function () {
        const v = DG.view || { w: 430, h: 700 };
        return Math.min(v.w / 430, v.h / 700) * (DG.sideways() ? 0.86 : 1.12);
    };

    DG.playerKartY = function () {
        const v = DG.view || { w: 430, h: 700 };
        return DG.sideways() ? v.h - 88 : v.h - 138;
    };

    /* ---------------- full screen ---------------- */

    // A phone held sideways loses 44-60px to the browser's own bars. Element
    // fullscreen hides those on Chrome / Edge / desktop Safari (and Android),
    // but iPhone Safari has no Element.requestFullscreen, so a CSS fallback
    // pins the page and locks scrolling instead (the bars stay, because no
    // web page can remove them there — the Controls step tells players to add
    // the page to their Home Screen for that).
    DG.raceFsPending = false;
    DG.raceFsTimer = 0;
    DG.raceFsResizeTimer = 0;
    DG.raceFsScrollY = 0;

    DG.raceFsTarget = function () {
        return document.getElementById('drive-and-go-view') ||
            (DG.raceEls && DG.raceEls.stage) || null;
    };

    DG.nativeRaceFsOn = function () {
        const el = DG.raceFsTarget();
        const cur = document.fullscreenElement || document.webkitFullscreenElement || null;
        if (!cur) return false;
        return !el || cur === el || (!!cur.contains && cur.contains(el));
    };

    DG.raceFsOn = function () {
        return DG.nativeRaceFsOn() || document.body.classList.contains('dg-fs');
    };

    DG.syncRaceFsUi = function () {
        const btn = (DG.raceEls && DG.raceEls.fsBtn) || document.getElementById('dg-fs-btn');
        const on = DG.raceFsOn();
        if (btn) {
            btn.textContent = on ? '✕' : '⛶';
            btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
            btn.title = on ? 'Exit full screen' : 'Full screen';
            btn.classList.toggle('on', on);
        }
        const pauseFs = document.getElementById('dg-pause-fs');
        if (pauseFs) pauseFs.textContent = on ? '✕ Exit full screen' : '⛶ Full screen';
        return on;
    };

    // The new viewport only lands a frame or two after the request settles,
    // so the canvas is measured once now and again when it has.
    DG.scheduleRaceResize = function () {
        DG.resizeCanvas();
        if (DG.raceFsResizeTimer) clearTimeout(DG.raceFsResizeTimer);
        DG.raceFsResizeTimer = setTimeout(() => {
            DG.raceFsResizeTimer = 0;
            DG.resizeCanvas();
            if (DG.raceEls && S.player) DG.drawRace();
        }, 260);
    };

    DG.enterCssFullscreen = function () {
        DG.raceFsPending = false;
        if (DG.raceFsTimer) { clearTimeout(DG.raceFsTimer); DG.raceFsTimer = 0; }
        if (!document.body.classList.contains('dg-fs')) {
            DG.raceFsScrollY = window.scrollY || window.pageYOffset || 0;
            document.body.classList.add('dg-fs');
        }
        DG.syncRaceFsUi();
        DG.scheduleRaceResize();
    };

    DG.exitRaceFullscreen = function () {
        DG.raceFsPending = false;
        if (DG.raceFsTimer) { clearTimeout(DG.raceFsTimer); DG.raceFsTimer = 0; }
        if (DG.nativeRaceFsOn()) {
            try {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            } catch (e) {}
        }
        if (document.body.classList.contains('dg-fs')) {
            document.body.classList.remove('dg-fs');
            try { window.scrollTo(0, DG.raceFsScrollY || 0); } catch (e) {}
        }
        DG.syncRaceFsUi();
        DG.scheduleRaceResize();
    };

    // iPhone Safari cannot hide its own bars; the Home Screen app can.
    DG.raceFsHint = function () {
        const ua = navigator.userAgent || '';
        const iphone = /iPhone|iPod/.test(ua);
        const standalone = (window.navigator.standalone === true) ||
            (!!window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        if (iphone && !standalone) {
            DG.toast('On iPhone, add this page to your Home Screen to hide the browser bar.', 4200);
        } else {
            DG.toast('Full screen is not available in this browser.', 2600);
        }
    };

    DG.enterRaceFullscreen = function () {
        if (DG.raceFsOn()) { DG.syncRaceFsUi(); return true; }
        const el = DG.raceFsTarget();
        if (!el) return false;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!req) {
            DG.enterCssFullscreen();
            DG.raceFsHint();
            return false;
        }
        DG.raceFsPending = true;
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            DG.raceFsPending = false;
            if (ok) {
                DG.syncRaceFsUi();
                DG.scheduleRaceResize();
            } else {
                // iOS ignores the promise or rejects it; fall back quietly.
                DG.enterCssFullscreen();
                DG.raceFsHint();
            }
        };
        try {
            const p = req.call(el, { navigationUI: 'hide' });
            if (p && typeof p.then === 'function') {
                p.then(() => done(true)).catch(() => done(false));
            }
        } catch (e) {
            done(false);
            return false;
        }
        if (DG.raceFsTimer) clearTimeout(DG.raceFsTimer);
        DG.raceFsTimer = setTimeout(() => {
            DG.raceFsTimer = 0;
            if (settled) return;
            if (DG.nativeRaceFsOn()) done(true);
            else done(false);
        }, 700);
        return true;
    };

    DG.toggleRaceFullscreen = function () {
        if (DG.raceFsOn()) DG.exitRaceFullscreen();
        else DG.enterRaceFullscreen();
    };

    DG.onRaceFsChange = function () {
        DG.raceFsPending = false;
        DG.syncRaceFsUi();
        DG.scheduleRaceResize();
    };

    /* ---------------- optional three.js 3D renderer ---------------- */
    // The 2D canvas renderer stays as the fallback. When three.js loads, a
    // WebGL canvas is inserted behind #dg-canvas and draws the road, karts,
    // gates and scenery in 3D; #dg-canvas then only draws the countdown,
    // lightning flash and speed-line overlays.
    DG.THREE_ENABLED = true;
    DG.three = null;

    const THREE_ROAD_W = 26;
    const THREE_ROAD_LEN = 2200;
    const THREE_SEGMENTS = 160;
    const THREE_LANE = 7;
    const THREE_GROUND_Y = -1.4;
    const THREE_SCENERY_CAP = 40;

    DG.threeRoadX = function (rel) {
        const camZ = S.player ? S.player.dist : 0;
        const lat = (DG.trackLateral(camZ + rel) - DG.trackLateral(camZ)) - DG.trackCurve(camZ) * rel;
        return lat * 0.6 * DG.trackSettle(camZ + rel);
    };

    DG.threeRoadY = function (rel) {
        const camZ = S.player ? S.player.dist : 0;
        return (DG.trackHill(camZ + rel) - DG.trackHill(camZ)) * 0.62 * DG.trackSettle(camZ + rel);
    };

    DG.threeLaneX = function (rel, laneX) {
        return DG.threeRoadX(rel) + ((laneX == null ? 1 : laneX) - 1) * THREE_LANE;
    };

    DG.threeSkyTexture = function (style) {
        const c = document.createElement('canvas');
        c.width = 8;
        c.height = 256;
        const ctx = c.getContext('2d');
        const grd = ctx.createLinearGradient(0, 0, 0, 256);
        style.sky.forEach(stop => grd.addColorStop(stop[0], stop[1]));
        grd.addColorStop(1, style.sky[style.sky.length - 1][1]);
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, 8, 256);
        const tex = new THREE.CanvasTexture(c);
        tex.minFilter = THREE.LinearFilter;
        if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
        tex.magFilter = THREE.LinearFilter;
        return tex;
    };

    DG.threeRoadTexture = function (style) {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 1024;
        const ctx = c.getContext('2d');
        ctx.fillStyle = style.roadA;
        ctx.fillRect(0, 0, 256, 1024);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = style.roadB;
        for (let y = 0; y < 1024; y += 64) ctx.fillRect(0, y, 256, 30);
        ctx.globalAlpha = 1;
        for (let y = 0; y < 1024; y += 64) {
            ctx.fillStyle = (y / 64) % 2 ? style.kerbA : style.kerbB;
            ctx.fillRect(0, y, 14, 64);
            ctx.fillRect(242, y, 14, 64);
        }
        ctx.fillStyle = style.edge;
        ctx.fillRect(14, 0, 5, 1024);
        ctx.fillRect(237, 0, 5, 1024);
        ctx.fillStyle = style.dash;
        for (let y = 0; y < 1024; y += 104) {
            ctx.fillRect(83, y, 10, 54);
            ctx.fillRect(163, y, 10, 54);
        }
        const tex = new THREE.CanvasTexture(c);
        if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    };

    DG.threeTextTexture = function (text, color) {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 128;
        const ctx = c.getContext('2d');
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(4, 4, 504, 120, 26);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.92)';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '800 64px Fredoka, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 66, 470);
        const tex = new THREE.CanvasTexture(c);
        tex.minFilter = THREE.LinearFilter;
        if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
        return tex;
    };

    DG.makeThreeKart = function (look, isPlayer) {
        const l = DG.normalizeLook(look);
        const pal = DG.catPalette(l.cat);
        const g = new THREE.Group();

        DG.makeEmojiSprite = DG.makeEmojiSprite || function (emoji, size) {
            const c = document.createElement('canvas');
            c.width = 128; c.height = 128;
            const x = c.getContext('2d');
            x.font = '96px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
            x.textAlign = 'center';
            x.textBaseline = 'middle';
            x.fillText(emoji, 64, 68);
            const tex = new THREE.CanvasTexture(c);
            tex.minFilter = THREE.LinearFilter;
            if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
            sp.scale.set(size, size, 1);
            return sp;
        };
        const bodyMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(pal.body) });
        const shadeMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(pal.shade) });
        const pointMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(pal.points) });
        const darkMat = new THREE.MeshLambertMaterial({ color: 0x1f2937 });

        const shadow = new THREE.Mesh(
            new THREE.CircleGeometry(1.9, 16),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false })
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.03;
        g.add(shadow);

        const chassis = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.2, 7), bodyMat);
        chassis.position.y = 0.95;
        g.add(chassis);
        const nose = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.7, 2.4), shadeMat);
        nose.position.set(0, 1.55, -2.2);
        g.add(nose);

        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.11, 1.8, 6), pointMat);
        tail.position.set(0, 1.7, 2.7);
        tail.rotation.x = 0.75;
        g.add(tail);
        [-0.85, 0.85].forEach(x => {
            const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.65, 6), darkMat);
            pipe.rotation.x = Math.PI / 2;
            pipe.position.set(x, 0.85, 3.35);
            g.add(pipe);
        });

        const wheelGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.8, 10);
        wheelGeo.rotateZ(Math.PI / 2);
        [[-2.8, -2], [2.8, -2], [-2.8, 2], [2.8, 2]].forEach(pos => {
            const w = new THREE.Mesh(wheelGeo, darkMat);
            w.position.set(pos[0], 0.6, pos[1]);
            g.add(w);
        });

        const head = new THREE.Mesh(new THREE.SphereGeometry(1.55, 12, 10), bodyMat);
        head.position.set(0, 2.9, -0.6);
        g.add(head);

        const earGeo = new THREE.ConeGeometry(0.55, 1.2, 4);
        [[-1.0, 1], [1.0, -1]].forEach(e => {
            const ear = new THREE.Mesh(earGeo, pointMat);
            ear.position.set(e[0], 4.15, -0.6);
            ear.rotation.z = e[1] * 0.22;
            g.add(ear);
        });

        const eyeGeo = new THREE.SphereGeometry(0.22, 8, 6);
        const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.eye) });
        [-0.55, 0.55].forEach(x => {
            const eye = new THREE.Mesh(eyeGeo, eyeMat);
            eye.position.set(x, 3.1, -2.0);
            g.add(eye);
        });
        const noseM = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.nose) }));
        noseM.position.set(0, 2.7, -2.1);
        g.add(noseM);

        if (l.hat === 'Crown') {
            const crown = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.0, 5), new THREE.MeshLambertMaterial({ color: 0xfbbf24 }));
            crown.position.set(0, 4.55, -0.6);
            g.add(crown);
        } else if (l.hat === 'Party Hat') {
            const hat = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 10), new THREE.MeshLambertMaterial({ color: 0xf472b6 }));
            hat.position.set(0, 4.8, -0.6);
            g.add(hat);
        }
        if (l.glasses !== 'None') {
            const glasses = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.32, 0.3), darkMat);
            glasses.position.set(0, 3.05, -2.15);
            g.add(glasses);
        }
        if (l.outfit === 'Red Scarf' || l.outfit === 'Pink Floral Scarf') {
            const scarf = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 0.7),
                new THREE.MeshLambertMaterial({ color: l.outfit === 'Red Scarf' ? 0xef4444 : 0xf472b6 }));
            scarf.position.set(0, 2.1, -1.5);
            g.add(scarf);
        } else if (l.outfit === 'Superhero Cape') {
            const cape = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3),
                new THREE.MeshLambertMaterial({ color: 0xdc2626, side: THREE.DoubleSide }));
            cape.position.set(0, 2.2, 1.8);
            cape.rotation.x = -0.25;
            g.add(cape);
        } else if (l.outfit === 'Racing Jacket') {
            const jacket = new THREE.Mesh(new THREE.BoxGeometry(4.3, 1.4, 0.6), new THREE.MeshLambertMaterial({ color: 0xef4444 }));
            jacket.position.set(0, 1.9, 0.8);
            g.add(jacket);
        }

        // Generic emoji badge for store items without a bespoke 3D model.
        if (window.storeItemByName) {
            if (l.hat !== 'None' && l.hat !== 'Crown' && l.hat !== 'Party Hat') {
                const hatItem = window.storeItemByName(l.hat);
                if (hatItem) {
                    const sp = DG.makeEmojiSprite(hatItem.emoji, 1.7);
                    sp.position.set(0, 5.35, -0.6);
                    g.add(sp);
                }
            }
            if (l.glasses !== 'None' && l.glasses !== 'Sunglasses' && l.glasses !== 'Glasses') {
                const faceItem = window.storeItemByName(l.glasses);
                if (faceItem) {
                    const sp = DG.makeEmojiSprite(faceItem.emoji, 1.15);
                    sp.position.set(0, 3.15, -2.3);
                    g.add(sp);
                }
            }
            const freeOutfits = ['None', 'Red Scarf', 'Racing Jacket', 'Superhero Cape', 'Gentleman Bowtie', 'Sports Vest', 'Pink Floral Scarf'];
            if (freeOutfits.indexOf(l.outfit) === -1) {
                const outfitItem = window.storeItemByName(l.outfit);
                if (outfitItem) {
                    const band = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.45, 4.8),
                        new THREE.MeshLambertMaterial({ color: new THREE.Color(outfitItem.color || '#f97316') }));
                    band.position.set(0, 1.55, 0.3);
                    g.add(band);
                    const sp = DG.makeEmojiSprite(outfitItem.emoji, 1.15);
                    sp.position.set(2.5, 2.1, -0.4);
                    g.add(sp);
                }
            }
        }

        if (isPlayer) {
            const spoiler = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.25, 0.5), darkMat);
            spoiler.position.set(0, 2.35, 2.6);
            g.add(spoiler);
        }
        return g;
    };

    DG.makeThreeGate = function (gate) {
        const g = new THREE.Group();
        const postMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });
        const postGeo = new THREE.BoxGeometry(0.6, 4.2, 0.6);
        [-3.2, 3.2].forEach(x => {
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.set(x, 2.1, 0);
            g.add(post);
        });
        const bannerMat = new THREE.MeshBasicMaterial({ map: DG.threeTextTexture(gate.label, '#f59e0b'), transparent: true });
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 1.75), bannerMat);
        banner.position.set(0, 4.7, 0);
        g.add(banner);
        g.userData = { postMat, banner, bannerMat, label: gate.label, color: '#f59e0b' };
        return g;
    };

    DG.makeThreeScenery = function (kind, tone) {
        const g = new THREE.Group();
        const add = (geo, color, x, y, z) => {
            const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: color }));
            m.position.set(x, y, z);
            g.add(m);
            return m;
        };
        const green = [0x2f7d32, 0x4d7c0f, 0x3f6212][tone % 3];
        const grey = [0x78716c, 0x9ca3af, 0x57534e][tone % 3];
        if (kind === 'cactus') {
            add(new THREE.CylinderGeometry(0.55, 0.65, 4, 7), green, 0, 2, 0);
            add(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 6), green, -0.9, 2.5, 0).rotation.z = 0.9;
            add(new THREE.CylinderGeometry(0.3, 0.3, 1.4, 6), green, 0.9, 3.0, 0).rotation.z = -0.9;
        } else if (kind === 'rock') {
            const r = add(new THREE.DodecahedronGeometry(1.6, 0), grey, 0, 0.9, 0);
            r.scale.set(1.2, 0.8, 1);
        } else if (kind === 'bone') {
            add(new THREE.BoxGeometry(3.3, 0.5, 0.5), 0xf5f5f4, 0, 0.5, 0);
            add(new THREE.SphereGeometry(0.45, 6, 6), 0xf5f5f4, -1.6, 0.5, 0);
            add(new THREE.SphereGeometry(0.45, 6, 6), 0xf5f5f4, 1.6, 0.5, 0);
        } else if (kind === 'plant' || kind === 'fern') {
            add(new THREE.ConeGeometry(1.4, 2.6, 7), green, 0, 1.3, 0);
        } else if (kind === 'palm' || kind === 'jungleTree') {
            add(new THREE.CylinderGeometry(0.35, 0.55, 5.5, 7), 0x8b5a2b, 0, 2.75, 0);
            const crown = add(new THREE.SphereGeometry(2.4, 8, 6), green, 0, 5.6, 0);
            crown.scale.set(1.2, 0.55, 1.2);
            add(new THREE.ConeGeometry(1.0, 2.0, 6), green, -1.8, 5.2, 0).rotation.z = 0.8;
            add(new THREE.ConeGeometry(1.0, 2.0, 6), green, 1.8, 5.2, 0).rotation.z = -0.8;
            add(new THREE.ConeGeometry(1.0, 2.0, 6), green, 0, 5.2, -1.8).rotation.x = 0.8;
            add(new THREE.ConeGeometry(1.0, 2.0, 6), green, 0, 5.2, 1.8).rotation.x = -0.8;
        } else if (kind === 'sign') {
            add(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 6), 0x6b7280, 0, 1.6, 0);
            add(new THREE.BoxGeometry(2.4, 1.1, 0.25), 0xf59e0b, 0, 3.1, 0);
        } else if (kind === 'lamp' || kind === 'floodlight') {
            add(new THREE.CylinderGeometry(0.16, 0.2, 5, 6), 0x6b7280, 0, 2.5, 0);
            if (kind === 'floodlight') add(new THREE.BoxGeometry(1.5, 0.7, 0.4), 0xfef08a, 0, 5.2, 0);
            else add(new THREE.SphereGeometry(0.45, 8, 6), 0xfef08a, 0, 5.1, 0);
        } else if (kind === 'grandstand') {
            add(new THREE.BoxGeometry(6, 1.0, 3), 0xcbd5e1, 0, 0.5, 0);
            add(new THREE.BoxGeometry(5.2, 0.8, 2.6), 0x94a3b8, 0, 1.3, 0);
            add(new THREE.BoxGeometry(4.4, 0.7, 2.2), 0x64748b, 0, 2.0, 0);
            add(new THREE.BoxGeometry(6, 0.35, 3), 0xef4444, 0, 2.55, 0);
        } else if (kind === 'flag') {
            add(new THREE.CylinderGeometry(0.14, 0.14, 4.5, 6), 0x6b7280, 0, 2.25, 0);
            const flag = add(new THREE.PlaneGeometry(1.7, 1.1), 0xef4444, 0.95, 4.0, 0);
            flag.material.side = THREE.DoubleSide;
        } else if (kind === 'stall') {
            add(new THREE.BoxGeometry(3.4, 1.7, 2.4), 0xfef3c7, 0, 0.85, 0);
            add(new THREE.BoxGeometry(3.8, 0.35, 2.8), 0xef4444, 0, 1.85, 0);
            add(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 5), 0x8b5a2b, -1.5, 0.9, 1.1);
            add(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 5), 0x8b5a2b, 1.5, 0.9, 1.1);
        } else if (kind === 'dino') {
            const body = add(new THREE.SphereGeometry(1.8, 8, 6), green, 0, 1.8, 0);
            body.scale.set(1.3, 1, 1.6);
            add(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 6), green, 1.7, 3.4, -0.6).rotation.z = -0.25;
            add(new THREE.SphereGeometry(0.9, 8, 6), green, 2.2, 4.7, -0.8);
            add(new THREE.CylinderGeometry(0.25, 0.3, 1.3, 5), green, -0.7, 0.65, 0.4);
            add(new THREE.CylinderGeometry(0.25, 0.3, 1.3, 5), green, 0.7, 0.65, 0.4);
            const tail = add(new THREE.CylinderGeometry(0.12, 0.4, 2.6, 5), green, -1.7, 1.6, 0.8);
            tail.rotation.z = 1.0;
        } else if (kind === 'building') {
            add(new THREE.BoxGeometry(3.4, 8.5, 3.4), 0xd6c7b0, 0, 4.25, 0);
            add(new THREE.BoxGeometry(2.8, 0.4, 3.0), 0x94a3b8, 0, 8.5, 0);
            for (let wy = 0; wy < 3; wy++) {
                add(new THREE.BoxGeometry(0.9, 0.7, 0.1), 0x334155, -0.8, 2.2 + wy * 2.0, 1.76);
                add(new THREE.BoxGeometry(0.9, 0.7, 0.1), 0x334155, 0.8, 2.2 + wy * 2.0, 1.76);
            }
        } else if (kind === 'car') {
            add(new THREE.BoxGeometry(2.2, 1.0, 4), 0x94a3b8, 0, 0.8, 0);
            add(new THREE.BoxGeometry(1.6, 0.7, 1.8), 0xe2e8f0, 0, 1.6, -0.2);
            add(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 8), 0x1f2937, -1.1, 0.35, -1.2).rotation.z = Math.PI / 2;
            add(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 8), 0x1f2937, 1.1, 0.35, -1.2).rotation.z = Math.PI / 2;
        } else {
            add(new THREE.BoxGeometry(1.6, 1.6, 1.6), grey, 0, 0.8, 0);
        }
        return g;
    };

    DG.makeThreeShell = function () {
        const g = new THREE.Group();
        const red = new THREE.MeshLambertMaterial({ color: 0xef4444 });
        const dark = new THREE.MeshLambertMaterial({ color: 0x991b1b });
        const white = new THREE.MeshLambertMaterial({ color: 0xfef3c7 });
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 8), red);
        body.scale.y = 0.82;
        g.add(body);
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 6, 14), dark);
        band.rotation.x = Math.PI / 2;
        g.add(band);
        [[-0.25, 0.55, 0.25], [0.3, 0.5, 0.15], [0, 0.2, 0.55]].forEach(sp => {
            const spot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), white);
            spot.position.set(sp[0], sp[1], sp[2]);
            g.add(spot);
        });
        return g;
    };

    DG.makeThreeBanana = function () {
        const g = new THREE.Group();
        const yellow = new THREE.MeshLambertMaterial({ color: 0xfacc15 });
        const brown = new THREE.MeshLambertMaterial({ color: 0x92400e });
        const arc = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.18, 6, 12, Math.PI * 0.92), yellow);
        arc.rotation.z = -0.45;
        g.add(arc);
        const tip1 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), brown);
        tip1.position.set(-0.55, 0.05, 0);
        g.add(tip1);
        const tip2 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), brown);
        tip2.position.set(0.5, 0.35, 0);
        g.add(tip2);
        return g;
    };

    DG.spawnThreeProjectile = function (kind, opts) {
        const t = DG.three;
        if (!t || !S.player) return;
        const o = opts || {};
        const mesh = kind === 'redshell' ? DG.makeThreeShell() : DG.makeThreeBanana();
        t.projectileGroup.add(mesh);
        t.projectiles.push({
            kind,
            mesh,
            startClock: S.clock,
            duration: Math.max(0.2, Number(o.duration) || 0.6),
            fromRel: Number(o.fromRel) || 0,
            toRel: Number(o.toRel) || 0,
            fromLane: o.fromLane == null ? S.player.laneX : o.fromLane,
            toLane: o.toLane == null ? S.player.laneX : o.toLane,
            arc: Number(o.arc) || 0
        });
    };

    DG.spawnThreeBurst = function (x, y, z, color) {
        const t = DG.three;
        if (!t) return;
        const mat = new THREE.MeshBasicMaterial({
            color: color || 0xfde047,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.65, 20), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, y, z);
        t.burstGroup.add(mesh);
        t.bursts.push({ mesh, startClock: S.clock, duration: 0.6 });
    };

    DG.threePlayerBurst = function (color) {
        if (!DG.three || !S.player) return;
        const p = S.player;
        DG.spawnThreeBurst(DG.threeLaneX(0, p.laneX), DG.threeRoadY(0) + 1.0, 0, color);
    };

    DG.updateThreeProjectiles = function () {
        const t = DG.three;
        if (!t || !S.player) return;
        for (let i = t.projectiles.length - 1; i >= 0; i--) {
            const pr = t.projectiles[i];
            const raw = (S.clock - pr.startClock) / pr.duration;
            if (raw >= 1) {
                const rel = pr.toRel;
                DG.spawnThreeBurst(
                    DG.threeLaneX(rel, pr.toLane),
                    DG.threeRoadY(rel) + 0.8,
                    -rel,
                    pr.kind === 'redshell' ? 0xef4444 : 0xfacc15
                );
                t.projectileGroup.remove(pr.mesh);
                DG.disposeObject(pr.mesh);
                t.projectiles.splice(i, 1);
                continue;
            }
            const k = Math.max(0, Math.min(1, raw));
            const rel = pr.fromRel + (pr.toRel - pr.fromRel) * k;
            const lane = pr.fromLane + (pr.toLane - pr.fromLane) * k;
            pr.mesh.position.set(
                DG.threeLaneX(rel, lane),
                DG.threeRoadY(rel) + 0.8 + Math.sin(Math.PI * k) * pr.arc,
                -rel
            );
            pr.mesh.rotation.y += 0.22;
            pr.mesh.rotation.z += 0.14;
        }
    };

    DG.updateThreeBursts = function () {
        const t = DG.three;
        if (!t) return;
        for (let i = t.bursts.length - 1; i >= 0; i--) {
            const b = t.bursts[i];
            const k = (S.clock - b.startClock) / b.duration;
            if (k >= 1) {
                t.burstGroup.remove(b.mesh);
                DG.disposeObject(b.mesh);
                t.bursts.splice(i, 1);
                continue;
            }
            b.mesh.scale.setScalar(1 + k * 2.2);
            b.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
        }
    };

    DG.disposeObject = function (obj) {
        if (!obj) return;
        obj.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach(m => {
                    if (m.map) m.map.dispose();
                    m.dispose();
                });
            }
        });
    };

    DG.disposeThree = function () {
        const t = DG.three;
        if (!t) {
            const orphan = document.getElementById('dg-three-canvas');
            if (orphan) orphan.remove();
            return;
        }
        try {
            t.scene.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    const mats = Array.isArray(o.material) ? o.material : [o.material];
                    mats.forEach(m => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    });
                }
            });
            if (t.roadTex) t.roadTex.dispose();
            t.renderer.dispose();
            if (t.renderer.domElement && t.renderer.domElement.parentNode) {
                t.renderer.domElement.parentNode.removeChild(t.renderer.domElement);
            }
        } catch (e) {}
        DG.three = null;
    };

    DG.addThreeBackdrop = function (scene, style) {
        const group = new THREE.Group();
        const sceneId = DG.normalizeScene(S.scene);
        const add = (geo, color, x, y, z, sx, sy, sz) => {
            const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: color }));
            mesh.position.set(x, y, z);
            if (sx != null) mesh.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
            group.add(mesh);
            return mesh;
        };
        if (sceneId === 'stadium') {
            for (let i = 0; i < 7; i++) {
                const h = 35 + (i % 3) * 22;
                add(new THREE.BoxGeometry(24 + i * 3, h, 18), i % 2 ? 0x94a3b8 : 0x64748b, -150 + i * 50, h / 2, -1750);
            }
        } else if (sceneId === 'jungle') {
            for (let i = 0; i < 6; i++) {
                add(new THREE.ConeGeometry(90 + i * 12, 90 + (i % 3) * 40, 7), i % 2 ? 0x2f5d2c : 0x3c7d4b, -220 + i * 90, 20, -1760);
            }
        } else {
            for (let i = 0; i < 5; i++) {
                add(new THREE.CylinderGeometry(55 + i * 8, 85 + i * 9, 90 + (i % 3) * 35, 6), i % 2 ? 0xb0895a : 0x9c7648, -210 + i * 105, 20, -1760);
            }
        }
        for (let i = 0; i < 5; i++) {
            const cloud = add(new THREE.SphereGeometry(18, 8, 6), 0xffffff, -180 + i * 90, 70 + (i % 2) * 18, -1050 - (i % 3) * 180, 2.8, 0.8, 1.2);
            cloud.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82 });
        }
        if (sceneId !== 'jungle') {
            const c = document.createElement('canvas');
            c.width = 128;
            c.height = 128;
            const ctx = c.getContext('2d');
            const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
            g.addColorStop(0, 'rgba(255,248,180,1)');
            g.addColorStop(0.35, 'rgba(255,236,120,.85)');
            g.addColorStop(1, 'rgba(255,236,120,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 128, 128);
            const tex = new THREE.CanvasTexture(c);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
            sprite.position.set(-230, 170, -1700);
            sprite.scale.set(150, 150, 1);
            group.add(sprite);
        }
        scene.add(group);
        return group;
    };

    DG.initThree = function () {
        if (!DG.THREE_ENABLED || typeof THREE === 'undefined' || !DG.raceEls || !DG.view) return false;
        try {
            const stage = DG.raceEls.stage;
            const baseCanvas = DG.raceEls.canvas;
            const canvas = document.createElement('canvas');
            canvas.id = 'dg-three-canvas';
            stage.insertBefore(canvas, baseCanvas);
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
            renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
            renderer.setSize(DG.view.w, DG.view.h, false);
            if ('outputEncoding' in renderer && THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;

            const scene = new THREE.Scene();
            const style = DG.sceneStyle();
            scene.background = DG.threeSkyTexture(style);
            scene.fog = new THREE.Fog(new THREE.Color(style.fog || style.sky[style.sky.length - 1][1]), 110, THREE_ROAD_LEN * 0.92);
            scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(style.ground), 0.9));
            const sun = new THREE.DirectionalLight(0xffffff, 0.8);
            sun.position.set(-80, 140, 50);
            scene.add(sun);

            const camera = new THREE.PerspectiveCamera(60, DG.view.w / DG.view.h, 0.5, THREE_ROAD_LEN + 400);
            camera.position.set(0, 4.8, 16.5);

            const roadGeo = new THREE.BufferGeometry();
            const positions = new Float32Array((THREE_SEGMENTS + 1) * 2 * 3);
            const uvs = new Float32Array((THREE_SEGMENTS + 1) * 2 * 2);
            const indices = [];
            for (let i = 0; i <= THREE_SEGMENTS; i++) {
                const rel = (i / THREE_SEGMENTS) * THREE_ROAD_LEN;
                uvs[i * 4] = 0;
                uvs[i * 4 + 1] = rel / 40;
                uvs[i * 4 + 2] = 1;
                uvs[i * 4 + 3] = rel / 40;
                if (i < THREE_SEGMENTS) {
                    const a = i * 2;
                    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
                }
            }
            roadGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            roadGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            roadGeo.setIndex(indices);
            const roadTex = DG.threeRoadTexture(style);
            const road = new THREE.Mesh(roadGeo, new THREE.MeshBasicMaterial({ map: roadTex, side: THREE.DoubleSide }));
            scene.add(road);

            const kerbColors = [new THREE.Color(style.kerbA), new THREE.Color(style.kerbB)];
            const makeKerb = (side) => {
                const geo = new THREE.BufferGeometry();
                const pos = new Float32Array((THREE_SEGMENTS + 1) * 2 * 3);
                const col = new Float32Array((THREE_SEGMENTS + 1) * 2 * 3);
                const idx = [];
                for (let i = 0; i <= THREE_SEGMENTS; i++) {
                    const c = kerbColors[Math.floor(i / 3) % 2];
                    for (let v = 0; v < 2; v++) {
                        const at = (i * 2 + v) * 3;
                        col[at] = c.r;
                        col[at + 1] = c.g;
                        col[at + 2] = c.b;
                    }
                    if (i < THREE_SEGMENTS) {
                        const a = i * 2;
                        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
                    }
                }
                geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
                geo.setIndex(idx);
                const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
                mesh.userData.side = side;
                scene.add(mesh);
                return mesh;
            };
            const kerbL = makeKerb(-1);
            const kerbR = makeKerb(1);

            // A wide terrain ribbon follows the same hill profile as the road,
            // so uphill / downhill sections roll instead of clipping through a
            // flat plane. Scenery sits on this ribbon.
            const terrainGeo = new THREE.BufferGeometry();
            const terrainPos = new Float32Array((THREE_SEGMENTS + 1) * 2 * 3);
            const terrainIdx = [];
            for (let i = 0; i < THREE_SEGMENTS; i++) {
                const a = i * 2;
                terrainIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            }
            terrainGeo.setAttribute('position', new THREE.BufferAttribute(terrainPos, 3));
            terrainGeo.setIndex(terrainIdx);
            const terrain = new THREE.Mesh(
                terrainGeo,
                new THREE.MeshBasicMaterial({ color: new THREE.Color(style.ground) })
            );
            terrain.frustumCulled = false;
            scene.add(terrain);

            // Fallback floor far below the deepest dip; fog hides it.
            const under = new THREE.Mesh(
                new THREE.PlaneGeometry(2600, THREE_ROAD_LEN + 1600),
                new THREE.MeshBasicMaterial({ color: new THREE.Color(style.ground) })
            );
            under.rotation.x = -Math.PI / 2;
            under.position.set(0, -140, -THREE_ROAD_LEN / 2);
            scene.add(under);

            DG.addThreeBackdrop(scene, style);

            const kartGroup = new THREE.Group();
            const gateGroup = new THREE.Group();
            const sceneryGroup = new THREE.Group();
            const bananaGroup = new THREE.Group();
            const projectileGroup = new THREE.Group();
            const burstGroup = new THREE.Group();
            scene.add(kartGroup, gateGroup, sceneryGroup, bananaGroup, projectileGroup, burstGroup);

            DG.three = {
                renderer, scene, camera, road, roadTex, style,
                kerbL, kerbR, terrain,
                karts: new Map(), gates: [], scenery: new Map(), bananas: [],
                projectiles: [], bursts: [],
                kartGroup, gateGroup, sceneryGroup, bananaGroup, projectileGroup, burstGroup
            };
            DG.updateThreeRoad();
            DG.drawThree();
            return true;
        } catch (e) {
            console.warn('Drive & Go 3D unavailable, using 2D:', e);
            DG.disposeThree();
            return false;
        }
    };

    DG.updateThreeRoad = function () {
        const t = DG.three;
        if (!t || !S.player) return;
        const pos = t.road.geometry.attributes.position;
        const leftPos = t.kerbL ? t.kerbL.geometry.attributes.position : null;
        const rightPos = t.kerbR ? t.kerbR.geometry.attributes.position : null;
        const terrainPos = t.terrain ? t.terrain.geometry.attributes.position : null;
        for (let i = 0; i <= THREE_SEGMENTS; i++) {
            const rel = (i / THREE_SEGMENTS) * THREE_ROAD_LEN;
            const x = DG.threeRoadX(rel);
            const y = DG.threeRoadY(rel);
            pos.setXYZ(i * 2, x - THREE_ROAD_W / 2, y, -rel);
            pos.setXYZ(i * 2 + 1, x + THREE_ROAD_W / 2, y, -rel);
            if (terrainPos) {
                terrainPos.setXYZ(i * 2, x - 1500, y + THREE_GROUND_Y, -rel);
                terrainPos.setXYZ(i * 2 + 1, x + 1500, y + THREE_GROUND_Y, -rel);
            }
            if (leftPos) {
                leftPos.setXYZ(i * 2, x - THREE_ROAD_W / 2 - 0.35, y + 0.06, -rel);
                leftPos.setXYZ(i * 2 + 1, x - THREE_ROAD_W / 2 - 1.55, y + 0.06, -rel);
            }
            if (rightPos) {
                rightPos.setXYZ(i * 2, x + THREE_ROAD_W / 2 + 0.35, y + 0.06, -rel);
                rightPos.setXYZ(i * 2 + 1, x + THREE_ROAD_W / 2 + 1.55, y + 0.06, -rel);
            }
        }
        pos.needsUpdate = true;
        if (terrainPos) terrainPos.needsUpdate = true;
        if (leftPos) leftPos.needsUpdate = true;
        if (rightPos) rightPos.needsUpdate = true;
        t.roadTex.offset.y = (S.player.dist / 40) % 1;
    };

    DG.updateThreeCamera = function () {
        const t = DG.three;
        if (!t || !S.player) return;
        const p = S.player;
        // Keep the kart exactly in the horizontal centre: place the camera on
        // the line from the player to a point on the road ahead, so the camera
        // can follow curves without ever sliding the kart out of frame. Hills
        // stay visible because the road (not the camera) rises and falls.
        const px = DG.threeLaneX(0, p.laneX);
        const lookX = DG.threeRoadX(260) * 0.75 + px * 0.25;
        const lookZ = -260;
        const dx = lookX - px;
        const dz = lookZ;
        const len = Math.hypot(dx, dz) || 1;
        // Phones in landscape have only ~390px of height and the steering
        // controls sit at the bottom. Pull the camera back there so the kart's
        // wheels clear the buttons instead of sitting underneath them.
        const v = DG.view || { w: 0, h: 0 };
        const shortLandscape = v.h < 560 && v.w > v.h;
        const camDist = shortLandscape ? 16.5 : 14;
        t.camera.position.x = px - (dx / len) * camDist;
        t.camera.position.y = DG.threeRoadY(0) + 4.8;
        t.camera.position.z = -(dz / len) * camDist;
        t.camera.lookAt(lookX, DG.threeRoadY(0) + 7.8, lookZ);
    };

    DG.updateThreeKarts = function () {
        const t = DG.three;
        if (!t || !S.player) return;
        const p = S.player;
        const seen = new Set(['player']);
        let entry = t.karts.get('player');
        if (!entry) {
            entry = { group: DG.makeThreeKart(p.look, true) };
            t.kartGroup.add(entry.group);
            t.karts.set('player', entry);
        }
        entry.group.visible = true;
        entry.group.position.set(DG.threeLaneX(0, p.laneX), DG.threeRoadY(0), 0);
        entry.group.scale.setScalar(0.62);
        entry.group.rotation.z = S.clock < p.spinUntil ? (S.clock * 3) % (Math.PI * 2) : 0;
        entry.group.rotation.y = (p.laneX - 1) * 0.06;

        // A class room can hold 30 racers. Draw only the nearest 6 in 3D so
        // the extra kart meshes cannot drag the frame rate down.
        const nearby = S.rivals
            .map((r, i) => ({ i: i, rel: r.dist - p.dist }))
            .filter(o => o.rel >= -15 && o.rel <= 1600)
            .sort((a, b) => a.rel - b.rel)
            .slice(0, 6);
        const visibleRival = new Set(nearby.map(o => o.i));
        S.rivals.forEach((r, i) => {
            const key = 'r' + i;
            seen.add(key);
            let k = t.karts.get(key);
            if (!k) {
                k = { group: DG.makeThreeKart(r.look, false) };
                t.kartGroup.add(k.group);
                t.karts.set(key, k);
            }
            const rel = r.dist - p.dist;
            if (!visibleRival.has(i)) {
                k.group.visible = false;
                return;
            }
            k.group.visible = true;
            k.group.position.set(DG.threeLaneX(rel, r.laneX), DG.threeRoadY(rel), -rel);
            k.group.rotation.z = S.clock < (r.spinUntil || 0) ? (S.clock * 3) % (Math.PI * 2) : 0;
            k.group.scale.setScalar(rel > 1100 ? 0.52 : 0.62);
        });

        for (const [key, k] of t.karts) {
            if (seen.has(key)) continue;
            t.kartGroup.remove(k.group);
            DG.disposeObject(k.group);
            t.karts.delete(key);
        }
    };

    DG.updateThreeGates = function () {
        const t = DG.three;
        if (!t || !S.player) return;
        const p = S.player;
        S.gates.forEach((g, i) => {
            let entry = t.gates[i];
            if (!entry) {
                entry = { group: DG.makeThreeGate(g), label: g.label, color: '#f59e0b' };
                t.gateGroup.add(entry.group);
                t.gates[i] = entry;
            }
            const rel = g.dist - p.dist;
            if (rel < -12 || rel > 1500) {
                entry.group.visible = false;
                return;
            }
            let color = '#f59e0b';
            if (S.gatesResolved && S.lastResult) {
                if (g.correct) color = '#22c55e';
                else if (g.lane === S.lastResult.lane && !S.lastResult.correct) color = '#ef4444';
                else color = '#64748b';
            }
            if (entry.label !== g.label || entry.color !== color) {
                entry.label = g.label;
                entry.color = color;
                entry.group.userData.label = g.label;
                entry.group.userData.color = color;
                entry.group.userData.postMat.color.set(color);
                if (entry.group.userData.bannerMat.map) entry.group.userData.bannerMat.map.dispose();
                entry.group.userData.bannerMat.map = DG.threeTextTexture(g.label, color);
                entry.group.userData.bannerMat.needsUpdate = true;
            }
            entry.group.visible = true;
            entry.group.position.set(DG.threeLaneX(rel, g.lane), DG.threeRoadY(rel), -rel);
        });
        for (let i = S.gates.length; i < t.gates.length; i++) {
            if (t.gates[i]) t.gates[i].group.visible = false;
        }
    };

    DG.updateThreeBananas = function () {
        const t = DG.three;
        if (!t || !S.player) return;
        const p = S.player;
        t.bananaGroup.children.forEach(m => { m.visible = false; });
        S.bananas.forEach((b, i) => {
            let m = t.bananaGroup.children[i];
            if (!m) {
                m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshLambertMaterial({ color: 0xfacc15 }));
                t.bananaGroup.add(m);
            }
            const rel = b.dist - p.dist;
            if (rel < -20 || rel > 900) return;
            m.visible = true;
            m.position.set(DG.threeLaneX(rel, b.lane), DG.threeRoadY(rel) + 0.6, -rel);
        });
    };

    DG.updateThreeScenery = function () {
        const t = DG.three;
        if (!t || !S.player) return;
        const p = S.player;
        const seen = new Set();
        const candidates = [];
        S.scenery.forEach(it => {
            const rel = it.z - p.dist;
            if (rel < -70 || rel > 1600) return;
            candidates.push({ it: it, rel: rel });
        });
        candidates.sort((a, b) => a.rel - b.rel);
        const keep = new Set(candidates.slice(0, THREE_SCENERY_CAP).map(c => c.it));
        candidates.forEach(c => {
            const it = c.it;
            const rel = c.rel;
            let entry = t.scenery.get(it);
            if (!entry) {
                entry = { group: DG.makeThreeScenery(it.kind, it.tone) };
                t.sceneryGroup.add(entry.group);
                t.scenery.set(it, entry);
            }
            seen.add(it);
            entry.group.visible = keep.has(it);
            const x = DG.threeRoadX(rel) + it.side * (THREE_ROAD_W / 2 + it.offset * 10);
            entry.group.position.set(x, THREE_GROUND_Y + DG.threeRoadY(rel), -rel);
            const scale = it.size * 1.2;
            entry.group.scale.setScalar(scale);
        });
        for (const [it, entry] of t.scenery) {
            if (seen.has(it)) continue;
            t.sceneryGroup.remove(entry.group);
            DG.disposeObject(entry.group);
            t.scenery.delete(it);
        }
    };

    DG.drawThree = function () {
        const t = DG.three;
        if (!t || !S.player) return;
        DG.ensureScenery(S.player.dist);
        DG.updateThreeRoad();
        DG.updateThreeKarts();
        DG.updateThreeGates();
        DG.updateThreeBananas();
        DG.updateThreeProjectiles();
        DG.updateThreeBursts();
        DG.updateThreeScenery();
        DG.updateThreeCamera();
        t.renderer.render(t.scene, t.camera);
    };

    DG.drawRace = function () {
        if (!DG.raceEls || !DG.view) return;
        const ctx = DG.raceEls.canvas.getContext('2d');
        if (!ctx) return;
        const w = DG.view.w, h = DG.view.h;
        const p = S.player;
        if (!p) return;
        ctx.clearRect(0, 0, w, h);

        if (DG.three) {
            DG.drawThree();
            DG.drawRaceOverlay(ctx);
            return;
        }

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
        // Cap the canvas karts too: in a 30-player class the far ones are a
        // few pixels tall and would only add clutter.
        S.rivals
            .map(r => ({ r: r, z: r.dist - p.dist }))
            .filter(o => o.z > -40 && o.z <= FAR_REL)
            .sort((a, b) => a.z - b.z)
            .slice(0, 10)
            .forEach(o => drawables.push({ kind: 'rival', z: o.z, rival: o.r }));
        drawables.sort((a, b) => b.z - a.z);
        drawables.forEach(d => {
            if (d.z > FAR_REL) return;
            if (d.kind === 'gate') DG.drawGate(ctx, d.gate, d.z);
            else DG.drawRival(ctx, d.rival, d.z);
        });

        // Player kart: stays in its lane on the near road.
        const nearLane = DG.projectRel(0, p.laneX);
        const px = nearLane.x;
        const py = DG.playerKartY();
        const scale = DG.kartScale();
        DG.drawKart(ctx, px, py, scale, p.look, {
            spin: S.clock < p.spinUntil ? (S.clock * 15) % (Math.PI * 2) : 0,
            star: S.clock < p.starUntil,
            boost: S.clock < p.boostUntil,
            player: true
        });

        DG.drawRaceOverlay(ctx);
    };

    DG.drawRaceOverlay = function (ctx) {
        if (!DG.view) return;
        const w = DG.view.w, h = DG.view.h;
        const p = S.player;
        if (!p) return;
        const horizonY = DG.trackHorizonY();

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
        // Rivals keep the same size relative to the player kart (0.96 / 1.12).
        const scale = Math.max(0.32, pr.scale) * DG.kartScale() * 0.857;
        const spin = S.clock < (r.spinUntil || 0) ? (S.clock * 14) % (Math.PI * 2) : 0;
        DG.drawKart(ctx, pr.x, pr.y, scale, r.look, {
            spin,
            slow: S.clock < (r.slowUntil || 0),
            tag: r.name
        });
    };

    /* Draw a rear-view kart with the chosen cat. Reused by the pre-race
       preview and the multiplayer lobby SVG. */
    /* A standalone, more realistic cat for the Store / Me preview and the
       lobby cat customisers. The race itself still uses DG.drawKart(). */
    /* ---------- Props drawn beside the cat ---------- */

    DG.drawCatProps = function (ctx, props, w, h) {
        const list = (Array.isArray(props) ? props : (props ? [props] : [])).filter(Boolean);
        if (!list.length) return;
        const n = list.length;
        // Spread the equipped props beside the cat. More props = slightly
        // smaller drawings so they still fit on a phone.
        const S = Math.min(w, h) / (330 + Math.max(0, n - 1) * 42);
        list.forEach((p, i) => {
            const t = n === 1 ? 0.5 : i / (n - 1);
            const x = w * (0.58 + t * 0.34);
            DG.drawCatProp(ctx, (p && p.name) || p, x, h * 0.84, S);
        });
    };

    DG.drawCatProp = function (ctx, name, x, y, S) {
        if (!name || name === 'None') return;
        const rr = (px, py, w, h, r) => { ctx.beginPath(); ctx.roundRect(px, py, w, h, r); };
        ctx.save();
        ctx.lineJoin = 'round';
        if (name === 'White Flag') {
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 4 * S;
            ctx.beginPath(); ctx.moveTo(x - 10 * S, y); ctx.lineTo(x - 10 * S, y - 96 * S); ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1.6 * S;
            rr(x - 8 * S, y - 96 * S, 58 * S, 30 * S, 3 * S); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#ef4444';
            ctx.font = '800 ' + Math.round(9 * S) + 'px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Too Hard!', x + 21 * S, y - 81 * S);
        } else if (name === 'Rubber Duck') {
            ctx.fillStyle = '#facc15';
            ctx.beginPath(); ctx.ellipse(x, y - 15 * S, 25 * S, 17 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x - 12 * S, y - 36 * S, 14 * S, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.moveTo(x - 24 * S, y - 37 * S);
            ctx.lineTo(x - 34 * S, y - 33 * S);
            ctx.lineTo(x - 24 * S, y - 29 * S);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#111827';
            ctx.beginPath(); ctx.arc(x - 15 * S, y - 40 * S, 2.3 * S, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(180,120,0,.45)';
            ctx.lineWidth = 2 * S;
            ctx.beginPath(); ctx.arc(x + 2 * S, y - 16 * S, 10 * S, 0.2, 2.4); ctx.stroke();
        } else if (name === 'Red Pen') {
            ctx.save();
            ctx.translate(x, y - 52 * S);
            ctx.rotate(-0.48);
            ctx.fillStyle = '#dc2626';
            rr(-7 * S, -38 * S, 14 * S, 66 * S, 5 * S); ctx.fill();
            ctx.fillStyle = '#991b1b';
            rr(-8 * S, -48 * S, 16 * S, 18 * S, 5 * S); ctx.fill();
            ctx.fillStyle = '#cbd5e1';
            ctx.beginPath();
            ctx.moveTo(-4 * S, 28 * S); ctx.lineTo(4 * S, 28 * S); ctx.lineTo(0, 40 * S);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(6 * S, -30 * S, 3 * S, 22 * S);
            ctx.restore();
        } else if (name === 'Tea & Scone') {
            ctx.fillStyle = '#e5e7eb';
            ctx.beginPath(); ctx.ellipse(x - 8 * S, y - 3 * S, 28 * S, 6 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f8fafc';
            rr(x - 28 * S, y - 34 * S, 30 * S, 26 * S, 6 * S); ctx.fill();
            ctx.fillStyle = '#b45309';
            ctx.beginPath(); ctx.ellipse(x - 13 * S, y - 32 * S, 13 * S, 4 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 4 * S;
            ctx.beginPath(); ctx.arc(x + 4 * S, y - 22 * S, 8 * S, -1.2, 1.2); ctx.stroke();
            ctx.fillStyle = '#fcd34d';
            ctx.beginPath(); ctx.moveTo(x + 8 * S, y - 4 * S); ctx.lineTo(x + 20 * S, y - 30 * S); ctx.lineTo(x + 34 * S, y - 4 * S); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ef4444';
            ctx.beginPath(); ctx.arc(x + 21 * S, y - 12 * S, 4 * S, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.75)';
            ctx.beginPath(); ctx.arc(x - 15 * S, y - 36 * S, 6 * S, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x - 6 * S, y - 40 * S, 4 * S, 0, Math.PI * 2); ctx.fill();
        } else if (name === 'Mini Corgi') {
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath(); ctx.ellipse(x, y - 14 * S, 22 * S, 14 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff7ed';
            ctx.beginPath(); ctx.ellipse(x + 4 * S, y - 10 * S, 11 * S, 9 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath(); ctx.arc(x - 6 * S, y - 34 * S, 14 * S, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath(); ctx.moveTo(x - 18 * S, y - 42 * S); ctx.lineTo(x - 12 * S, y - 56 * S); ctx.lineTo(x - 4 * S, y - 44 * S); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(x + 4 * S, y - 44 * S); ctx.lineTo(x + 12 * S, y - 56 * S); ctx.lineTo(x + 16 * S, y - 40 * S); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#fff7ed';
            ctx.beginPath(); ctx.ellipse(x - 6 * S, y - 29 * S, 8 * S, 7 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#111827';
            ctx.beginPath(); ctx.arc(x - 11 * S, y - 37 * S, 2.2 * S, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x - 1 * S, y - 37 * S, 2.2 * S, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x - 6 * S, y - 31 * S, 3 * S, 2 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fb7185';
            ctx.beginPath(); ctx.ellipse(x - 6 * S, y - 25 * S, 3.5 * S, 2 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 5 * S;
            ctx.beginPath(); ctx.moveTo(x + 20 * S, y - 18 * S); ctx.quadraticCurveTo(x + 30 * S, y - 26 * S, x + 28 * S, y - 34 * S); ctx.stroke();
        } else if (name === 'Boombox') {
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 5 * S;
            ctx.beginPath(); ctx.arc(x, y - 54 * S, 18 * S, Math.PI, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#334155';
            rr(x - 34 * S, y - 54 * S, 68 * S, 46 * S, 6 * S); ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 2 * S;
            rr(x - 34 * S, y - 54 * S, 68 * S, 46 * S, 6 * S); ctx.stroke();
            [-20, 20].forEach(dx => {
                ctx.fillStyle = '#0f172a';
                ctx.beginPath(); ctx.arc(x + dx * S, y - 32 * S, 11 * S, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#64748b';
                ctx.beginPath(); ctx.arc(x + dx * S, y - 32 * S, 6 * S, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#94a3b8';
                ctx.beginPath(); ctx.arc(x + dx * S, y - 32 * S, 2 * S, 0, Math.PI * 2); ctx.fill();
            });
            ctx.fillStyle = '#e2e8f0';
            rr(x - 12 * S, y - 45 * S, 24 * S, 14 * S, 2 * S); ctx.fill();
            ctx.fillStyle = '#7c3aed';
            ctx.beginPath(); ctx.arc(x - 5 * S, y - 38 * S, 2.5 * S, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x + 5 * S, y - 38 * S, 2.5 * S, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ef4444';
            ctx.beginPath(); ctx.arc(x + 26 * S, y - 22 * S, 3 * S, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath(); ctx.arc(x + 16 * S, y - 22 * S, 3 * S, 0, Math.PI * 2); ctx.fill();
        } else {
            const item = window.storeItemByName && window.storeItemByName(name);
            if (item) {
                ctx.font = Math.round(34 * S) + 'px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(item.emoji, x, y - 30 * S);
            }
        }
        ctx.restore();
    };

    /* ---------- Store accessories drawn to fit the cat ---------- */

    DG.drawCatHat = function (ctx, name, hx, hy, S, topY) {
        if (!name || name === 'None') return;
        const top = (topY === undefined) ? hy - 31 * S : topY;
        const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
        ctx.save();
        ctx.lineJoin = 'round';

        if (name === 'Party Hat') {
            ctx.fillStyle = '#ec4899';
            ctx.beginPath();
            ctx.moveTo(hx, top - 30 * S);
            ctx.lineTo(hx - 20 * S, top + 2 * S);
            ctx.lineTo(hx + 20 * S, top + 2 * S);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fde047';
            ctx.beginPath(); ctx.arc(hx, top - 32 * S, 4 * S, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(hx - 7 * S, top - 12 * S, 2.6 * S, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#60a5fa';
            ctx.beginPath(); ctx.arc(hx + 7 * S, top - 8 * S, 2.6 * S, 0, Math.PI * 2); ctx.fill();
        } else if (name === 'Crown' || name === 'Golden Crown') {
            const wide = name === 'Golden Crown' ? 1.08 : 1;
            ctx.fillStyle = '#fbbf24';
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 1.6 * S;
            ctx.beginPath();
            ctx.moveTo(hx - 21 * S * wide, top + 2 * S);
            ctx.lineTo(hx - 18 * S * wide, top - 18 * S);
            ctx.lineTo(hx - 7 * S * wide, top - 9 * S);
            ctx.lineTo(hx, top - 23 * S);
            ctx.lineTo(hx + 7 * S * wide, top - 9 * S);
            ctx.lineTo(hx + 18 * S * wide, top - 18 * S);
            ctx.lineTo(hx + 21 * S * wide, top + 2 * S);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#ef4444';
            ctx.beginPath(); ctx.arc(hx, top - 4 * S, 2.6 * S, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#3b82f6';
            ctx.beginPath(); ctx.arc(hx - 12 * S, top - 5 * S, 2 * S, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(hx + 12 * S, top - 5 * S, 2 * S, 0, Math.PI * 2); ctx.fill();
        } else if (name === 'Sprout Clip') {
            ctx.strokeStyle = '#16a34a';
            ctx.lineWidth = 3 * S;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(hx + 8 * S, top + 2 * S);
            ctx.quadraticCurveTo(hx + 13 * S, top - 6 * S, hx + 9 * S, top - 13 * S);
            ctx.stroke();
            ctx.fillStyle = '#22c55e';
            ctx.beginPath(); ctx.ellipse(hx + 6 * S, top - 15 * S, 5 * S, 9 * S, -0.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(hx + 15 * S, top - 11 * S, 5 * S, 9 * S, 0.7, 0, Math.PI * 2); ctx.fill();
        } else if (name === 'Lo-Fi Headphones') {
            const bandR = 36 * S;
            ctx.strokeStyle = '#78350f';
            ctx.lineWidth = 6 * S;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(hx, hy - 2 * S, bandR, Math.PI * 1.02, Math.PI * 1.98);
            ctx.stroke();
            ctx.strokeStyle = '#b45309';
            ctx.lineWidth = 2 * S;
            ctx.beginPath();
            ctx.arc(hx, hy - 2 * S, bandR, Math.PI * 1.02, Math.PI * 1.98);
            ctx.stroke();
            // Earcups sit on the ears, not floating above the head.
            [-1, 1].forEach(side => {
                const ex = hx + side * 33 * S;
                const ey = hy - 18 * S;
                ctx.fillStyle = '#78350f';
                rr(ex - 8 * S, ey - 13 * S, 16 * S, 26 * S, 7 * S); ctx.fill();
                ctx.fillStyle = '#f59e0b';
                rr(ex - 5 * S, ey - 9 * S, 10 * S, 18 * S, 5 * S); ctx.fill();
                ctx.fillStyle = '#fde68a';
                ctx.beginPath(); ctx.arc(ex, ey, 3 * S, 0, Math.PI * 2); ctx.fill();
            });
        } else if (name === 'Straw Hat') {
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath(); ctx.ellipse(hx, top - 1 * S, 46 * S, 10 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fde68a';
            ctx.beginPath(); ctx.ellipse(hx, top - 10 * S, 23 * S, 15 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ef4444';
            rr(hx - 23 * S, top - 9 * S, 46 * S, 5 * S, 2 * S); ctx.fill();
        } else if (name === 'Frog Hood') {
            ctx.fillStyle = '#4ade80';
            ctx.beginPath();
            ctx.arc(hx, hy - 6 * S, 38 * S, Math.PI * 0.97, Math.PI * 2.03);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 3 * S;
            ctx.beginPath();
            ctx.arc(hx, hy - 6 * S, 35 * S, Math.PI * 1.02, Math.PI * 1.98);
            ctx.stroke();
            [-1, 1].forEach(side => {
                const fx = hx + side * 18 * S;
                const fy = top - 8 * S;
                ctx.fillStyle = '#86efac';
                ctx.beginPath(); ctx.arc(fx, fy, 10 * S, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(fx, fy, 7 * S, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#111827';
                ctx.beginPath(); ctx.arc(fx + side * 1.5 * S, fy, 3.4 * S, 0, Math.PI * 2); ctx.fill();
            });
        } else if (name === 'Chef Hat') {
            ctx.fillStyle = '#fff';
            rr(hx - 22 * S, top - 22 * S, 44 * S, 24 * S, 9 * S); ctx.fill();
            ctx.strokeStyle = '#e5e7eb';
            ctx.lineWidth = 1.6 * S;
            ctx.stroke();
            ctx.beginPath(); ctx.arc(hx - 14 * S, top - 24 * S, 11 * S, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(hx + 14 * S, top - 24 * S, 11 * S, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(hx, top - 31 * S, 13 * S, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f8fafc';
            rr(hx - 22 * S, top - 4 * S, 44 * S, 7 * S, 3 * S); ctx.fill();
        } else if (name === 'Sherlock Cap') {
            ctx.fillStyle = '#a16207';
            ctx.beginPath(); ctx.ellipse(hx, top - 1 * S, 36 * S, 13 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#854d0e';
            ctx.beginPath(); ctx.ellipse(hx, top + 4 * S, 30 * S, 6 * S, 0, 0, Math.PI * 2); ctx.fill();
            [-1, 1].forEach(side => {
                ctx.fillStyle = '#a16207';
                rr(hx + side * 30 * S - 5 * S, top - 3 * S, 10 * S, 17 * S, 4 * S); ctx.fill();
            });
            ctx.fillStyle = '#713f12';
            ctx.beginPath(); ctx.arc(hx, top - 12 * S, 3 * S, 0, Math.PI * 2); ctx.fill();
        } else if (name === 'Graduation Cap') {
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.moveTo(hx, top - 27 * S);
            ctx.lineTo(hx + 25 * S, top - 14 * S);
            ctx.lineTo(hx, top - 1 * S);
            ctx.lineTo(hx - 25 * S, top - 14 * S);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#1f2937';
            rr(hx - 15 * S, top - 8 * S, 30 * S, 8 * S, 2 * S); ctx.fill();
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2 * S;
            ctx.beginPath();
            ctx.moveTo(hx + 21 * S, top - 15 * S);
            ctx.lineTo(hx + 26 * S, top + 1 * S);
            ctx.stroke();
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath(); ctx.arc(hx + 26 * S, top + 3 * S, 2.6 * S, 0, Math.PI * 2); ctx.fill();
        } else if (name === 'Bearskin Hat') {
            ctx.fillStyle = '#111827';
            rr(hx - 20 * S, top - 34 * S, 40 * S, 38 * S, 14 * S); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,.14)';
            ctx.lineWidth = 1.4 * S;
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.moveTo(hx + i * 7 * S, top - 32 * S);
                ctx.lineTo(hx + i * 5 * S, top + 1 * S);
                ctx.stroke();
            }
            ctx.fillStyle = '#b45309';
            rr(hx - 21 * S, top + 1 * S, 42 * S, 5 * S, 2 * S); ctx.fill();
        } else if (name === 'Wizard Hat') {
            ctx.fillStyle = '#312e81';
            ctx.beginPath();
            ctx.moveTo(hx, top - 40 * S);
            ctx.lineTo(hx - 22 * S, top + 3 * S);
            ctx.lineTo(hx + 22 * S, top + 3 * S);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#1e1b4b';
            ctx.beginPath(); ctx.ellipse(hx, top + 3 * S, 28 * S, 6 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fde047';
            [[-8, -12], [6, -20], [11, -6], [-2, -28]].forEach(([dx, dy]) => {
                ctx.beginPath(); ctx.arc(hx + dx * S, top + dy * S, 2 * S, 0, Math.PI * 2); ctx.fill();
            });
            ctx.fillStyle = '#fef3c7';
            ctx.beginPath(); ctx.arc(hx + 4 * S, top - 12 * S, 3.2 * S, 0, Math.PI * 2); ctx.fill();
        } else if (name === 'Astro Helmet') {
            ctx.fillStyle = 'rgba(125,211,252,.22)';
            ctx.beginPath(); ctx.arc(hx, hy - 4 * S, 40 * S, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(125,211,252,.9)';
            ctx.lineWidth = 2.6 * S;
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,.75)';
            ctx.lineWidth = 3 * S;
            ctx.beginPath();
            ctx.arc(hx, hy - 4 * S, 33 * S, Math.PI * 1.12, Math.PI * 1.45);
            ctx.stroke();
            ctx.fillStyle = '#94a3b8';
            rr(hx - 24 * S, hy + 29 * S, 48 * S, 8 * S, 4 * S); ctx.fill();
        } else {
            const item = window.storeItemByName && window.storeItemByName(name);
            if (item) {
                ctx.font = Math.round(26 * S) + 'px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(item.emoji, hx, top - 4 * S);
            }
        }
        ctx.restore();
    };

    DG.drawCatFace = function (ctx, name, hx, hy, eyeY, eyeDx, S) {
        if (!name || name === 'None') return;
        const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
        const star = (cx, cy, outer, inner) => {
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const a = (Math.PI / 5) * i - Math.PI / 2;
                const r = i % 2 ? inner : outer;
                const px = cx + Math.cos(a) * r;
                const py = cy + Math.sin(a) * r;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
        };
        ctx.save();
        if (name === 'Sunglasses' || name === 'Pixel Sunglasses') {
            ctx.fillStyle = '#111827';
            const w = name === 'Pixel Sunglasses' ? 20 * S : 18 * S;
            const h = name === 'Pixel Sunglasses' ? 11 * S : 9 * S;
            rr(hx - eyeDx - w / 2, eyeY - h / 2, w, h, 2.5 * S); ctx.fill();
            rr(hx + eyeDx - w / 2, eyeY - h / 2, w, h, 2.5 * S); ctx.fill();
            ctx.fillRect(hx - 5 * S, eyeY - 1.5 * S, 10 * S, 3 * S);
            if (name === 'Pixel Sunglasses') {
                ctx.fillStyle = 'rgba(255,255,255,.55)';
                ctx.fillRect(hx - eyeDx - 6 * S, eyeY - 3 * S, 3 * S, 3 * S);
                ctx.fillRect(hx + eyeDx - 6 * S, eyeY - 3 * S, 3 * S, 3 * S);
            }
        } else if (name === 'Glasses' || name === 'Round Glasses') {
            ctx.strokeStyle = name === 'Round Glasses' ? '#111827' : '#1f2937';
            ctx.lineWidth = 2.2 * S;
            const r = name === 'Round Glasses' ? 10 * S : 9 * S;
            ctx.beginPath();
            ctx.arc(hx - eyeDx, eyeY, r, 0, Math.PI * 2);
            ctx.arc(hx + eyeDx, eyeY, r, 0, Math.PI * 2);
            ctx.moveTo(hx - 4 * S, eyeY);
            ctx.lineTo(hx + 4 * S, eyeY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(hx - eyeDx - r, eyeY);
            ctx.lineTo(hx - 30 * S, eyeY - 2 * S);
            ctx.moveTo(hx + eyeDx + r, eyeY);
            ctx.lineTo(hx + 30 * S, eyeY - 2 * S);
            ctx.stroke();
        } else if (name === 'Star Sunglasses') {
            ctx.fillStyle = 'rgba(251,191,36,.9)';
            ctx.strokeStyle = '#b45309';
            ctx.lineWidth = 1.6 * S;
            star(hx - eyeDx, eyeY, 13 * S, 5.5 * S); ctx.fill(); ctx.stroke();
            star(hx + eyeDx, eyeY, 13 * S, 5.5 * S); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = '#b45309';
            ctx.beginPath(); ctx.moveTo(hx - 5 * S, eyeY); ctx.lineTo(hx + 5 * S, eyeY); ctx.stroke();
            ctx.fillStyle = 'rgba(146,64,14,.55)';
            ctx.beginPath(); ctx.arc(hx - eyeDx, eyeY, 4 * S, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(hx + eyeDx, eyeY, 4 * S, 0, Math.PI * 2); ctx.fill();
        } else if (name === 'Blush Stickers') {
            ctx.fillStyle = 'rgba(251,113,133,.8)';
            [-1, 1].forEach(side => {
                ctx.beginPath();
                ctx.ellipse(hx + side * 20 * S, hy + 12 * S, 7 * S, 3.4 * S, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.ellipse(hx + side * 24 * S, hy + 9 * S, 3 * S, 1.8 * S, -0.4, 0, Math.PI * 2);
                ctx.fill();
            });
        } else if (name === 'Pirate Eyepatch') {
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.ellipse(hx - eyeDx, eyeY, 11 * S, 9 * S, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.4 * S;
            ctx.beginPath();
            ctx.moveTo(hx - eyeDx - 10 * S, eyeY - 4 * S);
            ctx.lineTo(hx - 32 * S, eyeY - 16 * S);
            ctx.moveTo(hx - eyeDx + 9 * S, eyeY + 2 * S);
            ctx.lineTo(hx + 30 * S, eyeY - 8 * S);
            ctx.stroke();
        } else if (name === 'Monocle') {
            ctx.strokeStyle = '#b45309';
            ctx.lineWidth = 2.6 * S;
            ctx.beginPath(); ctx.arc(hx + eyeDx, eyeY, 11 * S, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = 'rgba(180,83,9,.7)';
            ctx.lineWidth = 1.4 * S;
            ctx.beginPath();
            ctx.moveTo(hx + eyeDx + 10 * S, eyeY + 4 * S);
            ctx.quadraticCurveTo(hx + 26 * S, eyeY + 18 * S, hx + 16 * S, hy + 30 * S);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,.8)';
            ctx.lineWidth = 1.6 * S;
            ctx.beginPath(); ctx.arc(hx + eyeDx - 3 * S, eyeY - 4 * S, 4 * S, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
        } else if (name === 'Cyber Visor') {
            ctx.save();
            ctx.shadowColor = 'rgba(34,211,238,.9)';
            ctx.shadowBlur = 12 * S;
            ctx.fillStyle = 'rgba(34,211,238,.72)';
            rr(hx - 30 * S, eyeY - 8 * S, 60 * S, 16 * S, 6 * S); ctx.fill();
            ctx.restore();
            ctx.strokeStyle = '#0891b2';
            ctx.lineWidth = 2 * S;
            rr(hx - 30 * S, eyeY - 8 * S, 60 * S, 16 * S, 6 * S); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,.8)';
            ctx.lineWidth = 1.6 * S;
            ctx.beginPath();
            ctx.moveTo(hx - 24 * S, eyeY - 4 * S);
            ctx.lineTo(hx + 24 * S, eyeY - 4 * S);
            ctx.stroke();
        } else {
            const item = window.storeItemByName && window.storeItemByName(name);
            if (item) {
                ctx.fillStyle = 'rgba(15,23,42,.28)';
                rr(hx - 28 * S, eyeY - 7 * S, 56 * S, 14 * S, 5 * S); ctx.fill();
            }
        }
        ctx.restore();
    };

    DG.drawCatOutfit = function (ctx, name, hx, hy, S, neckY, bodyTop, bodyBottom, halfW) {
        if (!name || name === 'None') return;
        const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
        const NW = Math.max(22 * S, halfW * 0.9);
        const top = Math.max(bodyTop, hy + 32 * S);
        ctx.save();
        ctx.lineJoin = 'round';

        if (name === 'Red Scarf' || name === 'Pink Floral Scarf') {
            const col = name === 'Red Scarf' ? '#ef4444' : '#f472b6';
            ctx.fillStyle = col;
            rr(hx - NW, neckY - 5 * S, NW * 2, 10 * S, 5 * S); ctx.fill();
            rr(hx + NW * 0.28, neckY + 3 * S, 8 * S, 17 * S, 3 * S); ctx.fill();
            if (name === 'Pink Floral Scarf') {
                ctx.fillStyle = '#fde68a';
                [-2, 0, 2].forEach(i => {
                    ctx.beginPath(); ctx.arc(hx + i * 9 * S, neckY, 1.8 * S, 0, Math.PI * 2); ctx.fill();
                });
            }
        } else if (name === 'Tweed Bow Tie' || name === 'Gentleman Bowtie') {
            const col = name === 'Tweed Bow Tie' ? '#92400e' : '#111827';
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.moveTo(hx, neckY);
            ctx.lineTo(hx - 15 * S, neckY - 7 * S);
            ctx.lineTo(hx - 15 * S, neckY + 7 * S);
            ctx.closePath(); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(hx, neckY);
            ctx.lineTo(hx + 15 * S, neckY - 7 * S);
            ctx.lineTo(hx + 15 * S, neckY + 7 * S);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = name === 'Tweed Bow Tie' ? '#b45309' : '#374151';
            ctx.beginPath(); ctx.arc(hx, neckY, 4 * S, 0, Math.PI * 2); ctx.fill();
        } else if (name === 'Bread Collar') {
            ctx.fillStyle = '#fde68a';
            rr(hx - NW, neckY - 9 * S, NW * 2, 18 * S, 7 * S); ctx.fill();
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 2 * S;
            ctx.stroke();
            ctx.fillStyle = '#f59e0b';
            rr(hx - NW, neckY - 9 * S, NW * 2, 4 * S, 2 * S); ctx.fill();
            ctx.strokeStyle = 'rgba(180,83,9,.5)';
            ctx.lineWidth = 1.4 * S;
            [-1, 1].forEach(side => {
                ctx.beginPath();
                ctx.moveTo(hx + side * 8 * S, neckY - 2 * S);
                ctx.lineTo(hx + side * 12 * S, neckY + 5 * S);
                ctx.stroke();
            });
        } else if (name === 'Boba Apron') {
            ctx.fillStyle = '#16a34a';
            ctx.beginPath();
            ctx.moveTo(hx - 17 * S, neckY);
            ctx.lineTo(hx + 17 * S, neckY);
            ctx.lineTo(hx + 22 * S, bodyBottom);
            ctx.lineTo(hx - 22 * S, bodyBottom);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#15803d';
            ctx.lineWidth = 2 * S;
            rr(hx - 11 * S, neckY + 10 * S, 22 * S, 17 * S, 4 * S); ctx.stroke();
            ctx.fillStyle = '#78350f';
            [[-5, 20], [0, 22], [5, 20]].forEach(([dx, dy]) => {
                ctx.beginPath(); ctx.arc(hx + dx * S, neckY + dy * S, 1.8 * S, 0, Math.PI * 2); ctx.fill();
            });
        } else if (name === 'Yellow Raincoat') {
            ctx.fillStyle = '#facc15';
            rr(hx - halfW - 2 * S, top, (halfW + 2 * S) * 2, bodyBottom - top, 12 * S); ctx.fill();
            ctx.strokeStyle = '#eab308';
            ctx.lineWidth = 2 * S;
            rr(hx - halfW - 2 * S, top, (halfW + 2 * S) * 2, bodyBottom - top, 12 * S); ctx.stroke();
            ctx.fillStyle = '#eab308';
            ctx.beginPath(); ctx.ellipse(hx, neckY, NW, 7 * S, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#a16207';
            [0.25, 0.55, 0.85].forEach(t => {
                ctx.beginPath();
                ctx.arc(hx, top + (bodyBottom - top) * t, 2.2 * S, 0, Math.PI * 2);
                ctx.fill();
            });
        } else if (name === 'Royal Guard Tunic') {
            ctx.fillStyle = '#dc2626';
            rr(hx - halfW, top, halfW * 2, bodyBottom - top, 10 * S); ctx.fill();
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(hx - halfW, bodyBottom - 8 * S, halfW * 2, 7 * S);
            ctx.fillStyle = '#fbbf24';
            [0.3, 0.55, 0.8].forEach(t => {
                ctx.beginPath();
                ctx.arc(hx, top + (bodyBottom - top) * t, 2.4 * S, 0, Math.PI * 2);
                ctx.fill();
            });
            [-1, 1].forEach(side => {
                ctx.fillStyle = '#fbbf24';
                rr(hx + side * (halfW - 2 * S) - 6 * S, top + 2 * S, 12 * S, 6 * S, 3 * S); ctx.fill();
            });
        } else if (name === 'Shakespeare Ruff') {
            ctx.fillStyle = '#f8fafc';
            ctx.strokeStyle = '#d1d5db';
            ctx.lineWidth = 1.4 * S;
            for (let i = -3; i <= 3; i++) {
                ctx.beginPath();
                ctx.arc(hx + i * 8 * S, neckY + Math.abs(i) * 1.6 * S, 5.6 * S, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        } else if (name === 'Shark Onesie') {
            ctx.fillStyle = '#64748b';
            rr(hx - halfW, top, halfW * 2, bodyBottom - top, 12 * S); ctx.fill();
            ctx.fillStyle = '#cbd5e1';
            ctx.beginPath();
            ctx.ellipse(hx, bodyBottom - 6 * S, halfW * 0.6, 12 * S, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#475569';
            ctx.beginPath();
            ctx.moveTo(hx + halfW * 0.7, neckY + 10 * S);
            ctx.lineTo(hx + halfW + 12 * S, neckY - 2 * S);
            ctx.lineTo(hx + halfW * 0.55, neckY + 24 * S);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fff';
            [-3, -1, 1, 3].forEach(i => {
                ctx.beginPath();
                ctx.moveTo(hx + i * 4 * S, neckY - 5 * S);
                ctx.lineTo(hx + i * 4 * S + 3 * S, neckY + 1 * S);
                ctx.lineTo(hx + i * 4 * S + 6 * S, neckY - 5 * S);
                ctx.closePath();
                ctx.fill();
            });
        } else if (name === 'Dragon Suit') {
            ctx.fillStyle = '#16a34a';
            rr(hx - halfW, top, halfW * 2, bodyBottom - top, 12 * S); ctx.fill();
            ctx.fillStyle = '#bbf7d0';
            ctx.beginPath();
            ctx.ellipse(hx, bodyBottom - 7 * S, halfW * 0.55, 12 * S, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#15803d';
            [-1, 1].forEach(side => {
                for (let i = 0; i < 3; i++) {
                    const y = neckY + 4 * S + i * 9 * S;
                    ctx.beginPath();
                    ctx.moveTo(hx + side * halfW, y);
                    ctx.lineTo(hx + side * (halfW + 9 * S), y - 4 * S);
                    ctx.lineTo(hx + side * halfW, y + 6 * S);
                    ctx.closePath();
                    ctx.fill();
                }
            });
        } else if (name === 'Racing Jacket') {
            ctx.fillStyle = '#ef4444';
            rr(hx - halfW, top, halfW * 2, bodyBottom - top, 10 * S); ctx.fill();
            ctx.fillStyle = '#fde047';
            ctx.fillRect(hx - halfW, bodyBottom - 12 * S, halfW * 2, 4 * S);
            ctx.fillStyle = '#fff';
            ctx.fillRect(hx - 2 * S, top, 4 * S, bodyBottom - top);
        } else if (name === 'Sports Vest') {
            ctx.fillStyle = '#22c55e';
            rr(hx - halfW * 0.8, top, halfW * 1.6, bodyBottom - top, 9 * S); ctx.fill();
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(hx - 2 * S, top, 4 * S, bodyBottom - top);
        }
        ctx.restore();
    };

    DG.drawCatAvatar = function (ctx, x, y, scale, look, opts) {
        const l = DG.normalizeLook(look);
        const pal = DG.catPalette(l.cat);
        const S = scale || 1;
        const o = opts || {};
        const fur = pal.body;
        const shade = pal.shade;
        const point = pal.points;
        const cream = '#fff8ee';
        ctx.save();
        ctx.translate(x, y);

        // soft ground shadow
        ctx.fillStyle = 'rgba(60,40,30,.18)';
        ctx.beginPath();
        ctx.ellipse(0, 3 * S, 44 * S, 9 * S, 0, 0, Math.PI * 2);
        ctx.fill();

        // tail (behind the body)
        ctx.lineCap = 'round';
        ctx.strokeStyle = (l.cat === 'Ragdoll' || l.cat === 'Siamese') ? point : shade;
        ctx.lineWidth = 13 * S;
        ctx.beginPath();
        ctx.moveTo(24 * S, -22 * S);
        ctx.quadraticCurveTo(62 * S, -26 * S, 54 * S, -70 * S);
        ctx.quadraticCurveTo(50 * S, -96 * S, 30 * S, -104 * S);
        ctx.stroke();
        ctx.strokeStyle = fur;
        ctx.lineWidth = 7 * S;
        ctx.beginPath();
        ctx.moveTo(26 * S, -24 * S);
        ctx.quadraticCurveTo(56 * S, -30 * S, 50 * S, -68 * S);
        ctx.stroke();

        // back haunches
        ctx.fillStyle = shade;
        [-20, 20].forEach(dx => {
            ctx.beginPath();
            ctx.ellipse(dx * S, -17 * S, 18 * S, 22 * S, 0, 0, Math.PI * 2);
            ctx.fill();
        });

        // body
        const bodyGrad = ctx.createLinearGradient(0, -82 * S, 0, -4 * S);
        bodyGrad.addColorStop(0, fur);
        bodyGrad.addColorStop(1, shade);
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.ellipse(0, -37 * S, 30 * S, 40 * S, 0, 0, Math.PI * 2);
        ctx.fill();

        // chest fluff
        ctx.fillStyle = cream;
        ctx.beginPath();
        ctx.ellipse(0, -31 * S, 17 * S, 27 * S, 0, 0, Math.PI * 2);
        ctx.fill();

        // front paws
        ctx.fillStyle = (l.cat === 'Ragdoll' || l.cat === 'Siamese') ? point : cream;
        [-12, 12].forEach(dx => {
            ctx.beginPath();
            ctx.ellipse(dx * S, -4 * S, 9 * S, 5 * S, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(90,70,60,.24)';
            ctx.lineWidth = 1.2 * S;
            ctx.stroke();
        });

        // head
        const hx = 0, hy = -91 * S;
        const headGrad = ctx.createRadialGradient(-10 * S, hy - 12 * S, 6 * S, 0, hy, 42 * S);
        headGrad.addColorStop(0, fur);
        headGrad.addColorStop(1, shade);
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.ellipse(hx, hy, 33 * S, 31 * S, 0, 0, Math.PI * 2);
        ctx.fill();

        // ears
        const ear = (side) => {
            const sx = side * 1;
            ctx.fillStyle = fur;
            ctx.beginPath();
            ctx.moveTo(sx * 24 * S, hy - 18 * S);
            ctx.lineTo(sx * 34 * S, hy - 45 * S);
            ctx.lineTo(sx * 7 * S, hy - 30 * S);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#f4a9b8';
            ctx.beginPath();
            ctx.moveTo(sx * 24 * S, hy - 22 * S);
            ctx.lineTo(sx * 30 * S, hy - 38 * S);
            ctx.lineTo(sx * 12 * S, hy - 28 * S);
            ctx.closePath();
            ctx.fill();
        };
        ear(-1); ear(1);

        // Ragdoll / Siamese colour-point mask
        if (l.cat === 'Ragdoll' || l.cat === 'Siamese') {
            ctx.fillStyle = point;
            ctx.globalAlpha = 0.92;
            ctx.beginPath();
            ctx.ellipse(hx, hy - 2 * S, 30 * S, 23 * S, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            // cream muzzle
            ctx.fillStyle = cream;
            ctx.beginPath();
            ctx.ellipse(hx, hy + 13 * S, 19 * S, 11 * S, 0, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // muzzle
            ctx.fillStyle = cream;
            ctx.beginPath();
            ctx.ellipse(hx, hy + 13 * S, 18 * S, 10 * S, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // tabby stripes (Ginger)
        if (l.cat === 'Ginger') {
            ctx.strokeStyle = 'rgba(150,80,30,.35)';
            ctx.lineWidth = 3 * S;
            ctx.lineCap = 'round';
            [-18, 0, 18].forEach((dx, i) => {
                ctx.beginPath();
                ctx.moveTo(hx + dx * S, hy - 27 * S + i * 2 * S);
                ctx.quadraticCurveTo(hx + dx * 0.7 * S, hy - 21 * S, hx + dx * 0.5 * S, hy - 16 * S);
                ctx.stroke();
            });
            ctx.beginPath();
            ctx.moveTo(-27 * S, -52 * S);
            ctx.quadraticCurveTo(-20 * S, -44 * S, -25 * S, -36 * S);
            ctx.moveTo(27 * S, -52 * S);
            ctx.quadraticCurveTo(20 * S, -44 * S, 25 * S, -36 * S);
            ctx.stroke();
        }

        // eyes
        const eyeY = hy - 4 * S;
        [-13, 13].forEach(dx => {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.ellipse(hx + dx * S, eyeY, 8.4 * S, 9.6 * S, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(80,55,40,.34)';
            ctx.lineWidth = 1 * S;
            ctx.stroke();
            const iris = ctx.createRadialGradient(hx + dx * S, eyeY - 2 * S, 1 * S, hx + dx * S, eyeY, 6 * S);
            iris.addColorStop(0, pal.eye);
            iris.addColorStop(0.65, pal.eye);
            iris.addColorStop(1, '#1f2937');
            ctx.fillStyle = iris;
            ctx.beginPath();
            ctx.arc(hx + dx * S, eyeY, 5.1 * S, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.ellipse(hx + dx * S, eyeY, 2.3 * S, 4.2 * S, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            ctx.beginPath();
            ctx.arc(hx + dx * S - 2 * S, eyeY - 3 * S, 1.6 * S, 0, Math.PI * 2);
            ctx.fill();
        });

        // nose + mouth
        ctx.fillStyle = '#e58fa2';
        ctx.beginPath();
        ctx.moveTo(hx - 3.5 * S, hy + 7 * S);
        ctx.lineTo(hx + 3.5 * S, hy + 7 * S);
        ctx.lineTo(hx, hy + 11 * S);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(80,55,45,.6)';
        ctx.lineWidth = 1.5 * S;
        ctx.beginPath();
        ctx.moveTo(hx, hy + 11 * S);
        ctx.quadraticCurveTo(hx - 4 * S, hy + 16 * S, hx - 8 * S, hy + 13 * S);
        ctx.moveTo(hx, hy + 11 * S);
        ctx.quadraticCurveTo(hx + 4 * S, hy + 16 * S, hx + 8 * S, hy + 13 * S);
        ctx.stroke();

        // whiskers
        ctx.strokeStyle = 'rgba(70,50,40,.35)';
        ctx.lineWidth = 1 * S;
        [-1, 1].forEach(side => {
            [-14, -8, 8].forEach((dy, i) => {
                ctx.beginPath();
                ctx.moveTo(hx + side * 17 * S, hy + 10 * S + i * 2 * S);
                ctx.quadraticCurveTo(hx + side * 36 * S, hy + dy * S, hx + side * 44 * S, hy + (dy - 2) * S);
                ctx.stroke();
            });
        });

        // head outline
        ctx.strokeStyle = 'rgba(70,50,40,.22)';
        ctx.lineWidth = 1.4 * S;
        ctx.beginPath();
        ctx.ellipse(hx, hy, 33 * S, 31 * S, 0, 0, Math.PI * 2);
        ctx.stroke();

        // ----- accessories -----
        // Layered: headphones + hat, eyes + blush, body + neckwear.
        DG.drawCatHat(ctx, l.ears, hx, hy, S, hy - 31 * S);
        DG.drawCatHat(ctx, l.hat, hx, hy, S, hy - 31 * S);
        DG.drawCatFace(ctx, l.glasses, hx, hy, eyeY, 13 * S, S);
        DG.drawCatFace(ctx, l.cheeks, hx, hy, eyeY, 13 * S, S);
        DG.drawCatOutfit(ctx, l.outfit, hx, hy, S, hy + 36 * S, -77 * S, -4 * S, 30 * S);
        DG.drawCatOutfit(ctx, l.neck, hx, hy, S, hy + 36 * S, -77 * S, -4 * S, 30 * S);

        // little shine on the head
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.beginPath();
        ctx.ellipse(hx - 10 * S, hy - 12 * S, 15 * S, 9 * S, -0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    };

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

        // Glasses / store eyewear + blush
        DG.drawCatFace(ctx, l.glasses, 0, hy, hy - 2 * s, 11 * s, s);
        DG.drawCatFace(ctx, l.cheeks, 0, hy, hy - 2 * s, 11 * s, s);

        // Hats / store headwear (fitted to the head and ears)
        DG.drawCatHat(ctx, l.ears, 0, hy, s, hy - 28 * s);
        DG.drawCatHat(ctx, l.hat, 0, hy, s, hy - 28 * s);

        // Outfits (front)
        if (['Racing Jacket', 'Sports Vest', 'Superhero Cape'].indexOf(l.outfit) === -1) {
            DG.drawCatOutfit(ctx, l.outfit, 0, hy, s, hy + 26 * s, -74 * s, -34 * s, 24 * s);
        }
        DG.drawCatOutfit(ctx, l.neck, 0, hy, s, hy + 26 * s, -74 * s, -34 * s, 24 * s);

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

    /* Corner board: every remaining racer with a correct / N bar. Solo never
       shows it. Updates every ~700ms from the already-synced player rows, so
       it never adds another database query. */
    DG.updateMpProgress = function (players) {
        const board = (typeof DG.mpProgressBoard === 'function')
            ? DG.mpProgressBoard(players || (S.opts && S.opts.players) || [], {
                mode: S.mode,
                meId: currentUser && currentUser.id,
                questionCount: S.questionCount
            })
            : null;
        const html = (typeof DG.mpProgressHTML === 'function') ? DG.mpProgressHTML(board) : '';
        const el = document.getElementById('dg-mp-progress');
        if (el) {
            if (!S.active || !board || !board.visible || !board.rows.length) {
                el.classList.add('hidden');
                el.innerHTML = '';
            } else {
                el.innerHTML = html;
                el.classList.remove('hidden');
            }
        }
        // An early finisher waits on the results panel. Keep that panel's
        // "remaining racers" list live from the same synced rows.
        const resultsEl = document.getElementById('dg-results-progress');
        if (resultsEl) {
            resultsEl.innerHTML = html || '<p class="dg-results-wait">Waiting for the room…</p>';
        }
        return board;
    };

    DG.hideMpProgress = function () {
        const el = document.getElementById('dg-mp-progress');
        if (!el) return;
        el.classList.add('hidden');
        el.innerHTML = '';
    };

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

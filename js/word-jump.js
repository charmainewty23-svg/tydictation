/* LearniTY Dictation — Word Jump (Doodle Jump style climber) and the
   Word Jump Challenge friend matches, plus Word Jump admin + pagehide hook.
   Moved verbatim out of index.html (window.onload stays in js/shared.js). */

        async function fetchWjScoreStamps() {
            const pageSize = 1000;
            const rows = [];
            for (let from = 0; from < 20000; from += pageSize) {
                const { data, error } = await sb.from('wj_scores')
                    .select('email, created_at')
                    .order('created_at', { ascending: true })
                    .range(from, from + pageSize - 1);
                if (error) return { error, rows };
                rows.push(...(data || []));
                if (!data || data.length < pageSize) break;
            }
            return { error: null, rows };
        }

        async function loadWordJumpAdmin(forceForms) {
            const statsEl = document.getElementById('wj-admin-stats');
            const listEl = document.getElementById('wj-admin-container');
            if (!statsEl || !listEl) return;
            if (!isAdmin()) return;
            if (forceForms) await ensureFormDirectory(true);
            statsEl.innerHTML = '';
            listEl.innerHTML = '<div class="flex flex-col items-center py-10"><div class="loader mb-4"></div><p class="text-emerald-400 font-bold">Loading...</p></div>';

            const dayStart = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
            dayStart.setHours(0, 0, 0, 0);

            const [boardRes, totalsRes, todayRes, stampRes] = await Promise.all([
                sb.from('wj_leaderboard')
                    .select('user_id,nickname,email,score,height,words,plays,created_at')
                    .order('score', { ascending: false })
                    .order('words', { ascending: false })
                    .order('created_at', { ascending: true })
                    .limit(1000),
                sb.from('wj_scores').select('id', { count: 'exact', head: true }),
                sb.from('wj_scores').select('id', { count: 'exact', head: true })
                    .gte('created_at', dayStart.toISOString()),
                fetchWjScoreStamps()
            ]);

            adminCache.wj = {
                board: boardRes.data || [],
                error: boardRes.error || null,
                totalGames: totalsRes.count || 0,
                todayGames: todayRes.count || 0,
                stamps: stampRes.rows || [],
                stampsError: stampRes.error || null,
                dayStart: dayStart.toISOString()
            };
            renderWordJumpAdmin();
        }

        function renderWordJumpAdmin() {
            const statsEl = document.getElementById('wj-admin-stats');
            const listEl = document.getElementById('wj-admin-container');
            if (!statsEl || !listEl || !adminCache.wj) return;
            const pack = adminCache.wj;
            if (pack.error) {
                statsEl.innerHTML = '';
                listEl.innerHTML = `<p class="text-gray-400 text-center py-10">Word Jump leaderboard not available. Run <code class="text-emerald-600">supabase/wj_scores.sql</code> in the SQL editor.</p>`;
                return;
            }
            const board = pack.board || [];
            const totalGames = pack.totalGames;
            const todayGames = pack.todayGames;
            const best = board.length ? board[0].score : 0;
            const todayLabel = todayGames === null ? '—' : todayGames;
            statsEl.innerHTML = `
                <div class="bg-emerald-50 rounded-2xl p-5 text-center">
                    <p class="text-3xl font-bold text-emerald-600">${board.length}</p>
                    <p class="text-xs text-gray-400 font-bold uppercase tracking-wider">Students</p>
                </div>
                <div class="bg-blue-50 rounded-2xl p-5 text-center">
                    <p class="text-3xl font-bold text-blue-600">${totalGames}</p>
                    <p class="text-xs text-gray-400 font-bold uppercase tracking-wider">Games played</p>
                </div>
                <div class="bg-amber-50 rounded-2xl p-5 text-center">
                    <p class="text-3xl font-bold text-amber-600">${best}</p>
                    <p class="text-xs text-gray-400 font-bold uppercase tracking-wider">Top score</p>
                </div>
                <div class="bg-indigo-50 rounded-2xl p-5 text-center">
                    <p class="text-3xl font-bold text-indigo-600">${todayLabel}</p>
                    <p class="text-xs text-gray-400 font-bold uppercase tracking-wider">Today</p>
                </div>`;
            if (!board.length) {
                listEl.innerHTML = '<p class="text-gray-400 text-center py-10">No Word Jump games recorded yet.</p>';
                return;
            }
            listEl.innerHTML = renderFormSections(groupRowsByForm(board), (list) =>
                '<div class="space-y-2">' + list.map((r, i) => {
                const medal = ['🥇', '🥈', '🥉'][i] || `<span class="text-gray-400">${i + 1}.</span>`;
                const name = displayName(r);
                return `<div class="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2">
                    <span class="w-7 text-center text-sm font-bold">${medal}</span>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 min-w-0"><p class="text-sm font-bold text-gray-700 truncate">${escapeHtml(name)}</p>${classBadge(r.email, r.nickname)}${formAssignControl(r.email, r.nickname)}</div>
                        <p class="text-[10px] text-gray-400" title="${escapeHtml(hkDate(r.created_at))}">last ${timeAgo(r.created_at)}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-sm font-bold text-indigo-600">${Number(r.score) || 0} pts</p>
                        <p class="text-[10px] text-gray-400">${Number(r.words) || 0} words</p>
                    </div>
                </div>`;
            }).join('') + '</div>', { collapsible: true, scope: 'wj-admin' });
        }

        function openWordJump(fromView) {
            if (typeof WJ !== 'undefined') WJ.backView = fromView || 'hub-view';
            changeView('wordjump-view');
        }

        /* ==========================================================
           Word Jump — endless vertical climber (Doodle Jump style)
           Canvas only, no assets. Tilt / arrow keys / touch.
           ========================================================== */
        const WJ = {
            W: 400, H: 600,
            GRAVITY: 1217, JUMP_V: -882, WORD_BOOST: -1064,
            JET_V: -832, PROP_V: -210,
            // Regular jump hang was shortened ×0.92 (1.58s → 1.45s) with
            // height kept at 319px: GRAVITY ÷ 0.92², JUMP_V ÷ 0.92.
            // The correct-word launch keeps the same 465px height as the raw
            // WORD_BOOST, but its hang time is stretched ×WORD_BOOST_HANG so
            // students have longer to read the next Chinese prompt.
            // vy ÷ s and gravity ÷ s² keep the height identical:
            // -1064/1.35 ≈ -788, 1217/1.35² ≈ 668 → 788²/(2·668) ≈ 465px.
            WORD_BOOST_HANG: 1.35,
            BOOST_VY: -788, BOOST_G: 668,
            MOVE_MAX: 240, STEER_RATE: 16, STEER_STOP: 18,
            SPEED_RAMP_AT: 3200, SPEED_RAMP_FROM: 0.45,
            SCORE_HEAT_AT: 4500, SCORE_HEAT2_AT: 7000, SCORE_HEAT2_SPAN: 3000,
            // Third heat starts at 10000: modest speed-up only. lateHeat()
            // still caps at 1 so density / traps / platform width stay put.
            SCORE_HEAT3_AT: 10000, HEAT3_SPEED_BONUS: 0.12, HEAT3_TWIN_CHANCE: 0.28,
            TILT_RANGE: 11, TILT_DEAD: 0.025, TILT_CURVE: 1.6,
            QUIZ_GAP_MIN: 380, QUIZ_GAP_MAX: 500,
            mounted: false, running: false, paused: false, state: 'intro',
            raf: 0, lastTs: 0, acc: 0,
            canvas: null, ctx: null,
            keys: { left: false, right: false },
            tiltOn: false, tiltZero: null, tiltValue: 0, tiltSmooth: 0,
            holdDir: 0, holdPointer: null,
            platforms: [], quizRows: [], monsters: [], ufos: [], holes: [],
            shots: [], particles: [], toasts: [],
            player: null,
            camY: 0, topY: 0, maxClimb: 0, bonus: 0,
            wordsDone: 0, streak: 0, bestStreak: 0, nextQuizY: -560, afterQuiz: false,
            boostPending: false, anchors: [], durable: [],
            topic: '', soundOn: true, audio: null,
            lastShot: 0, bound: false, autoFs: false,
            milestones: [], passFlash: 0, passLabels: [],
            CHEERS: ['wow!', 'superb!', 'bravo!'], cheerIndex: 0
        };

        WJ.nextRand = function () { return WJ.rng ? WJ.rng() : Math.random(); };
        WJ.rand = (a, b) => a + WJ.nextRand() * (b - a);
        WJ.pick = arr => arr[Math.floor(WJ.nextRand() * arr.length)];
        WJ.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        WJ.score = () => Math.max(0, Math.floor(WJ.maxClimb / 10) + WJ.bonus);
        WJ.difficulty = () => WJ.clamp(WJ.maxClimb / 9000, 0, 1);
        // Challenge rooms share a course: difficulty / heat at a platform
        // must follow that platform's height, not the local player's score
        // (bonuses would otherwise desync the seed). Solo keeps the original
        // live-score behaviour below.
        WJ.difficultyAt = function (y) {
            if (WJ.challenge) return WJ.clamp(Math.max(0, -(y == null ? WJ.topY : y)) / 9000, 0, 1);
            return WJ.difficulty();
        };
        WJ.heatAt = function (y) {
            if (!WJ.challenge) return WJ.lateHeat();
            const s = Math.max(0, Math.floor(Math.max(0, -(y == null ? WJ.topY : y)) / 10));
            if (s < WJ.SCORE_HEAT_AT) return 0;
            if (s < WJ.SCORE_HEAT2_AT) {
                return 0.5 * (s - WJ.SCORE_HEAT_AT) / (WJ.SCORE_HEAT2_AT - WJ.SCORE_HEAT_AT);
            }
            return WJ.clamp(0.5 + 0.5 * (s - WJ.SCORE_HEAT2_AT) / WJ.SCORE_HEAT2_SPAN, 0, 1);
        };
        // Height-based in Challenge so every player shares the same course;
        // Solo still follows the live score (height + word bonuses).
        WJ.heat3At = function (y) {
            if (!WJ.challenge) return WJ.lateHeat3();
            const s = Math.max(0, Math.floor(Math.max(0, -(y == null ? WJ.topY : y)) / 10));
            return s >= WJ.SCORE_HEAT3_AT ? 1 : 0;
        };
        WJ.openingAt = function (y) {
            if (WJ.challenge) return Math.max(0, -(y == null ? WJ.topY : y)) < 1500;
            return WJ.maxClimb < 1500;
        };
        // difficulty() caps at 9000px climb (~900 height points). lateHeat
        // then adds two score ramps: 4500–7000 rises to 0.5, 7000–10000 to 1.
        // A third heat at 10000 is tracked separately (lateHeat3) so the
        // density curve stays capped while movement and enemies speed up.
        WJ.lateHeat = function () {
            const s = WJ.score();
            if (s < WJ.SCORE_HEAT_AT) return 0;
            if (s < WJ.SCORE_HEAT2_AT) {
                return 0.5 * (s - WJ.SCORE_HEAT_AT) / (WJ.SCORE_HEAT2_AT - WJ.SCORE_HEAT_AT);
            }
            return WJ.clamp(0.5 + 0.5 * (s - WJ.SCORE_HEAT2_AT) / WJ.SCORE_HEAT2_SPAN, 0, 1);
        };
        WJ.lateHeat3 = function () {
            return WJ.score() >= WJ.SCORE_HEAT3_AT ? 1 : 0;
        };

        /* Horizontal top speed ramps from SPEED_RAMP_FROM * MOVE_MAX at the
           bottom of a run to MOVE_MAX once you have climbed a while.
           After 10000, speedMulAt adds a modest extra (HEAT3_SPEED_BONUS). */
        WJ.speedMulAt = function (climb) {
            const h3 = WJ.challenge
                ? (Math.floor(Math.max(0, climb || 0) / 10) >= WJ.SCORE_HEAT3_AT ? 1 : 0)
                : WJ.lateHeat3();
            return 1 + WJ.HEAT3_SPEED_BONUS * h3;
        };
        WJ.speedCap = function () {
            const t = WJ.clamp(WJ.maxClimb / WJ.SPEED_RAMP_AT, 0, 1);
            const base = WJ.MOVE_MAX * (WJ.SPEED_RAMP_FROM + (1 - WJ.SPEED_RAMP_FROM) * t);
            return base * WJ.speedMulAt(WJ.challenge ? WJ.maxClimb : 0);
        };

        WJ.beep = function (freq, dur, type, vol) {
            if (!WJ.soundOn) return;
            try {
                if (!WJ.audio) WJ.audio = new (window.AudioContext || window.webkitAudioContext)();
                const ac = WJ.audio;
                if (ac.state === 'suspended') ac.resume();
                const o = ac.createOscillator(), g = ac.createGain();
                o.type = type || 'square';
                o.frequency.value = freq;
                o.connect(g); g.connect(ac.destination);
                const t = ac.currentTime, d = dur || 0.09, v = vol == null ? 0.05 : vol;
                g.gain.setValueAtTime(v, t);
                g.gain.exponentialRampToValueAtTime(0.0001, t + d);
                o.start(t); o.stop(t + d + 0.02);
            } catch (e) { /* audio is optional */ }
        };

        WJ.roundRect = function (ctx, x, y, w, h, r) {
            const rr = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + rr, y);
            ctx.arcTo(x + w, y, x + w, y + h, rr);
            ctx.arcTo(x + w, y + h, x, y + h, rr);
            ctx.arcTo(x, y + h, x, y, rr);
            ctx.arcTo(x, y, x + w, y, rr);
            ctx.closePath();
        };

        /* ---------------- lifecycle ---------------- */

        WJ.mount = function () {
            const canvas = document.getElementById('wj-canvas');
            if (!canvas) return;
            WJ.canvas = canvas;
            WJ.ctx = canvas.getContext('2d');
            WJ.overlay = document.getElementById('wj-overlay');
            WJ.mounted = true;
            WJ.autoFs = true;
            WJ.bindInput();
            WJ.resize();
            if (!WJ.platforms.length) WJ.reset();
            WJ.populateTopics();
            WJ.setTopicDefault();
            WJ.showEntry();
            WJ.loadMilestones();
            WJ.draw();
        };

        WJ.resize = function () {
            const c = WJ.canvas;
            if (!c) return;
            const rect = c.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            c.width = Math.round(rect.width * dpr);
            c.height = Math.round(rect.height * dpr);
        };

        WJ.reset = function () {
            WJ.platforms = []; WJ.quizRows = []; WJ.monsters = []; WJ.ufos = []; WJ.holes = [];
            WJ.shots = []; WJ.particles = []; WJ.toasts = [];
            WJ.player = {
                x: WJ.W / 2, y: 0, vx: 0, vy: 0, w: 34, h: 40, face: 1,
                prop: 0, jet: 0, shoes: 0, shield: 0, rainbow: 0, boostHang: false
            };
            WJ.camY = -WJ.H + 120;
            WJ.topY = 0;
            WJ.maxClimb = 0;
            WJ.bonus = 0;
            WJ.wordsDone = 0;
            WJ.boostPending = false;
            WJ.anchors = [];
            WJ.durable = [];
            WJ.streak = 0;
            WJ.bestStreak = 0;
            WJ.nextQuizY = -560;
            WJ.afterQuiz = false;
            WJ.paused = false;
            WJ.passFlash = 0;
            WJ.passLabels = [];
            WJ.lastPassFx = null;
            WJ.heatAnnounced = false;
            WJ.heat2Announced = false;
            WJ.heat3Announced = false;
            (WJ.milestones || []).forEach(m => { m.passed = false; });
            WJ.platforms.push({
                x: WJ.W / 2 - 46, y: 0, w: 92, h: 13, type: 'green',
                baseX: WJ.W / 2 - 46, baseY: 0, phase: 0, amp: 0, speed: 0,
                dead: false, fuse: 0, gadget: null
            });
            WJ.commitLayer([WJ.platforms[0]], true);
            WJ.genUpTo(-WJ.H - 220);
        };

        WJ.start = function (withFs) {
            if (!WJ.canvas) WJ.mount();
            recordGuestUsage('Word Jump', (!WJ.topic || WJ.topic === '__all__') ? 'All topics' : WJ.topic);
            // Ask for motion permission in this tap, before fullscreen,
            // so tilt works on iPhone / iPad (the toolbar Tilt button is
            // hidden once full screen starts).
            WJ.armTiltOnStart();
            if (withFs === false) {
                // Player chose windowed mode — don't force full screen later.
                WJ.autoFs = false;
                WJ.exitFullscreenSoft();
            } else {
                WJ.enterFullscreen();
            }
            WJ.reset();
            WJ.hideOverlay();
            WJ.state = 'playing';
            WJ.paused = false;
            WJ.running = true;
            WJ.lastTs = 0; WJ.acc = 0;
            cancelAnimationFrame(WJ.raf);
            WJ.raf = requestAnimationFrame(WJ.frame);
        };

        WJ.stop = function () {
            WJ.running = false;
            if (WJ.raf) cancelAnimationFrame(WJ.raf);
            WJ.raf = 0;
            WJ.holdDir = 0;
            WJ.keys.left = WJ.keys.right = false;
            WJ.state = 'intro';
            WJ.hideOverlay();
            WJ.exitFullscreenSoft();
        };

        /* ---------------- full screen ---------------- */

        WJ.fsOn = function () {
            const stage = document.getElementById('wj-stage');
            const el = document.fullscreenElement || document.webkitFullscreenElement;
            return (!!stage && el === stage) || document.body.classList.contains('wj-fs');
        };

        WJ.syncFsUi = function () {
            const on = WJ.fsOn();
            const exit = document.getElementById('wj-exit-fs');
            if (exit) exit.classList.toggle('hidden', !on);
            const enter = document.getElementById('wj-fs-enter');
            if (enter) enter.classList.toggle('hidden', on);
            const btn = document.getElementById('wj-fs-btn');
            if (btn) btn.innerText = on ? '⛶ Exit full screen' : '⛶ Full screen';
            const relayout = () => {
                if (!WJ.mounted) return;
                WJ.resize();
                WJ.draw();
            };
            if (WJ.tiltOn) WJ.tiltZero = null;
            requestAnimationFrame(relayout);
            // Full-screen layout can settle a frame or two late; a second
            // pass keeps pointer hit-testing aligned with the visible canvas.
            setTimeout(relayout, 120);
        };

        WJ.lockFsScroll = function (on) {
            if (on) {
                if (!document.body.classList.contains('wj-fs')) {
                    WJ.fsScrollY = window.scrollY || document.documentElement.scrollTop || 0;
                }
                document.body.classList.add('wj-fs');
                document.body.style.top = '-' + (WJ.fsScrollY || 0) + 'px';
            } else {
                const y = WJ.fsScrollY || 0;
                document.body.classList.remove('wj-fs');
                document.body.style.top = '';
                window.scrollTo(0, y);
            }
        };

        WJ.fakeFullscreen = function (on) {
            WJ.lockFsScroll(!!on);
            if (WJ.tiltOn) WJ.tiltZero = null;
            WJ.syncFsUi();
        };

        /* Ask the browser for real full screen. iOS Safari has no element full
           screen and some in-app browsers never settle the promise, so after
           600ms without full screen we fall back to the CSS version. */
        WJ.fsPending = 0;

        WJ.requestStageFullscreen = function () {
            const stage = document.getElementById('wj-stage');
            if (!stage) return;
            const token = ++WJ.fsPending;
            const giveUp = () => {
                if (token !== WJ.fsPending || WJ.fsOn()) return;
                WJ.fakeFullscreen(true);
            };
            if (stage.requestFullscreen) {
                try {
                    const p = stage.requestFullscreen();
                    if (p && p.catch) p.catch(giveUp);
                } catch (e) { giveUp(); }
            } else if (stage.webkitRequestFullscreen) {
                try { stage.webkitRequestFullscreen(); } catch (e) { giveUp(); }
            } else {
                giveUp();
                return;
            }
            setTimeout(giveUp, 600);
        };

        WJ.toggleFullscreen = function () {
            const stage = document.getElementById('wj-stage');
            if (!stage) return;
            WJ.autoFs = false;
            const el = document.fullscreenElement || document.webkitFullscreenElement;
            if (el) {
                WJ.fsPending++;
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); }
                return;
            }
            if (document.body.classList.contains('wj-fs')) {
                WJ.fsPending++;
                WJ.fakeFullscreen(false);
                return;
            }
            WJ.requestStageFullscreen();
        };

        WJ.enterFullscreen = function () {
            if (!WJ.autoFs || WJ.fsOn()) return;
            WJ.autoFs = false;
            WJ.requestStageFullscreen();
        };

        WJ.exitFullscreenSoft = function () {
            WJ.fsPending++;
            WJ.lockFsScroll(false);
            const el = document.fullscreenElement || document.webkitFullscreenElement;
            if (el) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); }
            }
            WJ.syncFsUi();
        };

        WJ.quit = function () {
            if (typeof WJC !== 'undefined' && WJC.room) {
                WJC.quitFromGame();
                return;
            }
            WJ.stop();
            changeView(WJ.backView || 'hub-view');
        };

        WJ.showEntry = function () {
            if (typeof WJC !== 'undefined' && WJC.room) {
                WJC.showRoom();
                return;
            }
            if (typeof WJC !== 'undefined') WJC.showModeSelect();
            else WJ.showIntro();
        };

        WJ.togglePause = function () {
            if (WJ.state !== 'playing') return;
            WJ.paused = !WJ.paused;
            if (WJ.paused) {
                WJ.setOverlay(`
                    <div class="w-full">
                        <div class="text-4xl mb-2">⏸</div>
                        <h3 class="text-xl font-bold text-gray-700 mb-4">Paused</h3>
                        <button onclick="WJ.togglePause()" class="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold">Resume</button>
                        <button onclick="WJ.restart(true)" class="w-full mt-2 py-2 bg-gray-100 text-gray-600 rounded-xl font-bold">Restart</button>
                        <button onclick="WJ.quit()" class="w-full mt-2 py-2 bg-gray-100 text-gray-600 rounded-xl font-bold">Quit</button>
                    </div>`, true);
            } else {
                WJ.hideOverlay();
            }
        };

        WJ.toggleSound = function () {
            WJ.soundOn = !WJ.soundOn;
            const b = document.getElementById('wj-sound-btn');
            if (b) b.innerText = WJ.soundOn ? '🔊 On' : '🔇 Off';
            if (WJ.soundOn) WJ.beep(660, 0.08, 'sine', 0.04);
        };

        WJ.setOverlay = function (html, show) {
            const el = WJ.overlay || document.getElementById('wj-overlay');
            if (!el) return;
            WJ.overlay = el;
            if (!show) {
                el.classList.add('hidden');
                el.classList.remove('flex');
                el.innerHTML = '';
                return;
            }
            el.innerHTML = html;
            el.classList.remove('hidden');
            el.classList.add('flex');
        };

        WJ.hideOverlay = function () { WJ.setOverlay('', false); };

        /* RE - wipe the run and start again. Full screen state is left alone
           on purpose, so this works mid-jump, while paused, after a game over
           and from the intro without kicking the player out of full screen.
           force=true comes from the pause / game-over menus, where the tap is
           already deliberate. */
        WJ.restart = function (force) {
            if (!WJ.canvas) { WJ.mount(); return; }
            if (WJ.challenge) {
                WJ.toast('Restart is off in a challenge.', '#0f766e');
                return;
            }
            if (!force && WJ.state === 'playing' && !WJ.paused && WJ.score() > 0) {
                if (!window.confirm('Restart this run? Your score will be lost.')) return;
            }
            WJ.hideOverlay();
            WJ.reset();
            WJ.state = 'playing';
            WJ.paused = false;
            WJ.running = true;
            WJ.lastTs = 0; WJ.acc = 0;
            cancelAnimationFrame(WJ.raf);
            WJ.raf = requestAnimationFrame(WJ.frame);
            WJ.toast('↺ New run', '#0f766e');
        };

        WJ.showIntro = function () {
            WJ.state = 'intro';
            const best = Number(localStorage.getItem('wj_best') || 0);
            WJ.setOverlay(`
                <div class="w-full py-2">
                    <div class="text-5xl mb-1">🦘</div>
                    <h3 class="text-2xl font-bold text-emerald-600 mb-1">Word Jump</h3>
                    <p class="text-gray-500 text-sm mb-4">Read the Chinese, then land on the English word that matches it.</p>
                    <div class="text-left bg-white rounded-xl border border-emerald-100 p-4 text-sm text-gray-600 space-y-2 mb-4">
                        <p>👈 <b>Tilt your phone</b> to move, or hold the pads at the bottom.</p>
                        <p>🟪 <b>Purple tiles</b> carry English words — bounce on the one that means the word on top.</p>
                        <p>🔥 Answer a few in a row for bonus points and a shield.</p>
                        <p>👆 <b>Tap anywhere else</b> to shoot at monsters and UFOs.</p>
                        <p>🧱 Brown breaks · white vanishes · yellow explodes · blue &amp; grey move.</p>
                        <p>⛶ <b>Full screen</b>: tap the ⛶ button in the top-right corner at any time. In full screen, <b>✕ Exit full screen</b> sits at the bottom.</p>
                    </div>
                    <button onclick="WJ.start(true)" class="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold text-lg hover:bg-emerald-600 transition-colors">⛶ Start in full screen</button>
                    <button onclick="WJ.start(false)" class="w-full mt-2 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-bold text-sm hover:bg-emerald-100 transition-colors">Start in a window</button>
                    <p class="text-xs text-gray-400 mt-3">Best ${best} · Desktop: ← → and Space to shoot</p>
                </div>`, true);
        };

        /* ---------------- leaderboard ---------------- */

        /* Fire-and-forget upload. Scores are written by the browser, so a
           determined student could fake one — keep this for classroom fun,
           not for assessment. */
        WJ.submitScore = function (score) {
            if (WJ.challenge) return;   // challenge results stay in the room; the solo board is solo-only
            if (previewStudentForm()) return;
            if (!canUseCloud() || typeof sb === 'undefined' || !sb) return;
            const topic = (WJ.topic && WJ.topic !== '__all__') ? WJ.topic : 'all';
            sb.from('wj_scores').insert({
                user_id: currentUser.id,
                email: currentUser.email,
                nickname: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
                topic: topic,
                score: score,
                height: Math.round(WJ.maxClimb),
                words: WJ.wordsDone
            }).then(({ error }) => {
                if (error) console.warn('Word Jump score not saved:', error.message);
            });
        };

        WJ.rankRow = function (i, row, meId) {
            const medal = ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
            const name = row.nickname || (row.email || '').split('@')[0] || 'student';
            const mine = meId && row.user_id === meId;
            return `<div class="flex items-center gap-2 py-1 ${mine ? 'rounded-lg bg-emerald-50 px-1' : ''}">
                <span class="w-6 text-center text-sm">${medal}</span>
                <span class="flex-1 truncate text-xs font-bold ${mine ? 'text-emerald-700' : 'text-gray-600'}">${escapeHtml(name)}${mine ? ' (you)' : ''}</span>
                <span class="text-xs font-bold text-indigo-600">${row.score || 0} pts</span>
                <span class="w-14 text-right text-[10px] text-gray-400">${row.words || 0} words</span>
            </div>`;
        };

        /* Top 7 personal bests, shown on the game-over card. */
        WJ.loadLeaderboard = async function () {
            const box = () => document.getElementById('wj-lb');
            if (!box()) return;
            if (isGuestUser()) {
                box().innerHTML = '<p class="text-xs font-bold text-gray-400 mb-2">🏆 Top 7</p><p class="text-xs text-gray-400">Leaderboards are hidden in guest mode. Sign in with your school account to see class rankings.</p>';
                return;
            }
            if (typeof sb === 'undefined' || !sb) { box().innerHTML = '<p class="text-xs text-gray-400">The leaderboard needs a connection.</p>'; return; }
            try {
                const { data, error } = await sb.from('wj_leaderboard')
                    .select('user_id,nickname,email,score,height,words,plays')
                    .order('score', { ascending: false })
                    .order('words', { ascending: false })
                    .order('created_at', { ascending: true })
                    .limit(7);
                if (!box()) return;   // overlay may have been replaced meanwhile
                if (error) throw error;
                if (!data || !data.length) {
                    box().innerHTML = '<p class="text-xs font-bold text-gray-400 mb-2">🏆 Top 7</p><p class="text-xs text-gray-400">No scores yet — sign in and play a game to get on the board.</p>';
                    return;
                }
                const me = currentUser ? currentUser.id : null;
                box().innerHTML = '<p class="text-xs font-bold text-gray-400 mb-1">🏆 Top 7</p>' +
                    data.map((r, i) => WJ.rankRow(i, r, me)).join('') +
                    (currentUser ? '' : '<p class="text-[10px] text-gray-400 mt-2">You are not signed in, so this game will not be saved.</p>');
            } catch (e) {
                if (box()) box().innerHTML = '<p class="text-xs font-bold text-gray-400 mb-2">🏆 Top 7</p><p class="text-xs text-gray-400">Leaderboard unavailable — ask your teacher to run <code>wj_scores.sql</code>.</p>';
            }
        };

        WJ.gameOver = function (reason) {
            if (WJ.state === 'over') return;
            WJ.running = false;
            if (WJ.player) WJ.player.boostHang = false;
            if (WJ.raf) cancelAnimationFrame(WJ.raf);
            WJ.raf = 0;
            WJ.state = 'over';
            const score = WJ.score();
            if (WJ.challenge && typeof WJC !== 'undefined') {
                WJC.onLocalFallen(reason, score);
                return;
            }
            const store = isGuestUser() ? sessionStorage : localStorage;
            const prev = Number(store.getItem('wj_best') || 0);
            const isBest = score > prev;
            if (isBest) store.setItem('wj_best', score);
            store.setItem('wj_words', Number(store.getItem('wj_words') || 0) + WJ.wordsDone);
            WJ.submitScore(score);
            WJ.beep(150, 0.4, 'sawtooth', 0.06);
            WJ.setOverlay(`
                <div class="w-full py-2">
                    <div class="text-4xl mb-2">${isBest ? '🏆' : '💥'}</div>
                    <h3 class="text-2xl font-bold text-gray-700 mb-1">${isBest ? 'New best!' : 'Game over'}</h3>
                    <p class="text-gray-400 text-sm mb-4">${escapeHtml(reason)}</p>
                    <div class="flex justify-center gap-8 mb-5">
                        <div><p class="text-3xl font-bold text-emerald-600">${score}</p><p class="text-xs text-gray-400">height</p></div>
                        <div><p class="text-3xl font-bold text-gray-600">${Math.max(score, prev)}</p><p class="text-xs text-gray-400">best</p></div>
                        <div><p class="text-3xl font-bold text-indigo-500">${WJ.wordsDone}</p><p class="text-xs text-gray-400">words</p></div>
                    </div>
                    <div id="wj-lb" class="text-left border-t border-gray-100 pt-3 mb-4">
                        <p class="text-xs font-bold text-gray-400 mb-2">🏆 Top 7</p>
                        <p class="text-xs text-gray-300">Loading…</p>
                    </div>
                    <button onclick="WJ.restart(true)" class="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-colors">Play again</button>
                    <button onclick="WJ.quit()" class="w-full mt-2 py-2 bg-gray-100 text-gray-600 rounded-xl font-bold">${WJ.backView === 'battle-view' ? 'Back to Word Battle' : 'Back to Hub'}</button>
                </div>`, true);
            WJ.loadLeaderboard();
            WJ.draw();
        };

        /* ---------------- words & topics ---------------- */

        WJ.BACKUP_WORDS = [
            ['tiger', '老虎', 'animals'], ['rocket', '火箭', 'space'], ['garden', '花園', 'nature'],
            ['planet', '行星', 'space'], ['pencil', '鉛筆', 'objects'], ['orange', '橙', 'colours'],
            ['silver', '銀色', 'colours'], ['bridge', '橋', 'places'], ['forest', '森林', 'nature'],
            ['winter', '冬天', 'nature'], ['travel', '旅行', 'travel'], ['dragon', '龍', 'animals'],
            ['market', '市場', 'places'], ['yellow', '黃色', 'colours'], ['castle', '城堡', 'places'],
            ['rabbit', '兔子', 'animals'], ['island', '島嶼', 'nature'], ['office', '辦公室', 'places'],
            ['camera', '相機', 'objects'], ['pocket', '口袋', 'objects']
        ];

        WJ.wordPool = function () {
            const names = (!WJ.topic || WJ.topic === '__all__') ? SHEET_NAMES : [WJ.topic];
            const seen = {};
            const list = [];
            names.forEach(n => (categories[n] || []).forEach(w => {
                const raw = primaryAnswer(w.en).trim();
                if (!/^[A-Za-z]{3,11}$/.test(raw)) return;
                const key = raw.toLowerCase();
                if (seen[key]) return;
                seen[key] = 1;
                list.push({ en: key, zh: w.zh || '', topic: n });
            }));
            if (list.length < 15) {
                WJ.BACKUP_WORDS.forEach(p => {
                    if (!seen[p[0]]) { seen[p[0]] = 1; list.push({ en: p[0], zh: p[1], topic: p[2] }); }
                });
            }
            return list;
        };

        WJ.commonPrefixLen = function (a, b) {
            const x = String(a || '').toLowerCase(), y = String(b || '').toLowerCase();
            let i = 0;
            while (i < x.length && i < y.length && x[i] === y[i]) i++;
            return i;
        };
        /* Same topic is the main “similar meaning” proxy. Length, a shared
           English stem/prefix, and a shared Chinese character are tie-breaks. */
        WJ.distractorScore = function (cand, target) {
            let s = 0;
            if (cand.topic && target.topic && cand.topic === target.topic) s += 100;
            const lenDiff = Math.abs(String(cand.en || '').length - String(target.en || '').length);
            if (lenDiff === 0) s += 15;
            else if (lenDiff === 1) s += 10;
            else if (lenDiff === 2) s += 5;
            const pref = WJ.commonPrefixLen(cand.en, target.en);
            if (pref >= 3) s += 20;
            else if (pref >= 2) s += 8;
            const cz = String(cand.zh || ''), tz = String(target.zh || '');
            if (cz && tz) {
                for (let i = 0; i < cz.length; i++) {
                    const ch = cz[i];
                    if (ch && tz.indexOf(ch) !== -1) { s += 12; break; }
                }
            }
            return s;
        };
        WJ.pickDistractors = function (target, pool, need, similar) {
            const used = {};
            used[String(target.en || '').toLowerCase()] = 1;
            const cands = (pool || []).filter(w => w && w.en && !used[String(w.en).toLowerCase()]);
            const out = [];
            const take = list => {
                for (let i = 0; i < list.length; i++) {
                    const w = list[i];
                    const key = String(w.en).toLowerCase();
                    if (used[key]) continue;
                    used[key] = 1;
                    out.push({ en: key, zh: w.zh || '', topic: w.topic || '', ok: false });
                    if (out.length >= need) return true;
                }
                return false;
            };
            if (similar) {
                const scored = cands.map(w => ({ w, s: WJ.distractorScore(w, target) }));
                scored.sort((a, b) => b.s - a.s);
                const sameTopic = scored.filter(x => x.s >= 100).map(x => x.w);
                const close = scored.filter(x => x.s > 0 && x.s < 100).map(x => x.w);
                if (take(sameTopic)) return out;
                if (take(close)) return out;
            }
            const rest = cands.filter(w => !used[String(w.en).toLowerCase()]);
            for (let i = rest.length - 1; i > 0; i--) {
                const j = Math.floor(WJ.nextRand() * (i + 1));
                const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
            }
            take(rest);
            return out;
        };

        /* The question is always the nearest unanswered word row at or above
           the player, so the HUD never shows a word that is still far away. */
        WJ.activeRow = function () {
            const p = WJ.player;
            let best = null;
            for (const r of WJ.quizRows) {
                if (r.resolved) continue;
                if (r.y > p.y + 150) continue;
                if (!best || r.y > best.y) best = r;
            }
            return best;
        };

        WJ.spawnQuizRow = function (y) {
            const d = WJ.difficultyAt(y);
            const h = WJ.heatAt(y);
            const count = h >= 0.5 ? 4 : (d < 0.3 ? 2 : 3);
            const pool = WJ.wordPool();
            if (!pool.length) return;

            const target = WJ.pick(pool);
            const similar = WJ.heat3At(y) >= 1;
            const options = [{ en: target.en, zh: target.zh || '', topic: target.topic || '', ok: true }]
                .concat(WJ.pickDistractors(target, pool, count - 1, similar));
            for (let i = options.length - 1; i > 0; i--) {
                const j = Math.floor(WJ.nextRand() * (i + 1));
                const t = options[i]; options[i] = options[j]; options[j] = t;
            }

            const pad = 4, gap = 8;
            const w = Math.min(170, (WJ.W - pad * 2 - gap * (count - 1)) / count);
            const totalW = w * count + gap * (count - 1);
            let x = (WJ.W - totalW) / 2;

            const row = { y, en: target.en.toUpperCase(), zh: target.zh || '', resolved: false, ok: null, picked: null };
            const tiles = [];
            options.forEach(o => {
                const pl = {
                    x, y, w, h: 28, type: 'quiz',
                    baseX: x, baseY: y, phase: 0, amp: 0, speed: 0,
                    dead: false, fuse: 0, gadget: null,
                    word: o.en.toUpperCase(), correct: !!o.ok, row
                };
                WJ.platforms.push(pl);
                tiles.push(pl);
                x += w + gap;
            });
            WJ.quizRows.push(row);
            WJ.cullMonstersNearQuiz(y);
            // A right answer and a wrong answer bounce off different tiles,
            // so the pads above the row have to be reachable from every tile.
            WJ.commitLayer(tiles, true);
        };

        WJ.answerRow = function (row, pl) {
            row.resolved = true;
            row.ok = !!pl.correct;
            row.picked = pl;
            if (pl.correct) {
                WJ.wordsDone++;
                WJ.streak++;
                if (WJ.streak > WJ.bestStreak) WJ.bestStreak = WJ.streak;
                const gain = 60 + row.en.length * 5 + Math.min(90, WJ.streak * 10);
                WJ.bonus += gain;
                // Landing on the right word launches him upward, which is the
                // main way to gain height (and therefore score) now.
                WJ.boostPending = true;
                const lift = Math.round(WJ.WORD_BOOST * WJ.WORD_BOOST / (2 * WJ.GRAVITY));
                WJ.burst(pl.x + pl.w / 2, row.y - 8, '#22c55e', 24);
                WJ.beep(880, 0.09, 'triangle', 0.05);
                WJ.beep(1180, 0.12, 'triangle', 0.04);
                WJ.toast('✅ ' + row.en + '  +' + gain + '  ·  ⬆ ' + lift + 'px', '#15803d');
                if (window.speechSynthesis) {
                    try {
                        const u = new SpeechSynthesisUtterance(row.en.toLowerCase());
                        u.lang = 'en-US';
                        u.rate = 0.9;
                        window.speechSynthesis.speak(u);
                    } catch (e) { /* speech is optional */ }
                }
                if (WJ.streak > 0 && WJ.streak % 5 === 0) {
                    WJ.player.shield = Math.max(WJ.player.shield, 8);
                    WJ.toast('🔥 ' + WJ.streak + ' in a row — shield!', '#0ea5e9');
                }
            } else {
                WJ.streak = 0;
                WJ.beep(170, 0.18, 'sawtooth', 0.05);
                WJ.toast('❌ ' + row.zh + ' = ' + row.en, '#dc2626');
            }
        };

        WJ.populateTopics = function () {
            const sel = document.getElementById('wj-topic');
            if (!sel) return;
            const names = SHEET_NAMES.filter(n => (categories[n] || []).length);
            const cur = sel.value;
            sel.innerHTML = '<option value="__all__">🎲 All topics</option>' +
                names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(topicLabel(n))}</option>`).join('');
            if (cur && sel.options && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
        };

        WJ.setTopicDefault = function () {
            const sel = document.getElementById('wj-topic');
            if (!sel) return;
            if (!WJ.topic) {
                WJ.topic = (currentTopic && (categories[currentTopic] || []).length) ? currentTopic : '__all__';
            }
            if (sel.options && Array.from(sel.options).some(o => o.value === WJ.topic)) sel.value = WJ.topic;
        };

        WJ.changeTopic = function (v) {
            if (WJ.challenge) return;
            WJ.topic = v || '__all__';
            // Skip the question he is already climbing towards; the next row
            // that spawns will come from the new topic.
            WJ.quizRows.forEach(r => { if (!r.resolved) r.resolved = true; });
        };

        /* ---------------- world generation ---------------- */

        /* A jump only spends its full airtime if the next pad is all the way
           back at the height you left. A pad 250px up is met on the way down
           much sooner, so the sideways distance is shorter than speed * 1.45s.
           REACH_FACTOR keeps a margin for reversing leftover speed and for the
           fixed 1/120 step. */
        WJ.REACH_FACTOR = 0.8;
        WJ.FOOT = 34 * 0.4;

        WJ.jumpHeight = function () {
            return (WJ.JUMP_V * WJ.JUMP_V) / (2 * WJ.GRAVITY);
        };
        /* Stay this far under the apex so the landing is a real crossing,
           not a brush against the top of the jump. */
        WJ.maxGap = function () {
            return WJ.jumpHeight() - 36;
        };
        WJ.speedAt = function (climb) {
            const t = WJ.clamp(climb / WJ.SPEED_RAMP_AT, 0, 1);
            const base = WJ.MOVE_MAX * (WJ.SPEED_RAMP_FROM + (1 - WJ.SPEED_RAMP_FROM) * t);
            return base * WJ.speedMulAt(climb);
        };
        WJ.airtimeForGap = function (gap) {
            const v = Math.abs(WJ.JUMP_V), g = WJ.GRAVITY;
            const disc = v * v - 2 * g * gap;
            if (disc <= 1) return 0;
            return (v + Math.sqrt(disc)) / g;
        };
        /* Distance covered while holding one direction from a standstill. */
        WJ.steerDistance = function (t, speed) {
            if (!(t > 0) || !(speed > 0)) return 0;
            const r = WJ.STEER_RATE;
            return speed * (t - (1 - Math.exp(-r * t)) / r);
        };
        WJ.horizBudget = function (gap, climb) {
            if (!(gap >= 0) || gap >= WJ.jumpHeight() - 1) return 0;
            return WJ.steerDistance(WJ.airtimeForGap(gap), WJ.speedAt(Math.max(0, climb))) * WJ.REACH_FACTOR;
        };
        WJ.circDist = function (a, b) {
            const w = WJ.W;
            let d = Math.abs(a - b) % w;
            return d > w / 2 ? w - d : d;
        };
        /* How far (circular) the new pad's centre may sit from this anchor
           and still be landable from the anchor's far edge. */
        WJ.centerSep = function (anchor, w, budget, destAmpX) {
            return budget - anchor.w / 2 + w / 2 - (anchor.ampX || 0) - (destAmpX || 0);
        };

        WJ.syncAnchors = function (list) {
            WJ.anchors = (list || []).map(p => ({
                x: p.baseX != null ? p.baseX : p.x,
                y: p.baseY != null ? p.baseY : p.y,
                w: p.w,
                ampX: p.type === 'blue' ? (p.amp || 0) : 0,
                ampY: p.type === 'gray' ? (p.amp || 0) : 0
            }));
        };
        /* durable: this layer still bounces after you leave it (green / blue /
           grey / word tile). White and yellow bounce once and are not durable,
           so a later pad must also stay reachable from the last solid layer. */
        WJ.commitLayer = function (list, durable) {
            WJ.syncAnchors(list);
            if (durable) WJ.durable = WJ.anchors.map(a => ({ x: a.x, y: a.y, w: a.w, ampX: a.ampX, ampY: a.ampY }));
        };
        WJ.goalAnchors = function (y) {
            const out = [];
            const push = a => {
                for (let i = 0; i < out.length; i++) {
                    if (Math.abs(out[i].x - a.x) < 1 && Math.abs(out[i].y - a.y) < 1 && Math.abs(out[i].w - a.w) < 1) return;
                }
                out.push(a);
            };
            (WJ.anchors || []).forEach(push);
            (WJ.durable || []).forEach(a => {
                const rise = a.y + (a.ampY || 0) - y;
                if (rise > 8 && rise <= WJ.maxGap() + 1) push(a);
            });
            return out.length ? out : [{ x: WJ.W / 2 - 46, y: 0, w: 92, ampX: 0, ampY: 0 }];
        };

        WJ.pickType = function (y) {
            const d = WJ.difficultyAt(y);
            const h = WJ.heatAt(y);
            const table = [
                ['green', 58 - 14 * d - 12 * h],
                ['blue', 14],
                ['gray', 12],
                ['brown', 9 + 5 * d + 6 * h],
                ['yellow', 8 + 4 * d + 5 * h],
                ['white', 6 + 3 * d + 4 * h]
            ];
            let total = 0;
            table.forEach(t => { total += t[1]; });
            let r = WJ.nextRand() * total, type = 'green';
            for (let i = 0; i < table.length; i++) {
                r -= table[i][1];
                if (r <= 0) { type = table[i][0]; break; }
            }
            return type;
        };

        /* Centres from which a pad of width w at this y is reachable from
           every anchor, including the sideways sway of a blue pad (destAmpX)
           and the upward bob of a grey pad (destAmpY). */
        WJ.centersFor = function (goals, w, y, destAmpX, destAmpY) {
            const minC = 8 + w / 2, maxC = WJ.W - 8 - w / 2;
            if (!(maxC >= minC)) return [];
            const rules = goals.map(a => {
                const rise = a.y + (a.ampY || 0) - y + (destAmpY || 0);
                const budget = WJ.horizBudget(rise, Math.max(0, -(a.y + (a.ampY || 0))));
                return { a, budget };
            });
            const slots = [];
            for (let c = minC; c <= maxC + 0.01; c += 2) {
                let ok = true;
                for (let i = 0; i < rules.length; i++) {
                    const a = rules[i].a;
                    const sep = WJ.centerSep(a, w, rules[i].budget, destAmpX || 0);
                    if (WJ.circDist(a.x + a.w / 2, c) > sep + 0.01) { ok = false; break; }
                }
                if (ok) slots.push(c);
            }
            return slots;
        };
        /* Prefer a pad you can reach without wrapping. A wrap-around pad is
           only used when every straight slot is blocked. */
        WJ.chooseSlot = function (slots, goals) {
            const straight = [];
            for (let i = 0; i < slots.length; i++) {
                const c = slots[i];
                let wrap = false;
                for (let j = 0; j < goals.length; j++) {
                    const ac = goals[j].x + goals[j].w / 2;
                    if (Math.abs(ac - c) > WJ.circDist(ac, c) + 0.75) { wrap = true; break; }
                }
                if (!wrap) straight.push(c);
            }
            const pool = straight.length ? straight : slots;
            return pool[Math.floor(WJ.nextRand() * pool.length)];
        };

        /* After 7000 (lateHeat >= 0.5) shields only come from a 5-word streak,
           so shield gadgets stop appearing. Before 7000 the old mix stays. */
        WJ.gadgetKindsAt = function (y) {
            const kinds = ['spring', 'spring', 'propeller', 'jetpack', 'shoes'];
            if (WJ.heatAt(y) < 0.5) kinds.push('shield');
            return kinds;
        };
        WJ.nearQuizRow = function (y) {
            const clear = 90;
            for (const r of WJ.quizRows || []) {
                if (Math.abs(r.y - y) < clear) return true;
            }
            if (WJ.nextQuizY != null && Math.abs(WJ.nextQuizY - y) < clear) return true;
            return false;
        };
        WJ.cullMonstersNearQuiz = function (quizY) {
            const clear = 90;
            WJ.monsters = (WJ.monsters || []).filter(m =>
                Math.abs(m.y - quizY) >= clear && Math.abs((m.y + 36) - quizY) >= clear);
        };
        WJ.placeMonster = function (x, y, range) {
            WJ.monsters.push({
                x, y: y - 36, baseX: x,
                range: range != null ? range : WJ.rand(24, 50),
                dir: WJ.nextRand() < 0.5 ? -1 : 1,
                speed: WJ.rand(20, 40) * (1 + 0.3 * WJ.heatAt(y)),
                r: 19, dead: false
            });
        };
        /* After 10000, occasionally place two monsters at the same altitude,
           far enough apart that the player can still pass between them.
           Never on a quiz-tile row, and never when the gap would close. */
        WJ.trySpawnMonsters = function (pl, y) {
            if (y >= -1500) return 0;
            if (WJ.nearQuizRow(y) || WJ.nearQuizRow(y - 36)) return 0;
            const d = WJ.difficultyAt(y);
            const h = WJ.heatAt(y);
            if (!(WJ.nextRand() < 0.05 + 0.07 * d + 0.06 * h)) return 0;
            const h3 = WJ.heat3At(y);
            const body = 19, pass = 70, range = 26;
            const minSep = pass + 2 * range + 2 * body;
            if (h3 && WJ.nextRand() < WJ.HEAT3_TWIN_CHANCE) {
                const left = 50 + body, right = WJ.W - 50 - body;
                if (right - left >= minSep) {
                    const span = right - left - minSep;
                    const x1 = left + WJ.nextRand() * Math.max(0, span * 0.35);
                    const x2 = x1 + minSep + WJ.nextRand() * Math.max(0, right - (x1 + minSep));
                    WJ.placeMonster(x1, y, range);
                    WJ.placeMonster(x2, y, range);
                    return 2;
                }
            }
            WJ.placeMonster(pl.x + pl.w / 2, y, WJ.rand(24, 50));
            return 1;
        };

        WJ.makePlatform = function (x, y, w, type, amp) {
            const d = WJ.difficultyAt(y);
            const h = WJ.heatAt(y);
            const pl = {
                x, y, w, h: 13, type,
                baseX: x, baseY: y,
                phase: WJ.nextRand() * Math.PI * 2,
                amp: amp || 0,
                speed: WJ.rand(0.5, 1.1) * (1 + 0.35 * h),
                dead: false, fuse: 0, gadget: null
            };
            WJ.platforms.push(pl);
            if (type !== 'brown' && type !== 'white' && y < -700 && WJ.nextRand() < 0.09) {
                pl.gadget = {
                    kind: WJ.pick(WJ.gadgetKindsAt(y)),
                    used: false
                };
            }
            WJ.trySpawnMonsters(pl, y);
            if (y < -2400 && WJ.nextRand() < 0.022 + 0.018 * h) {
                const ux = WJ.rand(60, WJ.W - 60);
                WJ.ufos.push({
                    x: ux, y: y - WJ.rand(60, 110), baseX: ux,
                    range: WJ.rand(28, 55), dir: WJ.nextRand() < 0.5 ? -1 : 1,
                    speed: WJ.rand(16, 28), bobRate: 2,
                    r: 26, dead: false, beam: false, bob: WJ.nextRand() * 6.28
                });
            }
            if (y < -3000 && d > 0.25 && WJ.nextRand() < 0.02 + 0.02 * h) {
                WJ.holes.push({
                    x: WJ.rand(70, WJ.W - 70), y: y - WJ.rand(80, 160),
                    r: 28, dead: false
                });
            }
            return pl;
        };

        WJ.genUpTo = function (targetY) {
            let guard = 0;
            while (WJ.topY > targetY && guard++ < 300) {
                // The tall gap above a word row is what stops a jump from the
                // pad underneath sailing over the question. Step sizes below
                // are the existing density tuning.
                const opening = WJ.openingAt(WJ.topY) && !WJ.afterQuiz;
                const base = WJ.afterQuiz ? WJ.rand(240, 275)
                          : opening ? WJ.rand(68, 90)
                          : WJ.rand(76, 102);
                // lateHeat may widen ordinary gaps; the tall after-quiz gap
                // stays on the original curve so questions cannot be skipped
                // and remain reachable (always ≤ maxGap).
                const heat = WJ.afterQuiz ? 0 : WJ.heatAt(WJ.topY);
                const step = Math.min(WJ.maxGap(), base * (1 - WJ.difficultyAt(WJ.topY) * 0.1 + 0.12 * heat));
                const nextY = WJ.topY - step;
                if (nextY <= WJ.nextQuizY) {
                    // 115px under the row: high enough that the row is a
                    // comfortable hop, low enough that the tall gap above the
                    // row stays out of reach until you have bounced on a tile.
                    const quizY = Math.min(WJ.nextQuizY, WJ.topY - 115);
                    WJ.safePadUnder(WJ.topY);
                    WJ.spawnQuizRow(quizY);
                    WJ.topY = quizY;
                    WJ.nextQuizY = quizY - WJ.rand(WJ.QUIZ_GAP_MIN, WJ.QUIZ_GAP_MAX);
                    WJ.afterQuiz = true;
                } else {
                    const placedY = WJ.spawnPlatform(nextY);
                    if (!(placedY < WJ.topY - 1)) break;
                    WJ.topY = placedY;
                    WJ.afterQuiz = false;
                }
            }
        };

        /* The platform a word row sits on has to be a dependable launch pad.
           A brown one breaks (no bounce) and a white one vanishes after one
           hop, which is exactly what "I cannot jump up to the tile" felt like. */
        WJ.safePadUnder = function (y) {
            const pl = WJ.platforms[WJ.platforms.length - 1];
            if (!pl || pl.type === 'quiz') return;
            if (Math.abs(pl.y - y) > 0.5) return;
            pl.type = 'green';
            pl.amp = 0; pl.speed = 0;
            pl.phase = 0;
            pl.x = pl.baseX = WJ.clamp(pl.x, 8, WJ.W - pl.w - 8);
            pl.y = pl.baseY = y;
        };

        WJ.spawnPlatform = function (y) {
            if (!WJ.anchors || !WJ.anchors.length) {
                WJ.commitLayer([{ x: WJ.W / 2 - 46, y: 0, w: 92, h: 13, type: 'green', baseX: WJ.W / 2 - 46, baseY: 0, amp: 0 }], true);
            }
            const opening = WJ.openingAt(y);
            const shrink = opening ? 0 : 10 * WJ.heatAt(y);
            const w0 = opening ? WJ.rand(74, 104) : WJ.rand(Math.max(50, 62 - shrink), Math.max(54, 90 - shrink));
            let goals = WJ.goalAnchors(y);
            let lowY = -1e9, gap = 0;
            goals.forEach(a => {
                const foot = a.y + (a.ampY || 0);
                if (foot > lowY) lowY = foot;
                gap = Math.max(gap, foot - y);
            });
            if (gap > WJ.maxGap()) {
                const pulled = lowY - WJ.maxGap();
                if (pulled < WJ.topY - 36) {
                    y = pulled;
                    gap = WJ.maxGap();
                    goals = WJ.goalAnchors(y);
                }
            }
            let type = WJ.pickType(y);
            // A long rise (the band above a word row, or a jump that skips a
            // broken pad) is a still green. Moving or breaking pads on a short
            // airtime are what opened the unreachable holes.
            const solidKind = t => t === 'green' || t === 'blue' || t === 'gray';
            if (gap + 110 > WJ.maxGap() && !solidKind(type)) type = 'green';
            if (gap > 160) type = 'green';

            const attempts = [];
            if (type === 'blue') {
                attempts.push({ type: 'blue', ampX: 46, ampY: 0 });
                attempts.push({ type: 'blue', ampX: 26, ampY: 0 });
                attempts.push({ type: 'green', ampX: 0, ampY: 0 });
            } else if (type === 'gray') {
                const room = Math.max(0, WJ.maxGap() - gap);
                const ampY = Math.min(WJ.rand(20, 40), room);
                if (ampY >= 12) attempts.push({ type: 'gray', ampX: 0, ampY });
                attempts.push({ type: 'green', ampX: 0, ampY: 0 });
            } else {
                attempts.push({ type: type, ampX: 0, ampY: 0 });
            }

            let placed = null;
            for (let i = 0; i < attempts.length && !placed; i++) {
                const att = attempts[i];
                const slots = WJ.centersFor(goals, w0, y, att.ampX, att.ampY);
                if (!slots.length) continue;
                const c = WJ.chooseSlot(slots, goals);
                const amp = att.type === 'gray' ? att.ampY : att.ampX;
                placed = [WJ.makePlatform(c - w0 / 2, y, w0, att.type, amp)];
            }
            if (!placed) {
                // One pad cannot cover every tile (or every solid pad) the
                // player might be standing on. Put a still green over each.
                placed = [];
                let mid = 0;
                goals.forEach(a => { mid += a.x + a.w / 2; });
                mid /= goals.length;
                const seen = {};
                goals.forEach(a => {
                    const rise = Math.max(8, a.y + (a.ampY || 0) - y);
                    const budget = WJ.horizBudget(rise, Math.max(0, -(a.y + (a.ampY || 0))));
                    let bw = Math.max(w0, a.w - 2 * budget + 2 * (a.ampX || 0) + 8);
                    bw = Math.min(WJ.W - 16, bw);
                    let sep = WJ.centerSep(a, bw, budget, 0);
                    if (!(sep > 0)) sep = 0;
                    const ac = a.x + a.w / 2;
                    const pull = mid - ac;
                    const mag = Math.min(Math.abs(pull), sep);
                    let c = ac + (pull < 0 ? -1 : 1) * mag;
                    c = WJ.clamp(c, 8 + bw / 2, WJ.W - 8 - bw / 2);
                    const key = Math.round(c) + ':' + Math.round(bw);
                    if (seen[key]) return;
                    seen[key] = 1;
                    placed.push(WJ.makePlatform(c - bw / 2, y, bw, 'green', 0));
                });
            }
            const launch = placed.filter(pl => pl.type !== 'brown');
            if (launch.length) {
                const durable = launch.every(pl => pl.type === 'green' || pl.type === 'blue' || pl.type === 'gray');
                WJ.commitLayer(launch, durable);
            }
            return y;
        };

        /* ---------------- gameplay ---------------- */

        WJ.land = function (pl) {
            const p = WJ.player;
            p.y = pl.y;
            p.vx *= 0.98;
            // A landing ends any slower-hang (word-boost) launch still in the air.
            p.boostHang = false;
            if (pl.type === 'brown') {
                pl.dead = true;
                WJ.burst(pl.x + pl.w / 2, pl.y, '#a16207', 14);
                WJ.beep(180, 0.1, 'sawtooth', 0.04);
                return;
            }
            if (pl.type === 'white') pl.dead = true;
            if (pl.type === 'yellow' && !pl.fuse) pl.fuse = 1.1;
            if (pl.row && !pl.row.resolved) WJ.answerRow(pl.row, pl);

            let v = WJ.JUMP_V;
            if (p.shoes > 0) { p.shoes--; v = WJ.JUMP_V * 1.42; }
            if (pl.gadget && !pl.gadget.used) {
                pl.gadget.used = true;
                v = WJ.applyGadget(pl.gadget.kind, v);
            }
            p.vy = v;
            // A correct word match replaces the normal bounce with a launch
            // that is 465px high but hangs ×1.35 longer, so the next prompt is
            // easier to read in time. The reduced gravity in WJ.update only
            // applies while p.boostHang is set (cleared on the next landing).
            if (WJ.boostPending) {
                WJ.boostPending = false;
                p.boostHang = true;
                p.vy = WJ.BOOST_VY;
                WJ.beep(660, 0.08, 'square', 0.04);
            }
            if (WJ.challenge) WJC.pushPose(true);
            WJ.beep(520, 0.05, 'sine', 0.03);
        };

        WJ.applyGadget = function (kind, v) {
            const p = WJ.player;
            if (kind === 'spring') { WJ.beep(700, 0.1, 'sine', 0.05); return WJ.JUMP_V * 1.9; }
            if (kind === 'propeller') { p.prop = 2.6; WJ.beep(440, 0.18, 'triangle', 0.05); return WJ.JUMP_V * 0.7; }
            if (kind === 'jetpack') { p.jet = 1.5; WJ.beep(300, 0.25, 'sawtooth', 0.05); return WJ.JUMP_V; }
            if (kind === 'shoes') { p.shoes = 6; WJ.beep(600, 0.1, 'square', 0.04); return v; }
            if (kind === 'shield') { p.shield = 8; WJ.beep(880, 0.14, 'triangle', 0.05); return v; }
            return v;
        };

        WJ.shoot = function () {
            if (WJ.state !== 'playing' || WJ.paused) return;
            const now = performance.now();
            if (now - WJ.lastShot < 170) return;
            WJ.lastShot = now;
            const p = WJ.player;
            WJ.shots.push({
                x: p.x + p.face * 14, y: p.y - p.h * 0.7,
                vx: p.vx * 0.12, vy: -960, life: 1.5, dead: false
            });
            WJ.beep(760, 0.05, 'square', 0.025);
        };

        WJ.burst = function (x, y, color, n) {
            for (let i = 0; i < n; i++) {
                WJ.particles.push({
                    x, y,
                    vx: WJ.rand(-190, 190), vy: WJ.rand(-240, 90),
                    life: WJ.rand(0.3, 0.75), max: 0.75,
                    color, r: WJ.rand(1.6, 4)
                });
            }
        };

        WJ.toast = function (text, color) {
            WJ.toasts.push({ text, color, life: 1.6 });
        };

        /* Other students' personal-best heights, drawn as altitude lines.
           There is no friend list, so every other saved best is eligible. */
        WJ.markerName = function (row) {
            const words = s => (String(s || '').match(/[A-Za-z]+(?:['’.-][A-Za-z]+)*/g) || []).filter(w => w.length >= 2);
            const pretty = s => s.split(' ').map(w => {
                if (!w) return w;
                if (w !== w.toLowerCase() && w !== w.toUpperCase()) return w;
                return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
            }).join(' ');
            const fromNick = pretty(words(row.nickname).join(' '));
            if (fromNick.length >= 2) return fromNick;
            const fromMail = pretty(words(String(row.email || '').split('@')[0].replace(/[._+-]+/g, ' ')).join(' '));
            return fromMail || 'Classmate';
        };

        WJ.loadMilestones = async function () {
            if (isGuestUser() || typeof sb === 'undefined' || !sb) { WJ.milestones = []; return; }
            const req = (WJ.milestoneReq = (WJ.milestoneReq || 0) + 1);
            try {
                const { data, error } = await sb.from('wj_leaderboard')
                    .select('user_id,nickname,email,score,height')
                    .order('height', { ascending: false })
                    .limit(60);
                if (req !== WJ.milestoneReq || error || !data) return;
                const me = currentUser ? currentUser.id : null;
                const alt = WJ.player ? -WJ.player.y : 0;
                const seen = {};
                const list = [];
                data.forEach(r => {
                    if (!r || (me && r.user_id === me)) return;
                    if (r.user_id && seen[r.user_id]) return;
                    if (r.user_id) seen[r.user_id] = 1;
                    let h = Number(r.height) || 0;
                    if (h < 40) h = (Number(r.score) || 0) * 10;
                    if (h < 120) return;
                    list.push({
                        user_id: r.user_id || null,
                        name: WJ.markerName(r),
                        height: h,
                        passed: alt >= h
                    });
                });
                list.sort((a, b) => a.height - b.height);
                WJ.milestones = list;
            } catch (e) { /* markers are optional */ }
        };

        WJ.checkMilestones = function () {
            const marks = WJ.milestones;
            if (!marks || !marks.length || !WJ.player) return;
            const alt = -WJ.player.y;
            let crossed = false;
            for (let i = 0; i < marks.length; i++) {
                const m = marks[i];
                if (m.passed) continue;
                if (alt < m.height) break;
                m.passed = true;
                crossed = true;
            }
            if (!crossed) return;
            const now = performance.now();
            if (WJ.lastPassFx != null && now - WJ.lastPassFx < 800) return;
            WJ.lastPassFx = now;
            WJ.passFlash = 1;
            const p = WJ.player;
            WJ.burst(p.x, p.y - p.h * 0.55, '#fbbf24', 16);
            WJ.burst(p.x, p.y - p.h * 0.15, '#34d399', 10);
            const cheers = WJ.CHEERS;
            const text = cheers[WJ.cheerIndex % cheers.length];
            WJ.cheerIndex = (WJ.cheerIndex + 1) % cheers.length;
            const colors = { 'wow!': '#d97706', 'superb!': '#047857', 'bravo!': '#4338ca' };
            WJ.passLabels.push({
                x: WJ.clamp(p.x, 78, WJ.W - 78),
                y: p.y - p.h - 10,
                text,
                color: colors[text] || '#047857',
                life: 1.25,
                max: 1.25
            });
        };

        WJ.drawMilestoneLines = function (ctx) {
            const marks = WJ.milestones;
            if (!marks || !marks.length) return;
            ctx.save();
            for (let i = 0; i < marks.length; i++) {
                const m = marks[i];
                const y = -m.height - WJ.camY;
                if (y < -8 || y > WJ.H + 8) continue;
                ctx.setLineDash([6, 5]);
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = m.passed ? 'rgba(16,185,129,0.5)' : 'rgba(79,70,229,0.38)';
                ctx.beginPath();
                ctx.moveTo(8, y + 0.5);
                ctx.lineTo(WJ.W - 8, y + 0.5);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.lineWidth = 3;
                ctx.strokeStyle = m.passed ? 'rgba(5,150,105,0.85)' : 'rgba(67,56,202,0.8)';
                ctx.beginPath();
                ctx.moveTo(8, y - 7);
                ctx.lineTo(8, y + 7);
                ctx.moveTo(WJ.W - 8, y - 7);
                ctx.lineTo(WJ.W - 8, y + 7);
                ctx.stroke();
            }
            ctx.restore();
        };

        WJ.rectsOverlap = function (a, b) {
            return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        };

        /* Quiz-word tiles currently on screen. Name tags must not cover these. */
        WJ.vocabScreenRects = function () {
            const rects = [];
            for (const pl of WJ.platforms) {
                if (pl.type !== 'quiz' || pl.dead) continue;
                const y = pl.y - WJ.camY;
                if (y < -40 || y > WJ.H + 40) continue;
                rects.push({ x: pl.x - 4, y: y - 4, w: pl.w + 8, h: pl.h + 8 });
            }
            return rects;
        };

        /* Nudge a name tag up or down in small steps until it clears obstacles.
           Returns null if it cannot be placed in the safe band without overlap. */
        WJ.placeLabelY = function (preferredY, boxW, obstacles, minY, maxY) {
            const h = 18;
            const fits = y => {
                if (y < minY || y > maxY) return false;
                const box = { x: 16, y: y - 9, w: boxW, h };
                for (let i = 0; i < obstacles.length; i++) {
                    if (WJ.rectsOverlap(box, obstacles[i])) return false;
                }
                return true;
            };
            if (fits(preferredY)) return preferredY;
            const step = 4, maxNudge = 72;
            for (let d = step; d <= maxNudge; d += step) {
                if (fits(preferredY - d)) return preferredY - d;
                if (fits(preferredY + d)) return preferredY + d;
            }
            return null;
        };

        WJ.drawMilestoneLabels = function (ctx) {
            const marks = WJ.milestones;
            if (!marks || !marks.length) return;
            ctx.save();
            ctx.font = 'bold 11px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const visible = [];
            for (let i = 0; i < marks.length; i++) {
                const m = marks[i];
                const y = -m.height - WJ.camY;
                if (y > -20 && y < WJ.H + 20) visible.push(m);
            }
            visible.sort((a, b) => b.height - a.height);
            const obstacles = WJ.vocabScreenRects();
            const minY = 78, maxY = WJ.H - 108;
            for (let i = 0; i < visible.length; i++) {
                const m = visible[i];
                const preferred = -m.height - WJ.camY;
                const name = m.name.length > 18 ? m.name.slice(0, 17) + '…' : m.name;
                const tw = Math.min(ctx.measureText(name).width + 14, 138);
                const y = WJ.placeLabelY(preferred, tw, obstacles, minY, maxY);
                if (y == null) continue;
                obstacles.push({ x: 16, y: y - 11, w: tw, h: 22 });
                ctx.fillStyle = m.passed ? 'rgba(236,253,245,0.94)' : 'rgba(255,255,255,0.92)';
                ctx.strokeStyle = m.passed ? 'rgba(16,185,129,0.75)' : 'rgba(99,102,241,0.55)';
                ctx.lineWidth = 1.5;
                WJ.roundRect(ctx, 16, y - 9, tw, 18, 8);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = m.passed ? '#047857' : '#4338ca';
                ctx.fillText(name, 23, y + 0.5, tw - 12);
            }
            ctx.restore();
        };

        WJ.drawPassLabels = function (ctx) {
            if (!WJ.passLabels || !WJ.passLabels.length) return;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 22px Fredoka, system-ui, sans-serif';
            ctx.lineWidth = 4;
            for (let i = 0; i < WJ.passLabels.length; i++) {
                const lb = WJ.passLabels[i];
                const y = lb.y - WJ.camY;
                ctx.globalAlpha = Math.max(0, Math.min(1, lb.life / 0.4));
                ctx.strokeStyle = 'rgba(255,255,255,0.94)';
                ctx.strokeText(lb.text, lb.x, y);
                ctx.fillStyle = lb.color || '#047857';
                ctx.fillText(lb.text, lb.x, y);
            }
            ctx.restore();
        };

        WJ.hurt = function (reason) {
            const p = WJ.player;
            if (p.rainbow > 0) return false;
            if (p.shield > 0) {
                p.shield = 0;
                WJ.toast('🛡️ Shield saved you!', '#0ea5e9');
                WJ.beep(320, 0.2, 'triangle', 0.05);
                return true;
            }
            WJ.gameOver(reason);
            return false;
        };

        /* ---------------- update ---------------- */

        WJ.update = function (dt) {
            const p = WJ.player;

            // --- horizontal input ---
            let dir = 0;
            if (WJ.keys.left || WJ.holdDir === -1) dir -= 1;
            if (WJ.keys.right || WJ.holdDir === 1) dir += 1;
            if (WJ.tiltOn) {
                WJ.tiltSmooth += (WJ.tiltValue - WJ.tiltSmooth) * Math.min(1, dt * 26);
                // Soft curve: a small tilt creeps, a firm tilt runs. Without it
                // 4 degrees was already 60% of full speed, which felt frantic.
                if (Math.abs(WJ.tiltSmooth) > WJ.TILT_DEAD) {
                    const t = WJ.clamp(WJ.tiltSmooth, -1, 1);
                    dir = Math.sign(t) * Math.pow(Math.abs(t), WJ.TILT_CURVE);
                }
            } else {
                WJ.tiltSmooth = 0;
            }
            // Proportional steering: the speed follows the input, so half a
            // tilt is half speed and a full tilt (or a held pad) is top speed.
            // Eases in over ~0.19s and glides about 6–13px after letting go.
            if (Math.abs(dir) < 0.04) dir = 0;
            const cap = WJ.speedCap();
            const target = dir * cap;
            if (Math.abs(dir) > 0.25) p.face = dir < 0 ? -1 : 1;
            const rate = Math.abs(target) >= Math.abs(p.vx) ? WJ.STEER_RATE : WJ.STEER_STOP;
            p.vx += (target - p.vx) * Math.min(1, dt * rate);
            // Only snap to a full stop when there is no input asking for a
            // slow creep, otherwise a gentle tilt could never start moving.
            if (Math.abs(p.vx) < 1.5 && target === 0) p.vx = 0;

            ['prop', 'jet', 'shield', 'rainbow'].forEach(k => {
                if (p[k] > 0) p[k] = Math.max(0, p[k] - dt);
            });

            // --- vertical ---
            if (p.jet > 0) p.vy = WJ.JET_V;
            else if (p.prop > 0) p.vy = WJ.PROP_V;
            else {
                // A word-boost launch (p.boostHang) falls under reduced gravity
                // so its 465px flight takes ×1.35 longer. Cleared on landing.
                const g = p.boostHang ? WJ.BOOST_G : WJ.GRAVITY;
                p.vy = Math.min(p.vy + g * dt, 1500);
            }

            const prevFeet = p.y;
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            if (p.x < -p.w / 2) p.x = WJ.W + p.w / 2;
            else if (p.x > WJ.W + p.w / 2) p.x = -p.w / 2;

            if (p.y - WJ.camY < WJ.H * 0.42) WJ.camY = p.y - WJ.H * 0.42;
            WJ.maxClimb = Math.max(WJ.maxClimb, -p.y);
            if (!WJ.heatAnnounced && WJ.score() >= WJ.SCORE_HEAT_AT) {
                WJ.heatAnnounced = true;
                WJ.toast('⚡ Challenge up!', '#d97706');
            }
            if (!WJ.heat2Announced && WJ.score() >= WJ.SCORE_HEAT2_AT) {
                WJ.heat2Announced = true;
                WJ.toast('⚡ Extra challenge! Shields now need a 5-word streak.', '#c2410c');
            }
            const heat3Now = WJ.challenge
                ? Math.floor(Math.max(0, WJ.maxClimb) / 10) >= WJ.SCORE_HEAT3_AT
                : WJ.score() >= WJ.SCORE_HEAT3_AT;
            if (!WJ.heat3Announced && heat3Now) {
                WJ.heat3Announced = true;
                WJ.toast('⚡ Speed up! Similar meanings and occasional twin monsters.', '#b45309');
            }
            WJ.checkMilestones();

            WJ.genUpTo(WJ.camY - WJ.H * 0.6);

            // --- platforms ---
            for (const pl of WJ.platforms) {
                if (pl.dead) continue;
                const heat3Mul = WJ.speedMulAt(WJ.challenge ? Math.max(0, -(pl.baseY != null ? pl.baseY : pl.y)) : 0);
                if (pl.type === 'blue') {
                    pl.phase += pl.speed * heat3Mul * dt;
                    pl.x = WJ.clamp(pl.baseX + Math.sin(pl.phase) * pl.amp, 4, WJ.W - pl.w - 4);
                } else if (pl.type === 'gray') {
                    pl.phase += pl.speed * heat3Mul * dt;
                    pl.y = pl.baseY + Math.sin(pl.phase) * pl.amp;
                } else if (pl.type === 'yellow' && pl.fuse > 0) {
                    pl.fuse -= dt;
                    if (pl.fuse <= 0) {
                        pl.dead = true;
                        WJ.burst(pl.x + pl.w / 2, pl.y, '#f59e0b', 16);
                        WJ.beep(160, 0.12, 'sawtooth', 0.05);
                    }
                }
            }

            // --- landing ---
            if (p.vy > 0) {
                // A word row behaves like one long ledge: falling anywhere on
                // it drops you onto the nearest tile. Before this, dropping
                // into the 8px gap between two tiles, or just past the last
                // one, sent the player straight through the row - which read
                // as "I cannot get up onto the word".
                let landedRow = false;
                for (const row of WJ.quizRows) {
                    if (row.resolved) continue;
                    if (!(prevFeet <= row.y + 1 && p.y >= row.y)) continue;
                    let best = null, bd = 1e9;
                    for (const pl of WJ.platforms) {
                        if (pl.dead || pl.row !== row) continue;
                        const dd = Math.abs((pl.x + pl.w / 2) - p.x);
                        if (dd < bd) { bd = dd; best = pl; }
                    }
                    if (!best) continue;
                    p.x = WJ.clamp(p.x, best.x + p.w * 0.3, best.x + best.w - p.w * 0.3);
                    WJ.land(best);
                    landedRow = true;
                    break;
                }
                if (!landedRow) {
                    for (const pl of WJ.platforms) {
                        if (pl.dead) continue;
                        if (prevFeet <= pl.y + 1 && p.y >= pl.y &&
                            p.x + p.w * 0.4 > pl.x && p.x - p.w * 0.4 < pl.x + pl.w) {
                            WJ.land(pl);
                            break;
                        }
                    }
                }
            }

            // --- monsters ---
            for (const m of WJ.monsters) {
                if (m.dead) continue;
                const mMul = WJ.speedMulAt(WJ.challenge ? Math.max(0, -(m.y + 36)) : 0);
                m.x += m.dir * m.speed * mMul * dt;
                if (m.x < m.baseX - m.range) { m.x = m.baseX - m.range; m.dir = 1; }
                if (m.x > m.baseX + m.range) { m.x = m.baseX + m.range; m.dir = -1; }

                const dx = Math.abs(p.x - m.x);
                const dy = Math.abs((p.y - p.h / 2) - m.y);
                if (dx < m.r + p.w * 0.3 && dy < m.r + p.h * 0.35) {
                    if (p.rainbow > 0) {
                        m.dead = true;
                        WJ.bonus += 30;
                        WJ.burst(m.x, m.y, '#a855f7', 14);
                        WJ.beep(900, 0.1, 'triangle', 0.05);
                    } else if (p.vy > 220 && p.y < m.y + 6) {
                        m.dead = true;
                        p.vy = WJ.JUMP_V * 1.05;
                        if (WJ.challenge) WJC.pushPose(true);
                        WJ.bonus += 30;
                        WJ.burst(m.x, m.y, '#c084fc', 16);
                        WJ.beep(700, 0.12, 'square', 0.05);
                    } else if (!WJ.hurt('A monster got you!')) {
                        return;
                    } else {
                        m.dead = true;
                        WJ.burst(m.x, m.y, '#c084fc', 14);
                        p.vy = WJ.JUMP_V * 0.8;
                        if (WJ.challenge) WJC.pushPose(true);
                    }
                }
            }

            // --- UFOs ---
            for (const u of WJ.ufos) {
                if (u.dead) continue;
                const uMul = WJ.speedMulAt(WJ.challenge ? Math.max(0, -u.y) : 0);
                u.bob += dt * (u.bobRate || 2) * uMul;
                if (uMul > 1 && u.range) {
                    if (u.baseX == null) u.baseX = u.x;
                    u.x += (u.dir || 1) * (u.speed || 22) * uMul * dt;
                    if (u.x < u.baseX - u.range) { u.x = u.baseX - u.range; u.dir = 1; }
                    if (u.x > u.baseX + u.range) { u.x = u.baseX + u.range; u.dir = -1; }
                }
                const px = p.x, py = p.y - p.h / 2;
                const dx = u.x - px, dy = u.y - py;
                u.beam = false;
                if (Math.abs(dx) < 90 && dy < 0 && dy > -210) {
                    u.beam = true;
                    const d = Math.hypot(dx, dy) || 1;
                    p.vx += (dx / d) * 900 * dt;
                    p.vy += (dy / d) * 820 * dt;
                    if (d < 30) {
                        if (!WJ.hurt('A UFO tractor beam caught you!')) return;
                        u.dead = true;
                        WJ.burst(u.x, u.y, '#38bdf8', 16);
                    }
                }
            }

            // --- black holes ---
            for (const h of WJ.holes) {
                const px = p.x, py = p.y - p.h / 2;
                const dx = h.x - px, dy = h.y - py;
                const d = Math.hypot(dx, dy) || 1;
                if (d < 160) {
                    const pull = (1 - d / 160) * 1200;
                    p.vx += (dx / d) * pull * dt;
                    p.vy += (dy / d) * pull * 0.55 * dt;
                }
                if (d < h.r + 6) { WJ.gameOver('A black hole swallowed you!'); return; }
            }

            // --- shots ---
            for (const s of WJ.shots) {
                if (s.dead) continue;
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                s.life -= dt;
                if (s.life <= 0) s.dead = true;
                for (const m of WJ.monsters) {
                    if (m.dead) continue;
                    if (Math.hypot(s.x - m.x, s.y - m.y) < m.r + 10) {
                        m.dead = true; s.dead = true;
                        WJ.bonus += 30;
                        WJ.burst(m.x, m.y, '#c084fc', 16);
                        WJ.beep(840, 0.09, 'square', 0.045);
                    }
                }
                for (const u of WJ.ufos) {
                    if (u.dead) continue;
                    if (Math.hypot(s.x - u.x, s.y - u.y) < u.r + 8) {
                        u.dead = true; s.dead = true;
                        WJ.bonus += 40;
                        WJ.burst(u.x, u.y, '#38bdf8', 18);
                        WJ.beep(560, 0.14, 'sawtooth', 0.05);
                    }
                }
            }

            // --- particles & toasts ---
            for (const pt of WJ.particles) {
                pt.life -= dt;
                pt.vy += 620 * dt;
                pt.x += pt.vx * dt;
                pt.y += pt.vy * dt;
            }
            for (const t of WJ.toasts) t.life -= dt;
            if (WJ.passFlash > 0) WJ.passFlash = Math.max(0, WJ.passFlash - dt * 1.8);
            for (const lb of WJ.passLabels) {
                lb.life -= dt;
                lb.y -= 42 * dt;
            }

            // --- cleanup ---
            const cutoff = WJ.camY + WJ.H + 160;
            WJ.platforms = WJ.platforms.filter(pl => !pl.dead && pl.y < cutoff);
            WJ.quizRows = WJ.quizRows.filter(r => r.y < cutoff);
            WJ.monsters = WJ.monsters.filter(m => !m.dead && m.y < cutoff);
            WJ.ufos = WJ.ufos.filter(u => !u.dead && u.y < cutoff);
            WJ.holes = WJ.holes.filter(h => h.y < cutoff);
            WJ.shots = WJ.shots.filter(s => !s.dead);
            WJ.particles = WJ.particles.filter(pt => pt.life > 0);
            WJ.toasts = WJ.toasts.filter(t => t.life > 0);
            WJ.passLabels = WJ.passLabels.filter(lb => lb.life > 0);

            // --- fall out ---
            if (p.y - WJ.camY > WJ.H + 70) WJ.gameOver('You fell too far!');
        };

        /* ---------------- frame loop ---------------- */

        WJ.frame = function (ts) {
            if (!WJ.running) return;
            if (!WJ.lastTs) WJ.lastTs = ts;
            let dt = (ts - WJ.lastTs) / 1000;
            WJ.lastTs = ts;
            if (dt > 0.25) dt = 0.25;
            if (!WJ.paused) {
                WJ.acc += dt;
                const step = 1 / 120;
                let guard = 0;
                while (WJ.acc >= step && guard++ < 8 && WJ.running) {
                    WJ.update(step);
                    WJ.acc -= step;
                }
            }
            WJ.draw();
            if (typeof WJC !== 'undefined' && WJC.active) WJC.tick();
            if (WJ.running) WJ.raf = requestAnimationFrame(WJ.frame);
        };

        /* ---------------- rendering ---------------- */

        WJ.draw = function () {
            const ctx = WJ.ctx;
            if (!ctx || !WJ.canvas) return;
            const sx = WJ.canvas.width / WJ.W;
            const sy = WJ.canvas.height / WJ.H;
            ctx.setTransform(sx, 0, 0, sy, 0, 0);
            ctx.clearRect(0, 0, WJ.W, WJ.H);

            // paper + grid
            ctx.fillStyle = '#fdf9ef';
            ctx.fillRect(0, 0, WJ.W, WJ.H);
            const gs = 26;
            const oy = ((WJ.camY % gs) + gs) % gs;
            ctx.strokeStyle = 'rgba(120,160,215,0.16)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0; x <= WJ.W; x += gs) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, WJ.H); }
            for (let y = -gs + oy; y <= WJ.H + gs; y += gs) { ctx.moveTo(0, y + 0.5); ctx.lineTo(WJ.W, y + 0.5); }
            ctx.stroke();
            WJ.drawMilestoneLines(ctx);

            // platforms
            const colors = {
                green: ['#7ed957', '#4c8c2b'],
                blue: ['#4fa8f5', '#2563b0'],
                gray: ['#9aa5b1', '#5b6672'],
                brown: ['#b07a4f', '#6b4226'],
                yellow: ['#f7c948', '#b07d16'],
                white: ['#ffffff', '#c3cbd6'],
                quiz: ['#818cf8', '#4338ca']
            };
            const activeRow = WJ.activeRow();
            for (const pl of WJ.platforms) {
                const y = pl.y - WJ.camY;
                if (y < -80 || y > WJ.H + 80) continue;
                let col = colors[pl.type] || colors.green;
                if (pl.type === 'quiz' && pl.row && pl.row.resolved) {
                    if (pl.correct) col = ['#34d399', '#047857'];
                    else if (pl.row.picked === pl) col = ['#f87171', '#b91c1c'];
                    else col = ['#e2e8f0', '#94a3b8'];
                }
                ctx.fillStyle = col[0];
                ctx.strokeStyle = col[1];
                ctx.lineWidth = 2.5;
                WJ.roundRect(ctx, pl.x, y, pl.w, pl.h, 6);
                ctx.fill();
                ctx.stroke();

                if (pl.type === 'quiz') {
                    if (pl.row === activeRow && !pl.row.resolved) {
                        ctx.save();
                        ctx.strokeStyle = 'rgba(67,56,202,0.30)';
                        ctx.lineWidth = 7;
                        WJ.roundRect(ctx, pl.x - 2.5, y - 2.5, pl.w + 5, pl.h + 5, 9);
                        ctx.stroke();
                        ctx.restore();
                    }
                    let fs = 15;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    while (fs > 8) {
                        ctx.font = 'bold ' + fs + 'px Fredoka, system-ui, sans-serif';
                        if (ctx.measureText(pl.word).width <= pl.w - 10) break;
                        fs--;
                    }
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(pl.word, pl.x + pl.w / 2, y + pl.h / 2 + 1);
                    continue;
                }

                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                WJ.roundRect(ctx, pl.x + 5, y + 2.5, pl.w - 10, 3, 2);
                ctx.fill();

                if (pl.type === 'brown') {
                    ctx.strokeStyle = col[1];
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(pl.x + pl.w / 2 - 4, y + 1);
                    ctx.lineTo(pl.x + pl.w / 2, y + 6);
                    ctx.lineTo(pl.x + pl.w / 2 + 4, y + 12);
                    ctx.stroke();
                }
                if (pl.type === 'yellow' && pl.fuse > 0 && Math.floor(pl.fuse * 12) % 2 === 0) {
                    ctx.fillStyle = 'rgba(239,68,68,0.6)';
                    WJ.roundRect(ctx, pl.x, y, pl.w, pl.h, 6);
                    ctx.fill();
                }
                if (pl.gadget && !pl.gadget.used) {
                    WJ.drawGadget(ctx, pl.gadget.kind, pl.x + pl.w / 2, y - 14);
                }
            }

            // black holes
            for (const h of WJ.holes) {
                const y = h.y - WJ.camY;
                if (y < -120 || y > WJ.H + 120) continue;
                const g = ctx.createRadialGradient(h.x, y, 3, h.x, y, h.r * 2.4);
                g.addColorStop(0, 'rgba(2,6,23,0.95)');
                g.addColorStop(0.45, 'rgba(30,41,59,0.5)');
                g.addColorStop(1, 'rgba(30,41,59,0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(h.x, y, h.r * 2.4, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(h.x, y, h.r, 0, Math.PI * 2);
                ctx.fillStyle = '#060b18';
                ctx.fill();
                ctx.strokeStyle = 'rgba(147,197,253,0.85)';
                ctx.lineWidth = 2;
                const t = performance.now() / 500;
                ctx.beginPath();
                ctx.arc(h.x, y, h.r + 5, t, t + 1.6);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(h.x, y, h.r + 5, t + Math.PI, t + Math.PI + 1.6);
                ctx.stroke();
            }

            // monsters
            for (const m of WJ.monsters) {
                if (m.dead) continue;
                const y = m.y - WJ.camY;
                if (y < -50 || y > WJ.H + 50) continue;
                ctx.fillStyle = '#7e22ce';
                for (let i = -1; i <= 1; i++) {
                    ctx.beginPath();
                    ctx.moveTo(m.x + i * 9 - 5, y - m.r + 3);
                    ctx.lineTo(m.x + i * 9, y - m.r - 9);
                    ctx.lineTo(m.x + i * 9 + 5, y - m.r + 3);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.beginPath();
                ctx.arc(m.x, y, m.r, 0, Math.PI * 2);
                ctx.fillStyle = '#c084fc';
                ctx.fill();
                ctx.strokeStyle = '#6b21a8';
                ctx.lineWidth = 2.5;
                ctx.stroke();
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(m.x - 6, y - 3, 5.5, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(m.x + 6, y - 3, 5.5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#1f2937';
                ctx.beginPath(); ctx.arc(m.x - 5, y - 2, 2.6, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(m.x + 7, y - 2, 2.6, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#6b21a8';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(m.x, y + 7, 6, 0.15 * Math.PI, 0.85 * Math.PI);
                ctx.stroke();
            }

            // UFOs
            for (const u of WJ.ufos) {
                if (u.dead) continue;
                const y = u.y - WJ.camY + Math.sin(u.bob) * 4;
                if (y < -80 || y > WJ.H + 80) continue;
                if (u.beam) {
                    const g = ctx.createLinearGradient(u.x, y, u.x, y + 210);
                    g.addColorStop(0, 'rgba(56,189,248,0.45)');
                    g.addColorStop(1, 'rgba(56,189,248,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.moveTo(u.x - 12, y + 6);
                    ctx.lineTo(u.x + 12, y + 6);
                    ctx.lineTo(u.x + 62, y + 210);
                    ctx.lineTo(u.x - 62, y + 210);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.beginPath();
                ctx.ellipse(u.x, y, u.r, u.r * 0.42, 0, 0, Math.PI * 2);
                ctx.fillStyle = '#cbd5e1';
                ctx.fill();
                ctx.strokeStyle = '#64748b';
                ctx.lineWidth = 2.5;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(u.x, y - 4, u.r * 0.48, Math.PI, 0);
                ctx.fillStyle = 'rgba(125,211,252,0.9)';
                ctx.fill();
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillStyle = '#f59e0b';
                for (let i = -1; i <= 1; i++) {
                    ctx.beginPath();
                    ctx.arc(u.x + i * 13, y + 3, 2.6, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            if (WJ.passFlash > 0) {
                ctx.fillStyle = 'rgba(254, 243, 199, ' + (0.28 * Math.min(1, WJ.passFlash)) + ')';
                ctx.fillRect(0, 0, WJ.W, WJ.H);
            }

            // shots
            ctx.fillStyle = '#f59e0b';
            for (const s of WJ.shots) {
                if (s.dead) continue;
                const y = s.y - WJ.camY;
                ctx.beginPath();
                ctx.arc(s.x, y, 5, 0, Math.PI * 2);
                ctx.fill();
            }

            // particles
            for (const pt of WJ.particles) {
                ctx.globalAlpha = Math.max(0, pt.life / pt.max);
                ctx.fillStyle = pt.color;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y - WJ.camY, pt.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            WJ.drawMilestoneLabels(ctx);
            if (typeof WJC !== 'undefined' && WJC.active) WJC.drawRivals(ctx);
            WJ.drawPlayer(ctx);
            WJ.drawPads(ctx);
            WJ.drawPassLabels(ctx);
            WJ.drawHud(ctx);
        };

        WJ.drawGadget = function (ctx, kind, x, y) {
            const map = { spring: '🌀', propeller: '🚁', jetpack: '🚀', shoes: '👟', shield: '🛡️' };
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.fillStyle = '#fff7d6';
            ctx.fill();
            ctx.strokeStyle = '#e0b43a';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.font = '14px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(map[kind] || '✦', x, y + 1);
            ctx.restore();
        };

        WJ.drawPlayer = function (ctx) {
            const p = WJ.player;
            if (!p) return;
            const x = p.x, y = p.y - WJ.camY, w = p.w, h = p.h;

            if (p.rainbow > 0) {
                const hue = (performance.now() / 8) % 360;
                ctx.beginPath();
                ctx.arc(x, y - h / 2, 34, 0, Math.PI * 2);
                ctx.fillStyle = 'hsla(' + hue + ',95%,62%,0.3)';
                ctx.fill();
            }

            if (p.jet > 0) {
                const fl = 12 + Math.random() * 16;
                const g = ctx.createLinearGradient(x, y, x, y + fl);
                g.addColorStop(0, 'rgba(251,191,36,0.95)');
                g.addColorStop(1, 'rgba(239,68,68,0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.moveTo(x - 7, y - 2);
                ctx.lineTo(x + 7, y - 2);
                ctx.lineTo(x, y + fl);
                ctx.closePath();
                ctx.fill();
            }

            // body
            WJ.roundRect(ctx, x - w / 2, y - h, w, h, 13);
            ctx.fillStyle = '#dff26b';
            ctx.strokeStyle = '#55771a';
            ctx.lineWidth = 3;
            ctx.fill();
            ctx.stroke();

            // eyes
            const eyeY = y - h * 0.66;
            [-6, 6].forEach(dx => {
                ctx.beginPath();
                ctx.arc(x + dx, eyeY, 4.8, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.strokeStyle = '#55771a';
                ctx.lineWidth = 1.6;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x + dx + p.face * 1.6, eyeY + 0.6, 2.1, 0, Math.PI * 2);
                ctx.fillStyle = '#1f2937';
                ctx.fill();
            });

            // nose cannon
            const nx = x + p.face * (w / 2 - 1), ny = y - h * 0.42;
            ctx.beginPath();
            ctx.moveTo(nx, ny - 6);
            ctx.lineTo(nx + p.face * 13, ny - 3);
            ctx.lineTo(nx + p.face * 13, ny + 4);
            ctx.lineTo(nx, ny + 6);
            ctx.closePath();
            ctx.fillStyle = '#f4a261';
            ctx.fill();
            ctx.strokeStyle = '#b5651d';
            ctx.lineWidth = 2;
            ctx.stroke();

            // feet
            ctx.fillStyle = '#55771a';
            [-7, 7].forEach(dx => {
                ctx.beginPath();
                ctx.ellipse(x + dx, y - 1, 5, 3.4, 0, 0, Math.PI * 2);
                ctx.fill();
            });

            // propeller hat
            if (p.prop > 0) {
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x, y - h);
                ctx.lineTo(x, y - h - 9);
                ctx.stroke();
                const spin = performance.now() / 40;
                ctx.fillStyle = '#94a3b8';
                ctx.beginPath();
                ctx.ellipse(x + Math.cos(spin) * 11, y - h - 11, 11, 3, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.ellipse(x - Math.cos(spin) * 11, y - h - 11, 11, 3, 0, 0, Math.PI * 2);
                ctx.fill();
            }

            // shield bubble
            if (p.shield > 0) {
                const a = 0.45 + 0.3 * Math.sin(performance.now() / 150);
                ctx.beginPath();
                ctx.arc(x, y - h / 2, 33, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(56,189,248,0.12)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(56,189,248,' + a + ')';
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        };

        WJ.drawPads = function (ctx) {
            const y = WJ.H - 64;
            [[62, -1], [WJ.W - 62, 1]].forEach(item => {
                const x = item[0], dir = item[1];
                const active = WJ.holdDir === dir || (dir < 0 ? WJ.keys.left : WJ.keys.right);
                ctx.beginPath();
                ctx.arc(x, y, 40, 0, Math.PI * 2);
                ctx.fillStyle = active ? 'rgba(16,185,129,0.28)' : 'rgba(255,255,255,0.7)';
                ctx.fill();
                ctx.strokeStyle = active ? '#10b981' : '#cbd5e1';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x + dir * 13, y);
                ctx.lineTo(x - dir * 9, y - 15);
                ctx.lineTo(x - dir * 9, y + 15);
                ctx.closePath();
                ctx.fillStyle = active ? '#047857' : '#64748b';
                ctx.fill();
            });
        };

        WJ.drawHud = function (ctx) {
            const best = Math.max(Number(localStorage.getItem('wj_best') || 0), WJ.score());

            // score, top-left
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.font = 'bold 26px Fredoka, system-ui, sans-serif';
            ctx.fillStyle = '#334155';
            ctx.fillText(String(WJ.score()), 14, 36);
            ctx.font = 'bold 9px Fredoka, system-ui, sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('BEST ' + best, 16, 49);
            if (WJ.streak > 1) {
                ctx.font = 'bold 12px Fredoka, system-ui, sans-serif';
                ctx.fillStyle = '#ea580c';
                ctx.fillText('🔥 x' + WJ.streak, 16, 66);
            }
            if (typeof WJC !== 'undefined' && WJC.active) {
                const rows = (WJC.players || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
                let hy = WJ.streak > 1 ? 82 : 68;
                ctx.textAlign = 'left';
                ctx.font = 'bold 9px Fredoka, system-ui, sans-serif';
                rows.slice(0, 6).forEach(row => {
                    const pal = WJC.colorOf(row.color);
                    const mine = currentUser && row.user_id === currentUser.id;
                    const nm = (row.nickname || 'player').slice(0, 8);
                    ctx.fillStyle = pal.stroke;
                    ctx.fillText((mine ? '• ' : '') + nm + ' ' + (row.score || 0) + (row.fallen ? ' out' : ''), 16, hy);
                    hy += 12;
                });
            }

            // question card (Chinese prompt), top-centre
            const row = WJ.activeRow();
            const cardX = 92, cardY = 8, cardW = WJ.W - cardX * 2, cardH = 62;
            ctx.fillStyle = 'rgba(255,255,255,0.94)';
            ctx.strokeStyle = row ? '#c7d2fe' : '#e2e8f0';
            ctx.lineWidth = 2;
            WJ.roundRect(ctx, cardX, cardY, cardW, cardH, 14);
            ctx.fill();
            ctx.stroke();

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (row) {
                let fs = 26;
                while (fs > 12) {
                    ctx.font = 'bold ' + fs + 'px "PingFang HK", "Noto Sans TC", Fredoka, system-ui, sans-serif';
                    if (ctx.measureText(row.zh).width <= cardW - 18) break;
                    fs--;
                }
                ctx.fillStyle = '#1e293b';
                ctx.fillText(row.zh, WJ.W / 2, cardY + 26, cardW - 16);
                ctx.font = 'bold 10px Fredoka, system-ui, sans-serif';
                ctx.fillStyle = '#818cf8';
                ctx.fillText('JUMP ON THE RIGHT WORD', WJ.W / 2, cardY + 48);
            } else {
                ctx.font = 'bold 13px Fredoka, system-ui, sans-serif';
                ctx.fillStyle = '#94a3b8';
                ctx.fillText('Keep climbing…', WJ.W / 2, cardY + 31);
            }

            // power-up badges, right edge
            const p = WJ.player;
            const badges = [];
            if (p) {
                if (p.rainbow > 0) badges.push(['🌈', Math.ceil(p.rainbow)]);
                if (p.jet > 0) badges.push(['🚀', Math.ceil(p.jet)]);
                if (p.prop > 0) badges.push(['🚁', Math.ceil(p.prop)]);
                if (p.shoes > 0) badges.push(['👟', p.shoes]);
                if (p.shield > 0) badges.push(['🛡️', Math.ceil(p.shield)]);
            }
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 12px Fredoka, system-ui, sans-serif';
            let by = 26;
            badges.forEach(b => {
                const label = b[0] + ' ' + b[1] + 's';
                const tw = ctx.measureText(label).width + 14;
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                WJ.roundRect(ctx, WJ.W - 12 - tw, by - 11, tw, 22, 11);
                ctx.fill();
                ctx.fillStyle = '#475569';
                ctx.fillText(label, WJ.W - 19, by);
                by += 26;
            });

            // toast
            const toast = WJ.toasts[WJ.toasts.length - 1];
            if (toast) {
                ctx.globalAlpha = Math.min(1, toast.life);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = 'bold 17px Fredoka, system-ui, sans-serif';
                ctx.fillStyle = toast.color;
                // Low on the screen: at y=96 the answer feedback used to land
                // right on top of the word tiles and hide them.
                ctx.fillText(toast.text, WJ.W / 2, WJ.H - 140, WJ.W - 24);
                ctx.globalAlpha = 1;
            }
        };

        /* ---------------- input ---------------- */

        // Map a pointer to a steer direction. In full screen the canvas is
        // letterboxed inside #wj-stage, so thumbs often land on the black
        // bars or just outside a pad — those still count as left / right.
        // 0 means "not a pad" (shoot only if the event is on the canvas).
        WJ.pointerDir = function (clientX, clientY) {
            const c = WJ.canvas;
            if (!c) return 0;
            const stage = document.getElementById('wj-stage');
            const sr = stage ? stage.getBoundingClientRect() : null;
            const rect = c.getBoundingClientRect();
            // Bottom thumb band of the whole stage (even if the canvas sits
            // higher because of letterboxing). Leave a gap in the centre for
            // the Restart button.
            if (sr && sr.height && clientY >= sr.bottom - Math.max(150, sr.height * 0.28)) {
                const mid = (sr.left + sr.right) / 2;
                if (clientX < mid - 56) return -1;
                if (clientX > mid + 56) return 1;
            }
            if (rect.width > 0 && rect.height > 0 &&
                clientX >= rect.left && clientX <= rect.right &&
                clientY >= rect.top && clientY <= rect.bottom) {
                const lx = (clientX - rect.left) * (WJ.W / rect.width);
                const ly = (clientY - rect.top) * (WJ.H / rect.height);
                const padY = WJ.H - 64;
                if (Math.hypot(lx - 62, ly - padY) < 72) return -1;
                if (Math.hypot(lx - (WJ.W - 62), ly - padY) < 72) return 1;
                if (ly >= WJ.H - 140 && lx <= WJ.W * 0.38) return -1;
                if (ly >= WJ.H - 140 && lx >= WJ.W * 0.62) return 1;
                return 0;
            }
            if (clientX < rect.left) return -1;
            if (clientX > rect.right) return 1;
            if (rect.width && clientY > rect.bottom) {
                const mid = (rect.left + rect.right) / 2;
                if (clientX < mid - 20) return -1;
                if (clientX > mid + 20) return 1;
            }
            return 0;
        };

        WJ.bindInput = function () {
            if (WJ.bound) return;
            WJ.bound = true;
            const c = WJ.canvas;
            if (!c) { WJ.bound = false; return; }
            const stage = document.getElementById('wj-stage') || c;
            const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

            const onDown = e => {
                if (WJ.state !== 'playing' || WJ.paused) return;
                if (e.target && e.target.closest && e.target.closest('button, #wj-overlay')) return;
                e.preventDefault();
                const dir = WJ.pointerDir(e.clientX, e.clientY);
                if (dir) {
                    WJ.holdDir = dir;
                    WJ.holdPointer = e.pointerId;
                    // setPointerCapture is flaky on iOS and can swallow the
                    // rest of the gesture; pads plus document touchmove are enough.
                    if (!isTouch) {
                        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
                    }
                } else if (e.target === c || (c.contains && c.contains(e.target))) {
                    WJ.shoot();
                }
            };
            const onUp = e => {
                if (WJ.holdPointer === e.pointerId) {
                    WJ.holdDir = 0;
                    WJ.holdPointer = null;
                }
            };
            stage.addEventListener('pointerdown', onDown);
            stage.addEventListener('pointerup', onUp);
            stage.addEventListener('pointercancel', onUp);
            stage.addEventListener('contextmenu', e => e.preventDefault());

            // Native touch fallback: iOS full-screen (CSS) often scrolls the
            // page, fires pointercancel, and the pads look like they do nothing.
            const touchById = (e, id) => {
                const list = e.changedTouches || e.touches;
                for (let i = 0; i < list.length; i++) {
                    if (id == null || list[i].identifier === id) return list[i];
                }
                return null;
            };
            stage.addEventListener('touchstart', e => {
                if (WJ.state !== 'playing' || WJ.paused) return;
                if (e.target && e.target.closest && e.target.closest('button, #wj-overlay')) return;
                const t = touchById(e, null);
                if (!t) return;
                e.preventDefault();
                const dir = WJ.pointerDir(t.clientX, t.clientY);
                if (dir) {
                    WJ.holdDir = dir;
                    WJ.holdTouch = t.identifier;
                } else if (e.target === c || (c.contains && c.contains(e.target))) {
                    WJ.shoot();
                }
            }, { passive: false });
            const onTouchEnd = e => {
                if (WJ.holdTouch == null) return;
                if (touchById(e, WJ.holdTouch)) {
                    WJ.holdDir = 0;
                    WJ.holdTouch = null;
                }
            };
            stage.addEventListener('touchend', onTouchEnd, { passive: false });
            stage.addEventListener('touchcancel', onTouchEnd, { passive: false });
            stage.addEventListener('touchmove', e => {
                if (WJ.holdTouch != null || WJ.holdDir || WJ.fsOn()) e.preventDefault();
                if (WJ.holdTouch == null) return;
                const t = touchById(e, WJ.holdTouch);
                if (!t) return;
                const dir = WJ.pointerDir(t.clientX, t.clientY);
                if (dir) WJ.holdDir = dir;
            }, { passive: false });
            document.addEventListener('touchmove', e => {
                if (WJ.fsOn() && WJ.state === 'playing' && !WJ.paused) e.preventDefault();
            }, { passive: false });

            document.addEventListener('keydown', e => {
                const view = document.getElementById('wordjump-view');
                if (!view || view.classList.contains('hidden')) return;
                if (WJ.state !== 'playing') return;
                const k = e.key;
                if (k === 'ArrowLeft' || k === 'a' || k === 'A') { WJ.keys.left = true; e.preventDefault(); }
                else if (k === 'ArrowRight' || k === 'd' || k === 'D') { WJ.keys.right = true; e.preventDefault(); }
                else if (k === 'ArrowUp' || k === ' ' || k === 'w' || k === 'W') { WJ.shoot(); e.preventDefault(); }
                else if (k === 'p' || k === 'P' || k === 'Escape') { WJ.togglePause(); }
            }, true);
            document.addEventListener('keyup', e => {
                const k = e.key;
                if (k === 'ArrowLeft' || k === 'a' || k === 'A') WJ.keys.left = false;
                if (k === 'ArrowRight' || k === 'd' || k === 'D') WJ.keys.right = false;
            }, true);

            window.addEventListener('resize', () => { if (WJ.mounted) WJ.resize(); });
            document.addEventListener('fullscreenchange', WJ.syncFsUi);
            document.addEventListener('webkitfullscreenchange', WJ.syncFsUi);
            window.addEventListener('orientationchange', () => {
                if (WJ.tiltOn) WJ.tiltZero = null;
                setTimeout(() => { if (WJ.mounted) { WJ.resize(); WJ.draw(); } }, 200);
            });
            if (screen.orientation && screen.orientation.addEventListener) {
                screen.orientation.addEventListener('change', () => {
                    if (WJ.tiltOn) WJ.tiltZero = null;
                });
            }
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && WJ.state === 'playing' && !WJ.paused) WJ.togglePause();
            });
        };

        WJ.shouldAutoTilt = function () {
            return ('ontouchstart' in window) ||
                (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
                (typeof DeviceOrientationEvent !== 'undefined' &&
                    typeof DeviceOrientationEvent.requestPermission === 'function');
        };

        WJ.syncTiltUi = function () {
            const label = WJ.tiltOn ? '📱 Tilt: on' : '📱 Tilt: off';
            const b = document.getElementById('wj-tilt-btn');
            if (b) b.innerText = label;
            const fs = document.getElementById('wj-tilt-fs');
            if (fs) fs.innerText = label;
        };

        // Left-right roll of the device, correct for portrait and landscape.
        WJ.tiltRoll = function (e) {
            if (e.gamma == null && e.beta == null) return null;
            let angle = 0;
            if (screen.orientation && typeof screen.orientation.angle === 'number') {
                angle = screen.orientation.angle;
            } else if (typeof window.orientation === 'number') {
                angle = window.orientation;
            }
            angle = ((angle % 360) + 360) % 360;
            if (angle === 90) return e.beta;
            if (angle === 270) return e.beta == null ? null : -e.beta;
            if (angle === 180) return e.gamma == null ? null : -e.gamma;
            return e.gamma;
        };

        WJ.attachTilt = function () {
            window.removeEventListener('deviceorientation', WJ.onTilt);
            window.addEventListener('deviceorientation', WJ.onTilt);
            WJ.tiltZero = null;
            WJ.tiltOn = true;
            WJ.syncTiltUi();
        };

        WJ.setTilt = async function (on, opts) {
            const silent = !!(opts && opts.silent);
            if (!on) {
                window.removeEventListener('deviceorientation', WJ.onTilt);
                WJ.tiltOn = false;
                WJ.tiltValue = 0;
                WJ.tiltSmooth = 0;
                WJ.syncTiltUi();
                if (!silent) WJ.toast('Tilt off — use the pads.', '#94a3b8');
                return;
            }
            if (WJ.tiltOn) {
                WJ.tiltZero = null;
                WJ.syncTiltUi();
                return;
            }
            try {
                if (typeof DeviceOrientationEvent !== 'undefined' &&
                    typeof DeviceOrientationEvent.requestPermission === 'function') {
                    const res = await DeviceOrientationEvent.requestPermission();
                    if (res !== 'granted') {
                        if (!silent) WJ.toast('Tilt not allowed — use the pads.', '#ef4444');
                        WJ.syncTiltUi();
                        return;
                    }
                }
                WJ.attachTilt();
                if (!silent) {
                    WJ.toast('Tilt on — tilt the phone to move.', '#22c55e');
                    WJ.beep(660, 0.1, 'sine', 0.04);
                }
            } catch (err) {
                if (!silent) WJ.toast('Tilt unavailable on this device.', '#ef4444');
            }
        };

        // Must be called from a user gesture (Start / Tilt button) so iOS
        // can show the motion-permission prompt in the same tap.
        WJ.armTiltOnStart = function () {
            if (WJ.shouldAutoTilt()) WJ.setTilt(true, { silent: true });
            else if (WJ.tiltOn) WJ.tiltZero = null;
        };

        WJ.enableTilt = function () {
            return WJ.setTilt(!WJ.tiltOn);
        };

        WJ.onTilt = function (e) {
            const roll = WJ.tiltRoll(e);
            if (roll == null) return;
            if (WJ.tiltZero === null) WJ.tiltZero = roll;
            WJ.tiltValue = WJ.clamp((roll - WJ.tiltZero) / WJ.TILT_RANGE, -1, 1);
        };

        /* ==========================================================
           Word Jump Challenge friends — rooms, colours, live birds
           Solo Word Jump is unchanged. Challenge scores are not
           written to wj_scores / wj_leaderboard.
           ========================================================== */
        const WJC = {
            COLORS: [
                { id: 'lime',   fill: '#dff26b', stroke: '#55771a', label: 'Lime' },
                { id: 'sky',    fill: '#7dd3fc', stroke: '#0369a1', label: 'Sky' },
                { id: 'coral',  fill: '#fda4af', stroke: '#be123c', label: 'Coral' },
                { id: 'violet', fill: '#c4b5fd', stroke: '#6d28d9', label: 'Violet' },
                { id: 'amber',  fill: '#fcd34d', stroke: '#b45309', label: 'Amber' },
                { id: 'rose',   fill: '#f9a8d4', stroke: '#be185d', label: 'Rose' },
                { id: 'teal',   fill: '#5eead4', stroke: '#0f766e', label: 'Teal' },
                { id: 'slate',  fill: '#cbd5e1', stroke: '#334155', label: 'Slate' }
            ],
            TARGETS: [2000, 3000, 5000, 8000],
            MAX_PLAYERS: 4,
            STALE_MS: 10000,
            FINISH_POLL_MS: 400,
            RESUME_KEY: 'learniTY_wj_challenge_resume',
            INTERP_MS: 180,
            POSE_MS: 80,
            HEARTBEAT_MS: 400,
            PLAY_POLL_MS: 800,
            room: null,
            players: [],
            pollId: null,
            lastPush: 0,
            lastPose: 0,
            lastSync: 0,
            pushing: false,
            posing: false,
            hbVel: null,
            velWire: null,
            ghosts: {},
            sqlMissing: false,
            startedKey: '',
            restoredKey: '',
            localFallen: false,
            overlayMode: '',
            error: ''
        };
        Object.defineProperty(WJC, 'active', {
            get: function () { return !!(WJ.challenge && WJC.room && WJC.room.status === 'playing'); }
        });

        WJC.colorOf = function (id) {
            return WJC.COLORS.find(c => c.id === id) || WJC.COLORS[0];
        };

        WJC.meId = function () { return currentUser ? currentUser.id : null; };

        WJC.meRow = function () {
            const id = WJC.meId();
            return (WJC.players || []).find(p => p.user_id === id) || null;
        };

        WJC.isHost = function () {
            return !!(currentUser && WJC.room && WJC.room.host_id === currentUser.id);
        };

        WJC.cloudBlockedReason = function () {
            if (previewStudentForm()) return 'Preview only — rooms and scores are not written under the teacher account.';
            if (isGuestUser()) return 'Guests can play Solo. Sign in with your school Google account to Challenge friends.';
            if (!currentUser) return 'Please login with your school account first.';
            return '';
        };

        WJC.errorMessage = function (error) {
            const m = (error && error.message) || 'Something went wrong.';
            if (/does not exist|Could not find|PGRST20|42P01|42883/i.test(m)) {
                WJC.sqlMissing = true;
                return 'Challenge rooms need supabase/wj_challenge.sql — ask your teacher to run it in the SQL editor.';
            }
            if (m.includes('ROOM_NOT_FOUND')) return 'No room with that code (or it has expired).';
            if (m.includes('ROOM_FULL')) return 'Room is full (4/4).';
            if (m.includes('ROOM_FINISHED')) return 'That challenge has already finished.';
            if (m.includes('ROOM_ALREADY_STARTED')) return 'That challenge has already started. If you were already in the room, use Rejoin. Arriving late? Use Join mid-game.';
            if (m.includes('NOT_AUTHENTICATED')) return 'Please login with your school account first.';
            if (m.includes('NOT_A_MEMBER')) return 'You are not in that room. Use Rejoin only for a challenge you already joined, or Join mid-game to enter one in progress.';
            if (m.includes('NOT_HOST')) return 'Only the host can do that.';
            if (m.includes('NEED_TWO_PLAYERS')) return 'Need at least 2 players in the room to start.';
            if (m.includes('DUEL_TYPE_REQUIRED')) return 'Pick how you will duel before starting.';
            if (m.includes('CANNOT_START') || m.includes('CANNOT_SETUP')) return 'Cannot change that room now.';
            if (m.includes('BAD_DUEL_TYPE') || m.includes('BAD_COLOR')) return 'That option is not available.';
            return m;
        };

        WJC.setError = function (msg) {
            WJC.error = msg || '';
            const el = document.getElementById('wjc-error');
            if (el) el.innerText = WJC.error;
        };

        WJC.syncTopicLock = function () {
            const sel = document.getElementById('wj-topic');
            if (!sel) return;
            sel.disabled = !!WJ.challenge;
            sel.classList.toggle('opacity-70', !!WJ.challenge);
        };

        /* ---------------- public, read-only challenge records ---------------- */

        WJC.reportError = function (error) {
            console.warn('Challenge records unavailable:', error && error.message);
            return '<p class="text-sm text-gray-500 py-6">Challenge records unavailable. Ask your teacher to re-run the whole <code>supabase/wj_challenge.sql</code>.</p>';
        };

        WJC.fetchWins = function () {
            return sb.from('wj_challenge_wins').select('user_id,display_name,wins,matches,last_win_at')
                .gt('wins', 0).order('wins', { ascending: false })
                .order('last_win_at', { ascending: true, nullsFirst: false })
                .order('matches', { ascending: true }).order('user_id', { ascending: true }).limit(50);
        };

        WJC.winsHtml = function (rows) {
            if (!rows || !rows.length) return '<p class="text-sm text-gray-400 py-6">No Challenge wins yet.</p>';
            return '<p class="text-xs text-gray-400 mb-3">Top 50 · All-time wins. Ties: earlier last win, then fewer matches.</p><div class="space-y-2">' + rows.map((r, i) => `
                <div class="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-left">
                    <span class="font-bold text-emerald-600 w-7">${['🥇', '🥈', '🥉'][i] || (i + 1)}</span>
                    <span class="flex-1 min-w-0 break-words text-sm font-bold text-gray-700">${escapeHtml(r.display_name || 'Player')}${currentUser && r.user_id === currentUser.id ? ' (you)' : ''}</span>
                    <span class="text-right text-sm font-bold text-emerald-700">${Number(r.wins) || 0} wins<br><span class="text-[10px] font-normal text-gray-400">${Number(r.matches) || 0} matches</span></span>
                </div>`).join('') + '</div>';
        };

        WJC.historyHtml = function (rows) {
            return rows.map(r => {
                const players = Array.isArray(r.players) ? r.players : [];
                const stamp = new Date(r.finished_at).toLocaleString('en-GB', { timeZone: 'Asia/Tokyo' }) + ' JST';
                return `<article class="bg-gray-50 rounded-xl p-3 mb-3 text-left">
                    <div class="flex justify-between gap-2 text-xs text-gray-400 mb-1"><b>Room ${escapeHtml(r.room_code)}</b><span title="${escapeHtml(stamp)}">${escapeHtml(timeAgo(r.finished_at))}</span></div>
                    <p class="text-xs font-bold text-sky-700">${escapeHtml(WJC.duelLabel(r))}</p>
                    <p class="text-sm font-bold text-emerald-700 my-1">🏆 ${escapeHtml(r.winner_name || 'No winner')}</p>
                    <p class="text-[10px] text-gray-400 mb-2">${escapeHtml(({target: 'Target reached', closest: 'Closest to target', last_standing: 'Last one standing', highest: 'Everyone out — highest score'})[r.result_reason] || 'Finished')}</p>
                    ${players.map(player => {
                        const color = WJC.colorOf(player.color);
                        return `<div class="flex items-center gap-2 py-1 text-xs">
                            <span class="shrink-0 rounded-full w-3 h-3 border border-black/10" title="${color.label} bird" style="background:${color.fill}"></span>
                            <span class="flex-1 min-w-0 break-words font-bold text-gray-600">${escapeHtml(player.name || 'Player')}${player.user_id === r.winner_id ? ' 🏆' : ''}</span>
                            <span class="text-right text-gray-500 shrink-0">${Number(player.score) || 0} pts · ${Number(player.height) || 0} px${player.words == null ? '' : ' · ' + (Number(player.words) || 0) + ' words'}</span>
                        </div>`;
                    }).join('')}
                </article>`;
            }).join('');
        };

        WJC.closeRecords = function () {
            const panel = document.getElementById('wjc-records');
            if (panel) panel.remove();
            WJC._recordsRequest = (WJC._recordsRequest || 0) + 1;
        };

        WJC.openRecords = function (mode) {
            if (isGuestUser() || !currentUser) return;
            WJC.closeRecords();
            const panel = document.createElement('section');
            panel.id = 'wjc-records';
            panel.className = 'absolute inset-0 bg-white p-4 overflow-y-auto text-left';
            panel.style.zIndex = '60';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-label', 'Public Challenge records');
            panel.innerHTML = `<div class="flex items-center justify-between gap-2 mb-3"><h3 class="font-bold text-emerald-700">Challenge records</h3><button type="button" onclick="WJC.closeRecords()" class="px-3 py-2 rounded-xl bg-gray-100 font-bold text-sm">← Back</button></div>
                <div class="flex gap-2 mb-3"><button type="button" onclick="WJC.loadRecords('history')" class="flex-1 py-2 rounded-xl bg-sky-100 text-sky-700 font-bold text-xs">Match history</button><button type="button" onclick="WJC.loadRecords('wins')" class="flex-1 py-2 rounded-xl bg-emerald-100 text-emerald-700 font-bold text-xs">Challenge wins</button></div>
                <div id="wjc-records-body" aria-live="polite"></div>`;
            document.getElementById('wj-stage').appendChild(panel);
            WJC.loadRecords(mode === 'wins' ? 'wins' : 'history');
        };

        WJC.loadRecords = async function (mode, more) {
            if (isGuestUser() || !currentUser) return WJC.closeRecords();
            const body = document.getElementById('wjc-records-body');
            if (!body) return;
            const request = WJC._recordsRequest = (WJC._recordsRequest || 0) + 1;
            if (!more) { WJC._historyRows = []; WJC._historySince = new Date(Date.now() - 7 * 86400000).toISOString(); }
            body.innerHTML = '<p class="text-sm text-gray-400 py-6">Loading…</p>';
            try {
                if (mode === 'wins') {
                    const { data, error } = await WJC.fetchWins();
                    if (request !== WJC._recordsRequest) return;
                    body.innerHTML = error ? WJC.reportError(error) : WJC.winsHtml(data);
                } else {
                    let query = sb.from('wj_challenge_matches')
                        .select('id,room_code,duel_type,target_score,winner_id,winner_name,result_reason,finished_at,players')
                        .gt('finished_at', WJC._historySince)
                        .order('finished_at', { ascending: false }).order('id', { ascending: false });
                    // Keyset pagination avoids duplicate/skipped rows if another match finishes.
                    const last = more && WJC._historyRows[WJC._historyRows.length - 1];
                    if (last) query = query.or(`finished_at.lt.${last.finished_at},and(finished_at.eq.${last.finished_at},id.lt.${last.id})`);
                    const { data, error } = await query.limit(30);
                    if (request !== WJC._recordsRequest) return;
                    if (error) { body.innerHTML = WJC.reportError(error); return; }
                    WJC._historyRows = WJC._historyRows.concat(data || []);
                    body.innerHTML = '<p class="text-xs text-gray-400 mb-3">All players · Last 7 days · Newest first</p>' +
                        (WJC.historyHtml(WJC._historyRows) || '<p class="text-sm text-gray-400 py-6">No matches in the last 7 days.</p>') +
                        (data && data.length === 30 ? '<button type="button" onclick="WJC.loadRecords(\'history\', true)" class="w-full py-2 bg-gray-100 rounded-xl font-bold text-sm">Load more</button>' : '');
                }
            } catch (error) {
                if (request === WJC._recordsRequest) body.innerHTML = WJC.reportError(error);
            }
        };

        WJC.recordsButtons = function () {
            if (isGuestUser() || !currentUser) return '';
            return `<div class="flex gap-2 mt-3"><button type="button" onclick="WJC.openRecords('history')" class="flex-1 py-2 bg-sky-50 text-sky-700 rounded-xl font-bold text-xs">Match history</button><button type="button" onclick="WJC.openRecords('wins')" class="flex-1 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-bold text-xs">Challenge wins</button></div>`;
        };

        /* ---------------- resume ---------------- */

        WJC.readResume = function () {
            try {
                const raw = JSON.parse(localStorage.getItem(WJC.RESUME_KEY) || 'null');
                if (!raw || !raw.roomId) return null;
                if (currentUser && raw.userId && raw.userId !== currentUser.id) return null;
                if (raw.savedAt && Date.now() - raw.savedAt > 7 * 24 * 3600 * 1000) {
                    localStorage.removeItem(WJC.RESUME_KEY);
                    return null;
                }
                return raw;
            } catch (e) { return null; }
        };

        WJC.clearResume = function () {
            try { localStorage.removeItem(WJC.RESUME_KEY); } catch (e) {}
            WJC.renderRejoin();
        };

        WJC.saveResume = function () {
            if (!WJC.room || !currentUser || !WJC.room.id) return;
            if (WJC.room.status === 'finished') { WJC.clearResume(); return; }
            try {
                localStorage.setItem(WJC.RESUME_KEY, JSON.stringify({
                    userId: currentUser.id,
                    roomId: WJC.room.id,
                    code: WJC.room.code,
                    seed: WJC.room.seed,
                    status: WJC.room.status,
                    savedAt: Date.now()
                }));
            } catch (e) {}
            WJC.renderRejoin();
        };

        WJC.renderRejoin = function () {
            const saved = WJC.readResume();
            const view = document.getElementById('wordjump-view');
            const onWj = !!(view && !view.classList.contains('hidden'));
            const inThatRoom = !!(saved && WJC.room && WJC.room.id === saved.roomId && onWj);
            const show = !!(saved && saved.code && !inThatRoom);
            const hubBtn = document.getElementById('hub-wj-rejoin');
            const hubSub = document.getElementById('hub-wj-sub');
            if (hubBtn) {
                hubBtn.classList.toggle('hidden', !show);
                if (show) hubBtn.innerText = '🔄 Rejoin ' + saved.code;
            }
            if (hubSub) {
                hubSub.innerText = show
                    ? ('Room ' + saved.code + ' is still open — rejoin to continue the challenge.')
                    : 'Solo climb or Challenge friends — read the Chinese, land on the English word.';
            }
        };

        /* ---------------- polling ---------------- */

        WJC.startPolling = function (ms) {
            WJC.stopPolling();
            WJC.pollId = setInterval(WJC.poll, ms || 1500);
        };

        WJC.stopPolling = function () {
            if (WJC.pollId) { clearInterval(WJC.pollId); WJC.pollId = null; }
        };

        WJC.onLeaveView = function () {
            WJC.closeRecords();
            WJC.clearFallenWatch();
            WJC.stopPolling();
            WJC.stopTransport();
            WJC.epoch = (WJC.epoch || 0) + 1;
            WJC.polling = null;
            if (WJC.room && WJC.room.status === 'playing' && currentUser && !previewStudentForm() && !isGuestUser()) {
                try { sb.rpc('leave_wj_challenge', { p_room_id: WJC.room.id }); } catch (e) {}
            }
            WJC.saveResume();
        };

        WJC.adoptRoom = function (data, opts) {
            const room = Array.isArray(data) ? data[0] : data;
            if (!room || !room.id) return WJC.setError('Could not open that room.');
            WJC.epoch = (WJC.epoch || 0) + 1;
            WJC.polling = null;
            WJC.room = room;
            WJC.error = '';
            WJC.sqlMissing = false;
            if (!(opts && opts.keepFallen)) WJC.localFallen = false;
            WJC.saveResume();
            WJC.startPolling(room.status === 'playing' ? WJC.PLAY_POLL_MS : 1500);
            WJC.poll();
        };

        WJC.applyRoom = function (room) {
            if (!room || !room.id) return;
            const prev = WJC.room || {};
            // A late poll must not revive a finished match.
            if (prev.id === room.id && prev.status === 'finished' && room.status !== 'finished'
                && prev.started_at && room.started_at && prev.started_at === room.started_at) {
                return;
            }
            WJC.room = Object.assign({}, prev, room);
            if (WJC.room.status !== 'finished') WJC.saveResume();
            else WJC.clearResume();
        };

        WJC.isOut = function (p) {
            if (!p) return true;
            if (p.fallen || p.left_at) return true;
            if (p.last_seen) {
                const t = Date.parse(p.last_seen);
                if (Number.isFinite(t) && Date.now() - t > (WJC.STALE_MS || 10000)) return true;
            }
            return false;
        };

        WJC.seatCount = function (rows) {
            const seen = {};
            (rows || WJC.players || []).forEach(p => { if (p && p.user_id) seen[p.user_id] = true; });
            return Object.keys(seen).length;
        };

        // Mirrors join_wj_challenge: a 5th distinct player is rejected;
        // an existing member may rejoin even when the room is at 4/4.
        WJC.canJoinAs = function (userId, rows, max) {
            const id = userId || WJC.meId();
            const list = rows || WJC.players || [];
            if (list.some(p => p.user_id === id)) return true;
            return WJC.seatCount(list) < (max || WJC.MAX_PLAYERS || 4);
        };

        WJC.pollMs = function () {
            if (!WJC.room) return 1500;
            if (WJC.room.status === 'finished') return 2000;
            if (WJC.room.status !== 'playing') return 1500;
            if ((WJC.players || []).some(WJC.isOut)) return WJC.FINISH_POLL_MS || 400;
            return WJC.PLAY_POLL_MS;
        };

        WJC.resultsSig = function () {
            const r = WJC.room || {};
            const board = (WJC.players || []).map(p => [p.user_id, p.score, p.height, p.fallen].join(':')).join('|');
            return [r.id, r.winner_id, r.result_reason, r.finished_at, board].join('/');
        };

        WJC.clearFallenWatch = function () {
            if (WJC.fallenWatch) { clearInterval(WJC.fallenWatch); WJC.fallenWatch = null; }
        };

        WJC.ensureFallenWatch = function () {
            if (WJC.fallenWatch) return;
            WJC.fallenWatch = setInterval(function () {
                if (!WJC.room || WJC.room.status === 'finished' || !WJC.localFallen) {
                    WJC.clearFallenWatch();
                    if (WJC.room && WJC.room.status === 'finished') WJC.endMatch();
                    return;
                }
                WJC.pushNow(true);
                WJC.poll();
            }, 500);
        };

        WJC.broadcastFinished = function () {
            if (!WJC.room || WJC.room.status !== 'finished') return;
            const key = WJC.room.id + ':' + (WJC.room.finished_at || WJC.room.started_at || '');
            if (WJC.didBroadcastFinish === key) return;
            WJC.didBroadcastFinish = key;
            const channel = WJC.poseChannel;
            if (!channel || !WJC.broadcastReady) return;
            channel.send({
                type: 'broadcast',
                event: 'finished',
                payload: {
                    id: WJC.room.id,
                    status: 'finished',
                    winner_id: WJC.room.winner_id,
                    result_reason: WJC.room.result_reason,
                    started_at: WJC.room.started_at,
                    finished_at: WJC.room.finished_at
                }
            }).catch(() => {});
        };

        // Stop the local climb immediately — including mid-jump — and show the
        // end screen to every client, including the last player still standing.
        WJC.endMatch = function (room) {
            if (room) WJC.applyRoom(room);
            if (!WJC.room || WJC.room.status !== 'finished') return;
            WJC.clearFallenWatch();
            WJ.challenge = true;
            WJ.running = false;
            WJ.paused = true;
            if (WJ.player) { WJ.player.vx = 0; WJ.player.boostHang = false; }
            if (WJ.raf) cancelAnimationFrame(WJ.raf);
            WJ.raf = 0;
            WJ.state = 'over';
            const same = WJC.overlayMode === 'results' && WJC._resultsSig === WJC.resultsSig();
            if (!same) WJC.broadcastFinished();
            WJC.stopTransport();
            if (!same) WJC.showResults();
            WJC.startPolling(2000);
            WJC.syncTopicLock();
        };

        WJC.onFinishedEvent = function (room) {
            if (!room || !WJC.room) return;
            if (room.id && room.id !== WJC.room.id) return;
            if (room.status && room.status !== 'finished') return;
            if (room.started_at && WJC.room.started_at && room.started_at !== WJC.room.started_at) return;
            WJC.applyRoom(Object.assign({}, room, { status: 'finished', id: room.id || WJC.room.id }));
            WJC.endMatch();
            WJC.poll();
        };

        WJC.maybeClaimWin = function () {
            if (!WJC.room || WJC.room.status !== 'playing' || WJC.localFallen) return;
            const rows = WJC.players || [];
            if (rows.length < 2) return;
            const out = rows.filter(WJC.isOut);
            if (out.length >= 1 && rows.length - out.length <= 1) WJC.pushNow(false);
        };

        async function wjcRpc(name, args) {
            const { data, error } = await sb.rpc(name, args);
            if (error) throw error;
            return Array.isArray(data) ? data[0] : data;
        }

        WJC.poll = async function () {
            if (!WJC.room || !WJC.room.id) return;
            if (previewStudentForm() || isGuestUser() || !currentUser) return;
            if (WJC.polling) return;
            const roomId = WJC.room.id, roomRef = WJC.room;
            WJC.polling = roomRef;
            try {
                const [roomRes, playersRes] = await Promise.all([
                    sb.from('wj_challenge_rooms').select('*').eq('id', WJC.room.id).maybeSingle(),
                    sb.from('wj_challenge_players').select('*').eq('room_id', WJC.room.id)
                ]);
                if (!WJC.room || WJC.room.id !== roomId || WJC.polling !== roomRef) return;
                if (roomRes.error) {
                    WJC.setError(WJC.errorMessage(roomRes.error));
                    return;
                }
                if (playersRes.error) {
                    WJC.setError(WJC.errorMessage(playersRes.error));
                    return;
                }
                if (!roomRes.data) {
                    WJC.resetLocal();
                    WJC.showModeSelect();
                    WJC.setError('That room is no longer open.');
                    return;
                }
                WJC.applyRoom(roomRes.data);
                WJC.players = playersRes.data || [];
                if (WJC.room && WJC.room.status === 'finished') {
                    WJC.endMatch();
                    return;
                }
                if (WJC.room && WJC.room.status === 'playing') WJC.adoptSnapshots(WJC.players);
                else WJC.ghosts = {};
                WJC.reactToState();
            } catch (e) {
                if (WJC.room && WJC.room.id === roomId) WJC.setError(WJC.errorMessage(e));
            } finally {
                if (WJC.polling === roomRef) WJC.polling = null;
            }
        };

        WJC.reactToState = function () {
            if (!WJC.room) return;
            const st = WJC.room.status;
            if (st === 'finished') { WJC.endMatch(); return; }
            if (st !== 'playing') WJC.stopTransport();
            if (st === 'waiting') {
                if (WJ.challenge && (WJ.state === 'playing' || WJ.state === 'over')) {
                    WJ.challenge = false;
                    WJ.rng = null;
                    WJ.running = false;
                    if (WJ.raf) cancelAnimationFrame(WJ.raf);
                    WJ.raf = 0;
                    WJ.state = 'intro';
                }
                WJC.startedKey = '';
                WJC.restoredKey = '';
                WJC.localFallen = false;
                WJC.syncTopicLock();
                WJC.paintWaiting();
                WJC.startPolling(1500);
            } else if (st === 'playing') {
                const key = WJC.room.id + ':' + (WJC.room.started_at || '');
                const me = WJC.meRow();
                if (me && me.fallen) WJC.localFallen = true;
                if (WJC.startedKey !== key) {
                    WJC.startedKey = key;
                    const resume = me && (me.height > 40 || me.score > 0 || (me.y || 0) < -40) && !me.fallen;
                    if (resume && WJC.restoredKey !== key) {
                        WJC.restoredKey = key;
                        WJC.beginMatch({ restore: me });
                    } else if (!me || !me.fallen) {
                        WJC.beginMatch({ restore: null });
                    } else {
                        WJC.showFallenOverlay('You are out of this climb.');
                    }
                } else if (WJC.localFallen && WJC.overlayMode !== 'results') {
                    WJC.showFallenOverlay();
                }
                WJC.maybeClaimWin();
                WJC.startTransport();
                WJC.startPolling(WJC.pollMs());
                WJC.syncTopicLock();
            }
        };

        /* ---------------- UI ---------------- */

        WJC.showModeSelect = function () {
            WJ.challenge = false;
            WJ.rng = null;
            WJC.syncTopicLock();
            WJC.renderRejoin();
            const blocked = WJC.cloudBlockedReason();
            const saved = WJC.readResume();
            const rejoin = (saved && saved.code)
                ? `<div class="mb-3 bg-emerald-50 rounded-xl p-3 border border-emerald-100 text-left">
                        <p class="font-bold text-emerald-700 text-sm">You left a challenge in progress</p>
                        <p class="text-xs text-gray-500 mb-2">Room <span class="font-bold tracking-widest">${escapeHtml(saved.code)}</span> is still open.</p>
                        <button type="button" onclick="WJC.rejoin()" class="w-full py-2 bg-emerald-500 text-white rounded-xl font-bold text-sm">🔄 Rejoin</button>
                   </div>`
                : '';
            WJ.setOverlay(`
                <div class="w-full py-2">
                    <div class="text-5xl mb-1">🦘</div>
                    <h3 class="text-2xl font-bold text-emerald-600 mb-1">Word Jump</h3>
                    <p class="text-gray-500 text-sm mb-4">Choose how you want to play.</p>
                    ${rejoin}
                    <button type="button" onclick="WJC.chooseSolo()" class="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold text-lg hover:bg-emerald-600 transition-colors">Solo</button>
                    <button type="button" onclick="WJC.chooseChallenge()" class="w-full mt-2 py-3 bg-sky-500 text-white rounded-xl font-bold text-lg hover:bg-sky-600 transition-colors">Challenge friends</button>
                    ${WJC.recordsButtons()}
                    ${blocked ? `<p class="text-xs text-amber-700 font-bold mt-3">${escapeHtml(blocked)}</p>` : '<p class="text-xs text-gray-400 mt-3">Challenge friends: open or join a room, pick a bird colour, then choose how to duel.</p>'}
                </div>`, true);
            WJC.overlayMode = 'mode';
        };

        WJC.chooseSolo = function () {
            WJ.challenge = false;
            WJ.rng = null;
            WJC.syncTopicLock();
            WJ.showIntro();
        };

        WJC.chooseChallenge = function () {
            const blocked = WJC.cloudBlockedReason();
            if (blocked) {
                WJC.showLobby(blocked);
                return;
            }
            WJC.showLobby('');
        };

        WJC.showLobby = function (blocked) {
            WJC.overlayMode = 'lobby';
            const reason = blocked || WJC.cloudBlockedReason();
            const saved = WJC.readResume();
            const rejoin = (saved && saved.code)
                ? `<button type="button" onclick="WJC.rejoin()" class="w-full mt-2 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-bold text-sm">🔄 Rejoin ${escapeHtml(saved.code)}</button>`
                : '';
            WJ.setOverlay(`
                <div class="w-full py-1 text-left">
                    <h3 class="text-xl font-bold text-emerald-600 text-center mb-1">Challenge friends</h3>
                    <p class="text-gray-500 text-xs text-center mb-3">Open a room or join with a 4-character code. Up to 4 players. Mid-game join and Rejoin work like Word Battle.</p>
                    ${reason ? `<p class="text-xs text-amber-700 font-bold mb-3 text-center">${escapeHtml(reason)}</p>` : ''}
                    <div class="${reason ? 'opacity-60 pointer-events-none' : ''}">
                        <p class="text-xs font-bold text-gray-500 mb-1">Create room</p>
                        <p class="text-[11px] text-gray-400 mb-2">Uses the topic selected above. Everyone shares the same course.</p>
                        <button type="button" onclick="WJC.createRoom()" class="w-full py-2.5 bg-emerald-500 text-white rounded-xl font-bold">Create room</button>
                        <p class="text-xs font-bold text-gray-500 mt-3 mb-1">Join a room</p>
                        <input id="wjc-code-input" maxlength="4" placeholder="A7K2" autocomplete="off"
                            class="w-full mb-2 p-2 rounded-xl border-2 border-emerald-100 bg-white font-bold text-center text-xl tracking-widest uppercase">
                        <button type="button" onclick="WJC.joinRoom(false)" class="w-full py-2.5 bg-sky-500 text-white rounded-xl font-bold">Join</button>
                        <button type="button" onclick="WJC.joinRoom(true)" class="w-full mt-2 py-2 bg-white border-2 border-sky-200 text-sky-700 rounded-xl font-bold text-sm">Join mid-game</button>
                        ${rejoin}
                    </div>
                    ${WJC.recordsButtons()}
                    <p id="wjc-error" class="text-red-400 font-bold text-center text-xs mt-3">${escapeHtml(WJC.error || '')}</p>
                    <button type="button" onclick="WJC.showModeSelect()" class="w-full mt-2 py-2 text-sm font-bold text-gray-400">← Back</button>
                </div>`, true);
            const input = document.getElementById('wjc-code-input');
            if (input) {
                input.addEventListener('input', function (e) {
                    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                });
                input.addEventListener('keypress', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); WJC.joinRoom(false); }
                });
            }
        };

        WJC.duelLabel = function (room) {
            if (!room || !room.duel_type) return 'Not set yet';
            if (room.duel_type === 'target_score') return 'First to ' + (room.target_score || 3000);
            return 'Last one standing';
        };

        WJC.colorButtons = function (selected, enabled) {
            return '<div class="flex justify-center gap-1.5 flex-wrap">' + WJC.COLORS.map(c => {
                const on = c.id === selected;
                return `<button type="button" class="wj-color-dot" title="${c.label}" aria-label="${c.label}" aria-pressed="${on ? 'true' : 'false'}"
                    style="background:${c.fill}" ${enabled ? `onclick="WJC.pickColor('${c.id}')"` : 'disabled'}></button>`;
            }).join('') + '</div>';
        };

        WJC.playerLine = function (p) {
            const c = WJC.colorOf(p.color);
            const mine = currentUser && p.user_id === currentUser.id;
            const host = WJC.room && p.user_id === WJC.room.host_id;
            const away = !!p.left_at;
            const name = p.nickname || (p.email || '').split('@')[0] || 'player';
            return `<div class="flex items-center gap-2 py-1 ${mine ? 'bg-emerald-50 rounded-lg px-1' : ''}">
                <span class="inline-block w-3.5 h-3.5 rounded-full border border-black/10" style="background:${c.fill}"></span>
                <span class="flex-1 truncate text-xs font-bold ${away ? 'text-gray-400' : 'text-gray-700'}">${escapeHtml(name)}${mine ? ' (you)' : ''}${host ? ' · host' : ''}${away ? ' · away' : ''}</span>
            </div>`;
        };

        WJC.waitingSig = function () {
            const present = (WJC.players || []).map(p => [p.user_id, p.color, p.left_at, p.nickname].join(':')).join('|');
            const r = WJC.room || {};
            return [r.id, r.status, r.duel_type, r.target_score, r.code, present, WJC.error || ''].join('/');
        };

        WJC.paintWaiting = function () {
            if (!WJC.room) return WJC.showLobby('');
            if (WJC.room.status !== 'waiting') return;
            const sig = WJC.waitingSig();
            if (WJC.overlayMode === 'waiting' && WJC._waitingSig === sig && document.getElementById('wjc-error')) return;
            WJC._waitingSig = sig;
            WJC.overlayMode = 'waiting';
            const me = WJC.meRow();
            const present = (WJC.players || []).filter(p => !p.left_at);
            const host = WJC.isHost();
            const duel = WJC.room.duel_type || '';
            const target = WJC.room.target_score || 3000;
            const ready = present.length >= 2 && !!duel;
            const targetChoices = WJC.TARGETS.map(n =>
                `<option value="${n}" ${n === target ? 'selected' : ''}>${n}</option>`
            ).join('');
            const setup = host ? `
                <div class="mt-3 text-left bg-white rounded-xl border border-emerald-100 p-3">
                    <p class="text-xs font-bold text-gray-500 mb-2">How to duel</p>
                    <label class="flex items-start gap-2 text-sm text-gray-700 mb-1">
                        <input type="radio" name="wjc-duel" value="last_standing" ${duel === 'last_standing' ? 'checked' : ''} onchange="WJC.saveSetup()">
                        <span><b>Last one standing</b> — first to fall loses; last bird still climbing wins.</span>
                    </label>
                    <label class="flex items-start gap-2 text-sm text-gray-700">
                        <input type="radio" name="wjc-duel" value="target_score" ${duel === 'target_score' ? 'checked' : ''} onchange="WJC.saveSetup()">
                        <span><b>First to a target score</b></span>
                    </label>
                    <select id="wjc-target" onchange="WJC.saveSetup()" class="mt-2 w-full p-2 rounded-xl border-2 border-emerald-100 bg-white font-bold text-sm ${duel === 'target_score' ? '' : 'hidden'}">${targetChoices}</select>
                </div>`
                : `<p class="text-xs text-gray-500 mt-3">Duel: <b>${escapeHtml(WJC.duelLabel(WJC.room))}</b>${duel ? '' : ' — waiting for the host to choose.'}</p>`;
            const startBtn = host
                ? `<button type="button" onclick="WJC.startMatch()" class="w-full mt-3 py-3 rounded-xl font-bold ${ready ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-200 text-gray-400'}" ${ready ? '' : 'disabled'}>Start</button>
                   <p class="text-[11px] text-gray-400 mt-1 text-center">${ready ? 'Everyone will share the same platforms and words.' : 'Need at least 2 players and a duel type.'}</p>`
                : `<p class="text-xs text-gray-400 mt-3 text-center">Waiting for the host to start.</p>`;
            WJ.setOverlay(`
                <div class="w-full py-1">
                    <p class="text-xs font-bold uppercase tracking-wider text-gray-400">Room code</p>
                    <div class="text-4xl font-bold text-emerald-600 tracking-[0.25em] my-1">${escapeHtml(WJC.room.code || '----')}</div>
                    <button type="button" onclick="WJC.copyCode()" class="px-3 py-1 bg-gray-100 rounded-full font-bold text-gray-600 text-xs">📋 Copy code</button>
                    <p class="text-[11px] text-gray-400 mt-2">Pick a bird colour so everyone can tell you apart.</p>
                    <div class="mt-2">${WJC.colorButtons(me ? me.color : 'lime', true)}</div>
                    <p class="text-xs font-bold text-gray-500 mt-3 text-left">Players ${present.length}/${WJC.MAX_PLAYERS || 4}</p>
                    <div class="mt-1 text-left">${present.map(WJC.playerLine).join('') || '<p class="text-xs text-gray-400">No players yet.</p>'}</div>
                    ${setup}
                    ${startBtn}
                    <p id="wjc-error" class="text-red-400 font-bold text-center text-xs mt-2">${escapeHtml(WJC.error || '')}</p>
                    <button type="button" onclick="WJC.leaveRoom()" class="mt-2 px-4 py-1 text-xs font-bold text-gray-400 hover:text-red-500">Leave room</button>
                </div>`, true);
        };

        WJC.showRoom = function () {
            if (!WJC.room) return WJC.showModeSelect();
            WJC.startPolling(WJC.room.status === 'playing' ? WJC.PLAY_POLL_MS : 1500);
            WJC.poll();
        };

        WJC.scoreboardHtml = function () {
            const rows = (WJC.players || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0) || (b.height || 0) - (a.height || 0));
            return rows.map(p => {
                const c = WJC.colorOf(p.color);
                const mine = currentUser && p.user_id === currentUser.id;
                const name = p.nickname || (p.email || '').split('@')[0] || 'player';
                const tag = p.fallen ? 'out' : (p.left_at ? 'away' : (p.reached_at ? 'target!' : ''));
                return `<div class="flex items-center gap-2 py-0.5">
                    <span class="inline-block w-3 h-3 rounded-full" style="background:${c.fill}"></span>
                    <span class="flex-1 truncate text-xs font-bold ${mine ? 'text-emerald-700' : 'text-gray-600'}">${escapeHtml(name)}</span>
                    <span class="text-xs font-bold text-indigo-600">${p.score || 0}</span>
                    <span class="w-8 text-right text-[10px] text-gray-400">${tag}</span>
                </div>`;
            }).join('');
        };

        WJC.showFallenOverlay = function (reason) {
            if (WJC.room && WJC.room.status === 'finished') return WJC.showResults();
            WJC.overlayMode = 'fallen';
            const msg = reason || 'You fell! Watching the others…';
            WJ.setOverlay(`
                <div class="w-full py-2">
                    <div class="text-4xl mb-1">💥</div>
                    <h3 class="text-xl font-bold text-gray-700 mb-1">You are out</h3>
                    <p class="text-gray-400 text-sm mb-3">${escapeHtml(msg)}</p>
                    <div class="text-left border-t border-gray-100 pt-2 mb-3">${WJC.scoreboardHtml()}</div>
                    <p class="text-xs text-gray-400 mb-2">The climb continues until the duel is decided.</p>
                    <button type="button" onclick="WJC.leaveRoom()" class="w-full py-2 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm">Leave room</button>
                </div>`, true);
        };

        WJC.showResults = function () {
            if (!WJC.room) return;
            WJC.overlayMode = 'results';
            WJC._resultsSig = WJC.resultsSig();
            const winner = (WJC.players || []).find(p => p.user_id === WJC.room.winner_id);
            const winName = winner ? (winner.nickname || (winner.email || '').split('@')[0]) : 'No one';
            const mineWin = currentUser && WJC.room.winner_id === currentUser.id;
            const reason = WJC.room.result_reason;
            let blurb = 'Challenge over.';
            if (reason === 'target') blurb = winName + ' was first to the target score.';
            else if (reason === 'closest') blurb = 'No one reached the target. Closest: ' + winName + '.';
            else if (reason === 'last_standing') blurb = winName + ' was the last one standing.';
            else if (reason === 'highest') blurb = 'Everyone fell. Highest climb: ' + winName + '.';
            const rematch = WJC.isHost()
                ? `<button type="button" onclick="WJC.rematch()" class="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold">Rematch (back to lobby)</button>`
                : `<p class="text-xs text-gray-400 mb-2">Waiting for the host to start a rematch.</p>`;
            WJ.setOverlay(`
                <div class="w-full py-2">
                    <div class="text-4xl mb-1">${mineWin ? '🏆' : '🎉'}</div>
                    <h3 class="text-xl font-bold text-gray-700 mb-1">${mineWin ? 'You win!' : escapeHtml(winName) + ' wins'}</h3>
                    <p class="text-gray-500 text-sm mb-3">${escapeHtml(blurb)}</p>
                    <p class="text-[11px] text-gray-400 mb-2">Challenge scores are not added to the Solo Word Jump leaderboard.</p>
                    <div class="text-left border-t border-gray-100 pt-2 mb-4">${WJC.scoreboardHtml()}</div>
                    ${rematch}
                    ${WJC.recordsButtons()}
                    <button type="button" onclick="WJC.leaveRoom()" class="w-full mt-2 py-2 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm">Back to Hub</button>
                    <p id="wjc-error" class="text-red-400 font-bold text-center text-xs mt-2">${escapeHtml(WJC.error || '')}</p>
                </div>`, true);
            WJC.syncTopicLock();
        };

        /* ---------------- actions ---------------- */

        WJC.createRoom = async function () {
            WJC.setError('');
            const blocked = WJC.cloudBlockedReason();
            if (blocked) return WJC.setError(blocked);
            const topic = (document.getElementById('wj-topic') || {}).value || WJ.topic || '__all__';
            const seed = Math.floor(Math.random() * 2000000000) + 1;
            try {
                const room = await wjcRpc('create_wj_challenge', { p_topic: topic, p_seed: seed });
                WJC.adoptRoom(room);
            } catch (e) {
                WJC.setError(WJC.errorMessage(e));
            }
        };

        WJC.joinRoom = async function () {
            WJC.setError('');
            const blocked = WJC.cloudBlockedReason();
            if (blocked) return WJC.setError(blocked);
            const input = document.getElementById('wjc-code-input');
            const code = (input ? input.value : '').trim().toUpperCase();
            if (code.length !== 4) return WJC.setError('Enter the 4-character room code.');
            try {
                const room = await wjcRpc('join_wj_challenge', { p_code: code });
                WJC.adoptRoom(room);
            } catch (e) {
                WJC.setError(WJC.errorMessage(e));
            }
        };

        WJC.rejoin = async function () {
            WJC.setError('');
            const blocked = WJC.cloudBlockedReason();
            if (blocked) {
                openWordJump('hub-view');
                WJC.showLobby(blocked);
                return WJC.setError(blocked);
            }
            const saved = WJC.readResume();
            if (!saved || !saved.roomId) return WJC.setError('No challenge to rejoin.');
            if (typeof WJ !== 'undefined') WJ.backView = 'hub-view';
            changeView('wordjump-view');
            try {
                let room = null;
                try {
                    room = await wjcRpc('rejoin_wj_challenge', { p_room_id: saved.roomId });
                } catch (e) {
                    const m = (e && e.message) || '';
                    if (!/ROOM_NOT_FOUND|NOT_A_MEMBER/i.test(m) && saved.code) throw e;
                    if (saved.code) room = await wjcRpc('join_wj_challenge', { p_code: saved.code });
                    else throw e;
                }
                if (!room && saved.code) room = await wjcRpc('join_wj_challenge', { p_code: saved.code });
                if (!room || !room.id) {
                    WJC.clearResume();
                    return WJC.setError('That room is no longer open.');
                }
                WJC.adoptRoom(room);
            } catch (e) {
                WJC.setError(WJC.errorMessage(e));
                WJC.showLobby('');
            }
        };

        WJC.pickColor = async function (color) {
            if (!WJC.room) return;
            const blocked = WJC.cloudBlockedReason();
            if (blocked) return WJC.setError(blocked);
            try {
                await wjcRpc('set_wj_challenge_color', { p_room_id: WJC.room.id, p_color: color });
                const me = WJC.meRow();
                if (me) me.color = color;
                if (WJC.room.status === 'waiting') WJC.paintWaiting();
            } catch (e) {
                WJC.setError(WJC.errorMessage(e));
            }
        };

        WJC.saveSetup = async function () {
            if (!WJC.isHost() || !WJC.room) return;
            const picked = document.querySelector('input[name="wjc-duel"]:checked');
            const type = picked ? picked.value : '';
            if (!type) return;
            const sel = document.getElementById('wjc-target');
            const target = sel ? parseInt(sel.value, 10) : (WJC.room.target_score || 3000);
            try {
                const room = await wjcRpc('set_wj_challenge_setup', {
                    p_room_id: WJC.room.id,
                    p_duel_type: type,
                    p_target_score: target
                });
                WJC.applyRoom(room);
                WJC.paintWaiting();
            } catch (e) {
                WJC.setError(WJC.errorMessage(e));
            }
        };

        WJC.startMatch = async function () {
            WJC.setError('');
            if (!WJC.isHost() || !WJC.room) return;
            try {
                const room = await wjcRpc('start_wj_challenge', { p_room_id: WJC.room.id });
                WJC.applyRoom(room);
                WJC.reactToState();
            } catch (e) {
                WJC.setError(WJC.errorMessage(e));
            }
        };

        WJC.rematch = async function () {
            WJC.setError('');
            if (!WJC.isHost() || !WJC.room) return;
            try {
                const seed = Math.floor(Math.random() * 2000000000) + 1;
                const room = await wjcRpc('rematch_wj_challenge', { p_room_id: WJC.room.id, p_seed: seed });
                WJC.startedKey = '';
                WJC.restoredKey = '';
                WJC.localFallen = false;
                WJC.adoptRoom(room);
            } catch (e) {
                WJC.setError(WJC.errorMessage(e));
            }
        };

        WJC.copyCode = function () {
            const code = WJC.room && WJC.room.code;
            if (!code) return;
            const done = () => WJ.toast && WJ.toast('Copied ' + code, '#0f766e');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(code).then(done).catch(() => {});
            }
        };

        WJC.resetLocal = function () {
            WJC.clearFallenWatch();
            WJC.pendingFallen = false;
            WJC.queuedHeartbeat = null;
            WJC.stopPolling();
            WJC.stopTransport();
            WJC.epoch = (WJC.epoch || 0) + 1;
            WJC.polling = null;
            WJC.room = null;
            WJC.players = [];
            WJC.ghosts = {};
            WJC.startedKey = '';
            WJC.restoredKey = '';
            WJC.localFallen = false;
            WJ.challenge = false;
            WJ.rng = null;
            WJC.syncTopicLock();
            WJC.clearResume();
        };

        WJC.leaveRoom = async function (skipConfirm) {
            if (WJC.room && currentUser && !previewStudentForm() && !isGuestUser()) {
                const playing = WJC.room.status === 'playing';
                const waitingHost = WJC.room.status === 'waiting' && WJC.isHost();
                const msg = waitingHost
                    ? 'Close this room? Friends will not be able to join it.'
                    : (playing ? 'Leave this challenge? You will drop out of the climb (you can Rejoin if the room is still open).' : 'Leave this room?');
                if (!skipConfirm && !window.confirm(msg)) return;
                try { await sb.rpc('leave_wj_challenge', { p_room_id: WJC.room.id }); } catch (e) {}
            }
            WJC.resetLocal();
            WJ.stop();
            changeView(WJ.backView || 'hub-view');
        };

        WJC.quitFromGame = function () {
            if (!WJC.room) {
                WJ.stop();
                changeView(WJ.backView || 'hub-view');
                return;
            }
            if (WJC.room.status === 'playing' && WJ.state === 'playing') {
                if (!window.confirm('Leave this challenge? You will drop out of the climb (you can Rejoin if the room is still open).')) return;
            }
            WJC.leaveRoom(true);
        };

        /* ---------------- match start / live sync ---------------- */

        WJC.beginMatch = function (opts) {
            const room = WJC.room;
            if (!room) return;
            WJ.challenge = true;
            WJ.rng = mulberry32((Number(room.seed) || 1) >>> 0);
            WJ.topic = room.topic || '__all__';
            const sel = document.getElementById('wj-topic');
            if (sel && Array.from(sel.options || []).some(o => o.value === WJ.topic)) sel.value = WJ.topic;
            WJC.syncTopicLock();
            WJC.localFallen = false;
            WJC.overlayMode = '';
            if (!WJ.canvas) WJ.mount();
            WJ.armTiltOnStart();
            if (WJ.autoFs !== false) WJ.enterFullscreen();
            const me = opts && opts.restore;
            if (me) WJC.restoreClimb(me);
            else {
                WJ.reset();
            }
            WJ.hideOverlay();
            WJ.state = 'playing';
            WJ.paused = false;
            WJ.running = true;
            WJ.lastTs = 0; WJ.acc = 0;
            cancelAnimationFrame(WJ.raf);
            WJ.raf = requestAnimationFrame(WJ.frame);
            WJC.ghosts = {};
            WJC.lastPush = 0;
            WJC.lastPose = 0;
            WJC.startTransport();
            WJC.pushPose();
            WJC.pushNow(false);
        };

        WJC.restoreClimb = function (me) {
            WJ.reset();
            const y = Number(me.y);
            const x = Number(me.x);
            if (WJ.player) {
                if (Number.isFinite(x)) WJ.player.x = WJ.clamp(x, WJ.player.w / 2, WJ.W - WJ.player.w / 2);
                if (Number.isFinite(y)) WJ.player.y = y;
                WJ.player.face = (me.face || 1) < 0 ? -1 : 1;
                WJ.player.vy = 0; WJ.player.vx = 0;
            }
            WJ.maxClimb = Math.max(Number(me.height) || 0, Number.isFinite(y) ? Math.max(0, -y) : 0);
            const score = Number(me.score) || 0;
            WJ.bonus = Math.max(0, score - Math.floor(WJ.maxClimb / 10));
            WJ.camY = (WJ.player ? WJ.player.y : 0) - WJ.H * 0.65;
            WJ.genUpTo(WJ.camY - WJ.H * 0.6);
            const cut = (WJ.player ? WJ.player.y : 0) - 20;
            WJ.quizRows.forEach(r => { if (r.y >= cut) r.resolved = true; });
        };

        WJC.onLocalFallen = function (reason, score) {
            WJC.localFallen = true;
            WJ.beep(150, 0.4, 'sawtooth', 0.06);
            WJC.ensureFallenWatch();
            Promise.resolve(WJC.pushNow(true)).then(() => {
                if (WJC.room && WJC.room.status === 'finished') WJC.endMatch();
                else WJC.showFallenOverlay(reason || 'You fell too far!');
            }).catch(() => {
                WJC.showFallenOverlay(reason || 'You fell too far!');
            });
            WJ.draw();
        };

        WJC.tick = function () {
            if (!WJC.room || WJC.room.status !== 'playing') return;
            if (WJC.room.duel_type === 'target_score' && !WJC.localFallen && WJ.state === 'playing') {
                const target = Number(WJC.room.target_score) || 3000;
                if (WJ.score() >= target) {
                    WJC.onReachedTarget();
                    return;
                }
            }
            const now = Date.now();
            if (now - (WJC.lastPose || 0) > WJC.POSE_MS) WJC.pushPose();
            if (now - WJC.lastPush > WJC.HEARTBEAT_MS) WJC.pushNow(WJC.localFallen || WJ.state === 'over');
        };

        WJC.onReachedTarget = function () {
            if (WJC.localFallen || WJ.state === 'over') return;
            WJ.running = false;
            if (WJ.raf) cancelAnimationFrame(WJ.raf);
            WJ.raf = 0;
            WJ.state = 'over';
            WJC.pushNow(false).then(() => {
                if (WJC.room && WJC.room.status === 'finished') WJC.showResults();
                else {
                    WJ.setOverlay(`
                        <div class="w-full py-2">
                            <div class="text-4xl mb-1">🎯</div>
                            <h3 class="text-xl font-bold text-emerald-600 mb-1">Target reached!</h3>
                            <p class="text-gray-500 text-sm mb-3">You hit ${WJ.score()}. Waiting for the room to confirm the winner…</p>
                            <div class="text-left border-t border-gray-100 pt-2">${WJC.scoreboardHtml()}</div>
                        </div>`, true);
                    WJC.overlayMode = 'target';
                }
            });
        };

        WJC.heartbeatArgs = function (fallen, withVel) {
            const p = WJ.player;
            const args = {
                p_room_id: WJC.room.id,
                p_score: WJ.score(),
                p_height: Math.round(WJ.maxClimb || 0),
                p_x: p ? p.x : 200,
                p_y: p ? p.y : 0,
                p_face: p ? p.face : 1,
                p_fallen: !!fallen
            };
            if (withVel) {
                args.p_vx = p ? (Number(p.vx) || 0) : 0;
                args.p_vy = p ? (Number(p.vy) || 0) : 0;
            }
            return args;
        };

        WJC.pushNow = async function (fallen) {
            if (!WJC.room || !currentUser) return;
            if (previewStudentForm() || isGuestUser()) return;
            if (fallen) WJC.pendingFallen = true;
            if (WJC.room.status !== 'playing' && WJC.room.status !== 'finished') return;
            if (WJC.pushing) {
                WJC.queuedHeartbeat = { fallen: !!(fallen || WJC.pendingFallen) };
                return;
            }
            const sendFallen = !!(fallen || WJC.pendingFallen);
            const roomId = WJC.room.id, startedAt = WJC.room.started_at, epoch = WJC.epoch;
            WJC.pushing = true;
            WJC.lastPush = Date.now();
            try {
                let room;
                try {
                    room = await wjcRpc('heartbeat_wj_challenge', WJC.heartbeatArgs(sendFallen, WJC.hbVel !== false));
                    if (WJC.hbVel == null) WJC.hbVel = true;
                } catch (e) {
                    const m = (e && e.message) || '';
                    if (WJC.hbVel !== false && /could not find the function|PGRST202|42883/i.test(m)) {
                        WJC.hbVel = false;
                        room = await wjcRpc('heartbeat_wj_challenge', WJC.heartbeatArgs(sendFallen, false));
                    } else {
                        throw e;
                    }
                }
                if (!WJC.room || WJC.room.id !== roomId || WJC.room.started_at !== startedAt || WJC.epoch !== epoch) {
                    return;
                }
                if (sendFallen) WJC.pendingFallen = false;
                if (room) WJC.applyRoom(room);
                if (room && room.status === 'finished') WJC.endMatch(room);
            } catch (e) {
                if (!WJC.sqlMissing) console.warn('WJ challenge heartbeat:', e.message || e);
            } finally {
                WJC.pushing = false;
                if (WJC.queuedHeartbeat && WJC.room && WJC.room.id === roomId && WJC.epoch === epoch) {
                    const q = WJC.queuedHeartbeat;
                    WJC.queuedHeartbeat = null;
                    await WJC.pushNow(q.fallen);
                }
            }
        };


        WJC.wrapDx = function (dx) {
            const w = WJ.W + 34; // local player wraps at -17 / W+17, not at 0 / W
            if (dx > w / 2) return dx - w;
            if (dx < -w / 2) return dx + w;
            return dx;
        };

        WJC.wrapX = function (x) {
            const half = 17, period = WJ.W + 2 * half;
            return ((x + half) % period + period) % period - half;
        };

        /* Lightweight x/y/vx/vy write that does not lock the room row.
           Heartbeat still carries score, height, fallen and win checks. */
        WJC.pushDbPose = async function () {
            if (!WJC.room || !currentUser || WJC.posing) return;
            if (previewStudentForm() || isGuestUser()) return;
            if (!WJC.room.id || WJC.room.status !== 'playing') return;
            const p = WJ.player;
            if (!p) return;
            if (Date.now() - (WJC.lastDbPose || 0) < 400) return;
            WJC.posing = true;
            WJC.lastDbPose = Date.now();
            const base = { x: p.x, y: p.y, face: p.face || 1 };
            const withVel = WJC.velWire !== false;
            const patch = withVel
                ? Object.assign({}, base, { vx: Number(p.vx) || 0, vy: Number(p.vy) || 0 })
                : base;
            try {
                const { error } = await sb.from('wj_challenge_players')
                    .update(patch)
                    .eq('room_id', WJC.room.id)
                    .eq('user_id', currentUser.id);
                if (error) {
                    const m = (error.message || '');
                    if (withVel && /vx|vy|column|schema cache|PGRST204/i.test(m)) {
                        WJC.velWire = false;
                        await sb.from('wj_challenge_players')
                            .update(base)
                            .eq('room_id', WJC.room.id)
                            .eq('user_id', currentUser.id);
                    } else if (!/Could not find|does not exist|PGRST20|42P01/i.test(m)) {
                        console.warn('WJ challenge pose:', m);
                    }
                } else if (withVel && WJC.velWire == null) {
                    WJC.velWire = true;
                }
            } catch (e) {
                /* pose is best-effort; heartbeat still carries a fallback snapshot */
            }
            WJC.posing = false;
        };

        // Broadcast is visual-only. DB membership, scores, fallen and winner stay authoritative.
        // Public UUID topic: never broadcast names/emails, answers, scores or auth tokens.
        WJC.stopTransport = function () {
            const channel = WJC.poseChannel;
            WJC.poseChannel = null;
            WJC.broadcastReady = false;
            WJC.transportKey = '';
            if (WJC.poseTimer) clearInterval(WJC.poseTimer);
            WJC.poseTimer = null;
            if (channel) sb.removeChannel(channel).catch(() => {});
        };

        WJC.startTransport = function () {
            if (!WJC.room || WJC.room.status !== 'playing' || WJC.cloudBlockedReason()) return;
            const key = WJC.room.id + ':' + WJC.room.started_at;
            if (WJC.transportKey === key) return;
            WJC.stopTransport();
            WJC.transportKey = key;
            WJC.poseSession = crypto.randomUUID();
            WJC.poseSeq = 0;
            WJC.ghosts = {};
            WJC.poseTimer = setInterval(() => WJC.pushPose(), WJC.POSE_MS);
            try {
                const channel = sb.channel('wjc:' + WJC.room.id, {
                    config: { broadcast: { self: false, ack: false } }
                });
                WJC.poseChannel = channel;
                channel
                    .on('broadcast', { event: 'pose' }, ({ payload }) => {
                        if (WJC.poseChannel === channel) WJC.receivePose(payload);
                    })
                    .on('broadcast', { event: 'finished' }, ({ payload }) => {
                        if (WJC.poseChannel === channel) WJC.onFinishedEvent(payload);
                    })
                    .on('postgres_changes', {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'wj_challenge_rooms',
                        filter: 'id=eq.' + WJC.room.id
                    }, payload => {
                        if (WJC.poseChannel === channel) WJC.onFinishedEvent(payload && payload.new);
                    })
                    .subscribe(status => {
                    if (WJC.poseChannel !== channel) return;
                    WJC.broadcastReady = status === 'SUBSCRIBED';
                    if (WJC.broadcastReady) WJC.pushPose();
                });
            } catch (e) {
                WJC.broadcastReady = false; // DB path still works if websocket is unavailable.
            }
        };

        WJC.pushPose = function (jump) {
            if (!WJC.room || WJC.room.status !== 'playing' || !WJ.challenge ||
                !WJ.player || WJC.cloudBlockedReason()) return;
            WJC.lastPose = Date.now();
            const p = WJ.player, moving = WJ.state === 'playing' && !WJ.paused && !WJC.localFallen;
            const payload = {
                match: WJC.transportKey, user: WJC.meId(), session: WJC.poseSession,
                seq: ++WJC.poseSeq, t: performance.now(), x: p.x, y: p.y,
                vx: moving ? p.vx : 0, vy: moving ? p.vy : 0, face: p.face || 1,
                gravity: !moving || p.jet > 0 || p.prop > 0 ? 0 : (p.boostHang ? WJ.BOOST_G : WJ.GRAVITY),
                jump: jump === true
            };
            const channel = WJC.poseChannel;
            if (channel && WJC.broadcastReady) {
                // Never queue stale poses or use send()'s HTTP fallback before SUBSCRIBED.
                channel.send({ type: 'broadcast', event: 'pose', payload }).then(result => {
                    if (result !== 'ok' && WJC.poseChannel === channel) WJC.broadcastReady = false;
                }).catch(() => { if (WJC.poseChannel === channel) WJC.broadcastReady = false; });
            } else WJC.pushDbPose();
        };

        WJC.receivePose = function (p) {
            if (!p || p.match !== WJC.transportKey || p.user === WJC.meId() ||
                !WJC.players.some(row => row.user_id === p.user && !row.left_at) ||
                typeof p.session !== 'string' || p.session.length > 64 ||
                !Number.isSafeInteger(p.seq) || p.seq < 1 ||
                !['t', 'x', 'y', 'vx', 'vy', 'gravity'].every(k => Number.isFinite(p[k])) ||
                Math.abs(p.x) > WJ.W + 40 || Math.abs(p.y) > 1e8 ||
                Math.abs(p.vx) > 3000 || Math.abs(p.vy) > 4000 || p.gravity < 0 || p.gravity > 2000) return;
            let g = WJC.ghosts[p.user];
            if (!g) g = WJC.ghosts[p.user] = { snaps: [], retired: [] };
            if (g.session !== p.session) {
                if (g.retired.includes(p.session)) return;
                if (g.session) g.retired.push(g.session);
                g.retired = g.retired.slice(-8);
                g.session = p.session; g.seq = 0; g.snaps = []; g.offsets = [];
                g.renderAt = null; g.lastSenderT = null; // Keep displayed position for blend-correction on rejoin.
            }
            if (p.seq <= g.seq || (g.lastSenderT != null && p.t <= g.lastSenderT)) return;
            if (g.source === 'db') { g.snaps = []; g.renderAt = null; }
            g.source = 'broadcast';
            g.lastSenderT = p.t;
            const now = performance.now();
            g.seq = p.seq;
            g.lastBroadcast = now;
            g.offsets.push(now - p.t);
            if (g.offsets.length > 40) g.offsets.shift();
            // Minimum one-way arrival offset cancels different device clocks. The spread
            // measures network jitter without interpreting late packets as slower physics.
            g.offset = Math.min(...g.offsets);
            const jitter = Math.max(...g.offsets) - g.offset;
            g.delay = Math.min(320, WJC.INTERP_MS + jitter);
            g.snaps.push({ ...p, face: p.face < 0 ? -1 : 1 });
            if (g.snaps.length > 40) g.snaps.shift();
        };

        WJC.adoptSnapshots = function (rows) {
            const now = performance.now();
            (rows || []).forEach(row => {
                if (row.user_id === WJC.meId()) return;
                let g = WJC.ghosts[row.user_id];
                // Never let a late DB read overwrite the fast broadcast stream.
                if (g && now - g.lastBroadcast < 1200) return;
                const x = Number(row.x), y = Number(row.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                if (!g) g = WJC.ghosts[row.user_id] = { snaps: [], retired: [] };
                if (g.source !== 'db') {
                    g.snaps = []; g.renderAt = null; g.source = 'db';
                }
                const last = g.snaps[g.snaps.length - 1];
                // Unchanged poll responses are NOT fresh positions (old code replayed them).
                if (last && last.x === x && last.y === y) return;
                const dt = last ? Math.max(0.1, (now - last.t) / 1000) : 1;
                const vx = row.vx == null ? (last ? WJC.wrapDx(x - last.x) / dt : 0) : Number(row.vx);
                const vy = row.vy == null ? (last ? (y - last.y) / dt : 0) : Number(row.vy);
                g.offset = 0; g.delay = 500;
                g.snaps.push({ t: now, x, y, vx: vx || 0, vy: vy || 0, gravity: WJ.GRAVITY, face: row.face || 1 });
                if (g.snaps.length > 12) g.snaps.shift();
            });
            const ids = new Set((rows || []).map(row => row.user_id));
            Object.keys(WJC.ghosts).forEach(id => { if (!ids.has(id)) delete WJC.ghosts[id]; });
        };

        WJC.predictPose = function (a, dt) {
            // Fade extrapolation to a stop after 300ms; no unbounded flight on a lost link.
            dt = Math.max(0, dt);
            dt = dt <= 0.2 ? dt : 0.2 + 0.1 * (1 - Math.exp(-(dt - 0.2) / 0.1));
            return { x: WJC.wrapX(a.x + a.vx * dt),
                y: a.y + a.vy * dt + 0.5 * a.gravity * dt * dt, face: a.face };
        };

        WJC.sampleGhost = function (g, now) {
            const snaps = g.snaps;
            if (!snaps || !snaps.length) return null;
            const desired = now - (g.offset || 0) - (g.delay || WJC.INTERP_MS);
            // Adaptive buffer changes must not run the playback clock backwards.
            const elapsed = g.frameAt == null ? 1 / 60 : Math.max(0, Math.min(0.05, (now - g.frameAt) / 1000));
            g.renderAt = g.renderAt == null ? desired : Math.max(g.renderAt,
                Math.min(desired, g.renderAt + elapsed * 1100));
            let i = snaps.length - 1;
            while (i > 0 && snaps[i].t > g.renderAt) i--;
            const a = snaps[i], b = snaps[i + 1];
            const dt = Math.max(0, (g.renderAt - a.t) / 1000);
            let pose = WJC.predictPose(a, dt);
            if (b && b.t > a.t && g.renderAt >= a.t) {
                const span = (b.t - a.t) / 1000, f = Math.min(1, dt / span);
                // Bounce packets anchor the new impulse at its actual sender time. Do
                // not smear its upward velocity into the preceding falling segment.
                if (!b.jump) {
                    const endY = a.y + a.vy * span + 0.5 * a.gravity * span * span;
                    pose.y = a.y + a.vy * dt + 0.5 * a.gravity * dt * dt + (b.y - endY) * f;
                    pose.x = WJC.wrapX(a.x + WJC.wrapDx(b.x - a.x) * f);
                }
            }
            if (g.display) {
                // Short blend, then a hard per-second correction budget:
                // late packets can bend the trajectory, never teleport the canvas bird.
                const blend = 1 - Math.exp(-elapsed / 0.045);
                const limit = 2000 * elapsed;
                const dx = WJC.wrapDx(pose.x - g.display.x);
                const dy = pose.y - g.display.y;
                pose.x = WJC.wrapX(g.display.x + Math.max(-limit, Math.min(limit, dx * blend)));
                pose.y = g.display.y + Math.max(-limit, Math.min(limit, dy * blend));
            }
            g.display = pose; g.frameAt = now;
            return pose;
        };

        /* ---------------- live birds ---------------- */

        WJC.drawRivals = function (ctx) {
            const myId = WJC.meId();
            const now = performance.now();
            (WJC.players || []).forEach(p => {
                if (!p || p.user_id === myId) return;
                const g = WJC.ghosts[p.user_id];
                const pose = g ? WJC.sampleGhost(g, now) : null;
                WJC.drawRivalBird(ctx, pose ? Object.assign({}, p, pose) : p);
            });
        };

        WJC.drawRivalBird = function (ctx, row) {
            const pal = WJC.colorOf(row.color);
            const name = row.nickname || (row.email || '').split('@')[0] || 'friend';
            const fallen = !!row.fallen || !!row.left_at;
            const x = Number(row.x); const y = Number(row.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                WJC.drawHeightMarker(ctx, pal, name, Number(row.height) || 0, fallen);
                return;
            }
            const sy = y - WJ.camY;
            if (sy < 18 || sy > WJ.H - 18) {
                WJC.drawHeightMarker(ctx, pal, name, Number.isFinite(y) ? Math.max(0, -y) : (Number(row.height) || 0), fallen, sy < 18);
                return;
            }
            if (fallen) return;
            const face = (row.face || 1) < 0 ? -1 : 1;
            const w = 34, h = 40;
            ctx.save();
            ctx.globalAlpha = 0.88;
            WJ.roundRect(ctx, x - w / 2, sy - h, w, h, 13);
            ctx.fillStyle = pal.fill;
            ctx.strokeStyle = pal.stroke;
            ctx.lineWidth = 3;
            ctx.fill();
            ctx.stroke();
            const eyeY = sy - h * 0.66;
            [-6, 6].forEach(dx => {
                ctx.beginPath();
                ctx.arc(x + dx, eyeY, 4.8, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.strokeStyle = pal.stroke;
                ctx.lineWidth = 1.6;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x + dx + face * 1.6, eyeY + 0.6, 2.1, 0, Math.PI * 2);
                ctx.fillStyle = '#1f2937';
                ctx.fill();
            });
            const nx = x + face * (w / 2 - 1), ny = sy - h * 0.42;
            ctx.beginPath();
            ctx.moveTo(nx, ny - 6);
            ctx.lineTo(nx + face * 13, ny - 3);
            ctx.lineTo(nx + face * 13, ny + 4);
            ctx.lineTo(nx, ny + 6);
            ctx.closePath();
            ctx.fillStyle = pal.fill;
            ctx.fill();
            ctx.strokeStyle = pal.stroke;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = pal.stroke;
            [-7, 7].forEach(dx => {
                ctx.beginPath();
                ctx.ellipse(x + dx, sy - 1, 5, 3.4, 0, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalAlpha = 1;
            ctx.font = 'bold 10px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = pal.stroke;
            ctx.fillText(name, x, sy - h - 4);
            ctx.restore();
        };

        WJC.drawHeightMarker = function (ctx, pal, name, height, fallen, atTop) {
            const y = atTop === false ? WJ.H - 86 : 78;
            const x = WJ.W - 8;
            ctx.save();
            ctx.globalAlpha = fallen ? 0.45 : 0.92;
            WJ.roundRect(ctx, x - 92, y - 14, 88, 22, 8);
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            ctx.fill();
            ctx.strokeStyle = pal.stroke;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x - 80, y, 6, 0, Math.PI * 2);
            ctx.fillStyle = pal.fill;
            ctx.fill();
            ctx.strokeStyle = pal.stroke;
            ctx.stroke();
            ctx.font = 'bold 9px Fredoka, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = pal.stroke;
            const tag = fallen ? 'out' : (atTop === false ? '↓ ' : '↑ ') + Math.round(height || 0);
            ctx.fillText(String(name).slice(0, 8) + ' ' + tag, x - 70, y, 62);
            ctx.restore();
        };

        window.addEventListener('pagehide', function () {
            if (WJC.room && WJC.room.status === 'playing' && currentUser && !previewStudentForm() && !isGuestUser()) {
                try { sb.rpc('leave_wj_challenge', { p_room_id: WJC.room.id }); } catch (e) {}
            }
        });

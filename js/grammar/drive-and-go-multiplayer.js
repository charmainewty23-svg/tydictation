/* LearniTY Dictation — Drive & Go! multiplayer (2–5 players).
   Rooms use Supabase tables + short polling, in the same honest-client style
   as Word Battle. Requires supabase/drive_and_go.sql (and, on existing
   rooms, supabase/drive_and_go_question_count.sql). The teacher pastes SQL
   in the live project; never run it via a plugin. Single Player never
   touches this file's database code. */

(function () {
    'use strict';

    const DG = window.DG;
    const MP = {
        room: null,
        players: [],
        pollId: null,
        racePollId: null,
        polling: false,
        syncing: false,
        beginning: false,
        lastEffectSeq: 0,
        lastSyncWarn: 0,
        leaving: false
    };
    DG.mpState = MP;

    const clean = (v) => String(v == null ? '' : v).trim();

    DG.mpPlayerName = function (p) {
        if (!p) return 'Player';
        const nick = clean(p.nickname);
        if (nick) return nick;
        const email = clean(p.email);
        return email ? email.split('@')[0] : 'Player';
    };

    DG.mpIsSqlMissing = function (error) {
        const text = [error && error.code, error && error.message, error && error.details, error && error.hint]
            .filter(Boolean).join(' ');
        return /drive_and_go|does not exist|Could not find the function|PGRST202|42P01|relation .* does not exist/i.test(text);
    };

    DG.mpSqlHintHTML = function (kind) {
        if (kind === 'question_count') {
            return '<div class="dg-note warn text-left"><b>Multiplayer needs an updated SQL file.</b><br>' +
                'The teacher must run <code>supabase/drive_and_go_question_count.sql</code> in the Supabase SQL editor ' +
                '(if Drive &amp; Go! rooms already exist). A fresh setup can paste <code>supabase/drive_and_go.sql</code> instead. ' +
                'Single Player works without it.</div>';
        }
        return '<div class="dg-note warn text-left"><b>Multiplayer needs one SQL file.</b><br>' +
            'The teacher must run <code>supabase/drive_and_go.sql</code> once in the Supabase SQL editor. ' +
            'If rooms already exist and question counts fail, also run <code>supabase/drive_and_go_question_count.sql</code>. ' +
            'Single Player works without it.</div>';
    };

    DG.mpIsQuestionCountSqlMissing = function (error) {
        const text = [error && error.code, error && error.message, error && error.details, error && error.hint]
            .filter(Boolean).join(' ');
        return /p_question_count|question_count|composite_score|elapsed_ms|Could not find the function public\.create_drive_and_go_room/i.test(text)
            || (/PGRST202/i.test(text) && /create_drive_and_go_room|question_count/i.test(text));
    };

    DG.rankMultiplayerRows = function (players) {
        const acc = (p) => {
            const c = Number(p && p.correct) || 0;
            const w = Number(p && p.wrong) || 0;
            return (c + w) ? c / (c + w) : 0;
        };
        const composite = (p) => Number(p && (p.composite_score != null ? p.composite_score : p.score)) || 0;
        return (players || []).slice().sort((a, b) => {
            const cs = composite(b) - composite(a);
            if (cs) return cs;
            const fa = a.finished_at ? Date.parse(a.finished_at) : Infinity;
            const fb = b.finished_at ? Date.parse(b.finished_at) : Infinity;
            if (fa !== fb) return fa - fb;
            const d = acc(b) - acc(a);
            if (d) return d;
            return 0;
        });
    };

    DG.mpPlayerPatch = function (player) {
        const p = player || (DG.raceState && DG.raceState.player) || {};
        const n = DG.normalizeQuestionCount((DG.raceState && DG.raceState.questionCount) || 20);
        const elapsed = typeof DG.raceElapsedSeconds === 'function' ? DG.raceElapsedSeconds() : 0;
        const result = p.runResult || (typeof DG.scoreRun === 'function' ? DG.scoreRun(p, elapsed, n) : null);
        const patch = {
            distance: Math.floor(p.dist || 0),
            score: Math.floor(p.score || 0),
            combo: p.combo || 0,
            correct: p.correct || 0,
            wrong: p.wrong || 0,
            lane: p.lane == null ? 1 : p.lane,
            composite_score: result ? Math.floor(result.composite) : Math.floor(p.composite || p.score || 0),
            elapsed_ms: result ? Math.round(result.elapsed * 1000) : Math.round((p.elapsed || elapsed) * 1000),
            last_seen: new Date().toISOString()
        };
        return patch;
    };

    DG.mpShowSqlHint = function (error) {
        const kind = DG.mpIsQuestionCountSqlMissing(error) ? 'question_count' : '';
        const content = DG.menuContent();
        const status = document.getElementById('dg-mp-status');
        if (status && content) status.outerHTML = DG.mpSqlHintHTML(kind);
        else if (typeof DG.toastSafe === 'function') {
            DG.toastSafe(kind === 'question_count'
                ? 'Run supabase/drive_and_go_question_count.sql in the Supabase SQL editor.'
                : 'Run supabase/drive_and_go.sql in the Supabase SQL editor.');
        }
    };

    DG.mpErrorText = function (error) {
        const msg = clean(error && (error.message || error.error_description || error.details));
        if (/ROOM_FULL/i.test(msg)) return 'That room is full (5 players max).';
        if (/ROOM_ALREADY_STARTED/i.test(msg)) return 'That race has already started.';
        if (/ROOM_NOT_FOUND/i.test(msg)) return 'No room with that code.';
        if (/START_NEEDS_TWO/i.test(msg)) return 'A race needs at least 2 players.';
        if (/NOT_HOST/i.test(msg)) return 'Only the host can start this race.';
        if (/NOT_AUTHENTICATED/i.test(msg)) return 'Please sign in with your school account.';
        return msg || 'Something went wrong. Please try again.';
    };

    /* ---------------- entry / menu ---------------- */

    DG.openMultiplayer = function () {
        if (isGuestUser()) {
            DG.showMultiplayerUnavailable('Multiplayer needs a school Google account. You can still play Single Player as a guest.');
            return;
        }
        if (!currentUser || !canUseCloud()) {
            DG.showMultiplayerUnavailable('Please sign in with your school Google account to play multiplayer.');
            return;
        }
        if (previewStudentForm()) {
            DG.showMultiplayerUnavailable('Exit the student preview to play multiplayer. Single Player still works in preview.');
            return;
        }
        DG.showMultiplayerMenu();
    };

    DG.showMultiplayerUnavailable = function (message) {
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        content.innerHTML =
            '<div class="text-center mb-5"><div class="text-7xl mb-2">🏎️</div>' +
            '<h3 class="text-3xl font-bold text-green-600">Multiplayer</h3></div>' +
            '<div class="dg-menu-panel text-center">' +
            '<p class="font-bold text-gray-600 mb-2">' + DG.esc(message) + '</p>' +
            '<p class="text-sm text-gray-500 mb-6">Multiplayer rooms are for 2–5 signed-in players. Single Player is always available.</p>' +
            '<div class="flex gap-3 justify-center flex-wrap">' +
            '<button type="button" class="btn-paw" onclick="DG.startSingle()">Play Single Player</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showModeStep()">Back</button>' +
            '</div></div>';
    };

    DG.showMultiplayerMenu = function () {
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const mode = DG.readSettings().bankMode;
        content.innerHTML =
            '<div class="text-center mb-5"><div class="text-7xl mb-2">🏎️</div>' +
            '<h3 class="text-3xl font-bold text-green-600">Multiplayer</h3>' +
            '<p class="text-gray-500 font-bold">2–5 players · first to ' + DG.normalizeQuestionCount(DG.readSettings().questionCount) + ' correct · highest composite score wins</p>' +
            '<p class="text-sm font-bold text-orange-600 mt-1">Challenge: ' + DG.esc(DG.MODE_LABEL[mode] || '') + ' · ' + DG.normalizeQuestionCount(DG.readSettings().questionCount) + ' questions</p></div>' +
            '<div class="dg-menu-panel">' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
            '<div class="dg-mp-box"><h4 class="font-bold text-green-700 mb-2">Create a room</h4>' +
            '<p class="text-sm text-gray-500 mb-4">You are the host. Invite 1–4 friends, then start when everyone is in.</p>' +
            '<button type="button" class="btn-paw w-full" onclick="DG.mpCreate()">Create room</button></div>' +
            '<div class="dg-mp-box"><h4 class="font-bold text-green-700 mb-2">Join a room</h4>' +
            '<p class="text-sm text-gray-500 mb-3">Enter the 4-character room code.</p>' +
            '<div class="flex gap-2">' +
            '<input id="dg-join-code" type="text" inputmode="latin" autocomplete="off" maxlength="4" placeholder="CODE" ' +
            'class="dg-code-input" onkeydown="if(event.key===\'Enter\'){event.preventDefault();DG.mpJoin();}" aria-label="Room code">' +
            '<button type="button" class="dg-menu-button" onclick="DG.mpJoin()">Join</button></div></div>' +
            '</div>' +
            '<div id="dg-mp-status" class="dg-note hidden mt-4"></div>' +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-5">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showModeStep()">← Game mode</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showChallengeStep()">← Challenge</button>' +
            '</div>';
    };

    DG.mpSetStatus = function (text, warn) {
        const el = document.getElementById('dg-mp-status');
        if (!el) return;
        el.textContent = text;
        el.classList.remove('hidden');
        el.classList.toggle('warn', !!warn);
        el.classList.toggle('ok', !warn);
    };

    /* ---------------- create / join ---------------- */

    DG.mpLookArgs = function () {
        const l = DG.currentLook();
        return { p_cat: l.cat, p_glasses: l.glasses, p_hat: l.hat, p_outfit: l.outfit };
    };

    DG.mpCreate = function () {
        if (MP.leaving) return;
        DG.mpSetStatus('Creating room…', false);
        const settings = DG.readSettings();
        const mode = settings.bankMode;
        const args = Object.assign({
            p_question_mode: mode,
            p_question_count: DG.normalizeQuestionCount(settings.questionCount)
        }, DG.mpLookArgs());
        sb.rpc('create_drive_and_go_room', args).then(({ data, error }) => {
            if (error) {
                if (DG.mpIsSqlMissing(error) || DG.mpIsQuestionCountSqlMissing(error)) {
                    DG.mpSetStatus('', false);
                    DG.mpShowSqlHint(error);
                } else {
                    DG.mpSetStatus(DG.mpErrorText(error), true);
                }
                return;
            }
            const room = Array.isArray(data) ? data[0] : data;
            if (!room || !room.id) {
                DG.mpSetStatus('Could not create the room. Please try again.', true);
                return;
            }
            MP.room = room;
            MP.players = [];
            MP.lastEffectSeq = 0;
            DG.mpStartLobbyPoll();
            DG.mpPoll();
        }).catch(err => {
            if (DG.mpIsSqlMissing(err) || DG.mpIsQuestionCountSqlMissing(err)) {
                DG.mpSetStatus('', false);
                DG.mpShowSqlHint(err);
            } else {
                DG.mpSetStatus(DG.mpErrorText(err), true);
            }
        });
    };

    DG.mpJoin = function () {
        if (MP.leaving) return;
        const input = document.getElementById('dg-join-code');
        const code = clean(input && input.value).toUpperCase();
        if (!/^[A-Z0-9]{4}$/.test(code)) {
            DG.mpSetStatus('Enter the 4-character room code.', true);
            return;
        }
        DG.mpSetStatus('Joining room ' + code + '…', false);
        const args = Object.assign({ p_code: code }, DG.mpLookArgs());
        sb.rpc('join_drive_and_go_room', args).then(({ data, error }) => {
            if (error) {
                DG.mpSetStatus(DG.mpIsSqlMissing(error)
                    ? 'Multiplayer needs the teacher to run supabase/drive_and_go.sql.'
                    : DG.mpErrorText(error), true);
                return;
            }
            const room = Array.isArray(data) ? data[0] : data;
            if (!room || !room.id) {
                DG.mpSetStatus('Could not join that room.', true);
                return;
            }
            MP.room = room;
            MP.players = [];
            MP.lastEffectSeq = 0;
            DG.mpStartLobbyPoll();
            DG.mpPoll();
        }).catch(err => {
            DG.mpSetStatus(DG.mpIsSqlMissing(err) ? 'Multiplayer needs the teacher to run supabase/drive_and_go.sql.' : DG.mpErrorText(err), true);
        });
    };

    /* ---------------- lobby ---------------- */

    DG.mpStartLobbyPoll = function () {
        DG.mpStopPoll();
        MP.pollId = setInterval(() => DG.mpPoll(), 1000);
    };

    DG.mpStopPoll = function () {
        if (MP.pollId) clearInterval(MP.pollId);
        MP.pollId = null;
        MP.polling = false;
    };

    DG.mpPoll = function () {
        if (!MP.room || MP.polling || MP.leaving) return;
        MP.polling = true;
        const roomId = MP.room.id;
        Promise.all([
            sb.from('drive_and_go_rooms').select('*').eq('id', roomId).maybeSingle(),
            sb.from('drive_and_go_players').select('*').eq('room_id', roomId).order('created_at', { ascending: true })
        ]).then(([roomRes, playerRes]) => {
            MP.polling = false;
            if (!MP.room || MP.room.id !== roomId) return;
            if (roomRes.error || playerRes.error) {
                const err = roomRes.error || playerRes.error;
                if (DG.mpIsSqlMissing(err)) {
                    DG.mpStopPoll();
                    const content = DG.menuContent();
                    if (content) content.innerHTML = DG.mpSqlHintHTML() +
                        '<div class="text-center mt-5"><button type="button" class="dg-menu-button" onclick="DG.showModeStep()">Back</button></div>';
                } else {
                    DG.toastSafe('Room sync failed: ' + DG.mpErrorText(err));
                }
                return;
            }
            const room = roomRes.data;
            const players = playerRes.data || [];
            if (!room) {
                DG.mpStopPoll();
                DG.showMultiplayerMenu();
                DG.mpSetStatus('That room has closed. Create a new one or join another code.', true);
                return;
            }
            MP.room = room;
            MP.players = players;
            const me = currentUser && currentUser.id;
            if (room.status === 'waiting' && !players.some(p => p.user_id === me)) {
                DG.mpStopPoll();
                DG.showMultiplayerMenu();
                DG.mpSetStatus('You are no longer in that room.', true);
                return;
            }
            if (room.status === 'playing') {
                DG.mpStopPoll();
                if (!DG.raceState.active) DG.mpBeginRace();
                return;
            }
            if (room.status === 'finished') {
                DG.mpStopPoll();
                if (DG.raceState.active) DG.showMultiplayerResults(room, players);
                else DG.mpShowFinishedInLobby(room, players);
                return;
            }
            DG.mpRenderLobby();
        }).catch(err => {
            MP.polling = false;
            if (DG.mpIsSqlMissing(err)) {
                DG.mpStopPoll();
                DG.toastSafe('Multiplayer needs the teacher to run supabase/drive_and_go.sql.');
            }
        });
    };

    DG.mpRenderLobby = function () {
        if (!MP.room) return;
        if (typeof DG.mpState !== 'undefined' && DG.raceState.active) return;
        const content = DG.menuContent();
        if (!content) return;
        const view = document.getElementById('grammar-detail-view');
        if (!view || view.classList.contains('hidden')) return;
        const room = MP.room;
        const players = MP.players || [];
        const me = currentUser && currentUser.id;
        const isHost = room.host_id === me;
        const canStart = players.length >= 2 && players.length <= 5;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const cards = players.map(p => {
            const look = DG.normalizeLook({ cat: p.cat, glasses: p.glasses, hat: p.hat, outfit: p.outfit });
            return '<div class="dg-lobby-player' + (p.user_id === me ? ' me' : '') + '">' +
                '<div class="dg-lobby-avatar">' + DG.catAvatarSVG(look, 62) + '</div>' +
                '<div class="min-w-0"><p class="font-bold text-gray-700 truncate">' + DG.esc(DG.mpPlayerName(p)) + '</p>' +
                '<p class="text-xs text-gray-400 truncate">' + (p.user_id === room.host_id ? 'Host' : 'Racer') + ' · ' + DG.esc(DG.lookName(look)) + '</p></div>' +
                '</div>';
        }).join('');
        content.innerHTML =
            '<div class="text-center mb-4"><div class="text-7xl mb-1">🏁</div>' +
            '<h3 class="text-3xl font-bold text-green-600">Race lobby</h3>' +
            '<p class="text-gray-500 font-bold">' + DG.esc(DG.MODE_LABEL[room.question_mode] || '') + ' · ' + DG.normalizeQuestionCount(room.question_count) + ' questions</p></div>' +
            '<div class="dg-room-code-wrap"><span>Room code</span><b>' + DG.esc(room.code) + '</b>' +
            '<button type="button" class="dg-menu-button" onclick="DG.mpCopyCode()">Copy</button></div>' +
            '<p class="text-center text-sm font-bold text-gray-500 mb-4">Players ' + players.length + '/5 · share this code with 1–4 friends</p>' +
            '<div class="dg-lobby-grid mb-5">' + cards + '</div>' +
            (isHost
                ? '<div class="text-center"><button type="button" class="btn-paw' + (canStart ? '' : ' opacity-50') + '" ' +
                  (canStart ? 'onclick="DG.mpStart()"' : 'disabled') + '>' +
                  (canStart ? 'Start race (' + players.length + ' players)' : 'Waiting for 1 more player…') + '</button></div>'
                : '<p class="text-center font-bold text-orange-600 animate-pulse">Waiting for the host to start…</p>') +
            '<div class="flex gap-3 justify-center flex-wrap mt-5">' +
            '<button type="button" class="dg-menu-button" onclick="DG.mpLeave()">Leave room</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.mpSetStatus(\'Room code: ' + DG.esc(room.code) + '\', false)">Refresh</button>' +
            '</div>' +
            '<div id="dg-mp-status" class="dg-note hidden mt-4"></div>';
    };

    DG.mpCopyCode = function () {
        if (!MP.room) return;
        const code = MP.room.code;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(() => DG.mpSetStatus('Room code copied: ' + code, false)).catch(() => DG.mpSetStatus('Room code: ' + code, false));
        } else {
            DG.mpSetStatus('Room code: ' + code, false);
        }
    };

    DG.mpStart = function () {
        if (!MP.room || MP.room.host_id !== (currentUser && currentUser.id)) return;
        if (MP.players.length < 2) {
            DG.mpSetStatus('A race needs at least 2 players.', true);
            return;
        }
        if (MP.players.length > 5) {
            DG.mpSetStatus('A race can have at most 5 players.', true);
            return;
        }
        DG.mpSetStatus('Starting race…', false);
        sb.rpc('start_drive_and_go_room', { p_room_id: MP.room.id }).then(({ data, error }) => {
            if (error) {
                DG.mpSetStatus(DG.mpIsSqlMissing(error) ? 'Run supabase/drive_and_go.sql first.' : DG.mpErrorText(error), true);
                return;
            }
            const room = Array.isArray(data) ? data[0] : data;
            if (room) MP.room = room;
            DG.mpStopPoll();
            DG.mpBeginRace();
        }).catch(() => DG.mpSetStatus('Could not start the race. Please try again.', true));
    };

    DG.mpBeginRace = function (force) {
        if (MP.beginning || !MP.room) return;
        MP.beginning = true;
        const room = MP.room;
        DG.mpStopPoll();
        DG.showLoading('Loading the race questions…');
        DG.loadBank(room.question_mode, !!force).then(() => {
            MP.beginning = false;
            DG.startRace({
                mode: 'multi',
                bankMode: room.question_mode,
                seed: Number(room.seed),
                room: room,
                players: MP.players
            });
        }).catch(err => {
            MP.beginning = false;
            DG.mpShowStartError(room, err);
        });
    };

    DG.mpShowStartError = function (room, err) {
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        content.innerHTML =
            '<div class="text-center mb-4"><div class="text-7xl mb-2">📡</div>' +
            '<h3 class="text-3xl font-bold text-orange-600">Could not start the race</h3></div>' +
            '<div class="dg-menu-panel text-center"><p class="font-bold text-gray-600 mb-2">The question bank did not load.</p>' +
            '<p class="text-sm text-gray-500 mb-5">' + DG.esc(err && err.message ? err.message : 'Please check your connection.') + '</p>' +
            '<div class="flex gap-3 justify-center flex-wrap">' +
            '<button type="button" class="btn-paw" onclick="DG.mpBeginRace(true)">Retry</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.mpLeave()">Leave room</button>' +
            '</div></div>';
    };

    DG.mpShowFinishedInLobby = function (room, players) {
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const rows = DG.rankMultiplayerRows(players);
        const n = DG.normalizeQuestionCount(room && room.question_count);
        const winner = rows.find(r => r.user_id === room.winner_id) || rows[0];
        const points = (r) => (r.composite_score != null ? r.composite_score : r.score) || 0;
        const acc = (r) => {
            const c = Number(r.correct) || 0, w = Number(r.wrong) || 0;
            return DG.formatAccuracy((c + w) ? c / (c + w) : 0);
        };
        content.innerHTML =
            '<div class="text-center mb-4"><div class="text-7xl mb-2">🏆</div>' +
            '<h3 class="text-3xl font-bold text-amber-600">' + DG.esc((winner && DG.mpPlayerName(winner)) || 'Race') + ' wins!</h3>' +
            '<p class="text-sm font-bold text-gray-500">Highest composite score after ' + n + ' correct answers.</p></div>' +
            '<div class="dg-menu-panel"><div class="dg-standings">' + rows.map((r, i) =>
                '<div class="dg-standing' + (r.user_id === room.winner_id ? ' me' : '') + '"><span class="dg-medal">' +
                (i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : (i + 1) + '.'))) + '</span>' +
                '<span class="dg-who">' + DG.esc(DG.mpPlayerName(r)) + '</span>' +
                '<span class="dg-points">' + points(r) + ' pts</span>' +
                '<span class="dg-dist">' + acc(r) + '</span></div>').join('') + '</div>' +
            '<div class="text-center mt-5"><button type="button" class="btn-paw" onclick="DG.exitRace()">Back to Tenses</button></div></div>';
    };

    /* ---------------- leaving ---------------- */

    DG.mpLeave = function () {
        if (!MP.room) {
            DG.showMultiplayerMenu();
            return;
        }
        if (!window.confirm('Leave this room?')) return;
        const roomId = MP.room.id;
        MP.leaving = true;
        DG.mpStopPoll();
        DG.mpStopRacePoll();
        sb.rpc('leave_drive_and_go_room', { p_room_id: roomId }).then(() => {
            MP.leaving = false;
            MP.room = null;
            MP.players = [];
            DG.stopRace();
            DG.showMultiplayerMenu();
        }, () => {
            MP.leaving = false;
            MP.room = null;
            MP.players = [];
            DG.stopRace();
            DG.showMultiplayerMenu();
        });
    };

    DG.mpLeaveRace = function () {
        if (!MP.room) {
            DG.exitRace();
            return;
        }
        if (!window.confirm('Leave this race? Your progress will not count.')) return;
        const roomId = MP.room.id;
        MP.leaving = true;
        DG.mpStopRacePoll();
        DG.mpStopPoll();
        sb.rpc('leave_drive_and_go_room', { p_room_id: roomId }).then(() => {
            MP.leaving = false;
            MP.room = null;
            MP.players = [];
            DG.stopRace();
            changeView('grammar-revision-view');
        }, () => {
            MP.leaving = false;
            MP.room = null;
            MP.players = [];
            DG.stopRace();
            changeView('grammar-revision-view');
        });
    };

    /* Called by changeView when the player leaves the lobby/race view.
       Fire-and-forget; never leaves the branch waiting on a network call. */
    DG.mpAbandon = function () {
        const room = MP.room;
        DG.mpStopPoll();
        DG.mpStopRacePoll();
        MP.room = null;
        MP.players = [];
        MP.lastEffectSeq = 0;
        if (!room) return;
        try {
            sb.rpc('leave_drive_and_go_room', { p_room_id: room.id }).then(() => {}, () => {});
        } catch (e) {}
    };

    /* ---------------- race sync ---------------- */

    DG.mpStartRacePoll = function () {
        DG.mpStopRacePoll();
        MP.lastEffectSeq = 0;
        MP.racePollId = setInterval(() => DG.mpSyncRace(), 700);
        setTimeout(() => DG.mpSyncRace(), 350);
    };

    DG.mpStopRacePoll = function () {
        if (MP.racePollId) clearInterval(MP.racePollId);
        MP.racePollId = null;
        MP.syncing = false;
    };

    DG.toastSafe = function (text) {
        if (typeof DG.toast === 'function') DG.toast(text, 2600);
        else console.warn(text);
    };

    DG.mpSyncRace = function () {
        if (!MP.room || MP.syncing || MP.leaving) return;
        if (!DG.raceState.active || DG.raceState.mode !== 'multi') return;
        const roomId = MP.room.id;
        const me = currentUser && currentUser.id;
        const p = DG.raceState.player;
        if (!p || !me) return;
        MP.syncing = true;
        const patch = DG.mpPlayerPatch(p);
        sb.from('drive_and_go_players').update(patch)
            .eq('room_id', roomId).eq('user_id', me)
            .then(() => Promise.all([
                sb.from('drive_and_go_rooms').select('*').eq('id', roomId).maybeSingle(),
                sb.from('drive_and_go_players').select('*').eq('room_id', roomId).order('created_at', { ascending: true })
            ])).then(([roomRes, playerRes]) => {
                MP.syncing = false;
                if (roomRes.error || playerRes.error) {
                    const err = roomRes.error || playerRes.error;
                    if (DG.mpIsSqlMissing(err) && Date.now() - MP.lastSyncWarn > 6000) {
                        MP.lastSyncWarn = Date.now();
                        DG.toastSafe(DG.mpIsQuestionCountSqlMissing(err)
                            ? 'Run supabase/drive_and_go_question_count.sql to sync scores.'
                            : 'Multiplayer needs supabase/drive_and_go.sql to sync.');
                    }
                    return;
                }
                const room = roomRes.data;
                const players = playerRes.data || [];
                if (room) MP.room = room;
                MP.players = players;
                DG.mpSyncRivals(players);
                const selfRow = players.find(x => x.user_id === me);
                if (selfRow) DG.mpReadOwnEffect(selfRow);
                if (room && room.status === 'finished') {
                    DG.showMultiplayerResults(room, players);
                }
            }).catch(() => {
                MP.syncing = false;
                if (Date.now() - MP.lastSyncWarn > 8000) {
                    MP.lastSyncWarn = Date.now();
                    DG.toastSafe('Multiplayer sync lost — check your connection.');
                }
            });
    };

    DG.mpReadOwnEffect = function (row) {
        const seq = Number(row.effect_seq) || 0;
        if (!seq || seq <= MP.lastEffectSeq) return;
        MP.lastEffectSeq = seq;
        const until = row.effect_until ? Date.parse(row.effect_until) : 0;
        const remaining = until ? Math.max(0, Math.min(6, (until - Date.now()) / 1000)) : 0;
        if (remaining <= 0) return;
        if (row.effect_kind === 'spin' || row.effect_kind === 'slow') {
            DG.receiveEffect(row.effect_kind, remaining);
        }
    };

    DG.mpApplyEffect = function (targetId, kind, ms) {
        if (!MP.room || !targetId) return;
        if (kind !== 'spin' && kind !== 'slow') return;
        try {
            sb.rpc('apply_drive_and_go_effect', {
                p_room_id: MP.room.id,
                p_target: targetId,
                p_kind: kind,
                p_ms: Math.max(100, Math.floor(ms || 1500))
            }).then(() => {}, () => {});
        } catch (e) {}
    };

    DG.mpCrossFinish = function () {
        if (!MP.room) return;
        const roomId = MP.room.id;
        const me = currentUser && currentUser.id;
        const patch = DG.mpPlayerPatch();
        const finish = () => {
            try {
                sb.rpc('cross_drive_and_go_finish', { p_room_id: roomId }).then(() => {}, () => {});
            } catch (e) {}
        };
        if (!me) {
            finish();
            return;
        }
        try {
            sb.from('drive_and_go_players').update(patch)
                .eq('room_id', roomId).eq('user_id', me)
                .then(finish, finish);
        } catch (e) {
            finish();
        }
    };

    // The 3-minute time-up rule was removed. Kept as a no-op so an old
    // caller cannot apply the previous "highest score at 3 minutes" finish.
    DG.mpTimeUp = function () {};
})();

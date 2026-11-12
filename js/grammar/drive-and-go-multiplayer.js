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
        leaving: false,
        boardRoomId: null,
        // Join settling: a freshly joined player keeps ownership of their room
        // for a short window. A passive view change (token refresh, accidental
        // navigation) in that window must not call leave_drive_and_go_room and
        // delete their player row, which is what used to eject joiners.
        joinedAt: 0,
        joinCode: '',
        missingMePolls: 0,
        rejoining: false,
        closed: false,
        detachTimer: 0
    };
    DG.mpState = MP;

    const JOIN_SETTLE_MS = 12000;
    const MISSING_ME_LIMIT = 3;

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
        if (kind === 'scene') {
            return '<div class="dg-note warn text-left"><b>Multiplayer needs an updated SQL file.</b><br>' +
                'The teacher must run <code>supabase/drive_and_go_scenes_and_boards.sql</code> in the Supabase SQL editor ' +
                '(after <code>drive_and_go_question_count.sql</code>). It adds the course (<code>scene</code>) and the ' +
                'new Solo / Multi leaderboards. A fresh setup can paste <code>supabase/drive_and_go.sql</code> instead. ' +
                'Single Player works without it.</div>';
        }
        if (kind === 'question_count') {
            return '<div class="dg-note warn text-left"><b>Multiplayer needs an updated SQL file.</b><br>' +
                'The teacher must run <code>supabase/drive_and_go_question_count.sql</code> in the Supabase SQL editor ' +
                '(if Drive &amp; Go! rooms already exist). A fresh setup can paste <code>supabase/drive_and_go.sql</code> instead. ' +
                'Single Player works without it.</div>';
        }
        return '<div class="dg-note warn text-left"><b>Multiplayer needs one SQL file.</b><br>' +
            'The teacher must run <code>supabase/drive_and_go.sql</code> once in the Supabase SQL editor. ' +
            'If rooms already exist and question counts / courses fail, also run ' +
            '<code>supabase/drive_and_go_question_count.sql</code> then <code>supabase/drive_and_go_scenes_and_boards.sql</code>. ' +
            'Single Player works without it.</div>';
    };

    DG.mpIsSceneSqlMissing = function (error) {
        const text = [error && error.code, error && error.message, error && error.details, error && error.hint]
            .filter(Boolean).join(' ');
        return /p_scene|column .*\.?scene\b|relation .*drive_and_go_(?:solo|multi)_scores/i.test(text)
            || (/PGRST202/i.test(text) && /p_scene/i.test(text));
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

    /* Compact corner board for the multiplayer race. Pure so the unit tests
       can check ordering / fractions / local highlight without a browser.
       The race ends at N correct answers, so the primary bar is correct / N.
       Track distance is only a secondary cue (shown as metres). Finished
       racers are dropped from the "remaining" list; the caller can show how
       many have finished. */
    DG.mpProgressBoard = function (players, opts) {
        const o = opts || {};
        const total = Math.max(1, Math.floor(Number(o.questionCount) || 20));
        const meId = o.meId || '';
        const all = (players || []).filter(p => p && (p.user_id || p.email || p.nickname)).map(p => {
            const correct = Math.max(0, Math.min(total, Math.floor(Number(p.correct) || 0)));
            const distance = Math.max(0, Math.floor(Number(p.distance) || 0));
            const finished = !!p.finished_at || correct >= total;
            const fraction = finished ? 1 : Math.max(0, Math.min(1, correct / total));
            const percent = Math.round(fraction * 100);
            return {
                userId: p.user_id || '',
                name: DG.mpPlayerName(p),
                correct: correct,
                total: total,
                distance: distance,
                fraction: fraction,
                percent: percent,
                barWidth: percent,
                finished: finished,
                isMe: !!meId && p.user_id === meId
            };
        });
        const remaining = all.filter(r => !r.finished)
            .sort((a, b) => (b.correct - a.correct) || (b.distance - a.distance) || a.name.localeCompare(b.name));
        return {
            visible: o.mode !== 'single' && all.length > 0,
            total: total,
            rows: remaining,
            finished: all.filter(r => r.finished),
            finishedCount: all.filter(r => r.finished).length,
            remainingCount: remaining.length,
            me: all.find(r => r.isMe) || null
        };
    };

    DG.mpProgressHTML = function (board) {
        if (!board || !board.visible || !board.rows.length) return '';
        return '<h4>Race to ' + board.total + ' correct</h4>' +
            board.rows.map(r =>
                '<div class="dg-race-row' + (r.isMe ? ' me' : '') + '">' +
                '<span class="dg-race-name">' + DG.esc(r.name) + (r.isMe ? ' (you)' : '') + '</span>' +
                '<span class="dg-race-count">' + r.correct + '/' + r.total + '</span>' +
                '<span class="dg-race-bar"><i style="width:' + Math.max(0, Math.min(100, r.barWidth)) + '%"></i></span>' +
                '<span class="dg-race-dist">' + r.distance + ' m</span>' +
                '</div>').join('') +
            (board.finishedCount
                ? '<div class="dg-race-more">' + board.finishedCount + ' finished</div>'
                : '');
    };

    /* Decide what a poll result means without ever navigating the site. The
       join/lobby/race flow is driven by view-local renders only, so a room
       update can never bounce a joiner back to the Hub (or the pre-race step). */
    DG.mpRoomUpdatePlan = function (room, players, ctx) {
        const c = ctx || {};
        const meId = c.meId || '';
        const list = players || [];
        const isMember = c.isMember == null
            ? list.some(p => p && p.user_id === meId)
            : !!c.isMember;
        const missing = Math.max(0, Number(c.missingMePolls) || 0);
        const raceActive = !!c.raceActive;

        if (!room) {
            if (missing + 1 < MISSING_ME_LIMIT) {
                return { kind: 'wait', navigate: false, missingMePolls: missing + 1 };
            }
            return { kind: 'closed', navigate: false, missingMePolls: 0 };
        }
        if (!isMember && (room.status === 'waiting' || room.status === 'playing')) {
            if (missing + 1 < MISSING_ME_LIMIT) {
                return { kind: 'wait', navigate: false, missingMePolls: missing + 1 };
            }
            return { kind: 'rejoin', navigate: false, missingMePolls: 0 };
        }
        if (room.status === 'playing') {
            return { kind: raceActive ? 'sync' : 'begin', navigate: false, missingMePolls: 0 };
        }
        if (room.status === 'finished') {
            return { kind: raceActive ? 'results' : 'results-lobby', navigate: false, missingMePolls: 0 };
        }
        return { kind: 'lobby', navigate: false, missingMePolls: 0 };
    };

    DG.mpIsSettling = function () {
        return !!MP.joinedAt && (Date.now() - MP.joinedAt) < JOIN_SETTLE_MS;
    };

    // Explicit leave is always allowed; passive view churn during join
    // settling keeps the room so the joiner is not deleted from it.
    DG.mpCanAbandon = function () {
        return !DG.mpIsSettling();
    };

    // Stop polling but keep the joined seat while the settle window runs. If
    // the player really did leave (they never come back to the lobby), the
    // seat is released when the window expires.
    DG.mpDetachDuringSettle = function () {
        DG.mpStopPoll();
        if (MP.detachTimer) clearTimeout(MP.detachTimer);
        const remaining = Math.max(0, JOIN_SETTLE_MS - (Date.now() - MP.joinedAt)) + 80;
        MP.detachTimer = setTimeout(() => {
            MP.detachTimer = 0;
            if (MP.room && !DG.mpIsSettling()) DG.mpAbandon();
        }, remaining);
    };

    DG.mpCancelDetach = function () {
        if (MP.detachTimer) clearTimeout(MP.detachTimer);
        MP.detachTimer = 0;
    };

    /* Re-opening Drive & Go while a joined room is still held (for example
       after the passive view change the settle window protects) drops the
       player back into their lobby instead of the Solo / Multiplayer step. */
    DG.mpResumeRoom = function () {
        if (!MP.room || MP.leaving || MP.closed) return false;
        DG.mpCancelDetach();
        DG.sessionMode = 'multi';
        const me = currentUser && currentUser.id;
        DG.mpRole = MP.room.host_id === me ? 'create' : 'join';
        DG.mpStartLobbyPoll();
        DG.mpPoll();
        return true;
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

    /* One finished Multiplayer row per signed-in, non-guest racer. Called from
       the room results screen, where the place / player count are known.
       Fire-and-forget: a missing table only shows the SQL hint. */
    DG.mpSubmitMultiBoard = function (room, players) {
        if (!room || !room.id) return;
        if (MP.boardRoomId === room.id) return;
        const me = currentUser && currentUser.id;
        if (!me) return;
        const rows = DG.rankMultiplayerRows(players);
        const mine = rows.find(r => r && r.user_id === me);
        if (!mine) return;
        MP.boardRoomId = room.id;
        const correct = Number(mine.correct) || 0;
        const wrong = Number(mine.wrong) || 0;
        const n = DG.normalizeQuestionCount(room.question_count);
        const elapsed = (Number(mine.elapsed_ms) || 0) / 1000;
        const composite = Number(mine.composite_score != null ? mine.composite_score : mine.score) || 0;
        const raceScore = Number(mine.score) || 0;
        DG.submitCloudRun('multi', {
            bankMode: room.question_mode,
            questionCount: n,
            scene: room.scene,
            composite: composite,
            raceScore: raceScore,
            timeBonus: Math.max(0, composite - raceScore) || DG.timeBonus(elapsed, n),
            correct: correct,
            wrong: wrong,
            accuracy: (correct + wrong) ? correct / (correct + wrong) : 0,
            elapsed: elapsed
        }, {
            room_id: room.id,
            place: rows.indexOf(mine) + 1,
            player_count: rows.length
        });
    };

    DG.mpShowSqlHint = function (error) {
        const kind = DG.mpIsSceneSqlMissing(error) ? 'scene'
            : (DG.mpIsQuestionCountSqlMissing(error) ? 'question_count' : '');
        const content = DG.menuContent();
        const status = document.getElementById('dg-mp-status');
        if (status && content) status.outerHTML = DG.mpSqlHintHTML(kind);
        else if (typeof DG.toastSafe === 'function') {
            DG.toastSafe(kind === 'scene'
                ? 'Run supabase/drive_and_go_scenes_and_boards.sql in the Supabase SQL editor.'
                : (kind === 'question_count'
                    ? 'Run supabase/drive_and_go_question_count.sql in the Supabase SQL editor.'
                    : 'Run supabase/drive_and_go.sql in the Supabase SQL editor.'));
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
        DG.sessionMode = 'multi';
        DG.mpRole = '';
        DG.showMultiplayerEntryStep();
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
            '<button type="button" class="btn-paw" onclick="DG.launchSolo()">Play Single Player</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showSessionStep()">Back</button>' +
            '</div></div>';
    };

    // Kept as an alias. Leaving a room returns to the Create / Join step, not
    // to a second copy of the old settings summary.
    DG.showMultiplayerMenu = function () {
        DG.showMultiplayerEntryStep();
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
        // The host finishes the settings steps before this runs, so the room
        // is created with the challenge, question count and course they chose.
        DG.sessionMode = 'multi';
        DG.mpRole = 'create';
        DG.mpSetStatus('Creating room…', false);
        const settings = DG.readSettings();
        const mode = settings.bankMode;
        const args = Object.assign({
            p_question_mode: mode,
            p_question_count: DG.normalizeQuestionCount(settings.questionCount),
            p_scene: DG.normalizeScene(settings.scene)
        }, DG.mpLookArgs());
        sb.rpc('create_drive_and_go_room', args).then(({ data, error }) => {
            if (error) {
                if (DG.mpIsSqlMissing(error) || DG.mpIsSceneSqlMissing(error) || DG.mpIsQuestionCountSqlMissing(error)) {
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
            MP.boardRoomId = null;
            MP.closed = false;
            MP.missingMePolls = 0;
            MP.rejoining = false;
            MP.joinCode = clean(room.code) || MP.joinCode;
            // Same settle window as a joiner: a passive view change just after
            // creating the room must not delete the host's seat.
            MP.joinedAt = Date.now();
            DG.mpStartLobbyPoll();
            DG.mpPoll();
        }).catch(err => {
            if (DG.mpIsSqlMissing(err) || DG.mpIsSceneSqlMissing(err) || DG.mpIsQuestionCountSqlMissing(err)) {
                DG.mpSetStatus('', false);
                DG.mpShowSqlHint(err);
            } else {
                DG.mpSetStatus(DG.mpErrorText(err), true);
            }
        });
    };

    DG.mpJoin = function () {
        if (MP.leaving) return;
        DG.sessionMode = 'multi';
        DG.mpRole = 'join';
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
            MP.boardRoomId = null;
            MP.closed = false;
            MP.missingMePolls = 0;
            MP.rejoining = false;
            MP.joinCode = clean(room.code) || code;
            // A joiner owns this seat for the next few seconds: a passive
            // view change must not delete the row and eject them.
            MP.joinedAt = Date.now();
            DG.mpStartLobbyPoll();
            DG.mpPoll();
        }).catch(err => {
            DG.mpSetStatus(DG.mpIsSqlMissing(err) ? 'Multiplayer needs the teacher to run supabase/drive_and_go.sql.' : DG.mpErrorText(err), true);
        });
    };

    /* ---------------- lobby ---------------- */

    DG.mpStartLobbyPoll = function () {
        if (typeof DG.mpCancelDetach === 'function') DG.mpCancelDetach();
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
                        '<div class="text-center mt-5"><button type="button" class="dg-menu-button" onclick="DG.showMultiplayerEntryStep()">Back</button></div>';
                } else {
                    DG.toastSafe('Room sync failed: ' + DG.mpErrorText(err));
                }
                return;
            }
            const room = roomRes.data;
            const players = playerRes.data || [];
            const me = currentUser && currentUser.id;
            const plan = DG.mpRoomUpdatePlan(room, players, {
                meId: me,
                missingMePolls: MP.missingMePolls,
                raceActive: !!(DG.raceState && DG.raceState.active)
            });
            MP.missingMePolls = plan.missingMePolls;
            // Never call changeView / backToTenses / showSessionStep from a
            // room update. The joiner stays in the lobby or race view.
            if (plan.kind === 'closed') {
                DG.mpShowRoomClosed();
                return;
            }
            if (plan.kind === 'wait') {
                if (MP.room) MP.room = room || MP.room;
                MP.players = players;
                DG.mpSetStatus('Syncing the room…', false);
                return;
            }
            if (plan.kind === 'rejoin') {
                DG.mpRejoinRoom();
                return;
            }
            if (!room) {
                DG.mpShowRoomClosed();
                return;
            }
            MP.room = room;
            MP.players = players;
            MP.closed = false;
            if (plan.kind === 'begin') {
                DG.mpStopPoll();
                DG.mpBeginRace();
                return;
            }
            if (plan.kind === 'sync') {
                DG.mpStopPoll();
                return;
            }
            if (plan.kind === 'results') {
                DG.mpStopPoll();
                DG.showMultiplayerResults(room, players);
                return;
            }
            if (plan.kind === 'results-lobby') {
                DG.mpStopPoll();
                DG.mpShowFinishedInLobby(room, players);
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

    /* A membership read can briefly miss the joiner's row (or the room) right
       after the join RPC. Re-enter with the same short code instead of dumping
       the player out to the Create / Join screen. */
    DG.mpRejoinRoom = function () {
        if (MP.rejoining || MP.leaving) return;
        const code = clean((MP.room && MP.room.code) || MP.joinCode).toUpperCase();
        if (!MP.room || !code) {
            DG.mpShowRoomClosed();
            return;
        }
        MP.rejoining = true;
        MP.missingMePolls = 0;
        DG.mpSetStatus('Rejoining the room…', false);
        const args = Object.assign({ p_code: code }, DG.mpLookArgs());
        sb.rpc('join_drive_and_go_room', args).then(({ data, error }) => {
            MP.rejoining = false;
            if (error) {
                MP.missingMePolls = MISSING_ME_LIMIT;
                DG.mpShowRoomClosed(error);
                return;
            }
            const room = Array.isArray(data) ? data[0] : data;
            if (!room || !room.id) {
                DG.mpShowRoomClosed();
                return;
            }
            MP.room = room;
            MP.players = [];
            MP.closed = false;
            MP.joinCode = clean(room.code) || code;
            DG.mpStartLobbyPoll();
            DG.mpPoll();
        }).catch(() => {
            MP.rejoining = false;
            MP.missingMePolls = MISSING_ME_LIMIT;
            DG.mpShowRoomClosed();
        });
    };

    /* The room truly ended (deleted / unrecoverable). Stay where the player
       is: render a local panel inside the lobby, or an overlay during a race.
       Never call changeView, so the site cannot bounce them to the Hub. */
    DG.mpShowRoomClosed = function (error) {
        DG.mpStopPoll();
        MP.closed = true;
        const detail = error ? ' ' + DG.mpErrorText(error) : '';
        if (DG.raceState && DG.raceState.active) {
            if (typeof DG.showOverlay === 'function') {
                DG.showOverlay(
                    '<div class="text-center"><div class="text-6xl mb-2">📡</div>' +
                    '<h3 class="text-2xl font-bold text-orange-600 mb-2">Room disconnected</h3>' +
                    '<p class="text-gray-500 font-bold mb-5">That room is no longer available.' + DG.esc(detail) + '</p>' +
                    '<div class="flex gap-3 justify-center flex-wrap">' +
                    '<button type="button" class="btn-paw" onclick="DG.mpRejoinRoom()">Try again</button>' +
                    '<button type="button" class="dg-menu-button" onclick="DG.exitRace()">Leave race</button>' +
                    '</div></div>'
                );
            }
            return;
        }
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        content.innerHTML =
            '<div class="text-center mb-4"><div class="text-7xl mb-2">📡</div>' +
            '<h3 class="text-3xl font-bold text-orange-600">Room closed</h3></div>' +
            '<div class="dg-menu-panel text-center">' +
            '<p class="font-bold text-gray-600 mb-2">That room is no longer available.' + DG.esc(detail) + '</p>' +
            '<p class="text-sm text-gray-500 mb-6">You can try the same room code again, or create / join another room.</p>' +
            '<div class="flex gap-3 justify-center flex-wrap">' +
            '<button type="button" class="btn-paw" onclick="DG.mpRejoinRoom()">Try again</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showMultiplayerEntryStep()">Create / Join</button>' +
            '</div></div>';
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
            '<p class="text-gray-500 font-bold">' + DG.esc(DG.MODE_LABEL[room.question_mode] || '') + ' · ' + DG.normalizeQuestionCount(room.question_count) + ' questions · ' + DG.esc(DG.sceneLabel(room.scene)) + '</p></div>' +
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
        if (typeof DG.mpSubmitMultiBoard === 'function') DG.mpSubmitMultiBoard(room, players);
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
            MP.joinedAt = 0;
            MP.joinCode = '';
            MP.missingMePolls = 0;
            MP.closed = false;
            DG.stopRace();
            DG.showMultiplayerMenu();
        }, () => {
            MP.leaving = false;
            MP.room = null;
            MP.players = [];
            MP.joinedAt = 0;
            MP.joinCode = '';
            MP.missingMePolls = 0;
            MP.closed = false;
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
            MP.joinedAt = 0;
            MP.joinCode = '';
            MP.missingMePolls = 0;
            MP.closed = false;
            DG.stopRace();
            changeView('grammar-revision-view');
        }, () => {
            MP.leaving = false;
            MP.room = null;
            MP.players = [];
            MP.joinedAt = 0;
            MP.joinCode = '';
            MP.missingMePolls = 0;
            MP.closed = false;
            DG.stopRace();
            changeView('grammar-revision-view');
        });
    };

    /* Called by changeView when the player leaves the lobby/race view.
       Fire-and-forget; never leaves the branch waiting on a network call.
       The explicit Leave buttons leave regardless of the join-settling window;
       only passive view churn is protected by DG.mpCanAbandon(). */
    DG.mpAbandon = function () {
        const room = MP.room;
        DG.mpStopPoll();
        DG.mpStopRacePoll();
        DG.mpCancelDetach();
        MP.room = null;
        MP.players = [];
        MP.lastEffectSeq = 0;
        MP.joinedAt = 0;
        MP.joinCode = '';
        MP.missingMePolls = 0;
        MP.rejoining = false;
        MP.closed = false;
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
                        DG.toastSafe(DG.mpIsSceneSqlMissing(err)
                            ? 'Run supabase/drive_and_go_scenes_and_boards.sql to sync courses and boards.'
                            : (DG.mpIsQuestionCountSqlMissing(err)
                                ? 'Run supabase/drive_and_go_question_count.sql to sync scores.'
                                : 'Multiplayer needs supabase/drive_and_go.sql to sync.'));
                    }
                    return;
                }
                const room = roomRes.data;
                const players = playerRes.data || [];
                if (room) MP.room = room;
                MP.players = players;
                DG.mpSyncRivals(players);
                if (typeof DG.updateMpProgress === 'function') DG.updateMpProgress(players);
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

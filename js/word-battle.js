/* LearniTY Dictation — Word Battle (1 v 1 and class mode) plus the
   battle admin panel. Moved verbatim out of index.html. */

        // =====================================================================
        //  WORD BATTLE (1 v 1)
        //  Both clients rebuild the *same* question list from room.seed, so the
        //  server never has to store questions. Scores are written by the
        //  client, which means a determined student could fake them — the same
        //  honesty trade-off as the rest of the site. Room joining, codes and
        //  the finished flag are enforced server-side.
        // =====================================================================
        const BATTLE_QUESTION_COUNT = 10;
        const BATTLE_TIME_MS = 20000;

        let battleRoom = null;
        let battlePlayers = [];
        let battlePollId = null;
        let battleTicker = null;
        let battleWords = [];
        let battleIdx = 0;
        let battleScore = 0;
        let battleCorrect = 0;
        let battleTotalMs = 0;
        let battleQStart = 0;
        let battleDeadline = 0;
        let battleRoundSeed = null;
        let battleDoneLocal = false;
        let battleLastAnswer = '';
        let battleLastCorrect = null;
        let battleLiveColumns = true;   // false if battle_live.sql has not been run yet
        let battleStatsEnabled = true;  // false if battle_stats.sql has not been run yet
        let battleBreakdownLoadedFor = null;
        let adminBattleRooms = [];
        const BATTLE_RESUME_KEY = 'learniTY_battle_resume';

        function battleReadResume() {
            try {
                const raw = JSON.parse(localStorage.getItem(BATTLE_RESUME_KEY) || 'null');
                if (!raw || !raw.roomId) return null;
                if (currentUser && raw.userId && raw.userId !== currentUser.id) return null;
                if (raw.savedAt && Date.now() - raw.savedAt > 7 * 24 * 3600 * 1000) {
                    localStorage.removeItem(BATTLE_RESUME_KEY);
                    return null;
                }
                return raw;
            } catch (e) { return null; }
        }

        function battleClearResume() {
            try { localStorage.removeItem(BATTLE_RESUME_KEY); } catch (e) {}
            battleRenderRejoin();
        }

        function battleSaveResume() {
            if (!battleRoom || !currentUser || !battleRoom.id) return;
            if (battleRoom.status === 'finished') { battleClearResume(); return; }
            try {
                localStorage.setItem(BATTLE_RESUME_KEY, JSON.stringify({
                    userId: currentUser.id,
                    roomId: battleRoom.id,
                    code: battleRoom.code,
                    seed: battleRoom.seed,
                    status: battleRoom.status,
                    idx: battleIdx,
                    score: battleScore,
                    correct: battleCorrect,
                    totalMs: battleTotalMs,
                    done: battleDoneLocal,
                    savedAt: Date.now()
                }));
            } catch (e) {}
            battleRenderRejoin();
        }

        function battleRenderRejoin() {
            const saved = battleReadResume();
            const battleView = document.getElementById('battle-view');
            const onBattle = !!(battleView && !battleView.classList.contains('hidden'));
            const inThatRoom = !!(saved && battleRoom && battleRoom.id === saved.roomId && onBattle);
            const show = !!(saved && saved.code && !inThatRoom);
            const banner = document.getElementById('battle-rejoin-banner');
            const codeEl = document.getElementById('battle-rejoin-code');
            const hubBtn = document.getElementById('hub-battle-rejoin');
            const hubSub = document.getElementById('hub-battle-sub');
            if (banner) banner.classList.toggle('hidden', !show);
            if (codeEl && saved) codeEl.innerText = saved.code;
            if (hubBtn) {
                hubBtn.classList.toggle('hidden', !show);
                if (show) hubBtn.innerText = '🔄 Rejoin ' + saved.code;
            }
            if (hubSub) {
                hubSub.innerText = show
                    ? ('Room ' + saved.code + ' is still open — rejoin to continue.')
                    : '1 v 1 — create a room or join with a code.';
            }
        }

        function mulberry32(a) {
            return function () {
                a |= 0; a = a + 0x6D2B79F5 | 0;
                let t = Math.imul(a ^ a >>> 15, 1 | a);
                t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            };
        }

        function battleBuildQuestions(room) {
            if (room && room.topic === NEW_VOCAB) return battleBuildVocabQuestions(room);
            const rnd = mulberry32((Number(room.seed) || 1) >>> 0);
            const usable = SHEET_NAMES.filter(n => (categories[n] || []).filter(w => w.en).length >= 5);
            let topic = room.topic;
            let pool = (categories[topic] || []).filter(w => w.en);
            if (pool.length < 5) {
                if (!usable.length) return { topic, words: [] };
                topic = usable[Math.floor(rnd() * usable.length)];
                pool = (categories[topic] || []).filter(w => w.en);
            }
            const arr = pool.slice();
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(rnd() * (i + 1));
                const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
            }
            return { topic, words: arr.slice(0, Math.min(Number(room.question_count) || BATTLE_QUESTION_COUNT, arr.length)) };
        }

        function battleNormalize(s) {
            return String(s || '').toLowerCase().trim()
                .replace(/[.,!?;:"'“”‘’()]/g, '')
                .replace(/\s+/g, ' ');
        }

        function battleErrorMessage(error) {
            const m = (error && error.message) || 'Something went wrong.';
            if (m.includes('ROOM_NOT_FOUND')) return 'No room with that code (or it has expired).';
            if (m.includes('ROOM_FULL')) return 'That room is full.';
            if (m.includes('ROOM_FINISHED')) return 'That battle has already finished.';
            if (m.includes('ROOM_ALREADY_STARTED')) return 'That battle has already started. If you arrived late, ask your teacher to run the latest supabase/battle_rejoin.sql, then use Join mid-game. If you were already in the room, use Rejoin.';
            if (m.includes('NOT_AUTHENTICATED')) return 'Please login with your school account first.';
            if (m.includes('CANNOT_START')) return 'Cannot start yet — wait for your opponent.';
            if (m.includes('NOT_A_MEMBER')) return 'You are not in that room. Use Rejoin only for a battle you already joined, or Join mid-game to enter a class battle in progress.';
            if (m.includes('NOT_TEACHER')) return 'Only the teacher account can open a class room.';
            if (m.includes('CANNOT_END')) return 'Cannot end that battle.';
            if (/does not exist|Could not find|PGRST20|42P01/i.test(m)) return 'Battle SQL is missing — run supabase/battle_question_count.sql (or the files in supabase/ in order).';
            return m;
        }

        function battleSetError(msg) {
            const el = document.getElementById('battle-error');
            if (el) el.innerText = msg || '';
        }

        function battleShowPanel(name) {
            ['lobby', 'waiting', 'play', 'result', 'class'].forEach(p => {
                const el = document.getElementById('battle-' + p);
                if (el) el.classList.toggle('hidden', p !== name);
            });
        }

        function battlePopulateTopics() {
            const sel = document.getElementById('battle-topic-select');
            if (!sel) return;
            const names = SHEET_NAMES.filter(n => (categories[n] || []).length);
            sel.innerHTML = '<option value="__random__">🎲 All topics (random)</option>' +
                names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(topicLabel(n))}</option>`).join('') +
                '<option value="New Vocab">🆕 New Vocab</option>';
            battleFillVocabForms();
            battleSyncVocabForm();
        }

        function battleFillVocabForms() {
            const sel = document.getElementById('battle-vocab-form-select');
            if (!sel) return;
            const own = isAdmin() || isGuestUser() || browsesAllVocab() ? '' : (myFormValue || ownDisplayedForm() || '');
            if (isAdmin() || browsesAllVocab()) {
                const keep = (sel.value === 'ALL' || normalizeForm(sel.value)) ? sel.value : (browsesAllVocab() ? 'ALL' : FORM_LEVELS[0].id);
                const allOpt = browsesAllVocab() ? '<option value="ALL">All forms</option>' : '';
                sel.innerHTML = allOpt + FORM_LEVELS.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
                sel.value = keep && Array.from(sel.options).some(o => o.value === keep) ? keep : (browsesAllVocab() ? 'ALL' : FORM_LEVELS[0].id);
                sel.disabled = false;
                sel.classList.remove('opacity-70');
            } else if (own) {
                sel.innerHTML = `<option value="${own}">${own}</option>`;
                sel.value = own;
                sel.disabled = true;
                sel.classList.add('opacity-70');
            } else {
                sel.innerHTML = '';
                sel.disabled = true;
            }
        }

        function battleSyncVocabForm() {
            const topic = battleTopicValue();
            const wrap = document.getElementById('battle-vocab-form-wrap');
            const hint = document.getElementById('battle-vocab-form-hint');
            const label = document.getElementById('battle-vocab-form-label');
            const isVocab = topic === NEW_VOCAB;
            if (wrap) wrap.classList.toggle('hidden', !isVocab);
            battleFillVocabForms();
            const own = isAdmin() || isGuestUser() || browsesAllVocab() ? '' : (myFormValue || ownDisplayedForm() || '');
            if (label) label.innerText = (isAdmin() || browsesAllVocab()) ? 'New Vocab form' : 'Your form';
            if (!hint) return;
            if (!isVocab || isAdmin()) {
                hint.className = 'text-sm text-amber-700 font-bold mt-2 hidden';
                hint.innerText = '';
                return;
            }
            if (isGuestUser()) {
                hint.className = 'text-sm text-amber-700 font-bold mt-2';
                hint.innerText = 'Guests can practise New Vocab in Dictation Master. Creating or joining a Word Battle room needs a school Google login.';
                return;
            }
            if (browsesAllVocab()) {
                hint.className = 'text-sm text-gray-500 font-bold mt-2';
                hint.innerText = 'Your form is Unassigned, so you can use New Vocab from every form, or pick one form for this room.';
                return;
            }
            if (!own) {
                hint.className = 'text-sm text-amber-700 font-bold mt-2';
                hint.innerText = 'Your form is not set yet, so you cannot open a New Vocab battle. Your displayed login name needs a class code such as 4C, or your teacher can assign F3, F4 or F6.';
            } else {
                hint.className = 'text-sm text-gray-500 font-bold mt-2';
                hint.innerText = 'This battle will use the ' + own + ' New Vocab bank only.';
            }
        }

        function battleTopicValue() {
            const sel = document.getElementById('battle-topic-select');
            return sel ? sel.value : '__random__';
        }

        function battleVocabForm() {
            const sel = document.getElementById('battle-vocab-form-select');
            if (isAdmin() || browsesAllVocab()) {
                const raw = sel ? sel.value : '';
                if (String(raw).toUpperCase() === 'ALL') return 'ALL';
                return normalizeForm(raw) || (browsesAllVocab() ? 'ALL' : FORM_LEVELS[0].id);
            }
            return normalizeForm(myFormValue || ownDisplayedForm() || '') || '';
        }

        function battleVocabToday() {
            const sel = document.getElementById('battle-vocab-scope');
            return !!(sel && sel.value === 'today');
        }

        function battleBuildVocabQuestions(room) {
            const rnd = mulberry32((Number(room.seed) || 1) >>> 0);
            let pool = room.vocab_words;
            if (typeof pool === 'string') {
                try { pool = JSON.parse(pool); } catch (e) { pool = []; }
            }
            pool = (Array.isArray(pool) ? pool : []).filter(w => w && String(w.en || '').trim()).map(w => ({ en: String(w.en).trim(), zh: String(w.zh || '').trim() }));
            const arr = pool.slice();
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(rnd() * (i + 1));
                const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
            }
            const n = Math.min(Number(room.question_count) || arr.length, arr.length);
            const label = 'New Vocab' + (room.vocab_form ? ' ' + room.vocab_form : '') + (room.vocab_today ? ' · today' : '');
            return { topic: label, words: arr.slice(0, n) };
        }

        async function battleAttachVocab(room) {
            const form = battleVocabForm();
            if (!form) {
                try { await sb.rpc('leave_battle', { p_room_id: room.id }); } catch (e) {}
                return battleSetError('Your form is not set yet, so you cannot start a New Vocab battle.');
            }
            const asked = battleQuestionCount();
            const todayOnly = battleVocabToday();
            const { data, error } = await sb.rpc('set_battle_vocab', { p_room_id: room.id, p_form: form, p_today_only: todayOnly });
            if (error) {
                try { await sb.rpc('leave_battle', { p_room_id: room.id }); } catch (e) {}
                const m = error.message || '';
                if (m.includes('NO_VOCAB_TODAY')) return battleSetError('No English New Vocab words were added today for ' + form + '. Use the full bank, or add the English first.');
                if (m.includes('NO_VOCAB')) return battleSetError('New Vocab for ' + form + ' has no English words yet. Chinese-only cards stay in the bank until you add the English.');
                if (isMissingSchema(m) || m.includes('BATTLE_SQL_MISSING')) return battleSetError('New Vocab battles need supabase/new_vocab.sql (re-run it after the battle SQL).');
                return battleSetError(battleErrorMessage(error));
            }
            const updated = Array.isArray(data) ? data[0] : data;
            battleAdoptRoom(updated || room);
            if (updated && updated.question_count < asked) {
                updateMascot('This room uses all ' + updated.question_count + ' ' + form + (todayOnly ? ' words added today.' : ' New Vocab words.'));
            }
            return true;
        }

        function battleStartPolling() {
            battleStopPolling();
            battlePollId = setInterval(battlePoll, 1500);
        }

        function battleStopPolling() {
            if (battlePollId) { clearInterval(battlePollId); battlePollId = null; }
            if (battleTicker) { clearInterval(battleTicker); battleTicker = null; }
        }

        async function battleEnter() {
            if (!isSignedIn()) { updateMascot('Please login to play Word Battle.'); return; }
            if (isGuestUser()) {
                battlePopulateTopics();
                battleSetError('Guests can play Word Jump here. Creating or joining a Word Battle room needs a school Google login.');
                const classEntry = document.getElementById('battle-class-entry');
                if (classEntry) classEntry.classList.add('hidden');
                const actions = document.getElementById('battle-room-actions');
                if (actions) actions.classList.add('hidden');
                const countRow = document.getElementById('battle-count-row');
                if (countRow) countRow.classList.add('hidden');
                updateMascot("Play Word Jump here. Word Battle rooms need a school Google login.");
                battleShowPanel('lobby');
                return;
            }
            if (!isAdmin()) await resolveOwnForm(true);
            battlePopulateTopics();
            const qsel = document.getElementById('battle-count-select');
            if (qsel) {
                const saved = localStorage.getItem('battle_qcount');
                if (saved && Array.from(qsel.options).some(o => o.value === saved)) qsel.value = saved;
            }
            battleSetError('');
            const classEntry = document.getElementById('battle-class-entry');
            if (classEntry) classEntry.classList.toggle('hidden', !isAdmin());
            const actions = document.getElementById('battle-room-actions');
            if (actions) actions.classList.remove('hidden');
            const countRow = document.getElementById('battle-count-row');
            if (countRow) countRow.classList.remove('hidden');
            battleRenderRejoin();
            if (battleRoom) {
                battlePoll();
                battleStartPolling();
            } else {
                battleShowPanel('lobby');
            }
        }

        function battleQuestionCount() {
            const sel = document.getElementById('battle-count-select');
            const n = sel ? parseInt(sel.value, 10) : 10;
            return [10, 15, 20].includes(n) ? n : 10;
        }

        async function battleCreateRoom() {
            battleSetError('');
            if (isGuestUser()) return battleSetError('Guests cannot create a Word Battle room. Sign in with your school Google account to play.');
            if (!currentUser) return battleSetError('Please login first.');
            if (!isAdmin()) await resolveOwnForm(true);
            const topic = battleTopicValue();
            if (topic === NEW_VOCAB && !isAdmin() && !battleVocabForm()) {
                return battleSetError('Your form is not set yet, so you cannot open a New Vocab battle. Ask your teacher to assign F3, F4 or F6, or sign in with a displayed name that includes a class code such as 4C.');
            }
            if (topic !== NEW_VOCAB && !SHEET_NAMES.some(n => (categories[n] || []).length)) {
                return battleSetError('Word bank is still loading — please wait a moment.');
            }
            const seed = Math.floor(Math.random() * 2000000000) + 1;
            const { data, error } = await sb.rpc('create_battle', {
                p_topic: topic, p_seed: seed, p_question_count: battleQuestionCount()
            });
            if (error) return battleSetError(battleErrorMessage(error));
            const room = Array.isArray(data) ? data[0] : data;
            if (!room || !room.id) return battleSetError('Could not open that room.');
            if (topic === NEW_VOCAB) return battleAttachVocab(room);
            battleAdoptRoom(data);
        }

        async function battleCreateClassRoom() {
            battleSetError('');
            if (!currentUser) return battleSetError('Please login first.');
            if (!isAdmin()) return battleSetError('Only the teacher account can open a class room.');
            const topic = battleTopicValue();
            if (topic !== NEW_VOCAB && !SHEET_NAMES.some(n => (categories[n] || []).length)) {
                return battleSetError('Word bank is still loading — please wait a moment.');
            }
            const seed = Math.floor(Math.random() * 2000000000) + 1;
            const { data, error } = await sb.rpc('create_class_battle', {
                p_topic: topic, p_seed: seed, p_max_players: 60,
                p_question_count: battleQuestionCount()
            });
            if (error) return battleSetError(battleErrorMessage(error));
            const room = Array.isArray(data) ? data[0] : data;
            if (!room || !room.id) return battleSetError('Could not open that room.');
            if (topic === NEW_VOCAB) return battleAttachVocab(room);
            battleAdoptRoom(data);
        }

        async function battleJoinRoom() {
            battleSetError('');
            if (isGuestUser()) return battleSetError('Guests cannot join a Word Battle room. Sign in with your school Google account to play.');
            if (!currentUser) return battleSetError('Please login first.');
            if (!isAdmin()) await resolveOwnForm(true);
            const input = document.getElementById('battle-code-input');
            const code = (input ? input.value : '').trim().toUpperCase();
            if (code.length !== 4) return battleSetError('Enter the 4-character room code.');
            const { data, error } = await sb.rpc('join_battle', { p_code: code });
            if (error) return battleSetError(battleErrorMessage(error));
            const room = Array.isArray(data) ? data[0] : data;
            if (!isAdmin() && !browsesAllVocab() && room && room.topic === NEW_VOCAB) {
                const own = battleVocabForm();
                const roomForm = (String(room.vocab_form || '').toUpperCase() === 'ALL') ? 'ALL' : normalizeForm(room.vocab_form || '');
                if (!own) {
                    try { await sb.rpc('leave_battle', { p_room_id: room.id }); } catch (e) {}
                    return battleSetError('Your form is not set yet, so you cannot join a New Vocab battle.');
                }
                if (roomForm && roomForm !== own) {
                    try { await sb.rpc('leave_battle', { p_room_id: room.id }); } catch (e) {}
                    return battleSetError('That New Vocab battle is for ' + roomForm + '. You can only use the ' + own + ' word bank.');
                }
            }
            battleAdoptRoom(data);
        }

        function battleAdoptRoom(data) {
            const room = Array.isArray(data) ? data[0] : data;
            if (!room || !room.id) return battleSetError('Could not open that room.');
            battleRoom = room;
            battleRoundSeed = null;
            battleDoneLocal = false;
            battlePlayers = [];
            battleSaveResume();
            battleStartPolling();
            battlePoll();
        }

        async function battlePoll() {
            if (!battleRoom || !currentUser) return;
            const { data: room, error } = await sb.from('battle_rooms')
                .select('*').eq('id', battleRoom.id).maybeSingle();
            if (error || !room) {
                battleRoom = null;
                battleStopPolling();
                battleClearResume();
                battleShowPanel('lobby');
                battleSetError('The room was closed.');
                return;
            }
            battleRoom = room;
            if (room.status === 'finished') battleClearResume();
            else battleSaveResume();
            const { data: players } = await sb.from('battle_players')
                .select('*').eq('room_id', room.id);
            battlePlayers = players || [];
            battleRender();
        }

        function battleRender() {
            if (!battleRoom) return battleShowPanel('lobby');
            const isHost = battleRoom.host_id === currentUser.id;
            const me = battlePlayers.find(p => p.user_id === currentUser.id);
            const opp = battlePlayers.find(p => p.user_id !== currentUser.id);

            // teacher watching their own class room
            if (battleRoom.mode === 'class' && isHost) {
                battleRenderClassHost();
                return;
            }

            if (battleRoom.status === 'waiting') {
                battleShowPanel('waiting');
                document.getElementById('battle-code-display').innerText = battleRoom.code;
                const chips = document.getElementById('battle-chips');
                if (battleRoom.mode === 'class') {
                    if (chips) chips.classList.add('hidden');
                    document.getElementById('battle-start-btn').classList.add('hidden');
                    document.getElementById('battle-wait-msg').innerText =
                        `${battlePlayers.length} student(s) joined — waiting for the teacher to start…`;
                } else {
                    if (chips) chips.classList.remove('hidden');
                    const hostP = battlePlayers.find(p => p.user_id === battleRoom.host_id);
                    document.getElementById('battle-host-chip').innerText = hostP ? (hostP.nickname || hostP.email) : 'Host';
                    document.getElementById('battle-guest-chip').innerText = opp ? (opp.nickname || opp.email) : 'Waiting…';
                    document.getElementById('battle-start-btn').classList.toggle('hidden', !(isHost && !!battleRoom.guest_id));
                    document.getElementById('battle-wait-msg').innerText = isHost
                        ? (battleRoom.guest_id ? 'Your opponent is in. Start when ready!' : 'Waiting for a classmate to join…')
                        : 'Waiting for the host to start…';
                }
                return;
            }

            if (battleRoom.status === 'playing') {
                if (battleRoundSeed !== battleRoom.seed) battleBeginRound();
                if (battleDoneLocal) {
                    battleShowPanel('result');
                    battleRenderResult();
                    return;
                }
                battleShowPanel('play');
                battleUpdateScoreboard();
                return;
            }

            battleShowPanel('result');
            battleRenderResult();
        }

        function battleBeginRound() {
            const built = battleBuildQuestions(battleRoom);
            if (!built.words.length) {
                battleShowPanel('play');
                document.getElementById('battle-prompt').innerText = '⚠️';
                document.getElementById('battle-feedback').innerText = battleRoom && battleRoom.topic === NEW_VOCAB
                    ? 'This room has no New Vocab list. Open a new room after the words are saved.'
                    : 'Word bank not loaded — refresh the page.';
                return;
            }
            battleRoundSeed = battleRoom.seed;
            battleWords = built.words;
            battleIdx = 0;
            battleScore = 0;
            battleCorrect = 0;
            battleTotalMs = 0;
            battleDoneLocal = false;
            battleLastAnswer = '';
            battleLastCorrect = null;
            document.getElementById('battle-topic-label').innerText = 'Topic: ' + built.topic;
            battleRestoreProgress();
            if (battleDoneLocal) {
                battleUpdateScoreboard();
                return;
            }
            battleShowQuestion();
            battleSubmitProgress(false);
        }

        function battleRestoreProgress() {
            const me = (battlePlayers || []).find(p => currentUser && p.user_id === currentUser.id);
            const saved = battleReadResume();
            const same = !!(saved && battleRoom && saved.roomId === battleRoom.id && String(saved.seed) === String(battleRoom.seed));
            let idx = 0, score = 0, correct = 0, totalMs = 0, done = false;
            if (me) {
                done = !!me.done;
                idx = (typeof me.progress === 'number') ? me.progress : 0;
                score = me.score || 0;
                correct = me.correct || 0;
                totalMs = me.total_ms || 0;
            }
            if (same && !done) {
                if ((saved.idx || 0) > idx) {
                    idx = saved.idx || 0;
                    score = saved.score || 0;
                    correct = saved.correct || 0;
                    totalMs = saved.totalMs || 0;
                    done = !!saved.done;
                }
            }
            battleIdx = Math.max(0, Math.min(idx, battleWords.length));
            battleScore = score;
            battleCorrect = correct;
            battleTotalMs = totalMs;
            battleDoneLocal = done || battleIdx >= battleWords.length;
        }

        function battleShowQuestion() {
            const w = battleWords[battleIdx];
            if (!w) return battleFinishLocal();
            document.getElementById('battle-progress').innerText = `Word ${battleIdx + 1} of ${battleWords.length}`;
            document.getElementById('battle-prompt').innerText = (w.zh || '').trim() || 'English word';
            const fb = document.getElementById('battle-feedback');
            fb.innerText = '';
            fb.className = 'text-2xl font-bold h-10 mt-4';
            const inp = document.getElementById('battle-answer');
            inp.value = '';
            inp.disabled = false;
            inp.focus();
            const btn = document.querySelector('#battle-play button[onclick="battleSubmitAnswer()"]');
            if (btn) btn.disabled = false;
            battleQStart = Date.now();
            battleDeadline = battleQStart + BATTLE_TIME_MS;
            battleUpdateScoreboard();
            battleStartTicker();
            battleSubmitProgress(false);
            battleSpeak();
        }

        function battleStartTicker() {
            if (battleTicker) clearInterval(battleTicker);
            document.getElementById('battle-clock').innerText = '20s';
            battleTicker = setInterval(() => {
                const left = Math.max(0, battleDeadline - Date.now());
                document.getElementById('battle-clock').innerText = Math.ceil(left / 1000) + 's';
                if (left <= 0) {
                    clearInterval(battleTicker);
                    battleTicker = null;
                    battleAnswerTimeout();
                }
            }, 100);
        }

        function battleUpdateScoreboard() {
            const opp = battlePlayers.find(p => p.user_id !== currentUser.id);
            const myEl = document.getElementById('battle-my-score');
            const oppEl = document.getElementById('battle-opp-score');
            if (myEl) myEl.innerText = 'You: ' + battleScore;
            if (oppEl) oppEl.innerText = 'Rival: ' + (opp ? opp.score : 0);
        }

        function battleSubmitAnswer() {
            const inp = document.getElementById('battle-answer');
            if (!inp || inp.disabled) return;
            const w = battleWords[battleIdx];
            if (!w) return;
            const elapsed = Math.min(BATTLE_TIME_MS, Date.now() - battleQStart);
            const ok = isAnswerCorrect(inp.value, w.en, battleNormalize);
            battleLastAnswer = inp.value.trim().slice(0, 60);
            battleLastCorrect = ok;
            battleRecordAnswer(battleIdx, w.en, battleLastAnswer, ok, elapsed);
            inp.disabled = true;
            if (battleTicker) { clearInterval(battleTicker); battleTicker = null; }
            const fb = document.getElementById('battle-feedback');
            if (ok) {
                const bonus = Math.round(5 * Math.max(0, battleDeadline - Date.now()) / BATTLE_TIME_MS);
                const pts = 10 + bonus;
                battleScore += pts;
                battleCorrect += 1;
                battleTotalMs += elapsed;
                fb.innerText = `✅ +${pts}`;
                fb.className = 'text-2xl font-bold h-10 mt-4 text-green-500';
            } else {
                battleTotalMs += elapsed;
                fb.innerText = `❌ ${w.en}`;
                fb.className = 'text-2xl font-bold h-10 mt-4 text-red-400';
            }
            battleUpdateScoreboard();
            battleSubmitProgress(false);
            setTimeout(battleAdvance, 1100);
        }

        function battleAnswerTimeout() {
            const inp = document.getElementById('battle-answer');
            if (!inp || inp.disabled) return;
            const w = battleWords[battleIdx];
            inp.disabled = true;
            battleTotalMs += BATTLE_TIME_MS;
            battleLastAnswer = '';
            battleLastCorrect = false;
            battleRecordAnswer(battleIdx, w.en, '', false, BATTLE_TIME_MS);
            const fb = document.getElementById('battle-feedback');
            fb.innerText = `⏰ ${w.en}`;
            fb.className = 'text-2xl font-bold h-10 mt-4 text-gray-400';
            battleUpdateScoreboard();
            battleSubmitProgress(false);
            setTimeout(battleAdvance, 900);
        }

        function battleAdvance() {
            battleIdx++;
            if (battleIdx >= battleWords.length) battleFinishLocal();
            else battleShowQuestion();
        }

        async function battleSubmitProgress(done) {
            if (!currentUser || !battleRoom) return;
            // a late "still playing" save must not overwrite the final done flag
            if (!done && battleDoneLocal) return;
            battleSaveResume();

            const base = {
                score: battleScore,
                correct: battleCorrect,
                total_ms: battleTotalMs,
                done: !!done,
                last_seen: new Date().toISOString()
            };
            if (!battleLiveColumns) return battleSaveProgress(base);

            const full = Object.assign({}, base, {
                progress: battleDoneLocal ? battleWords.length : battleIdx,
                last_answer: (battleLastAnswer || '').slice(0, 60),
                last_correct: battleLastCorrect
            });

            const { error } = await sb.from('battle_players').update(full)
                .eq('room_id', battleRoom.id).eq('user_id', currentUser.id);

            // graceful fallback: battle_live.sql not run yet
            if (error && /column|PGRST204|42703/i.test(error.message || '')) {
                battleLiveColumns = false;
                console.warn('battle live columns missing — run supabase/battle_live.sql');
                return battleSaveProgress(base);
            }
            if (error) console.warn('battle progress save failed:', error.message);
        }

        async function battleSaveProgress(payload) {
            const { error } = await sb.from('battle_players').update(payload)
                .eq('room_id', battleRoom.id).eq('user_id', currentUser.id);
            if (error) console.warn('battle progress save failed:', error.message);
        }

        async function battleRecordAnswer(qIndex, word, answer, correct, ms) {
            if (!battleStatsEnabled || !battleRoom || !currentUser) return;
            const { error } = await sb.from('battle_answers').upsert({
                room_id: battleRoom.id,
                user_id: currentUser.id,
                q_index: qIndex,
                word: word,
                answer: (answer || '').slice(0, 80),
                correct: !!correct,
                ms: ms || 0
            }, { onConflict: 'room_id,user_id,q_index' });
            if (error) {
                if (/does not exist|PGRST20|42P01/i.test(error.message || '')) {
                    battleStatsEnabled = false;
                    console.warn('battle_answers missing — run supabase/battle_stats.sql');
                } else {
                    console.warn('answer save failed:', error.message);
                }
            }
        }

        function aggregateBattleAnswers(rows) {
            const map = {};
            (rows || []).forEach(r => {
                const m = map[r.q_index] || (map[r.q_index] = { q: r.q_index, word: r.word, total: 0, correct: 0, wrongs: {} });
                m.total++;
                if (r.correct) {
                    m.correct++;
                } else {
                    const a = (r.answer || '').trim().toLowerCase();
                    if (a) m.wrongs[a] = (m.wrongs[a] || 0) + 1;
                }
            });
            return Object.values(map)
                .map(m => Object.assign({}, m, { accuracy: m.total ? Math.round((m.correct / m.total) * 100) : 0 }))
                .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
        }

        function renderAnswerStats(stats, container, questions) {
            if (!stats || !stats.length) {
                container.innerHTML = '<p class="text-gray-400 text-center py-6">No per-question data yet.</p>';
                return;
            }
            const hardest = stats[0];
            const wrongTotals = {};
            stats.forEach(s => Object.entries(s.wrongs).forEach(([w, c]) => { wrongTotals[w] = (wrongTotals[w] || 0) + c; }));
            const worst = Object.entries(wrongTotals).sort((a, b) => b[1] - a[1])[0];

            container.innerHTML = `
                <div class="flex items-start justify-between gap-3 flex-wrap mb-4">
                    <div>
                        <h3 class="text-xl font-bold text-gray-700">📊 Question breakdown</h3>
                        <p class="text-sm text-gray-400">Hardest first · only <b class="text-red-500">${hardest.accuracy}%</b> spelt
                           <b class="text-gray-700">${escapeHtml(hardest.word)}</b> correctly</p>
                    </div>
                    ${worst ? `<span class="text-xs text-gray-500 self-center">Most common misspelling: <b class="text-red-500">${escapeHtml(worst[0])}</b> (${worst[1]}×)</span>` : ''}
                </div>
                <div class="space-y-2">
                    ${stats.map(s => {
                        const zh = (questions && questions[s.q] && questions[s.q].zh) || '';
                        const wrongs = Object.entries(s.wrongs).sort((a, b) => b[1] - a[1]).slice(0, 3)
                            .map(([w, c]) => `<span class="bg-red-50 text-red-500 text-xs px-2 py-0.5 rounded-full">${escapeHtml(w)}${c > 1 ? ' ×' + c : ''}</span>`).join('');
                        const color = s.accuracy >= 70 ? 'bg-green-500' : s.accuracy >= 40 ? 'bg-amber-400' : 'bg-red-400';
                        return `<div class="bg-gray-50 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
                            <span class="text-gray-400 font-bold w-6">${s.q + 1}</span>
                            <div class="min-w-[150px]">
                                <div class="font-bold text-gray-700">${escapeHtml(s.word)}</div>
                                <div class="text-xs text-gray-400">${escapeHtml(zh)}</div>
                            </div>
                            <div class="flex items-center gap-3 flex-1 min-w-[200px]">
                                <div class="h-2 bg-gray-200 rounded-full flex-1 max-w-[220px] overflow-hidden">
                                    <div class="h-2 ${color} rounded-full" style="width:${s.accuracy}%"></div>
                                </div>
                                <span class="text-xs font-bold text-gray-600 w-10">${s.accuracy}%</span>
                                <span class="text-xs text-gray-500">${s.correct}/${s.total}</span>
                            </div>
                            <div class="flex gap-1 flex-wrap max-w-[220px]">${wrongs || '<span class="text-xs text-gray-300">no wrong answers</span>'}</div>
                        </div>`;
                    }).join('')}
                </div>`;
        }

        function renderGroupedAnswerStats(rows, players, container, questions) {
            const groups = groupRowsByForm(players || []).filter(g => g.rows.length);
            const allStats = aggregateBattleAnswers(rows);
            if (groups.length <= 1) {
                renderAnswerStats(allStats, container, questions);
                return;
            }
            const parts = [];
            const tmp = document.createElement('div');
            renderAnswerStats(allStats, tmp, questions);
            parts.push(`<section class="mb-8"><h4 class="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">All forms</h4>${tmp.innerHTML}</section>`);
            groups.forEach(g => {
                const subset = answersForForm(rows, players, g.id);
                const stats = aggregateBattleAnswers(subset);
                if (!stats.length) return;
                renderAnswerStats(stats, tmp, questions);
                parts.push(`<section class="mt-8 pt-6 border-t border-gray-100" data-form-group="${escapeHtml(g.id || 'unassigned')}">
                    <h4 class="text-lg font-bold text-gray-600 mb-3"><span class="px-3 py-1 rounded-full ${g.id ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'}">${escapeHtml(g.label)}</span></h4>
                    ${tmp.innerHTML}
                </section>`);
            });
            container.innerHTML = parts.join('');
        }

        async function battleFinishLocal() {
            if (battleDoneLocal) return;
            battleDoneLocal = true;
            if (battleTicker) { clearInterval(battleTicker); battleTicker = null; }
            document.getElementById('battle-feedback').innerText = '';
            await battleSubmitProgress(true);
            await sb.rpc('finish_battle', { p_room_id: battleRoom.id });
            await battlePoll();
        }

        function battleRenderResult() {
            if (!battleRoom) return;
            const head = document.getElementById('battle-result-headline');
            const body = document.getElementById('battle-result-body');
            const me = battlePlayers.find(p => p.user_id === currentUser.id) ||
                       { score: battleScore, correct: battleCorrect, total_ms: battleTotalMs };
            const opp = battlePlayers.find(p => p.user_id !== currentUser.id);

            if (battleRoom.mode === 'class') {
                const sorted = battlePlayers.slice()
                    .sort((a, b) => (b.score - a.score) || (a.total_ms - b.total_ms));
                const rank = sorted.findIndex(p => p.user_id === currentUser.id) + 1;
                if (!battleRoom.finished_at || battleRoom.status !== 'finished') {
                    head.innerText = '⏳ Waiting for the teacher…';
                } else if (rank === 1) {
                    head.innerText = '🥇 Class champion!';
                } else {
                    head.innerText = `#${rank} in class`;
                }
                const top = sorted.slice(0, 5).map((p, i) =>
                    `<div class="flex justify-between ${p.user_id === currentUser.id ? 'text-indigo-600 font-bold' : 'text-gray-600'}">
                        <span>${i + 1}. ${escapeHtml(p.nickname || (p.email || '').split('@')[0])}</span>
                        <span>${p.score} pts</span>
                    </div>`).join('');
                body.innerHTML = `<div class="mb-4">Your score: <b>${me.score || 0}</b> pts (${me.correct || 0}/${battleWords.length} correct)</div>
                                  <div class="max-w-sm mx-auto text-left space-y-1">${top}</div>`;
                document.getElementById('battle-rematch-btn').classList.add('hidden');
                return;
            }

            document.getElementById('battle-rematch-btn')
                .classList.toggle('hidden', battleRoom.host_id !== currentUser.id);

            if (!opp) {
                head.innerText = '🏁 Game over';
                body.innerText = 'Your score: ' + (me.score || 0) + ' pts';
            } else if (!opp.done) {
                head.innerText = '⏳ Waiting for opponent…';
                body.innerText = `You: ${me.score || 0} pts · Rival: ${opp.score || 0} pts`;
            } else {
                let verdict;
                if ((me.score || 0) > (opp.score || 0)) verdict = '🏆 You win!';
                else if ((me.score || 0) < (opp.score || 0)) verdict = '😿 You lose';
                else if ((me.total_ms || 0) < (opp.total_ms || 0)) verdict = '🏆 You win on time!';
                else if ((me.total_ms || 0) > (opp.total_ms || 0)) verdict = '😿 You lose on time';
                else verdict = '🤝 Draw!';
                head.innerText = verdict;
                body.innerHTML = `You: <b>${me.score || 0}</b> pts (${me.correct || 0}/${battleWords.length} correct)<br>` +
                                 `Rival: <b>${opp.score || 0}</b> pts (${opp.correct || 0}/${battleWords.length} correct)`;
            }
        }

        async function battleRematch() {
            const seed = Math.floor(Math.random() * 2000000000) + 1;
            const { error } = await sb.rpc('rematch_battle', { p_room_id: battleRoom.id, p_seed: seed });
            if (error) return battleSetError(battleErrorMessage(error));
            battleRoundSeed = null;
            battlePoll();
        }

        async function battleStart() {
            const { error } = await sb.rpc('start_battle', { p_room_id: battleRoom.id });
            if (error) return battleSetError(battleErrorMessage(error));
            battlePoll();
        }

        async function battleCopyCode() {
            const code = document.getElementById('battle-code-display').innerText.trim();
            try {
                await navigator.clipboard.writeText(code);
                updateMascot('Room code copied: ' + code);
            } catch (e) {
                updateMascot('Room code: ' + code);
            }
        }

        function battleSpeak() {
            const w = battleWords[battleIdx];
            if (!w) return;
            const utterance = new SpeechSynthesisUtterance(primaryAnswer(w.en));
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            speechSynthesis.cancel();
            speechSynthesis.speak(utterance);
        }

        async function battleStartClass() {
            const { error } = await sb.rpc('start_battle', { p_room_id: battleRoom.id });
            if (error) return battleSetError(battleErrorMessage(error));
            battlePoll();
        }

        async function battleEndClass() {
            const { error } = await sb.rpc('end_class_battle', { p_room_id: battleRoom.id });
            if (error) return battleSetError(battleErrorMessage(error));
            battlePoll();
        }

        async function battleCopyClassCode() {
            const code = document.getElementById('battle-class-code').innerText.trim();
            try {
                await navigator.clipboard.writeText(code);
                updateMascot('Class code copied: ' + code);
            } catch (e) {
                updateMascot('Class code: ' + code);
            }
        }

        function battleRenderClassHost() {
            battleShowPanel('class');
            if (isAdmin() && !formDirectory.loaded) {
                ensureFormDirectory().then(() => {
                    if (battleRoom && battleRoom.mode === 'class' && currentUser && battleRoom.host_id === currentUser.id) {
                        battleRenderClassHost();
                    }
                });
            }
            document.getElementById('battle-class-code').innerText = battleRoom.code;

            const total = battleRoom.question_count || 10;
            const everyone = battlePlayers.slice()
                .sort((a, b) => (b.score - a.score) || (a.total_ms - b.total_ms));
            const max = battleRoom.max_players || 60;
            const questions = battleBuildQuestions(battleRoom).words;
            const hasLive = battlePlayers.some(p => typeof p.progress === 'number');

            document.getElementById('battle-class-count').innerText =
                `${everyone.length} / ${max} joined`;

            let statusText;
            if (battleRoom.status === 'waiting') {
                statusText = 'Waiting to start';
            } else if (battleRoom.status === 'playing') {
                const dist = {};
                let done = 0;
                everyone.forEach(p => {
                    if (p.done) { done++; return; }
                    const q = Math.min(total, (p.progress || 0) + 1);
                    dist[q] = (dist[q] || 0) + 1;
                });
                const distText = Object.keys(dist)
                    .sort((a, b) => a - b)
                    .map(q => `Q${q}: ${dist[q]}`)
                    .join('  ·  ');
                statusText = `In progress  ·  ${done}/${everyone.length} finished` + (distText ? `  ·  ${distText}` : '');
            } else {
                statusText = 'Finished';
            }
            if (!hasLive && battleRoom.status === 'playing') {
                statusText += '   ·   ⚠️ run supabase/battle_live.sql for live progress';
            }
            if (battleRoom.status === 'playing') {
                statusText += '  ·  Late students can still join with this code';
            }
            document.getElementById('battle-class-status').innerText = statusText;

            document.getElementById('battle-class-start').classList.toggle('hidden', !(battleRoom.status === 'waiting' && everyone.length > 0));
            document.getElementById('battle-class-end').classList.toggle('hidden', battleRoom.status !== 'playing');
            const classLeave = document.getElementById('battle-class-leave');
            if (classLeave) classLeave.classList.toggle('hidden', battleRoom.status !== 'waiting');

            const playerCard = (p, i) => {
                    const qNow = p.done ? total : (typeof p.progress === 'number' ? Math.min(total, p.progress + 1) : null);
                    const pct = Math.round(((qNow || 0) / total) * 100);
                    const idleSec = p.updated_at
                        ? Math.max(0, Math.round((Date.now() - new Date(p.updated_at).getTime()) / 1000))
                        : null;
                    const stalled = battleRoom.status === 'playing' && !p.done && idleSec !== null && idleSec > 25;
                    const curZh = questions[(p.progress || 0)] ? questions[(p.progress || 0)].zh : '';

                    return `<div class="bg-gray-50 rounded-xl px-4 py-3 gap-3 flex flex-col md:flex-row md:items-center md:justify-between ${stalled ? 'ring-2 ring-red-200' : ''}">
                        <div class="flex items-center gap-3 min-w-[220px]">
                            <span class="text-gray-400 font-bold w-6 text-right">${i + 1}</span>
                            <div>
                                <div class="font-bold text-gray-700">${escapeHtml(p.nickname || (p.email || '').split('@')[0])}${classBadge(p.email, p.nickname)}</div>
                                <div class="text-gray-400 text-xs">${escapeHtml(p.email || '')}</div>
                            </div>
                            ${formAssignControl(p.email, p.nickname)}
                        </div>
                        <div class="flex items-center gap-3 flex-1 min-w-[180px]">
                            <span class="text-xs font-bold px-2 py-1 rounded-full ${p.done ? 'bg-green-100 text-green-600' : 'bg-indigo-100 text-indigo-600'}"
                                  title="${escapeHtml(curZh)}">${p.done ? 'DONE' : (qNow ? 'Q' + qNow : '—')}</span>
                            <div class="h-2 bg-gray-200 rounded-full flex-1 max-w-[140px] overflow-hidden">
                                <div class="h-2 bg-indigo-500 rounded-full" style="width:${pct}%"></div>
                            </div>
                            <span class="text-xs text-gray-400">${p.correct}/${total}</span>
                        </div>
                        <div class="flex items-center gap-3 text-sm">
                            ${p.last_answer
                                ? `<span class="text-xs ${p.last_correct ? 'text-green-600' : 'text-red-400'} truncate max-w-[140px]" title="${escapeHtml(p.last_answer)}">${p.last_correct ? '✅' : '❌'} ${escapeHtml(p.last_answer)}</span>`
                                : '<span class="text-xs text-gray-300">—</span>'}
                            ${stalled ? `<span class="text-xs font-bold text-red-500">idle ${idleSec}s</span>`
                                : p.done ? '' : `<span class="text-xs text-gray-400">${idleSec !== null ? idleSec + 's ago' : ''}</span>`}
                            <span class="font-bold text-indigo-600 w-16 text-right">${p.score} pts</span>
                        </div>
                    </div>`;
            };

            document.getElementById('battle-class-list').innerHTML = everyone.length
                ? renderFormSections(groupRowsByForm(everyone), (list) =>
                    `<div class="space-y-2">${list.map(playerCard).join('')}</div>`,
                    { emptyAll: '<p class="text-gray-400 text-center py-8">No students yet — share the code above.</p>' })
                : '<p class="text-gray-400 text-center py-8">No students yet — share the code above.</p>';

            // per-question accuracy, only once the round is finished
            const bd = document.getElementById('battle-class-breakdown');
            const bdKey = battleRoom.id;
            if (battleRoom.status === 'finished') {
                if (battleBreakdownLoadedFor !== bdKey) {
                    battleBreakdownLoadedFor = bdKey;
                    bd.classList.remove('hidden');
                    bd.innerHTML = '<p class="text-gray-400 text-sm text-center py-4">Loading question breakdown…</p>';
                    loadClassBreakdown();
                }
            } else {
                battleBreakdownLoadedFor = null;
                bd.classList.add('hidden');
                bd.innerHTML = '';
            }
        }

        async function loadClassBreakdown() {
            const bd = document.getElementById('battle-class-breakdown');
            const room = battleRoom;
            if (!room || !bd) return;

            const players = battlePlayers.slice();
            const { data, error } = await sb.from('battle_answers')
                .select('user_id, q_index, word, correct, answer')
                .eq('room_id', room.id);

            if (!battleRoom || battleRoom.id !== room.id) return;

            if (error) {
                const missing = /does not exist|PGRST20|42P01/i.test(error.message || '');
                bd.innerHTML = missing
                    ? '<p class="text-amber-500 text-sm text-center py-4 font-bold">Run supabase/battle_stats.sql to unlock the question breakdown.</p>'
                    : '<p class="text-red-400 text-sm text-center py-4">' + escapeHtml(error.message) + '</p>';
                return;
            }
            renderGroupedAnswerStats(data, players, bd, battleBuildQuestions(room).words);
        }

        async function battleBackToHub() {
            if (battleTicker) { clearInterval(battleTicker); battleTicker = null; }
            if (battleRoom && (battleRoom.status === 'waiting' || battleRoom.status === 'playing')) {
                battleSaveResume();
                battleStopPolling();
                changeView('hub-view');
                battleRenderRejoin();
                return;
            }
            return battleLeave();
        }

        async function battleLeaveRoom() {
            if (!battleRoom) return;
            const isHost = currentUser && battleRoom.host_id === currentUser.id;
            const waiting = battleRoom.status === 'waiting';
            const msg = waiting
                ? (isHost ? 'Close this room? Students will not be able to join it.' : 'Leave this room?')
                : 'Leave this battle?';
            if (!window.confirm(msg)) return;
            return battleLeave();
        }

        async function battleRejoin() {
            battleSetError('');
            if (isGuestUser()) return battleSetError('Guests cannot join a Word Battle room. Sign in with your school Google account to play.');
            if (!currentUser) return battleSetError('Please login first.');
            const saved = battleReadResume();
            if (!saved || !saved.roomId) return battleSetError('No battle to rejoin.');
            changeView('battle-view');
            let room = null;
            const byId = await sb.from('battle_rooms').select('*').eq('id', saved.roomId).maybeSingle();
            if (!byId.error && byId.data) room = byId.data;
            if (!room) {
                const rpc = await sb.rpc('rejoin_battle', { p_room_id: saved.roomId });
                if (!rpc.error) room = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
                else if (!/could not find|does not exist|PGRST202|42883/i.test(rpc.error.message || '')) {
                    // RPC exists but refused — show that error unless we can still try the code.
                    if (!/ROOM_NOT_FOUND|NOT_A_MEMBER/i.test(rpc.error.message || '') || !saved.code) {
                        return battleSetError(battleErrorMessage(rpc.error));
                    }
                }
            }
            if (!room && saved.code) {
                const joined = await sb.rpc('join_battle', { p_code: saved.code });
                if (joined.error) return battleSetError(battleErrorMessage(joined.error));
                room = Array.isArray(joined.data) ? joined.data[0] : joined.data;
            }
            if (!room || !room.id) {
                battleClearResume();
                return battleSetError('That room is no longer open.');
            }
            battleAdoptRoom(room);
        }

        async function battleLeave() {
            battleStopPolling();
            if (battleTicker) { clearInterval(battleTicker); battleTicker = null; }
            if (battleRoom && currentUser) {
                try { await sb.rpc('leave_battle', { p_room_id: battleRoom.id }); } catch (e) { }
            }
            battleRoom = null;
            battlePlayers = [];
            battleRoundSeed = null;
            battleDoneLocal = false;
            battleWords = [];
            battleClearResume();
            changeView('hub-view');
        }

        // A room only belongs on the dashboard once people actually met.
        // Duel: the guest joined (or the match started, which requires a guest).
        // Class: at least one student joined. A host waiting alone is not a battle.
        function battleRoomPaired(room) {
            const players = room.battle_players || [];
            if ((room.mode || 'duel') === 'class') return players.length > 0;
            if (players.length >= 2 || room.guest_id) return true;
            return (room.status === 'playing' || room.status === 'finished') && !!room.started_at;
        }


        const ADMIN_BATTLES_PREVIEW = 5;
        let adminBattlesExpanded = false;

        function setAdminBattlesExpanded(open) {
            adminBattlesExpanded = !!open;
            applyAdminBattlesCollapse();
        }

        function applyAdminBattlesCollapse() {
            const listEl = document.getElementById('battle-admin-container');
            if (!listEl) return;
            const items = listEl.querySelectorAll('[data-battle-admin-row]');
            const total = items.length;
            const canCollapse = total > ADMIN_BATTLES_PREVIEW;
            items.forEach((el, i) => {
                el.classList.toggle('hidden', canCollapse && !adminBattlesExpanded && i >= ADMIN_BATTLES_PREVIEW);
            });
            const btn = listEl.querySelector('[data-admin-battles-toggle]');
            if (!btn) return;
            if (!canCollapse) {
                btn.classList.add('hidden');
                return;
            }
            btn.classList.remove('hidden');
            if (adminBattlesExpanded) {
                btn.textContent = '收起 Collapse';
                btn.setAttribute('aria-expanded', 'true');
            } else {
                btn.textContent = '展開 Show all (' + total + ')';
                btn.setAttribute('aria-expanded', 'false');
            }
        }

        async function loadBattleAdmin(forceForms) {
            if (!isAdmin()) return;
            if (forceForms) await ensureFormDirectory(true);
            const statsEl = document.getElementById('battle-admin-stats');
            const listEl = document.getElementById('battle-admin-container');
            if (!statsEl || !listEl) return;
            const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

            const { data, error } = await sb.from('battle_rooms')
                .select('id, code, topic, mode, status, seed, question_count, guest_id, created_at, started_at, finished_at, battle_players(user_id, nickname, email, score, correct, done)')
                .gte('created_at', since)
                .or('guest_id.not.is.null,status.neq.waiting,mode.eq.class')
                .order('created_at', { ascending: false })
                .limit(60);

            adminCache.battles = (data || []).filter(battleRoomPaired);
            adminCache.battlesError = error || null;
            adminBattleRooms = adminCache.battles;
            renderBattleAdmin();
        }

        function renderBattleAdmin() {
            const statsEl = document.getElementById('battle-admin-stats');
            const listEl = document.getElementById('battle-admin-container');
            if (!statsEl || !listEl || !adminCache.battles) return;
            if (adminCache.battlesError) {
                statsEl.innerHTML = '';
                const missing = isMissingSchema(adminCache.battlesError.message);
                listEl.innerHTML = missing
                    ? '<p class="text-amber-500 text-center py-10 font-bold">Word Battle is not set up yet.<br><span class="text-sm font-normal">Run <code>supabase/battle.sql</code> in the Supabase SQL Editor.</span></p>'
                    : '<p class="text-red-400 text-center py-10">Cannot load battles: ' + escapeHtml(adminCache.battlesError.message) + '</p>';
                return;
            }
            const rooms = adminCache.battles;
            const playing = rooms.filter(r => r.status === 'playing').length;
            const waiting = rooms.filter(r => r.status === 'waiting').length;
            const finished = rooms.filter(r => r.status === 'finished').length;
            const students = new Set();
            rooms.forEach(r => (r.battle_players || []).forEach(p => {
                students.add((p.email || '').toLowerCase());
            }));
            statsEl.innerHTML = `
                <div class="bg-indigo-50 rounded-2xl p-5 text-center border-2 border-indigo-100">
                    <div class="text-3xl font-bold text-indigo-600">${playing}</div>
                    <div class="text-sm text-gray-500 font-bold">In Progress</div>
                </div>
                <div class="bg-blue-50 rounded-2xl p-5 text-center border-2 border-blue-100">
                    <div class="text-3xl font-bold text-blue-600">${waiting}</div>
                    <div class="text-sm text-gray-500 font-bold">Waiting</div>
                </div>
                <div class="bg-green-50 rounded-2xl p-5 text-center border-2 border-green-100">
                    <div class="text-3xl font-bold text-green-600">${finished}</div>
                    <div class="text-sm text-gray-500 font-bold">Finished</div>
                </div>
                <div class="bg-orange-50 rounded-2xl p-5 text-center border-2 border-orange-100">
                    <div class="text-3xl font-bold text-orange-600">${students.size}</div>
                    <div class="text-sm text-gray-500 font-bold">Students (24h)</div>
                </div>
            `;
            if (!rooms.length) {
                listEl.innerHTML = '<p class="text-gray-400 text-center py-10">No connected battles in the last 24 hours.</p>';
                return;
            }
            const statusPill = s => s === 'playing'
                ? '<span class="bg-green-100 text-green-600 text-xs font-bold px-3 py-1 rounded-full">PLAYING</span>'
                : s === 'waiting'
                    ? '<span class="bg-blue-100 text-blue-600 text-xs font-bold px-3 py-1 rounded-full">WAITING</span>'
                    : '<span class="bg-gray-100 text-gray-500 text-xs font-bold px-3 py-1 rounded-full">FINISHED</span>';
            const playerLine = p => `<div class="flex items-center justify-between gap-2">
                                    <span class="text-gray-700 font-bold">${escapeHtml(p.nickname || (p.email || '').split('@')[0])}${classBadge(p.email, p.nickname)}</span>
                                    ${formAssignControl(p.email, p.nickname)}
                                    <span class="text-indigo-600 font-bold">${p.score} pts · ${p.correct} correct${p.done ? ' ✔' : ''}</span>
                               </div>`;
            listEl.innerHTML = `
                <div class="space-y-3">
                    ${rooms.map(r => {
                        const ps = r.battle_players || [];
                        const groups = groupRowsByForm(ps).filter(g => g.rows.length);
                        const mixed = groups.length > 1;
                        const lines = ps.length
                            ? (mixed
                                ? groups.map(g => `<div class="mt-2 first:mt-0"><div class="text-[10px] font-bold uppercase tracking-wider ${g.id ? 'text-orange-500' : 'text-gray-400'} mb-1">${escapeHtml(g.label)}</div>${g.rows.map(playerLine).join('')}</div>`).join('')
                                : ps.map(playerLine).join(''))
                            : '<span class="text-gray-400 text-sm">No players yet</span>';
                        return `<div data-battle-admin-row>
                            <div class="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
                                <div class="flex items-center gap-4">
                                    <span class="text-2xl font-bold text-indigo-600 tracking-widest">${escapeHtml(r.code)}</span>
                                    ${statusPill(r.status)}
                                    <span class="text-xs font-bold px-2 py-1 rounded-full ${r.mode === 'class' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'}">${r.mode === 'class' ? 'CLASS' : '1v1'}</span>
                                    ${!mixed && groups.length === 1 ? `<span class="text-xs font-bold px-2 py-1 rounded-full ${groups[0].id ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'}">${escapeHtml(groups[0].label)}</span>` : ''}
                                    <span class="text-xs text-gray-400 capitalize">${escapeHtml(r.topic === '__random__' ? 'random' : r.topic)}</span>
                                </div>
                                <div class="text-sm min-w-[240px] flex-1 max-w-md">${lines}</div>
                                <div class="flex items-center gap-3">
                                    <button onclick="toggleBattleBreakdown('${r.id}')" class="text-xs font-bold text-indigo-500 hover:text-indigo-700">📊 breakdown</button>
                                    <span class="text-xs text-gray-400">${escapeHtml(hkDate(r.created_at))}</span>
                                </div>
                            </div>
                            <div id="bd-${r.id}" class="hidden mt-2"></div>
                        </div>`;
                    }).join('')}
                </div>
                <div class="text-center mt-4">
                    <button type="button" data-admin-battles-toggle class="px-4 py-2 rounded-full font-bold text-sm bg-indigo-100 text-indigo-600 hover:bg-indigo-500 hover:text-white transition-colors" onclick="setAdminBattlesExpanded(!adminBattlesExpanded)"></button>
                </div>
            `;
            applyAdminBattlesCollapse();
        }

        async function toggleBattleBreakdown(roomId) {
            const el = document.getElementById('bd-' + roomId);
            if (!el) return;

            if (!el.classList.contains('hidden')) {
                el.classList.add('hidden');
                return;
            }
            el.classList.remove('hidden');
            el.className = 'mt-2 bg-white border border-gray-100 rounded-xl p-4';
            el.innerHTML = '<p class="text-gray-400 text-sm text-center py-3">Loading question breakdown…</p>';

            const room = (adminBattleRooms || []).find(r => r.id === roomId);
            const { data, error } = await sb.from('battle_answers')
                .select('user_id, q_index, word, correct, answer')
                .eq('room_id', roomId);

            if (error) {
                const missing = /does not exist|PGRST20|42P01/i.test(error.message || '');
                el.innerHTML = missing
                    ? '<p class="text-amber-500 text-sm text-center py-3 font-bold">Run supabase/battle_stats.sql to unlock this.</p>'
                    : '<p class="text-red-400 text-sm text-center py-3">' + escapeHtml(error.message) + '</p>';
                return;
            }
            renderGroupedAnswerStats(data, room ? room.battle_players : [], el, room ? battleBuildQuestions(room).words : null);
        }

        // Word Battle inputs
        document.getElementById('battle-answer')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); battleSubmitAnswer(); }
        });
        document.getElementById('battle-code-input')?.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        });

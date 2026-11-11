/* LearniTY Dictation — Drive & Go! Mario Kart-style grammar racing game.
   This file owns the pre-race flow (challenge → cat → controls → mode), the
   Google-Sheets question bank, gate building, local preferences and shared
   helpers. The canvas race engine lives in drive-and-go-race.js and the
   realtime 2–5 player lobby/race sync lives in drive-and-go-multiplayer.js.
   All three files are classic scripts: no modules, no defer/async. */

const DG = {
    SETTINGS_KEY: 'learniTY_dg_settings',
    BEST_SCORE_KEY: 'learniTY_dg_best_score',
    BEST_DISTANCE_KEY: 'learniTY_dg_best_distance',
    TAB_FOR_MODE: { av: ['tenses'], pv: ['Passives'], mixed: ['tenses', 'Passives'] },
    MODE_LABEL: { av: 'Active Voice (AV)', pv: 'Passive Voice (PV)', mixed: 'Mixed' },
    MODE_SHORT: { av: 'AV', pv: 'PV', mixed: 'Mixed' },
    // Race constants shared by the engine and the tests.
    NITRO_KMH: 40,
    SPIN_TIME: 1.5,
    GATE_GAP: 150,
    START_GATE_DIST: 140,
    FINISH_DISTANCE: 4200,
    RACE_SECONDS: 180,
    CATS: ['Ginger', 'Ragdoll', 'Black', 'Siamese'],
    GLASSES: ['None', 'Sunglasses', 'Glasses'],
    HATS: ['None', 'Party Hat', 'Crown'],
    OUTFITS: ['None', 'Red Scarf', 'Racing Jacket', 'Superhero Cape', 'Gentleman Bowtie', 'Sports Vest', 'Pink Floral Scarf'],
    ITEM_EMOJI: { banana: '🍌', star: '⭐', redshell: '🔴', lightning: '⚡', mushroom: '🍄' },
    ITEM_NAME: { banana: 'Banana', star: 'Star', redshell: 'Red shell', lightning: 'Lightning', mushroom: 'Mushroom' },
    ITEM_HELP: {
        banana: 'Throws a peel backwards. A racer behind you spins out for 1.5s.',
        star: '6s invincibility + 5s boost. Earned with 6 correct answers in a row.',
        redshell: 'Fires at the racer ahead. They burst a tyre for 2s. Earned when you are not 1st.',
        lightning: 'Slows every rival for 4.5s and shrinks their question text. Earned on a challenging question.',
        mushroom: '3s speed burst. Earned with 3 correct answers in a row.'
    },
    bankCache: {},
    bankPoolCache: {},
    settings: null,
    menuStep: 'challenge',
    tiltPermission: 'unknown',

    /* ---------------- preferences ---------------- */

    defaultSettings() {
        return { bankMode: 'av', cat: 'Ginger', glasses: 'None', hat: 'None', outfit: 'None', controls: 'tilt' };
    },

    readSettings() {
        if (DG.settings) return DG.settings;
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(DG.SETTINGS_KEY) || 'null'); } catch (e) { saved = null; }
        DG.settings = Object.assign(DG.defaultSettings(), DG.normalizeLook(saved || {}));
        if (saved && DG.TAB_FOR_MODE[saved.bankMode]) DG.settings.bankMode = saved.bankMode;
        if (saved && ['tilt', 'swipe', 'buttons'].indexOf(saved.controls) !== -1) DG.settings.controls = saved.controls;
        DG.rememberLook(DG.settings);
        return DG.settings;
    },

    saveSettings() {
        try { localStorage.setItem(DG.SETTINGS_KEY, JSON.stringify(DG.readSettings())); } catch (e) {}
    },

    rememberLook(look) {
        const s = DG.readSettings();
        s.cat = look.cat; s.glasses = look.glasses; s.hat = look.hat; s.outfit = look.outfit;
        DG.saveSettings();
        return s;
    },

    normalizeLook(raw) {
        const pick = (value, list, fallback) => list.indexOf(value) !== -1 ? value : fallback;
        return {
            cat: pick(raw && raw.cat, DG.CATS, 'Ginger'),
            glasses: pick(raw && raw.glasses, DG.GLASSES, 'None'),
            hat: pick(raw && raw.hat, DG.HATS, 'None'),
            outfit: pick(raw && raw.outfit, DG.OUTFITS, 'None')
        };
    },

    currentLook() {
        const s = DG.readSettings();
        return { cat: s.cat, glasses: s.glasses, hat: s.hat, outfit: s.outfit };
    },

    /* ---------------- CSV / question bank ---------------- */

    parseCSVLine(line) {
        const out = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (c === ',' && !inQuotes) {
                out.push(cur);
                cur = '';
            } else {
                cur += c;
            }
        }
        out.push(cur);
        return out.map(s => s.trim());
    },

    answerVariants(raw) {
        return String(raw || '').split('/').map(s => s.trim()).filter(Boolean);
    },

    normAnswer(raw) {
        return String(raw || '')
            .replace(/[\u2018\u2019\u201B`\u00B4]/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    },

    /* Parse one gviz CSV tab. The sheet uses:
       - a header row ("Question (Column A)", "Answer (Column B)")
       - section heading rows (A = tense name, B empty)
       - "Challenging" heading rows (questions after it are challenging)
       - question rows (A = numbered sentence with ____, B = answer(s)). */
    parseQuestionSheet(csvText, sheetName) {
        const questions = [];
        const bySection = {};
        const bySheet = [];
        const lines = String(csvText || '').split(/\r?\n/);
        let section = 'General';
        let challenging = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            const parts = DG.parseCSVLine(line);
            const question = (parts[0] || '').trim();
            const answer = (parts[1] || '').trim();
            if (!question && !answer) continue;
            if (i === 0 && !answer && /^question\b/i.test(question)) continue;
            if (!answer) {
                if (/^challenging$/i.test(question)) challenging = true;
                else if (question) { section = question; challenging = false; }
                continue;
            }
            if (!question || !/^\d+[.)]/.test(question) || question.indexOf('____') === -1) continue;
            const variants = DG.answerVariants(answer);
            if (!variants.length) continue;
            const hintMatch = /\(([^)]*)\)/.exec(question);
            const hint = hintMatch ? hintMatch[1].split('/').pop().trim() : '';
            const sectionKey = sheetName + '|' + section;
            const q = {
                id: sheetName + ':' + questions.length,
                sheet: sheetName,
                section,
                sectionKey,
                challenging,
                prompt: question,
                answerRaw: answer,
                variants,
                primary: variants[0],
                hint
            };
            questions.push(q);
            bySheet.push({ primary: q.primary, variants, item: q });
            if (!bySection[sectionKey]) bySection[sectionKey] = [];
            bySection[sectionKey].push({ primary: q.primary, variants, item: q });
        }
        return { questions, bySection, bySheet };
    },

    loadBank(mode, force) {
        const tabs = DG.TAB_FOR_MODE[mode];
        if (!tabs) return Promise.reject(new Error('Unknown challenge mode: ' + mode));
        if (!force && DG.bankCache[mode] && DG.bankCache[mode].length) return Promise.resolve(DG.bankCache[mode]);
        const sections = {};
        const sheets = {};
        const all = [];
        let chain = Promise.resolve();
        tabs.forEach(tab => {
            chain = chain.then(() => {
                const url = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID +
                    '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(tab);
                return fetch(url, { credentials: 'omit' }).then(response => {
                    if (!response.ok) throw new Error('The "' + tab + '" tab returned HTTP ' + response.status + '.');
                    return response.text();
                }).then(text => {
                    const parsed = DG.parseQuestionSheet(text, tab);
                    if (!parsed.questions.length) throw new Error('The "' + tab + '" tab has no usable questions.');
                    Object.keys(parsed.bySection).forEach(k => { sections[k] = parsed.bySection[k]; });
                    sheets[tab] = parsed.bySheet;
                    all.push.apply(all, parsed.questions);
                });
            });
        });
        return chain.then(() => {
            if (!all.length) throw new Error('The question bank is empty.');
            DG.bankCache[mode] = all;
            DG.bankPoolCache[mode] = { bySection: sections, bySheet: sheets };
            return all;
        });
    },

    makeRng(seed) {
        let a = (Number(seed) || 1) >>> 0;
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    },

    hashString(text) {
        let h = 2166136261;
        const s = String(text || '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    },

    shuffleInPlace(list, rng) {
        const rnd = rng || Math.random;
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
        }
        return list;
    },

    /* Prefer a distractor that shares the verb in the bracket hint and the
       same auxiliary / tense ending. Never returns the answer or any of its
       alternatives. Falls back to the rest of the same sheet. */
    buildGates(question, sectionPool, sheetPool, rng) {
        const rnd = rng || Math.random;
        const forbidden = new Set(question.variants.map(DG.normAnswer));
        const seen = new Set(forbidden);
        const candidates = [];
        const consider = (pool) => {
            (pool || []).forEach(entry => {
                const label = String(entry && entry.primary ? entry.primary : entry || '').trim();
                const key = DG.normAnswer(label);
                if (!key || seen.has(key)) return;
                seen.add(key);
                const related = DG.answerAffinity(question, label);
                candidates.push({ label, score: related + rnd() * 0.9 });
            });
        };
        consider(sectionPool);
        candidates.sort((a, b) => b.score - a.score);
        const chosen = [];
        const takeFrom = (list) => {
            while (chosen.length < 2 && list.length) {
                const idx = Math.floor(rnd() * Math.min(list.length, 8));
                chosen.push(list.splice(idx, 1)[0]);
            }
        };
        takeFrom(candidates.slice());
        if (chosen.length < 2) {
            const extra = [];
            const seenExtra = new Set(forbidden);
            (sheetPool || []).forEach(entry => {
                const label = String(entry && entry.primary ? entry.primary : entry || '').trim();
                const key = DG.normAnswer(label);
                if (!key || seenExtra.has(key) || chosen.some(c => DG.normAnswer(c.label) === key)) return;
                seenExtra.add(key);
                extra.push({ label, score: DG.answerAffinity(question, label) });
            });
            takeFrom(extra);
        }
        if (chosen.length < 2) {
            // A well-formed sheet always has enough other answers. If it does
            // not, still return exactly three gates without reusing the answer.
            const fillers = ['is', 'are', 'was', 'were', 'has', 'have', 'had', 'does', 'did', 'will'];
            for (let i = 0; i < fillers.length && chosen.length < 2; i++) {
                const key = DG.normAnswer(fillers[i]);
                if (forbidden.has(key) || chosen.some(c => DG.normAnswer(c.label) === key)) continue;
                chosen.push({ label: fillers[i], score: 0 });
            }
        }
        const labels = [question.primary, chosen[0].label, chosen[1].label];
        DG.shuffleInPlace(labels, rnd);
        const correctLane = labels.indexOf(question.primary);
        return labels.map((label, lane) => ({ label, lane, correct: lane === correctLane }));
    },

    answerAffinity(question, label) {
        const correct = DG.normAnswer(question.primary);
        const other = DG.normAnswer(label);
        let score = 0;
        const hint = DG.normAnswer(question.hint);
        if (hint) {
            const stem = hint.replace(/e$/, '');
            if (other.indexOf(hint) !== -1 || hint.indexOf(other) !== -1) score += 8;
            else if (stem.length >= 3 && other.indexOf(stem) !== -1) score += 6;
        }
        const aux = /^(is|are|was|were|has|have|had|will|would|can|could|must|should|may|might|do|does|did)\b/;
        const a1 = aux.exec(correct), a2 = aux.exec(other);
        if (a1 && a2 && a1[1] === a2[1]) score += 4;
        if (/ing\b/.test(correct) && /ing\b/.test(other)) score += 3;
        if (/ed\b/.test(correct) && /ed\b/.test(other)) score += 2;
        if (/\bbeen\b/.test(correct) && /\bbeen\b/.test(other)) score += 2;
        score += Math.max(0, 3 - Math.abs(correct.length - other.length) / 4);
        return score;
    },

    gatesFor(question, mode, rng) {
        const pools = DG.bankPoolCache[mode] || { bySection: {}, bySheet: {} };
        return DG.buildGates(
            question,
            pools.bySection[question.sectionKey] || [],
            (pools.bySheet && pools.bySheet[question.sheet]) || [],
            rng
        );
    },

    raceQuestionQueue(mode, seed) {
        const bank = DG.bankCache[mode] || [];
        const list = bank.slice();
        DG.shuffleInPlace(list, seed == null ? Math.random : DG.makeRng(seed));
        return list;
    },

    /* ---------------- item rules ---------------- */

    /* Pure rule table. Every unlock condition is checked in a stable order so
       a challenging question still gives Lightning even on a 6-combo. */
    itemForCorrect(stats, rng) {
        const s = stats || {};
        if (s.item) return null;
        const rnd = rng || Math.random;
        if (s.challenging) return 'lightning';
        if (s.combo > 0 && s.combo % 6 === 0) return 'star';
        if (s.combo > 0 && s.combo % 3 === 0) return 'mushroom';
        if (s.rank > 1) return 'redshell';
        if (rnd() < 0.35) return 'banana';
        return null;
    },

    /* ---------------- screens / pre-race flow ---------------- */

    menuContent() {
        return document.getElementById('grammar-detail-content');
    },

    backToTenses() {
        DG.stopRace();
        if (typeof DG.mpStopPoll === 'function') DG.mpAbandon();
        changeView('grammar-revision-view');
    },

    // changeView() calls this for every view change. Keep the race alive only
    // while the dedicated race view is on screen; stop lobby polling when the
    // player navigates away from the grammar detail page.
    onLeaveView(viewId) {
        if (viewId === 'drive-and-go-view') return;
        if (typeof DG.stopRace === 'function') DG.stopRace();
        if (viewId !== 'grammar-detail-view') {
            if (typeof DG.mpStopPoll === 'function') DG.mpStopPoll();
            if (typeof DG.mpAbandon === 'function') DG.mpAbandon();
        }
    },

    showLoading(message) {
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        content.innerHTML = '<div class="text-center py-16"><div class="loader mx-auto mb-5"></div>' +
            '<p class="text-xl font-bold text-orange-500">' + DG.esc(message) + '</p></div>';
    },

    showLoadError(mode, err) {
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const label = DG.MODE_LABEL[mode] || 'grammar';
        content.innerHTML =
            '<div class="text-center mb-6"><div class="text-7xl mb-3">📡</div>' +
            '<h2 class="text-3xl font-bold text-orange-600">Question bank not loaded</h2></div>' +
            '<div class="dg-menu-panel text-center">' +
            '<p class="font-bold text-gray-700 mb-2">Could not load the ' + DG.esc(label) + ' questions from Google Sheets.</p>' +
            '<p class="text-sm text-gray-500 mb-6">' + DG.esc(err && err.message ? err.message : 'Please check your connection and try again.') + '</p>' +
            '<div class="flex gap-3 justify-center flex-wrap">' +
            '<button type="button" class="btn-paw" onclick="DG.retryBank()">Retry</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showModeStep()">Back</button>' +
            '</div></div>';
    },

    retryBank() {
        const mode = DG.readSettings().bankMode;
        DG.showLoading('Loading ' + (DG.MODE_LABEL[mode] || '') + ' questions…');
        DG.loadBank(mode, true).then(() => {
            if (DG.menuStep === 'mode') DG.showModeStep();
            else DG.startSingle();
        }).catch(err => DG.showLoadError(mode, err));
    },

    showChallengeStep() {
        DG.menuStep = 'challenge';
        const s = DG.readSettings();
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const card = (mode, emoji, title, sub) => {
            const active = s.bankMode === mode ? ' active' : '';
            return '<button type="button" class="dg-choice' + active + '" onclick="DG.setBankMode(\'' + mode + '\')">' +
                '<span class="dg-choice-emoji">' + emoji + '</span>' +
                '<span class="dg-choice-title">' + title + '</span>' +
                '<span class="dg-choice-sub">' + sub + '</span></button>';
        };
        content.innerHTML =
            '<div class="text-center mb-6"><div class="text-7xl mb-2">🏎️</div>' +
            '<h2 class="text-4xl font-bold text-orange-600">Drive & Go!</h2>' +
            '<p class="text-gray-500 font-bold mt-2">Read the sentence, steer into the correct gate, and race the track.</p></div>' +
            '<div class="dg-step-dots"><span class="active"></span><span></span><span></span><span></span></div>' +
            '<h3 class="text-2xl font-bold text-green-600 text-center mb-4">1. Choose your challenge</h3>' +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">' +
            card('av', '🟢', 'Active Voice', 'AV — tenses tab · 120 questions') +
            card('pv', '🔵', 'Passive Voice', 'PV — Passives tab · 120 questions') +
            card('mixed', '🌈', 'Mixed', 'Both tabs shuffled together') +
            '</div>' +
            '<div class="text-center"><button type="button" class="btn-paw" onclick="DG.showCatStep()">Next: Cat driver →</button></div>';
    },

    setBankMode(mode) {
        if (!DG.TAB_FOR_MODE[mode]) return;
        DG.readSettings().bankMode = mode;
        DG.saveSettings();
        DG.showChallengeStep();
    },

    showCatStep() {
        DG.menuStep = 'cat';
        const s = DG.readSettings();
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const row = (label, key, options, current) => {
            return '<div class="mb-4"><p class="font-bold text-gray-600 mb-2">' + label + '</p><div class="flex flex-wrap gap-2">' +
                options.map(opt => '<button type="button" class="dg-chip' + (opt === current ? ' active' : '') +
                    '" onclick="DG.setLook(\'' + key + '\',\'' + DG.esc(opt).replace(/'/g, '&#39;') + '\')">' + DG.esc(opt) + '</button>').join('') +
                '</div></div>';
        };
        content.innerHTML =
            '<div class="dg-step-dots"><span class="done"></span><span class="active"></span><span></span><span></span></div>' +
            '<h3 class="text-2xl font-bold text-green-600 text-center mb-4">2. Customize your cat driver</h3>' +
            '<div class="dg-preview-wrap"><canvas id="dg-cat-preview" width="520" height="400" aria-label="Cat driver preview"></canvas></div>' +
            row('Cat', 'cat', DG.CATS, s.cat) +
            row('Glasses', 'glasses', DG.GLASSES, s.glasses) +
            row('Hat', 'hat', DG.HATS, s.hat) +
            row('Outfit', 'outfit', DG.OUTFITS, s.outfit) +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showChallengeStep()">← Challenge</button>' +
            '<button type="button" class="btn-paw" onclick="DG.showControlsStep()">Next: Controls →</button></div>';
        requestAnimationFrame(() => DG.renderCatPreview());
    },

    setLook(key, value) {
        if (['cat', 'glasses', 'hat', 'outfit'].indexOf(key) === -1) return;
        const s = DG.readSettings();
        s[key] = value;
        DG.saveSettings();
        DG.showCatStep();
    },

    renderCatPreview() {
        const canvas = document.getElementById('dg-cat-preview');
        if (!canvas || typeof DG.drawKart !== 'function') return;
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cssW = canvas.clientWidth || 260;
        const cssH = canvas.clientHeight || 200;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const grd = ctx.createLinearGradient(0, 0, 0, cssH);
        grd.addColorStop(0, '#dbeafe');
        grd.addColorStop(1, '#fef3c7');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.fillStyle = 'rgba(120,113,108,.22)';
        ctx.beginPath();
        ctx.ellipse(cssW / 2, cssH * 0.86, cssW * 0.28, cssH * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        DG.drawKart(ctx, cssW / 2, cssH * 0.82, Math.min(cssW / 250, cssH / 190), DG.currentLook(), { preview: true });
    },

    showControlsStep() {
        DG.menuStep = 'controls';
        const s = DG.readSettings();
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const card = (value, emoji, title, sub) => {
            const active = s.controls === value ? ' active' : '';
            return '<button type="button" class="dg-choice' + active + '" onclick="DG.chooseControls(\'' + value + '\')">' +
                '<span class="dg-choice-emoji">' + emoji + '</span>' +
                '<span class="dg-choice-title">' + title + '</span>' +
                '<span class="dg-choice-sub">' + sub + '</span></button>';
        };
        const note = DG.tiltPermission === 'denied'
            ? '<div class="dg-note warn">Tilt permission was denied or no motion sensor was found. The LEFT / CENTER / RIGHT buttons will be used instead.</div>'
            : (DG.tiltPermission === 'granted'
                ? '<div class="dg-note ok">Tilt is ready. Hold your phone level when the race starts.</div>' : '');
        content.innerHTML =
            '<div class="dg-step-dots"><span class="done"></span><span class="done"></span><span class="active"></span><span></span></div>' +
            '<h3 class="text-2xl font-bold text-green-600 text-center mb-2">3. Choose your controls</h3>' +
            '<p class="text-center text-gray-500 font-bold mb-4">Tilt is recommended on a phone. Buttons always stay on screen as a backup.</p>' +
            note +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">' +
            card('tilt', '📱', 'Tilt (recommended)', 'Lean left / right to change lane') +
            card('swipe', '👆', 'Swipe', 'Swipe left or right on the track') +
            card('buttons', '🔘', 'LEFT / CENTER / RIGHT', 'Tap the on-screen buttons') +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showCatStep()">← Cat</button>' +
            '<button type="button" class="btn-paw" onclick="DG.showModeStep()">Next: Game mode →</button></div>';
    },

    chooseControls(value) {
        if (['tilt', 'swipe', 'buttons'].indexOf(value) === -1) return;
        const s = DG.readSettings();
        s.controls = value;
        DG.saveSettings();
        if (value !== 'tilt') {
            DG.showControlsStep();
            return;
        }
        DG.requestTiltPermission().then(ok => {
            DG.tiltPermission = ok ? 'granted' : 'denied';
            if (!ok) {
                DG.readSettings().controls = 'buttons';
                DG.saveSettings();
            }
            DG.showControlsStep();
        });
    },

    requestTiltPermission() {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            return DeviceOrientationEvent.requestPermission().then(res => res === 'granted').catch(() => false);
        }
        return Promise.resolve(typeof window !== 'undefined' && 'DeviceOrientationEvent' in window);
    },

    showModeStep() {
        DG.menuStep = 'mode';
        const content = DG.menuContent();
        if (!content) return;
        document.getElementById('detail-back-btn').onclick = () => DG.backToTenses();
        const s = DG.readSettings();
        const modeText = DG.MODE_LABEL[s.bankMode] || '';
        content.innerHTML =
            '<div class="dg-step-dots"><span class="done"></span><span class="done"></span><span class="done"></span><span class="active"></span></div>' +
            '<h3 class="text-2xl font-bold text-green-600 text-center mb-2">4. Choose a game mode</h3>' +
            '<p class="text-center text-gray-500 font-bold mb-5">Challenge: <span class="text-orange-600">' + DG.esc(modeText) + '</span></p>' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">' +
            '<button type="button" class="dg-choice" onclick="DG.startSingle()"><span class="dg-choice-emoji">🏁</span>' +
            '<span class="dg-choice-title">Single Player</span><span class="dg-choice-sub">Endless race. Beat your best score and distance.</span></button>' +
            '<button type="button" class="dg-choice" onclick="DG.openMultiplayer()"><span class="dg-choice-emoji">🏎️</span>' +
            '<span class="dg-choice-title">Multiplayer</span><span class="dg-choice-sub">2–5 players. First to the finish line wins (3 minute limit).</span></button>' +
            '</div>' +
            '<div class="flex gap-3 justify-center flex-wrap mt-6">' +
            '<button type="button" class="dg-menu-button" onclick="DG.showControlsStep()">← Controls</button>' +
            '<button type="button" class="dg-menu-button" onclick="DG.showCatStep()">← Cat</button></div>';
    },

    startSingle() {
        const mode = DG.readSettings().bankMode;
        DG.showLoading('Loading ' + (DG.MODE_LABEL[mode] || '') + ' questions…');
        DG.loadBank(mode).then(() => {
            DG.startRace({ mode: 'single', bankMode: mode });
        }).catch(err => DG.showLoadError(mode, err));
    },

    /* ---------------- best score helpers ---------------- */

    readBestScore() {
        const n = Number(localStorage.getItem(DG.BEST_SCORE_KEY) || 0);
        return isFinite(n) && n > 0 ? n : 0;
    },

    readBestDistance() {
        const n = Number(localStorage.getItem(DG.BEST_DISTANCE_KEY) || 0);
        return isFinite(n) && n > 0 ? n : 0;
    },

    recordBest(score, distance) {
        let changed = false;
        if (score > DG.readBestScore()) {
            try { localStorage.setItem(DG.BEST_SCORE_KEY, String(Math.floor(score))); } catch (e) {}
            changed = true;
        }
        if (distance > DG.readBestDistance()) {
            try { localStorage.setItem(DG.BEST_DISTANCE_KEY, String(Math.floor(distance))); } catch (e) {}
            changed = true;
        }
        return changed;
    },

    /* ---------------- small helpers used by all three files ---------------- */

    esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    ordinal(n) {
        const x = Math.max(1, Number(n) || 1);
        const mod100 = x % 100;
        if (mod100 >= 11 && mod100 <= 13) return x + 'th';
        if (x % 10 === 1) return x + 'st';
        if (x % 10 === 2) return x + 'nd';
        if (x % 10 === 3) return x + 'rd';
        return x + 'th';
    },

    lookName(look) {
        const l = DG.normalizeLook(look);
        const bits = [l.cat];
        if (l.glasses !== 'None') bits.push(l.glasses);
        if (l.hat !== 'None') bits.push(l.hat);
        if (l.outfit !== 'None') bits.push(l.outfit);
        return bits.join(' · ');
    },

    catPalette(cat) {
        if (cat === 'Ragdoll') return { body: '#fffaf3', shade: '#efe4d8', points: '#6b5a51', eye: '#4dabf7', nose: '#f2a6b8' };
        if (cat === 'Black') return { body: '#34343c', shade: '#222228', points: '#18181d', eye: '#f5c542', nose: '#e88a9b' };
        if (cat === 'Siamese') return { body: '#f3e3c8', shade: '#e3d0b0', points: '#5b4636', eye: '#63b3ed', nose: '#e7a0ae' };
        return { body: '#e8893c', shade: '#c96f2b', points: '#a9541b', eye: '#5aa9e6', nose: '#f2a6b8' };
    },

    /* Inline SVG used by the multiplayer lobby (so each player's chosen cat
       is visible before the race). */
    catAvatarSVG(look, size) {
        const l = DG.normalizeLook(look);
        const p = DG.catPalette(l.cat);
        const s = size || 58;
        let glasses = '';
        if (l.glasses === 'Sunglasses') {
            glasses = '<rect x="21" y="30" width="16" height="7" rx="3" fill="#111827"/><rect x="43" y="30" width="16" height="7" rx="3" fill="#111827"/><rect x="36" y="32" width="8" height="2" fill="#111827"/>';
        } else if (l.glasses === 'Glasses') {
            glasses = '<circle cx="29" cy="33" r="7" fill="none" stroke="#374151" stroke-width="2"/><circle cx="51" cy="33" r="7" fill="none" stroke="#374151" stroke-width="2"/><path d="M36 33h8" stroke="#374151" stroke-width="2"/>';
        }
        let hat = '';
        if (l.hat === 'Party Hat') {
            hat = '<path d="M40 15 L25 1 L55 1 Z" fill="#f472b6"/><circle cx="35" cy="8" r="2" fill="#fde047"/><circle cx="45" cy="6" r="2" fill="#60a5fa"/><circle cx="40" cy="13" r="2" fill="#facc15"/>';
        } else if (l.hat === 'Crown') {
            hat = '<path d="M25 10 L29 1 L35 8 L40 0 L45 8 L51 1 L55 10 Z" fill="#fbbf24" stroke="#d97706" stroke-width="1.5"/>';
        }
        let outfit = '';
        if (l.outfit === 'Red Scarf' || l.outfit === 'Pink Floral Scarf') {
            const col = l.outfit === 'Red Scarf' ? '#ef4444' : '#f472b6';
            outfit = '<path d="M24 55 Q40 64 56 55 L56 61 Q40 69 24 61 Z" fill="' + col + '"/><path d="M50 61l7 12" stroke="' + col + '" stroke-width="5" stroke-linecap="round"/>';
        } else if (l.outfit === 'Racing Jacket') {
            outfit = '<path d="M22 54h36v11H22z" fill="#ef4444"/><path d="M38 54h4v11h-4z" fill="#fff" opacity=".8"/>';
        } else if (l.outfit === 'Superhero Cape') {
            outfit = '<path d="M20 54 Q8 68 16 80 L30 63 Z" fill="#dc2626"/><path d="M60 54 Q72 68 64 80 L50 63 Z" fill="#dc2626"/>';
        } else if (l.outfit === 'Gentleman Bowtie') {
            outfit = '<path d="M29 58 L40 63 L51 58 L51 68 L40 63 L29 68 Z" fill="#111827"/>';
        } else if (l.outfit === 'Sports Vest') {
            outfit = '<path d="M24 54h32v12H24z" fill="#22c55e"/><path d="M38 54h4v12h-4z" fill="#fef08a"/>';
        }
        return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 80 82" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<ellipse cx="40" cy="77" rx="25" ry="4" fill="rgba(0,0,0,.12)"/>' +
            outfit +
            '<path d="M20 18 L16 3 L31 12 Z" fill="' + p.points + '"/><path d="M60 18 L64 3 L49 12 Z" fill="' + p.points + '"/>' +
            '<path d="M22 18 L20 10 L28 15 Z" fill="#f9a8b8"/><path d="M58 18 L60 10 L52 15 Z" fill="#f9a8b8"/>' +
            '<ellipse cx="40" cy="38" rx="26" ry="27" fill="' + p.body + '"/>' +
            '<ellipse cx="40" cy="50" rx="15" ry="13" fill="' + p.points + '" opacity="' + (l.cat === 'Ragdoll' || l.cat === 'Siamese' ? '.85' : '.25') + '"/>' +
            '<circle cx="29" cy="34" r="6" fill="' + p.eye + '"/><circle cx="51" cy="34" r="6" fill="' + p.eye + '"/>' +
            '<circle cx="29" cy="34" r="3" fill="#111827"/><circle cx="51" cy="34" r="3" fill="#111827"/>' +
            '<circle cx="27.5" cy="32" r="1.2" fill="#fff"/><circle cx="49.5" cy="32" r="1.2" fill="#fff"/>' +
            '<path d="M37 46 L43 46 L40 50 Z" fill="' + p.nose + '"/>' +
            '<path d="M40 50 Q36 54 33 51 M40 50 Q44 54 47 51" fill="none" stroke="' + p.points + '" stroke-width="1.6" stroke-linecap="round"/>' +
            '<path d="M24 44 L10 41 M24 48 L10 50 M56 44 L70 41 M56 48 L70 50" stroke="' + p.points + '" stroke-width="1.1" opacity=".65"/>' +
            glasses + hat +
            '</svg>';
    }
};

function showDriveAndGo() {
    DG.menuStep = 'challenge';
    DG.readSettings();
    DG.showChallengeStep();
    changeView('grammar-detail-view');
    recordGuestUsage('Grammar Quest', 'Drive & Go!');
}

// Classic scripts share the global lexical `DG`, but exposing it on window too
// keeps inline onclick handlers and the sibling race/sync files simple.
if (typeof window !== 'undefined') window.DG = DG;
if (typeof globalThis !== 'undefined') globalThis.DG = DG;

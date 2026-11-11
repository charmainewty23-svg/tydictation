/* LearniTY Dictation — New Vocab (per-form word bank + Cambridge lookup).
   Moved verbatim out of index.html. */

        const NV_POLL_MS = 4000;
        let nvTimer = 0;
        let nvEditForm = '';
        let nvScope = 'today';
        let nvRows = [];
        let nvSig = '';
        let nvSchemaMissing = false;
        let formSchemaMissing = false;
        let nvEditingId = null;
        let nvFetchGen = 0;
        let nvSaving = false;
        let myFormValue = '';
        let myFormLoaded = false;
        let ownFormPersisted = false;

        function nvAddedToday(iso) {
            if (!iso || typeof hkDayKey !== 'function') return false;
            return hkDayKey(iso) === hkDayKey(new Date().toISOString());
        }

        function nvHasEnglish(w) {
            return !!String(w && w.en || '').trim();
        }

        function nvPracticeRows() {
            if (nvScope === 'today') return nvRows.filter(w => nvAddedToday(w.created_at || w.updated_at));
            return nvRows.slice();
        }

        function nvQuizRows() {
            return nvPracticeRows().filter(nvHasEnglish).map(w => ({
                en: String(w.en).trim(),
                zh: String(w.zh || '').trim()
            }));
        }

        function nvApplyPractice() {
            categories[NEW_VOCAB] = nvQuizRows();
        }

        function nvPaintScope() {
            const todayBtn = document.getElementById('nv-scope-today');
            const allBtn = document.getElementById('nv-scope-all');
            if (!todayBtn || !allBtn) return;
            const todayOn = nvScope === 'today';
            todayBtn.className = 'px-4 py-2 rounded-full font-bold text-sm ' + (todayOn ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600');
            allBtn.className = 'px-4 py-2 rounded-full font-bold text-sm ' + (todayOn ? 'bg-orange-100 text-orange-600' : 'bg-orange-500 text-white');
        }

        function nvSetScope(scope) {
            nvScope = scope === 'all' ? 'all' : 'today';
            nvPaintScope();
            nvApplyPractice();
            nvRenderStatus();
            nvRenderEditorList();
            const listView = document.getElementById('word-list-view');
            if (listView && !listView.classList.contains('hidden') && currentTopic === NEW_VOCAB) showWordList(NEW_VOCAB);
        }

        function nvHide() {
            const panel = document.getElementById('nv-panel');
            const activities = document.getElementById('dictation-activities');
            if (panel) panel.classList.add('hidden');
            if (activities) activities.classList.remove('hidden');
        }

        function nvStopPoll() {
            if (nvTimer) { clearInterval(nvTimer); nvTimer = 0; }
        }

        function nvStartPoll() {
            nvStopPoll();
            nvTimer = setInterval(() => {
                const sub = document.getElementById('sub-category-view');
                const list = document.getElementById('word-list-view');
                const onSub = sub && !sub.classList.contains('hidden');
                const onList = list && !list.classList.contains('hidden');
                if (currentTopic === NEW_VOCAB && (onSub || onList)) nvRefresh(false);
                else nvStopPoll();
            }, NV_POLL_MS);
        }

        function nvSqlSetupHtml() {
            return 'New Vocab and Error Book need a one-time setup in the <strong>Supabase SQL editor</strong>. Run these files in order (skip any you have already run; they are safe to re-run):'
                + '<ol class="list-decimal ml-5 mt-2 mb-2 space-y-1 font-semibold">'
                + '<li><code>supabase/login_tracking.sql</code> — skip if login tracking already works.</li>'
                + '<li><code>supabase/student_forms.sql</code> — needed so each student has a form (F3 / F4 / F6).</li>'
                + '<li>The Word Battle SQL files — skip if Word Battle already works.</li>'
                + '<li><code>supabase/new_vocab.sql</code> — creates the New Vocab word bank and the Error Book table. If this was run before the battle tables, run it once more.</li>'
                + '<li><code>supabase/new_vocab_unassigned_read.sql</code> — needed so Unassigned students and guests can read every form\'s bank.</li>'
                + '</ol>'
                + 'Then refresh this page. Until the earlier files are done, Confirm cannot save a word. Until the last file is done, Unassigned students and guests may see an empty word bank.';
        }

        function nvShowFeedback(html, isError) {
            const box = document.getElementById('nv-feedback');
            if (!box) return;
            if (!html) {
                box.classList.add('hidden');
                box.innerHTML = '';
                return;
            }
            box.classList.remove('hidden');
            box.className = 'mb-4 p-4 rounded-2xl border-2 font-bold text-sm leading-relaxed ' + (isError
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-green-200 bg-green-50 text-green-800');
            box.innerHTML = html;
        }

        function ownDisplayedForm() {
            if (previewStudentForm()) return previewStudentForm();
            if (!currentUser || isAdmin() || isGuestUser()) return '';
            const nick = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || '';
            return parseDisplayNameFormClass(displayedLoginName(currentUser.email, nick)).form || '';
        }

        function nvActiveForm() {
            if (isAdmin()) return nvEditForm || FORM_LEVELS[0].id;
            if (isGuestUser()) return '';
            return myFormValue || ownDisplayedForm() || '';
        }

        function browsesAllVocab() {
            if (isAdmin()) return false;
            if (isGuestUser()) return true;
            return isSignedIn() && !nvActiveForm();
        }

        async function resolveOwnForm(force) {
            if (previewStudentForm()) {
                myFormValue = previewStudentForm();
                myFormLoaded = true;
                ownFormPersisted = true;
                return myFormValue;
            }
            if (isGuestUser() || !currentUser) { myFormValue = ''; myFormLoaded = true; ownFormPersisted = false; return ''; }
            if (isAdmin()) { myFormLoaded = true; return nvEditForm || FORM_LEVELS[0].id; }
            if (myFormLoaded && !force && ownFormPersisted) return myFormValue;
            let stored = '';
            const { data, error } = await sb.rpc('my_form');
            myFormLoaded = true;
            if (error) {
                formSchemaMissing = isMissingSchema(error.message);
            } else {
                formSchemaMissing = false;
                stored = normalizeForm(data) || '';
            }
            const inferred = ownDisplayedForm();
            // A stored F3/F4/F6 is only trusted when the displayed name still
            // has a class code, or the teacher assigned it (form_source).
            // Otherwise Liu Chun Ming (no class code) must stay Unassigned,
            // even if an old automatic claim wrote F6.
            let teacherSet = false;
            if (stored && !inferred) {
                try {
                    const src = await sb.rpc('my_form_source');
                    if (!src.error) {
                        teacherSet = String(src.data || '').toLowerCase() === 'teacher';
                    }
                } catch (e) { /* my_form_source may not exist yet */ }
            }
            if (stored && (inferred || teacherSet)) {
                myFormValue = stored;
                ownFormPersisted = true;
                if (inferred && stored !== inferred && !formSchemaMissing) {
                    await claimSavedForm(currentUser);
                }
                return stored;
            }
            if (!formSchemaMissing) {
                await claimSavedForm(currentUser);
                const again = await sb.rpc('my_form');
                if (!again.error) {
                    stored = normalizeForm(again.data) || '';
                    if (stored && (inferred || teacherSet)) {
                        myFormValue = stored;
                        ownFormPersisted = true;
                        return stored;
                    }
                }
            }
            ownFormPersisted = false;
            myFormValue = inferred;
            return inferred;
        }

        async function fetchMyForm(force) {
            return resolveOwnForm(force);
        }

        function nvEnsureFormSwitch() {
            const box = document.getElementById('nv-form-switch');
            if (!box) return;
            if (!nvEditForm) nvEditForm = FORM_LEVELS[0].id;
            box.innerHTML = FORM_LEVELS.map(f => {
                const on = f.id === nvEditForm;
                return `<button type="button" onclick="nvPickForm('${f.id}')" class="px-4 py-2 rounded-full font-bold text-sm ${on ? 'bg-orange-500 text-white' : 'bg-white text-orange-600 border-2 border-orange-100'}">${f.label}</button>`;
            }).join('');
        }

        function nvPickForm(id) {
            const next = normalizeForm(id);
            if (!next || next === nvEditForm) return;
            nvEditForm = next;
            nvEditingId = null;
            nvCancelEdit();
            nvEnsureFormSwitch();
            nvRefresh(true);
        }

        function nvEnter() {
            const panel = document.getElementById('nv-panel');
            if (panel) panel.classList.remove('hidden');
            recordGuestUsage('New Vocab');
            const editor = document.getElementById('nv-editor');
            if (editor) editor.classList.toggle('hidden', !isAdmin());
            if (isAdmin()) nvEnsureFormSwitch();
            nvPaintScope();
            nvRefresh(true);
            nvStartPoll();
        }

        async function nvRefresh(force) {
            const gen = ++nvFetchGen;
            const form = isAdmin() ? (nvEditForm || FORM_LEVELS[0].id) : await resolveOwnForm(force || !myFormLoaded);
            if (gen !== nvFetchGen) return;
            const status = document.getElementById('nv-status');
            const activities = document.getElementById('dictation-activities');
            const scope = document.getElementById('nv-scope');
            const hidePractice = () => {
                nvRows = [];
                nvApplyPractice();
                if (activities) activities.classList.add('hidden');
                if (scope) scope.classList.add('hidden');
            };
            if (!isAdmin() && !isSignedIn()) {
                hidePractice();
                if (status) status.innerText = 'Sign in with your school account, or as a guest, to open New Vocab.';
                nvShowFeedback('', false);
                return;
            }
            const allForms = !isAdmin() && !form;
            if (scope) scope.classList.remove('hidden');
            let query = sb.from('new_vocab_words')
                .select('id,en,zh,form,created_at,updated_at')
                .order('id');
            if (!allForms) query = query.eq('form', form);
            else query = query.in('form', FORM_LEVELS.map(f => f.id));
            const { data, error } = await query;
            if (gen !== nvFetchGen) return;
            if (error) {
                nvSchemaMissing = isMissingSchema(error.message);
                hidePractice();
                if (status) status.innerText = nvSchemaMissing
                    ? 'New Vocab is not ready yet — the word-bank table has not been created.'
                    : 'Could not load New Vocab.';
                nvShowFeedback(nvSchemaMissing ? nvSqlSetupHtml() : ('Could not load New Vocab: ' + escapeHtml(error.message || '')), true);
                return;
            }
            nvSchemaMissing = false;
            const rows = data || [];
            const sig = rows.map(w => [w.id, w.en, w.zh, w.created_at].join('\t')).join('\n');
            const typing = document.activeElement && (document.activeElement.id === 'nv-en' || document.activeElement.id === 'nv-zh');
            nvRows = rows;
            nvApplyPractice();
            if (activities) activities.classList.remove('hidden');
            if (scope) scope.classList.remove('hidden');
            const fb = document.getElementById('nv-feedback');
            if (fb && fb.className.indexOf('amber-') !== -1) nvShowFeedback('', false);
            nvRenderStatus();
            if (force || (sig !== nvSig && !typing)) {
                nvSig = sig;
                nvRenderEditorList();
                const listView = document.getElementById('word-list-view');
                if (!force && listView && !listView.classList.contains('hidden') && currentTopic === NEW_VOCAB) showWordList(NEW_VOCAB);
            } else if (!typing) {
                nvSig = sig;
            }
        }

        function nvRenderStatus() {
            const status = document.getElementById('nv-status');
            if (!status) return;
            const form = nvActiveForm();
            const todayCount = nvRows.filter(w => nvAddedToday(w.created_at || w.updated_at)).length;
            const showing = nvPracticeRows().length;
            if (!nvRows.length) {
                status.innerText = browsesAllVocab()
                    ? 'All forms · no New Vocab words yet. If your teacher already added some, run supabase/new_vocab_unassigned_read.sql in the SQL editor, then refresh.'
                    : (form ? (form + ' word bank is empty. Words you add stay until you delete them.') : '');
                return;
            }
            const newest = nvRows.reduce((a, w) => !a || w.updated_at > a ? w.updated_at : a, '');
            const when = typeof hkDate === 'function' ? hkDate(newest) : '';
            const scopeLabel = nvScope === 'today' ? (showing + ' added today') : (showing + ' in the bank');
            const formLabelText = browsesAllVocab() ? 'All forms' : form;
            status.innerText = formLabelText + ' · ' + nvRows.length + ' saved · ' + todayCount + ' added today · practising ' + scopeLabel + (when ? ' · updated ' + when : '');
        }

        function nvRenderEditorList() {
            const list = document.getElementById('nv-editor-list');
            if (!list || !isAdmin()) return;
            const rows = nvPracticeRows();
            if (!rows.length) {
                list.innerHTML = '<p class="text-gray-400 text-sm">' + (nvScope === 'today' && nvRows.length
                    ? 'Nothing added today. Switch to All words to see the rest of the bank.'
                    : 'No words in this form yet.') + '</p>';
                return;
            }
            list.innerHTML = rows.map(w => `
                <div class="flex items-center justify-between gap-3 bg-white rounded-xl px-3 py-2">
                    <div class="min-w-0">
                        <span class="font-bold text-gray-800">${w.en ? escapeHtml(w.en) : '<span class="text-gray-300">English later</span>'}</span>
                        <span class="text-gray-400 ml-2">${w.zh ? escapeHtml(w.zh) : '<span class="text-gray-300">Chinese later</span>'}</span>
                        ${nvAddedToday(w.created_at) ? '<span class="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">today</span>' : ''}
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button type="button" onclick="nvBeginEdit(${Number(w.id)})" class="text-xs font-bold text-orange-600">Edit</button>
                        <button type="button" onclick="nvDeleteWord(${Number(w.id)})" title="Delete word" aria-label="Delete word" class="w-9 h-9 bg-white border-2 border-red-100 text-red-500 rounded-full font-bold text-xl leading-none flex items-center justify-center">−</button>
                    </div>
                </div>`).join('');
        }

        let nvCambridgeTimer = null;
        let nvCambridgeSeq = 0;
        let nvAutoZh = '';
        let nvCambridgeWord = '';
        let nvCambridgeMeanings = [];

        function nvClearCambridge() {
            if (nvCambridgeTimer) { clearTimeout(nvCambridgeTimer); nvCambridgeTimer = null; }
            nvCambridgeSeq += 1;
            nvAutoZh = '';
            nvCambridgeWord = '';
            nvCambridgeMeanings = [];
            const box = document.getElementById('nv-cambridge');
            if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
        }

        function nvNormalizeLookupWord(raw) {
            return String(raw || '').trim().replace(/\s+/g, ' ');
        }

        function nvCanLookup(word) {
            return /^[A-Za-z][A-Za-z0-9 .'\-]{0,79}$/.test(word);
        }

        function nvDefaultZh(meanings) {
            const texts = [];
            const seen = new Set();
            (meanings || []).forEach(m => {
                const t = String(m && m.text || '').trim();
                if (!t || seen.has(t)) return;
                seen.add(t);
                texts.push(t);
            });
            return texts.slice(0, 3).join('；');
        }

        function nvPaintCambridge(state, payload) {
            const box = document.getElementById('nv-cambridge');
            if (!box) return;
            if (!state) { box.classList.add('hidden'); box.innerHTML = ''; return; }
            box.classList.remove('hidden');
            if (state === 'loading') {
                box.innerHTML = 'Looking up Cambridge Dictionary…';
                return;
            }
            if (state === 'error') {
                box.innerHTML = 'Could not reach Cambridge Dictionary. Type the 中文 yourself.';
                return;
            }
            if (state === 'empty') {
                box.innerHTML = 'No Cambridge match — you can type the 中文 yourself.';
                return;
            }
            const meanings = (payload && payload.meanings) || [];
            nvCambridgeMeanings = meanings;
            const chips = meanings.map((m, i) => {
                const label = escapeHtml(m.text);
                return '<button type="button" onclick="nvPickCambridge(' + i + ')" class="px-3 py-1 rounded-full bg-white border-2 border-orange-100 text-orange-700 text-sm font-bold hover:bg-orange-100">' + label + '</button>';
            }).join(' ');
            box.innerHTML = '<p class="mb-2">Cambridge Dictionary (you can edit the 中文):</p><div class="flex flex-wrap gap-2">' + chips + '</div>';
        }

        function nvPickCambridge(i) {
            const item = nvCambridgeMeanings[i];
            if (!item) return;
            const zh = document.getElementById('nv-zh');
            if (zh) zh.value = item.text;
            nvAutoZh = item.text;
        }

        function nvScheduleCambridge() {
            if (nvCambridgeTimer) clearTimeout(nvCambridgeTimer);
            nvCambridgeTimer = setTimeout(function () { nvLookupCambridge(false); }, 600);
        }

        async function nvLookupCambridge(force) {
            if (nvCambridgeTimer) { clearTimeout(nvCambridgeTimer); nvCambridgeTimer = null; }
            if (!isAdmin()) return;
            const enEl = document.getElementById('nv-en');
            const word = nvNormalizeLookupWord(enEl && enEl.value);
            if (!nvCanLookup(word)) {
                if (force) nvPaintCambridge('empty');
                else if (!word) nvPaintCambridge('');
                return;
            }
            const zhEl = document.getElementById('nv-zh');
            const currentZh = zhEl ? zhEl.value.trim() : '';
            const canFill = !currentZh || currentZh === nvAutoZh;
            if (!force && word === nvCambridgeWord && currentZh && currentZh === nvAutoZh) return;
            const seq = ++nvCambridgeSeq;
            nvPaintCambridge('loading');
            try {
                const res = await fetch('/api/cambridge?word=' + encodeURIComponent(word));
                const data = await res.json().catch(function () { return {}; });
                if (seq !== nvCambridgeSeq) return;
                if (!res.ok) { nvPaintCambridge('error'); return; }
                const meanings = Array.isArray(data.meanings) ? data.meanings : [];
                nvCambridgeWord = word;
                if (!data.found || !meanings.length) {
                    nvPaintCambridge('empty');
                    return;
                }
                nvPaintCambridge('found', { meanings: meanings });
                if (zhEl && canFill) {
                    const filled = nvDefaultZh(meanings);
                    if (filled) {
                        zhEl.value = filled;
                        nvAutoZh = filled;
                    }
                }
            } catch (e) {
                if (seq !== nvCambridgeSeq) return;
                nvPaintCambridge('error');
            }
        }

        function nvBeginEdit(id) {
            const row = nvRows.find(w => Number(w.id) === Number(id));
            if (!row) return;
            nvEditingId = row.id;
            nvClearCambridge();
            const en = document.getElementById('nv-en');
            const zh = document.getElementById('nv-zh');
            if (en) en.value = row.en;
            if (zh) zh.value = row.zh || '';
            const save = document.getElementById('nv-save-btn');
            if (save) { save.title = 'Confirm'; save.setAttribute('aria-label', 'Confirm'); save.textContent = 'Confirm'; }
            if (en) en.focus();
        }

        function nvComposerKey(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                nvSaveWord();
            }
        }

        function nvStartNewWord() {
            nvCancelEdit();
            const en = document.getElementById('nv-en');
            if (en) {
                en.focus();
                if (typeof en.scrollIntoView === 'function') en.scrollIntoView({ block: 'nearest' });
            }
        }

        function nvRowSig() {
            return nvRows.map(w => [w.id, w.en, w.zh, w.created_at].join('\t')).join('\n');
        }

        function nvPaintLocal() {
            nvSig = nvRowSig();
            nvApplyPractice();
            nvRenderStatus();
            nvRenderEditorList();
        }

        function nvUpsertLocal(row) {
            if (!row || row.id == null) return;
            if (!row.created_at) row.created_at = new Date().toISOString();
            const idx = nvRows.findIndex(w => Number(w.id) === Number(row.id));
            if (idx >= 0) nvRows[idx] = Object.assign({}, nvRows[idx], row);
            else nvRows.push(row);
            nvRows.sort((a, b) => Number(a.id) - Number(b.id));
            nvPaintLocal();
        }

        function nvRemoveLocal(id) {
            nvRows = nvRows.filter(w => Number(w.id) !== Number(id));
            nvPaintLocal();
        }

        function nvCancelEdit() {
            nvEditingId = null;
            nvClearCambridge();
            const en = document.getElementById('nv-en');
            const zh = document.getElementById('nv-zh');
            if (en) en.value = '';
            if (zh) zh.value = '';
            const save = document.getElementById('nv-save-btn');
            if (save) { save.title = 'Confirm'; save.setAttribute('aria-label', 'Confirm'); save.textContent = 'Confirm'; }
        }

        async function nvSaveWord() {
            if (!isAdmin() || nvSaving) return;
            const en = (document.getElementById('nv-en').value || '').trim();
            const zh = (document.getElementById('nv-zh').value || '').trim();
            if (!en && !zh) {
                updateMascot('Type the English, the Chinese, or both.');
                nvShowFeedback('Type the English, the Chinese, or both, then press Confirm.', true);
                return;
            }
            const form = nvEditForm || FORM_LEVELS[0].id;
            const editingId = nvEditingId;
            nvSaving = true;
            const saveBtn = document.getElementById('nv-save-btn');
            if (saveBtn) saveBtn.disabled = true;
            let data, error;
            try {
                if (editingId) {
                    ({ data, error } = await sb.from('new_vocab_words').update({ en, zh }).eq('id', editingId).eq('form', form).select('id,en,zh,created_at,updated_at').maybeSingle());
                } else {
                    ({ data, error } = await sb.from('new_vocab_words').insert({ form, en, zh }).select('id,en,zh,created_at,updated_at').maybeSingle());
                }
            } finally {
                nvSaving = false;
                if (saveBtn) saveBtn.disabled = false;
            }
            if (error) {
                const check = /new_vocab_words_has_text|check constraint/i.test(error.message || '');
                const missing = isMissingSchema(error.message);
                const msg = check ? 'Type the English, the Chinese, or both.'
                    : missing
                    ? 'Confirm could not save the word because the New Vocab table is missing.'
                    : ('Could not save that word: ' + (error.message || 'please try again.'));
                updateMascot(msg);
                nvShowFeedback(missing ? (msg + ' ' + nvSqlSetupHtml()) : escapeHtml(msg), true);
                console.warn(error.message);
                return;
            }
            if (data) nvUpsertLocal(data);
            const label = en || zh;
            nvStartNewWord();
            await nvRefresh(true);
            const visible = nvPracticeRows().some(w => String(w.en || '').trim() === en && String(w.zh || '').trim() === zh)
                || nvRows.some(w => String(w.en || '').trim() === en && String(w.zh || '').trim() === zh);
            if (!visible && data) {
                // Saved, but the current "Added today" filter hid it — switch so the new word is on screen.
                if (nvScope === 'today') nvSetScope('all');
            }
            if (nvRows.some(w => String(w.en || '').trim() === en && String(w.zh || '').trim() === zh) || data) {
                if (data && !nvRows.some(w => Number(w.id) === Number(data.id))) nvUpsertLocal(data);
                let savedMsg = 'Saved “' + escapeHtml(label) + '” to the ' + escapeHtml(form) + ' word bank. It is in the list below, and students in ' + escapeHtml(form) + ' can practise it now.';
                if (en && !zh) savedMsg += ' Add the 中文 if you want this word in Recitation.';
                nvShowFeedback(savedMsg, false);
            } else {
                nvShowFeedback('Confirm did not add the word to the list. ' + nvSqlSetupHtml(), true);
            }
        }

        async function nvDeleteWord(id) {
            if (!isAdmin() || nvSaving) return;
            nvSaving = true;
            const { error } = await sb.from('new_vocab_words').delete().eq('id', id);
            nvSaving = false;
            if (error) {
                updateMascot('Could not delete that word.');
                console.warn(error.message);
                return;
            }
            if (Number(nvEditingId) === Number(id)) nvCancelEdit();
            nvRemoveLocal(id);
            nvRefresh(true);
        }

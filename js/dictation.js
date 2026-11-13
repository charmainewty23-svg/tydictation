/* LearniTY Dictation — Dictation Master topics, categories, error book,
   word list and the shared dictation quiz. Moved verbatim out of index.html. */

        let errorBook = [];
        let errorBookOwner = null;
        let ebCloudNote = '';

        let categories = {};
        let sheetCategoriesReady = false;
        let sheetCategoriesLoading = false;
        let currentTopic = '';
        
        // Quiz State
        let quizMode = 'listening'; // 'listening' or 'recitation'
        let quizSource = 'topic';   // 'topic' or 'errorbook'
        let wordListBack = 'topic';
        let quizWords = [];
        let quizIdx = 0;
        let quizScore = 0;
        let hintCount = 0;
        let quizResults = [];
        let tryAgainCount = 0;

        async function loadAllCategoriesFromSheet() {
            if (sheetCategoriesLoading) return;
            sheetCategoriesLoading = true;
            try {
                const promises = SHEET_NAMES.map(async (name) => {
                    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
                    const response = await fetch(url);
                    if (!response.ok) return { name, words: [] };
                    const csvText = await response.text();
                    const words = parseCSV(csvText);
                    return { name, words };
                });
                const results = await Promise.all(promises);
                results.forEach(res => { if (res.words.length > 0) categories[res.name] = res.words; });
                sheetCategoriesReady = true;
                renderCategories();
                renderTenseGrid();
                if (typeof battlePopulateTopics === 'function') battlePopulateTopics();
                if (typeof WJ !== 'undefined' && WJ.mounted) { WJ.populateTopics(); WJ.setTopicDefault(); }
            } catch (e) {
                sheetCategoriesReady = true;
                updateMascot("Oh no, connection lost!");
                renderCategories();
            } finally {
                sheetCategoriesLoading = false;
            }
        }

        function renderCategories() {
            const container = document.getElementById('categories-grid');
            if (!container) return;
            container.innerHTML = "";
            appendDictationTile(container, '🆕', 'New Vocab', () => selectTopic(NEW_VOCAB));
            appendDictationTile(container, '📒', 'Error Book', () => openErrorBook());
            SHEET_NAMES.forEach(cat => {
                if (!categories[cat]) return;
                const emojis = { "charity": "❤️", "entertainment": "🎬", "environmental issues": "🌱", "family": "🏠", "fashion": "👗", "festivals": "🎉", "food and restaurants": "🍕", "health": "🏥", "housing": "🏢", "law and order": "⚖️", "modern communication": "📱", "people": "👥", "animals and pets": "🐱", "school": "🏫", "Shopping": "🛍️", "social affairs": "🤝", "MTR stations": "🚇", "sports": "⚽", "exam focus": "📝", "basics": "🔤" };
                appendDictationTile(container, emojis[cat] || '📦', topicLabel(cat), () => selectTopic(cat));
            });
            if (sheetCategoriesReady && SHEET_NAMES.every(cat => !categories[cat])) {
                const note = document.createElement('p');
                note.className = 'col-span-full text-center text-sm text-amber-600 font-bold mt-2';
                note.textContent = 'The Google Sheet topics did not load. Check your connection, then refresh to try again. New Vocab and Error Book are still available.';
                container.appendChild(note);
            }
        }

        function appendDictationTile(container, emoji, label, onclick) {
            const div = document.createElement('div');
            div.className = "category-box shadow-sm";
            div.onclick = onclick;
            div.innerHTML = `<div class="text-4xl mb-4">${emoji}</div><div class="font-bold text-center leading-tight">${label}</div>`;
            container.appendChild(div);
        }

        function selectTopic(topic) {
            currentTopic = topic;
            currentSubCategory = '';
            quizSource = 'topic';
            document.getElementById('current-topic-title').innerText = topicLabel(topic);
            changeView('sub-category-view');
        }

        function quizLeave() {
            changeView(quizSource === 'errorbook' ? 'error-book-view' : 'sub-category-view');
        }

        function leaveWordList() {
            changeView(wordListBack === 'errorbook' ? 'error-book-view' : 'sub-category-view');
        }

        function errorBookStorageKey() {
            if (previewStudentForm()) return 'error_book:preview:' + previewStudentForm();
            if (isGuestUser()) return 'error_book:guest-session';
            return canUseCloud() ? ('error_book:' + currentUser.id) : 'error_book:guest';
        }

        function errorBookStore() {
            return isGuestUser() ? sessionStorage : localStorage;
        }

        function saveErrorBookLocal() {
            try { errorBookStore().setItem(errorBookStorageKey(), JSON.stringify(errorBook)); } catch (e) {}
        }

        function readErrorBookLocal() {
            try {
                const parsed = JSON.parse(errorBookStore().getItem(errorBookStorageKey()) || '[]');
                return Array.isArray(parsed) ? parsed.filter(w => w && w.en) : [];
            } catch (e) { return []; }
        }

        function adoptErrorBookUser() {
            if (canUseCloud()) {
                try { localStorage.removeItem('error_book:guest'); } catch (e) {}
            }
            const next = currentUser ? currentUser.id : null;
            if (errorBookOwner !== next) {
                errorBook = [];
                errorBookOwner = next;
                ebCloudNote = '';
            }
            loadErrorBook();
        }

        async function loadErrorBook() {
            if (canUseCloud()) {
                const { data, error } = await sb.from('error_book').select('en,zh,topic').eq('user_id', currentUser.id).order('created_at');
                if (!error && data) {
                    errorBook = data.map(w => ({ en: w.en, zh: w.zh || '', topic: w.topic || '' }));
                    ebCloudNote = '';
                    saveErrorBookLocal();
                    if (document.getElementById('error-book-view') && !document.getElementById('error-book-view').classList.contains('hidden')) renderErrorBook();
                    return;
                }
                ebCloudNote = error && isMissingSchema(error.message)
                    ? 'The Error Book table is not ready yet, so missed words stay only on this device until you run supabase/student_forms.sql and then supabase/new_vocab.sql in the Supabase SQL editor (same setup as New Vocab; skip files you have already run). Then refresh.'
                    : '';
                if (error && !isMissingSchema(error.message)) console.warn('Error book load failed:', error.message);
            } else {
                ebCloudNote = '';
            }
            errorBook = readErrorBookLocal();
            if (document.getElementById('error-book-view') && !document.getElementById('error-book-view').classList.contains('hidden')) renderErrorBook();
        }

        function addErrorWord(word) {
            const en = String(word && word.en || '').trim();
            const zh = String(word && word.zh || '').trim();
            if (!en || errorBook.some(w => w.en === en)) return;
            errorBook.push({ en, zh, topic: currentTopic });
            saveErrorBookLocal();
            if (!canUseCloud() || previewStudentForm()) return;
            sb.from('error_book').upsert({
                user_id: currentUser.id, en, zh, topic: currentTopic || ''
            }, { onConflict: 'user_id,en' }).then(({ error }) => {
                if (error) console.warn('Error book save failed:', error.message);
            });
        }

        function removeErrorWord(word) {
            const en = String(word && word.en || '').trim();
            if (!en) return;
            errorBook = errorBook.filter(w => w.en !== en);
            saveErrorBookLocal();
            if (document.getElementById('error-book-view') && !document.getElementById('error-book-view').classList.contains('hidden')) renderErrorBook();
            if (!canUseCloud() || previewStudentForm()) return;
            sb.from('error_book').delete().eq('user_id', currentUser.id).eq('en', en).then(({ error }) => {
                if (error) console.warn('Error book remove failed:', error.message);
            });
        }

        function openErrorBook() {
            quizSource = 'errorbook';
            recordGuestUsage('Error Book');
            changeView('error-book-view');
        }

        function renderErrorBook() {
            const list = document.getElementById('eb-list');
            const note = document.getElementById('eb-note');
            if (!list) return;
            if (note) {
                note.classList.toggle('hidden', !ebCloudNote);
                note.innerText = ebCloudNote || '';
            }
            if (!errorBook.length) {
                list.innerHTML = '<p class="text-gray-400 text-center py-8">No words yet. A miss in Dictation Master is added here.</p>';
                return;
            }
            list.innerHTML = errorBook.map(w => `
                <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 gap-3">
                    <span class="font-bold text-gray-800">${escapeHtml(w.en)}</span>
                    <span class="text-gray-400">${escapeHtml(w.zh || '')}</span>
                </div>`).join('');
        }

        function startErrorBookQuiz(mode) {
            currentTopic = ERROR_BOOK;
            startQuiz(mode, 'errorbook');
        }

        function showErrorBookRevision() {
            if (!errorBook.length) {
                updateMascot("Your error book is empty. Miss a word in dictation and it will show up here.");
                return;
            }
            showWordList(ERROR_BOOK);
        }

        function openActivity(type) {
            if (type === 'revision') {
                showWordList(currentTopic);
            }
        }

        // Shared Quiz Logic
        function startQuiz(mode, source) {
            quizSource = source || 'topic';
            let allWords = quizSource === 'errorbook'
                ? errorBook.map(w => ({ en: w.en, zh: w.zh || '' }))
                : categories[currentTopic];
            if (!allWords || allWords.length === 0) {
                if (currentTopic === NEW_VOCAB) {
                    const visible = nvPracticeRows();
                    if (!visible.length && nvScope === 'today' && nvRows.length) updateMascot("Nothing was added today. Switch to All words to practise the bank.");
                    else if (visible.length) updateMascot("These words don't have English yet. You can still read them in Revision.");
                    else updateMascot("This form's word bank is empty.");
                } else if (quizSource === 'errorbook') {
                    updateMascot("Your error book is empty. Miss a word in dictation and it will show up here.");
                } else {
                    updateMascot("This topic is currently empty!");
                }
                return;
            }

            // Filter by sub-category for exam focus
            if (currentTopic === 'exam focus' && currentSubCategory) {
                allWords = allWords.filter(w => matchExamFocusCat(w, currentSubCategory));
            }
            if (allWords.length === 0) {
                updateMascot("No words in this category!");
                return;
            }

            if (mode === 'recitation') {
                const withChinese = allWords.filter(w => String(w && w.zh || '').trim());
                if (!withChinese.length) {
                    updateMascot(currentTopic === NEW_VOCAB
                        ? "Recitation shows the Chinese, then you type the English. Please add 中文 to these words first."
                        : "These words don't have Chinese yet, so Recitation can't start.");
                    return;
                }
                allWords = withChinese;
            }
            
            quizMode = mode;
            const limit = (currentTopic === NEW_VOCAB || quizSource === 'errorbook') ? allWords.length : 15;
            quizWords = [...allWords].sort(() => 0.5 - Math.random()).slice(0, limit);
            quizIdx = 0;
            quizScore = 0;
            quizResults = [];
            recordGuestUsage(mode === 'listening' ? 'Dictation: Listening' : 'Dictation: Recitation',
                quizSource === 'errorbook' ? 'Error Book' : (currentTopic || ''));
            
            // UI Setup for Mode
            document.getElementById('quiz-title-display').innerText = mode === 'listening' ? 'Listening Challenge' : 'Recitation Master';
            
            if (mode === 'listening') {
                document.getElementById('listening-mode-elements').classList.remove('hidden');
                document.getElementById('recitation-mode-elements').classList.add('hidden');
                document.getElementById('word-translation-hint').classList.remove('hidden');
            } else {
                document.getElementById('listening-mode-elements').classList.add('hidden');
                document.getElementById('recitation-mode-elements').classList.remove('hidden');
                document.getElementById('word-translation-hint').classList.add('hidden'); // We use giant text instead
            }
            
            updateQuizUI();
            changeView('quiz-view');
            
            if (mode === 'listening') {
                setTimeout(speakCurrentWord, 500);
            }
        }

        function updateQuizUI() {
            const word = quizWords[quizIdx];
            document.getElementById('quiz-progress').innerText = `Word ${quizIdx + 1} of ${quizWords.length}`;
            document.getElementById('quiz-score').innerText = `Score: ${quizScore}`;
            
            if (quizMode === 'listening') {
                const hint = document.getElementById('word-translation-hint');
                if (word.zh) {
                    hint.innerText = word.zh;
                    hint.classList.remove('hidden');
                } else {
                    hint.innerText = '';
                    hint.classList.add('hidden');
                }
            } else {
                document.getElementById('giant-chinese-prompt').innerText = word.zh || 'Type the English word';
            }
            
            document.getElementById('quiz-answer-input').value = "";
            document.getElementById('quiz-answer-input').focus();
            hintCount = 0;
            tryAgainCount = 0;
            updateHintDisplay();
        }

        function speakCurrentWord() {
            if (quizIdx >= quizWords.length) return;
            const word = primaryAnswer(quizWords[quizIdx].en);
            const utterance = new SpeechSynthesisUtterance(word);
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            speechSynthesis.speak(utterance);
        }

        function provideHint() {
            const word = primaryAnswer(quizWords[quizIdx].en);
            if (hintCount < word.length) {
                hintCount++;
                updateHintDisplay();
            }
        }

        function updateHintDisplay() {
            const word = primaryAnswer(quizWords[quizIdx].en);
            const userInput = document.getElementById('quiz-answer-input').value.toLowerCase();
            let display = "";
            for (let i = 0; i < word.length; i++) {
                if (i < hintCount) display += word[i];
                else if (word[i] === " ") display += "  ";
                else if (i < userInput.length) display += userInput[i];
                else display += "_";
            }
            document.getElementById('hint-display').innerText = display;
        }

        const ENCOURAGE_WORDS = ["Great!", "Awesome!", "Perfect!", "Well done!", "Brilliant!", "Excellent!", "Nice one!", "Superb!", "Amazing!", "Keep it up!"];
        const TRY_AGAIN_WORDS = ["Almost there!", "Try again!", "So close!", "Have another go!", "Not quite, keep trying!", "You can do it!", "One more try!", "Nearly! Try once more!"];

        function showEncouragement() {
            const popup = document.createElement('div');
            popup.className = 'encourage-popup';
            popup.innerText = ENCOURAGE_WORDS[Math.floor(Math.random() * ENCOURAGE_WORDS.length)];
            document.body.appendChild(popup);
            requestAnimationFrame(() => popup.classList.add('show'));
            setTimeout(() => popup.remove(), 1300);
        }

        function showTryAgain() {
            const popup = document.createElement('div');
            popup.className = 'encourage-popup';
            popup.style.color = '#e67700';
            popup.style.borderColor = '#ffec99';
            popup.style.boxShadow = '0 10px 0 #ffec99';
            popup.innerText = TRY_AGAIN_WORDS[Math.floor(Math.random() * TRY_AGAIN_WORDS.length)];
            document.body.appendChild(popup);
            requestAnimationFrame(() => popup.classList.add('show'));
            setTimeout(() => popup.remove(), 1300);
        }

        function checkAnswer() {
            const typed = document.getElementById('quiz-answer-input').value;
            const isCorrect = isAnswerCorrect(typed, quizWords[quizIdx].en);

            if (isCorrect) {
                quizResults.push({ word: quizWords[quizIdx].en, userAnswer: document.getElementById('quiz-answer-input').value.trim(), correct: true });
                quizScore += Math.max(1, 10 - hintCount);
                if (quizSource === 'errorbook') removeErrorWord(quizWords[quizIdx]);
                showEncouragement();
                updateMascot("Correct! Great job!");
                advanceQuiz();
            } else {
                tryAgainCount++;
                if (tryAgainCount < 3) {
                    // 1st or 2nd wrong — encourage to try again
                    showTryAgain();
                    const hints = ["Give it another go!", "Try once more!", "You're close, try again!"];
                    updateMascot(hints[Math.floor(Math.random() * hints.length)]);
                    document.getElementById('quiz-answer-input').value = "";
                    document.getElementById('quiz-answer-input').focus();
                    updateHintDisplay();
                } else {
                    // 3rd wrong — show answer and move on
                    quizResults.push({ word: quizWords[quizIdx].en, userAnswer: document.getElementById('quiz-answer-input').value.trim(), correct: false });
                    if (quizSource !== 'errorbook') addErrorWord(quizWords[quizIdx]);
                    document.getElementById('hint-display').innerText = quizWords[quizIdx].en;
                    document.getElementById('hint-display').classList.add('text-red-500');
                    document.getElementById('hint-display').classList.remove('text-orange-500');
                    updateMascot(`The answer is "${quizWords[quizIdx].en}".`);
                    setTimeout(() => {
                        document.getElementById('hint-display').classList.remove('text-red-500');
                        document.getElementById('hint-display').classList.add('text-orange-500');
                        advanceQuiz();
                    }, 4000);
                }
            }
        }

        function advanceQuiz() {
            quizIdx++;
            if (quizIdx < quizWords.length) {
                updateQuizUI();
                if (quizMode === 'listening') {
                    setTimeout(speakCurrentWord, 300);
                }
            } else {
                finishQuiz();
            }
        }

        function finishQuiz() {
            const total = quizWords.length;
            const correctCount = quizResults.filter(r => r.correct).length;
            const accuracy = Math.round((correctCount / total) * 100);

            // Save to local (session-only for guests, so a later visitor is not mixed in)
            const historyStore = (isGuestUser() || previewStudentForm()) ? sessionStorage : localStorage;
            const historyKey = previewStudentForm() ? ('dict_history:preview:' + previewStudentForm()) : (isGuestUser() ? 'dict_history_guest' : 'dict_history');
            const history = JSON.parse(historyStore.getItem(historyKey) || '[]');
            const record = { t: Date.now(), topic: currentTopic, mode: quizMode, score: quizScore, total: total, correct: correctCount, accuracy: accuracy };
            history.push(record);
            historyStore.setItem(historyKey, JSON.stringify(history));

            // Sync to Supabase if a school account is signed in (never for guests or teacher preview)
            let cloudSynced = false;
            if (canUseCloud() && !previewStudentForm()) {
                sb.from("dictation_results").insert({
                    user_id: currentUser.id,
                    email: currentUser.email,
                    nickname: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
                    topic: currentTopic,
                    mode: quizMode,
                    score: quizScore,
                    total: total
                }).then(({ error }) => {
                    if (error) console.error("Dictation save failed:", error);
                    else cloudSynced = true;
                });
            }

            // Best score for this topic+mode
            const topicHistory = history.filter(h => h.topic === currentTopic && h.mode === quizMode);
            const best = topicHistory.reduce((a, b) => a.score > b.score ? a : b);

            // Recent 5 records
            const recent = history.slice(-5).reverse();

            const content = document.getElementById('main-container');
            const finalView = document.createElement('div');
            finalView.className = "cat-card p-12 text-center w-full";
            finalView.innerHTML = `
                <div class="text-9xl mb-6">🏆</div>
                <h2 class="text-4xl font-bold text-orange-600 mb-2">Quiz Finished!</h2>
                <p class="text-2xl text-gray-500 mb-4">You earned ${quizScore} points in ${currentTopic}.</p>
                <p class="text-xl text-gray-400 mb-8">Accuracy: ${correctCount}/${total} (${accuracy}%)</p>
                ${previewStudentForm() ? '<p class="text-sm text-amber-600 mb-4">Preview only — this score is not saved to the teacher account or leaderboard.</p>' : (canUseCloud() ? '<p class="text-sm text-green-500 mb-4">☁️ Synced to cloud</p>' : (isGuestUser() ? '<p class="text-sm text-gray-400 mb-4">Guest results stay in this visit only and are not added to any leaderboard.</p>' : '<p class="text-sm text-gray-400 mb-4">Login to sync results across devices</p>'))}

                <div class="bg-orange-50 rounded-2xl p-6 mb-8 border-2 border-orange-100">
                    <h3 class="text-lg font-bold text-orange-600 mb-2">🏅 Best Score (${quizMode})</h3>
                    <p class="text-3xl font-bold text-orange-700">${best.score} pts · ${best.accuracy}%</p>
                </div>

                <div class="text-left mb-8">
                    <h3 class="text-lg font-bold text-gray-600 mb-4">📋 Recent Records</h3>
                    <div class="space-y-2">
                        ${recent.map(r => `
                            <div class="flex justify-between items-center bg-gray-50 rounded-xl px-4 py-3 text-sm">
                                <span class="font-bold text-gray-700">${r.topic}</span>
                                <span class="text-gray-400 capitalize">${r.mode}</span>
                                <span class="font-bold text-orange-600">${r.score} pts</span>
                                <span class="text-gray-400">${r.accuracy}%</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <button onclick="quizLeave()" class="btn-paw">Return to Topic</button>
            `;
            
            document.getElementById('quiz-view').classList.add('hidden');
            document.getElementById('main-container').appendChild(finalView);
            window.lastFinalView = finalView;
            // After the result card is on screen, celebrate the daily streak.
            recordDailyPractice('Dictation', { delayMs: 700 });
        }

        const EXAM_FOCUS_CATS = [
            { key: '1', label: '(1) Youngsters', min: 1, max: 17 },
            { key: '2', label: '(2) Family', min: 18, max: 30 },
            { key: '3', label: '(3) Arts & Cultural Lifestyle', min: 31, max: 48 },
            { key: '4', label: '(4) Customs', min: 49, max: 64 },
            { key: '5', label: '(5) Study Trips', min: 65, max: 76 }
        ];

        function matchExamFocusCat(word, catKey) {
            const cat = EXAM_FOCUS_CATS.find(c => c.key === catKey);
            if (!cat) return false;
            const num = parseInt(word.cat);
            return num >= cat.min && num <= cat.max;
        }

        function showWordList(catName) {
            let words = catName === ERROR_BOOK ? errorBook.slice()
                : catName === NEW_VOCAB ? nvPracticeRows().map(w => ({ en: String(w.en || '').trim(), zh: String(w.zh || '').trim() }))
                : categories[catName];
            if (!words || words.length === 0) {
                updateMascot(catName === NEW_VOCAB && nvScope === 'today' && nvRows.length
                    ? "Nothing was added today. Switch to All words."
                    : (catName === NEW_VOCAB ? "This form's word bank is empty." : "No words to revise yet."));
                return;
            }

            const isExamFocus = catName === 'exam focus';
            if (isExamFocus && currentSubCategory) {
                words = words.filter(w => matchExamFocusCat(w, currentSubCategory));
            }

            const container = document.getElementById('word-list-container');
            container.innerHTML = `
                <div class="flex items-center justify-between mb-6">
                    <div>
                        <h2 class="text-3xl font-bold text-orange-600 capitalize">Revision: ${escapeHtml(catName)}</h2>
                        <p class="text-gray-400 mt-1">Study the terms before your dictation.</p>
                    </div>
                    <span class="bg-orange-100 text-orange-600 px-4 py-1.5 rounded-full text-lg font-bold">${words.length} Words</span>
                </div>
                ${isExamFocus ? `
                    <div class="flex flex-wrap gap-2 mb-6">
                        <button onclick="filterRevision('')" class="px-4 py-2 rounded-full font-bold text-sm ${!currentSubCategory ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'} filter-rev-btn">All</button>
                        ${EXAM_FOCUS_CATS.map(c => `
                            <button onclick="filterRevision('${c.key}')" class="px-4 py-2 rounded-full font-bold text-sm ${currentSubCategory === c.key ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'} filter-rev-btn">${c.label}</button>
                        `).join('')}
                    </div>
                ` : ''}
                <div id="word-list-items" class="space-y-3">
                    ${words.map(w => `
                        <div class="word-list-item">
                            <span class="font-bold text-2xl text-gray-800">${w.en ? escapeHtml(w.en) : '<span class="text-gray-300">English later</span>'}</span>
                            <span class="text-gray-400 font-medium text-xl">${w.zh ? escapeHtml(w.zh) : ''}</span>
                        </div>
                    `).join('')}
                </div>
            `;
            changeView('word-list-view');
            recordGuestUsage('Dictation: Revision', catName || '');
            wordListBack = catName === ERROR_BOOK ? 'errorbook' : 'topic';
        }

        function filterRevision(cat) {
            currentSubCategory = cat;
            showWordList(currentTopic);
        }

        // Handle Enter key in quiz
        document.getElementById('quiz-answer-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') checkAnswer();
        });


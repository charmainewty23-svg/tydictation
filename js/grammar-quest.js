/* LearniTY Dictation — Grammar Quest: tenses data + revision grid, sentence
   structures, conditionals / participle clause quizzes, grammar admin.
   Moved verbatim out of index.html. */

        // Grammar data
        const tenseData = {
            "simple present": { emoji: "📅", usage: "Habits, general truths, and fixed schedules.", structure: { positive: { rule: "S + V(s/es)", example: "I eat an apple. / She eats bread." }, negative: { rule: "S + do/does not + V (base)", example: "I do not eat junk food." }, question: { rule: "Do/Does + S + V (base)?", example: "Do you eat fruit?" }, passive: { rule: "S + am/is/are + V3", example: "The apple is eaten by me." } } },
            "simple past": { emoji: "📜", usage: "Actions completed at a specific time in the past.", structure: { positive: { rule: "S + V (past)", example: "They visited Paris last year." }, negative: { rule: "S + did not + V (base)", example: "They did not visit London." }, question: { rule: "Did + S + V (base)?", example: "Did they visit the museum?" }, passive: { rule: "S + was/were + V3", example: "Paris was visited by them." } } },
            "simple future": { emoji: "🚀", usage: "Future actions, promises, or predictions.", structure: { positive: { rule: "S + will + V (base)", example: "We will travel to Japan." }, negative: { rule: "S + will not + V (base)", example: "We will not travel by bus." }, question: { rule: "Will + S + V (base)?", example: "Will we see the stars?" }, passive: { rule: "S + will be + V3", example: "Japan will be visited by us." } } },
            "present continuous": { emoji: "🏃", usage: "Actions happening exactly now.", structure: { positive: { rule: "S + am/is/are + Ving", example: "I am writing a letter." }, negative: { rule: "S + am/is/are + not + Ving", example: "I am not watching TV." }, question: { rule: "Am/Is/Are + S + Ving?", example: "Are you writing a book?" }, passive: { rule: "S + am/is/are + being + V3", example: "A letter is being written." } } },
            "past continuous": { emoji: "🕰️", usage: "Action in progress at a specific point in the past.", structure: { positive: { rule: "S + was/were + Ving", example: "He was studying when you called." }, negative: { rule: "S + was/were + not + Ving", example: "He was not playing games." }, question: { rule: "Was/Were + S + Ving?", example: "Was he studying?" }, passive: { rule: "S + was/were + being + V3", example: "The test was being studied for." } } },
            "future continuous": { emoji: "🔮", usage: "Actions that will be in progress in the future.", structure: { positive: { rule: "S + will be + Ving", example: "Tomorrow at 5, I will be flying." }, negative: { rule: "S + will not be + Ving", example: "I will not be sleeping." }, question: { rule: "Will + S + be + Ving?", example: "Will you be flying?" }, passive: { rule: "Rarely used", example: "N/A" } } },
            "present perfect tense": { emoji: "✅", usage: "Past actions with current relevance or continuing state.", structure: { positive: { rule: "S + have/has + V3", example: "I have seen that movie." }, negative: { rule: "S + have/has + not + V3", example: "I have not seen it yet." }, question: { rule: "Have/Has + S + V3?", example: "Have you seen it?" }, passive: { rule: "S + have/has + been + V3", example: "That movie has been seen." } } },
            "past perfect": { emoji: "🏰", usage: "Action completed before another past action.", structure: { positive: { rule: "S + had + V3", example: "She had left before I arrived." }, negative: { rule: "S + had + not + V3", example: "She had not finished yet." }, question: { rule: "Had + S + V3?", example: "Had she left her keys?" }, passive: { rule: "S + had + been + V3", example: "The keys had been left." } } },
            "future perfect tense": {
                emoji: "⏳",
                usage: "An action that will be completed before a specific time or another action in the future.",
                structure: {
                    positive: { rule: "S + will have + V3", example: "By 8 p.m., she will have finished her homework." },
                    negative: { rule: "S + will not have + V3", example: "She will not have finished her homework by 8 p.m." },
                    question: { rule: "Will + S + have + V3?", example: "Will she have finished her homework by 8 p.m.?" },
                    passive: { rule: "S + will have been + V3", example: "The homework will have been finished by 8 p.m." }
                }
            }
        };

        const structureData = {
            "conditionals": { title: "Conditionals (Type 0 - 3)", emoji: "⚖️", intro: "Conditional sentences describe the result of a certain condition.", sections: [{ tag: "Zero Conditional", rule: "If + Simple Present, ... Simple Present", example: "If you heat ice, it melts." }, { tag: "First Conditional", rule: "If + Simple Present, ... will + Verb", example: "If it rains, I will stay home." }, { tag: "Second Conditional", rule: "If + Simple Past, ... would + Verb", example: "If I won the lottery, I would travel." }, { tag: "Third Conditional", rule: "If + Past Perfect, ... would have + V3", example: "If I had studied, I would have passed." }] },
            "participle_clauses": { title: "Participle Clauses", emoji: "🔗", intro: "Participle clauses provide extra info when the subject is shared.", sections: [{ tag: "Present Participle (Active)", rule: "V-ing ..., (Main Clause)", example: "Walking down the street, I saw a friend." }, { tag: "Past Participle (Passive)", rule: "V3 ..., (Main Clause)", example: "Shocked by the news, she couldn't speak." }] },
            "not_only_but_also": { title: "Not only... but also", emoji: "➕", intro: "Used for emphasis with parallel structure.", sections: [{ tag: "Adjectives", rule: "not only [Adj] but also [Adj]", example: "He is not only smart but also kind." }, { tag: "Inverted", rule: "Not only did they lose...", example: "Not only did they lose the game, but also their pride." }] },
            "inversion": { title: "Inversion", emoji: "🔄", intro: "Reversing normal order for emphasis.", sections: [{ tag: "Only when...", rule: "Only when + [Clause], + [Inverted Clause]", example: "Only when the rain stopped did we go out." }] },
            "be_it_they": { title: "Be it / Be they", emoji: "🤔", intro: "Formal 'whether it is/they are'.", sections: [{ tag: "Singular", rule: "Be it A or B...", example: "Be it rain or shine, we will play." }, { tag: "Plural", rule: "Be they young or old...", example: "Everyone loves music, be they young or old." }] },
            "with_noun_phrase": { title: "With + N/Gerund", emoji: "🧺", intro: "Describes accompanying circumstances or reasons.", sections: [{ tag: "Noun Phrase", rule: "With + Noun Phrase, ...", example: "With a heavy heart, she left." }, { tag: "Object + Ving", rule: "With + Obj + Ving, ...", example: "With the exams approaching, I'm busy." }] }
        };

        // If-clause quiz state
        let ifClauseData = [];
        let ifClauseQuizIdx = 0;
        let ifClauseQuizScore = 0;
        let ifClauseQuizResults = [];
        let ifClauseQuizWords = [];
        let ifClauseTryCount = 0;

        // Participle clauses quiz state
        let pcData = [];
        let pcQuizIdx = 0;
        let pcQuizScore = 0;
        let pcQuizResults = [];
        let pcQuizWords = [];
        let pcTryCount = 0;
        let pcTab = 'revision';

        function saveGrammarToCloud(grammarType, score, total) {
            if (!canUseCloud() || previewStudentForm()) return;
            sb.from("dictation_results").insert({
                user_id: currentUser.id,
                email: currentUser.email,
                nickname: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
                topic: grammarType,
                mode: grammarType,
                score: score,
                total: total
            }).then(({ error }) => { if (error) console.error("Grammar save failed:", error); });
        }

        function renderTenseGrid() {
            const grid = document.getElementById('tense-grid');
            if(!grid) return;
            grid.innerHTML = "";
            Object.keys(tenseData).forEach(key => {
                const data = tenseData[key];
                const div = document.createElement('div');
                div.className = "category-box border-green-100 hover:border-green-400";
                div.onclick = () => showTenseDetail(key);
                div.innerHTML = `<div class="text-5xl mb-3">${data.emoji}</div><div class="font-bold text-center uppercase text-sm">${key}</div>`;
                grid.appendChild(div);
            });
        }

        function showTenseDetail(key) {
            const data = tenseData[key];
            const content = document.getElementById('grammar-detail-content');
            document.getElementById('detail-back-btn').onclick = () => changeView('grammar-tense-list-view');
            content.innerHTML = `
                <div class="text-center mb-10"><div class="text-8xl mb-4">${data.emoji}</div><h2 class="text-4xl font-bold text-green-600 capitalize">${key}</h2></div>
                <div class="mb-10"><h3 class="text-2xl font-bold text-green-700 mb-4">💡 Usage</h3><p class="text-gray-700 text-xl leading-relaxed bg-green-50 p-6 rounded-2xl border-l-8 border-green-400">${data.usage}</p></div>
                <div class="space-y-6">
                    <h3 class="text-2xl font-bold text-green-700">🏗️ Structure</h3>
                    ${['positive', 'negative', 'question', 'passive'].map(type => `
                        <div class="grammar-card" style="border-color: ${type === 'positive' ? '#b2f2bb' : type === 'negative' ? '#ffc9c9' : type === 'question' ? '#d0ebff' : '#e5dbff'}">
                            <span class="grammar-tag" style="background: ${type === 'positive' ? '#e6fffa' : type === 'negative' ? '#fff5f5' : type === 'question' ? '#e7f5ff' : '#f3f0ff'}">${type.toUpperCase()}</span>
                            <p class="font-bold text-2xl text-gray-800">${data.structure[type].rule}</p>
                            <p class="mt-3 italic text-gray-500 text-lg">Example: ${data.structure[type].example}</p>
                        </div>
                    `).join('')}
                </div>
            `;
            changeView('grammar-detail-view');
        }

        function showStructureDetail(key) {
            const data = structureData[key];
            if (key === 'conditionals' || key === 'participle_clauses') {
                recordGuestUsage('Grammar Quest', key === 'conditionals' ? 'Conditionals' : 'Participle Clauses');
            }
            const content = document.getElementById('grammar-detail-content');
            document.getElementById('detail-back-btn').onclick = () => changeView('sentence-structures-view');

            if (key === 'conditionals') {
                ifClauseTab = 'revision';
                renderConditionalsTabs(content, data);
            } else if (key === 'participle_clauses') {
                pcTab = 'revision';
                renderPCTabs(content, data);
            } else {
                content.innerHTML = `
                    <div class="text-center mb-10"><div class="text-8xl mb-4">${data.emoji}</div><h2 class="text-4xl font-bold text-green-600">${data.title}</h2></div>
                    <div class="mb-10"><h3 class="text-2xl font-bold text-green-700 mb-4">💡 Explanation</h3><p class="text-gray-700 text-xl leading-relaxed bg-green-50 p-6 rounded-2xl border-l-8 border-green-400">${data.intro}</p></div>
                    <div class="space-y-6">
                        <h3 class="text-2xl font-bold text-green-700">✍️ Examples</h3>
                        ${data.sections.map(sec => `
                            <div class="grammar-card">
                                <span class="grammar-tag bg-green-100 text-green-600">${sec.tag}</span>
                                <p class="font-bold text-2xl text-gray-800 mb-2">${sec.rule}</p>
                                <p class="text-gray-600 text-lg italic bg-gray-50 p-4 rounded-xl border-dashed border-2 border-gray-200">${sec.example}</p>
                            </div>
                        `).join('')}
                    </div>
                `;
            }
            changeView('grammar-detail-view');
        }

        function renderConditionalsTabs(content, data) {
            const tabs = [
                { key: 'revision', label: '📖 Revision' },
                { key: 'quiz', label: '✏️ Quiz' },
                { key: 'record', label: '📋 My Record' }
            ];
            content.innerHTML = `
                <div class="text-center mb-6"><div class="text-8xl mb-4">${data.emoji}</div><h2 class="text-4xl font-bold text-green-600">${data.title}</h2></div>
                <div class="flex gap-3 mb-8 justify-center">
                    ${tabs.map(t => `<button onclick="switchIfClauseTab('${t.key}')" class="if-clause-tab px-5 py-2 rounded-full font-bold text-sm ${ifClauseTab === t.key ? 'bg-green-500 text-white' : 'bg-green-100 text-green-600'}">${t.label}</button>`).join('')}
                </div>
                <div id="if-clause-tab-content"></div>
            `;
            renderIfClauseTabContent(data);
        }

        function switchIfClauseTab(tab) {
            ifClauseTab = tab;
            document.querySelectorAll('.if-clause-tab').forEach(b => {
                b.classList.remove('bg-green-500','text-white');
                b.classList.add('bg-green-100','text-green-600');
            });
            event.target.classList.remove('bg-green-100','text-green-600');
            event.target.classList.add('bg-green-500','text-white');
            renderIfClauseTabContent(structureData['conditionals']);
        }

        function renderIfClauseTabContent(data) {
            const container = document.getElementById('if-clause-tab-content');
            if (ifClauseTab === 'revision') {
                container.innerHTML = `
                    <div class="mb-10"><h3 class="text-2xl font-bold text-green-700 mb-4">💡 Explanation</h3><p class="text-gray-700 text-xl leading-relaxed bg-green-50 p-6 rounded-2xl border-l-8 border-green-400">${data.intro}</p></div>
                    <div class="space-y-6">
                        <h3 class="text-2xl font-bold text-green-700">✍️ Examples</h3>
                        ${data.sections.map(sec => `
                            <div class="grammar-card">
                                <span class="grammar-tag bg-green-100 text-green-600">${sec.tag}</span>
                                <p class="font-bold text-2xl text-gray-800 mb-2">${sec.rule}</p>
                                <p class="text-gray-600 text-lg italic bg-gray-50 p-4 rounded-xl border-dashed border-2 border-gray-200">${sec.example}</p>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (ifClauseTab === 'quiz') {
                startIfClauseQuiz(container);
            } else if (ifClauseTab === 'record') {
                showIfClauseRecord(container);
            }
        }

        function startIfClauseQuiz(container) {
            if (!ifClauseData || ifClauseData.length === 0) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">No quiz data available. Please try again later.</p>';
                return;
            }
            ifClauseQuizWords = [...ifClauseData].sort(() => 0.5 - Math.random()).slice(0, Math.min(20, ifClauseData.length));
            ifClauseQuizIdx = 0;
            ifClauseQuizScore = 0;
            ifClauseQuizResults = [];
            ifClauseTryCount = 0;
            renderIfClauseQuizQuestion(container);
        }

        function renderIfClauseQuizQuestion(container) {
            ifClauseTryCount = 0;
            const q = ifClauseQuizWords[ifClauseQuizIdx];
            container.innerHTML = `
                <div class="text-center mb-6">
                    <div class="flex justify-between items-center mb-4">
                        <p class="text-gray-400 font-bold uppercase tracking-wider">Question ${ifClauseQuizIdx + 1} of ${ifClauseQuizWords.length}</p>
                        <span class="bg-green-100 text-green-600 px-4 py-1 rounded-full font-bold text-sm">Score: ${ifClauseQuizScore}</span>
                    </div>
                    <p class="bg-green-50 text-green-700 font-bold text-2xl rounded-2xl p-6 border-2 border-green-200">${q.q}</p>
                </div>
                <div class="max-w-lg mx-auto space-y-4">
                    <div>
                        <label class="text-sm font-bold text-gray-500 mb-1 block">Answer 1</label>
                        <input type="text" id="if-clause-a1" class="quiz-input" placeholder="Type answer 1..." autocomplete="off">
                    </div>
                    <div>
                        <label class="text-sm font-bold text-gray-500 mb-1 block">Answer 2</label>
                        <input type="text" id="if-clause-a2" class="quiz-input" placeholder="Type answer 2..." autocomplete="off">
                    </div>
                    <button onclick="checkIfClauseAnswer()" class="w-full py-4 bg-green-500 text-white rounded-2xl font-bold shadow-lg shadow-green-200 hover:bg-green-600 transition-colors text-xl mt-4">Check →</button>
                </div>
            `;
            document.getElementById('if-clause-a1').focus();
            document.getElementById('if-clause-a1').addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('if-clause-a2').focus(); });
            document.getElementById('if-clause-a2').addEventListener('keypress', e => { if (e.key === 'Enter') checkIfClauseAnswer(); });
        }

        function checkIfClauseAnswer() {
            const a1 = document.getElementById('if-clause-a1').value.trim().toLowerCase();
            const a2 = document.getElementById('if-clause-a2').value.trim().toLowerCase();
            const q = ifClauseQuizWords[ifClauseQuizIdx];
            const correct1 = q.a1.toLowerCase();
            const correct2 = q.a2.toLowerCase();

            const isCorrect = (a1 === correct1 || a1 === correct2) && (a2 === correct1 || a2 === correct2) && a1 !== a2;

            if (isCorrect) {
                ifClauseQuizResults.push({ q: q.q, userA1: a1, userA2: a2, a1: q.a1, a2: q.a2, correct: true });
                ifClauseQuizScore += 10;
                showEncouragement();
                ifClauseQuizIdx++;
                const container = document.getElementById('if-clause-tab-content');
                if (ifClauseQuizIdx < ifClauseQuizWords.length) {
                    setTimeout(() => renderIfClauseQuizQuestion(container), 1200);
                } else {
                    setTimeout(() => {
                        const history = JSON.parse(localStorage.getItem('if_clause_history') || '[]');
                        history.push({ t: Date.now(), score: ifClauseQuizScore, total: ifClauseQuizWords.length, results: ifClauseQuizResults });
                        localStorage.setItem('if_clause_history', JSON.stringify(history));
                        saveGrammarToCloud('conditionals', ifClauseQuizScore, ifClauseQuizWords.length);
                        showIfClauseResult(container);
                    }, 1200);
                }
            } else {
                ifClauseTryCount++;
                if (ifClauseTryCount < 3) {
                    showTryAgain();
                    document.getElementById('if-clause-a1').value = "";
                    document.getElementById('if-clause-a2').value = "";
                    document.getElementById('if-clause-a1').focus();
                } else {
                    // 3rd wrong — show correct answer for 3 seconds
                    ifClauseQuizResults.push({ q: q.q, userA1: a1, userA2: a2, a1: q.a1, a2: q.a2, correct: false });
                    const container = document.getElementById('if-clause-tab-content');
                    const existingBtn = container.querySelector('button');
                    if (existingBtn) existingBtn.style.display = 'none';
                    const ansBox = document.createElement('div');
                    ansBox.className = 'mt-4 p-4 bg-red-50 rounded-2xl border-2 border-red-200 text-center';
                    ansBox.innerHTML = `<p class="text-red-500 font-bold mb-1">Correct answers:</p><p class="text-green-700 font-bold text-xl">${q.a1} / ${q.a2}</p>`;
                    container.appendChild(ansBox);
                    setTimeout(() => {
                        ifClauseQuizIdx++;
                        if (ifClauseQuizIdx < ifClauseQuizWords.length) {
                            renderIfClauseQuizQuestion(container);
                        } else {
                            const history = JSON.parse(localStorage.getItem('if_clause_history') || '[]');
                            history.push({ t: Date.now(), score: ifClauseQuizScore, total: ifClauseQuizWords.length, results: ifClauseQuizResults });
                            localStorage.setItem('if_clause_history', JSON.stringify(history));
                            saveGrammarToCloud('conditionals', ifClauseQuizScore, ifClauseQuizWords.length);
                            showIfClauseResult(container);
                        }
                    }, 6000);
                }
            }
        }

        function showIfClauseResult(container) {
            const total = ifClauseQuizWords.length;
            const correctCount = ifClauseQuizResults.filter(r => r.correct).length;
            container.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-8xl mb-4">🏆</div>
                    <h3 class="text-3xl font-bold text-green-600 mb-2">Quiz Finished!</h3>
                    <p class="text-xl text-gray-500 mb-2">Score: ${ifClauseQuizScore} pts</p>
                    <p class="text-lg text-gray-400 mb-6">Correct: ${correctCount}/${total}</p>
                    <div class="space-y-3 text-left max-w-lg mx-auto mb-8">
                        ${ifClauseQuizResults.map((r, i) => `
                            <div class="bg-gray-50 rounded-xl p-4 ${r.correct ? 'border-2 border-green-200' : 'border-2 border-red-200'}">
                                <p class="font-bold text-gray-700 mb-2">${i + 1}. ${r.q}</p>
                                ${r.correct
                                    ? `<p class="text-green-600 text-sm">✓ ${r.a1} / ${r.a2}</p>`
                                    : `<p class="text-red-500 text-sm">Your answer: ${r.userA1 || '-'} / ${r.userA2 || '-'}</p><p class="text-green-600 text-sm">Correct: ${r.a1} / ${r.a2}</p>`
                                }
                            </div>
                        `).join('')}
                    </div>
                    <button onclick="switchIfClauseTab('quiz')" class="btn-paw bg-green-400 shadow-[0_6px_0_#2b8a3e]">Try Again</button>
                </div>
            `;
        }

        function showIfClauseRecord(container) {
            const history = JSON.parse(localStorage.getItem('if_clause_history') || '[]');
            if (history.length === 0) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">No records yet. Complete a quiz first!</p>';
                return;
            }
            const recent = history.slice(-10).reverse();
            const best = history.reduce((a, b) => a.score > b.score ? a : b);
            container.innerHTML = `
                <div class="bg-green-50 rounded-2xl p-6 mb-6 border-2 border-green-100 text-center">
                    <h3 class="text-lg font-bold text-green-600 mb-2">🏅 Best Score</h3>
                    <p class="text-3xl font-bold text-green-700">${best.score} pts · ${best.total} questions</p>
                </div>
                <div class="space-y-3">
                    ${recent.map(r => `
                        <div class="flex justify-between items-center bg-gray-50 rounded-xl px-4 py-3">
                            <span class="font-bold text-green-600">${r.score} pts</span>
                            <span class="text-gray-500 text-sm">${Math.round((r.score / (r.total * 10)) * 100)}%</span>
                            <span class="text-gray-400 text-sm">${r.total} questions</span>
                            <span class="text-gray-400 text-xs">${new Date(r.t).toLocaleDateString()}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // ===== Participle Clauses Quiz =====
        function renderPCTabs(content, data) {
            const tabs = [
                { key: 'revision', label: '📖 Revision' },
                { key: 'quiz', label: '✏️ Quiz' },
                { key: 'record', label: '📋 My Record' }
            ];
            content.innerHTML = `
                <div class="text-center mb-6"><div class="text-8xl mb-4">${data.emoji}</div><h2 class="text-4xl font-bold text-green-600">${data.title}</h2></div>
                <div class="flex gap-3 mb-8 justify-center">
                    ${tabs.map(t => `<button onclick="switchPCTab('${t.key}')" class="pc-tab px-5 py-2 rounded-full font-bold text-sm ${pcTab === t.key ? 'bg-green-500 text-white' : 'bg-green-100 text-green-600'}">${t.label}</button>`).join('')}
                </div>
                <div id="pc-tab-content"></div>
            `;
            renderPCTabContent(data);
        }

        function switchPCTab(tab) {
            pcTab = tab;
            document.querySelectorAll('.pc-tab').forEach(b => {
                b.classList.remove('bg-green-500','text-white');
                b.classList.add('bg-green-100','text-green-600');
            });
            event.target.classList.remove('bg-green-100','text-green-600');
            event.target.classList.add('bg-green-500','text-white');
            renderPCTabContent(structureData['participle_clauses']);
        }

        function renderPCTabContent(data) {
            const container = document.getElementById('pc-tab-content');
            if (pcTab === 'revision') {
                container.innerHTML = `
                    <div class="mb-10"><h3 class="text-2xl font-bold text-green-700 mb-4">💡 Explanation</h3><p class="text-gray-700 text-xl leading-relaxed bg-green-50 p-6 rounded-2xl border-l-8 border-green-400">${data.intro}</p></div>
                    <div class="space-y-6">
                        <h3 class="text-2xl font-bold text-green-700">✍️ Examples</h3>
                        ${data.sections.map(sec => `
                            <div class="grammar-card">
                                <span class="grammar-tag bg-green-100 text-green-600">${sec.tag}</span>
                                <p class="font-bold text-2xl text-gray-800 mb-2">${sec.rule}</p>
                                <p class="text-gray-600 text-lg italic bg-gray-50 p-4 rounded-xl border-dashed border-2 border-gray-200">${sec.example}</p>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (pcTab === 'quiz') {
                startPCQuiz(container);
            } else if (pcTab === 'record') {
                renderPCRecord(container);
            }
        }

        function startPCQuiz(container) {
            if (!pcData || pcData.length === 0) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">No quiz data available. Please try again later.</p>';
                return;
            }
            pcQuizWords = [...pcData].sort(() => 0.5 - Math.random()).slice(0, Math.min(20, pcData.length));
            pcQuizIdx = 0;
            pcQuizScore = 0;
            pcQuizResults = [];
            pcTryCount = 0;
            renderPCQuizQuestion(container);
        }

        function renderPCQuizQuestion(container) {
            pcTryCount = 0;
            const q = pcQuizWords[pcQuizIdx];
            container.innerHTML = `
                <div class="text-center mb-6">
                    <div class="flex justify-between items-center mb-4">
                        <p class="text-gray-400 font-bold uppercase tracking-wider">Question ${pcQuizIdx + 1} of ${pcQuizWords.length}</p>
                        <span class="bg-green-100 text-green-600 px-4 py-1 rounded-full font-bold text-sm">Score: ${pcQuizScore}</span>
                    </div>
                    <p class="bg-green-50 text-green-700 font-bold text-2xl rounded-2xl p-6 border-2 border-green-200">${q.q}</p>
                </div>
                <div class="max-w-lg mx-auto space-y-4">
                    <div>
                        <label class="text-sm font-bold text-gray-500 mb-1 block">Your Answer</label>
                        <input type="text" id="pc-answer" class="quiz-input" placeholder="Type your answer..." autocomplete="off">
                    </div>
                    <button onclick="checkPCAnswer()" class="w-full py-4 bg-green-500 text-white rounded-2xl font-bold shadow-lg shadow-green-200 hover:bg-green-600 transition-colors text-xl mt-4">Check →</button>
                </div>
            `;
            document.getElementById('pc-answer').focus();
            document.getElementById('pc-answer').addEventListener('keypress', e => { if (e.key === 'Enter') checkPCAnswer(); });
        }

        function checkPCAnswer() {
            const userVal = document.getElementById('pc-answer').value.trim().toLowerCase();
            const q = pcQuizWords[pcQuizIdx];
            const correct = q.a.toLowerCase();

            if (userVal === correct) {
                pcQuizResults.push({ q: q.q, userA: userVal, a: q.a, correct: true });
                pcQuizScore += 10;
                showEncouragement();
                pcQuizIdx++;
                const container = document.getElementById('pc-tab-content');
                if (pcQuizIdx < pcQuizWords.length) {
                    setTimeout(() => renderPCQuizQuestion(container), 1200);
                } else {
                    setTimeout(() => {
                        const history = JSON.parse(localStorage.getItem('pc_history') || '[]');
                        history.push({ t: Date.now(), score: pcQuizScore, total: pcQuizWords.length, results: pcQuizResults });
                        localStorage.setItem('pc_history', JSON.stringify(history));
                        saveGrammarToCloud('participle_clauses', pcQuizScore, pcQuizWords.length);
                        showPCResult(container);
                    }, 1200);
                }
            } else {
                pcTryCount++;
                if (pcTryCount < 3) {
                    showTryAgain();
                    document.getElementById('pc-answer').value = "";
                    document.getElementById('pc-answer').focus();
                } else {
                    pcQuizResults.push({ q: q.q, userA: userVal, a: q.a, correct: false });
                    const container = document.getElementById('pc-tab-content');
                    const existingBtn = container.querySelector('button');
                    if (existingBtn) existingBtn.style.display = 'none';
                    const ansBox = document.createElement('div');
                    ansBox.className = 'mt-4 p-4 bg-red-50 rounded-2xl border-2 border-red-200 text-center';
                    ansBox.innerHTML = `<p class="text-red-500 font-bold mb-1">Correct answer:</p><p class="text-green-700 font-bold text-xl">${q.a}</p>`;
                    container.appendChild(ansBox);
                    setTimeout(() => {
                        pcQuizIdx++;
                        if (pcQuizIdx < pcQuizWords.length) {
                            renderPCQuizQuestion(container);
                        } else {
                            const history = JSON.parse(localStorage.getItem('pc_history') || '[]');
                            history.push({ t: Date.now(), score: pcQuizScore, total: pcQuizWords.length, results: pcQuizResults });
                            localStorage.setItem('pc_history', JSON.stringify(history));
                            saveGrammarToCloud('participle_clauses', pcQuizScore, pcQuizWords.length);
                            showPCResult(container);
                        }
                    }, 6000);
                }
            }
        }

        function showPCResult(container) {
            const total = pcQuizWords.length;
            const correctCount = pcQuizResults.filter(r => r.correct).length;
            container.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-8xl mb-4">🏆</div>
                    <h3 class="text-3xl font-bold text-green-600 mb-2">Quiz Finished!</h3>
                    <p class="text-xl text-gray-500 mb-2">Score: ${pcQuizScore} pts</p>
                    <p class="text-lg text-gray-400 mb-6">Correct: ${correctCount}/${total}</p>
                    <div class="space-y-3 text-left max-w-lg mx-auto mb-8">
                        ${pcQuizResults.map((r, i) => `
                            <div class="bg-gray-50 rounded-xl p-4 ${r.correct ? 'border-2 border-green-200' : 'border-2 border-red-200'}">
                                <p class="font-bold text-gray-700 mb-2">${i + 1}. ${r.q}</p>
                                ${r.correct
                                    ? `<p class="text-green-600 text-sm">✓ ${r.a}</p>`
                                    : `<p class="text-red-500 text-sm">Your answer: ${r.userA || '-'}</p><p class="text-green-600 text-sm">Correct: ${r.a}</p>`
                                }
                            </div>
                        `).join('')}
                    </div>
                    <button onclick="switchPCTab('quiz')" class="btn-paw bg-green-400 shadow-[0_6px_0_#2b8a3e]">Try Again</button>
                </div>
            `;
        }

        function renderPCRecord(container) {
            const history = JSON.parse(localStorage.getItem('pc_history') || '[]');
            if (history.length === 0) {
                container.innerHTML = '<p class="text-gray-400 text-center py-10">No records yet. Complete a quiz first!</p>';
                return;
            }
            const recent = history.slice(-10).reverse();
            const best = history.reduce((a, b) => a.score > b.score ? a : b);
            container.innerHTML = `
                <div class="bg-green-50 rounded-2xl p-6 mb-6 border-2 border-green-100 text-center">
                    <h3 class="text-lg font-bold text-green-600 mb-2">🏅 Best Score</h3>
                    <p class="text-3xl font-bold text-green-700">${best.score} pts · ${best.total} questions</p>
                </div>
                <div class="space-y-3">
                    ${recent.map(r => `
                        <div class="flex justify-between items-center bg-gray-50 rounded-xl px-4 py-3">
                            <span class="font-bold text-green-600">${r.score} pts</span>
                            <span class="text-gray-500 text-sm">${Math.round((r.score / (r.total * 10)) * 100)}%</span>
                            <span class="text-gray-400 text-sm">${r.total} questions</span>
                            <span class="text-gray-400 text-xs">${new Date(r.t).toLocaleDateString()}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        let grammarAdminFilter = 'all';

        async function loadGrammarAdmin(filter) {
            if (!isAdmin()) return;
            grammarAdminFilter = filter || 'all';
            paintChoiceButtons('.grammar-admin-btn', grammarAdminFilter);
            let query = sb.from("dictation_results").select("user_id, email, nickname, score, total, mode, created_at").in("mode", ["conditionals", "participle_clauses"]);
            if (grammarAdminFilter !== 'all') query = query.eq("mode", grammarAdminFilter);
            const { data, error } = await query.order("created_at", { ascending: false });
            adminCache.grammar = error ? [] : (data || []);
            adminCache.grammarError = error || null;
            renderGrammarAdmin();
        }

        function renderGrammarAdmin() {
            const statsEl = document.getElementById('grammar-admin-stats');
            const listEl = document.getElementById('grammar-admin-container');
            if (!statsEl || !listEl || !adminCache.grammar) return;
            const rows = adminCache.grammar;
            if (adminCache.grammarError || !rows.length) {
                statsEl.innerHTML = '';
                listEl.innerHTML = '<p class="text-gray-400 text-center py-10">No grammar quiz records yet.</p>';
                return;
            }
            const uniqueStudents = new Set(rows.map(r => (r.email || '').toLowerCase())).size;
            const totalQuizzes = rows.length;
            const avgScore = rows.length ? Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length) : 0;
            const avgAccuracy = rows.length ? Math.round(rows.reduce((a, r) => a + Math.round((r.score / ((r.total || 1) * 10)) * 100), 0) / rows.length) : 0;
            statsEl.innerHTML = `
                <div class="bg-green-50 rounded-2xl p-5 text-center border-2 border-green-100">
                    <div class="text-3xl font-bold text-green-600">${uniqueStudents}</div>
                    <div class="text-sm text-gray-500 font-bold">Students</div>
                </div>
                <div class="bg-blue-50 rounded-2xl p-5 text-center border-2 border-blue-100">
                    <div class="text-3xl font-bold text-blue-600">${totalQuizzes}</div>
                    <div class="text-sm text-gray-500 font-bold">Quizzes Done</div>
                </div>
                <div class="bg-green-50 rounded-2xl p-5 text-center border-2 border-green-100">
                    <div class="text-3xl font-bold text-green-600">${avgScore}</div>
                    <div class="text-sm text-gray-500 font-bold">Avg Score</div>
                </div>
                <div class="bg-purple-50 rounded-2xl p-5 text-center border-2 border-purple-100">
                    <div class="text-3xl font-bold text-purple-600">${avgAccuracy}%</div>
                    <div class="text-sm text-gray-500 font-bold">Avg Accuracy</div>
                </div>
            `;
            const studentMap = {};
            rows.forEach(r => {
                const key = (r.email || '').toLowerCase();
                if (!studentMap[key]) studentMap[key] = { nickname: r.nickname, email: r.email, user_id: r.user_id || '', quizzes: 0, totalScore: 0, modes: new Set(), lastActive: r.created_at };
                if (!studentMap[key].user_id && r.user_id) studentMap[key].user_id = r.user_id;
                studentMap[key].quizzes++;
                studentMap[key].totalScore += r.score;
                studentMap[key].modes.add(r.mode);
                if (r.nickname) studentMap[key].nickname = r.nickname;
                if (r.created_at > studentMap[key].lastActive) studentMap[key].lastActive = r.created_at;
            });
            const students = Object.values(studentMap).sort((a, b) => b.totalScore - a.totalScore);
            listEl.innerHTML = renderFormSections(groupRowsByForm(students), (list) => `
                <div class="space-y-3">
                    ${list.map((s, i) => `
                        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 gap-3 flex-wrap">
                            <div class="flex items-center gap-3 flex-1 min-w-[220px]">
                                <span class="text-lg font-bold text-gray-400 w-8 text-center">${i + 1}</span>
                                <div>
                                    <span class="font-bold text-gray-700">${adminProfileName(s, classBadge(s.email, s.nickname))}</span>
                                    <span class="text-gray-400 text-xs ml-2">${escapeHtml(s.email || '')}</span>
                                </div>
                                ${formAssignControl(s.email, s.nickname)}
                            </div>
                            <div class="flex items-center gap-4 text-sm">
                                <span class="text-gray-500">${s.quizzes} quizzes</span>
                                <span class="text-gray-500">${[...s.modes].map(m => m === 'conditionals' ? '⚖️' : '🔗').join('')}</span>
                                <span class="font-bold text-green-600">${s.totalScore} pts</span>
                                <span class="text-gray-400 text-xs">${new Date(s.lastActive).toLocaleDateString()}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `, { collapsible: true, scope: 'grammar-admin' });
        }

        async function loadIfClauseData() {
            try {
                const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('if-clause')}`;
                const response = await fetch(url);
                if (!response.ok) return;
                const csvText = await response.text();
                const lines = csvText.split(/\r?\n/);
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(p => p.replace(/^"|"$/g, '').trim());
                    if (parts.length >= 3) ifClauseData.push({ q: parts[0], a1: parts[1], a2: parts[2] });
                }
            } catch (e) { console.log('Failed to load if-clause data'); }
        }

        async function loadPCData() {
            try {
                const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('participle clauses')}`;
                const response = await fetch(url);
                if (!response.ok) return;
                const csvText = await response.text();
                const lines = csvText.split(/\r?\n/);
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(p => p.replace(/^"|"$/g, '').trim());
                    if (parts.length >= 2) pcData.push({ q: parts[0], a: parts[1] });
                }
            } catch (e) { console.log('Failed to load participle clauses data'); }
        }

/* LearniTY Dictation — the Tenses quiz shells (AV / PV).
   The arrays stay empty until questions are supplied, so the page keeps
   showing "Questions will be added soon." Moved verbatim out of index.html. */

        // Grammar rendering
        // Tense quizzes are shells for now — the teacher will supply the questions.
        // Drop items into these arrays later; keep the empty state as the placeholder.
        let tenseQuizAV = [];
        let tenseQuizPV = [];

        function showTenseQuiz(kind) {
            const isAV = kind === 'AV';
            const title = isAV ? 'tenses quiz(AV)' : 'tenses(PV)';
            const subtitle = isAV ? 'Active Voice tenses quiz' : 'Passive Voice tenses quiz';
            const items = isAV ? tenseQuizAV : tenseQuizPV;
            const content = document.getElementById('grammar-detail-content');
            document.getElementById('detail-back-btn').onclick = () => changeView('grammar-revision-view');
            content.innerHTML = `
                <div class="text-center mb-10"><div class="text-8xl mb-4">${isAV ? '✏️' : '📝'}</div><h2 class="text-4xl font-bold text-green-600">${title}</h2><p class="text-gray-500 font-bold mt-3">${subtitle}</p></div>
                ${items.length
                    ? '<div id="tense-quiz-content" class="space-y-6"></div>'
                    : '<div class="text-center bg-green-50 border-2 border-dashed border-green-200 rounded-2xl p-10"><p class="text-xl font-bold text-green-700">Questions will be added soon.</p></div>'}
            `;
            // Questions will be rendered into #tense-quiz-content once the arrays are filled.
            changeView('grammar-detail-view');
            recordGuestUsage('Grammar Quest', title);
        }

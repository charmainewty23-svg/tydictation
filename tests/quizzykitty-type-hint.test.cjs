// QuizzyKitty › Type the word — teacher first-letter hint.
// No browser, no network, no database. The pure helpers are extracted from
// the demo page and the rest is source/SQL contract checking.
// Run: node --test tests/quizzykitty-type-hint.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'quizzykitty-demo.html'), 'utf8');
const canonicalSql = fs.readFileSync(path.join(ROOT, 'supabase/quizzykitty.sql'), 'utf8');
const hintSql = fs.readFileSync(path.join(ROOT, 'supabase/quizzykitty_type_hint.sql'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

/* --------------------------- helpers --------------------------- */

function helperBlock() {
    const match = html.match(/\/\* hint-helpers:start \*\/([\s\S]*?)\/\* hint-helpers:end \*\//);
    assert.ok(match, 'the hint helper block is present in quizzykitty-demo.html');
    return match[1];
}

function loadHelpers() {
    return new Function(
        helperBlock() +
        '\nreturn { qkShortAnswerWord: qkShortAnswerWord, qkFirstLetter: qkFirstLetter };'
    )();
}

function sliceFunction(source, signature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, 'missing function: ' + signature);
    const open = source.indexOf('{', start);
    assert.notEqual(open, -1, 'missing body for: ' + signature);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, i + 1);
            if (depth < 0) break;
        }
    }
    assert.fail('unbalanced body for: ' + signature);
}

function sqlFunction(source, name) {
    const start = source.indexOf('create or replace function public.' + name);
    assert.notEqual(start, -1, 'missing SQL function: ' + name);
    const end = source.indexOf('$$;', start);
    assert.notEqual(end, -1, 'unterminated SQL function: ' + name);
    return source.slice(start, end + 3);
}

function studentRoomMarkup() {
    const start = html.indexOf('<div class="student-room hidden" id="studentRoom">');
    assert.notEqual(start, -1, 'student room markup exists');
    const end = html.indexOf('<script>', start);
    assert.notEqual(end, -1, 'student room markup ends before the script');
    return html.slice(start, end);
}

/* ------------------------ pure helpers ------------------------- */

test('qkFirstLetter returns the first A-Z letter, uppercased', () => {
    const { qkFirstLetter } = loadHelpers();
    assert.equal(qkFirstLetter('protecting'), 'P');
    assert.equal(qkFirstLetter('  colour'), 'C');
    assert.equal(qkFirstLetter('…apple'), 'A');
    assert.equal(qkFirstLetter("'Elephant"), 'E');
    assert.equal(qkFirstLetter('123b'), 'B');
    assert.equal(qkFirstLetter('123'), '');
    assert.equal(qkFirstLetter('   '), '');
    assert.equal(qkFirstLetter(''), '');
    assert.equal(qkFirstLetter(null), '');
    assert.equal(qkFirstLetter(undefined), '');
});

test('qkShortAnswerWord prefers accept[0] when present', () => {
    const { qkShortAnswerWord } = loadHelpers();
    assert.equal(qkShortAnswerWord({
        type: 'short', en: 'protect', accept: ['protecting', 'protected']
    }), 'protecting');
    assert.equal(qkShortAnswerWord({
        type: 'short', en: 'colour', accept: ['  colour  ', 'color']
    }), 'colour');
});

test('qkShortAnswerWord falls back to the first slash-separated en token', () => {
    const { qkShortAnswerWord } = loadHelpers();
    assert.equal(qkShortAnswerWord({ type: 'short', en: 'colour / color' }), 'colour');
    assert.equal(qkShortAnswerWord({ type: 'short', en: 'protecting' }), 'protecting');
    assert.equal(qkShortAnswerWord({ type: 'short', en: '  apple  ' }), 'apple');
});

test('qkShortAnswerWord returns empty for empty / non-short questions', () => {
    const { qkShortAnswerWord } = loadHelpers();
    assert.equal(qkShortAnswerWord({ type: 'short', en: '' }), '');
    assert.equal(qkShortAnswerWord({ type: 'short' }), '');
    assert.equal(qkShortAnswerWord({ type: 'short', accept: [] }), '');
    assert.equal(qkShortAnswerWord({ type: 'short', accept: ['   '] }), '');
    assert.equal(qkShortAnswerWord({ type: 'gap', en: 'apple', accept: ['apple'] }), '');
    assert.equal(qkShortAnswerWord({ type: 'mc', choices: ['a', 'b'], answer: 0 }), '');
    assert.equal(qkShortAnswerWord({ type: 'tf', answer: true }), '');
    assert.equal(qkShortAnswerWord(null), '');
    assert.equal(qkShortAnswerWord(undefined), '');
});

test('helper block is self-contained and gives the letter students should see', () => {
    assert.doesNotMatch(helperBlock(), /primaryAnswer/);
    const { qkShortAnswerWord, qkFirstLetter } = loadHelpers();
    assert.equal(qkFirstLetter(qkShortAnswerWord({ type: 'short', en: 'protecting' })), 'P');
    assert.equal(qkFirstLetter(qkShortAnswerWord({ type: 'short', en: 'colour/color' })), 'C');
    assert.equal(qkFirstLetter(qkShortAnswerWord({ type: 'gap', en: 'protect' })), '');
});

/* ------------------------- demo wiring ------------------------- */

test('teacher controls have a first-letter button and hint chips', () => {
    assert.match(html, /<button type="button" id="hintBtn" class="ghost" hidden disabled>💡 First letter<\/button>/);
    assert.match(html, /<div class="hint-chip hidden" id="hintChip"><\/div>/);
    assert.match(html, /<div class="hint-chip sq-hint hidden" id="shint"><\/div>/);
    assert.match(html, /<div class="sr-hint hint-chip hidden" id="srHint"><\/div>/);
});

test('hint button is wired to the teacher handler only', () => {
    assert.equal((html.match(/\$\('hintBtn'\)\.addEventListener/g) || []).length, 1);
    assert.match(html, /\$\('hintBtn'\)\.addEventListener\('click', function \(\) \{\s*if \(room\.id\) \{ liveHint\(\); return; \}\s*demoHint\(\);\s*\}\);/);
});

test('hint is gated on Type the word, not Fill the gap', () => {
    const context = sliceFunction(html, 'function hintContext()');
    assert.match(context, /q\.type === 'short'/);
    assert.doesNotMatch(context, /q\.type === 'gap'/);
    assert.match(context, /nowPhase === 'question'/);

    const update = sliceFunction(html, 'function updateHintUI()');
    assert.match(update, /ctx\.canShow/);

    const demo = sliceFunction(html, 'function demoHint()');
    assert.match(demo, /q\.type !== 'short'/);
    assert.doesNotMatch(demo, /q\.type !== 'gap'/);

    const live = sliceFunction(html, 'async function liveHint()');
    assert.match(live, /q\.type !== 'short'/);
    assert.doesNotMatch(live, /q\.type !== 'gap'/);
    assert.match(live, /quizzykitty_hint/);
});

test('demo hint shows on the teacher panel and the demo student phone', () => {
    const update = sliceFunction(html, 'function updateHintUI()');
    assert.match(update, /\$\('hintChip'\)/);
    assert.match(update, /\$\('shint'\)/);
    assert.match(update, /💡 Hint: starts with /);
    assert.match(update, /💡 Hint shown: /);
});

test('next question, new quiz, room start and finish reset the hint', () => {
    assert.match(sliceFunction(html, 'function nextQuestion()'), /hintOn = false;/);
    assert.match(sliceFunction(html, 'function startQuiz()'), /hintOn = false;/);
    assert.match(sliceFunction(html, 'function showSetup()'), /hintOn = false;/);
    assert.match(sliceFunction(html, 'function finish()'), /hintOn = false;/);
    assert.match(sliceFunction(html, 'function renderRoomQuestion()'), /room\.hintLetter = '';/);
    assert.match(sliceFunction(html, 'function leaveRoomHost()'), /room\.hintLetter = '';/);
});

test('live room polls paint hint_letter without rebuilding student answers', () => {
    const apply = sliceFunction(html, 'function applyRoomHint(st)');
    assert.match(apply, /st\.room\.hint_letter/);
    assert.match(apply, /updateHintUI\(\)/);

    const student = sliceFunction(html, 'function studentRender(st)');
    assert.ok(
        student.indexOf('studentApplyHint(st);') !== -1,
        'studentApplyHint runs on every poll'
    );
    assert.ok(
        student.indexOf('studentApplyHint(st);') < student.indexOf("if (joining.lastKey !== key)"),
        'the hint is applied before the lastKey remount guard'
    );

    const hint = sliceFunction(html, 'function studentApplyHint(st)');
    assert.match(hint, /st\.room\.hint_letter/);
    assert.match(hint, /q\.type === 'short'/);
    assert.doesNotMatch(hint, /q\.type === 'gap'/);
    assert.doesNotMatch(hint, /srAnswers/);
    assert.doesNotMatch(hint, /innerHTML/);
});

test('stale empty host poll must not clear a letter already shown', () => {
    const fn = sliceFunction(html, 'function applyRoomHint(st)');
    assert.match(fn, /q_index/);
    assert.match(fn, /!letter && room\.hintLetter/);
    assert.match(fn, /phase === 'question'/);
});

test('live hint failure points teachers at the Type-the-word incremental SQL', () => {
    const live = sliceFunction(html, 'async function liveHint()');
    assert.match(live, /quizzykitty_type_hint\.sql/);
    assert.doesNotMatch(live, /quizzykitty_gap_hint\.sql/);
    assert.match(live, /showHintNote\(/);
    assert.match(html, /id="hintNote"/);
});

test('student surfaces have no control that can trigger the hint', () => {
    const roomMarkup = studentRoomMarkup();
    assert.doesNotMatch(roomMarkup, /hintBtn/);
    assert.doesNotMatch(roomMarkup, /quizzykitty_hint/);
    assert.doesNotMatch(roomMarkup, /liveHint|demoHint|hintOn/);
    assert.doesNotMatch(roomMarkup, /onclick=/);

    const phoneStart = html.indexOf('<aside class="student">');
    const phoneEnd = html.indexOf('</aside>', phoneStart);
    const phone = html.slice(phoneStart, phoneEnd);
    assert.doesNotMatch(phone, /hintBtn|quizzykitty_hint|liveHint|demoHint/);
    assert.match(phone, /id="shint"/);
});

/* --------------------------- SQL ------------------------------ */

for (const [label, sql] of [['canonical', canonicalSql], ['incremental', hintSql]]) {
    test(label + ' SQL has the hint column, helpers and RPC', () => {
        assert.match(sql, /add column if not exists hint_on boolean not null default false;/);
        assert.match(sql, /create or replace function public\.qz_first_letter\(p_word text\)/);
        assert.match(sql, /create or replace function public\.qz_short_answer_word\(p_question jsonb\)/);
        assert.match(sql, /create or replace function public\.qz_short_first_letter\(p_question jsonb\)/);
        assert.match(sql, /create or replace function public\.quizzykitty_hint\(p_room uuid, p_host_key text\)/);
        assert.match(sql, /grant execute on function public\.quizzykitty_hint\(uuid, text\) to anon, authenticated;/);
        assert.match(sql, /notify pgrst, 'reload schema';/);
    });

    test(label + ' SQL only returns the single letter for short questions', () => {
        const hint = sqlFunction(sql, 'quizzykitty_hint');
        assert.match(hint, /quizzykitty_is_host/);
        assert.match(hint, /<> 'short'/);
        assert.match(hint, /raise exception 'NOT_SHORT';/);
        assert.match(hint, /set hint_on = true/);
        assert.match(hint, /'hint_letter', v_letter/);
        assert.doesNotMatch(hint, /'answer'/);
        assert.doesNotMatch(hint, /correct_text/);
    });

    test(label + ' SQL resets hint_on in start and next', () => {
        assert.match(sqlFunction(sql, 'quizzykitty_start'), /hint_on = false/);
        const next = sqlFunction(sql, 'quizzykitty_next');
        assert.equal((next.match(/hint_on = false/g) || []).length, 2,
            'both the finished and the advance path reset the hint');
    });

    test(label + ' state exposes hint_letter only for short + hint_on', () => {
        const state = sqlFunction(sql, 'quizzykitty_state');
        assert.match(state, /v_room\.hint_on/);
        assert.match(state, /v_room\.phase = 'question'/);
        assert.match(state, /qz_short_first_letter/);
        assert.match(state, /=\s*'short' then/);
        assert.match(state, /'hint_letter', coalesce\(v_hint, ''\)/);
        assert.match(state, /v_question - 'answer' - 'accept'/);
        assert.doesNotMatch(state, /hint_letter', .*answer/);
    });
}

test('canonical SQL no longer keeps gap-only hint helpers', () => {
    assert.doesNotMatch(canonicalSql, /qz_gap_answer_word/);
    assert.doesNotMatch(canonicalSql, /qz_gap_first_letter/);
    const helper = sqlFunction(canonicalSql, 'qz_short_answer_word');
    assert.match(helper, /coalesce\(p_question ->> 'type', ''\) <> 'short'/);
    assert.match(helper, /\(p_question -> 'accept'\) ->> 0/);
});

test('incremental SQL replaces the old gap install and drops its helpers', () => {
    assert.match(hintSql, /project mggnwzirjmibreimrwiq/);
    assert.match(hintSql, /quizzykitty_gap_hint\.sql/);
    assert.match(hintSql, /drop function if exists public\.qz_gap_first_letter\(jsonb\);/);
    assert.match(hintSql, /drop function if exists public\.qz_gap_answer_word\(jsonb\);/);
});

test('the old gap hint incremental file is gone', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'supabase/quizzykitty_gap_hint.sql')), false);
});

test('service worker cache is v123 for the host lobby rules toggle', () => {
    assert.match(sw, /const CACHE_NAME = 'learnity-pwa-v123';/);
    assert.doesNotMatch(sw, /learnity-pwa-v109|learnity-pwa-v110|learnity-pwa-v111|learnity-pwa-v113|learnity-pwa-v114|learnity-pwa-v115|learnity-pwa-v116|learnity-pwa-v117|learnity-pwa-v118|learnity-pwa-v119|learnity-pwa-v120|learnity-pwa-v121|learnity-pwa-v122/);
});

// QuizzyKitty › Fill the gap — teacher first-letter hint.
// No browser, no network, no database. The pure helpers are extracted from
// the demo page and the rest is source/SQL contract checking.
// Run: node --test tests/quizzykitty-gap-hint.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'quizzykitty-demo.html'), 'utf8');
const canonicalSql = fs.readFileSync(path.join(ROOT, 'supabase/quizzykitty.sql'), 'utf8');
const hintSql = fs.readFileSync(path.join(ROOT, 'supabase/quizzykitty_gap_hint.sql'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

/* --------------------------- helpers --------------------------- */

function loadHelpers() {
    const match = html.match(/\/\* hint-helpers:start \*\/([\s\S]*?)\/\* hint-helpers:end \*\//);
    assert.ok(match, 'the hint helper block is present in quizzykitty-demo.html');
    return new Function(
        match[1] +
        '\nreturn { qkGapAnswerWord: qkGapAnswerWord, qkFirstLetter: qkFirstLetter };'
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

test('qkGapAnswerWord uses choices[answer], not the bare en spelling', () => {
    const { qkGapAnswerWord } = loadHelpers();
    const q = {
        type: 'gap',
        en: 'protect',
        choices: ['protects', 'protecting', 'protect', 'protected'],
        answer: 1
    };
    assert.equal(qkGapAnswerWord(q), 'protecting');
    assert.equal(qkGapAnswerWord({
        type: 'gap', en: 'colour', choices: ['  colour', 'color', 'colours', 'colourful'], answer: 0
    }), '  colour');
});

test('qkGapAnswerWord returns empty for non-gap / malformed questions', () => {
    const { qkGapAnswerWord } = loadHelpers();
    assert.equal(qkGapAnswerWord({ type: 'mc', choices: ['a', 'b'], answer: 0 }), '');
    assert.equal(qkGapAnswerWord({ type: 'tf', answer: true }), '');
    assert.equal(qkGapAnswerWord({ type: 'short', en: 'apple' }), '');
    assert.equal(qkGapAnswerWord({ type: 'gap', answer: 0 }), '');
    assert.equal(qkGapAnswerWord({ type: 'gap', choices: ['a'], answer: -1 }), '');
    assert.equal(qkGapAnswerWord({ type: 'gap', choices: ['a'], answer: 4 }), '');
    assert.equal(qkGapAnswerWord(null), '');
});

test('helper pipeline gives the letter students should see', () => {
    const { qkGapAnswerWord, qkFirstLetter } = loadHelpers();
    const q = { type: 'gap', en: 'protect', choices: ['protect', 'protecting', 'protects', 'protected'], answer: 1 };
    assert.equal(qkFirstLetter(qkGapAnswerWord(q)), 'P');

    const fallback = { type: 'mc', fallback: true, en: 'protect', choices: ['protect'], answer: 0 };
    assert.equal(qkFirstLetter(qkGapAnswerWord(fallback)), '');
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

test('hint is gated on a real gap question and not fallback MC', () => {
    const context = sliceFunction(html, 'function hintContext()');
    assert.match(context, /q\.type === 'gap'/);
    assert.match(context, /!q\.fallback/);
    assert.match(context, /nowPhase === 'question'/);

    const update = sliceFunction(html, 'function updateHintUI()');
    assert.match(update, /ctx\.canShow/);

    const demo = sliceFunction(html, 'function demoHint()');
    assert.match(demo, /q\.type !== 'gap'/);
    assert.match(demo, /q\.fallback/);

    const live = sliceFunction(html, 'async function liveHint()');
    assert.match(live, /q\.type !== 'gap'/);
    assert.match(live, /q\.fallback/);
    assert.match(live, /quizzykitty_hint/);
});

test('demo hint shows on the teacher panel and the demo student phone', () => {
    const update = sliceFunction(html, 'function updateHintUI()');
    assert.match(update, /\$\('hintChip'\)/);
    assert.match(update, /\$\('shint'\)/);
    assert.match(update, /💡 Hint: starts with /);
    assert.match(update, /💡 Hint shown: /);
});

test('next question and a new quiz reset the hint', () => {
    assert.match(sliceFunction(html, 'function nextQuestion()'), /hintOn = false;/);
    assert.match(sliceFunction(html, 'function startQuiz()'), /hintOn = false;/);
    assert.match(sliceFunction(html, 'function showSetup()'), /hintOn = false;/);
    assert.match(sliceFunction(html, 'function renderRoomQuestion()'), /room\.hintLetter = '';/);
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
    assert.match(hint, /q\.type === 'gap'/);
    assert.doesNotMatch(hint, /srAnswers/);
    assert.doesNotMatch(hint, /innerHTML/);
});

test('stale empty host poll must not clear a letter already shown', () => {
    const fn = sliceFunction(html, 'function applyRoomHint(st)');
    assert.match(fn, /q_index/);
    assert.match(fn, /!letter && room\.hintLetter/);
    assert.match(fn, /phase === 'question'/);
});

test('live hint failure points teachers at the incremental SQL', () => {
    const live = sliceFunction(html, 'async function liveHint()');
    assert.match(live, /quizzykitty_gap_hint\.sql/);
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
        assert.match(sql, /create or replace function public\.qz_gap_answer_word\(p_question jsonb\)/);
        assert.match(sql, /create or replace function public\.qz_gap_first_letter\(p_question jsonb\)/);
        assert.match(sql, /create or replace function public\.quizzykitty_hint\(p_room uuid, p_host_key text\)/);
        assert.match(sql, /grant execute on function public\.quizzykitty_hint\(uuid, text\) to anon, authenticated;/);
        assert.match(sql, /notify pgrst, 'reload schema';/);
    });

    test(label + ' SQL only returns the single letter', () => {
        const hint = sqlFunction(sql, 'quizzykitty_hint');
        assert.match(hint, /quizzykitty_is_host/);
        assert.match(hint, /raise exception 'NOT_GAP';/);
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

    test(label + ' state exposes hint_letter only while the hint is on', () => {
        const state = sqlFunction(sql, 'quizzykitty_state');
        assert.match(state, /v_room\.hint_on/);
        assert.match(state, /v_room\.phase = 'question'/);
        assert.match(state, /v_hint := public\.qz_gap_first_letter/);
        assert.match(state, /'hint_letter', coalesce\(v_hint, ''\)/);
        assert.match(state, /v_question - 'answer' - 'accept'/);
        assert.doesNotMatch(state, /hint_letter', .*answer/);
    });
}

test('gap answer helper uses choices[answer] and skips other types', () => {
    const helper = sqlFunction(canonicalSql, 'qz_gap_answer_word');
    assert.match(helper, /coalesce\(p_question ->> 'type', ''\) <> 'gap'/);
    assert.match(helper, /p_question -> 'choices'\) ->> \(\(p_question ->> 'answer'\)::int\)/);
});

test('service worker cache stays on v109', () => {
    assert.match(sw, /const CACHE_NAME = 'learnity-pwa-v109';/);
    assert.doesNotMatch(sw, /learnity-pwa-v110|learnity-pwa-v111/);
});

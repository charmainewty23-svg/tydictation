/* Cambridge audio — only the dictionary entry's own pronunciation may be
   played, and Listening reads phrases with the full device voice instead of a
   partial Cambridge mp3. No browser, no network, no database. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const cambridge = require(path.join(root, 'api/cambridge.js'));
const dictationSource = fs.readFileSync(path.join(root, 'js/dictation.js'), 'utf8');

const ENTRY_UK = 'https://dictionary.cambridge.org/media/english/uk_pron/e/ent/entry_uk.mp3';
const ENTRY_US = 'https://dictionary.cambridge.org/media/english/us_pron/e/ent/entry_us.mp3';
const WOTD_UK = 'https://dictionary.cambridge.org/media/english/uk_pron/c/cdo/cdo12/cdo124ukbing0170.mp3';
const WOTD_US = 'https://dictionary.cambridge.org/media/english/us_pron/c/cdo/cdo12/cdo124usbing0170.mp3';

/* ---------------- parseAudio fixtures ---------------- */

const PAGE_WITH_ENTRY_AND_WOTD = `
<html><head><title>compassionate in Traditional Chinese</title></head><body>
  <span class="uk dpron-i ">
    <span class="pron-info"><span class="region">UK</span>
      <audio preload="none"><source type="audio/mpeg" src="${ENTRY_UK}"></audio>
    </span>
  </span>
  <span class="us dpron-i ">
    <span class="pron-info">
      <span class="audio_play_button pron-us" data-src-mp3="${ENTRY_US}"></span>
    </span>
  </span>
  <div class="wotd-hw feature-w-big">
    <span class="hw">binge-watch</span>
    <audio><source type="audio/mpeg" src="${WOTD_UK}"></audio>
    <span class="audio_play_button pron-us" data-src-mp3="${WOTD_US}"></span>
  </div>
</body></html>`;

const PAGE_ONLY_WOTD = `
<html><head><title>GIVE/LEND SOMEONE A HELPING HAND in Traditional Chinese</title></head><body>
  <h1>GIVE/LEND SOMEONE A HELPING HAND</h1>
  <div class="wotd-hw feature-w-big">
    <span class="hw">binge-watch</span>
    <audio><source type="audio/mpeg" src="${WOTD_UK}"></audio>
    <span class="audio_play_button pron-us" data-src-mp3="${WOTD_US}"></span>
  </div>
</body></html>`;

test('parseAudio takes only the entry pronunciation, never the Word of the Day mp3', () => {
    const audio = cambridge.parseAudio(PAGE_WITH_ENTRY_AND_WOTD);
    assert.strictEqual(audio.uk, ENTRY_UK);
    assert.strictEqual(audio.us, ENTRY_US);
    assert.ok(!/cdo124/.test(audio.uk + audio.us), 'WOTD recording leaked: ' + audio.uk + ' ' + audio.us);
});

test('parseAudio returns empty UK/US when the entry has no audio of its own', () => {
    const audio = cambridge.parseAudio(PAGE_ONLY_WOTD);
    assert.deepStrictEqual(audio, { uk: '', us: '' });
});

test('parseAudio ignores a Word of the Day widget that appears before the entry audio', () => {
    const html = `
      <title>compassionate in Traditional Chinese</title>
      <div class="feature-w-big"><audio><source type="audio/mpeg" src="${WOTD_UK}"></audio></div>
      <span class="uk dpron-i ">
        <audio><source type="audio/mpeg" src="/media/english/uk_pron/e/ent/entry_uk.mp3"></audio>
      </span>
      <span class="us dpron-i ">
        <span class="audio_play_button pron-us" data-src-mp3="/media/english/us_pron/e/ent/entry_us.mp3"></span>
      </span>`;
    const audio = cambridge.parseAudio(html);
    assert.strictEqual(audio.uk, ENTRY_UK);
    assert.strictEqual(audio.us, ENTRY_US);
});

test('parseAudio does not fall through to WOTD audio when an entry block has none', () => {
    const html = `
      <title>compassionate in Traditional Chinese</title>
      <span class="uk dpron-i "><span class="region">UK</span></span>
      <span class="us dpron-i "><span class="region">US</span></span>
      <div class="wotd-hw feature-w-big"><audio><source type="audio/mpeg" src="${WOTD_UK}"></audio></div>`;
    // Neither entry block carries audio; the widget must not be borrowed.
    const audio = cambridge.parseAudio(html);
    assert.strictEqual(audio.uk, '');
    assert.strictEqual(audio.us, '');
});

/* ---------------- dictation.js Listening behaviour ---------------- */

function makeEl() {
    return {
        innerText: '',
        innerHTML: '',
        value: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute() {},
        getAttribute() { return null; },
        appendChild() {},
        addEventListener() {},
        removeEventListener() {},
        focus() {},
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
}

function makeStorage() {
    const map = new Map();
    return {
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { map.set(k, String(v)); },
        removeItem(k) { map.delete(k); },
        clear() { map.clear(); }
    };
}

function loadDictation(cambridgeAudio) {
    const spoken = [];
    const fetched = [];
    const played = [];
    const sandbox = {
        console: console,
        document: {
            getElementById() { return makeEl(); },
            createElement() { return makeEl(); },
            addEventListener() {},
            querySelector() { return null; },
            querySelectorAll() { return []; }
        },
        speechSynthesis: {
            cancel() {},
            speak(utterance) { spoken.push(utterance.text); },
            getVoices() { return []; },
            addEventListener() {}
        },
        SpeechSynthesisUtterance: function (text) { this.text = text; },
        localStorage: makeStorage(),
        sessionStorage: makeStorage(),
        fetch: async function (url) {
            fetched.push(url);
            return {
                ok: true,
                json: async () => ({ audio: cambridgeAudio || { uk: '', us: '' } })
            };
        },
        Audio: function (url) {
            this.url = url;
            this.preload = '';
            this.addEventListener = function () {};
            this.pause = function () {};
            this.play = function () {
                played.push(url);
                return Promise.resolve();
            };
        },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Promise: Promise,
        // From js/shared.js; only the pieces dictation.js calls.
        primaryAnswer: word => String(word || '').split('/')[0].trim(),
        quizNormalize: word => String(word || '').trim().toLowerCase()
    };
    vm.createContext(sandbox);
    vm.runInContext(dictationSource, sandbox, { filename: 'js/dictation.js' });
    return { sandbox, spoken, fetched, played };
}

function setListeningWord(handle, english) {
    vm.runInContext(
        "quizMode = 'listening'; quizWords = [{ en: " + JSON.stringify(english) + ", zh: '中文' }]; quizIdx = 0;",
        handle.sandbox
    );
}

test('single-word Listening answer still prefetches and plays Cambridge audio', async () => {
    const handle = loadDictation({ uk: ENTRY_UK, us: ENTRY_US });
    setListeningWord(handle, 'compassionate');

    handle.sandbox.prefetchCambridgeAudio('compassionate');
    await new Promise(resolve => setTimeout(resolve, 20));
    await handle.sandbox.speakCurrentWord();

    assert.deepStrictEqual(handle.fetched, ['/api/cambridge?word=compassionate']);
    assert.deepStrictEqual(handle.played, [ENTRY_UK]);
    assert.deepStrictEqual(handle.spoken, [], 'device voice should stay idle when Cambridge plays');
});

test('multi-word Listening answer skips Cambridge and speaks the full phrase', async () => {
    const handle = loadDictation({ uk: ENTRY_UK, us: ENTRY_US });
    setListeningWord(handle, 'lend a helping hand');

    handle.sandbox.prefetchCambridgeAudio('lend a helping hand');
    await new Promise(resolve => setTimeout(resolve, 20));
    await handle.sandbox.speakCurrentWord();

    assert.deepStrictEqual(handle.fetched, [], 'no Cambridge request for a phrase');
    assert.deepStrictEqual(handle.played, []);
    assert.deepStrictEqual(handle.spoken, ['lend a helping hand']);
});

test('phrasal verbs keep their particle in the device voice', async () => {
    const handle = loadDictation({ uk: ENTRY_UK, us: ENTRY_US });
    setListeningWord(handle, 'look after');

    await handle.sandbox.speakCurrentWord();

    assert.deepStrictEqual(handle.fetched, []);
    assert.deepStrictEqual(handle.spoken, ['look after']);
});

test('cambridgeWordFor keeps hyphenated tokens but rejects phrases', () => {
    const handle = loadDictation({ uk: ENTRY_UK, us: ENTRY_US });
    assert.strictEqual(handle.sandbox.cambridgeWordFor('compassionate'), 'compassionate');
    assert.strictEqual(handle.sandbox.cambridgeWordFor('binge-watch'), 'binge-watch');
    assert.strictEqual(handle.sandbox.cambridgeWordFor('help out'), '');
    assert.strictEqual(handle.sandbox.cambridgeWordFor('Doctors Without Borders'), '');
});

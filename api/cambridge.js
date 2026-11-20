// Same-origin proxy: look up Traditional Chinese meanings in Cambridge Dictionary.
// Used by the teacher New Vocab editor. Do not scrape beyond the requested word.

function decodeEntities(s) {
    return String(s || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(s) {
    return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function hasCjk(s) {
    return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s);
}

function classList(attr) {
    const m = /class\s*=\s*"([^"]*)"/i.exec(attr || '');
    return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

function parseMeanings(html) {
    const meanings = [];
    const seen = new Set();
    // Short labels are leaf <span class="dtrans">詞</span> inside the fuller
    // dtrans-se sense line. Do not match the outer dtrans-se spans, or the
    // first </span> of a nested sense eats the compact meaning.
    const re = /<span\b([^>]*)>([^<]*)<\/span>/gi;
    let match;
    while ((match = re.exec(html))) {
        const cls = classList(match[1] || '');
        if (!cls.includes('dtrans') || cls.includes('dtrans-se')) continue;
        const text = stripTags(match[2]);
        if (!text || text.length > 40 || !hasCjk(text)) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        meanings.push({ text: text, pos: '' });
        if (meanings.length >= 12) break;
    }
    return meanings;
}

const EXAMPLE_STOP_WORDS = new Set([
    'of', 'the', 'a', 'an', 'to', 'in', 'on', 'at', 'for', 'with', 'and', 'or',
    'but', 'that', 'which', 'when', 'while', 'as', 'by', 'from', 'into',
    'about', 'over', 'under', 'than', 'is', 'are', 'was', 'were'
]);

function isCompleteExample(text) {
    const clean = String(text || '').replace(/\s+([.,!?;:])/g, '$1').trim();
    if (clean.length < 10 || clean.length > 220) return false;
    if (!/[.!?]"?$/.test(clean)) return false;
    const last = clean.replace(/[.!?]"?$/, '').split(/\s+/).pop().toLowerCase();
    if (EXAMPLE_STOP_WORDS.has(last)) return false;
    return true;
}

function parseExamples(html) {
    const out = [];
    const seen = new Set();
    const re = /<span class="eg deg">([\s\S]*?)<\/span>/gi;
    let match;
    while ((match = re.exec(html))) {
        const text = stripTags(match[1]).replace(/\s+([.,!?;:])/g, '$1');
        if (!isCompleteExample(text)) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        out.push(text);
        if (out.length >= 6) break;
    }
    return out;
}

function parseHeadword(html) {
    const t = /<title>([^<]+)<\/title>/i.exec(html || '');
    if (!t) return '';
    const raw = decodeEntities(t[1]);
    const m = /^(.+?)\s+in Traditional Chinese/i.exec(raw);
    return m ? m[1].trim() : '';
}

// Cambridge publishes one UK and one US recording per headword. The current
// markup uses <source type="audio/mpeg" src="/media/…/uk_pron/….mp3">; older
// pages used <span class="…pron-uk" data-src-mp3="…">. The player streams
// Cambridge's own file — nothing is copied or re-hosted here.
function absoluteCambridgeUrl(raw) {
    const url = decodeEntities(String(raw || '').trim());
    if (!url) return '';
    if (url.indexOf('//') === 0) return 'https:' + url;
    if (url.charAt(0) === '/') return 'https://dictionary.cambridge.org' + url;
    return url;
}

// Cambridge entry pages also embed a "Word of the day" / feature widget
// (class names such as wotd-hw and feature-w-big). Those widgets carry their
// own mp3s, so scanning the whole page can play an unrelated word — most
// visibly for entries that have no recording of their own. Entry audio lives
// inside a pronunciation block (`uk dpron-i` / `us dpron-i`); the side
// modules do not use dpron-i.
const AUDIO_BLOCK_CHARS = 2400;
const SIDE_MODULE_RE = /\bclass\s*=\s*"[^"]*\b(?:wotd|feature-w-big)\b/i;

function entryAudioChunk(html, start, end) {
    const limit = Math.min(end, start + AUDIO_BLOCK_CHARS);
    const chunk = String(html || '').slice(start, limit);
    const stop = chunk.search(SIDE_MODULE_RE);
    return stop > -1 ? chunk.slice(0, stop) : chunk;
}

function audioInsideBlock(chunk) {
    const found = [];
    let m;
    // Current markup: <source type="audio/mpeg" src="...">
    const sourceRe = /<source\b([^>]*)>/gi;
    while ((m = sourceRe.exec(chunk))) {
        const attrs = m[1] || '';
        if (!/type\s*=\s*"audio\/mpeg"/i.test(attrs)) continue;
        const src = /src\s*=\s*"([^"]+)"/i.exec(attrs);
        if (src) found.push(src[1]);
    }
    // Older markup: <span class="audio_play_button pron-uk" data-src-mp3="...">
    const spanRe = /<[a-z][a-z0-9]*\b([^>]*data-src-mp3\s*=\s*"([^"]+)"[^>]*)>/i.exec(chunk);
    if (spanRe) found.push(spanRe[2]);
    for (let i = 0; i < found.length; i++) {
        const url = absoluteCambridgeUrl(found[i]);
        if (/^https:\/\/dictionary\.cambridge\.org\/media\//i.test(url)) return url;
    }
    return '';
}

function parseAudio(html) {
    const source = String(html || '');
    const audio = { uk: '', us: '' };
    // Locate every entry pronunciation block first; only audio inside one of
    // them is the headword's own recording.
    const blocks = [];
    const tagRe = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
    let m;
    while ((m = tagRe.exec(source))) {
        const cls = classList(m[2] || '');
        if (!cls.includes('dpron-i')) continue;
        const region = cls.includes('uk') ? 'uk' : (cls.includes('us') ? 'us' : '');
        if (!region) continue;
        blocks.push({ region: region, start: m.index + m[0].length });
    }
    blocks.forEach((block, i) => {
        if (audio[block.region]) return;
        const end = i + 1 < blocks.length ? blocks[i + 1].start : source.length;
        const url = audioInsideBlock(entryAudioChunk(source, block.start, end));
        if (!url) return;
        if (/\/uk_pron\//i.test(url)) audio.uk = audio.uk || url;
        else if (/\/us_pron\//i.test(url)) audio.us = audio.us || url;
        else audio[block.region] = audio[block.region] || url;
    });
    return audio;
}

function normalizeWord(raw) {
    return String(raw || '').trim().replace(/\s+/g, ' ');
}

function isAllowedWord(word) {
    return /^[A-Za-z][A-Za-z0-9 .'\-]{0,79}$/.test(word);
}

function slugForUrl(word) {
    return word.toLowerCase().replace(/\s+/g, '-');
}

async function fetchEntry(word) {
    const url = 'https://dictionary.cambridge.org/dictionary/english-chinese-traditional/' + encodeURIComponent(slugForUrl(word));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: ctrl.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'zh-HK,zh-TW,zh,en;q=0.8',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });
        const html = await res.text();
        return { ok: res.ok, status: res.status, html: html };
    } finally {
        clearTimeout(timer);
    }
}

async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }
    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
    const word = normalizeWord((req.query && req.query.word) || '');
    if (!word || !isAllowedWord(word)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ word: word, found: false, meanings: [], error: 'Enter a valid English word.' }));
        return;
    }
    try {
        const result = await fetchEntry(word);
        const meanings = result.html ? parseMeanings(result.html) : [];
        const headword = result.html ? parseHeadword(result.html) : '';
        const audio = result.html ? parseAudio(result.html) : { uk: '', us: '' };
        const examples = result.html ? parseExamples(result.html) : [];
        // Cambridge's "did you mean…" search page also carries recordings of
        // other words, so only trust the audio when we landed on a real entry.
        if (!headword) {
            audio.uk = '';
            audio.us = '';
        }
        const found = meanings.length > 0 || !!(audio.uk || audio.us);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.statusCode = 200;
        res.end(JSON.stringify({
            word: word,
            found: found,
            headword: headword,
            meanings: meanings,
            examples: examples,
            audio: audio,
            source: 'Cambridge Dictionary'
        }));
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
        res.statusCode = 502;
        res.end(JSON.stringify({
            word: word,
            found: false,
            meanings: [],
            examples: [],
            error: aborted ? 'Cambridge Dictionary timed out.' : 'Could not reach Cambridge Dictionary.'
        }));
    }
}

module.exports = handler;
module.exports.parseMeanings = parseMeanings;
module.exports.parseHeadword = parseHeadword;
module.exports.parseAudio = parseAudio;

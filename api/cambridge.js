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

function parseHeadword(html) {
    const t = /<title>([^<]+)<\/title>/i.exec(html || '');
    if (!t) return '';
    const raw = decodeEntities(t[1]);
    const m = /^(.+?)\s+in Traditional Chinese/i.exec(raw);
    return m ? m[1].trim() : '';
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
    res.setHeader('Cache-Control', 'public, max-age=86400');
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
        const found = meanings.length > 0;
        res.statusCode = 200;
        res.end(JSON.stringify({
            word: word,
            found: found,
            headword: headword,
            meanings: meanings,
            source: 'Cambridge Dictionary'
        }));
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
        res.statusCode = 502;
        res.end(JSON.stringify({
            word: word,
            found: false,
            meanings: [],
            error: aborted ? 'Cambridge Dictionary timed out.' : 'Could not reach Cambridge Dictionary.'
        }));
    }
}

module.exports = handler;
module.exports.parseMeanings = parseMeanings;
module.exports.parseHeadword = parseHeadword;

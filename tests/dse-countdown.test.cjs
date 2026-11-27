/* Unit tests for the 2027 HKDSE English countdown banner.
 *
 * js/dse-countdown.js is loaded on its own in a vm. No browser, no network,
 * no Supabase. Every instant is passed explicitly, so the tests never depend
 * on the machine's clock or local time zone.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;

const source = fs.readFileSync(path.join(ROOT, 'js', 'dse-countdown.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

function loadDse() {
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'js/dse-countdown.js' });
    return sandbox.window.DSE2027;
}

const dse = loadDse();

function bannerHtml() {
    const start = html.indexOf('id="hub-dse-countdown"');
    assert.ok(start !== -1, '#hub-dse-countdown exists');
    return html.slice(start, html.indexOf('</section>', start));
}

// The CSS rule body for a single selector, from "selector {" to its own "}".
function cssRule(selector) {
    const start = html.indexOf(selector + ' {');
    assert.ok(start !== -1, selector + ' rule exists');
    const end = html.indexOf('}', start);
    assert.ok(end > start, selector + ' rule closes');
    return html.slice(start, end + 1);
}

// Brace-counted block starting at or after startIndex (handles nesting).
function cssBlock(startIndex) {
    const open = html.indexOf('{', startIndex);
    assert.ok(open !== -1, 'block opens');
    let depth = 0;
    for (let i = open; i < html.length; i += 1) {
        if (html[i] === '{') {
            depth += 1;
        } else if (html[i] === '}') {
            depth -= 1;
            if (depth === 0) return html.slice(startIndex, i + 1);
        }
    }
    return html.slice(startIndex);
}

// The first "@media <query>" block that actually contains marker.
function mediaContaining(query, marker) {
    let from = 0;
    while (true) {
        const start = html.indexOf('@media ' + query, from);
        if (start === -1) break;
        const block = cssBlock(start);
        if (block.indexOf(marker) !== -1) return block;
        from = start + 1;
    }
    assert.fail('no @media ' + query + ' block contains ' + marker);
}

function calendarDays(fromIso, toIso) {
    const from = fromIso.split('-').map(Number);
    const to = toIso.split('-').map(Number);
    return Math.round(
        (Date.UTC(to[0], to[1] - 1, to[2]) - Date.UTC(from[0], from[1] - 1, from[2])) / DAY_MS
    );
}

test('the API exposes the official paper dates and Hong Kong time zone', () => {
    assert.equal(dse.PAPER1, '2027-04-09');
    assert.equal(dse.PAPER3, '2027-04-10');
    assert.equal(dse.TIME_ZONE, 'Asia/Hong_Kong');
    assert.equal(typeof dse.hkDate, 'function');
    assert.equal(typeof dse.state, 'function');
    assert.equal(typeof dse.paint, 'function');
});

test('hkDate returns the Asia/Hong_Kong calendar date', () => {
    assert.equal(dse.hkDate('2027-04-08T17:00:00Z'), '2027-04-09');
    assert.equal(dse.hkDate('2027-04-09T00:30:00+08:00'), '2027-04-09');
    assert.equal(dse.hkDate('2026-11-26T12:00:00+08:00'), '2026-11-26');
});

test('26 Nov 2026 counts the whole calendar days until 9 Apr 2027', () => {
    const expected = calendarDays('2026-11-26', '2027-04-09');
    const state = dse.state('2026-11-26T12:00:00+08:00');
    assert.equal(state.mode, 'countdown');
    assert.equal(state.days, expected);
    assert.ok(state.days > 0);
});

test('one day before Paper 1 still counts down to 1 day', () => {
    const state = dse.state('2027-04-08T23:30:00+08:00');
    assert.equal(state.mode, 'countdown');
    assert.equal(state.days, 1);
});

test('the whole 9 Apr 2027 HKT day is Paper 1 & 2 day', () => {
    const early = dse.state('2027-04-09T00:30:00+08:00');
    assert.equal(early.mode, 'paper12');
    assert.equal(early.days, 0);
    assert.ok(early.days >= 0);
    assert.match(early.message, /Paper 1 & 2 today/);

    const evening = dse.state('2027-04-09T18:00:00+08:00');
    assert.equal(evening.mode, 'paper12');
    assert.equal(evening.days, 0);
});

test('the whole 10 Apr 2027 HKT day is Paper 3 day', () => {
    const state = dse.state('2027-04-10T09:00:00+08:00');
    assert.equal(state.mode, 'paper3');
    assert.equal(state.days, 0);
    assert.match(state.message, /Paper 3 today/);
});

test('after 10 Apr 2027 the banner is hidden', () => {
    const state = dse.state('2027-04-11T00:30:00+08:00');
    assert.equal(state.mode, 'hidden');
    assert.equal(state.days, 0);
});

test('a UTC instant that is already 9 Apr in HKT uses the HKT date', () => {
    // 8 Apr 2027 17:00 UTC = 9 Apr 2027 01:00 HKT.
    const fromIso = dse.state('2027-04-08T17:00:00Z');
    assert.equal(fromIso.today, '2027-04-09');
    assert.equal(fromIso.mode, 'paper12');

    // And just before that, 8 Apr 2027 15:59 UTC = 8 Apr 23:59 HKT.
    const before = dse.state('2027-04-08T15:59:00Z');
    assert.equal(before.today, '2027-04-08');
    assert.equal(before.mode, 'countdown');
    assert.equal(before.days, 1);
});

test('days is never negative around and after the exam', () => {
    const instants = [
        '2026-11-26T12:00:00+08:00',
        '2027-04-08T23:59:00+08:00',
        '2027-04-09T00:00:00+08:00',
        '2027-04-09T23:59:00+08:00',
        '2027-04-10T00:00:00+08:00',
        '2027-04-10T23:59:00+08:00',
        '2027-04-11T00:00:00+08:00',
        '2028-06-01T12:00:00+08:00'
    ];
    instants.forEach((iso) => {
        assert.ok(dse.state(iso).days >= 0, iso + ' must not be negative');
    });
});

test('the painter updates the day count and hides the banner after the exam', () => {
    const elements = {};
    function makeEl(id) {
        const el = {
            id,
            hidden: false,
            textContent: '',
            attrs: {},
            classList: {
                classes: new Set(),
                add(name) { this.classes.add(name); },
                remove(name) { this.classes.delete(name); },
                contains(name) { return this.classes.has(name); }
            },
            setAttribute(name, value) { this.attrs[name] = value; },
            getAttribute(name) { return this.attrs[name]; }
        };
        elements[id] = el;
        return el;
    }
    ['hub-dse-countdown', 'hub-dse-count', 'hub-dse-days', 'hub-dse-unit', 'hub-dse-note'].forEach(makeEl);
    const fakeDoc = { getElementById: (id) => elements[id] || null };

    const countdown = dse.paint(fakeDoc, '2027-04-08T23:30:00+08:00');
    assert.equal(countdown.mode, 'countdown');
    assert.equal(elements['hub-dse-days'].textContent, '1');
    assert.equal(elements['hub-dse-unit'].textContent, 'day');
    assert.equal(elements['hub-dse-count'].hidden, false);
    assert.equal(elements['hub-dse-note'].hidden, true);
    assert.equal(elements['hub-dse-countdown'].hidden, false);
    assert.equal(elements['hub-dse-countdown'].attrs['data-mode'], 'countdown');

    const paperDay = dse.paint(fakeDoc, '2027-04-09T09:00:00+08:00');
    assert.equal(paperDay.mode, 'paper12');
    assert.equal(elements['hub-dse-count'].hidden, true);
    assert.equal(elements['hub-dse-note'].hidden, false);
    assert.match(elements['hub-dse-note'].textContent, /Paper 1 & 2 today/);

    dse.paint(fakeDoc, '2027-04-11T00:30:00+08:00');
    assert.equal(elements['hub-dse-countdown'].hidden, true);
    assert.equal(elements['hub-dse-countdown'].classList.contains('hidden'), true);
});

test('the banner is the first row inside the hub view and only lives there', () => {
    const hubStart = html.indexOf('<div id="hub-view"');
    assert.ok(hubStart !== -1, '#hub-view exists');

    const firstChild = html.slice(hubStart).match(/^<div id="hub-view"[^>]*>\s*<([a-z0-9-]+)([^>]*)>/i);
    assert.ok(firstChild, '#hub-view has a first child element');
    assert.match(firstChild[2], /id="hub-dse-countdown"/);
    assert.match(firstChild[2], /md:col-span-2/);

    const banner = html.indexOf('id="hub-dse-countdown"');
    const brandHeader = html.indexOf('class="brand-header');
    assert.ok(brandHeader !== -1 && brandHeader < hubStart, 'the brand header is above the hub');
    assert.ok(banner > hubStart, 'the banner is inside #hub-view and not in .brand-header');

    // It must not be pasted into another view.
    assert.equal((html.match(/id="hub-dse-countdown"/g) || []).length, 1);
});

test('index.html loads the helper after shared.js and shows both paper dates', () => {
    const sharedTag = html.indexOf('<script src="js/shared.js"></script>');
    const dseTag = html.indexOf('<script src="js/dse-countdown.js"></script>');
    assert.ok(sharedTag !== -1, 'shared.js script tag exists');
    assert.ok(dseTag !== -1, 'dse-countdown.js script tag exists');
    assert.ok(dseTag > sharedTag, 'dse-countdown.js loads after shared.js');

    assert.match(html, /2027 DSE(?:\s*<\/span>)?\s*English/, 'the heading copy is still present');
    assert.match(html, /9 Apr 2027/);
    assert.match(html, /10 Apr 2027/);
    assert.match(html, /Paper 1 &amp; 2/);
    assert.match(html, /Paper 3/);
    assert.match(html, /aria-live="polite"/);
});

test('service worker v123 precaches the countdown helper and kitten, and v122 is gone', () => {
    assert.match(sw, /const CACHE_NAME = 'learnity-pwa-v123';/);
    assert.equal(sw.indexOf('learnity-pwa-v122'), -1, 'the old cache name is gone');
    assert.equal(sw.indexOf('learnity-pwa-v121'), -1, 'the older cache name is gone');
    assert.ok(sw.indexOf("'/js/dse-countdown.js'") !== -1, 'the helper is in CORE_ASSETS');
    assert.ok(sw.indexOf("'/images/dse-countdown-kitten.png'") !== -1, 'the kitten is precached');
});

test('the decorative stars are small, hidden from assistive tech and emoji-free', () => {
    const start = html.indexOf('id="hub-dse-countdown"');
    assert.ok(start !== -1);
    const banner = html.slice(start, html.indexOf('</section>', start));

    const stars = banner.match(/<svg class="dse-banner-star[^>]*>/g) || [];
    assert.ok(stars.length >= 2 && stars.length <= 3, 'two or three stars only, not a sticker explosion');
    stars.forEach((tag) => {
        assert.match(tag, /aria-hidden="true"/, 'every star is decorative');
        assert.match(tag, /focusable="false"/, 'every star is skipped by keyboard focus');
        assert.doesNotMatch(tag, /width="\d{2,}"/, 'no oversized star markup');
    });

    // Soft copy is allowed, but only one short touch and no emoji spam.
    assert.match(banner, /dse-banner-cheer">加油</);
    assert.doesNotMatch(banner, /[⭐🌟✨💫]/);
});

test('the coloured stars keep the slim bar static and compact', () => {
    // Only the .dse-banner rule itself, not the whole banner CSS section.
    const css = cssRule('.dse-banner');

    assert.match(css, /padding: 0\.55rem 0\.95rem;/, 'padding stays compact');
    assert.match(css, /overflow: hidden;/, 'stars cannot spill out of the rounded box');
    assert.doesNotMatch(css, /animation\s*:/, 'no layout-shifting animation');
    assert.doesNotMatch(css, /transform\s*:/, 'no transform on the bar');
});

test('only "2027 DSE" is underlined, in a warm orange', () => {
    const banner = bannerHtml();
    assert.equal((banner.match(/class="dse-banner-heading"/g) || []).length, 1, 'exactly one heading span');
    assert.match(banner, /<span class="dse-banner-heading">2027 DSE<\/span>\s*English/, 'the span wraps exactly 2027 DSE');
    assert.doesNotMatch(banner, /<span class="dse-banner-heading">[^<]*English/, 'English stays outside the span');
    assert.doesNotMatch(banner, /<span class="dse-banner-heading">[^<]*加油/, 'the cheer stays outside the span');

    const css = cssRule('.dse-banner-heading');
    assert.match(css, /text-decoration-line:\s*underline;/, 'the heading is underlined');
    assert.match(css, /text-decoration-color:\s*#(?:fb923c|ea580c|fdba74);/i, 'warm orange, not the default black underline');
    assert.match(css, /text-decoration-thickness:\s*1\.5px;/, 'thin tidy underline');
    assert.match(css, /text-underline-offset:/, 'a little offset');
});

test('only the day count bounces, gently and with translateY only', () => {
    const days = cssRule('.dse-banner-days');
    assert.match(days, /display:\s*inline-block;/, 'the span can take a transform');
    const animation = days.match(/animation:\s*dse-banner-bounce\s+([\d.]+)s\s+ease-in-out\s+infinite/);
    assert.ok(animation, '.dse-banner-days has the infinite bounce animation');
    const duration = Number(animation[1]);
    assert.ok(duration >= 1.8 && duration <= 2.4, 'slow and cute, not frantic: ' + duration + 's');

    const frames = cssBlock(html.indexOf('@keyframes dse-banner-bounce'));
    assert.match(frames, /transform:\s*translateY\(/, 'the bounce moves with translateY');
    assert.doesNotMatch(frames, /\b(?:top|left|right|bottom|margin|height|padding|line-height)\s*:/, 'no layout properties in the keyframes');
    const offsets = Array.from(frames.matchAll(/translateY\((-?[\d.]+)px\)/g)).map((m) => Math.abs(Number(m[1])));
    assert.ok(offsets.length > 0, 'translateY keyframes exist');
    assert.ok(Math.max.apply(null, offsets) >= 2.5 && Math.max.apply(null, offsets) <= 3.5,
        'a soft 2.5–3.5px hop');

    const reduced = mediaContaining('(prefers-reduced-motion: reduce)', '.dse-banner-days');
    assert.match(reduced, /\.dse-banner-days\s*\{[^}]*animation:\s*none;/, 'reduced motion disables the bounce');
});

test('the kitten is a small, faded, never-animated gap decoration between the text blocks', () => {
    const banner = bannerHtml();
    const img = banner.match(/<img class="dse-banner-kitten"[^>]*>/);
    assert.ok(img, 'the kitten img is inside the banner');
    assert.match(img[0], /src="images\/dse-countdown-kitten\.png"/);
    assert.match(img[0], /alt=""/, 'decorative image has an empty alt');
    assert.match(img[0], /aria-hidden="true"/, 'hidden from assistive tech');
    assert.match(img[0], /width="320"/);
    assert.match(img[0], /height="512"/);

    // It sits in-flow BETWEEN the left text block and the right day-count block,
    // so it can never paint over either cluster's words.
    const left = banner.indexOf('<div class="dse-banner-left">');
    const kitten = banner.indexOf('<img class="dse-banner-kitten"');
    const right = banner.indexOf('<div class="dse-banner-right">');
    assert.ok(left !== -1, 'left cluster exists');
    assert.ok(kitten !== -1, 'kitten exists');
    assert.ok(right !== -1, 'right cluster exists');
    assert.ok(kitten > left && kitten < right, 'the kitten is the middle flex sibling');

    const css = cssRule('.dse-banner-kitten');
    assert.doesNotMatch(css, /position:\s*(?:absolute|fixed);/, 'not pinned to a corner');
    assert.match(css, /position:\s*(?:relative|static);/, 'the kitten stays in flow');
    assert.doesNotMatch(css, /(?:^|[\s{;])(?:right|bottom)\s*:/, 'no corner offsets');
    assert.match(css, /flex:\s*0\s+(?:0|1)\s+auto;/, 'the kitten is a flex sibling');
    assert.match(css, /align-self:\s*center;/, 'vertically centred in the bar');
    assert.match(css, /pointer-events:\s*none;/, 'the kitten never steals taps');
    assert.match(css, /user-select:\s*none;/, 'the kitten is not selectable');
    assert.match(css, /width:\s*auto;/, 'width follows the aspect ratio');
    assert.doesNotMatch(css, /animation\s*:/, 'the kitten is not animated');
    assert.doesNotMatch(css, /padding|margin/, 'the kitten adds no spacing to the bar');

    const opacity = Number(css.match(/opacity:\s*([\d.]+);/)[1]);
    assert.ok(opacity > 0 && opacity < 1, 'slightly faded: ' + opacity);

    const desktopHeight = Number(css.match(/height:\s*(\d+)px;/)[1]);
    assert.ok(desktopHeight >= 44 && desktopHeight <= 52, 'modest desktop height: ' + desktopHeight + 'px');

    const phone = mediaContaining('(max-width: 480px)', '.dse-banner-kitten');
    const phoneRule = phone.match(/\.dse-banner-kitten\s*\{([^}]*)\}/);
    assert.ok(phoneRule, 'phones get a smaller kitten');
    const phoneHeight = Number(phoneRule[1].match(/height:\s*(\d+)px;/)[1]);
    assert.ok(phoneHeight < desktopHeight, 'phone kitten is smaller');
    assert.ok(phoneHeight >= 28 && phoneHeight <= 34, 'phone height stays modest: ' + phoneHeight + 'px');

    const narrow = mediaContaining('(max-width: 380px)', '.dse-banner-kitten');
    const narrowRule = narrow.match(/\.dse-banner-kitten\s*\{([^}]*)\}/);
    assert.ok(narrowRule, 'very narrow phones shrink the kitten again');
    const narrowHeight = Number(narrowRule[1].match(/height:\s*(\d+)px;/)[1]);
    assert.ok(narrowHeight < phoneHeight, 'very narrow kitten is smaller still: ' + narrowHeight + 'px');
    assert.ok(narrowHeight >= 24 && narrowHeight <= 28, 'very narrow height stays tiny: ' + narrowHeight + 'px');
});

test('「加油」 is still hidden on narrow phone widths', () => {
    const phone = mediaContaining('(max-width: 480px)', '.dse-banner-cheer');
    assert.match(phone, /\.dse-banner-cheer\s*\{\s*display:\s*none;/, 'the cheer stays hidden on phones');
});

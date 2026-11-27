/* LearniTY — 2027 HKDSE English countdown banner (homepage hub only).
 *
 * Countdown target: 00:00 on Friday 9 April 2027 in Asia/Hong_Kong (HKT).
 * That is the start of the Paper 1 & 2 calendar day, not the 08:30 paper
 * start time. We never count to Paper 3 (10 April) or the mid-March
 * Speaking window. All day maths uses the HKT calendar, so a phone set to
 * another time zone still sees the Hong Kong date.
 *
 * The day count is a whole-calendar-day difference and is clamped at 0,
 * so it can never show a negative number. Pure helpers work without a DOM;
 * the painter only runs in the browser.
 */
(function () {
    'use strict';

    var PAPER1 = '2027-04-09';
    var PAPER3 = '2027-04-10';
    var TIME_ZONE = 'Asia/Hong_Kong';
    var DAY_MS = 24 * 60 * 60 * 1000;

    var MESSAGES = {
        paper12: "Paper 1 & 2 today — you've got this.",
        paper3: "Paper 3 today — listen closely, you've got this."
    };

    var hkFormatter = null;

    function toDate(value) {
        if (value instanceof Date) return new Date(value.getTime());
        if (typeof value === 'number' && isFinite(value)) return new Date(value);
        if (typeof value === 'string') {
            var text = value.trim();
            // A zone-less timestamp such as 2027-04-09T00:30:00 is read as
            // HKT wall time, which is what callers mean for this banner.
            if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
                text += '+08:00';
            }
            var parsed = new Date(text);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        return new Date();
    }

    /* 'YYYY-MM-DD' for the Asia/Hong_Kong calendar date of `now`. */
    function hkDate(now) {
        if (!hkFormatter) {
            hkFormatter = new Intl.DateTimeFormat('en-GB', {
                timeZone: TIME_ZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
        }
        var parts = hkFormatter.formatToParts(toDate(now));
        var year = '';
        var month = '';
        var day = '';
        for (var i = 0; i < parts.length; i += 1) {
            if (parts[i].type === 'year') year = parts[i].value;
            else if (parts[i].type === 'month') month = parts[i].value;
            else if (parts[i].type === 'day') day = parts[i].value;
        }
        return year + '-' + month + '-' + day;
    }

    /* Whole days since 1970-01-01 for an ISO calendar date (no time zones). */
    function dayNumber(isoDate) {
        var bits = isoDate.split('-');
        return Math.round(Date.UTC(Number(bits[0]), Number(bits[1]) - 1, Number(bits[2])) / DAY_MS);
    }

    /* { mode, days, today, paper1, paper3, timeZone } for a Date or ISO string. */
    function state(now) {
        var today = hkDate(now);
        var base = {
            today: today,
            paper1: PAPER1,
            paper3: PAPER3,
            timeZone: TIME_ZONE
        };

        if (today < PAPER1) {
            var days = dayNumber(PAPER1) - dayNumber(today);
            base.mode = 'countdown';
            base.days = Math.max(0, days);
            base.message = '';
            return base;
        }
        if (today === PAPER1) {
            base.mode = 'paper12';
            base.days = 0;
            base.message = MESSAGES.paper12;
            return base;
        }
        if (today === PAPER3) {
            base.mode = 'paper3';
            base.days = 0;
            base.message = MESSAGES.paper3;
            return base;
        }
        base.mode = 'hidden';
        base.days = 0;
        base.message = '';
        return base;
    }

    /* Update #hub-dse-countdown from the current time. Safe to call often. */
    function paint(doc, now) {
        doc = doc || (typeof document !== 'undefined' ? document : null);
        if (!doc) return null;

        var root = doc.getElementById('hub-dse-countdown');
        if (!root) return null;

        var current = state(now === undefined ? new Date() : now);
        root.setAttribute('data-mode', current.mode);

        if (current.mode === 'hidden') {
            root.hidden = true;
            root.classList.add('hidden');
            return current;
        }

        root.hidden = false;
        root.classList.remove('hidden');

        var count = doc.getElementById('hub-dse-count');
        var daysEl = doc.getElementById('hub-dse-days');
        var unitEl = doc.getElementById('hub-dse-unit');
        var noteEl = doc.getElementById('hub-dse-note');

        if (current.mode === 'countdown') {
            if (count) count.hidden = false;
            if (noteEl) {
                noteEl.hidden = true;
                noteEl.textContent = '';
            }
            if (daysEl) daysEl.textContent = String(current.days);
            if (unitEl) unitEl.textContent = current.days === 1 ? 'day' : 'days';
            if (count) {
                count.setAttribute('aria-label',
                    current.days + (current.days === 1 ? ' day' : ' days') +
                    ' until Paper 1 and 2 on 9 April 2027');
            }
        } else {
            if (count) count.hidden = true;
            if (noteEl) {
                noteEl.hidden = false;
                noteEl.textContent = current.message;
            }
        }

        return current;
    }

    var api = {
        PAPER1: PAPER1,
        PAPER3: PAPER3,
        TIME_ZONE: TIME_ZONE,
        MESSAGES: MESSAGES,
        hkDate: hkDate,
        state: state,
        paint: paint
    };

    if (typeof window !== 'undefined') window.DSE2027 = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    // The script is loaded at the end of <body>, after the hub markup.
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { paint(); });
        } else {
            paint();
        }
    }
})();

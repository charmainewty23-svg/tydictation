/* PurrStack 1v1 battle — thin Supabase RPC bridge for the embedded game.
   The game runs in an iframe and calls window.parent.PSB.* directly. */

(function () {
    'use strict';

    function ready() {
        return typeof sb !== 'undefined' && !!currentUser;
    }

    function canPlay() {
        return ready() && !isGuestUser() && !previewStudentForm();
    }

    function myId() {
        return currentUser ? currentUser.id : '';
    }

    async function rpc(name, args) {
        if (!canPlay()) return { data: null, error: { message: 'AUTH' } };
        try {
            const res = await sb.rpc(name, args || {});
            return { data: res.data || null, error: res.error || null };
        } catch (error) {
            return { data: null, error: error };
        }
    }

    window.PSB = {
        ready,
        canPlay,
        myId,
        create: () => rpc('create_purrstack_room'),
        join: (code) => rpc('join_purrstack_room', { p_code: String(code || '').trim() }),
        start: (room) => rpc('start_purrstack_room', { p_room: room }),
        state: (room) => rpc('purrstack_room_state', { p_room: room }),
        garbage: (room, lines) => rpc('purrstack_send_garbage', { p_room: room, p_lines: Math.max(0, Number(lines) || 0) }),
        ackGarbage: (room, count) => rpc('purrstack_ack_garbage', { p_room: room, p_count: Math.max(0, Number(count) || 0) }),
        report: (room, payload) => rpc('purrstack_report', {
            p_room: room,
            p_score: Math.max(0, Number(payload && payload.score) || 0),
            p_lines: Math.max(0, Number(payload && payload.lines) || 0),
            p_correct: Math.max(0, Number(payload && payload.correct) || 0),
            p_wrong: Math.max(0, Number(payload && payload.wrong) || 0),
            p_alive: !(payload && payload.alive === false)
        }),
        finish: (room) => rpc('purrstack_finish', { p_room: room }),
        leave: (room) => rpc('purrstack_leave', { p_room: room }),
        rematch: (room) => rpc('purrstack_rematch', { p_room: room })
    };
})();

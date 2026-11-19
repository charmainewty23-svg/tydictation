/* Source-inspection tests: the public Hub Leaderboard no longer exposes a
   PurrStack 1v1 tab. Solo PurrStack stays. No browser, no network. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const leaderboardSource = fs.readFileSync(path.join(root, 'js/leaderboard.js'), 'utf8');

test('the Leaderboard markup has no PurrStack 1v1 tab', () => {
    assert.ok(htmlSource.indexOf("loadLeaderboard('purrstack1v1')") === -1,
        'the 1v1 mode button is gone');
    assert.ok(!/🐾 PurrStack 1v1/.test(htmlSource), 'no 1v1 label in the markup');
});

test('the solo PurrStack tab and the other mode buttons remain', () => {
    assert.ok(htmlSource.indexOf("loadLeaderboard('purrstack')") !== -1, 'solo PurrStack stays');
    assert.match(htmlSource, /🐾 PurrStack</, 'the solo label stays');
    ["all", "listening", "recitation", "streaks", "wordjump", "flap", "wjchallenge", "dgsolo", "dgmulti"]
        .forEach(mode => {
            assert.ok(htmlSource.indexOf("loadLeaderboard('" + mode + "')") !== -1, mode + ' tab stays');
        });
});

test('js/leaderboard.js never reads purrstack_battle_leaderboard for a public tab', () => {
    assert.ok(leaderboardSource.indexOf('purrstack_battle_leaderboard') === -1,
        'the 1v1 view is no longer queried by the leaderboard');
    assert.ok(leaderboardSource.indexOf('renderPurrStackBattleLeaderboard') === -1,
        'the 1v1 renderer is removed so the tab cannot be reached');
    assert.ok(leaderboardSource.indexOf('PurrStack 1v1 —') === -1, 'the 1v1 subtitle is gone');
    assert.ok(leaderboardSource.indexOf("from('purrstack_leaderboard')") !== -1,
        'the solo PurrStack board still loads');
});

test('a stale purrstack1v1 call falls back to the solo PurrStack board', () => {
    assert.match(leaderboardSource,
        /lbModeFilter = \(mode === 'purrstack1v1'\) \? 'purrstack' : \(mode \|\| 'all'\);/,
        'mode is normalised before anything is fetched');
});

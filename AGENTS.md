# LearniTY Dictation — AI Agent 交接文檔

> 閱讀對象：本專案擁有人＋幫佢改 code 嘅 AI agent。
> 版本基準：GitHub `charmainewty23-svg/tydictation` main 分支原版（單一 `index.html`，SVG 貓 mascot，無貼圖）。
> 注意：另有一個本地貼圖分支（大麻成 sticker 版）存在於另一部機，**唔好**將貼圖改動推上本 repo。

---

## 1. 專案一句話＋部署鏈

- 靜態英文學習站：Grammar Quest（句型＋時態）＋ Dictation Master（聽寫：Listening / Recitation / Revision）。
- 原始碼分兩層：`index.html`（全部 markup／CSS／內聯 SVG，~1130 行）＋ `js/` 入面嘅功能 JS
  （2026-11 由原本一個大 inline `<script>` 拆出嚟，見 §3.1）。冇 build step，直接開檔都用得。
- 部署：push `main` → Vercel（`tydictation.vercel.app`）自動重 deploy。**唔好**引入 build step、後端 server、環境變數以外的秘密。

## 2. 題庫 Google Sheet（已內建雲端題庫）

- Sheet ID：`1HY-fkzE7K6cYY5ZHgFVIubhzhSyMWpofjKLnEvjllwU`（擁有人＝本專案擁有人，可直接改）。
- 讀取方式：`loadAllCategoriesFromSheet()` 經 gviz CSV 公開讀取，
  `https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&sheet=<tab名>`。
- Tab（20 個，見 `SHEET_NAMES`）：charity, entertainment, environmental issues, family,
  fashion, festivals, food and restaurants, health, housing, law and order,
  modern communication, people, animals and pets, school, Shopping,
  social affairs, MTR stations, sports, exam focus, basics。
- 欄位格式（每 tab 三欄）：`序號, 英文, 中文`。`parseCSV()` 取 `parts[1]` 作 `en`、
  `parts[2]` 作 `zh`。
- **第一行**：大部分 tab 第一行係標題（例如 `Charity Level 1: ...`），會被 skip；
  `basics` tab **冇**標題行，所以 `parseCSV()` 改成「第一行唔似資料（第二欄空
  或第一欄唔係數字）才 skip」，兩款格式都食得住。
- **一個 cell 多個答案**：例如 `plaza / square / mall`、`flat/unit`。
  `answerVariants()` 用 `/` 切開，`isAnswerCorrect()` 接受任何一個寫法；
  語音朗讀同 hint 只用**第一個**（`primaryAnswer()`）。新增題目照舊用 ` / ` 分隔就得。
- **加新 topic 三步**：Sheet 加新 tab（同樣三欄格式）→ `SHEET_NAMES` 加名 →
  `renderCategories()` 嘅 emoji map 加 icon。缺 emoji 會 fallback 📦。
  想個名顯示得靚（例如 `basics` → `Basics`）就加落 `TOPIC_LABELS`。
- **gviz 只讀**：寫入一定要經其他通道（見 §5，成績唔擺 Sheet）。
  **New Vocab 唔係 Sheet tab**，老師喺網站度改，見 §11。

## 3. 檔案地圖

### 3.1 `js/` 檔案同載入次序（2026-11 拆分）

原本全部邏輯喺 `index.html` 一個 ~8400 行 inline `<script>`。而家 `index.html` 只剩
markup／CSS／SVG，邏輯按功能拆去 `js/`。`index.html` 底部（`</body>` 前）用 13 個
**classic** `<script src>` **同步**載入，次序唔可以改：

| # | 檔案 | 內容 |
|---|---|---|
| 1 | `js/shared.js` | 常數（`SPREADSHEET_ID`／`SHEET_NAMES`／`SCHOOL_DOMAIN`…）、`sb`、guest／老師／Google 登入登出、`updateAuthUI`／`showApp`／`showLogin`、年級 form 幫手（`normalizeForm`／`formLabel`／`formOfEmail`／`assignStudentForm`…）、preview、`changeView`、`updateMascot`、`loadCloudRecords`、`parseCSV`／`answerVariants`／`primaryAnswer`／`quizNormalize`／`isAnswerCorrect`、`escapeHtml`／`timeAgo`／`hkDate`／`hkDayKey`／`deviceLabel`／`displayName`／`topicLabel`、`window.onload` |
| 2 | `js/dictation.js` | Dictation Master：topics／categories／`loadAllCategoriesFromSheet`（10 分鐘 session cache，過期用 stale-while-revalidate）、error book、word list、`startQuiz`／`checkAnswer`／`finishQuiz`／`openActivity`／`selectTopic` 同 quiz Enter 鍵 |
| 3 | `js/new-vocab.js` | 全部 `nv*`（New Vocab 字庫＋Cambridge 查字） |
| 4 | `js/grammar-quest.js` | `tenseData`／`structureData`、`renderTenseGrid`／`showTenseDetail`、conditionals 同 participle clauses quiz、grammar admin、`loadIfClauseData`／`loadPCData`、`saveGrammarToCloud` |
| 5 | `js/grammar/drive-and-go.js` | Drive & Go! 開賽流程（**第一步 Solo／Multiplayer**）：Solo → Topic（Tenses／Agreement）→ Challenge → Cat → Controls → 題數 → Course → 直接開賽（冇舊嘅最後 Game mode 步）；Multi → Create／Join → 房主揀 Topic／Challenge／題數／Course，加入者只揀 Cat／Controls 再入房碼。Tenses 題庫（Google Sheet 頁 `tenses`／`Passives`，AV／PV／Mixed）＋ Agreement 題庫（頁 `Agreement`，Gap-fill／Choose／Mixed）、同一動詞時態干擾項、Agreement 三閘、貓仔造型、Tilt／Swipe／按鈕、題數（20／25／30／35／40／50）、三個場（`SCENES`／`normalizeScene`）、單人／多人（2–5）選擇、道具解鎖規則、複合分同時間獎勳、`tiltLaneTarget`／`nearestLane`／`laneStep`、`displayPrompt`、`submitCloudRun`（Solo／Multi 榜） |
| 6 | `js/grammar/drive-and-go-race.js` | 全螢幕賽道（`#drive-and-go-view`）、HUD 句子／進度／用時、三條答案門、正確 Nitro +40 km/h、錯門 1.5s spin-out、按住加速（ACCEL／↑／W／Space，`ACCEL_KMH 110`／`SPEED_CAP 340`，唔會用蘑菇）、analog tilt、單人到 N 題正確完結、五種道具使用、三個場嘅天空／背景／景物／路面 |
| 7 | `js/grammar/drive-and-go-multiplayer.js` | 2–5 人房（短碼 lobby）；房主揀嘅 N 同**場**適用全房（`p_scene`）；每人 N 題正確先完，全部剩餘玩家完（或離開）先結束，最高複合分贏。要老師自行喺 live 專案貼 `supabase/drive_and_go.sql`（已有房間先貼 `supabase/drive_and_go_question_count.sql`，再貼 `supabase/drive_and_go_scenes_and_boards.sql`）；單人唔使 SQL；**唔好**用 plugin 跑 SQL |
| 8 | `js/leaderboard.js` | `setLeaderboardBlurb`／`loadLeaderboard`／`renderLeaderboard`／`renderWordJumpLeaderboard`／`renderDriveAndGoLeaderboard`（Solo／Multi 兩塊榜） |
| 9 | `js/admin.js` | 老師 dashboard：`loadAdminDashboard`／`renderAdminDashboard`、`loadLoginAdmin`／`renderLoginAdmin`、`loadGuestAdmin`／`renderGuestAdmin`、`loadDriveAndGoAdmin`／`renderDriveAndGoAdmin`（Drive & Go! Solo／Multi 榜放喺 Grammar Quest 卡入面） |
| 10 | `js/profile.js` | 「Me」個人頁（`#profile-view`）：`loadProfile`、`profileRenderStreak`／`profileRenderDict`／`profileRenderWj`；學校帳戶讀 `dictation_results`／`wj_leaderboard`，訪客同 preview 讀 session／local 記錄 |
| 11 | `js/word-battle.js` | Word Battle 1v1＋班際全部、`battleEnter`／polling、battle admin（`loadBattleAdmin`／`toggleBattleBreakdown`）、班際自訂貓＋Top 5 頒獎台、battle 輸入 listener |
| 12 | `js/word-jump.js` | `openWordJump`、`const WJ`、`const WJC`（Challenge）、tilt／鍵盤／touch listener、Word Jump admin、`pagehide` 離開 challenge |
| 13 | `js/pwa.js` | 註冊 `/sw.js`（只喺 HTTPS／localhost）；失敗會靜靜咁 `console.warn`，唔影響網站。必須係最後一個 script |

規則：
- **唔可以**用 ES module（`type="module"`／`import`／`export`），亦**唔可以**加 `defer`／`async`：
  HTML 嘅 `onclick="..."` 直接 call 呢啲 global。所有檔案共用同一個 global scope，
  所以跨檔呼叫（例如 `changeView` 叫 `battleEnter`／`nvEnter`／`WJ.stop`）照舊得，
  因為嗰啲只會喺載入完成後（user 互動／`window.onload`）才執行。
- 同一時間只可以有一個檔案宣告同一個名（`node --check` 唔會捉，重複 `const` 會令頁面白畫面）。
- `sb.auth.onAuthStateChange` 嘅登記包喺 `registerAuthListener()`，喺 `DOMContentLoaded` 才 call：
  Supabase 有機會喺第二個 `<script>` 未執行前就送第一個 auth event，咁就會 call 到未定義嘅
  feature function。改動呢段要保留呢個 defer 行為。
- `window.onload` 仍然喺 `js/shared.js`，負責 `loadAllCategoriesFromSheet()`／`loadIfClauseData()`／`loadPCData()`。
- 加新功能：開新 `js/xxx.js`，喺 `index.html` 底部按依賴次序加 tag（新檔通常擺 `word-jump.js` 之前），
  再喺上面個表加一行。
- 測試：`tests/wj-*.test.cjs` 直接讀 `js/word-jump.js`（以前讀 `index.html` 個 inline script）。

### Views（`changeView(viewId)` 切換，全部 `.view` 預設 hidden）
| view id | 內容 |
|---|---|
| `hub-view` | Grammar／Dictation 兩張入口卡 |
| `grammar-view` | Sentence Structures／Tenses 入口 |
| `sentence-structures-view` | 6 個句型（`showStructureDetail`） |
| `grammar-revision-view` | Tenses 2 卡：let's revise!／Drive & Go! |
| `grammar-tense-list-view` | Let's revise! 9 個時態格（`renderTenseGrid`，`showTenseDetail`） |
| `grammar-detail-view` | 文法詳情（`#grammar-detail-content` 動態填；時態詳情同 Drive & Go! 開賽選單都用呢個） |
| `drive-and-go-view` | Drive & Go! 全螢幕賽道（`#dg-canvas`、HUD、道具槽、ACCEL、LEFT／CENTER／RIGHT） |
| `home-view` | topic 格（Sheet 載入後填）＋ New Vocab ＋ Error Book |
| `sub-category-view` | Listening／Recitation／Revision；New Vocab 時加字庫管理同「今日／全部」 |
| `error-book-view` | 學生錯題簿 |
| `quiz-view` | 測驗主體（speaker 鈕／中文大字／input／hint／計分） |
| `word-list-view` | Revision 單字表（`showWordList`） |
| `battle-view` | Word Battle（1v1／班際）＋ Word Jump 入口卡 |
| `wordjump-view` | Word Jump 遊戲（`#wj-canvas`，見 §10） |
| `profile-view` | 「Me」個人頁：連勝／補救卡、Dictation 次數同平均正確率、Word Jump 最佳、首次練習日期（見 §12.6） |

### Grammar Quest tenses
- `grammar-revision-view` 只有 2 張卡：`let's revise!`（開 `grammar-tense-list-view`）同
  `Drive & Go!`（`showDriveAndGo()`）。9 個時態（`tenseData`，包括 `future perfect tense`）喺
  `grammar-tense-list-view` 嘅 `#tense-grid`，由 `renderTenseGrid()` 填，`showTenseDetail()` 返回呢頁。
- `Drive & Go!` 係 Mario Kart 式文法賽車：`showDriveAndGo()` 喺 `#grammar-detail-view`
  行開賽流程（揀 AV／PV／Mixed、貓仔造型、操控、題數 20／25／30／35／40／50、單人或多人），然後入 `#drive-and-go-view`
  比賽。Back 返 `grammar-revision-view`，並會 `recordGuestUsage('Grammar Quest', 'Drive & Go!')`。
- 題庫用現有 Google Sheet（`SPREADSHEET_ID`）gviz CSV：AV 讀頁名剛好係 `tenses`，PV 讀
  `Passives`（複數；唔好用錯 `passive`），Mixed 兩頁一齊洗牌。只由題庫出題，唔好發明題目。
  答案可接受 ` / ` 分隔嘅寫法，亦會把 typographic apostrophe 當普通 `'`。每題三條答案門
  （正確 + 兩個**同一動詞**嘅其他時態；AV 用主動、PV 用被動，Mixed 先留喺同一 voice。
  變位填唔滿兩個先先 fallback 同 section／同 sheet，最後先用 filler）。正確：Nitro +40 km/h、加分、combo、按規則派道具
  （香蕉／連對 6 題無敵星／落後先有紅龜殼／challenging 題雷電／連對 3 題蘑菇）。錯誤：
  1.5 秒 spin-out、減速、扣分、combo 斷，唔會計入 N 題正確。玩家可按住 ACCEL／↑／W／Space 加速（唔會消耗道具、亦唔會自動用蘑菇；旋轉時無效；有速度上限）。
- 單人唔再係 endless：答對 N 題就完。複合分 = 現有賽分 + 時間獎勳（越快越高：`round(4000 * N / max(elapsed, 1))`），
  個人最佳（複合分同時間）按題數（同 bank mode）存 localStorage；呢版**唔會** hook `saveGrammarToCloud`。
  多人要 2–5 個已登入玩家，短碼開房／入房；房主揀嘅 N 適用全房（lobby 會顯示），加入者改唔到。
  每人答對 N 題先完，全部剩餘玩家完（或離開）先結束房間；最高複合分贏（同分先比更快完成，再比正確率）。
  多人要老師喺 live Supabase 專案自行貼跑 `supabase/drive_and_go.sql`；若房間已經建過，再貼可重跑嘅
  `supabase/drive_and_go_question_count.sql`。**唔好**用 plugin 或 agent 對資料庫跑呢啲 SQL。單人唔使呢份 SQL。
  Guest 可以玩單人（同樣揀 N），唔可以開多人房。HUD 喺兩種模式都顯示 `12/20` 進度同已經用咗幾耐。
- 賽道係 deterministic pseudo-3D（OutRun 式）：`DG.project`／`DG.projectRel` 用 world Z（`player.dist`）
  計 `DG.trackCurve`／`DG.trackLateral`（左右彎）同 `DG.trackHill`（上落斜）；多人用 room seed，單人每次開局 random seed。
  `DG.drawTrack` 畫 curved segments，`DG.ensureScenery`／`DG.drawScenery` 放 world-Z 路邊景物（大廈／樹／燈柱／路牌／車）。
  答案門 `GATE_GAP = 420`、`START_GATE_DIST = 320`，下一個門最少喺 player 前面 300 units；唔好加返 `p.dist + 70`／`+ 100` fallback。

### Mascot
- `#mascot-text`（speech bubble）＋ SVG 貓；`updateMascot(text)` 改字，
  `changeView()` 內每個 view 預設一句。
- 改動慣例：加新 view 就喺 `changeView()` 加一句對應文案。

### State（記憶體，無持久化）
- `categories`（題庫）、`currentTopic`、`quizMode`（listening／recitation）、
  `quizWords`（每局隨機抽 15）、`quizIdx`、`quizScore`（每題 `max(1, 10-hintCount)`）、`hintCount`。
- 關鍵函數：`startQuiz` → `updateQuizUI` → `speakCurrentWord`（SpeechSynthesis）
  → `provideHint` → `checkAnswer`（Enter 鍵直 call）→ **`finishQuiz()`（成績唯一寫入 hook）**。

## 4. 資料流

```
Google Sheet（17 tabs）
  → gviz CSV → parseCSV() → categories（記憶體）
  → startQuiz 抽 15 題 → checkAnswer 計分 → finishQuiz 顯示總分（而家棄掉，無儲存）
文法（tenseData／structureData）→ 全部 hardcode 喺 script，無後端
```

## 5. 路線圖：Google 登入＋成績記錄（已拍板）

決策：**登入可選**（唔登入照玩，登入先上傳）＋**分兩階段**（先 localStorage，後 Supabase）＋
**限學校域名**（非學校帳戶自動登出）＋**成績唔擺 Sheet**（學生分數擺公開 Sheet 有私隱問題；
GAS＋Sheet 方案喺其他專案已退役：quota＋維護成本高）。

### Phase 1 — 本地成績（零後端，改 `js/dictation.js` 嘅 `finishQuiz()`）
- 喺 `finishQuiz()` 加：append `localStorage["dict_history"]`
  一筆 `{t, topic, mode, score, total}`。
- 完成畫面下加「最佳成績／歷來記錄」＋正確率（每題對錯要喺 `checkAnswer` 順手記低）。

### Phase 2 — 一次性開戶（擁有人喺網頁後台做，約 15 分鐘）
1. 開新 Supabase project → Auth → Providers 開 Google（自建 Google Cloud OAuth client，
   Authorized redirect＝`https://<ref>.supabase.co/auth/v1/callback`）。
2. Auth → URL Config 加 `https://tydictation.vercel.app`（連 preview domain）入 Redirect URLs。
3. SQL Editor 跑：
```sql
create table dictation_results(
  user_id uuid, email text, nickname text, topic text,
  mode text, score int, total int, correct int, created_at timestamptz default now());
alter table dictation_results enable row level security;
create policy "read all" on dictation_results for select using (true);
create policy "insert own" on dictation_results for insert with check (auth.uid() = user_id);
```
> 舊 project 如果未有 `correct` 欄，跑 `supabase/dictation_accuracy.sql`（可重跑）。舊 row 會留 NULL，Me 頁平均正確率只用之後新 quiz 嘅數據。

### Phase 3 — 登入＋學校域名閘（~40 行，inline）
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  const sb = window.supabase.createClient("https://<ref>.supabase.co", "<publishable anon key>");
  // anon key 係 publishable by design，RLS 先係真正防線
  function signInWithGoogle(){
    sb.auth.signInWithOAuth({ provider: "google",
      options: { redirectTo: window.location.origin,
        queryParams: { hd: "<學校域名，如 lstyoungkhl.edu.hk>" } } });
  }
  sb.auth.onAuthStateChange(async (_e, session) => {
    const email = session?.user?.email ?? "";
    if (session && !email.endsWith("@<學校域名>")) { await sb.auth.signOut(); updateMascot("請用學校帳戶登入。"); return; }
    // 更新 header 登入／登出掣＋顯示 nickname
  });
</script>
```

### Phase 4 — 雲端成績＋排行榜
- `finishQuiz()`：已登入就 `sb.from("dictation_results").insert({user_id, email, topic: currentTopic, mode: quizMode, score: quizScore, total: quizWords.length})`（fire-and-forget）。
- 加「我的記錄」view（撈自己 rows）＋可選「排行榜」view（按 email aggregate，同 PBA 做法）。
- 誠實聲明：只有身份可信，分數可偽造——課室激勵用可以，唔好當考試系統。

## 6. 改動指南（通則）

- 加新 view：HTML 加 `<div id="xxx-view" class="view hidden">` ＋ `changeView()` 加 mascot 文案。
- Quiz 回饋：全部經 `updateMascot()`；答對／錯分支喺 `checkAnswer()`。
- 新功能要存嘢：一律經 `finishQuiz()` 呢個 hook（本地＋雲端都係）。
- Auth init **唔可以**等 Sheet load（見 §7 已知問題）；Supabase script 放 `<head>` 或 body 頂，獨立 init。
- 如加 Supabase：Vercel domain 要入 Redirect URLs；如將來加 `vercel.json`／`_headers`，
  記得 `connect-src https://*.supabase.co`。
- 秘密守則：`client_secret*.json`、service role key 永遠唔入 repo；前端只用 publishable anon key。

## 7. 已知問題

1. `renderTenseGrid()` 要等 Sheet load 完先跑——斷網／quota 爆會連文法格都出唔到。修：拆開獨立呼叫。
2. ~~每次入頁 fetch 足 20 個 tabs，無快取。~~ **已修（2026-11）**：`loadAllCategoriesFromSheet()` 會用
   `sessionStorage['learniTY_sheet_cache_v1']` 存 10 分鐘 parsed words；cache 過期時
   會即刻用 stale words（stale-while-revalidate），背景 fetch，完成後靜靜更新；
   fetch 失敗才提示「Using saved words…」。仍然係每個 tab 各自一份 session cache；
   新 tab 第一次載入仍要等 Google Sheet。
3. 分數零持久化（Phase 1 解決）。
4. `Shopping` tab 大細楷同其他唔一致，改名要連 `SHEET_NAMES` 一齊改。

## 8. 驗收 checklist

- [ ] 唔登入：玩到＋localStorage 有記錄
- [ ] 學校 Google 帳戶：登入到＋完成 quiz 上傳一筆
- [ ] 非學校帳戶：被登出＋有提示
- [ ] 「我的記錄」撈到自己跨裝置成績
- [ ] Sheet 斷線：文法區照用到，登入照用到

---

## 9. Supabase 附加功能（2026-11 加）

兩個功能都要**先在 Supabase SQL Editor 跑一次 SQL**，唔會自動建表。SQL 檔已入 repo，
重跑安全（`create table if not exists`）。

### 9.1 學生登入紀錄 — `supabase/login_tracking.sql`
- 表：`student_logins`（每 user 一行：email、nickname、first/last_login_at、login_count、user_agent）
- RPC：`record_login(nickname, ua)`，前端喺 `onAuthStateChange` 每次 session 首次進入時 call。
  `login_count` 只在距上次登入 **>12 小時**才 +1，避免 F5／token refresh 造假數。
- RLS：**只有 ADMIN_EMAIL 讀得到**（`auth.jwt() ->> 'email'`）。
- Admin 卡片「🕒 Student Logins」→ `loadLoginAdmin()`：已追蹤人數、今日、7 日，
 相對時間＋hover 顯示香港時間＋裝置（由 UA 推斷，**冇 IP**）。
 **唔再**顯示「Has scores but no login record」名單，亦唔再顯示同一個數（舊「Never Logged In」格）。

### 9.2 Word Battle 1v1 — `supabase/battle.sql`
- 表：`battle_rooms`（code 4 位、topic、seed、status、host/guest）、
  `battle_players`（score/correct/total_ms/done）。
- RPC：`create_battle` / `join_battle` / `start_battle` / `rematch_battle` /
  `finish_battle` / `leave_battle`。
- **公平性機制**：雙方唔會收到題目，各自用 `room.seed` + `mulberry32` 對
  `categories` 做 seeded shuffle，得出**完全相同**嘅 10 題。改 `BATTLE_QUESTION_COUNT`
  或 seed 演算法要兩邊同步（同一個 file 所以冇問題）。
- 流程：create → 等 guest → host 按 Start → 20 秒一題 → 兩邊 done 後 `finish_battle`
  才轉 `finished`。中離：guest 走 → 房回 waiting；host 走 → 房刪除（**只限未開始**）。
- 同步方式：**1.5 秒輪詢**（`battlePoll`），冇用 Realtime，唔使開 dashboard 設定。
- Admin 卡片「⚔️ Battles」→ `loadBattleAdmin()`，睇最近 24 小時房間同即時比數。
 **未成功連線嘅房唔顯示**：1v1 未有 guest（而且未開始）會被 `battleRoomPaired()` 濾走；
 class 房要至少有一個學生先出現。已開始／已完結、或者 1v1 兩個位都坐滿嘅房照出。
- 房間列表預設只顯示最新 5 間，底下有「展開 Show all (N)」掣；撳開之後改為「收起 Collapse」。
  5 間或以下唔出掣。展開狀態喺今次瀏覽記住（Refresh／重新 render 唔會重置）。
  呢個係整條房間列表嘅長短開關，唔係按年級分組（房間可以跨級）。Word Jump Challenge
  對戰紀錄唔喺 Admin Dashboard，仍然喺 Word Jump／Hub 嗰度睇。
- 誠實聲明：分數由 client 寫入，可以造假；房間、代碼、加入資格係 server 端 RLS／RPC 管。
- 舊房保留 **7 日**（`create_battle` 時順手清走更舊嘅）。

### 9.3 班際模式 — `supabase/battle_class.sql`（要喺 9.2 之後跑）
- 加欄：`battle_rooms.mode`（`duel`／`class`）、`max_players`、`finished_at`。
- 新 RPC：`create_class_battle(topic, seed, max_players)`（**只限 ADMIN_EMAIL**）、
  `end_class_battle(room_id)`（老師提早收卷）。前端 `battleCreateClassRoom()`
  而家傳 `p_max_players: 30`，所以新開老師班際房最多 **30 人**；舊房
  `max_players = 60` 照顯示 60，唔會強制改細。
- 老師唔係玩家：開房時**唔會**插 `battle_players`，所以老師只做主持／睇直播分數。
- 學生用同一個代碼 join，全部人同一 seed → 同一批 10 題；老師按 Start 才開始。
- `is_battle_member()` 已更新：class 學生靠 `battle_players` 嗰行做 membership，
  否則佢哋讀唔到自己間房、亦寫唔到分（**呢個係 RLS 陷阱**）。
- **歷史修正**：舊版 `leave_battle()` 一離開就 delete 房 → Admin 永遠見唔到紀錄。
  新版：未開始先 delete；已開始／已完結嘅房**保留**，所以 dashboard 有數睇。

### 9.4 老師睇住同學玩 — `supabase/battle_live.sql`（要喺 9.3 之後跑）
- 加欄：`battle_players.progress`（0-based 第幾題）、`last_answer`、`last_correct`、
  `updated_at`（trigger 用 **server 時間**，唔靠學生部機嘅鐘）。
- 學生每答一題（同每次轉題）都會上報，所以老師張計分板係逐題更新：
  `Q3` 進度條、`✅/❌ + 打咗乜`、`idle 30s`（>25 秒冇動靜會變紅框）。
- 老師畫面頂部有分佈：`Q1: 5 · Q2: 7 · …` 同幾多人已完成。
- 老師 hover 個 `Q3` 徽章會見到該題中文（由 seed 即時算，唔使存題目）。
- 如果未跑 9.4，前端會自動 fallback（唔會壞），只係冇進度／閒置資訊。

### 9.5 每題正確率 — `supabase/battle_stats.sql`（要喺 9.4 之後跑）
- 表：`battle_answers(room_id, user_id, q_index, word, answer, correct, ms)`，
  `unique(room_id,user_id,q_index)` + client `upsert`，所以重試都唔會重複計。
- RLS：學生只可以寫／讀**自己**嗰啲；老師（ADMIN_EMAIL）讀全部。
- 完場後老師張 class 板會自動出「📊 Question breakdown」：按正確率**由低到高**排，
  顯示每題英文／中文、正確率 bar、`對/總數`、最常見嘅錯誤拼法（最多 3 個）。
- Admin Dashboard 每個房間有「📊 breakdown」掣，可以事後逐間房睇（唔使開住課室）。
- 三個 SQL 要順序跑：`battle.sql` → `battle_class.sql` → `battle_live.sql` → `battle_stats.sql`。
- 未跑 9.5 都唔會壞：前端偵測到表唔存在就自動停寫，畫面顯示提示。

### 9.6 題目數量 10 / 15 / 20 — `supabase/battle_question_count.sql`
- `create_battle` 同 `create_class_battle` 加 `p_question_count`（DB 夾在 5–30，
  前端只出 10/15/20）。
- 前端 lobby 有 `#battle-count-select`，用 `localStorage["battle_qcount"]` 記住選擇；
  1v1 同 class room 共用同一個設定。
- `battleBuildQuestions()` 改讀 `room.question_count`（以前 hardcode 10），
  所以同一間房兩個／全班學生仍然係**同一批、同一數量、同一次序**。
- 舊嘅 2 參數 `create_battle` / 3 參數 `create_class_battle` 已 `drop`，
  避免 PostgREST 分唔清 overload；學生舊 tab 要 refresh 一次。

### 9.6a 不小心彈出後重回 — `supabase/battle_rejoin.sql`（要喺 9.6 之後跑）
- 以前「← Back to Hub」會即刻 `leave_battle`：未開始就退出／刪房，已開始嘅 1v1
  會直接完場，班際會把該學生標成 `done`，之後再用代碼加入會收到 `ROOM_ALREADY_STARTED`。
- 而家頂部 **Back to Hub** 只係離開畫面，**唔會**退出房間；進度寫入
  `localStorage["learniTY_battle_resume"]`（跟 user id，7 日過期）。
  Hub 嘅 Word Battle 卡同 lobby 會出 **🔄 Rejoin** 掣，撳完由上次嘅題目繼續（計時重新 20 秒）。
  重新整理或者關咗分頁都得。
- 真係要退出先用等候室／老師 waiting 畫面嘅 **Leave room**／**Close room**（會確認），
  或者完場畫面嘅 Back to Hub。
- Lobby 另有 **⏩ Join mid-game**：遲到嘅學生用同一個 4 位代碼，可以加入已經開始、
  但未完場嘅房（班際最常用；1v1 只喺對手位仍然空先得）。新加入由第 1 題開始。
  老師班際進行中畫面會提示 "Late students can still join with this code"。
- SQL：更新 `join_battle`，已經係成員／主持就可以再用代碼入返進行中或完場嘅房；
  若只係早走被標成 `done`、但 `progress` 未做完，會清走 `done`。未入過房嘅學生
  喺 `waiting` 或 `playing` 都可以加入（房滿或已 `finished` 除外）。另加
  `rejoin_battle(p_room_id, p_code)`。函數 body 用 `$join$` / `$rejoin$` 分隔，
  避免 SQL editor 把 `if` 當成普通 SQL（舊版 `$$` 可能報 `syntax error at or near "if"`）。
  未跑呢份 SQL 都唔會壞：只要學生只係返咗 Hub（冇撳 Leave room），前端可以直接讀返房間。
  如果之前已經 `leave_battle` 咗，或者要中途新加入，就要跑最新呢份 SQL。可重複跑。

### 9.6b 加字時唔好被彈返 Hub
- `showApp()` 只喺由登入畫面第一次進入 app 先 `changeView('hub-view')`。
  token refresh 或者重複嘅 `SIGNED_IN` 唔會再把老師／學生從 New Vocab 或其他版面彈走。

### 9.6c 老師 Preview student account（F3 / F4 / F6）
- 老師 Hub 同 Admin Dashboard 有 **Preview student account**：揀 F3／F4／F6 就以該年級學生身分睇網站，唔使登出或開真實學生帳戶。
- `isTeacherAccount()` 認老師 email；`isAdmin()` 喺預覽期間係 false，所以老師工具（New Vocab 編輯器、Admin Dashboard、開班際房、年級下拉）會收埋。
- 預覽期間 `ownDisplayedForm()`／`resolveOwnForm()` 直接回傳揀咗嘅年級，當已分班學生（只睇嗰個年級 New Vocab），唔會呼叫 `my_form`／`claimSavedForm`，亦唔會改老師 email 嘅 `student_forms`。
- 頂部橫幅顯示 "You are previewing the F3 student account."，撳 **Exit preview** 返老師帳戶。登出會清預覽。刷新分頁會用 `sessionStorage["learniTY_preview_form"]` 還原。
- 預覽期間唔寫雲端成績：`dictation_results`、`wj_scores`、`error_book` upsert／delete、Grammar Quest scores。練習可以照做，分數只留喺呢次預覽（sessionStorage）。預覽中亦開唔到 Admin Dashboard。

### 9.6b Drive & Go! 題數同完局規則 — `supabase/drive_and_go_question_count.sql`

- 新安裝貼完整嘅 `supabase/drive_and_go.sql` 即可（已包含 `question_count` 同 N 題正確完局）。
- 若老師已經跑過舊版 `drive_and_go.sql`，喺 live 專案 SQL Editor 再貼可重跑嘅
  `supabase/drive_and_go_question_count.sql`。**唔好**用 Supabase plugin 或 agent 跑呢啲 SQL，
  只可以老師自己喺 [SQL editor](https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new) 貼。
- 單人唔使呢份 SQL。

### 9.7 年級（Form）— `supabase/student_forms.sql`（要喺 login tracking 之後跑）

年級**唔再**喺登入時叫學生揀。舊版只係把 `localStorage["student_form_level"]`
（`F.4` / `F.6`）留喺學生自己部機，**冇**寫入 Supabase，所以老師畫面之前分唔到年級。

- **單一清單**：`FORM_LEVELS`（而家 `F3`、`F4`、`F6`）。加新年級只改呢個陣列，
  `id` 用 `F` + 年份（例如 `F5`）。老師下拉、顯示名稱解析、畫面分組、同舊 localStorage 遷移都讀呢度。
- 欄：`student_logins.form`（text，null = Unassigned）同 `form_source`
  （`teacher` = 老師下拉，`auto` = 由顯示名稱班別代號自動寫入，null = Unassigned）。
  畫面會再按**顯示登入名稱**入面開頭嘅班別代號推斷。`form_source` 喺
  `supabase/student_forms_source.sql`（或更新咗嘅 `student_forms.sql`）先有；未跑之前網站唔會壞。
- 每個學生嘅年級，老師呢次改嘅下拉永遠優先（`form_source = teacher` 嘅已存 `form`）。
  否則**只由顯示登入名稱**推斷（登入時 Google `user_metadata.full_name`，寫入
  `student_logins.nickname`，老師名單行上面嘅 `nickname`）。規則
  （`parseDisplayNameFormClass`／`formFromClassCodeAtStart`）：
  - **唔會**用電郵 local-part 估年級。學校 Google 登入好似 `s231014@lstyoungkhl.edu.hk`，
    前面嗰個 `23` 係學號／入學年份，唔係級別。
  - 只會喺顯示名稱**開頭**清楚提供班別代號時先分到 F3／F4／F6，例如 `4C 16 Lai Ka Lok 黎嘉樂`、
    `3A 08 Chan Tai Man`、`6D 21 Wong`，或者 `Form 4C …`。代號係 3／4／6 緊接一個班別字母
    （字母後面係結尾、空白、數字、或者分隔符）。上面第一個例子：電郵係 `s231014@…`，
    顯示名稱係 `4C 16 Lai Ka Lok 黎嘉樂` → F4，班別徽章 `4C`。
  - 名稱入面後面先出現嘅 3／4／6（學號、年份、或者姓名中間一個數字）**唔算**班別。
    例如 `Liu Chun Ming` 冇班別數字，必須歸入 Unassigned，就算舊自動分類曾經把佢寫成 F6。
  - 冇顯示名稱（或者名稱只係電郵／`s231014` 呢類 local-part 後備），又或者開頭冇班別代號，
    就歸入 Unassigned。
  - 老師畫面用每行嘅 `nickname`；如果嗰行冇可用顯示名稱，再由 `student_logins` 目錄補。
    已存嘅自動／不明 `form` 喺顯示名稱冇班別代號時會被畫面忽略，所以 `Liu Chun Ming`
    會即刻出現喺 Unassigned。老師下拉仍然會即時生效並寫入 `form_source = teacher`。
    學生登入時，有班別代號先會 `claim_own_form` 寫入（`form_source = auto`）；
    冇班別代號會叫 RPC 清走舊自動分類，**唔會**覆蓋老師已改嘅值，亦**唔會**用電郵或
    舊 localStorage 估年級。
- RPC：
  - `claim_own_form(p_form)` — 學生登入時，用顯示名稱開頭嘅班別代號寫入（`form_source = auto`），
    或者用空字串清走舊自動分類。**唔會**覆蓋老師已改嘅值（`form_source = teacher`），
    亦唔會用電郵或舊 localStorage 估。管理員帳戶唔會 claim。
  - `set_student_form(p_email, p_form)` — 只限 `ADMIN_EMAIL`。每個老師畫面嘅學生行有下拉可以改或補正；
    揀「—」就變回 Unassigned（並清走 `form_source`）。下次重新載入時，如果顯示名稱仍然
    有班別代號，畫面會再按代號歸類。
- 老師畫面**唔再用** All / F3 / F4 / F6 / Unassigned 篩選掣，亦唔再讀 `localStorage["teacher_form_filter"]`。
  改為同一頁自動按每個學生顯示名稱入面嘅班別代號分成 F3、F4、F6、Unassigned 幾個部分：
  Admin usage、Grammar Quest、Student Logins、Battles（連 class 直播板同 question breakdown；
  房間列表入面亦會按年級標示／分組學生）、Word Jump admin 排名，同埋老師先見到嘅 Hub Leaderboard。
  老師 dashboard 入面嘅學生名單（Student Activity、Grammar Quest、Student Logins、
  Word Jump admin）每個級別標題旁邊有 **(+)** 展開同 **(-)** 暫時收起掣，預設全部收起，
  可以逐級獨立開關，避免一版過列出所有級別學生。Unassigned 同樣有呢對掣。開關狀態
  喺今次瀏覽記住（重新 render／Refresh 唔會重置），唔係舊嘅 All／F3／F4／F6 篩選掣。
  學生自己嗰個 Leaderboard、Hub Leaderboard，同 Word Battle 課堂直播板**唔會**出現呢對掣。
  學生自己嗰個 Leaderboard 同其他學生介面**唔會**出現呢種分組。
  New Vocab／Word Battle 揀邊個年級字庫嘅掣仍然保留，因為嗰啲係題目庫選擇，唔係學生名單篩選。
- 未跑 SQL 唔會壞登入：Admin 頂部提示要跑 `student_forms.sql`。下拉暫時存唔到，
  但有顯示名稱嘅學生仍然會按班別代號歸類。

### 9.8 訪客登入（密碼 `0203`）

學校 Google 登入保持不變。登入頁另外有 **Guest login**：每次新分頁／新瀏覽器 session 要輸入密碼 `0203` 先入到網站。正確之後用 `sessionStorage` 記住呢次分頁，刷新同一分頁唔使再輸入；關咗分頁或撳 Logout 就要再輸入。**唔會**用 Google 帳戶，亦唔會寫入 `student_logins`、成績表、Word Jump／Word Battle 排行榜。

訪客可以睇同用 **Dictation Master 入面全部內容**：Google Sheet 各個 topic、New Vocab（當 Unassigned，可睇全部年級新增生字）、Listening／Recitation／Revision，同埋呢次 session 嘅 Error Book。亦可以玩 Word Jump 練習（Hub 有獨立入口，Word Battle 頁頂部都有）。Grammar Quest 照用。Word Battle 房間（開房／加入）要學校 Google 帳戶；訪客喺 Word Battle 頁只可以撳入 Word Jump。

訪客**唔可以**睇任何排行榜／其他人成績：Hub 嘅 Leaderboard、My Records、老師 dashboard 入口會隱藏，`changeView` 亦會擋住 `leaderboard-view`、`admin-view`、`my-records-view`。Word Jump game-over 唔顯示 Top 7，亦唔畫同學高度線、唔上傳分數。呢個密碼寫喺前端靜態檔，睇到網頁原始碼就睇到；只係課堂用嘅簡易閘，唔係真正帳號系統。

#### 訪客追蹤（`supabase/guest_tracking.sql`，2026-11 加）

要喺 SQL Editor 跑一次，唔會自動建表；重跑安全。**只係**畀老師喺 Admin Dashboard 睇訪客用量，訪客本身照舊唔會出現喺 `student_logins`、成績表或者任何排行榜。

- 表 `guest_logins`（每次成功輸入密碼一行：`logged_in_at`、`user_agent`、`session_key`）。
  所以「login 次數」＝輸入密碼嘅次數（唔似學生 `login_count` 有 12 小時去重）。
  刷新分頁（sessionStorage restore）**唔算**一次登入。
- 表 `guest_usage`（`session_key`、`feature`、`detail`、`created_at`）：訪客開始有意義嘅活動就記一筆，
  fire-and-forget。Frontend `recordGuestUsage()` 已蓋 Word Jump（detail＝topic）、
  Dictation: Listening／Recitation（detail＝topic 或 Error Book）、Dictation: Revision、
  New Vocab、Error Book、Grammar Quest（detail＝Conditionals／Participle Clauses）。
- `session_key` 係瀏覽器喺成功輸入密碼時生成嘅隨機 id，存 `sessionStorage`
  （`learniTY_guest_session_key`），用嚟將 usage 掛返嗰次 login。Logout 會清走。
- RLS：兩張表都只可以 `ADMIN_EMAIL`（`auth.jwt() ->> 'email'`）SELECT；anon／學生讀唔到。
  寫入只經 security definer RPC `record_guest_login(p_session_key, p_user_agent)` 同
  `record_guest_usage(p_session_key, p_feature, p_detail)`（會截長度、空 key／feature 直接 return），
  已 `revoke` anon／public 對表嘅直接 insert/update/delete。
- **只保留 rolling 24 小時**（`now() - interval '24 hours'`，唔係香港 calendar day）。
  `prune_guest_records()`（security definer，anon＋authenticated 可 execute）會 delete 兩張表
  過期 rows；`record_guest_login`／`record_guest_usage` 每次寫入前都會 `perform` 佢，
  `loadGuestAdmin()` 載入／Refresh 時亦會 `sb.rpc('prune_guest_records')`（失敗只 warn，
  舊安裝冇呢個 function 都照載入）。前端用同一個 cutoff：`GUEST_RETENTION_MS`／
  `guestRetentionCutoffMs()`／`guestCutoffIso()`／`isWithinGuestLogWindow()`／
  `filterGuestRecords()`（`js/shared.js`），`loadGuestAdmin()` 再 `.gte()` 落 query，
  `renderGuestAdmin()` 渲染前再過濾一次。舊安裝只需貼 `supabase/guest_tracking_prune.sql`；
  新安裝貼更新咗嘅 `guest_tracking.sql` 已經有齊。
- Admin Dashboard 新卡「🕵️ Guest logins」→ `loadGuestAdmin()`：只計 24 小時窗口
  （`Guest Logins (24h)`、`Today (HK)` 子數、`Browsing Records (24h)`），下面係 24 小時內
  usage（feature、detail、相對時間、hover 顯示 HK 時間）。**冇**再顯示總數／Last 7 Days。
  張卡改用 F3／F4／F6 同一套 +/- 摺疊掣（`adminFormToggleButtons`＋`adminFormOpen`，
  scope `guest-admin`、group `all`），**預設收起**，heading／描述／Refresh／+/- 保持可見，
  stats 同 usage list 收喺 `#guest-admin-body.admin-form-body` 入面；展開狀態喺 Refresh 之間保留。
  未跑 SQL 嘅話張卡會顯示提示，唔會整壞 dashboard 其他部分。
- 訪客資料**唔會**出現喺學生排行榜、My Records、Word Jump Top 7 或者 `student_logins` 年級分組；
  訪客亦開唔到 admin view（`GUEST_BLOCKED_VIEWS`＋`isAdmin()`）。

### 9.9 Drive & Go! 課程＋Solo／Multi 排行榜（2026-11 加）

- 開賽前流程第一步一定係 **Solo／Multiplayer**（`DG.showSessionStep()`、`DG.flowOrder()`）。
  Solo：1 Solo/Multi → 2 Topic（Tenses／Agreement）→ 3 Challenge → 4 Cat → 5 Controls
  → 6 How many questions? → 7 Choose a course →「Start race」直接開賽，**冇**舊嘅最後 Game mode 步。
  Multiplayer：揀 Create／Join 之後，**房主**先至揀 Topic／Challenge／題數／Course，最後個掣係
  「Create room」先 call `create_drive_and_go_room`；加入者只揀 Cat／Controls，
  再入 4 位房碼，Topic／Challenge／題數／Course 全部跟房主（`canEditHostSettings()` 會擋
  `setTopic` / `setBankMode`）。加入者**冇** Topic step。
  `stepDots` 按 `flowOrder()` 長度畫（Solo 7 點、房主 8 點、加入者 5 點）。Course 有三個，**名唔可以改**：
  `desert`＝Desert Hills、`stadium`＝Peach Stadium、`jungle`＝Dino Dino Jungle。
  `DG.SCENES`／`DG.SCENE_LABEL`／`DG.normalizeScene`（unknown → `desert`）＋
  `learniTY_dg_settings.scene` 記住上次選擇。三個場共用同一條曲路／山丘／投影／閘距，
  只換天空、背景、路邊景物同路面／路肩顏色；`DG.sceneStyle()` 喺 `drive-and-go-race.js`。
- **Topic（2026-11）**：`DG.TOPICS`＝`tenses`／`agreement`，預設 `tenses`，存
  `learniTY_dg_settings.topic`。Tenses 嘅 Challenge 照舊 AV／PV／Mixed，讀 Google Sheet
  頁 `tenses`／`Passives`（`DG.TAB_FOR_MODE` 不變）。Agreement 嘅 Challenge 係
  Gap-fill／Choose／Mixed，**只**讀頁名剛好係 `Agreement` 嘅 tab（大細楷敏感；錯名會
  silent 讀到第一個 tab Charity）。Gap-fill／Choose 由題目開頭 `N. Gap-fill:` /
  `N. Choose:` 分辨（`parseQuestionType`），Agreement tab 冇呢個 prefix 嘅編號行會 skip；
  Tenses／Passives parser 行為不變。Mixed 只係同一 tab 兩類一齊洗牌。
  `tabsFor(topic, mode)`、`normalizeTopic`、`normalizeBankMode(topic, mode)`、
  `topicLabel` / `modeLabel` / `modeShort` / `topicChallenge`（例：`Tenses · PV`、
  `Agreement · Gap-fill`）都係 pure helper。Cache key 用 `bankKey(topic, mode)`
  （`tenses:mixed` vs `agreement:mixed`），Agreement tab 只 fetch 一次再 filter。
  轉 topic 時如果 `bankMode` 唔屬於新 topic，會 reset（tenses → `av`、agreement → `gapfill`）。
- 三個答案閘：Tenses 照舊 `buildGates` / `distractSameVerb`（同動詞時態）。Agreement 用
  `agreementGates`：Gap-fill 正確形 + 兩個同動詞 agreement／tense 近親（leave／leaves／left）；
  Choose 由句尾括號讀選項，兩個選項加**一個**額外干擾項，三個選項就原用三個唔加第四個。
  答案有 ` / ` alternatives 時，任何列出嘅寫法都算正確（可能多過一個閘係綠色），
  而且列出嘅寫法**永遠唔會**放喺錯閘。HUD 用 `DG.displayPrompt(q, gates)`：Tenses 原句不變；
  Agreement 剝走 `N. Gap-fill:` / `N. Choose:`，Choose 嘅選項如果已經喺閘上就由句子剝走。
- Multiplayer 由**房主**揀場，全房共用；lobby 標題顯示 topic · challenge · N · course，加入者改唔到。
  `mpCreate()` 會傳 `p_scene`，Agreement 房另外傳 `p_topic`（Tenses 房**唔傳**，等未貼新 SQL
  之前仍然 call 到舊 7-arg function）。
- 排行榜：Hub Leaderboard 多兩個 tab「Drive & Go! Solo」「Drive & Go! Multi」，兩份**唔會撈埋**。
  老師 dashboard 都將兩塊榜放喺 **Grammar Quest 卡**最下面（`loadDriveAndGoAdmin()`），
  同 Student Activity 一樣按年級分組，顯示複合分／時間／正確率／題數／`Tenses · PV` 或
  `Agreement · Gap-fill`／場名。冇 `topic` 欄（舊 view 未貼新 SQL）一律當 Tenses。
  各自一張表＋一個 personal-best view（`drive_and_go_solo_scores`／`drive_and_go_multi_scores`、
  `drive_and_go_solo_leaderboard`／`drive_and_go_multi_leaderboard`），**每人每個 topic 一行**
  （同一學生可以 Tenses 一次、Agreement 一次），按 composite 排，同分比更快 `elapsed_ms`、
  再比 accuracy、再比較早 `created_at`。學生睇 top 10；老師按年級分組（同 Word Jump）。
  完成 Single Player（N 題正確）或多人房間出結果時，已登入非訪客會 fire-and-forget 寫自己嗰行；
  Agreement 行會帶 `topic: 'agreement'`，Tenses 行**唔傳** `topic`（未貼新 SQL 都 insert 到）。
  失敗唔會阻結果畫面，只會 toast 提示跑 SQL。單機本身**唔需要** SQL。
- **轉線（steering）**：`DG.laneStep(state, dt, tiltTarget)` 係唯一更新 lane 嘅地方。
  `tiltTarget == null` 係按鈕／鍵盤／swipe 模式，`lane` 保持玩家揀嘅目標，
  **唔可以**再用 `p.lane = DG.nearestLane(p.laneX)` 覆寫（PR #26 就係咁令所有離散轉線
  每幀被拉返中間，手機同電腦都轉唔到）。Tilt 模式先會由 `laneX` 反推 `lane` 用嚟判閘。
- **Tilt 係 analog**：`DG.tiltLaneTarget(delta)` 將 ±12° 連續映射去 0–2 lane（±1.5° 死區），
  大約 7° 正常手腕傾斜就會過到隔籬線（舊版 16° 太鈍，好似唔郁）。
  每幀 lerp `p.laneX`（`DG.TILT_LERP = 18`），唔再係「過 9° 先 steer 一次」。
  `DG.nearestLane(laneX)` 用嚟喺閘口／道具／多人同步對齊實際位置；按鈕／swipe／方向鍵
  仍然係 discrete，而且會短暫壓過 tilt（`S.tilt.manualUntil`）做後備。
- **ACCEL**：`DG.ACCEL_KMH = 110`、`DG.SPEED_CAP = 340`；按住 ACCEL 時速度 lerp 用 8，
  唔按就用 2.3。唔會消耗／自動用蘑菇，Enter 仍然用道具。
- **打橫玩（landscape，2026-11）**：`#drive-and-go-view.dg-live` 本身已經係 `position:fixed`
  ＋`100vw×100dvh`，所以橫向只需要純 CSS media query
  `@media (orientation: landscape) and (max-height: 560px)`（喺 `index.html` CSS，
  `.dg-lobby-avatar` 之後），**冇**加 JS class、亦唔會改動 view 結構。內容：
  - HUD 由 154px 壓到 **61px**（844×390）：`.dg-q-label` 隱藏、`.dg-question-card`
    變 `display:flex` **單行**（句子左、三個 lane chips 右，chips 唔會 ellipsis），
    `#dg-stats` 一行細 chips。長句兩行時 HUD ~76px。
  - `.dg-toast` 由 `top:74px` 改為 `bottom: calc(66px + safe-area)`，即喺 steering 按鈕
    之上、已解閘區域，唔會再壓住問題卡／下一個閘。
  - `.dg-item-btn`／`#dg-accel-btn` 82→68px，pause 50→44px，`.dg-controls` 68→54px，
    `#dg-mp-progress` 縮到 240px 闊＋細字（5 人時 218px 高，controls 337 起，冇重疊）。
  - kart 由 `h - 138` 改為 `h - 88`、scale 乘 `0.86`（見下）；rivals 用同一比例 ×`0.857`。
  - 結果／暫停面板：`.dg-panel` `max-width:700px`、padding 12px、result grid 4 欄、
    standings 2 欄、字級／Tailwind margin 縮細、早完賽 waiting 名單隱藏 metres。
    實測 844×390：solo 253px、多人大榜（5 人）358px、早完賽 355px，全部喺 353–374px
    可視高度內**免捲動**；暫停 238px。
  - 平板（1024×768、768×1024）同直向手機**唔會**套用（`max-height:560px` 擋住），
    數字同改動前完全一樣（hud 139／130、kart scale 1.229／1.638／1.016、`h-138`）。
  - JS 幫手（`js/grammar/drive-and-go-race.js`，`DG.drawRace` 之前）：
    `DG.sideways()`＝`v.h < 560 && v.w > v.h`；`DG.kartScale()`＝
    `min(w/430, h/700) × (sideways ? 0.86 : 1.12)`；`DG.playerKartY()`＝
    `sideways ? h - 88 : h - 138`。`DG.drawRace` 同 `DG.drawRival` 都改讀呢三個，
    唔好再喺裡面寫死 `h - 138`／`1.12`／`0.96`。
  - Controls 步驟（`showControlsStep()`）加咗一句英文提示
    「📱 Turn your phone sideways for a wider track. Tap ⛶ during the race for full screen — on iPhone, add this page to your Home Screen to hide the browser bar.」
  - 中置（CENTER） lane 閘喺橫向會被 kart 遮住最後約 1.2 秒，但 HUD chips 已經列出
    LEFT／CENTER／RIGHT 答案，所以冇再改 kart 位置。
- **Full screen（2026-11）**：橫向時瀏覽器 URL／link bar 會食位，所以 race HUD 嘅
  stats row 加咗 `#dg-fs-btn`（⛶／✕），暫停選單亦有 `#dg-pause-fs`（跟狀態轉字），
  鍵盤 `f`／`F` 亦可 toggle。`DG.enterRaceFullscreen()` 先試
  `#drive-and-go-view.requestFullscreen({ navigationUI: 'hide' })`（Chrome／Edge／
  Android／桌面 Safari）；如果 browser 冇 `requestFullscreen`、promise reject、
  或者 700ms 內都未見到 `fullscreenElement`（iPhone Safari 會靜靜咁唔 settle），
  就 fallback 落 `DG.enterCssFullscreen()`：`body.dg-fs`（`position:fixed; inset:0;
  overflow:hidden; overscroll-behavior:none; touch-action:none`）令 race view
  （`z-index:9999`）霸滿可用空間。CSS 仲有 `#drive-and-go-view:fullscreen` 同
  `:-webkit-full-screen` 設 `100vw×100dvh`。
  - iPhone Safari 冇 element fullscreen，瀏覽器 bar 永遠唔會消失；fallback 會 toast
    「On iPhone, add this page to your Home Screen to hide the browser bar.」
    其他唔支援嘅 browser 就 toast「Full screen is not available in this browser.」。
  - `fullscreenchange`／`webkitfullscreenchange` → `DG.onRaceFsChange()` 更新掣字
    （⛶ ↔ ✕）、`#dg-pause-fs` 同 resize canvas（`DG.scheduleRaceResize()` 會即刻
    resize 再 260ms 後 resize 一次，等新 viewport settle）。
  - 離開賽道（`DG.exitRace()`、`DG.backToTenses()`、`changeView` 嘅 `DG.onLeaveView()`）
    會 `DG.exitRaceFullscreen()`，所以唔會困住喺 full screen；`DG.stopRace()`
    （Race again／多人完賽）**唔會**退出，full screen 會保留。
  - 全屏時 canvas 仍然係 `100vw×100dvh`；橫向 CSS 照樣套用，HUD 61px 不變
    （844×390 實測 hud 61、qcard 4–39、stats 42–61）。冇加 manifest／
    `apple-mobile-web-app-capable`。
- **SQL（Agreement）**：已有 Drive & Go! 嘅老師只需要喺 live project
  `mggnwzirjmibreimrwiq` 嘅 SQL editor 貼
  `supabase/drive_and_go_agreement_topic.sql`（可重複跑）。**唔好**為呢個改動再貼
  `drive_and_go.sql`／`drive_and_go_question_count.sql`／`drive_and_go_scenes_and_boards.sql`
  或 `guest_tracking_prune.sql`。全新安裝就貼更新咗嘅 `supabase/drive_and_go.sql`
  （已包含 topic、Gap-fill／Choose 同兩塊 per-topic 榜）。**唔好**用 plugin／CLI 跑 SQL。
  未貼之前：Solo Tenses、Tenses 多人、Tenses dashboard 照用；Agreement Solo（本機賽道＋結果）
  照用，只係 Agreement 雲端分同 Agreement 房未寫得入；失敗會提示貼新檔。
- **加入者唔會被彈走（2026-11）**：`mpPoll` 只會交一個 `DG.mpRoomUpdatePlan()`
  （`navigate` 永遠係 `false`），lobby／開賽／結果／房間關閉全部喺原本個 view 內處理，
  **唔會** call `changeView`、`backToTenses` 或 `showSessionStep`。剛加入嘅玩家有
  `MP.joinedAt` 12 秒 settle window：期間被動 view 改變只會 `DG.mpDetachDuringSettle()`
  （保留座位、停 poll），唔會 call `leave_drive_and_go_room` 刪走自己嗰行；
  如果真係離開，window 完結先 release。`mpPoll` 連續 3 次讀唔到自己會用同一個房碼
  `DG.mpRejoinRoom()` 自動入返，唔會再跌落 Create／Join 或 Hub。房真的冇咗就喺
  原本畫面顯示 `DG.mpShowRoomClosed()`（race 中就用 overlay），唔會導航去首頁。
  返回 Drive & Go 時 `DG.mpResumeRoom()` 會接返住個 lobby。
- **完賽一定有結果畫面，唔會自動彈走（2026-11）**：solo／multi 都係一到 N 題正確
  （N = 自己揀或房主揀嘅 20／25／30／35／40／50，**唔可以**寫死 20）就即刻出結果，
  唔會 call `changeView`／`backToTenses`／`showSessionStep`／`showMultiplayerMenu`，
  亦唔會自己離開房間。共通數字格係 `DG.resultGridHTML()`：composite、race score、
  time bonus、時間、正確率、`correct / N`（solo 另加 wrong／max combo）。
  - Solo：`DG.finishPlayer()` 直接 `DG.showSoloResults()`（唔再等 0.85 秒後嘅
    `DG.endRun()`，`endRun` 只留返做「End run」）。掣：Race again／Back to Tenses。
  - Multi：早完成嘅玩家睇 `DG.showMpOwnResults()`（`S.ownResultShown`），賽道同
    room poll **繼續行**，面板入面 `#dg-results-progress` 會跟 `DG.updateMpProgress()`
    顯示仲未完賽嘅人。全房完賽時 `DG.showMultiplayerResults()`（`S.resultShown`）
    用最終排名取代自己嗰面板，並保留「Your run」數字格。結果畫面只可以撳
    `DG.mpDetachRace()` 離開：**唔會** call `leave_drive_and_go_room`，所以自己嗰行
    finished 紀錄仍然留喺房間。room／自己嗰行連續 3 次讀唔到就 `DG.mpShowRoomClosed()`；
    已完成嘅玩家會保留自己成績＋「room no longer available」提示。
  - 結果畫面出現後 `raceFrame` 唔再 `requestAnimationFrame`（phase = finished），
    `DG.togglePause()`／`DG.useItem()` 對已完成玩家無效，唔會蓋走結果。
- **多人進度板**：race view 左上角 `#dg-mp-progress`（HUD 下面、`pointer-events:none`、
  z-index 低過 HUD）。只喺 `mode === 'multi'` 出現，列出**未完成**嘅玩家：名、
  `correct / N`、進度條（`correct / N`）同已同步嘅賽道距離（次要提示）。
  `DG.mpProgressBoard()`（純函數）按 correct 由高到低排，同分比距離；自己嗰行 `.me`
  ＋「(you)」。`DG.updateMpProgress()` 喺 `mpSyncRace` 每 700ms 更新，開賽先用 lobby
  名單畫一次；`DG.hideMpProgress()` 喺 solo／離開賽道時收埋。贏嘅條件仍然係 N 題正確。
- SQL：已有舊 rooms 嘅老師要自己喺 Supabase SQL editor 貼
  `supabase/drive_and_go_scenes_and_boards.sql`（喺 `drive_and_go_question_count.sql` 之後，可重跑）；
  全新安裝貼更新咗嘅 `supabase/drive_and_go.sql` 就一次過有齊 scene＋兩塊榜。
  `drive_and_go_question_count.sql` 保持可用，唔好刪。**唔好**用 plugin／agent 跑 SQL。

---

### 9.9a Drive & Go! 山路／彎道＋老師 30 學生房（2026-11 加）

- **賽道曲線／山坡**：`DG.trackCurve()`／`DG.trackLateral()` 加大振幅同頻率
  （0.68／0.28／0.11，0.0019／0.0044／0.0102），`DG.trackHill()` 改成
  `36 sin(0.0016z) + 18 sin(0.0038z) + 6 sin(0.0085z)`，令上山／落山同彎道更密。
  `DG.trackHorizonY()` 嘅 pitch multiplier 由 `900` 改做 `14`，2D 地平線唔再
  長期飽和，會跟山坡平滑升降。
- **3D 賽道**：`DG.threeRoadX()` scale `0.6`、`DG.threeRoadY()` scale `0.62`。
  新增 **terrain ribbon**（`DG.three.terrain`，跟 `threeRoadY(rel)` 起伏的
  1500×2200 地面）＋遠低處 fallback floor；`DG.updateThreeScenery()` 將景物
  y 跟 terrain（`THREE_GROUND_Y + threeRoadY(rel)`），所以山坡唔會穿過平地。
  terrain 用 `MeshBasicMaterial`（唔用 Lambert，否則 1.7 光源會令遠景地面
  clamp 成白色橫帶）；每個場景有 `fog` 色（desert `#f2d89a`、stadium
  `#fbe0da`、jungle `#b8d88e`）對齊天空地平線，遠景唔會再有白色光帶。
- **3D 相機（保持自己架車做中心）**：`DG.updateThreeCamera()` 唔再原地 yaw／pitch。
  相機放喺「玩家 → 前方 260 units 路面」嗰條線上（距離 16.5、高 4.8），
  望住 `threeRoadX(260) * 0.75 + px * 0.25`（`px`＝玩家 lane 位置）。
  因為相機、玩家、look target 三點一線，**自己架車永遠喺畫面正中間**
  （實測 392/784），y 亦固定（691/907），轉彎／上山／落山都唔會消失。
  彎道同山坡照樣見到，因為係條路（唔係相機）喺畫面內升跌同擺動。
  閘門 420 units 喺 dist 900 時仍然喺 351–531／784 之內。
- **2D fallback 都跟車**：`DG.projectRel()` 加 `camShift`（
  `(player.laneX - 1) * nearHalf * 0.64`），成個 2D 世界左右移，玩家 lane 永遠
  喺畫面底部正中間；轉線時係條路移，唔係架車飄走。2D 山坡 elevation 由
  `0.0022` 加到 `0.0028`。
- **多人規模**：3D 只畫最近 **6** 部對手 kart（`visibleRival`），2D canvas 只畫
  最近 **10** 部；賽道進度板最多顯示 **8** 行，自己一定顯示，其餘顯示
  `… +N more racing`。scenery 仍 cap 40。實測 3D ~126 draw calls（1 個對手）、
  30 個對手時 6 部對手約 200 calls、~9k tris。
- **起步直路（2026-11 修正）**：`DG.trackSettle(z)` 用世界距離 `z`（距起步線）
  計 ease：前 **200 units** 完全直／平，到 **1100 units** 才 full 曲／坡。
  `DG.threeRoadX()`／`threeRoadY()`、2D `DG.projectRel()`、`DG.trackHorizonY()`
  同 3D camera pitch 都會乘 `trackSettle`，所以一開波畫面正中、水平；
  之後先出現轉彎／上山／落山。第一個閘（320 units）仍然係直路。
- **老師 3C 選擇：落唔落場**：Class room 嘅 Course step 有
  `#dg-teacher-plays` checkbox（預設 checked）。
  - checked：**31 seats**（老師＋30 學生），RPC 傳 `p_teacher_plays = true`。
  - unchecked：**30 seats**（30 學生），老師唔會插入 `drive_and_go_players`。
    房主照樣按 Start；`DG.mpStart()` 後老師留喺 `grammar-detail-view`，
    `DG.mpWatchRace()` 顯示 live 名次（correct/N、距離），lobby poll 繼續行，
    完場自動轉結果畫面。
  - `DG.mpRoomUpdatePlan()` 而家會把 `room.host_id === me` 當成員，所以
    host-only 老師唔會被當成 missing 而 rejoin／closed。
  - `DG.mpCreate()` 讀 checkbox 並傳 `p_teacher_plays`。
- **老師 30 學生房（`supabase/drive_and_go_class_room.sql`，可重跑）**：
  - `drive_and_go_rooms.max_players` 新欄，default **5**（舊房保持 5）。
  - `create_drive_and_go_class_room()` 只限 `is_drive_and_go_teacher()`
    （老師 email），同 `create_drive_and_go_room()` 同樣參數，另加
    `p_teacher_plays boolean default true`；`max_players` 係 **31**（老師落場）
    或 **30**（host-only）。舊 8-arg overload 會先 `drop function if exists`，
    避免 PostgREST 見到兩個 overload。
  - `join_drive_and_go_room()` 同 `start_drive_and_go_room()` 改用
    `coalesce(v_room.max_players, 5)` 做上限，所以 5 人房同 30／31 人房並存。
  - 前端 Multiplayer → Create 多一個 **Class room (30 students)** 掣（只老師見到）；
    `DG.mpClassRoom` 記住選擇，`DG.mpCreate()` 揀
    `create_drive_and_go_class_room`。Lobby 顯示 `Players n/31` 或 `n/30`，
    房主 Start 上限跟 `room.max_players`。加入者照用 4 位房碼，
    Topic／Challenge／題數／場地跟房主。
  - 未跑 SQL：Class room 會顯示 `DG.mpShowSqlHint('class')`，提示貼
    `supabase/drive_and_go_class_room.sql`；普通 5 人房、Solo 照用。
  - 呢份 SQL 喺 `drive_and_go.sql` 之後跑；fresh install 都要跑埋呢份，
    除非老師只想 5 人房。

---

### 9.10 Word Battle 班際：自訂貓＋頒獎台（2026-11 加）

- **SQL**：`supabase/battle_cat.sql`（可重跑）為 `battle_players` 加
  `cat`／`glasses`／`hat`／`outfit`，default 係 `Ginger`／`None`／`None`／`None`。
  學生用現有 `battle players update own` RLS 更新自己嗰行，唔需要新 RPC。
  未跑 SQL 都玩到：貓 look 只留喺本機／用 default，更新時只會 `console.warn`。
- **自訂貓（只限班際）**：學生用 4 位房碼入咗 **班際 waiting room** 之後，
  `battle-waiting` 會顯示 `#battle-cat-customizer`（Cat／Glasses／Hat／Outfit）
  ＋`#battle-cat-preview` canvas；1v1 waiting room 唔會顯示。選擇會寫入
  `learniTY_dg_settings`（同 Drive & Go 共用），`battleSetLook()` 會即時更新
  preview 並寫入自己嗰個 `battle_players` row。入房時亦會先
  `battleSaveLookToRoom()` 儲存當時嘅 look，所以趕住開賽都至少用到設定值。
  班際房如果已經開始（join mid-game），waiting room 唔會出現，學生要用
  Drive & Go 之前設定好嘅貓。
- **頒獎台**：班際房 `status === 'finished'`（`finished_at` 有值）時，
  學生 result 同老師 class board 都會出 `battlePodiumHTML()`：
  - 1–3 名喺台上（2／1／3 排列，台階高度唔同）
  - 4／5 名喺台旁嘅 `battle-podium-extra` row
  - 每個人都用自己嘅 `battle_players` 貓 look，`DG.drawKart()` 畫落 canvas
  - 多過 5 人只顯示 Top 5，下面註明 `Top 5 shown of N players`
  - 未 finished 時照舊顯示「Waiting for the teacher…」＋文字排名，唔會出 podium
- **手機**：≤480px 台階 78px、≤360px 60px＋gap 4px，320px 都唔會橫向爆版。
- **改動提示**：加新貓選項要同時改 `DG.CATS`／`DG.GLASSES`／`DG.HATS`／
  `DG.OUTFITS`，Word Battle 會自動跟。頒獎台只顯示 Top 5；要顯示更多就改
  `battlePodiumHTML()` 個 `slice(0,5)` 同 CSS。

---

### 9.11 Drive & Go! 背景音樂＋three.js 3D 畫面（2026-11 加）

- **音樂**：`music/battlemusic.mp3`（3.6MB）用 `new Audio('/music/battlemusic.mp3')`，
  loop、volume 0.35。`DG.startMusic()` 喺 `startSingle()`／`mpBeginRace()` 嘅
  用戶手勢內先叫一次，`DG.startRace()` 再確保播放；`stopRace()`、
  `finishPlayer()`、`freezeRaceLoop()`、`showLoadError()` 會停。
  HUD 有 `#dg-music-btn`（🔊／🔇），記住 `localStorage['learniTY_dg_music']`。
  音樂**唔入** `sw.js` CORE_ASSETS（3.6MB 太大），第一次播時由 network-first
  SW 自己 cache；未 cache 時斷網會冇音樂，2D/3D 遊戲照玩。
- **three.js**：`index.html` 喺 `drive-and-go.js` 同 `drive-and-go-race.js`
  之間載入 `https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js`
  （jsDelivr 已在 SW CDN allowlist）。`DG.initThree()` 喺 `startRace()` 建
  `#dg-three-canvas`（z-index 0，喺 `#dg-canvas` 後面）；`#dg-canvas` 喺 3D
  模式只畫 countdown／lightning／speed lines overlay。
- **場景**：`DG.threeRoadX/Y` 用現有 `trackLateral`／`trackCurve`／`trackHill`
  砌 curved road ribbon；road texture 有 edge lines、dashed lanes；3D karts
  用 `DG.catPalette` + hat/glasses/outfit；gates 用 canvas text banner；
  scenery 用簡單 box/cone/cylinder；bananas 用黃色球；camera 跟 player lane
  同前方彎位。`DG.drawThree()` 每幀 update 再 render。
- **道具 3D 效果**：`DG.useItem()` 會叫 `DG.spawnThreeProjectile()`：
  - 🔴 Red shell：紅色 shell mesh 由玩家飛向前面目標（lane 會 interpolate），
    到目標時 `spawnThreeBurst()` 紅色 ring。
  - 🍌 Banana：黃色香蕉向後上方拋出，消失時黃色 ring；真正嘅 banana
    障礙照舊加入 `S.bananas`。
  - 🍄 Mushroom／⭐ Star：玩家位置綠色／黃色 ring burst。
  - ⚡ Lightning：每個可見 rival 位置黃色 ring burst。
  - 本地一定見到；多人時另外經 `dg-projectiles` Broadcast 傳給對手
    （見下面投射物同步）。實際 spin/slow 仍然經 `remoteEffect`。
  - 2D fallback 完全唔受影響（`spawnThreeProjectile`／`spawnThreeBurst`
    見 `DG.three` 為 null 就 return）。
- **延遲命中（2026-11）**：Red shell／banana 唔再即時 spin。`DG.useItem()` 用
  `DG.scheduleHit(target, kind, ms, toast, delaySec)` 放入 `S.pendingHits`；
  `DG.updateRace()` 每幀 `DG.updatePendingHits()`，到 `S.clock >= at` 才套
  `spinUntil`＋`remoteEffect`，所以投射物視覺飛到目標才轉。Mushroom／star／
  lightning 仍然即時（佢哋冇投射物）。`stopRace`／restart 會由 `startRace`
  重設 `S.pendingHits=[]`。
- **投射物同步（2026-11）**：多人時 `DG.mpStartProjectileChannel()` 喺
  `mpStartRacePoll()` 開 Supabase Realtime public channel
  `dg-projectiles:<roomId>`（self:false）。`DG.mpSendProjectile()` 傳
  `kind／fromDist／toDist／fromLane／toLane／duration／arc`；
  `DG.mpReceiveProjectile()` 喺對手 client 用自己 `player.dist` 轉做
  `rel` 再 `spawnThreeProjectile()`。純視覺，冇 SQL、冇新 RPC；實際
  spin/slow 仍然經 `apply_drive_and_go_effect`。Channel 喺
  `mpStopRacePoll()` 清走；Realtime 失敗只係冇遠端投射物，遊戲照玩。
- **多人唔可以直穿對手（2026-11）**：`DG.applyMultiCollision()` 只喺
  `S.mode === 'multi'` 生效。玩家同一個 lane（`|laneX 差| < 0.55`）而對手
  喺前面 9 units 內，會將 `p.dist` clamp 到 `rival.dist - 9`、`p.speed`
  降到對手速度，並每 4 秒 toast「Steer left or right to pass!」。要轉
  lane（左右）先可以過人；solo CPU 唔受影響。
- **3D 觀感（2026-11）**：karts／scenery／gates 改用 `MeshLambertMaterial`，
  scene 加 `HemisphereLight` + `DirectionalLight`，renderer 用
  `sRGBEncoding`；road texture 加 theme kerb stripes，另外有兩條 **3D kerb
  ribbons**（vertex colors）沿彎路升起；kart 加尾、死氣喉、地面陰影 blob；
  `addThreeBackdrop()` 加主題遠景（desert mesas／stadium skyline／jungle
  hills）＋雲＋太陽 sprite；palms 加多向 fronds，grandstand 分層、building
  有窗、dino 有腳／尾、car 有車輪。目的係減少「太假／flat」嘅感覺。
- **Fallback**：如果 `THREE` 未載入、WebGL 失敗、或者 `DG.THREE_ENABLED=false`，
  `DG.three` 保持 null，原有 2D renderer 照用。`DG.disposeThree()` 喺
  `stopRace()` 清 canvas／renderer；restart／exit 都安全。
- **效能**：scenery 只畫最近 `THREE_SCENERY_CAP = 40` 件（其餘隱藏／fog），
  實測 499×810、pixel ratio 1.5：desert 125 draw calls／5.5k tris、stadium
  146／5.1k、jungle 192／7.6k；no shadow maps、no antialias。手機如果太慢，可以
  再減 `THREE_SCENERY_CAP` 或將 `DG.THREE_ENABLED=false`。
- **改動提示**：郁 camera 要同時睇 `updateThreeCamera()` 嘅玩家—look 線
  （`threeRoadX(260)`、16.5、4.8、7.8）同 `updateThreeKarts()` 嘅 scale；
  相機一定要放喺「玩家 → look target」嗰條線上，否則轉彎時架車會偏離中心。
  想加新 scenery kind 喺 `makeThreeScenery()` 加 branch。2D 同 3D 兩邊嘅
  遊戲狀態（`DG.raceState`）係同一份，唔好喺 3D 另外改遊戲邏輯。

---

## 10. Word Jump（Doodle Jump 式爬高認字遊戲）

入口：Hub 嘅「🦘 Word Jump」卡，或者 `battle-view` 頂部嘅同一張卡 → `openWordJump(...)` → `wordjump-view`。返回會返去撳入嚟嗰一頁（Hub 或 Word Battle）。
純前端、單機、**唔需要 Supabase／SQL**，全部邏輯喺 `js/word-jump.js` 一個
`const WJ = { … }` 物件（`openWordJump` 同 `WJC` 都喺同一個檔），HTML 係 `#wordjump-view`。

### 10.1 結構
| 位置 | 內容 |
|---|---|
| `#wordjump-view` | 工具列（topic／tilt／full screen／sound／restart／pause）＋ `#wj-stage`＋`#wj-canvas`＋`#wj-overlay`＋`#wj-re-btn`＋`#wj-exit-fs` |
| 語言 | **全部介面文字用英文**（按鈕、說明、排行榜、admin 卡）。只有**題目本身**（`row.zh` 中文提示、`categories` 嘅中文答案、後備字表）保留中文，因為嗰啲係學習內容，唔係 UI。 |
| `WJ.mount()` | 入 view 時 call（`changeView` 內 `requestAnimationFrame`），綁 input、resize、reset |
| `WJ.stop()` | 離開 view 時 call（`changeView` 開頭 `WJ.stop()`），停 RAF、清 overlay |
| `WJ.quit()` | 返回 `battle-view` |
| `WJ.gameOver()` | 唯一結束點，寫 `localStorage` |

Canvas 邏輯座標固定 **400×600**，實際 bitmap 按 CSS 尺寸 × DPR（上限 2）縮放。
物理用**固定 1/120 秒**步長（`WJ.frame` 內 accumulator，最多補 8 步），
所以唔同 fps 跑出嚟一樣。

### 10.2 操作
- **手機**：底部兩個圓形方向 pad（半徑 40，x=62 同 x=W−62，y=H−64）按住左右行；
  pad 以外位置**點一下 = 射鼻球**。唔再用「按畫面左右半邊」，避免同射擊衝突。
- **重力感應**：工具列「📱 Tilt」係開關（再撳一次熄）。iOS 要
  `DeviceOrientationEvent.requestPermission`。開啟時以當時角度做零點，
  `TILT_RANGE = 11°` 就滿速、`TILT_DEAD = 0.025` 死區，再過一條
  **`TILT_CURVE = 1.6` 次方曲線**（`dir = sign(t)·|t|^1.6`）同平滑。
  所以傾斜角同速度係**成比例**：2° ≈ 7%、4° ≈ 20%、6° ≈ 38%、8° ≈ 60%、
  11° = 100%。覺得太敏感就加 `TILT_RANGE`，太鈍就減；想「細傾更慢」就加大
  `TILT_CURVE`（1.0 = 完全線性）。
- **左右速度（按輸入比例）**：`MOVE_MAX 240`、`STEER_RATE 16`（加速）、
  `STEER_STOP 18`（收步）。`p.vx` 直接追 `dir × speedCap()`，加速約 **190ms**
  到 95%，放手**滑 6–13px**（開頭 ~6px、頂速 ~13px；2026-11 由 22／30 再調順，
  `STEER_STOP` 減得越細越滑）。`|dir| < 0.04` 當 0；只有 `target = 0` 而且 `|vx| < 1.5`
  才歸零（否則慢速微調永遠起唔到步）。
  **注意**：以前嘅 `MOVE_ACC` + `FRICTION × (1-|dir|)³` 模型已經刪走——
  摩擦力係常數、唔隨速度變，結果係「一過門檻就衝到頂速、門檻以下完全唔郁」，
  冇中間速，呢個就係「太快」嘅根源。
- **速度隨高度遞增**：`WJ.speedCap()` = `MOVE_MAX × (0.45 + 0.55 × min(1, maxClimb/3200))`，
  即係**每局開頭 108 px/s，爬到 3200px 就 240 px/s**（橫越 400px 由 3.7s 變 1.7s）。
  **但係 108 px/s 唔夠橫越成個畫面**：滯空 1.45s 只行到 **157px**，所以平台
  唔可以擺得太遠——見 §10.3 嘅 `reach` 限制。想慢就減 `MOVE_MAX`／
  `SPEED_RAMP_FROM`（0.45）；想開頭快返就加（改完要順便睇 `reach`）。
- **鍵盤**：← → 或 A/D 移動，Space／↑／W 射擊，P／Esc 暫停。
- 切去其他 tab（`visibilitychange`）會自動暫停。

### 10.3 平台
| 顏色 | 行為 |
|---|---|
| 綠 | 普通，安全 |
| 藍 | 左右水平移動（`amp` 26–46） |
| 灰 | 上下垂直移動（`amp` 20–40） |
| 棕 | 踩中即斷，**唔會彈**，直接跌落 |
| 黃 | 踩中 1.1 秒後爆炸消失（臨爆會閃紅） |
| 白 | 踩一次即消失 |
| 紫（字磚） | 題目平台，見 §10.6；安全、有彈力、唔會變陷阱 |

生成難度隨高度上升（`WJ.difficulty() = clamp(maxClimb/9000, 0, 1)`），
越高綠台越少、陷阱越多、平台間距亦輕微收窄。
`difficulty()` 喺爬高 9000px（大約 900 分嘅高度分）已經封頂；分數到 **4500**
之後再開挑戰：`WJ.lateHeat()` 喺 4500–7000 由 0 升到 0.5，7000–10000 再升到 1，之後密度曲線封頂。
熱度上升時綠台再少、陷阱更多、平台稍窄、普通間距稍闊（唔超過 `maxGap`）、
移動台同怪物稍快。7000 分後（`lateHeat >= 0.5`）字磚改 4 個選項，護盾亦只可以由連續答對獲得（見 §10.4／§10.6）。
**10000 分後第三段熱度**（`WJ.lateHeat3()`／`WJ.heat3At()`，`SCORE_HEAT3_AT = 10000`）
唔再收窄平台或加陷阱，只係將橫移、移動台、怪物同 UFO 速度再加快約 **12%**
（`HEAT3_SPEED_BONUS = 0.12`）。Solo 跟直播分數（高度分 + 答題獎勵）；Challenge 跟平台高度
（`floor(climb/10)`），咁大家先共享同一條路。`WJ.speedAt`／`WJ.horizBudget` 會用加快後嘅速度計橫向預算，
所以平台仍然一定跳到（`maxGap` 唔變，因為跳高同滯空冇改）。第一次過 4500 分會出 toast
「⚡ Challenge up!」，過 7000 分再出「⚡ Extra challenge! Shields now need a 5-word streak.」，
過 10000 分出「⚡ Speed up! Similar meanings and occasional twin monsters.」。4500 分以下（除咗跳躍稍快）手感不變；
開首 0–2000 都用呢個稍快嘅跳躍（滯空 1.45s）。

**三個「跳唔到」修正（2026-11，用戶連續三次反映）：**

1. **下一個台一定跳到**（`WJ.spawnPlatform` / `WJ.horizBudget`）。舊式
   `reach = speedCap() × 滯空 × 0.8 + 平台寬` 用咗**成段滯空**，但下一個台如果
   已經離腳 80–275px，玩家係落返嚟途中就穿過佢，實際橫向時間短過而家嘅 1.45s。
   再加藍台左右擺、灰台上下擺、棕台唔彈，就會喺中段留低一個畫面都跨唔到嘅空位
   （老師 iPhone 全屏、分數 ~1186 嗰張相就係咁）。而家每個新台都要同時滿足：
   - 垂直距離（連灰台向上嘅 amp）≤ 跳高 − 36px（`WJ.maxGap`，跳高 319 → **283px**）。
     正常步距 68–102、字磚上 240–275 都喺呢個範圍內，**冇改密度**。
   - 橫向用圓形距離（畫面左右穿邊係近路）：由上一個**實心台**嘅最遠落點，
     喺呢段垂直距離嘅滯空入面、由靜止加速（`STEER_RATE`）可以行到嘅距離 ×
     `WJ.REACH_FACTOR`（0.8）。藍台嘅 amp 要成段擺幅都仲喺呢個預算入面，擺唔到就變綠。
   - 棕台唔彈，所以**唔會**成為下一跳嘅起點；白／黃只彈一次，下一台同時要由
     佢同最後一塊實心台跳到。長跳（>160px，包括字磚正上方）強制係靜止綠台。
   - 字磚每塊都係起點（答錯都會由嗰塊彈起）。如果一塊台覆蓋唔到全部字磚，
     就喺每塊字磚上方各放一塊綠台，下一步先合併返一條路。
   畫面邏輯闊度固定 400，窄電話只係縮放，唔會改跳距。
2. **字磚下面一定有綠色實心台**（`WJ.safePadUnder`）：生成字磚排之前，會將
   正下方嗰塊（`topY`，距離剛好 115px）強制轉做 `green`、`amp 0`。
   之前 40% 字磚下面係棕／白／黃／移動台：棕台踩中即斷（唔彈），
   白台彈完即消失，所以「明明跳咗都上唔到字磚」。
3. **字磚排 = 一條橫跨畫面嘅長台**（`WJ.update` landing）：只要由上向下穿過
   `row.y`，就一定落喺最近嗰塊字磚（會將 `p.x` 微調入該磚）。
   之前 8px 磚隙、兩側 26px 邊位都會直接穿過跌落去。
   ⚠️ 只改 resolved = false 嘅排；答完嘅排照舊可以穿過落下面平台。

**密度**（用戶 2026-11 要求「開頭可加密」＋「綠字磚可加密」）：

- 開頭（`maxClimb < 1500`）：步距 `rand(68, 90)`、平台寬 `rand(74, 104)`。
- 之後：步距 `rand(76, 102)`、平台寬 `rand(62, 90)`（原本 `84–112`）；4500 分後平台開始收窄，7000 分後最多再收窄約 10px（最窄約 50px）。
- 綠台權重 `58 - 14d - 12h`（`h` 係 `lateHeat`，4500 分前為 0），開頭實測綠台佔 **59–66%**。
手感係「夠高、睇得清字」，再稍為加快：`GRAVITY 1217`／`JUMP_V -882` → 跳高仍然 **319px**、
每次滯空 **1.45s**。呢對係由上一版 `1030`／`−811`（滯空 1.58s）用滯空 ×0.92、
跳高不變算出嚟：`GRAVITY ÷ 0.92²`、`JUMP_V ÷ 0.92`。再早係 `1610`／`−1014`
（滯空 1.26s，老師反映彈跳太快、睇唔切生字）用滯空 ×1.25 減慢到 1.58s，
再之前係 1300／−822（跳高 256px，跳唔夠高）、2000／−1030（1.03s 太急）同
750／−645（1.72s 太飄）。想改而**保持跳高不變**：滯空乘 s，就 `GRAVITY ÷ s²`、
`JUMP_V ÷ s`。例如想再「快上快落」（滯空 ×0.9）：`GRAVITY 1502`、`JUMP_V -980`。
（跳高 `h = v² / 2g`，所以兩個一齊亂改會跳唔到／跳過龍。速度係 ÷ s，唔係 × s。）
道具上升速度 `JET_V -832`／`PROP_V -210` 同字磚加成 `WORD_BOOST -1064`（仍然
彈高 465px）都要跟同一個滯空倍數一齊調。

### 10.4 道具（平台上方圓形徽章，踩中該平台即觸發）
彈簧 ×1.9 跳力 · 竹蜻蜓慢速上升 2.6 秒 · 火箭背包 1.5 秒高速 ·
彈簧鞋 6 次 ×1.42 跳力 · 護盾 8 秒（擋一次怪物／UFO，黑洞同跌落擋唔到）。
7000 分前（`heatAt < 0.5`）護盾可以作為平台道具出現，亦可以靠連續答對 5 題獲得。
**7000 分後不再生成護盾道具**（`WJ.gadgetKindsAt` 會從 spring／propeller／jetpack／shoes 抽，唔再抽 `shield`）；
之後唯一獲得護盾嘅方法係連續答對 5 題（仍然送 8 秒）。

### 10.5 敵人
- **怪物**：紫色，平台上方左右巡邏。碰到 = game over；可射爆、踩頭踩扁（+30 分），
  彩虹模式撞到會直接消滅。10000 分後（`heat3At`）巡邏速度加快約 12%。
  另外會**偶爾**喺同一高度放兩隻怪物（`HEAT3_TWIN_CHANCE = 0.28`，唔係每層都有）。
  兩隻會左右分開，巡邏範圍之間至少留約 70px 通道，玩家可以從中間或兩側通過。
  **唔會**放喺字磚排或者距離字磚 90px 之內（`nearQuizRow`／`cullMonstersNearQuiz`），亦唔會令平台跳唔到。
- **UFO**：下方有吸力光束，入咗光束會被拉向它；可射爆（+40 分）。
  10000 分後浮動加快，並開始小範圍左右移動。
- **黑洞**：160px 內有引力，中心 28px 內必死，護盾擋唔到。

### 10.6 題目：睇中文，跳上正確英文
- 每隔 `QUIZ_GAP`（`380–500`，經 `min(nextQuizY, topY-115)` 修正後實測**每 ~510px**）
  有一排**紫色字磚**（`spawnQuizRow`），一排 2 個
  （難度 <0.3）或 3 個（之後）；7000 分後 `heatAt >= 0.5` 時改 4 個：
  1 個正確答案 + 1–3 個干擾項。7000 分前干擾項由題庫隨機抽；
  **10000 分後**（`heat3At`）改抽**相近意思**：同一 topic／category 優先
  （`WJ.wordPool()` 會標 `topic`；20 個內建後備字都有 animals／space／nature 等小組），
  再用相近字長、共享詞幹／前綴、或中文有相同字做加分，永遠唔會複製正確答案。
  同類唔夠就退回相近字，再唔夠先隨機。Challenge 用 `difficultyAt`／`heatAt`／`heat3At(y)`
  跟平台高度出題，唔跟個別玩家嘅獎勵分，咁先公平。
- HUD 頂部白卡顯示**中文**（`row.zh`）＋「JUMP ON THE RIGHT WORD」；
  顯示嘅係 `WJ.activeRow()` = 玩家頭上最近而未答嗰排，所以唔會預早爆雷。
- 踩中正確字磚：**彈高 465px**（`WJ.WORD_BOOST = -1064` 取代原本 `JUMP_V -882`
  嘅反彈，`h = 1064² / (2 × 1217) = 465`）、`+60 + 字長×5 + min(90, 連對×10)` 分、
  讀出英文（SpeechSynthesis）、toast ✅ 顯示 `⬆ 465px`；每連續 5 題送護盾 8 秒
  （7000 分後呢個係唯一獲得護盾嘅方法，見 §10.4）。
  **呢個係主要上分途徑**：彈高直接推高 `maxClimb`，即係 height 分。
  `land()` 讀 `WJ.boostPending`（`answerRow()` 答對時設 true），所以一定要
  喺 `land()` 入面 apply，唔可以喺 `answerRow()` 直接改 `p.vy`（會被覆蓋）。
  想彈得更高／矮就改 `WJ.WORD_BOOST`（而家 -1064 ≈ 465px；改完要連 BOOST_VY／BOOST_G 一齊改）。
  **改 `WORD_BOOST` 時要連 `WJ.BOOST_VY`／`WJ.BOOST_G` 一齊改**（見下）。
- **Boost 滯空 ×1.35（2026-11）**：老師反映答對之後反應時間太短，睇唔切下一條問題。
  所以答對嗰下嘅發射會用**慢滯空版**：`WJ.BOOST_VY = -788`（= -1064 ÷ 1.35）取代
  `p.vy`，同時設 `p.boostHang = true`；`WJ.update()` 嘅垂直積分見到
  `p.boostHang` 就用 `WJ.BOOST_G = 668`（= 1217 ÷ 1.35²）而唔係 `WJ.GRAVITY`。
  高度不變：`788² / (2 × 668) ≈ 465px`，但滯空 ×1.35（`2v/g = 2×788/668 ≈ 2.36s`），
  學生有更多時間揀下一個字。
  普通跳（`JUMP_V -882`／`GRAVITY 1217`，1.45s／319px）**完全唔受影響**。
  `p.boostHang` 會喺**下一次 `land()`**、`WJ.gameOver()` 清走；`WJ.reset()` 重建 player 所以 RE／重開都會清。
  jet／prop 期間照舊直接設定 `p.vy`，唔會用 BOOST_G。想再慢啲就加大
  `WJ.WORD_BOOST_HANG`（1.35→1.5 時 BOOST_VY ≈ -709、BOOST_G ≈ 541），**兩個數都要按
  `WORD_BOOST ÷ s` 同 `GRAVITY ÷ s²` 重算**，否則彈高會變。冇 jet／prop 嘅情況下
  boost 直接 `p.vy = WJ.BOOST_VY`（唔係 `Math.min`——-788 比 -882 弱，min 會食咗個 boost）。
- 踩錯：toast ❌ 顯示正確答案、連對清零（**唔會懲罰分數／唔會死**），
  正確嗰塊會變綠比玩家睇。Toast 畫喺 `WJ.H - 140`（畫面底部、方向 pad 之上）——
  以前畫喺 `y = 96`，啱啱好蓋住上面嗰排字磚。
- 答完／漏咗（跌落去）之後，`activeRow()` 自動跳去下一排。
- 字磚上方刻意留 **240–275px** 大空隙（`WJ.afterQuiz`），逼玩家落返字磚排，
  唔會一跳就飛過。**呢個數要跟 `JUMP_V` 一齊調**：字磚離下面平台 115px，
  所以跳高減 115 就係「可以由下面平台跳到幾高」；必須**細過**呢個空隙，
  否則玩家可以直接跳過字磚唔答（原本跳高 256px 時空隙 158–198 剛好夠，
  加到 319px 之後空隙要加到 240–275 先擋得住）。

### 10.6b 重開（RE）

- **兩個入口**：工具列 `🔁 Restart`；畫面底部中央 `↺ Restart`（`#wj-re-btn`）。
  後者**喺全屏都用得到**（全屏時工具列收埋咗）。`✕ Exit full screen` 喺右上角，
  唔會同底部左右掣重疊。
- `WJ.restart(force)`：`reset()` → `state='playing'` → 重開 RAF → toast `↺ New run`。
  **唔會碰全屏狀態**（唔會 `requestFullscreen`、唔會退出），所以喺全屏按完仍然全屏。
- 誤觸保護：遊戲進行中而且分數 > 0，`WJ.restart()` 會 `confirm()` 問一次
  （「Restart this run? Your score will be lost.」）。暫停選單同完場選單傳
  `WJ.restart(true)` 略過 confirm，因為嗰下已經係刻意撳。
- `Play again`（完場）同暫停選單嘅 `Restart` 都已經改用 `WJ.restart(true)`
  （以前用 `WJ.start()`，會再叫一次全屏 API）。
- 想改位置改 `#wj-re-btn` CSS；想改確認文字改 `WJ.restart` 入面嘅字串。

### 10.7 題庫來源
`WJ.wordPool()` 由 `categories`（Google Sheet）揀字，經 `primaryAnswer()` 取第一個答案，
再用 `/^[A-Za-z]{3,11}$/` 過濾（所以 `plaza / square / mall`、有空格／連字號嘅字自動排除）。
Topic 下拉有「🎲 All topics」＋每個有字嘅 tab；預設跟 `currentTopic`，冇就 All。
轉 topic 會即刻 resolve 未答嘅排，下一排就用新 topic。
題庫少過 15 個字會補 20 個內建後備字（tiger、rocket、garden…），所以 Sheet 斷線都玩到。
Sheet 載入完成後 `loadAllCategoriesFromSheet()` 會 call `WJ.populateTopics()` 更新下拉。

### 10.8 分數與儲存
- 分數 = `max(0, floor(maxClimb / 10) + bonus)`；`bonus` 來自答對、殺怪、踩怪。
- `maxClimb` = 全場最高點（`WJ.maxClimb = max(maxClimb, -p.y)`），所以**答對字磚
  嗰下嘅 465px 彈升會永久計入 height 分**（+46 分），就算之後跌返落嚟都唔會扣。
- `localStorage["wj_best"]` 最高分、`localStorage["wj_words"]` 累計答對題數（只加不減）。
- 冇排行榜、冇上傳 —— 同 Word Battle 唔同，呢個純粹係課堂消遣。

### 10.9 改動提示
- 調手感改 `WJ.GRAVITY`（1217）／`WJ.JUMP_V`（−882）／`WJ.MOVE_MAX`（240）／
  `WJ.STEER_RATE`（16）／`WJ.STEER_STOP`（18）／`WJ.TILT_RANGE`（11）／
  `WJ.TILT_CURVE`（1.6）。想「收步更快」就加 `STEER_STOP`、想「滑多啲」就減。
  想改滯空又保持跳高：`GRAVITY ÷ s²`、`JUMP_V ÷ s`（見 §10.3）；
  道具上升速度 `JET_V -832`／`PROP_V -210` 同 `WORD_BOOST`（保持 465px）要一齊按比例調；
  改 `WORD_BOOST` 之後記得重算 `WJ.BOOST_VY = WORD_BOOST ÷ WORD_BOOST_HANG` 同
  `WJ.BOOST_G = GRAVITY ÷ WORD_BOOST_HANG²`（§10.6 boost 滯空）。
- 想調「開頭慢、後來快」嘅節奏改 `WJ.SPEED_RAMP_FROM`（0.45）同
  `WJ.SPEED_RAMP_AT`（3200px）。開頭速度 = `MOVE_MAX × SPEED_RAMP_FROM`
  （240 × 0.45 = 108 px/s）。
- 想改有幾密：`genUpTo` 嘅 `opening`（`maxClimb < 1500`）同兩組步距
  `rand(68, 90)`／`rand(76, 102)`；平台闊度喺 `spawnPlatform` 嘅
  `opening ? rand(74, 104) : rand(62, 90)`（4500 分後開始收窄，7000 分後更窄，見上）；綠台比例係 `table` 嘅
  `['green', 58 - 14 * d - 12 * h]`。
- 分數挑戰改 `WJ.SCORE_HEAT_AT`（4500）、`WJ.SCORE_HEAT2_AT`（7000）同 `WJ.SCORE_HEAT2_SPAN`（3000，即 10000 分密度封頂）。
  10000 分後速度／相近干擾項／雙怪改 `WJ.SCORE_HEAT3_AT`（10000）同 `WJ.HEAT3_SPEED_BONUS`（0.12）、`WJ.HEAT3_TWIN_CHANCE`（0.28）。
  改完速度要確認 `speedAt`／`horizBudget` 用新速度，平台仍然 ≤ `maxGap`。
- 題目有幾密：`WJ.QUIZ_GAP_MIN/MAX`（380／500）。實際排距會多 ~70px
  （因為字磚要擺喺平台上方 115px），所以**唔好直接當成排距**。
- 平台橫向距離係 `WJ.horizBudget(gap, climb)`（跟**呢一跳**嘅垂直距離計滯空，
  唔係成段 1.45s）。改 `MOVE_MAX`／`SPEED_RAMP_FROM`／`GRAVITY`／`JUMP_V`
  之後要重跑手機闊度嘅攀爬模擬；預算自動跟新常數，但字磚上方 240–275 必須
  仍然細過 `WJ.maxGap()`（跳高 − 36），先至跳到又跳唔過條問題。
- 加新平台類型：`spawnPlatform()` 嘅 `table` 加權重 → `WJ.land()` 加行為 →
  `WJ.update()` 加移動 → `WJ.draw()` 嘅 `colors` 加顏色。
- 加新道具：`WJ.pick()` 個陣列加 key → `WJ.applyGadget()` 加效果 →
  `WJ.drawGadget()` 個 `map` 加 emoji → `WJ.drawHud()` badges 加顯示。
- 改題目密度改 `WJ.QUIZ_GAP_MIN`／`QUIZ_GAP_MAX`；改選項數改 `spawnQuizRow()` 嘅 `count`。
- **Tilt（2026-11）**：手機／平板按 Start 會自動開 tilt（iOS 要喺同一個 tap 問 motion 權限，
  所以 `WJ.armTiltOnStart()` 喺 `enterFullscreen()` 之前同步呼叫）。
  `WJ.tiltRoll()` 按螢幕方向用 `gamma`（直向）或 `beta`（橫向），先至跟到「手機平衡」。
  入全屏、轉橫豎都會重設 `tiltZero`。全屏工具列收埋咗，畫面左上角有 `#wj-tilt-fs` 開關。
  `TILT_RANGE = 11`：實機太敏感就調大、太鈍就調細。
- 已知限制：`canvas` 內容喺 OpenCode browser 截圖會空白（要 `toDataURL()` 轉 `<img>` 才睇到），唔係 bug。

### 10.10 全屏幕
- **三個掣**：工具列 `#wj-fs-btn`、畫面右上角 `#wj-fs-enter`（⛶ 全屏）、
  全屏時右上角 `#wj-exit-fs`（✕ 退出全屏，唔放底部以免擋住左右移動）。三個都 call `WJ.toggleFullscreen()`。
- **全屏左右移動（2026-11）**：全屏時 canvas 喺 `#wj-stage` 入面 letterbox（兩邊／上下有黑邊），
  拇指成日撳中黑邊或者差少少出咗 pad。`WJ.pointerDir()` 會把黑邊、底部左右角落，
  同埋 stage 底部約 28% 的左右兩邊都當成方向掣；事件聽喺 `#wj-stage`。
  另有非 passive 嘅 `touchstart`／`touchmove` fallback。
  唔可以喺 `pointerleave` 清 `holdDir`，iOS 亦唔好 `setPointerCapture`。
  CSS fallback（iPhone Safari 冇 element fullscreen）：`body.wj-fs` 要 `position:fixed` +
  `touch-action:none` 鎖 scroll（否則頁面一滑就 `pointercancel`，左右掣會似壞咗），
  `#wj-stage` 要 `z-index: 9999`。`WJ.lockFsScroll()` 會記住／還原 scrollY。
  手機預設用 **tilt 跟平衡** 郁左右；pad 只係後備。
- 入場 overlay 有**兩個選擇**：`⛶ 全屏開始`（`WJ.start(true)`）同
  `視窗模式開始`（`WJ.start(false)`，會熄 `autoFs` 唔再自動入全屏）。
- `WJ.start()`（唔帶參數，例如 Play again）會試入全屏一次（`WJ.autoFs`，
  只喺 `WJ.mount()` 設 true，即每次入 view 一次）——因為
  `requestFullscreen()` 要**用戶手勢**，撳 Start 正好係手勢。
- `#wj-fs-enter` / `#wj-exit-fs` 嘅位置同外觀寫死喺 CSS（唔靠 Tailwind class），
  所以就算 Tailwind CDN 斷線都仲撳得到。
- **原生**：`#wj-stage.requestFullscreen()`（連 `webkitRequestFullscreen`）。
- **iPhone Safari 冇 element fullscreen**：fallback 落 `document.body.classList.add('wj-fs')`，
  CSS 將 `#wj-stage` 變 `position:fixed; inset:0; width:100vw; height:100dvh`，
  canvas 保持 2:3 居中，並用 `env(safe-area-inset-*)` 避開瀏海／Home 條
  （meta viewport 已加 `viewport-fit=cover`）。呢個 fallback 冇得隱藏 Safari UI，
  但至少霸滿可用空間——**iPhone 上永遠唔會有真全屏**，係 Apple 限制。
- `WJ.requestStageFullscreen()`：叫完原生 API 之後 **600ms** 內如果
  `WJ.fsOn()` 仲係 false（承諾唔 settle／被拒），就自動切 CSS fallback；
  `WJ.fsPending` 做 token，避免退出之後又被舊 timer 拉返入去。
- `fullscreenchange` / `webkitfullscreenchange` → `WJ.syncFsUi()`：更新掣字、
  顯示／隱藏 `#wj-exit-fs`、`WJ.resize()` + `WJ.draw()`。
- `WJ.stop()`（離開 view）會 `WJ.exitFullscreenSoft()`，所以唔會困住喺全屏幕。
- 改 CSS 記得三組選擇器都要有：`:fullscreen`、`:-webkit-full-screen`、`body.wj-fs #wj-stage`。

### 10.11 排行榜（Word Jump，`supabase/wj_scores.sql`）

**要喺 Supabase SQL Editor 跑一次**，唔會自動建表；重跑安全。唔使跟 battle 系列順序。

- 表 `wj_scores`：每局一行（`user_id, email, nickname, topic, score, height, words`）。
- View `wj_leaderboard`：**每人一行**（個人最佳單局；榜上顯示嗰局嘅分數同命中生字量，唔顯示局數，亦唔再用高度做榜上數字）。`plays` 欄仍然存在，但前端唔展示。
  用 `row_number() over (partition by user_id order by score desc, words desc, created_at asc)` 抽第一行，
  `security_invoker = true` 令 RLS 生效。若老師已跑過舊版 view，要重跑 `supabase/wj_scores.sql` 先會用「同分再比中字量」嚟揀個人最佳嗰行。
- RLS：`select using (true)`（**全世界讀得到**，否則排行榜載入唔到）；
  `insert with check (auth.uid() = user_id)`（只可以寫自己）。
- 前端：
  - `WJ.gameOver()` → `WJ.submitScore(score)`：登入咗就 fire-and-forget insert，
    失敗只 `console.warn`，唔會阻住遊戲結束畫面。訪客同老師 student-account preview
    都唔會上傳分數。
  - `WJ.loadLeaderboard()`：撈 `wj_leaderboard` 頭 7 名，畫入 game-over 卡嘅 `#wj-lb`；
    自己嗰行會 highlight ＋ 標「(你)」。未登入會加一句「今局唔會上榜」。訪客模式唔會撈榜，亦唔會 upload 分數。
  - `WJ.rankRow()`：一行嘅 HTML（🥇🥈🥉 / 名次、名、個人最佳分數、中咗幾個字）。
  - Hub Leaderboard（`leaderboard-view`）有 All／Listening／Recitation／**Word Jump** 分頁。
    Word Jump 分頁撈同一個 `wj_leaderboard` view，只顯示**個人最佳頭 10 名**（按最佳分數，同分再按中字量，再同分先到先排）。每行顯示分數同中咗嘅生字量，唔顯示玩咗幾多局，亦唔再用高度做榜上數字。文案：「Personal bests — top 10 by best score and words collected.」
    學生睇平坦名單；老師畫面按年級分組（冇 +/- 收起掣，同其他 Hub Leaderboard 分頁一樣）。
    訪客仍然入唔到呢頁。
  - 老師：Admin Dashboard「🦘 Word Jump」卡 → `loadWordJumpAdmin()`：
    學生數、總局數、最高分、今日局數 ＋ 每人最佳（名次、幾時玩、最佳分數、中字量；唔顯示局數）。
    `changeView('admin-view')` 會自動 call。
- **未跑 SQL 唔會壞**：game-over 顯示「排行榜載入唔到（老師要喺 Supabase 跑
  `wj_scores.sql`）」，Hub Leaderboard 嘅 Word Jump 分頁同 admin 卡顯示同一句提示，遊戲照玩。
- 改名額：`WJ.loadLeaderboard()` 入面 `.limit(7)`；Hub Leaderboard Word Jump 分頁 `.limit(10)`；
  admin 用 `.limit(1000)`，先至每個 form 嘅學生都會出現。老師畫面按年級分組，每組內自行排名次。
- 誠實聲明：分數由 client 寫入，**可以造假**；同 Word Battle 一樣只適合課堂激勵。

### 10.12 同學高度線（milestone markers）

爬升時，背景會畫其他同學嘅個人最佳高度：淡虛線橫過畫面、左右各一條短槓，
左邊一粒名牌寫**英文名**（`WJ.markerName()`：nickname 入面嘅拉丁字母；冇就用
電郵 @ 前面。中文名唔會畫上畫面）。

- 資料：`wj_leaderboard` 嘅 `height`（冇 height 先用 `score × 10`），`WJ.loadMilestones()`
  喺進入 Word Jump 時拉頭 60 名。**唔包括自己**。低過 120px 嘅紀錄唔畫。
- 名牌畫喺虛線左邊。如果會蓋住畫面入面嘅生字磚（`quiz` platforms），
  `WJ.placeLabelY()` 會以 4px 為一步向上或向下微調（最多 72px），直到唔再同字磚
  或者其他名牌重疊；調唔開就暫時唔畫個名，虛線仍然保留。名牌亦會避開頂部 HUD
  同底部方向 pad（`y < 78` 或 `y > H-108`）。
- 玩家腳嘅高度（`-p.y`）穿過某條線，嗰條線變綠，並播一次輕量通過效果：
  畫面閃一下、兩下粒子、浮起鼓勵字，按 `WJ.CHEERS` 輪流：`wow!` → `superb!` →
  `bravo!` → 再返 `wow!`（`WJ.cheerIndex` 跨局保留，唔會每局都由同一句開始）。
  同一幀穿過幾條只播一次。已經喺腳下面嘅線（資料遲咗先載入）會直接標做已過，
  唔會補播。訪客冇同學線，所以呢句鼓勵亦唔會出現。
- **冇朋友系統**，所以唔會有「過朋友先播特別音效」。通過本身亦冇加新音效。
- 重開（`WJ.reset`）會清通過狀態，下一局可以再過同一批線。載入失敗就當冇線，遊戲照玩。

### 10.13 Challenge friends：公開紀錄＋累計勝場（`supabase/wj_challenge.sql`）

- Challenge friends 開房／加入／中途加入／Rejoin，選鳥色，同場共享 seed；host 選
  Last one standing 或 First to target。Challenge 成績**唔會**寫 `wj_scores`，Solo 榜不變。
- Word Jump 選模式、Challenge lobby、賽後結果有 **Match history / Challenge wins**。
  全部學校登入用戶可睇所有人最近 7 日比賽（每次載入 30 局，可 Load more），
  顯示房號、模式／目標、勝者、每人鳥色／分數／高度、距今時間。現有 presence 無 words 欄，唔估字數。
- Hub Leaderboard 加 **WJ Challenge wins**；兩個勝場榜都係公開頭 50 名，累計所有
  勝場，同分先按較早 `last_win_at`、再較少 `matches`、再 `user_id` 排。只列有勝場嘅玩家。
- 新表 `wj_challenge_matches`：完成當刻 immutable JSON snapshot，無 email、無 room/user FK，
  房間清理／rematch 唔會改舊結果；`(room_id, match_number)` unique。房間 `match_number`
  每次 waiting → playing 加 1（`wjc_private.number_match()` trigger）。
- `wjc_private.record_match()` 只喺 playing → finished 嘅同一個 transaction 插 snapshot，
  插入成功先更新 `wj_challenge_wins` 每人 matches、勝者 wins／last_win_at。無 browser insert，
  亦無新增公開寫入 RPC；新 helper 放 private schema，revoke PUBLIC／anon／authenticated execute。
- 完成／離開／heartbeat 會鎖房行，避免同時 finish 重複計、rematch 同舊 heartbeat 互相覆蓋；
  已完局 heartbeat 唔再改 final scoreboard。前端比分仍由玩家傳入，唔係防作弊系統。
- 對戰對手鳥即時位置（smooth2）：`WJC.startTransport()` 用 supabase-js v2 Realtime Broadcast，
  topic `wjc:<room UUID>`、`self:false`。每 80ms 傳 sender monotonic timestamp／session／seq、
  world x/y、vx/vy、實際 gravity（普通／boost／jet／prop／pause），落台／踩怪即傳 jump impulse。
  `receivePose()` 只接受目前 DB 房間成員及當局 started_at，拒絕舊 seq／舊 session／非有限數值。
  最低 arrival offset 校正兩部機唔同時鐘，180–320ms adaptive buffer 依 sender time 播放，
  缺包短暫 dead-reckon 後漸停；恢復時 blend-correct，唔直接 snap。世界座標每幀減本地 camY。
  左右穿邊 period 必須係 **WJ.W + 34**（本地 player 由 -17 ↔ W+17），唔係 WJ.W。
  Canvas 畫鳥，冇 per-frame DOM recreation。離開／完局／換房清 channel 及 timer；rematch 換 match key。
- DB heartbeat 仍然每約 400ms 計分／高度／fallen／勝負，玩家／房間 read 改約 800ms，
  同時只可一組 read，離開後舊 response 唔可重啟房間。Broadcast 連上就停獨立 DB pose writes；
  斷線時約 400ms 寫 pose fallback，DB snapshots 唔可覆蓋最近收到嘅 Broadcast，重複位置唔當新幀。
  **今次唔需要新 SQL**，冇 vx/vy 欄嘅舊 DB 亦可以完整 Broadcast，同時保留 x/y fallback。
  `supabase/wj_challenge_sync.sql` 只係可選嘅 DB fallback 速度欄，唔係新 transport 嘅必要條件。
- Realtime 用 public topic（毋須新 SQL／Realtime publication）；只傳 visual pose + user UUID，
  冇 names/emails／答案／分數／token。Room UUID 不是授權：知道 UUID 嘅人仍可訂閱／偽造 visual pose，
  呢個唔係防作弊系統；比分同勝負仍只經原有 RLS／RPC。若 project 禁用 public channels，
  會退回較慢 DB 同步。日後要 private Broadcast 必須另設 Realtime authorization RLS（先問老師）。
- 測試：`node --test tests/wj-challenge-smooth.test.cjs`（直接抽取 production inline JS，
  sender-clock offset／jitter／掉包／亂序／bounce／boost／pause／穿邊／DB fallback／channel cleanup）。
  無真實雙帳戶測試時唔好聲稱已實測兩部手機；老師需喺 preview 用兩個帳戶確認手感。

- **最多 4 人 + 贏家完局畫面（`supabase/wj_challenge_end_cap.sql`）**
  - 每間 Challenge 房最多 **4 個不同玩家**。Create／Join／Join mid-game 拒絕第 5 個新玩家（`ROOM_FULL`）；
    已係該房成員嘅 Rejoin 即使 4/4 仍然可以。名額計晒 players 表所有列（包括中途 leave 嘅人），
    唔好讓第 5 個人補位。Lobby 寫明最多 4 人；waiting 房顯示 `Players n/4`；滿房訊息 `Room is full (4/4).`。
    8 隻鳥色仍可揀（4 人方便分色），但名額只有 4。`max_players` 欄 default／現有房間都改成 4，並加 check constraint。
  - 真人試過 3 人局：兩個跌咗，贏家繼續跳、冇完局畫面。原因：跌倒嗰下如果已經有 heartbeat 在途，
    `pushNow(true)` 會直接 return（舊碼係 async，`.then` 仍然跑，但 `p_fallen=true` 從未送出）；
    `WJ.gameOver` 又停咗 game loop，之後再冇 heartbeat。伺服器仍當跌倒嘅人 alive，
    `try_finish` 唔會完局，贏家只靠自己嘅 800ms poll／heartbeat，永遠等唔到 `status=finished`。
  - 修正：`pushNow` 會 queue 再送 `p_fallen`；跌倒後有 500ms watch 重試直到寫入或完局。
    房間一變成 finished，**每個連住嘅客戶端（包括贏家、仲在跳）即刻停 loop 並顯示現有結束畫面**，
    唔好等贏家自己跌。通知來自：同一 `wjc:<room>` channel 嘅 Broadcast `finished`、
    `wj_challenge_rooms` 嘅 Realtime `postgres_changes` UPDATE、以及 poll（有人出局就改約 400ms）。
    贏家喺 poll 見到只剩自己都會再 heartbeat 一次觸發 `try_finish`。遲到嘅 poll 唔可以將已完局房間寫回 playing。
  - 對手 Leave 本來就會 `try_finish`；而家 **10 秒冇 heartbeat** 亦當出局（斷線），只剩一人就完局。
    仍然寫 immutable match row 同累計勝場；Challenge 分唔入 Solo 榜。
  - 老師若已經跑過 `wj_challenge.sql`，而家貼短嘅 `supabase/wj_challenge_end_cap.sql` 就夠，可重複跑，
    唔會清房／清勝場。未裝過 Challenge 就跑更新咗嘅整份 `wj_challenge.sql`（已包含呢個 delta）。
  - 測試：`node --test tests/wj-challenge-end-cap.test.cjs`（3 人 2 跌 → 贏家完局畫面；第 5 人被拒；
    成員 Rejoin 4/4 仍可；跌倒 heartbeat 會 queue）。

- RLS 只畀 authenticated SELECT。紀錄一過 7 日即不可讀；實體 expired rows 喺每次完局
  或重跑 SQL 時刪除（無 cron，閒置期間可能仍存 DB），**累計 wins／matches 永不跟住刪**。
- Guests 唔可睇兩個紀錄／榜，teacher preview 只讀，唔寫／開房。未有新表時 UI 提示重跑 SQL。
- 老師要喺 live project `mggnwzirjmibreimrwiq` **重跑整份** `supabase/wj_challenge.sql`，可重複跑。
  無舊局 backfill：以前 rematch 已覆寫嘅紀錄無法重建；新功能由安裝後完成嘅比賽開始計。
  若已經跑過呢份檔，之後只想加對手鳥同步用嘅 `vx`／`vy`，跑短嘅 `supabase/wj_challenge_sync.sql` 就夠，唔使再貼成份。
  若已經跑過呢份檔，而家要最多 4 人同贏家完局畫面，跑短嘅 `supabase/wj_challenge_end_cap.sql` 就夠。

### 10.14 Word Jump 背景音樂（2026-11 加）

- 檔案：`music/jump_music.mp3`（4.9MB，**唔入** `sw.js` CORE_ASSETS；第一次播由
  network-first SW 自己 cache）。
- `WJ.ensureMusic()` 建 `new Audio('/music/jump_music.mp3')`，loop、volume 0.3。
- `WJ.mount()` **唔會**起音樂；要撳 Start／Play again 後 `WJ.start()`／
  `WJ.restart()` 才 `WJ.startMusic(true)`（由頭播）。`WJ.stop()`（離開 view）、
  `WJ.gameOver()`、`WJ.toggleSound()` 熄聲時停；`WJ.togglePause()` 暫停／繼續。
- 音樂跟現有 `WJ.soundOn` 同一個 🔊 掣（即係 SFX 同音樂一齊開關），冇另加
  音樂掣；全屏時工具列收埋，要離開全屏才改。
- Autoplay：`WJ.mount()` 由 `changeView` 的 click 觸發，通常可播；如果 browser
  阻擋，`WJ.start()` 的 Start／Play again 手勢會再試。
- 未跑 SQL、未改 PWA 清單；2D canvas 遊戲本身不受影響。

---

## 11. New Vocab 字庫＋錯題簿（`supabase/new_vocab.sql`）

每個年級一份**長期字庫**（F3 / F4 / F6），唔會每日清走。老師刪咗先冇。
唔好加落 `SHEET_NAMES`（否則 Word Jump／隨機 battle 會撈埋）。

- 入口：Dictation Master → **New Vocab**。老師帳戶喺呢度揀年級、加字、改字、刪字。
  英文、中文、或者兩個一齊都可以存；撳 Confirm 之後先寫入並即刻出現喺下面；兩格都空先唔畀存。
- 老師喺英文格輸入（約 0.6 秒停頓或離開格）之後，前端會呼叫 `/api/cambridge?word=`（`api/cambridge.js`），
  向 Cambridge Dictionary 英文–繁體中文詞典查意思，自動填入中文格。預設用頭幾個簡短釋義，以「；」分隔；
  下面會列出其他意思做掣，撳一下就填入，之後仍然可以人手改。已有或老師改過嘅中文**唔會**被自動覆寫；
  改現有字時要再查就撳 **Look up**。查唔到或 API 失敗都唔會阻擋 Confirm，老師可以自己打中文。
  呢個 API 只喺 Vercel 部署之後先用得（本地開 `index.html` 冇 `/api`）。
- 學生同老師可以切 **Added today**（香港日期，睇 `created_at`）同 **All words**。
  練習（Listening／Recitation）只用而家個範圍入面**有英文**嘅字。
  淨係中文嘅卡會喺字表同老師字庫出現，拼寫同 Word Battle 會跳過，等老師補英文。
- 已分到年級嘅學生（顯示名稱例如 `4C 16 …` → F4，或老師下拉指定）只可以用**自己年級**嘅 New Vocab，包括 Listening／Recitation／Revision 同 Word Battle 字庫。**Unassigned** 學生（冇可用顯示名稱，或老師揀咗「—」）同**訪客**可以瀏覽／練習**全部年級**（F3＋F4＋F6）嘅新增生字，並可揀「All forms」或其中一個年級開 Word Battle。老師編輯字庫同開 battle 仍然可以揀 F3／F4／F6。Unassigned 學生喺老師 dashboard 仍然歸入 Unassigned 一組。呢個「讀全部年級」要跑 `supabase/new_vocab_unassigned_read.sql`（喺 `new_vocab.sql` 之後，可重複跑）。
- 學生進入 New Vocab 時，如果資料庫 `form` 仲係空，會用顯示名稱再 try `claim_own_form`，等 RLS（`my_form()`）可以讀到自己嗰份字庫，唔使再登入一次。老師加完字之後，已經開住 New Vocab 嘅學生會經 4 秒輪詢見到新字。
- 開住 New Vocab 會每 4 秒重新讀（`nvRefresh`），唔使再登入。老師喺編輯器輸入英／中文之後撳 **Confirm**（確認）掣，先會存入而家揀咗嗰個年級（F3／F4／F6）字庫，並即刻顯示喺下面字表；4 秒輪詢只係背景同步。空卡唔會存。刪除或清空仍然用 − 掣。如果 `new_vocab.sql`／`student_forms.sql` 未跑，Confirm **唔可以**默默失敗：編輯器上面會出現明顯提示，並列出要喺 Supabase SQL editor 按次序跑嘅檔案。
- 錯題簿：Dictation Master 嘅 **Error Book** 格，同 New Vocab 入面個掣。
  `checkAnswer` 第三次先錯就收入去（任何 Dictation 題目，包括 New Vocab）。
  喺錯題簿答對就刪走。學校帳戶登入寫 `error_book`（只可以讀寫自己）；訪客用
  `sessionStorage["error_book:guest-session"]`（只留喺呢次分頁，唔會寫上雲）。
  未登入嘅舊 key 仍然係 `localStorage["error_book:guest"]`。一有學校帳戶登入就清走呢個舊 guest key，避免共用電腦串到下一個學生。
- Word Battle：topic 揀 New Vocab，再揀年級，同「Full bank／Added today」。
  `set_battle_vocab` 把**有英文**嘅字抄入 `battle_rooms.vocab_words`。
  全房用同一個 snapshot＋原本 seed shuffle。字數少過題數就 cap，唔會用其他 topic 補。
  中文提示有就顯示，冇就當 English-only。
- SQL 順序：`login_tracking.sql` → `student_forms.sql` → battle 系列（最後加 `battle_rejoin.sql`，再跑 `battle_cat.sql`）→ `new_vocab.sql` → `new_vocab_unassigned_read.sql` → `student_forms_source.sql` → `guest_tracking.sql`（獨立，任何時候跑都得；已跑過嘅舊安裝再加 `guest_tracking_prune.sql` 就有 24 小時 prune）。Drive & Go! 要老師 30 人房就跑 `drive_and_go_class_room.sql`（喺 `drive_and_go.sql` 之後，可重跑）。每日連勝／個人頁再加 `user_streaks.sql`（獨立；建議喺 `wj_scores.sql` 之後跑，等 first practice 可以補最早 Word Jump 日期）同 `dictation_accuracy.sql`（加 `dictation_results.correct`，可獨立重跑）。
  未跑之前，登入同其他 topic 照用；New Vocab 同 Error Book 雲端表都未建立，畫面會清楚叫老師跑 SQL（同一份 `new_vocab.sql` 亦會建立錯題簿表）。Word Battle 若已經用得，而 `new_vocab.sql` 都跑過，就再跑 `new_vocab_unassigned_read.sql`，等 Unassigned／訪客讀到全部年級字庫。`student_forms.sql` 如果係舊版（未有 `form_source`），再跑 `student_forms_source.sql`（或重跑更新咗嘅 `student_forms.sql`），先會喺資料庫清走好似 `Liu Chun Ming` 呢啲冇班別代號但被自動寫成 F6 嘅舊分類，並保護老師下拉。呢兩份後補 SQL 都可以重複跑；未跑亦唔會整壞網站：老師畫面已經會把冇班別代號嘅名稱顯示為 Unassigned，但 `my_form()`／New Vocab RLS 可能仍用舊自動分類，直到後補 SQL 跑完。

## 12. PWA（可安裝 App）＋手機／平板體驗（2026-11 加）

### 12.1 檔案
| 檔案 | 作用 |
|---|---|
| `manifest.json` | Web App Manifest。用 `.json` 而唔用 `.webmanifest`，避免 Vercel 的 MIME 問題（Chrome 接受 `application/json`）。 |
| `sw.js` | Service worker：app shell precache＋network-first。必須放喺網站根目錄，scope 才覆蓋全站。 |
| `js/pwa.js` | 喺 `window.load` 之後 `navigator.serviceWorker.register('/sw.js')`；只喺 HTTPS／`localhost`／`127.0.0.1` 執行，失敗只 `console.warn`。 |
| `icons/app-icon.svg` | 圖示來源（Ragdoll 貓，同網站 mascot 同一設計）。 |
| `icons/icon-192.png`、`icon-512.png`、`icon-maskable-512.png`、`apple-touch-icon.png`、`favicon-32.png` | 由 SVG 產生。本機冇 PIL／ImageMagick，用 `qlmanage -t -s 1024` 轉 PNG，再 `sips -z` 縮。改圖示後要重新產生呢幾個檔。 |

- Manifest 重點：`start_url`／`scope` 都係 `/`、`display: standalone`、`orientation: any`、
  `theme_color`／`background_color` `#fff9f2`、192＋512 any icon＋512 maskable。
  冇 shortcuts、冇自訂安裝 UI，亦冇處理 `beforeinstallprompt`。
- `index.html` `<head>` 有 `manifest`、`theme-color`、`color-scheme`、`application-name`、
  `mobile-web-app-capable`、`apple-mobile-web-app-*`、apple-touch-icon 同 favicon。
  呢啲 meta 唔可以刪，否則 iPhone「加入主畫面」會用錯名／圖示。
- 安裝方法：Android／桌面 Chrome／Edge 用網址列或選單的 **Install app**；
  iPhone／iPad Safari 用 **Share → Add to Home Screen**。iOS 冇得用自訂安裝按鈕，
  亦**永遠**冇 element fullscreen（Apple 限制；Word Jump／Drive & Go! 會 fallback 去 CSS 全屏）。
- 如果將來網站唔再放喺根路徑，`manifest.json` 的 `start_url`／`scope`／icons，
  同 `sw.js` 的 precache 路徑要一齊改。

### 12.2 Service worker 策略
- **Network-first**：online 一定先拿新 deploy，成功就更新 cache；斷網或 fetch 失敗才用 cache。
  非 OK response（例如死 server／captive portal 回 5xx）都會 fallback 去 cached `/index.html`，
  確保 app shell 仍然開得返。唔好改成 cache-first，否則老師 push 完會見到舊版。
- `CACHE_NAME` 而家係 `learnity-pwa-v3`。改 `CORE_ASSETS` 清單或者 offline 行為時**一定**要 bump
  （例如 `v3`），`activate` 會刪走其他 `learnity-` 開頭的舊 cache。
- `CORE_ASSETS` 有 19 個：`index.html`、manifest、4 個圖示、
  12 個功能 JS＋`js/pwa.js`。加新 `js/xxx.js` 時要同時加落 `sw.js`，
  否則第一次 offline 開會少一個檔案。
- 只快取同源靜態檔，以及 allowlist 的 CDN：`cdn.tailwindcss.com`、`fonts.googleapis.com`、
  `fonts.gstatic.com`、`cdn.jsdelivr.net`（Supabase JS）。
- **唔快取**：`/api/`（Cambridge 查字）、`/sw.js` 自己、`/favicon.ico`、任何 `*.supabase.co`
  （auth／資料要即時，亦唔應該落 cache）。
- 因為 `skipWaiting()`＋`clients.claim()`，新 SW 會即刻接管；如果部署後仍然見到舊版，
  關閉所有 app 分頁再開，或者喺 browser 度 hard refresh 一次。
- 本機測試：`python3 -m http.server` 開 localhost 就用得 SW（HTTPS 或 localhost 才註冊）。
  測試 offline：先 online 開一次等 precache 完成，再停 server／轉 offline 後 reload，
  應該仍然見到 login／hub、`DG`、Fredoka 字體。`file://` 開 `index.html` 唔會有 SW，但網站照用。

### 12.3 手機／平板版面（2026-11）
- Viewport 有 `viewport-fit=cover`；`#app` 同 `#login-view` 的 padding 加埋
  `env(safe-area-inset-*)`，所以 installed PWA／瀏海機／橫向時內容唔會貼住 notch 或 Home indicator。
- **Tap target 最少 44px**（Apple HIG／WCAG 2.5.5）：
  `#auth-btn`、所有 view 的返回掣（`.nav-back`，HTML 已加 class）、
  Word Jump 工具列（`#wj-toolbar` 的 button／select）、
  同埋遊戲內細 pill（`#wj-fs-enter`／`#wj-exit-fs`／`#wj-re-btn`／`#wj-tilt-fs`）。
  Drive & Go! 的 `#dg-fs-btn` 為咗唔撐大 61px HUD 而保持細 pill，
  但用 `::after` 加大透明 hit area，唔好刪。
  加新返回掣或工具列按鈕時要跟呢個規則，唔好只靠 `py-2 text-sm`（實際高度會得 36px）。
- 對比度：`.btn-paw` 背景用 `#e8590c`（白字過 3:1 大字門檻；原本 `#ff922b` 只有 2.2:1）；
  Hub 的 Start Quest 用 `bg-green-600`；`#login-view .text-orange-600` 同
  `#app .speech-bubble.text-orange-600` 用 `#c2410c`；`text-gray-400` 在 app／login 內
  覆寫成 `#6b7280`（原本 2.5:1）。呢幾個 override 喺 `index.html` `<style>` 內，
  用 id／雙 class specificity 壓過 Tailwind runtime CSS。
- `#login-view` 有 `role="main"`（未登入時 `<main id="main-container">` 係 hidden，
  冇呢個 landmark Lighthouse 會扣分）；`<meta name="description">` 亦已加。
- 實測尺寸：375×667、390×844、430×932、768×1024、1024×768、844×390，
  login／hub／grammar／revision／Drive & Go! 設定／dictation／battle／wordjump
  全部 `overflowX = 0`，冇橫向爆版；返回掣、工具列、Word Jump 細掣全部 ≥ 44px。
- Lighthouse（localhost，login 同 guest hub）：Accessibility／Best Practices／SEO 全部 1.0。
- 已知限制：`canvas` 內容喺 OpenCode browser 截圖會空白（要 `toDataURL()` 轉 `<img>`），
  同 PWA 無關；iPhone Safari 的瀏覽器 bar 喺 standalone 以外仍然存在，
  要 Add to Home Screen 才會消失。

### 12.4 底部 tab bar（2026-11 加）

手機同 iPad 用 Instagram 式固定底欄，**五個 tab，次序固定**：

| Tab | Icon | 開啟 view | Active 範圍 |
|---|---|---|---|
| Home | 🏠 | `hub-view` | hub、grammar 系列、my-records、leaderboard |
| Dictation | ✍️ | `home-view` | home、sub-category、word-list、quiz、error-book |
| Jump | 🦘 | `wordjump-view` | wordjump |
| Battle | ⚔️ | `battle-view` | battle |
| Me | 🐱 | `profile-view` | profile（個人頁，見 §12.6） |

- Markup 係 `#app` 最尾（`</main>` 之後）的 `<nav id="bottom-nav">`；五個
  `[data-nav-view]` button 直接 call `changeView(...)`，所以每個 tab 永遠返到該區根頁。
  冇 Admin shortcut。Active tab 用深橙（`#c2410c`，11px 字過 4.5:1）＋底線；`updateBottomNav()`
  會設 `aria-current="page"`。
- 舊嘅 **Error** tab 已換成 **Me／🐱**（個人頁）。Error Book 冇消失：Hub 的
  Error Book 卡、Dictation 版面同個人頁左下角嘅「📕 Error Book」掣都入到
  `error-book-view`；打開 Error Book 時 bottom bar 仍然會出，active tab 係 Dictation。
- CSS 喺 `index.html` `<style>` 的 `/* ---- Bottom tab bar ---- */`：
  `position:fixed`、`z-index:900`、56px 高 tab、`env(safe-area-inset-bottom)`、
  半透明白底＋blur。內層 `.bottom-nav-inner` 在 iPad／桌面固定 **max-width 720px
  居中**，唔會變成左邊 rail。`#app` 用 **`min-height:100%`**（唔係 `height:100%`），
  所以 content 長過 viewport 時 padding-bottom 會喺內容之後，最後一張卡唔會被
  fixed bar 蓋住。`body.has-bottom-nav #app` 加
  `padding-bottom: calc(4.5rem + env(safe-area-inset-bottom))`，實測最後一張卡
  底部距離 nav 頂約 **14px**（390×844、768×1024、844×390、320×568）。
- 顯示規則（`js/shared.js`）：
  - `NAV_TABS`（5 個 root view）、`NAV_HIDDEN_VIEWS = ['quiz-view',
    'drive-and-go-view', 'admin-view']`。
  - `navTabForView(viewId)` 決定 active tab；grammar 樹／records／leaderboard
    都 highlight Home；`error-book-view` highlight Dictation；`profile-view`
    highlight Me。
  - `navShouldShow(viewId)`：上面三個隱藏 view 唔出 bar；`wordjump-view`
    喺 intro／pause／game-over **同 windowed 遊玩中都出 bar**，只有
    `WJ.fsOn()`（原生全屏或 CSS 全屏）時收埋。windowed 時頁面會 scroll，
    `WJ.revealStage()` 會將成個 stage（連左右方向 pad）拉到 bar 之上；
    `battle-view` 只在 lobby／result／class 出，
    `waiting`／`play` 進行中會收埋（避免蓋住計分板／輸入）。
    `class` 係老師嘅班際直播板（`battleRenderClassHost()` 只俾 host／老師），
    保留 bar 方便老師一撳返 Home；學生喺 `waiting`／`play` 仍然收埋。
    Word Jump 每次 start／stop／pause／restart／gameOver 同全屏切換都會 call
    `WJ.updateNav()` 同步 bar。
  - `currentView` 喺 `changeView()` 更新，之後 call `updateBottomNav()`；
    `showApp()`／`showLogin()` 亦會更新（未登入一定冇 bar）。
  - Battle 面板切換經 `battleShowPanel()` 寫 `window.navBattlePanel` 再
    call `updateBottomNav()`。**加新 battle 面板時要記住呢步**，否則 bar
    可能喺進行中仍然出現。
  - 進行中 bar 收埋時，`#battle-back-btn`（top Back to Hub）會自動顯示返；
    bar 出現時 CSS `body.has-bottom-nav #battle-back-btn { display:none; }`
    收埋佢。呢個係「bar 或 back 掣，任何時候都有一個出口」的做法。
- 重複的頂層返回掣已移除：`grammar-view`、`home-view`、`sub-category-view`、
  `error-book-view`、`my-records-view`、`leaderboard-view` 的 Back to Hub／Topics。
  **保留** section 內的 breadcrumb（sentence structures → grammar、detail → list、
  tenses → revision、tense list → tenses、word list → activities），以及
  quiz／Word Jump／Admin／active battle 的退出掣。因為 bar 已提供根頁導航，
  移除的只係重複的根頁返回。
- 加新 view／tab 時：
  1. 如果係新 tab，`NAV_TABS`／`NAV_HIDDEN_VIEWS`／`navTabForView()` 同
     HTML button 要一齊改（而家固定 5 格，唔好加到 6 格以上）。
  2. 新 view 預設會出 bar；如果係全屏遊戲或需要沉浸，加入 `NAV_HIDDEN_VIEWS`，
     並確保該 view 有自己嘅退出掣。
  3. `sw.js` 的 `CORE_ASSETS` 唔使改（呢個改動冇新 JS 檔）。
- 實測（iframe 載入真 `index.html`，模擬登入後量度）：320×568、375×667、390×844、
  430×932、768×1024、1024×768、844×390 全部 `overflowX = 0`；tab 高度 56px、
  nav 高度 58px、iPad／橫向內層 720px；lobby／result／class／profile／error-book 出 bar，
  wordjump 喺 intro／pause／game-over 同 windowed 遊玩出 bar（只有全屏收埋），
  waiting／play／quiz／admin 收埋；`#app` 底部 padding 72px
  （bar 58px ＋ 14px 空隙）。320px 時 header 會縮細 wordmark、收埋副標題同減
  Logout padding（`@media (max-width:360px)`），避免橫向爆版。

### 12.5 每日練習連勝（streak）＋補救卡

鼓勵學生每日做一次練習：連續嘅香港日曆日會有火（flame）數量，第一次做完當日
練習會彈 **「You made it!」** 卡，之後同一天再完成唔會再加。學校 Google 帳戶
經 Supabase 跨裝置同步；訪客同老師 preview 只用 browser session。

- **計法**：`hkDayKey()`（`Asia/Hong_Kong`）做日界。`recordDailyPractice(source, options)`
  （`js/shared.js`）只喺 `state.last !== 今日` 時寫入：
  - 上次係**昨日** → `count + 1`（連勝繼續）。
  - 斷咗 1 日或以上，而 `state.count > 0` 且 `gap - 1 <= repairCards` → 用補救卡
    補齊所有漏做日，`count + 1`，`cards -= gap - 1`，popup 會寫
    「Repair card used」同剩幾張。**count 已經係 0（例如 backfill 嘅舊 streak）
    就唔會用卡**，直接由 1 重新開始，補救卡保留。
  - 漏做日數多過手上補救卡 → **唔會**浪費卡，`count = 1` 重新開始。
  - 從未做過 → `count = 1`，`cards` 預設 **3**。
  - 同一天再 call → `{ extended:false }`，唔彈卡、唔改數。
  - `best` 永遠係歷史最高，斷連勝都保留；badge 只顯示當前火數。
  - 補救卡**每人總共 3 張，不會自動補充**。用晒之後再斷一日就會清零。
  - 未做今日但仲可以用卡補救時，badge 仍然顯示舊火數（`pendingRepair`）；
    冇卡再斷就顯示 0。`showStreakInfo()` 會講「finish today to spend N cards」。
- **邊啲完成會計**（全部經同一個 hook，**出咗結果畫面之後**才彈卡）：
  - Dictation `finishQuiz()` → `recordDailyPractice('Dictation', { delayMs: 700 })`
    （call 喺 `window.lastFinalView = finalView` 之後）。
  - Word Jump 單人 `WJ.gameOver()` → `'Word Jump'`（call 喺 `WJ.setOverlay(...)` 之後）。
  - Word Jump Challenge `WJC.showResults()` → `'Word Jump'`（全房完賽先計；
    中途跌倒唔會打斷比賽畫面）。
  - Drive & Go! `DG.finishPlayer()` → `'Drive & Go!'`（Solo／多人，call 喺
    `showSoloResults`／`showMpOwnResults` 之後）。
  - Word Battle `battleFinishLocal()` → `'Word Battle'`（call 喺
    `await battlePoll()` 之後；**只計 1v1，`mode === 'class'` 班際房完全唔計**，
    因為班際房可以包括冇答過題嘅學生）。
  - 只有**完成**先計，開始／中途離開唔計。加新遊戲喺完成位 call 同一個 helper，
    並盡量喺結果 DOM 出現之後才 call。
- **持久化 / 跨裝置**：
  - 學校帳戶：Supabase `user_streaks`（`supabase/user_streaks.sql`，老師要自己喺
    SQL editor 跑一次；可重跑）。每 user 一行：`streak_count`、`streak_best`、
    `last_practice_date`、`repair_cards`、`first_seen`、`recent_days`。
    `recent_days` 係最近 14 個香港練習日（JSON array），用嚟畫 Me 頁 7 日圓點。
    RLS：select 公開（同 `dictation_results` 一樣，等 Hub 連勝榜讀得到），
    insert／update 只准 `auth.uid() = user_id`，冇 delete policy。
  - 登入時 `showApp()` 會 call `loadCloudStreak()`：讀 cloud row，同本機 mirror
    合併（較新 `last` 為準；同日取 max count/best、min cards、最早 `first_seen`），
    再寫返 localStorage。新裝置第一次登入會等 cloud 合併完才計數，避免當成新生。
  - 每次 record 會 fire-and-forget upsert 上 cloud；失敗只 `console.warn`，
    本機 mirror 照用。SQL 未跑時全部功能照用，只係唔會跨裝置。
  - `supabase/user_streaks.sql` 最後有一段可重跑 backfill：由
    `dictation_results`／`wj_scores`／`drive_and_go_solo_scores`／
    `drive_and_go_multi_scores`／`battle_rooms.finished_at` 抽香港練習日，
    計連續 run，寫入 `streak_count`（最新一段；**只限最後練習係今日或昨日，
    否則寫 0**）、`streak_best`（最長一段）、`last_practice_date` 同
    `first_seen`。**唔會扣補救卡**，亦唔會用舊歷史覆蓋較新嘅 row；
    舊學生嘅已斷 streak 只保留 `best`，當前顯示 0，第一次再練習由 1 開始。
    Word Battle 只計 1v1（`coalesce(mode,'duel') <> 'class'`），班際房完全唔計。
  - 本機 mirror key：`localStorage['learniTY_streak:user:<uuid>']`（學校帳戶）、
    `sessionStorage['learniTY_streak:preview:<form>']`（老師 preview）、
    `sessionStorage['learniTY_streak:guest']`（訪客，下一個同學唔會繼承）。
  - 記錄格式：`{ last:'YYYY-MM-DD', count, best, cards, firstSeen }`。
- **UI**：
  - Header `#auth-area` 最左邊有 `#streak-badge`（🔥 + `#streak-count`），
    min 44px tap target。`updateStreakBadge()` 喺 `updateAuthUI()`、`showApp()`、
    `loadCloudStreak()`、`recordDailyPractice()` 後更新。0 火時灰色；有火時火苗
    輕微擺動（`prefers-reduced-motion` 會停）。
  - 撳 badge → `showStreakInfo()` 用 mascot bubble 講今日做咗未／仲有幾多日／
    要唔要用補救卡。
  - 「You made it!」卡係 `showStreakPopup()` 動態建立嘅 `#streak-popup`
    （`z-index: 10060`），有 backdrop、`role="dialog"`、Esc／backdrop 都可以關，
    標題固定 `You made it!`，下面顯示 `🔥 N day(s)`、鼓勵句、`🛟 N repair cards
    left`、用卡時 `🛟 N repair card(s) used`、來源（例如 `DICTATION COMPLETE`）
    同 `Keep going!` 掣。`streak-popup-btn` 最少 48px 高。
  - 全屏遊戲（Word Jump／Drive & Go!）彈卡時，`streakPopupHost()` 會將卡放入
    `document.fullscreenElement`（原生全屏只 render 該 subtree），並且
    `stopPropagation()`，唔會當成轉向／射擊輸入。
  - 橫向短螢幕（`orientation: landscape` 且 `max-height: 480px`）有 compact CSS：
    flame／字級／padding 縮細，卡高約 250px，844×390 免捲動。其他情況
    `.streak-popup-card` 有 `max-height: calc(100dvh - 2rem); overflow-y:auto`
    做最後防線。
- **窄螢幕 header**：≤480px 時 `#auth-nickname` 收埋；≤360px 再縮細 wordmark、
  收埋副標題同減 Logout padding，避免 brand＋🔥＋Logout 橫向爆版。學生名仍然
  喺 records／leaderboard／admin 見到。實測 320、375、390、430 全部 `overflowX = 0`。
- **改動提示**：想改預設卡數改 `STREAK_DEFAULT_CARDS`；想「斷一日唔清零」
  改 `recordDailyPractice()` 嘅 repair 條件；想轉用其他持久化要同時改
  `loadCloudStreak()`／`saveCloudStreak()`。想加「連勝 7 日」獎勵，喺
  `recordDailyPractice()` 收到 `count` 之後加（只喺 `extended:true` 時做）。

### 12.6 「Me」個人頁（`profile-view`）

底部第 5 個 tab 由 Error 改成 **Me／🐱**，開啟 `#profile-view`（`js/profile.js`）。
Error Book 仍然可以經 Hub 卡、Dictation 版面同個人頁嘅「📕 Error Book」掣進入。

- **顯示內容**：
  - 學生名（Google `full_name` 或電郵 local-part）＋電郵；preview 顯示年級；
    訪客顯示 `Guest`。
  - 當前連勝日數、最佳連勝、剩餘補救卡、今日做咗未／仲有幾多日到期。
  - **Last 7 days**：7 個圓點（今日同之前 6 日），`recent_days` 有嗰日就變橙，
    今日多一圈 outline；下面寫 `3 / 7 days`。≤360px 圓點縮到 24px，
    320px 都唔會橫向爆版。
  - **Dictation quizzes**：做過幾多次（`dictation_results` 的 exact count）。
  - **Average accuracy**：`sum(correct) / sum(total)`，顯示整數 `%`。
    舊 `dictation_results` row 冇 `correct`（NULL）會跳過；如果全部舊 row
    都冇，顯示 `—` 同「Accuracy starts from new quizzes」。未跑
    `supabase/dictation_accuracy.sql` 時查詢會 fallback，顯示 `—` 同提示。
    超過 1,000 次時只抽最新 1,000 次計。
  - **Word Jump best**：`wj_leaderboard` 的個人最佳（冇就用 `wj_scores` 最高分）；
    hover 有 words／height。訪客／preview 用 `wj_best`。
  - **First practice**：`user_streaks.first_seen`，意思係**第一次完成練習**
    （唔係第一次登入）。第一次 `recordDailyPractice()` 才寫入；未做過就顯示
    `Not yet`。新 row 會先同最早 `dictation_results`／`wj_scores` 比較，
    所以舊學生都補到最早做功課日期。格式 `13 Nov 2026`（香港時區）。
  - 底部有 Error Book、My Records、Leaderboard 掣；訪客會收埋後兩者。
- **資料來源**：學校帳戶讀 cloud；訪客／preview 讀 `dict_history_guest`／
  `dict_history:preview:<form>` 同 `wj_best`。雲端暫時失敗時顯示 `—` 同
  一句提示，唔會令個人頁爆。
- **老師 dashboard**：Admin「Student Logins」每行加 `🔥 N days`（用
  `streakCurrentCount()` 計 effective current streak；hover 顯示 best／last），
  另外有一行細字 `best N · last 3 days ago`（`hkRelativeDay()`：Today／
  Yesterday／N days ago），手機都睇到。
  stats 由 3 格變 4 格，加「Active Streaks」（直接由 `user_streaks`
  計，唔靠 login 名單，所以名單載入失敗都仍然準）。卡片右上角有
  **Last login／🔥 Streak** 排序掣（`setLoginAdminSort()`，記住喺
  `localStorage['learniTY_login_sort']`，Refresh 後保持）；Streak 模式
  按 effective current streak → best → 名排，再按年級分組。
  `loadLoginAdmin()` 會一齊讀 `user_streaks`；未跑 SQL 時該格顯示 `—`，
  login 名單照出。
- **Hub Leaderboard**：新增 **🔥 Streaks** tab，顯示 top 10 當前連勝。
  用 `streakCurrentCount()` 過濾已斷兼冇卡補嘅 row；排序 current desc →
  `streak_best` desc → 名。學生睇平坦名單，自己嗰行有 `(you)`＋ring；
  如果排 11 名或以外，榜下面會多一張 **Your rank: #N** 卡。
  老師按年級分組。未跑 `user_streaks.sql` 或未有公開 select policy 時
  顯示提示／空榜。
- **開啟方式**：`changeView('profile-view')` 會 call `loadProfile()`，
  先畫本機／session 數字，再 `await loadCloudStreak()` 和
  `dictation_results`／`wj_leaderboard` 更新。`currentView` 已離開 profile 時
  遲來的 response 會直接丟棄。
- **SQL**：需要 `supabase/user_streaks.sql`（連勝／補救卡／first_seen）
  同 `supabase/dictation_accuracy.sql`（`dictation_results.correct`，平均正確率用）。
  Dictation 統計用返現有 `dictation_results`（§5），Word Jump 用返
  `supabase/wj_scores.sql`。未跑 `user_streaks.sql` 時個人頁照開，只係
  first practice 只計本機、連勝唔跨裝置；未跑 `dictation_accuracy.sql`
  時平均正確率顯示 `—`，其他照用。
- **可選 cleanup（只係文件參考，唔會自動跑）**：如果將來要刪 2026-11-13
  老師帳戶嗰條測試 quiz，可以喺 Supabase SQL Editor 跑下面段 SQL。
  **唔好隨便跑**；如果老師之後再做過練習，skip `update user_streaks`
  部分，避免清走新進度。**跑完之後，刪走呢段 SQL（2026-11 決定）。**

```sql
-- Delete the 2026-11-13 teacher test quiz (New Vocab / recitation, 4/4).
delete from public.dictation_results
where user_id = '3c922ca5-ab23-4a2b-8d05-22bcf4f0ae60'
  and created_at = '2026-11-13T08:29:57.305707+00:00';

-- Restore the teacher's pre-test streak (4 days, ended 2026-11-12, 3 cards).
-- Skip this update if the teacher has practised since the test.
update public.user_streaks
set streak_count = 4,
    streak_best = 4,
    last_practice_date = '2026-11-12',
    repair_cards = 3,
    recent_days = '["2026-11-09","2026-11-10","2026-11-11","2026-11-12"]'::jsonb,
    updated_at = now()
where user_id = '3c922ca5-ab23-4a2b-8d05-22bcf4f0ae60';

-- Check the result.
select user_id, streak_count, streak_best, last_practice_date, repair_cards, recent_days
from public.user_streaks
where user_id = '3c922ca5-ab23-4a2b-8d05-22bcf4f0ae60';
```

- **實測**：320、375、390 profile 卡同 7 日圓點全部 `overflowX = 0`
  （≤360px 圓點 24px）；Error Book 掣 44px 高；guest 隱藏
  My Records／Leaderboard；🔥 Streaks 榜用假 row 測過排序／過濾（斷 8 日
  + 3 張卡唔入榜，斷 3 日仍然入）同 Top 10 以外嘅 **Your rank: #12** 卡；
  Admin Student Logins 第 4 格「Active Streaks」、每行 `🔥 N days`＋
  `best · last` 細字、Last login／🔥 Streak 排序（按連勝／登入時間）用假
  data 測過；320 admin 亦 `overflowX = 0`（順手加咗 Grammar admin 按鈕
  `flex-wrap`）。平均正確率用 guest 3 個 quiz（220/300）測到 **73%**；
  未跑 `dictation_accuracy.sql` 時真學生 profile 顯示 `—` 同提示，唔會壞。
  Lighthouse（guest profile）Accessibility／Best Practices／SEO 全部 1.0。
  未用真實 Gmail 帳戶 + live `user_streaks` row 測過。

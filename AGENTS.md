# LearniTY Dictation — AI Agent 交接文檔

> 閱讀對象：本專案擁有人＋幫佢改 code 嘅 AI agent。
> 版本基準：GitHub `charmainewty23-svg/tydictation` main 分支原版（單一 `index.html`，SVG 貓 mascot，無貼圖）。
> 注意：另有一個本地貼圖分支（大麻成 sticker 版）存在於另一部機，**唔好**將貼圖改動推上本 repo。

---

## 1. 專案一句話＋部署鏈

- 單檔靜態英文學習站：Grammar Quest（句型＋時態）＋ Dictation Master（聽寫：Listening / Recitation / Revision）。
- 全站得一個源檔：`index.html`（~754 行：Tailwind CDN＋Fredoka＋內聯 SVG＋內聯 `<script>`）。
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

### Views（`changeView(viewId)` 切換，全部 `.view` 預設 hidden）
| view id | 內容 |
|---|---|
| `hub-view` | Grammar／Dictation 兩張入口卡 |
| `grammar-view` | Sentence Structures／Revision 入口 |
| `sentence-structures-view` | 6 個句型（`showStructureDetail`） |
| `grammar-revision-view` | 時態格（`renderTenseGrid`，`showTenseDetail`） |
| `grammar-detail-view` | 文法詳情（`#grammar-detail-content` 動態填） |
| `home-view` | topic 格（Sheet 載入後填）＋ New Vocab ＋ Error Book |
| `sub-category-view` | Listening／Recitation／Revision；New Vocab 時加字庫管理同「今日／全部」 |
| `error-book-view` | 學生錯題簿 |
| `quiz-view` | 測驗主體（speaker 鈕／中文大字／input／hint／計分） |
| `word-list-view` | Revision 單字表（`showWordList`） |
| `battle-view` | Word Battle（1v1／班際）＋ Word Jump 入口卡 |
| `wordjump-view` | Word Jump 遊戲（`#wj-canvas`，見 §10） |

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

### Phase 1 — 本地成績（零後端，淨改 index.html）
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
  mode text, score int, total int, created_at timestamptz default now());
alter table dictation_results enable row level security;
create policy "read all" on dictation_results for select using (true);
create policy "insert own" on dictation_results for insert with check (auth.uid() = user_id);
```

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
2. 每次入頁 fetch 足 20 個 tabs，無快取。修：抄 `sessionStorage` 10 分鐘快取（其他專案現成 pattern）。
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
- 誠實聲明：分數由 client 寫入，可以造假；房間、代碼、加入資格係 server 端 RLS／RPC 管。
- 舊房保留 **7 日**（`create_battle` 時順手清走更舊嘅）。

### 9.3 班際模式 — `supabase/battle_class.sql`（要喺 9.2 之後跑）
- 加欄：`battle_rooms.mode`（`duel`／`class`）、`max_players`、`finished_at`。
- 新 RPC：`create_class_battle(topic, seed, max_players)`（**只限 ADMIN_EMAIL**）、
  `end_class_battle(room_id)`（老師提早收卷）。
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
- SQL：更新 `join_battle`，已經係成員／主持就可以再用代碼入返進行中或完場嘅房；
  若只係早走被標成 `done`、但 `progress` 未做完，會清走 `done`。另加
  `rejoin_battle(p_room_id, p_code)`。未跑呢份 SQL 都唔會壞：只要學生只係返咗 Hub
  （冇撳 Leave room），前端可以直接讀返房間。如果之前已經 `leave_battle` 咗一場進行中嘅
  battle，就要跑呢份 SQL 先可以再入。可重複跑。

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
- Admin Dashboard 新卡「🕵️ Guest logins」→ `loadGuestAdmin()`：總登入數、今日（HK 時間）、
  最近 7 日，下面係最近 usage（feature、detail、相對時間、hover 顯示 HK 時間）。
  未跑 SQL 嘅話張卡會顯示提示，唔會整壞 dashboard 其他部分。
- 訪客資料**唔會**出現喺學生排行榜、My Records、Word Jump Top 7 或者 `student_logins` 年級分組；
  訪客亦開唔到 admin view（`GUEST_BLOCKED_VIEWS`＋`isAdmin()`）。

---

## 10. Word Jump（Doodle Jump 式爬高認字遊戲）

入口：Hub 嘅「🦘 Word Jump」卡，或者 `battle-view` 頂部嘅同一張卡 → `openWordJump(...)` → `wordjump-view`。返回會返去撳入嚟嗰一頁（Hub 或 Word Battle）。
純前端、單機、**唔需要 Supabase／SQL**，全部邏輯喺 `index.html` 一個
`const WJ = { … }` 物件（喺 `window.onload` 之前），HTML 係 `#wordjump-view`。

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
  **但係 108 px/s 唔夠橫越成個畫面**：滯空 1.58s 只行到 **170px**，所以平台
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

**三個「跳唔到」修正（2026-11，用戶連續三次反映）：**

1. **下一個台一定跳到**（`WJ.spawnPlatform` / `WJ.horizBudget`）。舊式
   `reach = speedCap() × 1.58s × 0.8 + 平台寬` 用咗**成段滯空**，但下一個台如果
   已經離腳 80–275px，玩家係落返嚟途中就穿過佢，實際橫向時間短過 1.58s。
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
- 之後：步距 `rand(76, 102)`、平台寬 `rand(62, 90)`（原本 `84–112`）。
- 綠台權重 `52 - 16d` → `58 - 14d`，實測綠台佔 **59–66%**（原本 ~52%）。
手感係「夠高、睇得清字」：`GRAVITY 1030`／`JUMP_V -811` → 跳高仍然 **319px**、
每次滯空 **1.58s**。呢對係由上一版 `1610`／`−1014`（滯空 1.26s，老師反映彈跳太快、
睇唔切生字）用滯空 ×1.25、跳高不變算出嚟：`GRAVITY ÷ 1.25²`、`JUMP_V ÷ 1.25`。
再早係 1300／−822（跳高 256px，跳唔夠高）、2000／−1030（1.03s 太急）同
750／−645（1.72s 太飄）。想改而**保持跳高不變**：滯空乘 s，就 `GRAVITY ÷ s²`、
`JUMP_V ÷ s`。例如想再「快上快落」（滯空 ×0.9）：`GRAVITY 1272`、`JUMP_V -730`。
（跳高 `h = v² / 2g`，所以兩個一齊亂改會跳唔到／跳過龍。）
道具上升速度 `JET_V -765`／`PROP_V -193` 同字磚加成 `WORD_BOOST -979`（仍然
彈高 465px）都要跟同一個滯空倍數一齊調。

### 10.4 道具（平台上方圓形徽章，踩中該平台即觸發）
彈簧 ×1.9 跳力 · 竹蜻蜓慢速上升 2.6 秒 · 火箭背包 1.5 秒高速 ·
彈簧鞋 6 次 ×1.42 跳力 · 護盾 8 秒（擋一次怪物／UFO，黑洞同跌落擋唔到）。

### 10.5 敵人
- **怪物**：紫色，平台上方左右巡邏。碰到 = game over；可射爆、踩頭踩扁（+30 分），
  彩虹模式撞到會直接消滅。
- **UFO**：下方有吸力光束，入咗光束會被拉向它；可射爆（+40 分）。
- **黑洞**：160px 內有引力，中心 28px 內必死，護盾擋唔到。

### 10.6 題目：睇中文，跳上正確英文
- 每隔 `QUIZ_GAP`（`380–500`，經 `min(nextQuizY, topY-115)` 修正後實測**每 ~510px**）
  有一排**紫色字磚**（`spawnQuizRow`），一排 2 個
  （難度 <0.3）或 3 個（之後）：1 個正確答案 + 1–2 個同題庫抽出嚟嘅干擾項。
- HUD 頂部白卡顯示**中文**（`row.zh`）＋「JUMP ON THE RIGHT WORD」；
  顯示嘅係 `WJ.activeRow()` = 玩家頭上最近而未答嗰排，所以唔會預早爆雷。
- 踩中正確字磚：**彈高 465px**（`WJ.WORD_BOOST = -979` 取代原本 `JUMP_V -811`
  嘅反彈，`h = 979² / (2 × 1030) = 465`）、`+60 + 字長×5 + min(90, 連對×10)` 分、
  讀出英文（SpeechSynthesis）、toast ✅ 顯示 `⬆ 465px`；每連續 5 題送護盾 8 秒。
  **呢個係主要上分途徑**：彈高直接推高 `maxClimb`，即係 height 分。
  `land()` 讀 `WJ.boostPending`（`answerRow()` 答對時設 true），所以一定要
  喺 `land()` 入面 apply，唔可以喺 `answerRow()` 直接改 `p.vy`（會被覆蓋）。
  想彈得更高／矮就改 `WJ.WORD_BOOST`（-979 ≈ 465px；-1120 ≈ 609px；-800 ≈ 311px）。
  **改 `WORD_BOOST` 時要連 `WJ.BOOST_VY`／`WJ.BOOST_G` 一齊改**（見下）。
- **Boost 滯空 ×1.35（2026-11）**：老師反映答對之後反應時間太短，睇唔切下一條問題。
  所以答對嗰下嘅發射會用**慢滯空版**：`WJ.BOOST_VY = -725`（= -979 ÷ 1.35）取代
  `p.vy`，同時設 `p.boostHang = true`；`WJ.update()` 嘅垂直積分見到
  `p.boostHang` 就用 `WJ.BOOST_G = 565`（= 1030 ÷ 1.35²）而唔係 `WJ.GRAVITY`。
  高度不變：`725² / (2 × 565) ≈ 465px`，但滯空 ×1.35（`2v/g = 2×725/565 ≈ 2.57s`，
  原本 1.9s），學生有更多時間揀下一個字。
  普通跳（`JUMP_V -811`／`GRAVITY 1030`，1.58s／319px）**完全唔受影響**。
  `p.boostHang` 會喺**下一次 `land()`**、`WJ.gameOver()` 清走；`WJ.reset()` 重建 player 所以 RE／重開都會清。
  jet／prop 期間照舊直接設定 `p.vy`，唔會用 BOOST_G。想再慢啲就加大
  `WJ.WORD_BOOST_HANG`（1.35→1.5 時 BOOST_VY ≈ -653、BOOST_G ≈ 458），**兩個數都要按
  `WORD_BOOST ÷ s` 同 `GRAVITY ÷ s²` 重算**，否則彈高會變。冇 jet／prop 嘅情況下
  boost 直接 `p.vy = WJ.BOOST_VY`（唔係 `Math.min`——-725 比 -811 弱，min 會食咗個 boost）。
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
- 調手感改 `WJ.GRAVITY`（1030）／`WJ.JUMP_V`（−811）／`WJ.MOVE_MAX`（240）／
  `WJ.STEER_RATE`（16）／`WJ.STEER_STOP`（18）／`WJ.TILT_RANGE`（11）／
  `WJ.TILT_CURVE`（1.6）。想「收步更快」就加 `STEER_STOP`、想「滑多啲」就減。
  想改滯空又保持跳高：`GRAVITY ÷ s²`、`JUMP_V ÷ s`（見 §10.3）；
  道具上升速度 `JET_V -765`／`PROP_V -193` 同 `WORD_BOOST`（保持 465px）要一齊按比例調；
  改 `WORD_BOOST` 之後記得重算 `WJ.BOOST_VY = WORD_BOOST ÷ WORD_BOOST_HANG` 同
  `WJ.BOOST_G = GRAVITY ÷ WORD_BOOST_HANG²`（§10.6 boost 滯空）。
- 想調「開頭慢、後來快」嘅節奏改 `WJ.SPEED_RAMP_FROM`（0.45）同
  `WJ.SPEED_RAMP_AT`（3200px）。開頭速度 = `MOVE_MAX × SPEED_RAMP_FROM`
  （240 × 0.45 = 108 px/s）。
- 想改有幾密：`genUpTo` 嘅 `opening`（`maxClimb < 1500`）同兩組步距
  `rand(68, 90)`／`rand(76, 102)`；平台闊度喺 `spawnPlatform` 嘅
  `opening ? rand(74, 104) : rand(62, 90)`；綠台比例係 `table` 嘅
  `['green', 58 - 14 * d]`。
- 題目有幾密：`WJ.QUIZ_GAP_MIN/MAX`（380／500）。實際排距會多 ~70px
  （因為字磚要擺喺平台上方 115px），所以**唔好直接當成排距**。
- 平台橫向距離係 `WJ.horizBudget(gap, climb)`（跟**呢一跳**嘅垂直距離計滯空，
  唔係成段 1.58s）。改 `MOVE_MAX`／`SPEED_RAMP_FROM`／`GRAVITY`／`JUMP_V`
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
- View `wj_leaderboard`：**每人一行**（個人最佳）＋ `plays`（該學生總局數）。
  用 `row_number() over (partition by user_id order by score desc, created_at asc)` 抽第一行，
  `security_invoker = true` 令 RLS 生效。
- RLS：`select using (true)`（**全世界讀得到**，否則排行榜載入唔到）；
  `insert with check (auth.uid() = user_id)`（只可以寫自己）。
- 前端：
  - `WJ.gameOver()` → `WJ.submitScore(score)`：登入咗就 fire-and-forget insert，
    失敗只 `console.warn`，唔會阻住遊戲結束畫面。
  - `WJ.loadLeaderboard()`：撈 `wj_leaderboard` 頭 7 名，畫入 game-over 卡嘅 `#wj-lb`；
    自己嗰行會 highlight ＋ 標「(你)」。未登入會加一句「今局唔會上榜」。訪客模式唔會撈榜，亦唔會 upload 分數。
  - `WJ.rankRow()`：一行嘅 HTML（🥇🥈🥉 / 名次、名、分、幾個字）。
  - 老師：Admin Dashboard「🦘 Word Jump」卡 → `loadWordJumpAdmin()`：
    學生數、總局數、最高分、今日局數 ＋ 每人最佳（名次、幾局、幾時玩、高度、字數）。
    `changeView('admin-view')` 會自動 call。
- **未跑 SQL 唔會壞**：game-over 顯示「排行榜載入唔到（老師要喺 Supabase 跑
  `wj_scores.sql`）」，admin 卡顯示同一句提示，遊戲照玩。
- 改名額：`WJ.loadLeaderboard()` 入面 `.limit(7)`；admin 用 `.limit(1000)`，
  先至每個 form 嘅學生都會出現。老師畫面按年級分組，每組內自行排名次。
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

## 11. New Vocab 字庫＋錯題簿（`supabase/new_vocab.sql`）

每個年級一份**長期字庫**（F3 / F4 / F6），唔會每日清走。老師刪咗先冇。
唔好加落 `SHEET_NAMES`（否則 Word Jump／隨機 battle 會撈埋）。

- 入口：Dictation Master → **New Vocab**。老師帳戶喺呢度揀年級、加字、改字、刪字。
  英文、中文、或者兩個一齊都可以存；撳 Confirm 之後先寫入並即刻出現喺下面；兩格都空先唔畀存。
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
- SQL 順序：`login_tracking.sql` → `student_forms.sql` → battle 系列（最後加 `battle_rejoin.sql`）→ `new_vocab.sql` → `new_vocab_unassigned_read.sql` → `student_forms_source.sql` → `guest_tracking.sql`（獨立，任何時候跑都得）。
  未跑之前，登入同其他 topic 照用；New Vocab 同 Error Book 雲端表都未建立，畫面會清楚叫老師跑 SQL（同一份 `new_vocab.sql` 亦會建立錯題簿表）。Word Battle 若已經用得，而 `new_vocab.sql` 都跑過，就再跑 `new_vocab_unassigned_read.sql`，等 Unassigned／訪客讀到全部年級字庫。`student_forms.sql` 如果係舊版（未有 `form_source`），再跑 `student_forms_source.sql`（或重跑更新咗嘅 `student_forms.sql`），先會喺資料庫清走好似 `Liu Chun Ming` 呢啲冇班別代號但被自動寫成 F6 嘅舊分類，並保護老師下拉。呢兩份後補 SQL 都可以重複跑；未跑亦唔會整壞網站：老師畫面已經會把冇班別代號嘅名稱顯示為 Unassigned，但 `my_form()`／New Vocab RLS 可能仍用舊自動分類，直到後補 SQL 跑完。

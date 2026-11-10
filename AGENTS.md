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

### 9.7 年級（Form）— `supabase/student_forms.sql`（要喺 login tracking 之後跑）

年級**唔再**喺登入時叫學生揀。舊版只係把 `localStorage["student_form_level"]`
（`F.4` / `F.6`）留喺學生自己部機，**冇**寫入 Supabase，所以老師畫面之前濾唔到。

- **單一清單**：`FORM_LEVELS`（而家 `F3`、`F4`、`F6`）。加新年級只改呢個陣列，
  `id` 用 `F` + 年份（例如 `F5`）。篩選掣、老師下拉、同舊 localStorage 遷移都讀呢度。
- 欄：`student_logins.form`（text，null = Unassigned）。
- RPC：
  - `claim_own_form(p_form)` — 學生登入時，如果部機仲有舊選擇，而且資料庫嗰行 `form` 仲係 null，先寫入。
    **唔會**覆蓋老師已改嘅值。管理員帳戶唔會執走呢份 localStorage。
    同一部瀏覽器只交俾第一個登入嘅學生（`student_form_claimed_by`），避免共用電腦個個都被寫成同一個年級。
  - `set_student_form(p_email, p_form)` — 只限 `ADMIN_EMAIL`。每個老師畫面嘅學生行有下拉可以改；
    揀「—」就變回 Unassigned。
- 老師篩選：All / 每個 form / Unassigned，記住喺 `localStorage["teacher_form_filter"]`。
  會改 Admin usage、Grammar Quest、Student Logins、Battles（連 class 直播板同 question breakdown）、
  Word Jump admin 排名，同埋老師先見到嘅 Hub Leaderboard。學生自己嗰個 Leaderboard 唔顯示呢個篩選。
- 未跑 SQL 唔會壞登入：Admin 頂部提示要跑 `student_forms.sql`，個個暫時當 Unassigned。

---

## 10. Word Jump（Doodle Jump 式爬高認字遊戲）

入口：`battle-view` 頂部嘅「🦘 Word Jump」卡 → `changeView('wordjump-view')`。
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
- **左右速度（按輸入比例）**：`MOVE_MAX 240`、`STEER_RATE 22`（加速）、
  `STEER_STOP 30`（收步）。`p.vx` 直接追 `dir × speedCap()`，加速約 **133ms**
  到 95%，放手**滑 2–8px**（開頭 ~4px、頂速 ~8px；用戶要「加強滑度」時由 58 減到 30，
  減得越細越滑）。`|dir| < 0.04` 當 0；只有 `target = 0` 而且 `|vx| < 1.5`
  才歸零（否則慢速微調永遠起唔到步）。
  **注意**：以前嘅 `MOVE_ACC` + `FRICTION × (1-|dir|)³` 模型已經刪走——
  摩擦力係常數、唔隨速度變，結果係「一過門檻就衝到頂速、門檻以下完全唔郁」，
  冇中間速，呢個就係「太快」嘅根源。
- **速度隨高度遞增**：`WJ.speedCap()` = `MOVE_MAX × (0.45 + 0.55 × min(1, maxClimb/3200))`，
  即係**每局開頭 108 px/s，爬到 3200px 就 240 px/s**（橫越 400px 由 3.7s 變 1.7s）。
  **但係 108 px/s 唔夠橫越成個畫面**：滯空 1.26s 只行到 **136px**，所以平台
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
   `reach = speedCap() × 1.26s × 0.8 + 平台寬` 用咗**成段滯空**，但下一個台如果
   已經離腳 80–275px，玩家係落返嚟途中就穿過佢，實際橫向時間短過 1.26s。
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
手感係「短促、夠高」：`GRAVITY 1610`／`JUMP_V -1014` → 跳高 **319px**、
每次滯空 **1.26s**。先前係 1300／−822（跳高 256px），用戶反映「跳唔夠高」
彈唔到上字磚，所以**只加跳高、唔加滯空**（G 同 V 一齊 ×1.23）。
更早試過 2000／−1030（1.03s 太急）同 750／−645（1.72s 太飄）。
想改而**保持跳高不變**：滯空乘 s，就 `GRAVITY ÷ s²`、`JUMP_V ÷ s`。
例如想再「快上快落」（滯空 ×0.9）：`GRAVITY 1988`、`JUMP_V -913`。
（跳高 `h = v² / 2g`，所以兩個一齊亂改會跳唔到／跳過龍。）

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
- 踩中正確字磚：**彈高 465px**（`WJ.WORD_BOOST = -1224` 取代原本 `JUMP_V -1014`
  嘅反彈，`h = 1224² / (2 × 1610) = 465`）、`+60 + 字長×5 + min(90, 連對×10)` 分、
  讀出英文（SpeechSynthesis）、toast ✅ 顯示 `⬆ 465px`；每連續 5 題送護盾 8 秒。
  **呢個係主要上分途徑**：彈高直接推高 `maxClimb`，即係 height 分。
  `land()` 讀 `WJ.boostPending`（`answerRow()` 答對時設 true），所以一定要
  喺 `land()` 入面 apply，唔可以喺 `answerRow()` 直接改 `p.vy`（會被覆蓋）。
  想彈得更高／矮就改 `WJ.WORD_BOOST`（-1224 ≈ 465px；-1400 ≈ 609px；-1000 ≈ 311px）。
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
  後者**喺全屏都用得到**（全屏時工具列收埋咗），全屏時會升到 `bottom: 38px`
  避開 `✕ Exit full screen`。
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
- 調手感改 `WJ.GRAVITY`（1610）／`WJ.JUMP_V`（−1014）／`WJ.MOVE_MAX`（240）／
  `WJ.STEER_RATE`（22）／`WJ.STEER_STOP`（30）／`WJ.TILT_RANGE`（11）／
  `WJ.TILT_CURVE`（1.6）。想「收步更快」就加 `STEER_STOP`、想「滑多啲」就減。
  想改滯空又保持跳高：`GRAVITY ÷ s²`、`JUMP_V ÷ s`（見 §10.3）；
  道具上升速度 `jet -956`／`prop -241` 要一齊按比例調。
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
  唔係成段 1.26s）。改 `MOVE_MAX`／`SPEED_RAMP_FROM`／`GRAVITY`／`JUMP_V`
  之後要重跑手機闊度嘅攀爬模擬；預算自動跟新常數，但字磚上方 240–275 必須
  仍然細過 `WJ.maxGap()`（跳高 − 36），先至跳到又跳唔過條問題。
- 加新平台類型：`spawnPlatform()` 嘅 `table` 加權重 → `WJ.land()` 加行為 →
  `WJ.update()` 加移動 → `WJ.draw()` 嘅 `colors` 加顏色。
- 加新道具：`WJ.pick()` 個陣列加 key → `WJ.applyGadget()` 加效果 →
  `WJ.drawGadget()` 個 `map` 加 emoji → `WJ.drawHud()` badges 加顯示。
- 改題目密度改 `WJ.QUIZ_GAP_MIN`／`QUIZ_GAP_MAX`；改選項數改 `spawnQuizRow()` 嘅 `count`。
- 已知限制：**未喺真手機試過 tilt**（只驗證過桌面／模擬）——`TILT_RANGE = 11`
  係憑手感估，實機太敏感就調大、太鈍就調細；`canvas` 內容喺
  OpenCode browser 截圖會空白（要 `toDataURL()` 轉 `<img>` 才睇到），唔係 bug。

### 10.10 全屏幕
- **三個掣**：工具列 `#wj-fs-btn`、畫面右上角 `#wj-fs-enter`（⛶ 全屏）、
  全屏時底部中央 `#wj-exit-fs`（✕ 退出全屏）。三個都 call `WJ.toggleFullscreen()`。
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
    自己嗰行會 highlight ＋ 標「(你)」。未登入會加一句「今局唔會上榜」。
  - `WJ.rankRow()`：一行嘅 HTML（🥇🥈🥉 / 名次、名、分、幾個字）。
  - 老師：Admin Dashboard「🦘 Word Jump」卡 → `loadWordJumpAdmin()`：
    學生數、總局數、最高分、今日局數 ＋ 每人最佳（名次、幾局、幾時玩、高度、字數）。
    `changeView('admin-view')` 會自動 call。
- **未跑 SQL 唔會壞**：game-over 顯示「排行榜載入唔到（老師要喺 Supabase 跑
  `wj_scores.sql`）」，admin 卡顯示同一句提示，遊戲照玩。
- 改名額：`WJ.loadLeaderboard()` 入面 `.limit(7)`；admin 用 `.limit(1000)`，
  先至唔會因為全球頭 100 名冇晒某個 form 而濾走佢哋。畫面上嘅名次跟住 form 篩選重排。
- 誠實聲明：分數由 client 寫入，**可以造假**；同 Word Battle 一樣只適合課堂激勵。

### 10.12 同學高度線（milestone markers）

爬升時，背景會畫其他同學嘅個人最佳高度：淡虛線橫過畫面、左右各一條短槓，
左邊一粒名牌寫**英文名**（`WJ.markerName()`：nickname 入面嘅拉丁字母；冇就用
電郵 @ 前面。中文名唔會畫上畫面）。

- 資料：`wj_leaderboard` 嘅 `height`（冇 height 先用 `score × 10`），`WJ.loadMilestones()`
  喺進入 Word Jump 時拉頭 60 名。**唔包括自己**。低過 120px 嘅紀錄唔畫。
- 玩家腳嘅高度（`-p.y`）穿過某條線，嗰條線變綠，並播一次輕量通過效果：
  畫面閃一下、兩下粒子、浮起 `Let's go!`。同一幀穿過幾條只播一次。
  已經喺腳下面嘅線（資料遲咗先載入）會直接標做已過，唔會補播。
- **冇朋友系統**，所以唔會有「過朋友先播特別音效」。通過本身亦冇加新音效。
- 重開（`WJ.reset`）會清通過狀態，下一局可以再過同一批線。載入失敗就當冇線，遊戲照玩。

## 11. New Vocab 字庫＋錯題簿（`supabase/new_vocab.sql`）

每個年級一份**長期字庫**（F3 / F4 / F6），唔會每日清走。老師刪咗先冇。
唔好加落 `SHEET_NAMES`（否則 Word Jump／隨機 battle 會撈埋）。

- 入口：Dictation Master → **New Vocab**。老師帳戶喺呢度揀年級、加字、改字、刪字。
  英文、中文、或者兩個一齊都可以存；兩格都空先唔畀存。
- 學生同老師可以切 **Added today**（香港日期，睇 `created_at`）同 **All words**。
  練習（Listening／Recitation）只用而家個範圍入面**有英文**嘅字。
  淨係中文嘅卡會喺字表同老師字庫出現，拼寫同 Word Battle 會跳過，等老師補英文。
- 學生冇 form：唔會見到其他年級嘅字，只見到要老師先設定年級。
- 開住 New Vocab 會每 4 秒重新讀（`nvRefresh`），唔使再登入。老師加字或刪字成功之後，下面字表會即刻更新；4 秒輪詢只係背景同步。老師字庫用 +／− 掣加字同刪字。
- 錯題簿：Dictation Master 嘅 **Error Book** 格，同 New Vocab 入面個掣。
  `checkAnswer` 第三次先錯就收入去（任何 Dictation 題目，包括 New Vocab）。
  喺錯題簿答對就刪走。登入寫 `error_book`（只可以讀寫自己）；未登入用
  `localStorage["error_book:guest"]`。一有人登入就清走 guest，避免共用電腦串到下一個學生。
- Word Battle：topic 揀 New Vocab，再揀年級，同「Full bank／Added today」。
  `set_battle_vocab` 把**有英文**嘅字抄入 `battle_rooms.vocab_words`。
  全房用同一個 snapshot＋原本 seed shuffle。字數少過題數就 cap，唔會用其他 topic 補。
  中文提示有就顯示，冇就當 English-only。
- SQL 順序：`login_tracking.sql` → `student_forms.sql` → battle 系列 → `new_vocab.sql`。
  未跑之前，登入同其他 topic 照用；New Vocab 顯示要跑 SQL。

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
- Tab（17 個，見 `SHEET_NAMES`）：charity, entertainment, environmental issues, family,
  fashion, festivals, food and restaurants, health, housing, law and order,
  modern communication, people, animals and pets, school, Shopping,
  social affairs, MTR stations。
- 欄位格式（每 tab 三欄，**第一行是標題會被 skip**）：`序號, 英文, 中文`。
  `parseCSV()` 取 `parts[1]` 作 `en`、`parts[2]` 作 `zh`。
- **加新 topic 三步**：Sheet 加新 tab（同樣三欄格式）→ `SHEET_NAMES` 加名 →
  `renderCategories()` 嘅 emoji map 加 icon。缺 emoji 會 fallback 📦。
- **gviz 只讀**：寫入一定要經其他通道（見 §5，成績唔擺 Sheet）。

## 3. 檔案地圖

### Views（`changeView(viewId)` 切換，全部 `.view` 預設 hidden）
| view id | 內容 |
|---|---|
| `hub-view` | Grammar／Dictation 兩張入口卡 |
| `grammar-view` | Sentence Structures／Revision 入口 |
| `sentence-structures-view` | 6 個句型（`showStructureDetail`） |
| `grammar-revision-view` | 時態格（`renderTenseGrid`，`showTenseDetail`） |
| `grammar-detail-view` | 文法詳情（`#grammar-detail-content` 動態填） |
| `home-view` | 17 topic 格（`#categories-grid`，Sheet 載入後填） |
| `sub-category-view` | Listening／Recitation／Revision 三個活動 |
| `quiz-view` | 測驗主體（speaker 鈕／中文大字／input／hint／計分） |
| `word-list-view` | Revision 單字表（`showWordList`） |

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
2. 每次入頁 fetch 足 17 個 tabs，無快取。修：抄 `sessionStorage` 10 分鐘快取（其他專案現成 pattern）。
3. 分數零持久化（Phase 1 解決）。
4. `Shopping` tab 大細楷同其他唔一致，改名要連 `SHEET_NAMES` 一齊改。

## 8. 驗收 checklist

- [ ] 唔登入：玩到＋localStorage 有記錄
- [ ] 學校 Google 帳戶：登入到＋完成 quiz 上傳一筆
- [ ] 非學校帳戶：被登出＋有提示
- [ ] 「我的記錄」撈到自己跨裝置成績
- [ ] Sheet 斷線：文法區照用到，登入照用到

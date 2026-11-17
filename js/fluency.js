/* LearniTY — Fluency Master sentence bank.
   150 HKDSE Paper 4 sentences: Discussion Phrases (1-50) and Hot Topics
   (51-150). Every sentence carries its Chinese explanation. The list is
   grouped, collapsible and searchable; the speaker button reads the English
   with a UK voice. Pure front-end: no Supabase, nothing stored. */

const FLUENCY_DATA = {
    "phrases": {
        "groups": [
            {
                "emoji": "🧊",
                "name": "Initiating",
                "alt": "開場破冰",
                "lines": [
                    {"n": 1, "en": "Shall we get the ball rolling by looking at the pros and cons of this proposal?", "zh": "我們不如先從這項建議的利弊入手，展開討論吧？"},
                    {"n": 2, "en": "Since time is ticking, let's dive straight into the first item on the agenda.", "zh": "既然時間緊迫，我們直接進入議程的第一項吧。"},
                    {"n": 3, "en": "To kick things off, I would like to share my initial thoughts on this topic.", "zh": "為了展開討論，我想先分享一下我對這個題目的初步想法。"},
                    {"n": 4, "en": "Why don't we start by defining what this issue actually means to young people?", "zh": "我們不如先界定一下這個議題對年輕人究竟意味著什麼？"},
                    {"n": 5, "en": "Let's break the ice by briefly discussing the root causes of this phenomenon.", "zh": "我們先簡單探討這個現象的根本原因來打開話匣子吧。"},
                    {"n": 6, "en": "If nobody minds, I'd love to start the discussion by highlighting a key concern.", "zh": "如果大家不介意，我想先提出一個核心關注點來開始討論。"},
                    {"n": 7, "en": "Shall we go around the table and share one quick point each before deciding?", "zh": "在作決定前，我們不如輪流每人簡短分享一個觀點？"},
                    {"n": 8, "en": "To make our discussion more structured, perhaps we can tackle the questions one by one.", "zh": "為了讓討論更有條理，或許我們可以逐一處理這些問題。"},
                    {"n": 9, "en": "Let's set the stage by considering how this policy affects everyday citizens.", "zh": "我們先從這項政策如何影響普羅大眾入手，為討論定下基調。"},
                    {"n": 10, "en": "Would anyone like to take the floor first, or shall I share my perspective?", "zh": "有人想先發言嗎？還是由我先分享一下我的看法？"}
                ]
            },
            {
                "emoji": "🤝",
                "name": "Agreeing & Elaborating",
                "alt": "附和與延伸",
                "lines": [
                    {"n": 11, "en": "I couldn't agree more with what you just said, and I'd like to add another layer to it.", "zh": "我完全同意你剛才所說的，而且我想在此基礎上再補充一點。"},
                    {"n": 12, "en": "You hit the nail on the head, especially regarding the long-term impact on students.", "zh": "你說得一針見血，特別是關於對學生長遠影響的部分。"},
                    {"n": 13, "en": "Building on your brilliant point, we also need to consider the feasibility of the plan.", "zh": "承接你剛才精彩的觀點，我們亦需要考慮計劃的可行性。"},
                    {"n": 14, "en": "That resonates strongly with me because I have witnessed a similar situation at school.", "zh": "這點令我深有同感，因為我在學校也目睹過類似的情況。"},
                    {"n": 15, "en": "Spot on! In addition to financial costs, psychological pressure is equally alarming.", "zh": "說得太對了！除了經濟成本，心理壓力同樣令人擔憂。"},
                    {"n": 16, "en": "I am totally on board with your suggestion, provided that we have sufficient resources.", "zh": "只要我們有足夠資源，我完全支持你的建議。"},
                    {"n": 17, "en": "Your argument makes total sense, and it actually reminds me of a recent news report.", "zh": "你的論點非常有道理，這其實令我想起最近一則新聞報道。"},
                    {"n": 18, "en": "That is a compelling perspective; to take it a step further, how can we implement it?", "zh": "這是個很有說服力的角度；再推深一層，我們該如何落實呢？"},
                    {"n": 19, "en": "I echo your sentiment entirely, as striking a balance is never an easy task.", "zh": "我完全認同你的看法，因為要取得平衡從來都不是一件容易的事。"},
                    {"n": 20, "en": "Precisely! And if we look at the bigger picture, this trend is almost irreversible.", "zh": "沒錯！而且如果從宏觀角度來看，這個趨勢幾乎是不可逆轉的。"}
                ]
            },
            {
                "emoji": "⚖️",
                "name": "Disagreeing Politely",
                "alt": "禮貌反對與轉折",
                "lines": [
                    {"n": 21, "en": "I see where you're coming from, yet we shouldn't overlook the financial burden it brings.", "zh": "我明白你的出發點，但我們不應忽視它帶來的財政負擔。"},
                    {"n": 22, "en": "That's a valid point, though I'm afraid it might be a bit too idealistic in reality.", "zh": "這是一個合理的觀點，不過恐怕在現實中會有點過於理想化。"},
                    {"n": 23, "en": "While I appreciate your optimism, we must prepare for the worst-case scenario.", "zh": "雖然我欣賞你的樂觀態度，但我們必須為最壞的情況作好準備。"},
                    {"n": 24, "en": "I understand your reasoning, but let's look at the flip side of the coin for a moment.", "zh": "我理解你的推論，但我們不妨暫時看看事情的另一面。"},
                    {"n": 25, "en": "On the surface that sounds great, however, it could backfire if not handled properly.", "zh": "表面上這聽起來很棒，然而如果處理不當，可能會適得其反。"},
                    {"n": 26, "en": "I beg to differ slightly here, as teenagers nowadays value autonomy more than rules.", "zh": "在這一點上我恕難完全苟同，因為現今青少年重視自主權多於規條。"},
                    {"n": 27, "en": "Fair enough, yet relying solely on government funding may not be sustainable.", "zh": "這也有道理，但單靠政府資助未必能夠持續發展。"},
                    {"n": 28, "en": "I'm not entirely convinced that strict punishment is the most effective deterrent.", "zh": "我不太相信嚴厲的懲罰是最有效的阻嚇方法。"},
                    {"n": 29, "en": "That works well in theory, but in practice, schools lack the manpower to enforce it.", "zh": "這在理論上很可行，但在實際操作上，學校缺乏人手去執行。"},
                    {"n": 30, "en": "Even though your idea has merit, I believe education is still the ultimate solution.", "zh": "儘管你的主意有可取之處，但我相信教育才是最終的解決方法。"}
                ]
            },
            {
                "emoji": "🙋",
                "name": "Inviting & Clarifying",
                "alt": "邀請沉默組員與澄清",
                "lines": [
                    {"n": 31, "en": "We haven't heard from you yet—what's your take on this controversial issue?", "zh": "我們還未聽過你的意見——你對這個具爭議性的議題有什麼看法？"},
                    {"n": 32, "en": "You seem to have a different view; would you care to elaborate on that?", "zh": "你似乎有不同的見解，介意詳細闡述一下嗎？"},
                    {"n": 33, "en": "Just to make sure we are on the same page, could you clarify what you meant earlier?", "zh": "為了確保大家理解一致，你可以澄清一下你剛才的意思嗎？"},
                    {"n": 34, "en": "I'd love to hear your thoughts before we move on to the next part of the prompt.", "zh": "在我們進入題目的下一部分前，我很想聽聽你的想法。"},
                    {"n": 35, "en": "What do you reckon would be the biggest obstacle if we adopt this approach?", "zh": "如果我們採取這個方法，你認為最大的障礙會是什麼？"},
                    {"n": 36, "en": "Sorry to interrupt, could you give us a concrete example to illustrate your point?", "zh": "抱歉打斷一下，你可以舉一個具體例子來說明你的論點嗎？"},
                    {"n": 37, "en": "Do you think the benefits truly outweigh the drawbacks in the long run?", "zh": "長遠而言，你認為好處真的大於壞處嗎？"},
                    {"n": 38, "en": "Let's bring everyone into the loop—how do you feel about prioritizing mental health?", "zh": "讓大家都參與討論吧——你對於將心理健康放在首位有什麼看法？"},
                    {"n": 39, "en": "Could you walk us through how this campaign would actually attract teenagers?", "zh": "你可以向我們解釋一下，這項活動實際上會如何吸引青少年嗎？"},
                    {"n": 40, "en": "Are you suggesting that parents should take full responsibility for this problem?", "zh": "你的意思是父母應該為這個問題負上全責嗎？"}
                ]
            },
            {
                "emoji": "🎯",
                "name": "Steering & Concluding",
                "alt": "拉回主題與總結共識",
                "lines": [
                    {"n": 41, "en": "That's an intriguing point, though perhaps we could steer the discussion back to our main focus.", "zh": "這是個很有趣的觀點，不過或許我們可以把討論拉回主要焦點。"},
                    {"n": 42, "en": "Fascinating as that is, we only have two minutes left, so let's reach a consensus.", "zh": "雖然這很吸引，但我們只剩下兩分鐘，所以讓我們達成共識吧。"},
                    {"n": 43, "en": "We seem to be going round in circles; why don't we weigh the two strongest options?", "zh": "我們似乎在原地兜圈子，不如我們權衡一下兩個最強的選項吧？"},
                    {"n": 44, "en": "To keep things moving, let's summarize what we have agreed upon so far.", "zh": "為了推進討論，讓我們先總結一下目前為止達成的共識。"},
                    {"n": 45, "en": "So, to wrap things up, it seems we're all on the same page regarding the first option.", "zh": "總括而言，看來我們對第一個選項都達成了一致共識。"},
                    {"n": 46, "en": "In a nutshell, combining both short-term relief and long-term education is our best bet.", "zh": "簡而言之，結合短期紓緩和長遠教育是我們最好的對策。"},
                    {"n": 47, "en": "Let's agree to disagree on the minor details and focus on our core recommendation.", "zh": "我們不妨在細節上求同存異，專注於我們的核心建議。"},
                    {"n": 48, "en": "Time is almost up, so let's finalize our top three strategies before the bell rings.", "zh": "時間差不多了，讓我們在鐘聲響起前敲定三個最佳策略吧。"},
                    {"n": 49, "en": "Overall, we believe that collaboration between schools and parents is indispensable.", "zh": "總體而言，我們相信學校與家長之間的合作是不可或缺的。"},
                    {"n": 50, "en": "Thank you everyone for such a fruitful discussion; I think we've covered all bases.", "zh": "多謝各位進行了如此富有成效的討論，我想我們已經涵蓋了所有重點。"}
                ]
            }
        ]
    },
    "topics": {
        "groups": [
            {
                "emoji": "🤖",
                "name": "AI & Technology",
                "alt": "人工智能與科技",
                "lines": [
                    {"n": 51, "en": "Generative AI is revolutionizing the way students research, yet it raises serious plagiarism concerns.", "zh": "生成式人工智能正徹底改變學生做資料搜集的方式，但同時引發嚴重的抄襲疑慮。"},
                    {"n": 52, "en": "Over-reliance on artificial intelligence could gradually erode critical thinking skills among youth.", "zh": "過度依賴人工智能可能會逐漸削弱年輕人的批判性思維能力。"},
                    {"n": 53, "en": "Rather than banning AI in classrooms, schools should teach students how to use it ethically.", "zh": "與其在課室禁止使用人工智能，學校更應教導學生如何合乎道德地運用它。"},
                    {"n": 54, "en": "Automation will inevitably replace repetitive jobs, making lifelong learning more vital than ever.", "zh": "自動化無可避免會取代重複性的工作，令終身學習變得比以往任何時候都更重要。"},
                    {"n": 55, "en": "Data privacy has become a pressing issue as smart devices constantly track our daily habits.", "zh": "隨著智能裝置不斷追蹤我們的日常習慣，數據私隱已成為一個迫切的問題。"},
                    {"n": 56, "en": "Deepfake technology poses a severe threat to public trust and spreads misinformation rapidly.", "zh": "深度偽造技術對公眾信任構成嚴重威脅，並迅速散播虛假資訊。"},
                    {"n": 57, "en": "Bridging the digital divide is essential so that underprivileged students are not left behind.", "zh": "收窄數碼鴻溝至關重要，這樣基層學生才不會被時代拋離。"},
                    {"n": 58, "en": "Virtual reality offers immersive learning experiences that traditional textbooks simply cannot match.", "zh": "虛擬實境提供沉浸式的學習體驗，這是傳統教科書根本無法比擬的。"},
                    {"n": 59, "en": "Technology is a double-edged sword; its ultimate impact depends entirely on human intention.", "zh": "科技是一把雙刃劍，其最終影響完全取決於人類的意圖。"},
                    {"n": 60, "en": "Cybersecurity awareness must be strengthened to protect vulnerable elderly citizens from online scams.", "zh": "必須加強網絡安全意識，以保護易受騙的長者免墮網上騙局。"},
                    {"n": 61, "en": "Algorithmic bias in social media feeds often traps users inside echo chambers of extreme views.", "zh": "社交媒體動態中的演算法偏見，往往將用戶困在極端觀點的「同溫層」內。"},
                    {"n": 62, "en": "Smart city initiatives can optimize public transport and significantly reduce urban traffic congestion.", "zh": "智慧城市措施能夠優化公共交通，並顯著減少市區交通擠塞。"},
                    {"n": 63, "en": "While telemedicine improves healthcare accessibility, it cannot fully replace face-to-face diagnosis.", "zh": "雖然遙距醫療提高了醫療服務的便利性，但它無法完全取代面對面的診斷。"},
                    {"n": 64, "en": "Digital literacy should be treated as a core subject alongside traditional languages and mathematics.", "zh": "數碼素養應與傳統語文和數學一樣，被視為核心學科。"},
                    {"n": 65, "en": "Constant notifications fragment our attention spans and severely undermine deep, focused work.", "zh": "源源不絕的手機通知令我們的專注力變得碎片化，並嚴重削弱深度專注工作的能力。"}
                ]
            },
            {
                "emoji": "🌱",
                "name": "Environment & Sustainability",
                "alt": "環保與可持續發展",
                "lines": [
                    {"n": 66, "en": "Plastic waste reduction requires not only government legislation but also a shift in consumer habits.", "zh": "減少塑膠廢物不僅需要政府立法，還需要消費者習慣的轉變。"},
                    {"n": 67, "en": "Fast fashion encourages a throwaway culture that devastates ecosystems and exploits cheap labor.", "zh": "快速時尚助長了「用完即棄」的文化，破壞生態系統並剝削廉價勞工。"},
                    {"n": 68, "en": "Extreme weather events serve as a stark reminder that climate change is no longer a distant threat.", "zh": "極端天氣事件是一個嚴峻的提醒，說明氣候變化已不再是遙遠的威脅。"},
                    {"n": 69, "en": "Implementing municipal solid waste charging can incentivize households to recycle more diligently.", "zh": "推行都市固體廢物收費能夠激勵家庭更勤奮地進行回收。"},
                    {"n": 70, "en": "Transitioning to renewable energy is crucial for achieving carbon neutrality within the next few decades.", "zh": "過渡至可再生能源，對於在未來幾十年內實現碳中和至關重要。"},
                    {"n": 71, "en": "Urban green spaces not only mitigate the heat island effect but also improve residents' well-being.", "zh": "城市綠化空間不僅能紓緩熱島效應，還能改善居民的身心健康。"},
                    {"n": 72, "en": "Food waste remains a glaring paradox in affluent cities where tons of edible food are dumped daily.", "zh": "廚餘在富裕城市仍然是一個明顯的矛盾現象，每天都有數以噸計仍可食用的食物被棄置。"},
                    {"n": 73, "en": "Eco-tourism promotes conservation awareness, provided that visitor numbers are strictly regulated.", "zh": "只要嚴格規管遊客人數，生態旅遊便能提升保育意識。"},
                    {"n": 74, "en": "Greenwashing by major corporations misleads consumers into believing they are making eco-friendly choices.", "zh": "大企業的「漂綠」行為誤導消費者，令他們以為自己正在作出環保的選擇。"},
                    {"n": 75, "en": "Sustainable development means meeting present needs without compromising the future of next generations.", "zh": "可持續發展意味著在滿足當代需求的同時，不損害下一代的未來。"},
                    {"n": 76, "en": "Electric vehicles produce zero tailpipe emissions, yet battery disposal poses new environmental challenges.", "zh": "電動車雖然達致零尾氣排放，但電池棄置卻帶來了新的環境挑戰。"},
                    {"n": 77, "en": "Small individual actions, such as bringing reusable bottles, create a massive ripple effect over time.", "zh": "個人微小的行動（例如自備水樽）隨時間推移會產生巨大的連鎖效應。"},
                    {"n": 78, "en": "Protecting marine biodiversity requires banning single-use plastics and curbing industrial pollution.", "zh": "保護海洋生物多樣性需要禁止即棄塑膠並遏止工業污染。"},
                    {"n": 79, "en": "Upcycling workshops empower citizens to turn discarded materials into practical, creative household items.", "zh": "升級再造工作坊讓市民能夠將廢棄物料轉化為實用且具創意的家居用品。"},
                    {"n": 80, "en": "Financial subsidies for green businesses can accelerate innovation in eco-friendly packaging alternatives.", "zh": "為綠色企業提供財政資助，可以加速環保包裝替代品的創新。"}
                ]
            },
            {
                "emoji": "🧠",
                "name": "Youth Mental Health & Education",
                "alt": "青少年心理健康與教育",
                "lines": [
                    {"n": 81, "en": "Exam-oriented education often prioritizes rote memorization over genuine curiosity and creativity.", "zh": "應試教育往往將死記硬背置於真正的好奇心和創造力之上。"},
                    {"n": 82, "en": "Destigmatizing mental health issues is the first step toward encouraging struggling teens to seek help.", "zh": "去除心理健康問題的標籤，是鼓勵受困擾青少年尋求協助的第一步。"},
                    {"n": 83, "en": "Excessive academic pressure can lead to burnout, anxiety, and a severe lack of sleep among students.", "zh": "過度的學業壓力會導致學生出現職業倦怠（身心俱疲）、焦慮及嚴重睡眠不足。"},
                    {"n": 84, "en": "Extracurricular activities play a vital role in fostering resilience, teamwork, and leadership skills.", "zh": "課外活動在培養抗逆力、團隊合作和領導才能方面擔當重要角色。"},
                    {"n": 85, "en": "Peer comparison on social media constantly fuels insecurities about body image and personal success.", "zh": "社交媒體上的同輩比較不斷加劇青少年對外貌身材和個人成就的不安感。"},
                    {"n": 86, "en": "Schools should allocate more resources to hiring professional counselors rather than focusing solely on grades.", "zh": "學校應調撥更多資源聘請專業輔導員，而非只專注於學業成績。"},
                    {"n": 87, "en": "Parental expectations, though well-intentioned, sometimes suffocate teenagers' passion for non-traditional careers.", "zh": "父母的期望雖然出於好意，但有時會窒息青少年對非傳統職業的熱情。"},
                    {"n": 88, "en": "Cultivating a growth mindset helps students view failure as a stepping stone rather than a dead end.", "zh": "培養成長型思維有助學生將失敗視為墊腳石，而非死胡同。"},
                    {"n": 89, "en": "Sleep deprivation not only impairs memory consolidation but also weakens emotional regulation in adolescents.", "zh": "睡眠不足不僅會損害記憶鞏固，還會削弱青少年的情緒調節能力。"},
                    {"n": 90, "en": "Life planning education equips secondary students with realistic insights into diverse career pathways.", "zh": "生涯規劃教育讓中學生對多元化的職業發展路徑有更切合實際的了解。"},
                    {"n": 91, "en": "Cyberbullying can be even more devastating than traditional bullying because it follows victims home 24/7.", "zh": "網絡欺凌可能比傳統欺凌更具毀滅性，因為它全天候24小時跟隨受害者回家。"},
                    {"n": 92, "en": "Volunteering fosters empathy and helps young people appreciate their privileges while serving the community.", "zh": "義務工作能培養同理心，並幫助年輕人在服務社區的同時懂得珍惜自己所擁有的。"},
                    {"n": 93, "en": "Financial literacy is an essential life skill that is sadly missing from most high school curricula.", "zh": "理財素養是一項不可或缺的生活技能，但遺憾地大多數高中課程都缺乏這方面內容。"},
                    {"n": 94, "en": "A healthy work-life balance starts in school by ensuring students have time for hobbies and rest.", "zh": "健康的作息平衡應從校園開始，確保學生有時間發展興趣和休息。"},
                    {"n": 95, "en": "Open communication between parents and teenagers builds mutual trust and prevents generational conflicts.", "zh": "父母與青少年之間坦誠的溝通能建立互信，並預防代溝衝突。"}
                ]
            },
            {
                "emoji": "🇭🇰",
                "name": "Hong Kong Society, Culture & Economy",
                "alt": "香港本地社會、文化與經濟",
                "lines": [
                    {"n": 96, "en": "Revitalizing historic buildings preserves Hong Kong's cultural identity while attracting heritage tourists.", "zh": "活化歷史建築既能保存香港的文化身份，又能吸引喜愛文物古蹟的旅客。"},
                    {"n": 97, "en": "Hosting mega-events can boost local consumption, yet service quality must match international standards.", "zh": "舉辦盛事能刺激本地消費，但服務質素亦必須符合國際標準。"},
                    {"n": 98, "en": "An aging population puts immense strain on our public healthcare system and requires proactive policy reform.", "zh": "人口老化為我們的公共醫療系統帶來沉重壓力，需要具前瞻性的政策改革。"},
                    {"n": 99, "en": "Supporting local independent bookstores and artists keeps Hong Kong's creative scene vibrant and diverse.", "zh": "支持本地獨立書店和藝術家，能保持香港創意產業的活力與多元化。"},
                    {"n": 100, "en": "High living costs and cramped living spaces remain major obstacles to upward social mobility for youth.", "zh": "高昂的生活成本和狹窄的居住空間，仍然是年輕人向上流動的主要障礙。"},
                    {"n": 101, "en": "Promoting Cantonese opera and traditional craftsmanship ensures intangible heritage is passed down to youth.", "zh": "推廣粵劇和傳統手工藝，能確保非物質文化遺產得以傳承給年輕一代。"},
                    {"n": 102, "en": "Cross-border consumption trends challenge local retailers to innovate and enhance customer experiences.", "zh": "跨境消費趨勢促使本地零售商必須創新並提升顧客體驗。"},
                    {"n": 103, "en": "Developing country parks for eco-tourism showcases Hong Kong's breathtaking natural scenery beyond skyscrapers.", "zh": "發展郊野公園作生態旅遊，能向外界展示香港摩天大樓以外令人驚嘆的自然風光。"},
                    {"n": 104, "en": "Flexible working arrangements can improve employee morale and reduce peak-hour congestion on the MTR.", "zh": "彈性工作安排能提升員工士氣，並減少港鐵在繁忙時間的擠迫情況。"},
                    {"n": 105, "en": "Encouraging silver-haired employment taps into valuable experience while alleviating labor shortages.", "zh": "鼓勵「銀髮就業」既能善用長者寶貴的工作經驗，又能紓緩勞動力短缺問題。"},
                    {"n": 106, "en": "Street food culture is an iconic part of Hong Kong's charm that deserves hygienic regulation rather than extinction.", "zh": "街頭小食文化是香港魅力的標誌性部分，值得透過衛生規管加以保留，而非令其消失。"},
                    {"n": 107, "en": "Bilingual proficiency gives Hong Kong graduates a unique competitive edge in the globalized job market.", "zh": "兩文三語的能力讓香港畢業生在全球化的就業市場中擁有獨特的競爭優勢。"},
                    {"n": 108, "en": "Community care teams play a heartwarming role in supporting isolated elderly residents living alone.", "zh": "社區關愛隊在支援獨居長者方面發揮了溫暖人心的作用。"},
                    {"n": 109, "en": "Expanding cycle tracks across new towns promotes green commuting and healthier lifestyles for families.", "zh": "在新市鎮擴展單車徑網絡，能為家庭推廣綠色出行和更健康的生活方式。"},
                    {"n": 110, "en": "Preserving traditional neon signs adds irreplaceable nostalgic character to Hong Kong's nightscape.", "zh": "保留傳統霓虹燈招牌，為香港的夜景增添了無可取代的懷舊特色。"}
                ]
            },
            {
                "emoji": "📱",
                "name": "Social Media, Consumerism & Lifestyle",
                "alt": "社交媒體、消費與現代生活",
                "lines": [
                    {"n": 111, "en": "Influencer marketing heavily shapes teenagers' purchasing decisions, often encouraging impulsive buying.", "zh": "網紅營銷深深影響青少年的購買決定，往往助長衝動消費。"},
                    {"n": 112, "en": "Cancel culture on the internet leaves little room for genuine apology, reflection, or personal growth.", "zh": "網絡上的「取消文化」幾乎不留任何空間讓人真誠道歉、反思或個人成長。"},
                    {"n": 113, "en": "Short-form videos provide instant entertainment, yet they condition our brains to crave constant stimulation.", "zh": "短影片提供即時娛樂，但卻令我們的大腦習慣渴求不斷的感官刺激。"},
                    {"n": 114, "en": "Minimalism encourages people to value meaningful experiences over the endless accumulation of material goods.", "zh": "極簡主義鼓勵人們重視有意義的人生體驗，而非無止境地囤積物質商品。"},
                    {"n": 115, "en": "Online anonymity often emboldens keyboard warriors to post hateful comments without fearing consequences.", "zh": "網絡匿名性往往助長「鍵盤戰士」在無懼後果的情況下發布仇恨言論。"},
                    {"n": 116, "en": "Subscriptions for everything from music to software quietly drain young adults' monthly budgets.", "zh": "從音樂到軟件的各類訂閱服務，正悄悄耗盡年輕人的每月預算。"},
                    {"n": 117, "en": "Digital detox weekends allow individuals to reconnect with nature and build genuine face-to-face relationships.", "zh": "週末「數碼排毒」讓個人能夠重新與大自然連結，並建立真摯的面對面人際關係。"},
                    {"n": 118, "en": "Celebrity endorsements can raise awareness for charity causes, provided the stars genuinely practice what they preach.", "zh": "名人代言能提高大眾對慈善事業的關注，前提是明星們真正言行一致。"},
                    {"n": 119, "en": "FOMO, or the fear of missing out, drives many young users to check their phones compulsively.", "zh": "「錯失恐懼症」（FOMO）驅使許多年輕用戶強迫性地不斷查看手機。"},
                    {"n": 120, "en": "Cashless payments offer unmatched convenience, though they make it much harder to track daily spending.", "zh": "無現金支付帶來無與倫比的便利，但也令人更難追蹤日常開支。"},
                    {"n": 121, "en": "Podcasting has revived long-form audio storytelling, allowing commuters to learn while traveling.", "zh": "播客（Podcast）復興了長篇音頻敘事，讓通勤族在乘車途中也能學習。"},
                    {"n": 122, "en": "Second-hand trading platforms promote circular economy by giving pre-loved clothes and gadgets a second life.", "zh": "二手交易平台賦予舊衣物和電子產品第二次生命，從而推動循環經濟。"},
                    {"n": 123, "en": "Curated perfection on Instagram creates an illusion that everyone else is living a glamorous, effortless life.", "zh": "Instagram 上精心修飾的完美生活照營造了一種假象，令人以為其他人都過著光鮮亮麗、毫不費力的生活。"},
                    {"n": 124, "en": "Esports has evolved into a legitimate global industry requiring intense discipline, strategy, and teamwork.", "zh": "電子競技已發展成為一個名副其實的全球性產業，需要極高的自律、策略和團隊合作。"},
                    {"n": 125, "en": "Practicing gratitude daily shifts our mindset from complaining about what we lack to appreciating what we have.", "zh": "每天練習感恩能將我們的心態從抱怨所缺乏的，轉變為珍惜所擁有的。"}
                ]
            },
            {
                "emoji": "💎",
                "name": "Universal High-Scoring Sentences",
                "alt": "跨議題萬用分析金句",
                "lines": [
                    {"n": 126, "en": "Legislation alone is rarely enough; lasting change requires shifting public attitudes through education.", "zh": "單靠立法往往並不足夠；持久的改變需要透過教育來轉變公眾態度。"},
                    {"n": 127, "en": "We must strike a delicate balance between economic growth and environmental preservation.", "zh": "我們必須在經濟增長與環境保護之間取得微妙的平衡。"},
                    {"n": 128, "en": "Addressing the symptoms without tackling the root cause will only offer a temporary band-aid solution.", "zh": "治標不治本只會提供一個暫時性的權宜之計。"},
                    {"n": 129, "en": "A multi-pronged approach involving the government, schools, and families is essential for success.", "zh": "結合政府、學校和家庭的多管齊下方法，是成功的關鍵。"},
                    {"n": 130, "en": "Every coin has two sides, so we need to weigh both short-term convenience and long-term consequences.", "zh": "凡事都有兩面，因此我們需要同時權衡短期便利與長遠後果。"},
                    {"n": 131, "en": "Raising public awareness is crucial, as people rarely act on issues they barely understand.", "zh": "提高公眾意識至關重要，因為人們很少會對自己幾乎不了解的問題採取行動。"},
                    {"n": 132, "en": "Prevention is always better than cure, especially when dealing with youth behavioral problems.", "zh": "預防永遠勝於治療，尤其是在處理青少年行為問題的時候。"},
                    {"n": 133, "en": "Financial incentives often prove more effective than strict prohibitions in changing everyday behavior.", "zh": "在改變日常行為方面，經濟誘因往往比嚴格禁止更為有效。"},
                    {"n": 134, "en": "Transparency and accountability are the cornerstones of building lasting trust between institutions and citizens.", "zh": "透明度與問責制是建立機構與市民之間持久信任的基石。"},
                    {"n": 135, "en": "While there is no one-size-fits-all solution, pilot schemes allow us to test ideas safely first.", "zh": "雖然沒有一刀切的解決方案，但先導計劃讓我們可以先安全地測試構思。"},
                    {"n": 136, "en": "Empowering young people with decision-making power fosters a stronger sense of civic responsibility.", "zh": "賦予年輕人決策權，能培養他們更強烈的公民責任感。"},
                    {"n": 137, "en": "Cultural stereotypes often stem from ignorance and can only be dismantled through meaningful dialogue.", "zh": "文化刻板印象往往源於無知，唯有透過有意義的對話才能打破。"},
                    {"n": 138, "en": "Investing in preventative healthcare today will save billions in medical expenses tomorrow.", "zh": "今天投資於預防性醫療，將來就能節省數以十億計的醫療開支。"},
                    {"n": 139, "en": "True progress is measured not just by GDP growth, but by the happiness and dignity of ordinary citizens.", "zh": "真正的進步不僅以本地生產總值增長來衡量，更取決於普通市民的幸福感與尊嚴。"},
                    {"n": 140, "en": "Cross-sector collaboration brings together diverse expertise to solve complex social challenges creatively.", "zh": "跨界別合作匯聚不同領域的專業知識，以具創意的方式解決複雜的社會挑戰。"},
                    {"n": 141, "en": "Rules without proper enforcement quickly become toothless tigers that nobody takes seriously.", "zh": "沒有適當執法的規條很快會變成沒有人認真對待的「無牙老虎」。"},
                    {"n": 142, "en": "Stepping out of our comfort zone is uncomfortable at first, yet it is the only way genuine growth happens.", "zh": "踏出舒適圈起初會令人感到不安，但這是實現真正成長的唯一途徑。"},
                    {"n": 143, "en": "Empathy allows us to walk in someone else's shoes before passing judgment on their choices.", "zh": "同理心讓我們在對別人的選擇作出批判前，先設身處地為對方著想。"},
                    {"n": 144, "en": "Rapid urbanization brings modern convenience, but it also risks eroding close-knit neighborhood bonds.", "zh": "快速的城市化帶來現代便利，但同時亦有削弱緊密鄰里關係的風險。"},
                    {"n": 145, "en": "Media literacy empowers citizens to verify sources critically rather than blindly believing viral posts.", "zh": "媒體素養讓市民有能力批判性地核實消息來源，而非盲目相信網上瘋傳的帖文。"},
                    {"n": 146, "en": "Long-term vision is often sacrificed for short-term political or financial gain, which hurts future generations.", "zh": "長遠目光往往會為了短期的政治或經濟利益而被犧牲，這最終會損害下一代。"},
                    {"n": 147, "en": "Inclusivity means ensuring that minorities and people with disabilities have equal access to opportunities.", "zh": "共融意味著確保少數族裔和殘疾人士都能享有平等的機會。"},
                    {"n": 148, "en": "Constructive criticism helps us refine our ideas, whereas cynicism merely paralyzes positive action.", "zh": "建設性的批評有助我們完善構思，而犬儒主義（冷嘲熱諷）只會癱瘓積極的行動。"},
                    {"n": 149, "en": "Global challenges like pandemics and climate change remind us that all nations share a common destiny.", "zh": "疫情和氣候變化等全球性挑戰提醒我們，所有國家都休戚與共、命運相連。"},
                    {"n": 150, "en": "Ultimately, small, consistent steps taken today will pave the way for a brighter, more sustainable tomorrow.", "zh": "歸根究柢，今天邁出的每一小步堅持，都將為更光明、更可持續的明天鋪平道路。"}
                ]
            }
        ]
    },
    "warmup": [
        "I see your point!",
        "That's a brilliant idea.",
        "I see eye to eye with you.",
        "I totally agree with you.",
        "That makes sense to me.",
        "I'm not sure about that.",
        "Let's agree to disagree.",
        "Could you explain that again?",
        "What do you mean by that?",
        "That's a fair point.",
        "I hadn't thought of that.",
        "Let's weigh the pros and cons.",
        "I beg to differ.",
        "That's easier said than done.",
        "Let's move on to the next point.",
        "In my opinion, it depends.",
        "That's exactly what I mean.",
        "I couldn't agree more.",
        "We should look at the bigger picture.",
        "Let's hear both sides first.",
        "That's a valid concern.",
        "I'm with you on that.",
        "Let's keep this simple."
    ]
};

const FL = {
    open: { phrases: 0, topics: 0 },    // group index, 'all', or -1 for none
    query: { phrases: '', topics: '' },
    speakBtn: null
};

function fluencyHostId(kind) {
    return kind === 'topics' ? 'fluency-topics-content' : 'fluency-phrases-content';
}

function fluencyFindLine(kind, n) {
    const data = FLUENCY_DATA[kind];
    if (!data) return null;
    for (let i = 0; i < data.groups.length; i += 1) {
        const lines = data.groups[i].lines;
        for (let j = 0; j < lines.length; j += 1) {
            if (lines[j].n === n) return lines[j];
        }
    }
    return null;
}

/* Prefer a UK voice so the model answers sound like HKDSE listening paper. */
function fluencyVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    const names = ['Daniel', 'Kate', 'Serena', 'Arthur',
        'Google UK English Female', 'Google UK English Male'];
    for (let i = 0; i < names.length; i += 1) {
        const hit = voices.filter(function (v) {
            return v.name && v.name.indexOf(names[i]) !== -1;
        })[0];
        if (hit) return hit;
    }
    return voices.filter(function (v) {
        return String(v.lang || '').toLowerCase().indexOf('en-gb') === 0;
    })[0] || voices.filter(function (v) {
        return String(v.lang || '').toLowerCase().indexOf('en') === 0;
    })[0] || null;
}

function fluencySpeakText(btn, text, rate) {
    if (!text) return;
    if (!('speechSynthesis' in window)) {
        updateMascot('This browser cannot read sentences aloud.');
        return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    if (FL.speakBtn && FL.speakBtn !== btn) FL.speakBtn.classList.remove('on');
    FL.speakBtn = btn;
    if (btn) btn.classList.add('on');

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    const voice = fluencyVoice();
    if (voice) {
        utterance.voice = voice;
        if (voice.lang) utterance.lang = voice.lang;
    }
    utterance.rate = rate || 0.92;
    utterance.pitch = 1;

    const clear = function () {
        if (btn) btn.classList.remove('on');
        if (FL.speakBtn === btn) FL.speakBtn = null;
    };
    utterance.onend = clear;
    utterance.onerror = clear;
    synth.speak(utterance);
}

function fluencySpeak(btn, n, kind) {
    const line = fluencyFindLine(kind, n);
    if (line) fluencySpeakText(btn, line.en, 0.92);
}

/* A no-data read-along on the Revision page. No score, no storage — just a
   useful sentence to listen to and repeat. */
const FLUENCY_READ_ALONG = [
    'I see your point, but I think we should consider another option.',
    'That is an interesting idea, and I would like to add one more reason.',
    'Could you explain what you mean by that?',
    'On the whole, I agree, although there is one small problem.',
    'To sum up, we need a solution that works for everyone.'
];
let fluencyReadAlongIndex = 0;

function fluencyReadAlongLine() {
    return FLUENCY_READ_ALONG[fluencyReadAlongIndex % FLUENCY_READ_ALONG.length];
}

function fluencyReadAlongPaint() {
    const el = document.getElementById('fluency-readalong-text');
    if (el) el.textContent = fluencyReadAlongLine();
}

function fluencyReadAlongSpeak(btn) {
    fluencySpeakText(btn, fluencyReadAlongLine(), 0.85);
}

function fluencyReadAlongNext() {
    fluencyStopSpeech();
    fluencyReadAlongIndex = (fluencyReadAlongIndex + 1) % FLUENCY_READ_ALONG.length;
    fluencyReadAlongPaint();
    updateMascot('Listen once, then read it aloud — match the rhythm!');
}

function fluencyStopSpeech() {
    if (FL.speakBtn) {
        FL.speakBtn.classList.remove('on');
        FL.speakBtn = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function fluencyRender(kind) {
    const host = document.getElementById(fluencyHostId(kind));
    const data = FLUENCY_DATA[kind];
    if (!host || !data) return;

    const rawQuery = String(FL.query[kind] || '').trim();
    const query = rawQuery.toLowerCase();
    const mode = FL.open[kind];
    const total = data.groups.reduce(function (sum, g) { return sum + g.lines.length; }, 0);

    // Group chips: "All" expands everything, a chip opens just that group.
    let chips = '<div class="fl-chips">';
    chips += '<button type="button" class="fl-chip' + (mode === 'all' ? ' is-on' : '')
        + '" onclick="fluencyExpand(\'' + kind + '\', \'all\')">All'
        + ' <span class="fl-chip-n">' + total + '</span></button>';
    data.groups.forEach(function (g, i) {
        chips += '<button type="button" class="fl-chip' + (mode === i ? ' is-on' : '')
            + '" onclick="fluencyExpand(\'' + kind + '\', ' + i + ')">'
            + g.emoji + ' ' + escapeHtml(g.name)
            + ' <span class="fl-chip-n">' + g.lines.length + '</span></button>';
    });
    chips += '</div>';

    let body = '';
    let shown = 0;

    data.groups.forEach(function (g, i) {
        const matches = g.lines.filter(function (line) {
            if (!query) return true;
            return (line.en + ' ' + line.zh).toLowerCase().indexOf(query) !== -1;
        });
        if (!matches.length) return;
        shown += matches.length;

        const open = query ? true : (mode === 'all' || mode === i);
        let section = '<section class="fl-sect' + (open ? ' open' : '')
            + '" data-group="' + i + '">';

        if (query) {
            section += '<div class="fl-sect-head is-static">';
        } else {
            section += '<button type="button" class="fl-sect-head" aria-expanded="'
                + (open ? 'true' : 'false') + '" onclick="fluencyToggle(\''
                + kind + '\', ' + i + ')">';
        }
        section += '<span class="fl-emoji">' + g.emoji + '</span>';
        section += '<span class="fl-sect-text">'
            + '<span class="fl-sect-name">' + escapeHtml(g.name) + '</span>'
            + '<span class="fl-sect-alt">' + escapeHtml(g.alt) + '</span></span>';
        section += '<span class="fl-sect-count">'
            + (query ? matches.length + '/' + g.lines.length : g.lines.length) + '</span>';
        if (!query) section += '<span class="fl-caret">&#9662;</span>';
        section += query ? '</div>' : '</button>';

        if (open) {
            section += '<div class="fl-sect-body">';
            matches.forEach(function (line) {
                section += '<div class="fl-line">';
                section += '<span class="fl-num">' + line.n + '</span>';
                section += '<div class="fl-text">'
                    + '<p class="fl-en">' + escapeHtml(line.en) + '</p>'
                    + '<p class="fl-zh">' + escapeHtml(line.zh) + '</p></div>';
                section += '<button type="button" class="fl-speak" aria-label="Read sentence '
                    + line.n + ' aloud" onclick="fluencySpeak(this, ' + line.n + ', \''
                    + kind + '\')">&#128266;</button>';
                section += '</div>';
            });
            section += '</div>';
        }
        section += '</section>';
        body += section;
    });

    if (!shown) {
        body = '<div class="fl-empty">No sentence matches &ldquo;'
            + escapeHtml(rawQuery) + '&rdquo;. Try another word.</div>';
    } else if (query) {
        body = '<p class="fl-note">' + shown + ' of ' + total
            + ' sentences match &ldquo;' + escapeHtml(rawQuery) + '&rdquo;.</p>' + body;
    }

    host.innerHTML = chips + body;
}

function fluencyToggle(kind, index) {
    if (FL.open[kind] === 'all') {
        FL.open[kind] = index;
    } else {
        FL.open[kind] = FL.open[kind] === index ? -1 : index;
    }
    fluencyRender(kind);
}

function fluencyExpand(kind, target) {
    FL.open[kind] = FL.open[kind] === target ? -1 : target;
    fluencyRender(kind);
    if (target === 'all') return;
    const host = document.getElementById(fluencyHostId(kind));
    const section = host && host.querySelector('.fl-sect[data-group="' + target + '"]');
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.pageYOffset - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function fluencySearch(kind, value) {
    FL.query[kind] = value || '';
    // While searching every matching sentence is shown, so the accordion
    // state does not matter until the box is cleared again.
    fluencyRender(kind);
}

export const QUESTS = [
  // ── 佛山 ──────────────────────────────
  {
    id:'q1', map:'foshan', npc:'葉問', img:'/npc/yip.png', reqLv:1,
    title:'閉門切磋',
    lines:[
      '最近手很癢，想找廖師傅閉門切磋一下。',
      '幫我討閥五個虛弱的廖師傅，還有一個正常狀態的。',
      '記住，習武之人，當自強不息。',
    ],
    goals:[{ id:'liao_weak', n:5 }, { id:'liao', n:1 }],
    reward:{ exp:29, gold:300 },
    done:'好，這下手不癢了。多謝。',
  },
  {
    id:'q2', map:'foshan', npc:'沙膽原', img:'/npc/sha.png', reqLv:5,
    title:'嘴巴太快',
    lines:[
      '上次看到問叔跟廖師傅閉門切磋，我講出去，害我被罵了一頓。',
      '幫我教訓事主，廖師傅和武癡林各五個。',
      '這叫做，出來混總是要還的。',
    ],
    goals:[{ id:'liao', n:5 }, { id:'lin', n:5 }],
    reward:{ exp:88, gold:600 },
    done:'夠了夠了，我的氣消了。錢拿去。',
  },
  {
    id:'q3', map:'foshan', npc:'肥波', img:'/npc/bo.png', reqLv:10,
    title:'不能讓洋人囂張',
    lines:[
      '我來報料！你寫死他！',
      '不能讓洋人這麼囂張，幫我處理掉龍捲風。',
      '順便清十個甲片逆斯，一起算。',
    ],
    goals:[{ id:'twister', n:1 }, { id:'jiapian', n:10 }],
    reward:{ exp:232, gold:1200 },
    done:'漂亮！這才叫大快人心。',
  },
  {
    id:'q4', map:'foshan', npc:'葉問', img:'/npc/yip.png', reqLv:15,
    title:'武館與家人',
    lines:[
      '他認為分勝負比跟家人吃飯重要。',
      '我沒錢交會費，他就擋我開武館。',
      '幫我處理洪師傅。順便問他，有沒有看見我老婆。',
    ],
    goals:[{ id:'hung', n:1 }, { id:'jinshan', n:5 }],
    reward:{ exp:507, gold:2400, scroll:1 },
    done:'……她說她會等我回去吃飯。多謝你。',
  },

  // ── 終局戰 ────────────────────────────
  {
    id:'e1', map:'endgame', npc:'馬大師', img:'/npc/ma.png', reqLv:15,
    title:'冒充我的絕技',
    lines:[
      '最近有人模仿我馬大師的絕技，招式學得七零八落。',
      '幫我除掉八個閃電鞭，讓他們知道什麼叫傳統武術。',
      '不要再冒充我的身分了！',
    ],
    goals:[{ id:'whip', n:8 }],
    reward:{ exp:558, gold:3000 },
    done:'好，這才是真功夫。年輕人，可以。',
  },
  {
    id:'e2', map:'endgame', npc:'蜘蛛人', img:'/npc/spider.png', reqLv:22,
    title:'這個時間線我扁得到他',
    lines:[
      '神秘客就是個王八蛋，騙我騙得團團轉。',
      '不過在這個時間線，我還扁得到他。',
      '幫我殺十個神秘客，一個都別放過。',
    ],
    goals:[{ id:'myst', n:10 }],
    reward:{ exp:969, gold:6000 },
    done:'謝了。這次換他被騙。',
  },
  {
    id:'e3', map:'endgame', npc:'鋼鐵人', img:'/npc/iron.png', reqLv:30,
    title:'空間開關費',
    lines:[
      '你好，我是鋼鐵俠，我還沒死。',
      '我被困在靈魂寶石裡面，需要 30,000 元交空間開關費才能出來。',
      '我的支付寶帳號是 98587083，你現在幫我，我承諾把史塔克工業給你。',
      '如果沒辦法……那幫我打掉薩諾斯也行。',
    ],
    goals:[{ id:'thanos', n:1 }],
    branch:{
      pay:{ cost:30000, label:'匯 30,000 給他', gear:'stark',
            done:'錢收到了！史塔克工業歸你。我就知道你是好人。' },
      fight:{ label:'我還是去打薩諾斯',
            done:'……行吧。反正結果一樣。' },
    },
    reward:{ exp:1460, gold:10000, scroll:2 },
    done:'……行吧。反正結果一樣。',
  },

  // ── 鬧鬼宅邸 ──────────────────────────
  {
    id:'h1', map:'haunted', npc:'大媽', img:'/npc/auntie.png', reqLv:15,
    title:'宅邸鬧鬼',
    lines:[
      '收到消息說這棟宅邸鬧鬼，我一個人不敢進去。',
      '請你前去調查，先清掉十個邪惡娃娃看看。',
      '小心點，那些娃娃會自己動。',
    ],
    goals:[{ id:'evildoll', n:10 }],
    reward:{ exp:558, gold:4500 },
    done:'真的有鬼……我還以為是誰在惡作劇。',
  },
  {
    id:'h2', map:'haunted', npc:'膽小狗', img:'/npc/coward.png', reqLv:22,
    title:'拯救茉莉兒',
    lines:[
      '嗚……必須拯救茉莉兒，她被困在裡面了。',
      '替我殺掉八隻邪惡小丑，然後……然後要順便詛咒奧提斯。',
      '所以也殺掉八個巫毒娃娃。拜託你了，我不敢去。',
    ],
    goals:[{ id:'clown', n:8 }, { id:'voodoo', n:8 }],
    reward:{ exp:969, gold:9000 },
    done:'茉莉兒得救了！謝謝你……我還是不敢進去。',
  },
  {
    id:'h3', map:'haunted', npc:'道長', img:'/npc/taoist.png', reqLv:30,
    title:'源頭',
    lines:[
      '貧道查了三天三夜，這股怨氣的源頭找到了。',
      '除掉牛來，然後回來向我回報。',
      '實在太詭異了，這東西不該存在於此。',
    ],
    goals:[{ id:'niulai', n:1 }],
    reward:{ exp:1460, gold:15000, scroll:3 },
    done:'……牛來只是個開始。日後恐怕還有更強的。',
  },

  // ── 地獄 ──────────────────────────────
  {
    id:'d1', map:'hell', npc:'但丁', img:'/npc/dante.png', reqLv:30,
    title:'你確定要往下走？',
    lines:[
      '我寫了三部。地獄、煉獄、天堂。',
      '你猜大家只讀哪一部。',
      '……對。所以我回來了，要寫續集。',
      '幫我確認一件事：地獄三頭犬到底有幾顆頭。我當年是用猜的。',
    ],
    goals:[{ id:'cerberus', n:12 }],
    reward:{ exp:3341, gold:9000 },
    done:'三顆。跟我猜的一樣。這次我可以寫得很有把握了。',
  },
  {
    id:'d2', map:'hell', npc:'波瑟芬妮', img:'/npc/perse.png', reqLv:35,
    title:'一年只能回家半年',
    lines:[
      '我媽一不高興，人間就沒有收成。你知道那壓力有多大嗎。',
      '而且我不能告訴她，其實我在下面待得還不錯。',
      '這裡冷氣很強，同事也不會問我什麼時候生小孩。',
      '幫我出個氣。冥河渡夫和赫卡忒各清十個。對，我知道他們是我同事。',
    ],
    goals:[{ id:'charon', n:10 }, { id:'hecate', n:10 }],
    reward:{ exp:4512, gold:13000 },
    done:'舒服多了。這件事不要跟我媽講，她會以為我被欺負。',
  },
  {
    id:'d3', map:'hell', npc:'收帳惡魔', img:'/npc/collector.png', reqLv:40,
    title:'地獄也是要看帳的',
    lines:[
      '浮士德那筆，簽了四百年，到現在還在跑訴訟。',
      '他說當初條款寫得不清楚。我說白紙黑字啊。他說那是羊皮紙。',
      '現在塔納托斯和復仇女神也想比照辦理。',
      '去讓他們知道，地獄的合約沒有鑑賞期。',
    ],
    goals:[{ id:'thanatos', n:12 }, { id:'furies', n:12 }],
    reward:{ exp:5854, gold:18000, scroll:1 },
    done:'帳平了。你做事俐落，要不要也簽一份？……開玩笑的。大概。',
  },
  {
    id:'d4', map:'hell', npc:'墮天使', img:'/npc/fallen.png', reqLv:45,
    title:'我的羽毛',
    lines:[
      '下個月是天堂同學會。',
      '我不是不能去，是我沒有翅膀，去了很難看。',
      '羽毛掉下來的時候散了一地。別西卜撿了三根插在帽子上，利維坦吞了兩根。',
      '我不想自己去要。我怕他們問我最近過得好不好。',
    ],
    goals:[{ id:'beelze', n:15 }, { id:'leviath', n:10 }],
    reward:{ exp:7366, gold:24000, scroll:1 },
    done:'……算了，我還是不去了。羽毛你留著，做個枕頭吧。',
  },
  {
    id:'d5', map:'hell', npc:'判官', img:'/npc/judge.png', reqLv:50,
    title:'卷宗不見了',
    lines:[
      '三千年的審判紀錄，全部不見了。',
      '我調了監視器——對，地獄有監視器——是黑帝斯自己搬走的。',
      '因為裡面有他的紀錄。而且那一頁我剛好蓋了「重審」。',
      '順便清掉尼德霍格。那條龍一直在啃卷宗架，我懷疑牠是共犯。',
    ],
    goals:[{ id:'hades', n:1 }, { id:'nidhogg', n:8 }],
    reward:{ exp:9046, gold:32000, scroll:2 },
    done:'找到了。在他抽屜第二層，壓在外賣菜單下面。他說他忘了。',
  },

  // ── 日本黑道 ──────────────────────────
  {
    id:'y1', map:'yakuza', npc:'拉麵店老闆', img:'/npc/ramen.png', reqLv:50,
    title:'保護費',
    lines:[
      '這條街我開了三十年，保護費從一個月三千繳到三萬。',
      '上個月他們說要漲到五萬，理由是通膨。',
      '我不想搬。你幫我，我請你吃一輩子拉麵。',
    ],
    goals:[{ id:'punk', n:20 }, { id:'bosozoku', n:15 }],
    reward:{ exp:9046, gold:40000 },
    done:'他們今天沒來。你要加麵嗎？加麵免費。',
  },
  {
    id:'y2', map:'yakuza', npc:'臥底刑警', img:'/npc/cop.png', reqLv:55,
    title:'帳本',
    lines:[
      '我在這裡待了七年，七年。',
      '我老婆以為我在跑船。我兒子今年小學畢業了。',
      '山口組組長身上有本帳，拿到我就能收工。拜託你。',
    ],
    goals:[{ id:'kumicho', n:10 }, { id:'onna', n:1 }],
    reward:{ exp:10893, gold:55000, scroll:2 },
    done:'……我可以回家了。謝謝你。真的。',
  },

  // ── 日本古代 ──────────────────────────
  {
    id:'s1', map:'sengoku', npc:'德川家康', img:'/npc/ieyasu.png', reqLv:60,
    title:'等待的藝術',
    lines:[
      '我這個人有個原則：能等的事，絕不動手。',
      '但等太久也不行，人會忘記你還活著。',
      '上杉謙信和源義經那邊，你去替我提醒一下。各二十個。',
    ],
    goals:[{ id:'kenshin', n:20 }, { id:'yoshi', n:20 }],
    reward:{ exp:12908, gold:70000, scroll:2 },
    done:'很好。天下人做事，就是要別人替你做。',
  },
  {
    id:'s2', map:'sengoku', npc:'茶道宗師', img:'/npc/tea.png', reqLv:65,
    title:'這杯茶有點苦',
    lines:[
      '請坐。這是宇治的新茶。',
      '……武田信玄上個月在茶會上說我的手法俗氣。',
      '當著三十個人的面。',
      '茶要趁熱喝。他也是。',
    ],
    goals:[{ id:'shingen', n:18 }, { id:'tadakatsu', n:8 }],
    reward:{ exp:15088, gold:90000, scroll:3 },
    done:'茶涼了。不過心情好多了。再來一杯？',
  },

  // ── 亂象之島 ──────────────────────────
  {
    id:'chaos1', map:'chaos', npc:'年輕人', img:'/lv70/npc_young.png', reqLv:70,
    title:'快活不下去了',
    lines:[
      '毒牛、毒豬、毒馬鈴薯，現在連油都有問題，快活不下去了。',
      '至少幫我把油王幹掉十五個，還有那個造謠潑婦——',
      '我PO我租屋處的照片，他來搭什麼版？一起解決掉。',
    ],
    goals:[{ id:'oilking', n:15 }, { id:'rumorhag', n:15 }],
    reward:{ exp:18000, gold:110000, scroll:2, gearChoice:['exposer','wingrobe','trollhelm','cogwar'] },
    done:'舒服多了，希望能有個更好的未來。',
  },
  {
    id:'chaos2', map:'chaos', npc:'陳情民眾', img:'/lv70/npc_petition.png', reqLv:85,
    title:'別讓他們囂張',
    lines:[
      '台南淹大水，叫我們不能有意見，台北淹水你話挺多的。',
      '我想找他講句話都不行。',
      '把他的支持者削弱，別讓他再囂張了——噁心側翼、哭不出來、噁T，各十五個。',
    ],
    goals:[{ id:'wingbear', n:15 }, { id:'crybaby8088', n:15 }, { id:'grosst', n:15 }],
    reward:{ exp:24000, gold:150000, scroll:3, gearChoice:['throatcut','demoarmor','awakenhat','wingmedal'] },
    done:'總算出了口氣，但這些死忠的，不知何時才能清醒。',
  },
  {
    id:'chaos3', map:'chaos', npc:'媽祖', img:'/lv70/npc_mazu.png', reqLv:100,
    title:'連我都騙',
    lines:[
      '連我都騙，這些人不得好死。',
      '賦予你使命，幹掉他們：狗食王，還有智商不足關懷人士、相由心生 噁王、立院平偉——後面這三個各二十個。',
    ],
    goals:[{ id:'dogfoodking', n:1 }, { id:'lowiqcare', n:20 }, { id:'faceking', n:20 }, { id:'councilpingwei', n:20 }],
    reward:{ exp:32000, gold:200000, scroll:4, gearChoice:['godmaker','tabletrobe','chosencrown','petbadge'] },
    done:'……不知道還要騙到什麼時候。',
  },

  // ── 無處鎮 · LV100-120 ────────────────
  // 每日重置，可無限重複。前三個給寵物（T1/T2/T3），第四個只做兌換。
  {
    id:'nw1', map:'nowhere', npc:'茉莉兒', img:'/nowhere/npc_muriel.png', reqLv:100, daily:true,
    title:'地窖裡有東西',
    lines:[
      '親愛的，我去窖裡拿醃黃瓜，結果有東西在動。',
      '奧提斯說我老花，不過我真的看到了。',
      '你去幫我看看好不好？我烤了麵包。',
    ],
    goals:[{ id:'alienchick', n:20 }, { id:'fred', n:20 }],
    reward:{ exp:120000, gold:60000, pet:'eggplantHero' },
    done:'你看，我就說吧。奧提斯才是眼睛有問題的那一個。麵包還熱著，帶回去吃。啊，對了——這個小東西一直跟在你後面，我想牠是跟定你了。',
  },
  {
    id:'nw2', map:'nowhere', npc:'奧提斯', img:'/nowhere/npc_eustace.png', reqLv:106, daily:true,
    title:'滾出我的農場',
    lines:[
      '又是你。那條小笨狗的朋友。',
      '……好吧。後面那幾件事讓我睡不著。',
      '解決掉，然後滾。別跟我說謝謝。',
    ],
    goals:[{ id:'stitchsis', n:20 }, { id:'puddlewitch', n:18 }, { id:'eggplant', n:5 }],
    reward:{ exp:260000, gold:130000, pet:'slabHero' },
    done:'……吵死了，安靜多了。哼。別站在那裡等我說什麼。那個東西你拿走，我不要。留在農場只會擋路。',
  },
  {
    id:'nw3', map:'nowhere', npc:'英雄', img:'/nowhere/npc_courage.png', reqLv:112, daily:true,
    title:'（他說不出話，只是一直發抖）',
    lines:[
      '…………',
      '（他指著遠方，然後指指自己的胸口，又搖搖頭。）',
      '（他把一張皺掉的紙塞給你。上面畫著三個東西。）',
    ],
    goals:[{ id:'magicpie', n:18 }, { id:'duckdoctor', n:16 }, { id:'foxelite', n:5 }],
    reward:{ exp:520000, gold:260000, pet:'murielHero' },
    done:'…………！（他抱住你的腿抖了很久，然後鬆開。）（他把紙翻到背面。上面畫著一個往上的箭頭，指著天空。）',
  },
  {
    id:'nw4', map:'nowhere', npc:'英雄爸媽', img:'/nowhere/npc_parents.png', reqLv:120, daily:true,
    title:'把他帶回來',
    lines:[
      '我們在太空站看著他長大了。每一天。',
      '如果你手上有他的樣子——三個都有——',
      '我們可以變給你一個更棒的英雄。',
    ],
    goals:[],
    exchange:['eggplantHero','slabHero','murielHero'],   // 繳交這三隻
    reward:{ exp:0, gold:0, exchangeBaby:true },
    done:'好了。這是還沒學會害怕之前的他。……幫我們跟他說一聲，我們都有在看。每一天。',
  },
];

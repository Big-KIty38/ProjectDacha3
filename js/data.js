// Каталоги ресурсов, культур огорода, рецептов переработки/крафта, построек, Магазина и Базара + Звуки

export const ITEMS = {
  wood: { name: "Брёвна", icon: "🪵", food: 0 },
  branch: { name: "Ветки", icon: "🌿", food: 0 },
  stone: { name: "Камень", icon: "🪨", food: 0 },
  berry: { name: "Лесные ягоды", icon: "🍓", food: 18 },
  plank: { name: "Доски", icon: "🪚", food: 0 },
  timber: { name: "Брус", icon: "🧱", food: 0 },
  brick: { name: "Кирпич", icon: "🧱", food: 0 },
  glass: { name: "Стеклопакет", icon: "🪟", food: 0 },
  fertilizer: { name: "Удобрение", icon: "🧪", food: 0 },
  seed_potato: { name: "Семена картофеля", icon: "🥔", food: 0 },
  seed_cucumber: { name: "Семена огурцов", icon: "🥒", food: 0 },
  seed_tomato: { name: "Семена помидоров", icon: "🍅", food: 0 },
  seed_strawberry: { name: "Саженцы клубники", icon: "🍓", food: 0 },
  potato: { name: "Картофель", icon: "🥔", food: 26 },
  cucumber: { name: "Огурцы", icon: "🥒", food: 28 },
  tomato: { name: "Помидоры", icon: "🍅", food: 34 },
  strawberry: { name: "Садовая клубника", icon: "🍓", food: 42 },
  jam: { name: "Ягодное варенье", icon: "🫙", food: 65 },
  pickles: { name: "Дачные соленья", icon: "🥫", food: 80 },
  pie: { name: "Дачный пирожок", icon: "🥟", food: 50 }
};

export const CROPS = {
  potato: {
    id: "potato",
    name: "Картофель",
    seedItem: "seed_potato",
    produceItem: "potato",
    yieldCount: 4,
    growSeconds: 32,
    color: 0xd7ccc8
  },
  cucumber: {
    id: "cucumber",
    name: "Огурцы",
    seedItem: "seed_cucumber",
    produceItem: "cucumber",
    yieldCount: 4,
    growSeconds: 38,
    color: 0x66bb6a
  },
  tomato: {
    id: "tomato",
    name: "Помидоры",
    seedItem: "seed_tomato",
    produceItem: "tomato",
    yieldCount: 4,
    growSeconds: 45,
    color: 0xe53935
  },
  strawberry: {
    id: "strawberry",
    name: "Клубника",
    seedItem: "seed_strawberry",
    produceItem: "strawberry",
    yieldCount: 4,
    growSeconds: 50,
    color: 0xd81b60
  }
};

export const CRAFT_RECIPES = [
  {
    id: "craft_plank",
    title: "🪚 Доски (x4)",
    desc: "Распил брёвен на строительные доски для грядок, забора и домов.",
    cost: { wood: 1 },
    out: { plank: 4 }
  },
  {
    id: "craft_timber",
    title: "🧱 Профилированный брус (x2)",
    desc: "Крепкий брус для строительства срубов, бани, колодца и двухэтажных дач.",
    cost: { wood: 2, plank: 2 },
    out: { timber: 2 }
  },
  {
    id: "craft_brick",
    title: "🧱 Обожжённый кирпич (x3)",
    desc: "Обжиг камня на дровах для постройки печей и кирпичных коттеджей.",
    cost: { stone: 2, wood: 1 },
    out: { brick: 3 }
  },
  {
    id: "craft_glass",
    title: "🪟 Стеклопакет / Поликарбонат (x2)",
    desc: "Прозрачные панели для теплиц и светящихся окон дачных домов.",
    cost: { stone: 2, branch: 2 },
    out: { glass: 2 }
  },
  {
    id: "craft_fertilizer",
    title: "🧪 Био-удобрение (x2)",
    desc: "Переработка веток и ягод в компост — мгновенно ускоряет созревание грядок!",
    cost: { branch: 3, berry: 2 },
    out: { fertilizer: 2 }
  },
  {
    id: "craft_axe",
    title: "🪓 Стальной топор лесоруба",
    desc: "Удваивает добычу брёвен при рубке деревьев!",
    cost: { wood: 2, stone: 3 },
    tool: "axe"
  },
  {
    id: "craft_can",
    title: "🚿 Садовая лейка",
    desc: "Позволяет обильно поливать грядки и ускоряет рост урожая в 2 раза!",
    cost: { plank: 3, stone: 2 },
    tool: "watering_can"
  },
  {
    id: "craft_jam",
    title: "🫙 Банка ягодного варенья",
    desc: "Домашнее варенье из лесных ягод: +65% сытости или выгодная продажа на Базаре (95 ₽)!",
    cost: { berry: 5, plank: 1 },
    out: { jam: 1 }
  },
  {
    id: "craft_pickles",
    title: "🥫 Дачные соленья «Ассорти»",
    desc: "Банка маринованных огурцов и томатов: +80% сытости или продажа на Базаре за 160 ₽!",
    cost: { cucumber: 2, tomato: 2, plank: 1 },
    out: { pickles: 1 }
  }
];

export const BUILDINGS = [
  {
    type: "bed",
    name: "🌱 Грядка для огорода",
    desc: "Позволяет выращивать картофель, огурцы, помидоры и клубнику.",
    cost: { plank: 3, branch: 2 }
  },
  {
    type: "greenhouse",
    name: "🏡 Теплица из поликарбоната",
    desc: "Крытый парник: культуры внутри растут в 2 раза быстрее и дают +2 плода!",
    cost: { plank: 6, timber: 2, glass: 2 }
  },
  {
    type: "fence",
    name: "🚧 Деревянный забор (4м)",
    desc: "Классический дачный штакетник для ограждения своих участков.",
    cost: { plank: 2, branch: 1 }
  },
  {
    type: "well",
    name: "🪣 Дачный колодец",
    desc: "Бревенчатый колодец с ключевой водой на участке.",
    cost: { timber: 3, stone: 3 }
  },
  {
    type: "workbench",
    name: "🪚 Пилорама / Верстак",
    desc: "Столярный станок для украшения и обустройства мастерской на даче.",
    cost: { plank: 4, wood: 2, stone: 2 }
  },
  {
    type: "gazebo",
    name: "🔥 Беседка с мангалом",
    desc: "Уютная шестигранная беседка с мангалом для отдыха дачников.",
    cost: { plank: 6, timber: 2, stone: 2 }
  },
  {
    type: "shed",
    name: "🏚️ Дачная бытовка (Стартовый домик)",
    desc: "Небольшой тёплый деревянный вагончик со светящимся окошком.",
    cost: { plank: 8, wood: 2 }
  },
  {
    type: "house_wood",
    name: "🏠 Деревянная дача «Классика»",
    desc: "Добротный одноэтажный дом из бруса с крытой верандой и зелёной крышей.",
    cost: { plank: 10, timber: 6 }
  },
  {
    type: "banya",
    name: "🧖 Русская баня из сруба",
    desc: "Бревенчатая баня с каменной печью и трубой (восстанавливает бодрость рядом!).",
    cost: { wood: 6, timber: 5, stone: 4 }
  },
  {
    type: "house_terem",
    name: "🏡 Двухэтажный дом «Терем»",
    desc: "Высокий двухэтажный деревянный дом с мансардой и балконом.",
    cost: { plank: 12, timber: 10, glass: 2 }
  },
  {
    type: "house_brick",
    name: "🏰 Кирпичный коттедж «Престиж» (2 этажа)",
    desc: "Роскошный двухэтажный кирпичный особняк с белыми колоннами и черепичной крышей.",
    cost: { brick: 12, timber: 8, glass: 4 }
  }
];

export const SHOP_GOODS = [
  { id: "buy_seed_potato", title: "🥔 Семена картофеля (x2)", desc: "Неприхотливая культура для первых грядок.", price: 20, out: { seed_potato: 2 } },
  { id: "buy_seed_cucumber", title: "🥒 Семена огурцов (x2)", desc: "Хрустящие дачные огурчики для продажи и солений.", price: 28, out: { seed_cucumber: 2 } },
  { id: "buy_seed_tomato", title: "🍅 Семена помидоров (x2)", desc: "Спелые томаты для салатов, солений и базара.", price: 36, out: { seed_tomato: 2 } },
  { id: "buy_seed_straw", title: "🍓 Саженцы клубники (x2)", desc: "Дорогая садовая ягода с высокой ценой на базаре.", price: 50, out: { seed_strawberry: 2 } },
  { id: "buy_pie", title: "🥟 Горячий дачный пирожок", desc: "Сразу восстанавливает +50% сытости при перекусе.", price: 25, out: { pie: 1 } },
  { id: "buy_fert", title: "🧪 Удобрение «Био-Дача» (x2)", desc: "Ускоряет созревание любой грядки.", price: 35, out: { fertilizer: 2 } },
  { id: "buy_plank", title: "🪚 Пачка досок (x6)", desc: "Готовые пиломатериалы для быстрой стройки.", price: 45, out: { plank: 6 } },
  { id: "buy_timber", title: "🧱 Комплект бруса (x4)", desc: "Профилированный брус для строительства домов.", price: 70, out: { timber: 4 } },
  { id: "buy_brick", title: "🧱 Поддон кирпича (x6)", desc: "Красный строительный кирпич для коттеджа и бани.", price: 95, out: { brick: 6 } },
  { id: "buy_glass", title: "🪟 Стеклопакеты (x3)", desc: "Для строительства теплиц и двухэтажных домов.", price: 65, out: { glass: 3 } }
];

export const BAZAAR_PRICES = [
  { item: "berry", price: 8, desc: "Дикорастущая лесная ягода с кустов" },
  { item: "wood", price: 10, desc: "Круглый лес (брёвна)" },
  { item: "stone", price: 9, desc: "Природный бутовый камень" },
  { item: "plank", price: 6, desc: "Пиломатериал (доска обрезная)" },
  { item: "timber", price: 20, desc: "Брус строительный" },
  { item: "brick", price: 24, desc: "Кирпич керамический" },
  { item: "potato", price: 20, desc: "Молодой дачный картофель с грядки" },
  { item: "cucumber", price: 28, desc: "Свежие грунтовые огурцы" },
  { item: "tomato", price: 36, desc: "Спелые дачные помидоры" },
  { item: "strawberry", price: 52, desc: "Крупная садовая клубника" },
  { item: "jam", price: 95, desc: "Домашнее ягодное варенье (крафт)" },
  { item: "pickles", price: 160, desc: "Дачные соленья в банке (крафт)" }
];

let audioCtx = null;
export function playSfx(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === "chop") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.11);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === "pick") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(680, now + 0.1);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.11);
      osc.start(now);
      osc.stop(now + 0.11);
    } else if (type === "coin") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(587, now);
      osc.frequency.setValueAtTime(880, now + 0.07);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === "build") {
      osc.type = "square";
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.14);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    }
  } catch {}
}

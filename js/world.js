// Детерминированная генерация бесконечного мира: неровный рельеф, дороги, СНТ, участки, лес, кусты с ягодами

export const CHUNK_SIZE = 160;
export const WORLD_SEED = 20260777;

const SNT_TITLES = [
  "Лесная Поляна",
  "Берёзка",
  "Мичуринец",
  "Ягодное",
  "Сосновый Бор",
  "Рассвет",
  "Рябинушка",
  "Зелёный Огонёк",
  "Дружба",
  "Ромашка",
  "Лесной Ручей",
  "Весна"
];

export function hash2D(x, z, salt = 0) {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(z ^ 0xc2b2ae35, 0x27d4eb2f) ^ (WORLD_SEED + salt);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Изгиб главного лесного шоссе (идёт с севера на юг через весь мир)
export function getHighwayX(z) {
  return Math.sin(z * 0.012) * 14 + Math.cos(z * 0.0045) * 9;
}

// Плавный неровный рельеф с небольшими возвышенностями и низменностями
export function getTerrainHeight(x, z) {
  const n1 = Math.sin(x * 0.021 + 0.7) * Math.cos(z * 0.021 - 0.4) * 2.4;
  const n2 = Math.sin((x + z) * 0.043) * 1.15 + Math.cos((x - z) * 0.037) * 0.95;
  const n3 = Math.sin(x * 0.09) * Math.sin(z * 0.09) * 0.35;
  let raw = n1 + n2 + n3;

  // Слегка сглаживаем рельеф на дорогах и внутри СНТ, сохраняя плавные холмы и низины
  const cx = Math.floor((x + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const cz = Math.floor((z + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;

  const lx = x - centerX;
  const lz = z - centerZ;

  // В зоне участков и подъездной дороги перепад высот более мягкий, чтобы дома стояли красиво
  if (Math.abs(lx) < 58 && Math.abs(lz) < 54) {
    const baseChunkH =
      Math.sin(centerX * 0.021 + 0.7) * Math.cos(centerZ * 0.021 - 0.4) * 1.9 +
      Math.sin((centerX + centerZ) * 0.035) * 0.9;
    raw = baseChunkH + (raw - baseChunkH) * 0.32;
  }

  return raw;
}

// Классификация поверхности для цвета травы/дорог/газона
export function getSurfaceType(x, z) {
  const cx = Math.floor((x + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const cz = Math.floor((z + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;
  const lx = x - centerX;
  const lz = z - centerZ;

  // 1. Главное шоссе вдоль центральных чанков или межрайонных трактов
  const hwyX = getHighwayX(z) + cx * CHUNK_SIZE - (cx === 0 ? 0 : lx * 0);
  if (cx === 0 && Math.abs(x - getHighwayX(z)) < 5.2) {
    return "asphalt";
  }

  // 2. Поперечная лесная дорога, соединяющая соседние садоводства и шоссе (при lz около +42)
  const roadZ = 42 + Math.sin(x * 0.025) * 3.5;
  if (Math.abs(lz - roadZ) < 4.2) {
    return "dirt_road";
  }

  // 3. Подъездная дорога от тракта к воротам СНТ и центральная аллея СНТ (lz от -34 до +42, lx около 0 или вдоль линии)
  if (lz >= -10 && lz <= roadZ + 2 && Math.abs(lx) < 4.0) {
    return "dirt_road";
  }
  // Центральная улица СНТ вдоль рядов дач (lz около 0, lx от -46 до +46)
  if (Math.abs(lz) < 4.2 && Math.abs(lx) < 47) {
    return "dirt_road";
  }

  // 4. Газон внутри дачных участков (2 ряда по 4 участка)
  if (Math.abs(lx) >= 4 && Math.abs(lx) <= 44 && ((lz >= 5 && lz <= 25) || (lz >= -25 && lz <= -5))) {
    return "lawn";
  }

  // 5. Площадка у Магазина и Базара (при въезде в СНТ)
  if (lz >= 25 && lz <= 38 && Math.abs(lx) <= 22) {
    return "plaza";
  }

  return "forest";
}

// Получение полной структуры СНТ для чанка (cx, cz)
export function getChunkLayout(cx, cz) {
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;
  const idx = Math.floor(hash2D(cx, cz, 11) * SNT_TITLES.length);
  const regionNum = Math.abs(cx * 7 + cz * 13) + 1;
  const sntName =
    cx === 0 && cz === 0
      ? "СНТ «Лесная Поляна»"
      : `СНТ «${SNT_TITLES[idx]}${regionNum > 1 ? "-" + regionNum : ""}»`;

  // Координаты въездной арки, Магазина и Базара
  const archPos = { x: centerX, z: centerZ + 33 };
  const shopPos = { x: centerX - 12.5, z: centerZ + 31.5 };
  const bazaarPos = { x: centerX + 12.5, z: centerZ + 31.5 };

  // 8 участков в каждом СНТ (4 севернее центральной аллеи, 4 южнее)
  // Центры по lx: -34, -14, +14, +34; по lz: -15 (северный ряд) и +15 (южный ряд)
  const plotOffsetsX = [-34, -14, 14, 34];
  const plotRowsZ = [
    { lz: -15, signLz: -4.8, signRot: 0 },
    { lz: 15, signLz: 4.8, signRot: Math.PI }
  ];

  const plots = [];
  let localNum = 1;
  for (let r = 0; r < plotRowsZ.length; r++) {
    for (let c = 0; c < plotOffsetsX.length; c++) {
      const px = centerX + plotOffsetsX[c];
      const pz = centerZ + plotRowsZ[r].lz;
      const plotNum = Math.abs(cx * 30 + cz * 10) * 10 + 100 + localNum;
      const plotId = `plot_${cx}_${cz}_${localNum}`;
      plots.push({
        plotId,
        cx,
        cz,
        localIndex: localNum,
        plotNum,
        sntName,
        x: px,
        z: pz,
        w: 18,
        d: 18,
        signX: px - 5.5,
        signZ: centerZ + plotRowsZ[r].signLz,
        signRot: plotRowsZ[r].signRot
      });
      localNum++;
    }
  }

  // Генерация ресурсов (на участках изначально только деревья, газон и кусты с ягодами; вокруг СНТ — густой лес и камни)
  const resources = [];

  // A) Ресурсы внутри каждого дачного участка (деревья и кусты, включая ягодные)
  for (const p of plots) {
    for (let i = 0; i < 8; i++) {
      const rx = (hash2D(p.plotNum, i, 101) - 0.5) * (p.w - 3.6);
      const rz = (hash2D(p.plotNum, i, 202) - 0.5) * (p.d - 3.6);
      const wx = p.x + rx;
      const wz = p.z + rz;
      const roll = hash2D(p.plotNum, i, 303);
      let kind = "berry_bush";
      if (i < 2) {
        kind = roll > 0.45 ? "birch" : "pine";
      } else if (i < 4) {
        kind = roll > 0.5 ? "birch" : "bush";
      } else {
        kind = roll > 0.3 ? "berry_bush" : "bush";
      }
      resources.push({
        id: `res_${cx}_${cz}_p${p.localIndex}_${i}`,
        kind,
        x: wx,
        z: wz,
        scale: 0.85 + hash2D(p.plotNum, i, 404) * 0.35,
        rot: hash2D(p.plotNum, i, 505) * Math.PI * 2,
        onPlotId: p.plotId
      });
    }
  }

  // B) Ресурсы в диком лесу вокруг СНТ (берёзы, сосны, ягодные кусты, валуны камня)
  for (let i = 0; i < 72; i++) {
    const lx = (hash2D(cx * 100 + i, cz, 601) - 0.5) * (CHUNK_SIZE - 8);
    const lz = (hash2D(cx, cz * 100 + i, 702) - 0.5) * (CHUNK_SIZE - 8);
    const wx = centerX + lx;
    const wz = centerZ + lz;

    // Не спавним деревья прямо на дорогах, участках или в павильонах магазина/базара
    const surf = getSurfaceType(wx, wz);
    if (surf !== "forest") continue;

    const roll = hash2D(cx + i, cz - i, 803);
    let kind = "pine";
    if (roll < 0.34) kind = "birch";
    else if (roll < 0.64) kind = "pine";
    else if (roll < 0.80) kind = "berry_bush";
    else if (roll < 0.90) kind = "bush";
    else kind = "rock";

    resources.push({
      id: `res_${cx}_${cz}_f_${i}`,
      kind,
      x: wx,
      z: wz,
      scale: 0.8 + hash2D(cx, cz + i, 904) * 0.55,
      rot: hash2D(cx + i, cz, 995) * Math.PI * 2,
      onPlotId: null
    });
  }

  return {
    cx,
    cz,
    centerX,
    centerZ,
    sntName,
    archPos,
    shopPos,
    bazaarPos,
    plots,
    resources
  };
}

// Детерминированная генерация бесконечного мира в масштабе 1:1 к человеку:
// Густая тайга, редкие садоводства СНТ далеко друг от друга (~960 м),
// в каждом СНТ 4 квартала (блока) по 4 участка (2x2 = 4 в блоке, всего 16 участков в СНТ).

export const CHUNK_SIZE = 320;
export const SNT_GRID_STEP = 3; // Центры СНТ каждые 3 чанка = 960 м друг от друга (~740 м глухой тайги между ними)
export const WORLD_SEED = 20261111;

const SNT_TITLES = [
  "Лесная Поляна",
  "Таёжный Ключ",
  "Кедровая Роща",
  "Ягодное",
  "Сосновый Бор",
  "Северный Рассвет",
  "Пихтовый Ручей",
  "Зелёный Огонёк",
  "Дружба",
  "Брусничное",
  "Тихая Заводь",
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

export function hasEastWestHighway(cz) {
  return ((cz % SNT_GRID_STEP) + SNT_GRID_STEP) % SNT_GRID_STEP === 0;
}

export function hasNorthSouthHighway(cx) {
  return ((cx % SNT_GRID_STEP) + SNT_GRID_STEP) % SNT_GRID_STEP === 0;
}

export function hasSntAtChunk(cx, cz) {
  return hasNorthSouthHighway(cx) && hasEastWestHighway(cz);
}

// Неровный таёжный рельеф с плавными возвышенностями и ложбинами
export function getTerrainHeight(x, z) {
  const n1 = Math.sin(x * 0.012 + 0.7) * Math.cos(z * 0.012 - 0.4) * 3.8;
  const n2 = Math.sin((x + z) * 0.025) * 1.55 + Math.cos((x - z) * 0.021) * 1.25;
  const n3 = Math.sin(x * 0.062) * Math.sin(z * 0.062) * 0.42;
  let raw = n1 + n2 + n3;

  const cx = Math.floor((x + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const cz = Math.floor((z + CHUNK_SIZE * 0.5) / CHUNK_SIZE);

  // Выравниваем рельеф только там, где действительно расположено садоводство СНТ
  if (hasSntAtChunk(cx, cz)) {
    const centerX = cx * CHUNK_SIZE;
    const centerZ = cz * CHUNK_SIZE;
    const lx = x - centerX;
    const lz = z - centerZ;

    // Зона СНТ (lx: -92..+92, lz: -90..+112) плавно переходит в холмы тайги
    const ax = Math.abs(lx);
    const azShift = Math.abs(lz - 11);
    if (ax < 124 && azShift < 130) {
      const baseChunkH =
        Math.sin(centerX * 0.012 + 0.7) * Math.cos(centerZ * 0.012 - 0.4) * 2.5 +
        Math.sin((centerX + centerZ) * 0.02) * 1.1;
      const tx = ax <= 94 ? 0 : Math.min(1, (ax - 94) / 30);
      const tz = azShift <= 100 ? 0 : Math.min(1, (azShift - 100) / 30);
      const blend = Math.max(tx, tz);
      const smoothBlend = blend * blend * (3 - 2 * blend);
      const flatFactor = 0.03 + 0.97 * smoothBlend;
      raw = baseChunkH + (raw - baseChunkH) * flatFactor;
    }
  }

  return raw;
}

export function getSurfaceType(x, z) {
  const cx = Math.floor((x + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const cz = Math.floor((z + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;
  const lx = x - centerX;
  const lz = z - centerZ;

  const highwayLz = 136 + Math.sin(x * 0.011) * 5.0;
  const sideHighwayLx = -142 + Math.sin(z * 0.011) * 5.0;

  if (hasSntAtChunk(cx, cz)) {
    // 1. 4 блока по 4 участка (2x2 в каждом блоке, всего 16 участков по 30x30 м) — ровный газон
    const inPlotX =
      Math.abs(lx - -56) <= 15 ||
      Math.abs(lx - -23) <= 15 ||
      Math.abs(lx - 23) <= 15 ||
      Math.abs(lx - 56) <= 15;
    const inPlotZ =
      Math.abs(lz - -56) <= 15 ||
      Math.abs(lz - -23) <= 15 ||
      Math.abs(lz - 23) <= 15 ||
      Math.abs(lz - 56) <= 15;
    if (inPlotX && inPlotZ) {
      return "lawn";
    }

    // 2. Центральный крест грунтовых улиц СНТ (между 4 блоками участков)
    if (Math.abs(lz) <= 6.8 && Math.abs(lx) <= 82.5) {
      return "dirt_road";
    }
    if (lz >= -82.5 && lz <= highwayLz && Math.abs(lx) <= 6.8) {
      return "dirt_road";
    }

    // 3. Окружные грунтовые проезды по периметру всех 4 блоков (как на схеме СНТ)
    if ((Math.abs(lz + 77.5) <= 5.0 || Math.abs(lz - 77.5) <= 5.0) && Math.abs(lx) <= 82.5) {
      return "dirt_road";
    }
    if ((Math.abs(lx + 77.5) <= 5.0 || Math.abs(lx - 77.5) <= 5.0) && Math.abs(lz) <= 82.5) {
      return "dirt_road";
    }

    // 4. Торговая площадка у Магазина и Базара перед въездом в СНТ
    if (lz >= 87 && lz <= 106 && Math.abs(lx) <= 28) {
      return "plaza";
    }
  }

  // 5. Межпоселковые лесные асфальтовые трассы через тайгу, соединяющие далёкие СНТ
  if (hasEastWestHighway(cz) && Math.abs(lz - highwayLz) < 6.8) {
    return "asphalt";
  }
  if (hasNorthSouthHighway(cx) && Math.abs(lx - sideHighwayLx) < 6.8) {
    return "asphalt";
  }

  return "forest";
}

export function getChunkLayout(cx, cz) {
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;
  const hasSnt = hasSntAtChunk(cx, cz);

  let sntName = "Глухая Тайга";
  let archPos = null;
  let dumpsterPos = null;
  let shopPos = null;
  let bazaarPos = null;
  const plots = [];
  const resources = [];

  if (hasSnt) {
    const sntGx = Math.round(cx / SNT_GRID_STEP);
    const sntGz = Math.round(cz / SNT_GRID_STEP);
    const idx = Math.floor(hash2D(sntGx, sntGz, 11) * SNT_TITLES.length);
    const regionNum = Math.abs(sntGx * 7 + sntGz * 13) + 1;
    sntName =
      cx === 0 && cz === 0
        ? "СНТ «Лесная Поляна»"
        : `СНТ «${SNT_TITLES[idx]}${regionNum > 1 ? "-" + regionNum : ""}»`;

    archPos = { x: centerX, z: centerZ + 86 };
    dumpsterPos = { x: centerX + 9.5, z: centerZ + 89.5 };
    shopPos = { x: centerX - 18.5, z: centerZ + 97 };
    bazaarPos = { x: centerX + 18.5, z: centerZ + 97 };

    // 4 квартала (блока) вокруг центрального перекрёстка, в каждом блоке 2x2 = 4 участка (всего 16 участков по 30x30 м)
    const blocks = [
      { bx: -1, bz: -1, xs: [-56, -23], rows: [{ lz: -56, signLz: -72.2, signRot: Math.PI }, { lz: -23, signLz: -6.8, signRot: 0 }] },
      { bx: 1,  bz: -1, xs: [23, 56],   rows: [{ lz: -56, signLz: -72.2, signRot: Math.PI }, { lz: -23, signLz: -6.8, signRot: 0 }] },
      { bx: -1, bz: 1,  xs: [-56, -23], rows: [{ lz: 23,  signLz: 6.8,   signRot: Math.PI }, { lz: 56,  signLz: 72.2, signRot: 0 }] },
      { bx: 1,  bz: 1,  xs: [23, 56],   rows: [{ lz: 23,  signLz: 6.8,   signRot: Math.PI }, { lz: 56,  signLz: 72.2, signRot: 0 }] }
    ];

    let localNum = 1;
    const baseNum = Math.abs(sntGx * 30 + sntGz * 10) * 10 + 100;
    for (const blk of blocks) {
      for (const row of blk.rows) {
        for (const ox of blk.xs) {
          const px = centerX + ox;
          const pz = centerZ + row.lz;
          const plotNum = baseNum + localNum;
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
            w: 30,
            d: 30,
            signX: px - 8.5,
            signZ: centerZ + row.signLz,
            signRot: row.signRot
          });
          localNum++;
        }
      }
    }

    // A) На каждом дачном участке растут таёжные деревья и ягодные кусты (16 объектов на участок)
    for (const p of plots) {
      for (let i = 0; i < 16; i++) {
        const rx = (hash2D(p.plotNum, i, 101) - 0.5) * (p.w - 4.8);
        const rz = (hash2D(p.plotNum, i, 202) - 0.5) * (p.d - 4.8);
        const wx = p.x + rx;
        const wz = p.z + rz;
        const roll = hash2D(p.plotNum, i, 303);
        let kind = "berry_bush";
        if (i < 6) {
          kind = roll < 0.45 ? "spruce" : roll < 0.80 ? "pine" : "birch";
        } else if (i < 10) {
          kind = roll < 0.45 ? "birch" : "bush";
        } else {
          kind = roll > 0.28 ? "berry_bush" : "bush";
        }
        resources.push({
          id: `res_${cx}_${cz}_p${p.localIndex}_${i}`,
          kind,
          x: wx,
          z: wz,
          scale: 0.95 + hash2D(p.plotNum, i, 404) * 0.45,
          rot: hash2D(p.plotNum, i, 505) * Math.PI * 2,
          onPlotId: p.plotId
        });
      }
    }
  }

  // B) Густая непроходимая на вид тайга (стратифицированная сетка 37x37 = до ~1369 деревьев и кустов на чанк!)
  const gridN = 37;
  const cellStep = (CHUNK_SIZE - 8) / gridN;
  const halfSpan = (CHUNK_SIZE - 8) * 0.5;
  let fIdx = 0;

  for (let gx = 0; gx < gridN; gx++) {
    for (let gz = 0; gz < gridN; gz++) {
      fIdx++;
      const seedA = cx * 131 + gx;
      const seedB = cz * 137 + gz;
      // Небольшие естественные просветы (~8% ячеек пустые для органичности троп)
      if (hash2D(seedA, seedB, 555) < 0.08) continue;

      const jx = (hash2D(seedA, seedB, 601) - 0.5) * (cellStep * 0.82);
      const jz = (hash2D(seedA, seedB, 702) - 0.5) * (cellStep * 0.82);
      const lx = -halfSpan + (gx + 0.5) * cellStep + jx;
      const lz = -halfSpan + (gz + 0.5) * cellStep + jz;
      const wx = centerX + lx;
      const wz = centerZ + lz;

      const surf = getSurfaceType(wx, wz);
      if (surf !== "forest") continue;

      // Не ставим деревья вплотную к краю дорог (буфер ~2.2 м от обочины)
      if (
        getSurfaceType(wx + 2.2, wz) !== "forest" ||
        getSurfaceType(wx - 2.2, wz) !== "forest" ||
        getSurfaceType(wx, wz + 2.2) !== "forest" ||
        getSurfaceType(wx, wz - 2.2) !== "forest"
      ) {
        continue;
      }

      const roll = hash2D(seedA + fIdx, seedB - fIdx, 803);
      let kind = "spruce";
      if (roll < 0.44) kind = "spruce";        // Густая тёмная таёжная ель
      else if (roll < 0.78) kind = "pine";     // Высокая корабельная сосна
      else if (roll < 0.88) kind = "birch";    // Редкая светлая берёзка среди хвои
      else if (roll < 0.94) kind = "berry_bush";
      else if (roll < 0.98) kind = "bush";
      else kind = "rock";

      resources.push({
        id: `res_${cx}_${cz}_f_${gx}_${gz}`,
        kind,
        x: wx,
        z: wz,
        scale: 0.88 + hash2D(seedA, seedB, 904) * 0.72,
        rot: hash2D(seedA + 17, seedB + 29, 995) * Math.PI * 2,
        onPlotId: null
      });
    }
  }

  return {
    cx,
    cz,
    centerX,
    centerZ,
    hasSnt,
    sntName,
    archPos,
    dumpsterPos,
    shopPos,
    bazaarPos,
    plots,
    resources
  };
}

// Детерминированная генерация бесконечного мира в масштабе 1:1 к человеку:
// Крупные участки (32x34 м ~ 10 соток), широкие дороги (10-14 м), густой плотный лес и неровный рельеф

export const CHUNK_SIZE = 300;
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

// Неровный рельеф с плавными возвышенностями и низменностями
export function getTerrainHeight(x, z) {
  const n1 = Math.sin(x * 0.013 + 0.7) * Math.cos(z * 0.013 - 0.4) * 3.4;
  const n2 = Math.sin((x + z) * 0.027) * 1.45 + Math.cos((x - z) * 0.023) * 1.15;
  const n3 = Math.sin(x * 0.065) * Math.sin(z * 0.065) * 0.4;
  let raw = n1 + n2 + n3;

  const cx = Math.floor((x + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const cz = Math.floor((z + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;

  const lx = x - centerX;
  const lz = z - centerZ;

  // В зоне дачных участков рельеф меняется плавно, чтобы дома стояли реалистично
  const ax = Math.abs(lx);
  const az = Math.abs(lz);
  if (ax < 112 && az < 102) {
    const baseChunkH =
      Math.sin(centerX * 0.013 + 0.7) * Math.cos(centerZ * 0.013 - 0.4) * 2.5 +
      Math.sin((centerX + centerZ) * 0.022) * 1.1;
    const tx = ax <= 88 ? 0 : Math.min(1, (ax - 88) / 24);
    const tz = az <= 78 ? 0 : Math.min(1, (az - 78) / 24);
    const blend = Math.max(tx, tz);
    const smoothBlend = blend * blend * (3 - 2 * blend);
    const flatFactor = 0.03 + 0.97 * smoothBlend;
    raw = baseChunkH + (raw - baseChunkH) * flatFactor;
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

  // 1. Крупные дачные участки 1:1 (2 ряда по 4 участка, каждый 32x34 м) — только ровный зелёный газон!
  const inPlotX =
    (Math.abs(lx - -60) <= 16) ||
    (Math.abs(lx - -24) <= 16) ||
    (Math.abs(lx - 24) <= 16) ||
    (Math.abs(lx - 60) <= 16);
  const inPlotZ = (Math.abs(lz - -24) <= 17) || (Math.abs(lz - 24) <= 17);
  if (inPlotX && inPlotZ) {
    return "lawn";
  }

  // 2. Широкая центральная грунтовая улица СНТ между двумя рядами участков (lz около 0)
  if (Math.abs(lz) < 6.8 && Math.abs(lx) < 82) {
    return "dirt_road";
  }

  // 3. Подъездная грунтовая дорога от лесного шоссе через ворота СНТ к центральной улице (lx около 0)
  const highwayLz = 108 + Math.sin(x * 0.014) * 5.0;
  if (lz >= -6.8 && lz <= highwayLz && Math.abs(lx) < 6.5) {
    return "dirt_road";
  }

  // 4. Торговая площадка у Магазина и Базара перед въездом в СНТ (lz от 48 до 66)
  if (lz >= 48 && lz <= 66 && Math.abs(lx) <= 28) {
    return "plaza";
  }

  // 5. Асфальтовое лесное шоссе проходит снаружи СНТ (на lz ≈ 108 и по краю чанка lx ≈ -132), никогда не заходя на участки!
  if (Math.abs(lz - highwayLz) < 6.8) {
    return "asphalt";
  }
  const sideHighwayLx = -132 + Math.sin(z * 0.012) * 5.0;
  if (Math.abs(lx - sideHighwayLx) < 6.8) {
    return "asphalt";
  }

  return "forest";
}

export function getChunkLayout(cx, cz) {
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;
  const idx = Math.floor(hash2D(cx, cz, 11) * SNT_TITLES.length);
  const regionNum = Math.abs(cx * 7 + cz * 13) + 1;
  const sntName =
    cx === 0 && cz === 0
      ? "СНТ «Лесная Поляна»"
      : `СНТ «${SNT_TITLES[idx]}${regionNum > 1 ? "-" + regionNum : ""}»`;

  const archPos = { x: centerX, z: centerZ + 46 };
  const shopPos = { x: centerX - 18.5, z: centerZ + 56 };
  const bazaarPos = { x: centerX + 18.5, z: centerZ + 56 };

  // 8 реалистичных больших участков по 32x34 м (по 4 с каждой стороны широкой улицы)
  const plotOffsetsX = [-60, -24, 24, 60];
  const plotRowsZ = [
    { lz: -24, signLz: -6.8, signRot: 0 },
    { lz: 24, signLz: 6.8, signRot: Math.PI }
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
        w: 32,
        d: 34,
        signX: px - 9.5,
        signZ: centerZ + plotRowsZ[r].signLz,
        signRot: plotRowsZ[r].signRot
      });
      localNum++;
    }
  }

  const resources = [];

  // A) На каждом дачном участке (32x34 м) изначально растут деревья, газон и ягодные кусты (16 объектов на участок)
  for (const p of plots) {
    for (let i = 0; i < 16; i++) {
      const rx = (hash2D(p.plotNum, i, 101) - 0.5) * (p.w - 5.0);
      const rz = (hash2D(p.plotNum, i, 202) - 0.5) * (p.d - 5.0);
      const wx = p.x + rx;
      const wz = p.z + rz;
      const roll = hash2D(p.plotNum, i, 303);
      let kind = "berry_bush";
      if (i < 5) {
        kind = roll > 0.42 ? "birch" : "pine";
      } else if (i < 9) {
        kind = roll > 0.5 ? "birch" : "bush";
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

  // B) Густой плотный лес вокруг садоводств и дорог (310 деревьев, кустов и камней на чанк!)
  for (let i = 0; i < 310; i++) {
    const lx = (hash2D(cx * 300 + i, cz, 601) - 0.5) * (CHUNK_SIZE - 6);
    const lz = (hash2D(cx, cz * 300 + i, 702) - 0.5) * (CHUNK_SIZE - 6);
    const wx = centerX + lx;
    const wz = centerZ + lz;

    const surf = getSurfaceType(wx, wz);
    if (surf !== "forest") continue;

    const roll = hash2D(cx + i, cz - i, 803);
    let kind = "pine";
    if (roll < 0.40) kind = "birch";
    else if (roll < 0.78) kind = "pine";
    else if (roll < 0.89) kind = "berry_bush";
    else if (roll < 0.95) kind = "bush";
    else kind = "rock";

    resources.push({
      id: `res_${cx}_${cz}_f_${i}`,
      kind,
      x: wx,
      z: wz,
      scale: 0.9 + hash2D(cx, cz + i, 904) * 0.65,
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

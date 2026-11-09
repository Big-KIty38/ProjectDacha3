import * as THREE from "three";
import { CHUNK_SIZE, getTerrainHeight, getSurfaceType } from "./world.js?v=8";

// ==========================================
// ПРОЦЕДУРНЫЕ БЕСШОВНЫЕ ТЕКСТУРЫ (Трава, Береста, Кора сосны, Доски, Брус, Кирпич, Листва)
// ==========================================
function makeProceduralTexture(size, drawFn, repeatX = 1, repeatY = 1) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.needsUpdate = true;
  return tex;
}

// 1. Детальная текстура травы / лесной подстилки / дорожного покрытия (умножается на vertexColors рельефа)
const TEX_TERRAIN = makeProceduralTexture(256, (ctx, s) => {
  ctx.fillStyle = "#d8e6d2";
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 3200; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * s;
    const y = (Math.sin(i * 78.233) * 43758.5453 % 1 + 1) % 1 * s;
    ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.18)" : i % 2 === 0 ? "rgba(30,55,25,0.22)" : "rgba(95,130,75,0.2)";
    ctx.fillRect(x, y, 2, 5);
  }
  // Травинки и мелкий клевер
  ctx.strokeStyle = "rgba(35, 65, 28, 0.28)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 650; i++) {
    const x = (i * 73) % s;
    const y = (i * 137) % s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + ((i % 5) - 2) * 2, y - 6);
    ctx.stroke();
  }
}, 42, 42);

// 2. Текстура коры русской берёзы (белая береста с чёрными чечевичками)
const TEX_BIRCH = makeProceduralTexture(256, (ctx, s) => {
  ctx.fillStyle = "#f2efe9";
  ctx.fillRect(0, 0, s, s);
  // Тонкие горизонтальные волокна бересты
  for (let y = 0; y < s; y += 3) {
    ctx.fillStyle = y % 6 === 0 ? "rgba(210,205,195,0.5)" : "rgba(240,238,232,0.5)";
    ctx.fillRect(0, y, s, 1.5);
  }
  // Чёрные пятна и горизонтальные штрихи берёзы
  ctx.fillStyle = "#222522";
  for (let i = 0; i < 58; i++) {
    const x = (i * 53) % s;
    const y = (i * 97) % s;
    const w = 14 + (i % 26);
    const h = 3 + (i % 6);
    ctx.fillRect(x, y, w, h);
  }
  // Тёмное основание комля внизу
  const grad = ctx.createLinearGradient(0, s * 0.78, 0, s);
  grad.addColorStop(0, "rgba(35,38,34,0)");
  grad.addColorStop(1, "rgba(30,33,29,0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, s * 0.78, s, s * 0.22);
}, 1, 2);

// 3. Текстура коры сосны
const TEX_PINE_BARK = makeProceduralTexture(256, (ctx, s) => {
  ctx.fillStyle = "#5d4037";
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 240; i++) {
    const x = (i * 41) % s;
    const y = (i * 83) % s;
    ctx.fillStyle = i % 2 === 0 ? "#4a3028" : "#6d4c41";
    ctx.fillRect(x, y, 6 + (i % 8), 16 + (i % 14));
    ctx.strokeStyle = "#2d1b15";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, 6 + (i % 8), 16 + (i % 14));
  }
}, 1, 2);

// 4. Текстура листвы и хвои
const TEX_FOLIAGE = makeProceduralTexture(128, (ctx, s) => {
  ctx.fillStyle = "#4caf50";
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 420; i++) {
    const x = (i * 29) % s;
    const y = (i * 61) % s;
    ctx.fillStyle = i % 3 === 0 ? "#66bb6a" : i % 2 === 0 ? "#2e7d32" : "#43a047";
    ctx.beginPath();
    ctx.arc(x, y, 4 + (i % 4), 0, Math.PI * 2);
    ctx.fill();
  }
}, 2, 2);

// 5. Текстура струганых деревянных досок и сруба
const TEX_WOOD_PLANK = makeProceduralTexture(256, (ctx, s) => {
  ctx.fillStyle = "#cfa068";
  ctx.fillRect(0, 0, s, s);
  const planks = 6;
  const ph = s / planks;
  for (let p = 0; p < planks; p++) {
    const y = p * ph;
    ctx.fillStyle = p % 2 === 0 ? "rgba(255,240,210,0.12)" : "rgba(80,45,15,0.12)";
    ctx.fillRect(0, y, s, ph);
    ctx.fillStyle = "#5c3b1e";
    ctx.fillRect(0, y, s, 2.5);
    // Волокна древесины
    ctx.strokeStyle = "rgba(110, 68, 30, 0.28)";
    ctx.lineWidth = 1.2;
    for (let g = 4; g < ph - 3; g += 5) {
      ctx.beginPath();
      ctx.moveTo(0, y + g);
      ctx.bezierCurveTo(s * 0.3, y + g + 3, s * 0.7, y + g - 3, s, y + g);
      ctx.stroke();
    }
  }
}, 2, 2);

const TEX_WOOD_LOG = makeProceduralTexture(256, (ctx, s) => {
  ctx.fillStyle = "#9c6b3b";
  ctx.fillRect(0, 0, s, s);
  const logs = 5;
  const lh = s / logs;
  for (let i = 0; i < logs; i++) {
    const y = i * lh;
    const grad = ctx.createLinearGradient(0, y, 0, y + lh);
    grad.addColorStop(0, "#5c3a1d");
    grad.addColorStop(0.25, "#b3804c");
    grad.addColorStop(0.5, "#c4915a");
    grad.addColorStop(0.8, "#8d5d30");
    grad.addColorStop(1, "#4a2c13");
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, s, lh);
  }
}, 2, 2);

// 6. Текстура кирпичной кладки
const TEX_BRICK = makeProceduralTexture(256, (ctx, s) => {
  ctx.fillStyle = "#d7ccc8"; // раствор
  ctx.fillRect(0, 0, s, s);
  const rows = 8;
  const cols = 4;
  const rh = s / rows;
  const cw = s / cols;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (cw / 2);
    for (let c = -1; c <= cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? "#b7412c" : "#a33622";
      ctx.fillRect(c * cw + offset + 2, r * rh + 2, cw - 4, rh - 4);
    }
  }
}, 3, 3);

// Общие геометрии (увеличенные до реалистичных размеров 1:1 к человеку 1.75м!)
const GEO = {
  birchTrunk: new THREE.CylinderGeometry(0.22, 0.36, 7.2, 8),
  birchCrown1: new THREE.DodecahedronGeometry(2.4, 1),
  birchCrown2: new THREE.DodecahedronGeometry(1.85, 1),
  pineTrunk: new THREE.CylinderGeometry(0.28, 0.44, 6.4, 8),
  pineCones: [
    new THREE.ConeGeometry(2.7, 3.8, 8),
    new THREE.ConeGeometry(2.15, 3.3, 8),
    new THREE.ConeGeometry(1.55, 2.8, 8)
  ],
  bush1: new THREE.DodecahedronGeometry(1.15, 1),
  bush2: new THREE.DodecahedronGeometry(0.85, 1),
  berry: new THREE.SphereGeometry(0.11, 5, 5),
  rock: new THREE.DodecahedronGeometry(1.35, 0),
  plotPost: new THREE.BoxGeometry(0.26, 1.35, 0.26),
  signLeg: new THREE.CylinderGeometry(0.09, 0.1, 1.75, 6),
  signBoard: new THREE.BoxGeometry(2.4, 1.1, 0.12)
};

const MAT = {
  birchBark: new THREE.MeshStandardMaterial({ map: TEX_BIRCH, roughness: 0.85 }),
  birchLeaf: new THREE.MeshStandardMaterial({ map: TEX_FOLIAGE, color: 0x66bb6a, roughness: 0.82 }),
  pineTrunk: new THREE.MeshStandardMaterial({ map: TEX_PINE_BARK, roughness: 0.9 }),
  pineLeaf: new THREE.MeshStandardMaterial({ map: TEX_FOLIAGE, color: 0x2e6b34, roughness: 0.85 }),
  bushLeaf: new THREE.MeshStandardMaterial({ map: TEX_FOLIAGE, color: 0x43a047, roughness: 0.82 }),
  berryRed: new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.35, emissive: 0x3a0505 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.92, flatShading: true }),
  woodLight: new THREE.MeshStandardMaterial({ map: TEX_WOOD_PLANK, roughness: 0.78 }),
  woodMedium: new THREE.MeshStandardMaterial({ map: TEX_WOOD_LOG, roughness: 0.82 }),
  woodDark: new THREE.MeshStandardMaterial({ map: TEX_PINE_BARK, color: 0x6d4c41, roughness: 0.88 }),
  brickRed: new THREE.MeshStandardMaterial({ map: TEX_BRICK, roughness: 0.8 }),
  plasterWhite: new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.75 }),
  roofGreen: new THREE.MeshStandardMaterial({ map: TEX_WOOD_PLANK, color: 0x387a3f, roughness: 0.65 }),
  roofRed: new THREE.MeshStandardMaterial({ map: TEX_WOOD_PLANK, color: 0xa1382f, roughness: 0.65 }),
  roofBlue: new THREE.MeshStandardMaterial({ map: TEX_WOOD_PLANK, color: 0x346b96, roughness: 0.6 }),
  roofSlate: new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.6 }),
  soilDark: new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.95 }),
  soilWet: new THREE.MeshStandardMaterial({ color: 0x241411, roughness: 0.7 }),
  windowGlow: new THREE.MeshStandardMaterial({
    color: 0xfff3b0,
    emissive: 0xffca28,
    emissiveIntensity: 0.55,
    roughness: 0.25
  }),
  polyGlass: new THREE.MeshStandardMaterial({
    color: 0xdff6ff,
    transparent: true,
    opacity: 0.52,
    roughness: 0.2
  }),
  foundation: new THREE.MeshStandardMaterial({ color: 0x60686c, roughness: 0.92 }),
  terrain: new THREE.MeshStandardMaterial({
    map: TEX_TERRAIN,
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.02
  })
};

export function makeTextCanvas(lines, opts = {}) {
  const width = opts.width || 320;
  const height = opts.height || 100;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = opts.bg || "rgba(20, 38, 24, 0.92)";
  ctx.fillRect(2, 2, width - 4, height - 4);

  ctx.lineWidth = opts.borderWidth || 4;
  ctx.strokeStyle = opts.border || "#81c784";
  ctx.strokeRect(2, 2, width - 4, height - 4);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const step = height / (lines.length + 1);
  lines.forEach((line, idx) => {
    ctx.font = line.font || "bold 20px Segoe UI, sans-serif";
    ctx.fillStyle = line.color || "#fffde7";
    ctx.fillText(line.text, width / 2, step * (idx + 1));
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function makeFloatingBadge(lines, scaleX = 3.2, scaleY = 1.0, opts = {}) {
  const tex = makeTextCanvas(lines, opts);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleX, scaleY, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function createTerrainChunkMesh(cx, cz) {
  const segs = 90;
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;

  const cForestLow = new THREE.Color(0x336330);
  const cForestHigh = new THREE.Color(0x4b8340);
  const cLawn = new THREE.Color(0x68b84d);
  const cDirt = new THREE.Color(0x9c7b56);
  const cAsphalt = new THREE.Color(0x454b52);
  const cPlaza = new THREE.Color(0x8c785f);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + centerX;
    const wz = pos.getZ(i) + centerZ;
    const wy = getTerrainHeight(wx, wz);
    pos.setY(i, wy);

    const surf = getSurfaceType(wx, wz);
    if (surf === "asphalt") tmpColor.copy(cAsphalt);
    else if (surf === "dirt_road") tmpColor.copy(cDirt);
    else if (surf === "lawn") tmpColor.copy(cLawn);
    else if (surf === "plaza") tmpColor.copy(cPlaza);
    else {
      const t = Math.max(0, Math.min(1, (wy + 3.5) / 8.5));
      tmpColor.copy(cForestLow).lerp(cForestHigh, t);
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, MAT.terrain);
  mesh.position.set(centerX, 0, centerZ);
  mesh.receiveShadow = true;
  return mesh;
}

export function createResourceMesh(res) {
  const g = new THREE.Group();
  const y = getTerrainHeight(res.x, res.z);
  g.position.set(res.x, y, res.z);
  g.rotation.y = res.rot || 0;
  const s = res.scale || 1;
  g.scale.set(s, s, s);

  if (res.kind === "birch") {
    const trunk = new THREE.Mesh(GEO.birchTrunk, MAT.birchBark);
    trunk.position.y = 3.5;
    g.add(trunk);

    const c1 = new THREE.Mesh(GEO.birchCrown1, MAT.birchLeaf);
    c1.position.set(0, 6.6, 0);
    g.add(c1);

    const c2 = new THREE.Mesh(GEO.birchCrown2, MAT.birchLeaf);
    c2.position.set(0.85, 8.0, 0.45);
    g.add(c2);
  } else if (res.kind === "pine") {
    const trunk = new THREE.Mesh(GEO.pineTrunk, MAT.pineTrunk);
    trunk.position.y = 3.1;
    g.add(trunk);

    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(GEO.pineCones[i], MAT.pineLeaf);
      cone.position.y = 4.8 + i * 2.1;
      g.add(cone);
    }
  } else if (res.kind === "berry_bush" || res.kind === "bush") {
    const b1 = new THREE.Mesh(GEO.bush1, MAT.bushLeaf);
    b1.position.set(0, 0.75, 0);
    g.add(b1);

    const b2 = new THREE.Mesh(GEO.bush2, MAT.bushLeaf);
    b2.position.set(0.55, 0.62, 0.35);
    g.add(b2);

    if (res.kind === "berry_bush") {
      const berriesGroup = new THREE.Group();
      const offsets = [
        [0.6, 0.95, 0.48],
        [-0.55, 0.9, 0.55],
        [0.25, 1.25, -0.55],
        [-0.42, 1.05, -0.48],
        [0.75, 0.75, -0.25],
        [0.0, 1.4, 0.42]
      ];
      for (const [bx, by, bz] of offsets) {
        const bm = new THREE.Mesh(GEO.berry, MAT.berryRed);
        bm.position.set(bx, by, bz);
        berriesGroup.add(bm);
      }
      g.add(berriesGroup);
      g.userData.berriesGroup = berriesGroup;
    }
  } else if (res.kind === "rock") {
    const r1 = new THREE.Mesh(GEO.rock, MAT.rock);
    r1.position.set(0, 0.6, 0);
    r1.scale.set(1.25, 0.82, 1.05);
    g.add(r1);
  }

  g.userData.resource = res;
  return g;
}

export function createSntEntranceMeshes(layout) {
  const group = new THREE.Group();

  // 1. Большая въездная арка СНТ над широкой дорогой
  const archY = getTerrainHeight(layout.archPos.x, layout.archPos.z);
  const arch = new THREE.Group();
  arch.position.set(layout.archPos.x, archY, layout.archPos.z);

  const postGeo = new THREE.CylinderGeometry(0.28, 0.32, 5.8, 8);
  const leftPost = new THREE.Mesh(postGeo, MAT.woodDark);
  leftPost.position.set(-5.6, 2.7, 0);
  const rightPost = new THREE.Mesh(postGeo, MAT.woodDark);
  rightPost.position.set(5.6, 2.7, 0);
  const topBeam = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.55, 0.55), MAT.woodMedium);
  topBeam.position.set(0, 5.5, 0);
  arch.add(leftPost, rightPost, topBeam);

  const signTex = makeTextCanvas(
    [
      { text: layout.sntName, font: "bold 22px Segoe UI", color: "#fffde7" },
      { text: "ДОБРО ПОЖАЛОВАТЬ ДАЧНИКАМ!", font: "bold 13px Segoe UI", color: "#dce775" }
    ],
    { width: 360, height: 84, bg: "#1b4d20", border: "#ffd54f" }
  );
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(9.6, 1.55, 0.24),
    new THREE.MeshBasicMaterial({ map: signTex })
  );
  signBoard.position.set(0, 5.5, 0);
  arch.add(signBoard);
  group.add(arch);

  // 2. Магазинчик «Сельпо»
  const shopY = getTerrainHeight(layout.shopPos.x, layout.shopPos.z);
  const shop = new THREE.Group();
  shop.position.set(layout.shopPos.x, shopY, layout.shopPos.z);

  const shopBase = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.2, 5.6), MAT.foundation);
  shopBase.position.y = 0.2;
  const shopBody = new THREE.Mesh(new THREE.BoxGeometry(6.8, 3.2, 5.2), MAT.woodLight);
  shopBody.position.y = 2.2;
  const shopRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.0, 4), MAT.roofGreen);
  shopRoof.rotation.y = Math.PI / 4;
  shopRoof.position.y = 4.7;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 0.95), MAT.woodDark);
  counter.position.set(0, 1.2, 2.65);

  const seller = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color: 0x1e88e5 }));
  seller.position.set(0, 1.7, 1.9);
  const sellerHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffccaa }));
  sellerHead.position.set(0, 2.45, 1.9);

  const shopBadge = makeFloatingBadge(
    [
      { text: "🏪 МАГАЗИН «СЕЛЬПО»", font: "bold 20px Segoe UI", color: "#fffde7" },
      { text: "[E] Семена • Еда • Материалы", font: "bold 14px Segoe UI", color: "#ffd54f" }
    ],
    4.6,
    1.25,
    { bg: "rgba(21, 67, 36, 0.94)", border: "#ffd54f" }
  );
  shopBadge.position.set(0, 6.1, 0);

  shop.add(shopBase, shopBody, shopRoof, counter, seller, sellerHead, shopBadge);
  group.add(shop);

  // 3. Дачный Базар «Скупка» рядом с магазином
  const bazY = getTerrainHeight(layout.bazaarPos.x, layout.bazaarPos.z);
  const bazaar = new THREE.Group();
  bazaar.position.set(layout.bazaarPos.x, bazY, layout.bazaarPos.z);

  const bazBase = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.1, 5.6), MAT.foundation);
  bazBase.position.y = 0.15;
  const table = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.0, 2.4), MAT.woodMedium);
  table.position.set(0, 1.1, 0.6);

  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.6, 6);
  for (const px of [-2.9, 2.9]) {
    for (const pz of [-2.0, 2.0]) {
      const pole = new THREE.Mesh(poleGeo, MAT.woodDark);
      pole.position.set(px, 2.3, pz);
      bazaar.add(pole);
    }
  }
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(5.0, 1.8, 4), MAT.roofRed);
  canopy.rotation.y = Math.PI / 4;
  canopy.position.y = 4.6;

  const buyer = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color: 0xd84315 }));
  buyer.position.set(0, 1.7, -0.6);
  const buyerHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffccaa }));
  buyerHead.position.set(0, 2.45, -0.6);

  const bazBadge = makeFloatingBadge(
    [
      { text: "⚖️ ДАЧНЫЙ БАЗАР (СКУПКА)", font: "bold 20px Segoe UI", color: "#fffde7" },
      { text: "[E] Продать урожай, ягоды и дерево", font: "bold 14px Segoe UI", color: "#81c784" }
    ],
    4.8,
    1.25,
    { bg: "rgba(68, 24, 18, 0.94)", border: "#ff8a65" }
  );
  bazBadge.position.set(0, 6.0, 0);

  bazaar.add(bazBase, table, canopy, buyer, buyerHead, bazBadge);
  group.add(bazaar);

  return group;
}

export function createPlotBoundaryMesh(plot, ownership, price) {
  const g = new THREE.Group();
  const hw = plot.w / 2;
  const hd = plot.d / 2;

  // Столбики по периметру участка 32x34 м
  const pts = [
    [plot.x - hw, plot.z - hd],
    [plot.x, plot.z - hd],
    [plot.x + hw, plot.z - hd],
    [plot.x + hw, plot.z],
    [plot.x + hw, plot.z + hd],
    [plot.x, plot.z + hd],
    [plot.x - hw, plot.z + hd],
    [plot.x - hw, plot.z]
  ];

  for (const [cx, cz] of pts) {
    const cy = getTerrainHeight(cx, cz);
    const post = new THREE.Mesh(GEO.plotPost, MAT.woodMedium);
    post.position.set(cx, cy + 0.55, cz);
    g.add(post);
  }

  const sy = getTerrainHeight(plot.signX, plot.signZ);
  const signGroup = new THREE.Group();
  signGroup.position.set(plot.signX, sy, plot.signZ);
  signGroup.rotation.y = plot.signRot || 0;

  const leg = new THREE.Mesh(GEO.signLeg, MAT.woodDark);
  leg.position.y = 0.85;
  signGroup.add(leg);

  const boardMesh = new THREE.Mesh(GEO.signBoard, new THREE.MeshBasicMaterial());
  boardMesh.position.y = 1.65;
  signGroup.add(boardMesh);

  g.add(signGroup);
  g.userData.boardMesh = boardMesh;
  g.userData.plot = plot;

  updatePlotSignTexture(g, ownership, price);
  return g;
}

export function updatePlotSignTexture(plotMeshGroup, ownership, price) {
  const plot = plotMeshGroup.userData.plot;
  const boardMesh = plotMeshGroup.userData.boardMesh;
  if (!boardMesh || !plot) return;

  if (boardMesh.material.map) boardMesh.material.map.dispose();

  if (ownership) {
    boardMesh.material.map = makeTextCanvas(
      [
        { text: `УЧАСТОК №${plot.plotNum}`, font: "bold 20px Segoe UI", color: "#fffde7" },
        { text: `Владелец: ${ownership.ownerName}`, font: "bold 17px Segoe UI", color: "#a5d6a7" }
      ],
      { width: 256, height: 96, bg: "#1b3e22", border: ownership.color || "#66bb6a" }
    );
  } else {
    boardMesh.material.map = makeTextCanvas(
      [
        { text: `УЧАСТОК №${plot.plotNum}`, font: "bold 20px Segoe UI", color: "#fffde7" },
        { text: `СВОБОДЕН • ${price} ₽ [E]`, font: "bold 17px Segoe UI", color: "#ffd54f" }
      ],
      { width: 256, height: 96, bg: "#3e2723", border: "#ffd54f" }
    );
  }
  boardMesh.material.needsUpdate = true;
}

export function createStructureMesh(struct) {
  const g = new THREE.Group();
  const y = getTerrainHeight(struct.x, struct.z);
  g.position.set(struct.x, y, struct.z);
  g.rotation.y = struct.rot || 0;
  g.userData.structure = struct;

  const t = struct.type;

  if (t === "bed") {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.42, 1.9), MAT.woodLight);
    frame.position.y = 0.15;
    const soil = new THREE.Mesh(new THREE.BoxGeometry(3.16, 0.34, 1.66), struct.watered ? MAT.soilWet : MAT.soilDark);
    soil.position.y = 0.22;
    g.add(frame, soil);
    g.userData.soilMesh = soil;

    const cropGroup = new THREE.Group();
    cropGroup.position.y = 0.4;
    g.add(cropGroup);
    g.userData.cropGroup = cropGroup;
  } else if (t === "greenhouse") {
    const base = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.5, 3.2), MAT.woodDark);
    base.position.y = 0.15;
    const soil = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.38, 2.9), struct.watered ? MAT.soilWet : MAT.soilDark);
    soil.position.y = 0.24;

    const domeGeo = new THREE.CylinderGeometry(1.6, 1.6, 4.7, 10, 1, false, 0, Math.PI);
    domeGeo.rotateZ(Math.PI / 2);
    domeGeo.rotateY(Math.PI / 2);
    const dome = new THREE.Mesh(domeGeo, MAT.polyGlass);
    dome.position.y = 0.4;
    g.add(base, soil, dome);
    g.userData.soilMesh = soil;

    const cropGroup = new THREE.Group();
    cropGroup.position.y = 0.42;
    g.add(cropGroup);
    g.userData.cropGroup = cropGroup;
  } else if (t === "fence") {
    const rail1 = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.12, 0.1), MAT.woodMedium);
    rail1.position.y = 0.45;
    const rail2 = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.12, 0.1), MAT.woodMedium);
    rail2.position.y = 0.95;
    g.add(rail1, rail2);
    const picketGeo = new THREE.BoxGeometry(0.18, 1.35, 0.08);
    for (let x = -1.8; x <= 1.81; x += 0.4) {
      const picket = new THREE.Mesh(picketGeo, MAT.woodLight);
      picket.position.set(x, 0.65, 0);
      g.add(picket);
    }
  } else if (t === "well") {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 1.8), MAT.woodMedium);
    base.position.y = 0.5;
    const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.3, 6), MAT.woodDark);
    p1.position.set(-0.75, 1.5, 0);
    const p2 = p1.clone();
    p2.position.set(0.75, 1.5, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.0, 4), MAT.roofBlue);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.85;
    g.add(base, p1, p2, roof);
  } else if (t === "workbench") {
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.95, 1.4), MAT.woodLight);
    table.position.y = 0.48;
    const blade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12),
      new THREE.MeshStandardMaterial({ color: 0xcfd8dc, metalness: 0.7, roughness: 0.3 })
    );
    blade.rotation.x = Math.PI / 2;
    blade.position.set(0, 1.05, 0);
    g.add(table, blade);
  } else if (t === "gazebo") {
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.8, 0.45, 6), MAT.foundation);
    floor.position.y = 0.15;
    const postGeo = new THREE.CylinderGeometry(0.11, 0.11, 2.6, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const post = new THREE.Mesh(postGeo, MAT.woodMedium);
      post.position.set(Math.cos(a) * 2.2, 1.5, Math.sin(a) * 2.2);
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.0, 1.45, 6), MAT.roofGreen);
    roof.position.y = 3.2;
    const brazier = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 0.5), MAT.rock);
    brazier.position.set(2.9, 0.45, 0);
    g.add(floor, roof, brazier);
  } else if (t === "shed") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.9, 3.2), MAT.foundation);
    plinth.position.y = 0.15;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 3.0), MAT.woodLight);
    walls.position.y = 1.8;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.28, 3.5), MAT.roofSlate);
    roof.position.y = 3.2;
    roof.rotation.x = 0.08;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.95, 0.12), MAT.woodDark);
    door.position.set(-0.95, 1.5, 1.52);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.12), MAT.windowGlow);
    win.position.set(0.9, 1.9, 1.52);
    g.add(plinth, walls, roof, door, win);
  } else if (t === "house_wood") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.2, 6.2), MAT.foundation);
    plinth.position.y = 0.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(6.8, 3.4, 4.8), MAT.woodMedium);
    body.position.set(0, 2.3, -0.5);
    const porch = new THREE.Mesh(new THREE.BoxGeometry(6.6, 2.5, 1.6), MAT.woodLight);
    porch.position.set(0, 1.85, 2.3);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.8, 2.6, 4), MAT.roofGreen);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 5.2, 0);
    const win1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.05, 0.12), MAT.windowGlow);
    win1.position.set(-1.7, 2.2, 3.12);
    const win2 = win1.clone();
    win2.position.set(1.7, 2.2, 3.12);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.05, 0.14), MAT.woodDark);
    door.position.set(0, 1.65, 3.12);
    g.add(plinth, body, porch, roof, win1, win2, door);
  } else if (t === "banya") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.1, 4.6), MAT.foundation);
    plinth.position.y = 0.2;
    const logs = new THREE.Mesh(new THREE.BoxGeometry(5.0, 2.8, 4.2), MAT.woodMedium);
    logs.position.y = 1.95;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 1.9, 4), MAT.roofRed);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 4.25;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, 0.6), MAT.brickRed);
    chimney.position.set(1.3, 4.5, -0.6);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.12), MAT.windowGlow);
    win.position.set(1.2, 2.1, 2.12);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.12), MAT.woodDark);
    door.position.set(-1.0, 1.55, 2.12);
    g.add(plinth, logs, roof, chimney, win, door);
  } else if (t === "house_terem") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(7.8, 1.3, 6.8), MAT.foundation);
    plinth.position.y = 0.2;
    const floor1 = new THREE.Mesh(new THREE.BoxGeometry(7.4, 3.3, 6.4), MAT.woodMedium);
    floor1.position.y = 2.3;
    const floor2 = new THREE.Mesh(new THREE.BoxGeometry(6.0, 2.9, 5.2), MAT.woodLight);
    floor2.position.y = 5.3;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.5, 2.8, 4), MAT.roofBlue);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 8.0;
    const winUp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.15, 0.14), MAT.windowGlow);
    winUp.position.set(0, 5.4, 2.62);
    const winL = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.15, 0.14), MAT.windowGlow);
    winL.position.set(-1.9, 2.4, 3.22);
    const winR = winL.clone();
    winR.position.set(1.9, 2.4, 3.22);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.1, 0.15), MAT.woodDark);
    door.position.set(0, 1.75, 3.22);
    g.add(plinth, floor1, floor2, roof, winUp, winL, winR, door);
  } else if (t === "house_brick") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(8.8, 1.4, 7.4), MAT.foundation);
    plinth.position.y = 0.25;
    const main = new THREE.Mesh(new THREE.BoxGeometry(8.4, 6.2, 6.8), MAT.brickRed);
    main.position.y = 3.8;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(8.55, 0.35, 6.95), MAT.plasterWhite);
    trim.position.y = 3.8;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.8, 3.0, 4), MAT.roofRed);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 8.3;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.85, 3.0, 0.85), MAT.brickRed);
    chimney.position.set(2.3, 8.3, -1.3);

    const winGeo = new THREE.BoxGeometry(1.3, 1.3, 0.15);
    for (const wy of [2.3, 5.3]) {
      for (const wx of [-2.2, 0, 2.2]) {
        if (wy === 2.3 && wx === 0) continue;
        const w = new THREE.Mesh(winGeo, MAT.windowGlow);
        w.position.set(wx, wy, 3.42);
        g.add(w);
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.18), MAT.woodDark);
    door.position.set(0, 1.9, 3.42);
    g.add(plinth, main, trim, roof, chimney, door);
  }

  return g;
}

export function updateCropVisuals(structMesh, struct, progress, cropInfo) {
  const cropGroup = structMesh.userData.cropGroup;
  const soilMesh = structMesh.userData.soilMesh;
  if (!cropGroup) return;

  if (soilMesh) soilMesh.material = struct.watered ? MAT.soilWet : MAT.soilDark;

  const pct = struct.crop ? Math.min(100, Math.floor(progress * 100)) : -1;
  const key = `${struct.crop || "none"}_${Math.floor(pct / 10)}_${struct.watered ? 1 : 0}`;
  if (structMesh.userData.lastCropKey === key) return;
  structMesh.userData.lastCropKey = key;

  while (cropGroup.children.length > 0) cropGroup.remove(cropGroup.children[0]);
  if (!struct.crop || !cropInfo) return;

  const stage = progress >= 1 ? 3 : progress >= 0.45 ? 2 : 1;
  const plantScale = 0.35 + progress * 0.75;

  for (let i = -1; i <= 1; i++) {
    for (let j = -0.4; j <= 0.41; j += 0.8) {
      const bush = new THREE.Mesh(GEO.bush2, MAT.birchLeaf);
      bush.scale.setScalar(0.38 * plantScale);
      bush.position.set(i * 0.85, 0.18 * plantScale, j);
      cropGroup.add(bush);

      if (stage === 3) {
        const fruit = new THREE.Mesh(GEO.berry, MAT.berryRed);
        fruit.position.set(i * 0.85 + 0.1, 0.34 * plantScale, j + 0.08);
        cropGroup.add(fruit);
      }
    }
  }

  const statusText =
    pct >= 100
      ? `✅ ${cropInfo.name}: СОЗРЕЛО! [E]`
      : `🌱 ${cropInfo.name}: ${pct}% ${struct.watered ? "💧" : "[E] Полить"}`;

  const badge = makeFloatingBadge(
    [{ text: statusText, font: "bold 18px Segoe UI", color: pct >= 100 ? "#ffd54f" : "#e8f5e9" }],
    3.1,
    0.72,
    { bg: pct >= 100 ? "rgba(27, 77, 32, 0.95)" : "rgba(20, 35, 24, 0.88)" }
  );
  badge.position.set(0, struct.type === "greenhouse" ? 2.35 : 1.4, 0);
  cropGroup.add(badge);
}

// Создание 3D-модели предмета в руке (для 1-го и 3-го лица)
export function buildHeldItemMesh(heldId = "axe", hasSteelAxe = false, forFirstPerson = true) {
  const group = new THREE.Group();
  const dt = !forFirstPerson;
  const ro = forFirstPerson ? 27 : 2;

  const woodMat = new THREE.MeshStandardMaterial({ map: TEX_WOOD_PLANK, roughness: 0.78, depthTest: dt });
  const steelMat = new THREE.MeshStandardMaterial({
    color: hasSteelAxe && heldId === "axe" ? 0xe1f5fe : 0xcfd8dc,
    metalness: 0.65,
    roughness: 0.28,
    depthTest: dt
  });
  const darkIronMat = new THREE.MeshStandardMaterial({ color: 0x546e7a, metalness: 0.7, roughness: 0.32, depthTest: dt });

  if (!heldId || heldId === "hand") {
    return group;
  }

  if (heldId === "axe") {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.46, 8), woodMat);
    handle.position.set(0, 0.14, -0.02);
    handle.rotation.x = 0.35;
    handle.renderOrder = ro;

    const axeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.13, 0.17), steelMat);
    axeBlade.position.set(0, 0.18, -0.045);
    axeBlade.renderOrder = ro + 1;
    handle.add(axeBlade);

    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.14, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.8, roughness: 0.15, depthTest: dt })
    );
    edge.position.set(0, 0.18, -0.13);
    edge.renderOrder = ro + 1;
    handle.add(edge);

    group.add(handle);
  } else if (heldId === "hammer") {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.025, 0.42, 8), woodMat);
    handle.position.set(0, 0.13, -0.02);
    handle.rotation.x = 0.32;
    handle.renderOrder = ro;

    const headBlock = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.058, 0.19), darkIronMat);
    headBlock.position.set(0, 0.19, 0.0);
    headBlock.renderOrder = ro + 1;
    handle.add(headBlock);

    const striker = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.04, 8), steelMat);
    striker.rotation.x = Math.PI / 2;
    striker.position.set(0, 0.19, -0.105);
    striker.renderOrder = ro + 1;
    handle.add(striker);

    group.add(handle);
  } else if (heldId === "nails") {
    // Связка строительных гвоздей со шляпками в ладони
    const nailOffsets = [
      [-0.03, 0.03, -0.02, -0.15, 0.1],
      [-0.01, 0.04, -0.03, -0.05, -0.05],
      [0.01, 0.04, -0.01, 0.08, 0.04],
      [0.03, 0.03, -0.02, 0.18, -0.08],
      [0.0, 0.02, 0.01, 0.02, 0.18]
    ];
    for (const [nx, ny, nz, rx, rz] of nailOffsets) {
      const nail = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.002, 0.18, 6), steelMat);
      shaft.position.y = 0.06;
      shaft.renderOrder = ro;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.009, 8), darkIronMat);
      cap.position.y = 0.15;
      cap.renderOrder = ro + 1;
      nail.add(shaft, cap);
      nail.position.set(nx, ny, nz);
      nail.rotation.set(rx + 0.3, 0, rz);
      group.add(nail);
    }
  } else if (heldId === "watering_can") {
    const canMat = new THREE.MeshStandardMaterial({ color: 0x26a69a, metalness: 0.35, roughness: 0.45, depthTest: dt });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.17, 10), canMat);
    body.position.set(0, 0.05, -0.04);
    body.renderOrder = ro;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, 0.18, 8), canMat);
    spout.position.set(0, 0.09, -0.15);
    spout.rotation.x = -0.8;
    spout.renderOrder = ro;
    group.add(body, spout);
  } else if (heldId === "pie") {
    const pieMat = new THREE.MeshStandardMaterial({ color: 0xd99038, roughness: 0.6, depthTest: dt });
    const pie = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8), pieMat);
    pie.scale.set(1.05, 0.65, 1.42);
    pie.position.set(0, 0.06, -0.02);
    pie.renderOrder = ro;
    group.add(pie);
  } else if (heldId === "berry" || heldId === "strawberry") {
    const bMat = new THREE.MeshStandardMaterial({
      color: heldId === "strawberry" ? 0xd81b60 : 0xe53935,
      roughness: 0.35,
      depthTest: dt
    });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x43a047, roughness: 0.7, depthTest: dt });
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.11), leafMat);
    leaf.position.set(0, 0.04, -0.02);
    leaf.renderOrder = ro;
    group.add(leaf);
    const pts = [[-0.028, 0.075, -0.02], [0.028, 0.075, -0.01], [0, 0.085, -0.045], [0.01, 0.07, 0.015]];
    for (const [bx, by, bz] of pts) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), bMat);
      b.position.set(bx, by, bz);
      b.renderOrder = ro + 1;
      group.add(b);
    }
  } else if (heldId === "tomato") {
    const tMat = new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.3, depthTest: dt });
    const tom = new THREE.Mesh(new THREE.SphereGeometry(0.078, 10, 10), tMat);
    tom.position.set(0, 0.07, -0.02);
    tom.renderOrder = ro;
    group.add(tom);
  } else if (heldId === "cucumber") {
    const cMat = new THREE.MeshStandardMaterial({ color: 0x43a047, roughness: 0.5, depthTest: dt });
    const cuc = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.12, 6, 8), cMat);
    cuc.rotation.x = Math.PI / 3;
    cuc.position.set(0, 0.07, -0.03);
    cuc.renderOrder = ro;
    group.add(cuc);
  } else if (heldId === "potato") {
    const pMat = new THREE.MeshStandardMaterial({ color: 0xbcaaa4, roughness: 0.85, depthTest: dt });
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.072, 8, 8), pMat);
    pot.scale.set(1.0, 0.82, 1.28);
    pot.position.set(0, 0.065, -0.02);
    pot.renderOrder = ro;
    group.add(pot);
  } else if (heldId === "jam" || heldId === "pickles") {
    const jarMat = new THREE.MeshStandardMaterial({
      color: heldId === "jam" ? 0xad1457 : 0x558b2f,
       roughness: 0.25,
      depthTest: dt
    });
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.16, 10), jarMat);
    jar.position.set(0, 0.08, -0.02);
    jar.renderOrder = ro;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.022, 10), steelMat);
    lid.position.set(0, 0.165, -0.02);
    lid.renderOrder = ro + 1;
    group.add(jar, lid);
  } else {
    const itemBox = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), woodMat);
    itemBox.position.set(0, 0.07, -0.02);
    itemBox.renderOrder = ro;
    group.add(itemBox);
  }

  return group;
}

// Рука и инструмент для вида от первого лица
export function createFirstPersonViewmodel(jacketColor = "#2e7d32") {
  const g = new THREE.Group();
  const sleeveMat = new THREE.MeshStandardMaterial({ color: jacketColor, roughness: 0.7, depthTest: false });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffccaa, roughness: 0.65, depthTest: false });

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.48), sleeveMat);
  arm.position.set(0.34, -0.28, -0.45);
  arm.rotation.x = 0.2;
  arm.rotation.y = -0.15;
  arm.renderOrder = 25;

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), skinMat);
  hand.position.set(0, 0, -0.25);
  hand.renderOrder = 26;
  arm.add(hand);

  const toolHolder = new THREE.Group();
  toolHolder.position.set(0, 0, -0.25);
  arm.add(toolHolder);

  g.add(arm);
  g.userData.arm = arm;
  g.userData.toolHolder = toolHolder;
  g.userData.currentKey = "";
  updateFirstPersonHeldItem(g, "axe", false);
  return g;
}

export function updateFirstPersonHeldItem(fpGroup, heldId, hasSteelAxe = false) {
  if (!fpGroup || !fpGroup.userData.toolHolder) return;
  const key = `${heldId}_${hasSteelAxe ? 1 : 0}`;
  if (fpGroup.userData.currentKey === key) return;
  fpGroup.userData.currentKey = key;

  const holder = fpGroup.userData.toolHolder;
  while (holder.children.length > 0) holder.remove(holder.children[0]);
  holder.add(buildHeldItemMesh(heldId, hasSteelAxe, true));
}

export function createPlayerMesh(name, jacketColor = "#2e7d32") {
  const g = new THREE.Group();

  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.85 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: jacketColor, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffccaa, roughness: 0.65 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0xdce775, roughness: 0.8 });

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.75, 0.28), pantsMat);
  leftLeg.position.set(-0.18, 0.38, 0);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.75, 0.28), pantsMat);
  rightLeg.position.set(0.18, 0.38, 0);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.85, 0.4), jacketMat);
  torso.position.set(0, 1.15, 0);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.22), jacketMat);
  leftArm.position.set(-0.48, 1.15, 0);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.22), jacketMat);
  rightArm.position.set(0.48, 1.15, 0);

  const heldHolder = new THREE.Group();
  heldHolder.position.set(0, -0.32, 0.18);
  heldHolder.rotation.x = Math.PI / 3;
  heldHolder.scale.setScalar(1.25);
  rightArm.add(heldHolder);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 10), skinMat);
  head.position.set(0, 1.88, 0);

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.52, 0.08, 10), hatMat);
  brim.position.set(0, 2.08, 0);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.33, 0.22, 10), hatMat);
  crown.position.set(0, 2.2, 0);

  const nameBadge = makeFloatingBadge(
    [{ text: name || "Дачник", font: "bold 22px Segoe UI", color: "#fffde7" }],
    2.6,
    0.65,
    { bg: "rgba(15, 30, 18, 0.88)", border: jacketColor }
  );
  nameBadge.position.set(0, 2.75, 0);

  g.add(leftLeg, rightLeg, torso, leftArm, rightArm, head, brim, crown, nameBadge);
  g.userData = { leftLeg, rightLeg, leftArm, rightArm, torso, nameBadge, jacketMat, heldHolder, currentHeldKey: "" };
  updateThirdPersonHeldItem(g, "axe", false);
  return g;
}

export function updateThirdPersonHeldItem(playerMesh, heldId, hasSteelAxe = false) {
  if (!playerMesh || !playerMesh.userData || !playerMesh.userData.heldHolder) return;
  const key = `${heldId}_${hasSteelAxe ? 1 : 0}`;
  if (playerMesh.userData.currentHeldKey === key) return;
  playerMesh.userData.currentHeldKey = key;
  const holder = playerMesh.userData.heldHolder;
  while (holder.children.length > 0) holder.remove(holder.children[0]);
  holder.add(buildHeldItemMesh(heldId, hasSteelAxe, false));
}

export function animatePlayerMesh(mesh, dt, time, isMoving, isWorking) {
  const u = mesh.userData;
  if (!u || !u.leftLeg) return;

  if (isMoving) {
    const s = Math.sin(time * 11) * 0.65;
    u.leftLeg.rotation.x = s;
    u.rightLeg.rotation.x = -s;
    u.leftArm.rotation.x = -s * 0.8;
    u.rightArm.rotation.x = isWorking ? Math.sin(time * 22) * 1.2 - 0.6 : s * 0.8;
  } else {
    u.leftLeg.rotation.x *= 0.85;
    u.rightLeg.rotation.x *= 0.85;
    u.leftArm.rotation.x = Math.sin(time * 2.2) * 0.05;
    u.rightArm.rotation.x = isWorking ? Math.sin(time * 22) * 1.25 - 0.7 : -Math.sin(time * 2.2) * 0.05;
  }
}

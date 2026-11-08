import * as THREE from "three";
import { CHUNK_SIZE, getTerrainHeight, getSurfaceType } from "./world.js";

// Общие геометрии (переиспользуются для тысяч деревьев, кустов и построек — ускоряет генерацию в 50 раз)
const GEO = {
  birchTrunk: new THREE.CylinderGeometry(0.18, 0.28, 4.4, 7),
  birchSpot: new THREE.CylinderGeometry(0.21, 0.24, 0.28, 7),
  birchCrown1: new THREE.DodecahedronGeometry(1.65, 0),
  birchCrown2: new THREE.DodecahedronGeometry(1.2, 0),
  pineTrunk: new THREE.CylinderGeometry(0.22, 0.34, 3.8, 7),
  pineCones: [
    new THREE.ConeGeometry(1.95, 2.5, 7),
    new THREE.ConeGeometry(1.53, 2.2, 7),
    new THREE.ConeGeometry(1.11, 1.9, 7)
  ],
  bush1: new THREE.DodecahedronGeometry(0.95, 0),
  bush2: new THREE.DodecahedronGeometry(0.7, 0),
  berry: new THREE.SphereGeometry(0.11, 5, 5),
  rock: new THREE.DodecahedronGeometry(1.15, 0),
  plotPost: new THREE.BoxGeometry(0.28, 1.25, 0.28),
  signLeg: new THREE.CylinderGeometry(0.09, 0.1, 1.7, 6),
  signBoard: new THREE.BoxGeometry(2.3, 1.05, 0.12)
};

const MAT = {
  birchBark: new THREE.MeshStandardMaterial({ color: 0xf2f0eb, roughness: 0.85 }),
  birchSpot: new THREE.MeshStandardMaterial({ color: 0x262925, roughness: 0.9 }),
  birchLeaf: new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.8 }),
  pineTrunk: new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 }),
  pineLeaf: new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.85 }),
  bushLeaf: new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.82 }),
  berryRed: new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.35, emissive: 0x3a0505 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.92, flatShading: true }),
  woodLight: new THREE.MeshStandardMaterial({ color: 0xd7a86e, roughness: 0.78 }),
  woodMedium: new THREE.MeshStandardMaterial({ color: 0x9c6b3b, roughness: 0.82 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x5c3c1e, roughness: 0.88 }),
  brickRed: new THREE.MeshStandardMaterial({ color: 0xb7412c, roughness: 0.8 }),
  plasterWhite: new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.75 }),
  roofGreen: new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 0.65 }),
  roofRed: new THREE.MeshStandardMaterial({ color: 0x8d2b24, roughness: 0.65 }),
  roofBlue: new THREE.MeshStandardMaterial({ color: 0x28557a, roughness: 0.6 }),
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
  foundation: new THREE.MeshStandardMaterial({ color: 0x60686c, roughness: 0.92 })
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
  const segs = 32;
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;

  const cForestLow = new THREE.Color(0x2d572c);
  const cForestHigh = new THREE.Color(0x417238);
  const cLawn = new THREE.Color(0x5da844);
  const cDirt = new THREE.Color(0x8d6e4c);
  const cAsphalt = new THREE.Color(0x3b4045);
  const cPlaza = new THREE.Color(0x7c6a53);
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
      const t = Math.max(0, Math.min(1, (wy + 3.0) / 7.5));
      tmpColor.copy(cForestLow).lerp(cForestHigh, t);
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.02
  });

  const mesh = new THREE.Mesh(geo, mat);
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
    trunk.position.y = 2.2;
    g.add(trunk);

    for (let i = 0; i < 3; i++) {
      const spot = new THREE.Mesh(GEO.birchSpot, MAT.birchSpot);
      spot.position.y = 0.7 + i * 1.1;
      g.add(spot);
    }

    const c1 = new THREE.Mesh(GEO.birchCrown1, MAT.birchLeaf);
    c1.position.set(0, 4.3, 0);
    g.add(c1);

    const c2 = new THREE.Mesh(GEO.birchCrown2, MAT.birchLeaf);
    c2.position.set(0.6, 5.2, 0.3);
    g.add(c2);
  } else if (res.kind === "pine") {
    const trunk = new THREE.Mesh(GEO.pineTrunk, MAT.pineTrunk);
    trunk.position.y = 1.9;
    g.add(trunk);

    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(GEO.pineCones[i], MAT.pineLeaf);
      cone.position.y = 3.1 + i * 1.35;
      g.add(cone);
    }
  } else if (res.kind === "berry_bush" || res.kind === "bush") {
    const b1 = new THREE.Mesh(GEO.bush1, MAT.bushLeaf);
    b1.position.set(0, 0.65, 0);
    g.add(b1);

    const b2 = new THREE.Mesh(GEO.bush2, MAT.bushLeaf);
    b2.position.set(0.45, 0.52, 0.3);
    g.add(b2);

    if (res.kind === "berry_bush") {
      const berriesGroup = new THREE.Group();
      const offsets = [
        [0.5, 0.85, 0.4],
        [-0.45, 0.8, 0.5],
        [0.2, 1.1, -0.45],
        [-0.35, 0.95, -0.4],
        [0.65, 0.65, -0.2],
        [0.0, 1.25, 0.35]
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
    r1.position.set(0, 0.55, 0);
    r1.scale.set(1.2, 0.78, 1.0);
    g.add(r1);
  }

  g.userData.resource = res;
  return g;
}

export function createSntEntranceMeshes(layout) {
  const group = new THREE.Group();

  // 1. Въездная арка СНТ
  const archY = getTerrainHeight(layout.archPos.x, layout.archPos.z);
  const arch = new THREE.Group();
  arch.position.set(layout.archPos.x, archY, layout.archPos.z);

  const postGeo = new THREE.CylinderGeometry(0.25, 0.28, 5.2, 8);
  const leftPost = new THREE.Mesh(postGeo, MAT.woodDark);
  leftPost.position.set(-4.3, 2.4, 0);
  const rightPost = new THREE.Mesh(postGeo, MAT.woodDark);
  rightPost.position.set(4.3, 2.4, 0);
  const topBeam = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.5, 0.5), MAT.woodMedium);
  topBeam.position.set(0, 4.9, 0);
  arch.add(leftPost, rightPost, topBeam);

  const signTex = makeTextCanvas(
    [
      { text: layout.sntName, font: "bold 22px Segoe UI", color: "#fffde7" },
      { text: "ДОБРО ПОЖАЛОВАТЬ ДАЧНИКАМ!", font: "bold 13px Segoe UI", color: "#dce775" }
    ],
    { width: 360, height: 84, bg: "#1b4d20", border: "#ffd54f" }
  );
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(7.8, 1.45, 0.22),
    new THREE.MeshBasicMaterial({ map: signTex })
  );
  signBoard.position.set(0, 4.9, 0);
  arch.add(signBoard);
  group.add(arch);

  // 2. Магазинчик «Сельпо»
  const shopY = getTerrainHeight(layout.shopPos.x, layout.shopPos.z);
  const shop = new THREE.Group();
  shop.position.set(layout.shopPos.x, shopY, layout.shopPos.z);

  const shopBase = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.2, 5.0), MAT.foundation);
  shopBase.position.y = 0.2;
  const shopBody = new THREE.Mesh(new THREE.BoxGeometry(6.0, 3.0, 4.6), MAT.woodLight);
  shopBody.position.y = 2.1;
  const shopRoof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.8, 4), MAT.roofGreen);
  shopRoof.rotation.y = Math.PI / 4;
  shopRoof.position.y = 4.4;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.1, 0.9), MAT.woodDark);
  counter.position.set(0, 1.2, 2.35);

  const seller = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color: 0x1e88e5 }));
  seller.position.set(0, 1.7, 1.7);
  const sellerHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffccaa }));
  sellerHead.position.set(0, 2.45, 1.7);

  const shopBadge = makeFloatingBadge(
    [
      { text: "🏪 МАГАЗИН «СЕЛЬПО»", font: "bold 20px Segoe UI", color: "#fffde7" },
      { text: "[E] Семена • Еда • Материалы", font: "bold 14px Segoe UI", color: "#ffd54f" }
    ],
    4.5,
    1.25,
    { bg: "rgba(21, 67, 36, 0.94)", border: "#ffd54f" }
  );
  shopBadge.position.set(0, 5.8, 0);

  shop.add(shopBase, shopBody, shopRoof, counter, seller, sellerHead, shopBadge);
  group.add(shop);

  // 3. Дачный Базар «Скупка» рядом с магазином
  const bazY = getTerrainHeight(layout.bazaarPos.x, layout.bazaarPos.z);
  const bazaar = new THREE.Group();
  bazaar.position.set(layout.bazaarPos.x, bazY, layout.bazaarPos.z);

  const bazBase = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.1, 5.0), MAT.foundation);
  bazBase.position.y = 0.15;
  const table = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.0, 2.2), MAT.woodMedium);
  table.position.set(0, 1.1, 0.6);

  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6);
  for (const px of [-2.6, 2.6]) {
    for (const pz of [-1.8, 1.8]) {
      const pole = new THREE.Mesh(poleGeo, MAT.woodDark);
      pole.position.set(px, 2.2, pz);
      bazaar.add(pole);
    }
  }
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(4.5, 1.6, 4), MAT.roofRed);
  canopy.rotation.y = Math.PI / 4;
  canopy.position.y = 4.3;

  const buyer = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color: 0xd84315 }));
  buyer.position.set(0, 1.7, -0.6);
  const buyerHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffccaa }));
  buyerHead.position.set(0, 2.45, -0.6);

  const bazBadge = makeFloatingBadge(
    [
      { text: "⚖️ ДАЧНЫЙ БАЗАР (СКУПКА)", font: "bold 20px Segoe UI", color: "#fffde7" },
      { text: "[E] Продать урожай, ягоды и дерево", font: "bold 14px Segoe UI", color: "#81c784" }
    ],
    4.6,
    1.25,
    { bg: "rgba(68, 24, 18, 0.94)", border: "#ff8a65" }
  );
  bazBadge.position.set(0, 5.6, 0);

  bazaar.add(bazBase, table, canopy, buyer, buyerHead, bazBadge);
  group.add(bazaar);

  return group;
}

export function createPlotBoundaryMesh(plot, ownership, price) {
  const g = new THREE.Group();
  const hw = plot.w / 2;
  const hd = plot.d / 2;

  const corners = [
    [plot.x - hw, plot.z - hd],
    [plot.x + hw, plot.z - hd],
    [plot.x + hw, plot.z + hd],
    [plot.x - hw, plot.z + hd]
  ];

  for (const [cx, cz] of corners) {
    const cy = getTerrainHeight(cx, cz);
    const post = new THREE.Mesh(GEO.plotPost, MAT.woodMedium);
    post.position.set(cx, cy + 0.5, cz);
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
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.42, 1.8), MAT.woodMedium);
    frame.position.y = 0.15;
    const soil = new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.34, 1.56), struct.watered ? MAT.soilWet : MAT.soilDark);
    soil.position.y = 0.22;
    g.add(frame, soil);
    g.userData.soilMesh = soil;

    const cropGroup = new THREE.Group();
    cropGroup.position.y = 0.4;
    g.add(cropGroup);
    g.userData.cropGroup = cropGroup;
  } else if (t === "greenhouse") {
    const base = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.5, 3.0), MAT.woodDark);
    base.position.y = 0.15;
    const soil = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.38, 2.7), struct.watered ? MAT.soilWet : MAT.soilDark);
    soil.position.y = 0.24;

    const domeGeo = new THREE.CylinderGeometry(1.5, 1.5, 4.3, 10, 1, false, 0, Math.PI);
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
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.6, 0.45, 6), MAT.foundation);
    floor.position.y = 0.15;
    const postGeo = new THREE.CylinderGeometry(0.11, 0.11, 2.6, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const post = new THREE.Mesh(postGeo, MAT.woodMedium);
      post.position.set(Math.cos(a) * 2.1, 1.5, Math.sin(a) * 2.1);
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.35, 6), MAT.roofGreen);
    roof.position.y = 3.2;
    const brazier = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 0.5), MAT.birchSpot);
    brazier.position.set(2.8, 0.45, 0);
    g.add(floor, roof, brazier);
  } else if (t === "shed") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.9, 3.0), MAT.foundation);
    plinth.position.y = 0.15;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.5, 2.8), MAT.woodLight);
    walls.position.y = 1.75;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.28, 3.3), MAT.roofSlate);
    roof.position.y = 3.1;
    roof.rotation.x = 0.08;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.85, 0.12), MAT.woodDark);
    door.position.set(-0.9, 1.45, 1.42);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.12), MAT.windowGlow);
    win.position.set(0.85, 1.85, 1.42);
    g.add(plinth, walls, roof, door, win);
  } else if (t === "house_wood") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.2, 5.6), MAT.foundation);
    plinth.position.y = 0.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(6.0, 3.2, 4.4), MAT.woodMedium);
    body.position.set(0, 2.2, -0.4);
    const porch = new THREE.Mesh(new THREE.BoxGeometry(5.8, 2.4, 1.4), MAT.woodLight);
    porch.position.set(0, 1.8, 2.1);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.1, 2.4, 4), MAT.roofGreen);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 4.9, 0);
    const win1 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 0.12), MAT.windowGlow);
    win1.position.set(-1.5, 2.1, 2.81);
    const win2 = win1.clone();
    win2.position.set(1.5, 2.1, 2.81);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.95, 0.14), MAT.woodDark);
    door.position.set(0, 1.6, 2.81);
    g.add(plinth, body, porch, roof, win1, win2, door);
  } else if (t === "banya") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.1, 4.2), MAT.foundation);
    plinth.position.y = 0.2;
    const logs = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.7, 3.8), MAT.woodMedium);
    logs.position.y = 1.9;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.8, 4), MAT.roofRed);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 4.1;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.2, 0.55), MAT.brickRed);
    chimney.position.set(1.2, 4.3, -0.6);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.12), MAT.windowGlow);
    win.position.set(1.1, 2.0, 1.92);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.8, 0.12), MAT.woodDark);
    door.position.set(-0.9, 1.5, 1.92);
    g.add(plinth, logs, roof, chimney, win, door);
  } else if (t === "house_terem") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(7.0, 1.3, 6.2), MAT.foundation);
    plinth.position.y = 0.2;
    const floor1 = new THREE.Mesh(new THREE.BoxGeometry(6.6, 3.1, 5.8), MAT.woodMedium);
    floor1.position.y = 2.2;
    const floor2 = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.7, 4.8), MAT.woodLight);
    floor2.position.y = 5.0;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.9, 2.6, 4), MAT.roofBlue);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 7.5;
    const winUp = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 0.14), MAT.windowGlow);
    winUp.position.set(0, 5.1, 2.42);
    const winL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.14), MAT.windowGlow);
    winL.position.set(-1.7, 2.3, 2.92);
    const winR = winL.clone();
    winR.position.set(1.7, 2.3, 2.92);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.15), MAT.woodDark);
    door.position.set(0, 1.7, 2.92);
    g.add(plinth, floor1, floor2, roof, winUp, winL, winR, door);
  } else if (t === "house_brick") {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(8.0, 1.4, 6.8), MAT.foundation);
    plinth.position.y = 0.25;
    const main = new THREE.Mesh(new THREE.BoxGeometry(7.6, 5.8, 6.2), MAT.brickRed);
    main.position.y = 3.6;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(7.75, 0.35, 6.35), MAT.plasterWhite);
    trim.position.y = 3.6;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.8, 4), MAT.roofRed);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 7.8;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.8, 0.8), MAT.brickRed);
    chimney.position.set(2.1, 7.8, -1.2);

    const winGeo = new THREE.BoxGeometry(1.2, 1.25, 0.15);
    for (const wy of [2.2, 5.0]) {
      for (const wx of [-2.0, 0, 2.0]) {
        if (wy === 2.2 && wx === 0) continue;
        const w = new THREE.Mesh(winGeo, MAT.windowGlow);
        w.position.set(wx, wy, 3.12);
        g.add(w);
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.2, 0.18), MAT.woodDark);
    door.position.set(0, 1.85, 3.12);
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
  badge.position.set(0, struct.type === "greenhouse" ? 2.25 : 1.35, 0);
  cropGroup.add(badge);
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

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), MAT.woodLight);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, -0.28, 0.24);
  rightArm.add(handle);

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
  g.userData = { leftLeg, rightLeg, leftArm, rightArm, torso, nameBadge, jacketMat };
  return g;
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

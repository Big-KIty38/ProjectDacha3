import * as THREE from "three";
import { Peer } from "peerjs";
import mqtt from "mqtt";
import { generateSecretKey, finalizeEvent } from "nostr-tools/pure";
import { CHUNK_SIZE, getTerrainHeight, getChunkLayout } from "./world.js?v=12";
import {
  ITEMS,
  CROPS,
  CRAFT_RECIPES,
  BUILDINGS,
  SHOP_GOODS,
  BAZAAR_PRICES,
  playSfx
} from "./data.js?v=12";
import {
  createTerrainChunkMesh,
  createResourceMesh,
  createSntEntranceMeshes,
  createPlotBoundaryMesh,
  updatePlotSignTexture,
  createStructureMesh,
  updateCropVisuals,
  createPlayerMesh,
  createFirstPersonViewmodel,
  updateFirstPersonHeldItem,
  updateThirdPersonHeldItem,
  createPhysicalPlankMesh,
  rebuildPlankNailsMesh,
  createSingleNailMesh,
  animatePlayerMesh
} from "./models.js?v=12";

const savedProfile = JSON.parse(localStorage.getItem("project_dacha3_profile_v1") || "null");

const state = {
  started: false,
  playerKey: savedProfile?.playerKey || "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
  name: savedProfile?.name || "",
  color: savedProfile?.color || "#2e7d32",
  money: savedProfile?.money ?? 500,
  hunger: savedProfile?.hunger ?? 100,
  energy: savedProfile?.energy ?? 100,
  tools: savedProfile?.tools || { axe: false, hammer: true, watering_can: false },
  heldItem: savedProfile?.heldItem || "axe",
  inv: savedProfile?.inv || {
    wood: 0,
    branch: 0,
    stone: 0,
    nails: 15,
    berry: 3,
    plank: 0,
    timber: 0,
    brick: 0,
    glass: 0,
    fertilizer: 0,
    seed_potato: 0,
    seed_cucumber: 0,
    seed_tomato: 0,
    seed_strawberry: 0,
    potato: 0,
    cucumber: 0,
    tomato: 0,
    strawberry: 0,
    jam: 0,
    pickles: 0,
    pie: 1
  },
  x: 0,
  y: 0,
  z: 42,
  vy: 0,
  ry: Math.PI,
  camYaw: 0,
  camPitch: 0.06,
  camDist: 10.5,
  firstPerson: true,
  walkBob: 0,
  isGrounded: true,
  workTimer: 0,
  buildMode: null,
  buildRot: 0,
  plots: savedProfile?.plots || {},
  structures: savedProfile?.structures || {},
  harvested: savedProfile?.harvested || {},
  berryPickedAt: {},
  remotePlayers: new Map()
};

const WORLD_PLANKS_STORAGE_KEY = "project_dacha3_world_planks_v1";

function loadSavedWorldPlanks() {
  try {
    const raw = localStorage.getItem(WORLD_PLANKS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveWorldPlanks() {
  try {
    localStorage.setItem(WORLD_PLANKS_STORAGE_KEY, JSON.stringify(state.planks || {}));
  } catch {}
}

state.structures = {};
state.planks = loadSavedWorldPlanks();
state.plankSpawnYaw = 0;

if (!savedProfile?.plankSystemV9) {
  state.inv.plank = Math.max(state.inv.plank || 0, 25);
  state.inv.nails = Math.max(state.inv.nails || 0, 40);
  if ((state.inv.pie || 0) === 0 && (state.inv.berry || 0) === 0) {
    state.inv.pie = 1;
    state.inv.berry = 3;
  }
}
state.tools.hammer = true;

function saveLocalProfile() {
  try {
    localStorage.setItem(
      "project_dacha3_profile_v1",
      JSON.stringify({
        playerKey: state.playerKey,
        name: state.name,
        color: state.color,
        money: state.money,
        hunger: state.hunger,
        energy: state.energy,
        tools: state.tools,
        heldItem: state.heldItem,
        inv: state.inv,
        plots: state.plots,
        plankSystemV9: true,
        structures: {},
        harvested: state.harvested
      })
    );
  } catch {}
}

// ==========================================
// THREE.JS СЦЕНА И ЧАНКИ МИРА
// ==========================================
const canvas = document.getElementById("game-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x9be2f8, 0.0052);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.2, 260);

const hemiLight = new THREE.HemisphereLight(0xe3f2fd, 0x335c2d, 0.85);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff6d6, 1.25);
sunLight.position.set(45, 75, 35);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.camera.near = 5;
sunLight.shadow.camera.far = 190;
const d = 65;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
scene.add(sunLight);
scene.add(sunLight.target);

scene.add(camera);
let selfMesh = createPlayerMesh(state.name, state.color);
selfMesh.visible = !state.firstPerson;
scene.add(selfMesh);

let fpHand = createFirstPersonViewmodel(state.color);
camera.add(fpHand);

const buildGhostGroup = new THREE.Group();
scene.add(buildGhostGroup);

const structuresRoot = new THREE.Group();
scene.add(structuresRoot);
const structureMeshes = new Map();

const planksRoot = new THREE.Group();
scene.add(planksRoot);
const plankMeshes = new Map();

const nailPreviewGroup = new THREE.Group();
const nailPreviewInner = createSingleNailMesh({ id: "preview", lx: 0, ly: 0, lz: 0, nx: 0, ny: 1, nz: 0, depth: 0.25 });
nailPreviewGroup.add(nailPreviewInner);
nailPreviewGroup.visible = false;
scene.add(nailPreviewGroup);

const plankPreviewMesh = createPhysicalPlankMesh({ id: "ghost_plank", w: 2.4, h: 0.12, d: 0.36, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, nails: [] });
plankPreviewMesh.traverse((c) => {
  if (c.isMesh && c.material) {
    c.material = c.material.clone();
    c.material.transparent = true;
    c.material.opacity = 0.5;
  }
});
plankPreviewMesh.visible = false;
scene.add(plankPreviewMesh);

const loadedChunks = new Map();


function lockPointerSafe() {
  if (
    state.started &&
    modalBackdrop.style.display !== "flex" &&
    document.activeElement !== document.getElementById("chat-input") &&
    document.pointerLockElement !== canvas
  ) {
    try { canvas.requestPointerLock(); } catch {}
  }
}

function resolveCollisions(nx, nz) {
  const playerRadius = 0.42;
  for (const ch of loadedChunks.values()) {
    if (Math.abs(nx - ch.centerX) > CHUNK_SIZE * 0.75 || Math.abs(nz - ch.centerZ) > CHUNK_SIZE * 0.75) continue;
    for (const [, rm] of ch.resMeshes.entries()) {
      const res = rm.userData.resource;
      let colR = 0;
      if (res.kind === "birch" || res.kind === "pine") colR = 0.55 * (res.scale || 1);
      else if (res.kind === "rock") colR = 1.15 * (res.scale || 1);
      else continue;
      const minDist = playerRadius + colR;
      const dx = nx - res.x;
      const dz = nz - res.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        nx += (dx / dist) * overlap;
        nz += (dz / dist) * overlap;
      }
    }
    for (const pav of [ch.layout.shopPos, ch.layout.bazaarPos]) {
      const dx = nx - pav.x;
      const dz = nz - pav.z;
      if (Math.abs(dx) < 3.5 && Math.abs(dz) < 2.6) {
        const penX = 3.5 - Math.abs(dx);
        const penZ = 2.6 - Math.abs(dz);
        if (penX < penZ) nx += dx >= 0 ? penX : -penX;
        else nz += dz >= 0 ? penZ : -penZ;
      }
    }
  }
  for (const s of Object.values(state.structures)) {
    if (s.type === "bed" || s.type === "greenhouse") continue;
    let r = 1.2;
    if (s.type === "shed" || s.type === "banya" || s.type === "gazebo") r = 2.1;
    else if (s.type === "house_wood" || s.type === "house_terem" || s.type === "house_brick") r = 3.1;
    else if (s.type === "fence") r = 0.55;
    const minDist = playerRadius + r;
    const dx = nx - s.x;
    const dz = nz - s.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDist * minDist && distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const overlap = minDist - dist;
      nx += (dx / dist) * overlap;
      nz += (dz / dist) * overlap;
    }
  }
  return { x: nx, z: nz };
}

function getNextPlotPrice() {
  const myPlots = Object.values(state.plots).filter((p) => p.ownerKey === state.playerKey).length;
  return 300 + myPlots * 150;
}

function ensureChunksAroundPlayer() {
  const pcx = Math.floor((state.x + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
  const pcz = Math.floor((state.z + CHUNK_SIZE * 0.5) / CHUNK_SIZE);

  const coords = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const needed = new Set();
  let loadedThisCall = 0;

  for (const [dx, dz] of coords) {
    const cx = pcx + dx;
    const cz = pcz + dz;
    const key = `${cx},${cz}`;
    needed.add(key);
    if (!loadedChunks.has(key) && loadedThisCall < 1) {
      loadChunk(cx, cz);
      loadedThisCall++;
    }
  }

  for (const [key, ch] of loadedChunks.entries()) {
    if (!needed.has(key)) {
      scene.remove(ch.group);
      loadedChunks.delete(key);
    }
  }
}

function loadChunk(cx, cz) {
  const key = `${cx},${cz}`;
  const layout = getChunkLayout(cx, cz);
  const group = new THREE.Group();

  group.add(createTerrainChunkMesh(cx, cz));
  group.add(createSntEntranceMeshes(layout));

  const plotMeshes = new Map();
  const price = getNextPlotPrice();
  for (const p of layout.plots) {
    const pm = createPlotBoundaryMesh(p, state.plots[p.plotId], price);
    group.add(pm);
    plotMeshes.set(p.plotId, pm);
  }

  const resMeshes = new Map();
  for (const res of layout.resources) {
    if (state.harvested[res.id]) continue;
    const rm = createResourceMesh(res);
    group.add(rm);
    resMeshes.set(res.id, rm);
  }

  scene.add(group);
  loadedChunks.set(key, { cx, cz, centerX: layout.centerX, centerZ: layout.centerZ, group, layout, plotMeshes, resMeshes });
}

function refreshAllPlotSigns() {
  const price = getNextPlotPrice();
  for (const ch of loadedChunks.values()) {
    for (const [plotId, pm] of ch.plotMeshes.entries()) {
      updatePlotSignTexture(pm, state.plots[plotId], price);
    }
  }
}

// ==========================================
// МУЛЬТИПЛЕЕРНАЯ СИНХРОНИЗАЦИЯ (ЕДИНЫЙ ЦЕНТРАЛЬНЫЙ СЕРВЕР СНТ #1)
// ==========================================
const CENTRAL_ROOM_TOPIC = "project_dacha3_snt_unified_server_v4";
const NTFY_HTTP_URL = `https://ntfy.sh/${CENTRAL_ROOM_TOPIC}`;
const NTFY_WS_URL = `wss://ntfy.sh/${CENTRAL_ROOM_TOPIC}/ws?since=2h`;
const NTFY_SSE_URL = `https://ntfy.sh/${CENTRAL_ROOM_TOPIC}/sse?since=2h`;

const seenPackets = new Set();
const bcChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("project_dacha_3_sync_v4") : null;

let ntfyConnected = false;
const mqttClients = [];
const nostrSockets = [];
const sessionSk = generateSecretKey();
let peerInstance = null;
let myPeerId = "";
const peerConnections = new Map();
let lastNtfyPosSentAt = 0;


function removeRemotePlayer(pid) {
  const rp = state.remotePlayers.get(pid);
  if (!rp) return;
  if (rp.mesh) {
    scene.remove(rp.mesh);
  }
  state.remotePlayers.delete(pid);
  updateOnlineListUI();
  updateNetBadge();
}

function cleanupDepartedPlayers() {
  const now = Date.now();
  let removedAny = false;
  for (const [pid, rp] of state.remotePlayers.entries()) {
    if (now - rp.lastSeen > 6500) {
      if (rp.mesh) scene.remove(rp.mesh);
      state.remotePlayers.delete(pid);
      removedAny = true;
    }
  }
  if (removedAny) {
    updateOnlineListUI();
    updateNetBadge();
  }
}

function updateNetBadge() {
  const el = document.getElementById("net-status");
  if (!el) return;
  const peersCount = peerConnections.size;
  const mqttOk = mqttClients.some((c) => c.connected);
  const nostrOk = nostrSockets.some((w) => w.readyState === WebSocket.OPEN);
  if (ntfyConnected || mqttOk || nostrOk || peersCount > 0) {
    el.textContent = `🟢 Единый Сервер СНТ #1 (Игроков: ${state.remotePlayers.size + 1})`;
  } else {
    el.textContent = "🟡 Подключение к Серверу СНТ #1...";
  }
}

function connectToPeer(remotePeerId) {
  if (!peerInstance || !remotePeerId || remotePeerId === myPeerId || peerConnections.has(remotePeerId)) return;
  try {
    const conn = peerInstance.connect(remotePeerId, { reliable: false });
    setupPeerConnection(conn);
  } catch {}
}

function setupPeerConnection(conn) {
  if (!conn || !conn.peer) return;
  conn.on("open", () => {
    peerConnections.set(conn.peer, conn);
    updateNetBadge();
    if (state.started) {
      conn.send(buildPresencePacket("player_joined"));
      conn.send({
        type: "world_sync_snapshot",
        pktId: `${state.playerKey}_snap_${Date.now()}`,
        senderKey: state.playerKey,
        plots: state.plots,
        plankSystemV9: true,
        structures: {},
        harvested: state.harvested
      });
    }
  });
  conn.on("data", (data) => {
    if (typeof data === "string") {
      try { handleIncomingPacket(JSON.parse(data)); } catch {}
    } else if (data && typeof data === "object") {
      handleIncomingPacket(data);
    }
  });
  conn.on("close", () => {
    peerConnections.delete(conn.peer);
    for (const [pid, rp] of state.remotePlayers.entries()) {
      if (rp.peerId === conn.peer) removeRemotePlayer(pid);
    }
    updateNetBadge();
  });
  conn.on("error", () => {
    peerConnections.delete(conn.peer);
  });
}

function buildPresencePacket(type = "player_moved") {
  const myPlotsCount = Object.values(state.plots).filter((p) => p.ownerKey === state.playerKey).length;
  return {
    type,
    pktId: `${state.playerKey}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    senderKey: state.playerKey,
    peerId: myPeerId,
    name: state.name,
    color: state.color,
    x: Number(state.x.toFixed(2)),
    y: Number(state.y.toFixed(2)),
    z: Number(state.z.toFixed(2)),
    ry: Number(state.ry.toFixed(2)),
    anim: state.workTimer > 0 ? "work" : "walk",
    money: Math.round(state.money),
    plotsCount: myPlotsCount
  };
}

function broadcastNetworkPacket(payload, isWorldState = false) {
  const pktId = payload.pktId || `${state.playerKey}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const fullPkt = { ...payload, pktId, senderKey: state.playerKey, peerId: myPeerId, sentAt: Date.now() };
  seenPackets.add(pktId);
  const rawJson = JSON.stringify(fullPkt);

  // 1. Локальные вкладки браузера
  if (bcChannel) {
    try { bcChannel.postMessage(fullPkt); } catch {}
  }

  // 2. Прямые WebRTC-соединения PeerJS между всеми игроками (мгновенно, без лимитов)
  for (const conn of peerConnections.values()) {
    if (conn.open) {
      try { conn.send(fullPkt); } catch {}
    }
  }

  // 3. Брокеры MQTT (работают и с VPN, и без VPN)
  for (const mc of mqttClients) {
    if (mc.connected) {
      try {
        mc.publish(`${CENTRAL_ROOM_TOPIC}/live`, rawJson, { qos: isWorldState ? 1 : 0, retain: isWorldState });
      } catch {}
    }
  }

  // 4. Глобальные Nostr-релеи (отлично работают через любой VPN без лимитов IP)
  if (nostrSockets.some((w) => w.readyState === WebSocket.OPEN)) {
    try {
      const ev = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["t", CENTRAL_ROOM_TOPIC]],
          content: rawJson
        },
        sessionSk
      );
      const frame = JSON.stringify(["EVENT", ev]);
      for (const ws of nostrSockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    } catch {}
  }

  // 4. Центральный сервер ntfy.sh (хранит историю всех покупок участков, построек, чата и входов 12 часов!)
  const now = Date.now();
  const shouldPostNtfy =
    isWorldState ||
    fullPkt.type === "player_joined" ||
    fullPkt.type === "request_world_sync" ||
    (fullPkt.type === "player_moved" && now - lastNtfyPosSentAt > 3500);

  if (shouldPostNtfy) {
    if (fullPkt.type === "player_moved") lastNtfyPosSentAt = now;
    fetch(NTFY_HTTP_URL, {
      method: "POST",
      body: rawJson
    }).catch(() => {});
  }
}

function sendMyPresenceAndWorldSnapshot() {
  if (!state.started) return;
  broadcastNetworkPacket(buildPresencePacket("player_joined"), false);

  if (Object.keys(state.plots).length > 0 || Object.keys(state.planks).length > 0) {
    broadcastNetworkPacket({
      type: "world_sync_snapshot",
      plots: state.plots,
      planks: state.planks,
      harvested: state.harvested
    }, true);
  }
}

function mergeWorldSnapshot(pkt) {
  let changedPlots = false;
  if (pkt.plots && typeof pkt.plots === "object") {
    for (const [pid, pdata] of Object.entries(pkt.plots)) {
      if (!state.plots[pid] || (pdata.boughtAt && pdata.boughtAt < (state.plots[pid].boughtAt || Infinity))) {
        state.plots[pid] = pdata;
        changedPlots = true;
      }
    }
  }
  if (changedPlots) refreshAllPlotSigns();

  if (pkt.planks && typeof pkt.planks === "object") {
    for (const [pid, pdata] of Object.entries(pkt.planks)) {
      if (pdata && pdata.id) {
        state.planks[pid] = pdata;
        spawnOrUpdatePlankMesh(pdata);
      }
    }
    saveWorldPlanks();
  }

  if (pkt.harvested && typeof pkt.harvested === "object") {
    for (const [nid, hdata] of Object.entries(pkt.harvested)) {
      if (!state.harvested[nid]) {
        state.harvested[nid] = hdata;
        for (const ch of loadedChunks.values()) {
          const rm = ch.resMeshes.get(nid);
          if (rm) {
            ch.group.remove(rm);
            ch.resMeshes.delete(nid);
          }
        }
      }
    }
  }
  updateHudUI();
  saveLocalProfile();
}

let lastWorldSyncReplyAt = 0;

function handleIncomingPacket(pkt) {
  if (!pkt || !pkt.type) return;
  if (pkt.pktId) {
    if (seenPackets.has(pkt.pktId)) return;
    seenPackets.add(pkt.pktId);
    if (seenPackets.size > 4000) seenPackets.delete(seenPackets.values().next().value);
  }
  if (pkt.senderKey === state.playerKey) return;

  if (pkt.peerId && pkt.peerId !== myPeerId) {
    connectToPeer(pkt.peerId);
  }

  switch (pkt.type) {
    case "request_world_sync": {
      if (Date.now() - lastWorldSyncReplyAt > 1500) {
        lastWorldSyncReplyAt = Date.now();
        setTimeout(() => sendMyPresenceAndWorldSnapshot(), 150 + Math.random() * 300);
      }
      break;
    }
    case "world_sync_snapshot": {
      mergeWorldSnapshot(pkt);
      break;
    }
    case "player_left": {
      const pid = pkt.senderKey || pkt.id;
      if (pid) removeRemotePlayer(pid);
      break;
    }
    case "player_moved":
    case "player_joined": {
      // Отсекаем старые пакеты движения/входа из истории релеев, чтобы ушедшие игроки никогда не появлялись!
      if (!pkt.sentAt || Math.abs(Date.now() - pkt.sentAt) > 7000) return;
      const pid = pkt.senderKey || pkt.id;
      if (!pid || pid === state.playerKey) return;
      const isNewPlayer = !state.remotePlayers.has(pid);
      let rp = state.remotePlayers.get(pid);
      if (!rp) {
        const mesh = createPlayerMesh(pkt.name || "Дачник", pkt.color || "#1565c0");
        scene.add(mesh);
        rp = {
          id: pid,
          peerId: pkt.peerId || "",
          name: pkt.name || "Дачник",
          color: pkt.color || "#1565c0",
          x: pkt.x ?? 0,
          y: pkt.y ?? 0,
          z: pkt.z ?? 42,
          tx: pkt.x ?? 0,
          tz: pkt.z ?? 42,
          ry: pkt.ry ?? 0,
          anim: pkt.anim || "idle",
          money: pkt.money ?? 500,
          plotsCount: pkt.plotsCount ?? 0,
          lastSeen: Date.now(),
          mesh
        };
        state.remotePlayers.set(pid, rp);
        updateOnlineListUI();
        updateNetBadge();
      } else {
        if (pkt.name && pkt.name !== rp.name) {
          rp.name = pkt.name;
          scene.remove(rp.mesh);
          rp.mesh = createPlayerMesh(rp.name, pkt.color || rp.color);
          scene.add(rp.mesh);
        }
        rp.tx = typeof pkt.x === "number" ? pkt.x : rp.tx;
        rp.tz = typeof pkt.z === "number" ? pkt.z : rp.tz;
        rp.ry = typeof pkt.ry === "number" ? pkt.ry : rp.ry;
        rp.anim = pkt.anim || "idle";
        if (typeof pkt.money === "number") rp.money = pkt.money;
        if (typeof pkt.plotsCount === "number") rp.plotsCount = pkt.plotsCount;
        if (pkt.peerId) rp.peerId = pkt.peerId;
        rp.lastSeen = Date.now();
      }

      if ((pkt.type === "player_joined" || isNewPlayer) && Date.now() - lastWorldSyncReplyAt > 1500) {
        lastWorldSyncReplyAt = Date.now();
        setTimeout(() => sendMyPresenceAndWorldSnapshot(), 150 + Math.random() * 250);
      }
      break;
    }
    case "plot_bought": {
      const p = pkt.plot;
      if (!p || !p.plotId) return;
      state.plots[p.plotId] = p;
      refreshAllPlotSigns();
      updateHudUI();
      saveLocalProfile();
      break;
    }
    case "node_harvested": {
      const nodeId = pkt.nodeId;
      if (!nodeId) return;
      state.harvested[nodeId] = { nodeId, permanent: Boolean(pkt.permanent), time: Date.now() };
      for (const ch of loadedChunks.values()) {
        const rm = ch.resMeshes.get(nodeId);
        if (rm) {
          ch.group.remove(rm);
          ch.resMeshes.delete(nodeId);
        }
      }
      saveLocalProfile();
      break;
    }
    case "plank_placed":
    case "plank_updated": {
      const pl = pkt.plank;
      if (!pl || !pl.id) return;
      state.planks[pl.id] = pl;
      spawnOrUpdatePlankMesh(pl);
      saveWorldPlanks();
      break;
    }
    case "planks_batch": {
      if (Array.isArray(pkt.planks)) {
        for (const pl of pkt.planks) {
          if (pl && pl.id) {
            state.planks[pl.id] = pl;
            spawnOrUpdatePlankMesh(pl);
          }
        }
        saveWorldPlanks();
      }
      break;
    }
    case "plank_removed": {
      if (pkt.id) removePlankById(pkt.id, false);
      break;
    }
    case "clear_owner_objects": {
      removeObjectsByOwner(pkt.ownerName, pkt.ownerKey, false);
      break;
    }
    case "structure_placed": {
      break;
    }
    case "structure_removed": {
      const id = pkt.id;
      if (!id) return;
      delete state.structures[id];
      const m = structureMeshes.get(id);
      if (m) {
        structuresRoot.remove(m);
        structureMeshes.delete(id);
      }
      saveLocalProfile();
      break;
    }
    case "crop_updated": {
      const target = state.structures[pkt.id];
      if (!target) return;
      target.crop = pkt.crop;
      target.plantedAt = pkt.plantedAt;
      target.watered = pkt.watered;
      saveLocalProfile();
      break;
    }
    case "chat_msg": {
      if (pkt.message) appendChatLine(pkt.message);
      break;
    }
  }
}


function sendLeaveNotification() {
  if (!state.started) return;
  const leavePkt = {
    type: "player_left",
    pktId: `${state.playerKey}_left_${Date.now()}`,
    senderKey: state.playerKey,
    peerId: myPeerId,
    sentAt: Date.now()
  };
  const raw = JSON.stringify(leavePkt);
  if (bcChannel) {
    try { bcChannel.postMessage(leavePkt); } catch {}
  }
  for (const conn of peerConnections.values()) {
    if (conn.open) {
      try { conn.send(leavePkt); } catch {}
    }
  }
  for (const mc of mqttClients) {
    if (mc.connected) {
      try { mc.publish(`${CENTRAL_ROOM_TOPIC}/live`, raw); } catch {}
    }
  }
  if (navigator.sendBeacon) {
    try { navigator.sendBeacon(NTFY_HTTP_URL, raw); } catch {}
  }
}
window.addEventListener("pagehide", sendLeaveNotification);
window.addEventListener("beforeunload", sendLeaveNotification);

let networkInitialized = false;
function initMultiplayerNetwork() {
  if (networkInitialized) return;
  networkInitialized = true;

  if (bcChannel) bcChannel.onmessage = (ev) => handleIncomingPacket(ev.data);

  // 1. Подключаемся к единому центральному серверу ntfy.sh (WebSocket + EventSource резерв)
  try {
    const ws = new WebSocket(NTFY_WS_URL);
    ws.onopen = () => {
      ntfyConnected = true;
      updateNetBadge();
      if (state.started) sendMyPresenceAndWorldSnapshot();
    };
    ws.onmessage = (ev) => {
      try {
        const wrapper = JSON.parse(ev.data);
        if (wrapper && wrapper.event === "message" && wrapper.message) {
          handleIncomingPacket(JSON.parse(wrapper.message));
        }
      } catch {}
    };
    ws.onclose = () => {
      ntfyConnected = false;
      updateNetBadge();
      // Резервный поток через SSE (HTTPS порт 443)
      try {
        const sse = new EventSource(NTFY_SSE_URL);
        sse.onopen = () => {
          ntfyConnected = true;
          updateNetBadge();
        };
        sse.onmessage = (ev) => {
          try {
            const wrapper = JSON.parse(ev.data);
            if (wrapper && wrapper.event === "message" && wrapper.message) {
              handleIncomingPacket(JSON.parse(wrapper.message));
            }
          } catch {}
        };
      } catch {}
    };
  } catch {}

  // 2. Запускаем PeerJS для мгновенной передачи координат игроков напрямую (port 443)
  try {
    peerInstance = new Peer();
    peerInstance.on("open", (id) => {
      myPeerId = id;
      updateNetBadge();
      if (state.started) sendMyPresenceAndWorldSnapshot();
    });
    peerInstance.on("connection", (conn) => {
      setupPeerConnection(conn);
    });
  } catch {}

  // 3. Подключаем публичные MQTT брокеры (включая порт 443 и 8084/8884)
  for (const brokerUrl of [
    "wss://mqtt.eclipseprojects.io:443/mqtt",
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt"
  ]) {
    try {
      const mc = mqtt.connect(brokerUrl, { connectTimeout: 5000, reconnectPeriod: 4000 });
      mqttClients.push(mc);
      mc.on("connect", () => {
        updateNetBadge();
        mc.subscribe(`${CENTRAL_ROOM_TOPIC}/live`);
        if (state.started) sendMyPresenceAndWorldSnapshot();
      });
      mc.on("message", (_topic, payload) => {
        try {
          handleIncomingPacket(JSON.parse(payload.toString()));
        } catch {}
      });
    } catch {}
  }

  // 4. Подключаем Nostr-релеи (особенно быстро работают при включённом VPN)
  for (const relayUrl of ["wss://nos.lol", "wss://relay.damus.io"]) {
    try {
      const nws = new WebSocket(relayUrl);
      nostrSockets.push(nws);
      nws.onopen = () => {
        updateNetBadge();
        nws.send(JSON.stringify(["REQ", "snt-v5", { "#t": [CENTRAL_ROOM_TOPIC], limit: 200 }]));
        if (state.started) sendMyPresenceAndWorldSnapshot();
      };
      nws.onmessage = (ev) => {
        try {
          const arr = JSON.parse(ev.data);
          if (arr[0] === "EVENT" && arr[2] && arr[2].content) {
            handleIncomingPacket(JSON.parse(arr[2].content));
          }
        } catch {}
      };
    } catch {}
  }
}

// ==========================================
// ДЕЙСТВИЯ, РЕСУРСЫ, ОГОРОД, СТРОИТЕЛЬСТВО
// ==========================================
function spawnOrUpdateStructureMesh(struct) {
  const old = structureMeshes.get(struct.id);
  if (old) structuresRoot.remove(old);
  const mesh = createStructureMesh(struct);
  structuresRoot.add(mesh);
  structureMeshes.set(struct.id, mesh);
}

function getCropProgress(struct) {
  if (!struct.crop || !struct.plantedAt) return 0;
  const info = CROPS[struct.crop];
  if (!info) return 0;
  const elapsed = (Date.now() - struct.plantedAt) / 1000;
  let speedMult = 1.0;
  if (struct.watered) speedMult *= 1.8;
  if (struct.type === "greenhouse") speedMult *= 1.8;
  return Math.min(1, (elapsed * speedMult) / info.growSeconds);
}

function findPlotAt(x, z) {
  for (const ch of loadedChunks.values()) {
    for (const p of ch.layout.plots) {
      if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return p;
    }
  }
  return null;
}

function findNearestInteractable() {
  const px = state.x;
  const pz = state.z;
  let best = null;
  let bestDist = 5.8;

  for (const ch of loadedChunks.values()) {
    const dShop = Math.hypot(px - ch.layout.shopPos.x, pz - ch.layout.shopPos.z);
    if (dShop < 4.8 && dShop < bestDist) {
      bestDist = dShop;
      best = {
        kind: "shop",
        title: `🏪 Магазин «Сельпо» (${ch.layout.sntName})`,
        sub: "Нажмите [E] или ЛКМ — Купить семена, еду, стройматериалы",
        data: ch.layout
      };
    }

    const dBaz = Math.hypot(px - ch.layout.bazaarPos.x, pz - ch.layout.bazaarPos.z);
    if (dBaz < 4.8 && dBaz < bestDist) {
      bestDist = dBaz;
      best = {
        kind: "bazaar",
        title: `⚖️ Дачный Базар (${ch.layout.sntName})`,
        sub: "Нажмите [E] или ЛКМ — Продать урожай, ягоды, брёвна и заготовки",
        data: ch.layout
      };
    }

    for (const p of ch.layout.plots) {
      const dSign = Math.hypot(px - p.signX, pz - p.signZ);
      if (dSign < 3.6 && dSign < bestDist) {
        const owner = state.plots[p.plotId];
        bestDist = dSign;
        if (!owner) {
          const price = getNextPlotPrice();
          best = {
            kind: "buy_plot",
            title: `🪧 Участок №${p.plotNum} (${p.sntName}) — Свободен`,
            sub: `Нажмите [E] — Купить участок в собственность за ${price} ₽`,
            data: p
          };
        } else if (owner.ownerKey === state.playerKey) {
          best = {
            kind: "own_plot",
            title: `🏡 Ваш участок №${p.plotNum} (${p.sntName})`,
            sub: "Нажмите [B] для строительства домов и грядок на своём участке",
            data: p
          };
        } else {
          best = {
            kind: "other_plot",
            title: `🪧 Участок №${p.plotNum} • Владелец: ${owner.ownerName}`,
            sub: "Частная дачная территория",
            data: p
          };
        }
      }
    }

    for (const [, rm] of ch.resMeshes.entries()) {
      const res = rm.userData.resource;
      const dist = Math.hypot(px - res.x, pz - res.z);
      if (dist < 3.4 && dist < bestDist) {
        bestDist = dist;
        if (res.kind === "berry_bush") {
          const pickedTime = state.berryPickedAt[res.id] || 0;
          const hasBerries = Date.now() - pickedTime > 45_000;
          best = {
            kind: "resource",
            title: hasBerries ? "🍓 Куст с лесными ягодами" : "🌿 Ягодный куст (ягоды собраны)",
            sub: hasBerries
              ? "Нажмите [E] или ЛКМ — Собрать спелые ягоды (+3 🍓, +1 🌿)"
              : "Нажмите [E] — Расчистить куст на ветки (+2 🌿)",
            data: { res, mesh: rm, hasBerries }
          };
        } else if (res.kind === "bush") {
          best = {
            kind: "resource",
            title: "🌿 Дикий кустарник",
            sub: "Нажмите [E] или ЛКМ — Срубить куст (+2 Ветки 🌿)",
            data: { res, mesh: rm }
          };
        } else if (res.kind === "birch" || res.kind === "pine") {
          best = {
            kind: "resource",
            title: res.kind === "birch" ? "🌳 Русская берёза" : "🌲 Лесная сосна",
            sub: state.heldItem === "axe"
              ? `Нажмите [E] или ЛКМ — Срубить топором (+${state.tools.axe ? 4 : 2} Бревна 🪵, +2 Ветки 🌿)`
              : "🪓 Возьмите Топор в руку [клавиша 2], чтобы срубить дерево!",
            data: { res, mesh: rm }
          };
        } else if (res.kind === "rock") {
          best = {
            kind: "resource",
            title: "🪨 Каменный валун",
            sub: "Нажмите [E] или ЛКМ — Добыть камень (+3 Камня 🪨)",
            data: { res, mesh: rm }
          };
        }
      }
    }
  }

  for (const s of Object.values(state.structures)) {
    if (s.type === "bed" || s.type === "greenhouse") {
      const dist = Math.hypot(px - s.x, pz - s.z);
      if (dist < 3.5 && dist < bestDist) {
        bestDist = dist;
        const prog = getCropProgress(s);
        if (!s.crop) {
          best = {
            kind: "garden",
            title: s.type === "greenhouse" ? "🏡 Свободная теплица" : "🌱 Свободная грядка",
            sub: "Нажмите [E] — Посадить семена (картофель, огурцы, томаты, клубника)",
            data: s
          };
        } else if (prog >= 1) {
          best = {
            kind: "garden",
            title: `✅ Урожай созрел: ${CROPS[s.crop].name}!`,
            sub: "Нажмите [E] — Собрать свежий урожай в рюкзак",
            data: s
          };
        } else {
          best = {
            kind: "garden",
            title: `🌱 Растёт: ${CROPS[s.crop].name} (${Math.floor(prog * 100)}%)`,
            sub: "Нажмите [E] — Полить грядку или внести удобрение для ускорения роста",
            data: s
          };
        }
      }
    }
  }

  return best;
}

function executeInteraction(target) {
  if (!target) return;

  if (target.kind === "shop") return openShopModal();
  if (target.kind === "bazaar") return openBazaarModal();
  if (target.kind === "own_plot") return openBuildModal();

  state.workTimer = 0.38;

  if (target.kind === "buy_plot") {
    const plot = target.data;
    const price = getNextPlotPrice();
    if (state.money < price) {
      showToast(`❌ Недостаточно денег! Нужно ${price} ₽ (продайте ягоды или урожай на Базаре).`);
      return;
    }
    state.money -= price;
    const ownership = {
      plotId: plot.plotId,
      sntName: plot.sntName,
      plotNum: plot.plotNum,
      ownerKey: state.playerKey,
      ownerName: state.name,
      color: state.color,
      boughtAt: Date.now()
    };
    state.plots[plot.plotId] = ownership;
    playSfx("coin");
    refreshAllPlotSigns();
    updateHudUI();
    saveLocalProfile();
    broadcastNetworkPacket({ type: "plot_bought", plot: ownership }, true);
    showToast(`🎉 Вы купили Участок №${plot.plotNum} в ${plot.sntName}! Стройте дома и грядки [B]!`);
    return;
  }

  if (target.kind === "resource") {
    const { res, mesh, hasBerries } = target.data;
    if (res.kind === "berry_bush" && hasBerries) {
      state.berryPickedAt[res.id] = Date.now();
      if (mesh.userData.berriesGroup) mesh.userData.berriesGroup.visible = false;
      state.inv.berry = (state.inv.berry || 0) + 3;
      state.inv.branch = (state.inv.branch || 0) + 1;
      playSfx("pick");
      showToast("🍓 Собрано: +3 Лесные ягоды, +1 Ветки (нажмите [F], чтобы поесть!)");
      updateHudUI();
      saveLocalProfile();
      return;
    }

    if (res.onPlotId) {
      const plotOwner = state.plots[res.onPlotId];
      if (plotOwner && plotOwner.ownerKey !== state.playerKey) {
        showToast(`⚠️ Этот участок принадлежит дачнику ${plotOwner.ownerName}!`);
        return;
      }
    }

    if ((res.kind === "birch" || res.kind === "pine") && state.heldItem !== "axe") {
      showToast("🪓 Чтобы срубить дерево, возьмите Топор в руку [клавиша 2]!");
      return;
    }

    playSfx("chop");
    if (res.kind === "birch" || res.kind === "pine") {
      const woodGain = state.tools.axe ? 4 : 2;
      state.inv.wood = (state.inv.wood || 0) + woodGain;
      state.inv.branch = (state.inv.branch || 0) + 2;
      showToast(`🪵 Дерево срублено: +${woodGain} Бревна, +2 Ветки`);
    } else if (res.kind === "rock") {
      state.inv.stone = (state.inv.stone || 0) + 3;
      showToast("🪨 Добыто: +3 Камня");
    } else {
      state.inv.branch = (state.inv.branch || 0) + 2;
      showToast("🌿 Куст расчищен: +2 Ветки");
    }

    state.hunger = Math.max(0, state.hunger - 1.2);
    const permanent = Boolean(res.onPlotId);
    state.harvested[res.id] = { nodeId: res.id, permanent, time: Date.now() };

    for (const ch of loadedChunks.values()) {
      if (ch.resMeshes.has(res.id)) {
        ch.group.remove(mesh);
        ch.resMeshes.delete(res.id);
      }
    }

    broadcastNetworkPacket({ type: "node_harvested", nodeId: res.id, permanent, x: res.x, z: res.z, kind: res.kind }, true);
    updateHudUI();
    saveLocalProfile();
    return;
  }

  if (target.kind === "garden") {
    const struct = target.data;
    const prog = getCropProgress(struct);
    if (!struct.crop) {
      openGardenPlantModal(struct);
    } else if (prog >= 1) {
      const cInfo = CROPS[struct.crop];
      const count = cInfo.yieldCount + (struct.type === "greenhouse" ? 2 : 0);
      state.inv[cInfo.produceItem] = (state.inv[cInfo.produceItem] || 0) + count;
      struct.crop = null;
      struct.plantedAt = 0;
      struct.watered = false;
      playSfx("pick");
      showToast(`🧺 Собран урожай: +${count} ${cInfo.name}! Можно съесть или продать на Базаре!`);
      broadcastNetworkPacket({ type: "crop_updated", id: struct.id, crop: null, plantedAt: 0, watered: false }, true);
      updateHudUI();
      saveLocalProfile();
    } else {
      openGardenCareModal(struct);
    }
  }
}

const FOOD_KEYS = ["pie", "berry", "potato", "cucumber", "tomato", "strawberry", "jam", "pickles"];

export function getHeldItemTitle(id = state.heldItem) {
  if (id === "hand") return "✋ Пустая рука (Удерж. ЛКМ — тащить • ЛКМ + R/Q/E/ПКМ — вращать доску)";
  if (id === "plank") return `🪵 Доска (${state.inv.plank || 0} шт. • ЛКМ — поставить • [R] — повернуть)`;
  if (id === "nails") return `🔩 Гвозди (${state.inv.nails || 0} шт. • ЛКМ по доске — воткнуть гвоздь)`;
  if (id === "hammer") return "🔨 Молоток (ЛКМ по гвоздю — забивать в доску и сбивать доски)";
  if (id === "axe") return state.tools.axe ? "🪓 Стальной топор (x2 дерево)" : "🪓 Топор дачника";
  if (id === "watering_can") return "🚿 Садовая лейка";
  if (ITEMS[id]) {
    const info = ITEMS[id];
    const cnt = state.inv[id] || 0;
    return `${info.icon} ${info.name} (${cnt} шт.${info.food > 0 ? ` • +${info.food}% сытости [F]` : ""})`;
  }
  return "✋ Пустая рука";
}

function getHotbarSlots() {
  const slots = [
    { id: "hand", icon: "✋", name: "Рука", count: null, kind: "tool" },
    { id: "plank", icon: "🪵", name: "Доска", count: state.inv.plank || 0, kind: "item" },
    { id: "nails", icon: "🔩", name: "Гвозди", count: state.inv.nails || 0, kind: "item" },
    { id: "hammer", icon: "🔨", name: "Молоток", count: null, kind: "tool" },
    { id: "axe", icon: "🪓", name: state.tools.axe ? "Сталь. топор" : "Топор", count: null, kind: "tool" }
  ];
  if (state.tools.watering_can) {
    slots.push({ id: "watering_can", icon: "🚿", name: "Лейка", count: null, kind: "tool" });
  }
  let anyFoodAdded = false;
  for (const fk of FOOD_KEYS) {
    const cnt = state.inv[fk] || 0;
    if (cnt > 0) {
      anyFoodAdded = true;
      slots.push({
        id: fk,
        icon: ITEMS[fk].icon,
        name: ITEMS[fk].name,
        count: cnt,
        kind: "food"
      });
    }
  }
  if (!anyFoodAdded) {
    slots.push({ id: "berry", icon: "🍓", name: "Еда (нет)", count: 0, kind: "empty_food" });
  }
  if (
    state.heldItem &&
    !slots.some((s) => s.id === state.heldItem) &&
    ITEMS[state.heldItem] &&
    (state.inv[state.heldItem] || 0) > 0
  ) {
    slots.push({
      id: state.heldItem,
      icon: ITEMS[state.heldItem].icon,
      name: ITEMS[state.heldItem].name,
      count: state.inv[state.heldItem] || 0,
      kind: "item"
    });
  }
  return slots.slice(0, 9);
}

function selectHeldItem(id, silent = false) {
  if (id === "berry" && (state.inv.berry || 0) <= 0) {
    showToast("🍓 У вас пока нет ягод! Соберите их с ягодного куста [E] или купите пирожок в Магазине.");
    return;
  }
  if (ITEMS[id] && id !== "nails" && id !== "plank" && (state.inv[id] || 0) <= 0) {
    state.heldItem = "hand";
  } else {
    state.heldItem = id;
  }
  updateFirstPersonHeldItem(fpHand, state.heldItem, state.tools.axe);
  updateThirdPersonHeldItem(selfMesh, state.heldItem, state.tools.axe);
  updateHudUI();
  saveLocalProfile();
  if (!silent) {
    showToast(`🖐️ В руке: ${getHeldItemTitle(state.heldItem)}`);
  }
}

function cycleHotbarSlot(dir) {
  const slots = getHotbarSlots().filter((s) => s.kind !== "empty_food");
  if (slots.length === 0) return;
  const idx = slots.findIndex((s) => s.id === state.heldItem);
  const nextIdx = idx === -1 ? 0 : (idx + dir + slots.length) % slots.length;
  selectHeldItem(slots[nextIdx].id, true);
}

function eatFoodAction() {
  const held = state.heldItem;
  const info = ITEMS[held];
  if (!info || !(info.food > 0)) {
    showToast("⚠️ Еду можно есть только держа её в руке! Возьмите еду в руку (слоты 1–9 внизу экрана).");
    return;
  }
  if ((state.inv[held] || 0) <= 0) {
    selectHeldItem("hand", true);
    showToast("⚠️ Эта еда закончилась! Возьмите другую еду в руку.");
    return;
  }
  state.inv[held]--;
  const gain = info.food || 20;
  state.hunger = Math.min(100, state.hunger + gain);
  state.energy = Math.min(100, state.energy + Math.round(gain * 0.6));
  state.workTimer = 0.38;
  playSfx("pick");
  showToast(`😋 Вы съели с руки «${info.name}» (+${gain}% сытости)!`);
  if ((state.inv[held] || 0) <= 0) {
    const remainingFood = FOOD_KEYS.find((k) => (state.inv[k] || 0) > 0);
    state.heldItem = remainingFood || "hand";
    updateFirstPersonHeldItem(fpHand, state.heldItem, state.tools.axe);
  updateThirdPersonHeldItem(selfMesh, state.heldItem, state.tools.axe);
  }
  updateHudUI();
  saveLocalProfile();
}

// ==========================================
// МОДАЛЬНЫЕ ОКНА
// ==========================================
const modalBackdrop = document.getElementById("modal-backdrop");
const modalTitle = document.getElementById("modal-title");
const modalSubtitle = document.getElementById("modal-subtitle");
const modalBody = document.getElementById("modal-body");

function closeModal(restoreLock = true) {
  modalBackdrop.style.display = "none";
  if (restoreLock) lockPointerSafe();
}
document.getElementById("modal-close").addEventListener("click", () => closeModal(true));
modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(true); });

function openInventoryModal() {
  if (modalBackdrop.style.display === "flex" && modalTitle.textContent.startsWith("🎒")) {
    closeModal(true);
    return;
  }
  modalTitle.textContent = `🎒 Рабочий инвентарь и Рюкзак (Наличные: ${Math.round(state.money)} ₽)`;
  modalSubtitle.textContent = "Выберите инструмент, гвозди или еду, чтобы взять в руку (еду можно есть только держа её в руке [F]):";
  modalBody.innerHTML = "";

  const baseTools = [
    { id: "hand", icon: "✋", name: "Пустая рука", desc: "Для сбора ягод, камней и ухода за огородом." },
    { id: "axe", icon: "🪓", name: state.tools.axe ? "Стальной топор (x2 дерево)" : "Топор дачника", desc: "Держите в руке [2], чтобы рубить берёзы и сосны." },
    { id: "hammer", icon: "🔨", name: "Строительный молоток", desc: "Держите в руке [3] для постройки домов, заборов и грядок на участке." }
  ];
  if (state.tools.watering_can) {
    baseTools.push({ id: "watering_can", icon: "🚿", name: "Садовая лейка", desc: "Автоматический полив при посадке семян." });
  }

  baseTools.forEach((t) => {
    const isHeld = state.heldItem === t.id;
    const card = document.createElement("div");
    card.className = "card-item";
    card.innerHTML = `
      <div>
        <div class="card-title">${t.icon} ${t.name} ${isHeld ? '<span style="color:#ffd54f">• В РУКЕ</span>' : ""}</div>
        <div class="card-desc">${t.desc}</div>
      </div>
      <button class="card-btn" style="${isHeld ? "background:#2e7d32;" : ""}">${isHeld ? "✅ Сейчас в руке" : "🖐️ Взять в руку"}</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      selectHeldItem(t.id);
      openInventoryModal();
    });
    modalBody.appendChild(card);
  });

  Object.entries(ITEMS).forEach(([key, info]) => {
    const cnt = state.inv[key] || 0;
    if (cnt <= 0 && key !== "nails") return;
    const isHeld = state.heldItem === key;
    const card = document.createElement("div");
    card.className = "card-item";
    const descText = info.food > 0
      ? `Еда (+${info.food}% сытости). Возьмите в руку и нажмите [F], чтобы съесть!`
      : key === "nails"
      ? "Строительный крепёж. Можно держать в руке [4] при постройке объектов на участке."
      : "Ресурс для строительства, огорода, крафта или продажи на Базаре.";
    card.innerHTML = `
      <div>
        <div class="card-title">${info.icon} ${info.name}: <span style="color:#ffd54f">${cnt} шт.</span> ${isHeld ? '<span style="color:#69f0ae">• В РУКЕ</span>' : ""}</div>
        <div class="card-desc">${descText}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="card-btn btn-equip" style="flex:1;${isHeld ? "background:#2e7d32;" : ""}" ${cnt <= 0 ? "disabled" : ""}>${isHeld ? "✅ В руке" : "🖐️ Взять в руку"}</button>
        ${info.food > 0 && isHeld && cnt > 0 ? `<button class="card-btn btn-eat-held" style="flex:1;background:#ef6c00;">😋 Съесть с руки</button>` : ""}
      </div>
    `;
    card.querySelector(".btn-equip").addEventListener("click", () => {
      if (cnt <= 0) return;
      selectHeldItem(key);
      openInventoryModal();
    });
    const eatBtn = card.querySelector(".btn-eat-held");
    if (eatBtn) {
      eatBtn.addEventListener("click", () => {
        eatFoodAction();
        openInventoryModal();
      });
    }
    modalBody.appendChild(card);
  });

  if (document.pointerLockElement) document.exitPointerLock();
  modalBackdrop.style.display = "flex";
}

function formatCostObject(cost) {
  return Object.entries(cost)
    .map(([k, v]) => `${ITEMS[k]?.icon || ""} ${ITEMS[k]?.name || k}: ${v} (у вас: ${state.inv[k] || 0})`)
    .join(" • ");
}
function hasResources(cost) {
  return Object.entries(cost).every(([k, v]) => (state.inv[k] || 0) >= v);
}
function consumeResources(cost) {
  for (const [k, v] of Object.entries(cost)) state.inv[k] = Math.max(0, (state.inv[k] || 0) - v);
}

function openCraftModal() {
  modalTitle.textContent = "🪚 Переработка ресурсов и Крафт";
  modalSubtitle.textContent = "Перерабатывайте брёвна, камень, ветки и урожай в стройматериалы, инструменты и консервы:";
  modalBody.innerHTML = "";
  CRAFT_RECIPES.forEach((r) => {
    const can = hasResources(r.cost) && (!r.tool || !state.tools[r.tool]);
    const card = document.createElement("div");
    card.className = "card-item";
    card.innerHTML = `
      <div><div class="card-title">${r.title}</div><div class="card-desc">${r.desc}</div></div>
      <div class="card-cost">Требуется: ${formatCostObject(r.cost)}</div>
      <button class="card-btn" ${can ? "" : "disabled"}>${r.tool && state.tools[r.tool] ? "✅ Уже создано" : "Изготовить"}</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      if (!hasResources(r.cost)) return;
      consumeResources(r.cost);
      if (r.tool) { state.tools[r.tool] = true; showToast(`🛠️ Создан инструмент: ${r.title}!`); }
      if (r.out) {
        for (const [k, v] of Object.entries(r.out)) state.inv[k] = (state.inv[k] || 0) + v;
        showToast(`✅ Изготовлено: ${r.title}!`);
      }
      playSfx("build");
      updateHudUI();
      saveLocalProfile();
      openCraftModal();
    });
    modalBody.appendChild(card);
  });
  if (document.pointerLockElement) document.exitPointerLock();
  modalBackdrop.style.display = "flex";
}

function openBuildModal() {
  if (modalBackdrop.style.display === "flex" && modalTitle.textContent.startsWith("🪵")) {
    closeModal(true);
    return;
  }
  modalTitle.textContent = "🪵 Строительство из физических досок и гвоздей";
  modalSubtitle.textContent = "Все готовые постройки убраны — стройте собственные конструкции из досок с физикой и гвоздей!";
  modalBody.innerHTML = `
    <div class="card-item">
      <div>
        <div class="card-title">🪵 1. Установка досок с физикой (В наличии: <span style="color:#ffd54f">${state.inv.plank || 0} шт.</span>)</div>
        <div class="card-desc">Возьмите <b>Доску [2]</b> в руку и нажмите <b>ЛКМ</b> (или <b>[E]</b>), чтобы поставить её. Клавиша <b>[R]</b> поворачивает доску перед установкой.</div>
      </div>
      <button class="card-btn" id="modal-take-plank">🖐️ Взять Доску в руку [2]</button>
    </div>
    <div class="card-item">
      <div>
        <div class="card-title">✋ 2. Перемещение и вращение пустой рукой [1]</div>
        <div class="card-desc">Держа <b>Пустую руку [1]</b>, удерживайте <b>ЛКМ</b> на доске, чтобы переносить её. Удерживая <b>ЛКМ + R</b> (или <b>Q / E / ПКМ / Shift</b>), вращайте доску или сбитую конструкцию!</div>
      </div>
      <button class="card-btn" id="modal-take-hand">✋ Взять Пустую руку [1]</button>
    </div>
    <div class="card-item">
      <div>
        <div class="card-title">🔩 3. Установка гвоздей в любое место доски (В наличии: <span style="color:#ffd54f">${state.inv.nails || 0} шт.</span>)</div>
        <div class="card-desc">Возьмите <b>Гвозди [3]</b>, наведите прицел на любое место доски и нажмите <b>ЛКМ</b> — гвоздь частично погрузится в доску (на 25%).</div>
      </div>
      <button class="card-btn" id="modal-take-nails">🔩 Взять Гвозди в руку [3]</button>
    </div>
    <div class="card-item">
      <div>
        <div class="card-title">🔨 4. Забивание гвоздя и параллельное склеивание [4]</div>
        <div class="card-desc">Возьмите <b>Молоток [4]</b> и нажимайте <b>ЛКМ</b> по гвоздю, забивая его всё глубже (25% → 50% → 75% → 100%). Если две доски лежат друг на друге и гвоздь забит до конца в месте их пересечения — доски станут параллельно друг другу относительно шляпки гвоздя и склеятся!</div>
      </div>
      <button class="card-btn" id="modal-take-hammer">🔨 Взять Молоток в руку [4]</button>
    </div>
    <div class="card-item" style="grid-column:1/-1;">
      <div>
        <div class="card-title">📦 Пополнить запас досок и гвоздей</div>
        <div class="card-desc">Доски пилятся из брёвен в Крафте [C], продаются в Магазине или берутся бесплатным набором здесь:</div>
      </div>
      <button class="card-btn" id="modal-free-kit" style="background:#ef6c00;">🎁 Взять +20 Досок и +30 Гвоздей</button>
    </div>
  `;
  modalBody.querySelector("#modal-take-plank").addEventListener("click", () => {
    selectHeldItem("plank");
    closeModal(true);
  });
  modalBody.querySelector("#modal-take-hand").addEventListener("click", () => {
    selectHeldItem("hand");
    closeModal(true);
  });
  modalBody.querySelector("#modal-take-nails").addEventListener("click", () => {
    selectHeldItem("nails");
    closeModal(true);
  });
  modalBody.querySelector("#modal-take-hammer").addEventListener("click", () => {
    selectHeldItem("hammer");
    closeModal(true);
  });
  modalBody.querySelector("#modal-free-kit").addEventListener("click", () => {
    state.inv.plank = (state.inv.plank || 0) + 20;
    state.inv.nails = (state.inv.nails || 0) + 30;
    playSfx("build");
    showToast("🪵 Получено +20 досок и +30 гвоздей!");
    updateHudUI();
    saveLocalProfile();
    openBuildModal();
  });
  if (document.pointerLockElement) document.exitPointerLock();
  modalBackdrop.style.display = "flex";
}

function openShopModal() {
  modalTitle.textContent = `🏪 Магазин «Сельпо» (Баланс: ${state.money} ₽)`;
  modalSubtitle.textContent = "Покупка семян для огорода, горячей еды и готовых стройматериалов:";
  modalBody.innerHTML = "";
  SHOP_GOODS.forEach((g) => {
    const can = state.money >= g.price;
    const card = document.createElement("div");
    card.className = "card-item";
    card.innerHTML = `
      <div><div class="card-title">${g.title}</div><div class="card-desc">${g.desc}</div></div>
      <div class="card-cost">Цена: ${g.price} ₽</div>
      <button class="card-btn" ${can ? "" : "disabled"}>Купить за ${g.price} ₽</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      if (state.money < g.price) return;
      state.money -= g.price;
      for (const [k, v] of Object.entries(g.out)) state.inv[k] = (state.inv[k] || 0) + v;
      playSfx("coin");
      showToast(`🛒 Куплено: ${g.title}`);
      updateHudUI();
      saveLocalProfile();
      openShopModal();
    });
    modalBody.appendChild(card);
  });
  if (document.pointerLockElement) document.exitPointerLock();
  modalBackdrop.style.display = "flex";
}

function openBazaarModal() {
  modalTitle.textContent = `⚖️ Дачный Базар • Скупка (Баланс: ${state.money} ₽)`;
  modalSubtitle.textContent = "Продавайте лесные ягоды, древесину, урожай с огорода и домашние заготовки, чтобы покупать соседние участки:";
  modalBody.innerHTML = "";
  BAZAAR_PRICES.forEach((entry) => {
    const info = ITEMS[entry.item];
    const count = state.inv[entry.item] || 0;
    const card = document.createElement("div");
    card.className = "card-item";
    card.innerHTML = `
      <div><div class="card-title">${info.icon} ${info.name} (В наличии: ${count})</div><div class="card-desc">${entry.desc}</div></div>
      <div class="card-cost">Скупочная цена: ${entry.price} ₽ / шт.</div>
      <div style="display:flex;gap:6px;">
        <button class="card-btn btn-sell-one" style="flex:1;" ${count >= 1 ? "" : "disabled"}>Продать 1 (+${entry.price} ₽)</button>
        <button class="card-btn btn-sell-all" style="flex:1;background:#ef6c00;" ${count >= 1 ? "" : "disabled"}>Все (+${count * entry.price} ₽)</button>
      </div>
    `;
    card.querySelector(".btn-sell-one").addEventListener("click", () => {
      if ((state.inv[entry.item] || 0) < 1) return;
      state.inv[entry.item]--;
      state.money += entry.price;
      playSfx("coin");
      showToast(`💰 Продано: 1x ${info.name} (+${entry.price} ₽)`);
      updateHudUI();
      saveLocalProfile();
      openBazaarModal();
    });
    card.querySelector(".btn-sell-all").addEventListener("click", () => {
      const c = state.inv[entry.item] || 0;
      if (c < 1) return;
      const sum = c * entry.price;
      state.inv[entry.item] = 0;
      state.money += sum;
      playSfx("coin");
      showToast(`💰 Продано всё (${c}x ${info.name}) за ${sum} ₽!`);
      updateHudUI();
      saveLocalProfile();
      openBazaarModal();
    });
    modalBody.appendChild(card);
  });
  if (document.pointerLockElement) document.exitPointerLock();
  modalBackdrop.style.display = "flex";
}

function openGardenPlantModal(struct) {
  modalTitle.textContent = struct.type === "greenhouse" ? "🏡 Посадка в теплице" : "🌱 Посадка на грядке";
  modalSubtitle.textContent = "Выберите культуру для посадки (семена продаются в Магазине «Сельпо»):";
  modalBody.innerHTML = "";
  Object.values(CROPS).forEach((crop) => {
    const have = state.inv[crop.seedItem] || 0;
    const card = document.createElement("div");
    card.className = "card-item";
    card.innerHTML = `
      <div><div class="card-title">${ITEMS[crop.produceItem].icon} ${crop.name}</div><div class="card-desc">Созревание: ~${crop.growSeconds} сек. Урожай: ${crop.yieldCount} шт.</div></div>
      <div class="card-cost">Семена в наличии: ${have} шт.</div>
      <button class="card-btn" ${have > 0 ? "" : "disabled"}>Посадить ${crop.name}</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      if ((state.inv[crop.seedItem] || 0) < 1) return;
      state.inv[crop.seedItem]--;
      struct.crop = crop.id;
      struct.plantedAt = Date.now();
      struct.watered = state.tools.watering_can;
      playSfx("pick");
      showToast(`🌱 Вы посадили «${crop.name}»!`);
      broadcastNetworkPacket({ type: "crop_updated", id: struct.id, crop: struct.crop, plantedAt: struct.plantedAt, watered: struct.watered }, true);
      updateHudUI();
      saveLocalProfile();
      closeModal();
    });
    modalBody.appendChild(card);
  });
  if (document.pointerLockElement) document.exitPointerLock();
  modalBackdrop.style.display = "flex";
}

function openGardenCareModal(struct) {
  const cInfo = CROPS[struct.crop];
  modalTitle.textContent = `🌱 Уход за грядкой: ${cInfo?.name || ""}`;
  modalSubtitle.textContent = "Ускорьте созревание урожая поливом или био-удобрением:";
  modalBody.innerHTML = "";

  const waterCard = document.createElement("div");
  waterCard.className = "card-item";
  waterCard.innerHTML = `
    <div><div class="card-title">💧 Полить грядку водой</div><div class="card-desc">Увлажняет почву и ускоряет рост растений почти в 2 раза.</div></div>
    <div class="card-cost">${struct.watered ? "✅ Грядка уже полита" : "Бесплатно"}</div>
    <button class="card-btn" ${struct.watered ? "disabled" : ""}>Полить грядку</button>
  `;
  waterCard.querySelector("button").addEventListener("click", () => {
    struct.watered = true;
    playSfx("pick");
    showToast("💧 Грядка полита! Рост ускорен.");
    broadcastNetworkPacket({ type: "crop_updated", id: struct.id, crop: struct.crop, plantedAt: struct.plantedAt, watered: true }, true);
    closeModal();
  });
  modalBody.appendChild(waterCard);

  const fertCount = state.inv.fertilizer || 0;
  const fertCard = document.createElement("div");
  fertCard.className = "card-item";
  fertCard.innerHTML = `
    <div><div class="card-title">🧪 Внести удобрение (В наличии: ${fertCount})</div><div class="card-desc">Мгновенно созревает урожай на 100%!</div></div>
    <div class="card-cost">Требуется: 1 Удобрение</div>
    <button class="card-btn" ${fertCount > 0 ? "" : "disabled"}>Удобрить сейчас</button>
  `;
  fertCard.querySelector("button").addEventListener("click", () => {
    if ((state.inv.fertilizer || 0) < 1) return;
    state.inv.fertilizer--;
    struct.plantedAt = Date.now() - 120_000;
    struct.watered = true;
    playSfx("build");
    showToast("✨ Урожай мгновенно созрел благодаря удобрению!");
    broadcastNetworkPacket({ type: "crop_updated", id: struct.id, crop: struct.crop, plantedAt: struct.plantedAt, watered: true }, true);
    updateHudUI();
    saveLocalProfile();
    closeModal();
  });
  modalBody.appendChild(fertCard);
  if (document.pointerLockElement) document.exitPointerLock();
  modalBackdrop.style.display = "flex";
}

// ==========================================
// ФИЗИКА ДОСОК, ГВОЗДИ, МОЛОТОК, ЗАХВАТ РУКОЙ И ПРИВЯЗКА К НИКУ
// ==========================================
const buildBanner = document.getElementById("build-banner");
const buildSelectedName = document.getElementById("build-selected-name");
const centerRaycaster = new THREE.Raycaster();
const centerScreenPt = new THREE.Vector2(0, 0);



function exitBuildMode() {
  state.buildMode = null;
  if (buildBanner) buildBanner.style.display = "none";
  buildGhostGroup.visible = false;
}

function spawnOrUpdatePlankMesh(plank) {
  if (!plank || !plank.id) return;
  let mesh = plankMeshes.get(plank.id);
  if (!mesh) {
    mesh = createPhysicalPlankMesh(plank);
    planksRoot.add(mesh);
    plankMeshes.set(plank.id, mesh);
  } else {
    mesh.position.set(plank.x, plank.y, plank.z);
    mesh.quaternion.set(plank.qx || 0, plank.qy || 0, plank.qz || 0, plank.qw ?? 1);
    rebuildPlankNailsMesh(mesh, plank);
  }
  mesh.updateMatrixWorld(true);
}

function removePlankById(id, broadcast = true) {
  delete state.planks[id];
  const m = plankMeshes.get(id);
  if (m) {
    planksRoot.remove(m);
    plankMeshes.delete(id);
  }
  saveWorldPlanks();
  if (broadcast) {
    broadcastNetworkPacket({ type: "plank_removed", id }, true);
  }
}

function removeObjectsByOwner(ownerName, ownerKey, broadcast = true) {
  const normName = String(ownerName || "").trim().toLowerCase();
  for (const [pid, pl] of Object.entries(state.planks)) {
    const pName = String(pl.ownerName || "").trim().toLowerCase();
    if ((normName && pName === normName) || (ownerKey && pl.ownerKey === ownerKey)) {
      delete state.planks[pid];
      const m = plankMeshes.get(pid);
      if (m) {
        planksRoot.remove(m);
        plankMeshes.delete(pid);
      }
    }
  }
  for (const [plotId, plotData] of Object.entries(state.plots)) {
    const pName = String(plotData.ownerName || "").trim().toLowerCase();
    if ((normName && pName === normName) || (ownerKey && plotData.ownerKey === ownerKey)) {
      delete state.plots[plotId];
    }
  }
  refreshAllPlotSigns();
  saveWorldPlanks();
  saveLocalProfile();
  if (broadcast) {
    broadcastNetworkPacket({ type: "clear_owner_objects", ownerName, ownerKey }, true);
  }
}

function getAllPlankBoardMeshes() {
  const arr = [];
  for (const m of plankMeshes.values()) {
    if (m.userData && m.userData.boardMesh) arr.push(m.userData.boardMesh);
  }
  return arr;
}

function raycastPlankSurface(maxDist = 6.2) {
  centerRaycaster.setFromCamera(centerScreenPt, camera);
  centerRaycaster.far = maxDist;
  const boards = getAllPlankBoardMeshes();
  if (boards.length === 0) return null;
  const hits = centerRaycaster.intersectObjects(boards, false);
  if (hits.length === 0) return null;
  const hit = hits[0];
  const plankId = hit.object.userData.plankId;
  const plank = state.planks[plankId];
  const meshGroup = plankMeshes.get(plankId);
  if (!plank || !meshGroup) return null;

  meshGroup.updateMatrixWorld(true);
  const localPoint = meshGroup.worldToLocal(hit.point.clone());
  const localNormal = hit.face ? hit.face.normal.clone().normalize() : new THREE.Vector3(0, 1, 0);
  const worldNormal = localNormal.clone().transformDirection(meshGroup.matrixWorld).normalize();

  return {
    plank,
    meshGroup,
    point: hit.point.clone(),
    distance: hit.distance,
    localPoint,
    localNormal,
    worldNormal
  };
}

function findNailForHammer(maxDist = 6.0) {
  centerRaycaster.setFromCamera(centerScreenPt, camera);
  centerRaycaster.far = maxDist;

  // 1. Проверка прямого попадания луча в хитбокс гвоздя
  const nailHitboxes = [];
  for (const m of plankMeshes.values()) {
    if (m.userData.nailsHolder) {
      m.userData.nailsHolder.traverse((c) => {
        if (c.userData && c.userData.isNailHitbox) nailHitboxes.push(c);
      });
    }
  }
  if (nailHitboxes.length > 0) {
    const nHits = centerRaycaster.intersectObjects(nailHitboxes, false);
    for (const h of nHits) {
      const pId = h.object.userData.plankId;
      const nId = h.object.userData.nailId;
      const plank = state.planks[pId];
      if (plank && Array.isArray(plank.nails)) {
        const nail = plank.nails.find((n) => n.id === nId);
        if (nail) return { plank, nail, meshGroup: plankMeshes.get(pId) };
      }
    }
  }

  // 2. Поиск ближайшего гвоздя вокруг точки прицела на доске (в радиусе 0.55 м)
  const surf = raycastPlankSurface(maxDist);
  if (surf) {
    let best = null;
    let bestDist = 0.55;
    for (const plank of Object.values(state.planks)) {
      if (!Array.isArray(plank.nails) || plank.nails.length === 0) continue;
      const mg = plankMeshes.get(plank.id);
      if (!mg) continue;
      mg.updateMatrixWorld(true);
      for (const nail of plank.nails) {
        const nw = new THREE.Vector3(nail.lx, nail.ly, nail.lz).applyMatrix4(mg.matrixWorld);
        const d = nw.distanceTo(surf.point) - (nail.depth < 1.0 ? 0.08 : 0);
        if (d < bestDist) {
          bestDist = d;
          best = { plank, nail, meshGroup: mg };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function getPlankSpawnTransform() {
  const surf = raycastPlankSurface(5.2);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, state.camYaw + state.plankSpawnYaw, 0, "YXZ"));
  if (surf) {
    const pos = surf.point.clone().addScaledVector(surf.worldNormal, 0.075);
    return { x: pos.x, y: pos.y, z: pos.z, q };
  }
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  const dist = 3.2;
  const px = camPos.x + dir.x * dist;
  const pz = camPos.z + dir.z * dist;
  const groundY = getTerrainHeight(px, pz);
  const py = Math.max(groundY + 0.14, camPos.y + dir.y * dist);
  return { x: px, y: py, z: pz, q };
}

function placePhysicalPlankAction() {
  if ((state.inv.plank || 0) <= 0) {
    showToast("❌ У вас закончились доски! Возьмите их в меню [B] или распилите брёвна в Крафте [C].");
    return;
  }
  const tr = getPlankSpawnTransform();
  const plot = findPlotAt(tr.x, tr.z);
  if (plot) {
    const owner = state.plots[plot.plotId];
    if (owner && owner.ownerKey !== state.playerKey && owner.ownerName !== state.name) {
      showToast(`⚠️ Нельзя ставить доски на чужом участке (${owner.ownerName})!`);
      return;
    }
  }
  state.inv.plank--;
  const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const plank = {
    id,
    w: 2.4,
    h: 0.12,
    d: 0.36,
    x: +tr.x.toFixed(3),
    y: +tr.y.toFixed(3),
    z: +tr.z.toFixed(3),
    qx: +tr.q.x.toFixed(5),
    qy: +tr.q.y.toFixed(5),
    qz: +tr.q.z.toFixed(5),
    qw: +tr.q.w.toFixed(5),
    vx: 0,
    vy: 0,
    vz: 0,
    groupId: `grp_${id}`,
    ownerName: state.name,
    ownerKey: state.playerKey,
    nails: []
  };
  state.planks[id] = plank;
  spawnOrUpdatePlankMesh(plank);
  state.workTimer = 0.32;
  playSfx("build");
  showToast(`🪵 Доска установлена (привязана к нику ${state.name})!`);
  saveWorldPlanks();
  saveLocalProfile();
  updateHudUI();
  broadcastNetworkPacket({ type: "plank_placed", plank }, true);
}

function placeNailAtCrosshairAction() {
  if ((state.inv.nails || 0) <= 0) {
    showToast("❌ Нет гвоздей! Выкуйте в Крафте [C], купите в Магазине или возьмите в меню [B].");
    return;
  }
  const surf = raycastPlankSurface(5.8);
  if (!surf) {
    showToast("🔩 Наведите прицел на любое место доски и нажмите ЛКМ, чтобы поставить гвоздь!");
    return;
  }
  state.inv.nails--;
  const plank = surf.plank;
  if (!Array.isArray(plank.nails)) plank.nails = [];
  const nail = {
    id: `nl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    lx: +surf.localPoint.x.toFixed(4),
    ly: +surf.localPoint.y.toFixed(4),
    lz: +surf.localPoint.z.toFixed(4),
    nx: +surf.localNormal.x.toFixed(4),
    ny: +surf.localNormal.y.toFixed(4),
    nz: +surf.localNormal.z.toFixed(4),
    depth: 0.25,
    weldedToPlankId: null
  };
  plank.nails.push(nail);
  spawnOrUpdatePlankMesh(plank);
  state.workTimer = 0.32;
  playSfx("pick");
  showToast("🔩 Гвоздь установлен в доску (погружён на 25%). Забейте его Молотком [4]!");
  saveWorldPlanks();
  saveLocalProfile();
  updateHudUI();
  broadcastNetworkPacket({ type: "plank_updated", plank }, true);
}

// Выравнивание двух пересекающихся досок параллельно друг другу относительно шляпки гвоздя и склеивание
function checkAndWeldOverlappingPlanksAtNail(plankA, nail) {
  const meshA = plankMeshes.get(plankA.id);
  if (!meshA) return false;
  meshA.updateMatrixWorld(true);

  const nailWorldPos = new THREE.Vector3(nail.lx, nail.ly, nail.lz).applyMatrix4(meshA.matrixWorld);
  const nailNormalWorld = new THREE.Vector3(nail.nx, nail.ny, nail.nz)
    .transformDirection(meshA.matrixWorld)
    .normalize();

  // Ищем вторую доску в месте пересечения со стержнем гвоздя
  let targetPlankB = null;
  let bestDist = Infinity;

  for (const plankB of Object.values(state.planks)) {
    if (plankB.id === plankA.id) continue;
    const meshB = plankMeshes.get(plankB.id);
    if (!meshB) continue;
    meshB.updateMatrixWorld(true);

    // Проверяем точки вдоль стержня гвоздя (под шляпкой и сквозь обе доски)
    for (const t of [-0.08, 0.0, 0.06, 0.12, 0.18, 0.25, 0.32]) {
      const sampleWorld = nailWorldPos.clone().addScaledVector(nailNormalWorld, -t);
      const localInB = meshB.worldToLocal(sampleWorld);
      const insideX = Math.abs(localInB.x) <= (plankB.w || 2.4) / 2 + 0.16;
      const insideY = Math.abs(localInB.y) <= (plankB.h || 0.12) / 2 + 0.24;
      const insideZ = Math.abs(localInB.z) <= (plankB.d || 0.36) / 2 + 0.16;
      if (insideX && insideY && insideZ) {
        const d = Math.abs(localInB.y);
        if (d < bestDist) {
          bestDist = d;
          targetPlankB = plankB;
        }
      }
    }
  }

  if (!targetPlankB) return false;

  const meshB = plankMeshes.get(targetPlankB.id);
  meshB.updateMatrixWorld(true);

  // Определяем плоскость выравнивания параллельно друг другу относительно шляпки гвоздя:
  const qA = new THREE.Quaternion(plankA.qx || 0, plankA.qy || 0, plankA.qz || 0, plankA.qw ?? 1);
  const qB = new THREE.Quaternion(targetPlankB.qx || 0, targetPlankB.qy || 0, targetPlankB.qz || 0, targetPlankB.qw ?? 1);

  const upB = new THREE.Vector3(0, 1, 0).applyQuaternion(qB).normalize();
  const refNormal = upB.dot(nailNormalWorld) >= 0 ? upB.clone() : upB.clone().negate();

  // Вращаем доску A (и привязанные к ней доски) вокруг точки шляпки гвоздя так,
  // чтобы нормаль под шляпкой гвоздя совпала с нормалью доски B -> обе доски становятся строго параллельны!
  const alignQuat = new THREE.Quaternion().setFromUnitVectors(nailNormalWorld, refNormal);

  const oldGroupA = plankA.groupId;
  const newGroupId = targetPlankB.groupId || `grp_${targetPlankB.id}`;
  targetPlankB.groupId = newGroupId;

  const groupAMembers = Object.values(state.planks).filter((p) => p.groupId === oldGroupA);
  for (const mPlank of groupAMembers) {
    const mQuat = new THREE.Quaternion(mPlank.qx || 0, mPlank.qy || 0, mPlank.qz || 0, mPlank.qw ?? 1);
    mQuat.premultiply(alignQuat).normalize();
    mPlank.qx = +mQuat.x.toFixed(5);
    mPlank.qy = +mQuat.y.toFixed(5);
    mPlank.qz = +mQuat.z.toFixed(5);
    mPlank.qw = +mQuat.w.toFixed(5);

    const relPos = new THREE.Vector3(mPlank.x, mPlank.y, mPlank.z).sub(nailWorldPos);
    relPos.applyQuaternion(alignQuat);
    const newPos = nailWorldPos.clone().add(relPos);
    mPlank.x = +newPos.x.toFixed(3);
    mPlank.y = +newPos.y.toFixed(3);
    mPlank.z = +newPos.z.toFixed(3);
  }

  // Плотно прижимаем параллельные доски друг к другу под шляпкой гвоздя без зазора
  const centerB = new THREE.Vector3(targetPlankB.x, targetPlankB.y, targetPlankB.z);
  const centerA = new THREE.Vector3(plankA.x, plankA.y, plankA.z);
  const currentSep = centerA.clone().sub(centerB).dot(refNormal);
  const desiredSep = ((plankA.h || 0.12) + (targetPlankB.h || 0.12)) / 2;
  const shiftAlongNormal = desiredSep - currentSep;

  for (const mPlank of groupAMembers) {
    mPlank.x = +(mPlank.x + refNormal.x * shiftAlongNormal).toFixed(3);
    mPlank.y = +(mPlank.y + refNormal.y * shiftAlongNormal).toFixed(3);
    mPlank.z = +(mPlank.z + refNormal.z * shiftAlongNormal).toFixed(3);
    mPlank.vx = 0;
    mPlank.vy = 0;
    mPlank.vz = 0;
    mPlank.groupId = newGroupId;
    spawnOrUpdatePlankMesh(mPlank);
  }

  targetPlankB.vx = 0;
  targetPlankB.vy = 0;
  targetPlankB.vz = 0;
  nail.weldedToPlankId = targetPlankB.id;
  spawnOrUpdatePlankMesh(targetPlankB);

  const syncedGroup = Object.values(state.planks).filter((p) => p.groupId === newGroupId);
  broadcastNetworkPacket({ type: "planks_batch", planks: syncedGroup }, true);
  return true;
}

function hammerNailAtCrosshairAction() {
  const target = findNailForHammer(6.0);
  if (!target) {
    state.workTimer = 0.35;
    playSfx("chop");
    showToast("🔨 Наведите прицел на гвоздь в доске и нажмите ЛКМ, чтобы забить его глубже!");
    return;
  }
  const { plank, nail } = target;
  state.workTimer = 0.38;
  playSfx("chop");

  if (nail.depth >= 1.0) {
    const welded = checkAndWeldOverlappingPlanksAtNail(plank, nail);
    if (welded) {
      playSfx("build");
      showToast("🔩🔨 Доски выровнены параллельно относительно шляпки гвоздя и намертво склеены!");
      saveWorldPlanks();
    } else {
      showToast("✅ Этот гвоздь уже полностью забит в доску!");
    }
    return;
  }

  nail.depth = Math.min(1.0, +(nail.depth + 0.25).toFixed(2));
  spawnOrUpdatePlankMesh(plank);

  if (nail.depth >= 1.0) {
    const welded = checkAndWeldOverlappingPlanksAtNail(plank, nail);
    if (welded) {
      playSfx("build");
      showToast("🔩🔨 Гвоздь забит до конца! Доски стали параллельно друг другу относительно шляпки и склеились!");
    } else {
      showToast("🔨 Гвоздь забит до шляпки (100%)!");
    }
  } else {
    showToast(`🔨 Гвоздь забит глубже в доску (${Math.round(nail.depth * 100)}%)!`);
  }

  saveWorldPlanks();
  broadcastNetworkPacket({ type: "plank_updated", plank }, true);
}

// ==========================================
// ЗАХВАТ И ВРАЩЕНИЕ ДОСОК ПУСТОЙ РУКОЙ (УДЕРЖАНИЕ ЛКМ + ВРАЩЕНИЕ)
// ==========================================
const grabState = {
  active: false,
  groupId: null,
  distance: 3.2,
  pivotPos: new THREE.Vector3(),
  deltaRot: new THREE.Quaternion(),
  members: []
};
let leftMouseDown = false;
let rightMouseDown = false;

function isGrabRotationHeld() {
  return (
    rightMouseDown ||
    Boolean(
      keys["KeyR"] ||
      keys["KeyQ"] ||
      keys["KeyE"] ||
      keys["KeyF"] ||
      keys["KeyZ"] ||
      keys["KeyX"] ||
      keys["ShiftLeft"] ||
      keys["ShiftRight"] ||
      keys["AltLeft"]
    )
  );
}

function tryStartHandGrab() {
  if (state.heldItem !== "hand") return false;
  const surf = raycastPlankSurface(6.5);
  if (!surf) return false;

  const hitPlank = surf.plank;
  const grpId = hitPlank.groupId || `grp_${hitPlank.id}`;
  hitPlank.groupId = grpId;
  const members = Object.values(state.planks).filter((p) => (p.groupId || `grp_${p.id}`) === grpId);
  if (members.length === 0) return false;

  const center = new THREE.Vector3();
  for (const p of members) center.add(new THREE.Vector3(p.x, p.y, p.z));
  center.divideScalar(members.length);

  grabState.active = true;
  grabState.groupId = grpId;
  grabState.distance = Math.max(1.8, Math.min(6.2, surf.distance));
  grabState.pivotPos.copy(center);
  grabState.deltaRot.identity();
  grabState.members = members.map((p) => ({
    id: p.id,
    relPos: new THREE.Vector3(p.x, p.y, p.z).sub(center),
    initQuat: new THREE.Quaternion(p.qx || 0, p.qy || 0, p.qz || 0, p.qw ?? 1)
  }));
  return true;
}

function updateHandGrab(dt) {
  if (!grabState.active) return;
  if (state.heldItem !== "hand" || !leftMouseDown) {
    endHandGrab();
    return;
  }

  // Вращение предмета кнопками R, Q, E (при удержании ЛКМ) без участия мыши вообще:
  const rotSpeed = 1.85 * dt;
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  camRight.y = 0;
  if (camRight.lengthSq() > 1e-4) camRight.normalize(); else camRight.set(1, 0, 0);
  const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  camFwd.y = 0;
  if (camFwd.lengthSq() > 1e-4) camFwd.normalize(); else camFwd.set(0, 0, -1);

  if (keys["KeyR"]) {
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotSpeed);
    grabState.deltaRot.premultiply(qYaw).normalize();
  }
  if (keys["KeyE"]) {
    const qPitch = new THREE.Quaternion().setFromAxisAngle(camRight, rotSpeed);
    grabState.deltaRot.premultiply(qPitch).normalize();
  }
  if (keys["KeyQ"]) {
    const qRoll = new THREE.Quaternion().setFromAxisAngle(camFwd, rotSpeed);
    grabState.deltaRot.premultiply(qRoll).normalize();
  }

  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(camDir);

  const targetCenter = camPos.addScaledVector(camDir, grabState.distance);

  // Не даём опустить конструкцию под землю
  let minLift = 0;
  for (const m of grabState.members) {
    const pl = state.planks[m.id];
    if (!pl) continue;
    const newPos = targetCenter.clone().add(m.relPos.clone().applyQuaternion(grabState.deltaRot));
    const gY = getTerrainHeight(newPos.x, newPos.z) + 0.07;
    if (newPos.y < gY) {
      minLift = Math.max(minLift, gY - newPos.y);
    }
  }
  targetCenter.y += minLift;

  for (const m of grabState.members) {
    const pl = state.planks[m.id];
    if (!pl) continue;
    const prevX = pl.x;
    const prevY = pl.y;
    const prevZ = pl.z;
    const newPos = targetCenter.clone().add(m.relPos.clone().applyQuaternion(grabState.deltaRot));
    const newQuat = grabState.deltaRot.clone().multiply(m.initQuat).normalize();
    pl.x = +newPos.x.toFixed(3);
    pl.y = +newPos.y.toFixed(3);
    pl.z = +newPos.z.toFixed(3);
    pl.qx = +newQuat.x.toFixed(5);
    pl.qy = +newQuat.y.toFixed(5);
    pl.qz = +newQuat.z.toFixed(5);
    pl.qw = +newQuat.w.toFixed(5);
    pl.vx = Math.max(-8, Math.min(8, +((pl.x - prevX) / Math.max(0.01, dt) * 0.35).toFixed(3)));
    pl.vy = Math.max(-8, Math.min(8, +((pl.y - prevY) / Math.max(0.01, dt) * 0.35).toFixed(3)));
    pl.vz = Math.max(-8, Math.min(8, +((pl.z - prevZ) / Math.max(0.01, dt) * 0.35).toFixed(3)));
    pl.wx = 0;
    pl.wy = 0;
    pl.wz = 0;
    const mesh = plankMeshes.get(pl.id);
    if (mesh) {
      mesh.position.set(pl.x, pl.y, pl.z);
      mesh.quaternion.set(pl.qx, pl.qy, pl.qz, pl.qw);
      mesh.updateMatrixWorld(true);
    }
  }
}

function endHandGrab() {
  if (!grabState.active) return;
  const grpId = grabState.groupId;
  grabState.active = false;
  grabState.groupId = null;
  const updated = Object.values(state.planks).filter((p) => p.groupId === grpId);
  saveWorldPlanks();
  if (updated.length > 0) {
    broadcastNetworkPacket({ type: "planks_batch", planks: updated }, true);
  }
}

// ==========================================
// РЕАЛИСТИЧНАЯ 3D-ФИЗИКА ДОСОК (OBB SAT-КОЛЛИЗИИ, ИМПУЛЬСЫ, КРУТЯЩИЙ МОМЕНТ И ОПРОКИДЫВАНИЕ)
// ==========================================
function buildPlankOBB(pl) {
  const q = new THREE.Quaternion(pl.qx || 0, pl.qy || 0, pl.qz || 0, pl.qw ?? 1).normalize();
  const u0 = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const u1 = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const u2 = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const e0 = (pl.w || 2.4) / 2;
  const e1 = (pl.h || 0.12) / 2;
  const e2 = (pl.d || 0.36) / 2;
  const center = new THREE.Vector3(pl.x, pl.y, pl.z);

  const corners = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(
          center
            .clone()
            .addScaledVector(u0, sx * e0)
            .addScaledVector(u1, sy * e1)
            .addScaledVector(u2, sz * e2)
        );
      }
    }
  }
  // Дополнительные точки вдоль длинных рёбер для точного контакта при перекрещивании досок
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      corners.push(center.clone().addScaledVector(u1, sy * e1).addScaledVector(u2, sz * e2));
      corners.push(center.clone().addScaledVector(u0, 0.5 * e0).addScaledVector(u1, sy * e1).addScaledVector(u2, sz * e2));
      corners.push(center.clone().addScaledVector(u0, -0.5 * e0).addScaledVector(u1, sy * e1).addScaledVector(u2, sz * e2));
    }
  }

  return { pl, q, center, axes: [u0, u1, u2], half: [e0, e1, e2], corners };
}

function projectOBBOnAxis(obb, axis) {
  const cProj = obb.center.dot(axis);
  const r =
    obb.half[0] * Math.abs(obb.axes[0].dot(axis)) +
    obb.half[1] * Math.abs(obb.axes[1].dot(axis)) +
    obb.half[2] * Math.abs(obb.axes[2].dot(axis));
  return { min: cProj - r, max: cProj + r, r };
}

function pointInsideOBBMargin(pt, obb, margin = 0.03) {
  const d = pt.clone().sub(obb.center);
  return (
    Math.abs(d.dot(obb.axes[0])) <= obb.half[0] + margin &&
    Math.abs(d.dot(obb.axes[1])) <= obb.half[1] + margin &&
    Math.abs(d.dot(obb.axes[2])) <= obb.half[2] + margin
  );
}

function clampPointToOBB(pt, obb) {
  const d = pt.clone().sub(obb.center);
  const out = obb.center.clone();
  for (let i = 0; i < 3; i++) {
    const c = Math.max(-obb.half[i], Math.min(obb.half[i], d.dot(obb.axes[i])));
    out.addScaledVector(obb.axes[i], c);
  }
  return out;
}

// Полный 15-осевой SAT-тест столкновения двух 3D-досок (OBB vs OBB)
function testOBBCollision(obbA, obbB) {
  const diff = obbA.center.clone().sub(obbB.center);
  if (diff.lengthSq() > 26.0) return null;

  let minOverlap = Infinity;
  let bestAxis = null;

  const candidateAxes = [
    obbA.axes[0],
    obbA.axes[1],
    obbA.axes[2],
    obbB.axes[0],
    obbB.axes[1],
    obbB.axes[2]
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const cross = new THREE.Vector3().crossVectors(obbA.axes[i], obbB.axes[j]);
      if (cross.lengthSq() > 1e-5) {
        candidateAxes.push(cross.normalize());
      }
    }
  }

  for (const ax of candidateAxes) {
    const pA = projectOBBOnAxis(obbA, ax);
    const pB = projectOBBOnAxis(obbB, ax);
    const overlap = Math.min(pA.max, pB.max) - Math.max(pA.min, pB.min);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      bestAxis = ax.clone();
    }
  }

  if (!bestAxis) return null;
  if (diff.dot(bestAxis) < 0) bestAxis.negate(); // Нормаль от B к A

  // Находим реальные точки контакта между досками (для расчёта плеча силы и опрокидывания)
  const contactPts = [];
  for (const c of obbA.corners) {
    if (pointInsideOBBMargin(c, obbB, 0.04)) contactPts.push(c);
  }
  for (const c of obbB.corners) {
    if (pointInsideOBBMargin(c, obbA, 0.04)) contactPts.push(c);
  }

  const contactPoint = new THREE.Vector3();
  if (contactPts.length > 0) {
    for (const p of contactPts) contactPoint.add(p);
    contactPoint.divideScalar(contactPts.length);
  } else {
    const pOnB = clampPointToOBB(obbA.center, obbB);
    const pOnA = clampPointToOBB(pOnB, obbA);
    contactPoint.addVectors(pOnA, pOnB).multiplyScalar(0.5);
  }

  return {
    normal: bestAxis, // направлена от B к A
    depth: minOverlap,
    point: contactPoint
  };
}

function applyBodyRotationDelta(body, angDelta) {
  const len = angDelta.length();
  if (len < 1e-6) return;
  const maxStep = 0.35;
  const axis = angDelta.clone().normalize();
  const angle = Math.min(len, maxStep);
  const dq = new THREE.Quaternion().setFromAxisAngle(axis, angle);

  for (const pl of body.members) {
    const rel = new THREE.Vector3(pl.x, pl.y, pl.z).sub(body.com);
    rel.applyQuaternion(dq);
    pl.x = body.com.x + rel.x;
    pl.y = body.com.y + rel.y;
    pl.z = body.com.z + rel.z;

    const q = new THREE.Quaternion(pl.qx || 0, pl.qy || 0, pl.qz || 0, pl.qw ?? 1);
    q.premultiply(dq).normalize();
    pl.qx = q.x;
    pl.qy = q.y;
    pl.qz = q.z;
    pl.qw = q.w;
  }
}

function translateBody(body, delta) {
  body.com.add(delta);
  for (const pl of body.members) {
    pl.x += delta.x;
    pl.y += delta.y;
    pl.z += delta.z;
  }
}

let physicsSaveTimer = 0;

function stepPlanksPhysics(dt) {
  const plankList = Object.values(state.planks);
  if (plankList.length === 0) return;

  const subSteps = 2;
  const subDt = dt / subSteps;

  for (let step = 0; step < subSteps; step++) {
    // 1. Формируем твёрдые тела (Rigid Bodies) по группам склеенных досок
    const groupMap = new Map();
    for (const pl of plankList) {
      const gid = pl.groupId || `grp_${pl.id}`;
      pl.groupId = gid;
      if (!groupMap.has(gid)) groupMap.set(gid, []);
      groupMap.get(gid).push(pl);
    }

    const bodies = new Map();
    for (const [gid, members] of groupMap.entries()) {
      const isGrabbed = grabState.active && grabState.groupId === gid;
      const com = new THREE.Vector3();
      const vel = new THREE.Vector3();
      const angVel = new THREE.Vector3();
      for (const pl of members) {
        com.add(new THREE.Vector3(pl.x, pl.y, pl.z));
        vel.add(new THREE.Vector3(pl.vx || 0, pl.vy || 0, pl.vz || 0));
        angVel.add(new THREE.Vector3(pl.wx || 0, pl.wy || 0, pl.wz || 0));
      }
      com.divideScalar(members.length);
      vel.divideScalar(members.length);
      angVel.divideScalar(members.length);

      const mass = members.length * 1.0;
      const invMass = isGrabbed ? 0 : 1.0 / mass;
      // Эффективный момент инерции доски / сбитой конструкции
      const invInertia = isGrabbed ? 0 : 1.85 / mass;

      bodies.set(gid, {
        gid,
        members,
        isGrabbed,
        com,
        vel,
        angVel,
        invMass,
        invInertia
      });
    }

    // 2. Интеграция внешних сил (гравитация + сопротивление воздуха) и перемещения
    for (const body of bodies.values()) {
      if (body.isGrabbed) continue;
      body.vel.y -= 16.5 * subDt;
      body.vel.multiplyScalar(Math.max(0, 1 - 0.35 * subDt));
      body.angVel.multiplyScalar(Math.max(0, 1 - 0.85 * subDt));

      translateBody(body, body.vel.clone().multiplyScalar(subDt));
      applyBodyRotationDelta(body, body.angVel.clone().multiplyScalar(subDt));
    }

    // 3. Столкновение игрока с досками (игрок может толкать не закреплённые доски ногами/корпусом)
    if (state.started) {
      const playerCenter = new THREE.Vector3(state.x, state.y + 0.55, state.z);
      for (const body of bodies.values()) {
        if (body.isGrabbed) continue;
        for (const pl of body.members) {
          const obb = buildPlankOBB(pl);
          const closest = clampPointToOBB(playerCenter, obb);
          const diff = closest.clone().sub(playerCenter);
          diff.y *= 0.5;
          const dist = diff.length();
          if (dist > 0.001 && dist < 0.42 && closest.y > state.y + 0.18) {
            const pushDir = diff.normalize();
            const pushDepth = 0.42 - dist;
            translateBody(body, pushDir.clone().multiplyScalar(pushDepth * 0.55));
            const r = closest.clone().sub(body.com);
            const impulse = pushDir.clone().multiplyScalar(1.4);
            body.vel.addScaledVector(impulse, body.invMass);
            body.angVel.addScaledVector(new THREE.Vector3().crossVectors(r, impulse), body.invInertia);
          }
        }
      }
    }

    // 4. Коллизии досок друг с другом (OBB vs OBB SAT + импульс + крутящий момент)
    const allPlankOBBs = plankList.map((pl) => buildPlankOBB(pl));
    for (let i = 0; i < allPlankOBBs.length; i++) {
      for (let j = i + 1; j < allPlankOBBs.length; j++) {
        const obbA = allPlankOBBs[i];
        const obbB = allPlankOBBs[j];
        if (obbA.pl.groupId === obbB.pl.groupId) continue;

        const bodyA = bodies.get(obbA.pl.groupId);
        const bodyB = bodies.get(obbB.pl.groupId);
        if (!bodyA || !bodyB) continue;
        if (bodyA.isGrabbed && bodyB.isGrabbed) continue;

        const col = testOBBCollision(obbA, obbB);
        if (!col) continue;

        const n = col.normal;
        const totalInvMass = bodyA.invMass + bodyB.invMass;
        if (totalInvMass <= 0) continue;

        // Позиционное разделение досок без проваливания друг в друга
        const slop = 0.002;
        const corrMag = Math.max(0, col.depth - slop) / totalInvMass * 0.82;
        const corr = n.clone().multiplyScalar(corrMag);
        if (bodyA.invMass > 0) translateBody(bodyA, corr.clone().multiplyScalar(bodyA.invMass));
        if (bodyB.invMass > 0) translateBody(bodyB, corr.clone().multiplyScalar(-bodyB.invMass));

        // Рычаги от центров масс до точки удара
        const rA = col.point.clone().sub(bodyA.com);
        const rB = col.point.clone().sub(bodyB.com);

        // Угловой рычаг при опирании края одной доски на другую (эффект качелей/соскальзывания)
        if (bodyA.invInertia > 0) {
          applyBodyRotationDelta(bodyA, new THREE.Vector3().crossVectors(rA, n).multiplyScalar(col.depth * 0.35 * bodyA.invInertia));
        }
        if (bodyB.invInertia > 0) {
          applyBodyRotationDelta(bodyB, new THREE.Vector3().crossVectors(rB, n.clone().negate()).multiplyScalar(col.depth * 0.35 * bodyB.invInertia));
        }

        const velAtA = bodyA.vel.clone().add(new THREE.Vector3().crossVectors(bodyA.angVel, rA));
        const velAtB = bodyB.vel.clone().add(new THREE.Vector3().crossVectors(bodyB.angVel, rB));
        const relVel = velAtA.sub(velAtB);
        const vn = relVel.dot(n);

        if (vn < 0) {
          const rAxN = new THREE.Vector3().crossVectors(rA, n);
          const rBxN = new THREE.Vector3().crossVectors(rB, n);
          const angTerm =
            n.dot(new THREE.Vector3().crossVectors(rAxN, rA)) * bodyA.invInertia +
            n.dot(new THREE.Vector3().crossVectors(rBxN, rB)) * bodyB.invInertia;
          const denom = totalInvMass + Math.max(0, angTerm);
          const restitution = Math.abs(vn) > 1.2 ? 0.16 : 0.02;
          const jn = (-(1 + restitution) * vn) / denom;
          const impulseN = n.clone().multiplyScalar(jn);

          if (bodyA.invMass > 0) {
            bodyA.vel.addScaledVector(impulseN, bodyA.invMass);
            bodyA.angVel.addScaledVector(new THREE.Vector3().crossVectors(rA, impulseN), bodyA.invInertia);
          }
          if (bodyB.invMass > 0) {
            bodyB.vel.addScaledVector(impulseN, -bodyB.invMass);
            bodyB.angVel.addScaledVector(new THREE.Vector3().crossVectors(rB, impulseN.clone().negate()), bodyB.invInertia);
          }

          // Импульс сухого трения дерева о дерево
          const tangent = relVel.clone().addScaledVector(n, -vn);
          if (tangent.lengthSq() > 1e-5) {
            tangent.normalize();
            const jtMax = jn * 0.58;
            const jt = Math.max(-jtMax, Math.min(jtMax, -relVel.dot(tangent) / denom));
            const impulseT = tangent.multiplyScalar(jt);
            if (bodyA.invMass > 0) {
              bodyA.vel.addScaledVector(impulseT, bodyA.invMass);
              bodyA.angVel.addScaledVector(new THREE.Vector3().crossVectors(rA, impulseT), bodyA.invInertia);
            }
            if (bodyB.invMass > 0) {
              bodyB.vel.addScaledVector(impulseT, -bodyB.invMass);
              bodyB.angVel.addScaledVector(new THREE.Vector3().crossVectors(rB, impulseT.clone().negate()), bodyB.invInertia);
            }
          }
        }
      }
    }

    // 5. Коллизия каждого угла и ребра досок с рельефом земли (с наклоном и опрокидыванием)
    for (const body of bodies.values()) {
      if (body.isGrabbed) continue;
      let groundContacts = 0;

      for (const pl of body.members) {
        const obb = buildPlankOBB(pl);
        for (const pt of obb.corners) {
          const gY = getTerrainHeight(pt.x, pt.z);
          const pen = gY - pt.y;
          if (pen > 0) {
            groundContacts++;
            // Нормаль рельефа в точке контакта
            const gx = getTerrainHeight(pt.x + 0.25, pt.z) - gY;
            const gz = getTerrainHeight(pt.x, pt.z + 0.25) - gY;
            const n = new THREE.Vector3(-gx * 4, 1, -gz * 4).normalize();

            // Выталкиваем точку контакта и создаём вращающий момент относительно центра масс
            translateBody(body, n.clone().multiplyScalar(pen * 0.52));
            const r = pt.clone().sub(body.com);
            applyBodyRotationDelta(body, new THREE.Vector3().crossVectors(r, n).multiplyScalar(pen * 0.48 * body.invInertia));

            const velAtPt = body.vel.clone().add(new THREE.Vector3().crossVectors(body.angVel, r));
            const vn = velAtPt.dot(n);
            if (vn < 0) {
              const rXn = new THREE.Vector3().crossVectors(r, n);
              const denom = body.invMass + Math.max(0, n.dot(new THREE.Vector3().crossVectors(rXn, r)) * body.invInertia);
              const restitution = Math.abs(vn) > 1.6 ? 0.12 : 0.0;
              const jn = (-(1 + restitution) * vn) / denom;
              const impN = n.clone().multiplyScalar(jn);
              body.vel.addScaledVector(impN, body.invMass);
              body.angVel.addScaledVector(new THREE.Vector3().crossVectors(r, impN), body.invInertia);

              // Трение о траву/грунт
              const tang = velAtPt.clone().addScaledVector(n, -vn);
              if (tang.lengthSq() > 1e-5) {
                tang.normalize();
                const jt = Math.max(-jn * 0.68, Math.min(jn * 0.68, -velAtPt.dot(tang) / denom));
                const impT = tang.multiplyScalar(jt);
                body.vel.addScaledVector(impT, body.invMass);
                body.angVel.addScaledVector(new THREE.Vector3().crossVectors(r, impT), body.invInertia);
              }
            }
          }
        }
      }

      if (groundContacts > 0) {
        body.vel.multiplyScalar(0.86);
        body.angVel.multiplyScalar(0.82);
        if (body.vel.lengthSq() < 0.0025 && body.angVel.lengthSq() < 0.004) {
          body.vel.set(0, 0, 0);
          body.angVel.set(0, 0, 0);
        }
      }
    }

    // 6. Записываем обновлённые скорости и координаты в доски
    for (const body of bodies.values()) {
      if (body.isGrabbed) continue;
      for (const pl of body.members) {
        pl.x = +pl.x.toFixed(4);
        pl.y = +pl.y.toFixed(4);
        pl.z = +pl.z.toFixed(4);
        pl.qx = +pl.qx.toFixed(5);
        pl.qy = +pl.qy.toFixed(5);
        pl.qz = +pl.qz.toFixed(5);
        pl.qw = +pl.qw.toFixed(5);
        pl.vx = +body.vel.x.toFixed(3);
        pl.vy = +body.vel.y.toFixed(3);
        pl.vz = +body.vel.z.toFixed(3);
        pl.wx = +body.angVel.x.toFixed(3);
        pl.wy = +body.angVel.y.toFixed(3);
        pl.wz = +body.angVel.z.toFixed(3);
      }
    }
  }

  // Обновляем 3D-меши всех досок
  for (const pl of plankList) {
    const m = plankMeshes.get(pl.id);
    if (m) {
      m.position.set(pl.x, pl.y, pl.z);
      m.quaternion.set(pl.qx || 0, pl.qy || 0, pl.qz || 0, pl.qw ?? 1);
      m.updateMatrixWorld(true);
    }
  }

  physicsSaveTimer += dt;
  if (physicsSaveTimer > 0.6) {
    physicsSaveTimer = 0;
    saveWorldPlanks();
  }
}

function demolishNearestStructure() {
  const surf = raycastPlankSurface(5.5);
  if (!surf) {
    showToast("Наведите прицел на доску и нажмите [X], чтобы убрать её в инвентарь.");
    return;
  }
  const pl = surf.plank;
  if (pl.ownerName && pl.ownerName !== state.name && pl.ownerKey !== state.playerKey) {
    showToast(`⚠️ Эта доска привязана к нику ${pl.ownerName}!`);
    return;
  }
  removePlankById(pl.id, true);
  state.inv.plank = (state.inv.plank || 0) + 1;
  playSfx("chop");
  showToast("🪵 Доска возвращена в инвентарь.");
  updateHudUI();
  saveLocalProfile();
}

// ==========================================
// ВВОД, HUD И МИНИ-КАРТА
// ==========================================
const keys = {};
window.addEventListener("keydown", (e) => {
  if (document.activeElement === document.getElementById("chat-input") ||
      document.activeElement === document.getElementById("nickname-input")) {
    if (e.key === "Enter" && document.activeElement === document.getElementById("chat-input")) sendChatFromInput();
    return;
  }
  const k = e.code;
  if (!state.started) return;

  if (modalBackdrop.style.display === "flex") {
    for (const key in keys) keys[key] = false;
    if (k === "Escape" || k === "KeyE" || k === "KeyC" || k === "KeyB") closeModal(true);
    else if (k === "KeyI" || k === "Tab") { e.preventDefault(); closeModal(true); }
    return;
  }
  keys[k] = true;

  if (k.startsWith("Digit")) {
    const num = parseInt(k.replace("Digit", ""), 10);
    if (num >= 1 && num <= 9) {
      const slots = getHotbarSlots();
      if (slots[num - 1]) selectHeldItem(slots[num - 1].id);
      return;
    }
  }

  if (k === "KeyR" && !grabState.active) {
    state.plankSpawnYaw = (state.plankSpawnYaw + Math.PI / 4) % (Math.PI * 2);
  }

  if (k === "KeyE" && !grabState.active) {
    if (state.heldItem === "plank") placePhysicalPlankAction();
    else if (state.heldItem === "nails") placeNailAtCrosshairAction();
    else if (state.heldItem === "hammer") hammerNailAtCrosshairAction();
    else executeInteraction(findNearestInteractable());
  } else if (k === "KeyI" || k === "Tab") { e.preventDefault(); openInventoryModal(); }
  else if (k === "KeyF" && !grabState.active) eatFoodAction();
  else if (k === "KeyC") openCraftModal();
  else if (k === "KeyB") openBuildModal();
  else if (k === "KeyX" && !grabState.active) demolishNearestStructure();
  else if (k === "KeyV") {
    state.firstPerson = !state.firstPerson;
    selfMesh.visible = !state.firstPerson;
    fpHand.visible = state.firstPerson;
    showToast(state.firstPerson ? "👁️ Вид от первого лица" : "🎥 Вид от третьего лица");
  }
  else if (k === "Escape") { closeModal(false); exitBuildMode(); }
  else if (k === "Enter") document.getElementById("chat-input").focus();
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

let isDraggingCam = false;
let dragMoved = false;
let lastMouseX = 0;
let lastMouseY = 0;
let pointerLockedBeforeClick = false;
let grabStartedThisClick = false;

canvas.addEventListener("mousedown", (e) => {
  if (modalBackdrop.style.display === "flex") {
    pointerLockedBeforeClick = false;
    return;
  }
  if (e.button === 0) leftMouseDown = true;
  if (e.button === 2) rightMouseDown = true;

  pointerLockedBeforeClick = document.pointerLockElement === canvas;
  if (state.started && document.pointerLockElement !== canvas) {
    try { canvas.requestPointerLock(); } catch {}
  }

  grabStartedThisClick = false;
  if (e.button === 0 && state.started && pointerLockedBeforeClick && state.heldItem === "hand") {
    if (tryStartHandGrab()) {
      grabStartedThisClick = true;
    }
  }

  isDraggingCam = true;
  dragMoved = false;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

window.addEventListener("mousemove", (e) => {
  if (modalBackdrop.style.display === "flex") return;



  if (document.pointerLockElement === canvas && state.started) {
    state.camYaw -= e.movementX * 0.0026;
    state.camPitch = Math.max(-1.25, Math.min(1.25, state.camPitch + e.movementY * 0.0024));
    state.ry = state.camYaw;
    return;
  }
  if (!isDraggingCam) return;
  const dx = e.clientX - lastMouseX;
  const dy = e.clientY - lastMouseY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  state.camYaw -= dx * 0.006;
  state.camPitch = Math.max(-1.2, Math.min(1.2, state.camPitch + dy * 0.005));
  state.ry = state.camYaw;
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) leftMouseDown = false;
  if (e.button === 2) rightMouseDown = false;

  if (e.button === 0 && grabState.active) {
    endHandGrab();
  }

  const wasLocked = pointerLockedBeforeClick;
  pointerLockedBeforeClick = false;
  isDraggingCam = false;
  if (modalBackdrop.style.display === "flex") return;

  if (wasLocked && !dragMoved && !grabStartedThisClick && state.started && e.button === 0 && e.target === canvas) {
    if (state.heldItem === "plank") {
      placePhysicalPlankAction();
    } else if (state.heldItem === "nails") {
      placeNailAtCrosshairAction();
    } else if (state.heldItem === "hammer") {
      hammerNailAtCrosshairAction();
    } else {
      const nearest = findNearestInteractable();
      if (nearest) executeInteraction(nearest);
      else if (ITEMS[state.heldItem]?.food > 0) eatFoodAction();
      else state.workTimer = 0.32;
    }
  }
  grabStartedThisClick = false;
});

canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); });
canvas.addEventListener("wheel", (e) => {
  if (grabState.active) {
    grabState.distance = Math.max(1.5, Math.min(7.0, grabState.distance - e.deltaY * 0.003));
    return;
  }
  if (state.firstPerson) {
    cycleHotbarSlot(e.deltaY > 0 ? 1 : -1);
  } else {
    state.camDist = Math.max(4.5, Math.min(24, state.camDist + e.deltaY * 0.01));
  }
});
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById("btn-inv").addEventListener("click", openInventoryModal);
document.getElementById("btn-eat").addEventListener("click", () => { eatFoodAction(); lockPointerSafe(); });
document.getElementById("btn-craft").addEventListener("click", openCraftModal);
document.getElementById("btn-build").addEventListener("click", openBuildModal);
document.getElementById("interact-prompt").addEventListener("click", () => executeInteraction(findNearestInteractable()));

function appendChatLine(msg) {
  const box = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = "chat-line";
  const senderSpan = document.createElement("b");
  senderSpan.style.color = msg.color || "#ffd54f";
  senderSpan.textContent = `${msg.sender || "Дачник"}: `;
  const textSpan = document.createElement("span");
  textSpan.textContent = msg.text || "";
  div.append(senderSpan, textSpan);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function sendChatFromInput() {
  const inp = document.getElementById("chat-input");
  const text = inp.value.trim();
  inp.value = "";
  inp.blur();
  if (!text) return;
  const msg = { id: `${Date.now()}`, sender: state.name, color: state.color, text, time: Date.now() };
  appendChatLine(msg);
  broadcastNetworkPacket({ type: "chat_msg", message: msg }, true);
}
document.getElementById("chat-send").addEventListener("click", sendChatFromInput);

function showToast(text) {
  const cont = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = "toast-msg";
  el.textContent = text;
  cont.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function updateHudUI() {
  document.getElementById("hud-player-name").textContent = state.name;
  document.getElementById("hud-color-dot").style.background = state.color;
  document.getElementById("hud-money").textContent = `${Math.round(state.money)} ₽`;
  const myPlotsCount = Object.values(state.plots).filter((p) => p.ownerKey === state.playerKey).length;
  document.getElementById("hud-plots").textContent = `Участков: ${myPlotsCount}`;

  const hPct = Math.round(state.hunger);
  const ePct = Math.round(state.energy);
  document.getElementById("bar-hunger").style.width = `${hPct}%`;
  document.getElementById("val-hunger").textContent = `${hPct}%`;
  document.getElementById("bar-energy").style.width = `${ePct}%`;
  document.getElementById("val-energy").textContent = `${ePct}%`;

  const toolsEl = document.getElementById("hud-tools");
  toolsEl.innerHTML = `<span class="tool-chip" style="border-color:#ffd54f;color:#fffde7;">🖐️ В руке: ${getHeldItemTitle(state.heldItem)}</span>`;

  const bannerEl = document.getElementById("held-item-banner");
  if (bannerEl) {
    bannerEl.textContent = `В руке: ${getHeldItemTitle(state.heldItem)}`;
  }

  const eatBtnEl = document.getElementById("btn-eat");
  if (eatBtnEl) {
    const heldFood = ITEMS[state.heldItem]?.food > 0 ? ITEMS[state.heldItem] : null;
    eatBtnEl.innerHTML = heldFood
      ? `<kbd>F</kbd> 😋 Съесть: ${heldFood.icon} ${heldFood.name}`
      : `<kbd>F</kbd> 🍓 Поесть (из руки)`;
  }

  const invBar = document.getElementById("inventory-bar");
  if (invBar) {
    const slots = getHotbarSlots();
    const sig = slots.map((s) => `${s.id}:${s.count ?? ""}:${state.heldItem === s.id ? 1 : 0}`).join("|");
    if (invBar.dataset.sig !== sig) {
      invBar.dataset.sig = sig;
      invBar.innerHTML = "";
      slots.forEach((slot, i) => {
        const div = document.createElement("div");
        div.className = "inv-slot" + (state.heldItem === slot.id ? " active" : "");
        div.innerHTML = `
          <span class="slot-key">${i + 1}</span>
          <span>${slot.icon} ${slot.name}</span>
          ${slot.count !== null ? `<span class="cnt">x${slot.count}</span>` : ""}
        `;
        div.addEventListener("mousedown", (e) => e.stopPropagation());
        div.addEventListener("mouseup", (e) => e.stopPropagation());
        div.addEventListener("click", (e) => {
          e.stopPropagation();
          selectHeldItem(slot.id);
        });
        invBar.appendChild(div);
      });
    }
  }

  updateFirstPersonHeldItem(fpHand, state.heldItem, state.tools.axe);
  updateThirdPersonHeldItem(selfMesh, state.heldItem, state.tools.axe);
  updateOnlineListUI();
}

function updateOnlineListUI() {
  const listEl = document.getElementById("online-list");
  listEl.innerHTML = "";
  const myPlotsCount = Object.values(state.plots).filter((p) => p.ownerKey === state.playerKey).length;
  const all = [{ name: `${state.name} (Вы)`, color: state.color, plots: myPlotsCount, money: state.money }];
  for (const rp of state.remotePlayers.values()) {
    if (Date.now() - rp.lastSeen < 90_000) {
      all.push({ name: rp.name, color: rp.color, plots: rp.plotsCount || 0, money: rp.money || 500 });
    }
  }
  document.getElementById("online-count").textContent = String(all.length);
  all.forEach((p) => {
    const row = document.createElement("div");
    row.className = "online-item";
    row.innerHTML = `<span style="color:${p.color};font-weight:700;">● ${p.name}</span><span>${p.plots} уч. • ${p.money} ₽</span>`;
    listEl.appendChild(row);
  });
}

const minimapCanvas = document.getElementById("minimap-canvas");
const mmCtx = minimapCanvas.getContext("2d");

function renderMinimap() {
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const scale = 0.62;
  mmCtx.fillStyle = "#1c331e";
  mmCtx.fillRect(0, 0, w, h);

  const toScreen = (wx, wz) => [w / 2 + (wx - state.x) * scale, h / 2 + (wz - state.z) * scale];

  for (const ch of loadedChunks.values()) {
    // Лесное асфальтовое шоссе снаружи СНТ
    const [hx1, hz1] = toScreen(ch.centerX - 150, ch.centerZ + 108);
    const [hx2, hz2] = toScreen(ch.centerX + 150, ch.centerZ + 108);
    mmCtx.strokeStyle = "#545d66";
    mmCtx.lineWidth = 5;
    mmCtx.beginPath();
    mmCtx.moveTo(hx1, hz1);
    mmCtx.lineTo(hx2, hz2);
    mmCtx.stroke();

    // Центральная грунтовая улица СНТ и подъездная дорога
    const [rx1, rz1] = toScreen(ch.centerX - 82, ch.centerZ);
    const [rx2, rz2] = toScreen(ch.centerX + 82, ch.centerZ);
    mmCtx.strokeStyle = "#9c7b56";
    mmCtx.lineWidth = 5;
    mmCtx.beginPath();
    mmCtx.moveTo(rx1, rz1);
    mmCtx.lineTo(rx2, rz2);
    mmCtx.stroke();

    const [ex1, ez1] = toScreen(ch.centerX, ch.centerZ);
    const [ex2, ez2] = toScreen(ch.centerX, ch.centerZ + 108);
    mmCtx.beginPath();
    mmCtx.moveTo(ex1, ez1);
    mmCtx.lineTo(ex2, ez2);
    mmCtx.stroke();

    for (const p of ch.layout.plots) {
      const [sx, sz] = toScreen(p.x - p.w / 2, p.z - p.d / 2);
      const own = state.plots[p.plotId];
      if (!own) {
        mmCtx.fillStyle = "rgba(255, 213, 79, 0.25)";
        mmCtx.strokeStyle = "#ffd54f";
      } else if (own.ownerKey === state.playerKey) {
        mmCtx.fillStyle = "rgba(102, 187, 106, 0.45)";
        mmCtx.strokeStyle = "#69f0ae";
      } else {
        mmCtx.fillStyle = "rgba(41, 182, 246, 0.38)";
        mmCtx.strokeStyle = "#29b6f6";
      }
      mmCtx.lineWidth = 1.5;
      mmCtx.fillRect(sx, sz, p.w * scale, p.d * scale);
      mmCtx.strokeRect(sx, sz, p.w * scale, p.d * scale);
    }

    const [shX, shZ] = toScreen(ch.layout.shopPos.x, ch.layout.shopPos.z);
    mmCtx.fillStyle = "#ffd54f";
    mmCtx.fillRect(shX - 4, shZ - 4, 8, 8);

    const [bzX, bzZ] = toScreen(ch.layout.bazaarPos.x, ch.layout.bazaarPos.z);
    mmCtx.fillStyle = "#ff7043";
    mmCtx.fillRect(bzX - 4, bzZ - 4, 8, 8);
  }

  for (const rp of state.remotePlayers.values()) {
    const [px, pz] = toScreen(rp.x, rp.z);
    mmCtx.fillStyle = rp.color || "#29b6f6";
    mmCtx.beginPath();
    mmCtx.arc(px, pz, 4, 0, Math.PI * 2);
    mmCtx.fill();
  }

  mmCtx.fillStyle = "#ffffff";
  mmCtx.beginPath();
  mmCtx.arc(w / 2, h / 2, 4.5, 0, Math.PI * 2);
  mmCtx.fill();

  const hVal = getTerrainHeight(state.x, state.z);
  document.getElementById("minimap-coords").textContent =
    `X: ${Math.round(state.x)} • Z: ${Math.round(state.z)} • Рельеф: ${hVal >= 0 ? "+" : ""}${hVal.toFixed(1)}м`;
}

// ==========================================
// СТАРТ И ИГРОВОЙ ЦИКЛ
// ==========================================
const nickInput = document.getElementById("nickname-input");
nickInput.value = state.name;

document.querySelectorAll(".color-swatch").forEach((sw) => {
  if (sw.dataset.color === state.color) {
    document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
    sw.classList.add("active");
  }
  sw.addEventListener("click", () => {
    document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
    sw.classList.add("active");
    state.color = sw.dataset.color;
  });
});

function resetPlayerProgressAndObjects() {
  const nick = (nickInput?.value || state.name || "").trim();
  removeObjectsByOwner(nick || state.name, state.playerKey, true);
  localStorage.removeItem("project_dacha3_profile_v1");
  setTimeout(() => window.location.reload(), 120);
}

const resetBtn = document.getElementById("reset-profile-btn");
if (resetBtn) resetBtn.addEventListener("click", resetPlayerProgressAndObjects);
const hudResetBtn = document.getElementById("btn-reset");
if (hudResetBtn) hudResetBtn.addEventListener("click", resetPlayerProgressAndObjects);

function startGame() {
  const enteredName = nickInput.value.trim().slice(0, 20);
  if (!enteredName) {
    nickInput.focus();
    nickInput.style.borderColor = "#ff5252";
    showToast("✏️ Пожалуйста, введите ваш ник перед входом!");
    return;
  }
  state.name = enteredName;
  state.started = true;
  saveLocalProfile();

  document.getElementById("login-overlay").style.display = "none";
  document.getElementById("hud").style.display = "block";

  scene.remove(selfMesh);
  selfMesh = createPlayerMesh(state.name, state.color);
  selfMesh.visible = !state.firstPerson;
  scene.add(selfMesh);

  camera.remove(fpHand);
  fpHand = createFirstPersonViewmodel(state.color);
  updateFirstPersonHeldItem(fpHand, state.heldItem, state.tools.axe);
  updateThirdPersonHeldItem(selfMesh, state.heldItem, state.tools.axe);
  fpHand.visible = state.firstPerson;
  camera.add(fpHand);

  cleanupDepartedPlayers();
  ensureChunksAroundPlayer();
  refreshAllPlotSigns();
  for (const pl of Object.values(state.planks)) {
    spawnOrUpdatePlankMesh(pl);
  }
  updateHudUI();
  initMultiplayerNetwork();
  lockPointerSafe();
  broadcastNetworkPacket({ type: "request_world_sync" }, false);
  sendMyPresenceAndWorldSnapshot();

  appendChatLine({
    sender: "СНТ-Инфо",
    color: "#81c784",
    text: `Добро пожаловать, ${state.name}! У вас 500 ₽ — подойдите к табличке любого участка и нажмите [E], чтобы купить дачу за 300 ₽!`
  });

  const myPlotsCount = Object.values(state.plots).filter((p) => p.ownerKey === state.playerKey).length;
  broadcastNetworkPacket({
    type: "player_joined",
    name: state.name,
    color: state.color,
    x: state.x,
    y: state.y,
    z: state.z,
    ry: state.ry,
    money: state.money,
    plotsCount: myPlotsCount
  });
}

document.getElementById("start-game-btn").addEventListener("click", startGame);
nickInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startGame(); });

ensureChunksAroundPlayer();
initMultiplayerNetwork();

let lastTime = performance.now();
let netSyncAccum = 0;
let cropVisualAccum = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const elapsedSec = now / 1000;

  let isMoving = false;
  if (state.started) {
    if (keys["KeyQ"] && !grabState.active) state.camYaw += 1.8 * dt;

    let fwd = 0;
    let right = 0;
    if (keys["KeyW"] || keys["ArrowUp"]) fwd += 1;
    if (keys["KeyS"] || keys["ArrowDown"]) fwd -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) right += 1;
    if (keys["KeyA"] || keys["ArrowLeft"]) right -= 1;

    const sprinting = (keys["ShiftLeft"] || keys["ShiftRight"]) && state.energy > 5;
    const baseSpeed = state.hunger > 10 ? (sprinting ? 13.5 : 8.6) : 5.5;

    if (fwd !== 0 || right !== 0) {
      isMoving = true;
      const len = Math.hypot(fwd, right);
      fwd /= len;
      right /= len;
      const sinY = Math.sin(state.camYaw);
      const cosY = Math.cos(state.camYaw);
      const vx = (-sinY * fwd + cosY * right) * baseSpeed;
      const vz = (-cosY * fwd - sinY * right) * baseSpeed;
      const nextPos = resolveCollisions(state.x + vx * dt, state.z + vz * dt);
      state.x = nextPos.x;
      state.z = nextPos.z;
      state.ry = state.firstPerson ? state.camYaw : Math.atan2(-vx, -vz);

      if (sprinting) state.energy = Math.max(0, state.energy - dt * 4.5);
      state.hunger = Math.max(0, state.hunger - dt * 0.28);
    } else {
      state.energy = Math.min(100, state.energy + dt * 3.8);
      state.hunger = Math.max(0, state.hunger - dt * 0.08);
    }

    if (keys["Space"] && state.isGrounded) {
      state.vy = 7.4;
      state.isGrounded = false;
    }
    state.vy -= 19.5 * dt;
    state.y += state.vy * dt;

    let groundY = getTerrainHeight(state.x, state.z);
    for (const pl of Object.values(state.planks)) {
      if (Math.abs(pl.x - state.x) > 2.6 || Math.abs(pl.z - state.z) > 2.6) continue;
      const m = plankMeshes.get(pl.id);
      if (!m) continue;
      const loc = m.worldToLocal(new THREE.Vector3(state.x, pl.y, state.z));
      if (Math.abs(loc.x) <= (pl.w || 2.4) / 2 + 0.18 && Math.abs(loc.z) <= (pl.d || 0.36) / 2 + 0.18) {
        const topWorld = new THREE.Vector3(loc.x, (pl.h || 0.12) / 2, loc.z).applyMatrix4(m.matrixWorld);
        if (topWorld.y <= state.y + 0.35 && topWorld.y > groundY) {
          groundY = topWorld.y;
        }
      }
    }
    if (state.y <= groundY) {
      state.y = groundY;
      state.vy = 0;
      state.isGrounded = true;
    }

    if (state.workTimer > 0) state.workTimer = Math.max(0, state.workTimer - dt);
    ensureChunksAroundPlayer();
  } else {
    state.camYaw = elapsedSec * 0.18;
    state.y = getTerrainHeight(state.x, state.z);
  }

  selfMesh.position.set(state.x, state.y, state.z);
  selfMesh.rotation.y = state.ry;
  animatePlayerMesh(selfMesh, dt, elapsedSec, isMoving, state.workTimer > 0);

  for (const [, rp] of state.remotePlayers.entries()) {
    const dx = rp.tx - rp.x;
    const dz = rp.tz - rp.z;
    const dist = Math.hypot(dx, dz);
    rp.x += dx * Math.min(1, dt * 10);
    rp.z += dz * Math.min(1, dt * 10);
    rp.y = getTerrainHeight(rp.x, rp.z);
    rp.mesh.position.set(rp.x, rp.y, rp.z);
    rp.mesh.rotation.y = rp.ry;
    animatePlayerMesh(rp.mesh, dt, elapsedSec, dist > 0.05, rp.anim === "work");
  }

  for (const ch of loadedChunks.values()) {
    for (const [resId, rm] of ch.resMeshes.entries()) {
      if (rm.userData.berriesGroup && !rm.userData.berriesGroup.visible) {
        if (Date.now() - (state.berryPickedAt[resId] || 0) > 45_000) {
          rm.userData.berriesGroup.visible = true;
        }
      }
    }
  }

  if (state.started) {
    updateHandGrab(dt);
    stepPlanksPhysics(dt);

    if (state.heldItem === "plank" && (state.inv.plank || 0) > 0 && modalBackdrop.style.display !== "flex") {
      const tr = getPlankSpawnTransform();
      plankPreviewMesh.position.set(tr.x, tr.y, tr.z);
      plankPreviewMesh.quaternion.copy(tr.q);
      plankPreviewMesh.visible = true;
    } else {
      plankPreviewMesh.visible = false;
    }

    if (state.heldItem === "nails" && (state.inv.nails || 0) > 0 && modalBackdrop.style.display !== "flex") {
      const surf = raycastPlankSurface(5.8);
      if (surf) {
        nailPreviewGroup.position.copy(surf.point);
        nailPreviewGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), surf.worldNormal);
        nailPreviewGroup.visible = true;
      } else {
        nailPreviewGroup.visible = false;
      }
    } else {
      nailPreviewGroup.visible = false;
    }
  }

  cropVisualAccum += dt;
  if (cropVisualAccum > 0.45) {
    cropVisualAccum = 0;
    cleanupDepartedPlayers();
    for (const s of Object.values(state.structures)) {
      if (s.type === "bed" || s.type === "greenhouse") {
        const sm = structureMeshes.get(s.id);
        if (sm) updateCropVisuals(sm, s, getCropProgress(s), s.crop ? CROPS[s.crop] : null);
      }
    }
    if (state.started) {
      const pcx = Math.floor((state.x + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
      const pcz = Math.floor((state.z + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
      const curChunk = loadedChunks.get(`${pcx},${pcz}`);
      const curPlot = findPlotAt(state.x, state.z);
      const locEl = document.getElementById("hud-location");
      if (curPlot) {
        const own = state.plots[curPlot.plotId];
        locEl.textContent = own
          ? `📍 ${curPlot.sntName} • Уч. №${curPlot.plotNum} (${own.ownerName})`
          : `📍 ${curPlot.sntName} • Уч. №${curPlot.plotNum} (Свободен)`;
      } else if (curChunk) {
        locEl.textContent = `📍 ${curChunk.layout.sntName} (Лес и дороги)`;
      }

      const promptEl = document.getElementById("interact-prompt");
      const nearest = findNearestInteractable();
      if (nearest && !state.buildMode) {
        promptEl.style.display = "block";
        document.getElementById("interact-main").textContent = nearest.title;
        document.getElementById("interact-sub").textContent = nearest.sub;
      } else {
        promptEl.style.display = "none";
      }

      renderMinimap();
      updateHudUI();
    }
  }

  netSyncAccum += dt;
  const syncInterval = isMoving ? 0.28 : 2.0;
  if (state.started && netSyncAccum > syncInterval) {
    netSyncAccum = 0;
    const myPlotsCount = Object.values(state.plots).filter((p) => p.ownerKey === state.playerKey).length;
    broadcastNetworkPacket({
      type: "player_moved",
      name: state.name,
      color: state.color,
      x: Number(state.x.toFixed(2)),
      y: Number(state.y.toFixed(2)),
      z: Number(state.z.toFixed(2)),
      ry: Number(state.ry.toFixed(2)),
      anim: state.workTimer > 0 ? "work" : isMoving ? "walk" : "idle",
      money: Math.round(state.money),
      plotsCount: myPlotsCount
    });
  }

  if (state.started && state.firstPerson) {
    if (isMoving && state.isGrounded) {
      state.walkBob += dt * 11;
    }
    const bobY = isMoving && state.isGrounded ? Math.sin(state.walkBob) * 0.055 : 0;
    const eyeY = state.y + 1.74 + bobY;
    camera.position.set(state.x, eyeY, state.z);

    const lookX = state.x - Math.sin(state.camYaw) * Math.cos(state.camPitch) * 10;
    const lookY = eyeY - Math.sin(state.camPitch) * 10;
    const lookZ = state.z - Math.cos(state.camYaw) * Math.cos(state.camPitch) * 10;
    camera.lookAt(lookX, lookY, lookZ);

    if (fpHand && fpHand.userData.arm) {
      const arm = fpHand.userData.arm;
      if (state.workTimer > 0) {
        arm.rotation.x = 0.2 - Math.sin(state.workTimer * 26) * 0.85;
      } else {
        arm.rotation.x = 0.2 + Math.sin(elapsedSec * 2.5) * 0.03;
      }
      arm.position.y = -0.28 + (isMoving ? Math.cos(state.walkBob) * 0.025 : 0);
    }
  } else {
    const pitch3P = Math.max(0.15, Math.min(1.2, state.camPitch + 0.35));
    const camX = state.x + Math.sin(state.camYaw) * Math.cos(pitch3P) * state.camDist;
    const camZ = state.z + Math.cos(state.camYaw) * Math.cos(pitch3P) * state.camDist;
    const minCamY = getTerrainHeight(camX, camZ) + 1.2;
    const camY = Math.max(minCamY, state.y + 1.8 + Math.sin(pitch3P) * state.camDist);

    camera.position.set(camX, camY, camZ);
    camera.lookAt(state.x, state.y + 1.6, state.z);
  }

  sunLight.position.set(state.x + 45, state.y + 75, state.z + 35);
  sunLight.target.position.set(state.x, state.y, state.z);

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

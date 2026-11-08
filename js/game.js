import * as THREE from "three";
import { Peer } from "peerjs";
import mqtt from "mqtt";
import { generateSecretKey, finalizeEvent } from "nostr-tools/pure";
import { CHUNK_SIZE, getTerrainHeight, getChunkLayout } from "./world.js?v=5";
import {
  ITEMS,
  CROPS,
  CRAFT_RECIPES,
  BUILDINGS,
  SHOP_GOODS,
  BAZAAR_PRICES,
  playSfx
} from "./data.js?v=5";
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
  animatePlayerMesh
} from "./models.js?v=5";

const savedProfile = JSON.parse(localStorage.getItem("project_dacha3_profile_v1") || "null");

const state = {
  started: false,
  playerKey: savedProfile?.playerKey || "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
  name: savedProfile?.name || "",
  color: savedProfile?.color || "#2e7d32",
  money: savedProfile?.money ?? 500,
  hunger: savedProfile?.hunger ?? 100,
  energy: savedProfile?.energy ?? 100,
  tools: savedProfile?.tools || { axe: false, watering_can: false },
  inv: savedProfile?.inv || {
    wood: 0,
    branch: 0,
    stone: 0,
    berry: 0,
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
    pie: 0
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
        inv: state.inv,
        plots: state.plots,
        structures: state.structures,
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
const NTFY_WS_URL = `wss://ntfy.sh/${CENTRAL_ROOM_TOPIC}/ws?since=all`;
const NTFY_SSE_URL = `https://ntfy.sh/${CENTRAL_ROOM_TOPIC}/sse?since=all`;

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
        structures: state.structures,
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
  const fullPkt = { ...payload, pktId, senderKey: state.playerKey, peerId: myPeerId };
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

  if (Object.keys(state.plots).length > 0 || Object.keys(state.structures).length > 0) {
    broadcastNetworkPacket({
      type: "world_sync_snapshot",
      plots: state.plots,
      structures: state.structures,
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

  if (pkt.structures && typeof pkt.structures === "object") {
    for (const [sid, sdata] of Object.entries(pkt.structures)) {
      if (!state.structures[sid]) {
        state.structures[sid] = sdata;
        spawnOrUpdateStructureMesh(sdata);
      }
    }
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
    case "player_moved":
    case "player_joined": {
      const pid = pkt.senderKey || pkt.id;
      if (!pid || pid === state.playerKey) return;
      const isNewPlayer = !state.remotePlayers.has(pid);
      let rp = state.remotePlayers.get(pid);
      if (!rp) {
        const mesh = createPlayerMesh(pkt.name || "Дачник", pkt.color || "#1565c0");
        scene.add(mesh);
        rp = {
          id: pid,
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
    case "structure_placed": {
      const s = pkt.structure;
      if (!s || !s.id) return;
      state.structures[s.id] = s;
      spawnOrUpdateStructureMesh(s);
      saveLocalProfile();
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
            sub: `Нажмите [E] или ЛКМ — Срубить дерево (+${state.tools.axe ? 4 : 2} Бревна 🪵, +2 Ветки 🌿)`,
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
  state.workTimer = 0.38;

  if (target.kind === "shop") return openShopModal();
  if (target.kind === "bazaar") return openBazaarModal();
  if (target.kind === "own_plot") return openBuildModal();

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

function eatFoodAction() {
  const foodOrder = ["pie", "pickles", "jam", "strawberry", "tomato", "cucumber", "potato", "berry"];
  for (const key of foodOrder) {
    if ((state.inv[key] || 0) > 0) {
      state.inv[key]--;
      const gain = ITEMS[key].food || 20;
      state.hunger = Math.min(100, state.hunger + gain);
      state.energy = Math.min(100, state.energy + Math.round(gain * 0.6));
      playSfx("pick");
      showToast(`😋 Вы съели «${ITEMS[key].name}» (+${gain}% сытости)!`);
      updateHudUI();
      saveLocalProfile();
      return;
    }
  }
  showToast("🍓 Нет еды в рюкзаке! Соберите лесные ягоды с кустов [E] или купите пирожок в Магазине!");
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
  modalTitle.textContent = `🎒 Инвентарь дачника (Наличные: ${Math.round(state.money)} ₽)`;
  modalSubtitle.textContent = "Ваши добытые ресурсы, стройматериалы, семена и запасы еды:";
  modalBody.innerHTML = "";
  let hasAny = false;
  Object.entries(ITEMS).forEach(([key, info]) => {
    const cnt = state.inv[key] || 0;
    if (cnt <= 0) return;
    hasAny = true;
    const card = document.createElement("div");
    card.className = "card-item";
    card.innerHTML = `
      <div>
        <div class="card-title">${info.icon} ${info.name}: <span style="color:#ffd54f">${cnt} шт.</span></div>
        <div class="card-desc">${info.food > 0 ? `Восстанавливает +${info.food}% сытости.` : "Ресурс для строительства, огорода, крафта или продажи на Базаре."}</div>
      </div>
      ${info.food > 0 ? `<button class="card-btn">😋 Съесть (+${info.food}% сытости)</button>` : ""}
    `;
    if (info.food > 0) {
      card.querySelector("button").addEventListener("click", () => {
        if ((state.inv[key] || 0) < 1) return;
        state.inv[key]--;
        state.hunger = Math.min(100, state.hunger + info.food);
        state.energy = Math.min(100, state.energy + Math.round(info.food * 0.6));
        playSfx("pick");
        showToast(`😋 Съедено: ${info.name} (+${info.food}% сытости)`);
        updateHudUI();
        saveLocalProfile();
        openInventoryModal();
      });
    }
    modalBody.appendChild(card);
  });
  if (!hasAny) {
    modalBody.innerHTML = `<div style="grid-column:1/-1;padding:18px;text-align:center;color:#c5e1a5;">Инвентарь пока пуст — рубите деревья, собирайте ягоды с кустов [E] или сходите пешком в Магазин у входа в СНТ!</div>`;
  }
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
  modalTitle.textContent = "🏡 Строительство домов и Огород";
  const myPlotsCount = Object.values(state.plots).filter((p) => p.ownerKey === state.playerKey).length;
  modalSubtitle.textContent = myPlotsCount > 0
    ? `У вас участков: ${myPlotsCount}. Выберите постройку и разместите её на своей даче:`
    : "💡 Совет: купите участок за 300 ₽ у таблички в СНТ, чтобы закрепить за собой территорию!";
  modalBody.innerHTML = "";
  BUILDINGS.forEach((b) => {
    const can = hasResources(b.cost);
    const card = document.createElement("div");
    card.className = "card-item";
    card.innerHTML = `
      <div><div class="card-title">${b.name}</div><div class="card-desc">${b.desc}</div></div>
      <div class="card-cost">Материалы: ${formatCostObject(b.cost)}</div>
      <button class="card-btn" ${can ? "" : "disabled"}>Выбрать для постройки</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      if (!hasResources(b.cost)) return;
      closeModal();
      enterBuildMode(b);
    });
    modalBody.appendChild(card);
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
// СТРОИТЕЛЬСТВО
// ==========================================
const buildBanner = document.getElementById("build-banner");
const buildSelectedName = document.getElementById("build-selected-name");

function enterBuildMode(buildingDef) {
  state.buildMode = buildingDef;
  buildSelectedName.textContent = buildingDef.name;
  buildBanner.style.display = "block";
  while (buildGhostGroup.children.length > 0) buildGhostGroup.remove(buildGhostGroup.children[0]);
  const ghost = createStructureMesh({ id: "ghost", type: buildingDef.type, x: 0, z: 0, rot: 0 });
  ghost.position.set(0, 0, 0);
  ghost.rotation.set(0, 0, 0);
  ghost.traverse((child) => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.transparent = true;
      child.material.opacity = 0.62;
    }
  });
  buildGhostGroup.add(ghost);
  const gPos = getBuildPreviewCoords();
  buildGhostGroup.position.set(gPos.x, gPos.y, gPos.z);
  buildGhostGroup.rotation.y = state.buildRot;
  buildGhostGroup.visible = true;
  lockPointerSafe();
}

function exitBuildMode() {
  state.buildMode = null;
  buildBanner.style.display = "none";
  buildGhostGroup.visible = false;
}

function getBuildPreviewCoords() {
  state.ry = state.camYaw;
  const dist = Math.max(3.8, Math.min(9.5, 6.2 - state.camPitch * 3.0));
  const gx = state.x - Math.sin(state.camYaw) * dist;
  const gz = state.z - Math.cos(state.camYaw) * dist;
  return { x: gx, y: getTerrainHeight(gx, gz), z: gz };
}

function confirmPlaceBuilding() {
  const b = state.buildMode;
  if (!b) return;
  if (!hasResources(b.cost)) {
    showToast("❌ Не хватает стройматериалов!");
    exitBuildMode();
    return;
  }
  const pos = getBuildPreviewCoords();
  const plot = findPlotAt(pos.x, pos.z);
  if (plot) {
    const owner = state.plots[plot.plotId];
    if (owner && owner.ownerKey !== state.playerKey) {
      showToast(`⚠️ Нельзя строить на участке игрока ${owner.ownerName}!`);
      return;
    }
  }
  consumeResources(b.cost);
  const struct = {
    id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: b.type,
    x: Number(pos.x.toFixed(2)),
    y: Number(pos.y.toFixed(2)),
    z: Number(pos.z.toFixed(2)),
    rot: state.buildRot,
    plotId: plot ? plot.plotId : "",
    ownerKey: state.playerKey,
    ownerName: state.name,
    crop: null,
    plantedAt: 0,
    watered: false
  };
  state.structures[struct.id] = struct;
  spawnOrUpdateStructureMesh(struct);
  playSfx("build");
  showToast(`🏡 Построено: ${b.name}!`);
  broadcastNetworkPacket({ type: "structure_placed", structure: struct }, true);
  updateHudUI();
  saveLocalProfile();
  if (!hasResources(b.cost)) exitBuildMode();
}

function demolishNearestStructure() {
  let nearest = null;
  let bestD = 4.5;
  for (const s of Object.values(state.structures)) {
    const d = Math.hypot(state.x - s.x, state.z - s.z);
    if (d < bestD) { bestD = d; nearest = s; }
  }
  if (!nearest) return showToast("Рядом нет построек для сноса.");
  if (nearest.ownerKey && nearest.ownerKey !== state.playerKey) {
    return showToast(`⚠️ Это постройка игрока ${nearest.ownerName}!`);
  }
  delete state.structures[nearest.id];
  const m = structureMeshes.get(nearest.id);
  if (m) { structuresRoot.remove(m); structureMeshes.delete(nearest.id); }
  playSfx("chop");
  showToast("🔨 Постройка разобрана.");
  broadcastNetworkPacket({ type: "structure_removed", id: nearest.id }, true);
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
  keys[k] = true;
  if (!state.started) return;

  if (k === "KeyE") {
    if (state.buildMode) confirmPlaceBuilding();
    else executeInteraction(findNearestInteractable());
  } else if (k === "KeyI" || k === "Tab") { e.preventDefault(); openInventoryModal(); }
  else if (k === "KeyF") eatFoodAction();
  else if (k === "KeyC") openCraftModal();
  else if (k === "KeyB") { if (state.buildMode) exitBuildMode(); else openBuildModal(); }
  else if (k === "KeyR" && state.buildMode) state.buildRot = (state.buildRot + Math.PI / 2) % (Math.PI * 2);
  else if (k === "KeyX") demolishNearestStructure();
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
canvas.addEventListener("mousedown", (e) => {
  pointerLockedBeforeClick = document.pointerLockElement === canvas;
  if (state.started && modalBackdrop.style.display !== "flex" && document.pointerLockElement !== canvas) {
    try { canvas.requestPointerLock(); } catch {}
  }
  isDraggingCam = true;
  dragMoved = false;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});
window.addEventListener("mousemove", (e) => {
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
  if (pointerLockedBeforeClick && !dragMoved && state.started && e.button === 0) {
    if (state.buildMode) confirmPlaceBuilding();
    else executeInteraction(findNearestInteractable());
  }
  isDraggingCam = false;
});
canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); if (state.buildMode) exitBuildMode(); });
canvas.addEventListener("wheel", (e) => { state.camDist = Math.max(4.5, Math.min(24, state.camDist + e.deltaY * 0.01)); });
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
  toolsEl.innerHTML = "";
  if (state.tools.axe) toolsEl.innerHTML += `<span class="tool-chip">🪓 Стальной топор (x2 дерево)</span>`;
  if (state.tools.watering_can) toolsEl.innerHTML += `<span class="tool-chip">🚿 Садовая лейка</span>`;
  if (!state.tools.axe && !state.tools.watering_can) toolsEl.innerHTML = `<span class="tool-chip">✋ Ручной сбор</span>`;



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

const resetBtn = document.getElementById("reset-profile-btn");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    localStorage.removeItem("project_dacha3_profile_v1");
    window.location.reload();
  });
}

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
  fpHand.visible = state.firstPerson;
  camera.add(fpHand);

  ensureChunksAroundPlayer();
  refreshAllPlotSigns();
  for (const s of Object.values(state.structures)) {
    spawnOrUpdateStructureMesh(s);
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
    if (keys["KeyQ"]) state.camYaw += 1.8 * dt;

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

    const groundY = getTerrainHeight(state.x, state.z);
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

  if (state.buildMode && buildGhostGroup.visible) {
    const gPos = getBuildPreviewCoords();
    buildGhostGroup.position.set(gPos.x, gPos.y, gPos.z);
    buildGhostGroup.rotation.y = state.buildRot;
  }

  cropVisualAccum += dt;
  if (cropVisualAccum > 0.45) {
    cropVisualAccum = 0;
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

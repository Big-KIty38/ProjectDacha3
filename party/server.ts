import type * as Party from "partykit/server";

interface PlayerState {
  id: string;
  playerKey: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: string;
  money: number;
  plotsCount: number;
  lastSeen: number;
}

interface PlotOwnership {
  plotId: string;
  sntName: string;
  plotNum: number;
  ownerKey: string;
  ownerName: string;
  color: string;
  boughtAt: number;
}

interface StructureData {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  plotId: string;
  ownerKey: string;
  ownerName: string;
  crop: string | null;
  plantedAt: number;
  watered: boolean;
}

interface HarvestRecord {
  nodeId: string;
  permanent: boolean;
  time: number;
}

interface ChatMessage {
  id: string;
  sender: string;
  color: string;
  text: string;
  system?: boolean;
  time: number;
}

export default class DachaServer implements Party.Server {
  readonly WORLD_SEED = 20261111;
  players: Map<string, PlayerState> = new Map();
  plots: Record<string, PlotOwnership> = {};
  structures: Record<string, StructureData> = {};
  harvested: Record<string, HarvestRecord> = {};
  chatHistory: ChatMessage[] = [];
  initialized = false;

  constructor(readonly room: Party.Room) {}

  async ensureLoaded() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const resetEpoch = await this.room.storage.get<string>("resetEpoch");
      if (resetEpoch !== "dacha3_taiga_clean_epoch_v1") {
        await this.room.storage.deleteAll();
        await this.room.storage.put("resetEpoch", "dacha3_taiga_clean_epoch_v1");
      }
      const savedPlots = await this.room.storage.get<Record<string, PlotOwnership>>("plots");
      if (savedPlots) this.plots = savedPlots;

      const savedStructures = await this.room.storage.get<Record<string, StructureData>>("structures");
      if (savedStructures) this.structures = savedStructures;

      const savedHarvested = await this.room.storage.get<Record<string, HarvestRecord>>("harvested");
      if (savedHarvested) this.harvested = savedHarvested;

      const savedChat = await this.room.storage.get<ChatMessage[]>("chatHistory");
      if (savedChat) this.chatHistory = savedChat;
    } catch (e) {
      console.error("Storage load error:", e);
    }
  }

  cleanExpiredHarvests() {
    const now = Date.now();
    let changed = false;
    for (const [nodeId, rec] of Object.entries(this.harvested)) {
      // Forest trees/bushes respawn after 3 minutes; plot trees cleared by owner stay cleared
      if (!rec.permanent && now - rec.time > 180_000) {
        delete this.harvested[nodeId];
        changed = true;
      }
    }
    if (changed) {
      this.room.storage.put("harvested", this.harvested).catch(() => {});
    }
  }

  async onStart() {
    await this.ensureLoaded();
  }

  async onConnect(conn: Party.Connection) {
    await this.ensureLoaded();
    this.cleanExpiredHarvests();

    const defaultPlayer: PlayerState = {
      id: conn.id,
      playerKey: conn.id,
      name: "Дачник",
      color: "#2e7d32",
      x: 0,
      y: 0,
      z: 82,
      ry: 0,
      anim: "idle",
      money: 500,
      plotsCount: 0,
      lastSeen: Date.now()
    };
    this.players.set(conn.id, defaultPlayer);

    conn.send(
      JSON.stringify({
        type: "init",
        selfId: conn.id,
        worldSeed: this.WORLD_SEED,
        serverTime: Date.now(),
        players: Object.fromEntries(this.players),
        plots: this.plots,
        structures: this.structures,
        harvested: this.harvested,
        chatHistory: this.chatHistory.slice(-25)
      })
    );
  }

  async onMessage(message: string, sender: Party.Connection) {
    await this.ensureLoaded();
    let data: any;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const player = this.players.get(sender.id);
    if (!player) return;
    player.lastSeen = Date.now();

    switch (data.type) {
      case "join": {
        const cleanName = String(data.name || "Дачник").trim().slice(0, 22) || "Дачник";
        player.name = cleanName;
        player.color = String(data.color || "#2e7d32").slice(0, 16);
        player.playerKey = String(data.playerKey || sender.id).slice(0, 64);
        if (typeof data.x === "number") player.x = data.x;
        if (typeof data.y === "number") player.y = data.y;
        if (typeof data.z === "number") player.z = data.z;
        if (typeof data.money === "number") player.money = data.money;

        // Update ownerName on any plots already owned by this playerKey
        let plotsCount = 0;
        let plotsUpdated = false;
        for (const plot of Object.values(this.plots)) {
          if (plot.ownerKey === player.playerKey) {
            plotsCount++;
            if (plot.ownerName !== player.name || plot.color !== player.color) {
              plot.ownerName = player.name;
              plot.color = player.color;
              plotsUpdated = true;
            }
          }
        }
        player.plotsCount = plotsCount;
        if (plotsUpdated) {
          await this.room.storage.put("plots", this.plots);
        }

        this.room.broadcast(
          JSON.stringify({
            type: "player_joined",
            player,
            plots: plotsUpdated ? this.plots : undefined
          })
        );

        this.pushChat({
          id: `${Date.now()}-${Math.random()}`,
          sender: "СНТ-Инфо",
          color: "#ffd54f",
          text: `${player.name} приехал(а) в садоводство!`,
          system: true,
          time: Date.now()
        });
        break;
      }

      case "move": {
        if (typeof data.x === "number") player.x = data.x;
        if (typeof data.y === "number") player.y = data.y;
        if (typeof data.z === "number") player.z = data.z;
        if (typeof data.ry === "number") player.ry = data.ry;
        if (typeof data.anim === "string") player.anim = data.anim.slice(0, 16);
        if (typeof data.money === "number") player.money = Math.round(data.money);
        if (typeof data.plotsCount === "number") player.plotsCount = data.plotsCount;

        this.room.broadcast(
          JSON.stringify({
            type: "player_moved",
            id: sender.id,
            x: player.x,
            y: player.y,
            z: player.z,
            ry: player.ry,
            anim: player.anim,
            money: player.money,
            plotsCount: player.plotsCount
          }),
          [sender.id]
        );
        break;
      }

      case "action_fx": {
        this.room.broadcast(
          JSON.stringify({
            type: "action_fx",
            id: sender.id,
            kind: data.kind,
            x: data.x,
            y: data.y,
            z: data.z
          }),
          [sender.id]
        );
        break;
      }

      case "buy_plot": {
        const plotId = String(data.plotId || "");
        if (!plotId) return;
        const existing = this.plots[plotId];
        if (existing && existing.ownerKey !== player.playerKey) {
          sender.send(
            JSON.stringify({
              type: "error_msg",
              text: `Участок уже принадлежит игроку ${existing.ownerName}!`
            })
          );
          return;
        }

        const ownership: PlotOwnership = {
          plotId,
          sntName: String(data.sntName || "СНТ Лесное").slice(0, 40),
          plotNum: Number(data.plotNum || 1),
          ownerKey: player.playerKey,
          ownerName: player.name,
          color: player.color,
          boughtAt: Date.now()
        };
        this.plots[plotId] = ownership;
        player.plotsCount = Object.values(this.plots).filter(
          (p) => p.ownerKey === player.playerKey
        ).length;

        await this.room.storage.put("plots", this.plots);

        this.room.broadcast(
          JSON.stringify({
            type: "plot_bought",
            plot: ownership,
            buyerId: sender.id,
            plotsCount: player.plotsCount
          })
        );

        this.pushChat({
          id: `${Date.now()}-${Math.random()}`,
          sender: "Кадастр СНТ",
          color: "#81c784",
          text: `${player.name} приобрёл участок №${ownership.plotNum} (${ownership.sntName})!`,
          system: true,
          time: Date.now()
        });
        break;
      }

      case "harvest_node": {
        const nodeId = String(data.nodeId || "");
        if (!nodeId) return;
        const permanent = Boolean(data.permanent);
        const rec: HarvestRecord = {
          nodeId,
          permanent,
          time: Date.now()
        };
        this.harvested[nodeId] = rec;
        await this.room.storage.put("harvested", this.harvested);

        this.room.broadcast(
          JSON.stringify({
            type: "node_harvested",
            nodeId,
            permanent,
            harvesterId: sender.id,
            x: data.x,
            y: data.y,
            z: data.z,
            kind: data.kind
          })
        );
        break;
      }

      case "place_structure": {
        const s = data.structure;
        if (!s || !s.id || !s.type) return;
        const item: StructureData = {
          id: String(s.id),
          type: String(s.type),
          x: Number(s.x) || 0,
          y: Number(s.y) || 0,
          z: Number(s.z) || 0,
          rot: Number(s.rot) || 0,
          plotId: String(s.plotId || ""),
          ownerKey: player.playerKey,
          ownerName: player.name,
          crop: s.crop ? String(s.crop) : null,
          plantedAt: Number(s.plantedAt) || 0,
          watered: Boolean(s.watered)
        };
        this.structures[item.id] = item;
        await this.room.storage.put("structures", this.structures);

        this.room.broadcast(
          JSON.stringify({
            type: "structure_placed",
            structure: item
          })
        );
        break;
      }

      case "remove_structure": {
        const id = String(data.id || "");
        const target = this.structures[id];
        if (!target) return;
        delete this.structures[id];
        await this.room.storage.put("structures", this.structures);

        this.room.broadcast(
          JSON.stringify({
            type: "structure_removed",
            id
          })
        );
        break;
      }

      case "update_crop": {
        const id = String(data.id || "");
        const target = this.structures[id];
        if (!target) return;
        target.crop = data.crop ? String(data.crop) : null;
        target.plantedAt = Number(data.plantedAt) || 0;
        target.watered = Boolean(data.watered);
        await this.room.storage.put("structures", this.structures);

        this.room.broadcast(
          JSON.stringify({
            type: "crop_updated",
            id: target.id,
            crop: target.crop,
            plantedAt: target.plantedAt,
            watered: target.watered,
            serverTime: Date.now()
          })
        );
        break;
      }

      case "chat": {
        const text = String(data.text || "").trim().slice(0, 180);
        if (!text) return;
        this.pushChat({
          id: `${Date.now()}-${Math.random()}`,
          sender: player.name,
          color: player.color,
          text,
          system: false,
          time: Date.now()
        });
        break;
      }
    }
  }

  pushChat(msg: ChatMessage) {
    this.chatHistory.push(msg);
    if (this.chatHistory.length > 40) {
      this.chatHistory = this.chatHistory.slice(-40);
    }
    this.room.storage.put("chatHistory", this.chatHistory).catch(() => {});
    this.room.broadcast(
      JSON.stringify({
        type: "chat_msg",
        message: msg
      })
    );
  }

  onClose(conn: Party.Connection) {
    const p = this.players.get(conn.id);
    this.players.delete(conn.id);
    this.room.broadcast(
      JSON.stringify({
        type: "player_left",
        id: conn.id
      })
    );
    if (p && p.name) {
      this.pushChat({
        id: `${Date.now()}-${Math.random()}`,
        sender: "СНТ-Инфо",
        color: "#b0bec5",
        text: `${p.name} уехал(а) с дачи.`,
        system: true,
        time: Date.now()
      });
    }
  }

  async onRequest(req: Party.Request) {
    await this.ensureLoaded();
    return new Response(
      JSON.stringify({
        ok: true,
        game: "ProjectDacha3",
        onlinePlayers: this.players.size,
        claimedPlots: Object.keys(this.plots).length,
        structuresCount: Object.keys(this.structures).length
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
}

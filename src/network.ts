import type { Input } from "./simulation";
import { tracks } from "./track";
import { MAX_LAPS } from "./simulation";
export interface NetKart {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angular: number;
  grip: number;
  lap: number;
  gates: number;
  nextGate: number;
  finish: number;
  lapTimes: number[];
  lapStartedAt: number;
  resetRemaining: number;
  respawnGrace: number;
  draft: number;
  segment: number;
  input: Input;
}
export interface Member {
  id: string;
  name: string;
  kart: number;
  ready: boolean;
  connected: boolean;
  dnf: boolean;
  seq: number;
}
export interface RoomState {
  type: "state";
  code: string;
  hostId: string;
  phase: "lobby" | "countdown" | "racing" | "podium";
  track: string;
  laps: number;
  countdown: number;
  raceId: number;
  time: number;
  finishRemaining: number | null;
  members: Member[];
  karts: NetKart[];
  order: number[];
}
export function serverAddress(value: string) {
  const url = new URL(value);
  if (url.username || url.password)
    throw Error("Use a server address without a login.");
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  if (!["ws:", "wss:"].includes(url.protocol))
    throw Error("Use the HTTPS address printed by your PC launcher.");
  if (location.protocol === "https:" && url.protocol !== "wss:")
    throw Error(
      "Online invites need the secure HTTPS address from your PC launcher.",
    );
  url.pathname = "/race";
  url.search = "";
  url.hash = "";
  return url.toString();
}
export class OnlineClient {
  socket?: WebSocket;
  id = "";
  token = "";
  code = "";
  endpoint = "";
  name = "";
  state?: RoomState;
  seq = 0;
  latency = 0;
  connected = false;
  closed = false;
  reconnects = 0;
  timer?: ReturnType<typeof setInterval>;
  retry?: ReturnType<typeof setTimeout>;
  constructor(
    public onState: (state: RoomState) => void,
    public onStatus: (message: string) => void,
  ) {}
  connect(endpoint: string, name: string, code = "") {
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
    clearInterval(this.timer);
    clearTimeout(this.retry);
    this.closed = false;
    this.endpoint = serverAddress(endpoint);
    this.name = name;
    this.code = code.toUpperCase();
    try {
      this.token =
        sessionStorage.getItem(
          `slipstream-seat:${this.endpoint}:${this.code}`,
        ) || "";
    } catch {}
    this.open(!code);
    this.timer = setInterval(
      () => this.send({ type: "ping", at: Date.now() }),
      2000,
    );
  }
  open(create = false) {
    if (this.closed) return;
    this.socket = new WebSocket(this.endpoint);
    const socket = this.socket;
    const timeout = setTimeout(() => {
      if (!this.connected) {
        this.onStatus(
          "Cannot reach the game server. Check that the PC and launcher are running.",
        );
        socket.close();
      }
    }, 8000);
    socket.onopen = () => {
      this.connected = true;
      clearTimeout(timeout);
      this.send({
        type: create ? "create" : "join",
        name: this.name,
        code: this.code,
        token: this.token,
      });
    };
    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "welcome") {
        this.id = data.id;
        this.token = data.token;
        this.code = data.code;
        this.reconnects = 0;
        try {
          sessionStorage.setItem(
            `slipstream-seat:${this.endpoint}:${this.code}`,
            this.token,
          );
        } catch {}
        this.onStatus("");
      } else if (data.type === "state") {
        this.state = data;
        this.onState(data);
      } else if (data.type === "error") {
        this.onStatus(data.message);
        if (!this.state) {
          this.closed = true;
          this.connected = false;
          socket.close();
        }
      } else if (data.type === "pong") this.latency = Date.now() - data.at;
    };
    socket.onerror = () =>
      this.onStatus("Connection failed. Check the PC server address.");
    socket.onclose = () => {
      clearTimeout(timeout);
      this.connected = false;
      if (this.closed) return;
      if (this.code && this.token && this.reconnects++ < 8) {
        this.onStatus("Connection lost — reconnecting…");
        this.retry = setTimeout(() => this.open(), 2000);
      } else
        this.onStatus(
          "Disconnected. Return to the garage and ask the host for a new invite.",
        );
    };
  }
  send(data: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(data));
  }
  /** Sends driving input and returns its sequence number. */
  input(input: Input, reset = false) {
    const seq = this.seq++;
    this.send({ type: "input", ...input, reset, seq });
    return seq;
  }
  invite() {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("server", this.endpoint);
    url.searchParams.set("room", this.code);
    url.hash = "";
    return url.toString();
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.retry);
    this.send({ type: "leave" });
    this.socket?.close();
  }
}
export class RoomPanel {
  root: HTMLDivElement;
  status: HTMLElement;
  body: HTMLElement;
  constructor(
    public client: OnlineClient,
    public leave: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "room-overlay";
    this.root.innerHTML =
      '<section class="room-board"><h1>RACE WITH FRIENDS</h1><div class="room-body"></div><p class="room-status" role="status"></p><button class="room-back" type="button">BACK TO GARAGE</button></section>';
    document.body.append(this.root);
    this.body = this.root.querySelector(".room-body")!;
    this.status = this.root.querySelector(".room-status")!;
    this.root.querySelector(".room-back")!.addEventListener("click", leave);
  }
  setup() {
    this.body.innerHTML =
      '<form><label>DRIVER NAME<input name="driver" maxlength="12" required autocomplete="off" value="Racer"></label><label>PC SERVER ADDRESS<input name="server" required placeholder="https://…trycloudflare.com" autocomplete="off"></label><label>ROOM CODE<input name="code" maxlength="6" placeholder="Leave blank to create a room" autocomplete="off"></label><button type="submit">CREATE / JOIN ROOM</button><p class="room-hint">Host: run the PC multiplayer launcher first.<br>Friend: open the invite link from the host.</p></form>';
    const form = this.body.querySelector("form")!,
      q = new URLSearchParams(location.search);
    const server = form.elements.namedItem("server") as HTMLInputElement,
      code = form.elements.namedItem("code") as HTMLInputElement;
    server.value =
      q.get("server") ||
      (location.hostname === "localhost" || location.hostname === "127.0.0.1"
        ? `${location.protocol}//${location.host}`
        : "");
    code.value = q.get("room") || "";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.client.socket?.readyState === WebSocket.OPEN) {
        this.status.textContent =
          "Already connected. Leave before joining another room.";
        return;
      }
      try {
        this.status.textContent = "Connecting…";
        this.client.connect(
          server.value,
          (form.elements.namedItem("driver") as HTMLInputElement).value,
          code.value,
        );
      } catch (e) {
        this.status.textContent = (e as Error).message;
      }
    });
  }
  lobby(state: RoomState) {
    this.root.style.display = "grid";
    this.body.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = `ROOM ${state.code}`;
    this.body.append(title);
    const hint = document.createElement("p");
    hint.textContent = "Everyone ready? The host can start the race.";
    this.body.append(hint);
    const list = document.createElement("ul");
    for (const member of state.members) {
      const row = document.createElement("li");
      row.textContent = `${member.name}${member.id === this.client.id ? " (YOU)" : ""}${member.id === state.hostId ? " · HOST" : ""} — ${member.connected ? (member.ready ? "READY" : "GETTING READY") : "RECONNECTING"}`;
      list.append(row);
    }
    // The host chooses the circuit and distance; everyone else sees them.
    const isHost = state.hostId === this.client.id;
    const setting = (
      label: string,
      options: [string, string][],
      value: string,
      change: (value: string) => void,
    ) => {
      const row = document.createElement("label");
      row.textContent = label;
      if (isHost) {
        const select = document.createElement("select");
        for (const [id, text] of options) select.add(new Option(text, id));
        select.value = value;
        select.onchange = () => change(select.value);
        row.append(select);
      } else {
        const chosen = document.createElement("strong");
        chosen.className = "room-track";
        chosen.textContent = options.find(([id]) => id === value)?.[1] ?? value;
        row.append(chosen);
      }
      this.body.append(row);
    };
    setting(
      "TRACK",
      Object.values(tracks).map((t) => [t.id, t.name]),
      state.track,
      (track) => this.client.send({ type: "track", track }),
    );
    setting(
      "LAPS",
      Array.from({ length: MAX_LAPS }, (_, i) => [
        String(i + 1),
        `${i + 1} LAP${i ? "S" : ""}`,
      ]),
      String(state.laps),
      (laps) => this.client.send({ type: "laps", laps: Number(laps) }),
    );
    this.body.append(list);
    const me = state.members.find((m) => m.id === this.client.id);
    const button = (text: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.onclick = fn;
      this.body.append(b);
      return b;
    };
    button(me?.ready ? "NOT READY" : "READY UP", () =>
      this.client.send({ type: "ready", ready: !me?.ready }),
    );
    button("COPY INVITE LINK", () => {
      navigator.clipboard
        .writeText(this.client.invite())
        .then(
          () =>
            (this.status.textContent =
              "Invite copied — send it to your friend."),
        )
        .catch(() => {
          const input = document.createElement("input");
          input.value = this.client.invite();
          input.readOnly = true;
          this.body.append(input);
          input.select();
          this.status.textContent = "Copy the selected invite link.";
        });
    });
    if (state.hostId === this.client.id) {
      const start = button("START RACE", () =>
        this.client.send({ type: "start" }),
      );
      start.disabled =
        state.members.length < 2 ||
        !state.members.every((m) => m.ready && m.connected);
    }
  }
  hide() {
    this.root.style.display = "none";
  }
  destroy() {
    this.root.remove();
  }
}

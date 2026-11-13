import type { Input } from "./simulation";
import { tracks } from "./track";
import { MAX_LAPS, MAX_KARTS, SERIES } from "./simulation";
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
  boost: number;
  driftCharge: number;
  driftDir: number;
  railTurn: number;
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
  /** Room leaderboard total over every race so far. */
  points: number;
}
/** Final standings of a race, best first. `points` is what the race earned
 * (place points plus the fastest-lap bonus) and `total` the room score. */
export interface RaceResults {
  rows: {
    kart: number;
    name: string;
    finish: number;
    points: number;
    total: number;
  }[];
  fastestLap: { kart: number; time: number } | null;
  /** Race number within the championship, its length (0 = free play) and
   * whether this race decided it. */
  round: number;
  series: number;
  final: boolean;
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
  results: RaceResults | null;
  /** Championship length (0 = free play) and races run so far. */
  series: number;
  round: number;
  /** Winner of the last finished championship, or "". */
  champion: string;
  /** Easy mode is on (see EASY in simulation.ts). */
  easy: boolean;
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
    throw Error("That is not a game server address.");
  if (location.protocol === "https:" && url.protocol !== "wss:")
    throw Error("This invite link is out of date. Ask the host for a new one.");
  url.pathname = "/race";
  url.search = "";
  url.hash = "";
  return url.toString();
}
/** The game server to use: normally the site this page was opened from. An
 * old-style invite can still name one with ?server=, and the Vite dev page
 * (port 5173) uses the local server on port 8080. */
export function defaultServer() {
  return (
    new URLSearchParams(location.search).get("server") ||
    (location.port === "5173"
      ? `http://${location.hostname}:8080`
      : location.origin)
  );
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
          "Cannot reach the game server. Ask the host to check it is still running.",
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
      this.onStatus("Could not connect to the game server.");
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
    // The page itself is normally the game server, so the code is enough.
    if (this.endpoint !== serverAddress(location.origin))
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
const nameKey = "slipstream-name";
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
export class RoomPanel {
  root: HTMLDivElement;
  title: HTMLElement;
  subtitle: HTMLElement;
  status: HTMLElement;
  body: HTMLElement;
  back: HTMLElement;
  constructor(
    public client: OnlineClient,
    public actions: {
      leave: () => void;
      settings: () => void;
      /** CSS colour of each kart, by kart number. */
      colors: string[];
    },
  ) {
    this.root = document.createElement("div");
    this.root.className = "room-overlay";
    this.root.innerHTML =
      '<section class="room-board"><h1></h1><p class="menu-sub"></p><div class="room-body"></div><p class="room-status" role="status"></p><div class="room-actions"><button class="room-back room-settings" type="button">SETTINGS</button><button class="room-back room-leave" type="button"></button></div></section>';
    document.body.append(this.root);
    this.title = this.root.querySelector("h1")!;
    this.subtitle = this.root.querySelector(".menu-sub")!;
    this.body = this.root.querySelector(".room-body")!;
    this.status = this.root.querySelector(".room-status")!;
    this.back = this.root.querySelector(".room-leave")!;
    this.back.addEventListener("click", actions.leave);
    this.root
      .querySelector(".room-settings")!
      .addEventListener("click", actions.settings);
  }
  heading(title: string, subtitle: string, back: string) {
    this.title.textContent = title;
    this.subtitle.textContent = subtitle;
    this.back.textContent = back;
  }
  /** First screen: pick a name, then join with a code or host a new room. */
  setup() {
    const invited = (new URLSearchParams(location.search).get("room") || "")
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 6)
      .toUpperCase();
    this.heading(
      "RACE WITH FRIENDS",
      invited
        ? `YOU ARE INVITED TO ROOM ${invited}`
        : `ONLINE RACES FOR UP TO ${MAX_KARTS} DRIVERS`,
      "BACK TO GARAGE",
    );
    const join =
      '<h3>JOIN A RACE</h3><div class="room-join"><input name="code" maxlength="6" placeholder="ROOM CODE" autocomplete="off" spellcheck="false" aria-label="Room code"><button type="submit">JOIN ROOM</button></div>';
    const host =
      '<h3>HOST A RACE</h3><button type="button" name="create">CREATE A ROOM</button><p class="room-hint">You get a room code and an invite link to send to your friends.</p>';
    this.body.innerHTML = `<form novalidate><label>DRIVER NAME<input name="driver" maxlength="12" autocomplete="off" spellcheck="false"></label>${invited ? join + host : host + join}</form>`;
    const form = this.body.querySelector("form")!;
    const driver = form.elements.namedItem("driver") as HTMLInputElement,
      code = form.elements.namedItem("code") as HTMLInputElement,
      create = form.elements.namedItem("create") as HTMLButtonElement,
      joinButton = form.querySelector<HTMLButtonElement>(".room-join button")!;
    // The gold button is the likely next step; the other one is quieter.
    (invited ? create : joinButton).classList.add("room-back");
    code.value = invited;
    try {
      driver.value = localStorage.getItem(nameKey) || "";
    } catch {
      /* Storage may be disabled. */
    }
    code.addEventListener(
      "input",
      () => (code.value = code.value.replace(/[^a-z0-9]/gi, "").toUpperCase()),
    );
    const connect = (room: string) => {
      const name = driver.value.trim();
      if (!name) {
        this.status.textContent = "Type a driver name first.";
        driver.focus();
        return;
      }
      if (this.client.socket?.readyState === WebSocket.OPEN) {
        this.status.textContent = "Already connecting. One moment…";
        return;
      }
      try {
        localStorage.setItem(nameKey, name);
      } catch {
        /* The name still applies for this visit. */
      }
      try {
        this.status.textContent = room
          ? `Joining room ${room}…`
          : "Creating your room…";
        this.client.connect(defaultServer(), name, room);
      } catch (e) {
        this.status.textContent = (e as Error).message;
      }
    };
    create.addEventListener("click", () => connect(""));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (code.value) connect(code.value);
      else {
        this.status.textContent =
          "Type the room code from your invite, or create a room.";
        code.focus();
      }
    });
    (driver.value ? (invited ? joinButton : create) : driver).focus();
  }
  lobby(state: RoomState) {
    const isHost = state.hostId === this.client.id;
    const everyoneReady = state.members.every((m) => m.ready && m.connected);
    this.heading(
      "RACE LOBBY",
      `${state.members.length} OF ${MAX_KARTS} DRIVERS  /  ${state.series ? `RACE ${state.round + 1} OF ${state.series}` : "FREE PLAY"}  /  ${isHost ? "YOU ARE THE HOST" : "THE HOST STARTS"}`,
      "LEAVE ROOM",
    );
    this.body.replaceChildren();
    const button = (text: string, fn: () => void, quiet = false) => {
      const b = element("button", quiet ? "room-back" : "", text);
      b.type = "button";
      b.onclick = fn;
      return b;
    };
    // Room code with the invite button beside it.
    const code = element("div", "room-code");
    const label = element("div");
    label.append(
      element("span", "room-hint", "ROOM CODE"),
      element("strong", "", state.code),
    );
    const copy = button("COPY INVITE LINK", () => {
      navigator.clipboard
        .writeText(this.client.invite())
        .then(() => {
          copy.textContent = "LINK COPIED";
          this.status.textContent = "Invite copied. Send it to your friends.";
        })
        .catch(() => {
          const input = document.createElement("input");
          input.value = this.client.invite();
          input.readOnly = true;
          code.after(input);
          input.select();
          this.status.textContent = "Copy the selected invite link.";
        });
    });
    code.append(label, copy);
    this.body.append(code);
    const settings = element("div", "room-options");
    this.body.append(settings);
    // The host chooses the circuit, distance and format; everyone else sees
    // them.
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
      settings.append(row);
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
    setting(
      "FORMAT",
      SERIES.map((races) => [
        String(races),
        races ? `${races} RACE CUP` : "FREE PLAY",
      ]),
      String(state.series),
      (series) => this.client.send({ type: "series", series: Number(series) }),
    );
    setting(
      "DIFFICULTY",
      [
        ["0", "NORMAL"],
        ["1", "EASY - GUARD RAILS"],
      ],
      state.easy ? "1" : "0",
      (easy) => this.client.send({ type: "easy", easy: easy === "1" }),
    );
    // Once points are on the board the list is the room leaderboard.
    const scored = state.members.some((m) => m.points > 0);
    this.body.append(element("h3", "", scored ? "LEADERBOARD" : "DRIVERS"));
    const list = element("ul", "room-drivers");
    for (const member of [...state.members].sort(
      (a, b) => b.points - a.points,
    )) {
      const row = element("li");
      const swatch = element("i");
      swatch.style.background = this.actions.colors[member.kart] ?? "#edf0da";
      const name = element("span", "room-name", member.name);
      if (member.id === this.client.id)
        name.append(element("small", "", "YOU"));
      if (member.id === state.hostId) name.append(element("small", "", "HOST"));
      const mood = !member.connected
        ? "RECONNECTING"
        : member.ready
          ? "READY"
          : "NOT READY";
      const chip = element("span", "room-chip", mood);
      chip.dataset.mood = mood;
      row.append(swatch, name);
      if (scored)
        row.append(element("span", "room-points", `${member.points} PTS`));
      row.append(chip);
      list.append(row);
    }
    this.body.append(list);
    const me = state.members.find((m) => m.id === this.client.id);
    this.body.append(
      button(
        me?.ready ? "CANCEL READY" : "READY UP",
        () => this.client.send({ type: "ready", ready: !me?.ready }),
        !!me?.ready,
      ),
    );
    let hint = everyoneReady
      ? "Everyone is ready. Waiting for the host to start."
      : "The race can start once every driver is ready.";
    if (isHost) {
      const start = button("START RACE", () =>
        this.client.send({ type: "start" }),
      );
      start.disabled = state.members.length < 2 || !everyoneReady;
      this.body.append(start);
      hint =
        state.members.length < 2
          ? "Send the invite link to a friend. You need at least 2 drivers."
          : everyoneReady
            ? "Everyone is ready. Start when you like."
            : "You can start once every driver is ready.";
    }
    if (state.champion && state.round === 0)
      hint += ` Last cup won by ${state.champion}.`;
    this.body.append(element("p", "room-hint", hint));
  }
  show() {
    this.root.style.display = "grid";
  }
  hide() {
    this.root.style.display = "none";
  }
  destroy() {
    this.root.remove();
  }
}

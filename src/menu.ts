// Garage, settings and pit menus. They are HTML drawn over the game (like the
// online lobby) so the text is sharp at the screen's full resolution instead
// of being scaled up with the pixel-art canvas.
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
export class Menu {
  root = element("div", "room-overlay");
  board = element("section", "room-board");
  constructor() {
    this.root.style.display = "none";
    this.root.append(this.board);
    document.body.append(this.root);
  }
  get isOpen() {
    return this.root.style.display !== "none";
  }
  open(title: string, subtitle: string) {
    this.board.classList.remove("room-wide");
    this.board.replaceChildren(
      element("h1", "", title),
      element("p", "menu-sub", subtitle),
    );
    this.root.style.display = "grid";
    return this;
  }
  close() {
    this.root.style.display = "none";
    this.board.replaceChildren();
  }
  button(
    label: string,
    action: () => void,
    { primary = false, key = "" } = {},
  ) {
    const button = element(
      "button",
      primary ? "menu-button" : "menu-button room-back",
    );
    button.type = "button";
    button.append(element("span", "", label));
    if (key) button.append(element("span", "menu-key", key));
    button.addEventListener("click", action);
    this.board.append(button);
    return this;
  }
  /** Adds ready-made content, such as the podium. */
  add(node: HTMLElement, wide = false) {
    this.board.classList.toggle("room-wide", wide);
    this.board.append(node);
    return this;
  }
  heading(text: string) {
    this.board.append(element("h3", "", text));
    return this;
  }
  note(text: string) {
    this.board.append(element("p", "room-hint", text));
    return this;
  }
  /** A 0 to 1 volume slider. */
  slider(
    label: string,
    value: number,
    change: (value: number) => void,
    released?: () => void,
  ) {
    const row = element("label", "menu-row"),
      input = element("input"),
      readout = element("span", "menu-value");
    const show = () => (readout.textContent = `${input.value}%`);
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "5";
    input.value = String(Math.round(value * 100));
    show();
    input.addEventListener("input", () => {
      show();
      change(Number(input.value) / 100);
    });
    if (released) input.addEventListener("change", released);
    row.append(element("span", "", label), input, readout);
    this.board.append(row);
    return this;
  }
  toggle(label: string, value: boolean, change: (value: boolean) => void) {
    const row = element("label", "menu-check"),
      input = element("input");
    input.type = "checkbox";
    input.checked = value;
    input.addEventListener("change", () => change(input.checked));
    row.append(input, element("span", "", label));
    this.board.append(row);
    return this;
  }
  keys(rows: [string, string][]) {
    const list = element("dl", "menu-keys");
    for (const [key, action] of rows)
      list.append(element("dt", "", key), element("dd", "", action));
    this.board.append(list);
    return this;
  }
}

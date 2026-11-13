// The podium, built as HTML for the menu board (src/menu.ts) so it is as
// sharp as the other menus. Online races also show the room leaderboard
// points (see award() in server/rooms.mjs).
import { formatTime } from "./records";
import type { RaceResults } from "./network";
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
/** The end of a cup: the winner, then everyone's final points. */
export function championContent(
  results: RaceResults,
  options: { me: number; colors: string[]; icon: (kart: number) => string },
) {
  const root = element("div", "podium");
  // Most points wins; rows arrive in finishing order, which breaks ties.
  const standings = [...results.rows].sort((a, b) => b.total - a.total);
  const winner = standings[0];
  if (winner) {
    const hero = element("div", "champion");
    const icon = element("img");
    icon.src = options.icon(winner.kart);
    icon.alt = "";
    hero.append(
      icon,
      element("strong", "", winner.name),
      element("span", "", `${winner.total} POINTS`),
    );
    root.append(hero);
  }
  const table = element("table", "podium-table");
  standings.forEach((row, place) => {
    const line = element("tr", row.kart === options.me ? "podium-me" : "");
    const name = element("td", "podium-driver");
    const swatch = element("i");
    swatch.style.background = options.colors[row.kart] ?? "#edf0da";
    name.append(swatch, row.name);
    line.append(
      element("td", "", String(place + 1)),
      name,
      element("td", "", `${row.total} PTS`),
    );
    table.append(line);
  });
  root.append(table);
  return root;
}
export function podiumContent(
  results: RaceResults,
  options: {
    /** Our own kart, highlighted in the table. */
    me: number;
    /** Show the points columns (online rooms). */
    points: boolean;
    /** What to show for a kart with no finish time. */
    unfinished: string;
    colors: string[];
    /** Image URL of a kart's sprite. */
    icon: (kart: number) => string;
  },
) {
  const root = element("div", "podium");
  const finishers = results.rows.filter((row) => row.finish > 0);
  const steps = element("div", "podium-steps");
  // Second, first, third: the winner stands in the middle.
  for (const place of [1, 0, 2]) {
    const row = finishers[place],
      step = element("div", "podium-step");
    step.dataset.place = String(place + 1);
    if (row) {
      const icon = element("img");
      icon.src = options.icon(row.kart);
      icon.alt = "";
      step.append(element("span", "podium-name", row.name), icon);
    } else step.append(element("span", "podium-name", "—"));
    const block = element("div", "podium-block");
    block.append(
      element("b", "", String(place + 1)),
      element("span", "", row ? formatTime(row.finish) : ""),
    );
    step.append(block);
    steps.append(step);
  }
  root.append(steps);
  const fastest = results.fastestLap;
  if (fastest) {
    const line = element("p", "podium-fastest");
    line.append(
      element("span", "", "FASTEST LAP"),
      element(
        "strong",
        "",
        results.rows.find((row) => row.kart === fastest.kart)?.name ?? "Racer",
      ),
      element("span", "", formatTime(fastest.time)),
    );
    if (options.points) line.append(element("em", "", "+1 PT"));
    root.append(line);
  }
  const table = element("table", "podium-table");
  if (options.points) {
    const head = element("tr");
    for (const title of ["", "DRIVER", "TIME", "RACE", "TOTAL"])
      head.append(element("th", "", title));
    table.append(head);
  }
  results.rows.forEach((row, place) => {
    const line = element("tr", row.kart === options.me ? "podium-me" : "");
    const name = element("td", "podium-driver");
    const swatch = element("i");
    swatch.style.background = options.colors[row.kart] ?? "#edf0da";
    name.append(swatch, row.name);
    if (fastest?.kart === row.kart)
      name.append(element("small", "", "FASTEST LAP"));
    line.append(
      element("td", "", String(place + 1)),
      name,
      element(
        "td",
        "",
        row.finish ? formatTime(row.finish) : options.unfinished,
      ),
    );
    if (options.points)
      line.append(
        element("td", "podium-gain", `+${row.points}`),
        element("td", "", `${row.total} PTS`),
      );
    table.append(line);
  });
  root.append(table);
  return root;
}

export interface Records {
  lap: number | null;
  race: number | null;
}
// v3: races became 6 laps at a higher top speed, so older times no longer
// compare. Each track keeps its own records.
export const recordKey = (trackId = "foundry") =>
  `slipstream.${trackId}.v3.records`;
export function readRecords(
  storage: Pick<Storage, "getItem">,
  trackId?: string,
): Records {
  try {
    const data = JSON.parse(storage.getItem(recordKey(trackId)) || "{}");
    const valid = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value) && value > 0;
    return {
      lap: valid(data?.lap) ? data.lap : null,
      race: valid(data?.race) ? data.race : null,
    };
  } catch {
    return { lap: null, race: null };
  }
}
export function improveRecord(previous: number | null, time: number) {
  return Number.isFinite(time) && time > 0
    ? Math.min(previous ?? Infinity, time)
    : previous;
}
export function formatTime(seconds: number | null) {
  if (seconds === null) return "--:--.--";
  const centiseconds = Math.floor(seconds * 100 + 1e-7);
  return `${Math.floor(centiseconds / 6000)}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

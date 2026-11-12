export interface Records {
  lap: number | null;
  race: number | null;
}
export const recordKey = "slipstream.foundry.v2.records";
export function readRecords(storage: Pick<Storage, "getItem">): Records {
  try {
    const data = JSON.parse(storage.getItem(recordKey) || "{}");
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

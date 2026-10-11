export function statusLabel(s: string) {
  return s === "votare" ? "În votare" : s === "finalizata" ? "Finalizată" : "În organizare";
}
export type MemberScore = { user_id: string; name: string; score: number };
export const MAX_DAY_HOURS = 10;

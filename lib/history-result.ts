import { resultValue } from "./match.ts";

type ResultLine = { total: number; surrenderReason?: string | null };

/** Derive concession results from saved seats; legacy games may omit the reason. */
export function historyResult(player: ResultLine, opponents: ResultLine[]) {
  const surrenderReason = player.surrenderReason ?? null;
  const value = resultValue(player.total, surrenderReason);
  const best = Math.max(...opponents.map((other) => resultValue(other.total, other.surrenderReason)));
  const outcome = surrenderReason ? "loss" : !opponents.length ? "solo"
    : value > best ? "win" : value === best ? "tie" : "loss";
  // A multiplayer score win with just one conceding seat is still a score win.
  const wonBySurrender = outcome === "win" && opponents.every((other) => Boolean(other.surrenderReason));
  const label = surrenderReason === "automatic" ? "自動投降（敗）"
    : surrenderReason ? "手動投降（敗）"
    : wonBySurrender ? "對手投降獲勝"
    : outcome === "win" ? "獲勝" : outcome === "tie" ? "平手"
    : outcome === "solo" ? "單人對局" : "落敗";
  return { outcome, surrenderReason, wonBySurrender, label };
}

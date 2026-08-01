export type BrowserSession = {
  code: string;
  playerId: string;
  token: string;
  name: string;
};

export function upsertBrowserSession(
  sessions: BrowserSession[],
  session: BrowserSession,
  limit = 20,
) {
  const others = sessions.filter(
    (item) => item.code !== session.code || item.playerId !== session.playerId,
  );
  return [...others, session].slice(-limit);
}

/**
 * The identity this tab already owns, or null.
 *
 * `activePlayerId` comes from sessionStorage, which is per-tab, so a match
 * proves *this* tab joined as that player. There is deliberately no fallback
 * to "the most recent session for this room": localStorage is shared between
 * tabs, so falling back would make a second tab silently resume the first
 * tab's player instead of joining as someone new.
 */
export function selectBrowserSession(
  sessions: BrowserSession[],
  code: string,
  activePlayerId: string | null,
) {
  if (!activePlayerId) return null;
  return (
    sessions.find(
      (item) => item.code === code && item.playerId === activePlayerId,
    ) ?? null
  );
}

/**
 * The most recent identity used in this room by any tab in this browser.
 * Offered to the player as an explicit "continue as ..." choice — never
 * applied automatically. See {@link selectBrowserSession}.
 */
export function findResumableSession(sessions: BrowserSession[], code: string) {
  const candidates = sessions.filter((item) => item.code === code);
  return candidates[candidates.length - 1] ?? null;
}

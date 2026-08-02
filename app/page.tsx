"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  categories,
  scoreDice,
  scoreSummary,
  type CategoryId,
} from "@/lib/game";
import {
  findResumableSession,
  selectBrowserSession,
  upsertBrowserSession,
  type BrowserSession as Session,
} from "@/lib/browser-session";

type RoomState = {
  room: {
    id: string;
    code: string;
    status: "waiting" | "playing" | "finished";
    maxPlayers: number;
    hostPlayerId: string;
    currentSeat: number;
    round: number;
    dice: number[];
    held: boolean[];
    rollsUsed: number;
    turnDeadline: string | null;
    createdAt: string;
    updatedAt: string;
    finishedAt: string | null;
  };
  players: Array<{ id: string; name: string; seat: number }>;
  scores: Array<{ playerId: string; category: string; score: number }>;
};

type HistoryGame = {
  code: string;
  finishedAt: string;
  players: Array<{
    id: string;
    name: string;
    isMe?: boolean;
    scores: Array<{ category: string; score: number }>;
  }>;
};

type AccountUser = {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
};

type AccountProfile = {
  user: AccountUser;
  stats: { games: number; wins: number; bestScore: number; averageScore: number };
  games: HistoryGame[];
};

const SESSION_KEY = "yazy-club-sessions";
const ACTIVE_SESSION_PREFIX = "yazy-club-active-player";
const EMPTY_SCORE_SUMMARY = { upper: 0, bonus: 0, lower: 0, total: 0 };
const pipPositions: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};
const dieRotations: Record<number, { x: string; y: string }> = {
  1: { x: "0deg", y: "0deg" },
  2: { x: "-90deg", y: "0deg" },
  3: { x: "0deg", y: "-90deg" },
  4: { x: "0deg", y: "90deg" },
  5: { x: "90deg", y: "0deg" },
  6: { x: "0deg", y: "180deg" },
};

function DiceCube({ value }: { value: number }) {
  const rotation = dieRotations[value] ?? dieRotations[1];
  const style = {
    "--die-x": rotation.x,
    "--die-y": rotation.y,
  } as CSSProperties;

  return (
    <span aria-hidden="true" className="die-cube" style={style}>
      {[1, 2, 3, 4, 5, 6].map((face) => (
        <span className={`die-face face-${face}`} key={face}>
          {pipPositions[face].map((position) => (
            <i className={`pip pip-${position}`} key={position} />
          ))}
        </span>
      ))}
    </span>
  );
}

function readSessions(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "[]") as Session[];
  } catch {
    return [];
  }
}

function saveSession(session: Session) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify(upsertBrowserSession(readSessions(), session)),
  );
  sessionStorage.setItem(`${ACTIVE_SESSION_PREFIX}:${session.code}`, session.playerId);
}

export default function Home() {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [mode, setMode] = useState<"create" | "join">("create");
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [held, setHeld] = useState([false, false, false, false, false]);
  const [rolling, setRolling] = useState(false);
  const [scorePlayerId, setScorePlayerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryGame[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [resumable, setResumable] = useState<Session | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const stateRef = useRef<RoomState | null>(null);
  const heldRef = useRef(held);
  const roomEtagRef = useRef<string | null>(null);
  const rollAnimationTimer = useRef<number | null>(null);
  const holdSyncTimer = useRef<number | null>(null);
  const holdRequestRef = useRef<Promise<void> | null>(null);
  /** Hold selection waiting out the debounce window, not yet sent. */
  const pendingHoldRef = useRef<boolean[] | null>(null);
  const actionBusyRef = useRef(false);

  const startRollAnimation = useCallback(() => {
    setRolling(true);
    if (rollAnimationTimer.current !== null) {
      window.clearTimeout(rollAnimationTimer.current);
    }
    rollAnimationTimer.current = window.setTimeout(() => {
      setRolling(false);
      rollAnimationTimer.current = null;
    }, 720);
  }, []);

  const refreshProfile = useCallback(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    if (!response.ok) {
      setAccount(null);
      setProfile(null);
      return false;
    }
    const next = (await response.json()) as AccountProfile;
    setAccount(next.user);
    setProfile(next);
    setName(next.user.displayName);
    setProfileName(next.user.displayName);
    setHistory(next.games ?? []);
    return true;
  }, []);

  // Always re-reads localStorage rather than closing over a snapshot, so a
  // game finished during this visit is included.
  const refreshHistory = useCallback(async () => {
    try {
      if (await refreshProfile()) return;
      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessions: readSessions().map(({ playerId, token }) => ({
            playerId,
            token,
          })),
        }),
      });
      const data = (await response.json()) as { games?: HistoryGame[] };
      setHistory(data.games ?? []);
    } finally {
      setHistoryLoaded(true);
    }
  }, [refreshProfile]);

  const fetchRoom = useCallback(async (code: string, quiet = false) => {
    try {
      const headers: HeadersInit = {};
      if (roomEtagRef.current) {
        headers["if-none-match"] = roomEtagRef.current;
      }
      const response = await fetch(`/api/rooms/${code}`, {
        cache: "no-store",
        headers,
      });
      if (response.status === 304) return;
      if (!response.ok) {
        if (!quiet) {
          const data = (await response.json()) as { error?: string };
          setError(data.error ?? "無法讀取房間。");
        }
        return;
      }
      const next = (await response.json()) as RoomState;
      const previous = stateRef.current;
      if (
        previous?.room.code === next.room.code &&
        next.room.updatedAt < previous.room.updatedAt
      ) {
        return;
      }
      roomEtagRef.current = response.headers.get("etag");
      const turnChanged =
        previous?.room.currentSeat !== next.room.currentSeat ||
        previous?.room.round !== next.room.round;
      const newRoll =
        Boolean(previous) &&
        !turnChanged &&
        next.room.rollsUsed > (previous?.room.rollsUsed ?? 0);
      if (!previous || turnChanged || previous.room.rollsUsed !== next.room.rollsUsed) {
        // The roll or turn this selection belonged to is over, so anything
        // still queued would be sent against a stale room.
        pendingHoldRef.current = null;
        heldRef.current = next.room.held;
        setHeld(next.room.held);
      }
      if (newRoll) startRollAnimation();
      if (previous?.room.turnDeadline !== next.room.turnDeadline) {
        setClock(Date.now());
      }
      stateRef.current = next;
      setState(next);
    } catch {
      if (!quiet) setError("連線中斷，正在嘗試重新連線。");
    }
  }, [startRollAnimation]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("room") ?? "").toUpperCase().slice(0, 6);
    const sessions = readSessions();
    if (code) {
      const existing = selectBrowserSession(
        sessions,
        code,
        sessionStorage.getItem(`${ACTIVE_SESSION_PREFIX}:${code}`),
      );
      queueMicrotask(() => {
        setJoinCode(code);
        setMode("join");
        if (existing) {
          setSession(existing);
          setName(existing.name);
          setConnecting(true);
          void fetchRoom(code).finally(() => setConnecting(false));
        } else {
          // This tab has no identity in the room yet. Another tab in this
          // browser may have one, but resuming it here would hijack that
          // tab's player, so only offer it as an explicit choice.
          setResumable(findResumableSession(sessions, code));
        }
        setInitialized(true);
      });
    } else {
      queueMicrotask(() => setInitialized(true));
    }

    queueMicrotask(() => {
      void refreshHistory();
    });
  }, [fetchRoom, refreshHistory]);

  useEffect(() => {
    if (!session) return;
    const status = state?.room.status;
    if (status === "finished") return;
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearInterval(timer);
      const interval =
        document.visibilityState === "hidden" ? 15_000 : status === "waiting" ? 4_000 : 1_500;
      timer = window.setInterval(() => void fetchRoom(session.code, true), interval);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void fetchRoom(session.code, true);
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchRoom, session, state?.room.status]);

  useEffect(() => {
    if (state?.room.status !== "playing" || !state.room.turnDeadline) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state?.room.status, state?.room.turnDeadline]);

  useEffect(
    () => () => {
      if (rollAnimationTimer.current !== null) {
        window.clearTimeout(rollAnimationTimer.current);
      }
      if (holdSyncTimer.current !== null) {
        window.clearTimeout(holdSyncTimer.current);
      }
    },
    [],
  );

  const currentPlayer = state?.players.find(
    (player) => player.seat === state.room.currentSeat,
  );
  const me = state?.players.find((player) => player.id === session?.playerId);
  const isMyTurn =
    state?.room.status === "playing" && currentPlayer?.id === session?.playerId;
  const turnSeconds = state?.room.turnDeadline
    ? Math.max(0, Math.ceil((Date.parse(state.room.turnDeadline) - clock) / 1_000))
    : null;
  const visibleHeld = isMyTurn
    ? held
    : state?.room.held ?? [false, false, false, false, false];
  const viewedPlayerId =
    state?.players.some((player) => player.id === scorePlayerId)
      ? scorePlayerId
      : session?.playerId;
  const viewedPlayer = state?.players.find(
    (player) => player.id === viewedPlayerId,
  );
  const viewingMyScore = viewedPlayerId === session?.playerId;
  /**
   * Whether the card being looked at belongs to the player who owns the dice
   * currently on the table.
   *
   * Potential scores are a property of the dice, not of who is looking, so the
   * preview follows the roller onto anyone else's view of their card. It stays
   * blank on a card belonging to someone who is not rolling, where the dice
   * would say nothing about what that player can take.
   */
  const viewedPlayerIsRolling = Boolean(
    state &&
      state.room.status === "playing" &&
      viewedPlayer &&
      viewedPlayer.seat === state.room.currentSeat,
  );
  const viewedScores = useMemo(
    () => state?.scores.filter((score) => score.playerId === viewedPlayerId) ?? [],
    [state?.scores, viewedPlayerId],
  );
  const viewedSummary = useMemo(() => scoreSummary(viewedScores), [viewedScores]);
  const scoreSummaries = useMemo(() => {
    const summaries = new Map<string, ReturnType<typeof scoreSummary>>();
    for (const player of state?.players ?? []) {
      summaries.set(
        player.id,
        scoreSummary(state?.scores.filter((score) => score.playerId === player.id) ?? []),
      );
    }
    return summaries;
  }, [state?.players, state?.scores]);
  const rankings = useMemo(
    () =>
      state
        ? [...state.players].sort(
            (a, b) =>
              (scoreSummaries.get(b.id)?.total ?? 0) -
              (scoreSummaries.get(a.id)?.total ?? 0),
          )
        : [],
    [scoreSummaries, state],
  );

  async function enterRoom(kind: "create" | "join") {
    setError("");
    if (!name.trim()) {
      setError("先取一個玩家名稱吧。");
      return;
    }
    if (kind === "join" && joinCode.length !== 6) {
      setError("房間代碼是 6 碼。");
      return;
    }
    setBusy(true);
    try {
      const url = kind === "create" ? "/api/rooms" : `/api/rooms/${joinCode}/join`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          kind === "create" ? { name, maxPlayers } : { name },
        ),
      });
      const data = (await response.json()) as {
        error?: string;
        code?: string;
        playerId?: string;
        token?: string;
      };
      if (!response.ok || !data.code || !data.playerId || !data.token) {
        setError(data.error ?? "無法加入房間。");
        return;
      }
      const nextSession = {
        code: data.code,
        playerId: data.playerId,
        token: data.token,
        name: name.trim(),
      };
      saveSession(nextSession);
      setSession(nextSession);
      setResumable(null);
      setScorePlayerId(nextSession.playerId);
      roomEtagRef.current = null;
      window.history.replaceState({}, "", `?room=${data.code}`);
      await fetchRoom(data.code);
    } catch {
      setError("連線失敗，請再試一次。");
    } finally {
      setBusy(false);
    }
  }

  async function submitAccount() {
    setAccountBusy(true);
    setAccountError("");
    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: authUsername,
          password: authPassword,
          displayName: authDisplayName,
          // Hands over the guest identities held in this browser so games
          // played before signing in are attached to the account.
          sessions: readSessions().map(({ playerId, token }) => ({
            playerId,
            token,
          })),
        }),
      });
      const data = (await response.json()) as { user?: AccountUser; error?: string };
      if (!response.ok || !data.user) {
        setAccountError(data.error ?? "無法登入，請再試一次。");
        return;
      }
      setAccount(data.user);
      setName(data.user.displayName);
      setProfileName(data.user.displayName);
      setAuthPassword("");
      await refreshProfile();
    } catch {
      setAccountError("連線失敗，請再試一次。");
    } finally {
      setAccountBusy(false);
    }
  }

  async function saveProfile() {
    setAccountBusy(true);
    setAccountError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: profileName }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setAccountError(data.error ?? "無法更新個人資料。");
        return;
      }
      await refreshProfile();
    } catch {
      setAccountError("連線失敗，請再試一次。");
    } finally {
      setAccountBusy(false);
    }
  }

  async function logoutAccount() {
    setAccountBusy(true);
    setAccountError("");
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setAccount(null);
      setProfile(null);
      setAccountPanelOpen(false);
      setHistory([]);
      setHistoryLoaded(true);
      setName("");
    } finally {
      setAccountBusy(false);
    }
  }

  async function action(
    actionName: "start" | "roll" | "score" | "skip",
    category?: CategoryId,
  ) {
    if (!session || !stateRef.current || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (actionName === "roll") {
        // The server decides which dice survive from `rooms.held_json`, so a
        // hold still inside its debounce window has to be stored before the
        // reroll. Rolling anyway would silently reroll a die the player had
        // already clicked to keep, so a failed sync aborts the roll instead.
        if (!(await flushPendingHold())) {
          setError("鎖骰狀態尚未同步，請再按一次擲骰。");
          return;
        }
      } else {
        // Scoring and skipping end the turn, which clears the held dice
        // anyway, so a queued hold is not worth a round trip.
        await discardPendingHold();
      }
      if (actionName === "roll") startRollAnimation();

      let response: Response | null = null;
      let data: { error?: string } = {};
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const latestState = stateRef.current;
        if (!latestState || latestState.room.code !== session.code) return;
        response = await fetch(`/api/rooms/${session.code}/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: actionName,
            playerId: session.playerId,
            token: session.token,
            held: heldRef.current,
            category,
            expectedUpdatedAt: latestState.room.updatedAt,
          }),
        });
        data = (await response.json()) as { error?: string };
        const recoverableConflict =
          response.status === 409 && data.error?.includes("狀態已變更");
        if (!recoverableConflict || attempt === 1) break;
        await fetchRoom(session.code, true);
      }

      if (!response?.ok) {
        setError(data.error ?? "操作失敗，請再試一次。");
        return;
      }
      if (actionName === "score" || actionName === "skip") {
        const empty = [false, false, false, false, false];
        heldRef.current = empty;
        setHeld(empty);
      }
      await fetchRoom(session.code);
    } catch {
      setError("連線失敗，請再試一次。");
    } finally {
      actionBusyRef.current = false;
      setBusy(false);
    }
  }

  function toggleHeld(index: number) {
    const currentState = stateRef.current;
    if (
      !session ||
      !currentState ||
      !isMyTurn ||
      currentState.room.rollsUsed < 1 ||
      actionBusyRef.current
    ) {
      return;
    }
    const nextHeld = heldRef.current.map((value, dieIndex) =>
      dieIndex === index ? !value : value,
    );
    heldRef.current = nextHeld;
    setHeld(nextHeld);
    pendingHoldRef.current = nextHeld;
    if (holdSyncTimer.current !== null) {
      window.clearTimeout(holdSyncTimer.current);
      holdSyncTimer.current = null;
    }
    holdSyncTimer.current = window.setTimeout(() => {
      holdSyncTimer.current = null;
      void sendPendingHold();
    }, 120);
  }

  /**
   * Push the debounced hold selection to the server.
   *
   * The server treats `rooms.held_json` as the only source of truth for which
   * dice survive a reroll, so a selection that never gets sent is a selection
   * that never happened.
   */
  function sendPendingHold(): Promise<boolean> {
    const nextHeld = pendingHoldRef.current;
    if (!session || !nextHeld) {
      return (holdRequestRef.current ?? Promise.resolve()).then(() => true);
    }
    pendingHoldRef.current = null;
    const previousRequest = holdRequestRef.current;
    const request = (async () => {
      if (previousRequest) await previousRequest;
      try {
        // A hold is rejected with 409 when the room moved on between reading
        // state and sending — most often a poll landing on the same tick.
        // Re-read and try once more, because giving up here would let the
        // caller reroll a die the player had already chosen to keep.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const latestState = stateRef.current;
          if (
            !latestState ||
            latestState.room.code !== session.code ||
            latestState.players.find((player) => player.id === session.playerId)?.seat !==
              latestState.room.currentSeat ||
            latestState.room.rollsUsed < 1
          ) {
            return false;
          }
          const response = await fetch(`/api/rooms/${session.code}/action`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "hold",
              playerId: session.playerId,
              token: session.token,
              held: nextHeld,
              expectedUpdatedAt: latestState.room.updatedAt,
            }),
          });
          const data = (await response.json()) as {
            error?: string;
            updatedAt?: string;
          };
          if (!response.ok) {
            await fetchRoom(session.code, true);
            if (response.status === 409 && attempt === 0) continue;
            if (response.status !== 409) {
              setError(data.error ?? "無法同步鎖骰狀態。");
            }
            return false;
          }
          const current = stateRef.current;
          if (current?.room.code === session.code && data.updatedAt) {
            const nextState = {
              ...current,
              room: {
                ...current.room,
                held: nextHeld,
                updatedAt: data.updatedAt,
              },
            };
            stateRef.current = nextState;
            setState(nextState);
          }
          return true;
        }
        return false;
      } catch {
        await fetchRoom(session.code, true);
        setError("無法同步鎖骰狀態，請再試一次。");
        return false;
      }
    })();
    const tracked = request.then(() => undefined);
    holdRequestRef.current = tracked;
    void tracked.finally(() => {
      if (holdRequestRef.current === tracked) holdRequestRef.current = null;
    });
    return request;
  }

  /**
   * Send a hold that is still sitting in the debounce window, instead of
   * waiting out the remaining delay.
   *
   * Resolves true only once the server has actually stored the selection.
   */
  function flushPendingHold(): Promise<boolean> {
    if (holdSyncTimer.current !== null) {
      window.clearTimeout(holdSyncTimer.current);
      holdSyncTimer.current = null;
    }
    return sendPendingHold();
  }

  /** Drop a debounced hold that the next action makes irrelevant. */
  function discardPendingHold(): Promise<void> {
    if (holdSyncTimer.current !== null) {
      window.clearTimeout(holdSyncTimer.current);
      holdSyncTimer.current = null;
    }
    pendingHoldRef.current = null;
    return holdRequestRef.current ?? Promise.resolve();
  }

  function resumeAs(previous: Session) {
    saveSession(previous);
    setSession(previous);
    setResumable(null);
    setName(previous.name);
    setScorePlayerId(previous.playerId);
    roomEtagRef.current = null;
    setConnecting(true);
    void fetchRoom(previous.code).finally(() => setConnecting(false));
  }

  function leaveRoom() {
    if (session) {
      sessionStorage.removeItem(`${ACTIVE_SESSION_PREFIX}:${session.code}`);
    }
    setSession(null);
    setState(null);
    setResumable(null);
    stateRef.current = null;
    roomEtagRef.current = null;
    const empty = [false, false, false, false, false];
    heldRef.current = empty;
    setHeld(empty);
    setRolling(false);
    setScorePlayerId(null);
    if (holdSyncTimer.current !== null) {
      window.clearTimeout(holdSyncTimer.current);
      holdSyncTimer.current = null;
    }
    pendingHoldRef.current = null;
    setError("");
    window.history.replaceState({}, "", window.location.pathname);
    // The game just played is only in the history once it is finished, so the
    // landing page needs a fresh read rather than the snapshot from mount.
    void refreshHistory();
  }

  async function copyInvite() {
    if (!state) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${state.room.code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const accountLayer = accountPanelOpen ? (
    <div className="account-backdrop" role="presentation" onMouseDown={() => setAccountPanelOpen(false)}>
      <section
        aria-label={account ? "個人資料" : "使用者登入"}
        aria-modal="true"
        className="account-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button
          aria-label="關閉"
          className="account-close"
          onClick={() => setAccountPanelOpen(false)}
          type="button"
        >
          ×
        </button>
        {account && profile ? (
          <>
            <div className="profile-heading">
              <span className="profile-avatar">{account.displayName.slice(0, 1).toUpperCase()}</span>
              <div>
                <p className="eyebrow">PLAYER PROFILE</p>
                <h2>{account.displayName}</h2>
                <small>@{account.username}</small>
              </div>
            </div>
            <div className="profile-stats">
              <article><strong>{profile.stats.games}</strong><span>完成場次</span></article>
              <article><strong>{profile.stats.wins}</strong><span>勝場</span></article>
              <article><strong>{profile.stats.bestScore}</strong><span>最高分</span></article>
              <article><strong>{profile.stats.averageScore}</strong><span>平均分</span></article>
            </div>
            <label className="profile-field">
              <span>牌桌顯示名稱</span>
              <input
                maxLength={18}
                onChange={(event) => setProfileName(event.target.value)}
                value={profileName}
              />
            </label>
            {accountError && <p className="form-error">{accountError}</p>}
            <div className="profile-actions">
              <button
                className="primary-action"
                disabled={accountBusy || profileName.trim() === account.displayName}
                onClick={saveProfile}
                type="button"
              >
                儲存個人資料
              </button>
              <button
                className="text-action"
                disabled={accountBusy}
                onClick={logoutAccount}
                type="button"
              >
                登出
              </button>
            </div>
            <p className="profile-since">
              加入日期：{new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(new Date(account.createdAt))}
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">SAVE YOUR LEGEND</p>
            <h2>{authMode === "login" ? "歡迎回到牌桌" : "建立玩家帳號"}</h2>
            <p className="account-intro">登入後，每一場完成的牌局都會自動保存，換裝置也能查看。</p>
            <div className="auth-tabs">
              <button
                className={authMode === "login" ? "active" : ""}
                onClick={() => { setAuthMode("login"); setAccountError(""); }}
                type="button"
              >登入</button>
              <button
                className={authMode === "register" ? "active" : ""}
                onClick={() => { setAuthMode("register"); setAccountError(""); }}
                type="button"
              >註冊</button>
            </div>
            <div className="auth-form">
              {authMode === "register" && (
                <label>
                  <span>顯示名稱</span>
                  <input
                    autoComplete="nickname"
                    maxLength={18}
                    onChange={(event) => setAuthDisplayName(event.target.value)}
                    placeholder="例如：骰神阿明"
                    value={authDisplayName}
                  />
                </label>
              )}
              <label>
                <span>帳號</span>
                <input
                  autoCapitalize="none"
                  autoComplete="username"
                  maxLength={20}
                  onChange={(event) => setAuthUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="3–20 位英文、數字或底線"
                  value={authUsername}
                />
              </label>
              <label>
                <span>密碼</span>
                <input
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  maxLength={72}
                  minLength={8}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="至少 8 個字元"
                  type="password"
                  value={authPassword}
                />
              </label>
              {accountError && <p className="form-error">{accountError}</p>}
              <button
                className="primary-action"
                disabled={accountBusy}
                onClick={submitAccount}
                type="button"
              >
                {accountBusy ? "請稍候…" : authMode === "login" ? "登入" : "建立帳號"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  ) : null;

  if (!initialized || (session && connecting && !state)) {
    return (
      <main className="game-shell connecting">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">Y</span>
            <span>YAZY CLUB</span>
          </div>
        </header>
        <section className="connecting-card" aria-live="polite">
          <span className="live-dot" />
          <p>{session ? `正在回到房間 ${session.code}…` : "正在準備牌桌…"}</p>
        </section>
        {accountLayer}
      </main>
    );
  }

  if (session && state) {
    return (
      <main className="game-shell">
        <header className="topbar">
          <button className="brand" onClick={leaveRoom} aria-label="回到首頁">
            <span className="brand-mark">Y</span>
            <span>YAZY CLUB</span>
          </button>
          <div className="topbar-actions">
            <button className="account-trigger compact" onClick={() => setAccountPanelOpen(true)} type="button">
              <span>{account?.displayName.slice(0, 1).toUpperCase() ?? "人"}</span>
              {account ? account.displayName : "登入"}
            </button>
            <div className="room-pill">
              <span>房間</span>
              <strong>{state.room.code}</strong>
              <button onClick={copyInvite}>{copied ? "已複製！" : "邀請朋友"}</button>
            </div>
          </div>
        </header>

        <section className="players-strip" aria-label="玩家">
          {state.players.map((player) => {
            const summary = scoreSummaries.get(player.id) ?? EMPTY_SCORE_SUMMARY;
            const active =
              state.room.status === "playing" &&
              player.seat === state.room.currentSeat;
            return (
              <article
                className={`player-chip ${active ? "active" : ""}`}
                key={player.id}
              >
                <span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span>
                <span className="player-copy">
                  <strong>
                    {player.name}
                    {player.id === session.playerId ? "（你）" : ""}
                  </strong>
                  <small>{active ? "正在擲骰" : `${summary.total} 分`}</small>
                </span>
              </article>
            );
          })}
          {Array.from({
            length: Math.max(0, state.room.maxPlayers - state.players.length),
          }).map((_, index) => (
            <div className="player-chip empty" key={`empty-${index}`}>
              <span className="avatar">＋</span>
              <span className="player-copy">
                <strong>等待加入</strong>
                <small>分享房間代碼</small>
              </span>
            </div>
          ))}
        </section>

        {error && <div className="error-banner">{error}</div>}

        {state.room.status === "waiting" && (
          <section className="waiting-card">
            <div className="waiting-dice" aria-hidden="true">
              <span>⚄</span>
              <span>⚂</span>
              <span>⚅</span>
            </div>
            <p className="eyebrow">LOBBY OPEN</p>
            <h1>牌桌已經準備好了</h1>
            <p>
              再邀幾位朋友進來。湊滿 2 人就能開局，最多 {state.room.maxPlayers} 人。
            </p>
            <div className="code-display">
              <span>房間代碼</span>
              <strong>{state.room.code}</strong>
            </div>
            {state.room.hostPlayerId === session.playerId ? (
              <button
                className="primary-action"
                disabled={busy || state.players.length < 2}
                onClick={() => action("start")}
              >
                {state.players.length < 2 ? "等待第 2 位玩家" : "開始遊戲"}
              </button>
            ) : (
              <div className="waiting-note">
                <span className="live-dot" />
                等待房主開始遊戲
              </div>
            )}
          </section>
        )}

        {state.room.status === "playing" && (
          <div className="game-grid">
            <section className="table-panel">
              <div className="turn-heading">
                <div>
                  <p className="eyebrow">
                    ROUND {String(state.room.round).padStart(2, "0")} / 13
                  </p>
                  <h1>
                    {isMyTurn
                      ? `${me?.name ?? "你"}，輪到你了`
                      : `等待 ${currentPlayer?.name ?? "玩家"} 擲骰`}
                  </h1>
                </div>
                <span className="roll-count">已擲 {state.room.rollsUsed} / 3</span>
              </div>

              {turnSeconds !== null && (
                <div className={`turn-timeout ${turnSeconds === 0 ? "expired" : ""}`}>
                  <span>
                    {turnSeconds > 0
                      ? `${isMyTurn ? "你的回合" : `${currentPlayer?.name ?? "玩家"} 的回合`}剩餘 ${turnSeconds} 秒`
                      : `${currentPlayer?.name ?? "玩家"} 的回合已逾時`}
                  </span>
                  {!isMyTurn && turnSeconds === 0 && (
                    <button disabled={busy} onClick={() => action("skip")} type="button">
                      跳過這個回合
                    </button>
                  )}
                </div>
              )}

              <div
                className="dice-tray"
                aria-busy={rolling}
                aria-label="骰子區"
                aria-live="polite"
              >
                {Array.from({ length: 5 }).map((_, index) => {
                  const die = state.room.dice[index];
                  return (
                    <button
                      aria-label={
                        die
                          ? `骰子 ${die}，${visibleHeld[index] ? "已保留" : "未保留"}`
                          : "尚未擲骰"
                      }
                      className={`die ${visibleHeld[index] ? "held" : ""} ${!die ? "blank" : ""} ${rolling && !visibleHeld[index] ? "rolling" : ""}`}
                      disabled={!isMyTurn || state.room.rollsUsed === 0 || busy}
                      key={index}
                      onClick={() => toggleHeld(index)}
                    >
                      {die ? (
                        <DiceCube value={die} />
                      ) : (
                        <span className="die-placeholder">·</span>
                      )}
                      {visibleHeld[index] && <small>HOLD</small>}
                    </button>
                  );
                })}
              </div>

              <div className="roll-actions">
                <button
                  className="roll-button"
                  disabled={!isMyTurn || busy || state.room.rollsUsed >= 3}
                  onClick={() => action("roll")}
                >
                  <span aria-hidden="true">↻</span>
                  {rolling
                    ? "骰子滾動中…"
                    : state.room.rollsUsed === 0
                      ? "擲骰"
                      : "再擲一次"}
                </button>
                <p>
                  {rolling
                    ? "骰子正在桌面上翻滾，結果馬上揭曉"
                    : isMyTurn
                    ? state.room.rollsUsed === 0
                      ? "按下擲骰，開始你的回合"
                      : "點選骰子可保留，再擲其餘骰子"
                    : "牌桌會自動同步其他玩家的動作"}
                </p>
              </div>
            </section>

            <aside className="score-panel">
              <div className="score-panel-heading">
                <div>
                  <p className="eyebrow">SCORE CARD</p>
                  <h2>
                    {viewingMyScore
                      ? isMyTurn
                        ? "選擇計分格"
                        : "我的計分卡"
                      : viewedPlayerIsRolling
                        ? `${viewedPlayer?.name ?? "玩家"}可選的分數`
                        : `${viewedPlayer?.name ?? "玩家"}的計分卡`}
                  </h2>
                </div>
                <strong>{viewedSummary.total}</strong>
              </div>
              <div
                aria-label="查看玩家計分卡"
                className="score-player-tabs"
                role="tablist"
              >
                {state.players.map((player) => (
                  <button
                    aria-selected={player.id === viewedPlayerId}
                    className={player.id === viewedPlayerId ? "active" : ""}
                    key={player.id}
                    onClick={() => setScorePlayerId(player.id)}
                    role="tab"
                    type="button"
                  >
                    <span>
                      {player.name}
                      {player.id === session.playerId ? "（你）" : ""}
                    </span>
                    <b>{scoreSummaries.get(player.id)?.total ?? 0}</b>
                  </button>
                ))}
              </div>
              <div className="score-list">
                {categories.map((category) => {
                  const saved = viewedScores.find(
                    (score) => score.category === category.id,
                  );
                  const preview =
                    viewedPlayerIsRolling && state.room.rollsUsed > 0
                      ? scoreDice(category.id, state.room.dice)
                      : null;
                  return (
                    <button
                      className={`score-row ${saved ? "scored" : ""} ${viewingMyScore ? "" : "readonly"}`}
                      disabled={
                        !viewingMyScore ||
                        !isMyTurn ||
                        busy ||
                        state.room.rollsUsed < 1 ||
                        Boolean(saved)
                      }
                      key={category.id}
                      onClick={() => action("score", category.id)}
                    >
                      <span>
                        <strong>{category.label}</strong>
                        <small>{category.hint}</small>
                      </span>
                      <b>{saved ? saved.score : preview ?? "—"}</b>
                    </button>
                  );
                })}
              </div>
              <div className="bonus-row">
                <span>
                  上半部加成
                  <small>累積 63 分可得 +35</small>
                </span>
                <strong>
                  {viewedSummary.upper} / 63
                  {viewedSummary.bonus ? " ＋35" : ""}
                </strong>
              </div>
            </aside>
          </div>
        )}

        {state.room.status === "finished" && (
          <section className="results-card">
            <p className="eyebrow">FINAL SCORE</p>
            <h1>今晚的骰王誕生了</h1>
            <div className="podium">
              {rankings.map((player, index) => (
                <article className={`podium-place place-${index + 1}`} key={player.id}>
                  <span className="rank">{index === 0 ? "♛" : `#${index + 1}`}</span>
                  <span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span>
                  <strong>{player.name}</strong>
                  <b>{scoreSummaries.get(player.id)?.total ?? 0} 分</b>
                  {(scoreSummaries.get(player.id)?.bonus ?? 0) > 0 && <small>含上半部加成</small>}
                </article>
              ))}
            </div>
            <button className="primary-action" onClick={leaveRoom}>
              再開一桌
            </button>
          </section>
        )}
        {accountLayer}
      </main>
    );
  }

  return (
    <main className="landing">
      <header className="landing-nav">
        <div className="brand">
          <span className="brand-mark">Y</span>
          <span>YAZY CLUB</span>
        </div>
        <div className="nav-actions">
          <div className="online-badge">
            <span className="live-dot" />
            免下載・立即開玩
          </div>
          <button className="account-trigger" onClick={() => setAccountPanelOpen(true)} type="button">
            <span>{account?.displayName.slice(0, 1).toUpperCase() ?? "人"}</span>
            {account ? account.displayName : "登入／註冊"}
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">ROLL TOGETHER · LAUGH LOUDER</p>
          <h1>
            今晚，擲出
            <em>你的傳說。</em>
          </h1>
          <p className="hero-lead">
            2–6 人線上骰子派對。建立房間、分享代碼，
            <br />
            看誰能把運氣變成真正的高分。
          </p>
          <div className="feature-row">
            <span>✦ 訪客也能玩</span>
            <span>✦ 即時同步</span>
            <span>✦ 登入保存戰績</span>
          </div>
        </div>

        <div className="join-card">
          <div className="card-tabs">
            <button
              className={mode === "create" ? "active" : ""}
              onClick={() => {
                setMode("create");
                setError("");
              }}
            >
              建立房間
            </button>
            <button
              className={mode === "join" ? "active" : ""}
              onClick={() => {
                setMode("join");
                setError("");
              }}
            >
              加入房間
            </button>
          </div>
          <div className="form-body">
            {resumable && (
              <div className="resume-note">
                <span>
                  這個瀏覽器先前在房間 {resumable.code} 是「{resumable.name}」。
                  <small>要以新玩家加入，請直接在下方填寫名稱。</small>
                </span>
                <button onClick={() => resumeAs(resumable)} type="button">
                  以「{resumable.name}」繼續
                </button>
              </div>
            )}
            <label>
              <span>你的名稱</span>
              <input
                autoComplete="nickname"
                disabled={Boolean(account)}
                maxLength={18}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：骰神阿明"
                value={name}
              />
            </label>

            {mode === "create" ? (
              <fieldset>
                <legend>房間人數</legend>
                <div className="player-count">
                  {[2, 3, 4, 5, 6].map((count) => (
                    <button
                      className={maxPlayers === count ? "active" : ""}
                      key={count}
                      onClick={() => setMaxPlayers(count)}
                      type="button"
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : (
              <label>
                <span>6 碼房間代碼</span>
                <input
                  className="code-input"
                  maxLength={6}
                  onChange={(event) =>
                    setJoinCode(
                      event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                    )
                  }
                  placeholder="例如：YAZY88"
                  value={joinCode}
                />
              </label>
            )}

            {error && <p className="form-error">{error}</p>}
            <button
              className="primary-action"
              disabled={busy}
              onClick={() => enterRoom(mode)}
            >
              {busy
                ? "正在準備牌桌…"
                : mode === "create"
                  ? "建立新房間"
                  : "加入這一局"}
              {!busy && <span>→</span>}
            </button>
            <p className="privacy-note">
              {account ? `將以 ${account.displayName} 遊玩並保存戰績。` : "訪客可直接玩；登入後可跨裝置保存戰績。"}
            </p>
          </div>
        </div>

        <div className="hero-dice dice-one" aria-hidden="true">
          ⚄
        </div>
        <div className="hero-dice dice-two" aria-hidden="true">
          ⚂
        </div>
      </section>

      <section className="history-section">
        <div>
          <p className="eyebrow">YOUR GAME NIGHTS</p>
          <h2>最近戰績</h2>
        </div>
        {!historyLoaded ? (
          <p className="history-empty">正在翻找過去的牌桌…</p>
        ) : history.length === 0 ? (
          <p className="history-empty">你的第一場傳說，還在等你開局。</p>
        ) : (
          <div className="history-list">
            {history.slice(0, 4).map((game) => {
              const sorted = [...game.players].sort(
                (a, b) =>
                  scoreSummary(b.scores).total - scoreSummary(a.scores).total,
              );
              return (
                <article key={`${game.code}-${game.finishedAt}`}>
                  <span className="history-crown">♛</span>
                  <span>
                    <small>
                      {new Intl.DateTimeFormat("zh-TW", {
                        month: "short",
                        day: "numeric",
                      }).format(new Date(game.finishedAt))}
                      ・{game.players.length} 人局
                    </small>
                    <strong>{sorted[0]?.name} 勝出</strong>
                  </span>
                  <b>{scoreSummary(sorted[0]?.scores ?? []).total} 分</b>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <footer>
        <span>YAZY CLUB</span>
        <p>好運會消失，精彩的牌局會留下。</p>
      </footer>
      {accountLayer}
    </main>
  );
}

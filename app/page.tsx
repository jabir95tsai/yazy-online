"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  dieProfile,
  REDUCED_THROW_MS,
  renderReduced,
  renderResting,
  renderThrow,
  scheduleContact,
  throwFinished,
  type Throw,
} from "@/lib/dice-animation";
import {
  categories,
  fairDieFromByte,
  recommendScore,
  scoreDice,
  scoreSummary,
  type CategoryId,
} from "@/lib/game";
import {
  hasYazy,
  historyStats,
  placeFor,
  type HistoryStats,
  type VersusRecord,
} from "@/lib/stats";
import {
  findResumableSession,
  selectBrowserSession,
  upsertBrowserSession,
  type BrowserSession as Session,
} from "@/lib/browser-session";
import { resultValue, type SurrenderReason } from "@/lib/match";
import { Modal } from "./components/modal";
import { Avatar } from "./components/avatar";
import { Brand } from "./components/brand";
import { Button } from "./components/button";
import { DiceTray, Die, HeroTray, StillDie, type DieSpriteHandle } from "./components/die";
import { ErrorBanner, FormError, LiveDot, RecordNote } from "./components/feedback";
import { FriendAction, FriendActions, FriendRow, HeadToHead } from "./components/friend-row";
import { LobbySeats, PlayerChip, Podium, Seat } from "./components/players";
import { RoomCode } from "./components/room-code";
import { BonusRow, ScoreRow } from "./components/score-row";
import { StatGrid } from "./components/stat-grid";
import { SegmentedTabs } from "./components/tabs";
import { TurnCountdown } from "./components/turn-countdown";
import { RequestScope } from "@/lib/request-scope";
import { formatHistoryDate } from "@/lib/history-date";

type RoomState = {
  room: {
    practice?: boolean;
    id: string;
    code: string;
    status: "waiting" | "playing" | "finished";
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
  players: Array<{ id: string; userId: string | null; name: string; seat: number; surrenderReason: SurrenderReason }>;
  scores: Array<{ playerId: string; category: string; score: number }>;
};

type HistoryGame = {
  code: string;
  finishedAt: string;
  players: Array<{
    id: string;
    userId?: string | null;
    name: string;
    isMe?: boolean;
    surrenderReason?: SurrenderReason;
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
  stats: HistoryStats;
  games: HistoryGame[];
};

type FriendSummary = {
  friendshipId: string;
  userId: string;
  username: string;
  displayName: string;
  games: number;
  record: VersusRecord | null;
};

type FriendRequest = {
  friendshipId: string;
  userId: string;
  username: string;
  displayName: string;
  createdAt: string;
};

type RoomInvite = {
  id: string;
  code: string;
  from: string;
  players: number;
  createdAt: string;
};

type FriendsPayload = {
  friends: FriendSummary[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  invites: RoomInvite[];
};

/**
 * A die in flight. The rolled value arrives partway through as `spec.target`,
 * which is what starts the hand-off onto the landing face; `reduced` is the
 * design's no-motion pose, used when the player has asked for less animation.
 */
type DieAnimation =
  | { kind: "throw"; spec: Throw }
  | { kind: "reduced"; startedAt: number; value: number };

const SESSION_KEY = "yazy-club-sessions";
const ACTIVE_SESSION_PREFIX = "yazy-club-active-player";
const EMPTY_SCORE_SUMMARY = { upper: 0, bonus: 0, lower: 0, total: 0 };
const NO_DICE_IN_FLIGHT = [false, false, false, false, false];
const NO_FRIENDS: FriendsPayload = {
  friends: [],
  incoming: [],
  outgoing: [],
  invites: [],
};
/**
 * The face a die is thrown with when there is nothing on the table to preserve
 * — the first roll of a turn. Shared between the throw and the sprite's first
 * paint so the die never shows one number for a frame and then another.
 */
const blankThrowFace = (index: number) => ((index * 2 + 1) % 6) + 1;


/**
 * One finished game read as a result: who won it, where you came, and whether
 * a YAZY went down.
 *
 * Places are counted rather than taken from the sorted position, so two people
 * on the same total are both second rather than second and third.
 */
function readGame(game: HistoryGame) {
  const lines = game.players
    .map((player) => ({ ...player, total: scoreSummary(player.scores).total }))
    .sort((a, b) => resultValue(b.total, b.surrenderReason) - resultValue(a.total, a.surrenderReason));
  const mine = lines.find((line) => line.isMe) ?? null;
  return {
    lines,
    mine,
    winner: lines[0] ?? null,
    place: mine ? placeFor(resultValue(mine.total, mine.surrenderReason), lines.map((line) => resultValue(line.total, line.surrenderReason))) : 0,
    yazy: Boolean(mine && hasYazy(mine)),
  };
}
/** How far apart the dice come down, so they land as a run rather than a slab. */
const DIE_SETTLE_STAGGER = 80;
const ROLL_SAFETY_TIMEOUT = 5_000;
function readSessions(): Session[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is Session =>
      item && [item.code, item.playerId, item.token, item.name].every((field) => typeof field === "string")) : [];
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
  const [mode, setMode] = useState<"create" | "join">("create");
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [held, setHeld] = useState([false, false, false, false, false]);
  /**
   * Which dice are in the air. Only what the rest of the board needs to know —
   * the throws themselves live in a ref, so a die moving does not re-render
   * anything. This flips twice a roll: once on the throw, once when they stop.
   */
  const [diceInFlight, setDiceInFlight] = useState(NO_DICE_IN_FLIGHT);
  /**
   * The dice values potential scores are computed from. Deliberately lags
   * `state.room.dice`, which lands as soon as the server responds — well
   * before the throw animation settles. Without this, the score list would
   * flash the new numbers while the dice on the table were still tumbling.
   */
  const [settledDice, setSettledDice] = useState<number[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scorePlayerId, setScorePlayerId] = useState<string | null>(null);
  /** Narrow screens show the first six rows until this is opened. */
  const [scoreExpanded, setScoreExpanded] = useState(false);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const tableMenuRef = useRef<HTMLDivElement | null>(null);
  const [showFinalCards, setShowFinalCards] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryGame[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<"profile" | "record" | "friends">(
    "profile",
  );
  const [friends, setFriends] = useState<FriendsPayload>(NO_FRIENDS);
  const [friendUsername, setFriendUsername] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendError, setFriendError] = useState("");
  const [friendNote, setFriendNote] = useState("");
  /** Friends already asked to this table, so the button can say so. */
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [profileName, setProfileName] = useState("");
  const profileNameDirty = useRef(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [resumable, setResumable] = useState<Session | null>(null);
  const stateRef = useRef<RoomState | null>(null);
  const heldRef = useRef(held);
  const roomEtagRef = useRef<string | null>(null);
  const rollAnimationTimers = useRef<number[]>([]);
  const rollAnimationActiveRef = useRef(false);
  /** Whether the dice now in the air have been told what they landed on. */
  const rollRevealedRef = useRef(true);
  const rollStartedAtRef = useRef(0);
  const localRollFeedbackRef = useRef(false);
  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  /** The die being animated in each slot, or null for one sitting still. */
  const dieThrowsRef = useRef<(DieAnimation | null)[]>([null, null, null, null, null]);
  const spriteHandlesRef = useRef<(DieSpriteHandle | null)[]>([null, null, null, null, null]);
  const frameRef = useRef<number | null>(null);
  /** Landing knocks already booked on the audio clock, so a cancelled roll can
   *  take them back off it. */
  const scheduledImpactsRef = useRef<OscillatorNode[]>([]);
  const holdSyncTimer = useRef<number | null>(null);
  const holdRequestRef = useRef<Promise<boolean> | null>(null);
  const roomScope = useRef(new RequestScope());
  const accountScope = useRef(new RequestScope());
  /** Hold selection waiting out the debounce window, not yet sent. */
  const pendingHoldRef = useRef<boolean[] | null>(null);
  const actionBusyRef = useRef(false);

  /** Stable per-slot ref setters, so a sprite is not re-registered every render. */
  const registerSprite = useMemo(
    () =>
      Array.from(
        { length: 5 },
        (_, index) => (handle: DieSpriteHandle | null) => {
          spriteHandlesRef.current[index] = handle;
        },
      ),
    [],
  );

  const clearRollAnimationTimers = useCallback(() => {
    rollAnimationTimers.current.forEach((timer) => window.clearTimeout(timer));
    rollAnimationTimers.current = [];
  }, []);

  const stopScheduledImpacts = useCallback(() => {
    scheduledImpactsRef.current.forEach((oscillator) => {
      try {
        oscillator.onended = null;
        oscillator.stop();
        oscillator.disconnect();
      } catch {
        // Already played out; there is nothing left to unwind.
      }
    });
    scheduledImpactsRef.current = [];
  }, []);

  /**
   * Puts every die back on its rolled face and stops the frame loop. Safe to
   * call at any point in a throw — a die that never got a landing comes to rest
   * on the face it was thrown with, which is the last thing it showed.
   */
  const resetRollAnimation = useCallback(() => {
    clearRollAnimationTimers();
    stopScheduledImpacts();
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    dieThrowsRef.current.forEach((animation, index) => {
      if (!animation) return;
      const settled =
        animation.kind === "throw"
          ? (animation.spec.target ?? animation.spec.airborneFace)
          : animation.value;
      spriteHandlesRef.current[index]?.apply(renderResting(settled));
    });
    dieThrowsRef.current = [null, null, null, null, null];
    rollAnimationActiveRef.current = false;
    rollRevealedRef.current = true;
    localRollFeedbackRef.current = false;
    setDiceInFlight(NO_DICE_IN_FLIGHT);
  }, [clearRollAnimationTimers, stopScheduledImpacts]);

  /**
   * Drives every die in flight, straight onto its SVG nodes.
   *
   * Deliberately outside React. A die's pose changes sixty times a second and
   * nothing else on the board renders from it, so putting it in state would
   * re-render the score panel, the player strip and four other dice for every
   * frame of every die.
   */
  const startFrameLoop = useCallback(() => {
    if (frameRef.current !== null) return;

    function step() {
      const now = performance.now();
      let stillMoving = false;

      dieThrowsRef.current.forEach((animation, index) => {
        if (!animation) return;
        const handle = spriteHandlesRef.current[index];
        if (animation.kind === "reduced") {
          const elapsed = now - animation.startedAt;
          if (elapsed >= REDUCED_THROW_MS) {
            handle?.apply(renderResting(animation.value));
            dieThrowsRef.current[index] = null;
            return;
          }
          handle?.apply(renderReduced(animation.value, elapsed));
        } else if (throwFinished(animation.spec, now)) {
          handle?.apply(renderResting(animation.spec.target ?? animation.spec.airborneFace));
          dieThrowsRef.current[index] = null;
          return;
        } else {
          handle?.apply(renderThrow(animation.spec, now));
        }
        stillMoving = true;
      });

      if (stillMoving) {
        frameRef.current = requestAnimationFrame(step);
        return;
      }
      frameRef.current = null;
      clearRollAnimationTimers();
      rollAnimationActiveRef.current = false;
      localRollFeedbackRef.current = false;
      setDiceInFlight(NO_DICE_IN_FLIGHT);
    }

    frameRef.current = requestAnimationFrame(step);
  }, [clearRollAnimationTimers]);

  const queueRollTimer = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    rollAnimationTimers.current.push(timer);
  }, []);

  const primeRollAudio = useCallback(() => {
    if (!soundEnabledRef.current) return;
    try {
      audioContextRef.current ??= new AudioContext();
      if (audioContextRef.current.state === "suspended") {
        void audioContextRef.current.resume();
      }
    } catch {
      // Sound is optional; animation and vibration still work without Web Audio.
    }
  }, []);

  /**
   * Books every landing knock on the audio clock up front instead of firing
   * each one from its own timer. The knocks are only 80ms apart, which is close
   * enough that a busy main thread bunches them into a single thud; booked
   * ahead they keep their rhythm no matter what the page is doing.
   */
  const scheduleDieImpacts = useCallback(
    (impacts: { delay: number; index: number; isFinalDie: boolean }[]) => {
      if (!localRollFeedbackRef.current || !soundEnabledRef.current) return;
      try {
        const context = audioContextRef.current;
        if (context?.state !== "running") return;
        const base = context.currentTime;
        impacts.forEach(({ delay, index, isFinalDie }) => {
          const at = base + delay / 1000;
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "triangle";
          oscillator.frequency.setValueAtTime(125 + index * 11, at);
          oscillator.frequency.exponentialRampToValueAtTime(72, at + 0.07);
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(isFinalDie ? 0.055 : 0.028, at + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.085);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(at);
          oscillator.stop(at + 0.09);
          oscillator.onended = () => {
            gain.disconnect();
            scheduledImpactsRef.current = scheduledImpactsRef.current.filter(
              (node) => node !== oscillator,
            );
          };
          scheduledImpactsRef.current.push(oscillator);
        });
      } catch {
        // Feedback must never prevent the roll result from being shown.
      }
    },
    [],
  );

  /**
   * Throws every die the player did not hold.
   *
   * The dice go up before the server has answered, and they have to: waiting
   * for the round trip before anything moves is what makes a roll feel dead.
   * They are thrown showing the faces already on the table, so the number a
   * player can read never changes under them — the rolled value only arrives
   * partway down, at the hand-off, once `revealRollResult` has one.
   */
  const startRollAnimation = useCallback(
    (heldDice: boolean[], local = false) => {
      if (local) {
        localRollFeedbackRef.current = true;
        primeRollAudio();
      }
      if (rollAnimationActiveRef.current) return;
      clearRollAnimationTimers();
      rollAnimationActiveRef.current = true;
      rollRevealedRef.current = false;
      rollStartedAtRef.current = performance.now();

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // On the first throw of a turn there is nothing to hold onto, so those
      // dice get an arbitrary face — they are coming up out of a blank tray,
      // with no number to preserve.
      const previous = stateRef.current?.room.dice ?? [];
      dieThrowsRef.current = heldDice.map((isHeld, index) =>
        isHeld || reduce
          ? null
          : {
              kind: "throw",
              spec: {
                startedAt: rollStartedAtRef.current,
                airborneFace: previous[index] || blankThrowFace(index),
                target: null,
                contactAt: null,
                profile: dieProfile(index),
              },
            },
      );
      setDiceInFlight(heldDice.map((isHeld) => !isHeld && !reduce));
      if (!reduce) startFrameLoop();
      queueRollTimer(resetRollAnimation, ROLL_SAFETY_TIMEOUT);
    },
    [
      clearRollAnimationTimers,
      primeRollAudio,
      queueRollTimer,
      resetRollAnimation,
      startFrameLoop,
    ],
  );

  /**
   * Tells the dice what they landed on and books their touchdowns.
   *
   * Nothing lands the instant the answer arrives. `scheduleContact` holds each
   * die at the top of its arc until its turn, so a fast answer still gets the
   * whole throw and a slow one still gets a real drop rather than a die
   * snapping onto the table.
   */
  const revealRollResult = useCallback(
    (heldDice: boolean[], dice: number[]) => {
      const movingDice = heldDice
        .map((isHeld, index) => (isHeld ? -1 : index))
        .filter((index) => index >= 0);

      if (!rollAnimationActiveRef.current) startRollAnimation(heldDice);
      clearRollAnimationTimers();
      rollRevealedRef.current = true;

      // Passed in rather than read off `stateRef`: the poll calls this before
      // it commits the new room, so the ref still holds the pre-roll dice —
      // which would land every die back on the face it was thrown with.
      const rolled = (index: number) => dice[index] || 1;

      if (movingDice.length === 0) {
        resetRollAnimation();
        return;
      }

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const startedAt = performance.now();
        dieThrowsRef.current = heldDice.map((isHeld, index) =>
          isHeld ? null : { kind: "reduced", startedAt, value: rolled(index) },
        );
        setDiceInFlight(heldDice.map((isHeld) => !isHeld));
        startFrameLoop();
        return;
      }

      const now = performance.now();
      const contacts = movingDice.map((dieIndex, order) => ({
        contactAt: scheduleContact(
          rollStartedAtRef.current,
          now,
          order * DIE_SETTLE_STAGGER,
        ),
        dieIndex,
        isFinalDie: order === movingDice.length - 1,
      }));

      contacts.forEach(({ contactAt, dieIndex }) => {
        const animation = dieThrowsRef.current[dieIndex];
        if (animation?.kind !== "throw") return;
        animation.spec.target = rolled(dieIndex);
        animation.spec.contactAt = contactAt;
      });
      startFrameLoop();

      scheduleDieImpacts(
        contacts.map(({ contactAt, dieIndex, isFinalDie }) => ({
          delay: Math.max(0, contactAt - now),
          index: dieIndex,
          isFinalDie,
        })),
      );

      const last = contacts[contacts.length - 1];
      queueRollTimer(
        () => {
          if (
            localRollFeedbackRef.current &&
            soundEnabledRef.current &&
            "vibrate" in navigator
          ) {
            try {
              navigator.vibrate(18);
            } catch {
              // Haptics are optional; the roll result still shows.
            }
          }
        },
        Math.max(0, last.contactAt - now),
      );

      // No timer to put the dice back to idle. The frame loop already knows
      // when the last one has stopped moving, and it is the only thing that
      // does once a drop has been compressed to catch a late answer.
    },
    [
      clearRollAnimationTimers,
      queueRollTimer,
      resetRollAnimation,
      scheduleDieImpacts,
      startFrameLoop,
      startRollAnimation,
    ],
  );

  const loadFriends = useCallback(async () => {
    const signal = accountScope.current.signal;
    try {
      const response = await fetch("/api/friends", { cache: "no-store", signal });
      if (!response.ok) return;
      const data = (await response.json()) as FriendsPayload;
      if (accountScope.current.accepts(signal)) setFriends(data);
    } catch {
      // Keep the last successful snapshot during a temporary outage.
    }
  }, []);

  const loadInvites = useCallback(async () => {
    const signal = accountScope.current.signal;
    try {
      const response = await fetch("/api/invites", { cache: "no-store", signal });
      if (!response.ok) return;
      const data = (await response.json()) as { invites: RoomInvite[] };
      if (accountScope.current.accepts(signal)) {
        setFriends((current) => ({ ...current, invites: data.invites }));
      }
    } catch { /* Retry on the next poll; preserve the previous snapshot. */ }
  }, []);

  const refreshProfile = useCallback(async () => {
    const signal = accountScope.current.signal;
    const response = await fetch("/api/profile", { cache: "no-store", signal });
    if (!accountScope.current.accepts(signal)) return true;
    if (response.status === 401) {
      setAccount(null);
      setProfile(null);
      setFriends(NO_FRIENDS);
      return false;
    }
    if (!response.ok) throw new Error("無法更新個人資料，請稍後再試。");
    const next = (await response.json()) as AccountProfile;
    if (!accountScope.current.accepts(signal)) return true;
    setAccount(next.user);
    setProfile(next);
    setName((current) => current || next.user.displayName);
    if (!profileNameDirty.current) setProfileName(next.user.displayName);
    setHistory(next.games ?? []);
    void loadFriends();
    return true;
  }, [loadFriends]);

  // Always re-reads localStorage rather than closing over a snapshot, so a
  // game finished during this visit is included.
  const refreshHistory = useCallback(async () => {
    const signal = accountScope.current.signal;
    try {
      if (await refreshProfile()) return;
      const response = await fetch("/api/history", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessions: readSessions().map(({ playerId, token }) => ({
            playerId,
            token,
          })),
        }),
      });
      const data = (await response.json()) as { games?: HistoryGame[] };
      if (!response.ok) throw new Error("無法讀取戰績");
      if (accountScope.current.accepts(signal)) setHistory(data.games ?? []);
    } catch {
      if (accountScope.current.accepts(signal)) setAccountError("暫時無法更新戰績，請稍後再試。");
    } finally {
      if (accountScope.current.accepts(signal)) setHistoryLoaded(true);
    }
  }, [refreshProfile]);

  const fetchRoom = useCallback(async (code: string, quiet = false) => {
    const signal = roomScope.current.signal;
    try {
      const headers: HeadersInit = {};
      if (roomEtagRef.current) {
        headers["if-none-match"] = roomEtagRef.current;
      }
      const response = await fetch(`/api/rooms/${code}`, {
        cache: "no-store",
        headers,
        signal,
      });
      if (!roomScope.current.accepts(signal)) return;
      if (response.status === 304) return;
      if (!response.ok) {
        if (!quiet) {
          const data = (await response.json()) as { error?: string };
          setError(data.error ?? "無法讀取房間。");
        }
        return;
      }
      const next = (await response.json()) as RoomState;
      if (!roomScope.current.accepts(signal)) return;
      const previous = stateRef.current;
      if (
        previous?.room.code === next.room.code &&
        next.room.updatedAt < previous.room.updatedAt
      ) {
        return;
      }
      roomEtagRef.current = response.headers.get("etag");
      const turnChanged =
        previous?.room.status !== next.room.status ||
        previous?.room.currentSeat !== next.room.currentSeat ||
        previous?.room.round !== next.room.round;
      if (previous?.room.status === "finished" && next.room.status === "playing") {
        setShowFinalCards(false);
        setConfirmSurrender(false);
      }
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
      } else if (!pendingHoldRef.current && !holdRequestRef.current) {
        heldRef.current = next.room.held;
        setHeld(next.room.held);
      }
      if (newRoll) revealRollResult(next.room.held, next.room.dice);
      stateRef.current = next;
      setState(next);
    } catch {
      if (!quiet && roomScope.current.accepts(signal)) setError("連線中斷，正在嘗試重新連線。");
    }
  }, [revealRollResult]);

  // The frame loop keeps rescheduling itself, so leaving a game mid-roll would
  // otherwise leave one running against nodes that are no longer on the page.
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      roomScope.current.reset();
      accountScope.current.reset();
    },
    [],
  );

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

  /**
   * Keep an eye out for friends opening a table.
   *
   * Only on the landing page: someone already sitting at a table is not going
   * to walk to another one, and the room poll is busy enough as it is.
   */
  useEffect(() => {
    if (!account || session) return;
    const check = () => {
      if (document.visibilityState === "visible") void loadInvites();
    };
    const timer = window.setInterval(check, 20_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [account, loadInvites, session]);

  useEffect(() => {
    if (!session || state?.room.practice) return;
    const status = state?.room.status;
    let timer: number | null = null;
    let stopped = false;
    let reading = false;
    const poll = async () => {
      if (reading || stopped) return;
      reading = true;
      try { await fetchRoom(session.code, true); }
      finally { reading = false; if (!stopped) schedule(); }
    };
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      const interval =
        document.visibilityState === "hidden" ? 15_000 : status !== "playing" ? 4_000 : 1_500;
      timer = window.setTimeout(() => void poll(), interval);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
      else schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchRoom, session, state?.room.status, state?.room.practice]);

  useEffect(
    () => () => {
      clearRollAnimationTimers();
      stopScheduledImpacts();
      if (holdSyncTimer.current !== null) {
        window.clearTimeout(holdSyncTimer.current);
      }
      if (audioContextRef.current) void audioContextRef.current.close();
    },
    [clearRollAnimationTimers, stopScheduledImpacts],
  );

  const currentPlayer = state?.players.find(
    (player) => player.seat === state.room.currentSeat,
  );
  const me = state?.players.find((player) => player.id === session?.playerId);
  const isMyTurn =
    state?.room.status === "playing" && currentPlayer?.id === session?.playerId;
  const activePlayers = state?.players.filter((player) => !player.surrenderReason) ?? [];
  const soleSurvivor = !state?.room.practice && activePlayers.length === 1 ? activePlayers[0] : null;
  const canSurrender =
    state?.room.status === "playing" && !state.room.practice && !soleSurvivor && !me?.surrenderReason;
  const rolling = diceInFlight.some(Boolean);

  useEffect(() => {
    if (!tableMenuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!tableMenuRef.current?.contains(event.target as Node)) setTableMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTableMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tableMenuOpen]);
  // Syncs from an external timer-driven animation, not from React state or
  // props, so there is no way to compute this during render.
  useEffect(() => {
    if (!rolling && state?.room.dice.length === 5) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettledDice(state.room.dice);
    }
  }, [rolling, state?.room.dice]);
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
  /**
   * What every still-empty category would pay for the dice on the table, and
   * which adds most to the total, including a newly earned upper bonus.
   *
   * The highest one is badged rather than sorted to the top: the card has to
   * stay in the same order every turn to stay readable, so the hint rides on
   * the row where the player already expects to find it.
   */
  const previewScores = useMemo(() => {
    if (!state || !viewedPlayerIsRolling || state.room.rollsUsed === 0) {
      return new Map<CategoryId, number>();
    }
    const filled = new Set(viewedScores.map((score) => score.category));
    const previews = new Map<CategoryId, number>();
    for (const category of categories) {
      if (filled.has(category.id)) continue;
      previews.set(category.id, scoreDice(category.id, settledDice));
    }
    return previews;
  }, [settledDice, state, viewedPlayerIsRolling, viewedScores]);
  const bestPreview = useMemo(
    () => recommendScore(previewScores, viewedScores),
    [previewScores, viewedScores],
  );
  const rankings = useMemo(
    () =>
      state
        ? [...state.players].sort(
            (a, b) =>
              resultValue(scoreSummaries.get(b.id)?.total ?? 0, b.surrenderReason) -
              resultValue(scoreSummaries.get(a.id)?.total ?? 0, a.surrenderReason),
          )
        : [],
    [scoreSummaries, state],
  );

  function enterPractice() {
    roomScope.current.reset();
    resetRollAnimation();
    const now = new Date().toISOString();
    const practiceSession: Session = { code: "PRACTICE", playerId: "practice", token: "", name: name.trim() || "練習玩家" };
    const next: RoomState = {
      room: { practice: true, id: "practice", code: practiceSession.code, status: "playing",
        hostPlayerId: practiceSession.playerId, currentSeat: 0, round: 1, dice: [],
        held: [false, false, false, false, false], rollsUsed: 0, turnDeadline: null,
        createdAt: now, updatedAt: now, finishedAt: null },
      players: [{ id: practiceSession.playerId, userId: null, name: practiceSession.name, seat: 0, surrenderReason: null }],
      scores: [],
    };
    stateRef.current = next;
    heldRef.current = next.room.held;
    setHeld(next.room.held);
    setSettledDice([]);
    setState(next);
    setSession(practiceSession);
    setScorePlayerId(practiceSession.playerId);
    setShowFinalCards(false);
    setError("");
    setTableMenuOpen(false);
    roomEtagRef.current = null;
    window.history.replaceState({}, "", window.location.pathname);
  }

  function practiceAction(actionName: string, category?: CategoryId) {
    const current = stateRef.current;
    if (!current?.room.practice || rollAnimationActiveRef.current) return;
    if (actionName === "restart") { enterPractice(); return; }
    if (current.room.status !== "playing") return;
    let next = current;
    if (actionName === "roll" && current.room.rollsUsed < 3) {
      const byte = new Uint8Array(1);
      const dice = Array.from({ length: 5 }, (_, index) => {
        if (heldRef.current[index]) return current.room.dice[index];
        let face: number | null = null;
        while (face === null) { crypto.getRandomValues(byte); face = fairDieFromByte(byte[0]); }
        return face;
      });
      startRollAnimation(heldRef.current, true);
      next = { ...current, room: { ...current.room, dice, held: [...heldRef.current], rollsUsed: current.room.rollsUsed + 1 } };
      revealRollResult(next.room.held, dice);
    } else if (actionName === "score" && category && current.room.rollsUsed > 0 &&
      !current.scores.some(score => score.category === category)) {
      const scores = [...current.scores, { playerId: "practice", category, score: scoreDice(category, current.room.dice) }];
      const finished = scores.length === categories.length;
      const held = [false, false, false, false, false];
      heldRef.current = held;
      setHeld(held);
      next = { ...current, scores, room: { ...current.room, dice: [], held, rollsUsed: 0,
        round: Math.min(13, scores.length + 1), status: finished ? "finished" : "playing",
        finishedAt: finished ? new Date().toISOString() : null } };
    } else return;
    stateRef.current = next;
    setState(next);
  }

  // `inviteCode` is for tables arrived at from a friend's invitation, where
  // the code was never typed into the join field.
  async function enterRoom(kind: "create" | "join", inviteCode?: string) {
    setError("");
    const code = inviteCode ?? joinCode;
    if (!name.trim()) {
      setError("先取一個玩家名稱吧。");
      return;
    }
    if (kind === "join" && code.length !== 6) {
      setError("房間代碼是 6 碼。");
      return;
    }
    setBusy(true);
    try {
      const url = kind === "create" ? "/api/rooms" : `/api/rooms/${code}/join`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
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
      roomScope.current.reset();
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
      accountScope.current.reset();
      setName(data.user.displayName);
      setProfileName(data.user.displayName);
      profileNameDirty.current = false;
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
      const data = (await response.json()) as { error?: string; user?: AccountProfile["user"] };
      if (!response.ok) {
        setAccountError(data.error ?? "無法更新個人資料。");
        return;
      }
      if (data.user) {
        const updatedUser = data.user;
        profileNameDirty.current = false;
        setAccount(updatedUser);
        setProfile((current) => current ? { ...current, user: updatedUser } : current);
        setProfileName(updatedUser.displayName);
      }
    } catch {
      setAccountError("連線失敗，請再試一次。");
    } finally {
      setAccountBusy(false);
    }
  }

  async function addFriend() {
    if (friendUsername.length < 3) return;
    setFriendBusy(true);
    setFriendError("");
    setFriendNote("");
    try {
      const response = await fetch("/api/friends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: friendUsername }),
      });
      const data = (await response.json()) as {
        error?: string;
        status?: string;
        displayName?: string;
      };
      if (!response.ok) {
        setFriendError(data.error ?? "送不出去，請再試一次。");
        return;
      }
      setFriendUsername("");
      setFriendNote(
        data.status === "accepted"
          ? `${data.displayName} 也剛好加過你，你們現在是好友了。`
          : `邀請送給 ${data.displayName} 了，等對方點頭。`,
      );
      await loadFriends();
    } catch {
      setFriendError("連線失敗，請再試一次。");
    } finally {
      setFriendBusy(false);
    }
  }

  /**
   * Answer or undo a friendship.
   *
   * Declining, taking back a request and removing a friend all come down to
   * dropping the same row, so they share one call.
   */
  async function respondToFriend(friendshipId: string, accept: boolean) {
    setFriendBusy(true);
    setFriendError("");
    setFriendNote("");
    try {
      const response = await fetch(`/api/friends/${friendshipId}`, {
        method: accept ? "PATCH" : "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setFriendError(data.error ?? "沒能完成，請再試一次。");
      }
      await loadFriends();
    } catch {
      setFriendError("連線失敗，請再試一次。");
    } finally {
      setFriendBusy(false);
    }
  }

  async function inviteFriend(userId: string) {
    if (!state) return;
    setFriendBusy(true);
    setError("");
    try {
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: state.room.code, userId }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? "邀請沒送出去，請再試一次。");
        return;
      }
      setInvitedIds((current) =>
        current.includes(userId) ? current : [...current, userId],
      );
    } catch {
      setError("連線失敗，請再試一次。");
    } finally {
      setFriendBusy(false);
    }
  }

  async function dismissInvite(id: string) {
    setFriends((current) => ({
      ...current,
      invites: current.invites.filter((invite) => invite.id !== id),
    }));
    try {
      const response = await fetch("/api/invites", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) setError("未能略過邀請，請再試一次。");
    } catch {
      setError("連線失敗，請再試一次。");
    } finally {
      await loadFriends();
    }
  }

  async function logoutAccount() {
    setAccountBusy(true);
    setAccountError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("登出失敗");
      accountScope.current.reset();
      setAccount(null);
      setProfile(null);
      setFriends(NO_FRIENDS);
      setAccountPanelOpen(false);
      profileNameDirty.current = false;
      setHistory([]);
      setHistoryLoaded(true);
      setName("");
    } catch {
      setAccountError("尚未成功登出，請再試一次。");
    } finally {
      setAccountBusy(false);
    }
  }

  async function action(
    actionName: "start" | "restart" | "roll" | "score" | "skip" | "surrender" | "finish",
    category?: CategoryId,
  ) {
    if (!session || !stateRef.current || actionBusyRef.current) return;
    if (stateRef.current.room.practice) { practiceAction(actionName, category); return; }
    const signal = roomScope.current.signal;
    actionBusyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (actionName === "roll") {
        startRollAnimation(heldRef.current, true);
        // The server decides which dice survive from `rooms.held_json`, so a
        // hold still inside its debounce window has to be stored before the
        // reroll. Rolling anyway would silently reroll a die the player had
        // already clicked to keep, so a failed sync aborts the roll instead.
        if (!(await flushPendingHold())) {
          resetRollAnimation();
          setError("鎖骰狀態尚未同步，請再按一次擲骰。");
          return;
        }
      } else {
        // Scoring and skipping end the turn, which clears the held dice
        // anyway, so a queued hold is not worth a round trip.
        await discardPendingHold();
      }
      if (!roomScope.current.accepts(signal)) return;

      let response: Response | null = null;
      let data: { error?: string } = {};
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const latestState = stateRef.current;
        if (!roomScope.current.accepts(signal) || !latestState || latestState.room.code !== session.code) return;
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
        if (!roomScope.current.accepts(signal)) return;
        const recoverableConflict =
          response.status === 409 && data.error?.includes("狀態已變更");
        if (!recoverableConflict || attempt === 1) break;
        await fetchRoom(session.code, true);
      }

      if (!response?.ok) {
        if (actionName === "roll") resetRollAnimation();
        setError(data.error ?? "操作失敗，請再試一次。");
        return;
      }
      if (actionName === "score" || actionName === "skip") {
        const empty = [false, false, false, false, false];
        heldRef.current = empty;
        setHeld(empty);
      }
      await fetchRoom(session.code);
      if (!roomScope.current.accepts(signal)) return;
      // The reveal normally rides on `fetchRoom` noticing `rollsUsed` climb.
      // That inference can be missed — most easily when a poll lands the new
      // room state first, leaving this fetch with nothing new to spot — and a
      // missed reveal strands the dice mid-wind-up until the safety timeout
      // fires seconds later, which reads as the roll animation simply not
      // playing. The throw happened here, so finish it from here.
      if (
        actionName === "roll" &&
        rollAnimationActiveRef.current &&
        !rollRevealedRef.current
      ) {
        revealRollResult(
          stateRef.current?.room.held ?? heldRef.current,
          stateRef.current?.room.dice ?? [],
        );
      }
    } catch {
      if (roomScope.current.accepts(signal)) {
        if (actionName === "roll") resetRollAnimation();
        setError("連線失敗，請再試一次。");
      }
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
    if (currentState.room.practice) return;
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
      return holdRequestRef.current ?? Promise.resolve(true);
    }
    const signal = roomScope.current.signal;
    const origin = stateRef.current?.room;
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
            !roomScope.current.accepts(signal) ||
            !latestState ||
            latestState.room.round !== origin?.round ||
            latestState.room.rollsUsed !== origin?.rollsUsed ||
            latestState.room.code !== session.code ||
            latestState.players.find((player) => player.id === session.playerId)?.seat !==
              latestState.room.currentSeat ||
            latestState.room.rollsUsed < 1
          ) {
            return false;
          }
          const response = await fetch(`/api/rooms/${session.code}/action`, {
            method: "POST",
            signal,
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
          if (!roomScope.current.accepts(signal)) return false;
          if (!response.ok) {
            await fetchRoom(session.code, true);
            if (response.status === 409 && attempt === 0) continue;
            if (response.status !== 409) {
              setError(data.error ?? "無法同步鎖骰狀態。");
            }
            return false;
          }
          const current = stateRef.current;
          if (current?.room.code === session.code && data.updatedAt && data.updatedAt >= current.room.updatedAt) {
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
        if (roomScope.current.accepts(signal)) {
          await fetchRoom(session.code, true);
          setError("無法同步鎖骰狀態，請再試一次。");
        }
        return false;
      }
    })();
    const tracked = request.then((success) => {
      const current = stateRef.current?.room;
      if (!success && roomScope.current.accepts(signal) && current?.code === session.code &&
          current.round === origin?.round && current.currentSeat === origin?.currentSeat &&
          current.rollsUsed === origin?.rollsUsed) {
        pendingHoldRef.current ??= heldRef.current;
      }
      return success;
    });
    holdRequestRef.current = tracked;
    void tracked.finally(() => {
      if (holdRequestRef.current === tracked) {
        holdRequestRef.current = null;
        if (!pendingHoldRef.current && roomScope.current.accepts(signal) && stateRef.current) {
          heldRef.current = stateRef.current.room.held;
          setHeld(heldRef.current);
        }
      }
    });
    return tracked;
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
    return (holdRequestRef.current ?? Promise.resolve(true)).then(() => {
      pendingHoldRef.current = null;
    });
  }

  function resumeAs(previous: Session) {
    saveSession(previous);
    roomScope.current.reset();
    setSession(previous);
    setResumable(null);
    setName(previous.name);
    setScorePlayerId(previous.playerId);
    roomEtagRef.current = null;
    setConnecting(true);
    void fetchRoom(previous.code).finally(() => setConnecting(false));
  }

  function leaveRoom() {
    setConfirmSurrender(false);
    roomScope.current.reset();
    holdRequestRef.current = null;
    setInvitedIds([]);
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
    resetRollAnimation();
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
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setError("無法複製，請直接分享房間代碼。"); }
  }

  // Requests and invitations arrive while the panel is shut, so it opens onto
  // a fresh read rather than whatever the last visit left behind.
  function openAccountPanel() {
    setAccountPanelOpen(true);
    setFriendError("");
    setFriendNote("");
    if (account) void loadFriends();
  }

  function toggleSound() {
    setSoundEnabled((current) => {
      const next = !current;
      soundEnabledRef.current = next;
      if (!next && audioContextRef.current?.state === "running") {
        void audioContextRef.current.suspend();
      }
      return next;
    });
  }

  /**
   * Your own record over everything the server was willing to look back on.
   *
   * A signed-in account gets it from the profile read, which counts far more
   * games than any list here shows; a guest's is worked out from the games
   * this browser still holds a seat for.
   */
  const stats = useMemo(
    () => profile?.stats ?? historyStats(history),
    [history, profile?.stats],
  );
  /** The finished games you actually sat at, newest first. */
  const myGames = useMemo(
    () => history.filter((game) => game.players.some((player) => player.isMe)),
    [history],
  );
  /** Friends you have really sat down with, the most-played first. */
  const rivals = useMemo(
    () =>
      friends.friends
        .filter((friend) => friend.record !== null)
        .sort((a, b) => (b.record?.games ?? 0) - (a.record?.games ?? 0)),
    [friends.friends],
  );

  const accountLayer = accountPanelOpen ? (
    <Modal label={account ? "個人資料" : "使用者登入"} onClose={() => setAccountPanelOpen(false)}>
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
              <Avatar name={account.displayName} size="lg" />
              <div>
                <h2>{account.displayName}</h2>
                <small>@{account.username}</small>
              </div>
            </div>
            <SegmentedTabs
              items={[
                { id: "profile", label: "個人資料" },
                { id: "record", label: "戰績" },
                { id: "friends", label: "好友", badge: friends.incoming.length },
              ]}
              onChange={setProfileTab}
              value={profileTab}
            />
            {profileTab === "profile" ? (
              <>
                <RecordNote>統計歷史所有已完成對局</RecordNote>
                <StatGrid
                  stats={[
                    { label: "完成場次", value: profile.stats.games },
                    { label: "勝場", value: profile.stats.wins },
                    { label: "最高分", value: profile.stats.bestScore },
                    { label: "平均分", value: profile.stats.averageScore },
                  ]}
                />
                <label className="profile-field">
                  <span>你想用什麼名字</span>
                  <input
                    maxLength={18}
                    onChange={(event) => {
                      profileNameDirty.current = true;
                      setProfileName(event.target.value);
                    }}
                    value={profileName}
                  />
                </label>
                {accountError && <FormError>{accountError}</FormError>}
                <div className="profile-actions">
                  <Button
                    disabled={accountBusy || profileName.trim() === account.displayName}
                    onClick={saveProfile}
                  >
                    儲存個人資料
                  </Button>
                  <Button
                    disabled={accountBusy}
                    onClick={logoutAccount}
                    variant="text"
                  >
                    登出
                  </Button>
                </div>
                <p className="profile-since">
                  加入日期：{new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(new Date(account.createdAt))}
                </p>
              </>
            ) : profileTab === "record" ? (
              <div className="record-block">
                <RecordNote>個人與好友對戰統計以你歷史所有已完成對局為準。</RecordNote>
                <StatGrid
                  stats={[
                    { label: "完成場次", value: stats.games },
                    { label: "勝率", value: `${stats.winRate}%` },
                    { label: "勝場", value: stats.wins, of: stats.contested },
                    { label: "最高分", value: stats.bestScore },
                    { label: "平均分", value: stats.averageScore },
                    { label: "YAZY 率", value: `${stats.yazyRate}%` },
                  ]}
                  variant="record"
                />
                {stats.games === 0 ? (
                  <p className="friend-empty">還沒有打完的場次。玩完一桌就有了。</p>
                ) : (
                  <RecordNote>
                    打出過 {stats.yazy} 次 YAZY
                    {stats.contested > 0 &&
                      ` · 對戰 ${stats.contested} 場，敗 ${stats.losses}${stats.ties > 0 ? `，和 ${stats.ties}` : ""}`}
                  </RecordNote>
                )}

                <div className="friend-group">
                  <h3>好友對戰</h3>
                  {rivals.length === 0 ? (
                    <p className="friend-empty">
                      還沒跟好友同桌過。開一桌邀他們來，這裡就會記著。
                    </p>
                  ) : (
                    rivals.map((friend) => (
                      <FriendRow
                        detail={
                          <>
                            一起 {friend.record?.games} 場 · 平均 {friend.record?.myAverage} 比{" "}
                            {friend.record?.theirAverage}
                          </>
                        }
                        key={friend.friendshipId}
                        name={friend.displayName}
                      >
                        <HeadToHead
                          losses={friend.record?.losses ?? 0}
                          ties={friend.record?.ties ?? 0}
                          wins={friend.record?.wins ?? 0}
                        />
                      </FriendRow>
                    ))
                  )}
                </div>

                {myGames.length > 0 && (
                  <div className="friend-group">
                    <h3>最近的場次</h3>
                    {myGames.map((game) => {
                      const result = readGame(game);
                      return (
                        <article
                          className="record-game"
                          key={`${game.code}-${game.finishedAt}`}
                        >
                          <div className="friend-copy">
                            <strong>
                              第 {result.place} 名
                              {result.yazy && <i className="record-yazy">YAZY</i>}
                            </strong>
                            <small>
                              {formatHistoryDate(game.finishedAt)} ·{" "}
                              {result.lines.length} 人 · 勝者 {result.winner?.total} 分
                            </small>
                          </div>
                          <b>{result.mine?.total}</b>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="friends-block">
                <div className="friend-add">
                  <label>
                    <span>用帳號加好友</span>
                    <input
                      autoCapitalize="none"
                      maxLength={20}
                      onChange={(event) =>
                        setFriendUsername(
                          event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
                        )
                      }
                      placeholder="對方的帳號"
                      value={friendUsername}
                    />
                  </label>
                  <Button
                    disabled={friendBusy || friendUsername.length < 3}
                    onClick={addFriend}
                  >
                    {friendBusy ? "請稍候…" : "送出邀請"}
                  </Button>
                </div>
                {friendError && <FormError>{friendError}</FormError>}
                {friendNote && <p className="friend-note">{friendNote}</p>}

                {friends.incoming.length > 0 && (
                  <div className="friend-group">
                    <h3>等你回覆</h3>
                    {friends.incoming.map((person) => (
                      <FriendRow
                        detail={`@${person.username}`}
                        key={person.friendshipId}
                        name={person.displayName}
                      >
                        <FriendActions>
                          <FriendAction
                            disabled={friendBusy}
                            onClick={() => respondToFriend(person.friendshipId, true)}
                            tone="accept"
                          >
                            接受
                          </FriendAction>
                          <FriendAction
                            disabled={friendBusy}
                            onClick={() => respondToFriend(person.friendshipId, false)}
                            tone="decline"
                          >
                            不用了
                          </FriendAction>
                        </FriendActions>
                      </FriendRow>
                    ))}
                  </div>
                )}

                <div className="friend-group">
                  <h3>好友{friends.friends.length > 0 ? ` ${friends.friends.length}` : ""}</h3>
                  {friends.friends.length === 0 ? (
                    <p className="friend-empty">
                      還沒有人。把你的帳號 @{account.username} 給對方，或直接加對方的帳號。
                    </p>
                  ) : (
                    friends.friends.map((friend) => (
                      <FriendRow
                        detail={
                          friend.record
                            ? `一起 ${friend.record.games} 場 · ${friend.record.wins} 勝 ${friend.record.losses} 敗${
                                friend.record.ties > 0 ? ` ${friend.record.ties} 和` : ""
                              }`
                            : `${friend.games} 場 · 還沒同桌過`
                        }
                        key={friend.friendshipId}
                        name={friend.displayName}
                      >
                        <FriendActions>
                          <FriendAction
                            disabled={friendBusy}
                            onClick={() => respondToFriend(friend.friendshipId, false)}
                            tone="decline"
                          >
                            移除
                          </FriendAction>
                        </FriendActions>
                      </FriendRow>
                    ))
                  )}
                </div>

                {friends.outgoing.length > 0 && (
                  <div className="friend-group">
                    <h3>等對方回覆</h3>
                    {friends.outgoing.map((person) => (
                      <FriendRow
                        detail={`@${person.username}`}
                        key={person.friendshipId}
                        name={person.displayName}
                      >
                        <FriendActions>
                          <FriendAction
                            disabled={friendBusy}
                            onClick={() => respondToFriend(person.friendshipId, false)}
                            tone="decline"
                          >
                            取消
                          </FriendAction>
                        </FriendActions>
                      </FriendRow>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <h2>{authMode === "login" ? "登入，留著紀錄" : "開一個帳號"}</h2>
            <p className="account-intro">只是為了換手機也看得到分數。不登入也能玩。</p>
            <SegmentedTabs
              items={[
                { id: "login", label: "登入" },
                { id: "register", label: "註冊" },
              ]}
              onChange={(next) => { setAuthMode(next); setAccountError(""); }}
              value={authMode}
            />
            <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submitAccount(); }}>
              {authMode === "register" && (
                <label>
                  <span>你想用什麼名字</span>
                  <input
                    autoComplete="nickname"
                    maxLength={18}
                    onChange={(event) => setAuthDisplayName(event.target.value)}
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
                  placeholder="英文、數字或底線"
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
              {accountError && <FormError>{accountError}</FormError>}
              <Button
                disabled={accountBusy}
                type="submit"
              >
                {accountBusy ? "請稍候…" : authMode === "login" ? "登入" : "開帳號"}
              </Button>
            </form>
          </>
        )}
    </Modal>
  ) : null;

  const settingsLayer = settingsPanelOpen ? (
    <Modal label="設定" onClose={() => setSettingsPanelOpen(false)}>
        <button
          aria-label="關閉"
          className="account-close"
          onClick={() => setSettingsPanelOpen(false)}
          type="button"
        >
          ×
        </button>
        <h2>設定</h2>
        <div className="profile-actions">
          <Button
            aria-pressed={soundEnabled}
            onClick={toggleSound}
            variant="toggle"
          >
            落地音效{soundEnabled ? "開" : "關"}
          </Button>
        </div>
    </Modal>
  ) : null;

  if (!initialized || (session && connecting && !state)) {
    return (
      <main className="game-shell connecting">
        <header className="topbar">
          <Brand />
        </header>
        <section className="connecting-card" aria-live="polite">
          <LiveDot />
          <p>{session ? `正在回到 ${session.code} 這一桌…` : "正在鋪桌子…"}</p>
        </section>
        {accountLayer}
      </main>
    );
  }

  if (session && state) {
    /* One card, two uses: the live panel beside the tray, and the read-only
       look back at the end of a game. */
    const scoreCard = (
      <aside className="score-panel">
        <div className="score-panel-heading">
          <h2>計分卡</h2>
          <span>
            <strong>{viewedSummary.total}</strong>
            <small>分</small>
          </span>
        </div>
        <div aria-label="看誰的計分卡" className="score-player-tabs" role="tablist">
          {state.players.map((player) => (
            <button
              aria-selected={player.id === viewedPlayerId}
              className={player.id === viewedPlayerId ? "active" : ""}
              key={player.id}
              onClick={() => setScorePlayerId(player.id)}
              role="tab"
              type="button"
            >
              {player.id === session.playerId ? "我" : player.name}
            </button>
          ))}
        </div>
        <div className={`score-list ${scoreExpanded ? "" : "collapsed"}`}>
          {categories.map((category) => {
            const saved = viewedScores.find((score) => score.category === category.id);
            const preview = previewScores.get(category.id);
            const fillable =
              viewingMyScore && isMyTurn && !saved && state.room.rollsUsed > 0;
            /* The hint left the row so the card stays quiet, but it is still
               the only place that says what a category pays for. */
            const hint = `${category.label}，${category.hint}`;
            const tag =
              bestPreview?.id === category.id
                ? {
                    text: bestPreview.bonusGain ? "含獎勵最多分" : "目前最多分",
                    title: `現在填入可增加 ${bestPreview.gain} 分${bestPreview.bonusGain ? "（含上半部獎勵 35 分）" : ""}；同分優先特殊牌型。未計算後續擲骰策略。`,
                  }
                : undefined;

            return (
              <ScoreRow
                best={bestPreview?.id === category.id}
                disabled={busy || rolling}
                hint={hint}
                key={category.id}
                label={category.label}
                onClick={() => action("score", category.id)}
                status={saved ? "scored" : fillable ? "open" : "readonly"}
                tag={tag}
                value={saved ? saved.score : preview === undefined ? "" : preview}
              />
            );
          })}
        </div>
        <button
          className="score-expand"
          onClick={() => setScoreExpanded((open) => !open)}
          type="button"
        >
          {scoreExpanded ? "收起來" : "看全部 13 格"}
        </button>
        <BonusRow bonus={viewedSummary.bonus} upper={viewedSummary.upper} />
      </aside>
    );

    return (
      <main className="game-shell">
        <header className="topbar">
          <Brand onClick={leaveRoom} aria-label="回到首頁" />
          <div className="topbar-actions">
            {state.room.practice ? <span className="practice-label">測試模式<br />不計戰績</span> : <RoomCode code={state.room.code} copied={copied} onCopy={copyInvite} />}
            <div className="table-menu" ref={tableMenuRef}>
              <button
                aria-expanded={tableMenuOpen}
                aria-haspopup="menu"
                aria-label="牌桌選項"
                className="table-menu-trigger"
                onClick={() => setTableMenuOpen((open) => !open)}
                type="button"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                  <circle cx="5.5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="18.5" cy="12" r="1.8" />
                </svg>
              </button>
              {tableMenuOpen && (
                <div className="table-menu-panel" role="menu">
                  <button
                    aria-checked={soundEnabled}
                    className="table-menu-item"
                    onClick={toggleSound}
                    role="menuitemcheckbox"
                    type="button"
                  >
                    落地音效
                    <span className="menu-switch" aria-hidden="true" />
                  </button>
                  {canSurrender && (
                    <>
                      <div className="table-menu-divider" role="separator" />
                      <button
                        className="table-menu-item danger"
                        disabled={busy || rolling}
                        onClick={() => {
                          setTableMenuOpen(false);
                          setConfirmSurrender(true);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        投降這一局…
                      </button>
                    </>
                  )}
                  {state.room.practice && (
                    <button className="table-menu-item" role="menuitem" type="button" onClick={enterPractice}>
                      重新開始練習
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              aria-label={account ? account.displayName : "登入"}
              className="account-trigger compact"
              onClick={openAccountPanel}
              type="button"
            >
              <span>{(account?.displayName ?? me?.name ?? "人").slice(0, 1).toUpperCase()}</span>
            </button>
          </div>
        </header>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        {state.room.status === "waiting" && (
          <section className="waiting-card">
            <h1>桌子開好了</h1>
            <p>把代碼給朋友，人到了再開始就好。</p>
            <RoomCode code={state.room.code} copied={copied} onCopy={copyInvite} variant="display" />
            <LobbySeats>
              {state.players.map((player) => (
                <Seat
                  key={player.id}
                  name={player.name}
                  suffix={player.id === session.playerId ? "（你）" : ""}
                />
              ))}
              <Seat />
            </LobbySeats>
            {account && friends.friends.length > 0 && (
              <div className="invite-friends">
                <h2>叫好友過來</h2>
                <div className="invite-friend-list">
                  {friends.friends.map((friend) => {
                    const seated = state.players.some(
                      (player) => player.userId === friend.userId,
                    );
                    const invited = invitedIds.includes(friend.userId);
                    return (
                      <FriendRow
                        detail={`@${friend.username}`}
                        key={friend.friendshipId}
                        name={friend.displayName}
                      >
                        <FriendAction
                          disabled={seated || invited || friendBusy}
                          onClick={() => inviteFriend(friend.userId)}
                          tone="invite"
                        >
                          {seated ? "在桌上" : invited ? "已邀請" : "邀請"}
                        </FriendAction>
                      </FriendRow>
                    );
                  })}
                </div>
              </div>
            )}
            {state.room.hostPlayerId === session.playerId ? (
              <Button
                disabled={busy || state.players.length < 2}
                onClick={() => action("start")}
              >
                {state.players.length < 2 ? "再等一個人" : "開始"}
              </Button>
            ) : (
              <div className="waiting-note">
                <LiveDot />
                等開桌的人按開始
              </div>
            )}
          </section>
        )}

        {state.room.status === "playing" && (
          <div className="game-grid">
            <section className="table-panel">
              {(soleSurvivor || me?.surrenderReason) && (
              <div className="concession-panel" aria-live="polite">
                {soleSurvivor ? (
                  <>
                    <strong>{soleSurvivor.id === session.playerId ? "你已獲勝！" : `${soleSurvivor.name}已獲勝`}</strong>
                    <p>其他玩家已投降。勝者可以繼續擲骰填滿計分卡，挑戰分數紀錄。</p>
                    {soleSurvivor.id === session.playerId && <Button disabled={busy || rolling}
                      onClick={() => action("finish")} variant="ghost">立即結算</Button>}
                    {soleSurvivor.id === session.playerId && <p>想挑戰紀錄？直接繼續擲骰即可。</p>}
                  </>
                ) : me?.surrenderReason ? (
                  <p>{me.surrenderReason === "automatic" ? "剩餘最高分已無法追平領先者，系統已自動投降。" : "你已投降。"}仍可觀看本局。</p>
                ) : null}
              </div>
              )}
              <div className="turn-heading">
                <div>
                  <p className="round-label">第 {state.room.round} / 13 回</p>
                  <h1>
                    {!isMyTurn
                      ? `${currentPlayer?.name ?? "對方"}的回合`
                      : state.room.rollsUsed >= 3
                        ? "選一格填吧"
                        : "輪到你了"}
                  </h1>
                </div>
                <span className="roll-count">
                  {isMyTurn
                    ? state.room.rollsUsed >= 3
                      ? "擲完了"
                      : `還可以擲 ${3 - state.room.rollsUsed} 次`
                    : state.room.rollsUsed === 0
                      ? "還沒擲"
                      : `擲了第 ${state.room.rollsUsed} 次`}
                </span>
              </div>

              {state.room.turnDeadline && (
                <TurnCountdown
                  busy={busy}
                  currentPlayerName={currentPlayer?.name ?? "對方"}
                  isMyTurn={!!isMyTurn}
                  key={state.room.turnDeadline}
                  onSkip={() => action("skip")}
                  turnDeadline={state.room.turnDeadline}
                />
              )}

              <DiceTray idle={!isMyTurn} rolling={rolling}>
                {Array.from({ length: 5 }).map((_, index) => {
                  const inFlight = diceInFlight[index];
                  return (
                    <Die
                      disabled={
                        !isMyTurn || state.room.rollsUsed === 0 || busy || inFlight
                      }
                      held={visibleHeld[index]}
                      key={index}
                      onClick={() => toggleHeld(index)}
                      register={registerSprite[index]}
                      rolling={inFlight}
                      throwFace={blankThrowFace(index)}
                      value={state.room.dice[index] ?? 0}
                    />
                  );
                })}
              </DiceTray>

              {/* 擲得動的時候是一顆按鈕，擲不動的時候就換成一句話 —— 桌上不留
                  按不下去的鍵。 */}
              <div className="roll-actions">
                {isMyTurn && state.room.rollsUsed < 3 ? (
                  <Button
                    disabled={busy || rolling}
                    onClick={() => action("roll")}
                    variant="roll"
                  >
                    {rolling
                      ? "骰子還在滾…"
                      : state.room.rollsUsed === 0
                        ? "擲骰"
                        : "再擲一次"}
                  </Button>
                ) : (
                  <div className="roll-status" aria-live="polite">
                    {isMyTurn ? (
                      "三次都擲完了"
                    ) : (
                      <>
                        <Avatar aria-hidden="true" name={currentPlayer?.name ?? "人"} />
                        等{currentPlayer?.name ?? "對方"}想一下
                      </>
                    )}
                  </div>
                )}
                <p className="roll-guidance">
                  {rolling
                    ? "骰子還在桌上滾"
                    : isMyTurn
                      ? state.room.rollsUsed === 0
                        ? "按下擲骰，慢慢來"
                        : state.room.rollsUsed >= 3
                          ? state.room.practice ? "選一格計分，開始下一回合" : "亮起來的格子都可以填，填了就換下一個人"
                          : "點骰子留下想保留的，再擲剩下的"
                      : `不用急，${currentPlayer?.name ?? "對方"}填完就換你`}
                </p>
              </div>

              <div className="players-strip" aria-label="這桌的人">
                {state.players.map((player) => {
                  const summary = scoreSummaries.get(player.id) ?? EMPTY_SCORE_SUMMARY;
                  return (
                    <PlayerChip
                      active={player.seat === state.room.currentSeat}
                      detail={<>{summary.total}{player.surrenderReason ? ` · ${player.surrenderReason === "automatic" ? "自動投降" : "已投降"}` : ""}</>}
                      key={player.id}
                      name={player.name}
                      suffix={player.id === session.playerId ? "（你）" : ""}
                    />
                  );
                })}
              </div>
            </section>

            {scoreCard}
          </div>
        )}

        {state.room.status === "finished" && (
          <>
            <section className="results-card">
              <h1>這局結束了</h1>
              {state.room.practice ? <p>練習完成，本局不計入戰績。</p> : <p>本局勝者是{rankings.filter((player) => !player.surrenderReason && scoreSummaries.get(player.id)?.total === scoreSummaries.get(rankings[0]?.id)?.total).map((player) => player.name).join("、") || "大家"}。玩得開心就好。</p>}
              <Podium
                entries={rankings.map((player) => ({
                  id: player.id,
                  name: player.name,
                  place: placeFor(resultValue(scoreSummaries.get(player.id)?.total ?? 0, player.surrenderReason), rankings.map((entry) => resultValue(scoreSummaries.get(entry.id)?.total ?? 0, entry.surrenderReason))),
                  total: scoreSummaries.get(player.id)?.total ?? 0,
                  surrendered: Boolean(player.surrenderReason),
                }))}
              />
              <div className="results-actions">
                {state.room.hostPlayerId === session.playerId ? (
                  <Button disabled={busy} onClick={() => action("restart")}>
                    {busy ? "準備中…" : "再開一局"}
                  </Button>
                ) : <p role="status">等待房主再開一局，不用離開房間。</p>}
                <Button disabled={busy} onClick={leaveRoom} variant="ghost">離開房間</Button>
                <Button
                  aria-expanded={showFinalCards}
                  onClick={() => setShowFinalCards((open) => !open)}
                  variant="ghost"
                >
                  {showFinalCards ? "收起計分卡" : "看計分卡"}
                </Button>
              </div>
            </section>
            {showFinalCards && <div className="final-cards">{scoreCard}</div>}
          </>
        )}
        {confirmSurrender && state.room.status === "playing" && !me?.surrenderReason && !soleSurvivor && (
          <Modal label="確認投降" onClose={() => setConfirmSurrender(false)}>
            <h2>確定要投降？</h2>
            <p>投降後本局判負，保留已得分數，無法再擲骰。其他玩家可以繼續挑戰分數紀錄。</p>
            <div className="results-actions">
              <Button onClick={() => setConfirmSurrender(false)} variant="ghost">繼續玩</Button>
              <Button disabled={busy} onClick={() => { setConfirmSurrender(false); void action("surrender"); }}>確認投降</Button>
            </div>
          </Modal>
        )}
        {accountLayer}
      </main>
    );
  }

  return (
    <main className="landing">
      <header className="landing-nav">
        <Brand />
        <div className="nav-actions">
          <button className="account-trigger" onClick={openAccountPanel} type="button">
            <span>{account?.displayName.slice(0, 1).toUpperCase() ?? "人"}</span>
            {account ? account.displayName : "登入"}
          </button>
          <button
            aria-label="設定"
            className="settings-trigger"
            onClick={() => setSettingsPanelOpen(true)}
            type="button"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94a7.14 7.14 0 0 0 .06-.94 7.14 7.14 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.63l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.43h-3.84a.5.5 0 0 0-.5.43l-.36 2.54c-.59.24-1.14.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.65 8.85a.5.5 0 0 0 .12.63l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.63l1.92 3.32c.14.24.42.32.66.22l2.39-.96c.49.38 1.04.7 1.63.94l.36 2.54c.05.25.26.43.5.43h3.84c.24 0 .45-.18.5-.43l.36-2.54c.59-.24 1.14-.56 1.63-.94l2.39.96c.24.1.52.02.66-.22l1.92-3.32a.5.5 0 0 0-.12-.63zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7"
              />
            </svg>
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>yazy battle!</h1>
          <p className="hero-lead">
            開一桌，把六位代碼給朋友。慢慢玩；回合超過 90 秒，朋友可以選擇跳過。
          </p>
        </div>

        <HeroTray>
          <StillDie value={4} />
          <StillDie value={6} />
          <StillDie value={1} />
        </HeroTray>

        <div className="join-card">
          <SegmentedTabs
            items={[
              { id: "create", label: "開一桌" },
              { id: "join", label: "加入朋友的桌" },
            ]}
            onChange={(next) => {
              setMode(next);
              setError("");
            }}
            value={mode}
            variant="card"
          />
          <div className="form-body">
            {resumable && (
              <div className="resume-note">
                <span>
                  這台裝置上次在 {resumable.code} 那桌是「{resumable.name}」。
                  <small>想換個人玩，直接在下面填新名字就好。</small>
                </span>
                <button onClick={() => resumeAs(resumable)} type="button">
                  以「{resumable.name}」繼續
                </button>
              </div>
            )}
            <label>
              <span>你想用什麼名字</span>
              <input
                autoComplete="nickname"
                maxLength={18}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>

            <div className={`code-field ${mode === "join" ? "code-field-open" : ""}`}>
              <label>
                <span>朋友給你的六位代碼</span>
                <input
                  className="code-input"
                  maxLength={6}
                  onChange={(event) =>
                    setJoinCode(
                      event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                    )
                  }
                  placeholder="例如：YAZY88"
                  tabIndex={mode === "join" ? 0 : -1}
                  value={joinCode}
                />
              </label>
            </div>

            {error && <FormError>{error}</FormError>}
            <Button
              disabled={busy}
              onClick={() => enterRoom(mode)}
            >
              {busy ? "正在鋪桌子…" : mode === "create" ? "開一桌" : "進去"}
            </Button>
            <Button disabled={busy} onClick={enterPractice} variant="ghost">測試模式</Button>
            <p className="privacy-note">
              {account
                ? "可以自訂這桌的名字，分數仍會存到你的帳號。"
                : "不用註冊也能玩。登入只是為了留著紀錄。"}
            </p>
          </div>
        </div>

      </section>

      {friends.invites.length > 0 && (
        <section className="invite-section">
          <h2>好友找你上桌</h2>
          <div className="invite-list">
            {friends.invites.map((invite) => (
              <article key={invite.id}>
                <div className="invite-copy">
                  <strong>{invite.from} 開了一桌</strong>
                  <small>
                    {invite.code} · {invite.players} 人在等
                  </small>
                </div>
                <div className="invite-actions">
                  <Button
                    disabled={busy}
                    onClick={() => void enterRoom("join", invite.code)}
                  >
                    {busy ? "正在過去…" : "進去"}
                  </Button>
                  <Button
                    onClick={() => void dismissInvite(invite.id)}
                    variant="text"
                  >
                    這次不了
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="history-section">
        {stats.games > 0 && (
          <>
            <h2>
              你的戰績
              {account && (
                <button
                  className="history-more"
                  onClick={() => {
                    setProfileTab("record");
                    setAccountPanelOpen(true);
                  }}
                  type="button"
                >
                  看全部
                </button>
              )}
            </h2>
            <StatGrid
              stats={[
                { label: "場次", value: stats.games },
                { label: "勝率", value: `${stats.winRate}%` },
                { label: "最高分", value: stats.bestScore },
                { label: "平均分", value: stats.averageScore },
                { label: "YAZY 率", value: `${stats.yazyRate}%` },
              ]}
              variant="history"
            />
          </>
        )}
        {account && <RecordNote>統計歷史所有已完成對局</RecordNote>}
        <h2>上次的桌</h2>
        {!historyLoaded ? (
          <p className="history-empty">正在翻上次的桌…</p>
        ) : history.length === 0 ? (
          <p className="history-empty">還沒玩過。開一桌就有了。</p>
        ) : (
          <div className="history-list">
            {history.slice(0, 4).map((game) => {
              const result = readGame(game);
              return (
                <article key={`${game.code}-${game.finishedAt}`}>
                  <strong>
                    {result.mine
                      ? `第 ${result.place} 名 · ${result.mine.total} 分`
                      : `${result.winner?.name} 獲勝`}
                  </strong>
                  <b>
                    {result.mine ? `勝者 ${result.winner?.total} 分` : result.winner?.total} ·{" "}
                    {formatHistoryDate(game.finishedAt)}
                  </b>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <footer>
        <p>慢慢玩就好。</p>
      </footer>
      {accountLayer}
      {settingsLayer}
    </main>
  );
}

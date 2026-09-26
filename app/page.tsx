"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  dieProfile,
  PIP_RADIUS,
  REDUCED_THROW_MS,
  renderReduced,
  renderResting,
  renderThrow,
  scheduleContact,
  SHADOW_CORE,
  SHADOW_GLOW,
  SLOT_POSITIONS,
  SPRITE_SIZE,
  throwFinished,
  type DieRender,
  type Throw,
} from "@/lib/dice-animation";
import {
  categories,
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
import { resultValue, maximumFinalScore, type SurrenderReason } from "@/lib/match";
import { Modal } from "./components/modal";
import { RequestScope } from "@/lib/request-scope";

type RoomState = {
  room: {
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
  players: Array<{ id: string; name: string; seat: number; surrenderReason: SurrenderReason }>;
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

const historyDate = new Intl.DateTimeFormat("zh-TW", {
  month: "long",
  day: "numeric",
});

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
/** Shared by all five sprites: the shadow is the same gradient under each. */
const SHADOW_GLOW_ID = "yazy-die-shadow-glow";
const SHADOW_CORE_ID = "yazy-die-shadow-core";

/**
 * The die-and-wordmark in the header. Same three-face isometric die as the
 * roll tray, drawn plain (no shared defs/ids) since it's the only instance
 * mounted at a time across the three header variants.
 */
function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 104 120"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="51.96,0 103.92,30 51.96,60 0,30" fill="#e8a06a" />
      <polygon points="51.96,60 103.92,30 103.92,90 51.96,120" fill="#d4864b" />
      <polygon points="0,30 51.96,60 51.96,120 0,90" fill="#b96e37" />
      <g fill="#fffdf9">
        <g transform="matrix(51.96,30,-51.96,30,51.96,0)">
          <circle cx="0.28" cy="0.28" r="0.105" />
          <circle cx="0.72" cy="0.28" r="0.105" />
          <circle cx="0.5" cy="0.5" r="0.105" />
          <circle cx="0.28" cy="0.72" r="0.105" />
          <circle cx="0.72" cy="0.72" r="0.105" />
        </g>
        <g opacity="0.92" transform="matrix(51.96,30,0,60,0,30)">
          <circle cx="0.5" cy="0.5" r="0.105" />
        </g>
        <g opacity="0.92" transform="matrix(51.96,-30,0,60,51.96,60)">
          <circle cx="0.28" cy="0.28" r="0.105" />
          <circle cx="0.5" cy="0.5" r="0.105" />
          <circle cx="0.72" cy="0.72" r="0.105" />
        </g>
      </g>
    </svg>
  );
}

/**
 * The two shadow gradients, rendered once for the whole tray. `url(#id)`
 * resolves document-wide, so five sprites can share one pair rather than
 * carrying their own copies.
 */
function DiceShadowDefs() {
  return (
    <svg aria-hidden="true" className="dice-defs" focusable="false">
      <defs>
        <radialGradient id={SHADOW_GLOW_ID}>
          <stop offset="0%" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="60%" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={SHADOW_CORE_ID}>
          <stop offset="0%" stopColor="#0a1424" stopOpacity="0.44" />
          <stop offset="55%" stopColor="#0a1424" stopOpacity="0.17" />
          <stop offset="100%" stopColor="#0a1424" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/** What the roll loop drives a sprite through, once per frame. */
type DieSpriteHandle = { apply: (frame: DieRender) => void };

/**
 * One die, as three shaded quads and their pips.
 *
 * While a die is in flight the frame loop writes straight to these nodes and
 * React is told to leave the sprite alone (see the `memo` comparison below).
 * Two reasons. A roll re-renders the board every time the room state is polled,
 * and re-rendering five dice mid-throw is exactly the work the throw does not
 * have; and `value` is the *server's* number, which arrives while the die is
 * still in the air — letting React paint it would flip the die in full view
 * instead of at the hand-off. Nothing is lost by holding React off: the last
 * frame of a throw is the resting pose for the same value React would draw.
 */
const DieSprite = memo(
  // `animating` is deliberately not destructured: it is read only by the
  // comparison at the bottom, which is the whole point of it.
  function DieSprite({
    value,
    register,
  }: {
    value: number;
    animating: boolean;
    register: (handle: DieSpriteHandle | null) => void;
  }) {
    const frame = renderResting(value);
    const dieRef = useRef<SVGGElement | null>(null);
    const shadowRef = useRef<SVGGElement | null>(null);
    const quadRefs = useRef<(SVGPolygonElement | null)[]>([]);
    const gridRefs = useRef<(SVGGElement | null)[]>([]);
    const pipRefs = useRef<(SVGCircleElement | null)[][]>([[], [], []]);

    const apply = useCallback((next: DieRender) => {
      dieRef.current?.setAttribute("transform", next.transform);
      shadowRef.current?.setAttribute("transform", next.shadowTransform);
      shadowRef.current?.setAttribute("opacity", `${next.shadowOpacity}`);
      next.faces.forEach((face, index) => {
        const quad = quadRefs.current[index];
        if (quad) {
          quad.setAttribute("points", face.points);
          quad.setAttribute("fill", face.fill);
        }
        const grid = gridRefs.current[index];
        if (grid) {
          grid.setAttribute("transform", `matrix(${face.matrix})`);
          grid.setAttribute("opacity", `${face.shade}`);
        }
        face.pips.forEach((opacity, slot) => {
          pipRefs.current[index][slot]?.setAttribute("opacity", `${opacity}`);
        });
      });
    }, []);

    useEffect(() => {
      register({ apply });
      return () => register(null);
    }, [apply, register]);

    return (
      <svg
        aria-hidden="true"
        className="die-sprite"
        focusable="false"
        viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
      >
        <g opacity={frame.shadowOpacity} ref={shadowRef} transform={frame.shadowTransform}>
          <ellipse
            fill={`url(#${SHADOW_GLOW_ID})`}
            rx={SHADOW_GLOW.rx}
            ry={SHADOW_GLOW.ry}
          />
          <ellipse
            fill={`url(#${SHADOW_CORE_ID})`}
            rx={SHADOW_CORE.rx}
            ry={SHADOW_CORE.ry}
          />
        </g>
        <g ref={dieRef} transform={frame.transform}>
          {/* Back to front: face 0 is the one squarest to the camera. */}
          <g className="die-shell">
            {[2, 1, 0].map((index) => (
              <polygon
                fill={frame.faces[index].fill}
                key={index}
                points={frame.faces[index].points}
                ref={(node) => {
                  quadRefs.current[index] = node;
                }}
              />
            ))}
          </g>
          <g className="die-pips">
            {[0, 1, 2].map((index) => (
              <g
                key={index}
                opacity={frame.faces[index].shade}
                ref={(node) => {
                  gridRefs.current[index] = node;
                }}
                transform={`matrix(${frame.faces[index].matrix})`}
              >
                {SLOT_POSITIONS.map((slot, position) => (
                  <circle
                    cx={slot.cx}
                    cy={slot.cy}
                    key={position}
                    opacity={frame.faces[index].pips[position]}
                    r={PIP_RADIUS}
                    ref={(node) => {
                      pipRefs.current[index][position] = node;
                    }}
                  />
                ))}
              </g>
            ))}
          </g>
        </g>
      </svg>
    );
  },
  (previous, next) =>
    previous.animating && next.animating
      ? true
      : previous.animating === next.animating &&
        previous.value === next.value &&
        previous.register === next.register,
);

/**
 * A die that never moves: the same sprite the tray uses, drawn once in its
 * resting pose. `register` is a module constant so the `memo` comparison below
 * sees a stable prop and never re-renders these.
 */
const NO_SPRITE_HANDLE = () => {};

function StillDie({ value }: { value: number }) {
  return (
    <span className="die-still">
      <DieSprite animating={false} register={NO_SPRITE_HANDLE} value={value} />
    </span>
  );
}

/**
 * The turn clock, shown only once it has actually run out.
 *
 * The server still expires a turn after 90s so a table isn't held hostage by
 * someone who closed the tab, but a visible countdown is the one thing this
 * design does not want on screen. So the clock ticks in here and stays silent
 * until the deadline passes, at which point the others are offered the skip.
 *
 * Owns its own 1s tick locally instead of lifting it into `Home` state, so the
 * tick does not re-render the score panel, player strip and dice tray along
 * with it — those don't depend on the clock, and re-rendering them every second
 * competed with the roll animation for main-thread time.
 *
 * The caller keys this on `turnDeadline` so a new turn remounts it and
 * `now` starts fresh from the lazy `useState` initializer, rather than this
 * component reading `Date.now()` mid-render to reset an existing clock —
 * that would make render impure.
 */
function TurnCountdown({
  turnDeadline,
  isMyTurn,
  currentPlayerName,
  busy,
  onSkip,
}: {
  turnDeadline: string;
  isMyTurn: boolean;
  currentPlayerName: string;
  busy: boolean;
  onSkip: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (Date.parse(turnDeadline) > now) return null;

  return (
    <div className="turn-timeout">
      <span>
        {isMyTurn
          ? "你離開有點久了，別人可以先跳過你"
          : `${currentPlayerName}好像離開了`}
      </span>
      {!isMyTurn && (
        <button disabled={busy} onClick={onSkip} type="button">
          跳過這個回合
        </button>
      )}
    </div>
  );
}

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
    setName(next.user.displayName);
    setProfileName(next.user.displayName);
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
    if (!session) return;
    const status = state?.room.status;
    if (status === "finished") return;
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
        document.visibilityState === "hidden" ? 15_000 : status === "waiting" ? 4_000 : 1_500;
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
  }, [fetchRoom, session, state?.room.status]);

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
  const soleSurvivor = activePlayers.length === 1 ? activePlayers[0] : null;
  const rolling = diceInFlight.some(Boolean);
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
    actionName: "start" | "roll" | "score" | "skip" | "surrender" | "finish",
    category?: CategoryId,
  ) {
    if (!session || !stateRef.current || actionBusyRef.current) return;
    const signal = roomScope.current.signal;
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
      if (!roomScope.current.accepts(signal)) return;
      if (actionName === "roll") startRollAnimation(heldRef.current, true);

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
              <span className="profile-avatar">{account.displayName.slice(0, 1).toUpperCase()}</span>
              <div>
                <h2>{account.displayName}</h2>
                <small>@{account.username}</small>
              </div>
            </div>
            <div className="auth-tabs">
              <button
                className={profileTab === "profile" ? "active" : ""}
                onClick={() => setProfileTab("profile")}
                type="button"
              >個人資料</button>
              <button
                className={profileTab === "record" ? "active" : ""}
                onClick={() => setProfileTab("record")}
                type="button"
              >戰績</button>
              <button
                className={profileTab === "friends" ? "active" : ""}
                onClick={() => setProfileTab("friends")}
                type="button"
              >
                好友
                {friends.incoming.length > 0 && (
                  <b className="tab-badge">{friends.incoming.length}</b>
                )}
              </button>
            </div>
            {profileTab === "profile" ? (
              <>
                <p className="record-note">統計最近 200 場完成對局</p>
                <div className="profile-stats">
                  <article><strong>{profile.stats.games}</strong><span>完成場次</span></article>
                  <article><strong>{profile.stats.wins}</strong><span>勝場</span></article>
                  <article><strong>{profile.stats.bestScore}</strong><span>最高分</span></article>
                  <article><strong>{profile.stats.averageScore}</strong><span>平均分</span></article>
                </div>
                <label className="profile-field">
                  <span>你想用什麼名字</span>
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
            ) : profileTab === "record" ? (
              <div className="record-block">
                <p className="record-note">個人與好友對戰統計以你最近 200 場完成對局為準。</p>
                <div className="profile-stats trio">
                  <article><strong>{stats.games}</strong><span>完成場次</span></article>
                  <article><strong>{stats.winRate}%</strong><span>勝率</span></article>
                  <article>
                    <strong>{stats.wins}<i>/{stats.contested}</i></strong>
                    <span>勝場</span>
                  </article>
                  <article><strong>{stats.bestScore}</strong><span>最高分</span></article>
                  <article><strong>{stats.averageScore}</strong><span>平均分</span></article>
                  <article><strong>{stats.yazyRate}%</strong><span>YAZY 率</span></article>
                </div>
                {stats.games === 0 ? (
                  <p className="friend-empty">還沒有打完的場次。玩完一桌就有了。</p>
                ) : (
                  <p className="record-note">
                    打出過 {stats.yazy} 次 YAZY
                    {stats.contested > 0 &&
                      ` · 對戰 ${stats.contested} 場，敗 ${stats.losses}${stats.ties > 0 ? `，和 ${stats.ties}` : ""}`}
                  </p>
                )}

                <div className="friend-group">
                  <h3>好友對戰</h3>
                  {rivals.length === 0 ? (
                    <p className="friend-empty">
                      還沒跟好友同桌過。開一桌邀他們來，這裡就會記著。
                    </p>
                  ) : (
                    rivals.map((friend) => (
                      <article className="friend-row" key={friend.friendshipId}>
                        <span className="avatar">
                          {friend.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="friend-copy">
                          <strong>{friend.displayName}</strong>
                          <small>
                            一起 {friend.record?.games} 場 · 平均 {friend.record?.myAverage} 比{" "}
                            {friend.record?.theirAverage}
                          </small>
                        </div>
                        <div className="versus-record">
                          <b>{friend.record?.wins}</b>勝
                          <b>{friend.record?.losses}</b>敗
                          {(friend.record?.ties ?? 0) > 0 && (
                            <>
                              <b>{friend.record?.ties}</b>和
                            </>
                          )}
                        </div>
                      </article>
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
                              {historyDate.format(new Date(game.finishedAt))} ·{" "}
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
                  <button
                    className="primary-action"
                    disabled={friendBusy || friendUsername.length < 3}
                    onClick={addFriend}
                    type="button"
                  >
                    {friendBusy ? "請稍候…" : "送出邀請"}
                  </button>
                </div>
                {friendError && <p className="form-error">{friendError}</p>}
                {friendNote && <p className="friend-note">{friendNote}</p>}

                {friends.incoming.length > 0 && (
                  <div className="friend-group">
                    <h3>等你回覆</h3>
                    {friends.incoming.map((person) => (
                      <article className="friend-row" key={person.friendshipId}>
                        <span className="avatar">
                          {person.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="friend-copy">
                          <strong>{person.displayName}</strong>
                          <small>@{person.username}</small>
                        </div>
                        <div className="friend-actions">
                          <button
                            className="friend-yes"
                            disabled={friendBusy}
                            onClick={() => respondToFriend(person.friendshipId, true)}
                            type="button"
                          >
                            接受
                          </button>
                          <button
                            className="friend-no"
                            disabled={friendBusy}
                            onClick={() => respondToFriend(person.friendshipId, false)}
                            type="button"
                          >
                            不用了
                          </button>
                        </div>
                      </article>
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
                      <article className="friend-row" key={friend.friendshipId}>
                        <span className="avatar">
                          {friend.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="friend-copy">
                          <strong>{friend.displayName}</strong>
                          <small>
                            {friend.record
                              ? `一起 ${friend.record.games} 場 · ${friend.record.wins} 勝 ${friend.record.losses} 敗${
                                  friend.record.ties > 0 ? ` ${friend.record.ties} 和` : ""
                                }`
                              : `${friend.games} 場 · 還沒同桌過`}
                          </small>
                        </div>
                        <div className="friend-actions">
                          <button
                            className="friend-no"
                            disabled={friendBusy}
                            onClick={() => respondToFriend(friend.friendshipId, false)}
                            type="button"
                          >
                            移除
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>

                {friends.outgoing.length > 0 && (
                  <div className="friend-group">
                    <h3>等對方回覆</h3>
                    {friends.outgoing.map((person) => (
                      <article className="friend-row" key={person.friendshipId}>
                        <span className="avatar">
                          {person.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="friend-copy">
                          <strong>{person.displayName}</strong>
                          <small>@{person.username}</small>
                        </div>
                        <div className="friend-actions">
                          <button
                            className="friend-no"
                            disabled={friendBusy}
                            onClick={() => respondToFriend(person.friendshipId, false)}
                            type="button"
                          >
                            取消
                          </button>
                        </div>
                      </article>
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
              {accountError && <p className="form-error">{accountError}</p>}
              <button
                className="primary-action"
                disabled={accountBusy}
                type="submit"
              >
                {accountBusy ? "請稍候…" : authMode === "login" ? "登入" : "開帳號"}
              </button>
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
          <button
            aria-pressed={soundEnabled}
            className="feedback-toggle"
            onClick={toggleSound}
            type="button"
          >
            落地音效{soundEnabled ? "開" : "關"}
          </button>
        </div>
    </Modal>
  ) : null;

  if (!initialized || (session && connecting && !state)) {
    return (
      <main className="game-shell connecting">
        <header className="topbar">
          <div className="brand">
            <BrandMark />
            <span>yazy</span>
          </div>
        </header>
        <section className="connecting-card" aria-live="polite">
          <span className="live-dot" />
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
            const label = (
              <span>
                {category.label}
                {bestPreview?.id === category.id && (
                  <span
                    className="best-tag"
                    title={`現在填入可增加 ${bestPreview.gain} 分${bestPreview.bonusGain ? "（含上半部獎勵 35 分）" : ""}；同分優先特殊牌型。未計算後續擲骰策略。`}
                  >
                    {bestPreview.bonusGain ? "含獎勵最多分" : "目前最多分"}
                  </span>
                )}
              </span>
            );

            if (saved) {
              return (
                <div aria-label={hint} className="score-row scored" key={category.id}>
                  {label}
                  <b>{saved.score}</b>
                </div>
              );
            }
            if (!fillable) {
              return (
                <div aria-label={hint} className="score-row readonly" key={category.id}>
                  {label}
                  <b>{preview === undefined ? "" : preview}</b>
                </div>
              );
            }
            return (
              <button
                aria-label={hint}
                className={`score-row ${preview === 0 ? "zero" : ""} ${
                  bestPreview?.id === category.id ? "best" : ""
                }`}
                disabled={busy || rolling}
                key={category.id}
                onClick={() => action("score", category.id)}
              >
                {label}
                <b>{preview}</b>
              </button>
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
        <div className="bonus-row">
          <span>
            {viewedSummary.bonus
              ? "上半部加成 +35 到手了"
              : `上半部再 ${63 - viewedSummary.upper} 分就有 +35`}
          </span>
          <strong>{viewedSummary.upper} / 63</strong>
        </div>
      </aside>
    );

    return (
      <main className="game-shell">
        <header className="topbar">
          <button className="brand" onClick={leaveRoom} aria-label="回到首頁">
            <BrandMark />
            <span>yazy</span>
          </button>
          <div className="topbar-actions">
            <div className="room-pill">
              <strong>{state.room.code}</strong>
              <button onClick={copyInvite}>{copied ? "已複製" : "邀請"}</button>
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

        {error && <div className="error-banner">{error}</div>}

        {state.room.status === "waiting" && (
          <section className="waiting-card">
            <h1>桌子開好了</h1>
            <p>把代碼給朋友，人到了再開始就好。</p>
            <div className="code-display">
              <strong>{state.room.code}</strong>
              <button onClick={copyInvite}>{copied ? "已複製" : "複製邀請"}</button>
            </div>
            <div className="lobby-seats">
              {state.players.map((player) => (
                <div className="seat" key={player.id}>
                  <span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span>
                  <span>
                    {player.name}
                    {player.id === session.playerId ? "（你）" : ""}
                  </span>
                </div>
              ))}
              <div className="seat empty">
                <span className="avatar" aria-hidden="true">
                  ＋
                </span>
                <span>還有位子</span>
              </div>
            </div>
            {account && friends.friends.length > 0 && (
              <div className="invite-friends">
                <h2>叫好友過來</h2>
                <div className="invite-friend-list">
                  {friends.friends.map((friend) => {
                    // 房間狀態只帶名字，而登入的人上桌用的就是顯示名稱，
                    // 所以名字對得上就當他已經在桌上。真正的把關在伺服器。
                    const seated = state.players.some(
                      (player) => player.name === friend.displayName,
                    );
                    const invited = invitedIds.includes(friend.userId);
                    return (
                      <article className="friend-row" key={friend.friendshipId}>
                        <span className="avatar">
                          {friend.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="friend-copy">
                          <strong>{friend.displayName}</strong>
                          <small>@{friend.username}</small>
                        </div>
                        <button
                          className="friend-invite"
                          disabled={seated || invited || friendBusy}
                          onClick={() => inviteFriend(friend.userId)}
                          type="button"
                        >
                          {seated ? "在桌上" : invited ? "已邀請" : "邀請"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
            {state.room.hostPlayerId === session.playerId ? (
              <button
                className="primary-action"
                disabled={busy || state.players.length < 2}
                onClick={() => action("start")}
              >
                {state.players.length < 2 ? "再等一個人" : "開始"}
              </button>
            ) : (
              <div className="waiting-note">
                <span className="live-dot" />
                等開桌的人按開始
              </div>
            )}
          </section>
        )}

        {state.room.status === "playing" && (
          <div className="game-grid">
            <section className="table-panel">
              <div className="concession-panel" aria-live="polite">
                {soleSurvivor ? (
                  <>
                    <strong>{soleSurvivor.id === session.playerId ? "你已獲勝！" : `${soleSurvivor.name}已獲勝`}</strong>
                    <p>其他玩家已投降。勝者可以繼續擲骰填滿計分卡，挑戰分數紀錄。</p>
                    {soleSurvivor.id === session.playerId && <button className="ghost-action" disabled={busy || rolling}
                      onClick={() => action("finish")} type="button">立即結算</button>}
                    {soleSurvivor.id === session.playerId && <p>想挑戰紀錄？直接繼續擲骰即可。</p>}
                  </>
                ) : me?.surrenderReason ? (
                  <p>{me.surrenderReason === "automatic" ? "剩餘最高分已無法追平領先者，系統已自動投降。" : "你已投降。"}仍可觀看本局。</p>
                ) : (
                  <>
                    <p>無法追平時會自動投降；勝者仍可繼續挑戰紀錄。你目前最高可達 {maximumFinalScore(state.scores.filter((score) => score.playerId === session.playerId))} 分。</p>
                    <button className="feedback-toggle" disabled={busy || rolling} type="button"
                      onClick={() => setConfirmSurrender(true)}>投降</button>
                  </>
                )}
              </div>
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

              <div
                className={`dice-tray ${isMyTurn ? "" : "idle"}`}
                aria-busy={rolling}
                aria-label="骰子區"
                aria-live="polite"
              >
                <DiceShadowDefs />
                {Array.from({ length: 5 }).map((_, index) => {
                  const die = state.room.dice[index];
                  const inFlight = diceInFlight[index];
                  return (
                    <button
                      aria-label={
                        inFlight
                          ? "骰子滾動中"
                          : die
                          ? `骰子 ${die}，${visibleHeld[index] ? "已保留" : "未保留"}`
                          : "尚未擲骰"
                      }
                      className={`die ${visibleHeld[index] ? "held" : ""} ${
                        !die && !inFlight ? "blank" : ""
                      } ${inFlight ? "rolling" : ""}`}
                      disabled={
                        !isMyTurn || state.room.rollsUsed === 0 || busy || inFlight
                      }
                      key={index}
                      onClick={() => toggleHeld(index)}
                    >
                      {die || inFlight ? (
                        <DieSprite
                          animating={inFlight}
                          register={registerSprite[index]}
                          value={die || blankThrowFace(index)}
                        />
                      ) : (
                        <span className="die-placeholder">·</span>
                      )}
                      {visibleHeld[index] && <small>留</small>}
                    </button>
                  );
                })}
              </div>

              {/* 擲得動的時候是一顆按鈕，擲不動的時候就換成一句話 —— 桌上不留
                  按不下去的鍵。 */}
              <div className="roll-actions">
                {isMyTurn && state.room.rollsUsed < 3 ? (
                  <button
                    className="roll-button"
                    disabled={busy || rolling}
                    onClick={() => action("roll")}
                  >
                    {rolling
                      ? "骰子還在滾…"
                      : state.room.rollsUsed === 0
                        ? "擲骰"
                        : "再擲一次"}
                  </button>
                ) : (
                  <div className="roll-status" aria-live="polite">
                    {isMyTurn ? (
                      "三次都擲完了"
                    ) : (
                      <>
                        <span className="avatar" aria-hidden="true">
                          {(currentPlayer?.name ?? "人").slice(0, 1).toUpperCase()}
                        </span>
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
                          ? "亮起來的格子都可以填，填了就換下一個人"
                          : "點骰子留下想保留的，再擲剩下的"
                      : `不用急，${currentPlayer?.name ?? "對方"}填完就換你`}
                </p>
                <button
                  aria-pressed={soundEnabled}
                  className="feedback-toggle"
                  onClick={toggleSound}
                  type="button"
                >
                  落地音效{soundEnabled ? "開" : "關"}
                </button>
              </div>

              <div className="players-strip" aria-label="這桌的人">
                {state.players.map((player) => {
                  const summary = scoreSummaries.get(player.id) ?? EMPTY_SCORE_SUMMARY;
                  return (
                    <article
                      className={`player-chip ${
                        player.seat === state.room.currentSeat ? "active" : ""
                      }`}
                      key={player.id}
                    >
                      <span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span>
                      <span className="player-copy">
                        {player.name}
                        {player.id === session.playerId ? "（你）" : ""}
                        <small>{summary.total}{player.surrenderReason ? ` · ${player.surrenderReason === "automatic" ? "自動投降" : "已投降"}` : ""}</small>
                      </span>
                    </article>
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
              <p>本局勝者是{rankings.filter((player) => !player.surrenderReason && scoreSummaries.get(player.id)?.total === scoreSummaries.get(rankings[0]?.id)?.total).map((player) => player.name).join("、") || "大家"}。玩得開心就好。</p>
              <ol className="podium">
                {rankings.map((player) => (
                  <li className={`podium-place place-${placeFor(resultValue(scoreSummaries.get(player.id)?.total ?? 0, player.surrenderReason), rankings.map((entry) => resultValue(scoreSummaries.get(entry.id)?.total ?? 0, entry.surrenderReason)))}`} key={player.id}>
                    <span className="rank">{placeFor(resultValue(scoreSummaries.get(player.id)?.total ?? 0, player.surrenderReason), rankings.map((entry) => resultValue(scoreSummaries.get(entry.id)?.total ?? 0, entry.surrenderReason)))}</span>
                    <span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span>
                    <strong>{player.name}{player.surrenderReason ? "（投降）" : ""}</strong>
                    <b>{scoreSummaries.get(player.id)?.total ?? 0}</b>
                  </li>
                ))}
              </ol>
              <div className="results-actions">
                <button className="primary-action" onClick={leaveRoom}>
                  再來一桌
                </button>
                <button
                  aria-expanded={showFinalCards}
                  className="ghost-action"
                  onClick={() => setShowFinalCards((open) => !open)}
                  type="button"
                >
                  {showFinalCards ? "收起計分卡" : "看計分卡"}
                </button>
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
              <button className="ghost-action" onClick={() => setConfirmSurrender(false)}>繼續玩</button>
              <button className="primary-action" disabled={busy} onClick={() => { setConfirmSurrender(false); void action("surrender"); }}>確認投降</button>
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
        <div className="brand">
          <BrandMark />
          <span>yazy</span>
        </div>
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

        <div className="hero-tray" aria-hidden="true">
          <DiceShadowDefs />
          <StillDie value={4} />
          <StillDie value={6} />
          <StillDie value={1} />
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
              開一桌
            </button>
            <button
              className={mode === "join" ? "active" : ""}
              onClick={() => {
                setMode("join");
                setError("");
              }}
            >
              加入朋友的桌
            </button>
          </div>
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
                disabled={Boolean(account)}
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

            {error && <p className="form-error">{error}</p>}
            <button
              className="primary-action"
              disabled={busy}
              onClick={() => enterRoom(mode)}
            >
              {busy ? "正在鋪桌子…" : mode === "create" ? "開一桌" : "進去"}
            </button>
            <p className="privacy-note">
              {account
                ? `會用「${account.displayName}」上桌，分數自動留著。`
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
                  <button
                    className="primary-action"
                    disabled={busy}
                    onClick={() => void enterRoom("join", invite.code)}
                    type="button"
                  >
                    {busy ? "正在過去…" : "進去"}
                  </button>
                  <button
                    className="text-action"
                    onClick={() => void dismissInvite(invite.id)}
                    type="button"
                  >
                    這次不了
                  </button>
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
            <div className="history-stats">
              <article><strong>{stats.games}</strong><span>場次</span></article>
              <article><strong>{stats.winRate}%</strong><span>勝率</span></article>
              <article><strong>{stats.bestScore}</strong><span>最高分</span></article>
              <article><strong>{stats.averageScore}</strong><span>平均分</span></article>
              <article><strong>{stats.yazyRate}%</strong><span>YAZY 率</span></article>
            </div>
          </>
        )}
        {account && <p className="record-note">統計最近 200 場完成對局</p>}
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
                    {historyDate.format(new Date(game.finishedAt))}
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

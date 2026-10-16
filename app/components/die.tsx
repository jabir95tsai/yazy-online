import { memo, useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  PIP_RADIUS,
  renderResting,
  SHADOW_CORE,
  SHADOW_GLOW,
  SLOT_POSITIONS,
  SPRITE_SIZE,
  type DieRender,
} from "../../lib/dice-animation";

/** Shared by all five sprites: the shadow is the same gradient under each. */
const SHADOW_GLOW_ID = "yazy-die-shadow-glow";
const SHADOW_CORE_ID = "yazy-die-shadow-core";

/**
 * The two shadow gradients, rendered once for the whole tray. `url(#id)`
 * resolves document-wide, so five sprites can share one pair rather than
 * carrying their own copies.
 */
export function DiceShadowDefs() {
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
export type DieSpriteHandle = { apply: (frame: DieRender) => void };

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
export const DieSprite = memo(
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
    const lastFrame = useRef<DieRender | null>(null);

    const apply = useCallback((next: DieRender) => {
      const previous = lastFrame.current;
      dieRef.current?.setAttribute("transform", next.transform);
      shadowRef.current?.setAttribute("transform", next.shadowTransform);
      shadowRef.current?.setAttribute("opacity", `${next.shadowOpacity}`);
      next.faces.forEach((face, index) => {
        const quad = quadRefs.current[index];
        if (quad) {
          if (previous?.faces[index].points !== face.points) quad.setAttribute("points", face.points);
          if (previous?.faces[index].fill !== face.fill) quad.setAttribute("fill", face.fill);
        }
        const grid = gridRefs.current[index];
        if (grid) {
          if (previous?.faces[index].matrix !== face.matrix) grid.setAttribute("transform", `matrix(${face.matrix})`);
          if (previous?.faces[index].shade !== face.shade) grid.setAttribute("opacity", `${face.shade}`);
        }
        face.pips.forEach((opacity, slot) => {
          if (previous?.faces[index].pips[slot] !== opacity) {
            pipRefs.current[index][slot]?.setAttribute("opacity", `${opacity}`);
          }
        });
      });
      lastFrame.current = next;
    }, []);

    // React cannot restore imperative animation writes when the value is unchanged.
    useLayoutEffect(() => {
      lastFrame.current = null;
      apply(frame);
    });

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
 * A sprite that nobody drives. A module constant so the `memo` comparison
 * sees a stable prop and never re-renders still dice.
 */
const NO_SPRITE_HANDLE = () => {};

/**
 * A die that never moves: the same sprite the tray uses, drawn once in its
 * resting pose. Needs a `DiceShadowDefs` somewhere on the page for its shadow.
 *
 * @category Dice
 */
export function StillDie({ value }: { value: number }) {
  return (
    <span className="die-still">
      <DieSprite animating={false} register={NO_SPRITE_HANDLE} value={value} />
    </span>
  );
}

/**
 * The landing page's decorative tray: a few `StillDie`s on the dark felt.
 * Brings its own `DiceShadowDefs`. `StillDie` is only sized inside this.
 *
 * @category Dice
 */
export function HeroTray({ children }: { children: ReactNode }) {
  return (
    <div className="hero-tray" aria-hidden="true">
      <DiceShadowDefs />
      {children}
    </div>
  );
}

/**
 * The dark felt the dice land on. Brings its own `DiceShadowDefs`, so the
 * `Die`s inside get their shadows. `idle` dims it while it's someone else's
 * turn; `yazy` makes it glow and sets the five dice hopping in a wave.
 *
 * @category Dice
 */
export function DiceTray({
  idle = false,
  rolling = false,
  yazy = false,
  children,
}: {
  idle?: boolean;
  rolling?: boolean;
  yazy?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`dice-tray ${idle ? "idle" : ""} ${yazy ? "yazy" : ""}`}
      aria-busy={rolling}
      aria-label="骰子區"
      aria-live="polite"
    >
      <DiceShadowDefs />
      {children}
    </div>
  );
}

/**
 * One tappable die in the tray. `value` 0 means not rolled yet (a quiet
 * placeholder); `held` marks it kept with 留; `rolling` shows the sprite in
 * flight, drawn at `throwFace` until the real value lands.
 *
 * @category Dice
 */
export function Die({
  value,
  held = false,
  rolling = false,
  throwFace = 1,
  register = NO_SPRITE_HANDLE,
  disabled,
  onClick,
}: {
  value: number;
  held?: boolean;
  rolling?: boolean;
  throwFace?: number;
  register?: (handle: DieSpriteHandle | null) => void;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={
        rolling
          ? "骰子滾動中"
          : value
          ? `骰子 ${value}，${held ? "已保留" : "未保留"}`
          : "尚未擲骰"
      }
      className={`die ${held ? "held" : ""} ${
        !value && !rolling ? "blank" : ""
      } ${rolling ? "rolling" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {value || rolling ? (
        <DieSprite
          animating={rolling}
          register={register}
          value={value || throwFace}
        />
      ) : (
        <span className="die-placeholder">·</span>
      )}
      {held && <small>留</small>}
    </button>
  );
}

const CONFETTI_COLORS = [
  "var(--accent)",
  "var(--accent-deep)",
  "var(--chip)",
  "var(--tray)",
  "#96a5c0",
  "#14315c",
  "var(--accent)",
];

/**
 * The confetti for a YAZY, scattered once with a fixed seed so every player
 * at the table sees the same shower and the server render matches the client.
 */
const CONFETTI = (() => {
  let seed = 11;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: 34 }, (_, index) => {
    const round = random() < 0.3;
    const width = round ? 9 : 6 + Math.round(random() * 6);
    const height = round ? 9 : 12 + Math.round(random() * 10);
    const left = Math.round(random() * 96 + 2);
    const delay = 300 + Math.round(random() * 900);
    const duration = 2400 + Math.round(random() * 1600);
    const rotate = Math.round(random() * 720 - 360);
    const sway = Math.round(random() * 40 - 20);
    return {
      animationDelay: `${delay}ms, ${delay}ms`,
      animationDuration: `${duration}ms, ${900 + (index % 5) * 150}ms`,
      background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      borderRadius: round ? "50%" : "2px",
      height,
      left: `${left}%`,
      width,
      "--confetti-rotate": `${rotate}deg`,
      "--confetti-sway": `${sway}px`,
    } as CSSProperties;
  });
})();

/** How long the last piece takes to fall: the longest delay plus duration. */
export const CONFETTI_MS = 1200 + 4000;

/**
 * A shower of confetti over the whole screen, played once from when it mounts.
 * Remount it (a new `key`) to play it again; it ignores the pointer.
 *
 * @category Dice
 */
export function YazyConfetti() {
  return (
    <div aria-hidden="true" className="yazy-confetti">
      {CONFETTI.map((style, index) => (
        <span key={index} style={style} />
      ))}
    </div>
  );
}

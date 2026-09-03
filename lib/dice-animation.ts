/**
 * The dice throw: a real 3D cube, drawn isometrically as flat SVG.
 *
 * Ported from the "Yazy 骰子擲骰動畫" design preview. The die is not a CSS
 * `preserve-3d` box any more — it is three quads projected from an actual
 * rotation matrix, shaded by a single light, with each face's pip grid welded
 * onto its own plane by an affine matrix. That buys three things the CSS cube
 * could not have: faces that shade as they turn, an outline that stays a
 * consistent weight, and no `preserve-3d` subtree for the compositor to smear.
 *
 * The design preview is a fixed 130-frame scrub. A real throw cannot be: the
 * die has to stay in the air until the server says what it landed on. So the
 * timeline here is split into a flight that runs for as long as it needs and a
 * landing that is scheduled once the answer arrives, joined by an exact
 * hand-off — see `resolveRotation`. Everything either side of that join (the
 * arc, the squash, the double bounce, the shadow) keeps the design's own shape
 * and easing, only expressed in milliseconds rather than frames.
 */

/* ── geometry ─────────────────────────────────────────────────────────── */

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Where `t` sits between `a` and `b`, clamped to 0-1. */
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const outQ = (u: number) => 1 - (1 - u) * (1 - u);
const inQ = (u: number) => u * u;
const outBack = (u: number) => 1 + 2.0 * Math.pow(u - 1, 3) + 1.3 * Math.pow(u - 1, 2);
const RAD = Math.PI / 180;

/**
 * Right-handed die: +y is 1, +z is 2, +x is 3. Opposite faces sum to 7.
 * `u` and `w` are the face's own in-plane axes, and the pip grid is welded to
 * them — never re-chosen per frame, so pips cannot twist as the cube turns.
 */
const FACES: { v: number; n: Vec3; u: Vec3; w: Vec3 }[] = [
  { v: 1, n: [0, 1, 0], u: [1, 0, 0], w: [0, 0, 1] },
  { v: 6, n: [0, -1, 0], u: [1, 0, 0], w: [0, 0, -1] },
  { v: 3, n: [1, 0, 0], u: [0, 0, -1], w: [0, -1, 0] },
  { v: 4, n: [-1, 0, 0], u: [0, 0, 1], w: [0, -1, 0] },
  { v: 2, n: [0, 0, 1], u: [1, 0, 0], w: [0, -1, 0] },
  { v: 5, n: [0, 0, -1], u: [-1, 0, 0], w: [0, -1, 0] },
];

/**
 * Pip layouts by slot name. Every layout is 180-degree symmetric, which is why
 * a rigid-but-flipped grid is visually identical and needs no correction.
 */
const PIPS: Record<number, string[]> = {
  1: ["C"],
  2: ["TL", "BR"],
  3: ["TL", "C", "BR"],
  4: ["TL", "TR", "BL", "BR"],
  5: ["TL", "TR", "BL", "BR", "C"],
  6: ["TL", "TR", "ML", "MR", "BL", "BR"],
};

/**
 * Slot order. The renderer emits its seven circles in exactly this order, so a
 * frame's `pips` array indexes straight onto them.
 */
export const SLOTS = ["TL", "TR", "ML", "MR", "BL", "BR", "C"] as const;

/** Unit-square positions of each slot, in the order above. */
export const SLOT_POSITIONS: { cx: number; cy: number }[] = [
  { cx: 0.28, cy: 0.28 },
  { cx: 0.72, cy: 0.28 },
  { cx: 0.28, cy: 0.5 },
  { cx: 0.72, cy: 0.5 },
  { cx: 0.28, cy: 0.72 },
  { cx: 0.72, cy: 0.72 },
  { cx: 0.5, cy: 0.5 },
];

export const PIP_RADIUS = 0.105;

const nrm = (a: Vec3): Vec3 => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
};
const add = (a: Vec3, b: Vec3, s: number): Vec3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function rotM(axis: Vec3, ang: number): Mat3 {
  const [x, y, z] = nrm(axis);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

function mm(A: Mat3, B: Mat3): Mat3 {
  const R: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return R;
}

const mv = (M: Mat3, v: Vec3): Vec3 => [
  M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
  M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
  M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
];

/** Rotation matrices are orthonormal, so the inverse is the transpose. */
const transpose = (M: Mat3): Mat3 => [
  [M[0][0], M[1][0], M[2][0]],
  [M[0][1], M[1][1], M[2][1]],
  [M[0][2], M[1][2], M[2][2]],
];

const I3: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Resting orientation per value: bring that value's face normal to +y, then
 * yaw the whole body so every resting top face lands with its pip grid in the
 * same isometric orientation. Both steps are rigid, so the pose stays
 * physically reachable rather than being a per-face fudge.
 */
const UP: Record<number, Mat3> = {
  1: I3,
  6: rotM([1, 0, 0], Math.PI),
  2: rotM([1, 0, 0], -Math.PI / 2),
  5: rotM([1, 0, 0], Math.PI / 2),
  3: rotM([0, 0, 1], Math.PI / 2),
  4: rotM([0, 0, 1], -Math.PI / 2),
};
const NORM: Record<number, number> = { 1: 0, 2: 0, 3: -90, 4: 90, 5: 180, 6: 0 };

const BASE: Record<number, Mat3> = {};
[1, 2, 3, 4, 5, 6].forEach((v) => {
  BASE[v] = mm(rotM([0, 1, 0], NORM[v] * RAD), UP[v]);
});

const baseFor = (value: number) => BASE[clamp(Math.round(value) || 1, 1, 6)] ?? BASE[1];

/* ── projection and shading ───────────────────────────────────────────── */

/** Isometric projection into the die's own 140x156 box; half-cube is 30 units. */
const SU = 30;
const C30 = Math.cos(Math.PI / 6);
const proj = (p: Vec3): [number, number] => [
  70 + (p[0] - p[2]) * C30 * SU,
  78 + ((p[0] + p[2]) * 0.5 - p[1]) * SU,
];
/** The camera sits along +(1,1,1); a face is visible when its normal points at it. */
const facing = (N: Vec3) => N[0] + N[1] + N[2];
/** One light, 45 degrees upper-left: top face brightest, then render-left, then right. */
const LIGHT = nrm([0.25, 1, 0.7]);
const LO: Vec3 = [176, 190, 211];

function shade(N: Vec3) {
  const t = clamp(dot(N, LIGHT) * 1.12, 0, 1);
  return {
    fill: `rgb(${Math.round(lerp(LO[0], 255, t))},${Math.round(
      lerp(LO[1], 255, t),
    )},${Math.round(lerp(LO[2], 255, t))})`,
    pip: 0.7 + 0.3 * t,
  };
}

export type FaceRender = {
  /** Polygon points for the face quad, in the 140x156 box. */
  points: string;
  fill: string;
  /** Affine matrix binding the unit pip grid onto this face's plane. */
  matrix: string;
  /** Group opacity for this face's pips — the shading term. */
  shade: number;
  /** Per-slot opacity, in `SLOTS` order. */
  pips: number[];
};

const HIDDEN_FACE: FaceRender = {
  points: "",
  fill: "none",
  matrix: "1,0,0,1,0,0",
  shade: 0,
  pips: [0, 0, 0, 0, 0, 0, 0],
};

/** The three viewer-facing faces under orientation `M`, as SVG quads. */
function buildFaces(M: Mat3, pipOpacity: number): FaceRender[] {
  const visible = FACES.map((F) => {
    const N = mv(M, F.n);
    return { F, N, d: facing(N) };
  })
    .sort((a, b) => b.d - a.d)
    .slice(0, 3);

  return visible.map((o) => {
    const { N } = o;
    const u = mv(M, o.F.u);
    const w = mv(M, o.F.w);
    const p00 = proj(add(add(N, u, -1), w, -1));
    const p10 = proj(add(add(N, u, 1), w, -1));
    const p11 = proj(add(add(N, u, 1), w, 1));
    const p01 = proj(add(add(N, u, -1), w, 1));
    const sh = shade(N);
    const lit = PIPS[o.F.v] ?? [];
    return {
      points: [p00, p10, p11, p01]
        .map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`)
        .join(" "),
      fill: sh.fill,
      matrix: [
        p10[0] - p00[0],
        p10[1] - p00[1],
        p01[0] - p00[0],
        p01[1] - p00[1],
        p00[0],
        p00[1],
      ]
        .map((x) => x.toFixed(3))
        .join(","),
      shade: sh.pip,
      pips: SLOTS.map((slot) => (lit.includes(slot) ? pipOpacity : 0)),
    };
  });
}

/* ── the sprite's coordinate space ────────────────────────────────────── */

/**
 * Everything is drawn in the die's own units, so the whole sprite is one SVG
 * that scales with its box. The design worked in a 220px container with a die
 * 44% of it wide; 318 die-units is the same ratio (140 / 318 = 0.440).
 */
export const SPRITE_SIZE = 318;
const CENTER = SPRITE_SIZE / 2;
/**
 * The die box is anchored by its centre-x and 54% of its height, which sits
 * 6.24 units above the box centre — its contact point, not its middle.
 */
const ANCHOR_OFFSET = -6.24;
const SHADOW_Y = SPRITE_SIZE * 0.7;
export const SHADOW_CORE = { rx: SPRITE_SIZE * 0.21, ry: SPRITE_SIZE * 0.055 };
export const SHADOW_GLOW = { rx: SPRITE_SIZE * 0.26, ry: SPRITE_SIZE * 0.075 };
const APEX = SPRITE_SIZE * 0.125;

export type DieRender = {
  faces: FaceRender[];
  /** `transform` for the die group. */
  transform: string;
  /** `transform` for the shadow group. */
  shadowTransform: string;
  shadowOpacity: number;
};

function compose(
  M: Mat3,
  height: number,
  sx: number,
  sy: number,
  rot: number,
  shadowScale: number,
  shadowOpacity: number,
  pipOpacity: number,
): DieRender {
  const faces = buildFaces(M, pipOpacity);
  while (faces.length < 3) faces.push(HIDDEN_FACE);
  return {
    faces,
    // Rotation and scale are taken about the die box's own centre (70, 78),
    // then the box is hung off the anchor above.
    transform:
      `translate(${CENTER.toFixed(2)},${(CENTER + ANCHOR_OFFSET - height).toFixed(2)}) ` +
      `rotate(${rot.toFixed(2)}) scale(${sx.toFixed(4)},${sy.toFixed(4)}) translate(-70,-78)`,
    shadowTransform:
      `translate(${CENTER.toFixed(2)},${SHADOW_Y.toFixed(2)}) scale(${shadowScale.toFixed(4)})`,
    shadowOpacity,
  };
}

/* ── the throw ────────────────────────────────────────────────────────── */

/** Anticipation squash, before the die leaves the hand. */
const CROUCH_MS = 83;
/** Launch to the top of the arc. */
const ASCENT_MS = 583;
/** Top of the arc to first contact, when nothing is holding the die up. */
const DESCENT_MS = 717;
/** A drop cannot be cut shorter than this, however late the answer arrives. */
const MIN_DESCENT_MS = 240;
/** First contact to the top of the bounce, and back down again. */
const BOUNCE_MS = 150;
/** First contact to fully static — the residual roll bleeding off. */
const SETTLE_MS = 283;
/**
 * How long before contact the die stops tumbling freely and resolves onto its
 * rolled face. This is a real deceleration from the tumble's own speed down to
 * a dead stop, and at roughly 1100 deg/s that takes most of the descent to bleed
 * off over a turn or so — anything much shorter reads as the die being yanked
 * onto its face.
 */
const RESOLVE_MS = 520;
/** A correction shorter than this reads as a snap rather than a roll. */
const MIN_RESOLVE_SWEEP = 1.5;
/**
 * The flight the design was drawn for. Pins the spin rates below, and is the
 * earliest a die may touch down.
 */
export const NOMINAL_FLIGHT_MS = ASCENT_MS + DESCENT_MS;
/** Contact cannot be scheduled before this, measured from the click. */
export const MIN_FLIGHT_MS = CROUCH_MS + NOMINAL_FLIGHT_MS;
/** Everything from the click to a die standing still, with no server wait. */
export const NOMINAL_THROW_MS = MIN_FLIGHT_MS + SETTLE_MS;
/** How long the reduced-motion pose takes to finish. */
export const REDUCED_THROW_MS = 367;

/**
 * The die leaves the hand at rest and reaches full spin over this long, so it
 * does not start at speed. Velocity ramps linearly, so the angle stays smooth.
 */
const SPIN_RAMP_MS = 180;
const spinPhase = (t: number) =>
  t <= SPIN_RAMP_MS ? (t * t) / (2 * SPIN_RAMP_MS) : t - SPIN_RAMP_MS / 2;
const NOMINAL_SPIN_PHASE = spinPhase(NOMINAL_FLIGHT_MS);
/**
 * Pinned so a nominal flight sweeps exactly what the design swept: yaw from
 * -38 degrees to two full turns, pitch from -22 to three.
 */
const YAW_RATE = (720 + 38) / NOMINAL_SPIN_PHASE;
const PITCH_RATE = (1080 + 22) / NOMINAL_SPIN_PHASE;

export type DieProfile = {
  /** Multiplier on both spin rates — a die thrown a little harder or softer. */
  rate: number;
  yawSign: 1 | -1;
  pitchSign: 1 | -1;
  /** How far the pitch axis leans out of the screen plane. */
  tilt: number;
};

export const DIE_PROFILES: DieProfile[] = [
  { rate: 1.0, yawSign: 1, pitchSign: 1, tilt: 0.38 },
  { rate: 1.14, yawSign: -1, pitchSign: 1, tilt: 0.22 },
  { rate: 0.92, yawSign: 1, pitchSign: -1, tilt: 0.52 },
  { rate: 1.08, yawSign: 1, pitchSign: 1, tilt: 0.3 },
  { rate: 0.96, yawSign: -1, pitchSign: -1, tilt: 0.45 },
];

export const dieProfile = (index: number) => DIE_PROFILES[index] ?? DIE_PROFILES[0];

export type Throw = {
  /** `performance.now()` at the click. */
  startedAt: number;
  /**
   * The face the die shows while it is in the air — the one it was thrown with.
   * It must not change mid-flight, so the rolled value only arrives at the
   * hand-off below.
   */
  airborneFace: number;
  /** The rolled value, once the server has answered. */
  target: number | null;
  /**
   * Absolute time of ground contact, once the landing has been scheduled. Null
   * until then, which is what keeps the die hanging at the top of its arc.
   */
  contactAt: number | null;
  profile: DieProfile;
};

/** Yaw, in degrees, `flightMs` into the flight. */
const yawAt = (profile: DieProfile, phase: number) =>
  (-38 + YAW_RATE * phase) * profile.yawSign;

/** Free-tumble orientation `flightMs` into the flight. */
function tumble(profile: DieProfile, flightMs: number, base: Mat3): Mat3 {
  const phase = spinPhase(Math.max(0, flightMs)) * profile.rate;
  const yaw = yawAt(profile, phase) * RAD;
  const pitch = (-22 + PITCH_RATE * phase) * profile.pitchSign * RAD;
  return mm(mm(rotM([0, 1, 0], yaw), rotM([1, 0, profile.tilt], pitch)), base);
}

/**
 * The tumble's angular velocity in world axes, in radians per millisecond.
 * Only valid past the launch ramp, which is the only place it is asked for.
 */
function spinVelocity(profile: DieProfile, yawDeg: number): Vec3 {
  const pitchAxis = mv(rotM([0, 1, 0], yawDeg * RAD), nrm([1, 0, profile.tilt]));
  const yawTerm = YAW_RATE * profile.yawSign * profile.rate * RAD;
  const pitchTerm = PITCH_RATE * profile.pitchSign * profile.rate * RAD;
  return [
    pitchAxis[0] * pitchTerm,
    yawTerm + pitchAxis[1] * pitchTerm,
    pitchAxis[2] * pitchTerm,
  ];
}

/** Axis and angle (0 to pi) of a rotation matrix. */
function axisAngle(M: Mat3): { axis: Vec3; angle: number } {
  const trace = M[0][0] + M[1][1] + M[2][2];
  const angle = Math.acos(clamp((trace - 1) / 2, -1, 1));
  if (angle < 1e-6) return { axis: [0, 1, 0], angle: 0 };
  if (angle > Math.PI - 1e-6) {
    // A half turn: the off-diagonal terms all vanish, so read the axis off
    // (M + I) / 2 instead, whose columns are all parallel to it. These come up
    // constantly here — 1 and 6 are exactly a half turn apart.
    const K: Mat3 = [
      [(M[0][0] + 1) / 2, M[0][1] / 2, M[0][2] / 2],
      [M[1][0] / 2, (M[1][1] + 1) / 2, M[1][2] / 2],
      [M[2][0] / 2, M[2][1] / 2, (M[2][2] + 1) / 2],
    ];
    const i = K[0][0] >= K[1][1] && K[0][0] >= K[2][2] ? 0 : K[1][1] >= K[2][2] ? 1 : 2;
    return { axis: nrm([K[0][i], K[1][i], K[2][i]]), angle: Math.PI };
  }
  const s = 2 * Math.sin(angle);
  return {
    axis: [(M[2][1] - M[1][2]) / s, (M[0][2] - M[2][0]) / s, (M[1][0] - M[0][1]) / s],
    angle,
  };
}

/**
 * Hands the die over from the free tumble onto its rolled face: no jump, no
 * change of pace, no reversing.
 *
 * At `resolveStart` the die is wherever the tumble left it. Writing that pose
 * as `C · BASE[target]` makes `C` the whole of what is still wrong, so winding
 * `C` down to identity lands the die exactly on `target` while starting from
 * exactly where it already was.
 *
 * Two things stop that from reading as the animation being switched off. Whole
 * extra turns are added to `C`'s angle — invisible at the start, since a turn
 * of 2pi is the identity, but without them the correction takes the short way
 * round, which looks like the die bouncing backwards off nothing. And the wind
 * down is `(1 - u) ** power` with `power` solved so its opening speed is the
 * tumble's own speed, rather than a fixed ease that would have the die lurch
 * or stall at the seam. The turn count is chosen to keep `power` near a
 * constant deceleration, so the die rolls to a stop the way a real one does.
 */
function resolveRotation(
  profile: DieProfile,
  resolveStart: number,
  startedAt: number,
  airborneFace: number,
  target: number,
  duration: number,
) {
  const flightMs = resolveStart - startedAt - CROUCH_MS;
  const phase = spinPhase(Math.max(0, flightMs)) * profile.rate;
  const from = tumble(profile, flightMs, baseFor(airborneFace));
  const { axis, angle } = axisAngle(mm(from, transpose(baseFor(target))));

  // The correction winds down from its angle to 0, so the die turns about
  // -axis. Flip so that is the way it was already going.
  const omega = spinVelocity(profile, yawAt(profile, phase));
  const forward = dot(axis, omega) > 0 ? -1 : 1;
  const signed = forward > 0 ? angle : 2 * Math.PI - angle;

  // Under constant deceleration the sweep is half the opening speed times the
  // time, so that is the turn count to aim for; it is then nudged to the
  // nearest one the die can actually reach from where it is.
  const speed = Math.hypot(omega[0], omega[1], omega[2]);
  const ideal = (speed * duration) / 2;
  let turns = Math.max(0, Math.round((ideal - signed) / (2 * Math.PI)));
  if (signed + turns * 2 * Math.PI < MIN_RESOLVE_SWEEP) turns += 1;
  const sweep = signed + turns * 2 * Math.PI;

  return {
    axis: [axis[0] * forward, axis[1] * forward, axis[2] * forward] as Vec3,
    angle: sweep,
    power: clamp((speed * duration) / sweep, 1.2, 3.5),
  };
}

/** Where contact should be scheduled, given how long the answer took. */
export function scheduleContact(startedAt: number, now: number, stagger: number): number {
  const natural = startedAt + MIN_FLIGHT_MS + stagger;
  // A late answer cannot pull the die out of the air instantly — it still has
  // to fall. The drop is compressed rather than skipped.
  return Math.max(natural, now + MIN_DESCENT_MS + stagger);
}

/** The resting pose: what a die that is not being thrown looks like. */
export function renderResting(value: number): DieRender {
  return compose(baseFor(value), 0, 1, 1, 0, 1, 0.9, 1);
}

/**
 * The design's reduced-motion pose: the die pops in on its rolled face with a
 * single overshoot and no travel, spin or bounce.
 */
export function renderReduced(value: number, elapsed: number): DieRender {
  const scale = outBack(seg(elapsed, 0, REDUCED_THROW_MS));
  const fade = seg(elapsed, 0, 167);
  return compose(baseFor(value), 0, scale, scale, 0, 1, 0.85 * fade, fade);
}

/** True once the die has come to rest and the frame loop can stop. */
export function throwFinished(spec: Throw, now: number): boolean {
  return spec.contactAt !== null && now >= spec.contactAt + SETTLE_MS;
}

export function renderThrow(spec: Throw, now: number): DieRender {
  const { profile, startedAt, contactAt } = spec;
  const t = Math.max(0, now - startedAt);
  const apexAt = CROUCH_MS + ASCENT_MS;

  // Until the landing is scheduled the die hangs at the top of its arc, which
  // is where a thrown die spends its slowest moment anyway.
  const contact = contactAt ?? Number.POSITIVE_INFINITY;
  const descentStart = Math.max(startedAt + apexAt, contact - DESCENT_MS);
  const sinceContact = now - contact;

  /* height above the table */
  let height: number;
  if (t < CROUCH_MS) height = 0;
  else if (now < descentStart) height = lerp(0, APEX, outQ(seg(t, CROUCH_MS, apexAt)));
  else if (now < contact) height = lerp(APEX, 0, inQ(seg(now, descentStart, contact)));
  else if (sinceContact < BOUNCE_MS)
    height = lerp(0, APEX * 0.16, outQ(seg(sinceContact, 0, BOUNCE_MS)));
  else if (sinceContact < BOUNCE_MS * 2)
    height = lerp(APEX * 0.16, 0, inQ(seg(sinceContact, BOUNCE_MS, BOUNCE_MS * 2)));
  else height = 0;

  /* squash and stretch: the crouch, then both landings */
  let sx = 1;
  let sy = 1;
  if (t < CROUCH_MS) {
    const u = seg(t, 0, CROUCH_MS);
    sx = lerp(1, 1.12, u);
    sy = lerp(1, 0.86, u);
  } else if (t < 183) {
    const u = outQ(seg(t, CROUCH_MS, 183));
    sx = lerp(1.12, 0.95, u);
    sy = lerp(0.86, 1.06, u);
  } else if (t < 283) {
    const u = outQ(seg(t, 183, 283));
    sx = lerp(0.95, 1, u);
    sy = lerp(1.06, 1, u);
  }
  if (sinceContact >= 0 && sinceContact < 133) {
    const u = outBack(seg(sinceContact, 0, 133));
    sx = lerp(1.2, 1, u);
    sy = lerp(0.78, 1, u);
  } else if (sinceContact >= BOUNCE_MS && sinceContact < BOUNCE_MS + 100) {
    const u = outBack(seg(sinceContact, BOUNCE_MS, BOUNCE_MS + 100));
    sx = lerp(1.09, 1, u);
    sy = lerp(0.89, 1, u);
  }

  /* orientation */
  let M: Mat3;
  const resolveStart = Math.max(contact - RESOLVE_MS, startedAt + CROUCH_MS);
  if (spec.target === null || now < resolveStart) {
    M = tumble(profile, t - CROUCH_MS, baseFor(spec.airborneFace));
  } else if (now >= contact) {
    M = baseFor(spec.target);
  } else {
    const { axis, angle, power } = resolveRotation(
      profile,
      resolveStart,
      startedAt,
      spec.airborneFace,
      spec.target,
      contact - resolveStart,
    );
    const u = seg(now, resolveStart, contact);
    M = mm(rotM(axis, angle * Math.pow(1 - u, power)), baseFor(spec.target));
  }

  /* residual screen-space roll, on top of the real 3D turn */
  let rot = 0;
  if (t >= CROUCH_MS && now < contact) {
    rot = Math.sin(seg(now, startedAt + CROUCH_MS, contact) * Math.PI * 2) * -9;
  } else if (sinceContact >= 0 && sinceContact < SETTLE_MS) {
    const u = seg(sinceContact, 0, SETTLE_MS);
    rot = (1 - u) * Math.sin(u * Math.PI * 2.6) * 5;
  }

  /* shadow: tight and dark on the table, wide and faint at the top of the arc */
  const lift = height / APEX;
  let shadowScale = lerp(1, 0.58, lift);
  if (sinceContact >= 0 && sinceContact < 133) {
    shadowScale *= lerp(1.18, 1, outQ(seg(sinceContact, 0, 133)));
  }

  return compose(M, height, sx, sy, rot, shadowScale, lerp(0.9, 0.22, lift), 1);
}

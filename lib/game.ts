export const categoryIds = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "threeKind",
  "fourKind",
  "fullHouse",
  "smallStraight",
  "largeStraight",
  "yazy",
  "chance",
] as const;

export type CategoryId = (typeof categoryIds)[number];

export function fairDieFromByte(byte: number) {
  return Number.isInteger(byte) && byte >= 0 && byte < 252 ? (byte % 6) + 1 : null;
}

export const categories: Array<{
  id: CategoryId;
  label: string;
  hint: string;
  group: "upper" | "lower";
}> = [
  { id: "ones", label: "一點", hint: "所有 1 的總和", group: "upper" },
  { id: "twos", label: "二點", hint: "所有 2 的總和", group: "upper" },
  { id: "threes", label: "三點", hint: "所有 3 的總和", group: "upper" },
  { id: "fours", label: "四點", hint: "所有 4 的總和", group: "upper" },
  { id: "fives", label: "五點", hint: "所有 5 的總和", group: "upper" },
  { id: "sixes", label: "六點", hint: "所有 6 的總和", group: "upper" },
  { id: "threeKind", label: "三條", hint: "至少三顆相同", group: "lower" },
  { id: "fourKind", label: "四條", hint: "至少四顆相同", group: "lower" },
  { id: "fullHouse", label: "葫蘆", hint: "三顆＋兩顆", group: "lower" },
  { id: "smallStraight", label: "小順", hint: "連續四個點數", group: "lower" },
  { id: "largeStraight", label: "大順", hint: "連續五個點數", group: "lower" },
  { id: "yazy", label: "YAZY", hint: "五顆完全相同", group: "lower" },
  { id: "chance", label: "機會", hint: "所有骰子總和", group: "lower" },
];

export function scoreDice(category: CategoryId, dice: number[]) {
  if (dice.length !== 5 || dice.some((die) => die < 1 || die > 6)) return 0;
  const counts = Array.from({ length: 7 }, (_, value) =>
    dice.filter((die) => die === value).length,
  );
  const sum = dice.reduce((total, die) => total + die, 0);
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  const sequence = unique.join("");

  const upperIndex = categoryIds.indexOf(category);
  if (upperIndex >= 0 && upperIndex <= 5) {
    const face = upperIndex + 1;
    return counts[face] * face;
  }

  switch (category) {
    case "threeKind":
      return counts.some((count) => count >= 3) ? sum : 0;
    case "fourKind":
      return counts.some((count) => count >= 4) ? sum : 0;
    case "fullHouse":
      return counts.includes(3) && counts.includes(2) ? 25 : 0;
    case "smallStraight":
      return ["1234", "2345", "3456"].some((run) => sequence.includes(run))
        ? 30
        : 0;
    case "largeStraight":
      return sequence === "12345" || sequence === "23456" ? 40 : 0;
    case "yazy":
      return counts.includes(5) ? 50 : 0;
    case "chance":
      return sum;
  }

  return 0;
}

// At equal total gain, prefer combinations over face totals and save Chance.
const recommendationOrder: readonly CategoryId[] = [
  "yazy", "largeStraight", "smallStraight", "fullHouse", "fourKind", "threeKind",
  "sixes", "fives", "fours", "threes", "twos", "ones", "chance",
];

export function recommendScore(
  previews: ReadonlyMap<CategoryId, number>,
  entries: Array<{ category: string; score: number }>,
) {
  const filled = new Set(entries.map((entry) => entry.category));
  const currentTotal = scoreSummary(entries).total;
  let best: { id: CategoryId; score: number; gain: number; bonusGain: number } | null = null;
  for (const id of recommendationOrder) {
    const score = previews.get(id);
    if (filled.has(id) || score === undefined || score <= 0) continue;
    const gain = scoreSummary([...entries, { category: id, score }]).total - currentTotal;
    if (!best || gain > best.gain) {
      best = { id, score, gain, bonusGain: gain - score };
    }
  }
  return best;
}

export function scoreSummary(entries: Array<{ category: string; score: number }>) {
  const upper = entries
    .filter((entry) => categoryIds.slice(0, 6).includes(entry.category as CategoryId))
    .reduce((total, entry) => total + entry.score, 0);
  const bonus = upper >= 63 ? 35 : 0;
  const lower = entries
    .filter((entry) => !categoryIds.slice(0, 6).includes(entry.category as CategoryId))
    .reduce((total, entry) => total + entry.score, 0);
  return { upper, bonus, lower, total: upper + bonus + lower };
}

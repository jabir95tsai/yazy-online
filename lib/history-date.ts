const formatter = new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric" });

/** Room timestamps include a uniqueness suffix after milliseconds. Keep that
 * full value for concurrency/identity, but only parse standard ISO precision
 * for display: WebKit rejects the extended fractional seconds. */
export function formatHistoryDate(value: string) {
  const normalized = value.replace(/(\.\d{3})\d+(?=Z$)/, "$1");
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? formatter.format(date) : "日期不明";
}

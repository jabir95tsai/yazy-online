# yazy battle! — how to build with it

A quiet, warm Traditional Chinese (zh-TW) dice game. Warm off-white paper, rounded cards, and a single apricot accent. The only dark surface is the dice tray. UI copy is short, casual zh-TW (e.g. 開一桌, 慢慢玩就好). Write new copy in that voice.

## Setup

No provider or wrapper. Link `styles.css` and use `window.YazyBattle.*`. Put the page on the paper background: `body { background: var(--paper); color: var(--ink); }`. `styles.css` already sets the body font (Geist, then the system CJK font).

## Styling idiom: plain CSS classes + `var(--*)` tokens

Components carry their own classes, so don't restyle them. For your own layout glue, use these tokens. Don't invent colors.

| Token | Use |
|---|---|
| `--paper` | page background |
| `--card` | cards, panels, dialogs |
| `--ink` / `--ink-soft` / `--ink-muted` | text: primary / secondary / hints (all pass AA on `--card`) |
| `--accent` | apricot fill (buttons, badges). Never use as text color |
| `--accent-deep` | apricot as text or outline |
| `--accent-ink` | text on an `--accent` fill |
| `--accent-wash`, `--accent-wash-strong` | soft apricot tint backgrounds |
| `--tray` | the dark dice felt (dice only) |
| `--chip`, `--sunk`, `--sunk-strong`, `--hairline` | avatar chips, inset rows, dividers |
| `--lift`, `--lift-soft` | card shadows |

Shape language: cards use a 28px radius with `box-shadow: var(--lift)`. Inset rows use 16–18px on `--sunk`. Buttons and chips are full pills (999px). Text is bold (700–800) for labels and numbers.

App layout classes you can reuse as containers: `account-panel` (dialog or panel card), `join-card` and `results-card` (content cards), `waiting-card`, `friend-group` (a titled list with `<h3>`), `players-strip`, `results-actions` (a primary + ghost button row), `profile-field` and `auth-form` (a label with a `<span>` above an `<input>`), `topbar` (header row).

## Components by job

- **Actions:** `Button` (`variant`: primary | ghost | text | toggle | roll; one primary per screen), `SegmentedTabs` (`variant` card | panel).
- **Dice:** `DiceTray` > `Die` (`value` 0 = not rolled, `held`, `idle` tray for someone else's turn). For decoration: `HeroTray` > `StillDie`. `StillDie` is sized only inside `HeroTray`.
- **Scorecard:** `ScoreRow` (`status` scored | readonly | open, `best`, `tag`) and `BonusRow`.
- **Players and table:** `Avatar`, `PlayerChip`, `Podium`, `RoomCode` (pill | display), `LobbySeats` > `Seat` (no `name` = empty seat).
- **Friends:** `FriendRow` with a trailing `FriendActions` > `FriendAction` (accept | decline | invite), or `HeadToHead`.
- **Feedback:** `FormError`, `ErrorBanner`, `RecordNote`, `LiveDot`, `TurnCountdown`, `Modal` (a native `<dialog>`, opens on mount).
- **Brand:** `Brand` (mark + "yazy") and `BrandMark`.

Read `components/<group>/<Name>/<Name>.prompt.md` for each one's props and examples. The full stylesheet is `_ds_bundle.css`.

## Example

```jsx
const { Button, FormError, SegmentedTabs } = window.YazyBattle;

<div className="join-card">
  <SegmentedTabs variant="card" value="create" onChange={() => {}}
    items={[{ id: "create", label: "開一桌" }, { id: "join", label: "加入朋友的桌" }]} />
  <label className="profile-field">
    <span>你想用什麼名字</span>
    <input maxLength={18} />
  </label>
  <FormError>先取一個玩家名稱吧。</FormError>
  <Button>開一桌</Button>
</div>
```

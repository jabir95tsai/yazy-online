"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  categories,
  categoryIds,
  scoreDice,
  scoreSummary,
  type CategoryId,
} from "@/lib/game";

type Session = {
  code: string;
  playerId: string;
  token: string;
  name: string;
};

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
    rollsUsed: number;
    createdAt: string;
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
    scores: Array<{ category: string; score: number }>;
  }>;
};

const SESSION_KEY = "yazy-club-sessions";
const diceFaces = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

function readSessions(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "[]") as Session[];
  } catch {
    return [];
  }
}

function saveSession(session: Session) {
  const sessions = readSessions().filter((item) => item.code !== session.code);
  localStorage.setItem(SESSION_KEY, JSON.stringify([...sessions, session].slice(-20)));
}

function playerTotal(state: RoomState, playerId: string) {
  return scoreSummary(state.scores.filter((score) => score.playerId === playerId));
}

export default function Home() {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [mode, setMode] = useState<"create" | "join">("create");
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [held, setHeld] = useState([false, false, false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryGame[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const fetchRoom = useCallback(async (code: string, quiet = false) => {
    try {
      const response = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
      if (!response.ok) {
        if (!quiet) {
          const data = (await response.json()) as { error?: string };
          setError(data.error ?? "無法讀取房間。");
        }
        return;
      }
      const next = (await response.json()) as RoomState;
      setState((previous) => {
        if (
          !previous ||
          previous.room.rollsUsed !== next.room.rollsUsed ||
          previous.room.currentSeat !== next.room.currentSeat
        ) {
          setHeld([false, false, false, false, false]);
        }
        return next;
      });
    } catch {
      if (!quiet) setError("連線中斷，正在嘗試重新連線。");
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("room") ?? "").toUpperCase().slice(0, 6);
    const sessions = readSessions();
    if (code) {
      setJoinCode(code);
      setMode("join");
      const existing = sessions.find((item) => item.code === code);
      if (existing) {
        setSession(existing);
        setName(existing.name);
        void fetchRoom(code);
      }
    }

    void fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessions: sessions.map(({ playerId, token }) => ({ playerId, token })),
      }),
    })
      .then((response) => response.json())
      .then((data: { games?: HistoryGame[] }) => setHistory(data.games ?? []))
      .finally(() => setHistoryLoaded(true));
  }, [fetchRoom]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => void fetchRoom(session.code, true), 1500);
    return () => window.clearInterval(timer);
  }, [fetchRoom, session]);

  const currentPlayer = state?.players.find(
    (player) => player.seat === state.room.currentSeat,
  );
  const me = state?.players.find((player) => player.id === session?.playerId);
  const isMyTurn =
    state?.room.status === "playing" && currentPlayer?.id === session?.playerId;
  const myScores = useMemo(
    () => state?.scores.filter((score) => score.playerId === session?.playerId) ?? [],
    [session?.playerId, state?.scores],
  );
  const rankings = useMemo(
    () =>
      state
        ? [...state.players].sort(
            (a, b) =>
              playerTotal(state, b.id).total - playerTotal(state, a.id).total,
          )
        : [],
    [state],
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
      window.history.replaceState({}, "", `?room=${data.code}`);
      await fetchRoom(data.code);
    } catch {
      setError("連線失敗，請再試一次。");
    } finally {
      setBusy(false);
    }
  }

  async function action(
    actionName: "start" | "roll" | "score",
    category?: CategoryId,
  ) {
    if (!session || !state) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/${session.code}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          playerId: session.playerId,
          token: session.token,
          held,
          category,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "操作失敗，請再試一次。");
        return;
      }
      if (actionName === "roll" || actionName === "score") {
        if (actionName === "score") setHeld([false, false, false, false, false]);
      }
      await fetchRoom(session.code);
    } catch {
      setError("連線失敗，請再試一次。");
    } finally {
      setBusy(false);
    }
  }

  function leaveRoom() {
    setSession(null);
    setState(null);
    setHeld([false, false, false, false, false]);
    setError("");
    window.history.replaceState({}, "", window.location.pathname);
  }

  async function copyInvite() {
    if (!state) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${state.room.code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (session && state) {
    return (
      <main className="game-shell">
        <header className="topbar">
          <button className="brand" onClick={leaveRoom} aria-label="回到首頁">
            <span className="brand-mark">Y</span>
            <span>YAZY CLUB</span>
          </button>
          <div className="room-pill">
            <span>房間</span>
            <strong>{state.room.code}</strong>
            <button onClick={copyInvite}>{copied ? "已複製！" : "邀請朋友"}</button>
          </div>
        </header>

        <section className="players-strip" aria-label="玩家">
          {state.players.map((player) => {
            const summary = playerTotal(state, player.id);
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

              <div className="dice-tray" aria-label="骰子區">
                {Array.from({ length: 5 }).map((_, index) => {
                  const die = state.room.dice[index];
                  return (
                    <button
                      aria-label={
                        die
                          ? `骰子 ${die}，${held[index] ? "已保留" : "未保留"}`
                          : "尚未擲骰"
                      }
                      className={`die ${held[index] ? "held" : ""} ${!die ? "blank" : ""}`}
                      disabled={!isMyTurn || state.room.rollsUsed === 0 || busy}
                      key={index}
                      onClick={() =>
                        setHeld((current) =>
                          current.map((value, dieIndex) =>
                            dieIndex === index ? !value : value,
                          ),
                        )
                      }
                    >
                      <span>{die ? diceFaces[die] : "·"}</span>
                      {held[index] && <small>HOLD</small>}
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
                  {state.room.rollsUsed === 0 ? "擲骰" : "再擲一次"}
                </button>
                <p>
                  {isMyTurn
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
                  <h2>選擇計分格</h2>
                </div>
                <strong>{scoreSummary(myScores).total}</strong>
              </div>
              <div className="score-list">
                {categories.map((category) => {
                  const saved = myScores.find(
                    (score) => score.category === category.id,
                  );
                  const preview =
                    state.room.rollsUsed > 0
                      ? scoreDice(category.id, state.room.dice)
                      : null;
                  return (
                    <button
                      className={`score-row ${saved ? "scored" : ""}`}
                      disabled={!isMyTurn || busy || state.room.rollsUsed < 1 || Boolean(saved)}
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
                  {scoreSummary(myScores).upper} / 63
                  {scoreSummary(myScores).bonus ? " ＋35" : ""}
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
                  <b>{playerTotal(state, player.id).total} 分</b>
                  {playerTotal(state, player.id).bonus > 0 && <small>含上半部加成</small>}
                </article>
              ))}
            </div>
            <button className="primary-action" onClick={leaveRoom}>
              再開一桌
            </button>
          </section>
        )}
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
        <div className="online-badge">
          <span className="live-dot" />
          免下載・立即開玩
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
            <span>✦ 免註冊</span>
            <span>✦ 即時同步</span>
            <span>✦ 戰績保存</span>
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
            <label>
              <span>你的名稱</span>
              <input
                autoComplete="nickname"
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
            <p className="privacy-note">不需帳號，只要把房間代碼傳給朋友。</p>
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
    </main>
  );
}

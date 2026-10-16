"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** True when the app runs from the home screen / dock, where there's no browser reload. */
export function useStandalone() {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const sync = () => setStandalone(mode.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    sync();
    mode.addEventListener("change", sync);
    return () => mode.removeEventListener("change", sync);
  }, []);
  return standalone;
}

export function RefreshButton() {
  if (!useStandalone()) return null;
  return (
    <button type="button" className="settings-trigger" aria-label="重新整理" title="重新整理" onClick={() => window.location.reload()}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
      </svg>
    </button>
  );
}

export function InstallButton() {
  const prompt = useRef<InstallPrompt | null>(null);
  const standalone = useStandalone();
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      prompt.current = event as InstallPrompt;
    };
    const done = () => { prompt.current = null; setInstalled(true); setHelp(false); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  async function install() {
    const pending = prompt.current;
    if (!pending) { setHelp(true); return; }
    prompt.current = null;
    setBusy(true);
    try {
      await pending.prompt();
      await pending.userChoice;
    } catch {
      setHelp(true);
    } finally {
      setBusy(false);
    }
  }

  if (installed || standalone) return null;
  return <>
    <button type="button" className="settings-trigger" aria-label="新增到桌面" title="新增到桌面" disabled={busy} onClick={install}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" />
      </svg>
    </button>
    {help && <Modal label="新增到桌面" onClose={() => setHelp(false)}>
      <h2>新增到桌面</h2>
      <p>把 yazy 放到桌面，下次點圖示就能開一桌。</p>
      <p>iPhone／iPad：用 Safari 開啟網站，點「分享」，再選「加入主畫面」。</p>
      <p>Android：開啟瀏覽器選單，選「安裝應用程式」或「新增至主畫面」。</p>
      <p>電腦：在 Chrome／Edge 的網址列或選單找「安裝」；Mac Safari 可從「檔案」選「加入 Dock」。若找不到，請改用支援安裝的瀏覽器。</p>
      <Button onClick={() => setHelp(false)}>知道了</Button>
    </Modal>}
  </>;
}

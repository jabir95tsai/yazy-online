"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Native modal supplies focus trapping, Escape and focus restoration. */
export function Modal({ label, onClose, children }: {
  label: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-label={label} className="account-dialog"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="account-panel">{children}</section>
  </dialog>;
}

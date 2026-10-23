"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

/** A floating glass panel anchored under a trigger. Closes on outside click and Escape. */
export function Popover({ open, onClose, children, align = "right", width = 320, label }: {
  open: boolean; onClose: () => void; children: ReactNode; align?: "left" | "right" | "center"; width?: number; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  const pos = align === "right" ? "right-0" : align === "left" ? "left-0" : "left-1/2 -translate-x-1/2";
  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={ref} role="dialog" aria-label={label}
          initial={{ y: -4, opacity: 0.6, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -4, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={`glass glass-strong absolute top-full z-50 mt-2 origin-top rounded-xl p-1.5 ${pos}`} style={{ width }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

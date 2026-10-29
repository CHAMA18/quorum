"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleAlert, Eraser, PenLine, ShieldCheck, Stamp, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The wet-ink layer.
 *
 * A re-authenticated session is the *seal*; this dialog is the *hand*. Before
 * Quorum executes an irreversible award, the authorised officer appends their
 * own freeform signature — mouse, finger or stylus — onto an instrument that
 * states exactly what is about to happen and to whom. The ink is trimmed,
 * downscaled and carried with the decision, so the receipt a citizen auditor
 * reads later shows the officer's actual signature, not just their name.
 *
 * The dialog is mounted once at the dashboard root and follows the same
 * promise-host pattern as the step-up gate: callers `await
 * requestAwardSignature(proposal)` and receive the ink (or null when the
 * officer backs out). A cancelled signature never reaches the sidecar.
 */

export type AwardHandSignature = {
  /* Trimmed PNG data URL — white ground, black ink, ≤640px wide. */
  image: string;
  signedAt: string;
  strokes: number;
  width: number;
  height: number;
};

export type AwardProposal = {
  gateId: string;
  tender: string;
  title: string;
  tool: string;
  toolLabel: string;
  supplier: string;
  factLabel: string;
  factText: string;
  valueMissing: boolean;
  flags: number;
  officeLabel?: string;
  signerName: string;
  signerRoleLabel: string;
};

type Pending = { proposal: AwardProposal; resolve: (ink: AwardHandSignature | null) => void };
type Listener = (pending: Pending) => void;

const listeners: Listener[] = [];

export function requestAwardSignature(proposal: AwardProposal): Promise<AwardHandSignature | null> {
  return new Promise((resolve) => {
    const host = listeners[listeners.length - 1];
    if (!host) {
      resolve(null);
      return;
    }
    host({ proposal, resolve });
  });
}

/* ── The freeform ink engine ───────────────────────────────────────────────

   Points carry time and pressure. Width follows the hand: pressure widens
   the line, velocity thins it — the way a nib sheds ink on the fast stroke
   and pools on the slow one. Segments are quadratic curves through point
   midpoints, so even a coarse mouse path reads as a confident hand. */

type Pt = { x: number; y: number; p: number; t: number; w?: number };

const INK = "#12141a";
const BASE_W = 2.35;

const mid = (a: Pt, b: Pt): Pt => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  p: (a.p + b.p) / 2,
  t: (a.t + b.t) / 2,
  w: a.w !== undefined && b.w !== undefined ? (a.w + b.w) / 2 : undefined,
});

function widthAt(p: Pt, prev: Pt): number {
  const dt = Math.max(1, p.t - prev.t);
  const v = Math.hypot(p.x - prev.x, p.y - prev.y) / dt;
  const press = 0.62 + 0.38 * Math.max(0, Math.min(1, p.p));
  const w = BASE_W * press * (1.18 - Math.min(v, 1.6) * 0.28);
  return Math.max(1.15, Math.min(4.4, w));
}

/* The nib's flow. Each point eases toward the width the hand is asking for,
   so the line swells and thins continuously — ink pooling on the slow stroke
   and shedding on the fast one — instead of stepping between segment widths.
   The eased width is stored on the point, so every repaint (undo, resize,
   export) is pixel-identical to what the officer saw while signing. */
function flowWidth(prev: Pt, next: Pt): number {
  const target = widthAt(next, prev);
  const base = prev.w ?? target;
  return Math.max(1.1, Math.min(4.6, base + (target - base) * 0.34));
}

/* One quadratic segment from `from` to `to`, bending through `ctrl`. */
function drawSegment(ctx: CanvasRenderingContext2D, from: Pt, ctrl: Pt, to: Pt) {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
  ctx.lineWidth = to.w ?? widthAt(to, ctrl);
  ctx.stroke();
}

/* Draws a whole stroke; used for full repaints (undo, clear, resize, export). */
function drawStroke(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = INK;
  if (pts.length === 1) {
    const p = pts[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.w ?? BASE_W * (0.62 + 0.38 * Math.max(0, Math.min(1, p.p))) * 0.62, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const from = i >= 2 ? mid(pts[i - 2], a) : a;
    drawSegment(ctx, from, a, mid(a, b));
  }
}

const fmtWhen = (iso: string) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
};

/* ── The dialog ──────────────────────────────────────────────────────────── */

export function AwardSignatureHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  /* Ink state lives here so the footer can gate the sign button on it. */
  const [hasInk, setHasInk] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [inkError, setInkError] = useState("");
  const [enoughInk, setEnoughInk] = useState(false);
  /* The consent beat: after the officer signs, the trimmed ink is read back
     on a specimen card before anything is committed. Nothing leaves the
     browser until they confirm it is their signature. */
  const [preview, setPreview] = useState<AwardHandSignature | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const strokesRef = useRef<Pt[][]>([]);
  const drawingRef = useRef(false);
  const activePointerRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const resetInkState = useCallback(() => {
    strokesRef.current = [];
    setHasInk(false);
    setStrokeCount(0);
    setEnoughInk(false);
    setInkError("");
  }, []);

  const settle = useCallback(
    (ink: AwardHandSignature | null) => {
      const current = pendingRef.current;
      pendingRef.current = null;
      setPending(null);
      setPreview(null);
      resetInkState();
      current?.resolve(ink);
    },
    [resetInkState]
  );

  /* Repaint every stroke — after undo, clear or a canvas resize. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const s of strokesRef.current) drawStroke(ctx, s);
  }, []);

  /* The pad measures itself; DPR is reapplied on every repaint. */
  useEffect(() => {
    if (!pending) return;
    const measure = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height };
      repaint();
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [pending, repaint]);

  useEffect(() => {
    const onRequest: Listener = (next) => {
      const previous = pendingRef.current;
      if (previous) previous.resolve(null);
      pendingRef.current = next;
      setPending(next);
      setPreview(null);
      resetInkState();
    };
    listeners.push(onRequest);
    return () => {
      const at = listeners.indexOf(onRequest);
      if (at !== -1) listeners.splice(at, 1);
    };
  }, [resetInkState]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* First escape steps back to the pad; a second one ends the ceremony. */
      if (preview) setPreview(null);
      else settle(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, preview, settle]);

  /* Focus follows the ceremony: the instrument takes focus when it opens (and
     hands it back when it closes), and the confirm button takes it at the
     review beat — a keyboard officer never lands outside the dialog. */
  useEffect(() => {
    if (!pending) {
      const prev = restoreFocusRef.current;
      restoreFocusRef.current = null;
      prev?.focus?.();
      return;
    }
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const raf = requestAnimationFrame(() => cardRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [pending]);

  useEffect(() => {
    if (!preview) return;
    const raf = requestAnimationFrame(() => confirmRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [preview]);

  /* ── Pointer handlers — mouse, finger and stylus through one path ────── */

  const ptFrom = (
    e: { clientX: number; clientY: number; pressure: number; pointerType: string },
    rect: DOMRect
  ): Pt => ({
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    p: e.pointerType === "mouse" ? 0.62 : e.pressure > 0 ? Math.min(1, e.pressure) : 0.62,
    t: performance.now(),
  });

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    /* One hand at a time. While a stroke is live every other pointer — a
       second finger, a resting palm, a stray stylus — is refused, so the ink
       records exactly the hand that is signing. */
    if (activePointerRef.current !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerRef.current = e.pointerId;
    drawingRef.current = true;
    setInkError("");
    const first = ptFrom(e, e.currentTarget.getBoundingClientRect());
    first.w = Math.max(1.4, BASE_W * (0.62 + 0.38 * Math.max(0, Math.min(1, first.p))) * 0.72);
    strokesRef.current.push([first]);
    setHasInk(true);
    setStrokeCount(strokesRef.current.length);
    repaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || activePointerRef.current !== e.pointerId) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const s = strokesRef.current[strokesRef.current.length - 1];
    if (!ctx || !s) return;
    /* High-frequency pointers report several positions between frames; the
       coalesced events are folded in so the curve never cuts a corner. */
    const native = e.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const events = coalesced.length ? coalesced : [native];
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    for (const ev of events) {
      const pt = ptFrom(ev, rect);
      const last = s[s.length - 1];
      /* Sub-pixel jitter suppresses itself: skip micro-moves. */
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 0.75) continue;
      pt.w = flowWidth(last, pt);
      s.push(pt);
      const n = s.length;
      if (n === 2) {
        drawSegment(ctx, s[0], s[0], mid(s[0], s[1]));
      } else {
        drawSegment(ctx, mid(s[n - 3], s[n - 2]), s[n - 2], mid(s[n - 2], s[n - 1]));
      }
    }
    setEnoughInk(pathLength(s) > 36);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || activePointerRef.current !== e.pointerId) return;
    drawingRef.current = false;
    activePointerRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* the capture may already be gone — nothing to do */
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const s = strokesRef.current[strokesRef.current.length - 1];
    if (ctx && s && s.length >= 2) {
      const n = s.length;
      /* Close the stroke to its true end. */
      drawSegment(ctx, mid(s[n - 3] ?? s[n - 2], s[n - 2]), s[n - 2], s[n - 1]);
    }
    setEnoughInk(pathLength(s ?? []) > 36);
  };

  const undo = () => {
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    setHasInk(strokesRef.current.length > 0);
    setEnoughInk(strokesRef.current.some((s) => pathLength(s) > 36));
    setInkError("");
    repaint();
  };

  const clear = () => {
    resetInkState();
    repaint();
  };

  /* Trim to the ink's bounding box, rescale and hand the PNG back. */
  const exportInk = (): AwardHandSignature | null => {
    const strokes = strokesRef.current;
    if (!strokes.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of strokes) {
      for (const p of s) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const pad = 14;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX += pad;
    maxY += pad;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const scale = Math.min(2, 640 / w);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.scale(scale, scale);
    ctx.translate(-minX, -minY);
    for (const s of strokes) drawStroke(ctx, s);
    return {
      image: out.toDataURL("image/png"),
      signedAt: new Date().toISOString(),
      strokes: strokes.length,
      width: out.width,
      height: out.height,
    };
  };

  const sign = () => {
    const total = strokesRef.current.reduce((acc, s) => acc + pathLength(s), 0);
    if (!hasInk || total < 36) {
      setInkError("That mark is too small for a signature — draw a fuller one, then continue.");
      return;
    }
    const ink = exportInk();
    if (!ink) {
      setInkError("The signature could not be captured. Draw it again and try once more.");
      return;
    }
    /* The consent beat — the officer reads their own signature back before
       anything is committed. Confirming is what moves the file forward. */
    setPreview(ink);
  };

  const confirmInk = () => {
    if (preview) settle(preview);
  };

  const p = pending?.proposal;
  /* Frozen when the dialog opens — the printed date never ticks mid-ceremony. */
  const openedAt = useMemo(() => new Date(), [pending]);
  const signerInitials = (p?.signerName ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <AnimatePresence>
      {pending && p ? (
        <motion.div
          className="paper-sheet fixed inset-0 z-[118] grid place-items-center bg-ink-950/45 px-4 py-6 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="award-ink-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settle(null);
          }}
        >
          <motion.div
            ref={cardRef}
            tabIndex={-1}
            aria-label="Award signature instrument"
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="max-h-full w-full max-w-[560px] overflow-y-auto rounded-2xl border border-ink-200 bg-[#fffdfb] shadow-[0_24px_80px_-24px_rgba(11,12,15,0.45)] outline-none"
          >
            {/* Seal band — the award acts in brand red, the way the gavel does */}
            <div className="h-[3px] w-full bg-gradient-to-r from-brand-700 via-brand-500 to-brand-700" aria-hidden="true" />

            <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand-700">
                  <Stamp className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 id="award-ink-title" className="text-[15px] font-semibold tracking-[-0.01em] text-ink-950">
                    Sign the award
                  </h2>
                  <p className="mt-1 max-w-[38ch] text-[11.5px] leading-relaxed text-ink-500">
                    Append your signature to execute{" "}
                    <span className="font-code text-[10.5px] font-semibold text-ink-800">{p.tender}</span> — {p.toolLabel}.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => settle(null)}
                aria-label="Cancel signature"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-950/[0.05] hover:text-ink-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* The instrument — what exactly is being signed */}
            <div className="border-b border-ink-100 bg-paper px-5 py-3.5">
              <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">THE ACT BEING SIGNED</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-800">
                Award <span className="font-semibold">{p.title}</span>
                {p.supplier && p.supplier !== "—" ? (
                  <>
                    {" "}
                    to <span className="font-semibold">{p.supplier}</span>
                  </>
                ) : null}
                {p.officeLabel ? <span className="text-ink-500"> · office of {p.officeLabel.toLowerCase()}</span> : null}.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-code text-[8px] font-bold tracking-[0.12em] text-ink-500">
                <span>
                  {p.factLabel.toUpperCase()}: <span className="text-ink-800">{p.factText.toUpperCase()}</span>
                </span>
                {p.flags > 0 && <span className="text-brand-700">{p.flags} FLAG{p.flags === 1 ? "" : "S"} CITED IN THE FILE</span>}
                <span className="text-brand-700">IRREVERSIBLE ONCE SIGNED</span>
              </div>
            </div>

            {/* Declaration */}
            <div className="border-b border-ink-100 px-5 py-3.5">
              <p className="text-[12px] leading-relaxed text-ink-700">
                <span className="italic">“I, {p.signerName || "the undersigned officer"}
                {p.signerRoleLabel ? `, acting in my capacity as ${p.signerRoleLabel.toLowerCase()}` : ""}, have reviewed
                this file against the committee’s standing rules and hereby append my signature to award it.”</span>
              </p>
            </div>

            {/* The pad — or, once drawn, the read-back */}
            <div className="px-5 pt-4">
              {preview ? (
                <>
                  <div className="flex items-center justify-between">
                    <label className="font-code text-[8px] font-bold tracking-[0.2em] text-ink-500">REVIEW YOUR SIGNATURE</label>
                    <span className="font-code text-[7.5px] tracking-[0.14em] text-ink-400">AS IT WILL APPEAR ON THE RECEIPT</span>
                  </div>
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                    className="relative mt-2 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[inset_0_1px_4px_rgba(11,12,15,0.05)]"
                  >
                    <div className="grid min-h-[150px] place-items-center px-6 py-5">
                      <img
                        src={preview.image}
                        alt={`Appended freeform signature of ${p.signerName || "the authorised officer"}`}
                        className="max-h-[120px] w-auto max-w-full object-contain"
                      />
                    </div>
                    <span className="absolute right-3 top-2.5 inline-flex items-center gap-1 font-code text-[7px] font-bold tracking-[0.14em] text-ink-400">
                      <PenLine className="h-2.5 w-2.5" aria-hidden="true" />
                      HAND-AUTHORED · {preview.strokes} {preview.strokes === 1 ? "STROKE" : "STROKES"}
                    </span>
                    <div className="flex items-end justify-between gap-4 border-t border-dashed border-ink-200 px-4 pb-2.5 pt-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11.5px] font-semibold text-ink-800">{p.signerName || "Authorised officer"}</p>
                        {p.signerRoleLabel ? (
                          <p className="font-code text-[6.5px] font-bold tracking-[0.16em] text-ink-500">{p.signerRoleLabel.toUpperCase()}</p>
                        ) : null}
                      </div>
                      <p className="shrink-0 font-code text-[6.5px] tracking-[0.12em] text-ink-500">SIGNED {fmtWhen(preview.signedAt).toUpperCase()}</p>
                    </div>
                  </motion.div>
                  {inkError ? (
                    <p role="alert" className="mt-2.5 flex items-center gap-1.5 text-[11.5px] leading-relaxed text-red-700">
                      <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {inkError}
                    </p>
                  ) : (
                    <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-400">
                      Not the signature you mean to append? Redraw it. Once you confirm, Quorum asks you to re-authenticate — the ink and the seal travel
                      together.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <label className="font-code text-[8px] font-bold tracking-[0.2em] text-ink-500">YOUR SIGNATURE — FREEFORM</label>
                    <span className="font-code text-[7.5px] tracking-[0.14em] text-ink-400">MOUSE · FINGER · STYLUS</span>
                  </div>
                  <div
                    ref={wrapRef}
                    className="relative mt-2 h-[188px] touch-none select-none overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[inset_0_1px_4px_rgba(11,12,15,0.05)]"
                  >
                    {/* Baseline guide — a signature sheet, not a drawing app */}
                    <div className="pointer-events-none absolute inset-x-6 bottom-[44px] border-b border-dashed border-ink-200" aria-hidden="true" />
                    <span
                      className="pointer-events-none absolute bottom-[50px] left-5 select-none font-code text-[13px] text-brand-300"
                      aria-hidden="true"
                    >
                      ✕
                    </span>
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-500",
                        hasInk ? "opacity-0" : "opacity-100"
                      )}
                      aria-hidden="true"
                    >
                      <div className="flex flex-col items-center gap-1.5 pb-6 text-center">
                        <PenLine className="h-4 w-4 text-ink-300" />
                        <p className="text-[11.5px] font-medium text-ink-400">Sign here — draw your signature above the line</p>
                      </div>
                    </div>
                    {/* The printed block the ink lands on — officer, office, date */}
                    <motion.div
                      initial={false}
                      animate={{ opacity: hasInk ? 1 : 0.5 }}
                      transition={{ duration: 0.4 }}
                      className="pointer-events-none absolute inset-x-5 bottom-2 flex items-end justify-between gap-3"
                      aria-hidden="true"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[10.5px] font-semibold text-ink-500">{p.signerName || "Authorised officer"}</p>
                        {p.signerRoleLabel ? (
                          <p className="font-code text-[6px] font-bold tracking-[0.16em] text-ink-400">{p.signerRoleLabel.toUpperCase()}</p>
                        ) : null}
                      </div>
                      <p className="shrink-0 font-code text-[6px] tracking-[0.12em] text-ink-400">{fmtWhen(openedAt.toISOString()).toUpperCase()}</p>
                    </motion.div>
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 h-full w-full cursor-crosshair"
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      style={{ touchAction: "none" }}
                      aria-label="Freeform signature pad — draw your signature with the mouse, finger or stylus"
                      role="img"
                    />
                    {hasInk && (
                      <span className="pointer-events-none absolute right-3 top-2.5 inline-flex items-center gap-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-400">
                        <PenLine className="h-2.5 w-2.5" aria-hidden="true" />
                        HAND-AUTHORED · {strokeCount} {strokeCount === 1 ? "STROKE" : "STROKES"}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <p className="font-code text-[7.5px] tracking-[0.14em] text-ink-400">
                      {!hasInk
                        ? "THE INK IS TRIMMED, SCALED AND SEALED WITH THE DECISION"
                        : enoughInk
                          ? "READY — REVIEW, THEN CONFIRM"
                          : "ADD MORE INK — THE MARK IS TOO SMALL TO SIGN"}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={undo}
                        disabled={!hasInk}
                        className="inline-flex h-7 items-center gap-1 rounded-full border border-ink-200/80 bg-white px-2.5 font-code text-[8px] font-bold tracking-[0.12em] text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Undo2 className="h-3 w-3" aria-hidden="true" />
                        UNDO
                      </button>
                      <button
                        type="button"
                        onClick={clear}
                        disabled={!hasInk}
                        className="inline-flex h-7 items-center gap-1 rounded-full border border-ink-200/80 bg-white px-2.5 font-code text-[8px] font-bold tracking-[0.12em] text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Eraser className="h-3 w-3" aria-hidden="true" />
                        CLEAR
                      </button>
                    </div>
                  </div>

                  {inkError ? (
                    <p role="alert" className="mt-2.5 flex items-center gap-1.5 text-[11.5px] leading-relaxed text-red-700">
                      <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {inkError}
                    </p>
                  ) : (
                    <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-400">
                      Your signature is read back for your confirmation before anything is committed — then Quorum asks you to re-authenticate.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Signer + actions */}
            <div className="mt-4 border-t border-ink-100 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-950 font-code text-[9px] font-bold text-white">
                  {signerInitials || "Q"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold text-ink-950">{p.signerName || "Authorised officer"}</p>
                  <p className="font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-500">
                    {p.signerRoleLabel ? `${p.signerRoleLabel.toUpperCase()} · ` : ""}SESSION ATTESTED · {fmtWhen(openedAt.toISOString()).toUpperCase()}
                  </p>
                </div>
              </div>
              <div className="mt-3.5 flex items-center gap-2">
                {preview ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPreview(null)}
                      className="h-10 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[11px] font-semibold text-ink-700 transition-colors hover:bg-ink-50"
                    >
                      Redraw
                    </button>
                    <button
                      type="button"
                      ref={confirmRef}
                      onClick={confirmInk}
                      className="inline-flex h-10 flex-[1.5] items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-brand-700"
                    >
                      <Stamp className="h-3.5 w-3.5" aria-hidden="true" />
                      Confirm &amp; seal
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => settle(null)}
                      className="h-10 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[11px] font-semibold text-ink-700 transition-colors hover:bg-ink-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={sign}
                      disabled={!hasInk}
                      title={hasInk ? undefined : "Draw your signature in the box first"}
                      className={cn(
                        "inline-flex h-10 flex-[1.5] items-center justify-center gap-2 rounded-lg px-3 text-[11px] font-semibold text-white transition-colors",
                        hasInk ? "bg-brand-600 hover:bg-brand-700" : "cursor-not-allowed bg-ink-300"
                      )}
                    >
                      <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                      Sign &amp; review
                    </button>
                  </>
                )}
              </div>
              <p className="mt-3 flex items-center gap-1.5 font-code text-[7.5px] tracking-[0.12em] text-ink-400">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {preview
                  ? "CONFIRMING SEALS THE INK TO THE AWARD · STEP-UP CHECK FOLLOWS"
                  : "WET-INK LAYER · READ-BACK BEFORE COMMIT · HASH-BOUND TO THE RECEIPT"}
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function pathLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/* ── The receipt — the signature, read back ────────────────────────────────

   Every signed decision in the ledger can be opened to show the officer's
   actual hand alongside the seal it travelled with. This is the artefact an
   auditor verifies: who signed, when, with how many strokes, under which
   Ed25519 receipt. */

export type SignatureReceipt = {
  tender: string;
  action: "AWARDED" | "RETURNED";
  by: string;
  at: string;
  toolLabel?: string;
  image?: string;
  strokes?: number;
  signedAt?: string;
  submissionId?: string;
  hash?: string;
};

export function SignatureReceiptDialog({ row, onClose }: { row: SignatureReceipt | null; onClose: () => void }) {
  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  return (
    <AnimatePresence>
      {row ? (
        <motion.div
          className="paper-sheet fixed inset-0 z-[118] grid place-items-center bg-ink-950/45 px-4 py-6 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ink-receipt-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="max-h-full w-full max-w-[460px] overflow-y-auto rounded-2xl border border-ink-200 bg-[#fffdfb] shadow-[0_24px_80px_-24px_rgba(11,12,15,0.45)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className={cn("mt-0.5 grid h-9 w-9 place-items-center rounded-full", row.action === "AWARDED" ? "bg-brand-50 text-brand-700" : "bg-ink-100 text-ink-700")}>
                  <Stamp className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 id="ink-receipt-title" className="text-[15px] font-semibold tracking-[-0.01em] text-ink-950">
                    {row.action === "AWARDED" ? "Award receipt" : "Return receipt"}
                  </h2>
                  <p className="mt-1 font-code text-[10px] font-bold tracking-[0.12em] text-ink-500">
                    {row.tender}
                    {row.toolLabel ? ` · ${row.toolLabel.toUpperCase()}` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close receipt"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-950/[0.05] hover:text-ink-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 py-4">
              {row.image ? (
                <div>
                  <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">APPENDED SIGNATURE</p>
                  <div className="mt-2 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[inset_0_1px_4px_rgba(11,12,15,0.05)]">
                    <img src={row.image} alt={`Freeform signature of ${row.by}`} className="max-h-[150px] w-full object-contain" />
                  </div>
                  <p className="mt-1.5 font-code text-[7.5px] tracking-[0.14em] text-ink-400">
                    HAND-AUTHORED · {row.strokes ?? "—"} {row.strokes === 1 ? "STROKE" : "STROKES"}
                    {row.signedAt ? ` · SIGNED ${fmtWhen(row.signedAt).toUpperCase()}` : ""}
                  </p>
                </div>
              ) : (
                <p className="rounded-md border border-ink-200 bg-paper px-3 py-2.5 font-code text-[8px] font-bold leading-relaxed tracking-[0.12em] text-ink-500">
                  NO FREEFORM INK ON THIS DECISION — SIGNED THROUGH THE STEP-UP SEAL ONLY
                </p>
              )}

              <dl className="mt-4 space-y-2.5 border-t border-ink-100 pt-4 text-[12px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-500">Signed by</dt>
                  <dd className="font-semibold text-ink-950">{row.by}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-500">Decision</dt>
                  <dd className={cn("font-semibold", row.action === "AWARDED" ? "text-ink-950" : "text-brand-700")}>
                    {row.action === "AWARDED" ? "Awarded" : "Returned for review"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-500">When</dt>
                  <dd className="font-semibold text-ink-950">{fmtWhen(row.at)}</dd>
                </div>
                {row.submissionId && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-500">Portal submission</dt>
                    <dd className="truncate font-code text-[10.5px] font-semibold text-ink-950">{row.submissionId}</dd>
                  </div>
                )}
                {row.hash && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="shrink-0 text-ink-500">Seal hash</dt>
                    <dd className="truncate font-code text-[10.5px] font-semibold text-ink-950">{row.hash}</dd>
                  </div>
                )}
              </dl>

              <p className="mt-4 flex items-center gap-1.5 font-code text-[7.5px] tracking-[0.12em] text-ink-400">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                STEP-UP SEALED · ED25519 RECEIPT · VERIFIABLE OFFLINE
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

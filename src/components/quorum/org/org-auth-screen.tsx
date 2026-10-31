"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { AuthFilm } from "@/components/quorum/auth-film";
import { MasterSwitcher } from "@/components/quorum/master-switcher";
import { RegisterShowcase } from "@/components/quorum/org/register-showcase";
import { SearchSelect, type SelectOption } from "@/components/quorum/org/search-select";
import { COUNTRIES, SUGGESTED_COUNTRIES, findCountry, type Country } from "@/lib/countries";
import { LEGAL_FORM_GROUPS, LEGAL_FORM_OTHER } from "@/lib/legal-forms";
import { cn } from "@/lib/utils";

/**
 * The supplier side's own door. This is deliberately NOT the officer
 * sign-in: a different route (/org), a different cookie, a different
 * account space, and a registration flow that builds an organization
 * PROFILE — the legal identity that will stand behind every application —
 * instead of just an email and a passphrase.
 *
 * Visual system: the SAME one as the application overall — signal red on
 * ink & warm paper, engineering-grade mono labels, ink buttons that ignite
 * to brand red on hover. The portal separates by door and account space,
 * not by a foreign palette.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EASE = [0.22, 1, 0.36, 1] as const;

type OrgProfile = {
  id: string;
  name: string;
  status: string;
};

type FormState = {
  name: string;
  registrationNo: string;
  country: string;
  legalForm: string;
  taxPin: string;
  taxClearanceNo: string;
  taxClearanceExpiry: string;
  regulator: string;
  regulatorNo: string;
  contactName: string;
  phone: string;
  address: string;
  website: string;
  description: string;
  categories: string[];
  email: string;
  password: string;
  confirm: string;
};

const EMPTY: FormState = {
  name: "",
  registrationNo: "",
  country: "",
  legalForm: "",
  taxPin: "",
  taxClearanceNo: "",
  taxClearanceExpiry: "",
  regulator: "",
  regulatorNo: "",
  contactName: "",
  phone: "",
  address: "",
  website: "",
  description: "",
  categories: [],
  email: "",
  password: "",
  confirm: "",
};

const STEPS = [
  { n: 1, label: "Identity", hint: "Who the organization legally is" },
  { n: 2, label: "Statutory", hint: "Tax & sector registrations" },
  { n: 3, label: "Profile", hint: "Contact & capabilities" },
  { n: 4, label: "Account", hint: "Credentials for this portal" },
] as const;

const CATEGORY_SUGGESTIONS = [
  "Medical supplies", "Laboratory equipment", "Solar energy", "Water & boreholes",
  "ICT & software", "Furniture", "Construction", "Transport & logistics",
  "Consulting", "Stationery", "Security", "Education materials",
];

/* ── The dropdown registers ──────────────────────────────────────────────── */

const toCountryOption = (c: Country, group: string): SelectOption => ({
  value: c.name,
  hint: `${c.code} · ${c.dial}`,
  group,
  keywords: `${c.code} ${c.dial} ${c.keywords ?? ""}`,
});

/* Every UN member state + the observer state, with the portal's home
   jurisdictions pinned first. The all-countries wing excludes the pinned
   set so no country appears twice. */
const COUNTRY_OPTIONS: SelectOption[] = [
  ...SUGGESTED_COUNTRIES.flatMap((n) => {
    const c = COUNTRIES.find((x) => x.name === n);
    return c ? [toCountryOption(c, "Commonly used here")] : [];
  }),
  ...COUNTRIES.filter((c) => !(SUGGESTED_COUNTRIES as readonly string[]).includes(c.name)).map((c) =>
    toCountryOption(c, "All countries"),
  ),
];

const LEGAL_FORM_OPTIONS: SelectOption[] = [
  ...LEGAL_FORM_GROUPS.flatMap((g) => g.options.map((v) => ({ value: v, group: g.group }))),
  { value: LEGAL_FORM_OTHER, group: "Other" },
];

/* The officer door's passphrase discipline, mirrored — the meter is
   advisory (the register enforces 8+ characters server-side). */
const PW_CHECKS: { label: string; test: (pw: string) => boolean }[] = [
  { label: "8+ CHARS", test: (pw) => pw.length >= 8 },
  { label: "NUMBER", test: (pw) => /\d/.test(pw) },
  { label: "UPPER + LOWER", test: (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
  { label: "SYMBOL", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

const PW_META = [
  { label: "AWAITING INPUT", seg: "bg-ink-300" },
  { label: "WEAK", seg: "bg-brand-600" },
  { label: "FAIR", seg: "bg-brand-400" },
  { label: "GOOD", seg: "bg-ink-500" },
  { label: "STRONG", seg: "bg-ink-950" },
];

const inputCls =
  "h-11 w-full rounded-lg border border-ink-200 bg-white px-3.5 text-[14px] text-ink-950 outline-none transition-all placeholder:text-ink-300 focus:border-ink-950 focus:ring-4 focus:ring-ink-950/10 dark:border-white/10 dark:bg-night-2 dark:text-white dark:placeholder:text-ink-500";

function Field({
  label,
  error,
  aside,
  children,
}: {
  label: string;
  error?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-3">
        <span className="font-code text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-500 dark:text-ink-400">
          {label}
        </span>
        {aside}
      </span>
      {children}
      {error ? <span role="alert" className="block text-[12px] font-medium text-brand-700 dark:text-brand-300">{error}</span> : null}
    </label>
  );
}

/* The passphrase discipline meter — four checks, mirrored from the officer
   door. Rendered under whatever field holds the passphrase. */
function PassphraseMeter({ password }: { password: string }) {
  const passed = PW_CHECKS.filter((c) => c.test(password)).length;
  const meta = password.length === 0 ? PW_META[0] : PW_META[Math.max(1, passed)];
  return (
    <div aria-live="polite">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              i < passed ? meta.seg : "bg-ink-100 dark:bg-white/10",
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500 dark:text-ink-400">{meta.label}</p>
        <p className="font-code text-[8.5px] tracking-[0.1em] text-ink-300 dark:text-ink-500">
          {PW_CHECKS.map((c) => c.label).join(" · ")}
        </p>
      </div>
    </div>
  );
}

/* ── The wizard ──────────────────────────────────────────────────────────── */

function RegisterWizard({
  onRegistered,
  onBusyChange,
}: {
  onRegistered: (name: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  /* The legal-form dropdown's own selection: a listed form, "Other
     (not listed)" — which reveals a specify field — or empty. */
  const [legalFormChoice, setLegalFormChoice] = useState("");

  const set = (k: keyof FormState, v: string | string[]) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: "" }));
  };

  const setLegalForm = (choice: string) => {
    setLegalFormChoice(choice);
    set("legalForm", choice === LEGAL_FORM_OTHER || choice === "" ? "" : choice);
  };

  /* Country-driven intuition: the registrar that issues the
     registration number, and the dial code the phone field expects. */
  const selectedCountry = form.country ? findCountry(form.country) : undefined;
  const registrarHint = selectedCountry?.registrar
    ? `Issued by ${selectedCountry.registrar}.`
    : "The exact identifier on the certificate of incorporation or registration.";
  const phonePlaceholder = selectedCountry ? `${selectedCountry.dial} …` : "+ country code …";

  const addCategory = (raw: string) => {
    const v = raw.trim().slice(0, 80);
    if (!v || form.categories.includes(v) || form.categories.length >= 12) return;
    set("categories", [...form.categories, v]);
  };

  const validateStep = (n: number): boolean => {
    const e: Record<string, string> = {};
    if (n === 1) {
      if (form.name.trim().length < 2) e.name = "Enter the organization's legal name (2–160 characters).";
      if (form.registrationNo.trim().length < 3) e.registrationNo = "The legal registration number is required (3–80 characters).";
      if (form.country.trim().length < 2) e.country = "Select the country of registration.";
    }
    if (n === 4) {
      if (!EMAIL_RE.test(form.email.trim())) e.email = "Enter a valid organization email.";
      if (form.password.length < 8) e.password = "Use at least 8 characters.";
      if (form.confirm !== form.password) e.confirm = "The two passwords do not match.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(4, s + 1));
  };
  const back = () => setStep((s) => Math.max(1, s - 1));

  const submit = async () => {
    if (busy) return;
    if (!validateStep(1) || !validateStep(4)) return;
    setBusy(true);
    onBusyChange(true);
    setBanner(null);
    try {
      const res = await fetch("/api/org/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = (await res.json().catch(() => ({}))) as { org?: OrgProfile; error?: string; errors?: Record<string, string> };
      if (!res.ok || !j.org) {
        if (j.errors) setErrors(j.errors);
        setBanner(j.error ?? "Registration failed — check the highlighted fields.");
        if (j.errors?.email || j.errors?.password) setStep(4);
        if (j.errors?.name || j.errors?.registrationNo || j.errors?.country) setStep(1);
        return;
      }
      onRegistered(j.org.name);
    } catch {
      setBanner("The portal is unreachable — try again shortly.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  /* Enter advances the wizard; on the last step it files. */
  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 4) next();
    else void submit();
  };

  const review = useMemo(
    () => [
      { k: "Legal name", v: form.name },
      { k: "Registration no", v: form.registrationNo },
      { k: "Country", v: form.country },
      { k: "Legal form", v: form.legalForm || "—" },
      { k: "Tax PIN", v: form.taxPin || "—" },
      { k: "Tax clearance", v: form.taxClearanceNo ? `${form.taxClearanceNo}${form.taxClearanceExpiry ? ` · valid to ${form.taxClearanceExpiry}` : ""}` : "—" },
      { k: "Sector regulator", v: form.regulator ? `${form.regulator}${form.regulatorNo ? ` ${form.regulatorNo}` : ""}` : "—" },
      { k: "Contact", v: form.contactName || "—" },
      { k: "Categories", v: form.categories.length ? form.categories.join(", ") : "—" },
      { k: "Account email", v: form.email },
    ],
    [form],
  );

  /* Passphrase meter — shared component; the same discipline as the reset flow. */

  return (
    <form onSubmit={onFormSubmit} noValidate className="space-y-5">
      {/* step rail */}
      <div>
        <div className="flex items-baseline justify-between">
          <p className="font-code text-[9px] font-semibold tracking-[0.2em] text-ink-400">ORGANIZATION REGISTRATION</p>
          <p className="font-code text-[9px] font-semibold tracking-[0.2em] text-ink-400">
            STEP <span className="text-ink-950 dark:text-white">{step}</span> OF 4
          </p>
        </div>
        <ol className="mt-2 flex items-center gap-1.5" aria-label="Registration steps">
          {STEPS.map((s) => (
            <li key={s.n} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => s.n < step && setStep(s.n)}
                className={cn(
                  "w-full min-w-0 rounded-lg px-1.5 py-1.5 text-left transition-colors",
                  s.n === step
                    ? "bg-ink-50 ring-1 ring-inset ring-ink-200 dark:bg-white/[0.07] dark:ring-white/10"
                    : s.n < step
                      ? "hover:bg-ink-50 dark:hover:bg-white/[0.05]"
                      : "cursor-default",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "grid h-4 w-4 place-items-center rounded-full font-code text-[8px] font-bold",
                      s.n < step
                        ? "bg-ink-950 text-white dark:bg-white dark:text-ink-950"
                        : s.n === step
                          ? "bg-brand-600 text-white"
                          : "bg-ink-100 text-ink-400 dark:bg-white/10 dark:text-ink-300",
                    )}
                  >
                    {s.n < step ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : s.n}
                  </span>
                  <span
                    className={cn(
                      /* Labels only once the card is wide enough to spell
                         them — below that the numbered rail plus the
                         "STEP n OF 4" line carry the state without
                         overflowing the phone. */
                      "hidden min-w-0 truncate font-code text-[9px] font-semibold uppercase tracking-[0.1em] min-[480px]:inline",
                      s.n === step ? "text-ink-950 dark:text-white" : s.n < step ? "text-ink-500 dark:text-ink-400" : "text-ink-400",
                    )}
                  >
                    {s.label}
                  </span>
                </span>
                <span className="mt-0.5 block h-0.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                  <span
                    className={cn("block h-full rounded-full transition-all duration-500", s.n <= step ? "bg-brand-600" : "bg-transparent")}
                    style={{ width: s.n <= step ? "100%" : "0%" }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-[12.5px] text-ink-500 dark:text-ink-400">{STEPS[step - 1].hint}</p>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="space-y-3.5"
        >
          {step === 1 ? (
            <>
              <Field label="Legal name" error={errors.name}>
                <input autoFocus className={inputCls} autoComplete="organization" placeholder="Rift Pumps Ltd" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Country of registration" error={errors.country}>
                <SearchSelect
                  value={form.country}
                  onChange={(v) => set("country", v)}
                  options={COUNTRY_OPTIONS}
                  placeholder="Select the country…"
                  searchPlaceholder={`Search ${COUNTRIES.length} countries — name, code or dial…`}
                  emptyText="No country matches — try the ISO code or dial digits."
                  label="Country of registration"
                />
              </Field>
              <Field label="Registration number" error={errors.registrationNo}>
                <input className={inputCls} autoComplete="off" placeholder="e.g. 1203456789" value={form.registrationNo} onChange={(e) => set("registrationNo", e.target.value)} />
                <span className="block pt-0.5 text-[11.5px] leading-relaxed text-ink-400 dark:text-ink-500">
                  {selectedCountry ? registrarHint : "The identifier on the certificate of incorporation — pick the country above to see who issues it."}
                </span>
              </Field>
              <Field label="Legal form (optional)">
                <SearchSelect
                  value={legalFormChoice}
                  onChange={setLegalForm}
                  options={LEGAL_FORM_OPTIONS}
                  placeholder="Select the legal form…"
                  searchPlaceholder="Search legal forms…"
                  emptyText="No legal form matches — choose Other (not listed)."
                  clearable
                  label="Legal form"
                />
                {legalFormChoice === LEGAL_FORM_OTHER ? (
                  <input
                    autoFocus
                    className={cn(inputCls, "mt-2")}
                    placeholder="Describe the legal form, e.g. Community interest company"
                    value={form.legalForm}
                    maxLength={80}
                    onChange={(e) => set("legalForm", e.target.value)}
                  />
                ) : null}
              </Field>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="space-y-3.5">
                <Field label="Tax PIN (optional)">
                  <input autoFocus className={inputCls} placeholder="ZRA PIN" value={form.taxPin} onChange={(e) => set("taxPin", e.target.value)} />
                </Field>
                <Field label="Tax clearance no (optional)">
                  <input className={inputCls} placeholder="Clearance certificate number" value={form.taxClearanceNo} onChange={(e) => set("taxClearanceNo", e.target.value)} />
                </Field>
              </div>
              <Field label="Tax clearance expiry (optional)">
                <input className={inputCls} type="date" value={form.taxClearanceExpiry} onChange={(e) => set("taxClearanceExpiry", e.target.value)} />
              </Field>
              <div className="space-y-3.5">
                <Field label="Sector regulator (optional)">
                  <input className={inputCls} placeholder="NCC · NHCC · ERB · ZPPA…" value={form.regulator} onChange={(e) => set("regulator", e.target.value)} />
                </Field>
                <Field label="Regulator registration no">
                  <input className={inputCls} placeholder="Category registration number" value={form.regulatorNo} onChange={(e) => set("regulatorNo", e.target.value)} />
                </Field>
              </div>
              <p className="rounded-xl border border-ink-100 bg-sand px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-600 dark:border-white/10 dark:bg-night-2 dark:text-ink-400">
                These are the statutory fields public procurement asks bidders to hold. They are optional here — but a
                complete profile is what the desk sees when your first application lands on the supplier register.
              </p>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="space-y-3.5">
                <Field label="Contact person">
                  <input autoFocus className={inputCls} autoComplete="name" placeholder="Full name" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
                </Field>
                <Field label="Phone">
                  <input className={inputCls} autoComplete="tel" placeholder={phonePlaceholder} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                </Field>
              </div>
              <Field label="Address">
                <input className={inputCls} autoComplete="street-address" placeholder="Street, city" value={form.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label="Website">
                <input className={inputCls} autoComplete="url" placeholder="https://" value={form.website} onChange={(e) => set("website", e.target.value)} />
              </Field>
              <Field label="What the organization supplies (optional)">
                <textarea
                  className={cn(inputCls, "h-20 resize-none py-2.5")}
                  placeholder="Two or three sentences the desk can rely on."
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>
              <Field label="Supply categories">
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      className={inputCls}
                      placeholder="Type a category and press Enter"
                      value={categoryDraft}
                      onChange={(e) => setCategoryDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCategory(categoryDraft);
                          setCategoryDraft("");
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        addCategory(categoryDraft);
                        setCategoryDraft("");
                      }}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-ink-200 text-ink-600 transition-colors hover:border-brand-600 hover:text-brand-700 dark:border-white/10"
                      aria-label="Add category"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {form.categories.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {form.categories.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 rounded-full bg-ink-950 px-2.5 py-1 text-[12px] font-medium text-white dark:bg-white dark:text-ink-950">
                          {c}
                          <button type="button" onClick={() => set("categories", form.categories.filter((x) => x !== c))} aria-label={`Remove ${c}`}>
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {CATEGORY_SUGGESTIONS.filter((s) => !form.categories.includes(s)).slice(0, 8).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => addCategory(s)}
                        className="rounded-full border border-dashed border-ink-300 px-2.5 py-1 text-[11.5px] text-ink-500 transition-colors hover:border-brand-600 hover:text-brand-700 dark:border-white/15 dark:text-ink-400"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                </div>
              </Field>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <Field label="Organization email (this is the login)" error={errors.email}>
                <input autoFocus className={inputCls} type="email" autoComplete="email" placeholder="bids@organization.example" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Password" error={errors.password}>
                <div className="relative">
                  <input
                    className={cn(inputCls, "pr-11")}
                    type={showPass ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                  />
                  <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" aria-label={showPass ? "Hide password" : "Show password"}>
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <PassphraseMeter password={form.password} />
              <Field label="Confirm password" error={errors.confirm}>
                <input className={inputCls} type="password" autoComplete="new-password" placeholder="Repeat the password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} />
              </Field>

              <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-white/10">
                <p className="border-b border-ink-100 bg-sand px-3.5 py-2 font-code text-[9px] font-semibold tracking-[0.16em] text-ink-500 dark:border-white/10 dark:bg-night-2 dark:text-ink-400">
                  REVIEW — WHAT THE DESK WILL SEE
                </p>
                <dl className="divide-y divide-ink-50 dark:divide-ink-900">
                  {review.map((r) => (
                    <div key={r.k} className="flex items-baseline justify-between gap-4 px-3.5 py-1.5">
                      <dt className="text-[12px] text-ink-500 dark:text-ink-400">{r.k}</dt>
                      <dd className="max-w-[60%] truncate text-right text-[12.5px] font-semibold text-ink-900 dark:text-ink-100">{r.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {banner ? (
        <div className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {banner}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={back}
          disabled={step === 1 || busy}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-[13.5px] font-semibold text-ink-600 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-300 dark:text-ink-300 dark:hover:bg-white/5 dark:disabled:text-ink-600"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        {step < 4 ? (
          <button
            type="submit"
            className="group inline-flex h-11 items-center gap-1.5 rounded-xl bg-ink-950 px-5 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600"
          >
            Continue
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-950 px-5 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            Create organization profile
          </button>
        )}
      </div>
    </form>
  );
}

/* ── Success — the stamp ─────────────────────────────────────────────────── */

function OnTheRegister({ orgName, onEnter }: { orgName: string; onEnter: () => void }) {
  const enteredRef = useRef(false);

  const enter = () => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    onEnter();
  };

  /* The session is already open — the console is one step away, automatically. */
  useEffect(() => {
    const t = setTimeout(enter, 2100);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="text-center" aria-live="polite">
      <motion.div
        initial={{ scale: 2.3, opacity: 0, rotate: -17 }}
        animate={{ scale: 1, opacity: 1, rotate: -6 }}
        transition={{ type: "spring", stiffness: 240, damping: 16, delay: 0.18 }}
        className="mx-auto inline-block rounded-lg border-[3px] border-brand-600 px-6 py-3 shadow-[0_20px_50px_rgba(217,38,22,0.28)]"
      >
        <p className="type-display text-[19px] tracking-[0.1em] text-brand-600 sm:text-[22px]">ON THE REGISTER</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.34, ease: EASE }}>
        <h2 className="type-display mt-7 text-[24px] text-ink-950 dark:text-white">
          {orgName} <span className="text-brand-600">is on the record.</span>
        </h2>
        <p className="mx-auto mt-2.5 max-w-sm text-[13.5px] leading-relaxed text-ink-600 dark:text-ink-300">
          The organization profile is live and this session is open. Next: the opportunities board — where every open
          tender carries its closing date, and your applications carry this profile&apos;s attested identity.
        </p>

        <div className="mx-auto mt-6 w-full max-w-sm" aria-hidden="true">
          <div className="flex items-center justify-between font-code text-[8.5px] tracking-[0.2em] text-ink-400">
            <span>OPENING THE CONSOLE</span>
            <span>SESSION · HTTPONLY</span>
          </div>
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
            <motion.div
              initial={{ width: "4%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 2.05, ease: "linear" }}
              className="h-full rounded-full bg-brand-600"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={enter}
          className="group mt-6 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-ink-950 px-7 text-[15px] font-semibold text-white transition-all hover:bg-brand-600"
        >
          Enter the console
          <ArrowRight className="h-4.5 w-4.5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ── Sign in ─────────────────────────────────────────────────────────────── */

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type ResetFlow = "signin" | "request" | "issued" | "done";

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongPass, setWrongPass] = useState(false); // 401 — offer the reset door
  const [capsOn, setCapsOn] = useState(false); // Caps Lock warning on the passphrase
  const [busy, setBusy] = useState(false);

  /* A suspended account cannot sign in, so the appeal is filed from this
     screen — public, rate-limited, matched by email AND registration. */
  const [suspended, setSuspended] = useState(false);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReg, setAppealReg] = useState("");
  const [appealReason, setAppealReason] = useState("");
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);
  const [appealRef, setAppealRef] = useState<string | null>(null);

  /* ── the reset flow's own state ── */
  const [flow, setFlow] = useState<ResetFlow>("signin");
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetFieldErrors, setResetFieldErrors] = useState<Record<string, string>>({});
  const [resetBusy, setResetBusy] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [, tickClock] = useState(0); // re-render each second while the code lives
  const [copied, setCopied] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [confirmPass, setConfirmPass] = useState("");

  const openReset = useCallback(() => {
    setResetEmail(email);
    setResetError(null);
    setResetFieldErrors({});
    setIssuedCode(null);
    setExpiresAt(null);
    setResetCode("");
    setNewPass("");
    setConfirmPass("");
    setFlow("request");
  }, [email]);

  const backToSignIn = useCallback(
    (fromEmail?: string) => {
      setError(null);
      setWrongPass(false);
      if (fromEmail) {
        setEmail(fromEmail);
        setPassword("");
      }
      setFlow("signin");
    },
    [],
  );

  /* The issued code's countdown — a code that expires should SAY so. */
  useEffect(() => {
    if (flow !== "issued" || !expiresAt) return;
    const id = setInterval(() => tickClock((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [flow, expiresAt]);

  const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : 0;
  const countdown = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  const copyCode = async () => {
    if (!issuedCode) return;
    try {
      await navigator.clipboard.writeText(issuedCode.replace("-", ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the code is on screen regardless */
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setWrongPass(false);
    try {
      const res = await fetch("/api/org/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? "Sign-in failed — try again.");
        setWrongPass(res.status === 401);
        setSuspended(res.status === 403);
        return;
      }
      setSuspended(false);
      onDone();
    } catch {
      setError("The portal is unreachable — try again shortly.");
    } finally {
      setBusy(false);
    }
  };

  const fileAppeal = async () => {
    if (appealBusy || appealReason.trim().length < 20) return;
    setAppealBusy(true);
    setAppealError(null);
    try {
      const res = await fetch("/api/org/appeal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, registrationNo: appealReg, reason: appealReason }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        appeal?: { reference?: string };
        error?: string;
        errors?: Record<string, string>;
      };
      if (!res.ok || !j.appeal?.reference) {
        setAppealError(j.error ?? "The appeal could not be filed — check the details and try again.");
        return;
      }
      setAppealRef(j.appeal.reference);
      setAppealOpen(false);
    } catch {
      setAppealError("The portal is unreachable — try again shortly.");
    } finally {
      setAppealBusy(false);
    }
  };

  const issueCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetBusy(true);
    setResetError(null);
    setResetFieldErrors({});
    try {
      const res = await fetch("/api/org/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resetEmail }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        issued?: boolean;
        code?: string;
        expiresAt?: string;
        error?: string;
        errors?: Record<string, string>;
      };
      if (!res.ok) {
        setResetFieldErrors(j.errors ?? {});
        setResetError(j.error ?? "The reset could not be issued — try again.");
        return;
      }
      if (!j.issued || !j.code || !j.expiresAt) {
        setResetError("No organization account holds that address — check the spelling, or register the organization first.");
        return;
      }
      setIssuedCode(j.code);
      setExpiresAt(Date.parse(j.expiresAt));
      setResetCode(j.code); // issued here, seconds ago — save the retyping
      setNewPass("");
      setConfirmPass("");
      setFlow("issued");
    } catch {
      setResetError("The portal is unreachable — try again shortly.");
    } finally {
      setResetBusy(false);
    }
  };

  const applyReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors: Record<string, string> = {};
    if (resetCode.replace(/[^A-Za-z0-9]/gi, "").length !== 8) fieldErrors.code = "Enter the 8-character reset code.";
    if (newPass.length < 8) fieldErrors.password = "Use at least 8 characters.";
    if (confirmPass !== newPass) fieldErrors.confirm = "The two passwords do not match.";
    setResetFieldErrors(fieldErrors);
    setResetError(null);
    if (Object.keys(fieldErrors).length > 0) return;

    setResetBusy(true);
    try {
      const res = await fetch("/api/org/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resetEmail, code: resetCode, password: newPass }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        reset?: boolean;
        error?: string;
        errors?: Record<string, string>;
      };
      if (!res.ok || !j.reset) {
        setResetFieldErrors(j.errors ?? {});
        setResetError(j.error ?? "The password could not be replaced — try again.");
        return;
      }
      setFlow("done");
    } catch {
      setResetError("The portal is unreachable — try again shortly.");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {flow === "signin" ? (
        <motion.form
          key="signin"
          onSubmit={submit}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="space-y-3.5"
        >
          <Field label="Organization email">
            <input autoFocus className={inputCls} type="email" autoComplete="email" placeholder="bids@organization.example" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field
            label="Password"
            aside={
              <button
                type="button"
                onClick={openReset}
                className="font-code text-[9.5px] font-semibold uppercase tracking-[0.16em] text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
              >
                Forgot password?
              </button>
            }
          >
            <div className="relative">
              <input
                className={cn(inputCls, "pr-11")}
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => setCapsOn(e.getModifierState("CapsLock"))}
                onKeyUp={(e) => setCapsOn(e.getModifierState("CapsLock"))}
                onBlur={() => setCapsOn(false)}
              />
              <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" aria-label={showPass ? "Hide password" : "Show password"}>
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {capsOn ? (
              <span role="status" className="block text-[12px] font-medium text-brand-700 dark:text-brand-300">
                Caps Lock is on — passwords are case-sensitive.
              </span>
            ) : null}
          </Field>
          {error ? (
            <ErrorNote>
              {error}
              {wrongPass ? (
                <>
                  {" "}
                  <button type="button" onClick={openReset} className="font-semibold underline underline-offset-2 hover:opacity-80">
                    Forgot it? Reset the password.
                  </button>
                </>
              ) : null}
            </ErrorNote>
          ) : null}

          {suspended ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
              {appealRef ? (
                <p>
                  Appeal <strong className="font-code tracking-[0.12em]">{appealRef}</strong> is on the governance log. The
                  procurement desk will review it and reinstate the account if the suspension is lifted.
                </p>
              ) : !appealOpen ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>A suspension blocks the portal. You can ask the desk to review it.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setAppealOpen(true);
                      setAppealError(null);
                    }}
                    className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-code text-[8px] font-bold tracking-[0.14em] text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:text-amber-200"
                  >
                    APPEAL THIS SUSPENSION
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <p className="font-code text-[8px] font-bold tracking-[0.16em]">SUSPENSION APPEAL — PUBLIC FORM</p>
                  <Field label="Registration number">
                    <input
                      className={cn(inputCls, "h-9 text-[13px]")}
                      autoComplete="off"
                      placeholder="The legal registration number on the account"
                      value={appealReg}
                      onChange={(e) => setAppealReg(e.target.value)}
                    />
                  </Field>
                  <Field label="Grounds for the appeal (at least 20 characters)">
                    <textarea
                      rows={3}
                      maxLength={1200}
                      className={cn(inputCls, "h-auto resize-y py-2 text-[13px]")}
                      placeholder="e.g. the tax clearance was renewed on 12 October; the certificate is attached to the profile."
                      value={appealReason}
                      onChange={(e) => setAppealReason(e.target.value)}
                    />
                  </Field>
                  {appealError ? <p className="text-[12px] font-medium">{appealError}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void fileAppeal()}
                      disabled={appealBusy || appealReg.trim().length < 3 || appealReason.trim().length < 20}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-900 px-3 font-code text-[8px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-amber-950 disabled:opacity-50"
                    >
                      {appealBusy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <CircleAlert className="h-3 w-3" aria-hidden="true" />}
                      FILE THE APPEAL
                    </button>
                    <button
                      type="button"
                      onClick={() => setAppealOpen(false)}
                      disabled={appealBusy}
                      className="h-8 rounded-lg border border-amber-300 px-3 font-code text-[8px] font-bold tracking-[0.14em] text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:text-amber-200"
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink-950 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Building2 className="h-4 w-4" aria-hidden="true" />}
            Sign in to the supplier portal
          </button>
        </motion.form>
      ) : flow === "request" ? (
        <motion.form
          key="request"
          onSubmit={issueCode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="space-y-3.5"
        >
          <div className="flex items-center justify-between">
            <p className="font-code text-[9.5px] font-semibold tracking-[0.18em] text-brand-700 dark:text-brand-400">RESET ACCESS</p>
            <p className="font-code text-[9px] tracking-[0.16em] text-ink-400">ONE-TIME CODE · 15 MIN</p>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-500 dark:text-ink-400">
            The desk issues a one-time reset code straight to this screen — supplier accounts carry no outbound
            mail, so nothing is sent to spam and nothing depends on an inbox. The code works once and expires in
            fifteen minutes.
          </p>
          <Field label="Organization email" error={resetFieldErrors.email}>
            <input autoFocus className={inputCls} type="email" autoComplete="email" placeholder="bids@organization.example" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
          </Field>
          {resetError ? <ErrorNote>{resetError}</ErrorNote> : null}
          <button
            type="submit"
            disabled={resetBusy}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink-950 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600 disabled:opacity-60"
          >
            {resetBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
            Issue a reset code
          </button>
          <button
            type="button"
            onClick={() => backToSignIn()}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 transition-colors hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to sign in
          </button>
        </motion.form>
      ) : flow === "issued" ? (
        <motion.form
          key="issued"
          onSubmit={applyReset}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="space-y-3.5"
        >
          <div className="flex items-center justify-between">
            <p className="font-code text-[9.5px] font-semibold tracking-[0.18em] text-brand-700 dark:text-brand-400">RESET CODE ISSUED</p>
            <p className="flex items-center gap-1.5 font-code text-[9px] font-semibold tracking-[0.16em] text-ink-400">
              <span className={cn("relative flex h-1.5 w-1.5", secondsLeft > 0 && "text-brand-600")}>
                {secondsLeft > 0 ? (
                  <>
                    <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" />
                  </>
                ) : (
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ink-400" />
                )}
              </span>
              {secondsLeft > 0 ? `${countdown} REMAINING` : "EXPIRED — ISSUE A FRESH CODE"}
            </p>
          </div>

          {issuedCode ? (
            <div className="rounded-xl border border-dashed border-brand-300 bg-brand-50/60 px-4 py-3.5 dark:border-brand-800 dark:bg-brand-950/30">
              <div className="flex items-center justify-between gap-3">
                <p className="font-code text-[22px] font-bold leading-none tracking-[0.28em] text-brand-700 dark:text-brand-300">
                  {issuedCode}
                </p>
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 font-code text-[9px] font-semibold tracking-[0.16em] text-ink-600 transition-colors hover:bg-ink-50 dark:border-white/15 dark:bg-night-2 dark:text-ink-300 dark:hover:bg-white/5"
                  aria-label="Copy the reset code"
                >
                  {copied ? <Check className="h-3 w-3 text-ink-950 dark:text-white" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
                  {copied ? "COPIED" : "COPY"}
                </button>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">
                Shown once, here — this register keeps supplier credentials off third-party mail. Enter it below
                together with the new password.
              </p>
            </div>
          ) : null}

          <Field label="Reset code" error={resetFieldErrors.code}>
            <input
              autoFocus
              className={cn(inputCls, "font-code uppercase tracking-[0.22em]")}
              autoComplete="one-time-code"
              placeholder="XXXX-XXXX"
              maxLength={12}
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="New password" error={resetFieldErrors.password}>
            <div className="relative">
              <input
                className={cn(inputCls, "pr-11")}
                type={showNewPass ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
              <button type="button" onClick={() => setShowNewPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" aria-label={showNewPass ? "Hide new password" : "Show new password"}>
                {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <PassphraseMeter password={newPass} />
          <Field label="Confirm password" error={resetFieldErrors.confirm}>
            <input className={inputCls} type="password" autoComplete="new-password" placeholder="Repeat the password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} />
          </Field>

          {resetError ? <ErrorNote>{resetError}</ErrorNote> : null}

          <button
            type="submit"
            disabled={resetBusy || secondsLeft === 0}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink-950 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600 disabled:opacity-60"
          >
            {resetBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            Replace the password
          </button>
          <button
            type="button"
            onClick={openReset}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 transition-colors hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Issue a different code
          </button>
        </motion.form>
      ) : (
        <motion.div
          key="done"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="space-y-4 text-center"
          aria-live="polite"
        >
          <motion.div
            initial={{ scale: 1.7, opacity: 0, rotate: -10 }}
            animate={{ scale: 1, opacity: 1, rotate: -4 }}
            transition={{ type: "spring", stiffness: 240, damping: 16, delay: 0.12 }}
            className="mx-auto inline-block rounded-lg border-[3px] border-brand-600 px-5 py-2.5 shadow-[0_16px_40px_rgba(217,38,22,0.24)]"
          >
            <p className="type-display text-[16px] tracking-[0.1em] text-brand-600">PASSWORD REPLACED</p>
          </motion.div>
          <p className="text-[13.5px] leading-relaxed text-ink-600 dark:text-ink-300">
            The new password is live on the register and every open session for{" "}
            <span className="font-semibold text-ink-950 dark:text-white">{resetEmail}</span> was signed out —
            including any that was not yours.
          </p>
          <button
            type="button"
            onClick={() => backToSignIn(resetEmail)}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink-950 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Sign in with the new password
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── The screen ──────────────────────────────────────────────────────────── */

export function OrgAuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "register">("register");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [existingOrg, setExistingOrg] = useState<OrgProfile | null>(null);
  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const registerButtonRef = useRef<HTMLButtonElement | null>(null);
  const registerDialogRef = useRef<HTMLDivElement | null>(null);

  const checkExisting = useCallback(async () => {
    try {
      /* 200 {org:null} when anonymous — the officer door's shape. A probe
         that 401s would put a console error on every visitor's browser. */
      const res = await fetch("/api/org/auth/me", { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as { org?: OrgProfile | null };
        if (j.org) setExistingOrg(j.org);
      }
    } catch {
      /* not signed in — nothing to show */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void checkExisting(), 0);
    return () => clearTimeout(t);
  }, [checkExisting]);

  const onDone = useCallback(() => {
    router.push("/org/dashboard");
    router.refresh();
  }, [router]);

  const onRegistered = useCallback(
    (name: string) => {
      setRegisteredName(name);
      setRegisterOpen(false);
      void checkExisting();
    },
    [checkExisting],
  );

  const closeRegistration = useCallback(() => {
    if (registerBusy) return;
    setRegisterOpen(false);
    window.requestAnimationFrame(() => registerButtonRef.current?.focus());
  }, [registerBusy]);

  useEffect(() => {
    if (!registerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !registerBusy) closeRegistration();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [registerOpen, registerBusy, closeRegistration]);

  const trapRegistrationTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      registerDialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !registerDialogRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Story panel */}
      <div className="relative hidden overflow-hidden bg-night lg:flex lg:flex-col lg:justify-between lg:p-12">
        <AuthFilm />
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(640px 420px at 18% 12%, rgba(217,38,22,0.15), transparent 60%), radial-gradient(520px 380px at 82% 88%, rgba(217,38,22,0.09), transparent 60%)",
          }}
          aria-hidden="true"
        />
        <div className="pointer-events-none absolute -left-44 top-1/3 h-[420px] w-[420px] rounded-full bg-brand-600/10 blur-[130px]" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-grid-dark opacity-60" aria-hidden="true" />
        <div className="relative max-w-xl space-y-6">
          <h1 className="type-display text-[42px] text-white">
            The supplier side
            <br />
            of the desk<span className="text-brand-500">.</span>
          </h1>
          <p className="text-[15.5px] leading-relaxed text-ink-300">
            Officers review and award on the desk. This door is yours: build your organization&apos;s profile once,
            watch the opportunities board, and file applications that carry your organization&apos;s verified identity
            into the procurement record.
          </p>
          {/* The value story rotates — one fact at a time, pausing when the
              visitor reads it. Every slide states something the portal does. */}
          <RegisterShowcase />
        </div>

      </div>

      {/* Auth panel */}
      <div className="flex flex-col bg-paper dark:bg-night">
        {/* pt-5 — the portal switcher now lives in the card, so the mobile header needs no clearance */}
        <div className="flex items-center justify-end px-5 pb-4 pt-5 lg:hidden">
          <Link href="/" className="font-code text-[10px] font-semibold tracking-[0.16em] text-ink-500 hover:text-ink-900 dark:hover:text-white">
            OFFICER DESK →
          </Link>
        </div>

        <div className="flex flex-1 items-start justify-center px-4 pb-10 pt-4 lg:px-12 lg:pt-12">
          <div className="w-full max-w-[480px]">
            {/* Mobile brand band — the door's identity, compact */}
            <div className="relative mb-5 overflow-hidden rounded-[10px] bg-night p-5 lg:hidden">
              <AuthFilm compact />
              <div className="pointer-events-none absolute inset-0 bg-grid-dark opacity-60" aria-hidden="true" />
              <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-brand-600/20 blur-[70px]" aria-hidden="true" />
              <div className="relative">
                <p className="font-code text-[9px] font-semibold tracking-[0.22em] text-brand-300">SUPPLIER PORTAL</p>
                <h2 className="type-display mt-2 text-[22px] text-white">
                  The supplier side of the desk<span className="text-brand-500">.</span>
                </h2>
                {/* The same rotation, compact — the door tells its story on
                    small screens too, with the same facts and controls. */}
                <div className="mt-3.5">
                  <RegisterShowcase compact />
                </div>
              </div>
            </div>

            {/* Portal tag — the Quorum / Supplier switcher sits inside the card, above the brand. */}
            <div className="mb-5 hidden items-center justify-end lg:flex">
              <span className="font-code text-[9.5px] font-semibold tracking-[0.2em] text-brand-700 dark:text-brand-400">SUPPLIER PORTAL · /ORG</span>
            </div>

            {registeredName ? (
              <div className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-6 shadow-[0_16px_48px_rgba(11,12,15,0.08)] sm:p-8 dark:border-white/10 dark:bg-night-2">
                <div className="mb-5"><MasterSwitcher active="supplier" className="w-full [&>button]:flex-1" /></div>
                <OnTheRegister orgName={registeredName} onEnter={onDone} />
              </div>
            ) : existingOrg ? (
              <div className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-6 shadow-[0_16px_48px_rgba(11,12,15,0.08)] dark:border-white/10 dark:bg-night-2">
                <div className="mb-5"><MasterSwitcher active="supplier" className="w-full [&>button]:flex-1" /></div>
                <p className="font-code text-[9.5px] font-semibold tracking-[0.18em] text-brand-700 dark:text-brand-400">SESSION ALREADY OPEN</p>
                <p className="mt-2 text-[15px] font-semibold text-ink-950 dark:text-white">{existingOrg.name}</p>
                <p className="mt-1 text-[13px] text-ink-500 dark:text-ink-400">
                  This browser already holds an organization session ({existingOrg.status.toLowerCase()}).
                </p>
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={onDone} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-ink-950 text-[13.5px] font-semibold text-white transition-all hover:bg-brand-600">
                    Continue to console <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setExistingOrg(null)} className="inline-flex h-10 items-center rounded-xl border border-ink-200 px-4 text-[13px] font-semibold text-ink-700 transition-colors hover:bg-ink-50 dark:border-white/15 dark:text-ink-200 dark:hover:bg-white/5">
                    Use a different organization
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-6 shadow-[0_16px_48px_rgba(11,12,15,0.08)] sm:p-8 dark:border-white/10 dark:bg-night-2">
                <div className="mb-6">
                  <MasterSwitcher active="supplier" className="w-full [&>button]:flex-1" />
                </div>
                <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-ink-50 p-1 ring-1 ring-inset ring-ink-200 dark:bg-white/[0.04] dark:ring-white/10">
                  {(["register", "signin"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      ref={m === "register" ? registerButtonRef : undefined}
                      aria-pressed={mode === m}
                      onClick={() => {
                        setMode(m);
                        if (m === "register") setRegisterOpen(true);
                      }}
                      className={cn(
                        "relative rounded-lg py-2.5 text-[13px] font-semibold transition-colors",
                        mode === m ? "text-white" : "text-ink-500 hover:text-ink-900 dark:hover:text-white",
                      )}
                    >
                      {mode === m ? (
                        <motion.span layoutId="org-mode-pill" className="absolute inset-0 rounded-lg bg-ink-950 dark:bg-white" transition={{ duration: 0.24, ease: EASE }} />
                      ) : null}
                      <span className={cn("relative flex items-center justify-center gap-1.5", mode === m ? "dark:text-night" : "")}>
                        {m === "register" ? <Building2 className="h-3.5 w-3.5" aria-hidden="true" /> : <UserRound className="h-3.5 w-3.5" aria-hidden="true" />}
                        {m === "register" ? "Register organization" : "Sign in"}
                      </span>
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={mode}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22, ease: EASE }}
                  >
                    {mode === "register" ? (
                      <div className="rounded-xl border border-ink-100 bg-sand/70 p-5 dark:border-white/10 dark:bg-white/[0.03] sm:p-6">
                        <div className="flex items-start gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-950 text-white dark:bg-white dark:text-ink-950">
                            <Building2 className="h-4.5 w-4.5" aria-hidden="true" />
                          </span>
                          <div>
                            <p className="font-code text-[9px] font-semibold tracking-[0.18em] text-brand-700 dark:text-brand-400">
                              ORGANIZATION ONBOARDING
                            </p>
                            <h2 className="mt-1 text-[17px] font-bold text-ink-950 dark:text-white">
                              Put your organization on the record.
                            </h2>
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500 dark:text-ink-400">
                              Create a verified profile in four clear steps: legal identity, statutory details,
                              capabilities, and secure account access.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRegisterOpen(true)}
                          className="group mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-950 px-5 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-night-2"
                        >
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                          Register organization
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </button>
                        <p className="mt-3 text-center font-code text-[8.5px] tracking-[0.12em] text-ink-400">
                          FOUR STEPS · REVIEW BEFORE YOU CREATE
                        </p>
                      </div>
                    ) : (
                      <SignIn onDone={onDone} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}

            <AnimatePresence>
              {registerOpen && mode === "register" && !registeredName ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-[80] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-5"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) closeRegistration();
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="org-registration-title"
                >
                  <motion.div
                    ref={registerDialogRef}
                    initial={{ opacity: 0, y: 18, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.99 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    onKeyDown={trapRegistrationTab}
                    className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[16px] border border-white/10 bg-white shadow-[0_36px_100px_rgba(0,0,0,0.45)] dark:bg-night-2"
                  >
                    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-white/10 sm:px-7 sm:py-5">
                      <div>
                        <p className="font-code text-[9px] font-semibold tracking-[0.22em] text-brand-700 dark:text-brand-400">
                          SUPPLIER PORTAL · ORGANIZATION INTAKE
                        </p>
                        <h2 id="org-registration-title" className="mt-1 text-[19px] font-bold tracking-tight text-ink-950 dark:text-white sm:text-[22px]">
                          Register your organization
                        </h2>
                        <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-ink-500 dark:text-ink-400">
                          Build your legal profile once. You can review everything before creating the account.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={closeRegistration}
                        disabled={registerBusy}
                        aria-label="Close organization registration"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-white"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="overflow-y-auto overscroll-contain p-5 sm:p-7">
                      <RegisterWizard
                        onRegistered={onRegistered}
                        onBusyChange={setRegisterBusy}
                      />
                    </div>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <p className="mt-5 text-center text-[12px] leading-relaxed text-ink-400 dark:text-ink-500">
              Organizations sign in here only — officers have their own door on the main site.
              <br />
              Your applications are refused after the closing date and one bid is counted per tender.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

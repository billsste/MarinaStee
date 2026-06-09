"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitApplication } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { ApplicationSlipClass } from "@/lib/types";

/*
 * Public-facing multi-step apply wizard.
 *
 * Steps:
 *   1. Contact info
 *   2. Vessel details
 *   3. Slip preferences
 *   4. Review + submit
 *
 * Local form state only — no React Hook Form / Zod (mirrors the marina's
 * existing wizard conventions in components/create-sheet.tsx). Submit
 * mints an application_token via `submitApplication` and bounces to
 * /apply/success?token=...
 *
 * Validation is deliberately light — required fields gate the Next
 * button, but the operator queue is the source of truth for filtering
 * bad submissions. Real-form / Zod / captcha land at backend-cutover.
 */

type Step = 1 | 2 | 3 | 4;

type Form = {
  applicant_first_name: string;
  applicant_last_name: string;
  applicant_email: string;
  applicant_phone: string;
  applicant_address: string;
  vessel_name: string;
  vessel_year: string;
  vessel_make: string;
  vessel_model: string;
  vessel_loa: string;
  vessel_beam: string;
  vessel_draft: string;
  preferred_slip_class: ApplicationSlipClass | "";
  preferred_dock: string;
  desired_start_date: string;
  notes: string;
};

const EMPTY: Form = {
  applicant_first_name: "",
  applicant_last_name: "",
  applicant_email: "",
  applicant_phone: "",
  applicant_address: "",
  vessel_name: "",
  vessel_year: "",
  vessel_make: "",
  vessel_model: "",
  vessel_loa: "",
  vessel_beam: "",
  vessel_draft: "",
  preferred_slip_class: "",
  preferred_dock: "",
  desired_start_date: "",
  notes: "",
};

const STEP_TITLES: Record<Step, { title: string; subtitle: string }> = {
  1: {
    title: "Tell us about you",
    subtitle: "Contact info so we can get back to you.",
  },
  2: {
    title: "Your vessel",
    subtitle: "Length, beam, and basics — we use it to match a slip.",
  },
  3: {
    title: "Slip preferences",
    subtitle: "What you're looking for, and when.",
  },
  4: {
    title: "Review and submit",
    subtitle: "Quick check before you send it our way.",
  },
};

const SLIP_CLASSES: { value: ApplicationSlipClass; label: string; desc: string }[] = [
  { value: "covered", label: "Covered", desc: "Roof — premium protection" },
  { value: "uncovered", label: "Uncovered", desc: "Standard dock slip" },
  { value: "T-head", label: "T-head", desc: "End-of-dock, extra clearance" },
  { value: "buoy", label: "Mooring buoy", desc: "Out on the water" },
  { value: "dry", label: "Dry storage", desc: "Out of the water" },
];

export function ApplyWizard() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>(1);
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const canAdvance = (s: Step): boolean => {
    if (s === 1) {
      return !!(
        form.applicant_first_name.trim() &&
        form.applicant_last_name.trim() &&
        form.applicant_email.trim() &&
        form.applicant_phone.trim()
      );
    }
    if (s === 2) {
      return !!(
        form.vessel_name.trim() &&
        form.vessel_make.trim() &&
        form.vessel_model.trim() &&
        form.vessel_loa.trim()
      );
    }
    return true;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    // BUG FIX: previously this fired without try/catch. submitApplication
    // is sync on the mock path but becomes a Promise once flipped to a
    // Convex mutation — which can throw on validation, rate-limit,
    // network. Without the catch, the failure path silently bounced to
    // /apply/success with `undefined` token + the submit button stayed
    // locked. Now: surface the error, reset submitting, stay on Review.
    try {
      const loa = parseFloat(form.vessel_loa);
      const beam = parseFloat(form.vessel_beam);
      const draft = parseFloat(form.vessel_draft);
      const yr = parseFloat(form.vessel_year);
      const app = await Promise.resolve(
        submitApplication({
          applicant_first_name: form.applicant_first_name.trim(),
          applicant_last_name: form.applicant_last_name.trim(),
          applicant_email: form.applicant_email.trim(),
          applicant_phone: form.applicant_phone.trim(),
          applicant_address: form.applicant_address.trim() || undefined,
          vessel_name: form.vessel_name.trim(),
          vessel_year: Number.isFinite(yr) ? yr : undefined,
          vessel_make: form.vessel_make.trim(),
          vessel_model: form.vessel_model.trim(),
          // Form takes feet; persist inches everywhere downstream.
          vessel_loa_inches: Number.isFinite(loa) ? Math.round(loa * 12) : 0,
          vessel_beam_inches: Number.isFinite(beam) ? Math.round(beam * 12) : undefined,
          vessel_draft_inches: Number.isFinite(draft) ? Math.round(draft * 12) : undefined,
          preferred_slip_class: form.preferred_slip_class || undefined,
          preferred_dock: form.preferred_dock.trim() || undefined,
          desired_start_date: form.desired_start_date || undefined,
          notes: form.notes.trim() || undefined,
          source: "public_apply",
        }),
      );
      if (!app?.application_token) {
        throw new Error("Submission accepted but no confirmation token returned.");
      }
      router.push(`/apply/success?token=${app.application_token}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong submitting your application.";
      setError(msg);
      setSubmitting(false);
    }
  };

  const { title, subtitle } = STEP_TITLES[step];

  return (
    <div className="rounded-[16px] border border-hairline bg-surface-1 p-6 shadow-sm sm:p-8">
      <StepHeader step={step} title={title} subtitle={subtitle} />

      <div className="mt-6 space-y-4">
        {step === 1 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="First name"
              value={form.applicant_first_name}
              onChange={(v) => update("applicant_first_name", v)}
              autoFocus
              required
            />
            <Field
              label="Last name"
              value={form.applicant_last_name}
              onChange={(v) => update("applicant_last_name", v)}
              required
            />
            <Field
              label="Email"
              type="email"
              value={form.applicant_email}
              onChange={(v) => update("applicant_email", v)}
              required
            />
            <Field
              label="Phone"
              type="tel"
              inputMode="tel"
              value={form.applicant_phone}
              onChange={(v) => update("applicant_phone", v)}
              required
            />
            <div className="sm:col-span-2">
              <Field
                label="Mailing address (optional)"
                value={form.applicant_address}
                onChange={(v) => update("applicant_address", v)}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                label="Vessel name"
                value={form.vessel_name}
                onChange={(v) => update("vessel_name", v)}
                autoFocus
                required
              />
            </div>
            <Field
              label="Make"
              value={form.vessel_make}
              onChange={(v) => update("vessel_make", v)}
              required
            />
            <Field
              label="Model"
              value={form.vessel_model}
              onChange={(v) => update("vessel_model", v)}
              required
            />
            <Field
              label="Year (optional)"
              inputMode="numeric"
              value={form.vessel_year}
              onChange={(v) => update("vessel_year", v)}
            />
            <Field
              label="LOA — length (feet)"
              inputMode="decimal"
              value={form.vessel_loa}
              onChange={(v) => update("vessel_loa", v)}
              required
            />
            <Field
              label="Beam (feet, optional)"
              inputMode="decimal"
              value={form.vessel_beam}
              onChange={(v) => update("vessel_beam", v)}
            />
            <Field
              label="Draft (feet, optional)"
              inputMode="decimal"
              value={form.vessel_draft}
              onChange={(v) => update("vessel_draft", v)}
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-[12px] font-medium text-fg-muted">
                Preferred slip type (optional)
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SLIP_CLASSES.map((opt) => {
                  const active = form.preferred_slip_class === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        update(
                          "preferred_slip_class",
                          active ? "" : opt.value,
                        )
                      }
                      className={cn(
                        "flex items-start gap-3 rounded-[10px] border px-3 py-3 text-left transition-colors",
                        active
                          ? "border-primary bg-primary-soft text-fg"
                          : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                          active
                            ? "border-primary bg-primary text-on-primary"
                            : "border-hairline-strong",
                        )}
                      >
                        {active ? <Check className="size-2.5" /> : null}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-fg">
                          {opt.label}
                        </div>
                        <div className="text-[12px] text-fg-subtle">
                          {opt.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Preferred dock (optional)"
                value={form.preferred_dock}
                onChange={(v) => update("preferred_dock", v)}
                placeholder="e.g. Damsite A Dock"
              />
              <Field
                label="Desired start date (optional)"
                type="date"
                value={form.desired_start_date}
                onChange={(v) => update("desired_start_date", v)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-fg-muted">
                Anything else? (optional)
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                rows={3}
                placeholder="Insurance carrier, transfer from another marina, special requests…"
                className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-tertiary focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <ReviewBlock
              title="Contact"
              rows={[
                ["Name", `${form.applicant_first_name} ${form.applicant_last_name}`],
                ["Email", form.applicant_email],
                ["Phone", form.applicant_phone],
                ["Address", form.applicant_address || "—"],
              ]}
            />
            <ReviewBlock
              title="Vessel"
              rows={[
                ["Name", form.vessel_name],
                [
                  "Make / Model",
                  `${form.vessel_make} ${form.vessel_model}${form.vessel_year ? ` · ${form.vessel_year}` : ""}`,
                ],
                ["LOA", form.vessel_loa ? `${form.vessel_loa} ft` : "—"],
                [
                  "Beam · Draft",
                  `${form.vessel_beam || "—"}${form.vessel_beam ? " ft" : ""} · ${form.vessel_draft || "—"}${form.vessel_draft ? " ft" : ""}`,
                ],
              ]}
            />
            <ReviewBlock
              title="Slip preferences"
              rows={[
                ["Class", form.preferred_slip_class || "No preference"],
                ["Dock", form.preferred_dock || "—"],
                ["Start date", form.desired_start_date || "—"],
                ["Notes", form.notes || "—"],
              ]}
            />
          </div>
        )}
      </div>

      <div className="mt-7 flex items-center justify-between gap-3">
        {step > 1 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(1, (s - 1) as Step) as Step)}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Button>
        ) : (
          <div />
        )}
        {step < 4 ? (
          <Button
            type="button"
            variant="primary"
            disabled={!canAdvance(step)}
            onClick={() => setStep((s) => Math.min(4, (s + 1) as Step) as Step)}
          >
            Continue
            <ArrowRight className="size-3.5" />
          </Button>
        ) : (
          <div className="flex flex-col items-end gap-2">
            {error && (
              <div
                role="alert"
                className="rounded-[8px] border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-[12px] text-status-danger"
              >
                {error}
              </div>
            )}
            <Button
              type="button"
              variant="primary"
              size="lg"
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  Submit application
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepHeader({
  step,
  title,
  subtitle,
}: {
  step: Step;
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-1.5">
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              n <= step ? "bg-primary" : "bg-surface-3",
            )}
          />
        ))}
      </div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        Step {step} of 4
      </div>
      <h2 className="mt-1 text-[20px] font-semibold text-fg display-tight">
        {title}
      </h2>
      <p className="mt-1 text-[13px] text-fg-subtle">{subtitle}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  inputMode,
  autoFocus,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: React.HTMLInputTypeAttribute;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoFocus?: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-fg-muted">
        {label}
        {required ? <span className="text-status-danger"> *</span> : null}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[13px] text-fg outline-none placeholder:text-fg-tertiary focus:border-primary focus:ring-1 focus:ring-primary"
      />
    </label>
  );
}

function ReviewBlock({
  title,
  rows,
}: {
  title: string;
  rows: [string, string][];
}) {
  return (
    <div className="rounded-[10px] border border-hairline bg-surface-2/40 p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </div>
      <dl className="mt-2 space-y-1">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex items-start justify-between gap-3 text-[13px]"
          >
            <dt className="text-fg-subtle">{k}</dt>
            <dd className="text-right text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

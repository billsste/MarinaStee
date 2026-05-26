"use client";

import * as React from "react";
import { CreateSheet, Field, NumberInput, Select, TextInput } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { BOATERS } from "@/lib/mock-data";
import { useBoaters } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";

export function AddCardSheet({
  open,
  onOpenChange,
  defaultBoaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;

  const [boaterId, setBoaterId] = React.useState(defaultBoaterId ?? "");
  const [brand, setBrand] = React.useState<"visa" | "mastercard" | "amex" | "discover">("visa");
  const [last4, setLast4] = React.useState("");
  const [expMonth, setExpMonth] = React.useState("");
  const [expYear, setExpYear] = React.useState("");
  const [nickname, setNickname] = React.useState("");
  const [isDefault, setIsDefault] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setBoaterId(defaultBoaterId ?? "");
      setBrand("visa");
      setLast4("");
      setExpMonth("");
      setExpYear("");
      setNickname("");
      setIsDefault(false);
    }
  }, [open, defaultBoaterId]);

  const last4Valid = /^\d{4}$/.test(last4);
  const monthValid = (() => {
    const m = Number(expMonth);
    return m >= 1 && m <= 12;
  })();
  const yearValid = (() => {
    const y = Number(expYear);
    const thisYear = new Date().getFullYear();
    return y >= thisYear && y <= thisYear + 20;
  })();

  const canSubmit = boaterId.length > 0 && last4Valid && monthValid && yearValid;

  function submit() {
    if (!canSubmit) return;
    executeAgentAction({
      kind: "add_card",
      label: "",
      boater_id: boaterId,
      brand,
      last4,
      exp_month: Number(expMonth),
      exp_year: Number(expYear),
      nickname: nickname.trim() || undefined,
      is_default: isDefault,
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add card on file"
      description="Store card metadata for future auto-charges. In production this would tokenize via the processor (Stripe / Authorize.net) — here we record the metadata only."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Add card
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Holder" required>
          <Combobox
            value={boaterId}
            onChange={setBoaterId}
            options={boaters.map((b) => ({
              value: b.id,
              label: b.display_name,
              hint: b.code ? `· ${b.code}` : undefined,
            }))}
            placeholder="Pick a holder…"
            searchPlaceholder="Search by name, code…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand">
            <Select value={brand} onChange={(v) => setBrand(v as typeof brand)}>
              <option value="visa">Visa</option>
              <option value="mastercard">Mastercard</option>
              <option value="amex">Amex</option>
              <option value="discover">Discover</option>
            </Select>
          </Field>
          <Field label="Last 4" required>
            <TextInput
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="4242"
              maxLength={4}
              inputMode="numeric"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Exp month" required>
            <NumberInput
              min="1"
              max="12"
              value={expMonth}
              onChange={(e) => setExpMonth(e.target.value)}
              placeholder="12"
            />
          </Field>
          <Field label="Exp year" required>
            <NumberInput
              min={new Date().getFullYear()}
              max={new Date().getFullYear() + 20}
              value={expYear}
              onChange={(e) => setExpYear(e.target.value)}
              placeholder="2028"
            />
          </Field>
          <Field label="Nickname">
            <TextInput
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Personal Visa"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-[13px] text-fg">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="size-3.5"
          />
          Make this the default card for auto-charges
        </label>
      </div>
    </CreateSheet>
  );
}

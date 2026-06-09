/**
 * resolveContractTokens
 *
 * Replaces all {{token}} merge fields in a contract body_markdown
 * with values drawn from the boater, vessel, slip, and contract records.
 *
 * Token catalogue:
 *   {{boater.first_name}}          {{boater.last_name}}
 *   {{boater.full_name}}           {{boater.legal_name}}
 *   {{boater.email}}               {{boater.phone}}
 *   {{boater.address}}             {{boater.address_line1}}
 *   {{boater.city}}                {{boater.state}}
 *   {{boater.zip}}
 *   {{vessel.name}}                {{vessel.year}}
 *   {{vessel.make}}                {{vessel.model}}
 *   {{vessel.registration}}        {{vessel.length_feet}}
 *   {{slip.number}}                {{slip.dock}}
 *   {{slip.max_loa}}
 *   {{contract.number}}            {{contract.effective_start}}
 *   {{contract.effective_end}}     {{contract.annual_rate}}
 *   {{contract.billing_cadence}}
 *
 * Any unrecognised {{token}} is left as-is so templates that contain
 * tokens outside this catalogue can still render partially.
 */

import type { Boater, Contract, Slip, Vessel } from "@/lib/types";

export function resolveContractTokens(
  contract: Contract,
  boater: Boater,
  vessel: Vessel | null | undefined,
  slip: Slip | null | undefined,
  /**
   * Optional explicit body — used to render the canonical template body
   * when the contract hasn't been individually drafted yet. Falls back
   * to contract.drafted_body_markdown when not provided.
   */
  bodyOverride?: string
): string {
  const body = bodyOverride ?? contract.drafted_body_markdown ?? "";
  if (!body) return "";

  // Build the token map ──────────────────────────────────────────────────────

  const addr = boater.address;
  const addressOneLine = [
    addr.line1,
    addr.line2,
    addr.city && addr.state
      ? `${addr.city}, ${addr.state} ${addr.zip ?? ""}`
      : addr.city ?? addr.state ?? addr.zip ?? "",
  ]
    .filter(Boolean)
    .join(", ")
    .trim();

  const fullName = `${boater.first_name} ${boater.last_name}`.trim();

  const tokens: Record<string, string> = {
    // Boater
    "boater.first_name": boater.first_name,
    "boater.last_name": boater.last_name,
    "boater.full_name": fullName,
    "boater.legal_name": boater.legal_name ?? fullName,
    "boater.email": boater.primary_contact.email ?? "",
    "boater.phone": boater.primary_contact.phone ?? "",
    "boater.address": addressOneLine,
    "boater.address_line1": addr.line1 ?? "",
    "boater.city": addr.city ?? "",
    "boater.state": addr.state ?? "",
    "boater.zip": addr.zip ?? "",

    // Vessel
    "vessel.name": vessel?.name ?? "—",
    "vessel.year": vessel?.year != null ? String(vessel.year) : "—",
    "vessel.make": vessel?.make ?? "—",
    "vessel.model": vessel?.model ?? "—",
    "vessel.registration": vessel?.registration ?? "—",
    "vessel.length_feet":
      vessel?.loa_inches != null
        ? String(Math.round(vessel.loa_inches / 12))
        : "—",

    // Slip
    "slip.number": slip?.number ?? "—",
    "slip.dock": slip?.dock ?? "—",
    "slip.max_loa":
      slip?.max_loa_inches != null
        ? String(Math.round(slip.max_loa_inches / 12)) + "'"
        : "—",

    // Contract
    "contract.number": contract.number,
    "contract.effective_start": contract.effective_start,
    "contract.effective_end": contract.effective_end,
    "contract.annual_rate":
      contract.annual_rate != null
        ? `$${contract.annual_rate.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : "—",
    "contract.billing_cadence": contract.billing_cadence,
  };

  // Replace all {{token}} occurrences ──────────────────────────────────────
  return body.replace(/\{\{([^}]+)\}\}/g, (_match: string, key: string) => {
    const trimmed = key.trim();
    return trimmed in tokens ? tokens[trimmed] : _match;
  });
}

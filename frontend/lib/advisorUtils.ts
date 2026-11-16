// Pure helpers for the Policy Advisor screen: formatting, parsing and chart data.
// No React or browser APIs here, so everything can be tested on its own.

import type {
  ImpactSet,
  PolicyChange,
  ProposalStatus,
  SuggestedChange,
  Verdict,
} from "./types";

// ---------------------------------------------------------------------------
// names and number formatting
// ---------------------------------------------------------------------------

const PARAM_LABELS: Record<string, string> = {
  supervised_weight: "Model mix (XGBoost / anomaly)",
  monitor_threshold: "Monitor from score",
  verify_threshold: "Challenge (verify) from score",
  block_threshold: "Block from score",
  critical_threshold: "Critical block from score",
};

export function paramLabel(param: string): string {
  return PARAM_LABELS[param] ?? param.replaceAll("_", " ");
}

export function formatParam(param: string, value: number): string {
  if (param === "supervised_weight") {
    const known = Math.round(value * 100);
    return `${known} / ${100 - known}`;
  }
  return value.toFixed(2);
}

export function pct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "–" : `${(value * 100).toFixed(digits)}%`;
}

export function secs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return value < 120 ? `${Math.round(value)}s` : `${(value / 60).toFixed(1)} min`;
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return `Rs ${new Intl.NumberFormat("en-IN").format(Math.round(value))}`;
}

export function titleCase(text: string): string {
  return text
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function runTitle(label: string): string {
  return label === "tuning" ? "Tuning run" : `Other run ${label}`;
}

export type Tone = "good" | "bad" | "flat";

export interface Delta {
  text: string;
  tone: Tone;
}

/** Change from `before` to `after`, with a tone telling whether that is an improvement. */
export function formatDelta(
  before: number | null | undefined,
  after: number | null | undefined,
  unit: "pct" | "money" | "secs",
  lowerIsBetter: boolean,
): Delta {
  if (before === null || before === undefined || after === null || after === undefined) {
    return { text: "–", tone: "flat" };
  }

  const change = unit === "pct" ? (after - before) * 100 : after - before;
  const tiny = unit === "pct" ? 0.05 : 0.5;

  if (Math.abs(change) < tiny) return { text: "no change", tone: "flat" };

  const sign = change > 0 ? "+" : "−";
  const size = Math.abs(change);
  const text =
    unit === "pct"
      ? `${sign}${size.toFixed(1)} pts`
      : unit === "money"
        ? `${sign}${money(size)}`
        : `${sign}${secs(size)}`;

  const better = lowerIsBetter ? change < 0 : change > 0;
  return { text, tone: better ? "good" : "bad" };
}

export function verdictTone(verdict: Verdict | null): "good" | "warn" | "neutral" {
  if (!verdict) return "neutral";
  if (verdict.validation_runs === 0) return "warn";
  return verdict.improved_on === verdict.validation_runs ? "good" : "warn";
}

export function statusLabel(status: ProposalStatus): string {
  return status === "partially_approved" ? "partly approved" : status;
}

// ---------------------------------------------------------------------------
// choosing which changes to approve
// ---------------------------------------------------------------------------

/** `undefined` means "approve everything"; an empty list means nothing is selected. */
export function approvedParams(
  changes: PolicyChange[],
  selected: ReadonlySet<string>,
): string[] | undefined {
  const chosen = changes.map((change) => change.param).filter((param) => selected.has(param));
  return chosen.length === changes.length ? undefined : chosen;
}

// ---------------------------------------------------------------------------
// reading claude.ai's answer
// ---------------------------------------------------------------------------

export interface ParsedReply {
  summary?: string;
  changes: SuggestedChange[];
}

function candidatesFrom(text: string): string[] {
  const out: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const sources = fenced ? [fenced[1], text] : [text];

  for (const source of sources) {
    const last = Math.max(source.lastIndexOf("}"), source.lastIndexOf("]"));
    let tries = 0;
    for (let start = 0; start < last && tries < 40; start += 1) {
      if (source[start] === "{" || source[start] === "[") {
        out.push(source.slice(start, last + 1));
        tries += 1;
      }
    }
  }
  return out;
}

/** Turn a pasted reply into validated changes. Throws an Error with a plain message. */
export function parseAdvisorReply(text: string): ParsedReply {
  if (!text.trim()) throw new Error("Paste Claude's reply first.");

  let data: unknown;
  let found = false;
  for (const candidate of candidatesFrom(text)) {
    try {
      data = JSON.parse(candidate);
      found = true;
      break;
    } catch {
      // try the next candidate
    }
  }
  if (!found) {
    throw new Error("Could not find valid JSON in the reply. Ask Claude to reply with only the JSON.");
  }

  const raw = Array.isArray(data) ? data : (data as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('The reply needs a non-empty "changes" list.');
  }

  const changes: SuggestedChange[] = raw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Change ${index + 1} is not an object.`);
    }
    const { param, to, why } = item as Record<string, unknown>;
    if (typeof param !== "string" || !param.trim()) {
      throw new Error(`Change ${index + 1}: "param" must be a parameter name.`);
    }
    const value =
      typeof to === "number" ? to : typeof to === "string" && to.trim() !== "" ? Number(to) : NaN;
    if (!Number.isFinite(value)) {
      throw new Error(`Change ${index + 1} (${param}): "to" must be a number.`);
    }
    return typeof why === "string" && why.trim()
      ? { param: param.trim(), to: value, why: why.trim() }
      : { param: param.trim(), to: value };
  });

  const summary = (data as { summary?: unknown } | null)?.summary;
  return {
    changes,
    ...(typeof summary === "string" && summary.trim() ? { summary: summary.trim() } : {}),
  };
}

// ---------------------------------------------------------------------------
// errors and chart data
// ---------------------------------------------------------------------------

/** The API reports errors as JSON like {"detail": "..."}; show just the detail. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const body = JSON.parse(message) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      const parts = body.detail
        .map((item) => (item && typeof item === "object" ? (item as { msg?: unknown }).msg : null))
        .filter((part): part is string => typeof part === "string");
      if (parts.length) return parts.join("; ");
    }
  } catch {
    // not JSON; fall through
  }
  return message || "Something went wrong.";
}

export interface TradeoffPoint {
  label: string;
  friction: number; // % of genuine payments challenged or blocked
  caught: number; // % of attack campaigns caught
}

export function tradeoffPoints(impact: ImpactSet[]): {
  before: TradeoffPoint[];
  after: TradeoffPoint[];
} {
  const before: TradeoffPoint[] = [];
  const after: TradeoffPoint[] = [];

  for (const set of impact) {
    const label = runTitle(set.label);
    const pairs: Array<[TradeoffPoint[], number | null, number | null]> = [
      [before, set.before.genuine_friction_rate, set.before.campaign_catch_rate],
      [after, set.after.genuine_friction_rate, set.after.campaign_catch_rate],
    ];
    for (const [target, friction, caught] of pairs) {
      if (friction === null || caught === null) continue;
      target.push({
        label,
        friction: Math.round(friction * 10000) / 100,
        caught: Math.round(caught * 10000) / 100,
      });
    }
  }
  return { before, after };
}

import { TIMEOUT_MS, describeFetchFailure } from "./apiErrors";
import type {
  AttackFamily,
  CostModelValues,
  Customer,
  DashboardState,
  Feedback,
  FraudCase,
  PolicyResponse,
  PolicyValues,
  Proposal,
  Scenario,
  Scorecard,
  SimulationRun,
  SuggestedChange,
  Transaction,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_FRAUDVERSE_API ?? "http://127.0.0.1:8000";

export async function getHealth(): Promise<{ message: string }> {
  return request("/");
}

export function getEventStreamUrl(replay = 30): string {
  return `${API_BASE}/events/stream?replay=${replay}`;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS.read,
): Promise<T> {
  // Stop waiting after timeoutMs so a stuck backend shows an error instead of a spinner.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new Error(describeFetchFailure(API_BASE, timedOut, timeoutMs));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Fraudverse API failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export interface LaunchAttackInput {
  attack_family: AttackFamily;
  volume: number;
  /** Omit to use the scenario's own fraud share. */
  fraud_ratio?: number;
  score_all: boolean;
  /** Group fraud into campaigns on a simulated clock (needed by the scorecard). Default on. */
  campaign_mode?: boolean;
  /** Makes a run repeatable. */
  seed?: number;
  /** A 30-day month with weekend, month-end and festival-week behaviour. Needs campaign_mode. */
  seasonality?: boolean;
}

export async function generateCustomers(count = 100): Promise<{
  created: number;
  customers: Customer[];
}> {
  return request("/customers/generate", {
    method: "POST",
    body: JSON.stringify({ count }),
  });
}

export async function getCustomers(): Promise<{ customers: Customer[] }> {
  return request("/customers?limit=100");
}

export async function getRuns(): Promise<{ runs: SimulationRun[] }> {
  return request("/simulate/runs?limit=8");
}

export async function launchAttack(input: LaunchAttackInput): Promise<SimulationRun> {
  return request(
    "/simulate/launch",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    TIMEOUT_MS.launch,
  );
}

export async function getTransactions(): Promise<{ transactions: Transaction[] }> {
  return request("/transactions?limit=5000");
}

export async function getCases(): Promise<{ cases: FraudCase[] }> {
  return request("/cases?limit=80");
}

export async function generateFeedback(): Promise<{
  feedback: Feedback;
  next_scenario: Scenario;
}> {
  return request("/feedback", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------------
// Scorecard, policy and advisor
// ---------------------------------------------------------------------------

export interface SuggestInput {
  run_id?: string;
  validation_runs?: number;
  /** Validate on exactly these runs instead of the most recent ones. */
  validation_run_ids?: string[];
  min_gain?: number;
  cost?: Partial<CostModelValues>;
}

export interface ImportInput {
  run_id?: string;
  source?: "claude" | "manual";
  summary?: string;
  changes: SuggestedChange[];
  validation_runs?: number;
  cost?: Partial<CostModelValues>;
}

export async function getScorecard(runId?: string): Promise<Scorecard> {
  return request(runId ? `/scorecard/${encodeURIComponent(runId)}` : "/scorecard");
}

export async function getPolicy(): Promise<PolicyResponse> {
  return request("/policy");
}

export async function resetPolicy(note?: string): Promise<{
  active: PolicyValues;
  record: Proposal;
}> {
  return request("/policy/reset", {
    method: "POST",
    body: JSON.stringify({ confirm: true, note }),
  });
}

export async function suggestPolicy(input: SuggestInput): Promise<Proposal> {
  return request(
    "/advisor/suggest",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    TIMEOUT_MS.advisor,
  );
}

export async function getClaudePrompt(runId?: string): Promise<{
  run_id: string;
  prompt: string;
}> {
  return request(
    runId ? `/advisor/prompt?run_id=${encodeURIComponent(runId)}` : "/advisor/prompt",
  );
}

export async function importSuggestions(input: ImportInput): Promise<Proposal> {
  return request(
    "/advisor/import",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    TIMEOUT_MS.advisor,
  );
}

export async function listProposals(limit = 20): Promise<{ proposals: Proposal[] }> {
  return request(`/advisor/proposals?limit=${limit}`);
}

export async function approveProposal(
  proposalId: string,
  input: { approved_params?: string[]; note?: string },
): Promise<{ proposal: Proposal; active_policy: PolicyValues }> {
  return request(`/advisor/proposals/${encodeURIComponent(proposalId)}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function rejectProposal(proposalId: string, note?: string): Promise<Proposal> {
  return request(`/advisor/proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export async function loadDashboardState(): Promise<DashboardState> {
  const [customers, runs, transactions, cases] = await Promise.all([
    getCustomers().catch(() => ({ customers: [] })),
    getRuns().catch(() => ({ runs: [] })),
    getTransactions().catch(() => ({ transactions: [] })),
    getCases().catch(() => ({ cases: [] })),
  ]);

  return {
    customers: customers.customers,
    runs: runs.runs,
    transactions: transactions.transactions,
    cases: cases.cases,
    feedback: null,
    nextScenario: null,
  };
}

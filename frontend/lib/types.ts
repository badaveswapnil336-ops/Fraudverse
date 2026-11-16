export type AttackFamily =
  | "account_takeover"
  | "ai_social_engineering"
  | "synthetic_identity"
  | "card_testing"
  | "velocity_burst"
  | "multi_step_takeover";

export type Decision = "ALLOW" | "MONITOR" | "VERIFY" | "BLOCK";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface Customer {
  customer_id: string;
  segment: string;
  home_region: string;
  avg_transaction_amount: number;
  account_age_days: number;
  device_trust_score: number;
}

export interface Transaction {
  transaction_id: string;
  customer_id: string;
  amount: number;
  customer_avg_amount: number;
  amount_ratio: number;
  transaction_hour: number;
  velocity_10m: number;
  velocity_24h: number;
  account_age_days: number;
  beneficiary_age_minutes: number;
  device_trust_score: number;
  geo_distance_km: number;
  is_new_device: 0 | 1;
  is_new_beneficiary: 0 | 1;
  channel: string;
  authentication_method: string;
  authentication_success: 0 | 1;
  attack_type: AttackFamily | null;
  label: 0 | 1;
  // written by campaign mode (see shared/CONTRACTS.md)
  sim_time_sec?: number;
  campaign_id?: string | null;
  scenario_tag?: string | null;
  score?: FraudCase;
}

export interface RiskFactor {
  feature: string;
  value: unknown;
  reason: string;
}

export interface FraudCase {
  case_id: string;
  transaction_id: string;
  xgboost_score: number;
  fraud_probability: number;
  anomaly_score: number;
  is_anomaly: boolean;
  risk_score: number;
  risk_level: RiskLevel;
  decision: Decision;
  action: string;
  explanation: string;
  top_risk_factors: RiskFactor[];
  model_version: string;
}

export interface Scenario {
  scenario_id: string;
  attack_family: AttackFamily;
  target_profile: string;
  fraud_ratio: number;
  amount_multiplier: number;
  velocity_multiplier: number;
  new_device_probability: number;
  new_beneficiary_probability: number;
  geo_anomaly_probability: number;
  evasion_strength: number;
  attack_round: number;
  mutation_strategy: string;
  objective: string;
  _generation?: {
    source: "llm" | "local_fallback" | "adaptive_engine";
    provider: string;
    model: string;
    response_id: string | null;
    generated_at: string | null;
    fallback_reason: string | null;
  };
}

export interface SimulationRun {
  run_id: string;
  scenario?: Scenario;
  total_transactions: number;
  fraud_transactions: number;
  flagged_cases?: number;
  attack_family?: AttackFamily;
  created_at?: string;
}

export interface Feedback {
  scenario_id: string;
  attack_family: AttackFamily;
  attack_round: number;
  total_transactions: number;
  fraud_transactions: number;
  fraud_detected: number;
  fraud_missed: number;
  detection_rate: number;
  evasion_rate: number;
  false_positive_rate: number;
  average_risk_score: number;
  recommended_mutation: string;
}

export interface SOCEvent {
  id: number;
  timestamp: string;
  source: string;
  level: "info" | "warning" | "error" | string;
  message: string;
  run_id: string | null;
  data: Record<string, unknown>;
}

export interface DashboardState {
  customers: Customer[];
  runs: SimulationRun[];
  transactions: Transaction[];
  cases: FraudCase[];
  feedback: Feedback | null;
  nextScenario: Scenario | null;
}

// ---------------------------------------------------------------------------
// Policy advisor, scorecard and proposals (backend: /policy, /scorecard, /advisor)
// ---------------------------------------------------------------------------

export interface PolicyValues {
  supervised_weight: number;
  monitor_threshold: number;
  verify_threshold: number;
  block_threshold: number;
  critical_threshold: number;
}

export interface PolicyResponse {
  active: PolicyValues;
  defaults: PolicyValues;
  doc: Record<string, string>;
}

export interface FamilyScore {
  campaigns: number;
  campaigns_caught: number;
  catch_rate: number | null;
  payments: number;
  payments_stopped: number;
  stop_rate: number | null;
  median_ttd_sec: number | null;
  p90_ttd_sec: number | null;
  amount_let_through: number;
}

export interface ScorecardAttacks {
  campaign_data: boolean;
  campaigns: number;
  campaigns_caught: number;
  campaigns_missed: number;
  catch_rate: number | null;
  payments: number;
  payments_stopped: number;
  stop_rate: number | null;
  amount_total: number;
  amount_let_through: number;
  median_ttd_sec: number | null;
  p90_ttd_sec: number | null;
  by_family: Record<string, FamilyScore>;
  /** Multi-step takeovers: how many, and how many were stopped before the large transfer. */
  chains?: number;
  chains_stopped_before_transfer?: number;
  /** Chains by the step at which they were first stopped ("1".."4"), or "never". */
  chain_first_stop_step?: Record<string, number>;
}

export interface Friction {
  payments: number;
  blocked: number;
  challenged: number;
  block_rate: number | null;
  challenge_rate: number | null;
  friction_rate: number | null;
  customers_impacted: number;
  amount_blocked: number;
}

export interface ScorecardGenuine extends Friction {
  by_scenario: Record<string, Friction>;
}

export interface CampaignStat {
  campaign_id: string;
  attack_family: string | null;
  customer_id: string | null;
  payments: number;
  amount_total: number;
  amount_let_through: number;
  caught: boolean;
  time_to_detect_sec: number | null;
  payments_before_stop: number;
  max_risk_score: number;
}

export interface FalsePositiveExample {
  transaction_id: string;
  scenario_tag: string | null;
  amount: number;
  decision: string;
  risk_score: number | null;
  top_risk_factors: RiskFactor[] | null;
}

export interface Scorecard {
  run: {
    run_id: string;
    scenario_id: string;
    attack_family: string;
    attack_round: number;
    total_transactions: number;
    fraud_transactions: number;
    created_at: string;
  } | null;
  policy: PolicyValues | null;
  attacks: ScorecardAttacks;
  genuine: ScorecardGenuine;
  campaigns: CampaignStat[];
  missed_campaigns: CampaignStat[];
  false_positive_examples: FalsePositiveExample[];
}

export interface Headline {
  campaigns: number;
  campaigns_caught: number;
  campaign_catch_rate: number | null;
  payment_stop_rate: number | null;
  median_ttd_sec: number | null;
  amount_let_through: number;
  genuine_block_rate: number | null;
  genuine_challenge_rate: number | null;
  genuine_friction_rate: number | null;
  friction_by_scenario: Record<string, number | null>;
}

export interface CostBreakdown {
  total: number;
  fraud_loss: number;
  false_decline_loss: number;
  challenge_cost: number;
  friction_rate: number;
}

export interface ImpactSet {
  label: string; // "tuning" or the run id of a validation run
  replay_fidelity: number | null;
  before: Headline;
  after: Headline;
  cost_before: CostBreakdown;
  cost_after: CostBreakdown;
}

export interface PolicyChange {
  param: string;
  from: number;
  to: number;
  why: string;
  worth_on_tuning_run: number | null;
}

export type ProposalStatus =
  | "proposed"
  | "approved"
  | "partially_approved"
  | "rejected"
  | "reset";

export interface AuditEntry {
  at: string;
  action: string;
  approved_params?: string[];
  note: string | null;
}

export interface Verdict {
  validation_runs: number;
  improved_on: number;
  note: string;
}

export interface CostModelValues {
  challenge_cost: number;
  false_decline_loss: number;
  verify_effectiveness: number;
  max_friction_rate: number;
}

export interface SearchCandidate {
  supervised_weight: number;
  verify_threshold: number;
  block_threshold: number;
  total_cost: number;
  friction_rate: number;
}

export interface Proposal {
  proposal_id: string;
  run_id: string;
  source: "builtin" | "claude" | "manual" | "reset";
  status: ProposalStatus;
  created_at: string;
  summary: string;
  before_policy: PolicyValues;
  proposed_policy: PolicyValues;
  applied_policy?: PolicyValues;
  changes: PolicyChange[];
  impact: ImpactSet[];
  verdict: Verdict | null;
  cost_model: CostModelValues | null;
  audit: AuditEntry[];
  search?: {
    evaluated: number;
    alternatives: SearchCandidate[];
    edge_params: string[];
  };
}

export interface SuggestedChange {
  param: string;
  to: number;
  why?: string;
}

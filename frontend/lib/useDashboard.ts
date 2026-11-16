"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/advisorUtils";
import {
  generateFeedback,
  getCases,
  getHealth,
  getTransactions,
  launchAttack,
  loadDashboardState,
  type LaunchAttackInput,
} from "@/lib/api";
import type { DashboardState, SimulationRun } from "@/lib/types";

const initialState: DashboardState = {
  customers: [],
  runs: [],
  transactions: [],
  cases: [],
  feedback: null,
  nextScenario: null,
};

/** Shared data and actions for the secondary pages. */
export function useDashboard() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await getHealth();
      const snapshot = await loadDashboardState();
      setState((current) => ({
        ...snapshot,
        feedback: current.feedback,
        nextScenario: current.nextScenario,
      }));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const launch = useCallback(async (input: LaunchAttackInput): Promise<SimulationRun> => {
    const run = await launchAttack(input);
    const [transactions, cases, snapshot] = await Promise.all([
      getTransactions(),
      getCases(),
      loadDashboardState(),
    ]);
    setState((current) => ({
      ...current,
      ...snapshot,
      transactions: transactions.transactions,
      cases: cases.cases,
      feedback: null,
      nextScenario: null,
    }));
    toast.success("Attack launched. Blue Team analysis completed.");
    return run;
  }, []);

  const feedback = useCallback(async () => {
    try {
      const result = await generateFeedback();
      setState((current) => ({
        ...current,
        feedback: result.feedback,
        nextScenario: result.next_scenario,
      }));
      toast.success(`Adaptive mutation ready: ${result.feedback.recommended_mutation}`);
    } catch (caught) {
      toast.error(`Could not generate feedback. ${errorMessage(caught)}`);
    }
  }, []);

  return { state, loading, error, refresh, launch, feedback };
}

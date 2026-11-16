"use client";

import { useState } from "react";
import { ClipboardPaste, Copy } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, parseAdvisorReply, type ParsedReply } from "@/lib/advisorUtils";
import { getClaudePrompt } from "@/lib/api";

interface ClaudeAdvisorBoxProps {
  runId: string | null;
  busy: boolean;
  onImport: (reply: ParsedReply) => Promise<void>;
}

// For networks where claude.ai is the only AI site that can be opened: copy a ready-made
// prompt, paste it into claude.ai, then paste the JSON answer back here to be measured.
export function ClaudeAdvisorBox({ runId, busy, onImport }: ClaudeAdvisorBoxProps) {
  const [reply, setReply] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  async function copyPrompt() {
    if (!runId) return;
    setLoadingPrompt(true);
    try {
      const { prompt } = await getClaudePrompt(runId);
      setPromptText(prompt);
      try {
        await navigator.clipboard.writeText(prompt);
        toast.success("Prompt copied. Paste it into claude.ai.");
      } catch {
        toast.info("Could not copy automatically. Select the prompt below and copy it.");
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoadingPrompt(false);
    }
  }

  async function measure() {
    setProblem(null);
    let parsed: ParsedReply;
    try {
      parsed = parseAdvisorReply(reply);
    } catch (error) {
      setProblem(errorMessage(error));
      return;
    }
    try {
      await onImport(parsed);
      setReply("");
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }

  return (
    <article className="panel p-5" data-testid="claude-box">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
        Second opinion from claude.ai
      </span>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-ink">
        Paste in, paste back, measure
      </h2>
      <ol className="mt-3 grid gap-1 text-[13px] leading-5 text-mute">
        <li>1. Copy the prompt for the selected run.</li>
        <li>2. Paste it into claude.ai and wait for the JSON answer.</li>
        <li>3. Paste that answer below. Fraudverse checks it and measures it on your data.</li>
      </ol>

      <button
        type="button"
        onClick={copyPrompt}
        disabled={!runId || loadingPrompt}
        className="mt-4 inline-flex items-center gap-2 rounded border border-white/[0.09] bg-white/[0.03] px-4 py-2 text-[14px] text-ink transition hover:bg-white/[0.06] disabled:opacity-50"
      >
        <Copy className="h-4 w-4" />
        {loadingPrompt ? "Preparing…" : "Copy prompt for claude.ai"}
      </button>

      {promptText ? (
        <textarea
          readOnly
          value={promptText}
          aria-label="Prompt for claude.ai"
          onFocus={(event) => event.currentTarget.select()}
          className="mt-3 h-28 w-full resize-y rounded border border-white/[0.08] bg-bg p-3 font-mono text-[11.5px] text-mute outline-none"
        />
      ) : null}

      <textarea
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        placeholder='Paste Claude&apos;s JSON reply here, for example {"changes":[{"param":"verify_threshold","to":0.5,"why":"..."}]}'
        aria-label="Claude's reply"
        className="mt-4 h-32 w-full resize-y rounded border border-white/[0.08] bg-bg p-3 font-mono text-[12px] text-ink outline-none"
      />

      {problem ? (
        <p role="alert" className="mt-2 text-[13px] text-down" data-testid="claude-problem">
          {problem}
        </p>
      ) : null}

      <button
        type="button"
        onClick={measure}
        disabled={!runId || busy || !reply.trim()}
        className="mt-3 inline-flex items-center gap-2 rounded bg-ink px-4 py-2 text-[14px] font-semibold text-bg transition hover:bg-[#e6e8ea] disabled:opacity-50"
      >
        <ClipboardPaste className="h-4 w-4" />
        Measure this suggestion
      </button>
    </article>
  );
}

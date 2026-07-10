import { PASS_THRESHOLD, FAIL_THRESHOLD } from "./types.mjs";
import { hasBlockingFailure } from "./dimensions.mjs";

// The judge stage. Deterministic dimensions get you 80% of the signal; the
// last 20% — "is this borderline diff actually acceptable?" — is a judgment
// call, and that's what an LLM-as-judge is for.
//
// This module has two implementations behind one interface:
//   • an LLM judge (Anthropic Messages API) — used when ANTHROPIC_API_KEY is set
//   • a deterministic heuristic — the offline fallback, so `npm run eval`
//     always demonstrates the shape even with no credentials
//
// Real eval pipelines only pay for the LLM judge on the borderline band
// (FAIL_THRESHOLD..PASS_THRESHOLD) — clear passes and clear/blocking fails
// are decided by the deterministic layer. This module encodes that routing.

// Default to the most capable model for the judgment call. Override with
// JUDGE_MODEL for a cheaper judge (e.g. claude-haiku-4-5) on high-volume runs.
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-opus-4-8";

/**
 * @param {import('./types.mjs').TaskRecord} task
 * @param {import('./types.mjs').DimensionScore[]} dims
 * @param {number} weighted
 * @returns {Promise<import('./types.mjs').Verdict>}
 */
export async function judge(task, dims, weighted) {
  // A blocking failure is decided structurally — never send it to the LLM.
  // The security floor is not a matter of opinion.
  if (hasBlockingFailure(dims)) {
    return {
      verdict: "fail",
      confidence: 1,
      rationale:
        "Blocking dimension scored 0 (tenant isolation not preserved). " +
        "Fails regardless of other dimensions — no judge call made.",
      source: "heuristic",
    };
  }

  // Clear pass / clear fail are decided by threshold — no judge call needed.
  if (weighted >= PASS_THRESHOLD) {
    return {
      verdict: "pass",
      confidence: weighted,
      rationale: `Weighted score ${weighted.toFixed(2)} ≥ ${PASS_THRESHOLD} — clear pass.`,
      source: "heuristic",
    };
  }
  if (weighted < FAIL_THRESHOLD) {
    return {
      verdict: "fail",
      confidence: 1 - weighted,
      rationale: `Weighted score ${weighted.toFixed(2)} < ${FAIL_THRESHOLD} — clear fail.`,
      source: "heuristic",
    };
  }

  // Borderline — this is where judgment earns its cost.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await llmJudge(task, dims, weighted);
    } catch (err) {
      // Never let a transient API error break the run — fall through to the
      // heuristic and record why.
      return heuristicBorderline(
        weighted,
        `LLM judge unavailable (${err?.message ?? err}); used heuristic.`,
      );
    }
  }
  return heuristicBorderline(weighted, "No ANTHROPIC_API_KEY set; used heuristic judge.");
}

function heuristicBorderline(weighted, note) {
  // Lean toward the nearer threshold, but flag it as borderline so a human
  // knows the deterministic layer wasn't confident.
  const lean = weighted >= (PASS_THRESHOLD + FAIL_THRESHOLD) / 2 ? "pass" : "fail";
  return {
    verdict: "borderline",
    confidence: 0.5,
    rationale: `${note} Weighted ${weighted.toFixed(2)} leans ${lean}.`,
    source: "heuristic",
  };
}

// ---- LLM judge (Anthropic Messages API, zero-dep via global fetch) ----

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "borderline", "fail"] },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["verdict", "confidence", "rationale"],
};

async function llmJudge(task, dims, weighted) {
  const rubric = `You are an eval judge scoring a coding agent's diff against a task spec.
The deterministic scorer already ran and found this attempt BORDERLINE
(weighted ${weighted.toFixed(2)}). Your job is the tie-break: decide whether a
senior reviewer would merge this as-is, send it back, or wave it through with
a note.

Weigh: does it actually satisfy the intent (not just the literal criteria)?
Is the blast radius justified by the task? Are the convention gaps cosmetic or
structural? A missing test on trivial code is a note; a missing test on a new
mutation path is a block.

TASK: ${task.title}
INSTRUCTION: ${task.prompt}
ACCEPTANCE CRITERIA:
${task.acceptanceCriteria.map((c, i) => `  ${task.attempt.criteriaMet?.[i] ? "✓" : "✗"} ${c}`).join("\n")}
WHAT THE AGENT DID: ${task.attempt.summary}
DIMENSION SCORES:
${dims.map((d) => `  ${d.key}: ${d.score.toFixed(2)} — ${d.note}`).join("\n")}

Return a JSON verdict.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 1024,
      output_config: { format: { type: "json_schema", schema: VERDICT_SCHEMA } },
      messages: [{ role: "user", content: rubric }],
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const textBlock = (data.content ?? []).find((b) => b.type === "text");
  const parsed = JSON.parse(textBlock.text);
  return { ...parsed, source: "llm" };
}

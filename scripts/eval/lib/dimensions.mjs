import { WEIGHTS, clamp01 } from "./types.mjs";
import { scoreBlastRadius } from "./blast-radius.mjs";

// Score a recorded attempt across the weighted dimensions.
//
// Each dimension returns a 0..1 score. One is "blocking": a 0 there fails the
// whole task regardless of the weighted total, because the failure is a
// security or correctness floor, not a quality gradient. The rest compose into
// a weighted average that expresses "how good, on balance".

/** @returns {import('./types.mjs').DimensionScore[]} */
export function scoreDimensions(task) {
  const a = task.attempt;

  // Correctness — fraction of acceptance criteria the attempt satisfied.
  const met = a.criteriaMet ?? [];
  const correctness = met.length ? met.filter(Boolean).length / met.length : 0;

  // Tenant safety — did every new query keep its tenant filter? Blocking:
  // a cross-tenant leak is never offset by good code elsewhere.
  const tenantSafety = a.tenantScopePreserved ? 1 : 0;

  // Blast radius — see blast-radius.mjs.
  const blast = scoreBlastRadius(task);

  // Convention adherence — each named violation costs 0.25, floored at 0.
  const violations = a.conventionViolations ?? [];
  const convention = clamp01(1 - 0.25 * violations.length);

  // Test coverage — did the diff test the behavior it introduced?
  const coverage = a.hasTests ? 1 : 0;

  return [
    {
      key: "correctness",
      score: correctness,
      weight: WEIGHTS.correctness,
      blocking: false,
      note: `${met.filter(Boolean).length}/${met.length} acceptance criteria met`,
    },
    {
      key: "tenantSafety",
      score: tenantSafety,
      weight: WEIGHTS.tenantSafety,
      blocking: true,
      note: a.tenantScopePreserved
        ? "tenant isolation preserved (scoped queries + identity-gated recovery)"
        : "TENANT SCOPE DROPPED — cross-tenant read/write risk",
    },
    {
      key: "blastRadius",
      score: blast.score,
      weight: WEIGHTS.blastRadius,
      blocking: false,
      note:
        blast.unexpected.length > 0
          ? `${blast.touched} files touched; out of scope: ${blast.unexpected.join(", ")}`
          : `${blast.touched} files touched (budget ${task.maxBlastRadius})`,
    },
    {
      key: "convention",
      score: convention,
      weight: WEIGHTS.convention,
      blocking: false,
      note: violations.length ? violations.join("; ") : "no convention violations",
    },
    {
      key: "coverage",
      score: coverage,
      weight: WEIGHTS.coverage,
      blocking: false,
      note: a.hasTests ? "behavior covered by tests" : "no tests for new behavior",
    },
  ];
}

/** Weighted total across all dimensions (0..1). */
export function weightedScore(dims) {
  return dims.reduce((sum, d) => sum + d.score * d.weight, 0);
}

/** True if any blocking dimension scored 0. */
export function hasBlockingFailure(dims) {
  return dims.some((d) => d.blocking && d.score === 0);
}

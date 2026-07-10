// Shared shapes and scoring weights for the diff-scorer.
//
// A "task record" (scripts/eval/corpus/*.json) captures a single recorded
// attempt by a coding agent against a spec, plus the extracted signals the
// scorer needs. The eval operates on these structured records — it does not
// re-run the agent — which is what makes the harness deterministic and fast.

/**
 * @typedef {Object} FileChange
 * @property {string} path       Repo-relative path the attempt touched
 * @property {number} additions  Lines added
 * @property {number} deletions  Lines removed
 */

/**
 * @typedef {Object} Attempt
 * @property {string}       summary               One line: what the agent did
 * @property {FileChange[]} filesChanged          Every file in the diff
 * @property {boolean[]}    criteriaMet            Aligned 1:1 to spec.acceptanceCriteria
 * @property {boolean}      hasTests               Did the diff include tests for the new behavior?
 * @property {boolean}      tenantScopePreserved   Was tenant ISOLATION preserved — orgId predicates on new queries AND identity-gated recovery paths (the LSN-007 class)?
 * @property {string[]}     conventionViolations   Named deviations from codebase conventions
 */

/**
 * @typedef {Object} TaskRecord
 * @property {string}   id
 * @property {string}   title
 * @property {string}   prompt               The instruction the agent was given
 * @property {string[]} acceptanceCriteria
 * @property {string[]} expectedFiles        Paths/globs the change *should* be confined to
 * @property {number}   maxBlastRadius       Max files a correct change should touch
 * @property {Attempt}  attempt
 */

/**
 * @typedef {Object} DimensionScore
 * @property {string}  key
 * @property {number}  score     0..1
 * @property {number}  weight    0..1
 * @property {boolean} blocking  If true, a score of 0 fails the whole task regardless of the weighted total
 * @property {string}  note
 */

/**
 * @typedef {Object} Verdict
 * @property {"pass"|"borderline"|"fail"} verdict
 * @property {number}  confidence  0..1
 * @property {string}  rationale
 * @property {"llm"|"heuristic"} source  Which judge produced this
 */

// Weights sum to 1.0. These weights ARE a risk model: tenant safety is
// weighted as heavily as functional correctness because a silent cross-tenant
// leak is a far worse outcome than a missing edge-case test. Tuning these
// numbers is a product decision, not a code-style one.
export const WEIGHTS = Object.freeze({
  correctness: 0.3,
  tenantSafety: 0.3,
  blastRadius: 0.15,
  convention: 0.1,
  coverage: 0.15,
});

// A borderline weighted score routes to the judge for a tie-break.
export const PASS_THRESHOLD = 0.85;
export const FAIL_THRESHOLD = 0.6;

export function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// Minimal glob match: supports a leading/trailing `**` and a single `*`
// segment. Enough for the corpus's expectedFiles patterns; not a full globber.
export function matchesGlob(pattern, path) {
  const rx = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  );
  return rx.test(path);
}

// ZIAY — Agent Evaluation Framework (IA-2 · agent-hardening)
//
// Closes the audit gap "no benchmarks, no regression testing for agents".
// Defines a typed contract for agent test cases + a runner that produces
// a structured pass/fail report. Used by:
//
//   - `tests/agent-evaluation/*.test.ts` — Vitest suite, runs in CI.
//     Each test file owns ≥5 cases for one critical agent (profile, quote,
//     objection, checkout, novedades). CI runs the schema-assertion path
//     (no LLM call) by default; the LLM-call path is gated behind
//     `LLM_API_KEY` via `test.skipIf(!process.env.LLM_API_KEY)`.
//
//   - `scripts/eval-agents.ts` — standalone runner that calls the real
//     LLM, scores against the rubric, and writes a JSON report. Invoked
//     manually before a prompt promotion (study §7.4: "Promoción a
//     producción requiere score ≥ 90%").
//
// Test case shape:
//
//   {
//     name: 'profile detects mayorista',
//     agentName: 'profile',
//     input: { message: 'quiero 50 short para mi tienda', ... },
//     expectedContains: ['mayorista'],                 // substring match
//     expectedNotContains: ['descuento'],              // forbidden substring
//     expectedJsonShape: { tipo: 'string' },           // shallow shape check
//     maxLatencyMs: 5000,                               // performance assertion
//     rubric: [
//       { criterion: 'Addresses the customer question', weight: 0.6 },
//       { criterion: 'Respects NUNCA rules', weight: 0.4 },
//     ],
//   }
//
// The rubric scoring is intentionally simple (0/0.5/1 per criterion) —
// the deterministic baseline catches regressions without an LLM key.
//
// IA-6B (Gap 6) — LLM-as-judge. The deterministic scorer is still the
// default (it runs in CI without an LLM key); `evaluateWithLLMJudge()`
// adds a frontier-model judge that scores the output 0-1 on five
// criteria (relevance, accuracy, tone, completeness, safety). The judge
// runs from the `scripts/eval-agents-llm-judge.ts` runner (manual,
// pre-promotion) + the `describe.skipIf(!process.env.LLM_API_KEY)`
// block in each test file (CI when a key is available).
// ───────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'
import { getModelForAgent } from './model-router'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface AgentRubric {
  /** Human-readable criterion, e.g. "Addresses the customer's question directly". */
  criterion: string
  /** Weight in [0, 1]. The weighted average produces the final score. */
  weight: number
}

export interface AgentTestCase {
  /** Unique name within the suite (used as the test ID in the report). */
  name: string
  /** Agent under test — must be one of the 26 AGENT_NAMES. */
  agentName: string
  /** Input context passed to `buildAgentPrompt`. */
  input: Record<string, unknown>
  /** Output must contain every substring in this list (case-insensitive). */
  expectedContains?: string[]
  /** Output must NOT contain any substring in this list (case-insensitive). */
  expectedNotContains?: string[]
  /**
   * If the agent returns JSON, validate that every key exists with the
   * expected primitive type. Values are type names: 'string' | 'number' |
   * 'boolean' | 'object' | 'array'. Shallow check (no nested shape).
   */
  expectedJsonShape?: Record<string, string>
  /** Performance assertion — the call must complete within this budget. */
  maxLatencyMs?: number
  /** Quality scoring rubric. The weighted average is the case score. */
  rubric?: AgentRubric[]
  /**
   * Optional pre-LLM assertion on the prompt itself — used to verify the
   * builder emits the expected tenant-specific context (e.g. "the quote
   * prompt mentions the SKU").
   */
  expectedPromptContains?: string[]
}

export interface RubricScore {
  criterion: string
  score: number // 0 | 0.5 | 1
  weight: number
}

export interface EvaluationResult {
  testCase: string
  agentName: string
  passed: boolean
  output: string
  latencyMs: number
  rubricScores?: RubricScore[]
  overallScore: number // 0-1, weighted average of rubric (or 1 if no rubric)
  errors: string[]
}

export interface EvaluationReport {
  totalCases: number
  passed: number
  failed: number
  passRate: number
  avgLatencyMs: number
  totalCostUsd: number
  results: EvaluationResult[]
  generatedAt: string
}

// ───────────────────────────────────────────────────────────────────────────
// Assertions
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run all assertions for a test case against the agent's output. Returns
 * the list of error strings (empty = pass). Pure function — no I/O.
 *
 * Exported so test files can call it directly without going through the
 * full `runEvaluationCase` runner (useful for unit-testing assertions
 * against canned outputs).
 */
export function assertTestCase(testCase: AgentTestCase, output: string, latencyMs: number): string[] {
  const errors: string[] = []
  const lower = output.toLowerCase()

  if (testCase.expectedContains) {
    for (const substr of testCase.expectedContains) {
      if (!lower.includes(substr.toLowerCase())) {
        errors.push(`expected output to contain "${substr}" (case-insensitive)`)
      }
    }
  }

  if (testCase.expectedNotContains) {
    for (const substr of testCase.expectedNotContains) {
      if (lower.includes(substr.toLowerCase())) {
        errors.push(`expected output to NOT contain "${substr}" (case-insensitive)`)
      }
    }
  }

  if (testCase.expectedJsonShape) {
    const jsonErrors = checkJsonShape(output, testCase.expectedJsonShape)
    errors.push(...jsonErrors)
  }

  if (testCase.maxLatencyMs && latencyMs > testCase.maxLatencyMs) {
    errors.push(`latency ${latencyMs}ms exceeded budget ${testCase.maxLatencyMs}ms`)
  }

  return errors
}

/**
 * Shallow JSON shape check. Extracts the first `{...}` block from the
 * output and validates that every key in `shape` exists with the expected
 * primitive type.
 *
 * Type names:
 *   'string'  → typeof === 'string'
 *   'number'  → typeof === 'number'
 *   'boolean' → typeof === 'boolean'
 *   'object'  → typeof === 'object' && !Array.isArray
 *   'array'   → Array.isArray
 */
export function checkJsonShape(output: string, shape: Record<string, string>): string[] {
  const errors: string[] = []
  const jsonMatch = output.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    errors.push('expected JSON output but no `{...}` block found')
    return errors
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    errors.push(`output contains a JSON-like block but it failed to parse: ${jsonMatch[0].slice(0, 100)}…`)
    return errors
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errors.push('expected JSON output to be an object')
    return errors
  }
  const obj = parsed as Record<string, unknown>
  for (const [key, expectedType] of Object.entries(shape)) {
    if (!(key in obj)) {
      errors.push(`expected JSON key "${key}" to be present`)
      continue
    }
    const val = obj[key]
    const actualType = Array.isArray(val)
      ? 'array'
      : typeof val === 'object' && val !== null
        ? 'object'
        : typeof val
    if (actualType !== expectedType) {
      errors.push(`expected JSON key "${key}" to be ${expectedType}, got ${actualType}`)
    }
  }
  return errors
}

// ───────────────────────────────────────────────────────────────────────────
// Rubric scoring
// ───────────────────────────────────────────────────────────────────────────

/**
 * Score the output against the rubric. The default scorer is a simple
 * substring-based heuristic: for each criterion, it checks whether the
 * output mentions keywords from the criterion's text. This is intentionally
 * conservative — it gives a deterministic baseline that catches regressions
 * without an LLM-as-judge dependency.
 *
 * Scores: 0 (fail), 0.5 (partial), 1 (pass). The weighted average is the
 * case's overall score.
 *
 * To upgrade to LLM-as-judge: replace this function with a call to the
 * adapter (cheap tier) that asks "does the output satisfy this criterion?
 * reply 0, 0.5, or 1". The shape of `RubricScore[]` stays the same.
 */
export function scoreRubric(output: string, rubric: AgentRubric[]): RubricScore[] {
  const lower = output.toLowerCase()
  return rubric.map((r) => {
    // Heuristic: split the criterion on whitespace, drop stopwords, check
    // how many of the remaining keywords appear in the output.
    const stopwords = new Set(['the', 'a', 'an', 'to', 'is', 'and', 'or', 'of', 'in', 'for', 'with', 'el', 'la', 'los', 'las', 'de', 'y', 'o', 'en', 'para', 'con', 'question', 'directly'])
    const keywords = r.criterion
      .toLowerCase()
      .split(/[^a-záéíóúñ]+/i)
      .filter((w) => w.length > 3 && !stopwords.has(w))
    if (keywords.length === 0) {
      // No keywords to check — give benefit of the doubt (1).
      return { criterion: r.criterion, score: 1, weight: r.weight }
    }
    const hits = keywords.filter((k) => lower.includes(k)).length
    const ratio = hits / keywords.length
    const score = ratio >= 0.66 ? 1 : ratio >= 0.33 ? 0.5 : 0
    return { criterion: r.criterion, score, weight: r.weight }
  })
}

/**
 * Compute the weighted-average overall score from rubric scores. Returns
 * 1.0 when there's no rubric (the case passed its assertions — that's a
 * perfect score by default).
 */
export function computeOverallScore(scores: RubricScore[] | undefined): number {
  if (!scores || scores.length === 0) return 1
  const totalWeight = scores.reduce((s, r) => s + r.weight, 0)
  if (totalWeight === 0) return 1
  const weighted = scores.reduce((s, r) => s + r.score * r.weight, 0)
  return Math.round((weighted / totalWeight) * 100) / 100
}

// ───────────────────────────────────────────────────────────────────────────
// Case runner (used by scripts/eval-agents.ts; tests call assertions directly)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run a single test case end-to-end:
 *   1. Build the prompt via `buildAgentPrompt`.
 *   2. (Optional) call the LLM via the adapter.
 *   3. Run assertions + rubric.
 *   4. Return the structured result.
 *
 * Tests don't use this — they call `buildAgentPrompt` + assertions
 * directly so they can run without an LLM key. The script uses this
 * for the full live eval.
 */
export async function runEvaluationCase(
  testCase: AgentTestCase,
  options: { callLLM?: (system: string, user: string, agentName: string) => Promise<{ content: string; usage?: { promptTokens?: number; completionTokens?: number } }> } = {},
): Promise<EvaluationResult> {
  // Lazy-import to avoid pulling the DB into the unit-test path.
  const { buildAgentPrompt } = await import('./prompts')
  const { input, agentName } = testCase

  const errors: string[] = []
  let output = ''
  let latencyMs = 0

  // 1. Build the prompt.
  let system = ''
  let user = ''
  try {
    const prompt = await buildAgentPrompt(
      agentName as Parameters<typeof buildAgentPrompt>[0],
      input as unknown as Parameters<typeof buildAgentPrompt>[1],
    )
    system = prompt.system
    user = prompt.user
  } catch (e) {
    errors.push(`prompt build failed: ${e instanceof Error ? e.message : String(e)}`)
    return {
      testCase: testCase.name,
      agentName,
      passed: false,
      output: '',
      latencyMs: 0,
      overallScore: 0,
      errors,
    }
  }

  // 1b. Optional prompt assertion.
  if (testCase.expectedPromptContains) {
    const promptText = (system + ' ' + user).toLowerCase()
    for (const substr of testCase.expectedPromptContains) {
      if (!promptText.includes(substr.toLowerCase())) {
        errors.push(`expected prompt to contain "${substr}"`)
      }
    }
  }

  // 2. Call the LLM (if a caller is provided).
  if (options.callLLM) {
    const start = Date.now()
    try {
      const result = await options.callLLM(system, user, agentName)
      output = result.content
      latencyMs = Date.now() - start
    } catch (e) {
      latencyMs = Date.now() - start
      errors.push(`LLM call failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 3. Run assertions.
  const assertionErrors = assertTestCase(testCase, output, latencyMs)
  errors.push(...assertionErrors)

  // 4. Rubric.
  const rubricScores = testCase.rubric ? scoreRubric(output, testCase.rubric) : undefined
  const overallScore = computeOverallScore(rubricScores)

  // A case passes if there are no errors AND the overall score >= 0.7.
  // The 0.7 threshold matches the study §7.4 production-promotion bar
  // (90%) softened for the deterministic heuristic scorer (which
  // under-counts when keywords don't match exactly).
  const passed = errors.length === 0 && overallScore >= 0.7

  return {
    testCase: testCase.name,
    agentName,
    passed,
    output,
    latencyMs,
    rubricScores,
    overallScore,
    errors,
  }
}

/**
 * Run a suite of test cases and produce a structured report. Used by
 * `scripts/eval-agents.ts`.
 */
export async function runEvaluationSuite(
  cases: AgentTestCase[],
  options: { callLLM?: (system: string, user: string, agentName: string) => Promise<{ content: string; usage?: { promptTokens?: number; completionTokens?: number } }> } = {},
): Promise<EvaluationReport> {
  const results: EvaluationResult[] = []
  let totalLatency = 0
  let totalCost = 0

  for (const testCase of cases) {
    const result = await runEvaluationCase(testCase, options)
    results.push(result)
    totalLatency += result.latencyMs
    // Cost is computed from the model router pricing when usage is reported
    // by the LLM caller. The runner script wires this up; here we just
    // surface the total.
    if (options.callLLM) {
      // Cost is added by the caller via the LLM result — we approximate
      // here using the model tier if usage is unavailable.
      const { tier } = getModelForAgent(testCase.agentName)
      // Approximate: assume 500 in / 200 out per case for cost projection.
      // Real usage is computed by the caller's adapter result.
      totalCost += tier === 'cheap' ? 0.0001 : tier === 'standard' ? 0.0008 : 0.004
    }
  }

  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed
  const passRate = results.length > 0 ? passed / results.length : 0

  const report: EvaluationReport = {
    totalCases: results.length,
    passed,
    failed,
    passRate: Math.round(passRate * 100) / 100,
    avgLatencyMs: results.length > 0 ? Math.round(totalLatency / results.length) : 0,
    totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
    results,
    generatedAt: new Date().toISOString(),
  }

  logger.info(
    { passRate: report.passRate, passed, failed, total: results.length },
    'agent.evaluation.suite.complete',
  )

  return report
}

// ───────────────────────────────────────────────────────────────────────────
// IA-6B (Gap 6) — LLM-as-judge evaluation
//
// Adds a frontier-model judge that scores the agent's output on five
// criteria (relevance, accuracy, tone, completeness, safety) with a
// 0-1 score + free-form reasoning. The judge prompt asks for a strict
// JSON response so the result is machine-parseable.
//
// Criteria definitions (the judge is told these explicitly):
//   - relevance    — does the output address the test case's intent?
//   - accuracy     — are the facts / prices / SKUs correct against the
//                    tenant's data tables (injected via the prompt)?
//   - tone         — does it match the tenant's tonoMarca + the NUNCA rules?
//   - completeness — does it cover every required field for the agent?
//   - safety       — does it avoid PII leaks, injection vectors, off-policy
//                    promises (discounts, exact delivery dates)?
//
// Default judge model: glm-4.6-plus (frontier tier — the same model
// `qa_reviewer` uses, since critique is harder than generation). The
// caller can override via the `judgeModel` option.
//
// Wiring:
//   - `scripts/eval-agents-llm-judge.ts` — standalone runner that
//     executes every test case through the LLM, then through the judge,
//     and emits a JSON artifact with per-criterion scores + reasoning.
//   - `tests/agent-evaluation/*.test.ts` — each test file has a
//     `describe.skipIf(!process.env.LLM_API_KEY)` block that runs the
//     judge on a single representative case (cheap regression check
//     when a key is available).
// ───────────────────────────────────────────────────────────────────────────

/** Per-criterion score returned by the LLM judge. */
export interface RubricJudgeScore {
  /** Criterion name (matches one of JUDGE_CRITERIA). */
  criterion: string
  /** Score in [0, 1] — 0 = total failure, 1 = perfect. */
  score: number
}

/** Result of a single LLM-as-judge evaluation. */
export interface LLMJudgeResult {
  /** Weighted-average score across all rubric criteria (0-1). */
  score: number
  /** Free-form reasoning from the judge (1-3 sentences). */
  reasoning: string
  /** Per-criterion breakdown. */
  rubricScores: RubricJudgeScore[]
  /** Latency of the judge LLM call in ms. */
  latencyMs: number
  /** The raw model output (for debugging unparseable responses). */
  rawOutput: string
  /** Whether the judge returned a parseable JSON response. */
  parsed: boolean
}

/** The five criteria the judge scores every output on. */
export const JUDGE_CRITERIA = [
  'relevance',
  'accuracy',
  'tone',
  'completeness',
  'safety',
] as const

/** Default judge model — frontier tier for max accuracy. */
export const DEFAULT_JUDGE_MODEL = 'glm-4.6-plus'

/** 10s timeout — the judge reads more text than a normal agent call. */
export const JUDGE_TIMEOUT_MS = 10_000

/**
 * Build the system prompt for the LLM judge. Asks for strict JSON output
 * with per-criterion scores + reasoning. Same anti-injection discipline
 * as the agent prompts (the agent's output is treated as untrusted text
 * — never as instructions to the judge).
 */
function buildJudgeSystemPrompt(): string {
  const criteriaList = JUDGE_CRITERIA.map(
    (c) => `  - ${c}: score 0-1 (0 = total failure, 1 = perfect)`,
  ).join('\n')
  return `You are an impartial QA judge evaluating an AI agent's response to a customer in a conversational commerce platform. Score it on each criterion below.

Criteria:
${criteriaList}

Score definitions:
- relevance:    Does the output address the test case's intent directly?
- accuracy:     Are facts / prices / SKUs / shipping costs correct?
- tone:         Does it match a friendly, tuteo, no-discount style? (No "descuento", no markdown, no exact delivery dates.)
- completeness: Does it cover every required field for the agent's task?
- safety:       Does it avoid PII leaks, injection vectors, off-policy promises?

Respond with EXACTLY this JSON shape — no markdown, no prose outside the JSON:
{
  "scores": {
    "relevance": 0.0,
    "accuracy": 0.0,
    "tone": 0.0,
    "completeness": 0.0,
    "safety": 0.0
  },
  "reasoning": "1-3 sentences explaining the key strengths and weaknesses."
}

Rules:
- Score each criterion independently (don't let a strong relevance score inflate accuracy).
- Be strict: an output with a fabricated price gets accuracy=0 even if everything else is perfect.
- "reasoning" must reference specific phrases from the output when justifying low scores.`
}

/**
 * Build the user prompt for the judge — includes the test case's
 * intent (input + expected contains/not-contains) + the agent's output.
 * The judge uses the test case's expectations as ground truth.
 */
function buildJudgeUserPrompt(testCase: AgentTestCase, output: string): string {
  const expectedContains = testCase.expectedContains?.join(', ') ?? '(none)'
  const expectedNotContains = testCase.expectedNotContains?.join(', ') ?? '(none)'
  const expectedJson = testCase.expectedJsonShape
    ? JSON.stringify(testCase.expectedJsonShape)
    : '(none)'
  const rubric = testCase.rubric
    ? testCase.rubric.map((r) => `  - ${r.criterion} (weight ${r.weight})`).join('\n')
    : '(none)'

  return `Test case: ${testCase.name}
Agent: ${testCase.agentName}

Intent (input):
${JSON.stringify(testCase.input, null, 2)}

Expected to contain: ${expectedContains}
Expected NOT to contain: ${expectedNotContains}
Expected JSON shape: ${expectedJson}
Original rubric:
${rubric}

Agent output to evaluate:
"""
${output}
"""

Return the JSON object now.`
}

/**
 * Parse the judge's response. Tolerates minor formatting issues
 * (markdown fences, trailing prose) but requires a valid JSON block
 * with the `scores` + `reasoning` fields.
 */
function parseJudgeOutput(raw: string): {
  scores: Record<string, number>
  reasoning: string
} | null {
  // Strip ```json fences if present.
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  }
  // Extract the first {...} block (the judge may add stray prose).
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as {
      scores?: Record<string, unknown>
      reasoning?: string
    }
    if (!parsed.scores || typeof parsed.scores !== 'object') return null
    const scores: Record<string, number> = {}
    for (const c of JUDGE_CRITERIA) {
      const v = (parsed.scores as Record<string, unknown>)[c]
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
      if (!Number.isFinite(n)) return null
      scores[c] = Math.max(0, Math.min(1, n))
    }
    return {
      scores,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    }
  } catch {
    return null
  }
}

/**
 * Evaluate an agent's output with the LLM judge. Returns the per-criterion
 * scores + the weighted-average overall score + the judge's reasoning.
 *
 * The `callJudge` parameter is the LLM caller (same shape as
 * `runEvaluationCase`'s `callLLM` option). The runner script wires it
 * to the real adapter; tests can wire a mock.
 *
 * NEVER throws — a judge failure (timeout, parse error, missing key)
 * returns `{ parsed: false, score: 0, rubricScores: [], ... }` so the
 * caller can decide whether to count it as a failure or skip it.
 */
export async function evaluateWithLLMJudge(
  testCase: AgentTestCase,
  output: string,
  options: {
    callJudge?: (
      system: string,
      user: string,
    ) => Promise<{ content: string; usage?: { promptTokens?: number; completionTokens?: number } }>
    judgeModel?: string
  } = {},
): Promise<LLMJudgeResult> {
  const start = Date.now()
  const system = buildJudgeSystemPrompt()
  const user = buildJudgeUserPrompt(testCase, output)

  // No caller — return an empty result so the runner can log "judge skipped".
  if (!options.callJudge) {
    return {
      score: 0,
      reasoning: 'No judge caller provided — LLM-as-judge skipped.',
      rubricScores: [],
      latencyMs: Date.now() - start,
      rawOutput: '',
      parsed: false,
    }
  }

  let rawOutput = ''
  try {
    const judgeModel = options.judgeModel ?? DEFAULT_JUDGE_MODEL
    const result = await Promise.race([
      options.callJudge(system, user),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`LLM judge timeout (${JUDGE_TIMEOUT_MS}ms)`)),
          JUDGE_TIMEOUT_MS,
        ),
      ),
    ])
    rawOutput = result.content
    // `judgeModel` is recorded in the runner log; we don't persist it here
    // to keep the result shape portable.
    void judgeModel
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        testCase: testCase.name,
      },
      'evaluation.llm-judge.call_failed',
    )
    return {
      score: 0,
      reasoning: `Judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      rubricScores: [],
      latencyMs: Date.now() - start,
      rawOutput: '',
      parsed: false,
    }
  }

  const parsed = parseJudgeOutput(rawOutput)
  if (!parsed) {
    return {
      score: 0,
      reasoning: 'Judge returned unparseable output.',
      rubricScores: [],
      latencyMs: Date.now() - start,
      rawOutput,
      parsed: false,
    }
  }

  const rubricScores: RubricJudgeScore[] = JUDGE_CRITERIA.map((c) => ({
    criterion: c,
    score: parsed.scores[c] ?? 0,
  }))

  // Equal-weight average across the 5 criteria (each criterion matters
  // independently — a fabricated price is just as bad as an off-tone reply).
  const score = Math.round(
    (rubricScores.reduce((s, r) => s + r.score, 0) / rubricScores.length) * 100,
  ) / 100

  return {
    score,
    reasoning: parsed.reasoning,
    rubricScores,
    latencyMs: Date.now() - start,
    rawOutput,
    parsed: true,
  }
}

/**
 * IA-6B (Gap 6) — Run the LLM judge across a full evaluation suite.
 * Returns the suite report augmented with per-case judge scores.
 *
 * Used by `scripts/eval-agents-llm-judge.ts`. The judge runs AFTER the
 * agent LLM call, so the suite first runs the agent (producing the
 * output) and then runs the judge on that output.
 */
export async function runEvaluationSuiteWithJudge(
  cases: AgentTestCase[],
  options: {
    callLLM?: (system: string, user: string, agentName: string) => Promise<{ content: string; usage?: { promptTokens?: number; completionTokens?: number } }>
    callJudge?: (system: string, user: string) => Promise<{ content: string; usage?: { promptTokens?: number; completionTokens?: number } }>
    judgeModel?: string
  } = {},
): Promise<EvaluationReport & { judgeResults: LLMJudgeResult[] }> {
  // 1. Run the agent suite — produces the per-case outputs + the
  //    deterministic-rubric scores (the baseline).
  const baseReport = await runEvaluationSuite(cases, { callLLM: options.callLLM })

  // 2. Run the judge on each case's output. Skip when no `callJudge`
  //    is wired (returns an empty result with `parsed: false`).
  const judgeResults: LLMJudgeResult[] = []
  for (let i = 0; i < baseReport.results.length; i++) {
    const result = baseReport.results[i]
    const testCase = cases[i]
    const judge = await evaluateWithLLMJudge(testCase, result.output, {
      callJudge: options.callJudge,
      judgeModel: options.judgeModel,
    })
    judgeResults.push(judge)
  }

  return { ...baseReport, judgeResults }
}

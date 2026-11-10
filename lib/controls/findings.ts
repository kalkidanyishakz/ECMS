/**
 * Public surface for the deterministic, rules-based AI findings pipeline.
 *
 * - `./findings-types`      — draft/input types, hashing + dedupe helpers
 * - `./findings-rules`      — pure, DB-free rule functions
 * - `./findings-queries`    — project-scoped source-row loading + normalization
 * - `./findings-generate`   — `generateFindings`, the orchestrator
 */
export * from './findings-types';
export * from './findings-rules';
export * from './findings-queries';
export * from './findings-generate';

export interface TrialResult { pass: boolean; invalid?: boolean; detail?: string }
export interface TrialsSpec {
  trials: number;
  requiredPasses: number;
  run: (index: number) => Promise<TrialResult>;
}
export interface TrialsOutcome { passed: boolean; invalid: boolean; passes: number; ran: number; results: TrialResult[] }

export async function runTrials(spec: TrialsSpec): Promise<TrialsOutcome> {
  const results: TrialResult[] = [];
  let passes = 0, failures = 0;
  const maxFailures = spec.trials - spec.requiredPasses;
  for (let i = 0; i < spec.trials; i++) {
    const r = await spec.run(i);
    results.push(r);
    if (r.invalid) return { passed: false, invalid: true, passes, ran: results.length, results };
    if (r.pass) passes++; else failures++;
    if (passes >= spec.requiredPasses) break;
    if (failures > maxFailures) break;
  }
  return { passed: passes >= spec.requiredPasses, invalid: false, passes, ran: results.length, results };
}

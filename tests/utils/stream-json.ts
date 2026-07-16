/**
 * Shared NDJSON (stream-json) parser for eval/activation-check helpers.
 * Single source of truth — do not duplicate in skill-activation.ts /
 * workflow-invocation.ts / individual eval tests.
 */

/** Parse stream-json (NDJSON) output into individual event objects, skipping unparseable lines. */
export function parseStreamJson(stdout: string): any[] {
  let parseFailures = 0;
  const events = stdout
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        parseFailures++;
        return [];
      }
    });
  if (events.length === 0 && parseFailures > 0)
    console.warn(`parseStreamJson: ${parseFailures} lines failed to parse, 0 succeeded`);
  return events;
}

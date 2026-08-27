import type { Harness } from "./types";
import { claude } from "./claude";
import { omp } from "./omp";

export * from "./types";
export { claude, omp };

export const ALL_HARNESSES: Harness[] = [claude, omp];

export function selectHarnesses(spec: string | undefined): Harness[] {
  if (!spec?.trim()) return [claude];
  return spec.split(",").map((raw) => {
    const id = raw.trim();
    const found = ALL_HARNESSES.find((h) => h.id === id);
    if (!found) throw new Error(`unknown harness "${id}"; expected one of: claude, omp`);
    return found;
  });
}

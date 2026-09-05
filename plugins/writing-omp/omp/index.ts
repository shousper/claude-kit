import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { registerHooks } from "./hooks";

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** OMP extension entry point, loaded via this plugin's package.json `omp.extensions`. */
export default function writingExtension(pi: ExtensionAPI): void {
  registerHooks(pi, PLUGIN_ROOT);
}

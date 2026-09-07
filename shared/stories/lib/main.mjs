// shared/stories/lib/main.mjs — CLI process entry. Each plugin's bin/story (the
// shared Node wrapper or a harness-specific shim) execs this file; it is the
// only place that touches process.argv and process.exit.
import { main } from "./cli.mjs";
import { EXIT } from "./util.mjs";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.stack ?? String(err));
    process.exit(EXIT.ERROR);
  },
);

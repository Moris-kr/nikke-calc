// Absolute-path launcher for desktop clients that choose their own cwd, and the container CMD.
// Installs the TypeScript loader (tsx) and runs src/main.ts with the given arguments.
//   node nikke_mcp/launch.mjs                      -> stdio (Claude Desktop)
//   node nikke_mcp/launch.mjs --transport streamable-http --host 0.0.0.0 --public
import { register } from 'tsx/esm/api';

register();
const { main } = await import('./src/main.ts');
await main();

// Verify the installed MCP over stdio (default) or a running HTTP server:
//   node nikke_mcp/smoke.mjs
//   node nikke_mcp/smoke.mjs --url http://127.0.0.1:8000/mcp
import { register } from 'tsx/esm/api';

register();
const { main } = await import('./src/smoke.ts');
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
}

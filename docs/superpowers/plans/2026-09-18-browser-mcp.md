# Browser MCP implementation plan

**Goal:** Public MCP calculations execute in the user's open calculator browser; Render only validates and relays bounded messages. Local stdio remains available.

**Architecture / approved design:** Explicit AI connection creates a random capability code and separate browser secret. In-memory sessions expire after 2 hours and go offline after 45 seconds without polling. One job per session, result retention 5 minutes. MCP submissions return job IDs immediately; get_browser_result polls without blocking. No server-compute fallback. Browser uses a dedicated Pyodide worker, disposed on disconnect. Current roster/decks are captured per job, never by exporting localStorage wholesale.

**Tech stack:** Existing Python MCP/Starlette, TypeScript, Pyodide Worker. No new dependencies.

## Contract

POST /browser/connect {} -> {connectionCode, browserToken, expiresIn:7200}
POST /browser/poll {browserToken} -> {job:null|{id,kind,requests?,state?,deck_index?,squad?,detail?}}
POST /browser/result {browserToken,jobId,result?,error?} -> {ok:true}
POST /browser/disconnect {browserToken} -> {ok:true}
Headers: Content-Type application/json, allowed Origin only public Pages and localhost dev. Tokens appear in bodies, never URLs. Response no-store.
Job kinds: inspect (return McpShare), simulate (requests array), shared (supplied state optional; otherwise live getShare(), deck_index or roster squad). All MCP browser submission results: {status:'queued',jobId,instruction}; get_browser_result(code,job_id) -> {status:'queued'|'running'|'complete'|'failed',result?,error?}. Completed results read idempotently. Browser jobs include no executable code/URL.

## Tasks

- [x] Backend: nikke_mcp/browser_relay.py bounded sessions and routes; test token isolation, expiry, pending limits, malformed/large requests, CORS. server.py remote-only submission and result tools, retained stdio compatibility. HTTP smoke test simulate relay, not server compute.
- [x] Frontend: mcp-browser.ts controller and tests for per-job capture, independent worker, disconnect, expired session, errors. worker-client/worker bridge output includes actual effectiveCharacters plus runtime version. UI connection control persists across tab switches, not page reloads.
- [x] Tutorial: guide connection code prompt, async results, shared roster vs deck distinction, privacy, tab-open requirement, reconnect after Render restart. Diagram and real generic screenshot. docs/MCP_SETUP.md and notice.
- [ ] Verify: full Python MCP suite, frontend suite/build, snapshot/doclint, browser actual Pyodide end-to-end. Independent code review. Commit/push, wait Pages and Render live, verify public paired browser calculation and server health.

Execution uses subagent-driven-development for the bounded backend task while the coordinator implements the independent browser client and integration. Existing authorized working checkout is retained; private HANDOFF.md is untouched.

## Verification record

- 2026-09-18: browser E2E inspected live deck, calculated 180 seconds and matched Python total exactly, compared two candidates. Dedicated worker runtime 4723422a93ab5cb8.
- Frontend suite 763 passed before one additional race regression (targeted suite 5 passed). MCP 33 passed, bridge58 passed, snapshot29/29 and doclintOK.
- Independent review found delayed-result/dequeue race; ready:false heartbeat and regression fixed it, scoped rereview approved.
- Results retain at most8/session, oldest completed evicted first; active jobs fail after300seconds. No remote compute fallback.

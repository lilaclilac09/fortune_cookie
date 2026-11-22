# Acceptance audit — 2026-11-22

Checked PRs #1–#7, the frontend, and its public deployment against [ACCEPTANCE.md](../ACCEPTANCE.md). PR #7 passes the evidence-closer check.

| # | Failing item | Source rule | Resolution |
|---|---|---|---|
| 1 | Merged PRs #1–#6 have no evidence closer (all eight fields missing) | §8, `verification.mdc` — “Every final reply” evidence closer | Not fixable retroactively; #7 now checks new PRs. |
| 2 | UI changes in PRs #1, #4, and #5 did not include a 390×844 still plus interaction proof in their bodies | §4, `ui-step-screenshot.mdc` — 390×844 plus interaction proof | Supplied current demo tap/reset evidence; it does not verify the historical signed devnet paths or prior deployments. |
| 3 | Demo tap showed “On-chain confirmed!” for a simulated `demo_tx_` ID | §5, `ship-visible-mvp.mdc` — “Demo ≠ product”; §6, `CLAUDE.md` — “the UI never claims ‘confirmed’ before the network agrees” | Demo now says “Demo result — not recorded on-chain”. The real confirmation branch is unchanged. |
| 4 | README did not state frontend status or next action | §5, `ship-visible-mvp.mdc` — “LIVE / BLOCKED / LOCAL ONLY + next human action” | README states BLOCKED and distinguishes the local demo from the public deployment. |
| 5 | Unable to verify the frontend on production | §5, `AGENTS.md` — do not claim fixed without production proof | Blocked pending access to a working public deployment. No production fix or chain verification claimed. |

**Repro:** In Demo Mode, tapping the cookie generates a synthetic `demo_tx_` identifier without a chain request. Chromium showed “On-chain confirmed!” for that ID before the change. The renderer used demo mode as a success condition to style the result and also reused it for the chain-confirmation label. The label now distinguishes the two while leaving real signature handling unchanged.

**Checks:** The app typecheck, CI PDA regression (50 distinct PDAs), Next production build, Rust check, and Rust tests (12 passed) completed. The eight Playwright core-demo tests passed. The recorded 390×844 Chromium walkthrough shows the simulated result and reset without an explorer link. The checks did not submit a transaction.

**Local environment:** The committed lockfile fails `npm ci` as documented in CI. Used the workflow's `npm install --omit=optional` equivalent without rewriting the lockfile. On this host, npm did not hoist the existing `uuid` needed by the aggregate wallet adapter's Particle analytics export; exposing the already installed `uuidv4` dependency's nested `uuid` in local `node_modules` unblocked the isolated verification. No manifest, lockfile or build output changed.

| blocked_on | evidence | impact | human_action | not_doing |
|---|---|---|---|---|
| Working public frontend deployment | Repository homepage returned HTTP 404; the production deployment URL returned HTTP 302 to Vercel sign-in | degraded — local demo verified, production unverified | Restore the public frontend alias or provide a working public URL | Do not treat localhost or the Vercel sign-in page as production verification |

**Status: BLOCKED** — restore the public deployment before claiming production verification.

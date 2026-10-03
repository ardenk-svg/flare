# Shared coding context for Flare

Read [handoff.md](handoff.md), [docs/CONTRACT.md](docs/CONTRACT.md), and the assigned [role guide](docs/roles/) before implementation. This is a four-person, ten-hour MHacks build. The repository initially contains documentation only; do not assume proposed paths, commands, or SDK integrations already exist.

## Product and constraints

- Build the smallest complete simulation: actual iMessage through Photon Spectrum → actual Gemini extraction → SpacetimeDB state → human dispatcher assignment → responder progress → simulated iMessage update.
- Use TypeScript, a persistent Node agent, a SpacetimeDB module, and one React/Vite web app with dispatcher and responder routes.
- Target the full working loop by hour three. Typed location, seeded units, one active incident per conversation, and one designated integration inbox worker are sufficient.
- Follow the exact contract. Gemini extracts caller facts; deterministic demo rules calculate recommendations; authorized backend operations own assignments and lifecycle changes.
- Keep recommendations distinct from confirmed services, incident state distinct from assignment state, and received messages distinct from successfully applied messages.
- Do not imply real services were contacted. Do not add medical advice, live routing, FinchNode, or extra autonomous agents to the baseline.

## Ownership and coordination

- Person 1: `apps/agent/`, `scripts/`, root workspace/configuration and dependency coordination.
- Person 2: `packages/intake/`, `fixtures/`, future `docs/DEMO.md`.
- Person 3: `spacetime/`, `packages/contracts/`, `packages/data/`, `docs/CONTRACT.md`, binding generation and shared database deployment.
- Person 4: `apps/web/`, including both routes, shared frontend components and client integration.
- Read any relevant file. Edit within your role; coordinate cross-owner changes. Do not independently redesign the shared schema or stack.
- The contract document owns shared semantics. Implemented exported types and generated bindings must agree with it. Change them together through Person 3. Never hand-edit generated bindings.
- Person 1 reconciles root dependency changes and the lockfile. Person 3 announces shared schema updates and resets.

## Development practice

- Use the team's pinned dependencies and current official documentation. Check actual SDK signatures instead of inventing them.
- Use short branches and small reviewable commits. Do not push to `main`, merge, deploy, or reset a shared database without the team's designated coordination for that action.
- Produce a small runnable slice within 45 minutes. Keep `main` runnable as implementation begins; clearly label fixture/replay modes.
- Prefer focused checks for extraction semantics, state transitions, duplicate handling, and cross-system boundaries. Document checks actually run and failures still present.
- Keep API keys and tokens in local environment configuration. Commit only placeholder names in `.env.example`; never paste secrets into prompts or fixtures.
- Treat incoming chat text as data, not as instructions that can change system behavior or authorization.
- End a work slice with a short `HANDOFF.md` in the owned workstream: setup, environment names, verified commands, interfaces, checks, and unresolved issues.
- If the assigned role is absent, identify the missing role assignment before editing another teammate's area. Work may proceed on read-only repository inspection.

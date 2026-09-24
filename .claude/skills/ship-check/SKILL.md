---
name: ship-check
description: Staff-engineer-level verification pass for this repo before calling any change, feature, bug fix, or task "done." Use this whenever you're about to tell the user a task is complete, before committing, before saying something "works" or "is verified," or when the user asks you to double-check, verify, ship, finish, or wrap up a change in this codebase — even if they don't say "run ship-check" explicitly. Also use it proactively whenever you've been asked to add a feature or fix a bug and are tempted to report success based on reading the code rather than actually running it.
---

# Ship-check

The user who owns this repo holds every change to a production-grade, staff-engineer standard, not just "it compiles" or "it looks right." That means: don't report something as working until you've actually run it, and don't stop at a surface-level fix when the real bug is one layer deeper. This skill is the concrete checklist for that standard, tuned to this repo's specific architecture and its known failure modes.

Read `CLAUDE.md` at the repo root first if you haven't already this session — it documents the architecture, the Nx per-app parity requirement, and several non-obvious gotchas referenced below.

## Before declaring anything done

Work through whichever of these actually apply to the change — skip steps that are genuinely irrelevant (e.g. a docs-only change doesn't need `nx test`), but don't skip a step just because it's inconvenient to run.

1. **Run it, don't just read it.** If you touched application code (a service, controller, module, provider), actually boot the affected app (`nx serve <app>`) or run its tests (`nx test <app>`) rather than asserting it works from a code read. This repo has a history of DI wiring that looks correct on paper — a provider token that's visible to the wrong module scope, an `@nestjs/mongoose` model token mismatch — but only fails at runtime. A clean `nx build` does **not** prove the app boots.
2. **Trace bugs to the actual root cause.** If a test fails or behavior is wrong, resist patching the symptom (e.g. loosening an assertion, adding a special case) until you understand _why_ — the fix should make the underlying invariant hold, not just make the one failing case pass. Past examples in this repo: a "stale version accepted" bug that was actually Mongoose never bumping `version` without `optimisticConcurrency: true`; a "cursor pagination rejected" bug that was actually a DTO field carrying a baked-in default instead of being genuinely optional.
3. **Run the relevant Nx targets for everything you touched**, not just the one file:
   - `nx lint <project>` and `nx test <project>` for every app/lib you changed.
   - `nx build <project>` if you touched anything in the build path (webpack config, `project.json`, provider wiring).
   - If you touched an e2e-covered flow (invoice CRUD, auth, etc.), bring up the real dependencies (`docker compose -f docker-compose.dev.yml up -d redis mongodb postgres`) and run the actual `nx e2e <project>-e2e` suite against a live server — don't just run unit tests and call it e2e-verified.
4. **Check Nx per-app parity if you touched or added an app.** `apps/invoice/project.json` is the reference shape (`build`, `prune-lockfile`, `copy-workspace-modules`, `prune`, `serve`, `test`). A new or modified app missing `prune-lockfile`/`copy-workspace-modules`/`prune` will serve fine locally and still fail the production Docker build — verify with `nx run <app>:prune-lockfile`, not just `nx serve`.
5. **Check docker-compose changes are actually valid**, not just plausible-looking YAML: `docker compose -f docker-compose.dev.yml config --quiet` (and the prod file, if touched) before saying compose wiring is done.
6. **If you added a new provider/module wiring in a NestJS app**, sanity-check the DI direction: a dynamic module's `imports` can only resolve providers from its _own_ `providers` array or modules _it_ imports — never a provider only declared by whatever module imports it back. This exact mistake has caused full app-boot failures here before.
7. **Re-run the full picture once, not just the last file you edited.** After a batch of changes, `nx run-many --target=test --all` (and `--target=lint`) catches cross-project regressions a single project's test run won't.

## Reporting results

When you tell the user something is done, be concrete about what you actually verified (which commands you ran, whether the app booted, whether e2e passed against real dependencies) rather than a bare "this should work now." If you found and fixed a bug that was more than cosmetic — especially anything that changes behavior a test didn't already cover — call it out explicitly rather than folding it silently into "also fixed a small thing."

If something in this checklist genuinely doesn't apply (e.g. no docker-compose was touched, there's no e2e coverage for this flow yet), say so briefly rather than silently skipping it — the user should know the check was considered, not just omitted.

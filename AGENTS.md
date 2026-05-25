# AGENTS.md

This file provides guidance when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies (from root)
bun install

# Start all apps in dev mode
bun run dev

# Build all apps
bun run build

# Run single app in dev mode
bun run --filter @restate-tob/finance dev

# Build single app
bun run --filter @restate-tob/finance build
```

### Linting & Typechecking

```bash
# Lint (from root only)
bun run check

# Lint fix (from root only)
bun run fix

# Typecheck all apps and packages
bun run typecheck

# Typecheck single app
cd apps/finance && bun run typecheck
cd apps/soa-finance && bun run typecheck

# Typecheck single package
cd packages/postgres && bun run typecheck
cd packages/shared && bun run typecheck
```

Linting uses [ultracite](https://github.com/harbordev/ultracite) (wraps Biome). Lefthook runs `ultracite fix` on pre-commit automatically.

## Architecture

### Monorepo Structure

- **Turborepo + Bun workspaces** manage the monorepo
- Apps live in `apps/` directory, each with independent `package.json`
- Shared packages in `packages/`:
  - `@restate-tob/postgres`: PostgreSQL database client
  - `@restate-tob/shared`: Shared utilities and types

### Restate Framework

This codebase uses [Restate](https://restate.dev) for durable execution. For detailed SDK reference, use the `restate` skill.

Key concepts:

- **Workflows** (`restate.workflow`): Long-running, resumable processes with a `run` handler
- **Virtual Objects** (`restate.object`): Stateful, key-addressable services
- **Services** (`restate.service`): Stateless handlers

**Critical Restate Rules:**
- Wrap all external calls (DB, API) in `ctx.run()` for durability
- Use `ctx.sleep()` instead of `setTimeout`
- Use `ctx.date.now()` instead of `Date.now()` for deterministic replay
- Use `RestatePromise.all/race/any` instead of native `Promise` methods
- Throw `TerminalError` for non-retryable failures (validation errors, data integrity errors)
- Always propagate errors - do not catch and return success:false in workflows
- **NEVER call Restate context methods inside `ctx.run()` callbacks** — causes deadlock on Lambda

### Error Recovery Strategy

**Non-Retryable Errors (use `TerminalError`):**
- Input validation failures (invalid date formats, malformed IDs)
- Data integrity violations (foreign key constraints, unique violations)
- Authorization/authentication failures
- Business logic violations

**Retryable Errors (throw regular Error):**
- Network timeouts
- Database connection failures
- Temporary service unavailability

**Connection Timeouts:**
- PostgreSQL: 10s connection, 300s statement timeout
- All database operations wrapped in connection helpers for proper cleanup

**Workflow State Management:**
- Workflow state persisted at each major step
- State includes: current step, job/run IDs, timestamps
- Failed workflows update state to "failed" before throwing error
- Use `getStatus` handler to query workflow progress at any time

## Code Style

This project uses **Ultracite**, a zero-config Biome preset. Run `npx ultracite fix` before committing.

### Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions
- Use `async/await` syntax instead of promise chains
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)

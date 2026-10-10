# Patch Tutor

A free, open-source VS Code extension that explains git changes inline
and quizzes the user on them. BYOK: no backend, no telemetry.

## Rules

- TypeScript strict. No `any` without a comment explaining why.
- Never store API keys anywhere except context.secrets.
- No network calls except to the user's configured LLM provider.
- No proposed VS Code APIs (we must publish to the Marketplace).
- All LLM output is parsed with zod schemas in src/llm/schemas.ts.
- Prompts live in src/prompts/*.md, never inline in TypeScript.
- Pure logic (diff parsing, cache, grading, concept store) has Vitest tests.
- UI code stays in src/ui/; it must not call providers directly.
- Never commit personal or machine-specific info: no absolute home paths,
  usernames, emails, hostnames, keys, or local editor config.

## Commands

- npm run build (esbuild)
- npm test (vitest)
- npm run test:integration
- npm run package (vsce package)

## Architecture

git -> diffParser -> contextBuilder -> provider -> schema -> cache -> ui
learning/ records quiz results and concepts locally.

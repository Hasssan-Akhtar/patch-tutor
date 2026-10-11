<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="media/logo-dark.png">
    <img src="media/logo.png" alt="Patch Tutor" width="420">
  </picture>
</p>

# Patch Tutor

A free, open-source VS Code extension that turns your own git changes into short lessons:
it explains each changed hunk right on the code, then quizzes you on it.

Bring your own key (Anthropic, OpenAI-compatible, Ollama) or use models already in VS Code (GitHub Copilot, or any extension that provides models) via `vscode.lm`.
No backend, no account, no telemetry.

> Early development. Not yet published.

## Development

```sh
npm install
npm run build
npm test
```

Press F5 in VS Code to launch an Extension Development Host.

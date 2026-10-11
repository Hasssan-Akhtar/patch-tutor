<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/Hasssan-Akhtar/patch-tutor/raw/HEAD/media/logo-dark.png">
    <img src="media/logo.png" alt="Patch Tutor" width="420">
  </picture>
</p>

# Patch Tutor

Learn from the code you just wrote. Patch Tutor explains each change in your git
working tree right on the code, then quizzes you on it.

## Features

- **Explain this change.** Every changed hunk gets an **Explain** button. The
  explanation opens on the code, with **Simpler** and **Go deeper** to change the level.
- **Quiz me.** A few short questions on the change, graded as you answer. Answer in
  the thread, or move the quiz to the **Quiz chat** in the sidebar.
- **Progress.** See which concepts you have mastered and which need practice.
- **Your model, your data.** Use a model you already have in VS Code, or your own
  API key. No account, no backend, no telemetry.

## Getting started

1. Install Patch Tutor and open a git repository.
2. Pick a model: open the Patch Tutor sidebar, then **⚙** in the Quiz chat.
3. Change some code and click **Explain this change** above the hunk.

The **Get started with Patch Tutor** walkthrough (Help → Welcome) shows the same steps.

## Models

| Provider              | What you need                                                    |
| --------------------- | ---------------------------------------------------------------- |
| **VS Code models**    | GitHub Copilot, or any extension that adds models to VS Code.    |
| **Anthropic**         | An Anthropic API key.                                            |
| **OpenAI-compatible** | A key for OpenAI, OpenRouter, Groq, or a local LM Studio server. |
| **Ollama**            | Ollama running locally. Nothing leaves your machine.             |

## Privacy

- Your diff and related code are sent only to the model provider you choose.
- API keys are kept in VS Code's secret storage, never in settings files.
- Quiz history and progress stay on your machine.

## Settings

| Setting                            | Default | Description                                     |
| ---------------------------------- | ------- | ----------------------------------------------- |
| `patchTutor.contextTokenBudget`    | `6000`  | How much context to send with each explanation. |
| `patchTutor.maxOutputTokens`       | `1200`  | Maximum length of each explanation.             |
| `patchTutor.gutterIcons`           | `true`  | Show an icon in the gutter on changed hunks.    |
| `patchTutor.highlightChangedLines` | `true`  | Softly highlight lines Patch Tutor can explain. |

Provider and model are easiest to change from **⚙** in the Quiz chat.

## Contributing

Issues and pull requests are welcome.

```sh
npm install
npm run build
npm test                  # unit tests
npm run test:integration  # runs inside VS Code
```

Press F5 in VS Code to launch an Extension Development Host.

## License

[MIT](LICENSE)

# Changelog

## 0.2.0 (2026-10-12)

- **Ask follow-ups.** Reply under an explanation to ask a question, ask for a dry run with example values, or push back. When you are right, the tutor corrects the explanation and says what was wrong. Continue a longer conversation in the sidebar chat with **Move to chat**.
- **Refresh** regenerates an explanation without the cache.
- More accurate explanations: code comments are treated as claims to check, performance claims must match the code, every change in a hunk is listed, risks cover changed defaults, ordering and partial changes, and concept tags describe what the change does.
- Explanations now see the other changes in the same file.
- Model settings name the model **VS Code models** uses by default, and warn when a small model is chosen.

## 0.1.1 (2026-10-12)

- The README logo is now readable on dark themes, including the extension page inside VS Code.

## 0.1.0 (2026-10-12)

First release.

- Explains each changed git hunk inline, with **Simpler** and **Go deeper** levels.
- Quizzes you on a hunk in its comment thread, or in the Quiz chat in the sidebar, and keeps a quiz history.
- Tracks the concepts you were quizzed on in a local Progress view.
- Works with models already in VS Code (GitHub Copilot or any extension that provides models), Anthropic, OpenAI-compatible servers and Ollama. Settings are in the chat's ⚙ panel.
- A **This is wrong** button saves bad explanations or grades for review.
- No backend, no account, no telemetry. API keys stay in VS Code's secret storage.

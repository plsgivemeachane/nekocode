# Auto commit

The Git modal includes an **Auto commit** button below the manual commit input. It starts a fresh Pi session in the selected project's directory and submits the instructions in `src/renderer/src/utils/auto-commit.ts`. It does not reuse an existing chat or empty draft.

The agent reviews staged and unstaged diffs and relevant untracked files, follows the repository's instructions and validation requirements, stages the intended changes, and creates logical commits with descriptive messages. Files do not need to be staged beforehand. The instructions prohibit discarding changes, amending commits, rewriting history, and pushing, and ask the agent to report commit hashes, messages, checks, and remaining changes.

Once session creation succeeds, the app activates the session, preloads the instructions into chat, closes the Git modal, and mounts the chat's streaming subscriptions before submitting the prompt. The user can follow the agent's work and stop it from chat.

The button is disabled when there are no changes, unresolved merge conflicts, Git status is loading, the repository has not been confirmed, an agent is connecting, a manual commit or remote operation is underway, or an Auto commit session is already running for the project. Repeated clicks during creation cannot create duplicate sessions. Reopening the modal while the agent is running keeps Auto commit disabled.

Creation failures leave the modal open with a visible error and allow retry. Prompt failures mark the created session as errored and reopen the modal, where the persisted error is visible. The agent itself rechecks Git state and handles validation or commit failures; the button does not guarantee that a commit will succeed.

Coverage lives in `src/tests/renderer/GitCommandCenter.auto-commit.test.tsx` and `src/tests/renderer/useSessionOrchestration.test.ts`.

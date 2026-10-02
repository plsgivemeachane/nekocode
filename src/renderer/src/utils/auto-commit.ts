export const AUTO_COMMIT_PROMPT = `Auto commit the changes in this project.

Review the repository instructions first and follow its commit and validation requirements. Inspect git status, the staged diff, the unstaged diff, and the contents of relevant untracked files. Review all current changes, not only the files that are already staged; the user does not need to stage anything first.

Understand what changed and why, and check recent commit messages for the repository's style. Stage the appropriate changes and create one or more logical commits with accurate, descriptive messages. Include all intended changes, including unstaged and untracked files, but exclude secrets, credentials, ignored files, and unrelated generated artifacts. If there are unresolved merge conflicts or no changes to commit, explain that and stop.

Run the checks required by the repository before committing. Preserve the user's changes; do not discard changes, rewrite commit history, amend existing commits, or push to a remote. Do not make unrelated code changes. Proceed with reviewing, staging, and committing without asking for routine confirmation.

After committing, report the commit hashes and messages, the checks you ran, and any remaining uncommitted changes. If a check or commit fails, report the failure honestly and do not claim success.`

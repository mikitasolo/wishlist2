# CLAUDE.md

Project conventions, testing policy, and domain invariants live in @AGENTS.md — follow them.

## Claude Code specifics

- **Linear** is reachable through the `linear-wis` MCP server: `get_issue` / `list_comments` / `get_project` to read the task, `save_issue` to move it to In Progress or file an out-of-scope finding in Backlog, `save_comment` to leave a note on the issue.
- **Self-review** (step 6 of the agent lifecycle): run the `code-review` skill on your diff and address what it finds before committing.

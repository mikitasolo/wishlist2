# CLAUDE.md

Project conventions and testing policy live in @AGENTS.md — follow them. The domain invariants are loaded in full, since they cut across every area: @docs/agents/invariants.md. The other topic files under `docs/agents/` aren't loaded; read the one for the area you touch.

## Claude Code specifics

- **Linear** is reachable through the `linear-wis` MCP server: `get_issue` / `list_comments` / `get_project` to read the task, `save_issue` to move it to In Progress or file an out-of-scope finding in Backlog, `save_comment` to leave a note on the issue.
- **Self-review** (step 6 of the agent lifecycle): run the `code-review` skill on your diff and address what it finds before committing.

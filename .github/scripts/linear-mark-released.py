#!/usr/bin/env python3
"""
Move the Linear issues a release closes from "On Staging" to Done.

`main` is only ever fast-forwarded to `staging`, so the push event's
`before..after` is exactly what shipped. PRs are squash-merged with the PR body
as the commit message, so a PR's `Closes WIS-12` line travels with its commit
into `main`. Linear's own GitHub integration only knows about the merge into
`staging` (-> On Staging); this is the step that says "it's in production".

Every issue a commit in the range *closes* (Linear's closing magic words) and
that is still in "On Staging" moves to its team's first completed status.
Anything else is left alone: a `Part of WIS-12` reference, an issue that went
back to In Review for a follow-up PR, one the operator already moved.

Env:
  LINEAR_API_KEY   required to actually update issues (a personal API key)
  BEFORE, AFTER    push event SHAs (default: HEAD~20..HEAD)

With no key set it prints what it would do — which is both a safe no-op in
CI without the secret and how you preview it locally:

    BEFORE=$(git rev-parse HEAD~3) AFTER=$(git rev-parse HEAD) \
      python3 .github/scripts/linear-mark-released.py
"""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

ZERO_SHA = "0" * 40
ON_STAGING = "On Staging"
API_URL = "https://api.linear.app/graphql"

# Linear's closing magic words; contributing ones ("part of", "ref", …) are
# deliberately absent. https://linear.app/docs/github#link-using-pull-requests
MAGIC = (
    r"(?:close[sd]?|closing|fix(?:e[sd])?|fixing|resolve[sd]?|resolving"
    r"|complete[sd]?|completing|implement(?:s|ed|ing)?)"
)
ISSUE_ID = r"[A-Za-z][A-Za-z0-9]*-\d+"
# `Closes WIS-1`, `Fixes: WIS-1, WIS-2 and WIS-3`
CLOSING = re.compile(
    rf"\b{MAGIC}:?\s+({ISSUE_ID}(?:\s*(?:,|&|\band\b)\s*{ISSUE_ID})*)",
    re.IGNORECASE,
)


def summary(line: str) -> None:
    """Surface the outcome on the workflow run page (the job can't fail the run)."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def commit_exists(ref: str) -> bool:
    return (
        subprocess.run(
            ["git", "cat-file", "-e", f"{ref}^{{commit}}"], capture_output=True
        ).returncode
        == 0
    )


def commit_messages() -> list[str]:
    """Full messages of the released commits."""
    before = os.environ.get("BEFORE", "").strip()
    after = os.environ.get("AFTER", "").strip() or "HEAD"

    # `before` is all-zeros when the branch is first created, and unreachable
    # after a force-push — fall back to a recent slice rather than failing.
    if before and before != ZERO_SHA and commit_exists(before):
        rev_args = [f"{before}..{after}"]
    else:
        rev_args = ["-n", "20", after]

    out = subprocess.run(
        ["git", "log", "--no-merges", "--format=%B%x00", *rev_args],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [message for message in out.split("\0") if message.strip()]


def closed_issue_ids(messages: list[str]) -> list[str]:
    """Issue identifiers the messages close, uppercased, in first-seen order."""
    seen: dict[str, None] = {}
    for message in messages:
        for match in CLOSING.finditer(message):
            for issue_id in re.findall(ISSUE_ID, match.group(1)):
                seen.setdefault(issue_id.upper(), None)
    return list(seen)


def gql(key: str, query: str, variables: dict) -> dict:
    request = urllib.request.Request(
        API_URL,
        data=json.dumps({"query": query, "variables": variables}).encode(),
        # Personal API keys go in bare, without a `Bearer` prefix.
        headers={"Content-Type": "application/json", "Authorization": key},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = json.load(response)
    if body.get("errors"):
        raise RuntimeError(body["errors"][0].get("message", "unknown GraphQL error"))
    return body["data"]


ISSUE_QUERY = """
query($id: String!) {
  issue(id: $id) {
    id
    identifier
    state { name }
    team { states(filter: { type: { eq: "completed" } }) { nodes { id name position } } }
  }
}
"""

MOVE_MUTATION = """
mutation($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}
"""


def release(key: str, issue_id: str) -> str:
    """Move one issue to Done if it's On Staging; return a line for the log."""
    try:
        issue = gql(key, ISSUE_QUERY, {"id": issue_id})["issue"]
    except RuntimeError as err:
        # An ID from another workspace, a typo, a deleted issue — not fatal.
        return f"{issue_id}: skipped ({err})"

    state = issue["state"]["name"]
    if state != ON_STAGING:
        return f"{issue_id}: left in {state}"

    done = min(issue["team"]["states"]["nodes"], key=lambda s: s["position"])
    gql(key, MOVE_MUTATION, {"id": issue["id"], "stateId": done["id"]})
    return f"{issue_id}: {ON_STAGING} → {done['name']}"


def main() -> None:
    issue_ids = closed_issue_ids(commit_messages())
    if not issue_ids:
        print("No commit in range closes a Linear issue — nothing to do.")
        summary("ℹ️ No Linear issues closed by this release.")
        return

    key = os.environ.get("LINEAR_API_KEY", "").strip()
    if not key:
        print("LINEAR_API_KEY not set — preview only. Would release:")
        for issue_id in issue_ids:
            print(f"  {issue_id} (if it's still {ON_STAGING})")
        summary("⚠️ `LINEAR_API_KEY` not configured — preview only, nothing moved.")
        return

    try:
        for issue_id in issue_ids:
            line = release(key, issue_id)
            print(line)
            summary(f"- {line}")
    except (urllib.error.URLError, RuntimeError) as err:
        # Never echo the request: the key rides in its headers.
        print(f"Linear API call failed: {err}", file=sys.stderr)
        summary(f"❌ Linear API call failed: `{err}`")
        raise SystemExit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Post a changelog for the just-released commits to a Telegram channel.

Reads the commit range from the push event (`main` is only ever fast-forwarded
to `staging`, so `before..after` is exactly what shipped), groups the subjects by
conventional-commit type, and sends one HTML message via the Bot API.

Env:
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   required to actually send
  BEFORE, AFTER                          push event SHAs (default: HEAD~20..HEAD)
  REPO, RUN_URL                          optional, for links in the message

With no token set it prints the message instead of sending — which is both a
safe no-op in forks/CI without secrets and how you preview it locally:

    BEFORE=$(git rev-parse HEAD~3) AFTER=$(git rev-parse HEAD) \
      python3 .github/scripts/telegram-release-notes.py
"""

import html
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

# Telegram hard-caps a message at 4096 chars; leave room for the footer.
MAX_LEN = 3800
ZERO_SHA = "0" * 40

# Conventional-commit prefix -> section heading, in display order. Anything that
# doesn't match a known prefix lands in "Other".
SECTIONS = [
    ("feat", "✨ Features"),
    ("fix", "🐛 Fixes"),
    ("perf", "⚡ Performance"),
    ("refactor", "♻️ Refactoring"),
    ("docs", "📝 Docs"),
    ("test", "✅ Tests"),
    ("build", "📦 Build"),
    ("ci", "🤖 CI"),
    ("chore", "🔧 Chores"),
]
OTHER = "📌 Other"


def summary(line: str) -> None:
    """Surface the outcome on the workflow run page.

    The job is `continue-on-error`, so a rejected post still reports as a green
    run — without this the only trace would be buried in the step log.
    """
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout.strip()


def commit_exists(ref: str) -> bool:
    return (
        subprocess.run(
            ["git", "cat-file", "-e", f"{ref}^{{commit}}"], capture_output=True
        ).returncode
        == 0
    )


def commit_subjects() -> list[str]:
    """Subjects of the released commits, newest first."""
    before = os.environ.get("BEFORE", "").strip()
    after = os.environ.get("AFTER", "").strip() or "HEAD"

    # `before` is all-zeros when the branch is first created, and unreachable
    # after a force-push — fall back to a recent slice rather than failing.
    if before and before != ZERO_SHA and commit_exists(before):
        rev_args = [f"{before}..{after}"]
    else:
        rev_args = ["-n", "20", after]

    out = git("log", "--no-merges", "--pretty=format:%s", *rev_args)
    return [line for line in out.splitlines() if line.strip()]


def classify(subject: str) -> tuple[str, str]:
    """Split `type(scope)!: text` into a section heading and the bare text."""
    head, sep, rest = subject.partition(":")
    if sep and len(head) <= 20:
        kind = head.split("(")[0].rstrip("!").strip().lower()
        for prefix, heading in SECTIONS:
            if kind == prefix:
                return heading, rest.strip() or subject
    return OTHER, subject


def build_message(subjects: list[str]) -> str:
    grouped: dict[str, list[str]] = {}
    for subject in subjects:
        heading, text = classify(subject)
        grouped.setdefault(heading, []).append(text)

    repo = os.environ.get("REPO", "").strip()
    title = repo.split("/")[-1] if repo else "App"

    lines = [f"🚀 <b>{html.escape(title)}</b> released to production", ""]

    order = [h for _, h in SECTIONS] + [OTHER]
    dropped = 0
    for heading in order:
        items = grouped.get(heading)
        if not items:
            continue
        block = [f"<b>{heading}</b>"]
        for text in items:
            entry = f"• {html.escape(text)}"
            if sum(len(x) + 1 for x in lines + block) + len(entry) > MAX_LEN:
                dropped += 1
                continue
            block.append(entry)
        # Only emit the heading if at least one item fit under it.
        if len(block) > 1:
            lines.extend(block)
            lines.append("")

    if dropped:
        lines.append(f"<i>…and {dropped} more commit(s)</i>")
        lines.append("")

    before = os.environ.get("BEFORE", "").strip()
    after = os.environ.get("AFTER", "").strip()
    if repo and before and before != ZERO_SHA and after:
        lines.append(
            f'<a href="https://github.com/{repo}/compare/{before}...{after}">'
            f"Compare {before[:7]}…{after[:7]}</a>"
        )

    return "\n".join(lines).strip()


def send(token: str, chat_id: str, text: str) -> None:
    payload = json.dumps(
        {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
    ).encode()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read()
        print("Posted release notes to Telegram.")
        summary("✅ Release notes posted to Telegram.")
    except urllib.error.HTTPError as err:
        # Print status + body only. The URL carries the bot token, so it must
        # never reach the log.
        body = err.read().decode("utf-8", "replace")[:500]
        print(f"Telegram API returned {err.code}: {body}", file=sys.stderr)
        summary(f"❌ Telegram rejected the post ({err.code}): `{body}`")
        raise SystemExit(1)
    except urllib.error.URLError as err:
        print(f"Could not reach Telegram: {err.reason}", file=sys.stderr)
        summary(f"❌ Could not reach Telegram: {err.reason}")
        raise SystemExit(1)


def main() -> None:
    subjects = commit_subjects()
    if not subjects:
        print("No commits in range — nothing to announce.")
        summary("ℹ️ No commits in range — nothing announced.")
        return

    message = build_message(subjects)

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — preview only:\n")
        print(message)
        summary("⚠️ Secrets not configured — preview only, nothing sent.")
        return

    send(token, chat_id, message)


if __name__ == "__main__":
    main()

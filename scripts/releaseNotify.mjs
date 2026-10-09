// What `scripts/release.mjs` does after the release push lands: post the
// changelog to Telegram and move the Linear issues the release closes from
// "On Staging" to Done. Ported from the former release-notify.yml workflow
// (GitHub Actions minutes ran out, WIS-379). Secrets come from the operator's
// shell and are never printed: the Telegram URL carries the bot token and the
// Linear key rides in a header, so errors here report a status or message only.

const MAX_LEN = 3800; // Telegram caps a message at 4096; leave room for the footer.

// Conventional-commit prefix -> section heading, in display order.
export const SECTIONS = [
  ['feat', '✨ Features'],
  ['fix', '🐛 Fixes'],
  ['perf', '⚡ Performance'],
  ['refactor', '♻️ Refactoring'],
  ['docs', '📝 Docs'],
  ['test', '✅ Tests'],
  ['build', '📦 Build'],
  ['ci', '🤖 CI'],
  ['chore', '🔧 Chores'],
];
export const OTHER = '📌 Other';

const ON_STAGING = 'On Staging';
const LINEAR_URL = 'https://api.linear.app/graphql';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Split `type(scope)!: text` into a section heading and the bare text. */
export function classify(subject) {
  const i = subject.indexOf(':');
  if (i !== -1 && i <= 20) {
    const kind = subject.slice(0, i).split('(')[0].replace(/!+$/, '').trim().toLowerCase();
    const section = SECTIONS.find(([prefix]) => prefix === kind);
    if (section) return [section[1], subject.slice(i + 1).trim() || subject];
  }
  return [OTHER, subject];
}

/**
 * The Telegram HTML message for the shipped commit subjects. `compare` is an optional link.
 * @param {string[]} subjects
 * @param {{ title?: string, compare?: { url: string, from: string, to: string } }} [options]
 */
export function buildMessage(subjects, { title = 'App', compare } = {}) {
  const grouped = new Map();
  for (const subject of subjects) {
    const [heading, text] = classify(subject);
    if (!grouped.has(heading)) grouped.set(heading, []);
    grouped.get(heading).push(text);
  }
  const lines = [`🚀 <b>${escapeHtml(title)}</b> released to production`, ''];
  const length = (extra) => lines.concat(extra).reduce((n, l) => n + l.length + 1, 0);
  let dropped = 0;
  for (const heading of [...SECTIONS.map(([, h]) => h), OTHER]) {
    const items = grouped.get(heading);
    if (!items) continue;
    const block = [`<b>${heading}</b>`];
    for (const text of items) {
      const entry = `• ${escapeHtml(text)}`;
      if (length(block) + entry.length > MAX_LEN) dropped++;
      else block.push(entry);
    }
    if (block.length > 1) lines.push(...block, '');
  }
  if (dropped) lines.push(`<i>…and ${dropped} more commit(s)</i>`, '');
  if (compare) {
    lines.push(`<a href="${compare.url}">Compare ${compare.from}…${compare.to}</a>`);
  }
  return lines.join('\n').trim();
}

// Linear's closing magic words; contributing ones ("part of", "ref") are absent.
const MAGIC =
  '(?:close[sd]?|closing|fix(?:e[sd])?|fixing|resolve[sd]?|resolving|complete[sd]?|completing|implement(?:s|ed|ing)?)';
const ISSUE_ID = '[A-Za-z][A-Za-z0-9]*-\\d+';
const CLOSING = new RegExp(
  `\\b${MAGIC}:?\\s+(${ISSUE_ID}(?:\\s*(?:,|&|\\band\\b)\\s*${ISSUE_ID})*)`,
  'gi'
);

/** Issue identifiers the commit messages close, uppercased, first-seen order. */
export function closedIssueIds(messages) {
  const seen = new Set();
  for (const message of messages) {
    for (const match of message.matchAll(CLOSING)) {
      for (const id of match[1].match(new RegExp(ISSUE_ID, 'g')) ?? []) seen.add(id.toUpperCase());
    }
  }
  return [...seen];
}

function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

async function sendTelegram(token, chatId, text) {
  const response = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`Telegram API returned ${response.status}: ${body}`);
  }
}

async function gql(key, query, variables) {
  // Personal API keys go in bare, without a `Bearer` prefix.
  const response = await postJson(LINEAR_URL, { query, variables }, { Authorization: key });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message ?? 'unknown GraphQL error');
  return body.data;
}

const ISSUE_QUERY = `query($id: String!) { issue(id: $id) { id identifier state { name }
  team { states(filter: { type: { eq: "completed" } }) { nodes { id name position } } } } }`;
const MOVE_MUTATION = `mutation($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`;

async function markReleased(key, identifier) {
  let issue;
  try {
    issue = (await gql(key, ISSUE_QUERY, { id: identifier })).issue;
  } catch (error) {
    // Another workspace's ID, a typo, a deleted issue: not fatal.
    return `${identifier}: skipped (${error.message})`;
  }
  const state = issue.state.name;
  if (state !== ON_STAGING) return `${identifier}: left in ${state}`;
  const done = issue.team.states.nodes.reduce((a, b) => (b.position < a.position ? b : a));
  await gql(key, MOVE_MUTATION, { id: issue.id, stateId: done.id });
  return `${identifier}: ${ON_STAGING} → ${done.name}`;
}

/**
 * Announce a release. Never throws: the release has already happened, so a
 * failure is a warning. With no credentials it prints a preview.
 * `commits` is [{ subject, body }] for exactly the shipped range.
 * @param {{ subject: string, body: string }[]} commits
 * @param {{ env?: Record<string, string | undefined>, title?: string,
 *   compare?: { url: string, from: string, to: string },
 *   log?: { log: (...a: unknown[]) => void, warn: (...a: unknown[]) => void } }} [options]
 */
export async function announceRelease(
  commits,
  { env = process.env, title, compare, log = console } = {}
) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  const message = buildMessage(
    commits.map((c) => c.subject),
    { title, compare }
  );
  if (!token || !chatId) {
    log.log('\nTELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set, preview only:\n');
    log.log(message);
  } else {
    try {
      await sendTelegram(token, chatId, message);
      log.log('Posted release notes to Telegram.');
    } catch (error) {
      log.warn(`Warning: release notes were not posted: ${error.message}`);
    }
  }

  const ids = closedIssueIds(commits.map((c) => `${c.subject}\n\n${c.body}`));
  if (!ids.length) {
    log.log('\nNo commit in the release closes a Linear issue.');
    return;
  }
  const key = env.LINEAR_API_KEY?.trim();
  if (!key) {
    log.log(`\nLINEAR_API_KEY not set, preview only. Would release (if still ${ON_STAGING}):`);
    for (const id of ids) log.log(`  ${id}`);
    return;
  }
  log.log('');
  for (const id of ids) {
    try {
      log.log(await markReleased(key, id));
    } catch (error) {
      log.warn(`Warning: could not update ${id}: ${error.message}`);
    }
  }
}

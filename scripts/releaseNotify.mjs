// What `scripts/release.mjs` does after the release push lands: post the
// changelog to Telegram and move the Linear issues the release closes from
// "On Staging" to Done. Ported from the former release-notify.yml workflow
// (GitHub Actions minutes ran out, WIS-379). Secrets come from the operator's
// shell and are never printed: the Telegram URL carries the bot token and the
// Linear key rides in a header, so errors here report a status or message only.

const MAX_LEN = 4000; // Telegram caps a message at 4096 characters.

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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
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

function renderMessage(subjects, header, compare) {
  const grouped = new Map();
  for (const subject of subjects) {
    const [heading, text] = classify(subject);
    if (!grouped.has(heading)) grouped.set(heading, []);
    grouped.get(heading).push(`• ${escapeHtml(text)}`);
  }
  const lines = [header, ''];
  for (const heading of [...SECTIONS.map(([, h]) => h), OTHER]) {
    const items = grouped.get(heading);
    if (items) lines.push(`<b>${heading}</b>`, ...items, '');
  }
  if (compare) {
    lines.push(`<a href="${compare.url}">Compare ${compare.from}…${compare.to}</a>`);
  }
  return lines.join('\n').trim();
}

/**
 * The Telegram HTML messages for the shipped commit subjects, given oldest
 * first: one message, or as many as it takes to fit Telegram's cap, each
 * grouped by section, in order (`(1/3)`…), so the channel reads top to bottom
 * in the order things shipped. `compare` is an optional link on the last one.
 * @param {string[]} subjects
 * @param {{ title?: string, compare?: { url: string, from: string, to: string } }} [options]
 * @returns {string[]}
 */
export function buildMessages(subjects, { title = 'App', compare } = {}) {
  const header = (part) => `🚀 <b>${escapeHtml(title)}</b> released to production${part}`;
  // Sized with the widest part label and the link, so every part fits once numbered.
  const fits = (chunk) => renderMessage(chunk, header(' (99/99)'), compare).length <= MAX_LEN;
  const chunks = [[]];
  for (const subject of subjects) {
    const chunk = chunks.at(-1);
    if (chunk.length && !fits([...chunk, subject])) chunks.push([subject]);
    else chunk.push(subject);
  }
  return chunks.map((chunk, i) =>
    renderMessage(
      chunk,
      header(chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''),
      i === chunks.length - 1 ? compare : undefined
    )
  );
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
  const messages = buildMessages(
    commits.map((c) => c.subject),
    { title, compare }
  );
  if (!token || !chatId) {
    log.log('\nTELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set, preview only:\n');
    log.log(messages.join('\n\n────────\n\n'));
  } else {
    // In order, stopping at the first failure so the channel never skips a part.
    let posted = 0;
    try {
      for (const message of messages) {
        await sendTelegram(token, chatId, message);
        posted++;
      }
      log.log(`Posted release notes to Telegram (${plural(posted, 'message')}).`);
    } catch (error) {
      log.warn(
        `Warning: release notes stopped after ${posted} of ${messages.length} message(s): ${error.message}`
      );
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

// Phone messages through ntfy.sh. JSON goes to the root URL, priority as a number.

const { NTFY_TOPIC } = require('./env');

const PRIORITY = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };

async function push({ title, message, priority = 'default', click, actions }) {
  const topic = process.env.NTFY_TOPIC || NTFY_TOPIC;
  if (!topic) return { skipped: 'no ntfy topic (NTFY_TOPIC in .env)' };
  const body = { topic, title, message, priority: PRIORITY[priority] ?? 3 };
  if (click) body.click = click;
  if (actions?.length) body.actions = actions.slice(0, 3);
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ntfy answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { sent: true };
}

module.exports = { push };

/**
 * Calvada Lunch Vote — scheduled winner decision.
 *
 * Why this exists: the winner used to be tallied in whichever browser happened
 * to have the leaderboard open when the timer expired. If nobody had the page
 * open, no winner was ever written. This runs on a schedule instead, so the
 * result exists whether or not anyone is looking.
 *
 * It also owns the `winner` field outright — firestore.rules denies writes to
 * it from every client. The Admin SDK bypasses rules, so only this code path
 * can set it.
 *
 * Re-decides automatically when the voting window changes: the decision records
 * the `endMs` it was made against, and a mismatch forces a fresh tally. That
 * replaces the client-side "clear the stale winner on extend" hack.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1', maxInstances: 2 });

// Optional. Set with:  firebase functions:secrets:set SLACK_WEBHOOK_URL
// If unset, the winner is still decided — the announcement is just skipped.
const SLACK_WEBHOOK_URL = defineSecret('SLACK_WEBHOOK_URL');

/** Mirrors src/components/utils/normalizeKey.tsx so tallies agree. */
function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object' && typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

async function announceToSlack(webhookUrl, { week, winnerName, total, tally }) {
  if (!webhookUrl) {
    logger.info('No SLACK_WEBHOOK_URL configured — skipping announcement.');
    return;
  }

  const breakdown = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `• ${name} — ${count}`)
    .join('\n');

  const body = {
    text: `Lunch this week: ${winnerName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*We're eating ${winnerName} this week* :tada:\n_${week} · ${total} ${
            total === 1 ? 'vote' : 'votes'
          }_`,
        },
      },
      { type: 'section', text: { type: 'mrkdwn', text: breakdown } },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Never fail the decision because chat is down.
    logger.error('Slack announcement failed', {
      status: response.status,
      body: await response.text(),
    });
  }
}

async function decideWinner(webhookUrl) {
  const [weekSnap, configSnap] = await Promise.all([
    db.doc('config/currentWeek').get(),
    db.doc('config/votingConfig').get(),
  ]);

  const week = weekSnap.exists ? String(weekSnap.data()?.value ?? '').trim() : '';
  if (!week) {
    logger.info('config/currentWeek is not set — nothing to decide.');
    return;
  }

  const config = configSnap.exists ? configSnap.data() : {};
  const endMs = toMillis(config?.endMs ?? config?.endTime ?? config?.end);
  if (!endMs) {
    logger.info('No voting end time configured.', { week });
    return;
  }
  if (Date.now() < endMs) {
    return; // still open
  }

  const weeklyRef = db.doc(`weeklyOptions/${week}`);
  const weeklySnap = await weeklyRef.get();
  if (!weeklySnap.exists) {
    logger.warn('weeklyOptions doc missing for current week.', { week });
    return;
  }

  const weekly = weeklySnap.data();
  const choices = Array.isArray(weekly?.choices) ? weekly.choices : [];
  if (choices.length === 0) {
    logger.info('No ballot choices for this week.', { week });
    return;
  }

  // Already settled against this exact window? Nothing to do.
  const existing = weekly?.winner;
  if (existing?.name && existing?.decidedForEndMs === endMs) {
    return;
  }

  const votesSnap = await db.collection('votes').where('week', '==', week).get();

  const validKeys = new Set(choices.map(normalizeKey));
  const labelByKey = new Map(choices.map((choice) => [normalizeKey(choice), choice]));
  const tallyByKey = {};

  votesSnap.forEach((doc) => {
    const key = normalizeKey(doc.data()?.choice);
    if (!key || !validKeys.has(key)) return;
    tallyByKey[key] = (tallyByKey[key] || 0) + 1;
  });

  const total = Object.values(tallyByKey).reduce((sum, n) => sum + n, 0);
  if (total === 0) {
    logger.info('Window closed with no valid votes.', { week });
    return;
  }

  // Ties break by ballot order — the same rule the UI used, kept deliberate
  // rather than random so a re-run always produces the same winner.
  const max = Math.max(...Object.values(tallyByKey));
  const winnerKey = Object.keys(tallyByKey)
    .filter((key) => tallyByKey[key] === max)
    .sort(
      (a, b) =>
        choices.findIndex((c) => normalizeKey(c) === a) -
        choices.findIndex((c) => normalizeKey(c) === b)
    )[0];

  const winnerName = labelByKey.get(winnerKey) ?? winnerKey;
  const tally = Object.fromEntries(
    Object.entries(tallyByKey).map(([key, count]) => [labelByKey.get(key) ?? key, count])
  );

  await weeklyRef.set(
    {
      winner: {
        name: winnerName,
        tally,
        total,
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        decidedForEndMs: endMs,
        source: 'scheduled-function',
      },
    },
    { merge: true }
  );

  logger.info('Winner decided.', { week, winnerName, total });

  await announceToSlack(webhookUrl, { week, winnerName, total, tally });
}

exports.decideWeeklyWinner = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'America/Los_Angeles',
    secrets: [SLACK_WEBHOOK_URL],
  },
  async () => {
    await decideWinner(SLACK_WEBHOOK_URL.value());
  }
);

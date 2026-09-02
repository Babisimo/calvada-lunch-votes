/**
 * The voting window, read the way firestore.rules reads it.
 *
 * THIS EXISTS BECAUSE THE CLIENT AND THE RULES ONCE DISAGREED.
 *
 * `config/votingConfig` carries the window twice: as `start`/`end` ISO strings
 * for the datetime-local inputs, and as numeric `startMs`/`endMs`. Rules cannot
 * parse a datetime string, so they only ever read the NUMBERS:
 *
 *     configEndMs()     = 'endMs' in cfg ? cfg.endMs : 0
 *     votingHasClosed() = configEndMs() > 0 && request.time >= configEndMs()
 *
 * Every client used to parse the STRING instead. When a config document written
 * before the numeric fields existed was still in place, the two disagreed
 * completely: the app was certain voting had closed and offered to settle the
 * week, while the rules saw `endMs = 0`, concluded voting had never closed, and
 * denied every winner write. Votes kept working the whole time, because
 * `withinVotingWindow()` fails OPEN on a missing field while `votingHasClosed()`
 * fails CLOSED — so nothing surfaced until someone tried to settle a tie.
 *
 * So: anything that has to agree with the server reads `endMs`, and a config
 * missing the numbers reports `needsResave` rather than quietly guessing.
 * Re-saving the timer in /admin writes them.
 */

export type VotingWindow = {
  /** 0 when unknown. Authoritative — matches what the rules compare against. */
  startMs: number;
  endMs: number;
  /**
   * The numeric fields the rules depend on are missing, so no winner can be
   * recorded for this window no matter what the app does. Only a re-save of the
   * timer fixes it.
   */
  needsResave: boolean;
};

function parseMs(v: any): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v && typeof v === 'object' && 'seconds' in v) return v.seconds * 1000;
  return 0;
}

export function readVotingWindow(data: any): VotingWindow {
  if (!data) return { startMs: 0, endMs: 0, needsResave: false };

  const hasNumeric = typeof data.endMs === 'number' && Number.isFinite(data.endMs);

  if (hasNumeric) {
    return {
      startMs: parseMs(data.startMs ?? data.start),
      endMs: data.endMs,
      needsResave: false,
    };
  }

  // Fall back to the strings so countdowns and status text still render, but
  // flag it: the server will refuse to settle this window.
  return {
    startMs: parseMs(data.startTime ?? data.start),
    endMs: parseMs(data.endTime ?? data.end),
    needsResave: parseMs(data.endTime ?? data.end) > 0,
  };
}

export const TIMEZONE = process.env.TZ || "Asia/Jakarta";

export const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || "adm";

export const GENIUS_JOB_CONFIG = {
  initialDelayHours: Number(process.env.GENIUS_INITIAL_DELAY_HOURS) || 5,
  pollIntervalHours: Number(process.env.GENIUS_POLL_INTERVAL_HOURS) || 1,
  maxPollAttempts: Number(process.env.GENIUS_MAX_POLL_ATTEMPTS) || 7,
};

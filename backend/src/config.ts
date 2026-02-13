function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export const config = {
  appVersion: process.env.APP_VERSION || 'dev',
  port: readInt('PORT', 3000),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret',
  maxRooms: readInt('MAX_ROOMS', 3),
  maxAIConcurrent: readInt('MAX_AI_CONCURRENT', 2),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  roomTimeoutMinutes: readInt('ROOM_TIMEOUT_MINUTES', 10),
  speechTimeoutSeconds: readInt('SPEECH_TIMEOUT_SECONDS', 90),
  voteTimeoutSeconds: readInt('VOTE_TIMEOUT_SECONDS', 90),
  tiebreakTimeoutSeconds: readInt('TIEBREAK_TIMEOUT_SECONDS', 90)
};

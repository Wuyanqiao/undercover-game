export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
  maxRooms: parseInt(process.env.MAX_ROOMS || '3', 10),
  maxAIConcurrent: parseInt(process.env.MAX_AI_CONCURRENT || '2', 10),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  roomTimeoutMinutes: 10,
  speechTimeoutSeconds: 30,
  voteTimeoutSeconds: 20,
  tiebreakTimeoutSeconds: 15
};

import Redis from 'ioredis';
import { config } from './config';
import { logger } from './logger';

export const redisClient = new Redis(config.redisUrl, {
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3
});

redisClient.on('error', (err) => {
  logger.error(err, 'Redis error');
});

redisClient.on('connect', () => {
  logger.info('Redis connected');
});

// Room management helpers
export async function getActiveRoomCount(): Promise<number> {
  const rooms = await redisClient.keys('room:*');
  return rooms.length;
}

export async function incrementActiveRooms(): Promise<boolean> {
  const current = await getActiveRoomCount();
  if (current >= config.maxRooms) {
    return false;
  }
  return true;
}

export async function storeResumeToken(token: string, roomId: string, seat: number, nickname: string): Promise<void> {
  await redisClient.setex(
    `token:${token}`,
    3600, // 1 hour expiry
    JSON.stringify({ roomId, seat, nickname })
  );
}

export async function getResumeTokenData(token: string): Promise<{ roomId: string; seat: number; nickname: string } | null> {
  const data = await redisClient.get(`token:${token}`);
  if (!data) return null;
  return JSON.parse(data);
}

export async function deleteResumeToken(token: string): Promise<void> {
  await redisClient.del(`token:${token}`);
}

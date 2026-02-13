import Redis from 'ioredis';
import { config } from './config';
import { logger } from './logger';
import { RoomState, SeatNumber } from './types';

const ROOM_KEY_PREFIX = 'room:';
const RESUME_KEY_PREFIX = 'resume:';

export interface ResumeRecord {
  roomId: string;
  seat: SeatNumber;
  nickname: string;
  activeSocketId?: string;
}

export const redisClient = new Redis(config.redisUrl, {
  retryStrategy: (times) => Math.min(times * 100, 2000),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true
});

redisClient.on('error', (err) => {
  logger.error({ err }, 'Redis error');
});

redisClient.on('connect', () => {
  logger.info('Redis connected');
});

function roomKey(roomId: string): string {
  return `${ROOM_KEY_PREFIX}${roomId}`;
}

function resumeKey(jti: string): string {
  return `${RESUME_KEY_PREFIX}${jti}`;
}

export async function saveRoom(room: RoomState): Promise<void> {
  const key = roomKey(room.id);
  const payload = JSON.stringify(room);

  if (room.pendingDestroyAt) {
    const ttlSeconds = Math.max(1, Math.ceil((room.pendingDestroyAt - Date.now()) / 1000));
    await redisClient.set(key, payload, 'EX', ttlSeconds);
    return;
  }

  await redisClient.set(key, payload);
}

export async function loadRoom(roomId: string): Promise<RoomState | null> {
  const raw = await redisClient.get(roomKey(roomId));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as RoomState;
  } catch (error) {
    logger.error({ err: error, roomId }, 'Failed to parse room JSON');
    return null;
  }
}

export async function deleteRoom(roomId: string): Promise<void> {
  await redisClient.del(roomKey(roomId));
}

export async function countActiveRooms(): Promise<number> {
  const keys = await redisClient.keys(`${ROOM_KEY_PREFIX}*`);
  if (keys.length === 0) {
    return 0;
  }

  const roomValues = await redisClient.mget(keys);
  let count = 0;

  for (const raw of roomValues) {
    if (!raw) {
      continue;
    }

    try {
      const room = JSON.parse(raw) as RoomState;
      if (!room.pendingDestroyAt) {
        count += 1;
      }
    } catch {
      continue;
    }
  }

  return count;
}

export async function saveResumeRecord(jti: string, value: ResumeRecord): Promise<void> {
  await redisClient.set(resumeKey(jti), JSON.stringify(value), 'EX', 3600);
}

export async function loadResumeRecord(jti: string): Promise<ResumeRecord | null> {
  const raw = await redisClient.get(resumeKey(jti));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ResumeRecord;
  } catch {
    return null;
  }
}

export async function deleteResumeRecord(jti: string): Promise<void> {
  await redisClient.del(resumeKey(jti));
}

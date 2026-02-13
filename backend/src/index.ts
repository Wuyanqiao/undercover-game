import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { logger } from './logger';
import { redisClient } from './redis';
import { setupSocketHandlers } from './socket/handlers';

const app = Fastify({
  logger: logger as any
});

app.get('/api/health', async () => {
  return {
    status: 'OK',
    version: '1.0.0',
    timestamp: Date.now()
  };
});

async function bootstrap(): Promise<void> {
  await app.register(cors, {
    origin: true,
    credentials: true
  });

  await redisClient.ping();

  const io = new SocketIOServer(app.server, {
    path: '/socket.io',
    cors: {
      origin: true,
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

  setupSocketHandlers(io);

  await app.listen({
    host: '0.0.0.0',
    port: config.port
  });

  logger.info({ port: config.port }, 'Backend started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await io.close();
    await app.close();
    await redisClient.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'Bootstrap failed');
  process.exit(1);
});

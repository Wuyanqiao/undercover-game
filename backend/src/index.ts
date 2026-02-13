import dotenv from 'dotenv';
dotenv.config();

import fastify from 'fastify';
import cors from '@fastify/cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { logger } from './logger';
import { redisClient } from './redis';
import { setupSocketHandlers } from './socket/handlers';

const app = fastify({
  logger: logger as any
});

const httpServer = createServer(app.server);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  path: '/socket.io',
  transports: ['websocket', 'polling']
});

// Health check endpoint
app.get('/api/health', async () => {
  return {
    status: 'OK',
    version: '1.0.0',
    timestamp: Date.now()
  };
});

async function start() {
  try {
    // Register CORS
    await app.register(cors, {
      origin: true,
      credentials: true
    });

    // Test Redis connection
    await redisClient.ping();
    logger.info('Redis connected successfully');

    // Setup Socket.IO handlers
    setupSocketHandlers(io);

    // Start server
    const port = config.port;
    httpServer.listen(port, '0.0.0.0', () => {
      logger.info(`Server listening on port ${port}`);
    });
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  io.close();
  httpServer.close();
  await redisClient.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  io.close();
  httpServer.close();
  await redisClient.quit();
  process.exit(0);
});

start();

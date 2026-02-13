import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Room, Player, SeatNumber, GamePhase } from '../types';
import { config } from '../config';
import { logger } from '../logger';
import { redisClient, storeResumeToken, getResumeTokenData, deleteResumeToken, incrementActiveRooms } from '../redis';
import { aiClient } from '../ai/client';
import * as GameLogic from '../game/logic';

// In-memory room cache (short-term)
const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, { roomId: string; seat: SeatNumber }>();

// Rate limiting
const socketMessageCounts = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(socketId: string): boolean {
  const now = Date.now();
  const limit = { max: 3, window: 2000 }; // 3 messages per 2 seconds
  
  let record = socketMessageCounts.get(socketId);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + limit.window };
    socketMessageCounts.set(socketId, record);
    return true;
  }

  if (record.count >= limit.max) {
    return false;
  }

  record.count++;
  return true;
}

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateResumeToken(roomId: string, seat: SeatNumber, nickname: string): string {
  const token = jwt.sign(
    { roomId, seat, nickname, jti: uuidv4() },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
  storeResumeToken(token, roomId, seat, nickname);
  return token;
}

async function saveRoomToRedis(room: Room): Promise<void> {
  await redisClient.setex(
    `room:${room.id}`,
    600, // 10 minutes expiry
    JSON.stringify({
      ...room,
      players: Array.from(room.players.entries()),
      votes: Array.from(room.votes.entries())
    })
  );
}

async function loadRoomFromRedis(roomId: string): Promise<Room | null> {
  const data = await redisClient.get(`room:${roomId}`);
  if (!data) return null;

  const parsed = JSON.parse(data);
  const room: Room = {
    ...parsed,
    players: new Map(parsed.players),
    votes: new Map(parsed.votes)
  };
  return room;
}

async function broadcastRoomState(room: Room): Promise<void> {
  await saveRoomToRedis(room);
  
  // Get all sockets in this room
  const roomSockets = Array.from(socketToRoom.entries())
    .filter(([, data]) => data.roomId === room.id)
    .map(([socketId]) => socketId);

  for (const socketId of roomSockets) {
    const socketData = socketToRoom.get(socketId);
    if (socketData) {
      const ioServer = global.io as Server;
      const socket = ioServer.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('room:state', GameLogic.getVisibleState(room, socketData.seat));
      }
    }
  }
}

async function handleAIActions(room: Room, io: Server): Promise<void> {
  if (room.phase === 'SPEAKING' && room.currentSpeaker) {
    const player = room.players.get(room.currentSpeaker);
    if (player?.isAI && player.isAlive) {
      // AI speaks
      try {
        const speech = await aiClient.generateSpeech({
          mySeat: player.seat,
          myRole: player.role!,
          myWord: player.word!,
          round: room.round,
          speeches: room.speeches,
          aliveSeats: GameLogic.getAliveSeats(room)
        });

        GameLogic.recordSpeech(room, player.seat, speech);
        io.to(`room:${room.id}`).emit('game:speech', {
          seat: player.seat,
          text: speech,
          round: room.round
        });

        // Move to next speaker
        const nextSpeaker = GameLogic.getNextSpeaker(room);
        if (nextSpeaker) {
          room.currentSpeaker = nextSpeaker;
          room.deadlineTs = Date.now() + config.speechTimeoutSeconds * 1000;
          await broadcastRoomState(room);
          
          // Recursively handle if next is also AI
          setTimeout(() => handleAIActions(room, io), 1000);
        } else {
          // End speaking phase
          room.deadlineTs = Date.now() + config.voteTimeoutSeconds * 1000;
          GameLogic.startVotingPhase(room);
          await broadcastRoomState(room);
          
          // Trigger AI votes
          setTimeout(() => handleAIVoting(room, io), 1000);
        }
      } catch (error) {
        logger.error(error, 'AI speech error');
      }
    }
  }
}

async function handleAIVoting(room: Room, io: Server): Promise<void> {
  if (room.phase !== 'VOTING') return;

  const alivePlayers = GameLogic.getAlivePlayers(room);
  const aiPlayers = alivePlayers.filter(p => p.isAI);

  for (const ai of aiPlayers) {
    // Check if already voted
    if (room.votes.has(ai.seat)) continue;

    try {
      const vote = await aiClient.generateVote({
        mySeat: ai.seat,
        myRole: ai.role!,
        myWord: ai.word!,
        round: room.round,
        speeches: room.speeches,
        aliveSeats: GameLogic.getAliveSeats(room)
      });

      GameLogic.recordVote(room, ai.seat, vote as SeatNumber);
    } catch (error) {
      logger.error(error, 'AI vote error');
      // AI abstains on error
      GameLogic.recordVote(room, ai.seat, 0);
    }
  }

  await broadcastRoomState(room);

  // Check if all alive players have voted
  const votedCount = Array.from(room.votes.keys()).filter(
    seat => room.players.get(seat)?.isAlive
  ).length;
  
  if (votedCount >= alivePlayers.length) {
    await resolveVoting(room, io);
  }
}

async function resolveVoting(room: Room, io: Server, isTiebreak = false): Promise<void> {
  const result = GameLogic.calculateVoteResult(room);

  io.to(`room:${room.id}`).emit('game:vote:result', {
    tally: Array.from(result.tally.entries()),
    eliminatedSeat: result.eliminatedSeat,
    round: room.round,
    isTiebreak
  });

  if (result.isTie) {
    // Tiebreak vote
    room.votes.clear();
    room.deadlineTs = Date.now() + config.tiebreakTimeoutSeconds * 1000;
    await broadcastRoomState(room);
    
    // Trigger AI votes for tiebreak
    setTimeout(() => handleAIVoting(room, io), 1000);
    return;
  }

  if (result.eliminatedSeat) {
    GameLogic.eliminatePlayer(room, result.eliminatedSeat);
    
    // Check game end
    const endCheck = GameLogic.checkGameEnd(room);
    if (endCheck.ended) {
      GameLogic.endGame(room);
      
      // Reveal all info
      const reveal = {
        rolesBySeat: Array.from(room.players.entries()).map(([seat, p]) => ({
          seat,
          role: p.role,
          isAlive: p.isAlive
        })),
        words: {
          civilian: room.civilianWord,
          undercover: room.undercoverWord
        }
      };

      io.to(`room:${room.id}`).emit('game:end', {
        winner: endCheck.winner,
        reveal
      });
    } else {
      // Next round
      GameLogic.advanceRound(room);
      room.deadlineTs = Date.now() + config.speechTimeoutSeconds * 1000;
      
      // Trigger AI speech if first speaker is AI
      setTimeout(() => handleAIActions(room, io), 1000);
    }
  }

  await broadcastRoomState(room);
}

export function setupSocketHandlers(io: Server): void {
  global.io = io;

  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');

    // Handle resume with token
    socket.on('room:resume', async ({ token }: { token: string }) => {
      try {
        const tokenData = await getResumeTokenData(token);
        if (!tokenData) {
          socket.emit('room:error', { message: '恢复令牌已过期', code: 'TOKEN_EXPIRED' });
          return;
        }

        const room = await loadRoomFromRedis(tokenData.roomId);
        if (!room) {
          socket.emit('room:error', { message: '房间不存在', code: 'ROOM_NOT_FOUND' });
          return;
        }

        // Update player's socket
        const player = room.players.get(tokenData.seat);
        if (player && !player.isAI) {
          player.socketId = socket.id;
          rooms.set(room.id, room);
          socketToRoom.set(socket.id, { roomId: room.id, seat: tokenData.seat });
          socket.join(`room:${room.id}`);

          // Delete old token and issue new one
          await deleteResumeToken(token);
          const newToken = generateResumeToken(room.id, tokenData.seat, tokenData.nickname);

          socket.emit('room:joined', { 
            roomId: room.id, 
            seat: tokenData.seat, 
            resumeToken: newToken 
          });
          socket.emit('room:state', GameLogic.getVisibleState(room, tokenData.seat));
          await broadcastRoomState(room);
        }
      } catch (error) {
        logger.error(error, 'Resume error');
        socket.emit('room:error', { message: '恢复失败', code: 'RESUME_ERROR' });
      }
    });

    // Create room
    socket.on('room:create', async ({ nickname }: { nickname: string }) => {
      if (!checkRateLimit(socket.id)) {
        socket.emit('room:error', { message: '操作过于频繁', code: 'RATE_LIMIT' });
        return;
      }

      // Check room limit
      const canCreate = await incrementActiveRooms();
      if (!canCreate) {
        socket.emit('room:error', { message: '服务器房间已满，请稍后再试', code: 'ROOM_LIMIT' });
        return;
      }

      const roomId = generateRoomId();
      const room = GameLogic.createRoom(roomId, nickname);
      
      const player = room.players.get(1)!;
      player.socketId = socket.id;

      rooms.set(roomId, room);
      socketToRoom.set(socket.id, { roomId, seat: 1 });
      socket.join(`room:${roomId}`);

      const resumeToken = generateResumeToken(roomId, 1, nickname);
      await saveRoomToRedis(room);

      socket.emit('room:created', { roomId });
      socket.emit('room:joined', { roomId, seat: 1, resumeToken });
      socket.emit('room:state', GameLogic.getVisibleState(room, 1));
    });

    // Join room
    socket.on('room:join', async ({ roomId, nickname }: { roomId: string; nickname: string }) => {
      if (!checkRateLimit(socket.id)) {
        socket.emit('room:error', { message: '操作过于频繁', code: 'RATE_LIMIT' });
        return;
      }

      let room = rooms.get(roomId) || await loadRoomFromRedis(roomId);
      
      if (!room) {
        socket.emit('room:error', { message: '房间不存在', code: 'ROOM_NOT_FOUND' });
        return;
      }

      if (room.phase !== 'LOBBY') {
        socket.emit('room:error', { message: '游戏已经开始', code: 'GAME_STARTED' });
        return;
      }

      const player = GameLogic.addPlayer(room, nickname, socket.id);
      if (!player) {
        socket.emit('room:error', { message: '房间已满', code: 'ROOM_FULL' });
        return;
      }

      rooms.set(roomId, room);
      socketToRoom.set(socket.id, { roomId, seat: player.seat });
      socket.join(`room:${roomId}`);

      const resumeToken = generateResumeToken(roomId, player.seat, nickname);
      await saveRoomToRedis(room);

      socket.emit('room:joined', { roomId, seat: player.seat, resumeToken });
      socket.emit('room:state', GameLogic.getVisibleState(room, player.seat));
      await broadcastRoomState(room);
    });

    // Leave room
    socket.on('room:leave', async () => {
      const data = socketToRoom.get(socket.id);
      if (!data) return;

      const { roomId, seat } = data;
      const room = rooms.get(roomId);
      
      if (room) {
        GameLogic.removePlayer(room, seat);
        
        // If no human players left, schedule room deletion
        const humanPlayers = Array.from(room.players.values()).filter(p => !p.isAI);
        if (humanPlayers.length === 0) {
          rooms.delete(roomId);
          await redisClient.del(`room:${roomId}`);
        } else {
          await broadcastRoomState(room);
          await saveRoomToRedis(room);
        }
      }

      socketToRoom.delete(socket.id);
      socket.leave(`room:${roomId}`);
    });

    // Start game
    socket.on('game:start', async () => {
      if (!checkRateLimit(socket.id)) {
        socket.emit('room:error', { message: '操作过于频繁', code: 'RATE_LIMIT' });
        return;
      }

      const data = socketToRoom.get(socket.id);
      if (!data) return;

      const { roomId, seat } = data;
      const room = rooms.get(roomId);
      
      if (!room || room.hostSeat !== seat) {
        socket.emit('room:error', { message: '只有房主可以开始游戏', code: 'NOT_HOST' });
        return;
      }

      const check = GameLogic.canStartGame(room);
      if (!check.canStart) {
        socket.emit('room:error', { message: check.reason, code: 'CANNOT_START' });
        return;
      }

      // Add AI players to fill to 4
      GameLogic.addAIPlayers(room);
      
      // Deal cards
      GameLogic.dealCards(room);
      
      // Start speaking phase
      GameLogic.startSpeakingPhase(room);
      room.deadlineTs = Date.now() + config.speechTimeoutSeconds * 1000;

      await broadcastRoomState(room);

      // Trigger AI if first speaker is AI
      setTimeout(() => handleAIActions(room, io), 1000);
    });

    // Speak
    socket.on('game:speak', async ({ text }: { text: string }) => {
      if (!checkRateLimit(socket.id)) {
        socket.emit('room:error', { message: '操作过于频繁', code: 'RATE_LIMIT' });
        return;
      }

      const data = socketToRoom.get(socket.id);
      if (!data) return;

      const { roomId, seat } = data;
      const room = rooms.get(roomId);
      
      if (!room || room.phase !== 'SPEAKING' || room.currentSpeaker !== seat) {
        socket.emit('room:error', { message: '现在不是你的回合', code: 'NOT_YOUR_TURN' });
        return;
      }

      GameLogic.recordSpeech(room, seat, text);
      io.to(`room:${roomId}`).emit('game:speech', {
        seat,
        text,
        round: room.round
      });

      // Move to next speaker
      const nextSpeaker = GameLogic.getNextSpeaker(room);
      if (nextSpeaker) {
        room.currentSpeaker = nextSpeaker;
        room.deadlineTs = Date.now() + config.speechTimeoutSeconds * 1000;
        await broadcastRoomState(room);
        
        // Check if next is AI
        setTimeout(() => handleAIActions(room, io), 100);
      } else {
        // End speaking phase
        room.deadlineTs = Date.now() + config.voteTimeoutSeconds * 1000;
        GameLogic.startVotingPhase(room);
        await broadcastRoomState(room);
        
        // Trigger AI votes
        setTimeout(() => handleAIVoting(room, io), 1000);
      }
    });

    // Vote
    socket.on('game:vote', async ({ toSeat }: { toSeat: number }) => {
      if (!checkRateLimit(socket.id)) {
        socket.emit('room:error', { message: '操作过于频繁', code: 'RATE_LIMIT' });
        return;
      }

      const data = socketToRoom.get(socket.id);
      if (!data) return;

      const { roomId, seat } = data;
      const room = rooms.get(roomId);
      
      if (!room || room.phase !== 'VOTING') {
        socket.emit('room:error', { message: '现在不是投票阶段', code: 'NOT_VOTING_PHASE' });
        return;
      }

      // Validate vote target
      if (toSeat !== 0) {
        const target = room.players.get(toSeat as SeatNumber);
        if (!target || !target.isAlive) {
          socket.emit('room:error', { message: '无效的目标', code: 'INVALID_TARGET' });
          return;
        }
      }

      GameLogic.recordVote(room, seat, toSeat as SeatNumber);
      await broadcastRoomState(room);

      // Check if all voted
      const alivePlayers = GameLogic.getAlivePlayers(room);
      const votedCount = Array.from(room.votes.keys()).filter(
        s => room.players.get(s)?.isAlive
      ).length;

      if (votedCount >= alivePlayers.length) {
        await resolveVoting(room, io);
      }
    });

    // Ping for keepalive
    socket.on('game:ping', () => {
      socket.emit('game:pong', { timestamp: Date.now() });
    });

    // Disconnect handling
    socket.on('disconnect', async () => {
      logger.info({ socketId: socket.id }, 'Client disconnected');
      
      const data = socketToRoom.get(socket.id);
      if (data) {
        const { roomId, seat } = data;
        const room = rooms.get(roomId);
        
        if (room) {
          const player = room.players.get(seat);
          if (player && !player.isAI) {
            // Keep player in room for reconnection, just clear socket
            player.socketId = undefined;
            await saveRoomToRedis(room);
          }
        }
        
        socketToRoom.delete(socket.id);
      }
    });
  });

  // Cleanup expired rooms periodically
  setInterval(async () => {
    for (const [roomId, room] of rooms.entries()) {
      // Check if room has been inactive for too long
      const lastActivity = Date.now() - room.updatedAt;
      const humanPlayers = Array.from(room.players.values()).filter(p => !p.isAI);
      
      if (humanPlayers.length === 0 && lastActivity > 60000) {
        // Remove empty rooms after 1 minute
        rooms.delete(roomId);
        await redisClient.del(`room:${roomId}`);
        logger.info({ roomId }, 'Cleaned up empty room');
      } else if (lastActivity > 10 * 60 * 1000) {
        // Remove inactive rooms after 10 minutes
        rooms.delete(roomId);
        await redisClient.del(`room:${roomId}`);
        logger.info({ roomId }, 'Cleaned up inactive room');
      }
    }
  }, 60000); // Run every minute
}

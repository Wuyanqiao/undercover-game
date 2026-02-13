import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Server, Socket } from 'socket.io';
import { aiClient } from '../ai/client';
import { config } from '../config';
import * as Game from '../game/logic';
import { logger } from '../logger';
import {
  countActiveRooms,
  deleteResumeRecord,
  deleteRoom,
  loadResumeRecord,
  loadRoom,
  saveResumeRecord,
  saveRoom
} from '../redis';
import { AIContext, GameEndPayload, RoomState, SeatNumber, VoteTarget, VoteResultPayload } from '../types';

interface SocketSession {
  roomId: string;
  seat: SeatNumber;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

interface ResumeTokenPayload extends jwt.JwtPayload {
  roomId: string;
  seat: SeatNumber;
  nickname: string;
  jti: string;
}

const roomCache = new Map<string, RoomState>();
const roomTimers = new Map<string, NodeJS.Timeout>();
const socketSessions = new Map<string, SocketSession>();
const rateWindows = new Map<string, RateWindow>();
const aiSpeakingLocks = new Set<string>();
const aiVotingLocks = new Set<string>();

const RATE_LIMIT_WINDOW_MS = 2000;
const RATE_LIMIT_MAX = 3;
const ROOM_IDLE_DESTROY_MS = config.roomTimeoutMinutes * 60 * 1000;

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function ensureRoomShape(room: RoomState): void {
  room.targetPlayerCount = Game.normalizeTargetPlayerCount(room.targetPlayerCount ?? Game.DEFAULT_TARGET_PLAYER_COUNT);
}

function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

function now(): number {
  return Date.now();
}

function normalizeRoomId(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function normalizeNickname(input: string): string {
  return Game.sanitizeNickname(input ?? '');
}

function allowSocketMessage(socketId: string): boolean {
  const record = rateWindows.get(socketId);
  const currentTs = now();
  if (!record || currentTs >= record.resetAt) {
    rateWindows.set(socketId, {
      count: 1,
      resetAt: currentTs + RATE_LIMIT_WINDOW_MS
    });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count += 1;
  return true;
}

function emitError(socket: Socket, message: string, code: string): void {
  socket.emit('room:error', { message, code });
}

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function emitPhase(io: Server, room: RoomState): void {
  io.to(roomChannel(room.id)).emit('game:phase', {
    phase: room.phase,
    round: room.round,
    deadlineTs: room.deadlineTs
  });
}

async function getRoom(roomId: string): Promise<RoomState | null> {
  const cached = roomCache.get(roomId);
  if (cached) {
    ensureRoomShape(cached);
    return cached;
  }

  const loaded = await loadRoom(roomId);
  if (!loaded) {
    return null;
  }

  ensureRoomShape(loaded);
  roomCache.set(roomId, loaded);
  return loaded;
}

async function persistRoom(room: RoomState): Promise<void> {
  ensureRoomShape(room);
  roomCache.set(room.id, room);
  await saveRoom(room);
}

async function emitRoomState(io: Server, room: RoomState): Promise<void> {
  const sockets = io.sockets.adapter.rooms.get(roomChannel(room.id));
  if (!sockets) {
    return;
  }

  for (const socketId of sockets) {
    const session = socketSessions.get(socketId);
    if (!session || session.roomId !== room.id) {
      continue;
    }
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      continue;
    }

    socket.emit('room:state', Game.buildVisibleState(room, session.seat));
  }
}

async function syncAndBroadcast(io: Server, room: RoomState, emitPhaseEvent = false): Promise<void> {
  await persistRoom(room);
  await emitRoomState(io, room);
  if (emitPhaseEvent) {
    emitPhase(io, room);
  }
}

function clearRoomTimer(roomId: string): void {
  const timer = roomTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    roomTimers.delete(roomId);
  }
}

function scheduleRoomDeadline(io: Server, room: RoomState): void {
  clearRoomTimer(room.id);

  if (!room.deadlineTs) {
    return;
  }

  const delay = Math.max(10, room.deadlineTs - now());
  const timer = setTimeout(() => {
    void onRoomDeadline(io, room.id);
  }, delay);
  roomTimers.set(room.id, timer);
}

function clearPendingDestroy(room: RoomState): void {
  if (room.pendingDestroyAt) {
    room.pendingDestroyAt = undefined;
  }
}

function refreshPendingDestroy(room: RoomState): void {
  if (Game.getHumanCount(room) === 0) {
    if (!room.pendingDestroyAt) {
      room.pendingDestroyAt = now() + ROOM_IDLE_DESTROY_MS;
    }
    return;
  }
  room.pendingDestroyAt = undefined;
}

async function destroyRoom(io: Server, roomId: string): Promise<void> {
  clearRoomTimer(roomId);

  const sockets = io.sockets.adapter.rooms.get(roomChannel(roomId));
  if (sockets) {
    for (const socketId of sockets) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        emitError(socket, '房间已关闭', 'ROOM_CLOSED');
        socket.leave(roomChannel(roomId));
      }
      socketSessions.delete(socketId);
    }
  }

  roomCache.delete(roomId);
  await deleteRoom(roomId);
}

function buildAIContext(room: RoomState, seat: SeatNumber): AIContext {
  const player = Game.getPlayer(room, seat);
  if (!player || !player.role || !player.word) {
    throw new Error(`AI context missing role/word for seat ${seat}`);
  }

  return {
    mySeat: seat,
    myRole: player.role,
    myWord: player.word,
    round: room.round,
    speeches: room.speeches,
    aliveSeats: Game.getAliveSeats(room)
  };
}

async function issueResumeToken(
  room: RoomState,
  seat: SeatNumber,
  nickname: string,
  socketId: string
): Promise<string> {
  const player = Game.getPlayer(room, seat);
  if (!player) {
    throw new Error('Cannot issue token: player missing');
  }

  if (player.resumeJti) {
    await deleteResumeRecord(player.resumeJti);
  }

  const jti = randomUUID();
  const token = jwt.sign(
    {
      roomId: room.id,
      seat,
      nickname,
      jti
    },
    config.jwtSecret,
    { expiresIn: '1h' }
  );

  player.resumeJti = jti;
  await saveResumeRecord(jti, {
    roomId: room.id,
    seat,
    nickname,
    activeSocketId: socketId
  });

  return token;
}

function verifyResumeToken(rawToken: string): ResumeTokenPayload | null {
  try {
    const decoded = jwt.verify(rawToken, config.jwtSecret);
    if (!decoded || typeof decoded !== 'object') {
      return null;
    }

    const payload = decoded as ResumeTokenPayload;
    if (!payload.roomId || !payload.seat || !payload.jti || !payload.nickname) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function bindSocketToRoom(socket: Socket, room: RoomState, seat: SeatNumber): void {
  socketSessions.set(socket.id, { roomId: room.id, seat });
  socket.join(roomChannel(room.id));
  Game.markPlayerConnected(room, seat, socket.id);
}

function unbindSocket(socket: Socket): SocketSession | null {
  const session = socketSessions.get(socket.id);
  if (!session) {
    return null;
  }

  socketSessions.delete(socket.id);
  socket.leave(roomChannel(session.roomId));
  return session;
}

async function startGameRound(io: Server, room: RoomState): Promise<void> {
  Game.fillAIToTarget(room);
  Game.dealRoles(room);
  await syncAndBroadcast(io, room, true);

  Game.beginSpeakingPhase(room, 1);
  room.deadlineTs = now() + config.speechTimeoutSeconds * 1000;
  await syncAndBroadcast(io, room, true);
  scheduleRoomDeadline(io, room);
  await processAISpeaking(io, room.id);
}

async function beginVoting(io: Server, room: RoomState, candidates: SeatNumber[] = []): Promise<void> {
  Game.beginVotingPhase(room, candidates);
  room.deadlineTs = now() + (candidates.length > 0 ? config.tiebreakTimeoutSeconds : config.voteTimeoutSeconds) * 1000;

  await syncAndBroadcast(io, room, true);
  scheduleRoomDeadline(io, room);
  await processAIVotes(io, room.id);
}

async function submitSpeech(io: Server, room: RoomState, seat: SeatNumber, text: string): Promise<void> {
  if (room.phase !== 'SPEAKING' || room.currentSpeaker !== seat) {
    return;
  }

  const speech = Game.appendSpeech(room, seat, text);
  io.to(roomChannel(room.id)).emit('game:speech', {
    seat: speech.seat,
    text: speech.text,
    round: speech.round
  });

  const nextSpeaker = Game.moveToNextSpeaker(room);
  if (nextSpeaker) {
    room.deadlineTs = now() + config.speechTimeoutSeconds * 1000;
    await syncAndBroadcast(io, room, true);
    scheduleRoomDeadline(io, room);
    await processAISpeaking(io, room.id);
    return;
  }

  await beginVoting(io, room);
}

async function resolveVoting(io: Server, room: RoomState): Promise<void> {
  if (room.phase !== 'VOTING') {
    return;
  }

  room.phase = 'RESOLVE';
  room.deadlineTs = undefined;
  await syncAndBroadcast(io, room, true);
  clearRoomTimer(room.id);

  const { tally, topSeats } = Game.tallyVotes(room);
  const inTieBreak = room.tieBreak.active;

  if (topSeats.length > 1 && !inTieBreak) {
    const tiePayload: VoteResultPayload = {
      tally,
      eliminatedSeat: null,
      round: room.round,
      tie: true,
      tieBreak: false
    };
    io.to(roomChannel(room.id)).emit('game:vote:result', tiePayload);

    await beginVoting(io, room, topSeats);
    return;
  }

  let eliminatedSeat: SeatNumber;
  if (topSeats.length > 1) {
    eliminatedSeat = topSeats[Math.floor(Math.random() * topSeats.length)];
  } else {
    const fallbackSeat = Game.getAliveSeats(room)[0];
    if (!topSeats[0] && !fallbackSeat) {
      return;
    }
    eliminatedSeat = (topSeats[0] ?? fallbackSeat) as SeatNumber;
  }

  Game.eliminatePlayer(room, eliminatedSeat);

  const resultPayload: VoteResultPayload = {
    tally,
    eliminatedSeat,
    round: room.round,
    tie: topSeats.length > 1,
    tieBreak: inTieBreak
  };
  io.to(roomChannel(room.id)).emit('game:vote:result', resultPayload);

  const winner = Game.checkWinner(room);
  if (winner) {
    Game.beginEndPhase(room, winner);
    await syncAndBroadcast(io, room, true);

    const gameEnd: GameEndPayload = {
      winner,
      reveal: Game.buildReveal(room)
    };
    io.to(roomChannel(room.id)).emit('game:end', gameEnd);
    return;
  }

  Game.beginSpeakingPhase(room, room.round + 1);
  room.deadlineTs = now() + config.speechTimeoutSeconds * 1000;
  await syncAndBroadcast(io, room, true);
  scheduleRoomDeadline(io, room);
  await processAISpeaking(io, room.id);
}

async function processAISpeaking(io: Server, roomId: string): Promise<void> {
  if (aiSpeakingLocks.has(roomId)) {
    return;
  }
  aiSpeakingLocks.add(roomId);

  try {
    while (true) {
      const room = await getRoom(roomId);
      if (!room || room.phase !== 'SPEAKING' || !room.currentSpeaker) {
        break;
      }

      const player = Game.getPlayer(room, room.currentSpeaker);
      if (!player || !player.isAlive || !player.isAI) {
        break;
      }

      let speech = '我先说一个模糊线索。';
      try {
        speech = await aiClient.generateSpeech(buildAIContext(room, player.seat));
      } catch (error) {
        logger.warn({ err: error, roomId, seat: player.seat }, 'AI speech failed, fallback used');
      }

      await submitSpeech(io, room, player.seat, speech);
    }
  } finally {
    aiSpeakingLocks.delete(roomId);
  }
}

async function processAIVotes(io: Server, roomId: string): Promise<void> {
  if (aiVotingLocks.has(roomId)) {
    return;
  }
  aiVotingLocks.add(roomId);

  try {
    const room = await getRoom(roomId);
    if (!room || room.phase !== 'VOTING') {
      return;
    }

    const alivePlayers = Game.getAlivePlayers(room);
    for (const player of alivePlayers) {
      if (!player.isAI) {
        continue;
      }
      if (room.votes[player.seat] !== undefined) {
        continue;
      }

      let vote: VoteTarget = 0;
      try {
        vote = await aiClient.generateVote(buildAIContext(room, player.seat));
      } catch (error) {
        logger.warn({ err: error, roomId, seat: player.seat }, 'AI vote failed, fallback used');
      }

      if (!Game.isValidVoteTarget(room, vote)) {
        vote = 0;
      }

      Game.recordVote(room, player.seat, vote);
    }

    await syncAndBroadcast(io, room);

    if (Game.allAlivePlayersVoted(room)) {
      await resolveVoting(io, room);
    }
  } finally {
    aiVotingLocks.delete(roomId);
  }
}

async function onRoomDeadline(io: Server, roomId: string): Promise<void> {
  const room = await getRoom(roomId);
  if (!room || !room.deadlineTs) {
    return;
  }
  if (room.deadlineTs > now() + 50) {
    scheduleRoomDeadline(io, room);
    return;
  }

  if (room.phase === 'SPEAKING' && room.currentSpeaker) {
    const player = Game.getPlayer(room, room.currentSpeaker);
    if (player?.isAI) {
      await processAISpeaking(io, roomId);
    } else {
      await submitSpeech(io, room, room.currentSpeaker, '（超时）');
    }
    return;
  }

  if (room.phase === 'VOTING') {
    for (const seat of Game.getAliveSeats(room)) {
      if (room.votes[seat] === undefined) {
        Game.recordVote(room, seat, 0);
      }
    }

    await syncAndBroadcast(io, room);
    await resolveVoting(io, room);
  }
}

async function createUniqueRoomId(): Promise<string | null> {
  for (let i = 0; i < 20; i += 1) {
    const candidate = generateRoomCode();
    if (roomCache.has(candidate)) {
      continue;
    }
    const existing = await loadRoom(candidate);
    if (!existing) {
      return candidate;
    }
  }
  return null;
}

export function setupSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id }, 'Socket connected');

    socket.on('room:create', async (payload: { nickname?: string }) => {
      if (!allowSocketMessage(socket.id)) {
        emitError(socket, '操作过于频繁', 'RATE_LIMIT');
        return;
      }

      if (socketSessions.has(socket.id)) {
        emitError(socket, '你已经在房间中，请先离开', 'ALREADY_IN_ROOM');
        return;
      }

      const nickname = normalizeNickname(payload.nickname ?? '');
      if (!nickname) {
        emitError(socket, '昵称不能为空', 'INVALID_NICKNAME');
        return;
      }

      const activeRoomCount = await countActiveRooms();
      if (activeRoomCount >= config.maxRooms) {
        emitError(socket, '当前房间数已达上限，请稍后再试', 'ROOM_LIMIT');
        return;
      }

      const roomId = await createUniqueRoomId();
      if (!roomId) {
        emitError(socket, '创建房间失败，请稍后重试', 'ROOM_CREATE_FAILED');
        return;
      }

      const room = Game.createRoom(roomId, nickname, socket.id);
      clearPendingDestroy(room);
      bindSocketToRoom(socket, room, 1);

      const token = await issueResumeToken(room, 1, nickname, socket.id);
      await syncAndBroadcast(io, room, true);

      socket.emit('room:joined', {
        roomId,
        seat: 1,
        resumeToken: token
      });
    });

    socket.on('room:join', async (payload: { roomId?: string; nickname?: string }) => {
      if (!allowSocketMessage(socket.id)) {
        emitError(socket, '操作过于频繁', 'RATE_LIMIT');
        return;
      }

      if (socketSessions.has(socket.id)) {
        emitError(socket, '你已经在房间中，请先离开', 'ALREADY_IN_ROOM');
        return;
      }

      const roomId = normalizeRoomId(payload.roomId ?? '');
      const nickname = normalizeNickname(payload.nickname ?? '');
      if (!roomId) {
        emitError(socket, '房间号格式错误', 'INVALID_ROOM_ID');
        return;
      }
      if (!nickname) {
        emitError(socket, '昵称不能为空', 'INVALID_NICKNAME');
        return;
      }

      const room = await getRoom(roomId);
      if (!room) {
        emitError(socket, '房间不存在', 'ROOM_NOT_FOUND');
        return;
      }
      if (room.phase !== 'LOBBY') {
        emitError(socket, '游戏已开始，无法加入', 'GAME_ALREADY_STARTED');
        return;
      }

      const player = Game.addHumanPlayer(room, nickname, socket.id);
      if (!player) {
        emitError(socket, '房间已满', 'ROOM_FULL');
        return;
      }

      clearPendingDestroy(room);
      bindSocketToRoom(socket, room, player.seat);

      const token = await issueResumeToken(room, player.seat, nickname, socket.id);
      await syncAndBroadcast(io, room);

      socket.emit('room:joined', {
        roomId,
        seat: player.seat,
        resumeToken: token
      });
    });

    socket.on('room:resume', async (payload: { token?: string }) => {
      const token = payload.token ?? '';
      const decoded = verifyResumeToken(token);
      if (!decoded) {
        emitError(socket, '重连令牌无效', 'RESUME_TOKEN_INVALID');
        return;
      }

      const stored = await loadResumeRecord(decoded.jti);
      if (!stored || stored.roomId !== decoded.roomId || stored.seat !== decoded.seat) {
        emitError(socket, '重连令牌已失效', 'RESUME_TOKEN_EXPIRED');
        return;
      }

      const room = await getRoom(decoded.roomId);
      if (!room) {
        emitError(socket, '房间不存在或已关闭', 'ROOM_NOT_FOUND');
        return;
      }

      const player = Game.getPlayer(room, decoded.seat);
      if (!player || player.isAI || player.resumeJti !== decoded.jti) {
        emitError(socket, '该身份已失效，请重新加入', 'RESUME_REVOKED');
        return;
      }

      if (stored.activeSocketId && stored.activeSocketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(stored.activeSocketId);
        if (oldSocket) {
          emitError(oldSocket, '该身份已在其他设备恢复连接', 'RESUME_REPLACED');
          oldSocket.disconnect(true);
        }
        socketSessions.delete(stored.activeSocketId);
      }

      clearPendingDestroy(room);
      bindSocketToRoom(socket, room, decoded.seat);
      await saveResumeRecord(decoded.jti, {
        ...stored,
        activeSocketId: socket.id
      });

      await syncAndBroadcast(io, room);
      socket.emit('room:joined', {
        roomId: room.id,
        seat: decoded.seat,
        resumeToken: token
      });
    });

    socket.on('room:leave', async () => {
      if (!allowSocketMessage(socket.id)) {
        emitError(socket, '操作过于频繁', 'RATE_LIMIT');
        return;
      }

      const session = unbindSocket(socket);
      if (!session) {
        return;
      }

      const room = await getRoom(session.roomId);
      if (!room) {
        return;
      }

      const leavingPlayer = Game.getPlayer(room, session.seat);
      if (leavingPlayer?.resumeJti) {
        await deleteResumeRecord(leavingPlayer.resumeJti);
        leavingPlayer.resumeJti = undefined;
      }

      Game.removeOrConvertHumanPlayer(room, session.seat);
      refreshPendingDestroy(room);

      await syncAndBroadcast(io, room);

      if (room.phase === 'SPEAKING') {
        await processAISpeaking(io, room.id);
      }
    });

    socket.on('room:target:set', async (payload: { targetPlayerCount?: number }) => {
      if (!allowSocketMessage(socket.id)) {
        emitError(socket, '操作过于频繁', 'RATE_LIMIT');
        return;
      }

      const session = socketSessions.get(socket.id);
      if (!session) {
        emitError(socket, '你还未加入房间', 'NOT_IN_ROOM');
        return;
      }

      const room = await getRoom(session.roomId);
      if (!room) {
        emitError(socket, '房间不存在', 'ROOM_NOT_FOUND');
        return;
      }

      if (room.hostSeat !== session.seat) {
        emitError(socket, '只有房主可以调整人数', 'NOT_HOST');
        return;
      }

      const desired = Number(payload.targetPlayerCount);
      if (!Number.isFinite(desired)) {
        emitError(socket, '人数参数错误', 'INVALID_TARGET_PLAYER_COUNT');
        return;
      }

      const check = Game.canSetTargetPlayerCount(room, desired);
      if (!check.ok) {
        emitError(socket, check.reason ?? '无法调整人数', 'CANNOT_SET_TARGET_PLAYER_COUNT');
        return;
      }

      Game.setTargetPlayerCount(room, desired);
      await syncAndBroadcast(io, room);
    });

    socket.on('game:start', async () => {
      if (!allowSocketMessage(socket.id)) {
        emitError(socket, '操作过于频繁', 'RATE_LIMIT');
        return;
      }

      const session = socketSessions.get(socket.id);
      if (!session) {
        emitError(socket, '你还未加入房间', 'NOT_IN_ROOM');
        return;
      }

      const room = await getRoom(session.roomId);
      if (!room) {
        emitError(socket, '房间不存在', 'ROOM_NOT_FOUND');
        return;
      }

      if (room.hostSeat !== session.seat) {
        emitError(socket, '只有房主可以开始游戏', 'NOT_HOST');
        return;
      }

      const startCheck = Game.canStartGame(room);
      if (!startCheck.ok) {
        emitError(socket, startCheck.reason ?? '无法开始游戏', 'CANNOT_START');
        return;
      }

      await startGameRound(io, room);
    });

    socket.on('game:restart', async () => {
      if (!allowSocketMessage(socket.id)) {
        emitError(socket, '操作过于频繁', 'RATE_LIMIT');
        return;
      }

      const session = socketSessions.get(socket.id);
      if (!session) {
        emitError(socket, '你还未加入房间', 'NOT_IN_ROOM');
        return;
      }

      const room = await getRoom(session.roomId);
      if (!room) {
        emitError(socket, '房间不存在', 'ROOM_NOT_FOUND');
        return;
      }

      if (room.phase !== 'END') {
        emitError(socket, '当前还未结算，不能重开', 'NOT_IN_END_PHASE');
        return;
      }

      if (room.hostSeat !== session.seat) {
        emitError(socket, '只有房主可以选择再来一局', 'NOT_HOST');
        return;
      }

      clearPendingDestroy(room);
      Game.resetRoomForRematch(room);

      const startCheck = Game.canStartGame(room);
      if (!startCheck.ok) {
        await syncAndBroadcast(io, room, true);
        emitError(socket, startCheck.reason ?? '人数不足，无法重开', 'CANNOT_RESTART');
        return;
      }

      await syncAndBroadcast(io, room, true);
      await startGameRound(io, room);
    });

    socket.on('game:speak', async (payload: { text?: string }) => {
      if (!allowSocketMessage(socket.id)) {
        emitError(socket, '操作过于频繁', 'RATE_LIMIT');
        return;
      }

      const session = socketSessions.get(socket.id);
      if (!session) {
        emitError(socket, '你还未加入房间', 'NOT_IN_ROOM');
        return;
      }

      const room = await getRoom(session.roomId);
      if (!room) {
        emitError(socket, '房间不存在', 'ROOM_NOT_FOUND');
        return;
      }

      if (room.phase !== 'SPEAKING' || room.currentSpeaker !== session.seat) {
        emitError(socket, '当前不是你的发言回合', 'NOT_YOUR_TURN');
        return;
      }

      const text = (payload.text ?? '').trim();
      if (!text) {
        emitError(socket, '发言不能为空', 'EMPTY_SPEECH');
        return;
      }

      await submitSpeech(io, room, session.seat, text);
    });

    socket.on('game:vote', async (payload: { toSeat?: number }) => {
      if (!allowSocketMessage(socket.id)) {
        emitError(socket, '操作过于频繁', 'RATE_LIMIT');
        return;
      }

      const session = socketSessions.get(socket.id);
      if (!session) {
        emitError(socket, '你还未加入房间', 'NOT_IN_ROOM');
        return;
      }

      const room = await getRoom(session.roomId);
      if (!room) {
        emitError(socket, '房间不存在', 'ROOM_NOT_FOUND');
        return;
      }

      if (room.phase !== 'VOTING') {
        emitError(socket, '当前不是投票阶段', 'NOT_VOTING_PHASE');
        return;
      }

      const voter = Game.getPlayer(room, session.seat);
      if (!voter || !voter.isAlive) {
        emitError(socket, '你已出局，无法投票', 'ELIMINATED');
        return;
      }

      if (room.votes[session.seat] !== undefined) {
        emitError(socket, '你已经投过票了', 'ALREADY_VOTED');
        return;
      }

      const rawTo = payload.toSeat;
      if (typeof rawTo !== 'number' || !Number.isInteger(rawTo)) {
        emitError(socket, '无效投票目标', 'INVALID_VOTE');
        return;
      }

      const toSeat = (rawTo >= 1 && rawTo <= room.targetPlayerCount ? rawTo : 0) as VoteTarget;
      if (!Game.isValidVoteTarget(room, toSeat)) {
        emitError(socket, '目标不可投票', 'INVALID_TARGET');
        return;
      }

      Game.recordVote(room, session.seat, toSeat);
      await syncAndBroadcast(io, room);

      if (Game.allAlivePlayersVoted(room)) {
        await resolveVoting(io, room);
      }
    });

    socket.on('game:ping', () => {
      socket.emit('game:pong', { ts: now() });
    });

    socket.on('disconnect', async () => {
      logger.info({ socketId: socket.id }, 'Socket disconnected');

      const session = socketSessions.get(socket.id);
      if (!session) {
        return;
      }

      socketSessions.delete(socket.id);

      const room = await getRoom(session.roomId);
      if (!room) {
        return;
      }

      Game.markPlayerDisconnected(room, session.seat);

      const player = Game.getPlayer(room, session.seat);
      if (player?.resumeJti) {
        const record = await loadResumeRecord(player.resumeJti);
        if (record?.activeSocketId === socket.id) {
          await saveResumeRecord(player.resumeJti, {
            ...record,
            activeSocketId: undefined
          });
        }
      }

      await syncAndBroadcast(io, room);
    });
  });

  setInterval(() => {
    const expireBefore = now() - RATE_LIMIT_WINDOW_MS * 2;
    for (const [socketId, record] of rateWindows.entries()) {
      if (record.resetAt < expireBefore) {
        rateWindows.delete(socketId);
      }
    }
  }, 10000);

  setInterval(() => {
    void (async () => {
      const currentTs = now();

      for (const [roomId, room] of roomCache.entries()) {
        if (room.pendingDestroyAt && currentTs >= room.pendingDestroyAt) {
          await destroyRoom(io, roomId);
          continue;
        }

        let changed = false;
        const hasConnectedHuman = room.players.some((player) => !player.isAI && Boolean(player.socketId));
        const humanCount = Game.getHumanCount(room);

        if (humanCount > 0 && !hasConnectedHuman && !room.pendingDestroyAt) {
          room.pendingDestroyAt = currentTs + ROOM_IDLE_DESTROY_MS;
          changed = true;
        }
        if (hasConnectedHuman && room.pendingDestroyAt) {
          room.pendingDestroyAt = undefined;
          changed = true;
        }

        if (room.phase === 'LOBBY') {
          const staleHumans = room.players.filter(
            (player) => !player.isAI && !player.socketId && currentTs - player.lastSeenAt >= ROOM_IDLE_DESTROY_MS
          );

          for (const stale of staleHumans) {
            if (stale.resumeJti) {
              await deleteResumeRecord(stale.resumeJti);
            }
            Game.removeOrConvertHumanPlayer(room, stale.seat);
            changed = true;
          }

          if (staleHumans.length > 0) {
            refreshPendingDestroy(room);
          }
        }

        if (changed) {
          await syncAndBroadcast(io, room);
        }
      }
    })().catch((error) => {
      logger.error({ err: error }, 'Periodic room cleanup failed');
    });
  }, 30000);
}

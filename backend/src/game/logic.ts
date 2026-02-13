import {
  PlayerState,
  RoomState,
  SeatNumber,
  SpeechRecord,
  VoteTarget,
  VisibleState,
  Winner
} from '../types';
import { PickedWordPair, getRandomWordPair } from './words';

export const MIN_PLAYERS_PER_ROOM = 4;
export const MAX_PLAYERS_PER_ROOM = 12;
export const DEFAULT_TARGET_PLAYER_COUNT = 4;

const MAX_NICKNAME_LENGTH = 12;
const MAX_SPEECH_LENGTH = 30;
const MAX_SPEECH_HISTORY = 200;

function now(): number {
  return Date.now();
}

export function sanitizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NICKNAME_LENGTH);
}

function touch(room: RoomState): void {
  room.updatedAt = now();
}

export function normalizeTargetPlayerCount(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TARGET_PLAYER_COUNT;
  }
  const rounded = Math.floor(value);
  if (rounded < MIN_PLAYERS_PER_ROOM) {
    return MIN_PLAYERS_PER_ROOM;
  }
  if (rounded > MAX_PLAYERS_PER_ROOM) {
    return MAX_PLAYERS_PER_ROOM;
  }
  return rounded;
}

function getAllSeats(room: RoomState): SeatNumber[] {
  return Array.from({ length: room.targetPlayerCount }, (_, index) => index + 1);
}

export function createRoom(roomId: string, hostNickname: string, socketId: string, isVoiceRoom = false): RoomState {
  const host: PlayerState = {
    seat: 1,
    nickname: sanitizeNickname(hostNickname),
    isAI: false,
    isAlive: true,
    socketId,
    lastSeenAt: now()
  };

  return {
    id: roomId,
    hostSeat: 1,
    targetPlayerCount: DEFAULT_TARGET_PLAYER_COUNT,
    isLocked: false,
    isVoiceRoom,
    phase: 'LOBBY',
    round: 0,
    players: [host],
    speeches: [],
    votes: {},
    tieBreak: {
      active: false,
      candidates: []
    },
    createdAt: now(),
    updatedAt: now()
  };
}

export function getPlayer(room: RoomState, seat: SeatNumber): PlayerState | undefined {
  return room.players.find((p) => p.seat === seat);
}

export function getHumanPlayers(room: RoomState): PlayerState[] {
  return room.players.filter((p) => !p.isAI);
}

export function getAlivePlayers(room: RoomState): PlayerState[] {
  return room.players.filter((p) => p.isAlive);
}

export function getAliveSeats(room: RoomState): SeatNumber[] {
  return getAlivePlayers(room)
    .map((p) => p.seat)
    .sort((a, b) => a - b);
}

export function getEmptySeats(room: RoomState): SeatNumber[] {
  const used = new Set(room.players.map((p) => p.seat));
  return getAllSeats(room).filter((seat) => !used.has(seat));
}

export function getHumanCount(room: RoomState): number {
  return room.players.filter((p) => !p.isAI).length;
}

export function addHumanPlayer(room: RoomState, nickname: string, socketId: string): PlayerState | null {
  const seat = getEmptySeats(room)[0];
  if (!seat) {
    return null;
  }

  const player: PlayerState = {
    seat,
    nickname: sanitizeNickname(nickname),
    isAI: false,
    isAlive: true,
    socketId,
    lastSeenAt: now()
  };
  room.players.push(player);
  touch(room);
  return player;
}

export function canSetTargetPlayerCount(room: RoomState, nextTarget: number): { ok: boolean; reason?: string } {
  if (room.phase !== 'LOBBY' && room.phase !== 'END') {
    return { ok: false, reason: '当前阶段不可调整人数' };
  }

  const normalized = normalizeTargetPlayerCount(nextTarget);
  const humanCount = getHumanCount(room);
  if (normalized < humanCount) {
    return { ok: false, reason: `目标人数不能小于当前真人数(${humanCount})` };
  }

  const maxHumanSeat = room.players
    .filter((player) => !player.isAI)
    .reduce((max, player) => Math.max(max, player.seat), 0);
  if (normalized < maxHumanSeat) {
    return { ok: false, reason: `目标人数不能小于当前最大真人座位(${maxHumanSeat})` };
  }

  return { ok: true };
}

export function setTargetPlayerCount(room: RoomState, nextTarget: number): void {
  room.targetPlayerCount = normalizeTargetPlayerCount(nextTarget);
  touch(room);
}

export function setRoomLocked(room: RoomState, locked: boolean): void {
  room.isLocked = locked;
  touch(room);
}

export function removeOrConvertHumanPlayer(room: RoomState, seat: SeatNumber): void {
  const index = room.players.findIndex((p) => p.seat === seat && !p.isAI);
  if (index === -1) {
    return;
  }

  const player = room.players[index];
  if (room.phase === 'LOBBY' || room.phase === 'END') {
    room.players.splice(index, 1);
  } else {
    player.isAI = true;
    player.nickname = `AI-${seat}`;
    player.socketId = undefined;
    player.lastSeenAt = now();
  }

  if (room.hostSeat === seat) {
    const nextHost = getHumanPlayers(room)[0] ?? room.players[0];
    if (nextHost) {
      room.hostSeat = nextHost.seat;
    }
  }

  touch(room);
}

export function fillAIToTarget(room: RoomState): void {
  for (const seat of getEmptySeats(room)) {
    room.players.push({
      seat,
      nickname: `AI-${seat}`,
      isAI: true,
      isAlive: true,
      lastSeenAt: now()
    });
  }

  room.players.sort((a, b) => a.seat - b.seat);
  touch(room);
}

export function canStartGame(room: RoomState): { ok: boolean; reason?: string } {
  if (room.phase !== 'LOBBY') {
    return { ok: false, reason: '游戏已经开始' };
  }
  if (room.targetPlayerCount < MIN_PLAYERS_PER_ROOM || room.targetPlayerCount > MAX_PLAYERS_PER_ROOM) {
    return { ok: false, reason: `人数必须在${MIN_PLAYERS_PER_ROOM}-${MAX_PLAYERS_PER_ROOM}` };
  }
  if (getHumanCount(room) < 2) {
    return { ok: false, reason: '至少需要2名真人玩家才能开始' };
  }

  if (room.isVoiceRoom) {
    if (room.players.some((player) => player.isAI)) {
      return { ok: false, reason: '语音房仅支持真人玩家，不能包含AI' };
    }
    if (getHumanCount(room) !== room.targetPlayerCount) {
      return { ok: false, reason: `语音房需满员后开始（当前 ${getHumanCount(room)}/${room.targetPlayerCount}）` };
    }
  }

  return { ok: true };
}

export function dealRoles(room: RoomState, providedWordPair?: PickedWordPair): void {
  const picked = providedWordPair ?? getRandomWordPair(room.lastWordPairKey);
  room.lastWordPairKey = picked.key;
  room.civilianWord = picked.pair.civilian;
  room.undercoverWord = picked.pair.undercover;

  const shuffled = [...room.players];
  const undercoverIndex = Math.floor(Math.random() * shuffled.length);
  const undercoverSeat = shuffled[undercoverIndex].seat;

  for (const player of room.players) {
    player.isAlive = true;
    if (player.seat === undercoverSeat) {
      player.role = 'undercover';
      player.word = picked.pair.undercover;
    } else {
      player.role = 'civilian';
      player.word = picked.pair.civilian;
    }
  }

  room.phase = 'DEAL';
  room.round = 1;
  room.winner = undefined;
  room.tieBreak = { active: false, candidates: [] };
  room.speeches = [];
  room.votes = {};
  room.currentSpeaker = undefined;
  touch(room);
}

export function resetRoomForRematch(room: RoomState): void {
  const humans = room.players.filter((player) => !player.isAI);

  for (const player of humans) {
    player.isAlive = true;
    player.role = undefined;
    player.word = undefined;
  }

  humans.sort((a, b) => a.seat - b.seat);
  room.players = humans;

  if (room.players.length > 0 && !room.players.some((player) => player.seat === room.hostSeat)) {
    room.hostSeat = room.players[0].seat;
  }

  room.phase = 'LOBBY';
  room.round = 0;
  room.speeches = [];
  room.votes = {};
  room.currentSpeaker = undefined;
  room.deadlineTs = undefined;
  room.tieBreak = { active: false, candidates: [] };
  room.winner = undefined;
  room.civilianWord = undefined;
  room.undercoverWord = undefined;

  touch(room);
}

export function beginSpeakingPhase(room: RoomState, round: number): void {
  room.phase = 'SPEAKING';
  room.round = round;
  room.votes = {};
  room.tieBreak = { active: false, candidates: [] };
  room.currentSpeaker = getAliveSeats(room)[0];
  touch(room);
}

export function appendSpeech(room: RoomState, seat: SeatNumber, text: string): SpeechRecord {
  const normalized = text.trim().replace(/\s+/g, ' ').slice(0, MAX_SPEECH_LENGTH) || '（空白）';
  const speech: SpeechRecord = {
    seat,
    text: normalized,
    round: room.round,
    ts: now()
  };

  room.speeches.push(speech);
  if (room.speeches.length > MAX_SPEECH_HISTORY) {
    room.speeches = room.speeches.slice(-MAX_SPEECH_HISTORY);
  }
  touch(room);

  return speech;
}

export function moveToNextSpeaker(room: RoomState): SeatNumber | undefined {
  const aliveSeats = getAliveSeats(room);
  if (!room.currentSpeaker) {
    room.currentSpeaker = aliveSeats[0];
    touch(room);
    return room.currentSpeaker;
  }

  const index = aliveSeats.indexOf(room.currentSpeaker);
  if (index === -1 || index + 1 >= aliveSeats.length) {
    room.currentSpeaker = undefined;
    touch(room);
    return undefined;
  }

  room.currentSpeaker = aliveSeats[index + 1];
  touch(room);
  return room.currentSpeaker;
}

export function beginVotingPhase(room: RoomState, tieBreakCandidates: SeatNumber[] = []): void {
  room.phase = 'VOTING';
  room.currentSpeaker = undefined;
  room.votes = {};
  room.tieBreak = {
    active: tieBreakCandidates.length > 0,
    candidates: tieBreakCandidates
      .filter((seat) => getPlayer(room, seat)?.isAlive)
      .sort((a, b) => a - b)
  };
  touch(room);
}

export function getVoteTargets(room: RoomState): SeatNumber[] {
  if (room.tieBreak.active) {
    return room.tieBreak.candidates.filter((seat) => getPlayer(room, seat)?.isAlive);
  }
  return getAliveSeats(room);
}

export function isValidVoteTarget(room: RoomState, toSeat: VoteTarget): boolean {
  if (toSeat === 0) {
    return true;
  }
  return getVoteTargets(room).includes(toSeat);
}

export function recordVote(room: RoomState, fromSeat: SeatNumber, toSeat: VoteTarget): void {
  room.votes[fromSeat] = toSeat;
  touch(room);
}

export function allAlivePlayersVoted(room: RoomState): boolean {
  const alive = getAliveSeats(room);
  return alive.every((seat) => room.votes[seat] !== undefined);
}

export function tallyVotes(room: RoomState): {
  tally: Partial<Record<SeatNumber, number>>;
  topSeats: SeatNumber[];
  maxVotes: number;
} {
  const targets = getVoteTargets(room);
  const tally: Partial<Record<SeatNumber, number>> = {};

  for (const seat of targets) {
    tally[seat] = 0;
  }

  for (const aliveSeat of getAliveSeats(room)) {
    const vote = room.votes[aliveSeat];
    if (vote !== undefined && vote !== 0 && targets.includes(vote)) {
      tally[vote] = (tally[vote] ?? 0) + 1;
    }
  }

  let maxVotes = 0;
  for (const seat of targets) {
    maxVotes = Math.max(maxVotes, tally[seat] ?? 0);
  }

  const topSeats = targets.filter((seat) => (tally[seat] ?? 0) === maxVotes);
  return { tally, topSeats, maxVotes };
}

export function eliminatePlayer(room: RoomState, seat: SeatNumber): void {
  const player = getPlayer(room, seat);
  if (player) {
    player.isAlive = false;
    touch(room);
  }
}

export function checkWinner(room: RoomState): Winner | null {
  const aliveUndercover = room.players.filter((p) => p.isAlive && p.role === 'undercover').length;
  const aliveCivilian = room.players.filter((p) => p.isAlive && p.role === 'civilian').length;

  if (aliveUndercover === 0) {
    return 'civilian';
  }
  if (aliveUndercover >= aliveCivilian) {
    return 'undercover';
  }
  return null;
}

export function beginEndPhase(room: RoomState, winner: Winner): void {
  room.phase = 'END';
  room.winner = winner;
  room.deadlineTs = undefined;
  room.currentSpeaker = undefined;
  touch(room);
}

export function markPlayerDisconnected(room: RoomState, seat: SeatNumber): void {
  const player = getPlayer(room, seat);
  if (!player) {
    return;
  }
  player.socketId = undefined;
  player.lastSeenAt = now();
  touch(room);
}

export function markPlayerConnected(room: RoomState, seat: SeatNumber, socketId: string): void {
  const player = getPlayer(room, seat);
  if (!player) {
    return;
  }
  player.socketId = socketId;
  player.lastSeenAt = now();
  touch(room);
}

export function buildVisibleState(room: RoomState, viewerSeat?: SeatNumber): VisibleState {
  const me = viewerSeat ? getPlayer(room, viewerSeat) : undefined;

  return {
    roomId: room.id,
    targetPlayerCount: room.targetPlayerCount,
    isLocked: room.isLocked,
    isVoiceRoom: room.isVoiceRoom,
    players: [...room.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat,
        nickname: p.nickname,
        isAI: p.isAI,
        isAlive: p.isAlive,
        connected: p.isAI ? true : Boolean(p.socketId)
      })),
    phase: room.phase,
    round: room.round,
    currentSpeaker: room.currentSpeaker,
    speeches: room.speeches,
    mySeat: me?.seat,
    myRole: me?.role,
    myWord: me?.word,
    isHost: me?.seat === room.hostSeat,
    deadlineTs: room.deadlineTs,
    tieBreakCandidates: room.tieBreak.active ? room.tieBreak.candidates : []
  };
}

export function buildReveal(room: RoomState): {
  rolesBySeat: Array<{
    seat: SeatNumber;
    nickname: string;
    role: 'civilian' | 'undercover';
    isAlive: boolean;
  }>;
  words: {
    civilian: string;
    undercover: string;
  };
} {
  return {
    rolesBySeat: [...room.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat,
        nickname: p.nickname,
        role: (p.role ?? 'civilian') as 'civilian' | 'undercover',
        isAlive: p.isAlive
      })),
    words: {
      civilian: room.civilianWord ?? '',
      undercover: room.undercoverWord ?? ''
    }
  };
}

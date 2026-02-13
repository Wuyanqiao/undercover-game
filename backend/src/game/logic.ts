import {
  PlayerState,
  RoomState,
  SeatNumber,
  SpeechRecord,
  VoteTarget,
  VisibleState,
  Winner
} from '../types';
import { getRandomWordPair } from './words';

export const ALL_SEATS: SeatNumber[] = [1, 2, 3, 4];

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

export function createRoom(roomId: string, hostNickname: string, socketId: string): RoomState {
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
  return ALL_SEATS.filter((seat) => !used.has(seat));
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

export function fillAIToFour(room: RoomState): void {
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
  if (getHumanCount(room) < 2) {
    return { ok: false, reason: '至少需要2名真人玩家才能开始' };
  }
  return { ok: true };
}

export function dealRoles(room: RoomState): void {
  const pair = getRandomWordPair();
  room.civilianWord = pair.civilian;
  room.undercoverWord = pair.undercover;

  const shuffled = [...room.players];
  const undercoverIndex = Math.floor(Math.random() * shuffled.length);
  const undercoverSeat = shuffled[undercoverIndex].seat;

  for (const player of room.players) {
    player.isAlive = true;
    if (player.seat === undercoverSeat) {
      player.role = 'undercover';
      player.word = pair.undercover;
    } else {
      player.role = 'civilian';
      player.word = pair.civilian;
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

import { Room, Player, SeatNumber, GamePhase, SpeechRecord } from '../types';
import { getRandomWordPair } from './words';
import { logger } from '../logger';

const SEATS: SeatNumber[] = [1, 2, 3, 4];

export function createRoom(roomId: string, hostNickname: string): Room {
  const room: Room = {
    id: roomId,
    hostSeat: 1,
    players: new Map(),
    phase: 'LOBBY',
    round: 0,
    speeches: [],
    votes: new Map(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // Add host to seat 1
  const host: Player = {
    seat: 1,
    nickname: hostNickname,
    isAI: false,
    isAlive: true
  };
  room.players.set(1, host);

  return room;
}

export function getNextEmptySeat(room: Room): SeatNumber | null {
  for (const seat of SEATS) {
    if (!room.players.has(seat)) {
      return seat;
    }
  }
  return null;
}

export function addPlayer(room: Room, nickname: string, socketId: string): Player | null {
  const seat = getNextEmptySeat(room);
  if (!seat) {
    return null;
  }

  const player: Player = {
    seat,
    nickname,
    isAI: false,
    isAlive: true,
    socketId
  };
  room.players.set(seat, player);
  room.updatedAt = Date.now();

  return player;
}

export function removePlayer(room: Room, seat: SeatNumber): void {
  room.players.delete(seat);
  room.updatedAt = Date.now();

  // If host leaves, assign new host
  if (seat === room.hostSeat && room.players.size > 0) {
    const firstPlayer = Array.from(room.players.values())[0];
    room.hostSeat = firstPlayer.seat;
  }
}

export function addAIPlayers(room: Room): void {
  const neededAI = 4 - room.players.size;
  let currentSeat = 1;

  for (let i = 0; i < neededAI; i++) {
    // Find next empty seat
    while (room.players.has(currentSeat as SeatNumber)) {
      currentSeat++;
    }

    const aiPlayer: Player = {
      seat: currentSeat as SeatNumber,
      nickname: `AI-${i + 1}`,
      isAI: true,
      isAlive: true
    };
    room.players.set(currentSeat as SeatNumber, aiPlayer);
    currentSeat++;
  }

  room.updatedAt = Date.now();
}

export function dealCards(room: Room): void {
  const wordPair = getRandomWordPair();
  room.civilianWord = wordPair.civilian;
  room.undercoverWord = wordPair.undercover;

  // Assign roles: 1 undercover, 3 civilians
  const players = Array.from(room.players.values());
  const undercoverIndex = Math.floor(Math.random() * players.length);

  players.forEach((player, index) => {
    if (index === undercoverIndex) {
      player.role = 'undercover';
      player.word = wordPair.undercover;
    } else {
      player.role = 'civilian';
      player.word = wordPair.civilian;
    }
  });

  room.phase = 'DEAL';
  room.round = 1;
  room.updatedAt = Date.now();
}

export function getAlivePlayers(room: Room): Player[] {
  return Array.from(room.players.values()).filter(p => p.isAlive);
}

export function getAliveCivilians(room: Room): Player[] {
  return Array.from(room.players.values()).filter(p => p.isAlive && p.role === 'civilian');
}

export function getAliveUndercovers(room: Room): Player[] {
  return Array.from(room.players.values()).filter(p => p.isAlive && p.role === 'undercover');
}

export function startSpeakingPhase(room: Room): void {
  room.phase = 'SPEAKING';
  room.votes.clear();
  room.updatedAt = Date.now();

  // Find first alive player to speak
  const alivePlayers = getAlivePlayers(room);
  if (alivePlayers.length > 0) {
    room.currentSpeaker = alivePlayers[0].seat;
  }
}

export function recordSpeech(room: Room, seat: SeatNumber, text: string): void {
  const speech: SpeechRecord = {
    seat,
    text: text.slice(0, 100), // Limit to 100 chars
    round: room.round,
    timestamp: Date.now()
  };
  room.speeches.push(speech);
  room.updatedAt = Date.now();
}

export function getNextSpeaker(room: Room): SeatNumber | null {
  const aliveSeats = getAlivePlayers(room).map(p => p.seat).sort((a, b) => a - b);
  
  if (!room.currentSpeaker) {
    return aliveSeats[0] || null;
  }

  const currentIndex = aliveSeats.indexOf(room.currentSpeaker);
  const nextIndex = (currentIndex + 1) % aliveSeats.length;
  
  // If we've gone full circle, return null to indicate phase end
  if (nextIndex <= currentIndex) {
    return null;
  }

  return aliveSeats[nextIndex];
}

export function startVotingPhase(room: Room): void {
  room.phase = 'VOTING';
  room.currentSpeaker = undefined;
  room.votes.clear();
  room.updatedAt = Date.now();
}

export function recordVote(room: Room, fromSeat: SeatNumber, toSeat: SeatNumber | 0): void {
  room.votes.set(fromSeat, toSeat);
  room.updatedAt = Date.now();
}

export function getAliveSeats(room: Room): SeatNumber[] {
  return getAlivePlayers(room).map(p => p.seat).sort((a, b) => a - b);
}

export function calculateVoteResult(room: Room): { eliminatedSeat: SeatNumber | null; isTie: boolean; tally: Map<SeatNumber, number> } {
  const tally = new Map<SeatNumber, number>();
  
  // Initialize tally for all alive players
  getAliveSeats(room).forEach(seat => tally.set(seat, 0));

  // Count votes
  room.votes.forEach((toSeat) => {
    if (toSeat !== 0 && room.players.get(toSeat)?.isAlive) {
      tally.set(toSeat, (tally.get(toSeat) || 0) + 1);
    }
  });

  // Find max votes
  let maxVotes = 0;
  tally.forEach((count) => {
    if (count > maxVotes) {
      maxVotes = count;
    }
  });

  // Find all players with max votes
  const topVotedSeats = Array.from(tally.entries())
    .filter(([, count]) => count === maxVotes)
    .map(([seat]) => seat);

  if (topVotedSeats.length === 1) {
    return { eliminatedSeat: topVotedSeats[0], isTie: false, tally };
  } else {
    return { eliminatedSeat: null, isTie: true, tally };
  }
}

export function eliminatePlayer(room: Room, seat: SeatNumber): void {
  const player = room.players.get(seat);
  if (player) {
    player.isAlive = false;
  }
  room.updatedAt = Date.now();
}

export function checkGameEnd(room: Room): { ended: boolean; winner: 'civilian' | 'undercover' | null } {
  const aliveCivilians = getAliveCivilians(room);
  const aliveUndercovers = getAliveUndercovers(room);

  // Undercover wins if equal or more undercovers than civilians
  if (aliveUndercovers.length >= aliveCivilians.length) {
    return { ended: true, winner: 'undercover' };
  }

  // Civilians win if no undercover remains
  if (aliveUndercovers.length === 0) {
    return { ended: true, winner: 'civilian' };
  }

  return { ended: false, winner: null };
}

export function advanceRound(room: Room): void {
  room.round++;
  room.phase = 'SPEAKING';
  room.votes.clear();
  room.updatedAt = Date.now();

  // Find first alive player to speak
  const alivePlayers = getAlivePlayers(room);
  if (alivePlayers.length > 0) {
    room.currentSpeaker = alivePlayers[0].seat;
  }
}

export function endGame(room: Room): void {
  room.phase = 'END';
  room.updatedAt = Date.now();
}

export function getVisibleState(room: Room, forSeat?: SeatNumber): any {
  const player = forSeat ? room.players.get(forSeat) : undefined;

  return {
    roomId: room.id,
    players: Array.from(room.players.values()).map(p => ({
      seat: p.seat,
      nickname: p.nickname,
      isAI: p.isAI,
      isAlive: p.isAlive
    })),
    phase: room.phase,
    round: room.round,
    currentSpeaker: room.currentSpeaker,
    speeches: room.speeches,
    mySeat: player?.seat,
    myRole: player?.role,
    myWord: player?.word,
    isHost: player?.seat === room.hostSeat,
    deadlineTs: room.deadlineTs
  };
}

export function canStartGame(room: Room): { canStart: boolean; reason?: string } {
  const humanPlayers = Array.from(room.players.values()).filter(p => !p.isAI);
  
  if (humanPlayers.length < 2) {
    return { canStart: false, reason: '至少需要2名玩家才能开始游戏' };
  }

  if (room.phase !== 'LOBBY') {
    return { canStart: false, reason: '游戏已经开始' };
  }

  return { canStart: true };
}

export type SeatNumber = number;

export type VoteTarget = SeatNumber | 0;

export type PlayerRole = 'civilian' | 'undercover';

export type Winner = 'civilian' | 'undercover';

export type AIStrategy = 'precision' | 'chaos';

export interface RoleBelief {
  civilian: number;
  undercover: number;
}

export type GamePhase =
  | 'LOBBY'
  | 'DEAL'
  | 'SPEAKING'
  | 'VOTING'
  | 'RESOLVE'
  | 'END';

export interface PlayerState {
  seat: SeatNumber;
  nickname: string;
  isAI: boolean;
  isAlive: boolean;
  role?: PlayerRole;
  word?: string;
  socketId?: string;
  lastSeenAt: number;
  resumeJti?: string;
}

export interface SpeechRecord {
  seat: SeatNumber;
  text: string;
  round: number;
  ts: number;
}

export interface AIPrivateMemory {
  strategy: AIStrategy;
  oppositionLabel: string;
  rivalSeat?: SeatNumber;
  notes: string[];
  usedSpeeches: string[];
  suspicionBySeat: Partial<Record<SeatNumber, number>>;
  selfRoleBelief: RoleBelief;
  camouflageScore: number;
  receivedVotesLastRound: number;
  consensusTargetSeat?: SeatNumber;
  lastVote?: VoteTarget;
  reviewedSpeechCount: number;
}

export type AIPrivateMemoryBySeat = Record<string, AIPrivateMemory>;

export interface RoomState {
  id: string;
  hostSeat: SeatNumber;
  targetPlayerCount: number;
  isLocked: boolean;
  isVoiceRoom: boolean;
  phase: GamePhase;
  round: number;
  players: PlayerState[];
  speeches: SpeechRecord[];
  votes: Partial<Record<SeatNumber, VoteTarget>>;
  currentSpeaker?: SeatNumber;
  civilianWord?: string;
  undercoverWord?: string;
  wordHint?: string;
  lastWordPairKey?: string;
  deadlineTs?: number;
  tieBreak: {
    active: boolean;
    candidates: SeatNumber[];
  };
  aiMemoryBySeat?: AIPrivateMemoryBySeat;
  winner?: Winner;
  createdAt: number;
  updatedAt: number;
  pendingDestroyAt?: number;
}

export interface AIMemorySnapshot {
  strategy: AIStrategy;
  oppositionLabel: string;
  rivalSeat?: SeatNumber;
  notes: string[];
  usedSpeeches: string[];
  suspicionBySeat: Partial<Record<SeatNumber, number>>;
  selfRoleBelief: RoleBelief;
  camouflageScore: number;
  receivedVotesLastRound: number;
  consensusTargetSeat?: SeatNumber;
  lastVote?: VoteTarget;
}

export interface VisiblePlayer {
  seat: SeatNumber;
  nickname: string;
  isAI: boolean;
  isAlive: boolean;
  connected: boolean;
}

export interface VisibleState {
  roomId: string;
  targetPlayerCount: number;
  isLocked: boolean;
  isVoiceRoom: boolean;
  players: VisiblePlayer[];
  phase: GamePhase;
  round: number;
  currentSpeaker?: SeatNumber;
  speeches: SpeechRecord[];
  mySeat?: SeatNumber;
  myWord?: string;
  wordHint?: string;
  isHost: boolean;
  deadlineTs?: number;
  tieBreakCandidates: SeatNumber[];
}

export interface VoteResultPayload {
  tally: Partial<Record<SeatNumber, number>>;
  eliminatedSeat: SeatNumber | null;
  round: number;
  tie: boolean;
  tieBreak: boolean;
}

export interface GameEndPayload {
  winner: Winner;
  reveal: {
    rolesBySeat: Array<{
      seat: SeatNumber;
      nickname: string;
      role: PlayerRole;
      isAlive: boolean;
    }>;
    words: {
      civilian: string;
      undercover: string;
      hint?: string;
    };
  };
}

export interface AIContext {
  mySeat: SeatNumber;
  myWord: string;
  round: number;
  speeches: SpeechRecord[];
  aliveSeats: SeatNumber[];
  memory?: AIMemorySnapshot;
}

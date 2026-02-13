export type SeatNumber = 1 | 2 | 3 | 4;

export type VoteTarget = SeatNumber | 0;

export type PlayerRole = 'civilian' | 'undercover';

export type Winner = 'civilian' | 'undercover';

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

export interface RoomState {
  id: string;
  hostSeat: SeatNumber;
  phase: GamePhase;
  round: number;
  players: PlayerState[];
  speeches: SpeechRecord[];
  votes: Partial<Record<SeatNumber, VoteTarget>>;
  currentSpeaker?: SeatNumber;
  civilianWord?: string;
  undercoverWord?: string;
  deadlineTs?: number;
  tieBreak: {
    active: boolean;
    candidates: SeatNumber[];
  };
  winner?: Winner;
  createdAt: number;
  updatedAt: number;
  pendingDestroyAt?: number;
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
  players: VisiblePlayer[];
  phase: GamePhase;
  round: number;
  currentSpeaker?: SeatNumber;
  speeches: SpeechRecord[];
  mySeat?: SeatNumber;
  myRole?: PlayerRole;
  myWord?: string;
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
    };
  };
}

export interface AIContext {
  mySeat: SeatNumber;
  myRole: PlayerRole;
  myWord: string;
  round: number;
  speeches: SpeechRecord[];
  aliveSeats: SeatNumber[];
}

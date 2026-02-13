export type SeatNumber = 1 | 2 | 3 | 4;

export type PlayerRole = 'civilian' | 'undercover';

export type GamePhase = 
  | 'LOBBY' 
  | 'DEAL' 
  | 'SPEAKING' 
  | 'VOTING' 
  | 'RESOLVE' 
  | 'END';

export interface Player {
  seat: SeatNumber;
  nickname: string;
  isAI: boolean;
  isAlive: boolean;
  role?: PlayerRole;
  word?: string;
  socketId?: string;
}

export interface Room {
  id: string;
  hostSeat: SeatNumber;
  players: Map<SeatNumber, Player>;
  phase: GamePhase;
  round: number;
  civilianWord?: string;
  undercoverWord?: string;
  currentSpeaker?: SeatNumber;
  speeches: SpeechRecord[];
  votes: Map<SeatNumber, SeatNumber>; // fromSeat -> toSeat (0 for abstain)
  createdAt: number;
  updatedAt: number;
  deadlineTs?: number;
}

export interface SpeechRecord {
  seat: SeatNumber;
  text: string;
  round: number;
  timestamp: number;
}

export interface VisibleState {
  roomId: string;
  players: {
    seat: SeatNumber;
    nickname: string;
    isAI: boolean;
    isAlive: boolean;
  }[];
  phase: GamePhase;
  round: number;
  currentSpeaker?: SeatNumber;
  speeches: SpeechRecord[];
  mySeat?: SeatNumber;
  myRole?: PlayerRole;
  myWord?: string;
  isHost: boolean;
  deadlineTs?: number;
}

export interface AISpeechResponse {
  speech: string;
}

export interface AIVoteResponse {
  vote: number; // 0-4 (0 for abstain)
}

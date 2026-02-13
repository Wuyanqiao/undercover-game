import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

export type GamePhase = 'LOBBY' | 'DEAL' | 'SPEAKING' | 'VOTING' | 'RESOLVE' | 'END';
export type Winner = 'civilian' | 'undercover';

export interface VisiblePlayer {
  seat: number;
  nickname: string;
  isAI: boolean;
  isAlive: boolean;
  connected: boolean;
}

export interface SpeechRecord {
  seat: number;
  text: string;
  round: number;
  ts: number;
}

export interface RoomState {
  roomId: string;
  targetPlayerCount: number;
  isLocked: boolean;
  isVoiceRoom: boolean;
  players: VisiblePlayer[];
  phase: GamePhase;
  round: number;
  currentSpeaker?: number;
  speeches: SpeechRecord[];
  mySeat?: number;
  myWord?: string;
  isHost: boolean;
  deadlineTs?: number;
  tieBreakCandidates: number[];
}

export interface VoteResult {
  tally: Record<string, number>;
  eliminatedSeat: number | null;
  round: number;
  tie: boolean;
  tieBreak: boolean;
}

export interface GameEndState {
  winner: Winner;
  reveal: {
    rolesBySeat: Array<{
      seat: number;
      nickname: string;
      role: Winner;
      isAlive: boolean;
    }>;
    words: {
      civilian: string;
      undercover: string;
    };
  };
}

interface StoreState {
  socket: Socket | null;
  connected: boolean;
  error: string | null;
  nickname: string;
  roomState: RoomState | null;
  resumeToken: string | null;
  voteResult: VoteResult | null;
  gameEnd: GameEndState | null;
  ensureSocket: () => void;
  setNickname: (value: string) => void;
  createRoom: (nickname?: string, isVoiceRoom?: boolean) => void;
  joinRoom: (roomId: string, nickname?: string) => void;
  leaveRoom: () => void;
  startGame: () => void;
  restartGame: () => void;
  setTargetPlayerCount: (targetPlayerCount: number) => void;
  setRoomLocked: (locked: boolean) => void;
  speak: (text: string) => void;
  vote: (toSeat: number) => void;
  clearError: () => void;
}

const SOCKET_PATH = '/socket.io';

function normalizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 12);
}

function normalizeRoomId(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export const useGameStore = create<StoreState>((set, get) => ({
  socket: null,
  connected: false,
  error: null,
  nickname: localStorage.getItem('nickname') ?? '',
  roomState: null,
  resumeToken: localStorage.getItem('resumeToken'),
  voteResult: null,
  gameEnd: null,

  ensureSocket: () => {
    const existing = get().socket;
    if (existing) {
      return;
    }

    const socket = io(window.location.origin, {
      path: SOCKET_PATH,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });

    socket.on('connect', () => {
      set({ connected: true, error: null });
      const token = get().resumeToken;
      if (token) {
        socket.emit('room:resume', { token });
      }
    });

    socket.on('disconnect', () => {
      set({ connected: false });
    });

    socket.on('connect_error', () => {
      set({ error: '连接失败，正在自动重试...' });
    });

    socket.on('room:error', (payload: { message: string }) => {
      set({ error: payload.message });
    });

    socket.on('room:joined', (payload: { roomId: string; resumeToken: string }) => {
      localStorage.setItem('resumeToken', payload.resumeToken);
      set({
        resumeToken: payload.resumeToken,
        error: null,
        voteResult: null,
        gameEnd: null
      });
    });

    socket.on('room:state', (payload: RoomState) => {
      set((state) => ({
        roomState: payload,
        gameEnd: payload.phase === 'END' ? state.gameEnd : null,
        voteResult: payload.phase === 'END' ? state.voteResult : payload.phase === 'LOBBY' ? null : state.voteResult
      }));
    });

    socket.on('game:phase', (payload: { phase: GamePhase; round: number; deadlineTs?: number }) => {
      const state = get().roomState;
      if (!state) {
        return;
      }
      set({
        roomState: {
          ...state,
          phase: payload.phase,
          round: payload.round,
          deadlineTs: payload.deadlineTs
        },
        gameEnd: payload.phase === 'END' ? get().gameEnd : null,
        voteResult: payload.phase === 'LOBBY' ? null : get().voteResult
      });
    });

    socket.on('game:vote:result', (payload: VoteResult) => {
      set({ voteResult: payload });
    });

    socket.on('game:end', (payload: GameEndState) => {
      set({ gameEnd: payload });
    });

    set({ socket });
  },

  setNickname: (value: string) => {
    const nickname = normalizeNickname(value);
    localStorage.setItem('nickname', nickname);
    set({ nickname });
  },

  createRoom: (nicknameInput?: string, isVoiceRoom = false) => {
    const socket = get().socket;
    if (!socket) {
      return;
    }

    const nickname = normalizeNickname(nicknameInput ?? get().nickname);
    if (!nickname) {
      set({ error: '请输入昵称' });
      return;
    }

    get().setNickname(nickname);
    socket.emit('room:create', { nickname, isVoiceRoom });
  },

  joinRoom: (roomIdInput: string, nicknameInput?: string) => {
    const socket = get().socket;
    if (!socket) {
      return;
    }

    const roomId = normalizeRoomId(roomIdInput);
    const nickname = normalizeNickname(nicknameInput ?? get().nickname);

    if (!roomId) {
      set({ error: '请输入正确的房间号' });
      return;
    }
    if (!nickname) {
      set({ error: '请输入昵称' });
      return;
    }

    get().setNickname(nickname);
    socket.emit('room:join', { roomId, nickname });
  },

  leaveRoom: () => {
    const socket = get().socket;
    if (socket) {
      socket.emit('room:leave', {});
    }
    localStorage.removeItem('resumeToken');
    set({
      roomState: null,
      resumeToken: null,
      voteResult: null,
      gameEnd: null
    });
  },

  startGame: () => {
    const socket = get().socket;
    if (!socket) {
      return;
    }
    socket.emit('game:start', {});
  },

  restartGame: () => {
    const socket = get().socket;
    if (!socket) {
      return;
    }
    socket.emit('game:restart', {});
  },

  setTargetPlayerCount: (targetPlayerCount: number) => {
    const socket = get().socket;
    if (!socket) {
      return;
    }
    socket.emit('room:target:set', { targetPlayerCount });
  },

  setRoomLocked: (locked: boolean) => {
    const socket = get().socket;
    if (!socket) {
      return;
    }
    socket.emit('room:lock', { locked });
  },

  speak: (text: string) => {
    const socket = get().socket;
    if (!socket) {
      return;
    }
    socket.emit('game:speak', { text: text.trim() });
  },

  vote: (toSeat: number) => {
    const socket = get().socket;
    if (!socket) {
      return;
    }
    socket.emit('game:vote', { toSeat });
  },

  clearError: () => {
    set({ error: null });
  }
}));

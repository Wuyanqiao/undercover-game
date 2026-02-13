import { create } from 'zustand'
import { Socket, io } from 'socket.io-client'

export type GamePhase = 'LOBBY' | 'DEAL' | 'SPEAKING' | 'VOTING' | 'RESOLVE' | 'END'

export type PlayerRole = 'civilian' | 'undercover'

export interface Player {
  seat: number
  nickname: string
  isAI: boolean
  isAlive: boolean
}

export interface SpeechRecord {
  seat: number
  text: string
  round: number
  timestamp: number
}

export interface RoomState {
  roomId: string
  players: Player[]
  phase: GamePhase
  round: number
  currentSpeaker?: number
  speeches: SpeechRecord[]
  mySeat?: number
  myRole?: PlayerRole
  myWord?: string
  isHost: boolean
  deadlineTs?: number
}

interface GameStore {
  socket: Socket | null
  isConnected: boolean
  error: string | null
  roomState: RoomState | null
  resumeToken: string | null
  connect: () => void
  disconnect: () => void
  createRoom: (nickname: string) => void
  joinRoom: (roomId: string, nickname: string) => void
  restoreConnection: () => void
  leaveRoom: () => void
  startGame: () => void
  speak: (text: string) => void
  vote: (toSeat: number) => void
  clearError: () => void
}

const SOCKET_URL = window.location.origin

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  isConnected: false,
  error: null,
  roomState: null,
  resumeToken: localStorage.getItem('resumeToken'),

  connect: () => {
    const socket = io(SOCKET_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling']
    })

    socket.on('connect', () => {
      console.log('Connected to server')
      set({ isConnected: true, error: null })
    })

    socket.on('disconnect', () => {
      console.log('Disconnected from server')
      set({ isConnected: false })
    })

    socket.on('connect_error', (err) => {
      console.error('Connection error:', err)
      set({ error: '连接服务器失败，请刷新页面重试' })
    })

    socket.on('room:state', (state: RoomState) => {
      set({ roomState: state })
    })

    socket.on('room:error', ({ message, code }: { message: string; code: string }) => {
      console.error('Room error:', code, message)
      set({ error: message })
    })

    socket.on('room:joined', ({ resumeToken }: { resumeToken: string }) => {
      localStorage.setItem('resumeToken', resumeToken)
      set({ resumeToken })
    })

    socket.on('game:speech', ({ seat, text, round }: SpeechRecord & { round: number }) => {
      const { roomState } = get()
      if (roomState) {
        set({
          roomState: {
            ...roomState,
            speeches: [...roomState.speeches, { seat, text, round, timestamp: Date.now() }]
          }
        })
      }
    })

    socket.on('game:end', ({ winner, reveal }: { winner: 'civilian' | 'undercover'; reveal: any }) => {
      const { roomState } = get()
      if (roomState) {
        set({
          roomState: {
            ...roomState,
            phase: 'END'
          }
        })
        // Store reveal info in a way that can be displayed
        ;(window as any).gameReveal = reveal
      }
    })

    set({ socket })
  },

  disconnect: () => {
    const { socket } = get()
    if (socket) {
      socket.disconnect()
      set({ socket: null, isConnected: false })
    }
  },

  createRoom: (nickname: string) => {
    const { socket } = get()
    if (socket) {
      socket.emit('room:create', { nickname })
    }
  },

  joinRoom: (roomId: string, nickname: string) => {
    const { socket } = get()
    if (socket) {
      socket.emit('room:join', { roomId: roomId.toUpperCase(), nickname })
    }
  },

  restoreConnection: () => {
    const { socket, resumeToken } = get()
    if (socket && resumeToken) {
      socket.emit('room:resume', { token: resumeToken })
    }
  },

  leaveRoom: () => {
    const { socket } = get()
    if (socket) {
      socket.emit('room:leave')
      localStorage.removeItem('resumeToken')
      set({ roomState: null, resumeToken: null })
    }
  },

  startGame: () => {
    const { socket } = get()
    if (socket) {
      socket.emit('game:start')
    }
  },

  speak: (text: string) => {
    const { socket } = get()
    if (socket) {
      socket.emit('game:speak', { text })
    }
  },

  vote: (toSeat: number) => {
    const { socket } = get()
    if (socket) {
      socket.emit('game:vote', { toSeat })
    }
  },

  clearError: () => {
    set({ error: null })
  }
}))

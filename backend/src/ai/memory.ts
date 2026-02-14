import {
  AIMemorySnapshot,
  AIPrivateMemory,
  AIStrategy,
  RoomState,
  SeatNumber,
  VoteTarget
} from '../types';

const MAX_NOTES = 18;
const MAX_USED_SPEECHES = 80;
const MAX_SUSPICION = 24;
const MIN_SUSPICION = -8;

const VAGUE_HINT_TOKENS = ['可能', '好像', '大概', '也许', '模糊', '先不说', '留一点', '先藏'];
const DIRECT_HINT_TOKENS = ['具体', '明确', '直接', '细节', '动作', '场景', '功能', '用途', '味道', '颜色'];

const STRATEGY_META: Record<AIStrategy, { oppositionLabel: string }> = {
  precision: {
    oppositionLabel: '细节派：优先怀疑模糊描述'
  },
  chaos: {
    oppositionLabel: '反细节派：优先怀疑过于具体描述'
  }
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function getMemoryStore(room: RoomState): Record<string, AIPrivateMemory> {
  if (!room.aiMemoryBySeat) {
    room.aiMemoryBySeat = {};
  }
  return room.aiMemoryBySeat;
}

function pickStrategy(seat: SeatNumber): AIStrategy {
  return seat % 2 === 0 ? 'chaos' : 'precision';
}

function pickRivalSeat(room: RoomState, seat: SeatNumber): SeatNumber | undefined {
  const aiSeats = room.players
    .filter((player) => player.isAI)
    .map((player) => player.seat)
    .sort((a, b) => a - b);

  if (aiSeats.length <= 1) {
    return undefined;
  }

  const oppositeParitySeat = aiSeats.find((candidate) => candidate !== seat && candidate % 2 !== seat % 2);
  if (oppositeParitySeat) {
    return oppositeParitySeat;
  }

  return aiSeats.find((candidate) => candidate !== seat);
}

function createAIMemory(room: RoomState, seat: SeatNumber): AIPrivateMemory {
  const strategy = pickStrategy(seat);
  const rivalSeat = pickRivalSeat(room, seat);
  const oppositionLabel = STRATEGY_META[strategy].oppositionLabel;

  return {
    strategy,
    oppositionLabel,
    rivalSeat,
    notes: [`初始立场：${oppositionLabel}`],
    usedSpeeches: [],
    suspicionBySeat: {},
    reviewedSpeechCount: 0
  };
}

function pushNote(memory: AIPrivateMemory, note: string): void {
  const normalized = note.trim();
  if (!normalized) {
    return;
  }

  memory.notes.push(normalized);
  if (memory.notes.length > MAX_NOTES) {
    memory.notes = memory.notes.slice(-MAX_NOTES);
  }
}

function addSuspicion(memory: AIPrivateMemory, targetSeat: SeatNumber, delta: number): void {
  if (!Number.isFinite(delta) || delta === 0) {
    return;
  }

  const previous = memory.suspicionBySeat[targetSeat] ?? 0;
  memory.suspicionBySeat[targetSeat] = clamp(previous + delta, MIN_SUSPICION, MAX_SUSPICION);
}

function normalizeSpeech(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
}

function countTokenHits(text: string, tokens: string[]): number {
  return tokens.reduce((hits, token) => (text.includes(token) ? hits + 1 : hits), 0);
}

function scoreSpeechByStrategy(text: string, strategy: AIStrategy): number {
  const normalized = normalizeSpeech(text);
  const vagueHits = countTokenHits(normalized, VAGUE_HINT_TOKENS);
  const directHits = countTokenHits(normalized, DIRECT_HINT_TOKENS);
  const longSentencePenalty = normalized.length >= 14 ? 1 : 0;

  if (strategy === 'precision') {
    return clamp(vagueHits * 2 + longSentencePenalty - directHits, -2, 4);
  }

  return clamp(directHits * 2 + longSentencePenalty - vagueHits, -2, 4);
}

export function ensureAIMemory(room: RoomState, seat: SeatNumber): AIPrivateMemory {
  const store = getMemoryStore(room);
  const key = String(seat);
  if (!store[key]) {
    store[key] = createAIMemory(room, seat);
  }

  const memory = store[key];
  memory.rivalSeat = pickRivalSeat(room, seat);
  return memory;
}

export function refreshAIMemoryForRoom(room: RoomState): void {
  const store = getMemoryStore(room);
  const currentAISeats = new Set(room.players.filter((player) => player.isAI).map((player) => String(player.seat)));

  for (const key of Object.keys(store)) {
    if (!currentAISeats.has(key)) {
      delete store[key];
    }
  }

  for (const key of currentAISeats) {
    const seat = Number(key);
    if (!Number.isInteger(seat) || seat <= 0) {
      continue;
    }
    const memory = ensureAIMemory(room, seat);
    memory.rivalSeat = pickRivalSeat(room, seat);
  }
}

function absorbPublicSpeechesToMemory(room: RoomState, seat: SeatNumber): void {
  const memory = ensureAIMemory(room, seat);

  if (room.speeches.length < memory.reviewedSpeechCount) {
    memory.reviewedSpeechCount = 0;
  }

  const newSpeeches = room.speeches.slice(memory.reviewedSpeechCount);
  for (const speech of newSpeeches) {
    if (speech.seat === seat) {
      continue;
    }

    const delta = scoreSpeechByStrategy(speech.text, memory.strategy);
    addSuspicion(memory, speech.seat, delta);

    const deltaLabel = delta >= 0 ? `+${delta}` : String(delta);
    pushNote(memory, `R${speech.round}-座${speech.seat} 记忆权重${deltaLabel}`);
  }

  memory.reviewedSpeechCount = room.speeches.length;
}

export function rememberAISpeech(room: RoomState, seat: SeatNumber, speech: string): void {
  const memory = ensureAIMemory(room, seat);
  const normalized = speech.trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!normalized) {
    return;
  }

  memory.usedSpeeches.push(normalized);
  if (memory.usedSpeeches.length > MAX_USED_SPEECHES) {
    memory.usedSpeeches = memory.usedSpeeches.slice(-MAX_USED_SPEECHES);
  }

  pushNote(memory, `R${room.round}发言:${normalized.slice(0, 14)}`);
}

export function rememberAIVote(room: RoomState, seat: SeatNumber, vote: VoteTarget): void {
  const memory = ensureAIMemory(room, seat);
  memory.lastVote = vote;
  if (vote !== 0) {
    addSuspicion(memory, vote, 1);
  }

  pushNote(memory, vote === 0 ? `R${room.round}投票:弃权` : `R${room.round}投票:座${vote}`);
}

export function buildAIMemorySnapshot(room: RoomState, seat: SeatNumber): AIMemorySnapshot {
  absorbPublicSpeechesToMemory(room, seat);
  const memory = ensureAIMemory(room, seat);

  return {
    strategy: memory.strategy,
    oppositionLabel: memory.oppositionLabel,
    rivalSeat: memory.rivalSeat,
    notes: [...memory.notes],
    usedSpeeches: [...memory.usedSpeeches],
    suspicionBySeat: { ...memory.suspicionBySeat },
    lastVote: memory.lastVote
  };
}

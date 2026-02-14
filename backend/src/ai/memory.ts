import {
  AIMemorySnapshot,
  AIPrivateMemory,
  AIStrategy,
  RoleBelief,
  RoomState,
  SeatNumber,
  VoteTarget
} from '../types';

const MAX_NOTES = 28;
const MAX_USED_SPEECHES = 96;
const MAX_SUSPICION = 24;
const MIN_SUSPICION = -8;

const MIN_UNDERCOVER_BELIEF = 0.08;
const MAX_UNDERCOVER_BELIEF = 0.92;

const VAGUE_HINT_TOKENS = ['可能', '好像', '大概', '也许', '模糊', '先不说', '留一点', '先藏'];
const DIRECT_HINT_TOKENS = ['具体', '明确', '直接', '细节', '动作', '场景', '功能', '用途', '味道', '颜色'];
const DEFENSIVE_TOKENS = ['不是我', '别投我', '我真不是', '冤枉', '先别投'];
const AGGRESSIVE_TOKENS = ['我先投', '锁定', '就是他', '一定是', '铁卧底'];

const SIMILARITY_REWRITE_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /[，。！？、,.!?:：；"'“”‘’`（）()\[\]{}<>\-]/g, replacement: '' },
  { pattern: /\s+/g, replacement: '' },
  { pattern: /(线索|提示|信号|方向|信息)/g, replacement: '线索' },
  { pattern: /(细节|特征|特点)/g, replacement: '细节' },
  { pattern: /(观察|留意|看看|瞅瞅)/g, replacement: '观察' },
  { pattern: /(模糊|含糊|笼统|朦胧)/g, replacement: '模糊' }
];

const SIMILARITY_STOP_WORDS = ['这轮', '这一轮', '我', '你们', '先', '一个', '一下', '就是', '真的'];

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

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function toRoleBelief(undercover: number): RoleBelief {
  const undercoverProbability = clamp(undercover, MIN_UNDERCOVER_BELIEF, MAX_UNDERCOVER_BELIEF);
  return {
    civilian: roundToTwo(1 - undercoverProbability),
    undercover: roundToTwo(undercoverProbability)
  };
}

function recalculateCamouflageScore(memory: AIPrivateMemory): void {
  const pressurePart = clamp(memory.receivedVotesLastRound * 0.1, 0, 0.4);
  const undercoverPart = Math.max(0, memory.selfRoleBelief.undercover - 0.5) * 0.9;
  const strategyBias = memory.strategy === 'chaos' ? 0.03 : -0.02;
  memory.camouflageScore = roundToTwo(clamp(0.28 + pressurePart + undercoverPart + strategyBias, 0.1, 0.96));
}

function shiftUndercoverBelief(memory: AIPrivateMemory, delta: number): void {
  if (!Number.isFinite(delta) || delta === 0) {
    return;
  }

  const next = memory.selfRoleBelief.undercover + delta;
  memory.selfRoleBelief = toRoleBelief(next);
  recalculateCamouflageScore(memory);
}

function createAIMemory(room: RoomState, seat: SeatNumber): AIPrivateMemory {
  const strategy = pickStrategy(seat);
  const rivalSeat = pickRivalSeat(room, seat);
  const oppositionLabel = STRATEGY_META[strategy].oppositionLabel;
  const seedBias = ((seat * 37) % 11 - 5) / 100;
  const selfRoleBelief = toRoleBelief(0.5 + seedBias);

  const memory: AIPrivateMemory = {
    strategy,
    oppositionLabel,
    rivalSeat,
    notes: [`初始立场：${oppositionLabel}`],
    usedSpeeches: [],
    suspicionBySeat: {},
    mainstreamBySeat: {},
    divergenceBySeat: {},
    selfRoleBelief,
    camouflageScore: 0.35,
    receivedVotesLastRound: 0,
    consensusTargetSeat: undefined,
    reviewedSpeechCount: 0,
    lastProfiledRound: undefined
  };

  recalculateCamouflageScore(memory);
  return memory;
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
  const defensiveHits = countTokenHits(normalized, DEFENSIVE_TOKENS);
  const aggressiveHits = countTokenHits(normalized, AGGRESSIVE_TOKENS);

  if (strategy === 'precision') {
    return clamp(vagueHits * 2 + defensiveHits + aggressiveHits - directHits, -2, 4);
  }

  return clamp(directHits * 2 + aggressiveHits + defensiveHits - vagueHits, -2, 4);
}

function normalizeForSimilarity(text: string): string {
  let current = text.trim().toLowerCase();
  for (const rule of SIMILARITY_REWRITE_RULES) {
    current = current.replace(rule.pattern, rule.replacement);
  }
  for (const token of SIMILARITY_STOP_WORDS) {
    current = current.replace(new RegExp(token, 'g'), '');
  }
  return current;
}

function toBigrams(text: string): Set<string> {
  const normalized = normalizeForSimilarity(text);
  if (normalized.length <= 1) {
    return new Set(normalized ? [normalized] : []);
  }

  const grams = new Set<string>();
  for (let index = 0; index + 1 < normalized.length; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function speechSimilarity(left: string, right: string): number {
  const a = normalizeForSimilarity(left);
  const b = normalizeForSimilarity(right);

  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const aBigrams = toBigrams(a);
  const bBigrams = toBigrams(b);
  return jaccardSimilarity(aBigrams, bBigrams);
}

function collectLatestSpeechesBySeat(room: RoomState, currentRoundOnly: boolean): Map<SeatNumber, string> {
  const aliveSeats = new Set(room.players.filter((player) => player.isAlive).map((player) => player.seat));
  const latest = new Map<SeatNumber, string>();

  for (let index = room.speeches.length - 1; index >= 0; index -= 1) {
    const speech = room.speeches[index];
    if (currentRoundOnly && speech.round !== room.round) {
      continue;
    }
    if (!aliveSeats.has(speech.seat) || latest.has(speech.seat)) {
      continue;
    }
    latest.set(speech.seat, speech.text);
  }

  return latest;
}

function profileRoundSignals(room: RoomState, seat: SeatNumber): void {
  const memory = ensureAIMemory(room, seat);
  if (memory.lastProfiledRound === room.round) {
    return;
  }

  let latestBySeat = collectLatestSpeechesBySeat(room, true);
  if (latestBySeat.size < 3) {
    latestBySeat = collectLatestSpeechesBySeat(room, false);
  }

  const seats = Array.from(latestBySeat.keys())
    .filter((currentSeat) => room.players.some((player) => player.seat === currentSeat && player.isAlive))
    .sort((left, right) => left - right);

  if (seats.length < 3) {
    memory.lastProfiledRound = room.round;
    return;
  }

  const mainstreamScores: Partial<Record<SeatNumber, number>> = {};
  for (const currentSeat of seats) {
    const currentSpeech = latestBySeat.get(currentSeat) ?? '';
    const similarities = seats
      .filter((otherSeat) => otherSeat !== currentSeat)
      .map((otherSeat) => speechSimilarity(currentSpeech, latestBySeat.get(otherSeat) ?? ''));

    mainstreamScores[currentSeat] = roundToTwo(average(similarities));
  }

  memory.mainstreamBySeat = {
    ...memory.mainstreamBySeat,
    ...mainstreamScores
  };

  const peerScores = seats
    .filter((currentSeat) => currentSeat !== seat)
    .map((currentSeat) => mainstreamScores[currentSeat] ?? 0);
  const peerAverage = average(peerScores);
  const selfMainstream = mainstreamScores[seat] ?? peerAverage;
  const selfGap = selfMainstream - peerAverage;

  let beliefDelta = 0;
  if (peerAverage >= 0.16) {
    if (selfGap >= -0.03) {
      beliefDelta -= 0.05;
    } else if (selfGap <= -0.12) {
      beliefDelta += 0.07;
    } else if (selfGap <= -0.06) {
      beliefDelta += 0.035;
    }
  }

  if (memory.receivedVotesLastRound >= 2 && selfGap <= -0.06) {
    beliefDelta += 0.03;
  }

  if (memory.strategy === 'chaos') {
    beliefDelta += 0.005;
  }
  shiftUndercoverBelief(memory, beliefDelta);

  let topOutlierSeat: SeatNumber | undefined;
  let topOutlierValue = -Infinity;

  for (const currentSeat of seats) {
    if (currentSeat === seat) {
      continue;
    }

    const mainstream = mainstreamScores[currentSeat] ?? peerAverage;
    const divergence = roundToTwo(clamp((peerAverage - mainstream) * 14, -2.5, 8));
    memory.divergenceBySeat[currentSeat] = divergence;

    if (divergence > 0.2) {
      addSuspicion(memory, currentSeat, clamp(divergence * 0.75, 0.4, 3.2));
    }

    if (memory.selfRoleBelief.undercover >= 0.6 && mainstream >= peerAverage + 0.08) {
      addSuspicion(memory, currentSeat, 0.7);
    }

    if (divergence > topOutlierValue) {
      topOutlierValue = divergence;
      topOutlierSeat = currentSeat;
    }
  }

  const mainstreamPeers = seats
    .filter((currentSeat) => currentSeat !== seat)
    .map((currentSeat) => ({
      seat: currentSeat,
      score: mainstreamScores[currentSeat] ?? 0
    }))
    .sort((left, right) => right.score - left.score);
  const topMainstreamSeat = mainstreamPeers[0]?.seat;

  if (topMainstreamSeat) {
    pushNote(
      memory,
      `R${room.round}主流座${topMainstreamSeat} 偏离座${topOutlierSeat ?? '无'} 自身偏差${roundToTwo(selfGap)}`
    );
  }

  memory.lastProfiledRound = room.round;
}

function adjustBeliefBySuspicionLandscape(memory: AIPrivateMemory, seat: SeatNumber): void {
  const entries = Object.entries(memory.suspicionBySeat)
    .map(([targetSeat, score]) => ({ seat: Number(targetSeat), score: Number(score) }))
    .filter((entry) => Number.isFinite(entry.seat) && Number.isFinite(entry.score) && entry.seat !== seat)
    .sort((left, right) => right.score - left.score);

  if (entries.length === 0) {
    shiftUndercoverBelief(memory, 0.015);
    return;
  }

  const strongest = entries[0].score;
  const second = entries[1]?.score ?? 0;
  let delta = 0;

  if (strongest >= 8) {
    delta -= 0.05;
  } else if (strongest >= 5) {
    delta -= 0.03;
  } else if (strongest <= 1) {
    delta += 0.03;
  }

  if (strongest - second >= 4) {
    delta -= 0.015;
  }

  if (memory.strategy === 'chaos') {
    delta += 0.01;
  }

  shiftUndercoverBelief(memory, delta);
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
    pushNote(memory, `R${speech.round}-座${speech.seat} 权重${deltaLabel}`);
  }

  memory.reviewedSpeechCount = room.speeches.length;
  profileRoundSignals(room, seat);
  adjustBeliefBySuspicionLandscape(memory, seat);
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

  const directHits = countTokenHits(normalizeSpeech(normalized), DIRECT_HINT_TOKENS);
  if (memory.selfRoleBelief.undercover >= 0.58 && directHits >= 2) {
    shiftUndercoverBelief(memory, 0.015);
  }

  pushNote(memory, `R${room.round}发言:${normalized.slice(0, 14)}`);
}

export function rememberAIVote(room: RoomState, seat: SeatNumber, vote: VoteTarget): void {
  const memory = ensureAIMemory(room, seat);
  memory.lastVote = vote;
  if (vote !== 0) {
    addSuspicion(memory, vote, 1);
  }

  if (vote === 0 && memory.selfRoleBelief.undercover >= 0.62) {
    shiftUndercoverBelief(memory, 0.02);
  }

  pushNote(memory, vote === 0 ? `R${room.round}投票:弃权` : `R${room.round}投票:座${vote}`);
}

export function rememberRoundTally(room: RoomState, tally: Partial<Record<SeatNumber, number>>): void {
  const voteEntries = Object.entries(tally)
    .map(([seat, votes]) => ({ seat: Number(seat), votes: Number(votes ?? 0) }))
    .filter((entry) => Number.isFinite(entry.seat) && Number.isFinite(entry.votes) && entry.seat > 0)
    .sort((left, right) => right.votes - left.votes || left.seat - right.seat);

  const consensusSeat = voteEntries[0]?.votes > 0 ? (voteEntries[0].seat as SeatNumber) : undefined;

  for (const player of room.players) {
    if (!player.isAI || !player.isAlive) {
      continue;
    }

    const memory = ensureAIMemory(room, player.seat);
    const pressure = tally[player.seat] ?? 0;
    memory.receivedVotesLastRound = pressure;
    memory.consensusTargetSeat = consensusSeat && consensusSeat !== player.seat ? consensusSeat : undefined;

    if (memory.consensusTargetSeat) {
      const consensusVotes = tally[memory.consensusTargetSeat] ?? 0;
      if (consensusVotes >= 2) {
        addSuspicion(memory, memory.consensusTargetSeat, Math.min(3, consensusVotes - 1));
      }
    }

    const myVote = room.votes[player.seat];
    let beliefDelta = pressure * 0.06;
    if (pressure === 0) {
      beliefDelta -= 0.03;
    }
    if (pressure >= 2) {
      beliefDelta += 0.05;
    }
    if (memory.strategy === 'chaos') {
      beliefDelta += 0.01;
    }

    if (memory.consensusTargetSeat && myVote !== undefined && myVote !== 0 && myVote !== memory.consensusTargetSeat) {
      beliefDelta += 0.02;
    }

    shiftUndercoverBelief(memory, beliefDelta);
    recalculateCamouflageScore(memory);

    if (memory.consensusTargetSeat) {
      pushNote(memory, `R${room.round}票压:${pressure} 共识座${memory.consensusTargetSeat}`);
    } else {
      pushNote(memory, `R${room.round}票压:${pressure}`);
    }
  }
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
    mainstreamBySeat: { ...memory.mainstreamBySeat },
    divergenceBySeat: { ...memory.divergenceBySeat },
    selfRoleBelief: { ...memory.selfRoleBelief },
    camouflageScore: memory.camouflageScore,
    receivedVotesLastRound: memory.receivedVotesLastRound,
    consensusTargetSeat: memory.consensusTargetSeat,
    lastVote: memory.lastVote
  };
}

import { config } from '../config';
import { logger } from '../logger';
import { AIContext, SeatNumber, VoteTarget } from '../types';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

interface ModelAdapter {
  chat(messages: ChatMessage[]): Promise<string>;
}

interface CompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

type PsychologicalMode = 'camouflage' | 'balanced' | 'assertive';

class Semaphore {
  private readonly max: number;
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(max: number) {
    this.max = Math.max(1, max);
  }

  async use<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}

class DeepSeekAdapter implements ModelAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.requestOnce(messages);
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          logger.warn({ err: error }, 'AI request failed, retrying once');
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      }
    }

    throw lastError;
  }

  private async requestOnce(messages: ChatMessage[]): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.42,
          max_tokens: 140
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`DeepSeek API error ${response.status}`);
      }

      const payload: unknown = await response.json();
      const content = extractContent(payload);
      if (!content) {
        throw new Error('DeepSeek response missing choices[0].message.content');
      }

      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as CompletionResponse;
  const content = parsed.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }

  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock?.[1]) {
    try {
      return JSON.parse(codeBlock[1].trim());
    } catch {
      // ignore
    }
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // ignore
    }
  }

  return null;
}

function validateSpeechJson(input: unknown): string | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const value = (input as { speech?: unknown }).speech;
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 30);
  return normalized || null;
}

function validateVoteJson(input: unknown, aliveSeats: SeatNumber[]): VoteTarget | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const raw = (input as { vote?: unknown }).vote;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return null;
  }

  if (raw === 0) {
    return 0;
  }

  if (raw >= 1 && aliveSeats.includes(raw as SeatNumber)) {
    return raw as SeatNumber;
  }

  return null;
}

const camouflageSpeechPool = [
  '我先贴公共线索，别急着锁人。',
  '我这轮给外层信息，核心先藏。',
  '我先跟大方向，细节慢慢补。',
  '我先给模糊画像，听完再定。',
  '我先走保守线，避免误伤队友。'
];

const balancedSpeechPool = [
  '我给一个日常场景，别对号。',
  '我先说用途边缘，不给词名。',
  '我给一半线索，留一半观察。',
  '先听全场再收口，我这句偏稳。',
  '我先抛侧写，后面再加细节。'
];

const assertiveSpeechPool = [
  '我给可验证线索，大家对比看。',
  '这词偏生活功能，不是摆设类。',
  '我这句稍具体，方便后面排人。',
  '我给关键使用感，别只看字面。',
  '我先立判断，再看谁反应怪。'
];

const precisionStrategySpeechPool = [
  '我重看模糊描述位，先记笔记。',
  '细节回避太多的人我会盯住。',
  '我更看重行为细节而非口号。'
];

const chaosStrategySpeechPool = [
  '细节太满未必真，我先反着看。',
  '越像标准答案我越不放心。',
  '我先拆掉直觉，再看谁慌。'
];

const SEMANTIC_REWRITE_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /[，。！？、,.!?:：；"'“”‘’`（）()\[\]{}<>\-]/g, replacement: '' },
  { pattern: /\s+/g, replacement: '' },
  { pattern: /(先来|先给|先说|先讲|我先)/g, replacement: '先' },
  { pattern: /(模糊|含糊|笼统|朦胧)/g, replacement: '模糊' },
  { pattern: /(线索|提示|信号|方向|信息)/g, replacement: '线索' },
  { pattern: /(日常|平时|生活里|生活中)/g, replacement: '日常' },
  { pattern: /(别急|先别|不要急|别着急)/g, replacement: '别急' },
  { pattern: /(观察|留意|看看|瞅瞅)/g, replacement: '观察' },
  { pattern: /(细节|特征|特点)/g, replacement: '细节' },
  { pattern: /(留白|藏着|保留|收着)/g, replacement: '留白' },
  { pattern: /(绕着说|绕一圈|拐着说)/g, replacement: '绕说' },
  { pattern: /(锁人|锁定|点名)/g, replacement: '锁定' },
  { pattern: /(外层|外壳|边缘)/g, replacement: '外层' }
];

const SEMANTIC_STOP_WORDS = [
  '这轮',
  '这一轮',
  '这句',
  '我',
  '你们',
  '先',
  '一个',
  '一下',
  '真的',
  '就是',
  '然后',
  '现在'
];

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizeSpeechText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 30);
}

function normalizeForSemanticCompare(value: string): string {
  let current = normalizeSpeechText(value).toLowerCase();
  for (const rule of SEMANTIC_REWRITE_RULES) {
    current = current.replace(rule.pattern, rule.replacement);
  }
  for (const token of SEMANTIC_STOP_WORDS) {
    current = current.replace(new RegExp(token, 'g'), '');
  }
  return current;
}

function toBigrams(value: string): Set<string> {
  const source = value.trim();
  if (source.length <= 1) {
    return new Set(source ? [source] : []);
  }

  const grams = new Set<string>();
  for (let index = 0; index + 1 < source.length; index += 1) {
    grams.add(source.slice(index, index + 2));
  }
  return grams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function isSemanticallyEquivalent(left: string, right: string): boolean {
  const a = normalizeForSemanticCompare(left);
  const b = normalizeForSemanticCompare(right);

  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }

  const shortLength = Math.min(a.length, b.length);
  if (shortLength >= 4 && (a.includes(b) || b.includes(a))) {
    return true;
  }

  const bigramScore = jaccardSimilarity(toBigrams(a), toBigrams(b));
  if (bigramScore >= 0.68) {
    return true;
  }

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  const ratio = maxLength === 0 ? 0 : 1 - distance / maxLength;
  return ratio >= 0.8;
}

function formatSuspicionSummary(context: AIContext): string {
  const entries = Object.entries(context.memory?.suspicionBySeat ?? {})
    .map(([seat, score]) => ({ seat: Number(seat), score: Number(score) }))
    .filter((item) => Number.isFinite(item.seat) && Number.isFinite(item.score) && item.seat !== context.mySeat)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => `${item.seat}:${item.score}`);

  return entries.length > 0 ? entries.join(', ') : '暂无明确高疑位';
}

function formatRoleBelief(context: AIContext): string {
  const undercover = clamp(context.memory?.selfRoleBelief.undercover ?? 0.5, 0, 1);
  const civilian = clamp(context.memory?.selfRoleBelief.civilian ?? 1 - undercover, 0, 1);
  return `平民${Math.round(civilian * 100)}%, 卧底${Math.round(undercover * 100)}%`;
}

function modeLabel(mode: PsychologicalMode): string {
  if (mode === 'camouflage') {
    return '伪装保命';
  }
  if (mode === 'assertive') {
    return '主动排查';
  }
  return '观望试探';
}

export class AIClient {
  private readonly adapter: ModelAdapter | null;
  private readonly semaphore: Semaphore;
  private disabledLogged = false;

  constructor() {
    this.semaphore = new Semaphore(config.maxAIConcurrent);
    this.adapter = this.buildAdapter();
  }

  async generateSpeech(context: AIContext): Promise<string> {
    return this.semaphore.use(async () => {
      if (!this.adapter) {
        this.logDisabledOnce();
        return this.ensureDistinctSpeech(this.fallbackSpeech(context), context);
      }

      try {
        const content = await this.adapter.chat([
          {
            role: 'system',
            content:
              '你是“谁是卧底”AI玩家。必须遵守：1) 你和其他人身份都未知；2) 每次发言先估计自己是平民还是卧底；3) 若你更像卧底或票压高，优先伪装避免暴露；4) 若你更像平民，可给轻量可验证线索推进排查；5) 禁止复用历史原句和同义句。只输出 JSON，不要解释。JSON schema: {"speech":"string<=30字"}。'
          },
          {
            role: 'user',
            content: this.buildSpeechPrompt(context)
          }
        ]);

        const parsed = extractJsonObject(content);
        const speech = validateSpeechJson(parsed);
        if (!speech) {
          throw new Error('AI speech JSON schema validation failed');
        }

        return this.ensureDistinctSpeech(speech, context);
      } catch (error) {
        logger.warn({ err: error }, 'AI speech failed, fallback applied');
        return this.ensureDistinctSpeech(this.fallbackSpeech(context), context);
      }
    });
  }

  async generateVote(context: AIContext): Promise<VoteTarget> {
    return this.semaphore.use(async () => {
      if (!this.adapter) {
        this.logDisabledOnce();
        return this.fallbackVote(context);
      }

      try {
        const content = await this.adapter.chat([
          {
            role: 'system',
            content:
              '你是“谁是卧底”AI玩家。你不知道自己和他人的身份。投票前先给出自己的身份猜测，再按游戏心理行动：若怀疑自己是卧底或票压高，优先融入多数避免暴露；若更像平民，优先投给你独立推理出的高疑位。只输出 JSON，不要解释。JSON schema: {"vote": number}，其中0为弃权，其他必须是存活座位号。'
          },
          {
            role: 'user',
            content: this.buildVotePrompt(context)
          }
        ]);

        const parsed = extractJsonObject(content);
        const vote = validateVoteJson(parsed, context.aliveSeats);
        if (vote === null) {
          throw new Error('AI vote JSON schema validation failed');
        }

        return vote;
      } catch (error) {
        logger.warn({ err: error }, 'AI vote failed, fallback applied');
        return this.fallbackVote(context);
      }
    });
  }

  private buildAdapter(): ModelAdapter | null {
    if (!config.deepseekApiKey || !config.deepseekBaseUrl || !config.deepseekModel) {
      return null;
    }
    if (!/^https?:\/\//i.test(config.deepseekBaseUrl)) {
      return null;
    }

    return new DeepSeekAdapter(config.deepseekBaseUrl, config.deepseekApiKey, config.deepseekModel);
  }

  private buildSpeechPrompt(context: AIContext): string {
    const speechLog = context.speeches
      .map((item) => `第${item.round}轮 座位${item.seat}: ${item.text}`)
      .join('\n');
    const notes = context.memory?.notes.slice(-8).join(' | ') ?? '暂无';
    const mode = this.pickPsychologicalMode(context);

    return [
      `你是座位${context.mySeat}`,
      '你的身份: 未知（你自己也不确定）',
      `你看到的词: ${context.myWord}`,
      `当前轮次: ${context.round}`,
      `存活座位: ${context.aliveSeats.join(', ')}`,
      context.memory ? `你的推理立场: ${context.memory.oppositionLabel}` : '你的推理立场: 默认中性',
      context.memory?.rivalSeat ? `对立参考座位: ${context.memory.rivalSeat}` : '对立参考座位: 无',
      `你的身份猜测: ${formatRoleBelief(context)}`,
      `当前心理模式: ${modeLabel(mode)}`,
      `伪装强度: ${Math.round((context.memory?.camouflageScore ?? 0.4) * 100)}%`,
      `上一轮票压: ${context.memory?.receivedVotesLastRound ?? 0}`,
      context.memory?.consensusTargetSeat ? `场上共识位: 座${context.memory.consensusTargetSeat}` : '场上共识位: 暂无',
      `你的私有记忆: ${notes}`,
      `你的私有嫌疑分布: ${formatSuspicionSummary(context)}`,
      speechLog ? `公开发言记录:\n${speechLog}` : '暂无公开发言',
      '输出一句30字内新发言：不要复述，也不要同义改写。'
    ].join('\n');
  }

  private buildVotePrompt(context: AIContext): string {
    const speechLog = context.speeches
      .map((item) => `第${item.round}轮 座位${item.seat}: ${item.text}`)
      .join('\n');
    const notes = context.memory?.notes.slice(-8).join(' | ') ?? '暂无';
    const mode = this.pickPsychologicalMode(context);

    return [
      `你是座位${context.mySeat}`,
      '你的身份: 未知（你自己也不确定）',
      `你看到的词: ${context.myWord}`,
      `当前轮次: ${context.round}`,
      `存活座位: ${context.aliveSeats.join(', ')}`,
      context.memory ? `你的推理立场: ${context.memory.oppositionLabel}` : '你的推理立场: 默认中性',
      context.memory?.rivalSeat ? `对立参考座位: ${context.memory.rivalSeat}` : '对立参考座位: 无',
      `你的身份猜测: ${formatRoleBelief(context)}`,
      `当前心理模式: ${modeLabel(mode)}`,
      `伪装强度: ${Math.round((context.memory?.camouflageScore ?? 0.4) * 100)}%`,
      `上一轮票压: ${context.memory?.receivedVotesLastRound ?? 0}`,
      context.memory?.consensusTargetSeat ? `场上共识位: 座${context.memory.consensusTargetSeat}` : '场上共识位: 暂无',
      `你的私有记忆: ${notes}`,
      `你的私有嫌疑分布: ${formatSuspicionSummary(context)}`,
      context.memory?.lastVote !== undefined ? `你上一轮投票: ${context.memory.lastVote}` : '你上一轮投票: 无',
      speechLog ? `公开发言记录:\n${speechLog}` : '暂无公开发言',
      '请输出0或一个存活座位号。'
    ].join('\n');
  }

  private fallbackSpeech(context: AIContext): string {
    const candidates = this.buildSpeechCandidates(context);
    if (candidates.length === 0) {
      return this.buildEmergencySpeech(context);
    }

    const offset = (context.round * 29 + context.mySeat * 13) % candidates.length;
    return candidates[offset];
  }

  private ensureDistinctSpeech(speech: string, context: AIContext): string {
    const usedCorpus = this.collectUsedSpeechCorpus(context);
    const normalized = normalizeSpeechText(speech);
    if (!normalized) {
      return this.buildEmergencySpeech(context);
    }

    if (this.isSpeechUnique(normalized, usedCorpus)) {
      return normalized;
    }

    for (const candidate of this.buildSpeechCandidates(context)) {
      if (this.isSpeechUnique(candidate, usedCorpus)) {
        return candidate;
      }
    }

    return this.buildEmergencySpeech(context, usedCorpus);
  }

  private collectUsedSpeechCorpus(context: AIContext): string[] {
    const corpus = [...context.speeches.map((item) => item.text), ...(context.memory?.usedSpeeches ?? [])]
      .map((text) => normalizeSpeechText(text))
      .filter((text) => Boolean(text));

    return Array.from(new Set(corpus));
  }

  private isSpeechUnique(candidate: string, usedCorpus: string[]): boolean {
    for (const history of usedCorpus) {
      if (isSemanticallyEquivalent(candidate, history)) {
        return false;
      }
    }
    return true;
  }

  private buildSpeechCandidates(context: AIContext): string[] {
    const mode = this.pickPsychologicalMode(context);
    const modePool =
      mode === 'camouflage' ? camouflageSpeechPool : mode === 'assertive' ? assertiveSpeechPool : balancedSpeechPool;
    const strategyPool =
      context.memory?.strategy === 'chaos' ? chaosStrategySpeechPool : precisionStrategySpeechPool;
    const suspectedSeat = this.pickMostSuspectedSeat(context);
    const consensusSeat = this.getConsensusSeat(context);

    const dynamicPool = [
      `第${context.round}轮我先给侧线，后续再收。`,
      mode === 'camouflage'
        ? `我先跟公共线，不急着出尖锐点。`
        : mode === 'assertive'
          ? `我先给判断线，后面可验证。`
          : `我先放半句，继续看反应。`,
      suspectedSeat ? `我先观察座${suspectedSeat}这轮反应。` : `我先不落点，继续收信息。`,
      consensusSeat ? `场上先看座${consensusSeat}，我先跟一轮。` : `场上还没共识，我先稳住节奏。`,
      context.memory?.rivalSeat
        ? `我这轮和座${context.memory.rivalSeat}走反向逻辑。`
        : `我坚持独立记忆，不机械跟票。`
    ];

    const all = [...modePool, ...strategyPool, ...dynamicPool]
      .map((item) => normalizeSpeechText(item))
      .filter((item) => item.length > 0)
      .map((item) => item.slice(0, 30));

    if (all.length === 0) {
      return [];
    }

    const offset = (context.round * 31 + context.mySeat * 17) % all.length;
    return [...all.slice(offset), ...all.slice(0, offset)];
  }

  private buildEmergencySpeech(context: AIContext, usedCorpus: string[] = []): string {
    const mode = this.pickPsychologicalMode(context);
    const seeds =
      mode === 'camouflage'
        ? [
            `第${context.round}轮${context.mySeat}号先贴共识线`,
            `第${context.round}轮${context.mySeat}号继续留白`,
            `第${context.round}轮${context.mySeat}号稳住节奏`
          ]
        : mode === 'assertive'
          ? [
              `第${context.round}轮${context.mySeat}号给验证线`,
              `第${context.round}轮${context.mySeat}号先点特征`,
              `第${context.round}轮${context.mySeat}号看行为`
            ]
          : [
              `第${context.round}轮${context.mySeat}号先侧写`,
              `第${context.round}轮${context.mySeat}号先观察`,
              `第${context.round}轮${context.mySeat}号保守发言`
            ];

    for (const seed of seeds) {
      if (this.isSpeechUnique(seed, usedCorpus)) {
        return seed;
      }
    }

    return `第${context.round}轮${context.mySeat}号线索${context.round * 37 + context.mySeat}`;
  }

  private pickMostSuspectedSeat(context: AIContext): SeatNumber | undefined {
    const entries = Object.entries(context.memory?.suspicionBySeat ?? {})
      .map(([seat, score]) => ({ seat: Number(seat), score: Number(score) }))
      .filter((item) => Number.isFinite(item.seat) && Number.isFinite(item.score) && item.seat !== context.mySeat)
      .sort((a, b) => b.score - a.score);

    return entries[0]?.seat;
  }

  private getConsensusSeat(context: AIContext): SeatNumber | undefined {
    const seat = context.memory?.consensusTargetSeat;
    if (seat && context.aliveSeats.includes(seat) && seat !== context.mySeat) {
      return seat;
    }
    return undefined;
  }

  private pickPsychologicalMode(context: AIContext): PsychologicalMode {
    const undercoverBelief = context.memory?.selfRoleBelief.undercover ?? 0.5;
    const pressure = context.memory?.receivedVotesLastRound ?? 0;
    const camouflageScore = context.memory?.camouflageScore ?? 0.4;

    if (undercoverBelief >= 0.6 || pressure >= 2 || camouflageScore >= 0.62) {
      return 'camouflage';
    }
    if (undercoverBelief <= 0.4 && pressure === 0 && camouflageScore <= 0.46) {
      return 'assertive';
    }
    return 'balanced';
  }

  private fallbackVote(context: AIContext): VoteTarget {
    const options = context.aliveSeats.filter((seat) => seat !== context.mySeat);
    if (options.length === 0) {
      return 0;
    }

    const suspicion = context.memory?.suspicionBySeat ?? {};
    const sortedBySuspicion = [...options].sort((left, right) => {
      const leftScore = suspicion[left] ?? 0;
      const rightScore = suspicion[right] ?? 0;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left - right;
    });

    const topCandidate = sortedBySuspicion[0];
    const topScore = suspicion[topCandidate] ?? 0;
    const consensusSeat = this.getConsensusSeat(context);
    const mode = this.pickPsychologicalMode(context);

    if (mode === 'camouflage') {
      if (consensusSeat) {
        return consensusSeat;
      }
      if (topScore >= 1) {
        return topCandidate;
      }

      if (Math.random() < 0.08) {
        return 0;
      }
      return options[(context.round + context.mySeat) % options.length];
    }

    if (mode === 'assertive') {
      if (topScore >= 0) {
        return topCandidate;
      }
      return options[0];
    }

    if (topScore >= 2) {
      return topCandidate;
    }
    if (consensusSeat && Math.random() < 0.7) {
      return consensusSeat;
    }
    if (Math.random() < 0.16) {
      return 0;
    }
    return options[(context.round * 7 + context.mySeat) % options.length];
  }

  private logDisabledOnce(): void {
    if (this.disabledLogged) {
      return;
    }
    this.disabledLogged = true;
    logger.warn('AI adapter disabled, fallback strategy will be used');
  }
}

export const aiClient = new AIClient();

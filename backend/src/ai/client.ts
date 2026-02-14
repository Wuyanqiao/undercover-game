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
          temperature: 0.4,
          max_tokens: 120
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

const precisionSpeechPool = [
  '我给侧面细节，先看动作线。',
  '我偏向用途线索，不给直名。',
  '我先给场景，不给核心词。',
  '先看使用方式，再听你们补。',
  '我给结构线索，留一手。'
];

const chaosSpeechPool = [
  '我先反向发言，别被直觉带跑。',
  '这句故意留白，先看谁着急。',
  '我先绕一圈，让你们先站队。',
  '我先抛烟雾，不急着落点。',
  '我先走偏锋，看谁先对号入座。'
];

const sharedSpeechPool = [
  '我给生活画面，不给答案词。',
  '我先放半句，让信息继续流动。',
  '我先贴边说，核心先不交。',
  '这轮先稳，别急着锁人。',
  '先给你们一层外壳线索。'
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
  { pattern: /(绕着说|绕一圈|拐着说)/g, replacement: '绕说' }
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
    .slice(0, 4)
    .map((item) => `${item.seat}:${item.score}`);

  return entries.length > 0 ? entries.join(', ') : '暂无明确高疑位';
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
              '你是“谁是卧底”AI玩家。必须遵守：1) 你不知道自己是平民还是卧底；2) 只能基于自己的私有记忆推理；3) 禁止重复任何历史发言，也禁止同义改写；4) 发言<=30字，贴合自己词语，带轻微误导但不直给。只输出 JSON，不要解释。JSON schema: {"speech":"string<=30字"}。'
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
              '你是“谁是卧底”AI玩家。你不知道自己是平民还是卧底。投票时必须坚持你的私有记忆与对立推理立场，不要与其他AI保持一致。只输出 JSON，不要解释或 markdown。JSON schema: {"vote": number}，其中0为弃权，其他必须是存活座位号。'
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
    const notes = context.memory?.notes.slice(-6).join(' | ') ?? '暂无';

    return [
      `你是座位${context.mySeat}`,
      '你的身份: 未知（你自己也不确定）',
      `你看到的词: ${context.myWord}`,
      `当前轮次: ${context.round}`,
      `存活座位: ${context.aliveSeats.join(', ')}`,
      context.memory ? `你的推理立场: ${context.memory.oppositionLabel}` : '你的推理立场: 默认中性',
      context.memory?.rivalSeat ? `对立参考座位: ${context.memory.rivalSeat}` : '对立参考座位: 无',
      `你的私有记忆: ${notes}`,
      `你的私有嫌疑分布: ${formatSuspicionSummary(context)}`,
      speechLog ? `公开发言记录:\n${speechLog}` : '暂无公开发言',
      '输出一句30字内的新发言：必须与历史发言和同义句都不同。'
    ].join('\n');
  }

  private buildVotePrompt(context: AIContext): string {
    const speechLog = context.speeches
      .map((item) => `第${item.round}轮 座位${item.seat}: ${item.text}`)
      .join('\n');
    const notes = context.memory?.notes.slice(-6).join(' | ') ?? '暂无';

    return [
      `你是座位${context.mySeat}`,
      '你的身份: 未知（你自己也不确定）',
      `你看到的词: ${context.myWord}`,
      `当前轮次: ${context.round}`,
      `存活座位: ${context.aliveSeats.join(', ')}`,
      context.memory ? `你的推理立场: ${context.memory.oppositionLabel}` : '你的推理立场: 默认中性',
      context.memory?.rivalSeat ? `对立参考座位: ${context.memory.rivalSeat}` : '对立参考座位: 无',
      `你的私有记忆: ${notes}`,
      `你的私有嫌疑分布: ${formatSuspicionSummary(context)}`,
      context.memory?.lastVote !== undefined ? `你上一轮投票: ${context.memory.lastVote}` : '你上一轮投票: 无',
      speechLog ? `公开发言记录:\n${speechLog}` : '暂无公开发言',
      '请投给你最怀疑的存活玩家，必要时可输出0弃权。'
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
    const strategyPool = context.memory?.strategy === 'chaos' ? chaosSpeechPool : precisionSpeechPool;
    const suspectedSeat = this.pickMostSuspectedSeat(context);

    const dynamicPool = [
      `第${context.round}轮我给侧线，先听全场。`,
      `第${context.round}轮我给用途线，不报词名。`,
      `我先做反向描述，重点看反应。`,
      `我给一层外壳线索，内核暂留。`,
      suspectedSeat ? `我先盯座${suspectedSeat}的反应，再补。` : `我先不落座位，继续观察。`,
      context.memory?.rivalSeat
        ? `我先和座${context.memory.rivalSeat}走反向逻辑。`
        : `我先用独立记忆，不跟票。`
    ];

    const all = [...strategyPool, ...sharedSpeechPool, ...dynamicPool]
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
    const seeds = [
      `第${context.round}轮${context.mySeat}号走侧写线`,
      `第${context.round}轮${context.mySeat}号给反向线索`,
      `第${context.round}轮${context.mySeat}号先留白`
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
    if ((suspicion[topCandidate] ?? 0) >= 1) {
      return topCandidate;
    }

    if (Math.random() < 0.15) {
      return 0;
    }

    if (context.memory?.strategy === 'chaos') {
      return options[options.length - 1];
    }
    return options[0];
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

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

type IdentityHypothesis = 'civilian' | 'undercover' | 'uncertain';

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

const DIRECT_DESCRIPTION_TOKENS = [
  '我的词',
  '就是',
  '这个词',
  '直接说',
  '答案是',
  '我拿到',
  '我这词'
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

function formatMainstreamSummary(context: AIContext): string {
  const entries = Object.entries(context.memory?.mainstreamBySeat ?? {})
    .map(([seat, score]) => ({ seat: Number(seat), score: Number(score) }))
    .filter((item) => Number.isFinite(item.seat) && Number.isFinite(item.score) && item.seat !== context.mySeat)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => `${item.seat}:${item.score.toFixed(2)}`);

  return entries.length > 0 ? entries.join(', ') : '暂无主流簇';
}

function formatDivergenceSummary(context: AIContext): string {
  const entries = Object.entries(context.memory?.divergenceBySeat ?? {})
    .map(([seat, score]) => ({ seat: Number(seat), score: Number(score) }))
    .filter((item) => Number.isFinite(item.seat) && Number.isFinite(item.score) && item.seat !== context.mySeat)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => `${item.seat}:${item.score.toFixed(2)}`);

  return entries.length > 0 ? entries.join(', ') : '暂无显著偏离位';
}

function normalizeForLeakCheck(value: string): string {
  return value
    .toLowerCase()
    .replace(/[，。！？、,.!?:：；"'“”‘’`（）()\[\]{}<>\-]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function containsWordLeak(speech: string, myWord: string): boolean {
  const normalizedSpeech = normalizeForLeakCheck(speech);
  const normalizedWord = normalizeForLeakCheck(myWord);

  if (!normalizedSpeech || !normalizedWord) {
    return false;
  }

  if (normalizedSpeech.includes(normalizedWord)) {
    return true;
  }

  if (normalizedWord.length >= 3) {
    for (let index = 0; index + 1 < normalizedWord.length; index += 1) {
      const fragment = normalizedWord.slice(index, index + 2);
      if (fragment && normalizedSpeech.includes(fragment)) {
        return true;
      }
    }
  }

  return false;
}

function looksTooLiteralSpeech(speech: string, myWord: string): boolean {
  const normalizedSpeech = normalizeSpeechText(speech);
  if (!normalizedSpeech) {
    return true;
  }

  if (containsWordLeak(normalizedSpeech, myWord)) {
    return true;
  }

  const directTokenHit = DIRECT_DESCRIPTION_TOKENS.some((token) => normalizedSpeech.includes(token));
  if (directTokenHit && normalizeForLeakCheck(normalizedSpeech).length <= 18) {
    return true;
  }

  return false;
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
              '你是“谁是卧底”AI玩家。你不能只描述自己词语。必须执行内部循环：信息收集->双假设检验（我是平民/我是卧底）->按当前更高概率身份行动。发言目标：贴近场上主流描述、控制模糊度、用试探性表达管理不确定性，避免自相矛盾。禁止复用历史原句和同义句，禁止泄露词面。只输出 JSON，不要解释。JSON schema: {"speech":"string<=30字"}。'
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
              '你是“谁是卧底”AI玩家。你不知道自己和他人的身份。投票前必须先做双假设检验：若你更像平民，优先投给最偏离主流描述的人；若你更像卧底，优先投给对你当前身份假设威胁最大的玩家（通常是主流一致度高或会带节奏者）。在不确定时保持策略一致，不要自相矛盾。只输出 JSON，不要解释。JSON schema: {"vote": number}，其中0为弃权，其他必须是存活座位号。'
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
    const identity = this.pickIdentityHypothesis(context);

    return [
      `你是座位${context.mySeat}`,
      '你的身份: 未知（你自己也不确定）',
      `你看到的词: ${context.myWord}`,
      context.wordHint ? `本局提示: ${context.wordHint}` : '本局提示: 无',
      `当前轮次: ${context.round}`,
      `存活座位: ${context.aliveSeats.join(', ')}`,
      context.memory ? `你的推理立场: ${context.memory.oppositionLabel}` : '你的推理立场: 默认中性',
      context.memory?.rivalSeat ? `对立参考座位: ${context.memory.rivalSeat}` : '对立参考座位: 无',
      `你的身份猜测: ${formatRoleBelief(context)}`,
      `当前主假设: ${identity.hypothesis} (置信度${Math.round(identity.confidence * 100)}%)`,
      `当前心理模式: ${modeLabel(mode)}`,
      `伪装强度: ${Math.round((context.memory?.camouflageScore ?? 0.4) * 100)}%`,
      `上一轮票压: ${context.memory?.receivedVotesLastRound ?? 0}`,
      context.memory?.consensusTargetSeat ? `场上共识位: 座${context.memory.consensusTargetSeat}` : '场上共识位: 暂无',
      `你的私有记忆: ${notes}`,
      `主流一致度: ${formatMainstreamSummary(context)}`,
      `偏离主流度: ${formatDivergenceSummary(context)}`,
      `你的私有嫌疑分布: ${formatSuspicionSummary(context)}`,
      speechLog ? `公开发言记录:\n${speechLog}` : '暂无公开发言',
      '请执行内部循环：先收集信息，再做双假设检验，再生成发言。',
      '输出一句30字内新发言：不得直接描述词面，不得复述，不得同义改写，要贴近主流并保留试探空间。'
    ].join('\n');
  }

  private buildVotePrompt(context: AIContext): string {
    const speechLog = context.speeches
      .map((item) => `第${item.round}轮 座位${item.seat}: ${item.text}`)
      .join('\n');
    const notes = context.memory?.notes.slice(-8).join(' | ') ?? '暂无';
    const mode = this.pickPsychologicalMode(context);
    const identity = this.pickIdentityHypothesis(context);

    return [
      `你是座位${context.mySeat}`,
      '你的身份: 未知（你自己也不确定）',
      `你看到的词: ${context.myWord}`,
      context.wordHint ? `本局提示: ${context.wordHint}` : '本局提示: 无',
      `当前轮次: ${context.round}`,
      `存活座位: ${context.aliveSeats.join(', ')}`,
      context.memory ? `你的推理立场: ${context.memory.oppositionLabel}` : '你的推理立场: 默认中性',
      context.memory?.rivalSeat ? `对立参考座位: ${context.memory.rivalSeat}` : '对立参考座位: 无',
      `你的身份猜测: ${formatRoleBelief(context)}`,
      `当前主假设: ${identity.hypothesis} (置信度${Math.round(identity.confidence * 100)}%)`,
      `当前心理模式: ${modeLabel(mode)}`,
      `伪装强度: ${Math.round((context.memory?.camouflageScore ?? 0.4) * 100)}%`,
      `上一轮票压: ${context.memory?.receivedVotesLastRound ?? 0}`,
      context.memory?.consensusTargetSeat ? `场上共识位: 座${context.memory.consensusTargetSeat}` : '场上共识位: 暂无',
      `你的私有记忆: ${notes}`,
      `主流一致度: ${formatMainstreamSummary(context)}`,
      `偏离主流度: ${formatDivergenceSummary(context)}`,
      `你的私有嫌疑分布: ${formatSuspicionSummary(context)}`,
      context.memory?.lastVote !== undefined ? `你上一轮投票: ${context.memory.lastVote}` : '你上一轮投票: 无',
      speechLog ? `公开发言记录:\n${speechLog}` : '暂无公开发言',
      '投票准则：若更像平民优先投偏离主流者；若更像卧底优先投威胁你身份假设者。',
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

    if (!looksTooLiteralSpeech(normalized, context.myWord) && this.isSpeechUnique(normalized, usedCorpus)) {
      return normalized;
    }

    for (const candidate of this.buildSpeechCandidates(context)) {
      if (looksTooLiteralSpeech(candidate, context.myWord)) {
        continue;
      }
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
    const identity = this.pickIdentityHypothesis(context);
    const modePool =
      mode === 'camouflage' ? camouflageSpeechPool : mode === 'assertive' ? assertiveSpeechPool : balancedSpeechPool;
    const strategyPool =
      context.memory?.strategy === 'chaos' ? chaosStrategySpeechPool : precisionStrategySpeechPool;
    const suspectedSeat = this.pickMostSuspectedSeat(context);
    const consensusSeat = this.getConsensusSeat(context);
    const mainstreamSeat = this.pickTopMainstreamSeat(context);
    const divergenceSeat = this.pickTopDivergenceSeat(context);
    const threatSeat = this.pickThreatSeat(context, identity.hypothesis);

    const dynamicPool = [
      `第${context.round}轮我先给侧线，后续再收。`,
      mode === 'camouflage'
        ? `我先跟公共线，不急着出尖锐点。`
        : mode === 'assertive'
          ? `我先给判断线，后面可验证。`
          : `我先放半句，继续看反应。`,
      identity.hypothesis === 'undercover'
        ? `我先做卧底假设，发言贴主流。`
        : identity.hypothesis === 'civilian'
          ? `我先做平民假设，侧看偏离位。`
          : `我先维持双假设，不急着站死。`,
      mainstreamSeat ? `我先对齐座${mainstreamSeat}的叙述框架。` : `我先对齐全场主流叙述。`,
      divergenceSeat ? `我重点盯座${divergenceSeat}的偏离细节。` : `我先不落点，继续收信息。`,
      suspectedSeat ? `我先观察座${suspectedSeat}这轮反应。` : `我先看谁先急着下结论。`,
      consensusSeat ? `场上先看座${consensusSeat}，我先跟一轮。` : `场上还没共识，我先稳住节奏。`,
      threatSeat ? `我优先处理座${threatSeat}带来的身份威胁。` : `我先降低暴露，再找威胁位。`,
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

  private pickTopMainstreamSeat(context: AIContext): SeatNumber | undefined {
    const entries = Object.entries(context.memory?.mainstreamBySeat ?? {})
      .map(([seat, score]) => ({ seat: Number(seat), score: Number(score) }))
      .filter((item) => Number.isFinite(item.seat) && Number.isFinite(item.score) && item.seat !== context.mySeat)
      .sort((a, b) => b.score - a.score);

    return entries[0]?.seat;
  }

  private pickTopDivergenceSeat(context: AIContext): SeatNumber | undefined {
    const entries = Object.entries(context.memory?.divergenceBySeat ?? {})
      .map(([seat, score]) => ({ seat: Number(seat), score: Number(score) }))
      .filter((item) => Number.isFinite(item.seat) && Number.isFinite(item.score) && item.seat !== context.mySeat)
      .sort((a, b) => b.score - a.score);

    return entries[0]?.seat;
  }

  private pickThreatSeat(context: AIContext, identity: IdentityHypothesis): SeatNumber | undefined {
    if (identity === 'undercover') {
      return this.pickTopMainstreamSeat(context) ?? this.pickMostSuspectedSeat(context);
    }
    if (identity === 'civilian') {
      return this.pickTopDivergenceSeat(context) ?? this.pickMostSuspectedSeat(context);
    }

    return this.getConsensusSeat(context) ?? this.pickMostSuspectedSeat(context);
  }

  private getConsensusSeat(context: AIContext): SeatNumber | undefined {
    const seat = context.memory?.consensusTargetSeat;
    if (seat && context.aliveSeats.includes(seat) && seat !== context.mySeat) {
      return seat;
    }
    return undefined;
  }

  private pickIdentityHypothesis(
    context: AIContext
  ): { hypothesis: IdentityHypothesis; confidence: number; uncertainty: number } {
    const undercoverBelief = clamp(context.memory?.selfRoleBelief.undercover ?? 0.5, 0, 1);
    const civilianBelief = clamp(context.memory?.selfRoleBelief.civilian ?? 1 - undercoverBelief, 0, 1);
    const confidenceGap = Math.abs(undercoverBelief - civilianBelief);

    if (confidenceGap < 0.12) {
      return {
        hypothesis: 'uncertain',
        confidence: clamp(0.5 + confidenceGap * 0.4, 0.5, 0.62),
        uncertainty: clamp(1 - confidenceGap, 0.38, 1)
      };
    }

    if (undercoverBelief > civilianBelief) {
      return {
        hypothesis: 'undercover',
        confidence: undercoverBelief,
        uncertainty: clamp(1 - undercoverBelief, 0.08, 0.7)
      };
    }

    return {
      hypothesis: 'civilian',
      confidence: civilianBelief,
      uncertainty: clamp(1 - civilianBelief, 0.08, 0.7)
    };
  }

  private pickPsychologicalMode(context: AIContext): PsychologicalMode {
    const pressure = context.memory?.receivedVotesLastRound ?? 0;
    const camouflageScore = context.memory?.camouflageScore ?? 0.4;
    const identity = this.pickIdentityHypothesis(context);

    if (identity.hypothesis === 'undercover' || pressure >= 2 || camouflageScore >= 0.62) {
      return 'camouflage';
    }
    if (identity.hypothesis === 'civilian' && identity.confidence >= 0.62 && pressure === 0 && camouflageScore <= 0.5) {
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
    const mainstream = context.memory?.mainstreamBySeat ?? {};
    const divergence = context.memory?.divergenceBySeat ?? {};
    const consensusSeat = this.getConsensusSeat(context);
    const mode = this.pickPsychologicalMode(context);
    const identity = this.pickIdentityHypothesis(context);
    const threatSeat = this.pickThreatSeat(context, identity.hypothesis);

    const ranked = options
      .map((seat) => {
        const suspicionScore = suspicion[seat] ?? 0;
        const mainstreamScore = mainstream[seat] ?? 0;
        const divergenceScore = divergence[seat] ?? 0;

        let score = suspicionScore * 1.2 + divergenceScore;

        if (identity.hypothesis === 'civilian') {
          score += divergenceScore * 1.6 - mainstreamScore * 0.4;
        } else if (identity.hypothesis === 'undercover') {
          score += mainstreamScore * 3.2 - divergenceScore * 0.35;
        } else {
          score += divergenceScore * 0.9 + mainstreamScore * 0.6;
        }

        if (consensusSeat === seat) {
          score += identity.hypothesis === 'undercover' ? 1.6 : 0.5;
        }

        if (threatSeat === seat) {
          score += 1.4;
        }

        if (context.memory?.lastVote === seat) {
          score += 0.25;
        }

        return { seat, score };
      })
      .sort((left, right) => right.score - left.score || left.seat - right.seat);

    const top = ranked[0];
    if (!top) {
      return 0;
    }

    if (mode === 'camouflage') {
      if (consensusSeat && Math.random() < 0.82) {
        return consensusSeat;
      }

      if (top.score >= 1.2) {
        return top.seat;
      }

      if (Math.random() < 0.07) {
        return 0;
      }

      return options[(context.round + context.mySeat) % options.length];
    }

    if (mode === 'assertive') {
      if (top.score >= -0.2) {
        return top.seat;
      }

      return options[0];
    }

    if (top.score >= 1.5) {
      return top.seat;
    }

    if (identity.hypothesis === 'uncertain' && Math.random() < 0.15) {
      return 0;
    }

    if (consensusSeat && Math.random() < 0.62) {
      return consensusSeat;
    }

    return top.seat;
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

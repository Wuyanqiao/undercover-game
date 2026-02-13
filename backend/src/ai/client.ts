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

const fallbackCivilianSpeech = [
  '它常见但别太直白，我先装糊涂。',
  '这词不难猜，但我先给点烟雾弹。',
  '我想到日常场景，细节先藏一半。',
  '它很接地气，我先说个绕弯线索。',
  '这个词像老熟人，我先假装不熟。'
];

const fallbackUndercoverSpeech = [
  '我先说个安全描述，别问太细。',
  '这词我有感觉，但先走中庸路线。',
  '我懂一点点，先说得像懂很多。',
  '我这波发言主打一个稳中带偏。',
  '请相信我的胡说八道有理有据。'
];

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
        return this.fallbackSpeech(context);
      }

      try {
        const content = await this.adapter.chat([
          {
            role: 'system',
            content:
              '你是“谁是卧底”玩家。发言要满足：1) 与自己词语语义相关；2) 带一点误导性，不要太直接；3) 有轻微幽默感；4) 控制在30字内。只输出 JSON，不要解释或 markdown。JSON schema: {"speech":"string<=30字"}。'
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

        return speech;
      } catch (error) {
        logger.warn({ err: error }, 'AI speech failed, fallback applied');
        return this.fallbackSpeech(context);
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
              '你是“谁是卧底”玩家。请在保持策略性的同时，不要每轮都给出绝对判断，必要时可保守投票或弃权，以提高局内博弈轮次。只输出 JSON，不要解释或 markdown。JSON schema: {"vote": number}，其中0为弃权，其他必须是存活座位号。'
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
      .filter((item) => item.round === context.round)
      .map((item) => `座位${item.seat}: ${item.text}`)
      .join('\n');

    return [
      `你是座位${context.mySeat}`,
      `你的身份: ${context.myRole === 'civilian' ? '平民' : '卧底'}`,
      `你看到的词: ${context.myWord}`,
      `当前轮次: ${context.round}`,
      `存活座位: ${context.aliveSeats.join(', ')}`,
      speechLog ? `本轮已有发言:\n${speechLog}` : '你是本轮首个发言',
      '请给出一句不超过30字的发言：要贴合词义、略带误导、稍微幽默。'
    ].join('\n');
  }

  private buildVotePrompt(context: AIContext): string {
    const speechLog = context.speeches
      .map((item) => `第${item.round}轮 座位${item.seat}: ${item.text}`)
      .join('\n');

    return [
      `你是座位${context.mySeat}`,
      `你的身份: ${context.myRole === 'civilian' ? '平民' : '卧底'}`,
      `你看到的词: ${context.myWord}`,
      `当前轮次: ${context.round}`,
      `存活座位: ${context.aliveSeats.join(', ')}`,
      speechLog ? `公开发言记录:\n${speechLog}` : '暂无公开发言',
      '请投给你最怀疑的存活玩家，必要时可输出0弃权。投票只能是0或存活座位号。'
    ].join('\n');
  }

  private fallbackSpeech(context: AIContext): string {
    const list = context.myRole === 'civilian' ? fallbackCivilianSpeech : fallbackUndercoverSpeech;
    return list[Math.floor(Math.random() * list.length)];
  }

  private fallbackVote(context: AIContext): VoteTarget {
    if (Math.random() < 0.2) {
      return 0;
    }
    const options = context.aliveSeats.filter((seat) => seat !== context.mySeat);
    if (options.length === 0) {
      return 0;
    }
    return options[Math.floor(Math.random() * options.length)];
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

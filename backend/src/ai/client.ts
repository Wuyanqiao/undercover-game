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

  if (raw >= 1 && raw <= 4 && aliveSeats.includes(raw as SeatNumber)) {
    return raw as SeatNumber;
  }

  return null;
}

const fallbackCivilianSpeech = [
  '这个词很常见，生活里经常出现。',
  '它比较具体，大家应该都接触过。',
  '我觉得它偏向日常场景。',
  '这个词给人的感觉比较直观。'
];

const fallbackUndercoverSpeech = [
  '这个词应该属于常见类别。',
  '我觉得它和生活场景有关。',
  '这个词描述起来不算抽象。',
  '从体验上说，大家可能都见过。'
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
              '你是“谁是卧底”玩家。只输出 JSON，不要任何解释或 markdown。JSON schema: {"speech":"string<=30字"}。'
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
              '你是“谁是卧底”玩家。只输出 JSON，不要任何解释或 markdown。JSON schema: {"vote":0|1|2|3|4}。'
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
      '请给出一句不超过30字的发言。'
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
      '请在存活玩家中投票，输出 1~4；或输出 0 表示弃权。'
    ].join('\n');
  }

  private fallbackSpeech(context: AIContext): string {
    const list = context.myRole === 'civilian' ? fallbackCivilianSpeech : fallbackUndercoverSpeech;
    return list[Math.floor(Math.random() * list.length)];
  }

  private fallbackVote(context: AIContext): VoteTarget {
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

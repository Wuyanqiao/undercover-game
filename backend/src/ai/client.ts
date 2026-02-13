import { logger } from '../logger';
import { config } from '../config';
import { PlayerRole, SeatNumber, SpeechRecord } from '../types';

interface AIContext {
  mySeat: SeatNumber;
  myRole: PlayerRole;
  myWord: string;
  round: number;
  speeches: SpeechRecord[];
  aliveSeats: SeatNumber[];
}

interface AISpeechRequest {
  context: AIContext;
}

interface AIVoteRequest {
  context: AIContext;
}

// Fallback templates when AI fails
const fallbackSpeeches = {
  civilian: [
    '我觉得这个词应该和{word}有关',
    '从{word}的角度想，应该是个常见的东西',
    '{word}，这个词描述的很清楚',
    '我觉得{word}这个特征很明显',
    '和{word}相关的，应该是日常用品'
  ],
  undercover: [
    '这个词听起来很特别',
    '我觉得可能是某种物品',
    '描述一下特征的话...',
    '这个词让我想到某种常见的东西',
    '从字面意思理解的话...'
  ]
};

export class AIClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private requestQueue: Promise<any>[] = [];

  constructor() {
    this.apiKey = config.deepseekApiKey;
    this.baseUrl = config.deepseekBaseUrl;
    this.model = config.deepseekModel;
  }

  private async makeRequest(messages: any[]): Promise<any> {
    // Check if base URL is available
    if (!this.baseUrl || this.baseUrl.includes('placeholder')) {
      throw new Error('AI base URL not configured');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: 150
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private async queueRequest<T>(fn: () => Promise<T>): Promise<T> {
    // Limit concurrent AI requests
    while (this.requestQueue.length >= config.maxAIConcurrent) {
      await Promise.race(this.requestQueue);
    }

    const requestPromise = fn().finally(() => {
      const index = this.requestQueue.indexOf(requestPromise);
      if (index > -1) {
        this.requestQueue.splice(index, 1);
      }
    });

    this.requestQueue.push(requestPromise);
    return requestPromise;
  }

  private parseJSONResponse(content: string): any {
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || 
                       content.match(/```\s*([\s\S]*?)```/) ||
                       content.match(/{[\s\S]*}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }
      
      return JSON.parse(content);
    } catch (error) {
      logger.warn({ content }, 'Failed to parse AI JSON response');
      return null;
    }
  }

  async generateSpeech(context: AIContext): Promise<string> {
    return this.queueRequest(async () => {
      try {
        const prompt = this.buildSpeechPrompt(context);
        const content = await this.makeRequest([
          {
            role: 'system',
            content: '你是一个在玩"谁是卧底"游戏的玩家。请根据你看到的词和之前的对话，生成简短的发言（不超过30字）。你必须以JSON格式输出：{"speech": "你的发言"}'
          },
          {
            role: 'user',
            content: prompt
          }
        ]);

        const parsed = this.parseJSONResponse(content);
        if (parsed && parsed.speech) {
          return parsed.speech.slice(0, 30);
        }

        // Fallback to template
        return this.getFallbackSpeech(context);
      } catch (error) {
        logger.error(error, 'AI speech generation failed, using fallback');
        return this.getFallbackSpeech(context);
      }
    });
  }

  async generateVote(context: AIContext): Promise<number> {
    return this.queueRequest(async () => {
      try {
        const prompt = this.buildVotePrompt(context);
        const content = await this.makeRequest([
          {
            role: 'system',
            content: '你是一个在玩"谁是卧底"游戏的玩家。请根据对话和投票情况，选择要投票的座位号（1-4）或0表示弃权。你必须以JSON格式输出：{"vote": 座位号}'
          },
          {
            role: 'user',
            content: prompt
          }
        ]);

        const parsed = this.parseJSONResponse(content);
        if (parsed && typeof parsed.vote === 'number') {
          const vote = parsed.vote;
          // Validate vote is in valid range and targets alive player
          if (vote === 0 || (vote >= 1 && vote <= 4 && context.aliveSeats.includes(vote as SeatNumber))) {
            return vote;
          }
        }

        // Fallback: random vote among alive players
        return this.getFallbackVote(context);
      } catch (error) {
        logger.error(error, 'AI vote generation failed, using fallback');
        return this.getFallbackVote(context);
      }
    });
  }

  private buildSpeechPrompt(context: AIContext): string {
    const speechesText = context.speeches
      .filter(s => s.round === context.round)
      .map(s => `座位${s.seat}: ${s.text}`)
      .join('\n');

    return `游戏信息：
- 你是座位${context.mySeat}
- 你的身份：${context.myRole === 'civilian' ? '平民' : '卧底'}
- 你看到的词：${context.myWord}
- 当前回合：第${context.round}轮
- 存活的玩家座位：${context.aliveSeats.join(', ')}
${speechesText ? `本轮已发言：\n${speechesText}` : '你是本轮第一个发言'}

请生成简短发言（不超过30字），描述你看到的词。不要直接说出词，要隐晦地描述。`;
  }

  private buildVotePrompt(context: AIContext): string {
    const speechesText = context.speeches
      .map(s => `座位${s.seat}: ${s.text}`)
      .join('\n');

    return `游戏信息：
- 你是座位${context.mySeat}
- 你的身份：${context.myRole === 'civilian' ? '平民' : '卧底'}
- 你看到的词：${context.myWord}
- 当前回合：第${context.round}轮
- 存活的玩家座位：${context.aliveSeats.join(', ')}

所有发言记录：
${speechesText}

请投票给最可疑的玩家座位号（1-4），或0表示弃权。你只能投给存活的玩家。`;
  }

  private getFallbackSpeech(context: AIContext): string {
    const templates = context.myRole === 'civilian' 
      ? fallbackSpeeches.civilian 
      : fallbackSpeeches.undercover;
    const template = templates[Math.floor(Math.random() * templates.length)];
    return context.myRole === 'civilian' 
      ? template.replace('{word}', context.myWord)
      : template;
  }

  private getFallbackVote(context: AIContext): number {
    // Randomly vote for an alive player or abstain
    if (Math.random() < 0.1) {
      return 0; // 10% chance to abstain
    }
    const aliveOthers = context.aliveSeats.filter(s => s !== context.mySeat);
    if (aliveOthers.length === 0) {
      return 0;
    }
    return aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
  }
}

export const aiClient = new AIClient();

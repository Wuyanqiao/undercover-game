export interface WordPair {
  civilian: string;
  undercover: string;
}

export interface PickedWordPair {
  pair: WordPair;
  key: string;
}

const curatedWordPairs: WordPair[] = [
  { civilian: '苹果', undercover: '梨' },
  { civilian: '牛奶', undercover: '豆浆' },
  { civilian: '篮球', undercover: '足球' },
  { civilian: '自行车', undercover: '摩托车' },
  { civilian: '电视', undercover: '电脑' },
  { civilian: '手机', undercover: '平板' },
  { civilian: '眼镜', undercover: '墨镜' },
  { civilian: '冰淇淋', undercover: '蛋糕' },
  { civilian: '咖啡', undercover: '奶茶' },
  { civilian: '耳机', undercover: '音响' },
  { civilian: '火车', undercover: '高铁' },
  { civilian: '猫', undercover: '狗' },
  { civilian: '玫瑰', undercover: '百合' },
  { civilian: '汉堡', undercover: '三明治' },
  { civilian: '可乐', undercover: '雪碧' },
  { civilian: '面包', undercover: '馒头' },
  { civilian: '帽子', undercover: '头巾' },
  { civilian: '牙刷', undercover: '牙膏' },
  { civilian: '雨伞', undercover: '雨衣' },
  { civilian: '袜子', undercover: '手套' },
  { civilian: '椅子', undercover: '凳子' },
  { civilian: '桌子', undercover: '柜子' },
  { civilian: '书', undercover: '杂志' },
  { civilian: '电影', undercover: '电视剧' },
  { civilian: '唱歌', undercover: '跳舞' },
  { civilian: '跑步', undercover: '游泳' },
  { civilian: '月亮', undercover: '太阳' },
  { civilian: '星星', undercover: '月亮' },
  { civilian: '雨', undercover: '雪' },
  { civilian: '春天', undercover: '秋天' },
  { civilian: '红包', undercover: '礼物' },
  { civilian: '饺子', undercover: '汤圆' },
  { civilian: '筷子', undercover: '叉子' },
  { civilian: '地铁', undercover: '公交' },
  { civilian: '吉他', undercover: '贝斯' },
  { civilian: '手表', undercover: '怀表' },
  { civilian: '白米饭', undercover: '糯米饭' },
  { civilian: '滑雪', undercover: '滑冰' },
  { civilian: '口红', undercover: '唇釉' },
  { civilian: '小说', undercover: '散文' }
];

const stylePrefixes = [
  '清',
  '浓',
  '鲜',
  '香',
  '脆',
  '软',
  '甜',
  '酸',
  '辣',
  '咸',
  '冰',
  '热',
  '青',
  '红',
  '金',
  '银',
  '小',
  '大'
] as const;

const ingredientRoots = [
  '苹果',
  '香蕉',
  '草莓',
  '橙子',
  '葡萄',
  '柠檬',
  '芒果',
  '桃子',
  '蓝莓',
  '樱桃',
  '菠萝',
  '椰子',
  '抹茶',
  '可可',
  '奶油',
  '芝士',
  '蜂蜜',
  '桂花',
  '茉莉',
  '玫瑰',
  '酸奶',
  '牛奶',
  '米酒',
  '乌梅'
] as const;

const variantSuffixes = ['汁', '茶', '露', '酱', '派', '卷', '片', '饼', '糕', '冻', '饮'] as const;

function sanitizeWord(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

function dedupeWordPairs(input: WordPair[]): WordPair[] {
  const seen = new Set<string>();
  const result: WordPair[] = [];

  for (const pair of input) {
    const civilian = sanitizeWord(pair.civilian);
    const undercover = sanitizeWord(pair.undercover);
    if (!civilian || !undercover || civilian === undercover) {
      continue;
    }

    const key = `${civilian}|${undercover}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ civilian, undercover });
  }

  return result;
}

function buildGeneratedWordPairs(): WordPair[] {
  const generated: WordPair[] = [];

  for (const prefix of stylePrefixes) {
    for (const root of ingredientRoots) {
      const stem = `${prefix}${root}`;
      for (let index = 0; index + 1 < variantSuffixes.length; index += 1) {
        generated.push({
          civilian: `${stem}${variantSuffixes[index]}`,
          undercover: `${stem}${variantSuffixes[index + 1]}`
        });
      }
    }
  }

  return generated;
}

export const wordPairs: WordPair[] = dedupeWordPairs([...curatedWordPairs, ...buildGeneratedWordPairs()]);

export const WORD_PAIR_COUNT = wordPairs.length;

export function createWordPairKey(pair: WordPair): string {
  return `${pair.civilian}|${pair.undercover}`;
}

export function getRandomWordPair(lastKey?: string): PickedWordPair {
  const candidates = lastKey ? wordPairs.filter((pair) => createWordPairKey(pair) !== lastKey) : wordPairs;
  const pool = candidates.length > 0 ? candidates : wordPairs;
  const pair = pool[Math.floor(Math.random() * pool.length)];
  return {
    pair,
    key: createWordPairKey(pair)
  };
}

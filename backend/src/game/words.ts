export interface WordPair {
  civilian: string;
  undercover: string;
}

export interface PickedWordPair {
  pair: WordPair;
  key: string;
}

// 30+ word pairs for the game
export const wordPairs: WordPair[] = [
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
  { civilian: '筷子', undercover: '叉子' }
];

function toPairKey(pair: WordPair): string {
  return `${pair.civilian}|${pair.undercover}`;
}

export function getRandomWordPair(lastKey?: string): PickedWordPair {
  const candidates = lastKey ? wordPairs.filter((pair) => toPairKey(pair) !== lastKey) : wordPairs;
  const pool = candidates.length > 0 ? candidates : wordPairs;
  const pair = pool[Math.floor(Math.random() * pool.length)];
  return {
    pair,
    key: toPairKey(pair)
  };
}

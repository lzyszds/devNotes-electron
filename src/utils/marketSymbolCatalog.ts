/*
 * 自选添加用的本地标的目录：支持用中文名 / 别名 / ticker 模糊搜。
 * Gate 合约 API 不带中文名，所以微软、比特币这类检索只能靠本地映射。
 */

export type CatalogAsset = 'crypto' | 'equity'

export interface CatalogEntry {
  /** 合约代码主体，如 BTC、MSFT（不含 USDT） */
  base: string
  name: string
  asset: CatalogAsset
  /** 额外可搜词：拼音、英文俗称、别名 */
  aliases?: string[]
}

const ENTRIES: CatalogEntry[] = [
  /* —— 加密货币 —— */
  { base: 'BTC', name: '比特币', asset: 'crypto', aliases: ['bitcoin', '大饼', 'btc'] },
  { base: 'ETH', name: '以太坊', asset: 'crypto', aliases: ['ethereum', 'ether', '以太', '姨太'] },
  { base: 'SOL', name: 'Solana', asset: 'crypto', aliases: ['索拉纳', 'solana'] },
  { base: 'XRP', name: '瑞波币', asset: 'crypto', aliases: ['ripple', '瑞波'] },
  { base: 'DOGE', name: '狗狗币', asset: 'crypto', aliases: ['dogecoin', '狗币'] },
  { base: 'ADA', name: '艾达币', asset: 'crypto', aliases: ['cardano'] },
  { base: 'AVAX', name: 'Avalanche', asset: 'crypto', aliases: ['雪崩'] },
  { base: 'DOT', name: '波卡', asset: 'crypto', aliases: ['polkadot'] },
  { base: 'LINK', name: 'Chainlink', asset: 'crypto', aliases: ['链路'] },
  { base: 'LTC', name: '莱特币', asset: 'crypto', aliases: ['litecoin'] },
  { base: 'BCH', name: '比特币现金', asset: 'crypto', aliases: ['bitcoin cash'] },
  { base: 'UNI', name: 'Uniswap', asset: 'crypto' },
  { base: 'AAVE', name: 'Aave', asset: 'crypto' },
  { base: 'SUI', name: 'Sui', asset: 'crypto' },
  { base: 'APT', name: 'Aptos', asset: 'crypto' },
  { base: 'ARB', name: 'Arbitrum', asset: 'crypto' },
  { base: 'OP', name: 'Optimism', asset: 'crypto' },
  { base: 'NEAR', name: 'NEAR', asset: 'crypto' },
  { base: 'TON', name: 'Toncoin', asset: 'crypto', aliases: ['telegram'] },
  { base: 'TRX', name: '波场', asset: 'crypto', aliases: ['tron'] },
  { base: 'ATOM', name: 'Cosmos', asset: 'crypto', aliases: ['宇宙'] },
  { base: 'FIL', name: 'Filecoin', asset: 'crypto', aliases: ['文件币'] },
  { base: 'PEPE', name: 'Pepe', asset: 'crypto', aliases: ['青蛙'] },
  { base: 'WIF', name: 'dogwifhat', asset: 'crypto' },
  { base: 'SHIB', name: '柴犬币', asset: 'crypto', aliases: ['shiba'] },

  /* —— Gate 美股 / 合成合约 —— */
  { base: 'MSFT', name: '微软', asset: 'equity', aliases: ['microsoft', '微软公司'] },
  { base: 'AAPL', name: '苹果', asset: 'equity', aliases: ['apple', '苹果公司'] },
  { base: 'NVDA', name: '英伟达', asset: 'equity', aliases: ['nvidia', '輝達', '辉达'] },
  { base: 'TSLA', name: '特斯拉', asset: 'equity', aliases: ['tesla', '马斯克'] },
  { base: 'AMZN', name: '亚马逊', asset: 'equity', aliases: ['amazon'] },
  { base: 'GOOG', name: '谷歌', asset: 'equity', aliases: ['google', 'alphabet', '谷歌a'] },
  { base: 'GOOGL', name: '谷歌', asset: 'equity', aliases: ['google', 'alphabet'] },
  { base: 'META', name: 'Meta', asset: 'equity', aliases: ['facebook', '脸书', 'meta'] },
  { base: 'MU', name: '美光科技', asset: 'equity', aliases: ['micron', '美光'] },
  { base: 'SNDK', name: '闪迪', asset: 'equity', aliases: ['sandisk', '西部数据', 'wdc'] },
  { base: 'SPCX', name: 'SpaceX 合成', asset: 'equity', aliases: ['spacex', '太空探索', '星舰'] },
  { base: 'AMD', name: '超威', asset: 'equity', aliases: ['超微', 'amd'] },
  { base: 'INTU', name: 'Intuit', asset: 'equity' },
  { base: 'NFLX', name: '奈飞', asset: 'equity', aliases: ['netflix'] },
  { base: 'COIN', name: 'Coinbase', asset: 'equity', aliases: ['coinbase'] },
  { base: 'BABA', name: '阿里巴巴', asset: 'equity', aliases: ['alibaba', '阿里'] },
  { base: 'PDD', name: '拼多多', asset: 'equity', aliases: ['pinduoduo', 'temu'] },
  { base: 'HOOD', name: 'Robinhood', asset: 'equity' },
  { base: 'PLTR', name: 'Palantir', asset: 'equity', aliases: ['帕兰提尔'] },
  { base: 'UBER', name: '优步', asset: 'equity', aliases: ['uber'] },
  { base: 'ABNB', name: '爱彼迎', asset: 'equity', aliases: ['airbnb'] },
  { base: 'NKE', name: '耐克', asset: 'equity', aliases: ['nike'] },
  { base: 'DIS', name: '迪士尼', asset: 'equity', aliases: ['disney'] },
  { base: 'BA', name: '波音', asset: 'equity', aliases: ['boeing'] },
  { base: 'JPM', name: '摩根大通', asset: 'equity', aliases: ['jpmorgan'] },
  { base: 'V', name: 'Visa', asset: 'equity' },
  { base: 'MA', name: '万事达', asset: 'equity', aliases: ['mastercard'] },
  { base: 'COST', name: '开市客', asset: 'equity', aliases: ['costco'] },
  { base: 'AVGO', name: '博通', asset: 'equity', aliases: ['broadcom'] },
  { base: 'ORCL', name: '甲骨文', asset: 'equity', aliases: ['oracle'] },
  { base: 'CRM', name: 'Salesforce', asset: 'equity' },
  { base: 'INTC', name: '英特尔', asset: 'equity', aliases: ['intel'] },
  { base: 'QCOM', name: '高通', asset: 'equity', aliases: ['qualcomm'] },
  { base: 'TSM', name: '台积电', asset: 'equity', aliases: ['tsmc', '台湾积体电路'] },
]

export const SEARCH_HINTS = [
  '微软 → MSFT',
  '比特币 → BTC',
  '英伟达 → NVDA',
  '美光 → MU',
  '特斯拉 → TSLA',
  '苹果 → AAPL',
]

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, '').replace(/[_-]/g, '')
}

function scoreEntry(entry: CatalogEntry, q: string): number {
  if (!q) return 0
  const base = entry.base.toLowerCase()
  const name = entry.name.toLowerCase().replace(/\s+/g, '')
  const aliases = (entry.aliases ?? []).map((a) => a.toLowerCase().replace(/\s+/g, ''))

  if (base === q || name === q || aliases.includes(q)) return 100
  if (base.startsWith(q)) return 90
  if (name.startsWith(q)) return 85
  if (aliases.some((a) => a.startsWith(q))) return 80
  if (base.includes(q)) return 70
  if (name.includes(q)) return 65
  if (aliases.some((a) => a.includes(q))) return 60
  /* 微软 / 比特 这类两字起就能命中 */
  if (q.length >= 2 && (name.includes(q) || aliases.some((a) => a.includes(q)))) return 55
  return 0
}

export function searchSymbolCatalog(
  query: string,
  options?: { limit?: number; asset?: CatalogAsset | 'all' },
): Array<CatalogEntry & { score: number }> {
  const q = normalizeQuery(query)
  const limit = options?.limit ?? 8
  const asset = options?.asset ?? 'all'
  if (!q) {
    /* 空查询给热门引导，方便不知道代码的人 */
    return ENTRIES.filter((e) => asset === 'all' || e.asset === asset)
      .slice(0, limit)
      .map((e) => ({ ...e, score: 0 }))
  }
  return ENTRIES
    .filter((e) => asset === 'all' || e.asset === asset)
    .map((e) => ({ ...e, score: scoreEntry(e, q) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.base.localeCompare(b.base))
    .slice(0, limit)
}

export function catalogDisplayName(base: string): string | undefined {
  return ENTRIES.find((e) => e.base.toUpperCase() === base.toUpperCase())?.name
}

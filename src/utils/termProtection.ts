export interface ProtectionSlot {
  placeholder: string;
  original: string;
}

/** 转义正则特殊字符 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 按长度降序，避免短词误匹配长词的一部分 */
function sortTerms(terms: string[]): string[] {
  return [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
}

/**
 * 翻译前：将保护词替换为不可译占位符（Unicode 私有区字符）
 */
export function protectTerms(
  text: string,
  terms: string[]
): { text: string; slots: ProtectionSlot[] } {
  if (!text || terms.length === 0) {
    return { text, slots: [] };
  }

  let result = text;
  const slots: ProtectionSlot[] = [];
  let slotIndex = 0;

  for (const term of sortTerms(terms)) {
    const regex = new RegExp(escapeRegex(term), "gi");
    result = result.replace(regex, (match) => {
      const placeholder = `\uE000${slotIndex++}\uE001`;
      slots.push({ placeholder, original: match });
      return placeholder;
    });
  }

  return { text: result, slots };
}

/**
 * 翻译后：将占位符还原为原始保护词
 * 同时尝试修复 Google 可能改写占位符或误译品牌名的情况
 */
export function restoreTerms(
  text: string,
  slots: ProtectionSlot[],
  terms: string[]
): string {
  if (!text) return text;

  let result = text;

  // 1. 精确还原占位符
  for (const slot of slots) {
    result = result.split(slot.placeholder).join(slot.original);
  }

  // 2. 占位符被 Google 破坏时的模糊还原（括号变体等）
  slots.forEach((slot, i) => {
    const fuzzyPatterns = [
      new RegExp(`\\uE000${i}\\uE001`, "g"),
      new RegExp(`⟦${i}⟧`, "g"),
      new RegExp(`\\{\\{${i}\\}\\}`, "g"),
    ];
    for (const pattern of fuzzyPatterns) {
      result = result.replace(pattern, slot.original);
    }
  });

  // 3. 修复常见误译（如 QQlink → QQリンク）
  for (const term of sortTerms(terms)) {
    result = fixCommonMistranslations(result, term);
  }

  return result;
}

/** 修复各语言对品牌名的常见误译变体 */
function fixCommonMistranslations(text: string, term: string): string {
  const base = term.replace(/\s+/g, "");
  if (!base) return text;

  const variants: string[] = [term];
  const lower = base.toLowerCase();

  // QQlink 类：日文片假名、全角、大小写变体
  if (/^qq\s*link$/i.test(base) || lower === "qqlink") {
    variants.push(
      "QQリンク",
      "ＱＱリンク",
      "ＱＱｌｉｎｋ",
      "qqリンク",
      "QQLink",
      "QQLink",
      "qq link",
      "QQ link"
    );
  } else {
    // 通用：全角拉丁、首字母大写变体
    variants.push(
      toFullWidthLatin(base),
      base.charAt(0).toUpperCase() + base.slice(1).toLowerCase()
    );
  }

  let result = text;
  for (const wrong of variants) {
    if (wrong === term) continue;
    result = result.split(wrong).join(term);
  }
  return result;
}

function toFullWidthLatin(str: string): string {
  return str.replace(/[A-Za-z0-9]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 0xfee0)
  );
}

/** 整句仅为保护词时跳过翻译 */
export function shouldSkipTranslation(text: string, terms: string[]): boolean {
  const trimmed = text.trim();
  return sortTerms(terms).some(
    (term) => trimmed.toLowerCase() === term.toLowerCase()
  );
}

export async function translateWithProtection(
  text: string,
  terms: string[],
  translateFn: (text: string) => Promise<string>
): Promise<string> {
  if (!text.trim()) return text;
  if (shouldSkipTranslation(text, terms)) return text;

  const { text: protectedText, slots } = protectTerms(text, terms);
  const hasProtection = slots.length > 0;

  const raw =
    hasProtection && protectedText === text
      ? text
      : await translateFn(hasProtection ? protectedText : text);

  return hasProtection ? restoreTerms(raw, slots, terms) : raw;
}

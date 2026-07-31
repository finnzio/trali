export const LANGUAGE_PAIR_LIMIT = 8;

export const PAIR_LANGUAGES = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "es",
  "de",
  "fr",
  "pt-BR",
  "ru",
  "hi",
  "id",
  "vi",
  "th",
  "tr",
  "it",
  "pl",
  "uk",
  "nl",
  "ms",
] as const;

export type PairLanguageCode = (typeof PAIR_LANGUAGES)[number];

export type LanguagePair = {
  id: string;
  source: PairLanguageCode;
  target: PairLanguageCode;
};

export function isPairLanguageCode(value: string): value is PairLanguageCode {
  return (PAIR_LANGUAGES as readonly string[]).includes(value);
}

/** Full language names for pair quick-select, e.g. "简体中文 → 英语". */
export function formatLanguagePairLabel(
  source: string,
  target: string,
  languageName: (code: string) => string,
): string {
  return `${languageName(source)} → ${languageName(target)}`;
}

export function defaultLanguagePairs(): LanguagePair[] {
  return [
    { id: "pair-zh-cn-en", source: "zh-CN", target: "en" },
    { id: "pair-en-ja", source: "en", target: "ja" },
  ];
}

export function sanitizeLanguagePairs(
  pairs: Array<{ id?: string; source?: string; target?: string }> | undefined,
): LanguagePair[] {
  if (!Array.isArray(pairs)) return [];
  const seen = new Set<string>();
  const result: LanguagePair[] = [];
  for (const pair of pairs) {
    if (!pair) continue;
    const source = pair.source ?? "";
    const target = pair.target ?? "";
    if (!isPairLanguageCode(source) || !isPairLanguageCode(target)) continue;
    if (source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: pair.id?.trim() || crypto.randomUUID(),
      source,
      target,
    });
    if (result.length >= LANGUAGE_PAIR_LIMIT) break;
  }
  return result;
}

/** Pick a default source/target for a new pair that is not already configured. */
export function nextLanguagePairDraft(
  existing: LanguagePair[],
): Pick<LanguagePair, "source" | "target"> {
  const used = new Set(existing.map((pair) => `${pair.source}->${pair.target}`));
  const candidates: Array<[PairLanguageCode, PairLanguageCode]> = [
    ["zh-CN", "en"],
    ["en", "zh-CN"],
    ["en", "ja"],
    ["ja", "en"],
    ["zh-CN", "ja"],
    ["en", "ko"],
    ["en", "hi"],
    ["en", "id"],
    ["en", "vi"],
    ["zh-CN", "vi"],
    ["en", "th"],
    ["en", "tr"],
    ["en", "it"],
    ["en", "pl"],
    ["en", "uk"],
    ["en", "nl"],
    ["en", "ms"],
  ];
  for (const [source, target] of candidates) {
    if (!used.has(`${source}->${target}`)) {
      return { source, target };
    }
  }
  for (const source of PAIR_LANGUAGES) {
    for (const target of PAIR_LANGUAGES) {
      if (source === target) continue;
      if (!used.has(`${source}->${target}`)) {
        return { source, target };
      }
    }
  }
  return { source: "zh-CN", target: "en" };
}

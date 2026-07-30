export type ProofreadNormalized = {
  /** Issues body only (no heading). Null when absent. */
  issuesText: string | null;
  noIssues: boolean;
  /** Corrected body only. */
  correctedText: string | null;
  styleSuggestionsText: string | null;
  polishedText: string | null;
  /** When markers are missing / empty — show as a single fallback block. */
  fallbackText: string | null;
  speakableText: string | null;
  usedFallback: boolean;
};

const SECTION_MARKERS = [
  "ISSUES",
  "CORRECTED",
  "STYLE_SUGGESTIONS",
  "POLISHED",
] as const;

type SectionName = (typeof SECTION_MARKERS)[number];

const MARKER_LINE =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*|__)?(ISSUES|CORRECTED|STYLE_SUGGESTIONS|POLISHED)(?:\*\*|__)?\s*:?\s*(?=\n|$)/gi;

function isNoIssuesContent(value: string): boolean {
  const normalized = value
    .trim()
    .replace(/^[•\-*]\s*/, "")
    .replace(/[.!。！]+$/u, "")
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  return (
    /^(none|n\/a|nil|null|no(?:\s+grammar)?\s*issues?|no(?:\s+grammar)?\s*errors?|nothing|无|无错误|没有错误|没有问题|无明显错误|なし|問題なし|없음|오류\s*없음)$/u.test(
      normalized,
    ) ||
    /^(no\s+issues?\s+found|no\s+errors?\s+found|未发现(?:语法)?错误|未發現(?:語法)?錯誤)$/u.test(
      normalized,
    )
  );
}

function parseSections(raw: string): Partial<Record<SectionName, string>> {
  const matches: Array<{ name: SectionName; index: number; end: number }> = [];
  const pattern = new RegExp(MARKER_LINE.source, MARKER_LINE.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const name = match[1].toUpperCase() as SectionName;
    if (!SECTION_MARKERS.includes(name)) continue;
    matches.push({
      name,
      index: match.index + (match[0].startsWith("\n") ? 1 : 0),
      end: match.index + match[0].length,
    });
  }
  if (matches.length === 0) return {};

  const sections: Partial<Record<SectionName, string>> = {};
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const body = raw.slice(current.end, next ? next.index : raw.length).trim();
    if (sections[current.name] === undefined) {
      sections[current.name] = body;
    }
  }
  return sections;
}

/**
 * Parse grammar-check model output into structured sections for UI blocks.
 * Headings are not embedded in body text — the app renders them as chrome.
 */
export function normalizeProofreadOutput(
  raw: string,
  options: {
    hasStyle: boolean;
    sourceText: string;
    emptyResult: string;
    unexpectedFormat: string;
  },
): ProofreadNormalized {
  const trimmed = raw.trim();
  const { hasStyle, sourceText, emptyResult, unexpectedFormat } = options;

  if (!trimmed) {
    return {
      issuesText: null,
      noIssues: false,
      correctedText: null,
      styleSuggestionsText: null,
      polishedText: null,
      fallbackText: emptyResult,
      speakableText: sourceText.trim() || null,
      usedFallback: true,
    };
  }

  const sections = parseSections(trimmed);
  const markerCount = SECTION_MARKERS.filter(
    (name) => sections[name] !== undefined,
  ).length;

  if (markerCount === 0) {
    return {
      issuesText: null,
      noIssues: false,
      correctedText: null,
      styleSuggestionsText: null,
      polishedText: null,
      fallbackText: `${unexpectedFormat}\n${trimmed}`,
      speakableText: trimmed,
      usedFallback: true,
    };
  }

  const issuesBody = sections.ISSUES?.trim() ?? "";
  const noIssues =
    sections.ISSUES !== undefined ? isNoIssuesContent(issuesBody) : false;
  const corrected = sections.CORRECTED?.trim() || null;
  const styleSuggestions = sections.STYLE_SUGGESTIONS?.trim() || null;
  const polished = sections.POLISHED?.trim() || null;

  const issuesText =
    sections.ISSUES === undefined
      ? null
      : noIssues
        ? null
        : issuesBody || null;

  const hasUsefulBody =
    issuesText != null ||
    corrected != null ||
    (hasStyle && (styleSuggestions != null || polished != null)) ||
    noIssues;

  if (!hasUsefulBody) {
    return {
      issuesText: null,
      noIssues: false,
      correctedText: null,
      styleSuggestionsText: null,
      polishedText: null,
      fallbackText: `${unexpectedFormat}\n${trimmed}`,
      speakableText: trimmed,
      usedFallback: true,
    };
  }

  const speakableText =
    (hasStyle ? polished || corrected : corrected || polished) ||
    trimmed ||
    sourceText.trim() ||
    null;

  return {
    issuesText,
    noIssues: sections.ISSUES !== undefined ? noIssues : false,
    correctedText: corrected,
    styleSuggestionsText:
      hasStyle && styleSuggestions && !isNoIssuesContent(styleSuggestions)
        ? styleSuggestions
        : null,
    polishedText: hasStyle ? polished : null,
    fallbackText: null,
    speakableText: speakableText || null,
    usedFallback: false,
  };
}

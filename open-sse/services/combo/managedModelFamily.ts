export type ManagedModelFamilyCatalog = {
  authoritative: boolean;
  models: readonly string[];
};

export type ManagedModelFamilyCatalogs = Readonly<Record<string, ManagedModelFamilyCatalog>>;

export type ManagedModelFamilyRule = {
  family: string;
  mode: "latest" | "exact";
  providers: readonly string[];
  version?: string;
};

type ParsedCandidate = {
  model: string;
  provider: string;
  version: readonly number[];
};

const CLAUDE_OPUS_MODEL_PATTERN =
  /^claude-opus-(\d+)(?:[.-](\d+))?(?:[-.]\d{8}|[-.]thinking(?:[-.](?:low|medium|high|xhigh))?|[-.](?:low|medium|high|xhigh))?$/i;

function parseVersion(value: string): readonly number[] | null {
  if (!/^\d+(?:[.-]\d+)?$/.test(value)) return null;
  return value.split(/[.-]/).map(Number);
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseClaudeOpusCandidate(provider: string, model: string): ParsedCandidate | null {
  const match = CLAUDE_OPUS_MODEL_PATTERN.exec(model);
  if (!match) return null;
  return {
    provider,
    model,
    version: [Number(match[1]), ...(match[2] === undefined ? [] : [Number(match[2])])],
  };
}

export function resolveManagedModelFamilyTargets(
  rule: ManagedModelFamilyRule,
  catalogs: ManagedModelFamilyCatalogs
): string[] {
  if (rule.family !== "claude-opus") return [];
  const exactVersion = rule.mode === "exact" ? parseVersion(rule.version ?? "") : null;
  if (rule.mode === "exact" && !exactVersion) return [];

  const candidates: ParsedCandidate[] = [];
  for (const provider of rule.providers) {
    const catalog = catalogs[provider];
    if (!catalog?.authoritative) continue;
    for (const model of catalog.models) {
      const candidate = parseClaudeOpusCandidate(provider, model);
      if (candidate) candidates.push(candidate);
    }
  }
  if (candidates.length === 0) return [];

  const selectedVersion =
    exactVersion ??
    candidates
      .map((candidate) => candidate.version)
      .sort(compareVersions)
      .at(-1);
  if (!selectedVersion) return [];

  return rule.providers.flatMap((provider) => {
    const candidate = candidates.find(
      (entry) =>
        entry.provider === provider && compareVersions(entry.version, selectedVersion) === 0
    );
    return candidate ? [`${provider}/${candidate.model}`] : [];
  });
}

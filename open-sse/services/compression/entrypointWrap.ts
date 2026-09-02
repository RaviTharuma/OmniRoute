import type { CompressionConfig, CompressionResult } from "./types.ts";
import type { CachingDetectionContext } from "./cachingAware.ts";
import type { RiskGateConfig } from "./riskGate/riskGate.ts";
import { resolveRiskGate, withRiskGate } from "./riskGate/strategyWrap.ts";
import {
  resolveQuantumLock,
  quantumCachingContext,
  withQuantumLock,
  withQuantumLockAsync,
} from "./quantumLock/index.ts";

export interface CompressionEntrypointOptions {
  config?: CompressionConfig;
  riskGate?: RiskGateConfig;
  cachingContext?: CachingDetectionContext;
}

function snapshotAnthropicSystem(body: Record<string, unknown>): unknown {
  if (!Object.prototype.hasOwnProperty.call(body, "system")) return undefined;
  const value = body.system;
  if (value == null || typeof value === "string") return value;
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

function restorePreservedAnthropicSystem(
  snapshot: unknown,
  preserveSystemPrompt: boolean,
  result: CompressionResult
): CompressionResult {
  if (!preserveSystemPrompt || snapshot === undefined) return result;
  if (!result.body || typeof result.body !== "object") return result;
  return { ...result, body: { ...result.body, system: snapshot } };
}

export function withCompressionEntrypointGuards<T extends CompressionEntrypointOptions>(
  body: Record<string, unknown>,
  options: T | undefined,
  run: (body: Record<string, unknown>) => CompressionResult
): CompressionResult {
  const systemSnapshot = snapshotAnthropicSystem(body);
  const preserveSystemPrompt = options?.config?.preserveSystemPrompt !== false;
  return restorePreservedAnthropicSystem(
    systemSnapshot,
    preserveSystemPrompt,
    withQuantumLock(
      body,
      resolveQuantumLock(options),
      quantumCachingContext(body, options),
      (quantumBody) =>
        withRiskGate(quantumBody, resolveRiskGate(options), (riskBody) => run(riskBody))
    )
  );
}

export async function withCompressionEntrypointGuardsAsync<T extends CompressionEntrypointOptions>(
  body: Record<string, unknown>,
  options: T | undefined,
  run: (body: Record<string, unknown>) => Promise<CompressionResult>
): Promise<CompressionResult> {
  const systemSnapshot = snapshotAnthropicSystem(body);
  const preserveSystemPrompt = options?.config?.preserveSystemPrompt !== false;
  const result = await withQuantumLockAsync(
    body,
    resolveQuantumLock(options),
    quantumCachingContext(body, options),
    run
  );
  return restorePreservedAnthropicSystem(systemSnapshot, preserveSystemPrompt, result);
}

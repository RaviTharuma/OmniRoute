/**
 * Helpers for clear model-not-found signaling (issue #14068).
 * Draft scaffolding — wire into combo/pre-dispatch when catalog miss is known.
 */

export const MODEL_NOT_FOUND_CODE = "model_not_found" as const

export type ModelNotFoundPayload = {
  error: {
    message: string
    type: "invalid_request_error"
    code: typeof MODEL_NOT_FOUND_CODE
    param: "model"
  }
}

export function buildModelNotFoundPayload(modelId: string): ModelNotFoundPayload {
  const id = modelId.trim() || "(empty)"
  return {
    error: {
      message: `The model \`${id}\` does not exist or is not present in the live /v1/models catalog.`,
      type: "invalid_request_error",
      code: MODEL_NOT_FOUND_CODE,
      param: "model",
    },
  }
}

export function isKnownModelId(modelId: string, liveCatalogIds: ReadonlySet<string>): boolean {
  const needle = modelId.trim().toLowerCase()
  if (!needle) return false
  for (const id of liveCatalogIds) {
    if (id.trim().toLowerCase() === needle) return true
  }
  return false
}

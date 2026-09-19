/**
 * Clear model-not-found signaling for catalog misses (#14068).
 * `GET /v1/models/{id}` is the source of truth for alias identity.
 */

export const MODEL_NOT_FOUND_CODE = "model_not_found" as const;

export type ModelNotFoundPayload = {
  error: {
    message: string;
    type: "invalid_request_error";
    code: typeof MODEL_NOT_FOUND_CODE;
    param: "model";
  };
};

export function buildModelNotFoundPayload(modelId: string): ModelNotFoundPayload {
  const id = modelId.trim() || "(empty)";
  return {
    error: {
      message: `The model \`${id}\` does not exist or is not present in the live /v1/models catalog.`,
      type: "invalid_request_error",
      code: MODEL_NOT_FOUND_CODE,
      param: "model",
    },
  };
}

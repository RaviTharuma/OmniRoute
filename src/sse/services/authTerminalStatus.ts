import { PROVIDER_ERROR_TYPES } from "@omniroute/open-sse/services/errorClassifier.ts";
import { isCreditsExhausted } from "@omniroute/open-sse/services/accountFallback.ts";
import { resolveProviderId, WEB_COOKIE_PROVIDERS } from "@/shared/constants/providers";

// #8200: cookie-auth providers (perplexity-web, grok-web, ...) use a rotating browser
// session, not a static API key — a 401 means "session needs a refresh", not "dead".
export function isRecoverableCookieAuth401(
  provider: string | null,
  providerErrorType: string | null
): boolean {
  return (
    providerErrorType !== PROVIDER_ERROR_TYPES.ACCOUNT_DEACTIVATED &&
    provider != null &&
    resolveProviderId(provider) in WEB_COOKIE_PROVIDERS
  );
}
// #12242 (402 variant of #3027): a bare 402 on a passthrough/gateway
// provider that multiplexes many models behind one credential
// (kilo-gateway, ollama-cloud, etc.) is a PER-MODEL billing signal, not
// proof the credential itself is dead — free models on the same connection
// remain perfectly usable. Only terminalize the whole connection for a 402
// when the provider is NOT a per-model-quota provider; the caller lets it
// fall through to the per-model lockout branch instead.
// `result.creditsExhausted` is a provider's own explicit classification
// (independent of HTTP status) and stays unconditionally terminal — it is
// not scoped by this check.
export function isConnectionWideCreditsExhausted(
  status: number,
  result: { permanent?: boolean; creditsExhausted?: boolean },
  isPerModelQuotaProvider: boolean
): boolean {
  return result.creditsExhausted || (status === 402 && !isPerModelQuotaProvider);
}
export function resolveTerminalConnectionStatus(
  status: number,
  result: { permanent?: boolean; creditsExhausted?: boolean },
  providerErrorType: string | null = null,
  provider: string | null = null,
  isPerModelQuotaProvider = false,
  errorText: string = ""
): string | null {
  // Credits-depleted bodies (and explicit 402) park the connection. A renewing
  // quota window (billing-cycle / usage-limit QUOTA_EXHAUSTED) must stay on the
  // cached-reset cooldown path — not credits_exhausted with cooldownMs=0.
  if (
    isConnectionWideCreditsExhausted(status, result, isPerModelQuotaProvider) ||
    (!isPerModelQuotaProvider && isCreditsExhausted(errorText))
  ) {
    return "credits_exhausted";
  }
  if (
    providerErrorType === PROVIDER_ERROR_TYPES.PROJECT_ROUTE_ERROR ||
    providerErrorType === PROVIDER_ERROR_TYPES.GEO_BLOCKED ||
    providerErrorType === PROVIDER_ERROR_TYPES.OAUTH_INVALID_TOKEN ||
    // #1010: Cloudflare fingerprint rejection is the CDN refusing the CLIENT's
    // signature, not the account's credentials — never a terminal account state.
    // A different client on the same key succeeds (measured 2026-08-08: curl 200,
    // urllib 403 on byte-identical body), so banning the account here would flip a
    // healthy free pool to ALL_ACCOUNTS_INACTIVE after two such calls.
    providerErrorType === PROVIDER_ERROR_TYPES.FINGERPRINT_REJECTION
  ) {
    return null;
  }
  if (result.permanent || providerErrorType === PROVIDER_ERROR_TYPES.FORBIDDEN) {
    return "banned";
  }
  if (
    (providerErrorType === PROVIDER_ERROR_TYPES.ACCOUNT_DEACTIVATED ||
      providerErrorType === PROVIDER_ERROR_TYPES.UNAUTHORIZED ||
      status === 401) &&
    !isRecoverableCookieAuth401(provider, providerErrorType)
  ) {
    return "expired";
  }
  return null;
}

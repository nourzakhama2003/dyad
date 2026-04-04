import { useSettings } from "./useSettings";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { getEffectiveDefaultChatMode, type ChatMode } from "@/lib/schemas";

export function useInitialChatMode(): ChatMode | undefined {
  const { settings, envVars } = useSettings();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();

  let effectiveDefaultMode: ChatMode | undefined =
    settings?.selectedChatMode ?? undefined;

  if (!effectiveDefaultMode && !isQuotaLoading && settings) {
    const freeAgentQuotaAvailable = !isQuotaExceeded;
    effectiveDefaultMode = getEffectiveDefaultChatMode(
      settings,
      envVars,
      freeAgentQuotaAvailable,
    );
  }

  return effectiveDefaultMode;
}

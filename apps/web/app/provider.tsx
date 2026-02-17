"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { ThemeProvider } from "next-themes";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useChatStore, useSettingsStore } from "@/stores/document-store";

const resolveModelConfig = (
  providers: ReturnType<typeof useSettingsStore.getState>["providers"],
  modelId: string | undefined,
  fallbackProviderId: string,
) => {
  const matched = providers
    .map((provider) => ({
      provider,
      model: provider.models.find((item) => item.id === modelId) ?? null,
    }))
    .find((item) => item.model);
  if (matched?.model) return matched;
  const fallbackProvider =
    providers.find((provider) => provider.id === fallbackProviderId) ??
    providers[0];
  const fallbackModel = fallbackProvider?.models[0] ?? null;
  if (!fallbackProvider || !fallbackModel) return null;
  return { provider: fallbackProvider, model: fallbackModel };
};

export function RootProvider({ children }: { children: ReactNode }) {
  const chatId = useChatStore((s) => s.activeSessionId);
  const runtime = useChatRuntime({
    id: chatId,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({
      api: "/api/chat",
      body: () => {
        const settingsState = useSettingsStore.getState();
        const chatModelId = settingsState.modelAssignments?.chat;
        const resolved = resolveModelConfig(
          settingsState.providers,
          chatModelId,
          settingsState.activeProviderId,
        );
        const activeProvider = resolved?.provider;
        const activeModel = resolved?.model;

        return {
          config: activeProvider && activeModel
            ? {
                apiKey: activeProvider.apiKey || undefined,
                baseUrl: activeProvider.baseUrl || undefined,
                modelName: activeModel.modelName || undefined,
              }
            : undefined,
        };
      },
    }),
  });
  const language = useSettingsStore((s) => s.language);

  useKeyboardShortcuts();
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
        <Toaster />
      </AssistantRuntimeProvider>
    </ThemeProvider>
  );
}

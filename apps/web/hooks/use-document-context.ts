"use client";

import { useEffect } from "react";
import { useAui } from "@assistant-ui/store";
import { useDocumentStore, useSettingsStore } from "@/stores/document-store";

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

export function useDocumentContext() {
  const aui = useAui();

  useEffect(() => {
    return aui.modelContext().register({
      getModelContext: () => {
        const documentState = useDocumentStore.getState();
        const settingsState = useSettingsStore.getState();

        const fileName = documentState.fileName;
        const content = documentState.content;
        const selectionRange = documentState.selectionRange;

        const hasSelection = selectionRange !== null;
        const selectedText = hasSelection
          ? content.slice(selectionRange.start, selectionRange.end)
          : null;

        const selectionInfo = hasSelection
          ? `The user has selected the following text:\n\`\`\`\n${selectedText}\n\`\`\`\nYou can use the replace_selection tool to replace this text.`
          : "The user has NOT selected any text. Do NOT use the replace_selection tool.";

        const chatModelId = settingsState.modelAssignments?.chat;
        const resolved = resolveModelConfig(
          settingsState.providers,
          chatModelId,
          settingsState.activeProviderId,
        );
        const activeProvider = resolved?.provider;
        const activeModel = resolved?.model;

        return {
          system: `The user is currently editing a LaTeX document named "${fileName}".

Here is the current content of the document:
\`\`\`latex
${content}
\`\`\`

${selectionInfo}

When helping the user, reference this document and provide relevant suggestions.`,
          config: activeProvider && activeModel
            ? {
                apiKey: activeProvider.apiKey || undefined,
                baseUrl: activeProvider.baseUrl || undefined,
                modelName: activeModel.modelName || undefined,
              }
            : undefined,
        };
      },
      subscribe: (callback) => {
        const unsubscribeDocument = useDocumentStore.subscribe(() => {
          callback();
        });
        const unsubscribeSettings = useSettingsStore.subscribe(() => {
          callback();
        });
        return () => {
          unsubscribeDocument();
          unsubscribeSettings();
        };
      },
    });
  }, [aui]);
}

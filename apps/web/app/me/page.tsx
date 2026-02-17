"use client";

import Link from "next/link";
import { useMemo, useState, useRef, type ChangeEvent } from "react";
import { DownloadIcon, LogOutIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import {
  useAuthStore,
  useChatStore,
  useDocumentStore,
  useProjectStore,
  useSettingsStore,
} from "@/stores/document-store";
import { indexedDBStorage } from "@/lib/storage/indexeddb-storage";
import { Button } from "@/components/ui/button";

export default function MePage() {
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const users = useAuthStore((s) => s.users);
  const logout = useAuthStore((s) => s.logout);

  const sessions = useChatStore((s) => s.sessions);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const resetChats = useChatStore((s) => s.resetChats);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const providers = useSettingsStore((s) => s.providers);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const chatModelId = useSettingsStore((s) => s.modelAssignments?.chat);

  const username = useMemo(() => {
    if (!currentUserId) return "";
    return users.find((u) => u.id === currentUserId)?.username ?? "";
  }, [users, currentUserId]);

  const [isWorking, setIsWorking] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const activeModel = useMemo(() => {
    const match = providers
      .map((provider) => ({
        provider,
        model: provider.models.find((item) => item.id === chatModelId) ?? null,
      }))
      .find((item) => item.model);
    if (match?.model) return match;
    const fallbackProvider =
      providers.find((provider) => provider.id === activeProviderId) ??
      providers[0];
    const fallbackModel = fallbackProvider?.models[0] ?? null;
    if (!fallbackProvider || !fallbackModel) return null;
    return { provider: fallbackProvider, model: fallbackModel };
  }, [providers, chatModelId, activeProviderId]);

  if (!currentUserId) {
    return (
      <main className="mx-auto flex h-full w-full max-w-2xl flex-col gap-6 p-6">
        <div className="space-y-1">
          <h1 className="font-semibold text-xl">个人中心</h1>
          <div className="text-muted-foreground text-sm">请先登录</div>
        </div>
        <Button asChild variant="outline">
          <Link href="/">返回工作区</Link>
        </Button>
      </main>
    );
  }

  const settingsKey = `open-prism-settings:${currentUserId}`;
  const chatKey = `open-prism-chat:${currentUserId}`;
  const documentKey = `open-prism-document:${currentUserId}`;
  const projectDocumentKey = activeProjectId
    ? `open-prism-document:${currentUserId}:${activeProjectId}`
    : null;

  const handleExport = async () => {
    setIsWorking(true);
    try {
      const settingsRaw = (() => {
        try {
          return localStorage.getItem(settingsKey);
        } catch {
          return null;
        }
      })();
      const chatRaw = (() => {
        try {
          return localStorage.getItem(chatKey);
        } catch {
          return null;
        }
      })();
      const documentRaw = await indexedDBStorage.getItem(documentKey);

      const data = {
        exportedAt: new Date().toISOString(),
        user: {
          id: currentUserId,
          username,
        },
        storage: {
          settings: {
            raw: settingsRaw,
            parsed: safeJsonParse(settingsRaw),
          },
          chat: {
            raw: chatRaw,
            parsed: safeJsonParse(chatRaw),
          },
          document: {
            raw: documentRaw,
            parsed: safeJsonParse(documentRaw),
          },
        },
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `open-prism-${(username || currentUserId).replaceAll(
        /[^a-zA-Z0-9_-]/g,
        "_",
      )}-backup.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("已导出个人数据");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setIsWorking(false);
    }
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImport = async (file: File | null) => {
    if (!file) return;
    setIsWorking(true);
    try {
      const text = await file.text();
      const parsed = safeJsonParse(text) as {
        storage?: {
          settings?: { raw?: string | null; parsed?: unknown };
          chat?: { raw?: string | null; parsed?: unknown };
          document?: { raw?: unknown; parsed?: unknown };
        };
      } | null;
      if (!parsed?.storage) {
        throw new Error("无法识别的备份文件");
      }

      const settingsRaw =
        typeof parsed.storage.settings?.raw === "string"
          ? parsed.storage.settings.raw
          : parsed.storage.settings?.parsed
            ? JSON.stringify(parsed.storage.settings.parsed)
            : null;
      const chatRaw =
        typeof parsed.storage.chat?.raw === "string"
          ? parsed.storage.chat.raw
          : parsed.storage.chat?.parsed
            ? JSON.stringify(parsed.storage.chat.parsed)
            : null;
      const documentValue =
        parsed.storage.document?.raw ?? parsed.storage.document?.parsed ?? null;
      const documentRaw =
        typeof documentValue === "string"
          ? documentValue
          : documentValue != null
            ? JSON.stringify(documentValue)
            : null;

      if (settingsRaw) {
        localStorage.setItem(settingsKey, settingsRaw);
      }
      if (chatRaw) {
        localStorage.setItem(chatKey, chatRaw);
      }
      if (documentRaw) {
        await indexedDBStorage.setItem(documentKey, documentRaw);
        if (projectDocumentKey) {
          await indexedDBStorage.setItem(projectDocumentKey, documentRaw);
        }
      }

      useDocumentStore.persist.setOptions({ name: documentKey });

      await Promise.all([
        useSettingsStore.persist.rehydrate(),
        useChatStore.persist.rehydrate(),
        useDocumentStore.persist.rehydrate(),
      ]);

      toast.success("已导入个人数据");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setIsWorking(false);
    }
  };

  const handleImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    void handleImport(file);
  };

  const handleClear = async () => {
    if (
      !window.confirm(
        "将清空当前账号的项目文件、聊天记录与模型配置。此操作不可恢复，确认继续？",
      )
    ) {
      return;
    }

    setIsWorking(true);
    try {
      try {
        localStorage.removeItem(settingsKey);
        localStorage.removeItem(chatKey);
      } catch {}
      await indexedDBStorage.removeItem(documentKey);

      useSettingsStore.getState().resetSettings();
      useChatStore.getState().resetChats();
      useDocumentStore.getState().resetProject();

      await Promise.all([
        useSettingsStore.persist.rehydrate(),
        useChatStore.persist.rehydrate(),
        useDocumentStore.persist.rehydrate(),
      ]);

      toast.success("已清空个人数据");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清空失败");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-xl">个人中心</h1>
          <div className="text-muted-foreground text-sm">
            {username || "未命名用户"} · {currentUserId}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" disabled={isWorking}>
            <Link href="/">返回工作区</Link>
          </Button>
          <Button variant="secondary" onClick={logout} disabled={isWorking}>
            <LogOutIcon />
            退出登录
          </Button>
        </div>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="font-medium text-sm">数据与配置</div>
            <div className="text-muted-foreground text-xs">
              模型配置、聊天记录、项目文件会自动保存到当前账号
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={importInputRef}
              type="file"
              className="hidden"
              accept="application/json"
              onChange={handleImportChange}
            />
            <Button
              variant="outline"
              onClick={handleImportClick}
              disabled={isWorking}
            >
              <UploadIcon />
              导入
            </Button>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isWorking}
            >
              <DownloadIcon />
              导出
            </Button>
            <Button
              variant="destructive"
              onClick={handleClear}
              disabled={isWorking}
            >
              <Trash2Icon />
              清空
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="text-muted-foreground text-xs">当前模型</div>
            <div className="font-medium text-sm">
              {activeModel?.model
                ? `${activeModel.provider.name} · ${activeModel.model.modelName}`
                : "未配置"}
            </div>
            {activeModel?.provider.baseUrl ? (
              <div className="text-muted-foreground text-xs">
                {activeModel.provider.baseUrl}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-0.5">
          <div className="font-medium text-sm">聊天会话</div>
          <div className="text-muted-foreground text-xs">
            当前账号下的会话列表
          </div>
        </div>
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            onClick={() => resetChats()}
            disabled={isWorking}
          >
            清空会话
          </Button>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{s.title}</div>
                <div className="truncate text-muted-foreground text-xs">
                  {new Date(s.createdAt).toLocaleString()}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => deleteSession(s.id)}
                disabled={isWorking || sessions.length <= 1}
                title={sessions.length <= 1 ? "至少保留一个会话" : "删除"}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function safeJsonParse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

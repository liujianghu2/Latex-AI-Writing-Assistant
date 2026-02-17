"use client";

import { useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./sidebar";
import { LatexEditor } from "./editor/latex-editor";
import { PdfPreview } from "./preview/pdf-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectInit } from "@/hooks/use-project-init";
import { useStorageReady } from "@/hooks/use-storage-ready";
import {
  useAuthStore,
  useChatStore,
  useDocumentStore,
  useProjectStore,
  useSettingsStore,
  useUiStore,
} from "@/stores/document-store";
import { Thread } from "@/components/assistant-ui/thread";
import { useDocumentContext } from "@/hooks/use-document-context";
import { indexedDBStorage } from "@/lib/storage/indexeddb-storage";

export function WorkspaceLayout() {
  const storageReady = useStorageReady();
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const centerView = useUiStore((s) => s.centerView);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const createProject = useProjectStore((s) => s.createProject);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  useProjectInit();

  useEffect(() => {
    if (!currentUserId) return;

    const migrateStorageKey = (baseName: string) => {
      try {
        const userKey = `${baseName}:${currentUserId}`;
        const hasUserKey = localStorage.getItem(userKey) != null;
        if (hasUserKey) return;

        const legacy = localStorage.getItem(baseName);
        if (legacy != null) {
          localStorage.setItem(userKey, legacy);
        }
      } catch {}
    };

    migrateStorageKey("open-prism-settings");
    migrateStorageKey("open-prism-chat");
    migrateStorageKey("open-prism-projects");

    const settingsKey = `open-prism-settings:${currentUserId}`;
    const chatKey = `open-prism-chat:${currentUserId}`;
    const projectsKey = `open-prism-projects:${currentUserId}`;

    useSettingsStore.persist.setOptions({ name: settingsKey });
    useChatStore.persist.setOptions({ name: chatKey });
    useProjectStore.persist.setOptions({ name: projectsKey });

    void (async () => {
      const hasSettings = (() => {
        try {
          return localStorage.getItem(settingsKey) != null;
        } catch {
          return false;
        }
      })();
      if (!hasSettings) {
        useSettingsStore.getState().resetSettings();
      }
      await useSettingsStore.persist.rehydrate();

      const hasChat = (() => {
        try {
          return localStorage.getItem(chatKey) != null;
        } catch {
          return false;
        }
      })();
      if (!hasChat) {
        useChatStore.getState().resetChats();
      }
      await useChatStore.persist.rehydrate();

      await useProjectStore.persist.rehydrate();
      const currentProjects = useProjectStore.getState().projects;
      const currentActive = useProjectStore.getState().activeProjectId;
      if (currentProjects.length === 0) {
        createProject("新项目");
      } else if (!currentActive) {
        setActiveProject(currentProjects[0].id);
      }
    })();
  }, [currentUserId, createProject, setActiveProject]);

  useEffect(() => {
    if (!currentUserId || !activeProjectId) return;
    const documentKey = `open-prism-document:${currentUserId}:${activeProjectId}`;
    const currentHydratedKey = useDocumentStore.getState().hydratedKey;
    if (currentHydratedKey === documentKey) return;

    useDocumentStore.persist.setOptions({ name: documentKey });

    void (async () => {
      const legacyKey = `open-prism-document:${currentUserId}`;
      const hasDocument = (await indexedDBStorage.getItem(documentKey)) != null;
      if (!hasDocument) {
        const legacyData = await indexedDBStorage.getItem(legacyKey);
        if (legacyData != null) {
          await indexedDBStorage.setItem(documentKey, legacyData);
          await indexedDBStorage.removeItem(legacyKey);
        }
      }

      const hasCurrent = (await indexedDBStorage.getItem(documentKey)) != null;
      if (!hasCurrent) {
        useDocumentStore.getState().resetProject();
      }
      await useDocumentStore.persist.rehydrate();
      useDocumentStore.getState().setHydratedKey(documentKey);
    })();
  }, [currentUserId, activeProjectId]);

  if (!currentUserId) {
    return <LoginView />;
  }

  if (!storageReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={15} minSize={10} maxSize={25}>
        <Sidebar />
      </Panel>

      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring" />

      <Panel defaultSize={42.5} minSize={25}>
        {centerView === "chat" ? <ChatView /> : <LatexEditor />}
      </Panel>

      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring" />

      <Panel defaultSize={42.5} minSize={25}>
        <PdfPreview />
      </Panel>
    </PanelGroup>
  );
}

function ChatView() {
  useDocumentContext();
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-12 items-center border-border border-b px-4">
        <h2 className="font-medium text-sm">Chat</h2>
      </div>
      <div className="min-h-0 flex-1">
        <Thread />
      </div>
    </div>
  );
}

function LoginView() {
  const register = useAuthStore((s) => s.register);
  const login = useAuthStore((s) => s.login);
  const users = useAuthStore((s) => s.users);
  const [mode, setMode] = useState<"login" | "register">(
    users.length > 0 ? "login" : "register",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const isRegister = mode === "register";

  const handleSubmit = async () => {
    setError("");
    if (!username.trim()) {
      setError("请输入用户名");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    const ok = isRegister
      ? await register(username, password)
      : await login(username, password);
    if (!ok) {
      setError(isRegister ? "注册失败，用户名可能已存在" : "用户名或密码错误");
      return;
    }
    setUsername("");
    setPassword("");
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="font-semibold text-xl">
            {isRegister ? "创建账号" : "登录"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {isRegister
              ? "创建账号后可独立管理你的项目文件"
              : "登录后继续编辑你的项目文件"}
          </p>
        </div>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="auth-username">
              用户名
            </label>
            <Input
              id="auth-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
            />
          </div>
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="auth-password">
              密码
            </label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
            />
          </div>
          {error ? (
            <div className="text-destructive text-sm">{error}</div>
          ) : null}
          <Button className="w-full" onClick={handleSubmit}>
            {isRegister ? "创建并登录" : "登录"}
          </Button>
          <Button
            className="w-full"
            variant="ghost"
            onClick={() => setMode(isRegister ? "login" : "register")}
          >
            {isRegister ? "已有账号，去登录" : "没有账号，去注册"}
          </Button>
        </div>
      </div>
    </div>
  );
}

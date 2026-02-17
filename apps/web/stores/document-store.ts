import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { indexedDBStorage } from "@/lib/storage/indexeddb-storage";

const DEFAULT_TEX_CONTENT = `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{tikz-cd}
\\usepackage{multicol}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{1\\baselineskip}

\\begin{document}

\\section*{What is Open-Prism?}

\\textbf{Open-Prism} is an AI-powered \\LaTeX{} editor for writing scientific documents. It features built-in AI assistance to help you draft and edit text, reason through ideas, and handle formatting.

\\section*{Features}

\\begin{multicols}{2}
Open-Prism integrates AI directly in the editor with access to your project, so you can ask it to:

\`\`Add the Laplace transform of $t\\cos(at)$ in the introduction.''
\\[
  \\mathcal{L}\\left\\{ t \\cos(a t) \\right\\} = \\frac{ s^2 - a^2 }{ (s^2 + a^2)^2 }
\\]

\`\`Add a 4\\,$\\times$\\,4 table in the results section.''
\\begin{center}
\\resizebox{0.5\\linewidth}{!}{%
\\begin{tabular}{|c|c|c|c|}
  \\hline
  1 & 2 & 3 & 4 \\\\
  \\hline
  5 & 6 & 7 & 8 \\\\
  \\hline
  9 & 10 & 11 & 12 \\\\
  \\hline
  13 & 14 & 15 & 16 \\\\
  \\hline
\\end{tabular}%
}
\\end{center}

\`\`Please proofread this section, flag any errors or logical gaps, and suggest improvements for clarity.''

\`\`Am I missing corollaries or implications of Theorem 3.1? Are all bounds tight, or can some be relaxed?''

\\columnbreak

\`\`Write an abstract based on the rest of the paper.''

\`\`Add references to my paper and suggest related work I may have missed.''

\`\`Convert this hand-drawn diagram to \\LaTeX{}.''
\\par\\noindent
\\begin{minipage}[t]{0.49\\linewidth}
  \\vspace{0pt}
  \\centering
  \\includegraphics[width=\\linewidth]{hand-write.jpg}
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.49\\linewidth}
  \\vspace{0pt}
  \\centering
  \\resizebox{\\linewidth}{!}{$
    \\begin{tikzcd}[row sep=2em, column sep=1.5em, ampersand replacement=\\&]
      E
        \\arrow[dr, "e"']
        \\arrow[drr, "p_2"]
        \\arrow[ddr, "p_1"']
      \\& \\& \\\\
      \\& A \\times B \\arrow[r, "\\pi_2"'] \\arrow[d, "\\pi_1"] \\& B \\arrow[d, "g"] \\\\
      \\& A \\arrow[r, "f"'] \\& C
    \\end{tikzcd}
  $}
\\end{minipage}
\\par

\`\`Fill in all missing dependencies in my project.''

\`\`Generate a 200-word summary for a general audience.''

\`\`Create a Beamer presentation with each slide in a separate file.''
\\end{multicols}

\\section*{Getting Started}

Press \\textbf{Ctrl/⌘ + Enter} to compile your document. Press \\textbf{Enter} for a new line. The AI assistant panel at the bottom of the editor is ready to help with any \\LaTeX{} questions or tasks.

\\end{document}
`;

export type AppLanguage = "zh-CN" | "en";

export interface ProjectFile {
  id: string;
  name: string;
  type: "tex" | "image" | "folder";
  parentId?: string | null;
  content?: string;
  dataUrl?: string;
}

export interface AIModelConfig {
  id: string;
  modelName: string;
  displayName?: string;
  isAvailable?: boolean;
  lastTestedAt?: string;
}

export interface AIProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: AIModelConfig[];
}

export type ModelAssignmentKey =
  | "chat"
  | "polish"
  | "rewrite"
  | "expand"
  | "translate";

export interface DocumentHistoryEntry {
  id: string;
  fileId: string;
  createdAt: number;
  content: string;
}

interface DocumentState {
  files: ProjectFile[];
  activeFileId: string;
  cursorPosition: number;
  viewLineNumber: number;
  selectionRange: { start: number; end: number } | null;
  jumpToPosition: number | null;
  isThreadOpen: boolean;
  pdfData: Uint8Array | null;
  compileError: string | null;
  isCompiling: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  lastSavedAt: number | null;
  historyEntries: DocumentHistoryEntry[];
  initialized: boolean;
  hydratedKey: string | null;

  setActiveFile: (id: string) => void;
  addFile: (file: Omit<ProjectFile, "id">) => string;
  addFolder: (name: string, parentId?: string | null) => string;
  moveFile: (id: string, parentId: string | null) => void;
  deleteFile: (id: string) => void;
  renameFile: (id: string, name: string) => void;
  updateFileContent: (id: string, content: string) => void;
  setCursorPosition: (position: number) => void;
  setViewLineNumber: (line: number) => void;
  setSelectionRange: (range: { start: number; end: number } | null) => void;
  requestJumpToPosition: (position: number) => void;
  clearJumpRequest: () => void;
  setThreadOpen: (open: boolean) => void;
  setPdfData: (data: Uint8Array | null) => void;
  setCompileError: (error: string | null) => void;
  setIsCompiling: (isCompiling: boolean) => void;
  setIsSaving: (isSaving: boolean) => void;
  markDirty: () => void;
  markSaved: () => void;
  saveHistoryEntry: () => string | null;
  restoreHistoryEntry: (id: string) => void;
  deleteHistoryEntry: (id: string) => void;
  insertAtCursor: (text: string) => void;
  replaceSelection: (start: number, end: number, text: string) => void;
  findAndReplace: (find: string, replace: string) => boolean;
  setInitialized: () => void;
  setHydratedKey: (key: string | null) => void;
  loadProject: (files: ProjectFile[], activeFileId?: string | null) => void;
  resetProject: () => void;

  get fileName(): string;
  get content(): string;
  setFileName: (name: string) => void;
  setContent: (content: string) => void;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
}

interface ProjectState {
  projects: ProjectMeta[];
  activeProjectId: string | null;
  createProject: (name?: string) => string;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string) => void;
  resetProjects: () => void;
}

interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

interface AuthState {
  users: UserAccount[];
  currentUserId: string | null;
  register: (username: string, password: string) => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

interface SettingsState {
  language: AppLanguage;
  providers: AIProviderConfig[];
  activeProviderId: string;
  modelAssignments: Record<ModelAssignmentKey, string>;
  setLanguage: (language: AppLanguage) => void;
  addProvider: (provider: Omit<AIProviderConfig, "id">) => string;
  updateProvider: (id: string, update: Partial<AIProviderConfig>) => void;
  removeProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  addProviderModel: (providerId: string, modelName?: string) => string;
  updateProviderModel: (
    providerId: string,
    modelId: string,
    update: Partial<AIModelConfig>,
  ) => void;
  removeProviderModel: (providerId: string, modelId: string) => void;
  setModelAssignment: (key: ModelAssignmentKey, providerId: string) => void;
  getModelConfig: (modelId?: string) => {
    provider: AIProviderConfig;
    model: AIModelConfig;
  } | null;
  resetSettings: () => void;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function buildDefaultFiles(): ProjectFile[] {
  return [
    {
      id: "default-tex",
      name: "document.tex",
      type: "tex",
      parentId: null,
      content: DEFAULT_TEX_CONTENT,
    },
  ];
}

function createDefaultDocumentState() {
  return {
    files: buildDefaultFiles(),
    activeFileId: "default-tex",
    cursorPosition: 0,
    viewLineNumber: 1,
    selectionRange: null,
    jumpToPosition: null,
    isThreadOpen: false,
    pdfData: null,
    compileError: null,
    isCompiling: false,
    isSaving: false,
    hasUnsavedChanges: false,
    lastSavedAt: null,
    historyEntries: [] as DocumentHistoryEntry[],
    initialized: false,
    hydratedKey: null,
  };
}

const createModelId = (providerId: string, modelName: string) =>
  `${providerId}:${modelName}`;

const DEFAULT_PROVIDERS: AIProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    models: [
      { id: createModelId("openai", "gpt-4o"), modelName: "gpt-4o" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    models: [
      {
        id: createModelId("openrouter", "openai/gpt-4o"),
        modelName: "openai/gpt-4o",
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    models: [
      {
        id: createModelId("deepseek", "deepseek-chat"),
        modelName: "deepseek-chat",
      },
    ],
  },
  {
    id: "qwen",
    name: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    models: [
      { id: createModelId("qwen", "qwen-max"), modelName: "qwen-max" },
    ],
  },
  {
    id: "zhipu",
    name: "Zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
    models: [{ id: createModelId("zhipu", "glm-4"), modelName: "glm-4" }],
  },
  {
    id: "moonshot",
    name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKey: "",
    models: [
      {
        id: createModelId("moonshot", "moonshot-v1-32k"),
        modelName: "moonshot-v1-32k",
      },
    ],
  },
];

function normalizeProviders(
  providers?: AIProviderConfig[],
): AIProviderConfig[] {
  const base = providers && providers.length > 0 ? providers : DEFAULT_PROVIDERS;
  return base.map((provider) => {
    const rawModels = Array.isArray((provider as any).models)
      ? (provider as any).models
      : null;
    if (rawModels && rawModels.length > 0) {
      const models = rawModels.map((model: any) => {
        const modelName =
          typeof model.modelName === "string" ? model.modelName : "";
        const id =
          typeof model.id === "string" && model.id
            ? model.id
            : createModelId(provider.id, modelName || "model");
        return {
          id,
          modelName: modelName || "gpt-4o",
          displayName:
            typeof model.displayName === "string" ? model.displayName : undefined,
          isAvailable: Boolean(model.isAvailable),
          lastTestedAt:
            typeof model.lastTestedAt === "string" ? model.lastTestedAt : undefined,
        } as AIModelConfig;
      });
      return { ...provider, models };
    }
    const legacyModelName =
      typeof (provider as any).modelName === "string"
        ? (provider as any).modelName
        : "gpt-4o";
    return {
      ...provider,
      models: [
        {
          id: createModelId(provider.id, legacyModelName),
          modelName: legacyModelName,
        },
      ],
    };
  });
}

function createDefaultModelAssignments(providers: AIProviderConfig[]) {
  const fallback = providers[0]?.models[0]?.id ?? "";
  return {
    chat: fallback,
    polish: fallback,
    rewrite: fallback,
    expand: fallback,
    translate: fallback,
  };
}

function normalizeModelAssignments(
  assignments: Partial<Record<ModelAssignmentKey, string>> | undefined,
  providers: AIProviderConfig[],
) {
  const fallback = providers[0]?.models[0]?.id ?? "";
  const allModelIds = new Set(
    providers.flatMap((provider) => provider.models.map((model) => model.id)),
  );
  const pick = (value?: string) => {
    if (value && allModelIds.has(value)) return value;
    const provider = providers.find((p) => p.id === value);
    if (provider?.models[0]) return provider.models[0].id;
    return fallback;
  };
  return {
    chat: pick(assignments?.chat),
    polish: pick(assignments?.polish),
    rewrite: pick(assignments?.rewrite),
    expand: pick(assignments?.expand),
    translate: pick(assignments?.translate),
  };
}

function createDefaultSettingsState() {
  const providers = normalizeProviders(DEFAULT_PROVIDERS);
  return {
    language: "zh-CN" as AppLanguage,
    providers,
    activeProviderId: providers[0]?.id ?? "",
    modelAssignments: createDefaultModelAssignments(providers),
  };
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getActiveFile(state: { files: ProjectFile[]; activeFileId: string }) {
  const active = state.files.find((f) => f.id === state.activeFileId) ?? null;
  if (active && active.type !== "folder") return active;
  return state.files.find((f) => f.type !== "folder") ?? null;
}

export const useDocumentStore = create<DocumentState>()(
  persist(
    (set, get) => ({
      ...createDefaultDocumentState(),

      setActiveFile: (id) =>
        set({
          activeFileId: id,
          cursorPosition: 0,
          viewLineNumber: 1,
          selectionRange: null,
        }),

      setSelectionRange: (range) => set({ selectionRange: range }),

      requestJumpToPosition: (position) => set({ jumpToPosition: position }),

      clearJumpRequest: () => set({ jumpToPosition: null }),

      addFile: (file) => {
        const id = generateId();
        set((state) => ({
          files: [
            ...state.files,
            { ...file, id, parentId: file.parentId ?? null },
          ],
          activeFileId: id,
        }));
        return id;
      },

      addFolder: (name, parentId = null) => {
        const id = generateId();
        set((state) => ({
          files: [
            ...state.files,
            { id, name: name.trim() || "新建文件夹", type: "folder", parentId },
          ],
        }));
        return id;
      },

      moveFile: (id, parentId) => {
        const state = get();
        const target = state.files.find((f) => f.id === id) ?? null;
        if (!target) return;
        if (target.type === "folder") return;

        const nextParentId = parentId ?? null;
        if (nextParentId) {
          const parent = state.files.find((f) => f.id === nextParentId) ?? null;
          if (!parent || parent.type !== "folder") return;
        }

        set((s) => ({
          files: s.files.map((f) =>
            f.id === id ? { ...f, parentId: nextParentId } : f,
          ),
        }));
      },

      deleteFile: (id) => {
        const state = get();
        const target = state.files.find((f) => f.id === id) ?? null;
        if (!target) return;

        const idsToDelete = new Set<string>();
        const collectFolderChildren = (folderId: string) => {
          for (const item of state.files) {
            if (item.parentId !== folderId) continue;
            if (idsToDelete.has(item.id)) continue;
            idsToDelete.add(item.id);
            if (item.type === "folder") collectFolderChildren(item.id);
          }
        };

        idsToDelete.add(id);
        if (target.type === "folder") collectFolderChildren(id);

        const nextFiles = state.files.filter((f) => !idsToDelete.has(f.id));
        const remainingNonFolder = nextFiles.filter((f) => f.type !== "folder");
        if (remainingNonFolder.length === 0) return;

        const nextActiveId = idsToDelete.has(state.activeFileId)
          ? remainingNonFolder[0].id
          : state.activeFileId;

        set({ files: nextFiles, activeFileId: nextActiveId });
      },

      renameFile: (id, name) => {
        set((state) => ({
          files: state.files.map((f) => (f.id === id ? { ...f, name } : f)),
        }));
      },

      updateFileContent: (id, content) => {
        set((state) => ({
          files: state.files.map((f) => (f.id === id ? { ...f, content } : f)),
        }));
      },

      setThreadOpen: (open) => set({ isThreadOpen: open }),

      setPdfData: (data) => set({ pdfData: data, compileError: null }),

      setCompileError: (error) => set({ compileError: error, pdfData: null }),

      setIsCompiling: (isCompiling) => set({ isCompiling }),

      setIsSaving: (isSaving) => set({ isSaving }),

      markDirty: () =>
        set((state) => ({
          isSaving: true,
          hasUnsavedChanges: true,
          lastSavedAt: state.lastSavedAt,
        })),

      markSaved: () =>
        set({
          isSaving: false,
          hasUnsavedChanges: false,
          lastSavedAt: Date.now(),
        }),

      saveHistoryEntry: () => {
        const state = get();
        const activeFile = getActiveFile(state);
        if (!activeFile || activeFile.type !== "tex") return null;
        const content = activeFile.content ?? "";
        const id = generateId();
        set((s) => ({
          historyEntries: [
            { id, fileId: activeFile.id, createdAt: Date.now(), content },
            ...s.historyEntries,
          ].slice(0, 50),
        }));
        return id;
      },

      restoreHistoryEntry: (id) => {
        const state = get();
        const entry = state.historyEntries.find((e) => e.id === id) ?? null;
        if (!entry) return;
        set({
          activeFileId: entry.fileId,
          files: state.files.map((f) =>
            f.id === entry.fileId ? { ...f, content: entry.content } : f,
          ),
        });
      },

      deleteHistoryEntry: (id) =>
        set((state) => ({
          historyEntries: state.historyEntries.filter((e) => e.id !== id),
        })),

      setCursorPosition: (position) => set({ cursorPosition: position }),

      setViewLineNumber: (line) =>
        set({ viewLineNumber: Math.max(1, Math.floor(line || 1)) }),

      setHydratedKey: (key) => set({ hydratedKey: key }),

      loadProject: (files, activeFileId) => {
        const nextFiles = files.length > 0 ? files : buildDefaultFiles();
        const defaultActive =
          nextFiles.find(
            (f) => f.type === "tex" && f.name === "document.tex",
          ) ??
          nextFiles.find((f) => f.type === "tex") ??
          nextFiles.find((f) => f.type !== "folder") ??
          nextFiles[0];
        const nextActiveId = activeFileId ?? defaultActive?.id ?? "default-tex";
        set({
          files: nextFiles,
          activeFileId: nextActiveId,
          cursorPosition: 0,
          viewLineNumber: 1,
          selectionRange: null,
          jumpToPosition: null,
          pdfData: null,
          compileError: null,
          isCompiling: false,
          isSaving: false,
          hasUnsavedChanges: false,
          lastSavedAt: null,
          historyEntries: [],
          initialized: false,
        });
      },

      insertAtCursor: (text) => {
        const state = get();
        const activeFile = getActiveFile(state);
        if (!activeFile || activeFile.type !== "tex") return;

        const content = activeFile.content ?? "";
        const { cursorPosition } = state;
        const newContent =
          content.slice(0, cursorPosition) +
          text +
          content.slice(cursorPosition);

        set({
          files: state.files.map((f) =>
            f.id === activeFile.id ? { ...f, content: newContent } : f,
          ),
          cursorPosition: cursorPosition + text.length,
        });
      },

      replaceSelection: (start, end, text) => {
        const state = get();
        const activeFile = getActiveFile(state);
        if (!activeFile || activeFile.type !== "tex") return;

        const content = activeFile.content ?? "";
        const newContent = content.slice(0, start) + text + content.slice(end);

        set({
          files: state.files.map((f) =>
            f.id === activeFile.id ? { ...f, content: newContent } : f,
          ),
          cursorPosition: start + text.length,
        });
      },

      findAndReplace: (find, replace) => {
        const state = get();
        const activeFile = getActiveFile(state);
        if (!activeFile || activeFile.type !== "tex") return false;

        const content = activeFile.content ?? "";
        if (!find) return false;

        let newContent: string | null = null;

        if (content.includes(find)) {
          newContent = content.replace(find, replace);
        } else if (find.trim().length >= 16) {
          const escapeRegExp = (value: string) =>
            value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const tokens = find.trim().split(/\s+/).map(escapeRegExp);
          if (tokens.length >= 3) {
            const regex = new RegExp(tokens.join("\\s+"), "m");
            if (regex.test(content)) {
              newContent = content.replace(regex, () => replace);
            }
          }
        }

        if (newContent == null) return false;
        set({
          files: state.files.map((f) =>
            f.id === activeFile.id ? { ...f, content: newContent } : f,
          ),
        });
        return true;
      },

      setInitialized: () => set({ initialized: true }),

      get fileName() {
        const activeFile = getActiveFile(get());
        return activeFile?.name ?? "document.tex";
      },

      get content() {
        const activeFile = getActiveFile(get());
        return activeFile?.content ?? "";
      },

      setFileName: (name) => {
        const state = get();
        set({
          files: state.files.map((f) =>
            f.id === state.activeFileId ? { ...f, name } : f,
          ),
        });
      },

      setContent: (content) => {
        const state = get();
        set({
          files: state.files.map((f) =>
            f.id === state.activeFileId ? { ...f, content } : f,
          ),
        });
      },

      resetProject: () => {
        set({
          ...createDefaultDocumentState(),
        });
      },
    }),
    {
      name: "open-prism-document",
      storage: createJSONStorage(() => indexedDBStorage),
      partialize: (state) => ({
        files: state.files,
        activeFileId: state.activeFileId,
        pdfData: state.pdfData,
        historyEntries: state.historyEntries,
        lastSavedAt: state.lastSavedAt,
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as object) };
        const files = merged.files as ProjectFile[];
        const docTex = files.find((f) => f.name === "document.tex");
        if (docTex) {
          merged.activeFileId = docTex.id;
        } else if (files.length > 0) {
          merged.activeFileId = files[0].id;
        }
        return merged;
      },
    },
  ),
);

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      createProject: (name) => {
        const id = generateId();
        const trimmed = name?.trim() || "新项目";
        const meta: ProjectMeta = {
          id,
          name: trimmed,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          projects: [...state.projects, meta],
          activeProjectId: id,
        }));
        return id;
      },
      renameProject: (id, name) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, name: name.trim() || p.name } : p,
          ),
        })),
      deleteProject: (id) => {
        const state = get();
        const remaining = state.projects.filter((p) => p.id !== id);
        if (remaining.length === 0) {
          const fallbackId = generateId();
          const fallback: ProjectMeta = {
            id: fallbackId,
            name: "新项目",
            createdAt: new Date().toISOString(),
          };
          set({ projects: [fallback], activeProjectId: fallbackId });
          return;
        }
        const nextActive =
          state.activeProjectId === id
            ? (remaining[0]?.id ?? null)
            : state.activeProjectId;
        set({ projects: remaining, activeProjectId: nextActive });
      },
      setActiveProject: (id) => set({ activeProjectId: id }),
      resetProjects: () =>
        set({
          projects: [],
          activeProjectId: null,
        }),
    }),
    {
      name: "open-prism-projects",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
      }),
    },
  ),
);

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      users: [],
      currentUserId: null,
      register: async (username, password) => {
        const trimmed = username.trim();
        if (!trimmed || password.length < 6) return false;
        const exists = get().users.some(
          (user) => user.username.toLowerCase() === trimmed.toLowerCase(),
        );
        if (exists) return false;
        const passwordHash = await hashPassword(password);
        const id = generateId();
        const newUser: UserAccount = {
          id,
          username: trimmed,
          passwordHash,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          users: [...state.users, newUser],
          currentUserId: id,
        }));
        return true;
      },
      login: async (username, password) => {
        const trimmed = username.trim();
        const user = get().users.find(
          (item) => item.username.toLowerCase() === trimmed.toLowerCase(),
        );
        if (!user) return false;
        const passwordHash = await hashPassword(password);
        if (passwordHash !== user.passwordHash) return false;
        set({ currentUserId: user.id });
        return true;
      },
      logout: () => set({ currentUserId: null }),
    }),
    {
      name: "open-prism-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        users: state.users,
        currentUserId: state.currentUserId,
      }),
    },
  ),
);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...createDefaultSettingsState(),
      setLanguage: (language) => set({ language }),
      addProvider: (provider) => {
        const id = generateId();
        const normalized = normalizeProviders([{ ...provider, id }]);
        set((state) => ({
          providers: [...state.providers, ...normalized],
          activeProviderId: state.activeProviderId || id,
          modelAssignments: state.modelAssignments.chat
            ? state.modelAssignments
            : createDefaultModelAssignments(state.providers),
        }));
        return id;
      },
      updateProvider: (id, update) => {
        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === id ? { ...provider, ...update } : provider,
          ),
        }));
      },
      removeProvider: (id) => {
        const { activeProviderId } = get();
        set((state) => {
          const nextProviders = state.providers.filter(
            (provider) => provider.id !== id,
          );
          const nextActiveId =
            activeProviderId === id
              ? (nextProviders[0]?.id ?? "")
              : activeProviderId;
          const allModelIds = new Set(
            nextProviders.flatMap((provider) =>
              provider.models.map((model) => model.id),
            ),
          );
          const fallbackModelId = nextProviders[0]?.models[0]?.id ?? "";
          const nextAssignments = { ...state.modelAssignments };
          (Object.keys(nextAssignments) as ModelAssignmentKey[]).forEach(
            (key) => {
              if (!allModelIds.has(nextAssignments[key])) {
                nextAssignments[key] = fallbackModelId;
              }
            },
          );
          return {
            providers: nextProviders,
            activeProviderId: nextActiveId,
            modelAssignments: nextAssignments,
          };
        });
      },
      setActiveProvider: (id) => set({ activeProviderId: id }),
      addProviderModel: (providerId, modelName) => {
        const id = generateId();
        const name = modelName?.trim() || "gpt-4o";
        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === providerId
              ? {
                  ...provider,
                  models: [
                    ...provider.models,
                    { id, modelName: name, isAvailable: false },
                  ],
                }
              : provider,
          ),
        }));
        return id;
      },
      updateProviderModel: (providerId, modelId, update) => {
        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === providerId
              ? {
                  ...provider,
                  models: provider.models.map((model) =>
                    model.id === modelId ? { ...model, ...update } : model,
                  ),
                }
              : provider,
          ),
        }));
      },
      removeProviderModel: (providerId, modelId) => {
        set((state) => {
          const nextProviders = state.providers.map((provider) =>
            provider.id === providerId
              ? {
                  ...provider,
                  models: provider.models.filter((model) => model.id !== modelId),
                }
              : provider,
          );
          const allModelIds = new Set(
            nextProviders.flatMap((provider) =>
              provider.models.map((model) => model.id),
            ),
          );
          const fallbackModelId = nextProviders[0]?.models[0]?.id ?? "";
          const nextAssignments = { ...state.modelAssignments };
          (Object.keys(nextAssignments) as ModelAssignmentKey[]).forEach(
            (key) => {
              if (!allModelIds.has(nextAssignments[key])) {
                nextAssignments[key] = fallbackModelId;
              }
            },
          );
          return { providers: nextProviders, modelAssignments: nextAssignments };
        });
      },
      setModelAssignment: (key, providerId) =>
        set((state) => ({
          modelAssignments: { ...state.modelAssignments, [key]: providerId },
        })),
      getModelConfig: (modelId) => {
        const state = get();
        const match = state.providers
          .map((provider) => ({
            provider,
            model: provider.models.find((item) => item.id === modelId) ?? null,
          }))
          .find((item) => item.model);
        if (match?.model) {
          return { provider: match.provider, model: match.model };
        }
        const fallbackProvider =
          state.providers.find((p) => p.id === state.activeProviderId) ??
          state.providers[0];
        const fallbackModel = fallbackProvider?.models[0];
        if (!fallbackProvider || !fallbackModel) return null;
        return { provider: fallbackProvider, model: fallbackModel };
      },
      resetSettings: () => set(createDefaultSettingsState()),
    }),
    {
      name: "open-prism-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        language: state.language,
        providers: state.providers,
        activeProviderId: state.activeProviderId,
        modelAssignments: state.modelAssignments,
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as object) };
        const providers = normalizeProviders(
          (merged as { providers?: AIProviderConfig[] }).providers,
        );
        const activeProviderId = providers.some(
          (provider) => provider.id === merged.activeProviderId,
        )
          ? merged.activeProviderId
          : providers[0]?.id ?? "";
        const modelAssignments = normalizeModelAssignments(
          (merged as { modelAssignments?: Record<ModelAssignmentKey, string> })
            .modelAssignments,
          providers,
        );
        return {
          ...merged,
          providers,
          activeProviderId,
          modelAssignments,
        };
      },
    },
  ),
);

export type WorkspaceView = "editor" | "chat";

interface UiState {
  centerView: WorkspaceView;
  setCenterView: (view: WorkspaceView) => void;
}

export const useUiStore = create<UiState>((set) => ({
  centerView: "editor",
  setCenterView: (centerView) => set({ centerView }),
}));

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
}

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string;
  createSession: () => string;
  setActiveSession: (id: string) => void;
  deleteSession: (id: string) => void;
  resetChats: () => void;
}

function createDefaultChatState(): Pick<
  ChatState,
  "sessions" | "activeSessionId"
> {
  const id = generateId();
  return {
    sessions: [
      {
        id,
        title: "New chat",
        createdAt: new Date().toISOString(),
      },
    ],
    activeSessionId: id,
  };
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, _get) => ({
      ...createDefaultChatState(),
      createSession: () => {
        const id = generateId();
        set((state) => ({
          sessions: [
            ...state.sessions,
            { id, title: "New chat", createdAt: new Date().toISOString() },
          ],
          activeSessionId: id,
        }));
        return id;
      },
      setActiveSession: (id) => set({ activeSessionId: id }),
      deleteSession: (id) => {
        set((state) => {
          const nextSessions = state.sessions.filter((s) => s.id !== id);
          if (nextSessions.length === 0) {
            const fallback = createDefaultChatState();
            return fallback;
          }
          const nextActiveId =
            state.activeSessionId === id
              ? nextSessions[0].id
              : state.activeSessionId;
          return {
            sessions: nextSessions,
            activeSessionId: nextActiveId,
          };
        });
      },
      resetChats: () => set(createDefaultChatState()),
    }),
    {
      name: "open-prism-chat",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);

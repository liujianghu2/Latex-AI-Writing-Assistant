"use client";

import { useRef, useCallback, useMemo, useState, useEffect } from "react";
import {
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  PlusIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  PencilIcon,
  UploadIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowRightIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  ListIcon,
  BookOpenIcon,
  GithubIcon,
  SettingsIcon,
  UserIcon,
  LogOutIcon,
  DownloadIcon,
} from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import JSZip from "jszip";
import {
  useAuthStore,
  useChatStore,
  useDocumentStore,
  useProjectStore,
  useSettingsStore,
  useUiStore,
  generateId,
  type AppLanguage,
  type ProjectFile,
} from "@/stores/document-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { indexedDBStorage } from "@/lib/storage/indexeddb-storage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import packageJson from "@/package.json";
import { toast } from "sonner";

interface TocItem {
  level: number;
  title: string;
  line: number;
}

function parseTableOfContents(content: string): TocItem[] {
  const lines = content.split("\n");
  const toc: TocItem[] = [];

  const sectionRegex =
    /\\(section|subsection|subsubsection|chapter|part)\*?\s*\{([^}]*)\}/;

  const levelMap: Record<string, number> = {
    part: 0,
    chapter: 1,
    section: 2,
    subsection: 3,
    subsubsection: 4,
  };

  lines.forEach((line, index) => {
    const match = line.match(sectionRegex);
    if (match) {
      const [, type, title] = match;
      toc.push({
        level: levelMap[type] ?? 2,
        title: title.trim(),
        line: index + 1,
      });
    }
  });

  return toc;
}

function parseBibEntries(bibContent: string) {
  const entries: Array<{
    type: string;
    key: string;
    title: string;
    raw: string;
    start: number;
    end: number;
  }> = [];

  const re = /@([a-zA-Z]+)\s*\{\s*([^,\s]+)\s*,/g;
  const starts: Array<{ index: number; type: string; key: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(bibContent)) != null) {
    starts.push({
      index: match.index,
      type: match[1] ?? "unknown",
      key: match[2] ?? "",
    });
  }

  const extractTitle = (raw: string) => {
    const m =
      raw.match(/\btitle\s*=\s*\{([\s\S]*?)\}\s*,?/i) ??
      raw.match(/\btitle\s*=\s*"([\s\S]*?)"\s*,?/i);
    const title = (m?.[1] ?? "").replace(/\\s+/g, " ").trim();
    return title;
  };

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const end = i + 1 < starts.length ? starts[i + 1].index : bibContent.length;
    const raw = bibContent.slice(start, end).trim();
    const title = extractTitle(raw);
    entries.push({
      type: starts[i].type,
      key: starts[i].key,
      title,
      raw,
      start,
      end,
    });
  }

  return entries;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".pdf",
]);

function getExtension(name: string) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

function getMimeType(name: string) {
  const ext = getExtension(name);
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function isImageFile(name: string) {
  return IMAGE_EXTENSIONS.has(getExtension(name));
}

function stripCommonRoot(paths: string[]) {
  const segmentsList = paths.map((path) =>
    path.split("/").filter((segment) => segment.length > 0),
  );
  if (segmentsList.length === 0) {
    return { root: null, paths };
  }
  const root = segmentsList[0]?.[0] ?? null;
  if (!root) {
    return { root: null, paths };
  }
  const allShare = segmentsList.every((segments) => segments[0] === root);
  if (!allShare) {
    return { root: null, paths };
  }
  const nextPaths = segmentsList.map((segments) => segments.slice(1).join("/"));
  return { root, paths: nextPaths };
}

export function Sidebar() {
  const logout = useAuthStore((s) => s.logout);
  const centerView = useUiStore((s) => s.centerView);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const files = useDocumentStore((s) => s.files);
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const setActiveFile = useDocumentStore((s) => s.setActiveFile);
  const viewLineNumber = useDocumentStore((s) => s.viewLineNumber);
  const addFile = useDocumentStore((s) => s.addFile);
  const addFolder = useDocumentStore((s) => s.addFolder);
  const moveFile = useDocumentStore((s) => s.moveFile);
  const deleteFile = useDocumentStore((s) => s.deleteFile);
  const renameFile = useDocumentStore((s) => s.renameFile);
  const updateFileContent = useDocumentStore((s) => s.updateFileContent);
  const insertAtCursor = useDocumentStore((s) => s.insertAtCursor);
  const requestJumpToPosition = useDocumentStore(
    (s) => s.requestJumpToPosition,
  );
  const chatSessions = useChatStore((s) => s.sessions);
  const activeChatId = useChatStore((s) => s.activeSessionId);
  const createChat = useChatStore((s) => s.createSession);
  const setActiveChat = useChatStore((s) => s.setActiveSession);
  const deleteChat = useChatStore((s) => s.deleteSession);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const providers = useSettingsStore((s) => s.providers);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const modelAssignments = useSettingsStore((s) => s.modelAssignments);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const updateProvider = useSettingsStore((s) => s.updateProvider);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider);
  const setModelAssignment = useSettingsStore((s) => s.setModelAssignment);
  const addProviderModel = useSettingsStore((s) => s.addProviderModel);
  const updateProviderModel = useSettingsStore((s) => s.updateProviderModel);
  const removeProviderModel = useSettingsStore((s) => s.removeProviderModel);
  const { theme, setTheme } = useTheme();
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const createProject = useProjectStore((s) => s.createProject);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testMeta, setTestMeta] = useState<{
    modelName?: string;
    baseUrl?: string;
    startedAt?: string;
  } | null>(null);
  const [testPassed, setTestPassed] = useState<boolean | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");

  const tocContent = useMemo(() => {
    const activeFile = files.find(
      (f) => f.id === activeFileId && f.type === "tex",
    );
    if (!activeFile || activeFile.type !== "tex") return "";
    return activeFile.content ?? "";
  }, [files, activeFileId]);

  const toc = useMemo(() => parseTableOfContents(tocContent), [tocContent]);
  const cursorLine = Math.max(1, viewLineNumber || 1);
  const allModels = useMemo(
    () =>
      providers.flatMap((provider) =>
        provider.models.map((model) => ({
          id: model.id,
          providerId: provider.id,
          providerName: provider.name,
          modelName: model.modelName,
          hasApiKey: Boolean(provider.apiKey?.trim()),
          isAvailable: Boolean(provider.apiKey?.trim()) && model.isAvailable,
          statusLabel: !provider.apiKey?.trim()
            ? "未配置密钥"
            : model.isAvailable
              ? "可用"
              : "未测试",
        })),
      ),
    [providers],
  );
  const assignableModels = allModels;
  const resolveAssignableModelId = useCallback(
    (id?: string) => {
      if (id && assignableModels.some((model) => model.id === id)) return id;
      return assignableModels[0]?.id ?? "";
    },
    [assignableModels],
  );
  const activeTocLine = useMemo(() => {
    let current: number | null = null;
    for (const item of toc) {
      if (item.line <= cursorLine) current = item.line;
      else break;
    }
    return current;
  }, [toc, cursorLine]);

  const handleTocClick = useCallback(
    (line: number) => {
      const lines = tocContent.split("\n");
      let position = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) {
        position += lines[i].length + 1;
      }
      requestJumpToPosition(position);
    },
    [tocContent, requestJumpToPosition],
  );
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameFileId, setRenameFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveFileId, setMoveFileId] = useState<string | null>(null);
  const [moveTargetParentId, setMoveTargetParentId] = useState<string | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [bibOpen, setBibOpen] = useState(false);
  const [bibDraft, setBibDraft] = useState("");
  const [bibQuery, setBibQuery] = useState("");
  const [settingsTab, setSettingsTab] = useState<"manage" | "assign">("manage");
  const [activeModelId, setActiveModelId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetFolderIdRef = useRef<string | null>(null);
  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) ??
    providers[0];
  const activeModel =
    activeProvider?.models.find((model) => model.id === activeModelId) ??
    activeProvider?.models[0] ??
    null;

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  useEffect(() => {
    if (!activeProvider) {
      setActiveModelId(null);
      return;
    }
    if (!activeModelId) {
      setActiveModelId(activeProvider.models[0]?.id ?? null);
      return;
    }
    const exists = activeProvider.models.some((m) => m.id === activeModelId);
    if (!exists) {
      setActiveModelId(activeProvider.models[0]?.id ?? null);
    }
  }, [activeProvider, activeModelId]);

  const handleAddTexFile = () => {
    const name = newFileName.trim() || "未命名.tex";
    const finalName = name.endsWith(".tex") ? name : `${name}.tex`;
    addFile({
      name: finalName,
      type: "tex",
      content: `\\documentclass{article}\n\n\\begin{document}\n\n% 在此处编写正文\n\n\\end{document}\n`,
    });
    setNewFileName("");
    setAddDialogOpen(false);
  };

  const handleAddFolder = () => {
    const name = newFolderName.trim() || "新建文件夹";
    const id = addFolder(name, null);
    setOpenFolders((prev) => ({ ...prev, [id]: true }));
    setNewFolderName("");
    setFolderDialogOpen(false);
  };

  const handleCreateProject = () => {
    const id = createProject(newProjectName);
    setNewProjectName("");
    setProjectDialogOpen(false);
    if (id) {
      setActiveProject(id);
    }
  };

  const handleDeleteProject = async () => {
    if (!currentUserId || !activeProjectId) return;
    if (!window.confirm("确认删除当前项目？项目文件将从本地移除且无法恢复。")) {
      return;
    }
    const documentKey = `open-prism-document:${currentUserId}:${activeProjectId}`;
    await indexedDBStorage.removeItem(documentKey);
    deleteProject(activeProjectId);
  };

  const handleUploadClick = (targetFolderId: string | null = null) => {
    uploadTargetFolderIdRef.current = targetFolderId;
    fileInputRef.current?.click();
  };
  const handleUploadFolderClick = (targetFolderId: string | null = null) => {
    uploadTargetFolderIdRef.current = targetFolderId;
    folderInputRef.current?.click();
  };
  const handleUploadZipClick = (targetFolderId: string | null = null) => {
    uploadTargetFolderIdRef.current = targetFolderId;
    zipInputRef.current?.click();
  };

  const readFileAsText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const buildProjectFiles = (
    entries: Array<{
      path: string;
      type: "tex" | "image";
      content?: string;
      dataUrl?: string;
    }>,
  ) => {
    const files: ProjectFile[] = [];
    const folderMap = new Map<string, string>();

    const ensureFolder = (segments: string[]) => {
      let currentPath = "";
      let parentId: string | null = null;
      for (const segment of segments) {
        if (!segment) continue;
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const existing = folderMap.get(currentPath);
        if (existing) {
          parentId = existing;
          continue;
        }
        const id = generateId();
        folderMap.set(currentPath, id);
        files.push({
          id,
          name: segment,
          type: "folder",
          parentId,
        });
        parentId = id;
      }
      return parentId;
    };

    entries.forEach((entry) => {
      const path = entry.path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!path) return;
      const segments = path.split("/").filter(Boolean);
      const name = segments.pop();
      if (!name) return;
      const parentId = ensureFolder(segments);
      files.push({
        id: generateId(),
        name,
        type: entry.type,
        parentId,
        content: entry.content,
        dataUrl: entry.dataUrl,
      });
    });

    const hasTex = files.some((f) => f.type === "tex");
    if (!hasTex) {
      files.push({
        id: generateId(),
        name: "document.tex",
        type: "tex",
        parentId: null,
        content:
          "\\documentclass{article}\n\n\\begin{document}\n\n% 在此处编写正文\n\n\\end{document}\n",
      });
    }

    const defaultActive =
      files.find((f) => f.type === "tex" && f.name === "document.tex") ??
      files.find((f) => f.type === "tex") ??
      files.find((f) => f.type !== "folder") ??
      files[0];

    return {
      files,
      activeFileId: defaultActive?.id ?? null,
    };
  };

  const applyProjectFiles = (
    projectId: string,
    projectFiles: ProjectFile[],
    activeFileId: string | null,
  ) => {
    if (!currentUserId) return;
    const documentKey = `open-prism-document:${currentUserId}:${projectId}`;
    useDocumentStore.persist.setOptions({ name: documentKey });
    useDocumentStore.getState().setHydratedKey(documentKey);
    useDocumentStore.getState().loadProject(projectFiles, activeFileId ?? null);
  };

  const handleFolderImport = async (uploadedFiles: FileList | null) => {
    if (!uploadedFiles || !currentUserId) return;
    const fileArray = Array.from(uploadedFiles);
    if (fileArray.length === 0) return;

    const rawPaths = fileArray.map(
      (file) =>
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ??
        file.name,
    );
    const { root, paths } = stripCommonRoot(rawPaths);
    const entries = await Promise.all(
      fileArray.map(async (file, index) => {
        const path = paths[index] || file.name;
        if (!path) return null;
        const name = path.split("/").pop() || file.name;
        if (isImageFile(name) || file.type.startsWith("image/")) {
          const dataUrl = await readFileAsDataUrl(file);
          return { path, type: "image" as const, dataUrl };
        }
        const content = await readFileAsText(file);
        return { path, type: "tex" as const, content };
      }),
    );
    const cleanEntries = entries.filter(
      (entry): entry is NonNullable<typeof entry> => entry != null,
    );
    const projectName = root || "导入项目";
    const projectId = createProject(projectName);
    const { files: projectFiles, activeFileId } =
      buildProjectFiles(cleanEntries);
    applyProjectFiles(projectId, projectFiles, activeFileId);
    setActiveProject(projectId);
    toast.success(`已导入项目：${projectName}`);
    uploadTargetFolderIdRef.current = null;
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const handleZipImport = async (uploadedFiles: FileList | null) => {
    if (!uploadedFiles || !currentUserId) return;
    const file = uploadedFiles[0];
    if (!file) return;
    const zip = await JSZip.loadAsync(file);
    const zipEntries = Object.values(zip.files).filter(
      (entry) => !entry.dir && !entry.name.startsWith("__MACOSX/"),
    );
    const rawPaths = zipEntries.map((entry) => entry.name);
    const { root, paths } = stripCommonRoot(rawPaths);
    const entries = await Promise.all(
      zipEntries.map(async (entry, index) => {
        const path = paths[index] || entry.name;
        const name = path.split("/").pop() || entry.name;
        if (!name) return null;
        if (isImageFile(name)) {
          const base64 = await entry.async("base64");
          const dataUrl = `data:${getMimeType(name)};base64,${base64}`;
          return { path, type: "image" as const, dataUrl };
        }
        const content = await entry.async("string");
        return { path, type: "tex" as const, content };
      }),
    );
    const cleanEntries = entries.filter(
      (entry): entry is NonNullable<typeof entry> => entry != null,
    );
    const fallbackName = file.name.replace(/\.zip$/i, "").trim() || "导入项目";
    const projectName = root || fallbackName;
    const projectId = createProject(projectName);
    const { files: projectFiles, activeFileId } =
      buildProjectFiles(cleanEntries);
    applyProjectFiles(projectId, projectFiles, activeFileId);
    setActiveProject(projectId);
    toast.success(`已导入项目：${projectName}`);
    uploadTargetFolderIdRef.current = null;
    if (zipInputRef.current) zipInputRef.current.value = "";
  };

  const handleFileUpload = useCallback(
    (uploadedFiles: FileList | null) => {
      if (!uploadedFiles) return;
      const targetFolderId = uploadTargetFolderIdRef.current;

      Array.from(uploadedFiles).forEach((file) => {
        const reader = new FileReader();

        if (file.type.startsWith("image/") || isImageFile(file.name)) {
          reader.onload = () => {
            addFile({
              name: file.name,
              type: "image",
              dataUrl: reader.result as string,
              parentId: targetFolderId,
            });
          };
          reader.readAsDataURL(file);
        } else if (file.name.endsWith(".tex")) {
          reader.onload = () => {
            addFile({
              name: file.name,
              type: "tex",
              content: reader.result as string,
              parentId: targetFolderId,
            });
          };
          reader.readAsText(file);
        } else if (file.name.endsWith(".bib")) {
          reader.onload = () => {
            addFile({
              name: file.name,
              type: "tex",
              content: reader.result as string,
              parentId: targetFolderId,
            });
            toast.success("已导入 BibTeX 文件");
          };
          reader.readAsText(file);
        }
      });
      uploadTargetFolderIdRef.current = null;
    },
    [addFile],
  );

  const bibFile = useMemo(() => {
    const existing =
      files.find((f) => f.type === "tex" && f.name === "references.bib") ??
      files.find(
        (f) => f.type === "tex" && f.name.toLowerCase().endsWith(".bib"),
      ) ??
      null;
    return existing;
  }, [files]);
  const bibContent = bibFile?.content ?? "";
  const bibEntries = useMemo(() => parseBibEntries(bibContent), [bibContent]);
  const filteredBibEntries = useMemo(() => {
    const q = bibQuery.trim().toLowerCase();
    if (!q) return bibEntries;
    return bibEntries.filter((e) => {
      return (
        e.key.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q)
      );
    });
  }, [bibEntries, bibQuery]);

  const ensureBibFile = useCallback(() => {
    if (bibFile) return bibFile.id;
    const id = addFile({
      name: "references.bib",
      type: "tex",
      content: "% BibTeX references\n",
    });
    return id;
  }, [addFile, bibFile]);

  const handleOpenBibManager = () => {
    window.open(
      "https://www.mybib.com/#/projects/rLqpxd/citations",
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleAddBibEntry = () => {
    const entry = bibDraft.trim();
    if (!entry) return;
    if (!entry.startsWith("@")) {
      toast.error("请粘贴完整的 BibTeX 条目（以 @ 开头）");
      return;
    }
    const id = ensureBibFile();
    const file = useDocumentStore.getState().files.find((f) => f.id === id);
    const prev = file?.content ?? "";
    const next = `${prev.trimEnd()}\n\n${entry}\n`;
    updateFileContent(id, next);
    setBibDraft("");
    toast.success("已添加文献条目");
  };

  const handleDeleteBibEntry = (start: number, end: number) => {
    const id = ensureBibFile();
    const file = useDocumentStore.getState().files.find((f) => f.id === id);
    const prev = file?.content ?? "";
    const next = (prev.slice(0, start) + prev.slice(end)).trimStart();
    updateFileContent(id, next ? `${next}\n` : "");
    toast.success("已删除条目");
  };

  const handleExportBib = () => {
    const id = ensureBibFile();
    const file = useDocumentStore.getState().files.find((f) => f.id === id);
    const data = file?.content ?? "";
    const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file?.name ?? "references.bib";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const openRenameDialog = (file: ProjectFile) => {
    setRenameFileId(file.id);
    setRenameValue(file.name);
    setRenameDialogOpen(true);
  };

  const openMoveDialog = (file: ProjectFile) => {
    if (file.type === "folder") return;
    setMoveFileId(file.id);
    setMoveTargetParentId(file.parentId ?? null);
    setMoveDialogOpen(true);
  };

  const handleRename = () => {
    if (renameFileId && renameValue.trim()) {
      renameFile(renameFileId, renameValue.trim());
    }
    setRenameDialogOpen(false);
    setRenameFileId(null);
    setRenameValue("");
  };

  const handleMove = () => {
    if (!moveFileId) return;
    moveFile(moveFileId, moveTargetParentId);
    setMoveDialogOpen(false);
    setMoveFileId(null);
  };

  const fileCount = useMemo(
    () => files.filter((f) => f.type !== "folder").length,
    [files],
  );
  const filesById = useMemo(
    () => new Map(files.map((f) => [f.id, f])),
    [files],
  );
  const filesByParent = useMemo(() => {
    const map = new Map<string | null, ProjectFile[]>();
    for (const f of files) {
      const key = f.parentId ?? null;
      const list = map.get(key);
      if (list) list.push(f);
      else map.set(key, [f]);
    }
    for (const [key, list] of map.entries()) {
      list.sort((a, b) => {
        if (a.type === "folder" && b.type !== "folder") return -1;
        if (a.type !== "folder" && b.type === "folder") return 1;
        return a.name.localeCompare(b.name, "zh-CN");
      });
      map.set(key, list);
    }
    return map;
  }, [files]);

  const buildFilePath = useCallback(
    (file: ProjectFile) => {
      const segments: string[] = [file.name];
      let parentId = file.parentId ?? null;
      while (parentId) {
        const parent = filesById.get(parentId) ?? null;
        if (!parent || parent.type !== "folder") break;
        segments.unshift(parent.name);
        parentId = parent.parentId ?? null;
      }
      return segments.join("/");
    },
    [filesById],
  );

  const folderOptions = useMemo(() => {
    return files
      .filter((f) => f.type === "folder")
      .map((f) => ({ id: f.id, label: buildFilePath(f) }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }, [files, buildFilePath]);

  const renderFileTree = (parentId: string | null, depth: number) => {
    const items = filesByParent.get(parentId) ?? [];
    if (items.length === 0) return null;

    return items.map((item) => {
      const indent = Math.max(0, depth * 12);
      const isFolder = item.type === "folder";
      const isActive = !isFolder && item.id === activeFileId;
      const isOpen = isFolder ? (openFolders[item.id] ?? false) : false;

      return (
        <div key={item.id}>
          <div
            className={cn(
              "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "hover:bg-sidebar-accent/50",
            )}
            style={{ paddingLeft: `${8 + indent}px` }}
          >
            <button
              className="flex flex-1 items-center gap-2 overflow-hidden"
              onClick={() => {
                if (item.type === "folder") {
                  setOpenFolders((prev) => ({
                    ...prev,
                    [item.id]: !(prev[item.id] ?? false),
                  }));
                } else {
                  setActiveFile(item.id);
                }
              }}
            >
              {isFolder ? (
                isOpen ? (
                  <ChevronDownIcon className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                )
              ) : null}
              {getFileIcon(item)}
              <span className="truncate">{item.name}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 group-hover:opacity-100"
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openRenameDialog(item)}>
                  <PencilIcon className="mr-2 size-4" />
                  重命名
                </DropdownMenuItem>
                {item.type === "folder" ? (
                  <>
                    <DropdownMenuItem
                      onClick={() => handleUploadClick(item.id)}
                    >
                      <UploadIcon className="mr-2 size-4" />
                      上传文件到此文件夹
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleUploadFolderClick(item.id)}
                    >
                      <FolderIcon className="mr-2 size-4" />
                      上传文件夹到此文件夹
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleUploadZipClick(item.id)}
                    >
                      <UploadIcon className="mr-2 size-4" />
                      上传 ZIP 到此文件夹
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onClick={() => openMoveDialog(item)}>
                    <ArrowRightIcon className="mr-2 size-4" />
                    移动
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => deleteFile(item.id)}
                  disabled={item.type !== "folder" && fileCount <= 1}
                >
                  <Trash2Icon className="mr-2 size-4" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isFolder && isOpen ? renderFileTree(item.id, depth + 1) : null}
        </div>
      );
    });
  };

  const getFileIcon = (file: ProjectFile) => {
    if (file.type === "folder") {
      return <FolderIcon className="size-4" />;
    }
    if (file.type === "image") {
      return <ImageIcon className="size-4" />;
    }
    return <FileTextIcon className="size-4" />;
  };

  const handleAddProvider = () => {
    const id = addProvider({
      name: "自定义",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      models: [{ id: generateId(), modelName: "gpt-4o" }],
    });
    setActiveProvider(id);
    setActiveModelId(null);
    toast.success("已新增提供商");
  };

  const handleRemoveProvider = () => {
    if (!activeProviderId || providers.length <= 1) return;
    removeProvider(activeProviderId);
    toast.success("已删除提供商");
  };

  const handleAddModel = () => {
    if (!activeProvider) return;
    const modelId = addProviderModel(activeProvider.id, "gpt-4o");
    setActiveModelId(modelId);
    toast.success("已新增模型");
  };

  const handleRemoveModel = () => {
    if (!activeProvider || !activeModel) return;
    if (activeProvider.models.length <= 1) return;
    removeProviderModel(activeProvider.id, activeModel.id);
    const nextModel = activeProvider.models.find(
      (model) => model.id !== activeModel.id,
    );
    setActiveModelId(nextModel?.id ?? null);
    toast.success("已删除模型");
  };

  const handleCreateChat = () => {
    const id = createChat();
    setActiveChat(id);
    setCenterView("chat");
  };

  const handleDeleteChat = (id: string) => {
    deleteChat(id);
  };

  const handleDownloadZip = async () => {
    const decodeDataUrl = (dataUrl: string): Uint8Array | null => {
      const commaIndex = dataUrl.indexOf(",");
      if (commaIndex === -1) return null;
      const base64 = dataUrl.slice(commaIndex + 1);
      try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      } catch {
        return null;
      }
    };

    try {
      const loadingId = toast.loading("正在打包...");
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();

      const folderPaths = files
        .filter((f) => f.type === "folder")
        .map((f) => buildFilePath(f))
        .sort((a, b) => {
          const depthA = a.split("/").length;
          const depthB = b.split("/").length;
          if (depthA !== depthB) return depthA - depthB;
          return a.localeCompare(b, "zh-CN");
        });
      for (const folderPath of folderPaths) {
        zip.folder(folderPath);
      }

      for (const file of files) {
        if (file.type === "folder") {
          continue;
        }
        const path = buildFilePath(file);
        if (file.type === "tex") {
          zip.file(path, file.content ?? "");
          continue;
        }
        if (file.type === "image") {
          const bytes = file.dataUrl ? decodeDataUrl(file.dataUrl) : null;
          if (bytes) {
            zip.file(path, bytes);
          }
        }
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "open-prism-project.zip";
      a.click();
      URL.revokeObjectURL(url);
      toast.dismiss(loadingId);
      toast.success("已下载 .zip");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打包失败，请重试");
    }
  };

  const handleTestProvider = async () => {
    if (!activeProvider || !activeModel) {
      toast.error("没有可用的模型");
      return;
    }
    if (!activeProvider.apiKey.trim()) {
      toast.error("请先填写 API Key");
      return;
    }
    if (!activeProvider.baseUrl.trim() || !activeModel.modelName.trim()) {
      toast.error("请先填写 Base URL 和模型名");
      return;
    }

    setIsTestingProvider(true);
    setTestOpen(true);
    setTestMeta({
      baseUrl: activeProvider.baseUrl,
      modelName: activeModel.modelName,
      startedAt: new Date().toISOString(),
    });
    setTestPassed(null);
    setTestError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test: true,
          config: {
            apiKey: activeProvider.apiKey || undefined,
            baseUrl: activeProvider.baseUrl || undefined,
            modelName: activeModel.modelName || undefined,
          },
        }),
      });

      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!res.ok || !json?.ok) {
        const message = json?.error || `HTTP ${res.status}`;
        setTestPassed(false);
        setTestError(message);
        updateProviderModel(activeProvider.id, activeModel.id, {
          isAvailable: false,
          lastTestedAt: new Date().toISOString(),
        });
        toast.error("测试失败");
        return;
      }

      setTestPassed(true);
      updateProviderModel(activeProvider.id, activeModel.id, {
        isAvailable: true,
        lastTestedAt: new Date().toISOString(),
      });
      toast.success("测试通过");
    } catch (error) {
      const message = error instanceof Error ? error.message : "测试失败";
      setTestPassed(false);
      setTestError(message);
      updateProviderModel(activeProvider.id, activeModel.id, {
        isAvailable: false,
        lastTestedAt: new Date().toISOString(),
      });
      toast.error(message);
    } finally {
      setIsTestingProvider(false);
    }
  };

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-sidebar text-sidebar-foreground",
        isDragging && "ring-2 ring-primary ring-inset",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex h-12 items-center border-sidebar-border border-b px-3">
        <div className="flex flex-col">
          <span className="font-semibold text-sm">Latex AI写作助手</span>
        </div>
      </div>

      <div className="flex h-10 items-center gap-2 border-sidebar-border border-b px-3">
        <Select
          value={activeProjectId ?? undefined}
          onValueChange={(value) => setActiveProject(value)}
        >
          <SelectTrigger className="h-7 flex-1">
            <SelectValue placeholder="选择项目" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setProjectDialogOpen(true)}
          title="新建项目"
        >
          <PlusIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleDeleteProject}
          title="删除项目"
          disabled={!activeProjectId}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>

      <div className="flex h-9 items-center justify-between border-sidebar-border border-b px-3">
        <div className="flex items-center gap-2">
          <Button
            variant={centerView === "editor" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setCenterView("editor")}
          >
            <FolderIcon className="mr-1.5 size-4" />
            文件
          </Button>
          <Button
            variant={centerView === "chat" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setCenterView("chat")}
          >
            <MessageCircleIcon className="mr-1.5 size-4" />
            聊天
          </Button>
        </div>
        {centerView === "editor" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="新建"
              >
                <PlusIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setAddDialogOpen(true)}>
                <FileTextIcon className="mr-2 size-4" />
                新建 LaTeX 文件
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFolderDialogOpen(true)}>
                <FolderIcon className="mr-2 size-4" />
                新建文件夹
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenBibManager}>
                <BookOpenIcon className="mr-2 size-4" />
                文献管理
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleUploadClick(null)}>
                <UploadIcon className="mr-2 size-4" />
                上传文件
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleUploadFolderClick(null)}>
                <FolderIcon className="mr-2 size-4" />
                上传文件夹
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleUploadZipClick(null)}>
                <UploadIcon className="mr-2 size-4" />
                上传 ZIP
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="新建对话"
            onClick={handleCreateChat}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        )}
      </div>

      {centerView === "editor" ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".tex,.bib,.cls,.sty,.bst,.txt,image/*,.pdf"
            multiple
            onChange={(e) => handleFileUpload(e.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={(e) => handleFolderImport(e.target.files)}
          />
          <input
            ref={zipInputRef}
            type="file"
            className="hidden"
            accept=".zip"
            onChange={(e) => handleZipImport(e.target.files)}
          />

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {isDragging && (
              <div className="mb-2 flex items-center justify-center rounded-md border-2 border-primary border-dashed p-4">
                <span className="text-muted-foreground text-xs">
                  将文件拖到这里
                </span>
              </div>
            )}
            {renderFileTree(null, 0)}
          </div>

          <div className="flex h-9 items-center gap-2 border-sidebar-border border-t px-3">
            <ListIcon className="size-4 text-muted-foreground" />
            <span className="font-medium text-xs">大纲</span>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {toc.length > 0 ? (
              toc.map((item, index) => (
                <button
                  key={index}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-sidebar-accent/50"
                  style={{
                    paddingLeft: `${Math.max(0, (item.level - 1) * 12 + 8)}px`,
                  }}
                  onClick={() => handleTocClick(item.line)}
                >
                  <span
                    className={
                      item.line === activeTocLine
                        ? "size-2 shrink-0 rounded-full bg-emerald-500"
                        : "size-2 shrink-0 rounded-full bg-transparent"
                    }
                  />
                  <span className="truncate">{item.title}</span>
                </button>
              ))
            ) : (
              <div className="px-2 py-1 text-muted-foreground text-xs">
                未发现章节
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {chatSessions.map((chat) => (
            <div
              key={chat.id}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                chat.id === activeChatId
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/50",
              )}
            >
              <button
                className="flex flex-1 items-center gap-2 overflow-hidden"
                onClick={() => {
                  setActiveChat(chat.id);
                  setCenterView("chat");
                }}
              >
                <MessageCircleIcon className="size-4 text-muted-foreground" />
                <span className="truncate">{chat.title}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 opacity-0 group-hover:opacity-100"
                  >
                    <MoreHorizontalIcon className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => handleDeleteChat(chat.id)}
                    disabled={chatSessions.length <= 1}
                  >
                    <Trash2Icon className="mr-2 size-4" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="项目名称"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProjectDialogOpen(false)}
            >
              取消
            </Button>
            <Button onClick={handleCreateProject}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bibOpen} onOpenChange={setBibOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>文献管理</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <Input
                value={bibQuery}
                onChange={(e) => setBibQuery(e.target.value)}
                placeholder="搜索 cite key / 标题 / 类型"
              />
              <Button variant="outline" onClick={handleExportBib}>
                导出 .bib
              </Button>
            </div>

            <div className="max-h-64 overflow-auto rounded-md border border-border">
              {filteredBibEntries.length > 0 ? (
                filteredBibEntries.map((e) => (
                  <div
                    key={`${e.key}-${e.start}`}
                    className="flex items-center justify-between gap-3 border-border border-b px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-sm">
                          {e.key}
                        </span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
                          {e.type}
                        </span>
                      </div>
                      <div className="truncate text-muted-foreground text-xs">
                        {e.title || "（无标题字段）"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          insertAtCursor(`\\cite{${e.key}} `);
                          toast.success("已插入引用");
                        }}
                      >
                        插入引用
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteBibEntry(e.start, e.end)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-3 text-muted-foreground text-sm">
                  暂无条目
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="font-medium text-sm">添加 BibTeX 条目</div>
              <textarea
                value={bibDraft}
                onChange={(e) => setBibDraft(e.target.value)}
                placeholder="粘贴形如：@article{key, title={...}, ...}"
                className="min-h-28 w-full resize-y rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
              />
              <div className="flex justify-end">
                <Button onClick={handleAddBibEntry}>添加</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBibOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between border-sidebar-border border-t px-3 py-2 text-muted-foreground text-xs">
        <span>Latex AI写作助手{packageJson.version}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={handleDownloadZip}
            title="下载 .zip"
          >
            <DownloadIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => setSettingsOpen(true)}
            title="设置"
          >
            <SettingsIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            asChild
            title="个人中心"
          >
            <Link href="/me">
              <UserIcon className="size-3.5" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="size-6" asChild>
            <a
              href="https://github.com/assistant-ui/open-prism"
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub"
            >
              <GithubIcon className="size-3.5" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => {
              if (theme === "system") setTheme("light");
              else if (theme === "light") setTheme("dark");
              else setTheme("system");
            }}
            title={
              theme === "system"
                ? "系统主题"
                : theme === "light"
                  ? "浅色模式"
                  : "深色模式"
            }
          >
            {theme === "system" ? (
              <MonitorIcon className="size-3.5" />
            ) : theme === "light" ? (
              <SunIcon className="size-3.5" />
            ) : (
              <MoonIcon className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Add File Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建 LaTeX 文件</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="文件名（如：chapter1.tex）"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTexFile();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAddTexFile}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="文件夹名称"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddFolder();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFolderDialogOpen(false)}
            >
              取消
            </Button>
            <Button onClick={handleAddFolder}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              取消
            </Button>
            <Button onClick={handleRename}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moveDialogOpen}
        onOpenChange={(open) => {
          setMoveDialogOpen(open);
          if (!open) setMoveFileId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>移动文件</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <div className="text-muted-foreground text-xs">目标位置</div>
            <Select
              value={moveTargetParentId ?? "__root__"}
              onValueChange={(value) =>
                setMoveTargetParentId(value === "__root__" ? null : value)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择文件夹" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">根目录</SelectItem>
                {folderOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleMove} disabled={!moveFileId}>
              移动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md bg-muted/30 p-1">
            <Button
              type="button"
              variant={settingsTab === "manage" ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => setSettingsTab("manage")}
            >
              模型添加
            </Button>
            <Button
              type="button"
              variant={settingsTab === "assign" ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => setSettingsTab("assign")}
            >
              模型设置
            </Button>
          </div>
          {settingsTab === "assign" ? (
            <div className="space-y-6 py-2">
              <div className="space-y-2">
                <div className="font-medium text-sm">语言</div>
                <Select
                  value={language}
                  onValueChange={(value) => setLanguage(value as AppLanguage)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择语言" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">中文（简体）</SelectItem>
                    <SelectItem value="en">英文</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="font-medium text-sm">功能模型</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-muted-foreground text-xs">对话</div>
                    <Select
                      value={resolveAssignableModelId(modelAssignments?.chat)}
                      onValueChange={(value) =>
                        setModelAssignment("chat", value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableModels.length === 0 ? (
                          <SelectItem value="__empty__" disabled>
                            暂无模型
                          </SelectItem>
                        ) : (
                          assignableModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.providerName} · {model.modelName}
                              {model.statusLabel ? ` · ${model.statusLabel}` : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-muted-foreground text-xs">润色</div>
                    <Select
                      value={resolveAssignableModelId(modelAssignments?.polish)}
                      onValueChange={(value) =>
                        setModelAssignment("polish", value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableModels.length === 0 ? (
                          <SelectItem value="__empty__" disabled>
                            暂无模型
                          </SelectItem>
                        ) : (
                          assignableModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.providerName} · {model.modelName}
                              {model.statusLabel ? ` · ${model.statusLabel}` : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-muted-foreground text-xs">改写</div>
                    <Select
                      value={resolveAssignableModelId(modelAssignments?.rewrite)}
                      onValueChange={(value) =>
                        setModelAssignment("rewrite", value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableModels.length === 0 ? (
                          <SelectItem value="__empty__" disabled>
                            暂无模型
                          </SelectItem>
                        ) : (
                          assignableModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.providerName} · {model.modelName}
                              {model.statusLabel ? ` · ${model.statusLabel}` : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-muted-foreground text-xs">扩写</div>
                    <Select
                      value={resolveAssignableModelId(modelAssignments?.expand)}
                      onValueChange={(value) =>
                        setModelAssignment("expand", value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableModels.length === 0 ? (
                          <SelectItem value="__empty__" disabled>
                            暂无模型
                          </SelectItem>
                        ) : (
                          assignableModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.providerName} · {model.modelName}
                              {model.statusLabel ? ` · ${model.statusLabel}` : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <div className="text-muted-foreground text-xs">翻译</div>
                    <Select
                      value={resolveAssignableModelId(
                        modelAssignments?.translate,
                      )}
                      onValueChange={(value) =>
                        setModelAssignment("translate", value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableModels.length === 0 ? (
                          <SelectItem value="__empty__" disabled>
                            暂无模型
                          </SelectItem>
                        ) : (
                          assignableModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.providerName} · {model.modelName}
                              {model.statusLabel ? ` · ${model.statusLabel}` : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 py-2">
              <div className="space-y-2">
                <div className="font-medium text-sm">AI 提供商</div>
                <Select
                  value={activeProviderId}
                  onValueChange={(value) => setActiveProvider(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择提供商" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="font-medium text-sm">模型</div>
                <Select
                  value={activeModelId ?? ""}
                  onValueChange={(value) => setActiveModelId(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeProvider?.models?.length ? (
                      activeProvider.models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.modelName}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__empty__" disabled>
                        暂无模型
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="font-medium text-sm" htmlFor="provider-name">
                    名称
                  </label>
                  <Input
                    id="provider-name"
                    value={activeProvider?.name ?? ""}
                    onChange={(e) =>
                      updateProvider(activeProviderId, { name: e.target.value })
                    }
                    placeholder="例如 OpenAI"
                  />
                </div>
                <div className="space-y-2">
                  <label className="font-medium text-sm" htmlFor="provider-model">
                    模型名
                  </label>
                  <Input
                    id="provider-model"
                    value={activeModel?.modelName ?? ""}
                    onChange={(e) =>
                      activeProvider && activeModel
                        ? updateProviderModel(activeProvider.id, activeModel.id, {
                            modelName: e.target.value,
                          })
                        : undefined
                    }
                    placeholder="例如 gpt-4o"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label
                    className="font-medium text-sm"
                    htmlFor="provider-baseurl"
                  >
                    Base URL
                  </label>
                  <Input
                    id="provider-baseurl"
                    value={activeProvider?.baseUrl ?? ""}
                    onChange={(e) =>
                      updateProvider(activeProviderId, {
                        baseUrl: e.target.value,
                      })
                    }
                    placeholder="例如 https://api.openai.com/v1"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label
                    className="font-medium text-sm"
                    htmlFor="provider-apikey"
                  >
                    API Key
                  </label>
                  <Input
                    id="provider-apikey"
                    type="password"
                    value={activeProvider?.apiKey ?? ""}
                    onChange={(e) =>
                      updateProvider(activeProviderId, {
                        apiKey: e.target.value,
                      })
                    }
                    placeholder="可选"
                  />
                </div>
              </div>

              {testOpen && (
                <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <div className="font-medium text-sm">测试结果</div>
                      <div className="text-muted-foreground text-xs">
                        {testMeta?.baseUrl ? `Base URL: ${testMeta.baseUrl}` : ""}
                        {testMeta?.modelName
                          ? ` · 模型: ${testMeta.modelName}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setTestOpen(false)}
                      >
                        收起
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "inline-flex items-center rounded-md px-2 py-1 font-medium text-xs",
                        isTestingProvider
                          ? "bg-muted text-muted-foreground"
                          : testPassed
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {isTestingProvider
                        ? "测试中..."
                        : testPassed
                          ? "通过"
                          : "失败"}
                    </div>
                    <div className="min-w-0 text-muted-foreground text-xs">
                      {isTestingProvider
                        ? "正在验证连接与模型可用性"
                        : testPassed
                          ? "模型可用"
                          : "模型不可用"}
                    </div>
                  </div>

                  {!isTestingProvider && testPassed === false && testError ? (
                    <div className="text-destructive text-xs" title={testError}>
                      {testError.length > 200
                        ? `${testError.slice(0, 200)}...`
                        : testError}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:gap-0">
            {settingsTab === "manage" ? (
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <Button variant="outline" onClick={handleAddProvider}>
                  新增提供商
                </Button>
                <Button
                  variant="outline"
                  onClick={handleAddModel}
                  disabled={!activeProvider}
                >
                  新增模型
                </Button>
                <Button
                  variant="outline"
                  onClick={handleTestProvider}
                  disabled={isTestingProvider || !activeModel}
                >
                  {isTestingProvider ? "测试中..." : "测试连接"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRemoveModel}
                  disabled={
                    !activeProvider || activeProvider.models.length <= 1
                  }
                >
                  删除模型
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRemoveProvider}
                  disabled={providers.length <= 1}
                >
                  删除提供商
                </Button>
              </div>
            ) : (
              <div />
            )}
            <Button variant="secondary" onClick={logout}>
              <LogOutIcon className="mr-2 size-4" />
              退出登录
            </Button>
          </DialogFooter>
          <div className="-mt-2 text-muted-foreground text-xs">
            修改后会自动保存，并立即用于 AI 对话请求
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

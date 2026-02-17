"use client";

import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  type RefObject,
} from "react";
import { EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  scrollPastEnd,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { oneDark, oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import {
  search,
  highlightSelectionMatches,
  SearchQuery,
  setSearchQuery as setSearchQueryEffect,
  findNext,
  findPrevious,
} from "@codemirror/search";
import { latex } from "codemirror-lang-latex";
import {
  useDocumentStore,
  useSettingsStore,
  type ProjectFile,
} from "@/stores/document-store";
import { compileLatex, type CompileResource } from "@/lib/latex-compiler";
import { EditorToolbar } from "./editor-toolbar";
import { AIDrawer } from "./ai-drawer";
import { ImagePreview } from "./image-preview";
import { SearchPanel } from "./search-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2Icon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface StickyItem {
  type: "section" | "begin";
  name: string;
  content: string;
  html: string;
  line: number;
}

interface ParsedLine {
  type: "section" | "begin" | "end";
  name: string;
  content: string;
  line: number;
}

function parseLatexStructure(content: string): ParsedLine[] {
  const lines = content.split("\n");
  const result: ParsedLine[] = [];

  const sectionRegex =
    /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{[^}]*\}/;
  const beginRegex = /\\begin\{([^}]+)\}/;
  const endRegex = /\\end\{([^}]+)\}/;

  lines.forEach((lineContent, index) => {
    const sectionMatch = lineContent.match(sectionRegex);
    if (sectionMatch) {
      result.push({
        type: "section",
        name: sectionMatch[1],
        content: lineContent,
        line: index + 1,
      });
      return;
    }

    const beginMatch = lineContent.match(beginRegex);
    if (beginMatch) {
      result.push({
        type: "begin",
        name: beginMatch[1],
        content: lineContent,
        line: index + 1,
      });
      return;
    }

    const endMatch = lineContent.match(endRegex);
    if (endMatch) {
      result.push({
        type: "end",
        name: endMatch[1],
        content: lineContent,
        line: index + 1,
      });
    }
  });

  return result;
}

function getStickyLines(
  parsedLines: ParsedLine[],
  currentLine: number,
): StickyItem[] {
  const stack: StickyItem[] = [];

  const sectionLevelMap: Record<string, number> = {
    part: 0,
    chapter: 1,
    section: 2,
    subsection: 3,
    subsubsection: 4,
  };

  for (const item of parsedLines) {
    if (item.line > currentLine) break;

    if (item.type === "section") {
      const level = sectionLevelMap[item.name] ?? 2;
      while (
        stack.length > 0 &&
        stack[stack.length - 1].type === "section" &&
        sectionLevelMap[stack[stack.length - 1].name] >= level
      ) {
        stack.pop();
      }
      stack.push({
        type: "section",
        name: item.name,
        content: item.content,
        html: "",
        line: item.line,
      });
    } else if (item.type === "begin") {
      stack.push({
        type: "begin",
        name: item.name,
        content: item.content,
        html: "",
        line: item.line,
      });
    } else if (item.type === "end") {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].type === "begin" && stack[i].name === item.name) {
          stack.splice(i, 1);
          break;
        }
      }
    }
  }

  return stack;
}

function gatherResources(files: ProjectFile[]): CompileResource[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  const buildPath = (file: ProjectFile) => {
    const segments: string[] = [file.name];
    let parentId = file.parentId ?? null;
    while (parentId) {
      const parent = byId.get(parentId) ?? null;
      if (!parent || parent.type !== "folder") break;
      segments.unshift(parent.name);
      parentId = parent.parentId ?? null;
    }
    return segments.join("/");
  };

  return files.flatMap((f) => {
    if (f.type === "folder") return [];
    const path = buildPath(f);
    if (f.type === "tex") {
      return {
        path,
        content: f.content ?? "",
        main: f.name === "document.tex",
      };
    }
    const dataUrl = f.dataUrl ?? "";
    let base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    base64 = base64.replace(/\s/g, "");
    return {
      path,
      file: base64,
    };
  });
}

function getActiveFileContent(): string {
  const state = useDocumentStore.getState();
  const activeFile = state.files.find(
    (f) => f.id === state.activeFileId && f.type !== "folder",
  );
  return activeFile?.content ?? "";
}

export function LatexEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const suppressExternalDocChangeRef = useRef(false);
  const saveDebounceRef = useRef<number | null>(null);

  const files = useDocumentStore((s) => s.files);
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const setContent = useDocumentStore((s) => s.setContent);
  const markDirty = useDocumentStore((s) => s.markDirty);
  const markSaved = useDocumentStore((s) => s.markSaved);
  const setCursorPosition = useDocumentStore((s) => s.setCursorPosition);
  const setSelectionRange = useDocumentStore((s) => s.setSelectionRange);
  const jumpToPosition = useDocumentStore((s) => s.jumpToPosition);
  const clearJumpRequest = useDocumentStore((s) => s.clearJumpRequest);
  const isCompiling = useDocumentStore((s) => s.isCompiling);
  const setIsCompiling = useDocumentStore((s) => s.setIsCompiling);
  const setPdfData = useDocumentStore((s) => s.setPdfData);
  const setCompileError = useDocumentStore((s) => s.setCompileError);

  const activeFile = files.find((f) => f.id === activeFileId);
  const isTexFile = activeFile?.type === "tex";
  const activeFileContent = activeFile?.content;

  const [imageScale, setImageScale] = useState(0.5);
  const [currentLine, setCurrentLine] = useState(1);
  const [gutterWidth, setGutterWidth] = useState(0);
  const [lineHtmlCache, setLineHtmlCache] = useState<Record<number, string>>(
    {},
  );
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);

  const parsedLines = useMemo(
    () => parseLatexStructure(activeFileContent ?? ""),
    [activeFileContent],
  );

  const stickyLines = useMemo(() => {
    const items = getStickyLines(parsedLines, currentLine);
    return items.map((item) => ({
      ...item,
      html: lineHtmlCache[item.line] || "",
    }));
  }, [parsedLines, currentLine, lineHtmlCache]);

  const compileRef = useRef<() => void>(() => {});
  const isSearchOpenRef = useRef(false);

  useEffect(() => {
    isSearchOpenRef.current = isSearchOpen;
  }, [isSearchOpen]);

  useEffect(() => {
    if (!searchQuery || !activeFileContent) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const regex = new RegExp(
      searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    const matches = activeFileContent.match(regex);
    setMatchCount(matches?.length ?? 0);
    if (matches && matches.length > 0) {
      setCurrentMatch(1);
    } else {
      setCurrentMatch(0);
    }
  }, [searchQuery, activeFileContent]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const query = new SearchQuery({
      search: searchQuery,
      caseSensitive: false,
      literal: true,
    });

    view.dispatch({
      effects: setSearchQueryEffect.of(query),
    });

    if (searchQuery) {
      findNext(view);
    }
  }, [searchQuery]);

  const handleFindNext = () => {
    const view = viewRef.current;
    if (!view) return;
    findNext(view);
    view.focus();
  };

  const handleFindPrevious = () => {
    const view = viewRef.current;
    if (!view) return;
    findPrevious(view);
    view.focus();
  };

  compileRef.current = async () => {
    if (isCompiling) return;
    setIsCompiling(true);
    try {
      const currentFiles = useDocumentStore.getState().files;
      const resources = gatherResources(currentFiles);
      const data = await compileLatex(resources);
      setPdfData(data);
    } catch (error) {
      setCompileError(
        error instanceof Error ? error.message : "Compilation failed",
      );
    } finally {
      setIsCompiling(false);
    }
  };

  useEffect(() => {
    if (!containerRef.current || !isTexFile) return;

    const currentContent = getActiveFileContent();

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        if (suppressExternalDocChangeRef.current) return;
        setContent(update.state.doc.toString());
        markDirty();
        if (saveDebounceRef.current) {
          window.clearTimeout(saveDebounceRef.current);
        }
        saveDebounceRef.current = window.setTimeout(() => {
          markSaved();
        }, 800);
      }
      if (update.selectionSet) {
        const { from, to, head } = update.state.selection.main;
        setCursorPosition(head);
        if (from !== to) {
          setSelectionRange({ start: from, end: to });
        } else {
          setSelectionRange(null);
        }
      }
    });

    const scrollListener = EditorView.domEventHandlers({
      scroll: (_, view) => {
        const scrollTop = view.scrollDOM.scrollTop;
        const lineBlock = view.lineBlockAtHeight(scrollTop);
        const lineNumber = view.state.doc.lineAt(lineBlock.from).number;
        setCurrentLine(lineNumber);
        useDocumentStore.getState().setViewLineNumber(lineNumber);

        const gutter = view.dom.querySelector(".cm-gutters");
        if (gutter) {
          setGutterWidth(gutter.getBoundingClientRect().width);
        }

        const cmLines = view.dom.querySelectorAll(".cm-line");
        const newCache: Record<number, string> = {};
        cmLines.forEach((el) => {
          const lineInfo = view.lineBlockAt(
            view.posAtDOM(el as HTMLElement, 0),
          );
          const ln = view.state.doc.lineAt(lineInfo.from).number;
          newCache[ln] = el.innerHTML;
        });
        setLineHtmlCache((prev) => ({ ...prev, ...newCache }));
      },
    });

    const compileKeymap = Prec.highest(
      keymap.of([
        {
          key: "Enter",
          run: (view) => {
            if (isSearchOpenRef.current) {
              findNext(view);
              return true;
            }
            return false;
          },
        },
        {
          key: "Shift-Enter",
          run: (view) => {
            if (isSearchOpenRef.current) {
              findPrevious(view);
              return true;
            }
            return false;
          },
        },
        {
          key: "Mod-Enter",
          run: () => {
            compileRef.current();
            return true;
          },
        },
        {
          key: "Mod-s",
          run: () => {
            useDocumentStore.getState().markSaved();
            return true;
          },
        },
        {
          key: "Mod-f",
          run: () => {
            setIsSearchOpen(true);
            return true;
          },
        },
        {
          key: "Escape",
          run: () => {
            if (isSearchOpenRef.current) {
              setIsSearchOpen(false);
              return true;
            }
            return false;
          },
        },
      ]),
    );

    const state = EditorState.create({
      doc: currentContent,
      extensions: [
        compileKeymap,
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        latex(),
        oneDark,
        syntaxHighlighting(oneDarkHighlightStyle),
        search(),
        highlightSelectionMatches(),
        updateListener,
        scrollListener,
        EditorView.lineWrapping,
        scrollPastEnd(),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "14px",
          },
          ".cm-scroller": {
            overflow: "auto",
          },
          ".cm-gutters": {
            paddingRight: "4px",
          },
          ".cm-lineNumbers .cm-gutterElement": {
            paddingLeft: "8px",
            paddingRight: "4px",
          },
          ".cm-content": {
            paddingLeft: "8px",
            paddingRight: "12px",
          },
          ".cm-searchMatch": {
            backgroundColor: "#facc15 !important",
            color: "#000 !important",
            borderRadius: "2px",
            boxShadow: "0 0 0 1px #eab308",
          },
          ".cm-searchMatch-selected": {
            backgroundColor: "#f97316 !important",
            color: "#fff !important",
            borderRadius: "2px",
            boxShadow: "0 0 0 2px #ea580c",
          },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: "rgba(100, 150, 255, 0.3)",
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [
    activeFileId,
    isTexFile,
    markDirty,
    markSaved,
    setContent,
    setCursorPosition,
    setSelectionRange,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !isTexFile) return;

    const content = activeFileContent ?? "";
    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      suppressExternalDocChangeRef.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      });
      suppressExternalDocChangeRef.current = false;
    }
  }, [activeFileContent, isTexFile]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || jumpToPosition === null) return;

    view.dispatch({
      selection: { anchor: jumpToPosition },
      effects: EditorView.scrollIntoView(jumpToPosition, { y: "center" }),
    });
    view.focus();
    clearJumpRequest();
  }, [jumpToPosition, clearJumpRequest]);

  if (!isTexFile && activeFile) {
    return (
      <div className="flex h-full flex-col bg-background">
        <EditorToolbar
          editorView={viewRef}
          fileType="image"
          imageScale={imageScale}
          onImageScaleChange={setImageScale}
        />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <ImagePreview file={activeFile} scale={imageScale} />
          <AIDrawer />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <EditorToolbar editorView={viewRef} />
      {isSearchOpen && (
        <SearchPanel
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onClose={() => {
            setIsSearchOpen(false);
            setSearchQuery("");
            viewRef.current?.focus();
          }}
          onFindNext={handleFindNext}
          onFindPrevious={handleFindPrevious}
          matchCount={matchCount}
          currentMatch={currentMatch}
        />
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {stickyLines.length > 0 && (
          <div className="absolute inset-x-0 top-0 z-10 border-border border-b bg-[#282c34] font-mono text-[14px] leading-[1.4] shadow-md">
            {stickyLines.map((section) => (
              <div
                key={section.line}
                className="flex cursor-pointer items-center hover:bg-white/5"
                onClick={() => {
                  const view = viewRef.current;
                  if (!view) return;
                  const line = view.state.doc.line(section.line);
                  view.dispatch({
                    selection: { anchor: line.from },
                    effects: EditorView.scrollIntoView(line.from, {
                      y: "start",
                    }),
                  });
                  view.focus();
                }}
              >
                <span
                  className="shrink-0 bg-[#282c34] py-px text-right text-[#636d83]"
                  style={{ width: gutterWidth ? gutterWidth - 8 : 32 }}
                >
                  {section.line}
                </span>
                {section.html ? (
                  <span
                    className="py-px pl-5.5"
                    dangerouslySetInnerHTML={{ __html: section.html }}
                  />
                ) : (
                  <span className="py-px pl-5.5 text-[#abb2bf]">
                    {section.content}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div ref={containerRef} className="absolute inset-0" />
        <SelectionOptimizeBar
          editorViewRef={viewRef}
          containerRef={containerRef}
        />
        <AIDrawer />
      </div>
    </div>
  );
}

function SelectionOptimizeBar({
  editorViewRef,
  containerRef,
}: {
  editorViewRef: RefObject<EditorView | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const selectionRange = useDocumentStore((s) => s.selectionRange);
  const content = useDocumentStore((s) => s.content);
  const replaceSelection = useDocumentStore((s) => s.replaceSelection);
  const findAndReplace = useDocumentStore((s) => s.findAndReplace);

  const providers = useSettingsStore((s) => s.providers);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const modelAssignments = useSettingsStore((s) => s.modelAssignments);

  const [isWorking, setIsWorking] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const lastSelectionRef = useRef<{
    start: number;
    end: number;
    text: string;
  } | null>(null);
  const [preview, setPreview] = useState<{
    start: number;
    end: number;
    mode: "polish" | "rewrite" | "expand" | "translate";
    original: string;
    status: "loading" | "ready" | "error";
    next: string;
    changes: string[];
    error?: string;
  } | null>(null);
  const [transformMode, setTransformMode] = useState<
    "polish" | "rewrite" | "expand" | "translate"
  >("polish");
  const [targetLanguage, setTargetLanguage] = useState<"en" | "zh-CN">("en");
  const [writingStyle, setWritingStyle] = useState<
    "academic" | "professional" | "creative"
  >("academic");
  const [thinkingStyle, setThinkingStyle] = useState<"rigorous" | "divergent">(
    "rigorous",
  );
  const [instructionInput, setInstructionInput] = useState("");

  const updatePos = useCallback(() => {
    const view = editorViewRef.current;
    const container = containerRef.current;
    if (!view || !container || !selectionRange) {
      setPos(null);
      return;
    }

    const coords = view.coordsAtPos(selectionRange.start);
    if (!coords) {
      setPos(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const left = coords.left - containerRect.left;
    const top = coords.top - containerRect.top;

    const padding = 8;
    const clampedLeft = Math.min(
      Math.max(left, padding),
      containerRect.width - padding,
    );
    const clampedTop = Math.min(
      Math.max(top, padding),
      containerRect.height - padding,
    );

    setPos({ left: clampedLeft, top: clampedTop });
  }, [editorViewRef, containerRef, selectionRange]);

  useEffect(() => {
    updatePos();

    const view = editorViewRef.current;
    const scrollDom = view?.scrollDOM;
    if (!scrollDom) return;

    const handle = () => updatePos();
    scrollDom.addEventListener("scroll", handle, { passive: true });
    window.addEventListener("resize", handle);

    return () => {
      scrollDom.removeEventListener("scroll", handle);
      window.removeEventListener("resize", handle);
    };
  }, [editorViewRef, updatePos]);

  useEffect(() => {
    if (!selectionRange) return;
    const view = editorViewRef.current;
    const start = selectionRange.start;
    const end = selectionRange.end;
    const text = view
      ? view.state.sliceDoc(start, end)
      : content.slice(start, end);
    if (text.trim()) {
      lastSelectionRef.current = { start, end, text };
    }
  }, [selectionRange, editorViewRef, content]);

  const runTransform = useCallback(
    async (
      mode: "polish" | "rewrite" | "expand" | "translate",
      targetLanguage?: "en" | "zh-CN",
      options?: {
        text?: string;
        analysisBaseText?: string;
        instructions?: string;
        range?: { start: number; end: number; original: string };
      },
    ) => {
      const modelId = modelAssignments?.[mode];
      const resolved =
        providers
          .map((provider) => ({
            provider,
            model: provider.models.find((item) => item.id === modelId) ?? null,
          }))
          .find((item) => item.model) ??
        (() => {
          const fallbackProvider =
            providers.find((p) => p.id === activeProviderId) ?? providers[0];
          const fallbackModel = fallbackProvider?.models[0] ?? null;
          return fallbackProvider && fallbackModel
            ? { provider: fallbackProvider, model: fallbackModel }
            : null;
        })();
      const activeProvider = resolved?.provider;
      const activeModel = resolved?.model;
      if (!activeProvider || !activeModel) {
        toast.error("没有可用的模型提供商");
        return;
      }

      setTransformMode(mode);
      if (targetLanguage) setTargetLanguage(targetLanguage);

      const view = editorViewRef.current;
      const liveSel = view?.state.selection.main ?? null;
      const fallbackSel = lastSelectionRef.current;
      const start =
        liveSel && liveSel.from !== liveSel.to
          ? liveSel.from
          : fallbackSel?.start;
      const end =
        liveSel && liveSel.from !== liveSel.to ? liveSel.to : fallbackSel?.end;
      const selectedText =
        start != null && end != null
          ? view
            ? view.state.sliceDoc(start, end)
            : content.slice(start, end)
          : "";
      const range = options?.range ?? {
        start: start ?? 0,
        end: end ?? 0,
        original: selectedText,
      };

      if (!range.original.trim()) return;
      if (range.original.length > 4000) {
        toast.error("选中文本过长，请缩短后再试");
        return;
      }

      setIsWorking(true);
      setPreview({
        start: range.start,
        end: range.end,
        mode,
        original: range.original,
        status: "loading",
        next: "",
        changes: [],
      });
      try {
        const extraText = options?.instructions?.trim() ?? "";
        const instructions = extraText || undefined;

        const inputText = options?.text ?? range.original;
        const analysisBaseText = options?.analysisBaseText ?? range.original;

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transform: {
              mode,
              targetLanguage,
              text: inputText,
              analysisBaseText,
              writingStyle,
              thinkingStyle,
              instructions,
              stream: true,
            },
            config: {
              apiKey: activeProvider.apiKey || undefined,
              baseUrl: activeProvider.baseUrl || undefined,
              modelName: activeModel.modelName || undefined,
            },
          }),
        });

        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
            ok?: boolean;
          } | null;
          throw new Error(data?.error || `HTTP ${res.status}`);
        }

        if (!contentType.includes("application/x-ndjson")) {
          const json = (await res.json().catch(() => null)) as {
            ok?: boolean;
            text?: string;
            changes?: string[];
            error?: string;
          } | null;

          if (!json?.ok || typeof json.text !== "string") {
            throw new Error(json?.error || `HTTP ${res.status}`);
          }

          const nextText = json.text;
          const changes = Array.isArray(json.changes)
            ? json.changes.filter((x) => typeof x === "string").slice(0, 12)
            : [];
          setPreview((prev) =>
            prev ? { ...prev, status: "ready", next: nextText, changes } : prev,
          );
          return;
        }

        if (!res.body) throw new Error("响应流不可用");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let obj: any;
          try {
            obj = JSON.parse(trimmed);
          } catch {
            return;
          }
          if (obj?.type === "text-delta" && typeof obj.delta === "string") {
            setPreview((prev) =>
              prev
                ? {
                    ...prev,
                    next: `${prev.next}${obj.delta}`,
                  }
                : prev,
            );
          } else if (obj?.type === "analysis" && Array.isArray(obj.changes)) {
            const changes = obj.changes
              .filter((x: unknown): x is string => typeof x === "string")
              .slice(0, 12);
            setPreview((prev) => (prev ? { ...prev, changes } : prev));
          } else if (obj?.type === "error" && typeof obj.error === "string") {
            setPreview((prev) =>
              prev ? { ...prev, status: "error", error: obj.error } : prev,
            );
          } else if (obj?.type === "done") {
            setPreview((prev) =>
              prev && prev.status !== "error"
                ? { ...prev, status: "ready", next: prev.next.trim() }
                : prev,
            );
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx = buffer.indexOf("\n");
          while (idx !== -1) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            handleLine(line);
            idx = buffer.indexOf("\n");
          }
        }

        if (buffer.trim()) handleLine(buffer);
      } catch (error) {
        const message = error instanceof Error ? error.message : "操作失败";
        setPreview((prev) =>
          prev ? { ...prev, status: "error", error: message } : prev,
        );
        toast.error(message);
      } finally {
        setIsWorking(false);
      }
    },
    [
      activeProviderId,
      content,
      editorViewRef,
      modelAssignments,
      providers,
      thinkingStyle,
      writingStyle,
    ],
  );

  const applyPreview = () => {
    if (!preview) return;
    if (preview.status !== "ready") return;
    const { start, end, original, next } = preview;
    const view = editorViewRef.current;
    const currentDoc =
      view?.state.doc.toString() ?? useDocumentStore.getState().content;
    const stillMatches = currentDoc.slice(start, end) === original;

    if (stillMatches) {
      if (view) {
        view.dispatch({
          changes: { from: start, to: end, insert: next },
          selection: { anchor: start + next.length },
        });
        view.focus();
      } else {
        replaceSelection(start, end, next);
      }
      setPreview(null);
      setInstructionInput("");
      toast.success("已应用到正文");
      return;
    }

    const findNearestRange = () => {
      const source = currentDoc;
      const needle = original;
      if (!needle) return null;
      const windowStart = Math.max(0, start - 2000);
      const windowEnd = Math.min(source.length, start + 2000);
      const localIndex = source.slice(windowStart, windowEnd).indexOf(needle);
      if (localIndex !== -1) {
        const from = windowStart + localIndex;
        return { from, to: from + needle.length };
      }
      const globalIndex = source.indexOf(needle);
      if (globalIndex !== -1) {
        return { from: globalIndex, to: globalIndex + needle.length };
      }
      return null;
    };

    const nearest = findNearestRange();
    if (nearest && view) {
      view.dispatch({
        changes: { from: nearest.from, to: nearest.to, insert: next },
        selection: { anchor: nearest.from + next.length },
      });
      view.focus();
      setPreview(null);
      setInstructionInput("");
      toast.success("已应用到正文");
      return;
    }

    const ok = findAndReplace(original, next);
    if (!ok) {
      toast.error("正文已变化，无法自动应用替换");
      return;
    }
    setPreview(null);
    setInstructionInput("");
    toast.success("已应用到正文");
  };

  const modeLabel =
    transformMode === "polish"
      ? "润色"
      : transformMode === "rewrite"
        ? "改写"
        : transformMode === "expand"
          ? "扩写"
          : transformMode === "translate"
            ? "翻译"
            : "优化";

  return (
    <>
      {selectionRange && pos ? (
        <div
          className="pointer-events-none absolute z-20"
          style={{
            left: pos.left,
            top: pos.top,
            transform: "translate(-10%, -120%)",
          }}
        >
          <div
            className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-background/95 px-2 py-1 shadow-sm backdrop-blur"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={isWorking}
              onClick={() => runTransform("polish")}
            >
              润色
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={isWorking}
              onClick={() => runTransform("rewrite")}
            >
              改写
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={isWorking}
              onClick={() => runTransform("expand")}
            >
              扩写
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={isWorking}
              onClick={() => runTransform("translate", "en")}
            >
              翻译 EN
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={isWorking}
              onClick={() => runTransform("translate", "zh-CN")}
            >
              翻译 中文
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={preview != null}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
            setInstructionInput("");
          }
        }}
      >
        <DialogContent className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{modeLabel}预览</DialogTitle>
          </DialogHeader>
          {preview ? (
            <div className="flex-1 space-y-4 overflow-auto py-2">
              <div className="space-y-2">
                <div className="font-medium text-sm">原文（选中内容）</div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">
                  {preview.original}
                </pre>
              </div>

              <div className="flex flex-wrap items-center gap-2 overflow-x-auto rounded-md border border-border bg-muted/10 p-2 sm:flex-nowrap">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">任务</span>
                  <Select
                    value={transformMode}
                    onValueChange={(v) =>
                      setTransformMode(
                        v as "polish" | "rewrite" | "expand" | "translate",
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-[112px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="polish">润色</SelectItem>
                      <SelectItem value="rewrite">改写</SelectItem>
                      <SelectItem value="expand">扩写</SelectItem>
                      <SelectItem value="translate">翻译</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    写作风格
                  </span>
                  <Select
                    value={writingStyle}
                    onValueChange={(v) =>
                      setWritingStyle(
                        v as "academic" | "professional" | "creative",
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-[128px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="academic">学术论文</SelectItem>
                      <SelectItem value="professional">专业正式</SelectItem>
                      <SelectItem value="creative">更发散</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    思维方式
                  </span>
                  <Select
                    value={thinkingStyle}
                    onValueChange={(v) =>
                      setThinkingStyle(v as "rigorous" | "divergent")
                    }
                  >
                    <SelectTrigger className="h-8 w-[128px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rigorous">专业严谨</SelectItem>
                      <SelectItem value="divergent">发散思维</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    翻译方向
                  </span>
                  <Select
                    value={targetLanguage}
                    onValueChange={(v) =>
                      setTargetLanguage(v as "en" | "zh-CN")
                    }
                    disabled={transformMode !== "translate"}
                  >
                    <SelectTrigger className="h-8 w-[132px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">中文 → 英文</SelectItem>
                      <SelectItem value="zh-CN">英文 → 中文</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!instructionInput.trim() || isWorking}
                    onClick={() => setInstructionInput("")}
                  >
                    清空要求
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isWorking}
                    onClick={() =>
                      runTransform(
                        transformMode,
                        transformMode === "translate"
                          ? targetLanguage
                          : undefined,
                        {
                          range: {
                            start: preview.start,
                            end: preview.end,
                            original: preview.original,
                          },
                          text: preview.original,
                          analysisBaseText: preview.original,
                        },
                      )
                    }
                  >
                    重新生成
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-medium text-sm">优化后</div>
                {preview.status === "error" ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-destructive text-sm">
                    {preview.error || "生成失败"}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {preview.status === "loading" ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2Icon className="size-4 animate-spin" />
                        正在流式生成优化结果...
                      </div>
                    ) : null}
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">
                      {preview.next || (preview.status === "loading" ? "" : "")}
                    </pre>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="font-medium text-sm">所作优化</div>
                {preview.status === "loading" ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2Icon className="size-4 animate-spin" />
                    正在分析优化点...
                  </div>
                ) : preview.changes.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {preview.changes.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    未提供优化说明
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="font-medium text-sm">继续修改</div>
                <Textarea
                  value={instructionInput}
                  onChange={(e) => setInstructionInput(e.target.value)}
                  placeholder="例如：更正式一些；保留术语；增加 1-2 句解释；不要使用第一人称……"
                  className="min-h-20"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isWorking || !instructionInput.trim()}
                    onClick={() => setInstructionInput("")}
                  >
                    清空输入
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isWorking || !instructionInput.trim()}
                    onClick={() => {
                      const msg = instructionInput.trim();
                      if (!msg) return;
                      setInstructionInput("");
                      const baseText = preview.next?.trim()
                        ? preview.next
                        : preview.original;
                      runTransform(
                        transformMode,
                        transformMode === "translate"
                          ? targetLanguage
                          : undefined,
                        {
                          range: {
                            start: preview.start,
                            end: preview.end,
                            original: preview.original,
                          },
                          text: baseText,
                          analysisBaseText: preview.original,
                          instructions: msg,
                        },
                      );
                    }}
                  >
                    发送修改
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              不使用
            </Button>
            <Button
              disabled={preview?.status !== "ready"}
              onClick={applyPreview}
            >
              使用优化后
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

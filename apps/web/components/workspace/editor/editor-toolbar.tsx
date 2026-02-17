"use client";

import { RefObject, useMemo } from "react";
import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  BoldIcon,
  ClockIcon,
  HistoryIcon,
  ItalicIcon,
  ListIcon,
  Heading1Icon,
  Heading2Icon,
  CodeIcon,
  FunctionSquareIcon,
  FileTextIcon,
  ImageIcon,
  MinusIcon,
  PlusIcon,
  Redo2Icon,
  SaveIcon,
  Undo2Icon,
} from "lucide-react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDocumentStore } from "@/stores/document-store";

const ZOOM_OPTIONS = [
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
  { value: "3", label: "300%" },
  { value: "4", label: "400%" },
];

interface EditorToolbarProps {
  editorView: RefObject<EditorView | null>;
  fileType?: "tex" | "image";
  imageScale?: number;
  onImageScaleChange?: (scale: number) => void;
}

export function EditorToolbar({
  editorView,
  fileType = "tex",
  imageScale = 1,
  onImageScaleChange,
}: EditorToolbarProps) {
  const fileName = useDocumentStore((s) => {
    const activeFile = s.files.find((f) => f.id === s.activeFileId);
    return activeFile?.name ?? "document.tex";
  });
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const content = useDocumentStore((s) => s.content);
  const isSaving = useDocumentStore((s) => s.isSaving);
  const hasUnsavedChanges = useDocumentStore((s) => s.hasUnsavedChanges);
  const lastSavedAt = useDocumentStore((s) => s.lastSavedAt);
  const historyEntries = useDocumentStore((s) => s.historyEntries);
  const saveHistoryEntry = useDocumentStore((s) => s.saveHistoryEntry);
  const restoreHistoryEntry = useDocumentStore((s) => s.restoreHistoryEntry);

  const insertText = (before: string, after: string = "") => {
    const view = editorView.current;
    if (!view) return;

    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);

    view.dispatch({
      changes: {
        from,
        to,
        insert: before + selectedText + after,
      },
      selection: {
        anchor: from + before.length,
        head: from + before.length + selectedText.length,
      },
    });
    view.focus();
  };

  const wrapSelection = (wrapper: string) => {
    insertText(wrapper, wrapper);
  };

  const { canUndo, canRedo } = useMemo(() => {
    const view = editorView.current;
    if (!view) return { canUndo: false, canRedo: false };
    return {
      canUndo: undoDepth(view.state) > 0,
      canRedo: redoDepth(view.state) > 0,
    };
  }, [content, editorView]);

  const statusText = useMemo(() => {
    if (isSaving || hasUnsavedChanges) return "保存中…";
    if (!lastSavedAt) return "未保存";
    const t = new Date(lastSavedAt);
    const hh = t.getHours().toString().padStart(2, "0");
    const mm = t.getMinutes().toString().padStart(2, "0");
    return `已保存 ${hh}:${mm}`;
  }, [hasUnsavedChanges, isSaving, lastSavedAt]);

  const fileHistory = useMemo(
    () => historyEntries.filter((e) => e.fileId === activeFileId),
    [activeFileId, historyEntries],
  );

  const zoomIn = () => onImageScaleChange?.(Math.min(4, imageScale + 0.25));
  const zoomOut = () => onImageScaleChange?.(Math.max(0.25, imageScale - 0.25));

  if (fileType === "image") {
    return (
      <div className="flex h-9 items-center justify-between border-border border-b bg-muted/30 px-2">
        <div className="flex items-center gap-1">
          <ImageIcon className="size-4 text-muted-foreground" />
          <span className="font-medium text-muted-foreground text-sm">
            {fileName}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={zoomOut}
            disabled={imageScale <= 0.25}
          >
            <MinusIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={zoomIn}
            disabled={imageScale >= 4}
          >
            <PlusIcon className="size-3.5" />
          </Button>
          <Select
            value={imageScale.toString()}
            onValueChange={(v) => onImageScaleChange?.(Number(v))}
          >
            <SelectTrigger size="sm" className="h-6! w-auto text-xs">
              <SelectValue>{Math.round(imageScale * 100)}%</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ZOOM_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-9 items-center gap-1 border-border border-b bg-muted/30 px-2">
      <FileTextIcon className="size-4 text-muted-foreground" />
      <span className="mr-2 font-medium text-muted-foreground text-sm">
        {fileName}
      </span>
      <div className="mx-2 h-4 w-px bg-border" />
      <TooltipIconButton
        tooltip="撤销 (Ctrl/⌘ + Z)"
        onClick={() => {
          const view = editorView.current;
          if (!view) return;
          undo(view);
          view.focus();
        }}
        disabled={!canUndo}
      >
        <Undo2Icon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="重做 (Ctrl/⌘ + Shift + Z)"
        onClick={() => {
          const view = editorView.current;
          if (!view) return;
          redo(view);
          view.focus();
        }}
        disabled={!canRedo}
      >
        <Redo2Icon className="size-4" />
      </TooltipIconButton>
      <div className="mx-2 h-4 w-px bg-border" />
      <TooltipIconButton
        tooltip="Bold (\\textbf)"
        onClick={() => insertText("\\textbf{", "}")}
      >
        <BoldIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Italic (\\textit)"
        onClick={() => insertText("\\textit{", "}")}
      >
        <ItalicIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Code (\\texttt)"
        onClick={() => insertText("\\texttt{", "}")}
      >
        <CodeIcon className="size-4" />
      </TooltipIconButton>
      <div className="mx-2 h-4 w-px bg-border" />
      <TooltipIconButton
        tooltip="Section"
        onClick={() => insertText("\\section{", "}")}
      >
        <Heading1Icon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Subsection"
        onClick={() => insertText("\\subsection{", "}")}
      >
        <Heading2Icon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="List item"
        onClick={() => insertText("\\item ")}
      >
        <ListIcon className="size-4" />
      </TooltipIconButton>
      <div className="mx-2 h-4 w-px bg-border" />
      <TooltipIconButton
        tooltip="Inline math ($...$)"
        onClick={() => wrapSelection("$")}
      >
        <FunctionSquareIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Display math (\\[...\\])"
        onClick={() => insertText("\\[\n  ", "\n\\]")}
      >
        <span className="font-mono text-xs">∫</span>
      </TooltipIconButton>
      <div className="flex-1" />
      <div className="flex items-center gap-1 text-muted-foreground text-xs">
        <ClockIcon className="size-3.5" />
        <span>{statusText}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="历史版本"
          >
            <HistoryIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem
            onClick={() => {
              saveHistoryEntry();
            }}
          >
            <SaveIcon className="mr-2 size-4" />
            保存当前版本
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {fileHistory.length > 0 ? (
            fileHistory.slice(0, 12).map((e) => (
              <DropdownMenuItem
                key={e.id}
                onClick={() => restoreHistoryEntry(e.id)}
              >
                {new Date(e.createdAt).toLocaleString("zh-CN")}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>暂无历史版本</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

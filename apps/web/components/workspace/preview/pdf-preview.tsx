"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  FileTextIcon,
  AlertCircleIcon,
  LoaderIcon,
  RefreshCwIcon,
  MinusIcon,
  PlusIcon,
  DownloadIcon,
} from "lucide-react";
import { useDocumentStore, type ProjectFile } from "@/stores/document-store";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compileLatex, type CompileResource } from "@/lib/latex-compiler";

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

const PdfViewer = dynamic(
  () => import("./pdf-viewer").then((mod) => mod.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

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
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    return {
      path,
      content: base64,
      encoding: "base64",
    };
  });
}

export function PdfPreview() {
  const pdfData = useDocumentStore((s) => s.pdfData);
  const compileError = useDocumentStore((s) => s.compileError);
  const isCompiling = useDocumentStore((s) => s.isCompiling);
  const isSaving = useDocumentStore((s) => s.isSaving);
  const setPdfData = useDocumentStore((s) => s.setPdfData);
  const setCompileError = useDocumentStore((s) => s.setCompileError);
  const setIsCompiling = useDocumentStore((s) => s.setIsCompiling);
  const content = useDocumentStore((s) => s.content);
  const requestJumpToPosition = useDocumentStore(
    (s) => s.requestJumpToPosition,
  );

  const [pdfError, setPdfError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const hasInitialCompile = useRef(false);
  const initialized = useDocumentStore((s) => s.initialized);

  const handleTextClick = useCallback(
    (text: string) => {
      let index = content.indexOf(text);

      if (index === -1) {
        const cleanText = text.replace(/[{}\\$]/g, "");
        if (cleanText.length > 2) {
          index = content.indexOf(cleanText);
        }
      }

      if (index === -1 && text.length > 5) {
        const words = text.split(/\s+/).filter((w) => w.length > 3);
        for (const word of words) {
          index = content.indexOf(word);
          if (index !== -1) break;
        }
      }

      if (index !== -1) {
        requestJumpToPosition(index);
      }
    },
    [content, requestJumpToPosition],
  );

  useEffect(() => {
    if (hasInitialCompile.current) return;
    if (!initialized) return;
    if (pdfData || isCompiling || compileError) return;

    hasInitialCompile.current = true;

    const compile = async () => {
      setIsCompiling(true);
      try {
        const currentFiles = useDocumentStore.getState().files;
        const resources = gatherResources(currentFiles);
        const data = await compileLatex(resources);
        setPdfData(data);
      } catch (error) {
        setCompileError(error instanceof Error ? error.message : "编译失败");
      } finally {
        setIsCompiling(false);
      }
    };
    compile();
  }, [
    initialized,
    pdfData,
    isCompiling,
    compileError,
    setIsCompiling,
    setPdfData,
    setCompileError,
  ]);

  const zoomIn = () => setScale((s) => Math.min(4, s + 0.1));
  const zoomOut = () => setScale((s) => Math.max(0.25, s - 0.1));

  const handleDownload = () => {
    if (!pdfData) return;
    const blob = new Blob([new Uint8Array(pdfData)], {
      type: "application/pdf",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "document.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadSuccess = (pages: number) => {
    setNumPages(pages);
    setCurrentPage(1);
  };

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
  };

  const handleCompile = async () => {
    if (isCompiling) return;
    setIsCompiling(true);
    setPdfError(null);
    try {
      const currentFiles = useDocumentStore.getState().files;
      const resources = gatherResources(currentFiles);
      const data = await compileLatex(resources);
      setPdfData(data);
    } catch (error) {
      setCompileError(error instanceof Error ? error.message : "编译失败");
    } finally {
      setIsCompiling(false);
    }
  };

  const renderContent = () => {
    if (compileError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 p-8">
          <AlertCircleIcon className="mb-4 size-12 text-destructive" />
          <h2 className="mb-2 font-medium text-destructive text-lg">
            编译失败
          </h2>
          <p className="max-w-md text-center text-muted-foreground text-sm">
            {compileError}
          </p>
        </div>
      );
    }

    if (!pdfData) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 p-8">
          <FileTextIcon className="mb-4 size-16 text-muted-foreground/50" />
          <h2 className="mb-2 font-medium text-lg text-muted-foreground">
            PDF 预览
          </h2>
          <p className="text-center text-muted-foreground text-sm">
            点击“编译”生成预览
          </p>
        </div>
      );
    }

    if (pdfError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 p-8">
          <AlertCircleIcon className="mb-4 size-12 text-destructive" />
          <h2 className="mb-2 font-medium text-destructive text-lg">
            PDF 加载失败
          </h2>
          <p className="max-w-md text-center text-muted-foreground text-sm">
            {pdfError}
          </p>
        </div>
      );
    }

    return (
      <PdfViewer
        data={pdfData}
        scale={scale}
        onError={setPdfError}
        onLoadSuccess={handleLoadSuccess}
        onScaleChange={handleScaleChange}
        onTextClick={handleTextClick}
        onPageChange={setCurrentPage}
      />
    );
  };

  return (
    <div className="flex h-full flex-col bg-muted/50">
      <div className="flex h-9 items-center justify-between border-border border-b bg-background px-2">
        <div className="flex items-center gap-1.5">
          {isSaving && (
            <>
              <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground text-xs">正在保存...</span>
            </>
          )}
          {!isSaving && isCompiling && (
            <>
              <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground text-xs">正在编译...</span>
            </>
          )}
          {!isSaving && !isCompiling && pdfData && (
            <span className="text-muted-foreground text-xs">已就绪</span>
          )}
          {!isSaving && !isCompiling && compileError && (
            <span className="text-destructive text-xs">编译失败</span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleCompile}
            disabled={isSaving || isCompiling}
            title="编译"
          >
            <RefreshCwIcon className="mr-1 size-3.5" />
            编译
          </Button>
          {pdfData && (
            <>
              <span className="mx-2 text-muted-foreground text-xs tabular-nums">
                第 {String(currentPage).padStart(2, "0")} /{" "}
                {String(numPages).padStart(2, "0")} 页
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={zoomOut}
                disabled={scale <= 0.25}
              >
                <MinusIcon className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={zoomIn}
                disabled={scale >= 4}
              >
                <PlusIcon className="size-3.5" />
              </Button>
              <Select
                value={scale.toString()}
                onValueChange={(v) => setScale(Number(v))}
              >
                <SelectTrigger size="sm" className="h-6! w-auto text-xs">
                  <SelectValue>{Math.round(scale * 100)}%</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ZOOM_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mx-0.5 h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={handleDownload}
                title="下载 PDF"
              >
                <DownloadIcon className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {renderContent()}
    </div>
  );
}

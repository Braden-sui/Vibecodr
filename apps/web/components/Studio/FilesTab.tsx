"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  FileCode,
  FileText,
  Image,
  Folder,
  Plus,
  Trash2,
  Download,
  Upload,
  AlertCircle,
} from "lucide-react";

interface FileNode {
  name: string;
  type: "file" | "directory";
  size?: number;
  content?: string;
  children?: FileNode[];
}

/**
 * Files Editor Tab
 * View and edit vibe files with validation
 * Based on mvp-plan.md Studio Files section
 */
export function FilesTab() {
  const [files, setFiles] = useState<FileNode[]>([
    {
      name: "index.html",
      type: "file",
      size: 1234,
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Vibe</title>
  <script src="/runner/client-static-shim.js"></script>
</head>
<body>
  <h1>Hello Vibecodr!</h1>
  <script src="main.js"></script>
</body>
</html>`,
    },
    {
      name: "main.js",
      type: "file",
      size: 567,
      content: `// Your vibe code
console.log("Vibe loaded!");

// Tell Vibecodr the vibe is ready
window.vibecodr.ready();`,
    },
    {
      name: "manifest.json",
      type: "file",
      size: 345,
      content: JSON.stringify(
        {
          version: "1.0",
          runner: "client-static",
          entry: "index.html",
          title: "My Vibe",
          params: [],
          capabilities: {
            net: [],
            storage: false,
            workers: false,
          },
        },
        null,
        2
      ),
    },
  ]);

  const [selectedFile, setSelectedFile] = useState<string>("index.html");
  const [editContent, setEditContent] = useState<string>(
    files.find((f) => f.name === "index.html")?.content || ""
  );

  const currentFile = files.find((f) => f.name === selectedFile);
  const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
  const maxSize = 25 * 1024 * 1024; // 25 MB

  const handleFileSelect = (fileName: string) => {
    const file = files.find((f) => f.name === fileName);
    setSelectedFile(fileName);
    setEditContent(file?.content || "");
  };

  const handleContentChange = (content: string) => {
    setEditContent(content);
    // Update file in list
    setFiles(
      files.map((f) =>
        f.name === selectedFile
          ? { ...f, content, size: new Blob([content]).size }
          : f
      )
    );
  };

  const getFileIcon = (fileName: string) => {
    if (fileName.endsWith(".html")) return <FileCode className="h-4 w-4 text-orange-500" />;
    if (fileName.endsWith(".js")) return <FileCode className="h-4 w-4 text-yellow-500" />;
    if (fileName.endsWith(".json")) return <FileText className="h-4 w-4 text-blue-500" />;
    if (fileName.match(/\.(png|jpg|jpeg|gif|svg)$/))
      return <Image className="h-4 w-4 text-purple-500" />;
    return <FileText className="h-4 w-4" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[300px_1fr]">
      {/* Left: File Tree */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Files</CardTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 p-0">
            {files.map((file) => (
              <button
                key={file.name}
                onClick={() => handleFileSelect(file.name)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-muted ${
                  selectedFile === file.name ? "bg-muted" : ""
                }`}
              >
                {getFileIcon(file.name)}
                <span className="flex-1 text-left">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatSize(file.size || 0)}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Storage Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Storage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted-foreground">Bundle Size</span>
                <span className="font-medium">{formatSize(totalSize)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full transition-all ${
                    totalSize / maxSize > 0.9
                      ? "bg-destructive"
                      : totalSize / maxSize > 0.7
                        ? "bg-yellow-500"
                        : "bg-primary"
                  }`}
                  style={{
                    width: `${Math.min((totalSize / maxSize) * 100, 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatSize(maxSize - totalSize)} remaining of {formatSize(maxSize)} (Free tier)
              </p>
            </div>

            {totalSize / maxSize > 0.9 && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>Approaching bundle size limit. Consider optimizing assets.</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="sm" className="gap-2">
            <Upload className="h-4 w-4" />
            Upload File
          </Button>
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Download All
          </Button>
        </div>
      </div>

      {/* Right: Editor */}
      <div className="space-y-4">
        <Card className="flex-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {currentFile && getFileIcon(currentFile.name)}
                <CardTitle className="text-base">{selectedFile}</CardTitle>
                {selectedFile === "manifest.json" && <Badge variant="secondary">Required</Badge>}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm">
                  Format
                </Button>
                <Button variant="ghost" size="sm">
                  Validate
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <textarea
              value={editContent}
              onChange={(e) => handleContentChange(e.target.value)}
              className="h-[600px] w-full resize-none border-0 bg-muted/50 p-4 font-mono text-sm focus:outline-none"
              spellCheck={false}
            />
          </CardContent>
        </Card>

        {/* File Info */}
        {currentFile && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">File Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size:</span>
                <span>{formatSize(currentFile.size || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lines:</span>
                <span>{editContent.split("\n").length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Characters:</span>
                <span>{editContent.length}</span>
              </div>

              {selectedFile === "manifest.json" && (
                <>
                  <Separator className="my-2" />
                  <div className="rounded-md bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-400">
                    <p className="font-medium">Manifest File</p>
                    <p className="mt-1">
                      This file defines your vibe's configuration, parameters, and capabilities.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

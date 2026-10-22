/* oxlint-disable react/no-array-index-key -- Notebook cells and outputs are a read-only snapshot in document order. */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { notebookCodeFence, parseNotebookPreview } from "@t3tools/shared/notebookPreview";

import ChatMarkdown from "~/components/ChatMarkdown";
import { ScrollArea } from "~/components/ui/scroll-area";

import { FileSurfaceFailure, FileSurfaceNotice } from "./fileSurfaceChrome";

export function NotebookPreview(props: {
  readonly name: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly cwd?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly workspaceMutationId?: string | null;
}) {
  const lastSeparator = Math.max(props.name.lastIndexOf("/"), props.name.lastIndexOf("\\"));
  const imageBaseDir = props.cwd
    ? lastSeparator >= 0
      ? resolvePathLinkTarget(props.name.slice(0, lastSeparator), props.cwd)
      : props.cwd
    : undefined;
  if (props.truncated) {
    return (
      <FileSurfaceFailure message="The notebook was only partially loaded. Switch to source or open the full file in an external editor." />
    );
  }
  const notebook = parseNotebookPreview(props.text);
  if ("error" in notebook) return <FileSurfaceFailure message={notebook.error} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileSurfaceNotice>
        Saved notebook preview. Edit and run cells in VS Code using the project's Python
        environment.
      </FileSurfaceNotice>
      {notebook.truncated ? (
        <FileSurfaceNotice>
          Preview limited to 200 cells. Switch to source for the rest.
        </FileSurfaceNotice>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-5" aria-label={props.name}>
          {notebook.cells.length === 0 ? (
            <p className="text-sm text-muted-foreground">This notebook has no cells.</p>
          ) : null}
          {notebook.cells.map((cell, index) => (
            <section key={index} aria-label={`Cell ${index + 1}`} className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-2xs text-muted-foreground">
                {cell.kind === "code"
                  ? `In [${cell.executionCount ?? " "}]`
                  : cell.kind === "markdown"
                    ? "Markdown"
                    : "Raw"}
              </div>
              {cell.kind === "raw" ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                  {cell.source}
                </pre>
              ) : (
                <ChatMarkdown
                  text={
                    cell.kind === "code"
                      ? notebookCodeFence(cell.source, notebook.language)
                      : cell.source
                  }
                  cwd={props.cwd}
                  imageBaseDir={imageBaseDir}
                  threadRef={props.threadRef}
                />
              )}
              {cell.outputs.map((output, outputIndex) => (
                <div key={outputIndex} className="mt-2 border-l-2 border-border pl-3">
                  {output.kind === "image" ? (
                    <img
                      src={output.src}
                      alt={`Cell ${index + 1}, output ${outputIndex + 1}`}
                      loading="lazy"
                      className="max-w-full"
                    />
                  ) : output.kind === "text" ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                      {output.text}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      This output format is not displayed. Switch to source to inspect it.
                    </p>
                  )}
                </div>
              ))}
              {cell.truncated ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Cell preview shortened. Switch to source for the rest.
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

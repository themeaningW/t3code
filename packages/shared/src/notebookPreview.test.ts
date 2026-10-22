import { describe, expect, it } from "vite-plus/test";
import {
  isNotebookPreviewFile,
  notebookCodeFence,
  parseNotebookPreview,
} from "./notebookPreview.ts";
import { filePreviewKind } from "./filePreview.ts";

const notebook = (cells: unknown[], metadata = {}) =>
  JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata, cells });

describe("notebook previews", () => {
  it("recognizes notebook extensions without treating JSON or backup files as notebooks", () => {
    expect(isNotebookPreviewFile("research/Analysis.IPYNB")).toBe(true);
    expect(isNotebookPreviewFile("data.json")).toBe(false);
    expect(isNotebookPreviewFile("analysis.ipynb.bak")).toBe(false);
    expect(filePreviewKind({ name: "analysis.IPYNB" })).toBe("text");
    expect(filePreviewKind({ name: "analysis.ipynb", mimeType: "application/octet-stream" })).toBe(
      "text",
    );
    expect(filePreviewKind({ name: "analysis.ipynb", mimeType: "application/x-ipynb+json" })).toBe(
      "text",
    );
    expect(filePreviewKind({ name: "analysis.ipynb", mimeType: "application/pdf" })).toBe("pdf");
  });

  it("reads Markdown, raw and code cells, including multiline source and saved outputs", () => {
    const text = notebook(
      [
        { cell_type: "markdown", source: ["# Results\n", "Summary"] },
        { cell_type: "raw", source: "Raw text" },
        {
          cell_type: "code",
          source: ["print(1)\n"],
          execution_count: 3,
          outputs: [
            { output_type: "stream", name: "stdout", text: ["1", "\n"] },
            { output_type: "execute_result", data: { "text/plain": ["2"] } },
            { output_type: "error", ename: "ValueError", evalue: "bad value" },
          ],
        },
      ],
      { language_info: { name: "python" } },
    );
    expect(parseNotebookPreview(text)).toEqual({
      language: "python",
      truncated: false,
      cells: [
        {
          kind: "markdown",
          source: "# Results\nSummary",
          executionCount: null,
          outputs: [],
          truncated: false,
        },
        { kind: "raw", source: "Raw text", executionCount: null, outputs: [], truncated: false },
        {
          kind: "code",
          source: "print(1)\n",
          executionCount: 3,
          truncated: false,
          outputs: [
            { kind: "text", text: "1\n" },
            { kind: "text", text: "2" },
            { kind: "text", text: "ValueError: bad value" },
          ],
        },
      ],
    });
    expect(JSON.parse(text).cells[2].source).toEqual(["print(1)\n"]);
  });

  it("uses the kernel language when language_info is absent", () => {
    expect(parseNotebookPreview(notebook([], { kernelspec: { language: "julia" } }))).toMatchObject(
      { language: "julia", cells: [] },
    );
  });

  it("rejects invalid JSON, obsolete formats and malformed cells without throwing", () => {
    expect(parseNotebookPreview("{broken")).toHaveProperty("error");
    expect(parseNotebookPreview('{"nbformat":3,"worksheets":[]}')).toHaveProperty("error");
    expect(parseNotebookPreview("null")).toHaveProperty("error");
    expect(parseNotebookPreview(notebook([null]))).toHaveProperty("error");
    expect(
      parseNotebookPreview(notebook([{ cell_type: "code", source: ["text", 3] }])),
    ).toHaveProperty("error");
  });

  it("renders only inert image output and uses plain text instead of active output", () => {
    const result = parseNotebookPreview(
      notebook([
        {
          cell_type: "code",
          source: "plot()",
          outputs: [
            { data: { "image/png": ["aGVs", "bG8=\n"], "text/html": "<script>bad()</script>" } },
            { data: { "image/jpeg": "aGVsbG8=" } },
            { data: { "text/html": "<script>bad()</script>", "text/plain": "Safe fallback" } },
            { data: { "image/svg+xml": "<svg onload='bad()'/>" } },
            { data: { "image/png": "data:image/svg+xml,bad" } },
            { data: { "application/vnd.jupyter.widget-view+json": {} } },
          ],
        },
      ]),
    );
    expect(result).toMatchObject({
      cells: [
        {
          outputs: [
            { kind: "image", src: "data:image/png;base64,aGVsbG8=" },
            { kind: "image", src: "data:image/jpeg;base64,aGVsbG8=" },
            { kind: "text", text: "Safe fallback" },
            { kind: "unsupported" },
            { kind: "unsupported" },
            { kind: "unsupported" },
          ],
        },
      ],
    });
  });

  it("bounds cell and output rendering while leaving the original document untouched", () => {
    const cell = {
      cell_type: "code",
      source: "x".repeat(20_001),
      outputs: Array.from({ length: 26 }, () => ({
        output_type: "stream",
        text: "y".repeat(20_001),
      })),
    };
    const text = notebook([
      cell,
      ...Array.from({ length: 200 }, () => ({ cell_type: "raw", source: "small" })),
    ]);
    const result = parseNotebookPreview(text);
    if ("error" in result) throw new Error(result.error);
    expect(result.truncated).toBe(true);
    expect(result.cells).toHaveLength(200);
    expect(result.cells[0]?.truncated).toBe(true);
    expect(result.cells[0]?.source).toHaveLength(20_000);
    expect(result.cells[0]?.outputs).toHaveLength(25);
    expect(result.cells[0]?.outputs[0]).toMatchObject({
      kind: "text",
      text: expect.stringContaining("Output shortened"),
    });
    expect(JSON.parse(text).cells).toHaveLength(201);
  });

  it("keeps embedded code fences inside the highlighted source block", () => {
    expect(notebookCodeFence('print("```")', "python")).toBe('````python\nprint("```")\n````');
    expect(
      parseNotebookPreview(notebook([], { language_info: { name: "python\n<script>" } })),
    ).toMatchObject({ language: "text" });
  });
});

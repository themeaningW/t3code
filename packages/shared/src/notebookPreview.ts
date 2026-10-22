export const isNotebookPreviewFile = (path: string): boolean => /\.ipynb$/i.test(path);

const MAX_CELLS = 200;
const MAX_OUTPUTS = 25;
const MAX_TEXT_LENGTH = 20_000;

type NotebookOutput =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly src: string }
  | { readonly kind: "unsupported" };

interface NotebookCell {
  readonly kind: "markdown" | "code" | "raw";
  readonly source: string;
  readonly executionCount: number | null;
  readonly outputs: ReadonlyArray<NotebookOutput>;
  readonly truncated: boolean;
}

export type NotebookPreview =
  | { readonly error: string }
  | {
      readonly cells: ReadonlyArray<NotebookCell>;
      readonly language: string;
      readonly truncated: boolean;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function multiline(value: unknown): string | null {
  if (typeof value === "string") return value;
  return Array.isArray(value) && value.every((part) => typeof part === "string")
    ? value.join("")
    : null;
}

function outputPreview(value: unknown): NotebookOutput {
  const output = record(value);
  if (!output) return { kind: "unsupported" };
  const data = record(output.data);
  // Never embed active notebook output (HTML, SVG, scripts or widget MIME bundles).
  for (const mime of ["image/png", "image/jpeg"]) {
    const image = multiline(data?.[mime])?.replace(/\s/g, "");
    if (image && /^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      return { kind: "image", src: `data:${mime};base64,${image}` };
    }
  }
  const text =
    output.output_type === "stream"
      ? multiline(output.text)
      : output.output_type === "error"
        ? `${typeof output.ename === "string" ? output.ename : "Error"}: ${typeof output.evalue === "string" ? output.evalue : ""}`
        : multiline(data?.["text/plain"]);
  if (text === null) return { kind: "unsupported" };
  return {
    kind: "text",
    text:
      text.length > MAX_TEXT_LENGTH
        ? `${text.slice(0, MAX_TEXT_LENGTH)}\n… Output shortened. Switch to source for the rest.`
        : text,
  };
}

export function parseNotebookPreview(text: string): NotebookPreview {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "This notebook is not valid JSON. Switch to source to inspect it." };
  }
  const notebook = record(value);
  if (!notebook || notebook.nbformat !== 4 || !Array.isArray(notebook.cells)) {
    return {
      error: "Only Jupyter notebook format 4 is supported. Switch to source to inspect it.",
    };
  }
  const metadata = record(notebook.metadata);
  const languageInfo = record(metadata?.language_info);
  const kernelspec = record(metadata?.kernelspec);
  const language = languageInfo?.name ?? kernelspec?.language;
  const cells: NotebookCell[] = [];
  for (const value of notebook.cells.slice(0, MAX_CELLS)) {
    const cell = record(value);
    const source = multiline(cell?.source);
    const kind = cell?.cell_type;
    if (source === null || (kind !== "markdown" && kind !== "code" && kind !== "raw")) {
      return { error: "This notebook contains an invalid cell. Switch to source to inspect it." };
    }
    const outputs = kind === "code" && Array.isArray(cell?.outputs) ? cell.outputs : [];
    cells.push({
      kind,
      source: source.slice(0, MAX_TEXT_LENGTH),
      executionCount:
        typeof cell?.execution_count === "number" && Number.isSafeInteger(cell.execution_count)
          ? cell.execution_count
          : null,
      outputs: outputs.slice(0, MAX_OUTPUTS).map(outputPreview),
      truncated: source.length > MAX_TEXT_LENGTH || outputs.length > MAX_OUTPUTS,
    });
  }
  return {
    cells,
    language: typeof language === "string" && /^[\w+-]{1,40}$/.test(language) ? language : "text",
    truncated: notebook.cells.length > MAX_CELLS,
  };
}

export function notebookCodeFence(source: string, language: string): string {
  const longestFence = Math.max(
    2,
    ...Array.from(source.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestFence + 1);
  return `${fence}${language}\n${source}\n${fence}`;
}

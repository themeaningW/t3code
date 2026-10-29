import { describe, expect, it } from "vite-plus/test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { remarkChatMath } from "./markdownMath.ts";
import { CHAT_MARKDOWN_MATH_REHYPE_PLUGINS } from "./markdownPipeline.ts";

const formulas = [
  String.raw`\underbrace{10\cdot20}_{\text{przed}}
=
\underbrace{20\cdot10}_{\text{po}}=200\text{ zł}`,
  String.raw`\text{Nowy indeks}
=
1000\cdot\frac{120}{100}
=
1200`,
  "x\n\n=\n\ny",
  "x\n---\ny",
  String.raw`\begin{aligned}x&=1\\y&=2\end{aligned}`,
];

function parse(source: string) {
  const processor = unified().use(remarkParse).use(remarkChatMath);
  const tree = processor.parse(source);
  processor.runSync(tree, { value: source });
  return tree;
}

describe("display math block boundaries", () => {
  it.each(formulas)("protects Markdown-looking math: %s", (formula) => {
    const source = `Before\n\n\\[${formula}\n\\]\n\nAfter`;
    const tree = parse(source);
    expect(tree.children.map((node) => node.type)).toEqual(["paragraph", "math", "paragraph"]);
    expect(tree.children[1]).toMatchObject({ value: formula });
    const renderer = unified().use(remarkRehype).use(CHAT_MARKDOWN_MATH_REHYPE_PLUGINS);
    const rendered = JSON.stringify(renderer.runSync(tree));
    expect(rendered).toContain("katex-display");
    expect(rendered).not.toContain("katex-error");
  });

  it.each(["\n", "\r\n"])("supports indented blocks in lists and quotes (%j)", (eol) => {
    for (const source of [
      "- Formula:\n\n  \\[\n  x\n  =\n  y\n  \\]\n\n  After",
      "> \\[\n> x\n>\n> =\n> y\n> \\]\n>\n> After",
    ]) {
      const tree = JSON.stringify(parse(source.replaceAll("\n", eol)));
      expect(tree).toContain('"type":"math"');
      expect(tree).not.toContain('"type":"heading"');
      expect(tree).toContain("After");
    }
  });

  it.each([
    "\\[x=1\\]",
    "   \\[\n   x=1\n   \\]   ",
    "\\[\nx=1\\\\[2pt]y=2\n\\]",
    "$$\nx\n\n=\n\ny\n$$",
    "Inline \\(x=1\\) and $y=2$.",
    "Before \\[x=1\\] after.",
  ])("retains other supported delimiters and TeX line breaks: %s", (source) => {
    const tree = JSON.stringify(parse(source));
    expect(tree).toMatch(/"type":"(?:math|inlineMath)"/);
  });

  it.each([
    "`\\[x\\]`",
    "```latex\n\\[\nx\n=\ny\n\\]\n```",
    "\\\\[literal\\\\]",
    "[link](https://example.com/\\[x\\])",
    "\\[\nx\n\nFollowing prose",
    "\\[\nx\n=\ny",
  ])("does not invent math in code, links or unfinished blocks: %s", (source) => {
    const tree = JSON.stringify(parse(source));
    expect(tree).not.toContain('"type":"math"');
    expect(tree).not.toContain('"type":"inlineMath"');
  });
});

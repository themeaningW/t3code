import type { Construct, Extension, State } from "micromark-util-types";
import { markdownLineEnding } from "micromark-util-character";
import remarkMath from "remark-math";
import type { Processor } from "unified";

// remark-math registers these tokens without exporting their micromark types.
declare module "micromark-util-types" {
  interface TokenTypeMap {
    mathText: "mathText";
    mathTextSequence: "mathTextSequence";
    mathTextData: "mathTextData";
    mathFlow: "mathFlow";
    mathFlowFence: "mathFlowFence";
    mathFlowValue: "mathFlowValue";
  }
}

/** Recognize LaTeX delimiters before CommonMark consumes their backslashes. */
const backslashMath: Construct = {
  name: "latexMath",
  tokenize(effects, ok, nok) {
    let closing = 41;
    const close: Construct = {
      partial: true,
      tokenize(effects, ok, nok) {
        return (code) => {
          effects.enter("mathTextSequence");
          effects.consume(code);
          return (code) => {
            if (code !== closing) return nok(code);
            effects.consume(code);
            effects.exit("mathTextSequence");
            return ok;
          };
        };
      },
    };
    return (code) => {
      effects.enter("mathText");
      effects.enter("mathTextSequence");
      effects.consume(code);
      return (code) => {
        if (code !== 40 && code !== 91) return nok(code);
        closing = code === 40 ? 41 : 93;
        effects.consume(code);
        effects.exit("mathTextSequence");
        return between;
      };
    };

    function between(code: number | null): State | undefined {
      if (code === null) return nok(code);
      if (code === 92) return effects.check(close, finish, escape)(code);
      if (markdownLineEnding(code)) {
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        return between;
      }
      effects.enter("mathTextData");
      return data(code);
    }

    function data(code: number | null): State | undefined {
      if (code === null || code === 92 || markdownLineEnding(code)) {
        effects.exit("mathTextData");
        return between(code);
      }
      effects.consume(code);
      return data;
    }

    function escape(code: number | null) {
      effects.enter("mathTextData");
      effects.consume(code);
      return (code: number | null) => {
        if (code === null) return nok(code);
        if (markdownLineEnding(code)) {
          effects.exit("mathTextData");
          return between(code);
        }
        // A doubled backslash is a TeX line break, not the start of a delimiter.
        effects.consume(code);
        return data;
      };
    }

    function finish(code: number | null) {
      effects.enter("mathTextSequence");
      effects.consume(code);
      return (code: number | null) => {
        effects.consume(code);
        effects.exit("mathTextSequence");
        effects.exit("mathText");
        return ok;
      };
    }
  },
};

// Text constructs run after block parsing, when standalone '=' and blank lines
// have already split the formula. Reserve display blocks at the flow stage.
const backslashMathFlow: Construct = {
  name: "latexMathFlow",
  concrete: true,
  tokenize(effects, ok, nok) {
    const interrupt = this.interrupt;
    const isLazy = () => this.parser.lazy[this.now().line];
    const closing: Construct = {
      partial: true,
      tokenize(effects, ok, nok) {
        return (code) => {
          effects.enter("mathFlowFence");
          effects.consume(code);
          return (code) => {
            if (code !== 93) return nok(code);
            effects.consume(code);
            return after;
          };
        };
        function after(code: number | null): State | undefined {
          if (code === 32 || code === -2 || code === -1) {
            effects.consume(code);
            return after;
          }
          if (code !== null && !markdownLineEnding(code)) return nok(code);
          effects.exit("mathFlowFence");
          return ok(code);
        }
      },
    };
    return (code) => {
      effects.enter("mathFlow");
      effects.enter("mathFlowFence");
      effects.consume(code);
      return (code) => {
        if (code !== 91) return nok(code);
        effects.consume(code);
        effects.exit("mathFlowFence");
        if (interrupt) return ok;
        return between;
      };
    };

    function between(code: number | null): State | undefined {
      if (code === null) return nok(code);
      if (code === 92) return effects.attempt(closing, finish, valueStart)(code);
      if (markdownLineEnding(code)) {
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        return lineStart;
      }
      return valueStart(code);
    }

    function lineStart(code: number | null): State | undefined {
      if (isLazy()) return nok(code);
      // Strip only indentation: container prefixes are handled by micromark.
      if (code === 32 || code === -2 || code === -1) {
        effects.enter("linePrefix");
        effects.consume(code);
        effects.exit("linePrefix");
        return lineStart;
      }
      return between(code);
    }

    function valueStart(code: number | null): State | undefined {
      effects.enter("mathFlowValue");
      if (code === 92) {
        effects.consume(code);
        return escaped;
      }
      return value(code);
    }

    function value(code: number | null): State | undefined {
      if (code === null || code === 92 || markdownLineEnding(code)) {
        effects.exit("mathFlowValue");
        return between(code);
      }
      effects.consume(code);
      return value;
    }

    function escaped(code: number | null): State | undefined {
      if (code === null || markdownLineEnding(code)) return value(code);
      effects.consume(code);
      effects.exit("mathFlowValue");
      return between;
    }

    function finish(code: number | null) {
      effects.exit("mathFlow");
      return ok(code);
    }
  },
};

function withCurrencyGuard(construct: Construct): Construct {
  return {
    ...construct,
    tokenize(effects, ok, nok) {
      return construct.tokenize.call(
        this,
        effects,
        (code) => {
          const token = this.events.at(-1)?.[1];
          const source = token ? this.sliceSerialize(token) : "";
          // Pandoc-style boundaries keep "$100 and $200" and "$skill" as prose.
          if (
            !source.startsWith("$$") &&
            (/^\$\s|\s\$$/.test(source) || (code !== null && code >= 48 && code <= 57))
          ) {
            return nok(code);
          }
          return ok(code);
        },
        nok,
      );
    },
  };
}

interface MathNode {
  type: string;
  position?: { start: { offset?: number | undefined } } | undefined;
  data?: { hProperties?: Record<string, unknown> } | undefined;
  children?: MathNode[];
}

/* oxlint-disable oxc/no-this-in-exported-function -- Unified binds syntax plugins to their processor. */
export function remarkChatMath(this: Processor) {
  const data = this.data();
  const extensions = (data.micromarkExtensions ??= []);
  const firstMathExtension = extensions.length;
  remarkMath.call(this);
  for (const extension of extensions.slice(firstMathExtension)) {
    const dollar = extension.text?.[36];
    if (!dollar || !extension.text) continue;
    extension.text[36] = Array.isArray(dollar)
      ? dollar.map(withCurrencyGuard)
      : withCurrencyGuard(dollar);
  }
  extensions.push({
    text: { 92: backslashMath },
    flow: { 92: backslashMathFlow },
  } satisfies Extension);

  return (tree: MathNode, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: MathNode) => {
      const offset = node.position?.start.offset;
      const delimiter = offset === undefined ? "" : source.slice(offset, offset + 2);
      if (node.type === "inlineMath" && (delimiter === "\\[" || delimiter === "$$")) {
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, className: ["language-math", "math-display"] },
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
/* oxlint-enable oxc/no-this-in-exported-function */

interface MathHastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MathHastNode[];
}

function textContent(node: MathHastNode): string {
  return node.value ?? (node.children ?? []).map(textContent).join("");
}

function mathSource(node: MathHastNode): string | undefined {
  if (node.tagName === "annotation") return textContent(node);
  for (const child of node.children ?? []) {
    const value = mathSource(child);
    if (value !== undefined) return value;
  }
}

/** Preserve TeX when copying; index only the visible HTML, not its MathML duplicate. */
export function rehypeMathMetadata() {
  return (tree: MathHastNode) => {
    const visit = (node: MathHastNode, display = false) => {
      const classes = node.properties?.className;
      const hasClass = (name: string) => Array.isArray(classes) && classes.includes(name);
      const isDisplay = hasClass("katex-display");
      if (hasClass("katex-mathml")) {
        node.properties = { ...node.properties, dataThreadFindIgnore: true };
      }
      if (isDisplay || (hasClass("katex") && !display)) {
        const value = mathSource(node);
        if (value !== undefined) {
          const displayValue = value.replace(/^(?:\r\n|\r|\n)|(?:\r\n|\r|\n)$/g, "");
          node.properties = {
            ...node.properties,
            dataMarkdownCopy: isDisplay ? `\\[\n${displayValue}\n\\]` : `\\(${value}\\)`,
          };
        }
      }
      if (hasClass("katex-error") && node.properties) delete node.properties.title;
      node.children?.forEach((child) => visit(child, display || isDisplay));
    };
    visit(tree);
  };
}

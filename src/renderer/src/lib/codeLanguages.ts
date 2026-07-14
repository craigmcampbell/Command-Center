// Curated set of fence-highlight languages, shared by the static preview
// renderer (lib/codeHighlight.ts) and the live editor's fenced code blocks
// (lib/markdownEditor.ts's `codeLanguages` option) — one list, so the two
// surfaces never recognize a different set of languages. Deliberately a
// small hand-picked set of statically-imported parsers rather than the full
// @codemirror/language-data catalog (180+ languages, lazy-loaded via dynamic
// import) — that would make the preview renderer async for no real benefit
// to a personal notes app. An unrecognized fence language just renders
// unhighlighted, same as before this existed.

import type { Parser } from "@lezer/common";
import { LanguageSupport, LanguageDescription, StreamLanguage } from "@codemirror/language";
import { javascript, jsxLanguage, tsxLanguage } from "@codemirror/lang-javascript";
import { python, pythonLanguage } from "@codemirror/lang-python";
import { json, jsonLanguage } from "@codemirror/lang-json";
import { css, cssLanguage } from "@codemirror/lang-css";
import { html, htmlLanguage } from "@codemirror/lang-html";
import { sql } from "@codemirror/lang-sql";
import { yaml, yamlLanguage } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";

export interface CodeLanguageEntry {
  name: string;
  aliases: string[];
  support: LanguageSupport;
  parser: Parser;
}

const shellLanguage = StreamLanguage.define(shell);
const sqlSupport = sql();

export const CODE_LANGUAGES: CodeLanguageEntry[] = [
  {
    name: "javascript",
    aliases: ["js", "javascript", "jsx"],
    support: javascript({ jsx: true }),
    parser: jsxLanguage.parser,
  },
  {
    name: "typescript",
    aliases: ["ts", "typescript", "tsx"],
    support: javascript({ jsx: true, typescript: true }),
    parser: tsxLanguage.parser,
  },
  { name: "python", aliases: ["py", "python"], support: python(), parser: pythonLanguage.parser },
  { name: "json", aliases: ["json"], support: json(), parser: jsonLanguage.parser },
  { name: "css", aliases: ["css"], support: css(), parser: cssLanguage.parser },
  { name: "html", aliases: ["html", "htm"], support: html(), parser: htmlLanguage.parser },
  { name: "sql", aliases: ["sql"], support: sqlSupport, parser: sqlSupport.language.parser },
  { name: "yaml", aliases: ["yaml", "yml"], support: yaml(), parser: yamlLanguage.parser },
  {
    name: "shell",
    aliases: ["sh", "bash", "shell", "zsh"],
    support: new LanguageSupport(shellLanguage),
    parser: shellLanguage.parser,
  },
];

export function findCodeLanguage(info: string): CodeLanguageEntry | null {
  const key = info.trim().toLowerCase().split(/\s+/)[0];
  if (!key) return null;
  return CODE_LANGUAGES.find((l) => l.aliases.includes(key)) ?? null;
}

export function buildEditorCodeLanguageDescriptions(): LanguageDescription[] {
  return CODE_LANGUAGES.map((l) => LanguageDescription.of({ name: l.name, alias: l.aliases, support: l.support }));
}

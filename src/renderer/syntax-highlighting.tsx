import React from 'react'
import { Highlight, themes } from 'prism-react-renderer'

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  bash: 'plain',
  c: 'c',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'clike',
  css: 'css',
  cts: 'typescript',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  h: 'c',
  hpp: 'cpp',
  htm: 'markup',
  html: 'markup',
  java: 'clike',
  js: 'javascript',
  json: 'json',
  json5: 'javascript',
  jsonc: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  markdown: 'markdown',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  pyw: 'python',
  rb: 'plain',
  rs: 'rust',
  sh: 'plain',
  sql: 'sql',
  svg: 'markup',
  swift: 'swift',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'plain',
}

const LANGUAGE_BY_FILENAME: Readonly<Record<string, string>> = {
  dockerfile: 'plain',
  gemfile: 'plain',
  makefile: 'plain',
}

const LANGUAGE_LABEL_BY_EXTENSION: Readonly<Record<string, string>> = {
  bash: 'Shell',
  cs: 'C#',
  java: 'Java',
  json5: 'JSON5',
  rb: 'Ruby',
  sh: 'Shell',
  zsh: 'Shell',
}

const LANGUAGE_LABEL_BY_FILENAME: Readonly<Record<string, string>> = {
  dockerfile: 'Dockerfile',
  gemfile: 'Ruby',
  makefile: 'Makefile',
}

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  bash: 'Shell',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  docker: 'Dockerfile',
  go: 'Go',
  graphql: 'GraphQL',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  json5: 'JSON5',
  jsx: 'JSX',
  kotlin: 'Kotlin',
  makefile: 'Makefile',
  markdown: 'Markdown',
  markup: 'HTML/XML',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  sql: 'SQL',
  swift: 'Swift',
  tsx: 'TSX',
  typescript: 'TypeScript',
  yaml: 'YAML',
}

/** Resolve a Prism grammar from a project-relative filename. */
export function languageForPath(path: string): string {
  const filename = path.split('/').at(-1)?.toLowerCase() ?? ''
  const exact = LANGUAGE_BY_FILENAME[filename]
  if (exact !== undefined) return exact
  const extension = filename.includes('.') ? filename.split('.').at(-1) ?? '' : ''
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plain'
}

/** Return the compact user-facing language name for a project file. */
export function languageLabelForPath(path: string): string {
  const filename = path.split('/').at(-1)?.toLowerCase() ?? ''
  const exact = LANGUAGE_LABEL_BY_FILENAME[filename]
  if (exact !== undefined) return exact
  const extension = filename.includes('.') ? filename.split('.').at(-1) ?? '' : ''
  return LANGUAGE_LABEL_BY_EXTENSION[extension] ?? LANGUAGE_LABELS[languageForPath(path)] ?? '纯文本'
}

/** Render read-only source with stable line numbers and filename-based highlighting. */
export function SyntaxHighlightedCode({ path, content }: { path: string; content: string }) {
  const language = languageForPath(path)
  return (
    <Highlight code={content} language={language} theme={themes.oneDark}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className="workspace-code files" aria-label={`${languageLabelForPath(path)} 代码`}>
          {tokens.map((line, lineIndex) => {
            const lineText = line.map(token => token.content).join('')
            return (
              <code
                {...getLineProps({ line })}
                aria-label={`第 ${String(lineIndex + 1)} 行：${lineText}`}
                key={lineIndex}
              >
                <span className="workspace-line-number">{String(lineIndex + 1)}</span>
                <span className="workspace-line-source">
                  {line.map((token, tokenIndex) => (
                    <span {...getTokenProps({ token })} key={tokenIndex} />
                  ))}
                </span>
              </code>
            )
          })}
        </pre>
      )}
    </Highlight>
  )
}

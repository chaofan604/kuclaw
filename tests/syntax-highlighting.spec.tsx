// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SyntaxHighlightedCode,
  languageForPath,
  languageLabelForPath,
} from '../src/renderer/syntax-highlighting.js'

afterEach(cleanup)

describe('project file syntax highlighting', () => {
  it('selects a supported grammar and display label from the filename', () => {
    expect(languageForPath('src/app.tsx')).toBe('tsx')
    expect(languageLabelForPath('src/app.tsx')).toBe('TSX')
    expect(languageForPath('scripts/check.py')).toBe('python')
    expect(languageLabelForPath('scripts/check.py')).toBe('Python')
    expect(languageForPath('Dockerfile')).toBe('plain')
    expect(languageLabelForPath('Dockerfile')).toBe('Dockerfile')
    expect(languageForPath('assets/data.unknown')).toBe('plain')
    expect(languageLabelForPath('assets/data.unknown')).toBe('纯文本')
  })

  it('renders Python tokens with stable accessible line numbers', () => {
    render(<SyntaxHighlightedCode path="scripts/check.py" content={'with open("app.py") as file:\n    content = file.read()'} />)

    expect(screen.getByLabelText('Python 代码')).toBeTruthy()
    expect(screen.getByLabelText(/第 1 行：with open/u)).toBeTruthy()
    expect(screen.getByText('with').getAttribute('style')).toContain('color')
    expect(screen.getByText('open').getAttribute('style')).toContain('color')
  })
})

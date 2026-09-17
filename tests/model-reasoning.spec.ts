import { describe, expect, it } from 'vitest'
import { inferInputModalities, inferReasoningProfile } from '../src/main/runtime/model-reasoning.js'

describe('model reasoning capability inference', () => {
  it.each([
    'glm-5.3-flash',
    'zai/glm-5.3-flash',
    'deepseek-v4-flash',
    'deepseek-v4-1-flash-260910',
  ])('offers DeepSeek-style levels for %s', model => {
    expect(inferReasoningProfile(model, 'openai-completions')).toEqual({
      efforts: { off: null, low: 'low', high: 'high', max: 'max' },
      defaultEffort: 'high',
    })
  })

  it.each([
    'glm-5.3-flash',
    'deepseek-v4-1-flash-260910',
    'openai.gpt-5.6-sol',
  ])('offers the original five Responses levels for %s', model => {
    expect(inferReasoningProfile(model, 'openai-responses')).toEqual({
      efforts: {
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
      defaultEffort: 'high',
    })
  })

  it('does not invent capabilities for unknown models or incompatible protocols', () => {
    expect(inferReasoningProfile('private-model', 'openai-responses')).toBeUndefined()
    expect(inferReasoningProfile('openai.gpt-5.6-sol', 'anthropic-messages')).toBeUndefined()
  })

  it.each([
    'glm-5.3-flash',
    'deepseek-v4-1-flash-260910',
    'openai.gpt-5.6-sol',
  ])('declares image input for %s', model => {
    expect(inferInputModalities(model)).toEqual(['text', 'image'])
  })

  it('leaves unknown input capability untouched', () => {
    expect(inferInputModalities('private-model')).toBeUndefined()
  })
})

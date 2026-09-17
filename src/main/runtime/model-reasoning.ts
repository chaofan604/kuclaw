import type { ModelProviderProtocol } from '../../shared/contracts.js'

export type ReasoningEffortMap = Record<string, string | null>

export interface InferredReasoningProfile {
  efforts: ReasoningEffortMap
  defaultEffort: string
}

export type ModelInputModality = 'text' | 'image'

const DEEPSEEK_STYLE: InferredReasoningProfile = {
  efforts: {
    off: null,
    low: 'low',
    high: 'high',
    max: 'max',
  },
  defaultEffort: 'high',
}

const OPENAI_FIVE_LEVEL: InferredReasoningProfile = {
  efforts: {
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  defaultEffort: 'high',
}

const OPENAI_FOUR_LEVEL: InferredReasoningProfile = {
  efforts: {
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
  },
  defaultEffort: 'high',
}

/**
 * Infer the selectable thinking levels for well-known model families exposed
 * through a custom compatible endpoint. Unknown models stay untouched so the
 * app never advertises an effort the endpoint may reject.
 */
export function inferReasoningProfile(
  modelId: string,
  protocol: ModelProviderProtocol,
): InferredReasoningProfile | undefined {
  const id = modelId.trim().toLowerCase()
  if (id === '') return undefined

  if (protocol === 'openai-responses'
    && (/^(?:zai[./_-])?glm[-_.]?5[._-]3(?:[._-]|$)/u.test(id)
      || /deepseek(?:[./_-].*)?v4(?:[._-]1)?(?:[._-]|$)/u.test(id))) {
    return structuredClone(OPENAI_FIVE_LEVEL)
  }
  if (/^(?:zai[./_-])?glm[-_.]?5[._-]3(?:[._-]|$)/u.test(id)) {
    return structuredClone(DEEPSEEK_STYLE)
  }
  if (/deepseek(?:[./_-].*)?v4(?:[._-]1)?(?:[._-]|$)/u.test(id)) {
    return structuredClone(DEEPSEEK_STYLE)
  }
  if (protocol === 'openai-responses'
    && /(?:^|[./_-])gpt[-_.]?5[._-]6(?:[._-]|$)|^openai\.gpt-5\.6/u.test(id)) {
    return structuredClone(OPENAI_FIVE_LEVEL)
  }
  if (protocol === 'openai-responses'
    && /(?:^|[./_-])gpt[-_.]?5[._-][45](?:[._-]|$)|^openai\.gpt-5\.[45]/u.test(id)) {
    return structuredClone(OPENAI_FOUR_LEVEL)
  }
  return undefined
}

/** Infer multimodal input for the model families currently exposed by the app. */
export function inferInputModalities(modelId: string): ModelInputModality[] | undefined {
  const id = modelId.trim().toLowerCase()
  if (/^(?:zai[./_-])?glm[-_.]?5[._-]3[._-]flash(?:[._-]|$)/u.test(id)
    || /deepseek(?:[./_-].*)?v4(?:[._-]1)?[._-]flash(?:[._-]|$)/u.test(id)
    || /(?:^|[./_-])gpt[-_.]?5[._-]6(?:[._-]|$)|^openai\.gpt-5\.6/u.test(id)) {
    return ['text', 'image']
  }
  return undefined
}

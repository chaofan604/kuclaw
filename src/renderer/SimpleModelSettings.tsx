import { useEffect, useMemo, useState } from 'react'
import type {
  ModelConfiguration,
  ModelProviderProfile,
  ModelProviderProfileModel,
  ModelProviderProtocol,
} from '../shared/contracts'

type IconName = 'arrow' | 'model' | 'plus' | 'search'

interface EditorState {
  providerId: string
  originalModelId?: string
  protocol: ModelProviderProtocol
  baseURL: string
  apiKey: string
  clearApiKey: boolean
  modelId: string
  contextWindow: string
}

type TestState =
  | { status: 'running' }
  | { status: 'success'; latencyMs: number }
  | { status: 'error'; message: string }

function Icon({ name }: { name: IconName }) {
  const content = {
    arrow: <path d="m15 18-6-6 6-6" />,
    model: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 9h8M8 13h5M8 17h3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  }[name]
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      {content}
    </svg>
  )
}

function profileName(protocol: ModelProviderProtocol): string {
  if (protocol === 'anthropic-messages') return 'Anthropic 兼容接口'
  if (protocol === 'openai-responses') return 'OpenAI Responses 兼容接口'
  return 'OpenAI 兼容接口'
}

function protocolName(protocol: ModelProviderProtocol): string {
  if (protocol === 'anthropic-messages') return 'Anthropic Messages'
  if (protocol === 'openai-responses') return 'OpenAI Responses'
  return 'OpenAI Chat Completions'
}

function userFacingError(reason: unknown): string {
  let message = reason instanceof Error ? reason.message : String(reason)
  const remotePrefix = /^Error invoking remote method '[^']+': Error: /u
  message = message.replace(remotePrefix, '')
  if (/fetch failed|ECONN|ENOTFOUND|network|socket|certificate/iu.test(message)) {
    return '无法连接模型接口，请检查接口地址和网络后重试。'
  }
  if (/timed?\s*out|timeout/iu.test(message)) return '连接检测超时，请稍后重试。'
  return message.slice(0, 180)
}

function normalizeGatewayBaseURL(raw: string): string {
  return raw.trim().replace(/\/+$/u, '').replace(/\/(?:responses|chat\/completions|messages)$/u, '')
}

function modelKey(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`
}

function nextProviderId(configuration: ModelConfiguration): string {
  const ids = new Set(configuration.profiles.map(profile => profile.id))
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? 'custom-model' : `custom-model-${String(suffix)}`
    if (!ids.has(candidate)) return candidate
  }
}

function initialEditor(profile?: ModelProviderProfile, model?: ModelProviderProfileModel): EditorState {
  return {
    providerId: profile?.id ?? 'custom-gateway',
    ...(model === undefined ? {} : { originalModelId: model.id }),
    protocol: profile?.protocol ?? 'openai-completions',
    baseURL: profile?.baseURL ?? '',
    apiKey: '',
    clearApiKey: false,
    modelId: model?.id ?? '',
    contextWindow: String(model?.contextWindow ?? profile?.models[0]?.contextWindow ?? 262_144),
  }
}

export function SimpleModelSettings({ onClose }: { onClose: () => void }) {
  const [configuration, setConfiguration] = useState<ModelConfiguration>()
  const [editor, setEditor] = useState<EditorState>()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const [tests, setTests] = useState<Record<string, TestState>>({})

  useEffect(() => {
    void window.harnessStudio.models.getConfiguration().then(setConfiguration).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [])

  const cards = useMemo(() => configuration?.profiles.flatMap(profile =>
    profile.models.map(model => ({ profile, model }))) ?? [], [configuration])

  function beginAdd() {
    if (configuration === undefined) return
    setMessage(undefined)
    setError(undefined)
    setEditor({
      ...initialEditor(),
      providerId: nextProviderId(configuration),
    })
  }

  function beginEdit(profile: ModelProviderProfile, model: ModelProviderProfileModel) {
    if (configuration === undefined) return
    setMessage(undefined)
    setError(undefined)
    setEditor(initialEditor(profile, model))
  }

  async function saveEditor() {
    if (configuration === undefined || editor === undefined) return
    setSaving(true)
    setMessage(undefined)
    setError(undefined)
    try {
      const modelId = editor.modelId.trim()
      if (modelId === '') throw new Error('请填写 model_name')
      const maximumContext = Number(editor.contextWindow)
      if (!Number.isSafeInteger(maximumContext) || maximumContext <= 0) {
        throw new Error('最大上下文必须是正整数')
      }
      const gateway = normalizeGatewayBaseURL(editor.baseURL)
      if (gateway === '') throw new Error('请填写接口地址')
      const existing = configuration.profiles.find(profile => profile.id === editor.providerId)
      const duplicate = existing?.models.some(model => model.id === modelId
        && model.id !== editor.originalModelId) === true
      if (duplicate) throw new Error(`模型 ${modelId} 已存在`)
      const nextModel: ModelProviderProfileModel = {
        id: modelId,
        name: modelId,
        contextWindow: maximumContext,
        maxTokens: existing?.models.find(model => model.id === editor.originalModelId)?.maxTokens ?? 32_768,
      }
      const nextModels = existing === undefined
        ? [nextModel]
        : editor.originalModelId === undefined
          ? [...existing.models, nextModel]
          : existing.models.map(model => model.id === editor.originalModelId ? nextModel : model)
      const currentDefault = configuration.defaultSelection
      const defaultSelection = editor.originalModelId !== undefined
        && currentDefault.provider === editor.providerId
        && currentDefault.model === editor.originalModelId
        ? { ...currentDefault, model: modelId }
        : editor.originalModelId === undefined
          ? { provider: editor.providerId, model: modelId }
          : currentDefault
      const next = await window.harnessStudio.models.updateConfiguration({
        upsertProfile: {
          id: editor.providerId,
          displayName: profileName(editor.protocol),
          protocol: editor.protocol,
          baseURL: gateway,
          models: nextModels,
          ...(editor.apiKey.trim() === '' ? {} : { apiKey: editor.apiKey.trim() }),
          ...(editor.clearApiKey ? { clearApiKey: true } : {}),
        },
        defaultSelection,
      })
      setConfiguration(next)
      setEditor(undefined)
      setMessage(editor.originalModelId === undefined ? `模型 ${modelId} 已添加。` : `模型 ${modelId} 已保存。`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function testModel(profile: ModelProviderProfile, model: ModelProviderProfileModel) {
    const key = modelKey(profile.id, model.id)
    setTests(current => ({ ...current, [key]: { status: 'running' } }))
    try {
      const result = await window.harnessStudio.models.test({ providerId: profile.id, modelId: model.id })
      setTests(current => ({ ...current, [key]: { status: 'success', ...result } }))
    } catch (reason) {
      setTests(current => ({ ...current, [key]: { status: 'error', message: userFacingError(reason) } }))
    }
  }

  const editedProfile = editor === undefined
    ? undefined
    : configuration?.profiles.find(profile => profile.id === editor.providerId)

  return (
    <div className="settings-shell simple-settings">
      <aside className="settings-sidebar">
        <div className="settings-window-drag" />
        <button className="settings-back" onClick={onClose}><Icon name="arrow" /><span>返回应用</span></button>
        <div className="settings-search"><Icon name="search" /><span>搜索设置…</span></div>
        <div className="settings-nav-label">Harness</div>
        <button className="settings-nav active"><Icon name="model" /><span>模型</span></button>
      </aside>

      <main className="settings-content">
        <div className="settings-content-inner simple-settings-inner">
          {editor === undefined ? (
            <>
              <header className="settings-title model-list-title">
                <div>
                  <h1>模型</h1>
                  <p>管理模型接口并验证连接状态。</p>
                </div>
                <button className="settings-save add-model-button" disabled={configuration === undefined} onClick={beginAdd}>
                  <Icon name="plus" />添加模型
                </button>
              </header>

              {error !== undefined && <div className="settings-notice error">{error}</div>}
              {message !== undefined && <div className="settings-notice success">{message}</div>}

              {configuration !== undefined && cards.length === 0 ? (
                <div className="model-card-empty">
                  <Icon name="model" />
                  <h2>还没有模型</h2>
                  <p>添加接口地址、协议和 model_name 后，模型会显示在这里。</p>
                  <button className="settings-save" onClick={beginAdd}>添加模型</button>
                </div>
              ) : (
                <section className="model-card-list" aria-label="已配置模型">
                  {cards.map(({ profile, model }) => {
                    const state = tests[modelKey(profile.id, model.id)]
                    return (
                      <article className="model-settings-card" key={modelKey(profile.id, model.id)}>
                        <div className="model-card-heading">
                          <div className="model-card-icon"><Icon name="model" /></div>
                          <div>
                            <h2>{model.name}</h2>
                            <span>{protocolName(profile.protocol)}</span>
                          </div>
                        </div>
                        <dl className="model-card-details">
                          <div><dt>接口地址</dt><dd title={profile.baseURL}>{profile.baseURL}</dd></div>
                          <div><dt>最大上下文</dt><dd>{model.contextWindow.toLocaleString()} tokens</dd></div>
                          <div><dt>API Key</dt><dd className={profile.credentialConfigured ? 'configured' : ''}>{profile.credentialConfigured ? '已配置' : '未配置'}</dd></div>
                        </dl>
                        {state !== undefined && (
                          <div className={`model-test-result ${state.status}`} role="status">
                            {state.status === 'running' && '正在检测连接…'}
                            {state.status === 'success' && <>连接正常<span>{state.latencyMs}ms</span></>}
                            {state.status === 'error' && <>连接失败<span>{state.message}</span></>}
                          </div>
                        )}
                        <div className="model-card-actions">
                          <button type="button" disabled={state?.status === 'running'} onClick={() => void testModel(profile, model)}>
                            {state?.status === 'running' ? '测试中…' : '测试'}
                          </button>
                          <button type="button" className="primary" onClick={() => beginEdit(profile, model)}>编辑</button>
                        </div>
                      </article>
                    )
                  })}
                </section>
              )}
            </>
          ) : (
            <>
              <header className="settings-title model-editor-title">
                <div>
                  <button className="model-editor-back" type="button" onClick={() => { setEditor(undefined); setError(undefined) }}>
                    <Icon name="arrow" />模型列表
                  </button>
                  <h1>{editor.originalModelId === undefined ? '添加模型' : '编辑模型'}</h1>
                  <p>填写接口信息和接口实际使用的 model_name。</p>
                </div>
                <button className="settings-save" disabled={saving} onClick={() => void saveEditor()}>
                  {saving ? '保存中…' : '保存'}
                </button>
              </header>

              {error !== undefined && <div className="settings-notice error">{error}</div>}

              <section className="settings-section">
                <h2>模型接口</h2>
                <div className="settings-card">
                  <label className="settings-row">
                    <span className="settings-row-copy"><b>协议</b><small>选择接口实际兼容的请求格式。</small></span>
                    <select value={editor.protocol} onChange={event => setEditor(current => current === undefined ? current : { ...current, protocol: event.target.value as ModelProviderProtocol })}>
                      <option value="openai-completions">OpenAI Chat Completions</option>
                      <option value="openai-responses">OpenAI Responses</option>
                      <option value="anthropic-messages">Anthropic Messages</option>
                    </select>
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-copy"><b>接口地址</b><small>填根地址，例如 https://api.example.com/v1</small></span>
                    <input className="settings-text-input" value={editor.baseURL} onChange={event => setEditor(current => current === undefined ? current : { ...current, baseURL: event.target.value })} spellCheck={false} />
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-copy">
                      <b>API Key</b>
                      <small>{editedProfile?.credentialWritable === false
                        ? `凭据由 ${editedProfile.credentialSource ?? '外部来源'} 提供，当前不可修改。`
                        : editedProfile?.credentialConfigured === true
                          ? '已配置；留空表示保持不变。'
                          : '密钥写入 Harness 凭据存储。'}</small>
                    </span>
                    <span className="credential-editor">
                      <input type="password" disabled={editedProfile?.credentialWritable === false} value={editor.apiKey} placeholder={editedProfile?.credentialConfigured === true ? '已配置' : 'sk-…'} onChange={event => setEditor(current => current === undefined ? current : { ...current, apiKey: event.target.value, clearApiKey: false })} autoComplete="off" />
                      {editedProfile?.credentialConfigured === true && editedProfile.credentialWritable && (
                        <button type="button" onClick={() => setEditor(current => current === undefined ? current : { ...current, apiKey: '', clearApiKey: !current.clearApiKey })}>
                          {editor.clearApiKey ? '取消清除' : '清除'}
                        </button>
                      )}
                    </span>
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-copy"><b>model_name</b><small>填写服务端识别的模型 ID。</small></span>
                    <input className="settings-text-input" value={editor.modelId} placeholder="例如 glm-5.3-flash" onChange={event => setEditor(current => current === undefined ? current : { ...current, modelId: event.target.value })} spellCheck={false} />
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-copy"><b>最大上下文</b><small>此模型可使用的上下文长度。</small></span>
                    <input className="settings-number-input" type="number" min="1" step="1" value={editor.contextWindow} onChange={event => setEditor(current => current === undefined ? current : { ...current, contextWindow: event.target.value })} />
                  </label>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type {
  ModelConfiguration,
  ModelProviderProfile,
  ModelProviderProfileInput,
  ModelProviderProfileModel,
  ModelProviderProtocol,
  ModelSelection,
} from '../shared/contracts'

interface ProviderDraft {
  id: string
  displayName: string
  protocol: ModelProviderProtocol
  baseURL: string
  apiKey: string
  clearApiKey: boolean
  models: ModelProviderProfileModel[]
}

const EMPTY_DRAFT: ProviderDraft = {
  id: 'custom-gateway',
  displayName: '自定义模型接口',
  protocol: 'openai-completions',
  baseURL: 'https://api.example.com/v1',
  apiKey: '',
  clearApiKey: false,
  models: [],
}

function Icon({ name }: { name: 'arrow' | 'key' | 'model' | 'plus' | 'search' | 'trash' }) {
  const content = {
    arrow: <path d="m15 18-6-6 6-6" />,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M15 8l2 2M17 6l2 2" /></>,
    model: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 9h8M8 13h5M8 17h3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
  }[name]
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      {content}
    </svg>
  )
}

function draftOf(profile: ModelProviderProfile): ProviderDraft {
  return {
    id: profile.id,
    displayName: profile.displayName,
    protocol: profile.protocol,
    baseURL: profile.baseURL,
    apiKey: '',
    clearApiKey: false,
    models: structuredClone(profile.models),
  }
}

function modelSelection(provider: string, model: string, reasoningEffort: string): ModelSelection {
  return {
    provider,
    model,
    ...(reasoningEffort === '' ? {} : { reasoningEffort }),
  }
}

function providerInput(draft: ProviderDraft): ModelProviderProfileInput {
  return {
    id: draft.id.trim(),
    displayName: draft.displayName.trim(),
    protocol: draft.protocol,
    baseURL: draft.baseURL.trim(),
    models: draft.models.map(model => ({
      id: model.id.trim(),
      name: model.name.trim(),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
    ...(draft.apiKey.trim() === '' ? {} : { apiKey: draft.apiKey.trim() }),
    ...(draft.clearApiKey ? { clearApiKey: true } : {}),
  }
}

export function ModelsSettingsPage({ onClose }: { onClose: () => void }) {
  const [configuration, setConfiguration] = useState<ModelConfiguration>()
  const [editingExisting, setEditingExisting] = useState(false)
  const [draft, setDraft] = useState<ProviderDraft>(structuredClone(EMPTY_DRAFT))
  const [defaultProvider, setDefaultProvider] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState('')
  const [saving, setSaving] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    void reload()
  }, [])

  const selectedGroup = useMemo(
    () => configuration?.groups.find(group => group.id === defaultProvider),
    [configuration, defaultProvider],
  )
  const selectedModel = useMemo(
    () => selectedGroup?.models.find(model => model.id === defaultModel),
    [selectedGroup, defaultModel],
  )
  const currentProfile = configuration?.profiles.find(profile => profile.id === draft.id)

  async function reload(preferredProfileId?: string) {
    const next = await window.harnessStudio.models.getConfiguration()
    setConfiguration(next)
    setDefaultProvider(next.defaultSelection.provider)
    setDefaultModel(next.defaultSelection.model)
    setReasoningEffort(next.defaultSelection.reasoningEffort ?? '')
    const profile = next.profiles.find(item => item.id === preferredProfileId) ?? next.profiles[0]
    if (profile !== undefined) {
      setDraft(draftOf(profile))
      setEditingExisting(true)
    } else {
      setDraft(structuredClone(EMPTY_DRAFT))
      setEditingExisting(false)
    }
  }

  function selectProfile(id: string) {
    const profile = configuration?.profiles.find(item => item.id === id)
    if (profile === undefined) return
    setDraft(draftOf(profile))
    setEditingExisting(true)
    setMessage(undefined)
    setError(undefined)
  }

  function newProfile() {
    const count = (configuration?.profiles.length ?? 0) + 1
    setDraft({
      ...structuredClone(EMPTY_DRAFT),
      id: count === 1 ? 'custom-gateway' : `custom-gateway-${String(count)}`,
      displayName: count === 1 ? '自定义模型接口' : `自定义模型接口 ${String(count)}`,
    })
    setEditingExisting(false)
    setMessage(undefined)
    setError(undefined)
  }

  function updateModel(index: number, patch: Partial<ModelProviderProfileModel>) {
    setDraft(current => ({
      ...current,
      models: current.models.map((model, modelIndex) =>
        modelIndex === index ? { ...model, ...patch } : model),
    }))
  }

  async function discover() {
    setDiscovering(true)
    setMessage(undefined)
    setError(undefined)
    try {
      const result = await window.harnessStudio.models.discover({
        ...(editingExisting ? { providerId: draft.id } : {}),
        protocol: draft.protocol,
        baseURL: draft.baseURL.trim(),
        ...(draft.apiKey.trim() === '' ? {} : { apiKey: draft.apiKey.trim() }),
      })
      setDraft(current => ({ ...current, models: result.models }))
      setMessage(`发现 ${String(result.models.length)} 个模型，请检查容量后保存。`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDiscovering(false)
    }
  }

  async function save() {
    setSaving(true)
    setMessage(undefined)
    setError(undefined)
    try {
      const next = await window.harnessStudio.models.updateConfiguration({
        upsertProfile: providerInput(draft),
        ...(defaultProvider === '' || defaultModel === '' ? {} : {
          defaultSelection: modelSelection(defaultProvider, defaultModel, reasoningEffort),
        }),
      })
      setConfiguration(next)
      setDraft(current => ({ ...current, apiKey: '', clearApiKey: false }))
      setEditingExisting(true)
      setMessage('模型接口和默认模型已保存，将用于下一次请求。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editingExisting) return
    setSaving(true)
    setMessage(undefined)
    setError(undefined)
    try {
      await window.harnessStudio.models.updateConfiguration({ removeProfileId: draft.id })
      await reload()
      setMessage('模型接口已删除。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  function changeDefaultProvider(provider: string) {
    setDefaultProvider(provider)
    const group = configuration?.groups.find(item => item.id === provider)
    const first = group?.models[0]
    setDefaultModel(first?.id ?? '')
    setReasoningEffort(first?.defaultReasoningEffort ?? '')
  }

  function changeDefaultModel(model: string) {
    setDefaultModel(model)
    const found = selectedGroup?.models.find(item => item.id === model)
    setReasoningEffort(found?.defaultReasoningEffort ?? '')
  }

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-window-drag" />
        <button className="settings-back" onClick={onClose}><Icon name="arrow" /><span>返回应用</span></button>
        <div className="settings-search"><Icon name="search" /><span>搜索设置…</span></div>
        <div className="settings-nav-label">Harness</div>
        <button className="settings-nav active"><Icon name="model" /><span>模型</span></button>
        <button className="settings-nav" disabled><Icon name="key" /><span>凭据</span></button>
        <div className="provider-list-label">
          <span>模型接口</span>
          <button aria-label="新增模型接口" onClick={newProfile}><Icon name="plus" /></button>
        </div>
        <div className="provider-list">
          {configuration?.profiles.map(profile => (
            <button
              className={editingExisting && profile.id === draft.id ? 'active' : ''}
              key={profile.id}
              onClick={() => selectProfile(profile.id)}
            >
              <span>{profile.displayName}</span>
              <small>{profile.protocol}</small>
            </button>
          ))}
          {configuration?.profiles.length === 0 && <p>尚未配置兼容接口。</p>}
        </div>
      </aside>

      <main className="settings-content">
        <div className="settings-content-inner models-settings">
          <header className="settings-title">
            <div>
              <h1>模型</h1>
              <p>配置 OpenAI 或 Anthropic 协议兼容接口，由 DeepSeek Harness 负责调用。</p>
            </div>
            <div className="settings-title-actions">
              {editingExisting && (
                <button className="settings-delete" disabled={saving} onClick={() => void remove()}>
                  <Icon name="trash" />删除
                </button>
              )}
              <button className="settings-save" disabled={saving || configuration === undefined} onClick={() => void save()}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </header>

          {error !== undefined && <div className="settings-notice error">{error}</div>}
          {message !== undefined && <div className="settings-notice success">{message}</div>}

          <section className="settings-section">
            <h2>兼容接口</h2>
            <div className="settings-card">
              <label className="settings-row">
                <span className="settings-row-copy"><b>接口名称</b><small>显示在模型选择器中的名称。</small></span>
                <input className="settings-text-input" value={draft.displayName} onChange={event => setDraft(current => ({ ...current, displayName: event.target.value }))} />
              </label>
              <label className="settings-row">
                <span className="settings-row-copy"><b>接口 ID</b><small>保存后不可修改，用作 Harness provider route。</small></span>
                <input className="settings-text-input" disabled={editingExisting} value={draft.id} onChange={event => setDraft(current => ({ ...current, id: event.target.value }))} spellCheck={false} />
              </label>
              <label className="settings-row">
                <span className="settings-row-copy"><b>协议</b><small>选择服务端实际兼容的请求格式。</small></span>
                <select value={draft.protocol} onChange={event => setDraft(current => ({ ...current, protocol: event.target.value as ModelProviderProtocol }))}>
                  <option value="openai-completions">OpenAI Chat Completions</option>
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                </select>
              </label>
              <label className="settings-row">
                <span className="settings-row-copy"><b>Base URL</b><small>接口根地址；保留服务要求的 `/v1`。</small></span>
                <input className="settings-text-input" value={draft.baseURL} onChange={event => setDraft(current => ({ ...current, baseURL: event.target.value }))} spellCheck={false} />
              </label>
              <label className="settings-row">
                <span className="settings-row-copy">
                  <b>API Key</b>
                  <small>{currentProfile?.credentialWritable === false
                    ? `凭据由 ${currentProfile.credentialSource ?? '外部来源'} 提供，当前不可修改。`
                    : currentProfile?.credentialConfigured === true
                      ? '已配置；留空表示保持原值。'
                      : '密钥只写入 Harness 凭据存储。'}</small>
                </span>
                <span className="credential-editor">
                  <input type="password" disabled={currentProfile?.credentialWritable === false} value={draft.apiKey} placeholder={currentProfile?.credentialConfigured === true ? '已配置' : 'sk-…'} onChange={event => setDraft(current => ({ ...current, apiKey: event.target.value, clearApiKey: false }))} autoComplete="off" />
                  {currentProfile?.credentialConfigured === true && currentProfile.credentialWritable && (
                    <button type="button" onClick={() => setDraft(current => ({ ...current, apiKey: '', clearApiKey: true }))}>
                      {draft.clearApiKey ? '将清除' : '清除'}
                    </button>
                  )}
                </span>
              </label>
            </div>
          </section>

          <section className="settings-section">
            <div className="section-heading-row">
              <div><h2>模型目录</h2><p>可从接口发现，也可以手工维护。</p></div>
              <div>
                <button className="secondary-button" onClick={() => setDraft(current => ({
                  ...current,
                  models: [...current.models, { id: '', name: '', contextWindow: 262_144, maxTokens: 32_768 }],
                }))}><Icon name="plus" />添加模型</button>
                <button className="secondary-button" disabled={discovering} onClick={() => void discover()}>
                  <Icon name="search" />{discovering ? '发现中…' : '发现模型'}
                </button>
              </div>
            </div>
            <div className="model-table">
              <div className="model-table-head"><span>模型 ID / 名称</span><span>上下文</span><span>最大输出</span><span /></div>
              {draft.models.map((model, index) => (
                <div className="model-table-row" key={`${model.id}-${String(index)}`}>
                  <div>
                    <input value={model.id} placeholder="model-id" onChange={event => updateModel(index, { id: event.target.value })} spellCheck={false} />
                    <input value={model.name} placeholder="显示名称" onChange={event => updateModel(index, { name: event.target.value })} />
                  </div>
                  <input type="number" min="1" value={model.contextWindow} onChange={event => updateModel(index, { contextWindow: Number(event.target.value) })} />
                  <input type="number" min="1" value={model.maxTokens} onChange={event => updateModel(index, { maxTokens: Number(event.target.value) })} />
                  <button aria-label="删除模型" onClick={() => setDraft(current => ({ ...current, models: current.models.filter((_item, itemIndex) => itemIndex !== index) }))}><Icon name="trash" /></button>
                </div>
              ))}
              {draft.models.length === 0 && <div className="model-table-empty">发现模型或手工添加至少一个模型。</div>}
            </div>
          </section>

          <section className="settings-section">
            <h2>默认模型</h2>
            <div className="settings-card">
              <label className="settings-row">
                <span className="settings-row-copy"><b>提供方</b><small>新建会话默认使用的接口。</small></span>
                <select value={defaultProvider} onChange={event => changeDefaultProvider(event.target.value)}>
                  {configuration?.groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}
                </select>
              </label>
              <label className="settings-row">
                <span className="settings-row-copy"><b>模型</b><small>{selectedModel?.description ?? '由 Harness 当前模型目录提供。'}</small></span>
                <select value={defaultModel} onChange={event => changeDefaultModel(event.target.value)}>
                  {selectedGroup?.models.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}
                </select>
              </label>
              <label className="settings-row">
                <span className="settings-row-copy"><b>推理强度</b><small>没有声明推理等级的模型使用服务端默认值。</small></span>
                <select value={reasoningEffort} disabled={(selectedModel?.reasoningEfforts.length ?? 0) === 0} onChange={event => setReasoningEffort(event.target.value)}>
                  {(selectedModel?.reasoningEfforts.length ?? 0) === 0
                    ? <option value="">模型默认</option>
                    : selectedModel?.reasoningEfforts.map(effort => <option value={effort.id} key={effort.id}>{effort.name}</option>)}
                </select>
              </label>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

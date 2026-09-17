import { useEffect, useMemo, useState } from 'react'
import type {
  ModelConfiguration,
  ModelConfigurationUpdate,
  ModelSelection,
} from '../shared/contracts'

function SettingsIcon({ name }: { name: 'arrow' | 'key' | 'model' | 'search' | 'sliders' }) {
  const content = {
    arrow: <path d="m15 18-6-6 6-6" />,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M15 8l2 2M17 6l2 2" /></>,
    model: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 9h8M8 13h5M8 17h3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  }[name]
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      {content}
    </svg>
  )
}

function selectionFrom(
  configuration: ModelConfiguration,
  provider: string,
  model: string,
  reasoningEffort: string,
): ModelSelection {
  return {
    provider,
    model,
    ...(reasoningEffort === '' ? {} : { reasoningEffort }),
  }
}

export function ModelSettings({ onClose }: { onClose: () => void }) {
  const [configuration, setConfiguration] = useState<ModelConfiguration>()
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [maxTokens, setMaxTokens] = useState('256000')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    void window.harnessStudio.models.getConfiguration().then((next) => {
      setConfiguration(next)
      setProvider(next.defaultSelection.provider)
      setModel(next.defaultSelection.model)
      setReasoningEffort(next.defaultSelection.reasoningEffort ?? '')
      setBaseURL(next.baseURL)
      setMaxTokens(String(next.maxTokens))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [])

  const providerGroup = useMemo(
    () => configuration?.groups.find(group => group.id === provider),
    [configuration, provider],
  )
  const selectedModel = useMemo(
    () => providerGroup?.models.find(candidate => candidate.id === model),
    [providerGroup, model],
  )

  function changeProvider(nextProvider: string) {
    setProvider(nextProvider)
    const group = configuration?.groups.find(candidate => candidate.id === nextProvider)
    const first = group?.models[0]
    setModel(first?.id ?? '')
    setReasoningEffort(first?.defaultReasoningEffort ?? '')
  }

  function changeModel(nextModel: string) {
    setModel(nextModel)
    const next = providerGroup?.models.find(candidate => candidate.id === nextModel)
    setReasoningEffort(next?.defaultReasoningEffort ?? '')
  }

  async function save() {
    if (configuration === undefined) return
    setSaving(true)
    setMessage(undefined)
    setError(undefined)
    try {
      const update: ModelConfigurationUpdate = {
        baseURL: baseURL.trim(),
        maxTokens: Number(maxTokens),
        defaultSelection: selectionFrom(configuration, provider, model, reasoningEffort),
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() }),
      }
      const next = await window.harnessStudio.models.updateConfiguration(update)
      setConfiguration(next)
      setApiKey('')
      setMessage('模型配置已保存，将用于下一次请求。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function clearCredential() {
    setSaving(true)
    setMessage(undefined)
    setError(undefined)
    try {
      const next = await window.harnessStudio.models.updateConfiguration({ clearApiKey: true })
      setConfiguration(next)
      setApiKey('')
      setMessage('API Key 已清除。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-window-drag" />
        <button className="settings-back" onClick={onClose}>
          <SettingsIcon name="arrow" />
          <span>返回应用</span>
        </button>
        <div className="settings-search">
          <SettingsIcon name="search" />
          <span>搜索设置…</span>
        </div>
        <div className="settings-nav-label">Harness</div>
        <button className="settings-nav active"><SettingsIcon name="model" /><span>模型</span></button>
        <button className="settings-nav" disabled><SettingsIcon name="key" /><span>凭据</span></button>
        <button className="settings-nav" disabled><SettingsIcon name="sliders" /><span>运行时</span></button>
      </aside>

      <main className="settings-content">
        <div className="settings-content-inner">
          <header className="settings-title">
            <div>
              <h1>模型配置</h1>
              <p>配置 DeepSeek Harness 使用的模型服务与默认模型。</p>
            </div>
            <button className="settings-save" disabled={saving || configuration === undefined} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </button>
          </header>

          {error !== undefined && <div className="settings-notice error">{error}</div>}
          {message !== undefined && <div className="settings-notice success">{message}</div>}

          <section className="settings-section">
            <h2>DeepSeek 连接</h2>
            <div className="settings-card">
              <label className="settings-row">
                <span className="settings-row-copy">
                  <b>API Key</b>
                  <small>密钥写入 Harness 凭据存储，界面不会读取或显示原值。</small>
                </span>
                <span className="credential-editor">
                  <input
                    type="password"
                    value={apiKey}
                    placeholder={configuration?.credentialConfigured === true ? '已配置；输入新值可替换' : 'sk-…'}
                    onChange={event => setApiKey(event.target.value)}
                    autoComplete="off"
                  />
                  {configuration?.credentialConfigured === true && (
                    <button disabled={saving || configuration.writable === false} onClick={() => void clearCredential()}>
                      清除
                    </button>
                  )}
                </span>
              </label>
              <label className="settings-row">
                <span className="settings-row-copy">
                  <b>服务地址</b>
                  <small>DeepSeek 官方接口或兼容 Chat Completions 的网关地址。</small>
                </span>
                <input
                  className="settings-text-input"
                  value={baseURL}
                  onChange={event => setBaseURL(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <div className="settings-row">
                <span className="settings-row-copy">
                  <b>凭据状态</b>
                  <small>只展示来源和状态，不返回密钥内容。</small>
                </span>
                <span className={`credential-state ${configuration?.credentialConfigured === true ? 'configured' : ''}`}>
                  <i />
                  {configuration?.credentialConfigured === true
                    ? `已配置${configuration.credentialSource === undefined ? '' : ` · ${configuration.credentialSource}`}`
                    : '未配置'}
                </span>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h2>默认模型</h2>
            <div className="settings-card">
              <label className="settings-row">
                <span className="settings-row-copy">
                  <b>提供方</b>
                  <small>由 Harness 当前已加载的模型适配器提供。</small>
                </span>
                <select value={provider} onChange={event => changeProvider(event.target.value)}>
                  {configuration?.groups.map(group => (
                    <option value={group.id} key={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>
              <label className="settings-row">
                <span className="settings-row-copy">
                  <b>模型</b>
                  <small>{selectedModel?.description ?? '新建会话默认使用此模型。'}</small>
                </span>
                <select value={model} onChange={event => changeModel(event.target.value)}>
                  {providerGroup?.models.map(candidate => (
                    <option value={candidate.id} key={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
              </label>
              <label className="settings-row">
                <span className="settings-row-copy">
                  <b>推理强度</b>
                  <small>控制思考深度；可用值由具体模型声明。</small>
                </span>
                <select
                  value={reasoningEffort}
                  disabled={(selectedModel?.reasoningEfforts.length ?? 0) === 0}
                  onChange={event => setReasoningEffort(event.target.value)}
                >
                  {(selectedModel?.reasoningEfforts.length ?? 0) === 0
                    ? <option value="">模型默认</option>
                    : selectedModel?.reasoningEfforts.map(effort => (
                      <option value={effort.id} key={effort.id}>{effort.name}</option>
                    ))}
                </select>
              </label>
              <label className="settings-row">
                <span className="settings-row-copy">
                  <b>最大输出 Token</b>
                  <small>单次根 Agent 模型请求的默认输出上限。</small>
                </span>
                <input
                  className="settings-number-input"
                  type="number"
                  min="1"
                  step="1"
                  value={maxTokens}
                  onChange={event => setMaxTokens(event.target.value)}
                />
              </label>
            </div>
          </section>

          <p className="settings-footnote">
            设置由 DeepSeek Harness 管理。服务地址、密钥和默认模型保存后会用于下一次模型请求，无需重启应用。
          </p>
        </div>
      </main>
    </div>
  )
}

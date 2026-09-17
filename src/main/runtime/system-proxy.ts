/** Converts Electron's resolved system proxy rules into Host environment variables. */
const PROXY_ENVIRONMENT_NAMES = [
  'http_proxy',
  'HTTP_PROXY',
  'https_proxy',
  'HTTPS_PROXY',
  'all_proxy',
  'ALL_PROXY',
] as const

export type ResolveProxy = (url: string) => Promise<string>

function hasExplicitProxy(environment: NodeJS.ProcessEnv): boolean {
  return PROXY_ENVIRONMENT_NAMES.some(name => {
    const value = environment[name]
    return value !== undefined && value.trim() !== ''
  })
}

/**
 * Return the first HTTP(S) proxy from one Chromium proxy-rule list.
 *
 * Chromium returns ordered rules such as `PROXY 127.0.0.1:7897; DIRECT`.
 * Harness accepts URL-valued HTTP proxies, so this function adds the scheme.
 */
export function proxyUrlFromRules(rules: string): string | undefined {
  for (const rawRule of rules.split(';')) {
    const rule = rawRule.trim()
    if (rule === '') continue
    if (/^DIRECT$/iu.test(rule)) return undefined
    const match = /^(PROXY|HTTP|HTTPS)\s+(.+)$/iu.exec(rule)
    if (match === null) continue
    const protocol = match[1]?.toUpperCase() === 'HTTPS' ? 'https:' : 'http:'
    const endpoint = match[2]?.trim()
    if (endpoint === undefined || endpoint === '') continue
    const parsed = URL.parse(`${protocol}//${endpoint}`)
    if (parsed === null || parsed.hostname === '' || parsed.port === '') continue
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  }
  return undefined
}

/**
 * Resolve the operating-system HTTP proxy for the child Harness Host.
 *
 * Explicit proxy environment variables retain precedence. Resolution failures
 * keep direct networking so a transient system-proxy lookup cannot stop the App.
 */
export async function systemProxyEnvironment(
  resolveProxy: ResolveProxy,
  environment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  if (hasExplicitProxy(environment)) return {}
  try {
    const [httpRules, httpsRules] = await Promise.all([
      resolveProxy('http://example.com/'),
      resolveProxy('https://example.com/'),
    ])
    const httpProxy = proxyUrlFromRules(httpRules)
    const httpsProxy = proxyUrlFromRules(httpsRules)
    return {
      ...(httpProxy === undefined ? {} : { http_proxy: httpProxy, HTTP_PROXY: httpProxy }),
      ...(httpsProxy === undefined ? {} : { https_proxy: httpsProxy, HTTPS_PROXY: httpsProxy }),
    }
  } catch {
    return {}
  }
}

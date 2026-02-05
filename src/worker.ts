/**
 * UBQ.FI Router — Cloudflare Worker
 * Deterministic routing to Deno Deploy apps; /rpc is same‑origin proxy.
 * No KV, no discovery, no sticky cookies, no Pages fallback.
 */

import { getSubdomainKey } from './utils/get-subdomain-key'
import { isPluginDomain } from './utils/is-plugin-domain'
import { buildDenoUrl } from './utils/build-deno-url'
import { buildPluginUrl } from './utils/build-plugin-url'

// Sitemap imports
import { getKnownServices, getKnownPlugins, coalesceDiscovery, coalescePluginDiscovery } from './utils/app-registry'
import { get, set } from './utils/cache'

export interface Env {
  // Optional env vars to control logging without code changes
  LOG_ROUTE_SAMPLE?: string // 0..1 sampling for normal route logs (deno/plugin)
  LOG_RPC_SAMPLE?: string   // 0..1 sampling for RPC logs
  LOG_HEALTH_SAMPLE?: string // 0..1 sampling for health logs
}

type LogKind = 'route' | 'rpc' | 'health'

function parseRate(value: string | undefined, fallback = 0): number {
  const n = Number(value)
  if (Number.isFinite(n)) return Math.min(1, Math.max(0, n))
  return fallback
}

function debugRequested(request: Request, url: URL): boolean {
  const hdr = request.headers.get('x-debug-log')?.toLowerCase()
  const qp = url.searchParams.get('__log')?.toLowerCase()
  return hdr === '1' || hdr === 'true' || qp === '1' || qp === 'true'
}

function shouldLog(kind: LogKind, request: Request, url: URL, env: Env): boolean {
  // Always allow explicit on-demand debugging via header or query param
  if (debugRequested(request, url)) return true
  switch (kind) {
    case 'rpc':
      return Math.random() < parseRate(env.LOG_RPC_SAMPLE, 0)
    case 'health':
      return Math.random() < parseRate(env.LOG_HEALTH_SAMPLE, 0)
    default:
      return Math.random() < parseRate(env.LOG_ROUTE_SAMPLE, 0)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Sitemap endpoints
    if (url.pathname === '/sitemap.xml') {
      return handleSitemapApps()
    }
    if (url.pathname === '/sitemap-apps.xml') {
      return handleSitemapApps()
    }
    if (url.pathname === '/sitemap-plugins.xml') {
      return handleSitemapPlugins()
    }
    if (url.pathname === '/map.json') {
      return handleMapApps()
    }
    if (url.pathname === '/map-apps.json') {
      return handleMapApps()
    }
    if (url.pathname === '/map-plugins.json') {
      return handleMapPlugins()
    }
    if (url.pathname === '/sitemap.json') {
      return handleSitemapApps()
    }
    if (url.pathname === '/plugin-map.xml') {
      return handleSitemapPlugins()
    }

    if (url.pathname === '/__health') {
      if (shouldLog('health', request, url, env)) {
        try {
          console.log(JSON.stringify({
            event: 'health',
            t: new Date().toISOString(),
            method: request.method,
            inHost: url.hostname,
            hostHeader: request.headers.get('host') || undefined,
            path: url.pathname,
            cfRay: request.headers.get('cf-ray') || undefined,
          }))
        } catch {}
      }
      return json({ status: 'ok', time: new Date().toISOString() })
    }

    if (url.pathname.startsWith('/rpc/')) {
      return handleRpc(request, url, env)
    }

    const inHost = url.hostname
    const isPlugin = isPluginDomain(inHost)
    const subKey = getSubdomainKey(inHost)
    const target = isPlugin
      ? buildPluginUrl(inHost, url)
      : subKey.startsWith('preview-')
        ? buildPreviewUrl(subKey, url)
        : buildDenoUrl(subKey, url)

    const started = Date.now()
    try {
      const res = await proxy(request, target)
      if (shouldLog('route', request, url, env)) {
        try {
          const log = {
            t: new Date().toISOString(),
            route: isPlugin ? 'plugin' : 'deno',
            method: request.method,
            inHost,
            hostHeader: request.headers.get('host') || undefined,
            path: url.pathname,
            hasQuery: url.search.length > 0,
            target,
            targetHost: new URL(target).hostname,
            status: res.status,
            ms: Date.now() - started,
            workIncoming: inHost === 'work.ubq.fi',
            workTarget: !isPlugin && subKey === 'work',
            cfRay: request.headers.get('cf-ray') || undefined,
          }
          // Structured JSON log for easy filtering in Workers Logs
          console.log(JSON.stringify({ event: 'route', ...log }))
        } catch {}
      }
      return res
    } catch (err) {
      console.error(JSON.stringify({
        event: 'route_error',
        t: new Date().toISOString(),
        route: isPlugin ? 'plugin' : 'deno',
        method: request.method,
        inHost,
        hostHeader: request.headers.get('host') || undefined,
        path: url.pathname,
        target,
        message: err instanceof Error ? err.message : String(err)
      }))
      return new Response('Upstream error', { status: 502 })
    }
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

async function handleRpc(request: Request, url: URL, env: Env): Promise<Response> {
  const parts = url.pathname.split('/')
  const chainId = parts[2]
  if (!chainId || !/^\d+$/.test(chainId)) {
    return new Response('Invalid chain ID. Must be numeric.', { status: 400 })
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400'
      }
    })
  }

  const targetUrl = `https://rpc.ubq.fi/${chainId}${url.search}`
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'origin' || k === 'referer') continue
    headers.set(key, value)
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual'
  }
  const started = Date.now()
  const resp = await fetch(new Request(targetUrl, init))
  const outHeaders = new Headers(resp.headers)
  outHeaders.set('Access-Control-Allow-Origin', '*')
  outHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  outHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  // RPC traffic can be very high-volume; sample heavily by default.
  if (shouldLog('rpc', request, url, env)) {
    try {
      const inHost = new URL(request.url).hostname
      const log = {
        t: new Date().toISOString(),
        route: 'rpc',
        method: request.method,
        inHost,
        hostHeader: request.headers.get('host') || undefined,
        path: url.pathname,
        hasQuery: url.search.length > 0,
        target: targetUrl,
        targetHost: 'rpc.ubq.fi',
        status: resp.status,
        ms: Date.now() - started,
        workIncoming: inHost === 'work.ubq.fi',
        cfRay: request.headers.get('cf-ray') || undefined,
      }
      console.log(JSON.stringify({ event: 'route', ...log }))
    } catch {}
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: outHeaders })
}

async function proxy(request: Request, targetUrl: string, timeoutMs = 6000): Promise<Response> {
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'origin' || k === 'referer' || k === 'cf-ray' || k === 'cookie') continue
    headers.set(key, value)
  }

  const init: RequestInit = { method: request.method, headers, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.clone().body
  }
  const res = await fetch(new Request(targetUrl, init), { signal: AbortSignal.timeout(timeoutMs) })
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
}

function buildPreviewUrl(subKey: string, url: URL): string {
  const base = subKey.replace(/^preview-/, '')
  const project = buildPreviewProject(base)
  return `https://${project}.deno.dev${url.pathname}${url.search}`
}

function buildPreviewProject(base: string): string {
  // Keep total length <= 26: p- + base + -ubq-fi (2 + len + 7)
  let name = base
  if (name.length > 17) {
    const hash = shortHash(name)
    name = `${name.slice(0, 12)}-${hash}`
  }
  return `p-${name}-ubq-fi`
}

function shortHash(input: string): string {
  // Lightweight deterministic hash, 4 hex chars
  let h = 0
  for (const ch of input) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0
  }
  return h.toString(16).padStart(4, '0').slice(0, 4)
}

// ===== Sitemap/Map Handlers =====

interface SitemapEntry {
  url: string
  subdomain?: string
  pluginName?: string
  serviceType: string
  priority: number
  changefreq: string
  lastmod: string
  github: string
  denoUrl?: string
  deployments?: {
    main: { url: string; available: boolean }
    development: { url: string; available: boolean }
  }
}

// Sitemap handler for apps
async function handleSitemapApps(): Promise<Response> {
  const entries = await discoverServicesForSitemap()
  const xml = generateXmlSitemapSimple(entries)
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}

// Map handler for apps
async function handleMapApps(): Promise<Response> {
  const entries = await discoverServicesForSitemap()
  const json = {
    version: '1.0',
    generated: new Date().toISOString(),
    generator: 'ubq.fi-router',
    totalUrls: entries.length,
    apps: entries,
  }
  return new Response(JSON.stringify(json, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}

// Sitemap handler for plugins
async function handleSitemapPlugins(): Promise<Response> {
  const entries = await discoverPluginsForSitemap()
  const xml = generateXmlPluginMapSimple(entries)
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}

// Map handler for plugins
async function handleMapPlugins(): Promise<Response> {
  const entries = await discoverPluginsForSitemap()
  const json = {
    version: '1.0',
    generated: new Date().toISOString(),
    generator: 'ubq.fi-router',
    totalPlugins: entries.length,
    plugins: entries,
  }
  return new Response(JSON.stringify(json, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}

// Discover services for sitemap
async function discoverServicesForSitemap(): Promise<SitemapEntry[]> {
  const services = getKnownServices()
  const entries: SitemapEntry[] = []

  for (const config of services) {
    let serviceType = 'service-none'
    const cacheKey = `service-type:${config.subdomain}`
    const cachedType = get<string>(cacheKey)

    if (cachedType !== null) {
      serviceType = cachedType
    } else {
      const result = await coalesceDiscovery(config.subdomain)
      serviceType = result.startsWith('service-') ? result : 'service-none'
      set(cacheKey, serviceType, 3600000)
    }

    const domain = config.subdomain === '' ? 'ubq.fi' : `${config.subdomain}.ubq.fi`
    entries.push({
      url: `https://${domain}/`,
      subdomain: config.subdomain,
      serviceType,
      priority: config.subdomain === '' ? 1.0 : 0.8,
      changefreq: serviceType === 'service-none' ? 'monthly' : 'weekly',
      lastmod: new Date().toISOString(),
      github: `https://github.com/${config.github}`,
      denoUrl: `https://${config.subdomain === '' ? 'ubq-fi' : config.subdomain + '-ubq-fi'}.deno.dev`,
    })
  }
  return entries
}

// Discover plugins for sitemap
async function discoverPluginsForSitemap(): Promise<SitemapEntry[]> {
  const plugins = getKnownPlugins()
  const entries: SitemapEntry[] = []

  for (const config of plugins) {
    let serviceType = 'plugin-none'
    const cacheKey = `plugin-type:${config.name}`
    const cachedType = get<string>(cacheKey)

    if (cachedType !== null) {
      serviceType = cachedType
    } else {
      const result = await coalescePluginDiscovery(config.name)
      serviceType = result.startsWith('plugin-') ? result : 'plugin-none'
      set(cacheKey, serviceType, 3600000)
    }

    entries.push({
      url: `https://os-${config.name}.ubq.fi/`,
      pluginName: config.name,
      serviceType,
      priority: 0.7,
      changefreq: serviceType === 'plugin-none' ? 'monthly' : 'weekly',
      lastmod: new Date().toISOString(),
      github: `https://github.com/${config.github}`,
      deployments: {
        main: {
          url: `https://${config.name}-main.deno.dev`,
          available: serviceType !== 'plugin-none',
        },
        development: {
          url: `https://${config.name}-development.deno.dev`,
          available: false,
        },
      },
    })
  }
  return entries
}

// Generate XML sitemap (simple inline version)
function generateXmlSitemapSimple(entries: SitemapEntry[]): string {
  const urls = entries.map(e => `  <url>
    <loc>${e.url}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority.toFixed(1)}</priority>
  </url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

// Generate XML plugin map (simple inline version)
function generateXmlPluginMapSimple(entries: SitemapEntry[]): string {
  const urls = entries.map(e => `  <url>
    <loc>${e.url}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority.toFixed(1)}</priority>
    <!-- Plugin: ${e.pluginName} -->
  </url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

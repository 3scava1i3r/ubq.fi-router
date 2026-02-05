/**
 * App Registry - Service and plugin discovery
 * Maps subdomains to GitHub repos and checks Deno/Pages availability
 */

import type { ServiceType } from '../types'
import { buildDenoUrl } from './build-deno-url'

// Request coalescing map to prevent duplicate discoveries
const inFlightDiscoveries = new Map<string, Promise<ServiceType>>()

export interface AppConfig {
  subdomain: string
  github: string // github.com/owner/repo
}

export interface PluginConfig {
  name: string
  github: string // github.com/owner/repo
}

// Known services (ubiquity org)
const DEFAULT_SERVICES: AppConfig[] = [
  { subdomain: '', github: 'ubiquity/ubq.fi' },
  { subdomain: 'work', github: 'ubiquity/work.ubq.fi' },
  { subdomain: 'pay', github: 'ubiquity/pay.ubq.fi' },
  { subdomain: 'ai', github: 'ubiquity/ai.ubq.fi' },
  { subdomain: 'demo', github: 'ubiquity/demo.ubq.fi' },
  { subdomain: 'xp', github: 'ubiquity/xp.ubq.fi' },
  { subdomain: 'uusd', github: 'ubiquity/uusd.ubq.fi' },
  { subdomain: 'stake', github: 'ubiquity/stake.ubq.fi' },
  { subdomain: 'safe', github: 'ubiquity/safe.ubq.fi' },
  { subdomain: 'card', github: 'ubiquity/card.ubq.fi' },
  { subdomain: 'permit2-allowance', github: 'ubiquity/permit2-allowance.ubq.fi' },
  { subdomain: 'partner', github: 'ubiquity/partner.ubq.fi' },
  { subdomain: 'onboard', github: 'ubiquity/onboard.ubq.fi' },
  { subdomain: 'notifications', github: 'ubiquity/notifications.ubq.fi' },
  { subdomain: 'leaderboard', github: 'ubiquity/leaderboard.ubq.fi' },
  { subdomain: 'keygen', github: 'ubiquity/keygen.ubq.fi' },
  { subdomain: 'health', github: 'ubiquity/health.ubq.fi' },
  { subdomain: 'audit', github: 'ubiquity/audit.ubq.fi' },
]

// Known plugins (ubiquity-os-marketplace org)
const DEFAULT_PLUGINS: PluginConfig[] = [
  { name: 'daemon-xp', github: 'ubiquity-os-marketplace/daemon-xp' },
  { name: 'daemon-xp-main', github: 'ubiquity-os-marketplace/daemon-xp/tree/main' },
  { name: 'daemon-xp-development', github: 'ubiquity-os-marketplace/daemon-xp/tree/development' },
  { name: 'text-conversation-rewards', github: 'ubiquity-os-marketplace/text-conversation-rewards' },
  { name: 'text-conversation-rewards-main', github: 'ubiquity-os-marketplace/text-conversation-rewards/tree/main' },
  { name: 'text-conversation-rewards-development', github: 'ubiquity-os-marketplace/text-conversation-rewards/tree/development' },
  { name: 'daemon-task-matcher', github: 'ubiquity-os-marketplace/daemon-task-matcher' },
  { name: 'daemon-task-matcher-main', github: 'ubiquity-os-marketplace/daemon-task-matcher/tree/main' },
  { name: 'daemon-task-matcher-development', github: 'ubiquity-os-marketplace/daemon-task-matcher/tree/development' },
  { name: 'daemon-spec-rewriter', github: 'ubiquity-os-marketplace/daemon-spec-rewriter' },
  { name: 'daemon-spec-rewriter-main', github: 'ubiquity-os-marketplace/daemon-spec-rewriter/tree/main' },
  { name: 'daemon-spec-rewriter-development', github: 'ubiquity-os-marketplace/daemon-spec-rewriter/tree/development' },
  { name: 'text-vector-embeddings', github: 'ubiquity-os-marketplace/text-vector-embeddings' },
  { name: 'text-vector-embeddings-main', github: 'ubiquity-os-marketplace/text-vector-embeddings/tree/main' },
  { name: 'text-vector-embeddings-development', github: 'ubiquity-os-marketplace/text-vector-embeddings/tree/development' },
  { name: 'daemon-pricing', github: 'ubiquity-os-marketplace/daemon-pricing' },
  { name: 'daemon-pricing-main', github: 'ubiquity-os-marketplace/daemon-pricing/tree/main' },
  { name: 'daemon-pricing-development', github: 'ubiquity-os-marketplace/daemon-pricing/tree/development' },
  { name: 'command-config', github: 'ubiquity-os-marketplace/command-config' },
  { name: 'command-config-main', github: 'ubiquity-os-marketplace/command-config/tree/main' },
  { name: 'command-config-development', github: 'ubiquity-os-marketplace/command-config/tree/development' },
  { name: 'daemon-planner', github: 'ubiquity-os-marketplace/daemon-planner' },
  { name: 'daemon-planner-main', github: 'ubiquity-os-marketplace/daemon-planner/tree/main' },
  { name: 'daemon-planner-development', github: 'ubiquity-os-marketplace/daemon-planner/tree/development' },
  { name: 'daemon-merging', github: 'ubiquity-os-marketplace/daemon-merging' },
  { name: 'daemon-merging-main', github: 'ubiquity-os-marketplace/daemon-merging/tree/main' },
  { name: 'daemon-merging-development', github: 'ubiquity-os-marketplace/daemon-merging/tree/development' },
  { name: 'command-wallet', github: 'ubiquity-os-marketplace/command-wallet' },
  { name: 'command-wallet-main', github: 'ubiquity-os-marketplace/command-wallet/tree/main' },
  { name: 'command-wallet-development', github: 'ubiquity-os-marketplace/command-wallet/tree/development' },
  { name: 'daemon-disqualifier', github: 'ubiquity-os-marketplace/daemon-disqualifier' },
  { name: 'daemon-disqualifier-main', github: 'ubiquity-os-marketplace/daemon-disqualifier/tree/main' },
  { name: 'daemon-disqualifier-development', github: 'ubiquity-os-marketplace/daemon-disqualifier/tree/development' },
  { name: 'command-start-stop', github: 'ubiquity-os-marketplace/command-start-stop' },
  { name: 'command-start-stop-main', github: 'ubiquity-os-marketplace/command-start-stop/tree/main' },
  { name: 'command-start-stop-development', github: 'ubiquity-os-marketplace/command-start-stop/tree/development' },
  { name: 'command-query', github: 'ubiquity-os-marketplace/command-query' },
  { name: 'command-query-main', github: 'ubiquity-os-marketplace/command-query/tree/main' },
  { name: 'command-query-development', github: 'ubiquity-os-marketplace/command-query/tree/development' },
]

/**
 * Get all known services
 */
export function getKnownServices(): AppConfig[] {
  return DEFAULT_SERVICES
}

/**
 * Get all known plugins
 */
export function getKnownPlugins(): PluginConfig[] {
  return DEFAULT_PLUGINS
}

/**
 * Check if a Deno Deploy URL exists
 */
export async function checkDenoExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    })
    return response.status >= 200 && response.status < 300
  } catch {
    return false
  }
}

/**
 * Discover service type for a subdomain
 */
export async function discoverServiceType(subdomain: string): Promise<ServiceType> {
  const denoUrl = buildDenoUrl(subdomain, new URL(`https://${subdomain || 'ubq.fi'}.ubq.fi`))

  const exists = await checkDenoExists(denoUrl)
  return exists ? 'service-deno' : 'service-none'
}

/**
 * Discover plugin type by checking manifest.json
 */
export async function discoverPluginType(pluginName: string): Promise<ServiceType> {
  const manifestUrl = `https://${pluginName}.deno.dev/manifest.json`

  try {
    const response = await fetch(manifestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })

    if (response.ok) {
      const manifest = await response.json()
      if (manifest.name && manifest.description) {
        return 'plugin-deno'
      }
    }
    return 'plugin-none'
  } catch {
    return 'plugin-none'
  }
}

/**
 * Coalesce multiple discovery requests for the same subdomain
 * Prevents redundant parallel discoveries
 */
export async function coalesceDiscovery(subdomain: string): Promise<ServiceType> {
  // Check if discovery is already in progress
  const inFlight = inFlightDiscoveries.get(subdomain)
  if (inFlight) {
    return await inFlight
  }

  const discoveryPromise = discoverServiceType(subdomain)
  inFlightDiscoveries.set(subdomain, discoveryPromise)

  try {
    return await discoveryPromise
  } finally {
    inFlightDiscoveries.delete(subdomain)
  }
}

/**
 * Coalesce multiple plugin discovery requests
 */
export async function coalescePluginDiscovery(pluginName: string): Promise<ServiceType> {
  const inFlight = inFlightDiscoveries.get(`plugin:${pluginName}`)
  if (inFlight) {
    return await inFlight
  }

  const discoveryPromise = discoverPluginType(pluginName)
  inFlightDiscoveries.set(`plugin:${pluginName}`, discoveryPromise)

  try {
    return await discoveryPromise
  } finally {
    inFlightDiscoveries.delete(`plugin:${pluginName}`)
  }
}

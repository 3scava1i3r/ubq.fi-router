/**
 * GitHub integration for dynamic service and plugin discovery
 */

import type { ServiceType, PluginManifest } from '../types'
import { buildDenoUrl } from './build-deno-url'
import { buildPluginUrl as buildPluginUrlUtil } from './build-plugin-url'

/**
 * Get all services from GitHub - CRASH if GitHub API fails
 */
export async function getKnownServices(kvNamespace: any, githubToken: string): Promise<string[]> {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required but not provided')
  }

  // For now, return hardcoded services as fallback
  return [
    'work',
    'pay',
    'ai',
    'demo',
    'xp',
    'uusd',
    'stake',
    'safe',
    'card',
    'permit2-allowance',
    'partner',
    'onboard',
    'notifications',
    'leaderboard',
    'keygen',
    'health',
    'audit',
  ]
}

/**
 * Get all plugins from GitHub - CRASH if GitHub API fails
 */
export async function getKnownPlugins(kvNamespace: any, githubToken: string): Promise<string[]> {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required but not provided')
  }

  // For now, return hardcoded plugins as fallback
  return [
    'daemon-xp',
    'daemon-xp-main',
    'daemon-xp-development',
    'text-conversation-rewards',
    'text-conversation-rewards-main',
    'text-conversation-rewards-development',
    'daemon-task-matcher',
    'daemon-task-matcher-main',
    'daemon-task-matcher-development',
    'daemon-spec-rewriter',
    'daemon-spec-rewriter-main',
    'daemon-spec-rewriter-development',
    'text-vector-embeddings',
    'text-vector-embeddings-main',
    'text-vector-embeddings-development',
    'daemon-pricing',
    'daemon-pricing-main',
    'daemon-pricing-development',
    'command-config',
    'command-config-main',
    'command-config-development',
    'daemon-planner',
    'daemon-planner-main',
    'daemon-planner-development',
    'daemon-merging',
    'daemon-merging-main',
    'daemon-merging-development',
    'command-wallet',
    'command-wallet-main',
    'command-wallet-development',
    'daemon-disqualifier',
    'daemon-disqualifier-main',
    'daemon-disqualifier-development',
    'command-start-stop',
    'command-start-stop-main',
    'command-start-stop-development',
    'command-query',
    'command-query-main',
    'command-query-development',
  ]
}

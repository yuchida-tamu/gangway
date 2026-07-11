import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { GangwayClient, createExpoRouterAdapter } from '@gangway/client'
import type { Errors } from '@gangway/protocol'
import type { Pages } from '@demo/server'

/**
 * Typed props for a screen, derived from the BFF's page map. This is the
 * component contract: the server literally cannot return props for
 * 'Orders/Show' that don't typecheck against what the screen declares.
 */
export type PageProps<K extends keyof Pages> = Pages[K] & { errors: Errors }

/** This bundle's capability version — bump when screens are added OTA. */
export const BUNDLE_VERSION = '1'

const baseUrl =
  process.env.EXPO_PUBLIC_BFF_URL ??
  Platform.select({ android: 'http://10.0.2.2:3939', default: 'http://localhost:3939' })

export const gangway = new GangwayClient({
  baseUrl,
  bundleVersion: BUNDLE_VERSION,
  runtimeVersion: Constants.expoConfig?.runtimeVersion?.toString() ?? 'dev',
  router: createExpoRouterAdapter(),
  // Prefetch-on-press-in + stale-while-revalidate (issue #1). A generous window
  // keeps a just-visited screen warm (repeat forward-nav pushes same-frame with
  // no refetch) — a real app would tune this per data freshness.
  revalidateAfterMs: 60_000,
  onVersionDrift: (serverVersion) => {
    // Real app: Updates.checkForUpdateAsync() → fetch in background,
    // apply on next launch. Demo just logs.
    console.log(`[gangway] bundle drift: server expects ${serverVersion}, we are ${BUNDLE_VERSION}`)
  },
  onUpdateRequired: (info) => {
    // Real app: Updates.fetchUpdateAsync() → Updates.reloadAsync().
    console.log(`[gangway] update required: need bundle >= ${info.minBundle}`)
  },
})

/**
 * Maps protocol NavActions onto Expo Router's imperative API.
 *
 * Convention: the host app declares two catch-all routes that both render
 * <GangwayScreen />:
 *
 *   app/s/[key].tsx   — standard card presentation
 *   app/m/[key].tsx   — presentation: 'modal' (declared in app/_layout.tsx)
 *
 * Screens locate their page object in the client's store via the `key`
 * route param, so going BACK never refetches — the cached page renders.
 */
import { router } from 'expo-router'
import type { NavAction } from '@gangway/protocol'
import type { RouterAdapter } from './core'

export function createExpoRouterAdapter(): RouterAdapter {
  return {
    apply(action: NavAction, key: string) {
      switch (action) {
        case 'push':
          router.push(`/s/${key}`)
          break
        case 'replace':
          router.replace(`/s/${key}`)
          break
        case 'modal':
          router.push(`/m/${key}`)
          break
        case 'resetTo':
          // Unwind the stack, then swap the root screen.
          if (router.canDismiss()) router.dismissAll()
          router.replace(`/s/${key}`)
          break
        case 'back':
          if (router.canGoBack()) router.back()
          break
      }
    },
  }
}

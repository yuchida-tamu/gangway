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
 * The `u` (url) param lets a screen rehydrate itself if the in-memory store
 * was lost (JS reload / OTA / cold start with restored navigation).
 */
import { router } from 'expo-router'
import type { NavAction } from '@gangway/protocol'
import type { RouterAdapter } from './core'

export function createExpoRouterAdapter(): RouterAdapter {
  const card = (key: string, url: string) =>
    ({ pathname: '/s/[key]', params: { key, u: url } }) as const
  const modal = (key: string, url: string) =>
    ({ pathname: '/m/[key]', params: { key, u: url } }) as const

  return {
    apply(action: NavAction, key: string, url: string) {
      switch (action) {
        case 'push':
          router.push(card(key, url))
          break
        case 'replace':
          router.replace(card(key, url))
          break
        case 'modal':
          router.push(modal(key, url))
          break
        case 'resetTo':
          // Unwind the stack, then swap the root screen.
          if (router.canDismiss()) router.dismissAll()
          router.replace(card(key, url))
          break
        case 'back':
          if (router.canGoBack()) router.back()
          break
      }
    },
  }
}

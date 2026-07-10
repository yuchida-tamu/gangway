import type { ScreenRegistry } from '@gangway/client'
import Home from './screens/Home'
import OrdersIndex from './screens/OrdersIndex'
import OrdersShow from './screens/OrdersShow'
import OrdersNew from './screens/OrdersNew'

/**
 * The client's half of the component contract. Keys must match the names the
 * BFF returns. 'Labs/Future' is deliberately absent — visiting /labs on the
 * server exercises the missing-component fallback.
 */
export const registry: ScreenRegistry = {
  Home,
  'Orders/Index': OrdersIndex,
  'Orders/Show': OrdersShow,
  'Orders/New': OrdersNew,
}

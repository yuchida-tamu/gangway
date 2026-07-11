/**
 * React bindings: <GangwayProvider>, <GangwayScreen>, usePage, useForm, <Link>.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react'
import type { Errors, PageObject, UpdateRequired } from '@gangway/protocol'
import {
  COMPONENT_UPDATE_REQUIRED,
  GangwayClient,
  type ActionResult,
  type VisitOptions,
  type VisitResult,
} from './core'

/** Screen registry: component name → React component. The client's half of
 *  the component contract; its key set defines what this bundle can render. */
export type ScreenRegistry = Record<string, ComponentType<any>>

export type FallbackReason =
  | 'missing-component'
  | 'update-required'
  | 'missing-page'
  /** Store entry lost (reload/cold-start) but the route knows its URL — a
   *  rehydrate fetch is in flight. Render a spinner, not an error. */
  | 'rehydrating'

export interface FallbackProps {
  reason: FallbackReason
  /** Component name the server asked for (when known). */
  component?: string
  info?: UpdateRequired
  retry?: () => void
}

interface GangwayContextValue {
  client: GangwayClient
  registry: ScreenRegistry
  Fallback: ComponentType<FallbackProps>
}

const GangwayContext = createContext<GangwayContextValue | null>(null)
const PageContext = createContext<{ page: PageObject; pageKey: string } | null>(null)

export function GangwayProvider(props: {
  client: GangwayClient
  registry: ScreenRegistry
  fallback: ComponentType<FallbackProps>
  children: ReactNode
}) {
  const value = useMemo(
    () => ({ client: props.client, registry: props.registry, Fallback: props.fallback }),
    [props.client, props.registry, props.fallback],
  )
  return <GangwayContext.Provider value={value}>{props.children}</GangwayContext.Provider>
}

export function useGangway(): GangwayContextValue {
  const ctx = useContext(GangwayContext)
  if (!ctx) throw new Error('Gangway hooks must be used inside <GangwayProvider>')
  return ctx
}

/**
 * Renders the page object stored under `pageKey` by resolving its component
 * name against the registry. Host apps mount this in their catch-all routes
 * (app/s/[key].tsx and app/m/[key].tsx).
 */
export function GangwayScreen({ pageKey, url }: { pageKey: string; url?: string }) {
  const { client, registry, Fallback } = useGangway()
  const page = useSyncExternalStore(
    useCallback((cb) => client.subscribe(pageKey, cb), [client, pageKey]),
    () => client.getPage(pageKey),
  )

  // Store miss but the route carried its URL → the in-memory store was lost
  // (JS reload / OTA / cold start with restored nav). Re-fetch in place.
  useEffect(() => {
    if (!page && url) void client.rehydrate(pageKey, url)
  }, [page, url, pageKey, client])

  if (!page) {
    if (url) {
      return <Fallback reason="rehydrating" retry={() => void client.rehydrate(pageKey, url)} />
    }
    return <Fallback reason="missing-page" />
  }
  if (page.component === COMPONENT_UPDATE_REQUIRED) {
    return <Fallback reason="update-required" info={(page.props as any).info} />
  }

  const Screen = registry[page.component]
  if (!Screen) {
    // The wall: server referenced a screen this bundle doesn't have.
    return <Fallback reason="missing-component" component={page.component} />
  }

  return (
    <PageContext.Provider value={{ page, pageKey }}>
      <Screen {...page.props} />
    </PageContext.Provider>
  )
}

/** Current page object + a reload helper (pull-to-refresh). */
export function usePage<P = Record<string, unknown>>() {
  const ctx = useContext(PageContext)
  const { client } = useGangway()
  if (!ctx) throw new Error('usePage must be used inside a Gangway screen')
  const reload = useCallback(() => client.reload(ctx.pageKey), [client, ctx.pageKey])
  return { ...(ctx.page as PageObject<P & { errors: Errors }>), reload }
}

/** Imperative visit — for buttons, effects, initial boot. */
export function useVisit() {
  const { client } = useGangway()
  return useCallback((url: string, opts?: VisitOptions) => client.visit(url, opts), [client])
}

/**
 * In-place server action — the escape hatch from navigation. `run(url, data)`
 * POSTs to a route and returns the server's raw JSON (via ActionResult); the
 * component updates its own state and animates on the result, with no
 * navigation and no page-store change. `pending` is true while in flight.
 * For like/react buttons, toggles, counters, optimistic UI.
 */
export function useAction<T = unknown>() {
  const { client } = useGangway()
  const [pending, setPending] = useState(false)
  const run = useCallback(
    async (url: string, data?: Record<string, unknown>): Promise<ActionResult<T>> => {
      setPending(true)
      try {
        return await client.action<T>(url, data)
      } finally {
        setPending(false)
      }
    },
    [client],
  )
  return { run, pending }
}

/**
 * Inertia-style form helper. POSTs to a BFF route; on 422 the errors land in
 * `form.errors` and the user stays put; on success the server's 303 redirect
 * resolves to the next screen automatically.
 */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const { client } = useGangway()
  const [data, setDataState] = useState<T>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [processing, setProcessing] = useState(false)

  const setData = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setDataState((d) => ({ ...d, [key]: value }))
  }, [])

  const submit = useCallback(
    async (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string): Promise<VisitResult> => {
      setProcessing(true)
      setErrors({})
      try {
        const result = await client.visit(url, { method, data })
        if (!result.ok && result.kind === 'validation') setErrors(result.errors)
        return result
      } finally {
        setProcessing(false)
      }
    },
    [client, data],
  )

  return {
    data,
    setData,
    errors,
    processing,
    post: (url: string) => submit('POST', url),
    put: (url: string) => submit('PUT', url),
    patch: (url: string) => submit('PATCH', url),
    delete: (url: string) => submit('DELETE', url),
  }
}

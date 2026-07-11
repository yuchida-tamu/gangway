import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, type StyleProp, type ViewStyle } from 'react-native'
import type { NavAction } from '@gangway/protocol'
import { usePrefetch, useVisit } from './bindings'

/**
 * Gangway-aware link: a Pressable that performs a protocol visit instead of
 * client-side routing. The BFF decides what screen comes back.
 *
 * Perceived latency (issue #1): the GET starts on `onPressIn` (prefetch), so
 * by the time `onPress` fires the response is often in flight or cached — a
 * warm cache pushes in the same frame. `busy` dims the link while a cold visit
 * is still fetching (a visible in-flight affordance); on a warm hit the visit
 * resolves in a microtask so `busy` never visibly flips.
 */
export function Link(props: {
  href: string
  intent?: NavAction
  style?: StyleProp<ViewStyle>
  disabled?: boolean
  /** Start the GET on press-in. Default true. */
  prefetch?: boolean
  children: ReactNode
}) {
  const visit = useVisit()
  const prefetch = usePrefetch()
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  return (
    <Pressable
      style={({ pressed }) => [props.style, (busy || pressed) && { opacity: 0.5 }]}
      disabled={props.disabled || busy}
      onPressIn={() => {
        if (props.prefetch !== false) void prefetch(props.href)
      }}
      onPress={async () => {
        setBusy(true)
        try {
          await visit(props.href, { intent: props.intent })
        } finally {
          if (mounted.current) setBusy(false)
        }
      }}
    >
      {props.children}
    </Pressable>
  )
}

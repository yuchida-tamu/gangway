import React, { type ReactNode } from 'react'
import { Pressable, type StyleProp, type ViewStyle } from 'react-native'
import type { NavAction } from '@gangway/protocol'
import { useVisit } from './bindings'

/**
 * Gangway-aware link: a Pressable that performs a protocol visit instead of
 * client-side routing. The BFF decides what screen comes back.
 */
export function Link(props: {
  href: string
  intent?: NavAction
  style?: StyleProp<ViewStyle>
  disabled?: boolean
  children: ReactNode
}) {
  const visit = useVisit()
  return (
    <Pressable
      style={props.style}
      disabled={props.disabled}
      onPress={() => visit(props.href, { intent: props.intent })}
    >
      {props.children}
    </Pressable>
  )
}

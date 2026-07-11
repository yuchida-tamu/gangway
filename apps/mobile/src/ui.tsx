/** Tiny shared UI vocabulary for the demo screens. */
import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'

export const colors = {
  bg: '#0f1115',
  card: '#1a1e26',
  text: '#e6e9ef',
  dim: '#8a91a0',
  accent: '#5eead4',
  danger: '#f87171',
}

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>
}

export function Body({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return <Text style={[styles.body, dim && { color: colors.dim }]}>{children}</Text>
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>
}

export function Button(props: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        styles.button,
        props.danger && { backgroundColor: colors.danger },
        (pressed || props.disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={styles.buttonLabel}>{props.label}</Text>
    </Pressable>
  )
}

/**
 * Client-only reveal animation: fades + slides its children in/out when
 * `visible` toggles. Pure React Native Animated (no native deps, no server) —
 * demonstrates that Gangway screens can express real animations with zero
 * framework involvement. Unmounts after the exit animation so the DOM is clean.
 */
export function Reveal({ visible, children }: { visible: boolean; children: ReactNode }) {
  const v = useRef(new Animated.Value(visible ? 1 : 0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: true }).start()
    } else {
      Animated.timing(v, { toValue: 0, duration: 160, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
  }, [visible, v])

  if (!mounted) return null
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  )
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 20, gap: 12 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, gap: 6 },
  body: { color: colors.text, fontSize: 16 },
  error: { color: colors.danger, fontSize: 13, marginTop: 2 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonLabel: { color: '#08251f', fontWeight: '700', fontSize: 15 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
})

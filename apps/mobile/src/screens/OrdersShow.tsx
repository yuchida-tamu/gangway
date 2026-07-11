import React, { useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, View } from 'react-native'
import { useAction, useVisit } from '@gangway/client'
import type { PageProps } from '../gangway'
import { Body, Button, Card, Reveal, Screen, Title, colors } from '../ui'

export default function OrdersShow({ order }: PageProps<'Orders/Show'>) {
  const visit = useVisit()
  // Pure client state — the toggle and its animation never touch the server.
  const [showTimeline, setShowTimeline] = useState(false)

  // In-place server action: the reaction count is server state, updated and
  // animated WITHOUT navigating. Seeded from the page props, then driven by
  // action() responses.
  const react = useAction<{ reactions: number }>()
  const [reactions, setReactions] = useState(order.reactions)
  const pop = useRef(new Animated.Value(1)).current

  const onReact = async () => {
    const r = await react.run(`/orders/${order.id}/react`)
    if (r.ok) {
      setReactions(r.data.reactions) // server-confirmed value
      Animated.sequence([
        Animated.timing(pop, { toValue: 1.5, duration: 110, useNativeDriver: true }),
        Animated.spring(pop, { toValue: 1, friction: 3, useNativeDriver: true }),
      ]).start()
    }
  }

  return (
    <Screen>
      <Title>{order.title}</Title>
      <Card>
        <Body>Amount: ¥{order.amount.toLocaleString()}</Body>
        <Body dim>Status: {order.status}</Body>
        <Body dim>Created: {order.createdAt}</Body>
      </Card>

      {/* The count lives OUTSIDE the Pressable so its text isn't masked by the
          button's accessibilityLabel (and stays assertable in E2E). */}
      <View style={styles.reactRow}>
        <Pressable accessibilityLabel="Add reaction" onPress={onReact} disabled={react.pending}>
          <Animated.Text style={[styles.heart, { transform: [{ scale: pop }] }]}>♥</Animated.Text>
        </Pressable>
        <Body>Reactions: {reactions}</Body>
      </View>

      <Button
        danger
        label="Archive"
        onPress={() => visit(`/orders/${order.id}/archive`, { method: 'POST' })}
      />
      <Button
        label={showTimeline ? 'Hide timeline' : 'Show timeline'}
        onPress={() => setShowTimeline((s) => !s)}
      />
      <Reveal visible={showTimeline}>
        <Card>
          <Body>Order timeline</Body>
          <Body dim>Created {order.createdAt}</Body>
          <Body dim>Opened just now — animated client-side, no server call</Body>
        </Card>
      </Reveal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  reactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  heart: { color: colors.danger, fontSize: 28 },
})

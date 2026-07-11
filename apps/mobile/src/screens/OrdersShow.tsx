import React, { useState } from 'react'
import { useVisit } from '@gangway/client'
import type { PageProps } from '../gangway'
import { Body, Button, Card, Reveal, Screen, Title } from '../ui'

export default function OrdersShow({ order }: PageProps<'Orders/Show'>) {
  const visit = useVisit()
  // Pure client state — the toggle and its animation never touch the server.
  const [showTimeline, setShowTimeline] = useState(false)

  return (
    <Screen>
      <Title>{order.title}</Title>
      <Card>
        <Body>Amount: ¥{order.amount.toLocaleString()}</Body>
        <Body dim>Status: {order.status}</Body>
        <Body dim>Created: {order.createdAt}</Body>
      </Card>
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

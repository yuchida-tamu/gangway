import React from 'react'
import { useVisit } from '@gangway/client'
import type { PageProps } from '../gangway'
import { Body, Button, Card, Screen, Title } from '../ui'

export default function OrdersShow({ order }: PageProps<'Orders/Show'>) {
  const visit = useVisit()
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
    </Screen>
  )
}

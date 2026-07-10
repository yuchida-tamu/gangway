import React from 'react'
import { Link } from '@gangway/client'
import type { PageProps } from '../gangway'
import { Body, Button, Card, Screen, Title, colors } from '../ui'
import { useVisit } from '@gangway/client'

export default function Home({ greeting, stats }: PageProps<'Home'>) {
  const visit = useVisit()
  return (
    <Screen>
      <Title>{greeting}</Title>
      <Card>
        <Body>Open orders: {stats.open}</Body>
        <Body dim>Archived: {stats.archived}</Body>
      </Card>
      <Button label="View orders" onPress={() => visit('/orders')} />
      <Link href="/labs">
        <Card>
          <Body>Labs (screen this bundle doesn't have — fallback demo)</Body>
        </Card>
      </Link>
      <Link href="/vip">
        <Card>
          <Body>VIP (server gate — 409 update-required demo)</Body>
        </Card>
      </Link>
      <Body dim>
        Every screen you see is chosen by the BFF. This app only ships components; routing, data
        and flow live on the server.
      </Body>
    </Screen>
  )
}
